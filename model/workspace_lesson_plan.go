package model

import (
	"sort"
	"strings"

	"gorm.io/gorm"
)

// 分项任务的产出形式：大段文字 / 文件上传 / AI 生成作品提交。
const (
	WorkspaceTaskOutputText = "text"
	WorkspaceTaskOutputFile = "file"
	WorkspaceTaskOutputAI   = "ai"
)

// WorkspaceUnit 备课单元：归属「学部 + 年级序号」，一个年级下可有多个单元。
// 年级序号由入学年份自动推算（决策 9），因此年级变化只影响展示，不影响单元归属。
type WorkspaceUnit struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
	SectionId   int    `json:"section_id" gorm:"index:idx_ws_unit_scope"`
	GradeIndex  int    `json:"grade_index" gorm:"index:idx_ws_unit_scope"`
	Name        string `json:"name" gorm:"type:varchar(128)"`
	Description string `json:"description" gorm:"type:text"`
	SortOrder   int    `json:"sort_order"`
	// 展示用，不入库
	LessonCount int                `json:"lesson_count" gorm:"-"`
	Lessons     []*WorkspaceLesson `json:"lessons,omitempty" gorm:"-"`
}

// WorkspaceLesson 课时：单元下的单节课，支持 AI 课程 / 普通课程（C1）。
type WorkspaceLesson struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
	UnitId      int    `json:"unit_id" gorm:"index"`
	Title       string `json:"title" gorm:"type:varchar(128)"`
	Description string `json:"description" gorm:"type:text"`
	AiCourse    bool   `json:"ai_course" gorm:"default:false"`
	SortOrder   int    `json:"sort_order"`
	// 展示用，不入库
	TaskCount int                    `json:"task_count" gorm:"-"`
	Tasks     []*WorkspaceLessonTask `json:"tasks,omitempty" gorm:"-"`
}

// WorkspaceLessonTask 课时下的分项任务（C3/C4）：
// 产物类型直接配置在任务上（决策 5，不再有课程环节层级）。
type WorkspaceLessonTask struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	LessonId  int    `json:"lesson_id" gorm:"index"`
	Title     string `json:"title" gorm:"type:varchar(128)"`
	// Requirement 任务要求（学生端任务面板展示）。
	Requirement string `json:"requirement" gorm:"type:text"`
	// OutputForms 产出形式，逗号分隔：text / file / ai。
	OutputForms string `json:"output_forms" gorm:"type:varchar(64)"`
	// AllowedExtensions 允许上传的文件后缀白名单，逗号分隔（如 py,html）。
	AllowedExtensions string `json:"allowed_extensions" gorm:"type:varchar(255)"`
	// MaxUploads 单任务上传数量上限。
	MaxUploads int `json:"max_uploads" gorm:"default:1"`
	// MaxSubmits 每位学生对该任务的提交次数上限（含文字/文件/AI 作品），0 表示不限次数，无时间限制。
	MaxSubmits int `json:"max_submits" gorm:"default:0"`
	// ReferenceArtifacts 备课时挂到任务上的参考资料素材 id 列表，逗号分隔（云端素材共享后挑选）。
	ReferenceArtifacts string `json:"reference_artifacts" gorm:"type:varchar(512);default:''"`
	SortOrder          int    `json:"sort_order"`
}

// ---------- 备课方案读取 ----------

// GetWorkspaceLessonPlans 返回指定学部+年级下的全部单元，并嵌套课时与分项任务。
func GetWorkspaceLessonPlans(sectionId, gradeIndex int) ([]*WorkspaceUnit, error) {
	var units []*WorkspaceUnit
	query := DB.Order("sort_order asc, id asc")
	if sectionId > 0 {
		query = query.Where("section_id = ?", sectionId)
	}
	if gradeIndex > 0 {
		query = query.Where("grade_index = ?", gradeIndex)
	}
	if err := query.Find(&units).Error; err != nil {
		return nil, err
	}
	if len(units) == 0 {
		return units, nil
	}

	unitIds := make([]int, 0, len(units))
	for _, unit := range units {
		unitIds = append(unitIds, unit.Id)
	}
	var lessons []*WorkspaceLesson
	if err := DB.Where("unit_id in (?)", unitIds).
		Order("sort_order asc, id asc").Find(&lessons).Error; err != nil {
		return nil, err
	}

	tasksByLesson := make(map[int][]*WorkspaceLessonTask)
	if len(lessons) > 0 {
		lessonIds := make([]int, 0, len(lessons))
		for _, lesson := range lessons {
			lessonIds = append(lessonIds, lesson.Id)
		}
		var tasks []*WorkspaceLessonTask
		if err := DB.Where("lesson_id in (?)", lessonIds).
			Order("sort_order asc, id asc").Find(&tasks).Error; err != nil {
			return nil, err
		}
		for _, task := range tasks {
			tasksByLesson[task.LessonId] = append(tasksByLesson[task.LessonId], task)
		}
	}

	lessonsByUnit := make(map[int][]*WorkspaceLesson)
	for _, lesson := range lessons {
		lesson.Tasks = tasksByLesson[lesson.Id]
		if lesson.Tasks == nil {
			lesson.Tasks = []*WorkspaceLessonTask{}
		}
		lesson.TaskCount = len(lesson.Tasks)
		lessonsByUnit[lesson.UnitId] = append(lessonsByUnit[lesson.UnitId], lesson)
	}
	for _, unit := range units {
		unit.Lessons = lessonsByUnit[unit.Id]
		if unit.Lessons == nil {
			unit.Lessons = []*WorkspaceLesson{}
		}
		unit.LessonCount = len(unit.Lessons)
	}
	return units, nil
}

func GetWorkspaceUnitById(id int) (*WorkspaceUnit, error) {
	var unit WorkspaceUnit
	if err := DB.First(&unit, id).Error; err != nil {
		return nil, err
	}
	return &unit, nil
}

func GetWorkspaceLessonById(id int) (*WorkspaceLesson, error) {
	var lesson WorkspaceLesson
	if err := DB.First(&lesson, id).Error; err != nil {
		return nil, err
	}
	return &lesson, nil
}

func GetWorkspaceLessonTaskById(id int) (*WorkspaceLessonTask, error) {
	var task WorkspaceLessonTask
	if err := DB.First(&task, id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// ---------- 单元 CRUD ----------

func (u *WorkspaceUnit) Insert() error {
	return DB.Create(u).Error
}

func (u *WorkspaceUnit) Update() error {
	return DB.Model(u).
		Select("section_id", "grade_index", "name", "description", "sort_order").
		Updates(u).Error
}

// DeleteWorkspaceUnit 删除单元，同时级联删除其下课时与分项任务。
func DeleteWorkspaceUnit(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var lessonIds []int
		if err := tx.Model(&WorkspaceLesson{}).Where("unit_id = ?", id).
			Pluck("id", &lessonIds).Error; err != nil {
			return err
		}
		if len(lessonIds) > 0 {
			if err := tx.Where("lesson_id in (?)", lessonIds).
				Delete(&WorkspaceLessonTask{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("unit_id = ?", id).Delete(&WorkspaceLesson{}).Error; err != nil {
			return err
		}
		return tx.Delete(&WorkspaceUnit{}, id).Error
	})
}

// ---------- 课时 CRUD ----------

func (l *WorkspaceLesson) Insert() error {
	return DB.Create(l).Error
}

func (l *WorkspaceLesson) Update() error {
	return DB.Model(l).
		Select("unit_id", "title", "description", "ai_course", "sort_order").
		Updates(l).Error
}

// DeleteWorkspaceLesson 删除课时，同时级联删除其分项任务。
func DeleteWorkspaceLesson(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("lesson_id = ?", id).Delete(&WorkspaceLessonTask{}).Error; err != nil {
			return err
		}
		return tx.Delete(&WorkspaceLesson{}, id).Error
	})
}

// CopyWorkspaceLesson 复制课时（含全部分项任务）到目标单元，用于方案复用（C5）。
func CopyWorkspaceLesson(lessonId, targetUnitId int) (*WorkspaceLesson, error) {
	source, err := GetWorkspaceLessonById(lessonId)
	if err != nil {
		return nil, err
	}
	unitId := source.UnitId
	if targetUnitId > 0 {
		if _, err := GetWorkspaceUnitById(targetUnitId); err != nil {
			return nil, err
		}
		unitId = targetUnitId
	}
	copied := &WorkspaceLesson{
		UnitId:      unitId,
		Title:       source.Title + "（副本）",
		Description: source.Description,
		AiCourse:    source.AiCourse,
		SortOrder:   source.SortOrder + 1,
	}
	var tasks []*WorkspaceLessonTask
	if err := DB.Where("lesson_id = ?", lessonId).
		Order("sort_order asc, id asc").Find(&tasks).Error; err != nil {
		return nil, err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(copied).Error; err != nil {
			return err
		}
		for _, task := range tasks {
			clone := &WorkspaceLessonTask{
				LessonId:          copied.Id,
				Title:             task.Title,
				Requirement:       task.Requirement,
				OutputForms:       task.OutputForms,
				AllowedExtensions: task.AllowedExtensions,
				MaxUploads:        task.MaxUploads,
				MaxSubmits:        task.MaxSubmits,
				ReferenceArtifacts: task.ReferenceArtifacts,
				SortOrder:         task.SortOrder,
			}
			if err := tx.Create(clone).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return copied, nil
}

// ---------- 分项任务 CRUD ----------

func (t *WorkspaceLessonTask) Insert() error {
	return DB.Create(t).Error
}

func (t *WorkspaceLessonTask) Update() error {
	return DB.Model(t).
		Select("lesson_id", "title", "requirement", "output_forms",
			"allowed_extensions", "max_uploads", "max_submits",
			"reference_artifacts", "sort_order").
		Updates(t).Error
}

func DeleteWorkspaceLessonTask(id int) error {
	return DB.Delete(&WorkspaceLessonTask{}, id).Error
}

// ---------- 字段规范化 ----------

// NormalizeWorkspaceTaskOutputForms 归一化产出形式，未知值忽略；为空时默认「文字」。
func NormalizeWorkspaceTaskOutputForms(value string) string {
	allowed := map[string]bool{
		WorkspaceTaskOutputText: true,
		WorkspaceTaskOutputFile: true,
		WorkspaceTaskOutputAI:   true,
	}
	forms := make([]string, 0, 3)
	seen := make(map[string]bool)
	for _, part := range strings.Split(value, ",") {
		form := strings.ToLower(strings.TrimSpace(part))
		if !allowed[form] || seen[form] {
			continue
		}
		seen[form] = true
		forms = append(forms, form)
	}
	if len(forms) == 0 {
		return WorkspaceTaskOutputText
	}
	sort.Strings(forms)
	return strings.Join(forms, ",")
}

// NormalizeWorkspaceTaskExtensions 归一化允许上传的后缀白名单：去点、转小写、去重。
func NormalizeWorkspaceTaskExtensions(value string) string {
	exts := make([]string, 0, 16)
	seen := make(map[string]bool)
	for _, part := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == ';' || r == '；' || r == ' ' || r == '\t' || r == '\n'
	}) {
		ext := strings.ToLower(strings.TrimSpace(part))
		ext = strings.TrimLeft(ext, ".")
		if ext == "" || seen[ext] {
			continue
		}
		seen[ext] = true
		exts = append(exts, ext)
	}
	return strings.Join(exts, ",")
}

// WorkspaceTaskAllowsExtension 判断后缀是否在白名单内；白名单为空表示不限制。
func WorkspaceTaskAllowsExtension(task *WorkspaceLessonTask, fileName string) bool {
	if task == nil {
		return false
	}
	allowed := NormalizeWorkspaceTaskExtensions(task.AllowedExtensions)
	if allowed == "" {
		return true
	}
	lower := strings.ToLower(fileName)
	dot := strings.LastIndex(lower, ".")
	if dot < 0 || dot == len(lower)-1 {
		return false
	}
	ext := lower[dot+1:]
	for _, item := range strings.Split(allowed, ",") {
		if item == ext {
			return true
		}
	}
	return false
}
