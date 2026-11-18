package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// WorkspaceSlideProject 演示实验室（Slide Lab）的创作项目：一名学生可拥有多个项目。
type WorkspaceSlideProject struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime;index:idx_ws_slide_project_user"`
	UserId    int    `json:"user_id" gorm:"index:idx_ws_slide_project_user"`
	Name      string `json:"name" gorm:"type:varchar(200)"`
	// Slides 当前演示文稿内容：JSON 字符串，形如 [{"title":"…","html":"<完整HTML>"}]。
	// 列表查询通过 Select 隐藏该字段，仅项目详情返回。
	Slides string `json:"-" gorm:"type:text"`
}

// WorkspaceSlideMessage 演示实验室的对话消息（user / assistant）。
type WorkspaceSlideMessage struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	ProjectId int    `json:"project_id" gorm:"index:idx_ws_slide_message_project"`
	UserId    int    `json:"user_id" gorm:"index"`
	Role      string `json:"role" gorm:"type:varchar(16)"`
	Content   string `json:"content" gorm:"type:text"`
}

func (m *WorkspaceSlideProject) TableName() string { return "workspace_slide_projects" }

func (m *WorkspaceSlideMessage) TableName() string { return "workspace_slide_messages" }

// CreateWorkspaceSlideProject 新建项目，名称为空时给出默认名称。
func CreateWorkspaceSlideProject(userId int, name string) (*WorkspaceSlideProject, error) {
	if name == "" {
		name = "未命名演示"
	}
	project := &WorkspaceSlideProject{UserId: userId, Name: trimSlideName(name, 120)}
	if err := DB.Create(project).Error; err != nil {
		return nil, err
	}
	return project, nil
}

// GetWorkspaceSlideProject 读取单个项目（含 slides 内容）。
func GetWorkspaceSlideProject(id int) (*WorkspaceSlideProject, error) {
	project := &WorkspaceSlideProject{}
	if err := DB.Where("id = ?", id).First(project).Error; err != nil {
		return nil, err
	}
	return project, nil
}

// ListWorkspaceSlideProjects 分页列出学生本人的项目（按最近更新倒序，不含 slides 内容）。
// keyword 非空时按项目名称模糊匹配。
func ListWorkspaceSlideProjects(userId int, keyword string, page, pageSize int) ([]*WorkspaceSlideProject, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	query := DB.Model(&WorkspaceSlideProject{}).Where("user_id = ?", userId)
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	projects := make([]*WorkspaceSlideProject, 0, pageSize)
	err := query.Select("id", "created_at", "updated_at", "user_id", "name").
		Order("updated_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&projects).Error
	return projects, total, err
}

// RenameWorkspaceSlideProject 修改项目名称。
func RenameWorkspaceSlideProject(id int, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "未命名演示"
	}
	return DB.Model(&WorkspaceSlideProject{}).Where("id = ?", id).
		Updates(map[string]any{
			"name":       trimSlideName(name, 120),
			"updated_at": common.GetTimestamp(),
		}).Error
}

// UpdateWorkspaceSlideProject 保存项目的 slides 内容（name 非空时一并更新名称）。
func UpdateWorkspaceSlideProject(id int, name, slides string) error {
	updates := map[string]any{"slides": slides, "updated_at": common.GetTimestamp()}
	if name != "" {
		updates["name"] = trimSlideName(name, 120)
	}
	return DB.Model(&WorkspaceSlideProject{}).Where("id = ?", id).Updates(updates).Error
}

// TouchWorkspaceSlideProject 仅刷新项目的最近更新时间。
func TouchWorkspaceSlideProject(id int) {
	_ = DB.Model(&WorkspaceSlideProject{}).Where("id = ?", id).
		Update("updated_at", common.GetTimestamp()).Error
}

// DeleteWorkspaceSlideProject 删除项目及其消息（仅用于生成失败时的新建项目回滚）。
func DeleteWorkspaceSlideProject(id int) {
	DB.Where("project_id = ?", id).Delete(&WorkspaceSlideMessage{})
	DB.Where("id = ?", id).Delete(&WorkspaceSlideProject{})
}

// InsertWorkspaceSlideMessage 追加一条对话消息。
func InsertWorkspaceSlideMessage(projectId, userId int, role, content string) error {
	message := &WorkspaceSlideMessage{ProjectId: projectId, UserId: userId, Role: role, Content: content}
	return DB.Create(message).Error
}

// ListWorkspaceSlideMessages 读取项目的对话历史（按时间正序）。
func ListWorkspaceSlideMessages(projectId int, limit int) ([]*WorkspaceSlideMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	messages := make([]*WorkspaceSlideMessage, 0, limit)
	err := DB.Where("project_id = ?", projectId).Order("id ASC").Limit(limit).Find(&messages).Error
	return messages, err
}

// CountWorkspaceSlideProjects 学生项目总数（用于首页概览）。
func CountWorkspaceSlideProjects(userId int) int64 {
	var total int64
	_ = DB.Model(&WorkspaceSlideProject{}).Where("user_id = ?", userId).Count(&total).Error
	return total
}

// trimSlideName 按字符截断名称，避免多字节中文被截成乱码。
func trimSlideName(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
