package model

import (
	"database/sql/driver"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

// 教学组织主数据：学部（Section）与年级自动换算。
//
// 设计要点：
//   - 学部（小学部/初中部/高中部）配置学制年限、年级阶梯名称、学年升级月份与毕业规则。
//   - 班级只绑定「学部 + 届别」，年级不再手动维护，按「届别 + 学制 + 升级月份」实时计算。
//   - 学生用户名 = 学部代码(1) + 届别(2) + 顺位编号(5)，共 8 位，例如 P2600001。
//   - 教师用户名 = 固定前缀 T00 + 顺位编号(5)，共 8 位，例如 T0000001。

// WorkspaceGradeNames 年级阶梯名称（JSON 数组）。
type WorkspaceGradeNames []string

func (n *WorkspaceGradeNames) Scan(val any) error {
	bytesValue := jsonScanBytes(val)
	if len(bytesValue) == 0 {
		*n = WorkspaceGradeNames{}
		return nil
	}
	return common.Unmarshal(bytesValue, n)
}

func (n WorkspaceGradeNames) Value() (driver.Value, error) {
	if len(n) == 0 {
		return "[]", nil
	}
	b, err := common.Marshal(n)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// WorkspaceSection 学部。Code 参与学生用户名前缀。
type WorkspaceSection struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	Code      string `json:"code" gorm:"type:varchar(4);uniqueIndex"`
	Name      string `json:"name" gorm:"type:varchar(32)"`
	// Years 学制年限，如小学 6、初中 3、高中 3。
	Years int `json:"years" gorm:"default:3"`
	// PromoteMonth 学年升级月份（1-12），默认 9 月。
	PromoteMonth int `json:"promote_month" gorm:"default:9"`
	// GradeNames 年级阶梯名称，按年级序号排列，如 ["一年级","二年级",...]。
	GradeNames WorkspaceGradeNames `json:"grade_names" gorm:"type:text"`
	// AutoGraduate 超出学制年限的在读学生是否在学年结转时自动冻结为已毕业。
	AutoGraduate bool `json:"auto_graduate" gorm:"default:true"`
	SortOrder    int  `json:"sort_order"`
	Enabled      bool `json:"enabled" gorm:"default:true"`
	// 展示用，不入库
	ClassCount int                          `json:"class_count" gorm:"-"`
	StudentNum int                          `json:"student_num" gorm:"-"`
	Grades     []*WorkspaceSectionGradeStat `json:"grades" gorm:"-"`
}

// WorkspaceSectionGradeStat 学部下单个年级的在读规模。
type WorkspaceSectionGradeStat struct {
	GradeIndex int    `json:"grade_index"`
	GradeName  string `json:"grade_name"`
	ClassCount int    `json:"class_count"`
	StudentNum int    `json:"student_num"`
}

// WorkspaceDefaultSections 内置三个学部：小学部 P（6 年）、初中部 J（3 年）、高中部 S（3 年）。
func WorkspaceDefaultSections() []*WorkspaceSection {
	return []*WorkspaceSection{
		{
			Code: "P", Name: "小学部", Years: 6, PromoteMonth: 9, SortOrder: 10,
			GradeNames:   WorkspaceGradeNames{"一年级", "二年级", "三年级", "四年级", "五年级", "六年级"},
			AutoGraduate: true, Enabled: true,
		},
		{
			Code: "J", Name: "初中部", Years: 3, PromoteMonth: 9, SortOrder: 20,
			GradeNames:   WorkspaceGradeNames{"初一", "初二", "初三"},
			AutoGraduate: true, Enabled: true,
		},
		{
			Code: "S", Name: "高中部", Years: 3, PromoteMonth: 9, SortOrder: 30,
			GradeNames:   WorkspaceGradeNames{"高一", "高二", "高三"},
			AutoGraduate: true, Enabled: true,
		},
	}
}

// EnsureWorkspaceSections 首次启动时写入默认学部；已有数据不做改动。
func EnsureWorkspaceSections() error {
	var count int64
	if err := DB.Model(&WorkspaceSection{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	for _, section := range WorkspaceDefaultSections() {
		if err := DB.Create(section).Error; err != nil {
			return err
		}
	}
	return nil
}

func AllWorkspaceSections() ([]*WorkspaceSection, error) {
	var list []*WorkspaceSection
	err := DB.Order("sort_order asc, id asc").Find(&list).Error
	return list, err
}

func GetWorkspaceSectionById(id int) (*WorkspaceSection, error) {
	if id <= 0 {
		return nil, errors.New("学部不存在")
	}
	var section WorkspaceSection
	if err := DB.First(&section, id).Error; err != nil {
		return nil, err
	}
	return &section, nil
}

// WorkspaceDefaultGradeNames 按学制生成兜底年级名称。
func WorkspaceDefaultGradeNames(years int) WorkspaceGradeNames {
	names := make(WorkspaceGradeNames, 0, years)
	for i := 1; i <= years; i++ {
		names = append(names, fmt.Sprintf("%d年级", i))
	}
	return names
}

// WorkspaceSectionGradeName 返回学部下某年级序号的显示名。
func WorkspaceSectionGradeName(section *WorkspaceSection, index int) string {
	if section == nil || index <= 0 {
		return "未设置届别"
	}
	names := section.GradeNames
	if len(names) == 0 {
		names = WorkspaceDefaultGradeNames(section.Years)
	}
	if index <= len(names) {
		return names[index-1]
	}
	if section.Years > 0 && index > section.Years {
		return "已毕业"
	}
	return fmt.Sprintf("%d年级", index)
}

// WorkspaceSectionAcademicYear 按学部升级月份推算时间点所处学年。
func WorkspaceSectionAcademicYear(section *WorkspaceSection, at time.Time) int {
	month := 9
	if section != nil && section.PromoteMonth >= 1 && section.PromoteMonth <= 12 {
		month = section.PromoteMonth
	}
	if int(at.Month()) >= month {
		return at.Year()
	}
	return at.Year() - 1
}

// WorkspaceSectionGradeIndexAt 由届别与学部学制推算当前年级序号（1 起）。
// 返回 0 表示届别缺失；返回值可能大于学制年限（表示已超出毕业年级）。
func WorkspaceSectionGradeIndexAt(section *WorkspaceSection, entryYear int, at time.Time) int {
	if entryYear <= 0 || section == nil {
		return 0
	}
	return WorkspaceSectionAcademicYear(section, at) - entryYear + 1
}

// WorkspaceSectionGraduated 判断该届别学生在当前时间点是否已超出学制年限。
func WorkspaceSectionGraduated(section *WorkspaceSection, entryYear int, at time.Time) bool {
	if section == nil || section.Years <= 0 || entryYear <= 0 {
		return false
	}
	return WorkspaceSectionGradeIndexAt(section, entryYear, at) > section.Years
}

// ---------- 学年与年级 ----------

// WorkspaceAcademicYear 返回时间点所处的学年（以 9 月 1 日为学年起点）。
func WorkspaceAcademicYear(t time.Time) int {
	if t.Month() >= time.September {
		return t.Year()
	}
	return t.Year() - 1
}

// WorkspaceCurrentAcademicYear 当前学年。
func WorkspaceCurrentAcademicYear() int {
	return WorkspaceAcademicYear(time.Now())
}

// ---------- 学部总览 ----------

// WorkspaceSectionOverview 汇总各学部的班级数、在读学生数与各年级规模。
func WorkspaceSectionOverview() ([]*WorkspaceSection, error) {
	sections, err := AllWorkspaceSections()
	if err != nil {
		return nil, err
	}
	index := make(map[int]*WorkspaceSection, len(sections))
	for _, section := range sections {
		section.Grades = make([]*WorkspaceSectionGradeStat, 0, section.Years)
		for i := 1; i <= section.Years; i++ {
			section.Grades = append(section.Grades, &WorkspaceSectionGradeStat{
				GradeIndex: i,
				GradeName:  WorkspaceSectionGradeName(section, i),
			})
		}
		index[section.Id] = section
	}
	var classes []*WorkspaceClass
	if err := DB.Find(&classes).Error; err != nil {
		return nil, err
	}
	classSection := make(map[int]*WorkspaceSection, len(classes))
	classEntryYear := make(map[int]int, len(classes))
	now := time.Now()
	for _, class := range classes {
		section := index[class.SectionId]
		if section == nil {
			continue
		}
		classSection[class.Id] = section
		classEntryYear[class.Id] = class.EntryYear
		section.ClassCount++
		gradeIndex := WorkspaceSectionGradeIndexAt(section, class.EntryYear, now)
		if gradeIndex >= 1 && gradeIndex <= section.Years {
			section.Grades[gradeIndex-1].ClassCount++
		}
	}
	type studentRow struct {
		ClassId   int
		EntryYear int
	}
	var studentRows []studentRow
	if err := DB.Model(&WorkspaceStudent{}).
		Select("class_id, entry_year").
		Where("status = ?", WorkspaceStudentStatusActive).
		Where("class_id > 0").
		Scan(&studentRows).Error; err != nil {
		return nil, err
	}
	for _, s := range studentRows {
		section := classSection[s.ClassId]
		if section == nil {
			continue
		}
		section.StudentNum++
		entryYear := s.EntryYear
		if entryYear <= 0 {
			entryYear = classEntryYear[s.ClassId]
		}
		gradeIndex := WorkspaceSectionGradeIndexAt(section, entryYear, now)
		if gradeIndex >= 1 && gradeIndex <= section.Years {
			section.Grades[gradeIndex-1].StudentNum++
		}
	}
	return sections, nil
}

// ---------- 学年结转 ----------

// WorkspaceLastRolloverOptionKey 记录最近一次学年结转的学年，供管理端提示。
const WorkspaceLastRolloverOptionKey = "WorkspaceLastRolloverAcademicYear"

// WorkspaceLastRolloverAcademicYear 读取最近一次学年结转的学年（0 表示从未结转）。
func WorkspaceLastRolloverAcademicYear() int {
	year, err := strconv.Atoi(strings.TrimSpace(common.OptionMap[WorkspaceLastRolloverOptionKey]))
	if err != nil {
		return 0
	}
	return year
}

// RolloverWorkspaceSchoolYear 学年结转（幂等）：
// 超出所属学部学制年限且学部启用「毕业自动冻结」的在读学生，标记为已毕业。
// 返回被标记的人数与本次学年。
func RolloverWorkspaceSchoolYear() (int, int, error) {
	academicYear := WorkspaceCurrentAcademicYear()
	sections, err := AllWorkspaceSections()
	if err != nil {
		return 0, academicYear, err
	}
	sectionIndex := make(map[int]*WorkspaceSection, len(sections))
	for _, section := range sections {
		sectionIndex[section.Id] = section
	}
	var classes []*WorkspaceClass
	if err := DB.Find(&classes).Error; err != nil {
		return 0, academicYear, err
	}
	classSection := make(map[int]*WorkspaceSection, len(classes))
	classEntryYear := make(map[int]int, len(classes))
	for _, class := range classes {
		classSection[class.Id] = sectionIndex[class.SectionId]
		classEntryYear[class.Id] = class.EntryYear
	}
	var students []*WorkspaceStudent
	if err := DB.Where("status = ?", WorkspaceStudentStatusActive).Find(&students).Error; err != nil {
		return 0, academicYear, err
	}
	now := time.Now()
	timestamp := common.GetTimestamp()
	marked := 0
	for _, student := range students {
		section := classSection[student.ClassId]
		if section == nil || !section.AutoGraduate {
			continue
		}
		entryYear := student.EntryYear
		if entryYear <= 0 {
			entryYear = classEntryYear[student.ClassId]
		}
		if !WorkspaceSectionGraduated(section, entryYear, now) {
			continue
		}
		// 毕业即停用登录账号并记录毕业时间，毕业满 1 年后由定时任务注销账号。
		if err := MarkWorkspaceStudentGraduated(student.Id, student.UserId, timestamp); err != nil {
			return marked, academicYear, err
		}
		marked++
	}
	if err := UpdateOption(WorkspaceLastRolloverOptionKey, strconv.Itoa(academicYear)); err != nil {
		return marked, academicYear, err
	}
	return marked, academicYear, nil
}

// ---------- 用户名分配 ----------

// allocateWorkspaceUsername 在事务内分配一个未被占用的账号：prefix + 5 位顺位编号。
// 顺位计数按（prefixKey, entryYear）隔离，范围 1..99999。
func allocateWorkspaceUsername(prefixKey string, entryYear int, prefix string) (string, error) {
	var allocated string
	err := DB.Transaction(func(tx *gorm.DB) error {
		seq := &WorkspaceUsernameSequence{}
		err := tx.Where("prefix_key = ? and entry_year = ?", prefixKey, entryYear).First(seq).Error
		if err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			seq = &WorkspaceUsernameSequence{PrefixKey: prefixKey, EntryYear: entryYear, NextSeq: 1}
			if err := tx.Create(seq).Error; err != nil {
				return err
			}
		}
		next := seq.NextSeq
		if next < 1 {
			next = 1
		}
		for ; next <= 99999; next++ {
			candidate := fmt.Sprintf("%s%05d", prefix, next)
			exist, existErr := CheckUserExistOrDeleted(candidate, "")
			if existErr != nil {
				return existErr
			}
			if exist {
				continue
			}
			if err := tx.Model(&WorkspaceUsernameSequence{}).
				Where("id = ?", seq.Id).
				Update("next_seq", next+1).Error; err != nil {
				return err
			}
			allocated = candidate
			return nil
		}
		return errors.Errorf("%s 开头的账号编号已用尽（超过 99999）", prefix)
	})
	if err != nil {
		return "", err
	}
	return allocated, nil
}

// AllocateWorkspaceUsername 按「学部代码 + 届别(2位) + 顺位编号(5位)」分配学生用户名。
// 例：小学部、2026 届 → P2600001。
func AllocateWorkspaceUsername(sectionCode string, entryYear int) (string, error) {
	code := strings.TrimSpace(strings.ToUpper(sectionCode))
	if code == "" {
		return "", errors.New("学部代码为空，无法生成学生账号")
	}
	if entryYear < 1000 || entryYear > 9999 {
		return "", errors.New("届别必须是 4 位年份")
	}
	prefix := fmt.Sprintf("%s%02d", code, entryYear%100)
	return allocateWorkspaceUsername(code, entryYear, prefix)
}

// AllocateWorkspaceTeacherUsername 分配教师用户名：固定前缀 T00 + 顺位编号(5位)。
// 例：T0000001。
func AllocateWorkspaceTeacherUsername() (string, error) {
	return allocateWorkspaceUsername("T", 0, "T00")
}
