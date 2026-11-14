package middleware

import (
	"context"
	"io"
	"mime"
	"path"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	// WorkspaceCapabilityIdKey / WorkspaceCapabilityKindKey 保存中台生成入口解析出的能力标识与类型。
	WorkspaceCapabilityIdKey   = "workspace_capability_id"
	WorkspaceCapabilityKindKey = "workspace_capability_kind"

	// WorkspaceResolvedVoiceKey 保存声音合成实际使用的音色（供用量明细记录）。
	WorkspaceResolvedVoiceKey = "resolved_task_voice"

	workspaceDefaultMusicModel = "suno_music"

	// workspaceInputSaveTimeout 参考素材落盘超时。
	workspaceInputSaveTimeout = 2 * time.Minute
)

// WorkspaceSessionToken 把已登录用户映射为一次性会话令牌上下文，
// 使中台生成入口复用 new-api 的渠道路由、限流与计费链路。
// 临时令牌 Id=0 且不限额度，因此不会触碰任何真实令牌的额度。
func WorkspaceSessionToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "登录状态无效，请重新登录")
			c.Abort()
			return
		}
		userCache, err := model.GetUserCache(userId)
		if err != nil {
			common.ApiErrorMsg(c, "读取用户信息失败")
			c.Abort()
			return
		}
		userCache.WriteContext(c)

		group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}
		if group == "" {
			group = "default"
		}
		tempToken := &model.Token{
			UserId:         userId,
			Name:           "workspace",
			Group:          group,
			UnlimitedQuota: true,
		}
		if err := SetupContextForToken(c, tempToken); err != nil {
			common.ApiErrorMsg(c, err.Error())
			c.Abort()
			return
		}
		// TokenAuth 会用该键做分渠道路由，中台入口需显式补齐，否则找不到任何渠道。
		if common.GetContextKeyString(c, constant.ContextKeyUsingGroup) == "" {
			common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
		}
		// 中台生成一律按次计费：new-api 侧不按 token 用量扣学生钱包，
		// 由 WorkspaceMetering 在成功生成后按次数扣点数。
		c.Set(service.WorkspaceBillingContextKey, true)
		c.Next()
	}
}

type workspaceUpstream struct {
	path  string
	mode  int
	model string
}

// workspaceMusicAction 解析音乐能力对应的任务插件动作。
// 内置 sunoapi 插件要求动作必须是 MUSIC / LYRICS，且插件原生路由从路径参数
// 取动作；中台走的是 /v1/tasks/:key 旧版入口，没有该路径参数，因此必须在此
// 显式补齐，否则插件解码会以 invalid_action 拒绝请求。
func workspaceMusicAction(cap setting.WorkspaceCapability) string {
	switch strings.ToLower(strings.TrimSpace(cap.Action)) {
	case "lyrics", "lyric":
		return "LYRICS"
	case "music", "song", "create":
		return "MUSIC"
	}
	if strings.Contains(strings.ToLower(cap.Model), "lyric") {
		return "LYRICS"
	}
	return "MUSIC"
}

// workspaceUpstreamFor 把能力类型映射到 new-api 已有的上游链路：
// path 用于 Path2RelayMode / getModelRequest / 渠道端点匹配，
// mode 覆盖 Path2RelayMode 无法识别的中台路径。
func workspaceUpstreamFor(cap setting.WorkspaceCapability) (workspaceUpstream, bool) {
	model := strings.TrimSpace(cap.Model)
	switch cap.Kind {
	case "text":
		return workspaceUpstream{path: "/v1/chat/completions", mode: relayconstant.RelayModeChatCompletions, model: model}, true
	case "html":
		// HTML 编程实验室复用聊天补全链路，提示词工程在 WorkspaceHTMLPrepare 中完成。
		return workspaceUpstream{path: "/v1/chat/completions", mode: relayconstant.RelayModeChatCompletions, model: model}, true
	case "slide":
		// 演示实验室复用聊天补全链路，提示词工程在 WorkspaceSlidePrepare 中完成。
		return workspaceUpstream{path: "/v1/chat/completions", mode: relayconstant.RelayModeChatCompletions, model: model}, true
	case "image":
		return workspaceUpstream{path: "/v1/images/generations", mode: relayconstant.RelayModeImagesGenerations, model: model}, true
	case "edit":
		return workspaceUpstream{path: "/v1/images/edits", mode: relayconstant.RelayModeImagesEdits, model: model}, true
	case "tts":
		return workspaceUpstream{path: "/v1/audio/speech", mode: relayconstant.RelayModeAudioSpeech, model: model}, true
	case "video":
		return workspaceUpstream{path: "/v1/video/generations", mode: relayconstant.RelayModeVideoSubmit, model: model}, true
	case "music":
		pluginKey := strings.TrimSpace(cap.Plugin)
		if pluginKey == "" {
			return workspaceUpstream{}, false
		}
		if model == "" {
			model = workspaceDefaultMusicModel
		}
		return workspaceUpstream{path: "/v1/tasks/" + pluginKey, mode: relayconstant.RelayModeVideoSubmit, model: model}, true
	}
	return workspaceUpstream{}, false
}

// WorkspaceGenerateRoute 校验能力可用性并把中台生成入口规范化为 new-api 上游链路：
//  1. 按能力配置注入默认模型（JSON 体直接改写，表单体交回上下文）；
//  2. 改写请求路径，使路径解析、渠道路由与上游 URL 构造都落在标准 /v1 通路上；
//  3. 显式设置 relay_mode，避免中台路径被识别为未知模式。
func WorkspaceGenerateRoute() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 小班 AI 权限（B1/B2）：学生所属小班未开通 AI 课程时，服务端强制拦截全部 AI 生成请求。
		// 教师与管理员不受小班开关限制。
		if c.GetInt("role") < common.RoleAdminUser &&
			!model.WorkspaceStudentAIEnabled(c.GetInt("id")) {
			common.ApiErrorMsg(c, "所在小班未开通 AI 课程，暂不能使用 AI 生成能力")
			c.Abort()
			return
		}
		// HTML 实验室按小班开关单独拦截（默认关闭）。
		if workspaceCapabilityId(c) == setting.WorkspaceKindHTML &&
			c.GetInt("role") < common.RoleAdminUser &&
			!model.WorkspaceStudentHtmlEnabled(c.GetInt("id")) {
			common.ApiErrorMsg(c, "所在小班未开通 HTML 实验室，暂不能使用该能力")
			c.Abort()
			return
		}
		// 演示实验室按小班开关单独拦截（默认关闭）。
		if workspaceCapabilityId(c) == setting.WorkspaceKindSlide &&
			c.GetInt("role") < common.RoleAdminUser &&
			!model.WorkspaceStudentSlideEnabled(c.GetInt("id")) {
			common.ApiErrorMsg(c, "所在小班未开通演示实验室，暂不能使用该能力")
			c.Abort()
			return
		}
		cap, ok := setting.GetEnabledWorkspaceCapability(workspaceCapabilityId(c))
		if !ok {
			common.ApiErrorMsg(c, "该生成能力不存在或已停用")
			c.Abort()
			return
		}
		upstream, ok := workspaceUpstreamFor(cap)
		if !ok {
			common.ApiErrorMsg(c, "该生成能力配置不完整")
			c.Abort()
			return
		}

		if upstream.model == "" {
			upstream.model = workspaceJSONModel(c)
		}
		if upstream.model != "" {
			if err := workspaceRewriteJSONModel(c, upstream.model); err != nil {
				common.ApiErrorMsg(c, "请求体解析失败："+err.Error())
				c.Abort()
				return
			}
			// 记录实际使用的模型，供按次计费的用量明细与月度对账使用；
			// 表单/multipart 请求无法安全改写正文，模型名仅经由上下文传递。
			c.Set("resolved_task_model", upstream.model)
		}

		// 模型开放范围校验：已声明但未对当前角色开放的模型不允许被调用。
		if upstream.model != "" &&
			!setting.WorkspaceModelAllowedForRole(upstream.model, cap.Kind, c.GetInt("role") >= common.RoleAdminUser) {
			common.ApiErrorMsg(c, "该模型未对你所在的角色开放")
			c.Abort()
			return
		}

		if cap.Kind == "music" {
			pluginKey := strings.TrimSpace(cap.Plugin)
			c.Params = append(c.Params, gin.Param{Key: "key", Value: pluginKey})
			// 旧版任务插件入口不带动作路径参数，需按能力配置补齐 MUSIC / LYRICS，
			// 既供插件解码（ctx.params.action）也供 RelayTask 记录任务动作。
			action := workspaceMusicAction(cap)
			c.Params = append(c.Params, gin.Param{Key: "action", Value: action})
			c.Set("task_action", action)
		}

		// 按「模型 × 功能」配置覆盖上游接口路径、结果查询地址与附加参数。
		workspaceApplyModelEndpoint(c, &upstream, cap.Kind)

		// 声音合成：按所选模型声明的音色校验/回落，保证前端下拉与上游取值一致。
		if cap.Kind == "tts" {
			workspaceResolveTTSVoice(c, upstream.model)
		}
		// 图生图：把用户上传的源图先落对象存储归档（转发仍使用原始表单，不做改写）。
		if cap.Kind == "edit" {
			workspaceCaptureEditInputs(c)
		}

		c.Request.URL.Path = upstream.path
		c.Set("relay_mode", upstream.mode)
		c.Set(WorkspaceCapabilityIdKey, cap.Id)
		c.Set(WorkspaceCapabilityKindKey, cap.Kind)
		c.Next()
	}
}

// workspaceCapabilityId 取生成入口的能力标识：优先路由参数，兼容静态路径写法。
func workspaceCapabilityId(c *gin.Context) string {
	if id := c.Param("cap"); id != "" {
		return id
	}
	return path.Base(c.Request.URL.Path)
}

// workspaceJSONModel 读取请求体顶层的 model 字段。
// 能力未配置固定模型时用它回填实际模型名，保证用量明细与对账能记录到模型。
func workspaceJSONModel(c *gin.Context) string {
	return workspaceJSONStringField(c, "model")
}

// workspaceJSONStringField 读取请求体顶层的字符串字段。
// 兼容 JSON 正文与 multipart 表单两种形态：multipart 表单体（图生图）无法安全
// 改写正文，但必须解析出字段值，否则表单请求会绕过校验，用量明细也记不到值。
func workspaceJSONStringField(c *gin.Context, field string) string {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil {
		return ""
	}
	if mediaType == "multipart/form-data" {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil || form == nil {
			return ""
		}
		if values := form.Value[field]; len(values) > 0 {
			return strings.TrimSpace(values[0])
		}
		return ""
	}
	if mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json") {
		return ""
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return ""
	}
	raw, err := storage.Bytes()
	if err != nil || len(raw) == 0 {
		return ""
	}
	return strings.TrimSpace(gjson.GetBytes(raw, field).String())
}

// workspaceRewriteJSONModel 用配置的模型覆盖请求体顶层 model 字段。
func workspaceRewriteJSONModel(c *gin.Context, model string) error {
	return workspaceRewriteJSONField(c, "model", model)
}

// workspaceRewriteJSONField 覆盖 JSON 请求体顶层的字符串字段。
// 非 JSON 正文保持原样，交由调用方决定是否使用上下文回填。
func workspaceRewriteJSONField(c *gin.Context, field, value string) error {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil {
		return nil
	}
	if mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json") {
		return nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return err
	}
	raw, err := storage.Bytes()
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	patched, err := sjson.SetBytes(raw, field, value)
	if err != nil {
		return err
	}
	newStorage, err := common.CreateBodyStorage(patched)
	if err != nil {
		return err
	}
	_ = storage.Close()
	c.Set(common.KeyBodyStorage, newStorage)
	c.Set(common.KeyRequestBody, nil)
	c.Request.Body = io.NopCloser(newStorage)
	c.Request.ContentLength = int64(len(patched))
	return nil
}

// workspaceResolveTTSVoice 按所选模型声明的音色校验并回落，并把最终音色写入上下文。
// 模型未声明音色时保持请求原样（兼容上游默认音色）；声明了但请求音色为空或非法时
// 改用首个声明音色，保证前端下拉与上游取值始终落在管理员配置的范围内。
func workspaceResolveTTSVoice(c *gin.Context, modelName string) {
	voices := setting.WorkspaceModelVoices(modelName, "tts")
	current := workspaceJSONStringField(c, "voice")
	chosen := current
	if len(voices) > 0 {
		allowed := false
		for _, voice := range voices {
			if voice == current {
				allowed = true
				break
			}
		}
		if !allowed {
			chosen = voices[0]
			if err := workspaceRewriteJSONField(c, "voice", chosen); err != nil {
				common.SysError(common.LogText("workspace rewrite tts voice failed: %v", err))
			}
		}
	}
	c.Set(WorkspaceResolvedVoiceKey, chosen)
}

// workspaceApplyModelEndpoint 应用「模型 × 功能」维度的上游接口配置：
//  1. Path 覆盖上游接口路径（例如 /chat/completions、/images/generations）；
//  2. Extra 附加参数深合并覆盖进 JSON 请求体（教师专业版不受此限制）。
//
// 结果查询地址（QPath）由前端在轮询任务时按所选模型取用，不在此处改写转发链路。
func workspaceApplyModelEndpoint(c *gin.Context, upstream *workspaceUpstream, kind string) {
	if upstream == nil || strings.TrimSpace(upstream.model) == "" {
		return
	}
	endpoint, ok := setting.WorkspaceModelEndpointFor(upstream.model, kind)
	if !ok {
		return
	}
	if path := strings.TrimSpace(endpoint.Path); path != "" {
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		upstream.path = path
	}
	// 通用 JSON 格式（非 OpenAI 标准协议）时，附加参数以外的正文不做 OpenAI 规范化改写，
	// 交由上游原样解析；此处仅保证 model 字段可用。
	workspaceApplyExtraParams(c, endpoint.Extra)
}

// workspaceApplyExtraParams 把附加参数 JSON 深合并进 JSON 请求体。
// 冲突时附加参数优先；教师专业版（管理角色）不受附加参数限制，直接跳过。
func workspaceApplyExtraParams(c *gin.Context, extra string) {
	extra = strings.TrimSpace(extra)
	if extra == "" || c.GetInt("role") >= common.RoleAdminUser {
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil {
		return
	}
	if mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json") {
		return
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return
	}
	raw, err := storage.Bytes()
	if err != nil || len(raw) == 0 {
		return
	}
	merged, err := workspaceMergeJSONObject(raw, extra)
	if err != nil {
		common.SysError(common.LogText("workspace merge extra params failed: %v", err))
		return
	}
	newStorage, err := common.CreateBodyStorage(merged)
	if err != nil {
		return
	}
	_ = storage.Close()
	c.Set(common.KeyBodyStorage, newStorage)
	c.Set(common.KeyRequestBody, nil)
	c.Request.Body = io.NopCloser(newStorage)
	c.Request.ContentLength = int64(len(merged))
}

// workspaceMergeJSONObject 把 extra（JSON 对象）深合并进 raw（JSON 对象），extra 的叶子值优先。
func workspaceMergeJSONObject(raw []byte, extra string) ([]byte, error) {
	var base map[string]any
	if err := common.Unmarshal(raw, &base); err != nil {
		return nil, err
	}
	var overlay map[string]any
	if err := common.UnmarshalJsonStr(extra, &overlay); err != nil {
		return nil, err
	}
	merged := workspaceDeepMerge(base, overlay)
	return common.Marshal(merged)
}

// workspaceDeepMerge 递归合并两个 JSON 对象，overlay 的叶子值覆盖 base。
func workspaceDeepMerge(base, overlay map[string]any) map[string]any {
	for key, value := range overlay {
		if overlayObj, ok := value.(map[string]any); ok {
			if baseObj, ok := base[key].(map[string]any); ok {
				base[key] = workspaceDeepMerge(baseObj, overlayObj)
				continue
			}
		}
		base[key] = value
	}
	return base
}

// workspaceCaptureEditInputs 把图生图（multipart）请求中用户上传的源图写入对象存储归档。
// 转发链路仍使用原始表单（不做改写），因此不会破坏上游对 multipart 的解析。
func workspaceCaptureEditInputs(c *gin.Context) {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "multipart/form-data" {
		return
	}
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil || form == nil || len(form.File) == 0 {
		return
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		return
	}
	classId := model.GetWorkspaceClassIdByUserId(userId)
	for field, headers := range form.File {
		if field != "image" && field != "image[]" {
			continue
		}
		for _, header := range headers {
			source, openErr := header.Open()
			if openErr != nil {
				continue
			}
			mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
			ctx, cancel := context.WithTimeout(context.Background(), workspaceInputSaveTimeout)
			_, saveErr := service.SaveWorkspaceInputArtifact(ctx, userId, classId, header.Filename, mimeType, source)
			cancel()
			_ = source.Close()
			if saveErr != nil {
				common.SysError(common.LogText("workspace capture edit input failed: userId=%d err=%s", userId, saveErr.Error()))
			}
		}
	}
}
