package controller

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// defaultWorkspaceTeacherPassword 返回新建教师的默认密码 Teacher@<当前年份>。
func defaultWorkspaceTeacherPassword() string {
	return fmt.Sprintf("Teacher@%d", time.Now().Year())
}

// AI Workspace 教学组织管理：学部（Section）、年级（按届别自动换算）与教师账号。

// ---------- 学部 ----------

func GetWorkspaceSections(c *gin.Context) {
	sections, err := model.AllWorkspaceSections()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, sections)
}

type workspaceSectionRequest struct {
	Id           int      `json:"id"`
	Code         string   `json:"code"`
	Name         string   `json:"name"`
	Years        int      `json:"years"`
	PromoteMonth int      `json:"promote_month"`
	GradeNames   []string `json:"grade_names"`
	AutoGraduate *bool    `json:"auto_graduate"`
	SortOrder    int      `json:"sort_order"`
	Enabled      *bool    `json:"enabled"`
}

// normalizeWorkspaceGradeNames 校验年级阶梯名称数量与学制年限一致，缺省按序号补齐。
func normalizeWorkspaceGradeNames(names []string, years int) model.WorkspaceGradeNames {
	result := make(model.WorkspaceGradeNames, 0, years)
	for i := 0; i < years; i++ {
		name := ""
		if i < len(names) {
			name = strings.TrimSpace(names[i])
		}
		if name == "" {
			name = fmt.Sprintf("%d年级", i+1)
		}
		result = append(result, name)
	}
	return result
}

func CreateWorkspaceSection(c *gin.Context) {
	var req workspaceSectionRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		common.ApiError(c, common.NewMessage("学部代码不能为空（用于生成学生账号前缀）"))
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		common.ApiError(c, common.NewMessage("学部名称不能为空"))
		return
	}
	years := req.Years
	if years <= 0 || years > 12 {
		common.ApiError(c, common.NewMessage("学制年限需在 1-12 之间"))
		return
	}
	promoteMonth := req.PromoteMonth
	if promoteMonth <= 0 || promoteMonth > 12 {
		promoteMonth = 9
	}
	section := &model.WorkspaceSection{
		Code:         code,
		Name:         name,
		Years:        years,
		PromoteMonth: promoteMonth,
		GradeNames:   normalizeWorkspaceGradeNames(req.GradeNames, years),
		AutoGraduate: true,
		SortOrder:    req.SortOrder,
		Enabled:      true,
	}
	if req.AutoGraduate != nil {
		section.AutoGraduate = *req.AutoGraduate
	}
	if req.Enabled != nil {
		section.Enabled = *req.Enabled
	}
	if err := model.DB.Create(section).Error; err != nil {
		common.ApiError(c, common.NewMessage("学部创建失败，代码可能已存在"))
		return
	}
	common.ApiSuccess(c, section)
}

func UpdateWorkspaceSection(c *gin.Context) {
	var req workspaceSectionRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	section, err := model.GetWorkspaceSectionById(req.Id)
	if err != nil {
		common.ApiError(c, common.NewMessage("学部不存在"))
		return
	}
	if code := strings.ToUpper(strings.TrimSpace(req.Code)); code != "" {
		section.Code = code
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		section.Name = name
	}
	if req.Years > 0 && req.Years <= 12 {
		section.Years = req.Years
	}
	if req.PromoteMonth > 0 && req.PromoteMonth <= 12 {
		section.PromoteMonth = req.PromoteMonth
	}
	section.GradeNames = normalizeWorkspaceGradeNames(req.GradeNames, section.Years)
	if req.AutoGraduate != nil {
		section.AutoGraduate = *req.AutoGraduate
	}
	section.SortOrder = req.SortOrder
	if req.Enabled != nil {
		section.Enabled = *req.Enabled
	}
	if err := model.DB.Model(section).
		Select("code", "name", "years", "promote_month", "grade_names", "auto_graduate", "sort_order", "enabled").
		Updates(section).Error; err != nil {
		common.ApiError(c, common.NewMessage("学部更新失败，代码可能已存在"))
		return
	}
	common.ApiSuccess(c, section)
}

func DeleteWorkspaceSection(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiError(c, common.NewMessage("学部 ID 不能为空"))
		return
	}
	var classCount int64
	_ = model.DB.Model(&model.WorkspaceClass{}).Where("section_id = ?", id).Count(&classCount)
	if classCount > 0 {
		common.ApiError(c, common.NewMessage("该学部下仍有班级，请先调整班级归属"))
		return
	}
	if err := model.DB.Delete(&model.WorkspaceSection{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// workspaceGradeOption 由学部与学制推导出的年级选择项（学年变化后自动跟随）。
type workspaceGradeOption struct {
	SectionId   int    `json:"section_id"`
	SectionName string `json:"section_name"`
	SectionCode string `json:"section_code"`
	GradeIndex  int    `json:"grade_index"`
	GradeName   string `json:"grade_name"`
}

// GetWorkspaceSectionGrades 返回全部启用学部的年级阶梯，供筛选与展示使用。
func GetWorkspaceSectionGrades(c *gin.Context) {
	sections, err := model.AllWorkspaceSections()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]*workspaceGradeOption, 0, 40)
	for _, section := range sections {
		if !section.Enabled {
			continue
		}
		for i := 1; i <= section.Years; i++ {
			items = append(items, &workspaceGradeOption{
				SectionId:   section.Id,
				SectionName: section.Name,
				SectionCode: section.Code,
				GradeIndex:  i,
				GradeName:   model.WorkspaceSectionGradeName(section, i),
			})
		}
	}
	common.ApiSuccess(c, items)
}

// ---------- 学部总览 ----------

func GetWorkspaceSectionOverview(c *gin.Context) {
	sections, err := model.WorkspaceSectionOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"academic_year":               model.WorkspaceCurrentAcademicYear(),
		"last_rollover_academic_year": model.WorkspaceLastRolloverAcademicYear(),
		"items":                       sections,
	})
}

// GetWorkspaceStatsOverview 统计概览：各学部的班级数、在读学生数、正课小班数、
// 社团数与社团参与率（参与学生 / 在读学生），并按年级拆出同样指标，
// 供首页汇总卡片使用。
func GetWorkspaceStatsOverview(c *gin.Context) {
	sections, err := model.WorkspaceSectionOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	classes, err := model.GetAllWorkspaceClasses()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	smalls, err := model.GetAllWorkspaceSmallClasses(0, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	students, err := model.GetWorkspaceStudentsFiltered(0, model.WorkspaceStudentStatusActive)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sectionIndex := make(map[int]*model.WorkspaceSection, len(sections))
	for _, section := range sections {
		sectionIndex[section.Id] = section
	}
	classSection := make(map[int]int, len(classes))
	classEntryYear := make(map[int]int, len(classes))
	for _, class := range classes {
		classSection[class.Id] = class.SectionId
		classEntryYear[class.Id] = class.EntryYear
	}
	// 正课小班按所属行政班归到学部与年级；社团按自身学部计数。
	regularCount := make(map[int]int)
	regularGradeCount := make(map[int]map[int]int)
	clubCount := make(map[int]int)
	clubSmallIds := make(map[int]bool)
	for _, small := range smalls {
		if normalizeWorkspaceSmallClassType(small.Type) == model.WorkspaceSmallClassTypeClub {
			clubCount[small.SectionId]++
			clubSmallIds[small.Id] = true
			continue
		}
		if len(small.ParentClassIds) == 0 {
			continue
		}
		parentId := small.ParentClassIds[0]
		sectionId := classSection[parentId]
		if sectionId <= 0 {
			continue
		}
		regularCount[sectionId]++
		gradeIndex := model.WorkspaceSectionGradeIndexAt(sectionIndex[sectionId], classEntryYear[parentId], time.Now())
		if gradeIndex < 1 {
			continue
		}
		if regularGradeCount[sectionId] == nil {
			regularGradeCount[sectionId] = make(map[int]int)
		}
		regularGradeCount[sectionId][gradeIndex]++
	}
	// 社团参与：在读学生入了任一社团即计入其所在学部/年级的参与人数（按人去重）。
	clubStudents := make(map[int]int)
	clubGradeStudents := make(map[int]map[int]int)
	for _, student := range students {
		sectionId := classSection[student.ClassId]
		if sectionId <= 0 {
			continue
		}
		joined := false
		for _, smallId := range student.SmallClassIds {
			if clubSmallIds[smallId] {
				joined = true
				break
			}
		}
		if !joined {
			continue
		}
		clubStudents[sectionId]++
		section := sectionIndex[sectionId]
		entryYear := student.EntryYear
		if entryYear <= 0 {
			entryYear = classEntryYear[student.ClassId]
		}
		gradeIndex := model.WorkspaceSectionGradeIndexAt(section, entryYear, time.Now())
		if gradeIndex < 1 || gradeIndex > section.Years {
			continue
		}
		if clubGradeStudents[sectionId] == nil {
			clubGradeStudents[sectionId] = make(map[int]int)
		}
		clubGradeStudents[sectionId][gradeIndex]++
	}
	rateOf := func(joined, total int) float64 {
		if total <= 0 {
			return 0
		}
		return float64(joined) / float64(total)
	}
	items := make([]gin.H, 0, len(sections))
	for _, section := range sections {
		grades := make([]gin.H, 0, len(section.Grades))
		for _, grade := range section.Grades {
			grades = append(grades, gin.H{
				"grade_index":         grade.GradeIndex,
				"grade_name":          grade.GradeName,
				"class_count":         grade.ClassCount,
				"student_num":         grade.StudentNum,
				"regular_small_count": regularGradeCount[section.Id][grade.GradeIndex],
				"club_student_count":  clubGradeStudents[section.Id][grade.GradeIndex],
				"club_rate":           rateOf(clubGradeStudents[section.Id][grade.GradeIndex], grade.StudentNum),
			})
		}
		items = append(items, gin.H{
			"id":                  section.Id,
			"code":                section.Code,
			"name":                section.Name,
			"years":               section.Years,
			"class_count":         section.ClassCount,
			"student_num":         section.StudentNum,
			"regular_small_count": regularCount[section.Id],
			"club_count":          clubCount[section.Id],
			"club_student_count":  clubStudents[section.Id],
			"club_rate":           rateOf(clubStudents[section.Id], section.StudentNum),
			"grades":              grades,
		})
	}
	common.ApiSuccess(c, gin.H{
		"academic_year":               model.WorkspaceCurrentAcademicYear(),
		"last_rollover_academic_year": model.WorkspaceLastRolloverAcademicYear(),
		"items":                       items,
	})
}

// RolloverWorkspaceSchoolYear 学年结转：超出学部学制年限的在读学生自动冻结为「已毕业」（幂等）。
func RolloverWorkspaceSchoolYear(c *gin.Context) {
	marked, academicYear, err := model.RolloverWorkspaceSchoolYear()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"academic_year": academicYear,
		"graduated":     marked,
	})
}

// ---------- 教师账号 ----------

type workspaceTeacherItem struct {
	UserId      int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        int    `json:"role"`
	Status      int    `json:"status"`
}

// GetWorkspaceTeachers 返回全部教师账号。
func GetWorkspaceTeachers(c *gin.Context) {
	users, err := model.ListWorkspaceTeacherUsers()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]*workspaceTeacherItem, 0, len(users))
	for _, user := range users {
		items = append(items, &workspaceTeacherItem{
			UserId:      user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Role:        user.Role,
			Status:      user.Status,
		})
	}
	common.ApiSuccess(c, items)
}

// CreateWorkspaceTeacher 新建教师账号，登录名留空时自动分配（T0000001 形式），
// 默认密码为 Teacher@<当前年份>。
func CreateWorkspaceTeacher(c *gin.Context) {
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	username := strings.TrimSpace(req.Username)
	if username != "" {
		exist, err := model.CheckUserExistOrDeleted(username, "")
		if err != nil {
			common.ApiError(c, common.NewMessage("账号校验失败"))
			return
		}
		if exist {
			common.ApiError(c, common.NewMessage("账号已存在"))
			return
		}
	} else {
		allocated, err := model.AllocateWorkspaceTeacherUsername()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		username = allocated
	}
	password := strings.TrimSpace(req.Password)
	if password == "" {
		password = defaultWorkspaceTeacherPassword()
	}
	if len(password) < 6 {
		common.ApiError(c, common.NewMessage("密码长度不能少于 6 位"))
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = username
	}
	user := &model.User{
		Username:    username,
		Password:    password,
		DisplayName: displayName,
		Role:        common.RoleAdminUser,
	}
	if err := user.Insert(0); err != nil {
		common.ApiError(c, common.NewMessage("创建教师账号失败"))
		return
	}
	common.ApiSuccess(c, gin.H{
		"user_id":      user.Id,
		"username":     username,
		"display_name": displayName,
		"password":     password,
	})
}

// ---------- 转班 / 转年级 ----------

func TransferWorkspaceStudent(c *gin.Context) {
	var req struct {
		StudentId int    `json:"student_id"`
		ToClassId int    `json:"to_class_id"`
		Reason    string `json:"reason"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.StudentId <= 0 {
		common.ApiError(c, common.NewMessage("请选择学生"))
		return
	}
	if _, err := model.GetWorkspaceStudentById(req.StudentId); err != nil {
		common.ApiError(c, common.NewMessage("学生记录不存在"))
		return
	}
	if req.ToClassId > 0 {
		if _, err := model.GetWorkspaceClassById(req.ToClassId); err != nil {
			common.ApiError(c, common.NewMessage("目标班级不存在"))
			return
		}
	}
	if err := model.TransferWorkspaceStudent(req.StudentId, req.ToClassId, strings.TrimSpace(req.Reason), c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// BatchTransferWorkspaceStudents 批量把学生转入目标行政班（转班 / 升学）。
// 正课小班随行政班走：目标班不存在该小班时自动移出归属（社团跨年级组建、
// 与行政班无关，保持不变）。返回转入、跳过、清理的小班归属数与失败明细。
func BatchTransferWorkspaceStudents(c *gin.Context) {
	var req struct {
		StudentIds []int  `json:"student_ids"`
		ToClassId  int    `json:"to_class_id"`
		Reason     string `json:"reason"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	requested := make(map[int]bool, len(req.StudentIds))
	orderedIds := make([]int, 0, len(req.StudentIds))
	for _, studentId := range req.StudentIds {
		if studentId <= 0 || requested[studentId] {
			continue
		}
		requested[studentId] = true
		orderedIds = append(orderedIds, studentId)
	}
	if len(orderedIds) == 0 {
		common.ApiError(c, common.NewMessage("请选择学生"))
		return
	}
	if req.ToClassId <= 0 {
		common.ApiError(c, common.NewMessage("请选择目标班级"))
		return
	}
	if _, err := model.GetWorkspaceClassById(req.ToClassId); err != nil {
		common.ApiError(c, common.NewMessage("目标班级不存在"))
		return
	}
	// 小班全量缓存：判定正课/社团与所属行政班，并按成员表反查每个学生的小班归属。
	allSmalls, err := model.GetAllWorkspaceSmallClasses(0, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	smallById := make(map[int]*model.WorkspaceSmallClass, len(allSmalls))
	membership := make(map[int][]int, len(orderedIds))
	for _, small := range allSmalls {
		smallById[small.Id] = small
		memberIds, err := model.GetWorkspaceSmallClassMemberIds(small.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, studentId := range memberIds {
			if requested[studentId] {
				membership[studentId] = append(membership[studentId], small.Id)
			}
		}
	}
	reason := strings.TrimSpace(req.Reason)
	operatorId := c.GetInt("id")
	transferred := 0
	cleaned := 0
	skipped := 0
	failures := make([]gin.H, 0)
	for _, studentId := range orderedIds {
		student, err := model.GetWorkspaceStudentById(studentId)
		if err != nil {
			failures = append(failures, gin.H{"student_id": studentId, "reason": "学生记录不存在"})
			continue
		}
		if student.ClassId == req.ToClassId {
			skipped++
			continue
		}
		if err := model.TransferWorkspaceStudent(studentId, req.ToClassId, reason, operatorId); err != nil {
			failures = append(failures, gin.H{"student_id": studentId, "reason": err.Error()})
			continue
		}
		transferred++
		// 清理原班正课小班归属：目标班不挂该小班则移出，避免错班上课。
		for _, smallId := range membership[studentId] {
			small := smallById[smallId]
			if small == nil || normalizeWorkspaceSmallClassType(small.Type) != model.WorkspaceSmallClassTypeRegular {
				continue
			}
			if slices.Contains(small.ParentClassIds, req.ToClassId) {
				continue
			}
			removed, err := model.RemoveWorkspaceSmallClassMembers(smallId, []int{studentId})
			if err != nil {
				failures = append(failures, gin.H{
					"student_id": studentId,
					"reason":     "清理原班小班「" + small.Name + "」失败：" + err.Error(),
				})
				continue
			}
			cleaned += removed
		}
	}
	common.ApiSuccess(c, gin.H{
		"transferred": transferred,
		"skipped":     skipped,
		"cleaned":     cleaned,
		"failures":    failures,
	})
}
