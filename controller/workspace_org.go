package controller

import (
	"fmt"
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
