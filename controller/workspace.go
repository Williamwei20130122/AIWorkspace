package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// WorkspaceRelay 承接中台同步生成能力（文生文 / 文生图 / 图生图 / 声音合成）。
// 请求路径与 relay_mode 已由 middleware.WorkspaceGenerateRoute 规范化为
// new-api 的标准上游通路，这里只按能力类型选择请求解析格式，
// 之后的渠道选择、计费与上游调用完全复用 new-api 现有链路。
func WorkspaceRelay(c *gin.Context) {
	// 通用 JSON 格式：透传原始请求体，避免 new-api 按 OpenAI 结构体重新序列化时
	// 丢弃非标准协议的自定义字段。需在 Relay（内部 GenRelayInfo 读取渠道设置）之前设置。
	workspaceApplyBodyPassthrough(c)
	switch c.GetString(middleware.WorkspaceCapabilityKindKey) {
	case "image", "edit":
		Relay(c, types.RelayFormatOpenAIImage)
	case "tts":
		Relay(c, types.RelayFormatOpenAIAudio)
	default:
		Relay(c, types.RelayFormatOpenAI)
	}
}

// workspaceApplyBodyPassthrough 当「模型 × 功能」声明的请求格式为通用 JSON 时，
// 把当前渠道设置为「原样透传请求体」，使上游收到用户/管理员配置的完整字段。
func workspaceApplyBodyPassthrough(c *gin.Context) {
	kind := c.GetString(middleware.WorkspaceCapabilityKindKey)
	modelName := strings.TrimSpace(c.GetString("resolved_task_model"))
	if kind == "" || modelName == "" {
		return
	}
	endpoint, ok := setting.WorkspaceModelEndpointFor(modelName, kind)
	if !ok || endpoint.Format != setting.WorkspaceEndpointFormatJSON {
		return
	}
	channelSetting, ok := common.GetContextKeyType[dto.ChannelSettings](c, constant.ContextKeyChannelSetting)
	if !ok {
		return
	}
	channelSetting.PassThroughBodyEnabled = true
	common.SetContextKey(c, constant.ContextKeyChannelSetting, channelSetting)
}

// GetWorkspaceCapabilities 返回按模态派生的生成能力（含未配置项），供学生端渲染入口。
// 未配置的模态会以 enabled=false 返回，前端据此展示「未配置」且不可点击。
// 模型列表按当前角色过滤：仅学生 / 仅教师开放的模型不会出现在对方的下拉里。
// ai_enabled 反映当前账号（学生）所在小班的 AI 权限开关：
// false 时前端隐藏全部 AI 生成入口（决策6：历史记录与账户页仍可见）。
func GetWorkspaceCapabilities(c *gin.Context) {
	isTeacher := c.GetInt("role") >= common.RoleAdminUser
	aiEnabled := isTeacher || model.WorkspaceStudentAIEnabled(c.GetInt("id"))
	// html_enabled：HTML 实验室按小班开关独立控制（默认关闭），教师/管理员恒为可用。
	htmlEnabled := isTeacher || model.WorkspaceStudentHtmlEnabled(c.GetInt("id"))
	// slide_enabled：演示实验室按小班开关独立控制（默认关闭），教师/管理员恒为可用。
	slideEnabled := isTeacher || model.WorkspaceStudentSlideEnabled(c.GetInt("id"))
	common.ApiSuccess(c, gin.H{
		"capabilities":  filterWorkspaceCapabilityModels(setting.GetWorkspaceCapabilitiesForRole(isTeacher)),
		"ai_enabled":    aiEnabled,
		"html_enabled":  htmlEnabled,
		"slide_enabled": slideEnabled,
	})
}

// filterWorkspaceCapabilityModels 下发前剔除已删除的模型。
// 能力声明可能因渠道侧移除模型等路径残留（模型管理删除接口会同步清理，渠道编辑不会），
// 而学生/教师端的模型下拉直接取自该列表，不过滤会导致已删除的模型仍可被选中。
func filterWorkspaceCapabilityModels(caps []setting.WorkspaceCapability) []setting.WorkspaceCapability {
	exist := workspaceExistingModelNames()
	if exist == nil {
		return caps
	}
	for i := range caps {
		kept := make([]string, 0, len(caps[i].Models))
		for _, name := range caps[i].Models {
			if _, ok := exist[name]; ok {
				kept = append(kept, name)
			}
		}
		caps[i].Models = kept
		// 全部模型都被过滤掉时置为未配置，前端据此隐藏入口。
		caps[i].Enabled = len(kept) > 0
		for key := range caps[i].ModelVoices {
			if _, ok := exist[key]; !ok {
				delete(caps[i].ModelVoices, key)
			}
		}
		for key := range caps[i].ModelQPaths {
			if _, ok := exist[key]; !ok {
				delete(caps[i].ModelQPaths, key)
			}
		}
		// 声音合成的音色并集按过滤后的模型重算，避免残留已删模型的专属音色。
		if caps[i].Kind == "tts" && len(caps[i].ModelVoices) > 0 {
			rebuilt := make([]string, 0, len(caps[i].Voices))
			// 保持声明顺序：按原 Voices 顺序保留仍被任一存活模型使用的音色。
			for _, voice := range caps[i].Voices {
				for _, voices := range caps[i].ModelVoices {
					if containsString(voices, voice) {
						rebuilt = append(rebuilt, voice)
						break
					}
				}
			}
			caps[i].Voices = rebuilt
		}
	}
	return caps
}

func containsString(list []string, target string) bool {
	for _, one := range list {
		if one == target {
			return true
		}
	}
	return false
}

// GetWorkspacePoints 返回当前账号的点数（剩余/已用）与已消费折算金额，
// 供学生端与数据看板以「点数」而非货币符号展示。
// 教师额外返回教学钱包余额（管理员发放、可自由使用且不占用 API 额度）。
func GetWorkspacePoints(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, common.NewMessage("读取账户点数失败"))
		return
	}
	usedYuan, err := model.SumWorkspaceUsageAmountByUser(userId)
	if err != nil {
		usedYuan = 0
	}
	isTeacher := c.GetInt("role") >= common.RoleAdminUser
	walletBalance := 0
	if isTeacher {
		if wallet, wErr := model.GetWorkspaceTeacherWallet(userId); wErr == nil && wallet != nil {
			walletBalance = wallet.Balance
		}
	}
	common.ApiSuccess(c, gin.H{
		"quota":          user.Quota,
		"used_quota":     user.UsedQuota,
		"used_yuan":      usedYuan,
		"is_teacher":     isTeacher,
		"wallet_balance": walletBalance,
		"api_quota":      user.Quota,
	})
}

// GetWorkspaceCapabilitiesAdmin 返回派生的能力列表与平台名称，供账户额度页展示。
func GetWorkspaceCapabilitiesAdmin(c *gin.Context) {
	common.ApiSuccess(c, gin.H{
		"capabilities":  filterWorkspaceCapabilityModels(setting.GetWorkspaceCapabilities()),
		"platform_name": setting.GetWorkspacePlatformName(),
	})
}

// GetWorkspaceModelCapabilitiesAdmin 返回全部模型能力声明，供模型管理抽屉读取。
// 已删除模型残留的声明会被过滤，避免它们仍出现在前端下拉与配置列表。
func GetWorkspaceModelCapabilitiesAdmin(c *gin.Context) {
	items := setting.GetWorkspaceModelCapabilities()
	if exist := workspaceExistingModelNames(); exist != nil {
		kept := make([]setting.WorkspaceModelCapability, 0, len(items))
		for _, item := range items {
			if _, ok := exist[item.Model]; ok {
				kept = append(kept, item)
			}
		}
		items = kept
	}
	common.ApiSuccess(c, items)
}

// UpdateWorkspaceModelCapabilitiesAdmin 保存单个模型的生成能力声明；
// 未勾选任何模态表示清除该模型的声明。
func UpdateWorkspaceModelCapabilitiesAdmin(c *gin.Context) {
	var request setting.WorkspaceModelCapability
	if err := common.UnmarshalBodyReusable(c, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	encoded, err := setting.SetWorkspaceModelCapability(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(setting.WorkspaceModelCapabilitiesKey, encoded); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, setting.GetWorkspaceModelCapabilities())
}
