package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
)

// ---------- 上课小班（授课分班）管理 ----------
// 小班与行政大班（原班级）相互独立：小班从行政大班拆分学生、绑定授课教师、
// 标记正课/选修，并提供 AI 权限总开关。

type workspaceSmallClassRequest struct {
	Id   int    `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
	// ParentClassIds 所属行政大班 id 列表（多选）。
	ParentClassIds []int `json:"parent_class_ids"`
	// TeacherIds 授课教师用户 id 列表（多选）。
	TeacherIds []int  `json:"teacher_ids"`
	Type       string `json:"type"`
	// SectionId 社团归属学部 id（小学部/初中部/高中部），仅社团类型使用。
	SectionId int   `json:"section_id"`
	Enabled   *bool `json:"enabled"`
	AiEnabled *bool `json:"ai_enabled"`
	// HtmlEnabled HTML 实验室开关（默认关闭）。
	HtmlEnabled *bool `json:"html_enabled"`
	// SlideEnabled 演示实验室开关（默认关闭）。
	SlideEnabled *bool `json:"slide_enabled"`
}

// normalizeWorkspaceIdList 清洗 id 列表：去空、去重、保序。
func normalizeWorkspaceIdList(ids []int) model.WorkspaceIdList {
	result := make(model.WorkspaceIdList, 0, len(ids))
	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

// validateWorkspaceTeacherIds 校验授课教师 id 列表：仅教师及以上角色（role >= 教师）
// 可被绑定，学生等非教师账号一律拒绝，防止前端绕过或传脏数据。
func validateWorkspaceTeacherIds(ids model.WorkspaceIdList) error {
	if len(ids) == 0 {
		return nil
	}
	teachers, err := model.ListWorkspaceTeacherUsers()
	if err != nil {
		return err
	}
	valid := make(map[int]bool, len(teachers))
	for _, teacher := range teachers {
		valid[teacher.Id] = true
	}
	for _, id := range ids {
		if !valid[id] {
			return fmt.Errorf("用户 ID %d 不是教师账号，仅教师及以上角色可被设为授课教师", id)
		}
	}
	return nil
}

// GetWorkspaceSmallClasses 返回小班列表，可按行政大班 / 授课教师筛选；
// mine=1 时只返回当前登录教师授课的小班（教师端自助维护名单入口）。
func GetWorkspaceSmallClasses(c *gin.Context) {
	parentClassId, _ := strconv.Atoi(c.Query("parent_class_id"))
	teacherId, _ := strconv.Atoi(c.Query("teacher_id"))
	if c.Query("mine") == "1" || strings.EqualFold(c.Query("mine"), "true") {
		teacherId = c.GetInt("id")
	}
	list, err := model.GetAllWorkspaceSmallClasses(parentClassId, teacherId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, list)
}

func normalizeWorkspaceSmallClassType(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), string(model.WorkspaceSmallClassTypeClub)) ||
		strings.Contains(value, "选修") || strings.Contains(value, "社团") {
		return model.WorkspaceSmallClassTypeClub
	}
	return model.WorkspaceSmallClassTypeRegular
}

// validateWorkspaceSmallClassScope 按小班类型校验归属范围（正课/社团分班规则）：
//   - 正课：仅允许在同年级、同一个行政大班内部拆分，恰好选 1 个行政班，
//     禁止把不同行政大班下的同名小班合并成一个。
//   - 社团：归属学部（小学部/初中部/高中部），支持跨年级，不挂行政班。
func validateWorkspaceSmallClassScope(classType string, parentIds model.WorkspaceIdList, sectionId int) error {
	if classType == model.WorkspaceSmallClassTypeClub {
		if sectionId <= 0 {
			return fmt.Errorf("社团小班必须选择归属学部（小学部/初中部/高中部）")
		}
		section, err := model.GetWorkspaceSectionById(sectionId)
		if err != nil || section == nil {
			return fmt.Errorf("所选学部不存在，请重新选择")
		}
		return nil
	}
	// 正课：仅允许在同一个行政大班内部拆分（单选），禁止把不同行政大班合并成一个小班。
	if len(parentIds) != 1 || parentIds[0] <= 0 {
		return fmt.Errorf("正课小班必须且只能选择 1 个所属行政大班，仅允许在该行政大班内部拆分，不允许跨行政大班合并")
	}
	return nil
}

func CreateWorkspaceSmallClass(c *gin.Context) {
	var req workspaceSmallClassRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		common.ApiErrorMsg(c, "小班名称不能为空")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code != "" {
		if exists, err := model.WorkspaceSmallClassCodeExists(code, 0); err == nil && exists {
			common.ApiErrorMsg(c, "小班编码「"+code+"」已被占用，请更换")
			return
		}
	}
	item := &model.WorkspaceSmallClass{
		Name:           name,
		Code:           code,
		ParentClassIds: normalizeWorkspaceIdList(req.ParentClassIds),
		TeacherIds:     normalizeWorkspaceIdList(req.TeacherIds),
		Type:           normalizeWorkspaceSmallClassType(req.Type),
		Enabled:        true,
		AiEnabled:      true,
		HtmlEnabled:    false,
		SlideEnabled:   false,
	}
	if item.Type == model.WorkspaceSmallClassTypeClub {
		item.SectionId = req.SectionId
	}
	if err := validateWorkspaceTeacherIds(item.TeacherIds); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := validateWorkspaceSmallClassScope(item.Type, item.ParentClassIds, item.SectionId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	if req.AiEnabled != nil {
		item.AiEnabled = *req.AiEnabled
	}
	if req.HtmlEnabled != nil {
		item.HtmlEnabled = *req.HtmlEnabled
	}
	if req.SlideEnabled != nil {
		item.SlideEnabled = *req.SlideEnabled
	}
	if err := item.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	// 未填写编码时按自增序号自动生成，保证每个小班有唯一编码（A3）。
	if item.Code == "" {
		item.Code = "S" + strconv.Itoa(1000+item.Id)
		if err := item.Update(); err != nil {
			common.SysError(common.LogText("auto small class code failed: id=%d err=%s", item.Id, err.Error()))
		}
	}
	common.ApiSuccess(c, item)
}

func UpdateWorkspaceSmallClass(c *gin.Context) {
	var req workspaceSmallClassRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	item, err := model.GetWorkspaceSmallClassById(req.Id)
	if err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		item.Name = name
	}
	if code := strings.TrimSpace(req.Code); code != "" && code != item.Code {
		if exists, cErr := model.WorkspaceSmallClassCodeExists(code, item.Id); cErr == nil && exists {
			common.ApiErrorMsg(c, "小班编码「"+code+"」已被占用，请更换")
			return
		}
		item.Code = code
	}
	item.ParentClassIds = normalizeWorkspaceIdList(req.ParentClassIds)
	item.TeacherIds = normalizeWorkspaceIdList(req.TeacherIds)
	item.Type = normalizeWorkspaceSmallClassType(req.Type)
	if item.Type == model.WorkspaceSmallClassTypeClub {
		item.SectionId = req.SectionId
	} else {
		item.SectionId = 0
	}
	if err := validateWorkspaceTeacherIds(item.TeacherIds); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := validateWorkspaceSmallClassScope(item.Type, item.ParentClassIds, item.SectionId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	if req.AiEnabled != nil {
		item.AiEnabled = *req.AiEnabled
	}
	if req.HtmlEnabled != nil {
		item.HtmlEnabled = *req.HtmlEnabled
	}
	if req.SlideEnabled != nil {
		item.SlideEnabled = *req.SlideEnabled
	}
	if err := item.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func DeleteWorkspaceSmallClass(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	if err := model.DeleteWorkspaceSmallClass(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// SetWorkspaceSmallClassAIEnabled 一键开启/关闭小班全部 AI 生成权限（B1）。
// 同一接口也支持切换 html_enabled / slide_enabled（HTML / 演示实验室开关，三选一传入）。
func SetWorkspaceSmallClassAIEnabled(c *gin.Context) {
	var req struct {
		Id           int   `json:"id"`
		AiEnabled    *bool `json:"ai_enabled"`
		HtmlEnabled  *bool `json:"html_enabled"`
		SlideEnabled *bool `json:"slide_enabled"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	if req.AiEnabled == nil && req.HtmlEnabled == nil && req.SlideEnabled == nil {
		common.ApiErrorMsg(c, "ai_enabled、html_enabled 或 slide_enabled 不能为空")
		return
	}
	if _, err := model.GetWorkspaceSmallClassById(req.Id); err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	if req.AiEnabled != nil {
		if err := model.SetWorkspaceSmallClassAI(req.Id, *req.AiEnabled); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.HtmlEnabled != nil {
		if err := model.SetWorkspaceSmallClassHtml(req.Id, *req.HtmlEnabled); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.SlideEnabled != nil {
		if err := model.SetWorkspaceSmallClassSlide(req.Id, *req.SlideEnabled); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	item, _ := model.GetWorkspaceSmallClassById(req.Id)
	common.ApiSuccess(c, item)
}

// ---------- 小班成员 ----------

// GetWorkspaceSmallClassMembers 返回小班全部成员学生。
func GetWorkspaceSmallClassMembers(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	students, err := model.GetWorkspaceSmallClassMembers(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, students)
}

// AddWorkspaceSmallClassMembers 批量把学生加入小班（学生↔小班多对多）。
func AddWorkspaceSmallClassMembers(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	var req struct {
		StudentIds []int `json:"student_ids"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(req.StudentIds) == 0 {
		common.ApiErrorMsg(c, "请选择要加入小班的学生")
		return
	}
	if _, err := model.GetWorkspaceSmallClassById(id); err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	added, err := model.AddWorkspaceSmallClassMembers(id, req.StudentIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"added": added})
}

// RemoveWorkspaceSmallClassMember 把学生移出小班（灵活调班）。
func RemoveWorkspaceSmallClassMember(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	studentId, _ := strconv.Atoi(c.Param("student_id"))
	if id <= 0 || studentId <= 0 {
		common.ApiErrorMsg(c, "参数不完整")
		return
	}
	if err := model.RemoveWorkspaceSmallClassMember(id, studentId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// RemoveWorkspaceSmallClassMembers 批量把学生移出小班，免去成员管理里逐个点击。
func RemoveWorkspaceSmallClassMembers(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	var req struct {
		StudentIds []int `json:"student_ids"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(req.StudentIds) == 0 {
		common.ApiErrorMsg(c, "请选择要移出小班的学生")
		return
	}
	if _, err := model.GetWorkspaceSmallClassById(id); err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	removed, err := model.RemoveWorkspaceSmallClassMembers(id, req.StudentIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"removed": removed})
}

// CleanupWorkspaceGraduatedSmallClassMembers 社团按届清退：移出已超出学部
// 学制年限（毕业届）或学籍非在读的成员，返回实际移出人数与检查人数。
// 届别缺失的学生无法推算毕业届，保留在名单内由教师手动处理。
func CleanupWorkspaceGraduatedSmallClassMembers(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	item, err := model.GetWorkspaceSmallClassById(id)
	if err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	if normalizeWorkspaceSmallClassType(item.Type) != model.WorkspaceSmallClassTypeClub {
		common.ApiErrorMsg(c, "仅社团小班支持按届清退毕业成员")
		return
	}
	section, err := model.GetWorkspaceSectionById(item.SectionId)
	if err != nil {
		common.ApiErrorMsg(c, "社团未绑定学部，无法推算毕业届")
		return
	}
	members, err := model.GetWorkspaceSmallClassMembers(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	now := time.Now()
	graduated := make([]int, 0, len(members))
	for _, member := range members {
		if member.Status != model.WorkspaceStudentStatusActive {
			graduated = append(graduated, member.Id)
			continue
		}
		if member.EntryYear > 0 && model.WorkspaceSectionGraduated(section, member.EntryYear, now) {
			graduated = append(graduated, member.Id)
		}
	}
	removed, err := model.RemoveWorkspaceSmallClassMembers(id, graduated)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"removed": removed, "checked": len(members)})
}

// ExportWorkspaceSmallClassAccounts 导出小班学生账户信息 Excel（账号、登录名、点数、状态）。
// 供教师下载后发给学生核对自己的账户；与成员管理同一份数据源，保证一致。
func ExportWorkspaceSmallClassAccounts(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	item, err := model.GetWorkspaceSmallClassById(id)
	if err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	students, err := model.GetWorkspaceSmallClassMembers(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	file := excelize.NewFile()
	const sheet = "账户信息"
	defer func() { _ = file.Close() }()
	if idx, err := file.NewSheet(sheet); err == nil {
		file.SetActiveSheet(idx)
	}
	// 删除默认 Sheet，避免打开时出现空表。
	if defIdx, err := file.GetSheetIndex("Sheet1"); err == nil && defIdx >= 0 {
		_ = file.DeleteSheet("Sheet1")
	}
	header := []string{"学号", "账户名", "姓名拼音", "姓名", "所属班级", "年级", "剩余点数", "已用点数", "登录密码", "状态"}
	if err := writeWorkspaceExcelRow(file, sheet, 1, header); err != nil {
		common.ApiError(c, err)
		return
	}

	statusLabel := func(student *model.WorkspaceStudent) string {
		if !student.Enabled {
			return "已停用"
		}
		switch student.Status {
		case model.WorkspaceStudentStatusGraduated:
			return "已毕业"
		case model.WorkspaceStudentStatusDeactivated:
			return "已注销"
		default:
			return "在读"
		}
	}
	passwordLabel := func(student *model.WorkspaceStudent) string {
		if student.PasswordSet {
			return "已设置密码"
		}
		return "免密登录"
	}

	for i, student := range students {
		values := []string{
			student.StudentNo,
			student.Username,
			student.PinyinUsername,
			student.DisplayName,
			student.ClassName,
			student.GradeName,
			strconv.Itoa(student.Quota),
			strconv.Itoa(student.UsedQuota),
			passwordLabel(student),
			statusLabel(student),
		}
		if err := writeWorkspaceExcelRow(file, sheet, i+2, values); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	buf, err := file.WriteToBuffer()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	safeName := strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		default:
			return r
		}
	}, item.Name)
	if safeName == "" {
		safeName = "small-class"
	}
	filename := fmt.Sprintf("%s-账户信息.xlsx", safeName)
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.QueryEscape(filename))
	c.Data(http.StatusOK,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		buf.Bytes())
}

// ImportWorkspaceSmallClassParentStudents 把小班所属行政班的在读学生一键拉入小班。
// 免去教师为每个小班重复上传学生名单：建好小班后点一次即可完成整班入班。
func ImportWorkspaceSmallClassParentStudents(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	item, err := model.GetWorkspaceSmallClassById(id)
	if err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	if len(item.ParentClassIds) == 0 {
		common.ApiErrorMsg(c, "该小班未绑定行政班，请先在编辑小班里选择所属行政班")
		return
	}
	students, err := model.GetWorkspaceStudentsByClassIds(item.ParentClassIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ids := make([]int, 0, len(students))
	for _, student := range students {
		ids = append(ids, student.Id)
	}
	added, err := model.AddWorkspaceSmallClassMembers(id, ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"added": added, "total": len(ids)})
}

// ---------- 小班学生导入：姓名 + 届次 + 年级模糊匹配（A4/A5） ----------
//
// 导入 Excel 后按「姓名 + 届次 + 年级」对现有学生做模糊匹配：
//   - 唯一命中 → 直接返回为已匹配；
//   - 未命中 / 多条候选 → 返回未匹配清单（含候选学生），由教师在弹窗中手动配对。
//
// 匹配结果确认后，前端调用 POST /small-classes/:id/members 完成入班。

const wsSmallClassImportSheet = "学生"

// DownloadWorkspaceSmallClassImportTemplate 下载导入模板。
// 与行政大班共用同一份四工作表合并模板（班级/学生/小班/小班学生），保证全校只用一个文件。
func DownloadWorkspaceSmallClassImportTemplate(c *gin.Context) {
	DownloadWorkspaceClassTemplate(c)
}

// DownloadWorkspaceClubImportTemplate 下载社团专用导入模板（独立于正课表格）。
// 社团跨年级组建，表格只需「社团名称 / 姓名 / 届」三列。
func DownloadWorkspaceClubImportTemplate(c *gin.Context) {
	file := excelize.NewFile()
	defer func() { _ = file.Close() }()
	sheet := "社团学生"
	_ = file.SetSheetName("Sheet1", sheet)
	headers := []string{"社团名称", "姓名", "届（如2024）"}
	for col, header := range headers {
		cell, _ := excelize.CoordinatesToCellName(col+1, 1)
		_ = file.SetCellValue(sheet, cell, header)
	}
	// 示例行帮助教师理解填法。
	samples := [][]string{
		{"机器人社", "张三", "2026"},
		{"合唱团", "李四", "2025"},
	}
	for i, row := range samples {
		for col, value := range row {
			cell, _ := excelize.CoordinatesToCellName(col+1, i+2)
			_ = file.SetCellValue(sheet, cell, value)
		}
	}
	_ = file.SetColWidth(sheet, "A", "C", 18)
	buf, err := file.WriteToBuffer()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.QueryEscape("社团学生导入模板.xlsx"))
	c.Data(http.StatusOK,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		buf.Bytes())
}

type wsSmallClassMatchedRow struct {
	Row         string `json:"row"`
	StudentId   int    `json:"student_id"`
	UserId      int    `json:"user_id"`
	DisplayName string `json:"display_name"`
	StudentNo   string `json:"student_no"`
	ClassName   string `json:"class_name"`
	GradeName   string `json:"grade_name"`
}

type wsSmallClassCandidate struct {
	StudentId   int    `json:"student_id"`
	UserId      int    `json:"user_id"`
	DisplayName string `json:"display_name"`
	StudentNo   string `json:"student_no"`
	ClassName   string `json:"class_name"`
	GradeName   string `json:"grade_name"`
	EntryYear   int    `json:"entry_year"`
}

type wsSmallClassUnmatchedRow struct {
	Row         string                  `json:"row"`
	DisplayName string                  `json:"display_name"`
	EntryYear   int                     `json:"entry_year"`
	GradeRef    string                  `json:"grade_ref"`
	Candidates  []wsSmallClassCandidate `json:"candidates"`
	Reason      string                  `json:"reason"`
}

// wsSmallClassImportRow 小班导入表格的一行（姓名 + 届次 + 年级）。
type wsSmallClassImportRow struct {
	Row         string
	SmallName   string
	DisplayName string
	EntryYear   int
	GradeRef    string
}

// ImportWorkspaceSmallClassStudents 解析上传 Excel，按 姓名+届次+年级 模糊匹配现有学生。
func ImportWorkspaceSmallClassStudents(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "小班 ID 不能为空")
		return
	}
	if _, err := model.GetWorkspaceSmallClassById(id); err != nil {
		common.ApiErrorMsg(c, "小班不存在")
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "请上传 Excel 文件")
		return
	}
	source, err := fileHeader.Open()
	if err != nil {
		common.ApiErrorMsg(c, "读取上传文件失败")
		return
	}
	defer func() { _ = source.Close() }()
	book, err := excelize.OpenReader(source)
	if err != nil {
		common.ApiErrorMsg(c, "无法解析 Excel 文件，请使用模板填写")
		return
	}
	defer func() { _ = book.Close() }()

	rows, parseFailures := parseWsSmallClassStudents(book)
	if len(rows) == 0 {
		common.ApiErrorMsg(c, "Excel 中没有可导入的数据，请确认含「姓名」列")
		return
	}
	// 合并模板可同时包含多个小班的学生行：只导入目标小班名下的行；
	// 旧版模板（无「小班名称」列）整表视为目标小班，保持原有行为。
	target, err := model.GetWorkspaceSmallClassById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filteredRows := make([]wsSmallClassImportRow, 0, len(rows))
	for _, row := range rows {
		if row.SmallName != "" &&
			wsNormalizeClassName(row.SmallName) != wsNormalizeClassName(target.Name) {
			continue
		}
		filteredRows = append(filteredRows, row)
	}
	if len(filteredRows) == 0 {
		common.ApiErrorMsg(c, "Excel 中没有属于小班「"+target.Name+"」的学生行，请确认「小班名称」列填写正确")
		return
	}
	rows = filteredRows

	// 学部索引：按代码/名称解析年级列。
	sections, _ := model.AllWorkspaceSections()
	sectionByRef := make(map[string]*model.WorkspaceSection, len(sections)*2)
	for _, section := range sections {
		sectionByRef[strings.ToUpper(strings.TrimSpace(section.Code))] = section
		sectionByRef[strings.TrimSpace(section.Name)] = section
	}

	// 全部在读学生 + 班级信息，用于内存匹配。
	allStudents, err := model.GetWorkspaceStudentsFiltered(0, model.WorkspaceStudentStatusActive)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	matched := make([]wsSmallClassMatchedRow, 0, len(rows))
	unmatched := make([]wsSmallClassUnmatchedRow, 0)
	for _, row := range rows {
		if strings.TrimSpace(row.DisplayName) == "" {
			continue
		}
		// 第一层：姓名精确匹配（去空白）。
		candidates := make([]*model.WorkspaceStudent, 0)
		for _, student := range allStudents {
			if wsNormalizeClassName(student.DisplayName) == wsNormalizeClassName(row.DisplayName) {
				candidates = append(candidates, student)
			}
		}
		// 第二层：届次过滤。
		if row.EntryYear > 0 && len(candidates) > 0 {
			filtered := candidates[:0]
			for _, student := range candidates {
				if student.EntryYear == row.EntryYear {
					filtered = append(filtered, student)
				}
			}
			candidates = filtered
		}
		// 第三层：年级（学部）过滤。
		if row.GradeRef != "" && len(candidates) > 0 {
			section := sectionByRef[strings.ToUpper(strings.TrimSpace(row.GradeRef))]
			if section == nil {
				section = sectionByRef[strings.TrimSpace(row.GradeRef)]
			}
			if section != nil {
				classSection := make(map[int]int)
				if classes, err := model.GetAllWorkspaceClasses(); err == nil {
					for _, class := range classes {
						classSection[class.Id] = class.SectionId
					}
				}
				filtered := candidates[:0]
				for _, student := range candidates {
					if classSection[student.ClassId] == section.Id {
						filtered = append(filtered, student)
					}
				}
				candidates = filtered
			}
		}

		switch len(candidates) {
		case 1:
			student := candidates[0]
			matched = append(matched, wsSmallClassMatchedRow{
				Row:         row.Row,
				StudentId:   student.Id,
				UserId:      student.UserId,
				DisplayName: student.DisplayName,
				StudentNo:   student.StudentNo,
				ClassName:   student.ClassName,
				GradeName:   student.GradeName,
			})
		case 0:
			unmatched = append(unmatched, wsSmallClassUnmatchedRow{
				Row:         row.Row,
				DisplayName: row.DisplayName,
				EntryYear:   row.EntryYear,
				GradeRef:    row.GradeRef,
				Candidates:  []wsSmallClassCandidate{},
				Reason:      "未找到匹配的学生，请手动选择或先创建学生",
			})
		default:
			// 多条候选：姓名+届次+年级仍无法唯一定位，退回全部候选供手动配对。
			wide := make([]*model.WorkspaceStudent, 0)
			for _, student := range allStudents {
				if wsNormalizeClassName(student.DisplayName) == wsNormalizeClassName(row.DisplayName) {
					wide = append(wide, student)
				}
			}
			candidates = wide
			list := make([]wsSmallClassCandidate, 0, len(candidates))
			for _, student := range candidates {
				list = append(list, wsSmallClassCandidate{
					StudentId:   student.Id,
					UserId:      student.UserId,
					DisplayName: student.DisplayName,
					StudentNo:   student.StudentNo,
					ClassName:   student.ClassName,
					GradeName:   student.GradeName,
					EntryYear:   student.EntryYear,
				})
			}
			unmatched = append(unmatched, wsSmallClassUnmatchedRow{
				Row:         row.Row,
				DisplayName: row.DisplayName,
				EntryYear:   row.EntryYear,
				GradeRef:    row.GradeRef,
				Candidates:  list,
				Reason:      "存在多名同名学生，请手动选择要加入的学生",
			})
		}
	}

	if parseFailures == nil {
		parseFailures = []wsExcelFailure{}
	}
	common.ApiSuccess(c, gin.H{
		"matched":   matched,
		"unmatched": unmatched,
		"failed":    parseFailures,
		// matched_student_ids 供前端一键确认后直接提交入班。
		"matched_student_ids": func() []int {
			ids := make([]int, 0, len(matched))
			for _, item := range matched {
				ids = append(ids, item.StudentId)
			}
			return ids
		}(),
	})
}

// parseWsSmallClassStudents 解析小班导入的学生工作表（姓名 / 届 / 年级）。
// 合并模板优先取「小班学生」工作表；旧版单表模板（仅含「学生」表）仍兼容。
func parseWsSmallClassStudents(book *excelize.File) ([]wsSmallClassImportRow, []wsExcelFailure) {
	sheet := wsFindSheet(book, wsExcelSmallStudentSheet)
	if sheet == "" {
		sheet = wsFindSheet(book, wsSmallClassImportSheet, "小班学生", "名单", "花名册", "社团学生")
	}
	if sheet == "" {
		if sheets := book.GetSheetList(); len(sheets) == 1 {
			sheet = sheets[0]
		}
	}
	if sheet == "" {
		return nil, nil
	}
	raw, err := book.GetRows(sheet)
	if err != nil || len(raw) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(raw[0])
	nameIdx := wsFirstIndex(index, "姓名", "学生姓名", "名字")
	if nameIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「姓名」列"}}
	}
	yearIdx := wsFirstIndex(index, "届（如2024）", "届别", "届")
	gradeIdx := wsFirstIndex(index, "年级（代码或名称）", "学部（代码或名称）", "学部", "年级")
	smallIdx := wsFirstIndex(index, "小班名称", "小班")

	result := make([]wsSmallClassImportRow, 0, len(raw)-1)
	for rowIndex, row := range raw[1:] {
		displayName := wsNormalizeCell(wsCell(row, nameIdx))
		if displayName == "" {
			continue
		}
		item := wsSmallClassImportRow{
			Row:         strconv.Itoa(rowIndex + 2),
			SmallName:   wsNormalizeCell(wsCell(row, smallIdx)),
			DisplayName: displayName,
			GradeRef:    wsNormalizeCell(wsCell(row, gradeIdx)),
		}
		if yearIdx >= 0 {
			item.EntryYear, _ = parseWsExcelYear(wsCell(row, yearIdx))
		}
		result = append(result, item)
	}
	return result, nil
}
