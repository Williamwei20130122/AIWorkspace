package model

import (
	"strconv"
	"strings"

	"gorm.io/gorm"
)

// 小班类型：正课班级 / 社团（原选修）班级。
// 两类业务相互分开：正课只能在同年级、同一行政大班内部拆分；
// 社团归属学部并支持跨年级组建。
const (
	WorkspaceSmallClassTypeRegular = "regular"
	// WorkspaceSmallClassTypeClub 社团（原选修 elective），存量 elective 数据按社团处理。
	WorkspaceSmallClassTypeClub = "elective"
)

// WorkspaceSmallClass 上课小班（授课分班），与行政大班（WorkspaceClass）相互独立。
// 后续需求中提到的「班级」均指小班。
type WorkspaceSmallClass struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	Name      string `json:"name" gorm:"type:varchar(64);index"`
	// Code 小班专属编码/代号，教师自定义（A3），留空时按自增序号自动生成。
	Code string `json:"code" gorm:"type:varchar(32);index"`
	// ParentClassIds 所属行政大班 id 列表（A6：一个行政大班可拆分为多个小班，且一个小班可挂靠多个行政班），空数组表示未指定。
	ParentClassIds WorkspaceIdList `json:"parent_class_ids"`
	// TeacherIds 授课教师用户 id 列表（A8：一个小班可由多位教师共同授课），空数组表示未绑定。
	TeacherIds WorkspaceIdList `json:"teacher_ids"`
	// Type 小班类型：regular 正课 / elective 社团（原选修），默认正课。
	Type string `json:"type" gorm:"type:varchar(16);default:'regular'"`
	// SectionId 社团小班归属学部 id（小学部/初中部/高中部），支持跨年级组建；正课小班为 0。
	SectionId int `json:"section_id" gorm:"default:0;index"`
	Enabled bool   `json:"enabled" gorm:"default:true"`
	// AiEnabled 小班 AI 权限总开关（B1）：关闭后该小班学生无法使用任何 AI 生成能力。
	AiEnabled bool `json:"ai_enabled" gorm:"default:true"`
	// HtmlEnabled HTML 实验室开关：默认关闭，需教师在小班管理中显式开启。
	HtmlEnabled bool `json:"html_enabled" gorm:"default:false"`
	// SlideEnabled 演示实验室开关：默认关闭，需教师在小班管理中显式开启。
	SlideEnabled bool `json:"slide_enabled" gorm:"default:false"`
	// 展示用，不入库
	ParentClassName string `json:"parent_class_name" gorm:"-"`
	SectionName     string `json:"section_name" gorm:"-"`
	TeacherName     string `json:"teacher_name" gorm:"-"`
	MemberCount     int    `json:"member_count" gorm:"-"`
}

// WorkspaceSmallClassMember 小班与学生的多对多关系（A7）：
// 一名学生可同时加入多个不同课时对应的小班。
type WorkspaceSmallClassMember struct {
	Id           int   `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt    int64 `json:"created_at" gorm:"autoCreateTime;index"`
	SmallClassId int   `json:"small_class_id" gorm:"uniqueIndex:idx_ws_small_member;index"`
	StudentId    int   `json:"student_id" gorm:"uniqueIndex:idx_ws_small_member;index"`
	// UserId 便于按登录用户反查其所在小班（AI 权限校验用），冗余存储。
	UserId int `json:"user_id" gorm:"index"`
}

// ---------- 小班 CRUD ----------

// GetAllWorkspaceSmallClasses 返回全部小班，并回填所属行政班、授课教师与成员数。
// parentClassId / teacherId > 0 时按包含该 id 的小班过滤（列表字段为内存判断）。
func GetAllWorkspaceSmallClasses(parentClassId, teacherId int) ([]*WorkspaceSmallClass, error) {
	var list []*WorkspaceSmallClass
	if err := DB.Order("id desc").Find(&list).Error; err != nil {
		return nil, err
	}
	if parentClassId > 0 || teacherId > 0 {
		filtered := make([]*WorkspaceSmallClass, 0, len(list))
		for _, item := range list {
			if parentClassId > 0 && !item.ParentClassIds.Contains(parentClassId) {
				continue
			}
			if teacherId > 0 && !item.TeacherIds.Contains(teacherId) {
				continue
			}
			filtered = append(filtered, item)
		}
		list = filtered
	}
	fillWorkspaceSmallClassDisplay(list)
	return list, nil
}

// Contains 判断 id 列表是否包含指定 id。
func (l WorkspaceIdList) Contains(id int) bool {
	for _, item := range l {
		if item == id {
			return true
		}
	}
	return false
}

func fillWorkspaceSmallClassDisplay(list []*WorkspaceSmallClass) {
	if len(list) == 0 {
		return
	}
	classIds := make(map[int]bool)
	teacherIds := make(map[int]bool)
	for _, item := range list {
		for _, id := range item.ParentClassIds {
			if id > 0 {
				classIds[id] = true
			}
		}
		for _, id := range item.TeacherIds {
			if id > 0 {
				teacherIds[id] = true
			}
		}
	}
	classNames := make(map[int]string)
	if len(classIds) > 0 {
		ids := make([]int, 0, len(classIds))
		for id := range classIds {
			ids = append(ids, id)
		}
		var classes []*WorkspaceClass
		_ = DB.Where("id in (?)", ids).Find(&classes).Error
		for _, class := range classes {
			classNames[class.Id] = class.Name
		}
	}
	teacherNames := make(map[int]string)
	if len(teacherIds) > 0 {
		ids := make([]int, 0, len(teacherIds))
		for id := range teacherIds {
			ids = append(ids, id)
		}
		var users []*User
		_ = DB.Where("id in (?)", ids).Find(&users).Error
		for _, user := range users {
			teacherNames[user.Id] = user.DisplayName
			if teacherNames[user.Id] == "" {
				teacherNames[user.Id] = user.Username
			}
		}
	}
	// 成员数统计。
	type row struct {
		SmallClassId int
		Total        int
	}
	var rows []row
	_ = DB.Model(&WorkspaceSmallClassMember{}).
		Select("small_class_id, count(*) as total").
		Group("small_class_id").
		Scan(&rows).Error
	counts := make(map[int]int, len(rows))
	for _, r := range rows {
		counts[r.SmallClassId] = r.Total
	}
	for _, item := range list {
		item.ParentClassName = joinWorkspaceSmallClassNames(item.ParentClassIds, classNames)
		item.TeacherName = joinWorkspaceSmallClassNames(item.TeacherIds, teacherNames)
		item.MemberCount = counts[item.Id]
	}
	// 社团小班回填学部名（展示用）。
	fillWorkspaceSmallClassSections(list)
}

// fillWorkspaceSmallClassSections 回填小班所属学部名称。
func fillWorkspaceSmallClassSections(list []*WorkspaceSmallClass) {
	sectionIds := make(map[int]bool)
	for _, item := range list {
		if item.SectionId > 0 {
			sectionIds[item.SectionId] = true
		}
	}
	if len(sectionIds) == 0 {
		return
	}
	sections, err := AllWorkspaceSections()
	if err != nil {
		return
	}
	names := make(map[int]string, len(sections))
	for _, section := range sections {
		names[section.Id] = section.Name
	}
	for _, item := range list {
		item.SectionName = names[item.SectionId]
	}
}

// joinWorkspaceSmallClassNames 按 id 顺序拼接展示名（行政班名 / 教师名），分号分隔。
func joinWorkspaceSmallClassNames(ids WorkspaceIdList, names map[int]string) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		if name := names[id]; name != "" {
			parts = append(parts, name)
		}
	}
	return strings.Join(parts, "；")
}

func GetWorkspaceSmallClassById(id int) (*WorkspaceSmallClass, error) {
	var item WorkspaceSmallClass
	if err := DB.First(&item, id).Error; err != nil {
		return nil, err
	}
	fillWorkspaceSmallClassDisplay([]*WorkspaceSmallClass{&item})
	return &item, nil
}

func (s *WorkspaceSmallClass) Insert() error {
	return DB.Create(s).Error
}

func (s *WorkspaceSmallClass) Update() error {
	return DB.Model(s).
		Select("name", "code", "parent_class_ids", "teacher_ids", "type", "section_id", "enabled", "ai_enabled", "html_enabled", "slide_enabled").
		Updates(s).Error
}

func DeleteWorkspaceSmallClass(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&WorkspaceSmallClass{}, id).Error; err != nil {
			return err
		}
		return tx.Where("small_class_id = ?", id).Delete(&WorkspaceSmallClassMember{}).Error
	})
}

// SetWorkspaceSmallClassAI 一键开启/关闭小班全部 AI 模型工作站权限（B1）。
func SetWorkspaceSmallClassAI(id int, aiEnabled bool) error {
	return DB.Model(&WorkspaceSmallClass{}).Where("id = ?", id).
		Update("ai_enabled", aiEnabled).Error
}

// SetWorkspaceSmallClassHtml 一键开启/关闭小班 HTML 实验室权限。
func SetWorkspaceSmallClassHtml(id int, htmlEnabled bool) error {
	return DB.Model(&WorkspaceSmallClass{}).Where("id = ?", id).
		Update("html_enabled", htmlEnabled).Error
}

// SetWorkspaceSmallClassSlide 一键开启/关闭小班演示实验室权限。
func SetWorkspaceSmallClassSlide(id int, slideEnabled bool) error {
	return DB.Model(&WorkspaceSmallClass{}).Where("id = ?", id).
		Update("slide_enabled", slideEnabled).Error
}

// ---------- 小班成员 ----------

// GetWorkspaceSmallClassMemberIds 返回小班内全部学生的 student id 集合。
func GetWorkspaceSmallClassMemberIds(smallClassId int) ([]int, error) {
	var ids []int
	if err := DB.Model(&WorkspaceSmallClassMember{}).
		Where("small_class_id = ?", smallClassId).
		Pluck("student_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// GetWorkspaceSmallClassMembers 返回小班成员学生列表（回填展示字段）。
func GetWorkspaceSmallClassMembers(smallClassId int) ([]*WorkspaceStudent, error) {
	studentIds, err := GetWorkspaceSmallClassMemberIds(smallClassId)
	if err != nil {
		return nil, err
	}
	if len(studentIds) == 0 {
		return []*WorkspaceStudent{}, nil
	}
	var students []*WorkspaceStudent
	if err := DB.Where("id in (?)", studentIds).Order("id asc").Find(&students).Error; err != nil {
		return nil, err
	}
	fillWorkspaceStudentDisplay(students)
	return students, nil
}

// AddWorkspaceSmallClassMembers 把学生批量加入小班（幂等：已在班内的跳过）。
func AddWorkspaceSmallClassMembers(smallClassId int, studentIds []int) (int, error) {
	added := 0
	for _, studentId := range studentIds {
		if studentId <= 0 {
			continue
		}
		student, err := GetWorkspaceStudentById(studentId)
		if err != nil {
			continue
		}
		var count int64
		_ = DB.Model(&WorkspaceSmallClassMember{}).
			Where("small_class_id = ? AND student_id = ?", smallClassId, studentId).
			Count(&count).Error
		if count > 0 {
			continue
		}
		member := &WorkspaceSmallClassMember{
			SmallClassId: smallClassId,
			StudentId:    studentId,
			UserId:       student.UserId,
		}
		if err := DB.Create(member).Error; err != nil {
			continue
		}
		added++
	}
	return added, nil
}

// RemoveWorkspaceSmallClassMember 把学生移出小班（灵活调班）。
func RemoveWorkspaceSmallClassMember(smallClassId, studentId int) error {
	return DB.Where("small_class_id = ? AND student_id = ?", smallClassId, studentId).
		Delete(&WorkspaceSmallClassMember{}).Error
}

// RemoveWorkspaceSmallClassMembers 批量把学生移出小班，返回实际移出人数。
func RemoveWorkspaceSmallClassMembers(smallClassId int, studentIds []int) (int, error) {
	valid := make([]int, 0, len(studentIds))
	seen := make(map[int]bool, len(studentIds))
	for _, studentId := range studentIds {
		if studentId <= 0 || seen[studentId] {
			continue
		}
		seen[studentId] = true
		valid = append(valid, studentId)
	}
	if len(valid) == 0 {
		return 0, nil
	}
	result := DB.Where("small_class_id = ? AND student_id in (?)", smallClassId, valid).
		Delete(&WorkspaceSmallClassMember{})
	if result.Error != nil {
		return 0, result.Error
	}
	return int(result.RowsAffected), nil
}

// GetWorkspaceStudentSmallClassIds 返回学生当前加入的小班 id 列表。
func GetWorkspaceStudentSmallClassIds(studentId int) ([]int, error) {
	var ids []int
	if err := DB.Model(&WorkspaceSmallClassMember{}).
		Where("student_id = ?", studentId).
		Order("small_class_id asc").
		Pluck("small_class_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// ---------- AI 权限判定 ----------

// WorkspaceStudentAIEnabled 判断学生当前是否可使用 AI 生成能力（B1/B2）。
// 判定规则：学生所属的任一 enabled 小班 AiEnabled 为 true 即放行；
// 未加入任何小班（或小班已停用）时不拦截，保持原有全量可用行为。
func WorkspaceStudentAIEnabled(userId int) bool {
	if userId <= 0 {
		return true
	}
	var count int64
	err := DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Where("sc.ai_enabled = ?", true).
		Count(&count).Error
	if err != nil {
		return true
	}
	if count > 0 {
		return true
	}
	// 有归属小班但全部关闭 AI：拦截。
	var total int64
	_ = DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Count(&total).Error
	return total == 0
}

// WorkspaceStudentHtmlEnabled 判断学生当前是否可使用 HTML 实验室。
// 与 AI 开关独立：HTML 实验室默认关闭，学生所属任一 enabled 小班 HtmlEnabled
// 为 true 即放行；未加入任何小班时不拦截（无小班数据的账号保持可用）。
func WorkspaceStudentHtmlEnabled(userId int) bool {
	if userId <= 0 {
		return true
	}
	var count int64
	err := DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Where("sc.html_enabled = ?", true).
		Count(&count).Error
	if err != nil {
		return true
	}
	if count > 0 {
		return true
	}
	// 有归属小班但全部关闭 HTML 实验室：拦截。
	var total int64
	_ = DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Count(&total).Error
	return total == 0
}

// WorkspaceStudentSlideEnabled 判断学生当前是否可使用演示实验室（Slide Lab）。
// 与 AI 开关独立：演示实验室默认关闭，学生所属任一 enabled 小班 SlideEnabled
// 为 true 即放行；未加入任何小班时不拦截（无小班数据的账号保持可用）。
func WorkspaceStudentSlideEnabled(userId int) bool {
	if userId <= 0 {
		return true
	}
	var count int64
	err := DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Where("sc.slide_enabled = ?", true).
		Count(&count).Error
	if err != nil {
		return true
	}
	if count > 0 {
		return true
	}
	// 有归属小班但全部关闭演示实验室：拦截。
	var total int64
	_ = DB.Model(&WorkspaceSmallClassMember{}).
		Joins("JOIN workspace_small_classes sc ON sc.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.user_id = ?", userId).
		Where("sc.enabled = ?", true).
		Count(&total).Error
	return total == 0
}

// ---------- 学生侧小班视图（学生登录窗口等） ----------

// GetWorkspaceStudentSmallClasses 返回学生本人加入的小班列表。
func GetWorkspaceStudentSmallClasses(userId int) ([]*WorkspaceSmallClass, error) {
	var list []*WorkspaceSmallClass
	err := DB.
		Joins("JOIN workspace_small_class_members m ON m.small_class_id = workspace_small_classes.id").
		Where("m.user_id = ?", userId).
		Where("workspace_small_classes.enabled = ?", true).
		Order("workspace_small_classes.id desc").
		Find(&list).Error
	if err != nil {
		return nil, err
	}
	fillWorkspaceSmallClassDisplay(list)
	return list, nil
}

// MigrateWorkspaceSmallClassMultiSelect 把旧版单值列（parent_class_id / teacher_id）
// 的存量数据迁移到新的列表列（parent_class_ids / teacher_ids），仅执行一次幂等补齐。
func MigrateWorkspaceSmallClassMultiSelect() error {
	migrator := DB.Migrator()
	if !migrator.HasColumn(&WorkspaceSmallClass{}, "parent_class_id") &&
		!migrator.HasColumn(&WorkspaceSmallClass{}, "teacher_id") {
		return nil
	}
	var list []*WorkspaceSmallClass
	if err := DB.Find(&list).Error; err != nil {
		return err
	}
	for _, item := range list {
		changed := false
		if len(item.ParentClassIds) == 0 && migrator.HasColumn(&WorkspaceSmallClass{}, "parent_class_id") {
			var oldId int
			if err := DB.Model(&WorkspaceSmallClass{}).Where("id = ?", item.Id).
				Select("parent_class_id").Scan(&oldId).Error; err == nil && oldId > 0 {
				item.ParentClassIds = WorkspaceIdList{oldId}
				changed = true
			}
		}
		if len(item.TeacherIds) == 0 && migrator.HasColumn(&WorkspaceSmallClass{}, "teacher_id") {
			var oldId int
			if err := DB.Model(&WorkspaceSmallClass{}).Where("id = ?", item.Id).
				Select("teacher_id").Scan(&oldId).Error; err == nil && oldId > 0 {
				item.TeacherIds = WorkspaceIdList{oldId}
				changed = true
			}
		}
		if !changed {
			continue
		}
		if err := DB.Model(&WorkspaceSmallClass{}).Where("id = ?", item.Id).
			Updates(map[string]any{
				"parent_class_ids": item.ParentClassIds,
				"teacher_ids":      item.TeacherIds,
			}).Error; err != nil {
			return err
		}
	}
	// 迁移完成后删除旧的单值列，避免 GORM 继续读写过期字段。
	if migrator.HasColumn(&WorkspaceSmallClass{}, "parent_class_id") {
		_ = migrator.DropColumn(&WorkspaceSmallClass{}, "parent_class_id")
	}
	if migrator.HasColumn(&WorkspaceSmallClass{}, "teacher_id") {
		_ = migrator.DropColumn(&WorkspaceSmallClass{}, "teacher_id")
	}
	return nil
}

// EnsureWorkspaceSmallClassCodes 为存量小班补齐空编码，保证每个小班有唯一编码（A3）。
func EnsureWorkspaceSmallClassCodes() error {
	var list []*WorkspaceSmallClass
	if err := DB.Where("code = '' OR code IS NULL").Find(&list).Error; err != nil {
		return err
	}
	for _, item := range list {
		item.Code = "S" + strconv.Itoa(1000+item.Id)
		if err := item.Update(); err != nil {
			return err
		}
	}
	return nil
}

// WorkspaceSmallClassCodeExists 判断小班编码是否已被占用。
func WorkspaceSmallClassCodeExists(code string, excludeId int) (bool, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return false, nil
	}
	var count int64
	query := DB.Model(&WorkspaceSmallClass{}).Where("code = ?", code)
	if excludeId > 0 {
		query = query.Where("id <> ?", excludeId)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
