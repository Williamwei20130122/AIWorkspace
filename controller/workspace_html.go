package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// GetWorkspaceHtmlLabConfig 返回 HTML 编程实验室的可用模型与单次消耗点数。
// 该能力在学生端不渲染为能力卡片，因此单独提供配置接口。
func GetWorkspaceHtmlLabConfig(c *gin.Context) {
	caption, ok := setting.GetWorkspaceCapability(setting.WorkspaceKindHTML)
	if !ok {
		common.ApiSuccess(c, gin.H{"enabled": false, "models": []string{}, "points": 0})
		return
	}
	isTeacher := c.GetInt("role") >= common.RoleAdminUser
	// HTML 实验室受小班开关控制（默认关闭），关闭时 enabled=false 让前端隐藏入口。
	htmlEnabled := isTeacher || model.WorkspaceStudentHtmlEnabled(c.GetInt("id"))
	// 已删除模型的残留声明不下发，避免实验室下拉仍可选中已删除的模型。
	exist := workspaceExistingModelNames()
	models := make([]string, 0, len(caption.Models))
	for _, name := range caption.Models {
		if exist != nil {
			if _, ok := exist[name]; !ok {
				continue
			}
		}
		// HTML 未单独声明模型时会复用文生文模型，两者任一允许即可。
		if !setting.WorkspaceModelAllowedForRole(name, setting.WorkspaceKindHTML, isTeacher) &&
			!setting.WorkspaceModelAllowedForRole(name, "text", isTeacher) {
			continue
		}
		models = append(models, name)
	}
	common.ApiSuccess(c, gin.H{
		"enabled": htmlEnabled && len(models) > 0,
		"models":  models,
		"points":  caption.Points,
		// 后台配置的默认思考强度（空串表示跟随模型默认），学生进入实验室时以此作为初始档位。
		"thinking_effort":         setting.GetWorkspaceHtmlThinkingEffort(),
		"thinking_effort_options": setting.WorkspaceThinkingEffortOptions(),
	})
}

// ListWorkspaceHtmlProjects 学生本人的 HTML 项目列表（分页 + 标题搜索，不含源码）。
func ListWorkspaceHtmlProjects(c *gin.Context) {
	userId := c.GetInt("id")
	page := parseWorkspaceHtmlInt(c.Query("page"), 1)
	pageSize := parseWorkspaceHtmlInt(c.Query("page_size"), 10)
	keyword := c.Query("keyword")
	items, total, err := model.ListWorkspaceHtmlProjects(userId, keyword, page, pageSize)
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

// RenameWorkspaceHtmlProject 修改项目标题（仅项目归属者本人）。
func RenameWorkspaceHtmlProject(c *gin.Context) {
	userId := c.GetInt("id")
	projectId, err := strconv.Atoi(c.Param("id"))
	if err != nil || projectId <= 0 {
		common.ApiErrorMsg(c, "项目参数无效")
		return
	}
	project, err := model.GetWorkspaceHtmlProject(projectId)
	if err != nil || project.UserId != userId {
		common.ApiErrorMsg(c, "项目不存在或无权访问")
		return
	}
	var payload struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		common.ApiErrorMsg(c, "请求参数无效")
		return
	}
	if err := model.RenameWorkspaceHtmlProject(projectId, payload.Title); err != nil {
		common.ApiErrorMsg(c, "重命名失败")
		return
	}
	common.ApiSuccess(c, gin.H{"id": projectId, "title": payload.Title})
}

// parseWorkspaceHtmlInt 解析正整数查询参数，非法或小于 1 时使用默认值。
func parseWorkspaceHtmlInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

// GetWorkspaceHtmlProject 读取单个项目的源码与完整对话历史，用于历史项目续写。
func GetWorkspaceHtmlProject(c *gin.Context) {
	userId := c.GetInt("id")
	projectId, err := strconv.Atoi(c.Param("id"))
	if err != nil || projectId <= 0 {
		common.ApiErrorMsg(c, "项目参数无效")
		return
	}
	project, err := model.GetWorkspaceHtmlProject(projectId)
	if err != nil || project.UserId != userId {
		common.ApiErrorMsg(c, "项目不存在或无权访问")
		return
	}
	messages, mErr := model.ListWorkspaceHtmlMessages(projectId, 100)
	if mErr != nil {
		messages = nil
	}
	common.ApiSuccess(c, gin.H{
		"project":  project,
		"messages": messages,
	})
}
