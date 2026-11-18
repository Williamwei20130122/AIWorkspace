package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// GetWorkspaceSlideLabConfig 返回演示实验室（Slide Lab）的可用模型与单次消耗点数。
// 该能力在学生端不渲染为能力卡片，因此单独提供配置接口。
func GetWorkspaceSlideLabConfig(c *gin.Context) {
	caption, ok := setting.GetWorkspaceCapability(setting.WorkspaceKindSlide)
	if !ok {
		common.ApiSuccess(c, gin.H{"enabled": false, "models": []string{}, "points": 0})
		return
	}
	isTeacher := c.GetInt("role") >= common.RoleAdminUser
	// 演示实验室受小班开关控制（默认关闭），关闭时 enabled=false 让前端隐藏入口。
	slideEnabled := isTeacher || model.WorkspaceStudentSlideEnabled(c.GetInt("id"))
	// 已删除模型的残留声明不下发，避免下拉仍可选中已删除的模型。
	exist := workspaceExistingModelNames()
	models := make([]string, 0, len(caption.Models))
	for _, name := range caption.Models {
		if exist != nil {
			if _, ok := exist[name]; !ok {
				continue
			}
		}
		// 演示实验室未单独声明模型时会复用文生文模型，两者任一允许即可。
		if !setting.WorkspaceModelAllowedForRole(name, setting.WorkspaceKindSlide, isTeacher) &&
			!setting.WorkspaceModelAllowedForRole(name, "text", isTeacher) {
			continue
		}
		models = append(models, name)
	}
	common.ApiSuccess(c, gin.H{
		"enabled": slideEnabled && len(models) > 0,
		"models":  models,
		"points":  caption.Points,
		// 后台配置的默认思考强度（空串表示跟随模型默认），学生进入实验室时以此作为初始档位。
		"thinking_effort":         setting.GetWorkspaceSlideThinkingEffort(),
		"thinking_effort_options": setting.WorkspaceThinkingEffortOptions(),
	})
}

// ListWorkspaceSlideProjects 学生本人的演示项目列表（分页 + 名称搜索，不含 slides 内容）。
func ListWorkspaceSlideProjects(c *gin.Context) {
	userId := c.GetInt("id")
	page := parseWorkspaceSlideInt(c.Query("page"), 1)
	pageSize := parseWorkspaceSlideInt(c.Query("page_size"), 10)
	keyword := c.Query("keyword")
	items, total, err := model.ListWorkspaceSlideProjects(userId, keyword, page, pageSize)
	if err != nil {
		common.ApiError(c, common.NewMessage("读取项目列表失败"))
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetWorkspaceSlideProject 读取单个项目的 slides 内容，用于历史项目续写。
func GetWorkspaceSlideProject(c *gin.Context) {
	userId := c.GetInt("id")
	projectId, err := strconv.Atoi(c.Param("id"))
	if err != nil || projectId <= 0 {
		common.ApiErrorMsg(c, "项目参数无效")
		return
	}
	project, err := model.GetWorkspaceSlideProject(projectId)
	if err != nil || project.UserId != userId {
		common.ApiErrorMsg(c, "项目不存在或无权访问")
		return
	}
	// 携带对话历史，供前端重开项目时恢复左侧对话区展示。
	messages, mErr := model.ListWorkspaceSlideMessages(projectId, 100)
	if mErr != nil {
		messages = nil
	}
	slides := parseWorkspaceSlideItems(project.Slides)
	common.ApiSuccess(c, gin.H{
		"id":         project.Id,
		"name":       project.Name,
		"slides":     slides,
		"messages":   messages,
		"created_at": project.CreatedAt,
		"updated_at": project.UpdatedAt,
	})
}

// RenameWorkspaceSlideProject 修改项目名称（仅项目归属者本人）。
func RenameWorkspaceSlideProject(c *gin.Context) {
	userId := c.GetInt("id")
	projectId, err := strconv.Atoi(c.Param("id"))
	if err != nil || projectId <= 0 {
		common.ApiErrorMsg(c, "项目参数无效")
		return
	}
	project, err := model.GetWorkspaceSlideProject(projectId)
	if err != nil || project.UserId != userId {
		common.ApiErrorMsg(c, "项目不存在或无权访问")
		return
	}
	var payload struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		common.ApiErrorMsg(c, "请求参数无效")
		return
	}
	if err := model.RenameWorkspaceSlideProject(projectId, payload.Name); err != nil {
		common.ApiErrorMsg(c, "重命名失败")
		return
	}
	common.ApiSuccess(c, gin.H{"id": projectId, "name": payload.Name})
}

// parseWorkspaceSlideInt 解析正整数查询参数，非法或小于 1 时使用默认值。
func parseWorkspaceSlideInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

// workspaceSlideListItem 详情接口返回的单页幻灯片（对外契约：title + html）。
type workspaceSlideListItem struct {
	Title string `json:"title"`
	Html  string `json:"html"`
}

// parseWorkspaceSlideItems 把项目里存储的 slides JSON 解析为前端契约结构；
// 解析失败时返回空数组（而不是 null），保证前端拿到稳定形状。
func parseWorkspaceSlideItems(raw string) []workspaceSlideListItem {
	items := make([]workspaceSlideListItem, 0)
	if raw == "" {
		return items
	}
	_ = common.UnmarshalJsonStr(raw, &items)
	return items
}
