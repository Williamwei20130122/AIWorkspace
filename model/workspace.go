package model

import (
	"database/sql/driver"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// WorkspaceIdList 以 JSON 文本形式存储的 ID 列表。
type WorkspaceIdList []int

func (l *WorkspaceIdList) Scan(val any) error {
	bytesValue := jsonScanBytes(val)
	if len(bytesValue) == 0 {
		*l = WorkspaceIdList{}
		return nil
	}
	return common.Unmarshal(bytesValue, l)
}

func (l WorkspaceIdList) Value() (driver.Value, error) {
	if len(l) == 0 {
		return "[]", nil
	}
	b, err := common.Marshal(l)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// WorkspaceCapabilityPoints 按生成能力记录点数，键为能力 id（text/image/edit/video/music/tts）。
type WorkspaceCapabilityPoints map[string]int

func (p *WorkspaceCapabilityPoints) Scan(val any) error {
	bytesValue := jsonScanBytes(val)
	if len(bytesValue) == 0 {
		*p = WorkspaceCapabilityPoints{}
		return nil
	}
	return common.Unmarshal(bytesValue, p)
}

func (p WorkspaceCapabilityPoints) Value() (driver.Value, error) {
	if len(p) == 0 {
		return "{}", nil
	}
	b, err := common.Marshal(p)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// Total 返回全部能力点数之和。
func (p WorkspaceCapabilityPoints) Total() int {
	total := 0
	for _, points := range p {
		if points > 0 {
			total += points
		}
	}
	return total
}

// 学生状态：在读 / 已毕业（学年结转后自动标记）/ 已注销（毕业满一年后删除账号，仅保留名单档案）。
const (
	WorkspaceStudentStatusActive      = 1
	WorkspaceStudentStatusGraduated   = 2
	WorkspaceStudentStatusDeactivated = 3
)

// WorkspaceClass 班级，通过 SectionId 关联学部，年级按届别自动换算。
type WorkspaceClass struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	Name      string `json:"name" gorm:"type:varchar(64);index"`
	// Code 班级编号，教师可编辑，用于名单表格下拉快速区分同名班级。
	Code        string `json:"code" gorm:"type:varchar(32);index"`
	Description string `json:"description" gorm:"type:varchar(255)"`
	// SectionId 所属学部（小学部/初中部/高中部）。
	SectionId int `json:"section_id" gorm:"index"`
	// EntryYear 届别对应的入学年份，如 2024；0 表示未设置。
	EntryYear int  `json:"entry_year" gorm:"index"`
	Enabled   bool `json:"enabled" gorm:"default:true"`
	// 展示用，不入库
	StudentCount int    `json:"student_count" gorm:"-"`
	SectionName  string `json:"section_name" gorm:"-"`
	SectionCode  string `json:"section_code" gorm:"-"`
	// GradeIndex 当前年级序号（由届别实时换算），0 表示届别未设置。
	GradeIndex int `json:"grade_index" gorm:"-"`
	// GradeName 当前年级显示名（如「初二」「已毕业」）。
	GradeName string `json:"grade_name" gorm:"-"`
	// Graduated 为 true 表示该班届别已超出学部学制年限。
	Graduated bool `json:"graduated" gorm:"-"`
}

// WorkspaceStudent 学生与班级的归属关系，学生账号复用 new-api 用户体系。
type WorkspaceStudent struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex"`
	ClassId   int    `json:"class_id" gorm:"index"`
	EntryYear int    `json:"entry_year" gorm:"index"`
	StudentNo string `json:"student_no" gorm:"type:varchar(64);index"`
	// PinyinUsername 学生姓名的小写拼音登录名，可由教师维护；学生可用它或学号登录。
	PinyinUsername string `json:"pinyin_username" gorm:"type:varchar(64);index"`
	// PasswordSet 学生是否已设置登录密码：仅在本人或教师主动设置后为 true，
	// 新建账号时写入的随机占位密码不算，以保证学生默认免密登录。
	PasswordSet bool   `json:"password_set" gorm:"default:false"`
	DisplayName string `json:"display_name" gorm:"type:varchar(64)"`
	Enabled     bool   `json:"enabled" gorm:"default:true"`
	// Status 1 在读、2 已毕业（学年结转时自动标记）、3 已注销（毕业满 1 年后删除账号）。
	Status int `json:"status" gorm:"default:1"`
	// GraduatedAt 毕业时间戳（学年结转时写入），用于计算毕业满 1 年后注销账号；0 表示未毕业。
	GraduatedAt int64 `json:"graduated_at" gorm:"default:0;index"`
	// 展示用，不入库：所属上课小班（学生可在学生表中直接设置）
	SmallClassIds   []int    `json:"small_class_ids" gorm:"-"`
	SmallClassNames []string `json:"small_class_names" gorm:"-"`
	// 展示用，不入库
	Username  string `json:"username" gorm:"-"`
	ClassName string `json:"class_name" gorm:"-"`
	GradeName string `json:"grade_name" gorm:"-"`
	// 展示用：剩余点数与已用点数（取自关联账号配额）
	Quota     int `json:"quota" gorm:"-"`
	UsedQuota int `json:"used_quota" gorm:"-"`
}

// WorkspaceUserQuota 单个用户在单项生成能力上的可用额度与已用量。
// Quota 为 0 表示不单独限制（沿用用户总配额）。
type WorkspaceUserQuota struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UpdatedAt    int64  `json:"updated_at" gorm:"autoUpdateTime"`
	UserId       int    `json:"user_id" gorm:"uniqueIndex:idx_ws_user_cap"`
	CapabilityId string `json:"capability_id" gorm:"type:varchar(32);uniqueIndex:idx_ws_user_cap"`
	Quota        int    `json:"quota"`
	Used         int    `json:"used"`
}

// ---------- 班级 ----------

func GetAllWorkspaceClasses() ([]*WorkspaceClass, error) {
	var classes []*WorkspaceClass
	if err := DB.Order("id desc").Find(&classes).Error; err != nil {
		return nil, err
	}
	fillWorkspaceClassStudentCount(classes)
	fillWorkspaceClassOrg(classes)
	return classes, nil
}

// fillWorkspaceClassOrg 按「学部 + 届别」实时回填当前年级名与毕业标记。
func fillWorkspaceClassOrg(classes []*WorkspaceClass) {
	if len(classes) == 0 {
		return
	}
	sections := make(map[int]*WorkspaceSection)
	if list, err := AllWorkspaceSections(); err == nil {
		for _, section := range list {
			sections[section.Id] = section
		}
	}
	now := time.Now()
	for _, class := range classes {
		section := sections[class.SectionId]
		if section == nil {
			continue
		}
		class.SectionName = section.Name
		class.SectionCode = section.Code
		index := WorkspaceSectionGradeIndexAt(section, class.EntryYear, now)
		class.GradeIndex = index
		class.GradeName = WorkspaceSectionGradeName(section, index)
		class.Graduated = WorkspaceSectionGraduated(section, class.EntryYear, now)
	}
}

func fillWorkspaceClassStudentCount(classes []*WorkspaceClass) {
	if len(classes) == 0 {
		return
	}
	type row struct {
		ClassId int
		Total   int
	}
	var rows []row
	_ = DB.Model(&WorkspaceStudent{}).
		Select("class_id, count(*) as total").
		Group("class_id").
		Scan(&rows).Error
	counts := make(map[int]int, len(rows))
	for _, r := range rows {
		counts[r.ClassId] = r.Total
	}
	for _, class := range classes {
		class.StudentCount = counts[class.Id]
	}
}

func GetWorkspaceClassById(id int) (*WorkspaceClass, error) {
	var class WorkspaceClass
	if err := DB.First(&class, id).Error; err != nil {
		return nil, err
	}
	fillWorkspaceClassOrg([]*WorkspaceClass{&class})
	return &class, nil
}

func (c *WorkspaceClass) Insert() error {
	return DB.Create(c).Error
}

func (c *WorkspaceClass) Update() error {
	return DB.Model(c).
		Select("name", "code", "description", "section_id", "entry_year", "enabled").
		Updates(c).Error
}

func DeleteWorkspaceClass(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&WorkspaceClass{}, id).Error; err != nil {
			return err
		}
		// 把该班学生归零（保留学生账号）。
		return tx.Model(&WorkspaceStudent{}).
			Where("class_id = ?", id).
			Update("class_id", 0).Error
	})
}

// ---------- 学生 ----------

func GetAllWorkspaceStudents(classId int) ([]*WorkspaceStudent, error) {
	return GetWorkspaceStudentsFiltered(classId, 0)
}

// GetWorkspaceStudentsFiltered 按班级/状态筛选学生，0 表示不限制。
func GetWorkspaceStudentsFiltered(classId, status int) ([]*WorkspaceStudent, error) {
	var students []*WorkspaceStudent
	query := DB.Order("id desc")
	if classId > 0 {
		query = query.Where("class_id = ?", classId)
	}
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	if err := query.Find(&students).Error; err != nil {
		return nil, err
	}
	fillWorkspaceStudentDisplay(students)
	return students, nil
}

// SearchWorkspaceStudents 按关键词搜索学生（姓名/拼音/学号/账号），供社团选人等场景快速检索。
// keyword 为空时返回空列表；默认最多 100 条，避免全表回传。
func SearchWorkspaceStudents(keyword string, limit int) ([]*WorkspaceStudent, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []*WorkspaceStudent{}, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	like := "%" + strings.ToLower(keyword) + "%"
	var students []*WorkspaceStudent
	if err := DB.
		Where("(lower(display_name) LIKE ? OR lower(pinyin_username) LIKE ? OR lower(student_no) LIKE ?)", like, like, like).
		Order("id asc").Limit(limit).Find(&students).Error; err != nil {
		return nil, err
	}
	fillWorkspaceStudentDisplay(students)
	return students, nil
}

// GetWorkspaceStudentsByClassIds 按班级 id 列表取在读学生（一键拉入小班时使用）。
func GetWorkspaceStudentsByClassIds(classIds []int) ([]*WorkspaceStudent, error) {
	if len(classIds) == 0 {
		return []*WorkspaceStudent{}, nil
	}
	var students []*WorkspaceStudent
	if err := DB.Where("class_id in (?) AND status = ?", classIds, WorkspaceStudentStatusActive).
		Order("id asc").Find(&students).Error; err != nil {
		return nil, err
	}
	fillWorkspaceStudentDisplay(students)
	return students, nil
}

// GetWorkspaceStudentsByUserIds 按用户 id 批量取学生档案，并回填班级、年级与账号展示信息。
func GetWorkspaceStudentsByUserIds(userIds []int) (map[int]*WorkspaceStudent, error) {
	result := make(map[int]*WorkspaceStudent, len(userIds))
	if len(userIds) == 0 {
		return result, nil
	}
	var students []*WorkspaceStudent
	if err := DB.Where("user_id in (?)", userIds).Find(&students).Error; err != nil {
		return nil, err
	}
	fillWorkspaceStudentDisplay(students)
	for _, student := range students {
		result[student.UserId] = student
	}
	return result, nil
}

func fillWorkspaceStudentDisplay(students []*WorkspaceStudent) {
	if len(students) == 0 {
		return
	}
	classIds := make(map[int]bool)
	userIds := make(map[int]bool)
	for _, s := range students {
		if s.ClassId > 0 {
			classIds[s.ClassId] = true
		}
		if s.UserId > 0 {
			userIds[s.UserId] = true
		}
	}
	classNames := make(map[int]string)
	classSections := make(map[int]int)
	classEntryYears := make(map[int]int)
	if len(classIds) > 0 {
		ids := make([]int, 0, len(classIds))
		for id := range classIds {
			ids = append(ids, id)
		}
		var classes []*WorkspaceClass
		_ = DB.Where("id in (?)", ids).Find(&classes).Error
		for _, c := range classes {
			classNames[c.Id] = c.Name
			classSections[c.Id] = c.SectionId
			classEntryYears[c.Id] = c.EntryYear
		}
	}
	sections := make(map[int]*WorkspaceSection)
	if list, err := AllWorkspaceSections(); err == nil {
		for _, section := range list {
			sections[section.Id] = section
		}
	}
	now := time.Now()
	usernames := make(map[int]string)
	quotas := make(map[int]int)
	usedQuotas := make(map[int]int)
	if len(userIds) > 0 {
		ids := make([]int, 0, len(userIds))
		for id := range userIds {
			ids = append(ids, id)
		}
		var rows []struct {
			Id        int
			Username  string
			Quota     int
			UsedQuota int
		}
		_ = DB.Model(&User{}).
			Select("id, username, quota, used_quota").
			Where("id in (?)", ids).
			Scan(&rows).Error
		for _, row := range rows {
			usernames[row.Id] = row.Username
			quotas[row.Id] = row.Quota
			usedQuotas[row.Id] = row.UsedQuota
		}
	}
	for _, s := range students {
		s.ClassName = classNames[s.ClassId]
		section := sections[classSections[s.ClassId]]
		entryYear := s.EntryYear
		if entryYear <= 0 {
			entryYear = classEntryYears[s.ClassId]
		}
		s.GradeName = WorkspaceSectionGradeName(section, WorkspaceSectionGradeIndexAt(section, entryYear, now))
		if s.Status == WorkspaceStudentStatusGraduated {
			s.GradeName = "已毕业"
		}
		s.Username = usernames[s.UserId]
		s.Quota = quotas[s.UserId]
		s.UsedQuota = usedQuotas[s.UserId]
	}
	fillWorkspaceStudentSmallClasses(students)
}

// fillWorkspaceStudentSmallClasses 回填学生所属上课小班 id 与名称列表。
func fillWorkspaceStudentSmallClasses(students []*WorkspaceStudent) {
	studentIds := make([]int, 0, len(students))
	for _, s := range students {
		if s.Id > 0 {
			studentIds = append(studentIds, s.Id)
		}
	}
	if len(studentIds) == 0 {
		return
	}
	type memberRow struct {
		StudentId      int
		SmallClassId   int
		SmallClassName string
	}
	var rows []memberRow
	_ = DB.Model(&WorkspaceSmallClassMember{}).
		Select("workspace_small_class_members.student_id AS student_id, "+
			"workspace_small_class_members.small_class_id AS small_class_id, "+
			"workspace_small_classes.name AS small_class_name").
		Joins("JOIN workspace_small_classes ON workspace_small_classes.id = workspace_small_class_members.small_class_id").
		Where("workspace_small_class_members.student_id IN (?)", studentIds).
		Order("workspace_small_class_members.small_class_id asc").
		Scan(&rows).Error
	byStudent := make(map[int][]memberRow, len(students))
	for _, row := range rows {
		byStudent[row.StudentId] = append(byStudent[row.StudentId], row)
	}
	for _, s := range students {
		members := byStudent[s.Id]
		s.SmallClassIds = make([]int, 0, len(members))
		s.SmallClassNames = make([]string, 0, len(members))
		for _, m := range members {
			s.SmallClassIds = append(s.SmallClassIds, m.SmallClassId)
			s.SmallClassNames = append(s.SmallClassNames, m.SmallClassName)
		}
	}
}

func GetWorkspaceStudentById(id int) (*WorkspaceStudent, error) {
	var student WorkspaceStudent
	if err := DB.First(&student, id).Error; err != nil {
		return nil, err
	}
	return &student, nil
}

// WorkspacePinyinInUse 判断同一班级内是否已存在相同拼音登录名。
// excludeStudentId 用于编辑场景排除学生本人。
func WorkspacePinyinInUse(classId int, pinyinName string, excludeStudentId int) (bool, error) {
	pinyinName = strings.TrimSpace(pinyinName)
	if classId <= 0 || pinyinName == "" {
		return false, nil
	}
	var count int64
	query := DB.Model(&WorkspaceStudent{}).
		Where("class_id = ? AND pinyin_username = ?", classId, pinyinName)
	if excludeStudentId > 0 {
		query = query.Where("id <> ?", excludeStudentId)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetWorkspaceActiveStudentUserIds 返回指定班级或在读学生用户 id 集合。
// classId > 0 时按班级过滤；否则 sectionId > 0 时按学部过滤，
// gradeIndex > 0 时再按「当前年级序号」换算到对应届别（当前学年 - 年级序号 + 1）。
func GetWorkspaceActiveStudentUserIds(classId, sectionId, gradeIndex int) ([]int, error) {
	if classId <= 0 && sectionId <= 0 {
		return []int{}, nil
	}
	query := DB.Model(&WorkspaceStudent{}).
		Where("status = ?", WorkspaceStudentStatusActive).
		Where("user_id > 0")
	if classId > 0 {
		query = query.Where("class_id = ?", classId)
	} else {
		classQuery := DB.Model(&WorkspaceClass{}).Select("id").Where("section_id = ?", sectionId)
		if gradeIndex > 0 {
			section, err := GetWorkspaceSectionById(sectionId)
			if err != nil {
				return []int{}, nil
			}
			entryYear := WorkspaceSectionAcademicYear(section, time.Now()) - gradeIndex + 1
			classQuery = classQuery.Where("entry_year = ?", entryYear)
		}
		query = query.Where("class_id in (?)", classQuery)
	}
	var ids []int
	if err := query.Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// FindWorkspaceStudentUserIds 按「班级 / 学部年级 + 姓名关键词」筛出学生的用户 id。
// classId 优先；其次 sectionId + gradeIndex；keyword 同时匹配姓名、姓名拼音、学号与登录账号，
// 为空时不限制姓名。includeGraduated 为 true 时把已毕业学生也纳入筛选结果。
// 三者都为空时返回全部学生（用于仅按姓名搜索的场景）。
func FindWorkspaceStudentUserIds(classId, sectionId, gradeIndex int, keyword string, includeGraduated bool) ([]int, error) {
	query := DB.Model(&WorkspaceStudent{}).
		Where("user_id > 0")
	if includeGraduated {
		query = query.Where("status IN ?", []int{WorkspaceStudentStatusActive, WorkspaceStudentStatusGraduated})
	} else {
		query = query.Where("status = ?", WorkspaceStudentStatusActive)
	}
	if classId > 0 {
		query = query.Where("class_id = ?", classId)
	} else if sectionId > 0 {
		classQuery := DB.Model(&WorkspaceClass{}).Select("id").Where("section_id = ?", sectionId)
		if gradeIndex > 0 {
			section, err := GetWorkspaceSectionById(sectionId)
			if err != nil {
				return []int{}, nil
			}
			entryYear := WorkspaceSectionAcademicYear(section, time.Now()) - gradeIndex + 1
			classQuery = classQuery.Where("entry_year = ?", entryYear)
		}
		query = query.Where("class_id in (?)", classQuery)
	}
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + keyword + "%"
		// 拼音登录名以去掉空格的紧凑形式存储，这里同步做一次紧凑匹配。
		compact := strings.ToLower(strings.Join(strings.Fields(keyword), ""))
		query = query.Where(
			"(display_name LIKE ? OR pinyin_username LIKE ? OR student_no LIKE ? OR user_id IN (?))",
			like,
			"%"+compact+"%",
			like,
			DB.Model(&User{}).Select("id").Where("username LIKE ? OR display_name LIKE ?", like, like),
		)
	}
	var ids []int
	if err := query.Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// FindWorkspaceStudentForLogin 按班级 + 姓名（可选学号）定位可登录的学生。
// 仅匹配在读（status 为在读）且启用的学生；重名时要求补学号，
// 未命中或存在多条候选均返回可展示的错误。
func FindWorkspaceStudentForLogin(classId int, name string, studentNo string) (*WorkspaceStudent, error) {
	query := DB.Model(&WorkspaceStudent{}).
		Where("class_id = ?", classId).
		Where("display_name = ?", name).
		Where("status = ?", WorkspaceStudentStatusActive).
		Where("enabled = ?", true)
	if studentNo != "" {
		query = query.Where("student_no = ?", studentNo)
	}
	var students []*WorkspaceStudent
	if err := query.Find(&students).Error; err != nil {
		return nil, err
	}
	switch len(students) {
	case 0:
		return nil, errors.New("未找到该学生，请核对班级与姓名")
	case 1:
		return students[0], nil
	default:
		return nil, errors.New("该班级存在同名学生，请补充学号")
	}
}

// FindWorkspaceStudentByAccount 按学号 / 登录账号 / 小写拼音用户名定位可登录的学生。
// 账号大小写不敏感；classId > 0 时限定班级范围；gradeName 非空时按学生所在班级的
// 当前年级名缩小命中范围（登录页只选年级不选班级，账号同名/同拼音时按年级区分）。
// 命中多条时返回可展示错误。
func FindWorkspaceStudentByAccount(account string, classId int, gradeName string) (*WorkspaceStudent, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return nil, errors.New("请输入学号、登录账号或姓名全拼")
	}
	lower := strings.ToLower(account)
	// 姓名拼音兼容大小写与空格（含全角空格）：输入「Zhang San」也能匹配 zhangsan。
	pinyinKey := strings.ToLower(strings.Join(strings.Fields(strings.ReplaceAll(account, "\u3000", " ")), ""))
	query := DB.Model(&WorkspaceStudent{}).
		Where("status = ?", WorkspaceStudentStatusActive).
		Where("enabled = ?", true).
		Where(
			"student_no = ? OR LOWER(REPLACE(REPLACE(pinyin_username, ' ', ''), '　', '')) = ? OR user_id IN (?)",
			account,
			pinyinKey,
			DB.Model(&User{}).Select("id").Where("LOWER(username) = ?", lower),
		)
	if classId > 0 {
		query = query.Where("class_id = ?", classId)
	}
	var students []*WorkspaceStudent
	if err := query.Find(&students).Error; err != nil {
		return nil, err
	}
	// 年级为实时换算字段，命中多人时再按所选年级名过滤，用于账号同名/同拼音的区分。
	if gradeName = strings.TrimSpace(gradeName); gradeName != "" && len(students) > 1 {
		students = filterWorkspaceStudentsByGrade(students, gradeName)
	}
	switch len(students) {
	case 0:
		return nil, errors.New("未找到该学生，请核对学号或登录账号")
	case 1:
		return students[0], nil
	default:
		return nil, errors.New("该账号对应多名学生，请核对学号或拼音账号")
	}
}

// filterWorkspaceStudentsByGrade 按学生所在班级的当前年级名过滤（年级为实时换算值）。
func filterWorkspaceStudentsByGrade(students []*WorkspaceStudent, gradeName string) []*WorkspaceStudent {
	classIds := make([]int, 0, len(students))
	seen := make(map[int]bool, len(students))
	for _, student := range students {
		if student.ClassId > 0 && !seen[student.ClassId] {
			seen[student.ClassId] = true
			classIds = append(classIds, student.ClassId)
		}
	}
	if len(classIds) == 0 {
		return students
	}
	var classes []*WorkspaceClass
	if err := DB.Where("id IN ?", classIds).Find(&classes).Error; err != nil {
		return students
	}
	fillWorkspaceClassOrg(classes)
	hit := make(map[int]bool, len(classes))
	for _, class := range classes {
		if class.GradeName == gradeName {
			hit[class.Id] = true
		}
	}
	result := make([]*WorkspaceStudent, 0, len(students))
	for _, student := range students {
		if hit[student.ClassId] {
			result = append(result, student)
		}
	}
	return result
}

// GetWorkspaceStudentByUserId 按登录用户 id 取学生档案（学生自助页使用）。
func GetWorkspaceStudentByUserId(userId int) (*WorkspaceStudent, error) {
	var student WorkspaceStudent
	if err := DB.Where("user_id = ?", userId).First(&student).Error; err != nil {
		return nil, err
	}
	return &student, nil
}

func (s *WorkspaceStudent) Insert() error {
	return DB.Create(&s).Error
}

func (s *WorkspaceStudent) Update() error {
	return DB.Model(s).
		Select("user_id", "class_id", "entry_year", "student_no", "pinyin_username",
			"password_set", "display_name", "enabled", "status", "graduated_at").
		Updates(s).Error
}

func DeleteWorkspaceStudent(id int) error {
	return DB.Delete(&WorkspaceStudent{}, id).Error
}

// SetWorkspaceUserAccountEnabled 启用或停用学生登录账号（毕业停用 / 直升恢复）。
func SetWorkspaceUserAccountEnabled(userId int, enabled bool) error {
	if userId <= 0 {
		return nil
	}
	status := common.UserStatusDisabled
	if enabled {
		status = common.UserStatusEnabled
	}
	return DB.Model(&User{}).Where("id = ?", userId).Update("status", status).Error
}

// MarkWorkspaceStudentGraduated 学年结转：把学生标记为「已毕业」并停用其登录账号。
func MarkWorkspaceStudentGraduated(studentId, userId int, graduatedAt int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&WorkspaceStudent{}).Where("id = ?", studentId).Updates(map[string]any{
			"status":       WorkspaceStudentStatusGraduated,
			"enabled":      false,
			"graduated_at": graduatedAt,
		}).Error; err != nil {
			return err
		}
		if userId <= 0 {
			return nil
		}
		return tx.Model(&User{}).Where("id = ?", userId).
			Update("status", common.UserStatusDisabled).Error
	})
}

// ReinstateWorkspaceStudent 恢复被停用/毕业的学生账号并转入目标班级（直升沿用原账号）。
// 会同时把登录账号重新置为启用状态，并写入转班审计日志。
func ReinstateWorkspaceStudent(studentId, classId, entryYear int, reason string, operatorId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var student WorkspaceStudent
		if err := tx.First(&student, studentId).Error; err != nil {
			return err
		}
		fromClassId := student.ClassId
		if err := tx.Model(&WorkspaceStudent{}).Where("id = ?", studentId).Updates(map[string]any{
			"class_id":     classId,
			"entry_year":   entryYear,
			"status":       WorkspaceStudentStatusActive,
			"enabled":      true,
			"graduated_at": 0,
		}).Error; err != nil {
			return err
		}
		if student.UserId > 0 {
			if err := tx.Model(&User{}).Where("id = ?", student.UserId).
				Update("status", common.UserStatusEnabled).Error; err != nil {
				return err
			}
		}
		return tx.Create(&WorkspaceStudentTransferLog{
			UserId:      student.UserId,
			FromClassId: fromClassId,
			ToClassId:   classId,
			Reason:      reason,
			OperatorId:  operatorId,
		}).Error
	})
}

// ListWorkspaceStudentsPendingDeletion 返回毕业满保留期、待注销账号的学生（供定时任务使用）。
func ListWorkspaceStudentsPendingDeletion(targetTimestamp int64, limit int) ([]*WorkspaceStudent, error) {
	if limit <= 0 {
		limit = 200
	}
	var students []*WorkspaceStudent
	err := DB.Where("status = ? and graduated_at > 0 and graduated_at <= ?",
		WorkspaceStudentStatusGraduated, targetTimestamp).
		Order("id asc").
		Limit(limit).
		Find(&students).Error
	return students, err
}

// MarkWorkspaceStudentDeactivated 注销学生账号：仅保留名单档案并标记为「已注销」。
func MarkWorkspaceStudentDeactivated(studentId int) error {
	return DB.Model(&WorkspaceStudent{}).Where("id = ?", studentId).Updates(map[string]any{
		"status":  WorkspaceStudentStatusDeactivated,
		"enabled": false,
	}).Error
}

// DeleteWorkspaceUsagesByUserId 删除某学生的全部生成明细（账号注销时清理）。
func DeleteWorkspaceUsagesByUserId(userId int) (int64, error) {
	if userId <= 0 {
		return 0, nil
	}
	result := DB.Where("user_id = ?", userId).Delete(&WorkspaceUsage{})
	return result.RowsAffected, result.Error
}

// DeleteWorkspaceUserQuotas 删除某学生的能力额度记录（账号注销时清理）。
func DeleteWorkspaceUserQuotas(userId int) error {
	if userId <= 0 {
		return nil
	}
	return DB.Where("user_id = ?", userId).Delete(&WorkspaceUserQuota{}).Error
}

// ---------- 用户能力额度 ----------

func GetWorkspaceUserQuotas(userId int) ([]*WorkspaceUserQuota, error) {
	var quotas []*WorkspaceUserQuota
	query := DB.Order("user_id, capability_id")
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if err := query.Find(&quotas).Error; err != nil {
		return nil, err
	}
	return quotas, nil
}

// SetWorkspaceUserQuotas 全量覆盖某用户的能力额度（仅写入 quota 大于 0 的项）。
func SetWorkspaceUserQuotas(userId int, quotas map[string]int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userId).Delete(&WorkspaceUserQuota{}).Error; err != nil {
			return err
		}
		records := make([]*WorkspaceUserQuota, 0, len(quotas))
		for capabilityId, quota := range quotas {
			if capabilityId == "" || quota <= 0 {
				continue
			}
			records = append(records, &WorkspaceUserQuota{
				UserId:       userId,
				CapabilityId: capabilityId,
				Quota:        quota,
			})
		}
		if len(records) == 0 {
			return nil
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].CapabilityId < records[j].CapabilityId
		})
		return tx.Create(&records).Error
	})
}

// ResetWorkspaceUserQuotaUsage 清零某用户（或指定能力）的已用量。
func ResetWorkspaceUserQuotaUsage(userId int, capabilityId string) error {
	query := DB.Model(&WorkspaceUserQuota{}).Where("user_id = ?", userId)
	if capabilityId != "" {
		query = query.Where("capability_id = ?", capabilityId)
	}
	return query.Update("used", 0).Error
}

// ResetWorkspaceUserUsedQuota 一键清零用户累计已用点数（users.used_quota），
// 同步清零各能力已用量；剩余点数（users.quota）保持不变。
func ResetWorkspaceUserUsedQuota(userId int) error {
	if userId <= 0 {
		return errors.New("用户 ID 无效")
	}
	if err := DB.Model(&User{}).Where("id = ?", userId).Update("used_quota", 0).Error; err != nil {
		return err
	}
	return ResetWorkspaceUserQuotaUsage(userId, "")
}

// ---------- 转班 / 转年级 ----------

// TransferWorkspaceStudent 变更学生归属（转班、转年级、留级、直升），并写入审计日志。
func TransferWorkspaceStudent(studentId, toClassId int, reason string, operatorId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var student WorkspaceStudent
		if err := tx.First(&student, studentId).Error; err != nil {
			return err
		}
		fromClassId := student.ClassId
		entryYear := student.EntryYear
		if toClassId > 0 {
			var class WorkspaceClass
			if err := tx.First(&class, toClassId).Error; err != nil {
				return err
			}
			if class.EntryYear > 0 {
				entryYear = class.EntryYear
			}
		}
		if err := tx.Model(&WorkspaceStudent{}).Where("id = ?", studentId).
			Updates(map[string]any{
				"class_id":   toClassId,
				"entry_year": entryYear,
			}).Error; err != nil {
			return err
		}
		return tx.Create(&WorkspaceStudentTransferLog{
			UserId:      student.UserId,
			FromClassId: fromClassId,
			ToClassId:   toClassId,
			Reason:      reason,
			OperatorId:  operatorId,
		}).Error
	})
}
