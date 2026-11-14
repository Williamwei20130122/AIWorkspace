package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// 课堂会话状态：授课中 / 已结束。
const (
	WorkspaceClassSessionActive = "active"
	WorkspaceClassSessionClosed = "closed"
)

// 课堂任务提交内容类型：大段文字 / 文件上传 / AI 生成作品。
const (
	WorkspaceSubmissionText = "text"
	WorkspaceSubmissionFile = "file"
	WorkspaceSubmissionAI   = "ai"
)

// WorkspaceClassSession 授课分发记录：把一节备课课时分发到某个小班，
// 小班学生进入课堂模式后即可看到本节课的分项任务。
// 决策 7：同一小班 + 同一课时再次分发时复用同一条会话，不重置进度与提交。
type WorkspaceClassSession struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime;index"`
	// SmallClassId + LessonId 唯一，保证同方案复用不重复建会话。
	SmallClassId int    `json:"small_class_id" gorm:"uniqueIndex:idx_ws_class_session_scope;index"`
	LessonId     int    `json:"lesson_id" gorm:"uniqueIndex:idx_ws_class_session_scope;index"`
	UnitId       int    `json:"unit_id" gorm:"index"`
	SectionId    int    `json:"section_id"`
	GradeIndex   int    `json:"grade_index"`
	TeacherId    int    `json:"teacher_id" gorm:"index"`
	Status       string `json:"status" gorm:"type:varchar(16);default:'active';index"`
	// Theme 本节课主题：分发时默认取课时标题，教师可自由修改（遗留待办 4 已确认口径）。
	Theme     string `json:"theme" gorm:"type:varchar(255);default:''"`
	StartedAt int64  `json:"started_at"`
	EndedAt   int64  `json:"ended_at"`
	// 展示用，不入库
	LessonTitle       string `json:"lesson_title" gorm:"-"`
	UnitName          string `json:"unit_name" gorm:"-"`
	SmallClassName    string `json:"small_class_name" gorm:"-"`
	SmallClassCode    string `json:"small_class_code" gorm:"-"`
	AiCourse          bool   `json:"ai_course" gorm:"-"`
	TaskCount         int    `json:"task_count" gorm:"-"`
	SubmissionCount   int    `json:"submission_count" gorm:"-"`
	MySubmissionCount int    `json:"my_submission_count" gorm:"-"`
}

// WorkspaceTaskSubmission 课堂任务提交（E2/E3/E4/E7）：
// 一条记录对应「某个学生在某个会话下对某个分项任务的一次提交」。
// 单张 AI 图片单独提交时也是一条独立记录。
type WorkspaceTaskSubmission struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
	SessionId int   `json:"session_id" gorm:"index:idx_ws_submission_session_task;index"`
	TaskId    int   `json:"task_id" gorm:"index:idx_ws_submission_session_task;index"`
	UserId    int   `json:"user_id" gorm:"index"`
	// SmallClassId 冗余保存，便于教师按小班汇总与 ZIP 打包。
	SmallClassId int    `json:"small_class_id" gorm:"index"`
	ContentType  string `json:"content_type" gorm:"type:varchar(16)"`
	// TextContent 大段文字提交内容。
	TextContent string `json:"text_content" gorm:"type:text"`
	// FileName 原始文件名（文件上传或 AI 落盘素材）。
	FileName string `json:"file_name" gorm:"type:varchar(255)"`
	// ArtifactId 指向本地磁盘素材（F1：图片/文件不入库，DB 只存路径与素材 id）。
	ArtifactId int    `json:"artifact_id" gorm:"index"`
	MimeType   string `json:"mime_type" gorm:"type:varchar(128)"`
	SizeBytes  int64  `json:"size_bytes"`
	// AssetUrl AI 作品的上游直链（无法落盘时的兜底引用）。
	AssetUrl string `json:"asset_url" gorm:"type:text"`
	// Capability AI 提交对应的生成能力（text/image/edit/video/music/tts）。
	Capability string `json:"capability" gorm:"type:varchar(16)"`
	// Prompt / Params / ResultText 保存 AI 作品详情（D5：提示词、参数、最终内容）。
	Prompt     string `json:"prompt" gorm:"type:varchar(1000)"`
	Params     string `json:"params" gorm:"type:text"`
	ResultText string `json:"result_text" gorm:"type:text"`
	// 展示用，不入库
	TaskTitle   string `json:"task_title" gorm:"-"`
	StudentName string `json:"student_name" gorm:"-"`
	StudentNo   string `json:"student_no" gorm:"-"`
}

// ---------- 会话 ----------

func GetWorkspaceClassSessionById(id int) (*WorkspaceClassSession, error) {
	var session WorkspaceClassSession
	if err := DB.First(&session, id).Error; err != nil {
		return nil, err
	}
	fillWorkspaceClassSessionDisplay([]*WorkspaceClassSession{&session})
	return &session, nil
}

// DistributeWorkspaceLesson 分发课时到小班（D2）：
// 同小班同课时已存在会话时复用并重新置为授课中（决策 7），否则新建；
// 分发新课时会结束该小班其它进行中的会话，保证「当前课时」唯一。
// theme 为本节课主题，留空时回落课时标题。
func DistributeWorkspaceLesson(smallClassId, lessonId, teacherId int, theme string) (*WorkspaceClassSession, error) {
	smallClass, err := GetWorkspaceSmallClassById(smallClassId)
	if err != nil {
		return nil, errors.New("小班不存在")
	}
	lesson, err := GetWorkspaceLessonById(lessonId)
	if err != nil {
		return nil, errors.New("课时不存在")
	}
	unit, err := GetWorkspaceUnitById(lesson.UnitId)
	if err != nil {
		return nil, errors.New("课时所属单元不存在")
	}
	theme = strings.TrimSpace(theme)
	if theme == "" {
		theme = strings.TrimSpace(lesson.Title)
	}
	if runes := []rune(theme); len(runes) > 255 {
		theme = string(runes[:255])
	}

	now := time.Now().Unix()
	var session WorkspaceClassSession
	err = DB.Where("small_class_id = ? AND lesson_id = ?", smallClassId, lessonId).First(&session).Error
	switch {
	case err == nil:
		session.Status = WorkspaceClassSessionActive
		session.EndedAt = 0
		session.TeacherId = teacherId
		session.UnitId = unit.Id
		session.SectionId = unit.SectionId
		session.GradeIndex = unit.GradeIndex
		session.Theme = theme
		if session.StartedAt == 0 {
			session.StartedAt = now
		}
		if err := DB.Save(&session).Error; err != nil {
			return nil, err
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		session = WorkspaceClassSession{
			SmallClassId: smallClass.Id,
			LessonId:     lesson.Id,
			UnitId:       unit.Id,
			SectionId:    unit.SectionId,
			GradeIndex:   unit.GradeIndex,
			TeacherId:    teacherId,
			Status:       WorkspaceClassSessionActive,
			Theme:        theme,
			StartedAt:    now,
		}
		if err := DB.Create(&session).Error; err != nil {
			return nil, err
		}
	default:
		return nil, err
	}

	// 结束该小班其它进行中的会话，避免学生端出现多个「当前课时」。
	_ = DB.Model(&WorkspaceClassSession{}).
		Where("small_class_id = ? AND id <> ? AND status = ?", smallClassId, session.Id, WorkspaceClassSessionActive).
		Updates(map[string]any{"status": WorkspaceClassSessionClosed, "ended_at": now}).Error

	fillWorkspaceClassSessionDisplay([]*WorkspaceClassSession{&session})
	return &session, nil
}

// CreateTempWorkspaceClassSession 临时发起课堂（v1.1）：不依赖备课方案，
// 直接按教师选择的任务环节数量与提交内容类型创建一次性课时任务并分发到小班。
// 临时课时 UnitId 为 0，不进入备课方案列表，也不影响已有备课数据。
func CreateTempWorkspaceClassSession(smallClassId, teacherId int, theme string, tasks []*WorkspaceLessonTask) (*WorkspaceClassSession, error) {
	smallClass, err := GetWorkspaceSmallClassById(smallClassId)
	if err != nil {
		return nil, errors.New("小班不存在")
	}
	theme = strings.TrimSpace(theme)
	if theme == "" {
		theme = "临时课堂"
	}
	if runes := []rune(theme); len(runes) > 255 {
		theme = string(runes[:255])
	}
	now := time.Now().Unix()
	lesson := &WorkspaceLesson{
		UnitId:      0,
		Title:       theme,
		Description: "临时发起的课堂",
		AiCourse:    true,
	}
	var session WorkspaceClassSession
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(lesson).Error; err != nil {
			return err
		}
		for index, task := range tasks {
			task.LessonId = lesson.Id
			task.SortOrder = index + 1
			if err := tx.Create(task).Error; err != nil {
				return err
			}
		}
		session = WorkspaceClassSession{
			SmallClassId: smallClass.Id,
			LessonId:     lesson.Id,
			TeacherId:    teacherId,
			Status:       WorkspaceClassSessionActive,
			Theme:        theme,
			StartedAt:    now,
		}
		return tx.Create(&session).Error
	})
	if err != nil {
		return nil, err
	}
	// 结束该小班其它进行中的会话，保证学生端只看到一个「当前课时」。
	_ = DB.Model(&WorkspaceClassSession{}).
		Where("small_class_id = ? AND id <> ? AND status = ?", smallClassId, session.Id, WorkspaceClassSessionActive).
		Updates(map[string]any{"status": WorkspaceClassSessionClosed, "ended_at": now}).Error
	fillWorkspaceClassSessionDisplay([]*WorkspaceClassSession{&session})
	return &session, nil
}

// GetWorkspaceActiveClassSessionForUser 返回学生所在小班中最近一次进行中的课堂会话。
func GetWorkspaceActiveClassSessionForUser(userId int) (*WorkspaceClassSession, error) {
	var session WorkspaceClassSession
	err := DB.
		Joins("JOIN workspace_small_class_members m ON m.small_class_id = workspace_class_sessions.small_class_id").
		Where("m.user_id = ?", userId).
		Where("workspace_class_sessions.status = ?", WorkspaceClassSessionActive).
		Order("workspace_class_sessions.updated_at desc, workspace_class_sessions.id desc").
		First(&session).Error
	if err != nil {
		return nil, err
	}
	fillWorkspaceClassSessionDisplay([]*WorkspaceClassSession{&session})
	return &session, nil
}

// CloseWorkspaceClassSession 结束授课。
func CloseWorkspaceClassSession(id int) error {
	return DB.Model(&WorkspaceClassSession{}).Where("id = ?", id).
		Updates(map[string]any{"status": WorkspaceClassSessionClosed, "ended_at": time.Now().Unix()}).Error
}

// ListWorkspaceClassSessions 按小班列出分发记录（教师端选用）。
func ListWorkspaceClassSessions(smallClassId int) ([]*WorkspaceClassSession, error) {
	var list []*WorkspaceClassSession
	query := DB.Order("updated_at desc, id desc")
	if smallClassId > 0 {
		query = query.Where("small_class_id = ?", smallClassId)
	}
	if err := query.Find(&list).Error; err != nil {
		return nil, err
	}
	fillWorkspaceClassSessionDisplay(list)
	return list, nil
}

func fillWorkspaceClassSessionDisplay(list []*WorkspaceClassSession) {
	for _, item := range list {
		if item == nil {
			continue
		}
		if lesson, err := GetWorkspaceLessonById(item.LessonId); err == nil {
			item.LessonTitle = lesson.Title
			item.AiCourse = lesson.AiCourse
			if strings.TrimSpace(item.Theme) == "" {
				item.Theme = strings.TrimSpace(lesson.Title)
			}
		}
		if unit, err := GetWorkspaceUnitById(item.UnitId); err == nil {
			item.UnitName = unit.Name
		}
		if smallClass, err := GetWorkspaceSmallClassById(item.SmallClassId); err == nil {
			item.SmallClassName = smallClass.Name
			item.SmallClassCode = smallClass.Code
		}
		var taskCount int64
		_ = DB.Model(&WorkspaceLessonTask{}).Where("lesson_id = ?", item.LessonId).Count(&taskCount).Error
		item.TaskCount = int(taskCount)
		var submissionCount int64
		_ = DB.Model(&WorkspaceTaskSubmission{}).Where("session_id = ?", item.Id).Count(&submissionCount).Error
		item.SubmissionCount = int(submissionCount)
	}
}

// ---------- 提交 ----------

// ListWorkspaceLessonTasks 取课时下全部分项任务（按排序）。
func ListWorkspaceLessonTasks(lessonId int) ([]*WorkspaceLessonTask, error) {
	var tasks []*WorkspaceLessonTask
	err := DB.Where("lesson_id = ?", lessonId).Order("sort_order asc, id asc").Find(&tasks).Error
	if err == nil && tasks == nil {
		tasks = []*WorkspaceLessonTask{}
	}
	return tasks, err
}

// ListWorkspaceSubmissionsBySessionUser 取某学生在某会话下的全部提交。
func ListWorkspaceSubmissionsBySessionUser(sessionId, userId int) ([]*WorkspaceTaskSubmission, error) {
	var list []*WorkspaceTaskSubmission
	err := DB.Where("session_id = ? AND user_id = ?", sessionId, userId).
		Order("id asc").Find(&list).Error
	if err == nil && list == nil {
		list = []*WorkspaceTaskSubmission{}
	}
	return list, err
}

// ListWorkspaceSubmissionsBySession 取某会话下全部学生的提交（教师概览用）。
func ListWorkspaceSubmissionsBySession(sessionId int) ([]*WorkspaceTaskSubmission, error) {
	var list []*WorkspaceTaskSubmission
	err := DB.Where("session_id = ?", sessionId).Order("id asc").Find(&list).Error
	if err == nil && list == nil {
		list = []*WorkspaceTaskSubmission{}
	}
	return list, err
}

// CountWorkspaceTaskFileSubmissions 统计学生对某分项任务已提交的文件数量，
// 用于校验 max_uploads 上限（文字/AI 作品提交不占用文件名额）。
func CountWorkspaceTaskFileSubmissions(sessionId, taskId, userId int) (int64, error) {
	var count int64
	err := DB.Model(&WorkspaceTaskSubmission{}).
		Where("session_id = ? AND task_id = ? AND user_id = ? AND content_type = ?",
			sessionId, taskId, userId, WorkspaceSubmissionFile).
		Count(&count).Error
	return count, err
}

// CountWorkspaceTaskSubmissions 统计学生对某分项任务已提交的总次数（含全部形式），
// 用于校验 max_submits 提交次数上限。
func CountWorkspaceTaskSubmissions(sessionId, taskId, userId int) (int64, error) {
	var count int64
	err := DB.Model(&WorkspaceTaskSubmission{}).
		Where("session_id = ? AND task_id = ? AND user_id = ?", sessionId, taskId, userId).
		Count(&count).Error
	return count, err
}

// ListWorkspaceTaskSubmissionsInRange 列出时间范围内这批学生的全部提交（学习报告完成率用）。
// userIds 为空表示不限学生。
func ListWorkspaceTaskSubmissionsInRange(start, end int64, userIds []int) ([]*WorkspaceTaskSubmission, error) {
	var list []*WorkspaceTaskSubmission
	tx := DB.Where("created_at >= ? AND created_at < ?", start, end)
	if len(userIds) > 0 {
		tx = tx.Where("user_id in (?)", userIds)
	}
	err := tx.Find(&list).Error
	if err == nil && list == nil {
		list = []*WorkspaceTaskSubmission{}
	}
	return list, err
}

func (s *WorkspaceTaskSubmission) Insert() error {
	return DB.Create(s).Error
}
