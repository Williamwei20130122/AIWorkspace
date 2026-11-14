package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// WorkspaceHtmlProject HTML 编程实验室的创作项目：一名学生可拥有多个项目。
type WorkspaceHtmlProject struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime;index:idx_ws_html_project_user"`
	UserId    int    `json:"user_id" gorm:"index:idx_ws_html_project_user"`
	Title     string `json:"title" gorm:"type:varchar(200)"`
	// Code 当前编辑器中的完整 HTML 源码。
	Code string `json:"code,omitempty" gorm:"type:text"`
}

// WorkspaceHtmlMessage HTML 编程实验室的对话消息（user / assistant）。
type WorkspaceHtmlMessage struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	ProjectId int    `json:"project_id" gorm:"index:idx_ws_html_message_project"`
	UserId    int    `json:"user_id" gorm:"index"`
	Role      string `json:"role" gorm:"type:varchar(16)"`
	Content   string `json:"content" gorm:"type:text"`
}

func (m *WorkspaceHtmlProject) TableName() string { return "workspace_html_projects" }

func (m *WorkspaceHtmlMessage) TableName() string { return "workspace_html_messages" }

// CreateWorkspaceHtmlProject 新建项目，标题为空时给出默认名称。
func CreateWorkspaceHtmlProject(userId int, title string) (*WorkspaceHtmlProject, error) {
	if title == "" {
		title = "未命名项目"
	}
	project := &WorkspaceHtmlProject{UserId: userId, Title: trimsHtmlTitle(title, 120)}
	if err := DB.Create(project).Error; err != nil {
		return nil, err
	}
	return project, nil
}

// GetWorkspaceHtmlProject 读取单个项目（含源码）。
func GetWorkspaceHtmlProject(id int) (*WorkspaceHtmlProject, error) {
	project := &WorkspaceHtmlProject{}
	if err := DB.Where("id = ?", id).First(project).Error; err != nil {
		return nil, err
	}
	return project, nil
}

// ListWorkspaceHtmlProjects 分页列出学生本人的项目（按最近更新倒序，不含源码）。
// keyword 非空时按项目标题模糊匹配。
func ListWorkspaceHtmlProjects(userId int, keyword string, page, pageSize int) ([]*WorkspaceHtmlProject, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	query := DB.Model(&WorkspaceHtmlProject{}).Where("user_id = ?", userId)
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		query = query.Where("title LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	projects := make([]*WorkspaceHtmlProject, 0, pageSize)
	err := query.Select("id", "created_at", "updated_at", "user_id", "title").
		Order("updated_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&projects).Error
	return projects, total, err
}

// RenameWorkspaceHtmlProject 修改项目标题。
func RenameWorkspaceHtmlProject(id int, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "未命名项目"
	}
	return DB.Model(&WorkspaceHtmlProject{}).Where("id = ?", id).
		Updates(map[string]any{
			"title":      trimsHtmlTitle(title, 120),
			"updated_at": common.GetTimestamp(),
		}).Error
}

// UpdateWorkspaceHtmlProject 保存项目标题与源码。
func UpdateWorkspaceHtmlProject(id int, title, code string) error {
	updates := map[string]any{"code": code, "updated_at": common.GetTimestamp()}
	if title != "" {
		updates["title"] = trimsHtmlTitle(title, 120)
	}
	return DB.Model(&WorkspaceHtmlProject{}).Where("id = ?", id).Updates(updates).Error
}

// TouchWorkspaceHtmlProject 仅刷新项目的最近更新时间。
func TouchWorkspaceHtmlProject(id int) {
	_ = DB.Model(&WorkspaceHtmlProject{}).Where("id = ?", id).
		Update("updated_at", common.GetTimestamp()).Error
}

// DeleteWorkspaceHtmlProject 删除项目及其消息（仅用于生成失败时的新建项目回滚）。
func DeleteWorkspaceHtmlProject(id int) {
	DB.Where("project_id = ?", id).Delete(&WorkspaceHtmlMessage{})
	DB.Where("id = ?", id).Delete(&WorkspaceHtmlProject{})
}

// InsertWorkspaceHtmlMessage 追加一条对话消息。
func InsertWorkspaceHtmlMessage(projectId, userId int, role, content string) error {
	message := &WorkspaceHtmlMessage{ProjectId: projectId, UserId: userId, Role: role, Content: content}
	return DB.Create(message).Error
}

// ListWorkspaceHtmlMessages 读取项目的对话历史（按时间正序）。
func ListWorkspaceHtmlMessages(projectId int, limit int) ([]*WorkspaceHtmlMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	messages := make([]*WorkspaceHtmlMessage, 0, limit)
	err := DB.Where("project_id = ?", projectId).Order("id ASC").Limit(limit).Find(&messages).Error
	return messages, err
}

// CountWorkspaceHtmlProjects 学生项目总数（用于首页概览）。
func CountWorkspaceHtmlProjects(userId int) int64 {
	var total int64
	_ = DB.Model(&WorkspaceHtmlProject{}).Where("user_id = ?", userId).Count(&total).Error
	return total
}

// trimsHtmlTitle 按字符截断标题，避免多字节中文被截成乱码。
func trimsHtmlTitle(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
