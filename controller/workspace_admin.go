package controller

import (
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/mozillazg/go-pinyin"
)

// ---------- 班级管理 ----------

func GetWorkspaceClasses(c *gin.Context) {
	classes, err := model.GetAllWorkspaceClasses()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, classes)
}

type workspaceClassRequest struct {
	Id          int    `json:"id"`
	Name        string `json:"name"`
	Code        string `json:"code"`
	Description string `json:"description"`
	SectionId   int    `json:"section_id"`
	EntryYear   int    `json:"entry_year"`
	Enabled     *bool  `json:"enabled"`
}

func CreateWorkspaceClass(c *gin.Context) {
	var req workspaceClassRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		common.ApiError(c, common.NewMessage("班级名称不能为空"))
		return
	}
	class := &model.WorkspaceClass{
		Name:        name,
		Code:        strings.TrimSpace(req.Code),
		Description: strings.TrimSpace(req.Description),
		SectionId:   req.SectionId,
		EntryYear:   req.EntryYear,
		Enabled:     true,
	}
	if req.Enabled != nil {
		class.Enabled = *req.Enabled
	}
	if err := class.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	// 未填写编号时按自增序号自动生成，保证名单表格可直接展示。
	if class.Code == "" {
		class.Code = "C" + strconv.Itoa(1000+class.Id)
		if err := class.Update(); err != nil {
			common.SysError(common.LogText("auto class code failed: id=%d err=%s", class.Id, err.Error()))
		}
	}
	common.ApiSuccess(c, class)
}

func UpdateWorkspaceClass(c *gin.Context) {
	var req workspaceClassRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiError(c, common.NewMessage("班级 ID 不能为空"))
		return
	}
	class, err := model.GetWorkspaceClassById(req.Id)
	if err != nil {
		common.ApiError(c, common.NewMessage("班级不存在"))
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		class.Name = name
	}
	if code := strings.TrimSpace(req.Code); code != "" {
		class.Code = code
	}
	class.Description = strings.TrimSpace(req.Description)
	class.SectionId = req.SectionId
	class.EntryYear = req.EntryYear
	if req.Enabled != nil {
		class.Enabled = *req.Enabled
	}
	if err := class.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, class)
}

func DeleteWorkspaceClass(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiError(c, common.NewMessage("班级 ID 不能为空"))
		return
	}
	if err := model.DeleteWorkspaceClass(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---------- 学生管理 ----------

func GetWorkspaceStudents(c *gin.Context) {
	classId, _ := strconv.Atoi(c.Query("class_id"))
	students, err := model.GetAllWorkspaceStudents(classId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, students)
}

type workspaceStudentRequest struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id"`
	ClassId        int    `json:"class_id"`
	EntryYear      int    `json:"entry_year"`
	Status         *int   `json:"status"`
	StudentNo      string `json:"student_no"`
	PinyinUsername string `json:"pinyin_username"`
	DisplayName    string `json:"display_name"`
	Enabled        *bool  `json:"enabled"`
	// SmallClassIds 学生所属上课小班；非 nil 时按该列表全量同步归属（幂等加减）。
	SmallClassIds *[]int `json:"small_class_ids"`
}

// syncWorkspaceStudentSmallClasses 把学生的上课小班归属调整为目标列表。
func syncWorkspaceStudentSmallClasses(studentId int, target []int) error {
	want := make(map[int]bool, len(target))
	for _, id := range target {
		if id > 0 {
			want[id] = true
		}
	}
	current := make(map[int]bool)
	if ids, err := model.GetWorkspaceStudentSmallClassIds(studentId); err == nil {
		for _, id := range ids {
			current[id] = true
		}
	}
	var toAdd, toRemove []int
	for id := range want {
		if !current[id] {
			toAdd = append(toAdd, id)
		}
	}
	for id := range current {
		if !want[id] {
			toRemove = append(toRemove, id)
		}
	}
	if len(toAdd) > 0 {
		for _, id := range toAdd {
			if _, err := model.AddWorkspaceSmallClassMembers(id, []int{studentId}); err != nil {
				return err
			}
		}
	}
	for _, id := range toRemove {
		if err := model.RemoveWorkspaceSmallClassMember(id, studentId); err != nil {
			return err
		}
	}
	return nil
}

func CreateWorkspaceStudent(c *gin.Context) {
	var req workspaceStudentRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	studentNo := strings.TrimSpace(req.StudentNo)
	userId := req.UserId
	if userId > 0 {
		if _, err := model.GetUserById(userId, false); err != nil {
			common.ApiError(c, common.NewMessage("关联账号不存在"))
			return
		}
	} else {
		// 学生账号由系统按「年级代码 + 届别 + 顺位」自动生成，学生登录无需密码。
		if req.ClassId <= 0 {
			common.ApiError(c, common.NewMessage("请选择班级"))
			return
		}
		if displayName == "" {
			common.ApiError(c, common.NewMessage("请填写学生姓名"))
			return
		}
		user, err := createWorkspaceStudentAccount(req.ClassId, req.EntryYear, displayName)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		userId = user.Id
		if studentNo == "" {
			studentNo = user.Username
		}
	}
	// 拼音登录名：留空时按中文姓名自动转拼音并在班级内自动去重；
	// 手动填写且同班重复时返回冲突提示，由教师决定如何修改。
	pinyinName := normalizeWorkspacePinyin(req.PinyinUsername)
	if pinyinName == "" {
		pinyinName = allocateWorkspacePinyin(req.ClassId, workspacePinyinForName(displayName), 0)
	} else if workspacePinyinConflict(req.ClassId, pinyinName, 0) {
		common.ApiErrorMsg(c, "同一班级内已存在相同拼音「"+pinyinName+"」，请修改拼音后再保存")
		return
	}
	student := &model.WorkspaceStudent{
		UserId:         userId,
		ClassId:        req.ClassId,
		EntryYear:      req.EntryYear,
		StudentNo:      studentNo,
		PinyinUsername: pinyinName,
		DisplayName:    displayName,
		Enabled:        true,
		Status:         model.WorkspaceStudentStatusActive,
	}
	applyWorkspaceStudentClassDefaults(student)
	if req.Status != nil {
		student.Status = *req.Status
	}
	if req.Enabled != nil {
		student.Enabled = *req.Enabled
	}
	if err := student.Insert(); err != nil {
		common.ApiError(c, common.NewMessage("该账号已绑定班级"))
		return
	}
	if req.SmallClassIds != nil {
		if err := syncWorkspaceStudentSmallClasses(student.Id, *req.SmallClassIds); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	refreshWorkspaceStudentDisplay(student)
	common.ApiSuccess(c, student)
}

// refreshWorkspaceStudentDisplay 保存后回填班级、小班与账号展示字段。
func refreshWorkspaceStudentDisplay(student *model.WorkspaceStudent) {
	if list, err := model.GetWorkspaceStudentsByUserIds([]int{student.UserId}); err == nil {
		if filled := list[student.UserId]; filled != nil {
			student.SmallClassIds = filled.SmallClassIds
			student.SmallClassNames = filled.SmallClassNames
			student.ClassName = filled.ClassName
			student.GradeName = filled.GradeName
			student.Username = filled.Username
		}
	}
}

// createWorkspaceStudentAccount 为学生自动建号。
// 用户名按「年级代码(A/B/C) + 届别(2位) + 顺位(5位)」生成，例如 A2600001；
// 学生登录不依赖密码，这里写入随机密码仅用于占位。
func createWorkspaceStudentAccount(classId, entryYear int, displayName string) (*model.User, error) {
	class, err := model.GetWorkspaceClassById(classId)
	if err != nil {
		return nil, common.NewMessage("班级不存在")
	}
	section, err := model.GetWorkspaceSectionById(class.SectionId)
	if err != nil {
		return nil, common.NewMessage("班级未绑定学部，无法生成账号")
	}
	if entryYear <= 0 {
		entryYear = class.EntryYear
	}
	if entryYear < 1000 || entryYear > 9999 {
		return nil, common.NewMessage("届别必须是 4 位入学年份")
	}
	username, err := model.AllocateWorkspaceUsername(section.Code, entryYear)
	if err != nil {
		return nil, err
	}
	user := &model.User{
		Username:    username,
		Password:    common.GetRandomString(16),
		DisplayName: displayName,
		Role:        common.RoleCommonUser,
	}
	if err := user.Insert(0); err != nil {
		return nil, common.NewMessage("创建账号失败")
	}
	return user, nil
}

// applyWorkspaceStudentClassDefaults 未显式指定届别时，从所属班级补齐。
func applyWorkspaceStudentClassDefaults(student *model.WorkspaceStudent) {
	if student.ClassId <= 0 {
		return
	}
	class, err := model.GetWorkspaceClassById(student.ClassId)
	if err != nil {
		return
	}
	if student.EntryYear <= 0 {
		student.EntryYear = class.EntryYear
	}
}

func UpdateWorkspaceStudent(c *gin.Context) {
	var req workspaceStudentRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiError(c, common.NewMessage("学生 ID 不能为空"))
		return
	}
	student, err := model.GetWorkspaceStudentById(req.Id)
	if err != nil {
		common.ApiError(c, common.NewMessage("学生记录不存在"))
		return
	}
	if req.UserId > 0 {
		student.UserId = req.UserId
	}
	student.ClassId = req.ClassId
	student.EntryYear = req.EntryYear
	student.StudentNo = strings.TrimSpace(req.StudentNo)
	displayName := strings.TrimSpace(req.DisplayName)
	pinyinName := normalizeWorkspacePinyin(req.PinyinUsername)
	if pinyinName == "" {
		pinyinName = workspacePinyinForName(displayName)
	}
	if workspacePinyinConflict(req.ClassId, pinyinName, student.Id) {
		common.ApiErrorMsg(c, "同一班级内已存在相同拼音「"+pinyinName+"」，请修改拼音后再保存")
		return
	}
	if pinyinName != "" {
		student.PinyinUsername = pinyinName
	}
	student.DisplayName = displayName
	applyWorkspaceStudentClassDefaults(student)
	if req.Status != nil {
		student.Status = *req.Status
	}
	if req.Enabled != nil {
		student.Enabled = *req.Enabled
	}
	if err := student.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.SmallClassIds != nil {
		if err := syncWorkspaceStudentSmallClasses(student.Id, *req.SmallClassIds); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	refreshWorkspaceStudentDisplay(student)
	common.ApiSuccess(c, student)
}

func DeleteWorkspaceStudent(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiError(c, common.NewMessage("学生 ID 不能为空"))
		return
	}
	if err := model.DeleteWorkspaceStudent(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---------- 批量操作 ----------

type workspaceBatchStudentRow struct {
	StudentNo      string `json:"student_no"`
	PinyinUsername string `json:"pinyin_username"`
	DisplayName    string `json:"display_name"`
	Username       string `json:"username"`
	Password       string `json:"password"`
}

// normalizeWorkspacePinyin 规范化小写拼音登录名：去空格并统一小写。
func normalizeWorkspacePinyin(value string) string {
	// 姓名全拼统一存为「小写、无空格」，便于学生直接输入 zhangsan 登录。
	cleaned := strings.ReplaceAll(value, "\u3000", " ")
	return strings.ToLower(strings.Join(strings.Fields(cleaned), ""))
}

// workspacePinyinForName 按中文姓名自动转拼音（取首读音、小写、无空格）。
func workspacePinyinForName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	parts := pinyin.LazyConvert(name, nil)
	var builder strings.Builder
	for _, part := range parts {
		part = strings.ToLower(strings.TrimSpace(part))
		if part == "" {
			continue
		}
		builder.WriteString(part)
	}
	return builder.String()
}

// allocateWorkspacePinyin 保证同一班级内拼音唯一：冲突时自动追加 2/3/... 序号。
func allocateWorkspacePinyin(classId int, base string, excludeStudentId int) string {
	base = normalizeWorkspacePinyin(base)
	if base == "" || classId <= 0 {
		return base
	}
	candidate := base
	for i := 2; i < 100; i++ {
		conflict, err := model.WorkspacePinyinInUse(classId, candidate, excludeStudentId)
		if err != nil || !conflict {
			return candidate
		}
		candidate = base + strconv.Itoa(i)
	}
	return candidate
}

// workspacePinyinConflict 判断手动填写的拼音在同一班级内是否重复。
func workspacePinyinConflict(classId int, pinyinName string, excludeStudentId int) bool {
	if classId <= 0 || pinyinName == "" {
		return false
	}
	conflict, err := model.WorkspacePinyinInUse(classId, pinyinName, excludeStudentId)
	return err == nil && conflict
}

// workspaceBatchPinyin 批量建号时取用教师填写的拼音，留空则按姓名自动生成。
func workspaceBatchPinyin(input, displayName string) string {
	pinyinName := normalizeWorkspacePinyin(input)
	if pinyinName != "" {
		return pinyinName
	}
	return workspacePinyinForName(displayName)
}

// GetWorkspacePinyin 按中文姓名自动转拼音，供管理端名单表格自动填充。
func GetWorkspacePinyin(c *gin.Context) {
	names := c.QueryArray("name")
	if len(names) == 0 {
		names = []string{c.Query("name")}
	}
	items := make([]gin.H, 0, len(names))
	for _, name := range names {
		items = append(items, gin.H{"name": name, "pinyin": workspacePinyinForName(name)})
	}
	common.ApiSuccess(c, items)
}

// BatchCreateWorkspaceStudents 批量新建学生账号并直接加入指定班级。
// 学生登录不依赖密码，账号名默认由系统按「年级代码 + 届别 + 顺位」自动生成；
// 同名（重名）由上传名单时通过学号区分。失败的行不影响其他行，逐行返回失败原因。
func BatchCreateWorkspaceStudents(c *gin.Context) {
	var req struct {
		ClassId         int                        `json:"class_id"`
		DefaultPassword string                     `json:"default_password"`
		Students        []workspaceBatchStudentRow `json:"students"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ClassId <= 0 {
		common.ApiError(c, common.NewMessage("班级 ID 不能为空"))
		return
	}
	class, err := model.GetWorkspaceClassById(req.ClassId)
	if err != nil {
		common.ApiError(c, common.NewMessage("班级不存在"))
		return
	}
	if len(req.Students) == 0 {
		common.ApiError(c, common.NewMessage("请至少填写一名学生"))
		return
	}
	if len(req.Students) > 500 {
		common.ApiError(c, common.NewMessage("单次最多创建 500 名学生"))
		return
	}
	defaultPassword := strings.TrimSpace(req.DefaultPassword)
	section, sectionErr := model.GetWorkspaceSectionById(class.SectionId)

	type failure struct {
		StudentNo string `json:"student_no"`
		Reason    string `json:"reason"`
	}
	created := make([]*model.WorkspaceStudent, 0, len(req.Students))
	failed := make([]failure, 0)
	for _, row := range req.Students {
		studentNo := strings.TrimSpace(row.StudentNo)
		username := strings.TrimSpace(row.Username)
		displayName := strings.TrimSpace(row.DisplayName)
		if displayName == "" {
			displayName = username
		}
		if displayName == "" {
			displayName = studentNo
		}
		if displayName == "" {
			failed = append(failed, failure{StudentNo: studentNo, Reason: "姓名不能为空"})
			continue
		}
		password := strings.TrimSpace(row.Password)
		if password == "" {
			password = defaultPassword
		}
		// 批量建号时写入的密码（含默认密码与随机密码）只是占位，
		// 学生仍按「默认免密」规则登录，之后可在账户管理中自行设置密码。
		if password == "" {
			password = common.GetRandomString(16)
		}
		if username == "" {
			// 未指定账号名：按学部代码 + 届别自动生成 8 位学号账号。
			if sectionErr != nil {
				failed = append(failed, failure{StudentNo: studentNo, Reason: "班级未绑定学部，无法生成账号"})
				continue
			}
			allocated, allocErr := model.AllocateWorkspaceUsername(section.Code, class.EntryYear)
			if allocErr != nil {
				failed = append(failed, failure{StudentNo: studentNo, Reason: allocErr.Error()})
				continue
			}
			username = allocated
			if studentNo == "" {
				studentNo = allocated
			}
		}
		exist, existErr := model.CheckUserExistOrDeleted(username, "")
		if existErr != nil {
			failed = append(failed, failure{StudentNo: studentNo, Reason: "账号校验失败"})
			continue
		}
		if exist {
			failed = append(failed, failure{StudentNo: studentNo, Reason: "账号已存在"})
			continue
		}
		user := &model.User{
			Username:    username,
			Password:    password,
			DisplayName: displayName,
			Role:        common.RoleCommonUser,
		}
		if err := user.Insert(0); err != nil {
			failed = append(failed, failure{StudentNo: studentNo, Reason: "创建账号失败"})
			continue
		}
		student := &model.WorkspaceStudent{
			UserId:         user.Id,
			ClassId:        req.ClassId,
			EntryYear:      class.EntryYear,
			StudentNo:      studentNo,
			PinyinUsername: allocateWorkspacePinyin(req.ClassId, workspaceBatchPinyin(row.PinyinUsername, displayName), 0),
			DisplayName:    displayName,
			Enabled:        true,
			Status:         model.WorkspaceStudentStatusActive,
		}
		if err := student.Insert(); err != nil {
			failed = append(failed, failure{StudentNo: studentNo, Reason: "加入班级失败"})
			continue
		}
		created = append(created, student)
	}
	common.ApiSuccess(c, map[string]any{
		"created_count": len(created),
		"created":       created,
		"failed":        failed,
	})
}

// BatchSetWorkspaceStudentPoints 批量调整学生点数。
// 传 student_ids 按学生档案处理，传 user_ids 按账号处理（两者可同时传）；
// 两者都未传时把整个 class_id 班级作为目标。
func BatchSetWorkspaceStudentPoints(c *gin.Context) {
	var req struct {
		ClassId    int    `json:"class_id"`
		StudentIds []int  `json:"student_ids"`
		// UserIds 供课堂大屏等只持有 user_id 的场景按用户维度批量发点数。
		UserIds    []int  `json:"user_ids"`
		Mode       string `json:"mode"`
		Value      int    `json:"value"`
		ResetUsage bool   `json:"reset_usage"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	mode := strings.TrimSpace(req.Mode)
	if mode != "clear" && mode != "set" {
		common.ApiError(c, common.NewMessage("不支持的操作类型"))
		return
	}
	if mode == "set" && req.Value < 0 {
		common.ApiError(c, common.NewMessage("点数不能为负数"))
		return
	}

	type pointTarget struct {
		studentId int
		userId    int
	}
	targets := make([]pointTarget, 0, len(req.StudentIds)+len(req.UserIds))
	for _, studentId := range req.StudentIds {
		if studentId > 0 {
			targets = append(targets, pointTarget{studentId: studentId})
		}
	}
	for _, userId := range req.UserIds {
		if userId > 0 {
			targets = append(targets, pointTarget{userId: userId})
		}
	}
	if len(targets) == 0 {
		if req.ClassId <= 0 {
			common.ApiError(c, common.NewMessage("请选择要操作的学生"))
			return
		}
		if _, err := model.GetWorkspaceClassById(req.ClassId); err != nil {
			common.ApiError(c, common.NewMessage("班级不存在"))
			return
		}
		students, err := model.GetAllWorkspaceStudents(req.ClassId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, student := range students {
			if student.Id > 0 {
				targets = append(targets, pointTarget{studentId: student.Id})
			}
		}
	}
	if len(targets) == 0 {
		common.ApiError(c, common.NewMessage("没有可操作的学生"))
		return
	}

	applied := 0
	failed := 0
	for _, target := range targets {
		userId, err := resolveWorkspaceStudentUserId(target.studentId, target.userId)
		if err != nil {
			failed++
			continue
		}
		points := req.Value
		if mode == "clear" {
			points = 0
		}
		if err := applyStudentPoints(c, userId, points, req.ResetUsage); err != nil {
			failed++
			continue
		}
		applied++
	}
	common.ApiSuccess(c, map[string]any{
		"applied": applied,
		"failed":  failed,
		"total":   len(targets),
	})
}

// ---------- 账户与能力额度 ----------

type workspaceAccountItem struct {
	Id          int                         `json:"id"`
	Username    string                      `json:"username"`
	DisplayName string                      `json:"display_name"`
	Role        int                         `json:"role"`
	Status      int                         `json:"status"`
	Quota       int                         `json:"quota"`
	UsedQuota   int                         `json:"used_quota"`
	Quotas      []*model.WorkspaceUserQuota `json:"capability_quotas"`
}

type workspaceUserBrief struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        int    `json:"role"`
}

// GetWorkspaceUsers 返回精简用户列表，供班级选择学生账号使用。
func GetWorkspaceUsers(c *gin.Context) {
	users, _, err := model.GetAllUsers(&common.PageInfo{Page: 1, PageSize: 100})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]*workspaceUserBrief, 0, len(users))
	for _, user := range users {
		result = append(result, &workspaceUserBrief{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Role:        user.Role,
		})
	}
	common.ApiSuccess(c, result)
}

// GetWorkspaceAccounts 返回账户列表（含各能力额度分配与已用量）。
func GetWorkspaceAccounts(c *gin.Context) {
	users, _, err := model.GetAllUsers(&common.PageInfo{Page: 1, PageSize: 100})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	allQuotas, err := model.GetWorkspaceUserQuotas(0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	grouped := make(map[int][]*model.WorkspaceUserQuota)
	for _, quota := range allQuotas {
		grouped[quota.UserId] = append(grouped[quota.UserId], quota)
	}
	result := make([]*workspaceAccountItem, 0, len(users))
	for _, user := range users {
		quotas := grouped[user.Id]
		if quotas == nil {
			quotas = []*model.WorkspaceUserQuota{}
		}
		result = append(result, &workspaceAccountItem{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Role:        user.Role,
			Status:      user.Status,
			Quota:       user.Quota,
			UsedQuota:   user.UsedQuota,
			Quotas:      quotas,
		})
	}
	common.ApiSuccess(c, result)
}

// UpdateWorkspaceAccountQuotas 全量覆盖某用户的能力额度分配。
func UpdateWorkspaceAccountQuotas(c *gin.Context) {
	var req struct {
		UserId int            `json:"user_id"`
		Quotas map[string]int `json:"quotas"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.UserId <= 0 {
		common.ApiError(c, common.NewMessage("用户 ID 不能为空"))
		return
	}
	if err := model.SetWorkspaceUserQuotas(req.UserId, req.Quotas); err != nil {
		common.ApiError(c, err)
		return
	}
	quotas, err := model.GetWorkspaceUserQuotas(req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, quotas)
}

// ResetWorkspaceAccountUsage 清零某用户（或指定能力）的已用量。
func ResetWorkspaceAccountUsage(c *gin.Context) {
	var req struct {
		UserId       int    `json:"user_id"`
		CapabilityId string `json:"capability_id"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.UserId <= 0 {
		common.ApiError(c, common.NewMessage("用户 ID 不能为空"))
		return
	}
	if err := model.ResetWorkspaceUserQuotaUsage(req.UserId, strings.TrimSpace(req.CapabilityId)); err != nil {
		common.ApiError(c, err)
		return
	}
	quotas, err := model.GetWorkspaceUserQuotas(req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, quotas)
}

// ClearWorkspaceAccountUsedQuota 一键清零累计已用点数（users.used_quota）。
// 支持单个 user_id，也支持批量 user_ids；剩余点数不受影响。
func ClearWorkspaceAccountUsedQuota(c *gin.Context) {
	var req struct {
		UserId  int   `json:"user_id"`
		UserIds []int `json:"user_ids"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	ids := make([]int, 0, len(req.UserIds)+1)
	if req.UserId > 0 {
		ids = append(ids, req.UserId)
	}
	for _, id := range req.UserIds {
		if id > 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		common.ApiError(c, common.NewMessage("请选择要清零的用户"))
		return
	}
	for _, id := range ids {
		if err := model.ResetWorkspaceUserUsedQuota(id); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	common.ApiSuccess(c, map[string]any{"cleared": len(ids)})
}

// ---------- 使用记录 ----------

type workspaceRecord struct {
	Key      string `json:"key"`
	Source   string `json:"source"`
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
	// StudentName / StudentNo / ClassName / GradeName 用于在筛选结果中区分重名学生。
	StudentName string `json:"student_name,omitempty"`
	StudentNo   string `json:"student_no,omitempty"`
	ClassName   string `json:"class_name,omitempty"`
	GradeName   string `json:"grade_name,omitempty"`
	Capability  string `json:"capability"`
	Model       string `json:"model"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	Progress    string `json:"progress,omitempty"`
	Quota       int    `json:"quota"`
	TaskId      string `json:"task_id,omitempty"`
	CreatedAt   int64  `json:"created_at"`
	FailReason  string `json:"fail_reason,omitempty"`
	// Points 中台按次计费的真实扣点（来自 workspace_usages），0 表示未关联到计费明细。
	Points int `json:"points"`
	// Prompt / ResultPreview 本次生成提交的内容与 AI 返回的内容预览。
	Prompt        string `json:"prompt,omitempty"`
	ResultPreview string `json:"result_preview,omitempty"`
	// DurationMs 本次生成的耗时（毫秒），0 表示未记录到计费明细。
	DurationMs int `json:"duration_ms,omitempty"`
	// ArtifactId 关联的云端素材 id（同一学生同一能力的最近产物）；0 表示未关联到产物。
	ArtifactId int `json:"artifact_id,omitempty"`
	// requestId 仅用于内部关联中台计费明细，不参与序列化。
	requestId string
}

// workspaceKindScanLimit 指定能力筛选时任务侧需在内存过滤，拉取上限用于兜底防止全表扫描。
const workspaceKindScanLimit = 5000

// GetWorkspaceRecords 返回生成记录：学生仅可查看本人，教师与管理员可按用户、班级、年级、
// 能力类型与时间范围筛选。
func GetWorkspaceRecords(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	role := c.GetInt("role")
	viewerId := c.GetInt("id")
	targetUserId := viewerId
	allUsers := false
	hasExplicitUser := false
	if role >= common.RoleAdminUser {
		if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
			if id, err := strconv.Atoi(raw); err == nil && id > 0 {
				targetUserId = id
				hasExplicitUser = true
			}
		} else {
			allUsers = true
		}
	}
	// 班级 / 学部年级 / 学生姓名筛选仅对教师与管理员生效，学生始终只能查看本人。
	classId, _ := strconv.Atoi(c.Query("class_id"))
	sectionId, _ := strconv.Atoi(c.Query("section_id"))
	gradeIndex, _ := strconv.Atoi(c.Query("grade_index"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	includeGraduated := c.Query("include_graduated") == "1" || strings.EqualFold(c.Query("include_graduated"), "true")
	scoped := false
	var scopedUserIds []int
	if role >= common.RoleAdminUser && (classId > 0 || sectionId > 0 || keyword != "") {
		ids, err := model.FindWorkspaceStudentUserIds(classId, sectionId, gradeIndex, keyword, includeGraduated)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		// 与显式 user_id 同时指定时取交集。
		if hasExplicitUser {
			filtered := make([]int, 0, len(ids))
			for _, id := range ids {
				if id == targetUserId {
					filtered = append(filtered, id)
				}
			}
			ids = filtered
		}
		scoped = true
		scopedUserIds = ids
		allUsers = true
	}

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	kind := strings.TrimSpace(c.Query("kind"))

	startIdx := pageInfo.GetStartIdx()
	pageSize := pageInfo.GetPageSize()
	fetchNum := startIdx + pageSize

	// kind 过滤：把能力类型映射为其模型集合，交由日志侧在库内过滤。
	var kindModels []string
	if kind != "" {
		for _, capability := range setting.GetWorkspaceCapabilities() {
			if capability.Kind == kind {
				kindModels = capability.Models
				break
			}
		}
	}
	noLogs := (scoped && len(scopedUserIds) == 0) || (kind != "" && len(kindModels) == 0)

	logFilter := model.LogFilter{
		Type:           model.LogTypeConsume,
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
	}
	if len(kindModels) > 0 {
		logFilter.ModelNames = kindModels
	}
	var logs []*model.Log
	var logTotal int64
	var err error
	if noLogs {
		logs, logTotal = nil, 0
	} else {
		switch {
		case scoped:
			logs, logTotal, err = model.GetUserLogsByUserIds(scopedUserIds, logFilter, 0, fetchNum)
		case allUsers:
			logs, logTotal, err = model.GetAllLogs(logFilter, 0, fetchNum)
		default:
			logs, logTotal, err = model.GetUserLogs(targetUserId, logFilter, 0, fetchNum)
		}
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}

	taskParams := model.SyncTaskQueryParams{
		TaskID:         strings.TrimSpace(c.Query("task_id")),
		Status:         strings.TrimSpace(c.Query("status")),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
	}
	if scoped {
		taskParams.UserIDs = scopedUserIds
	}
	// 指定 kind 时任务侧无法在库内按模型过滤，改为拉取后在内存中按能力过滤，
	// 并令 total 等于过滤后的条数，保证分页与总数自洽（不出现空页/重复）。
	filterByKind := kind != ""
	var tasks []*model.Task
	var taskTotal int64
	switch {
	case scoped && len(scopedUserIds) == 0:
		tasks, taskTotal = nil, 0
	case allUsers:
		limit := fetchNum
		if filterByKind {
			limit = workspaceKindScanLimit
		}
		tasks = model.TaskGetAllTasks(0, limit, taskParams)
		if filterByKind {
			tasks = filterWorkspaceTasksByKind(tasks, kind)
			taskTotal = int64(len(tasks))
		} else {
			taskTotal = model.TaskCountAllTasks(taskParams)
		}
	default:
		limit := fetchNum
		if filterByKind {
			limit = workspaceKindScanLimit
		}
		tasks = model.TaskGetAllUserTask(targetUserId, 0, limit, taskParams)
		if filterByKind {
			tasks = filterWorkspaceTasksByKind(tasks, kind)
			taskTotal = int64(len(tasks))
		} else {
			taskTotal = model.TaskCountAllUserTask(targetUserId, taskParams)
		}
	}

	records := make([]*workspaceRecord, 0, len(logs)+len(tasks))
	for _, log := range logs {
		records = append(records, &workspaceRecord{
			Key:        "log-" + strconv.Itoa(log.Id),
			Source:     "sync",
			UserId:     log.UserId,
			Username:   log.Username,
			Capability: workspaceKindForModel(log.ModelName),
			Model:      log.ModelName,
			Title:      strings.TrimSpace(log.Content),
			Status:     "SUCCESS",
			Quota:      log.Quota,
			CreatedAt:  log.CreatedAt,
			requestId:  log.RequestId,
		})
	}
	for _, task := range tasks {
		records = append(records, &workspaceRecord{
			Key:        "task-" + strconv.FormatInt(task.ID, 10),
			Source:     "task",
			UserId:     task.UserId,
			Capability: workspaceKindForModel(task.Properties.OriginModelName),
			Model:      task.Properties.OriginModelName,
			Title:      strings.TrimSpace(task.Properties.Input),
			Status:     string(task.Status),
			Progress:   task.Progress,
			Quota:      task.Quota,
			TaskId:     task.TaskID,
			CreatedAt:  task.CreatedAt,
			FailReason: task.FailReason,
			requestId:  workspaceTaskRequestId(task),
		})
	}

	sort.SliceStable(records, func(i, j int) bool {
		return records[i].CreatedAt > records[j].CreatedAt
	})
	if startIdx < len(records) {
		end := startIdx + pageSize
		if end > len(records) {
			end = len(records)
		}
		records = records[startIdx:end]
	} else {
		records = []*workspaceRecord{}
	}
	fillWorkspaceRecordUsernames(records)
	fillWorkspaceRecordCharges(records)
	attachWorkspaceRecordArtifacts(records)

	pageInfo.SetTotal(int(logTotal + taskTotal))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}

// filterWorkspaceTasksByKind 按能力类型过滤任务（视频/音乐等异步生成）。
func filterWorkspaceTasksByKind(tasks []*model.Task, kind string) []*model.Task {
	filtered := make([]*model.Task, 0, len(tasks))
	for _, task := range tasks {
		if workspaceKindForModel(task.Properties.OriginModelName) == kind {
			filtered = append(filtered, task)
		}
	}
	return filtered
}

// attachWorkspaceRecordArtifacts 为页面内的生成记录关联其最近的产物 id：
// 同一用户、同一能力（模型信息都存在时再校验模型一致），取生成时间最接近的一条。
func attachWorkspaceRecordArtifacts(records []*workspaceRecord) {
	type groupKey struct {
		userId int
		kind   string
	}
	userSet := map[int]bool{}
	kindSet := map[string]bool{}
	for _, record := range records {
		if record.UserId <= 0 || record.Capability == "" {
			continue
		}
		userSet[record.UserId] = true
		kindSet[record.Capability] = true
	}
	if len(userSet) == 0 || len(kindSet) == 0 {
		return
	}
	userIds := make([]int, 0, len(userSet))
	for id := range userSet {
		userIds = append(userIds, id)
	}
	kinds := make([]string, 0, len(kindSet))
	for kind := range kindSet {
		kinds = append(kinds, kind)
	}
	artifacts, err := model.ListWorkspaceArtifactsByUsersAndKinds(userIds, kinds)
	if err != nil || len(artifacts) == 0 {
		return
	}
	index := make(map[groupKey][]*model.WorkspaceArtifact)
	for _, artifact := range artifacts {
		key := groupKey{artifact.UserId, artifact.Kind}
		index[key] = append(index[key], artifact)
	}
	for _, record := range records {
		candidates := index[groupKey{record.UserId, record.Capability}]
		if len(candidates) == 0 {
			continue
		}
		var best *model.WorkspaceArtifact
		var bestDiff int64
		for _, candidate := range candidates {
			if record.Model != "" && candidate.Model != "" && candidate.Model != record.Model {
				continue
			}
			diff := candidate.CreatedAt - record.CreatedAt
			if diff < 0 {
				diff = -diff
			}
			if best == nil || diff < bestDiff {
				best = candidate
				bestDiff = diff
			}
		}
		if best != nil {
			record.ArtifactId = best.Id
		}
	}
}

// workspaceTaskRequestId 取异步任务提交时那次请求的 request id，用于关联中台计费明细。
func workspaceTaskRequestId(task *model.Task) string {
	if task == nil || task.PrivateData.Execution == nil {
		return ""
	}
	return strings.TrimSpace(task.PrivateData.Execution.RequestID)
}

// fillWorkspaceRecordCharges 用中台的计费明细回填使用记录的真实扣点与请求/响应内容。
func fillWorkspaceRecordCharges(records []*workspaceRecord) {
	requestIds := make([]string, 0, len(records))
	for _, record := range records {
		if record.requestId != "" {
			requestIds = append(requestIds, record.requestId)
		}
	}
	if len(requestIds) == 0 {
		return
	}
	usages, err := model.ListWorkspaceUsagesByRequestIds(requestIds)
	if err != nil || len(usages) == 0 {
		return
	}
	index := make(map[string]*model.WorkspaceUsage, len(usages))
	for _, usage := range usages {
		// 空 request_id 无法一一对应，跳过以免误配到别的记录。
		if usage.RequestId == "" {
			continue
		}
		if _, exists := index[usage.RequestId]; !exists {
			index[usage.RequestId] = usage
		}
	}
	for _, record := range records {
		if record.requestId == "" {
			continue
		}
		usage, ok := index[record.requestId]
		if !ok || usage == nil {
			continue
		}
		record.Points = usage.Points
		record.Prompt = usage.Prompt
		record.ResultPreview = usage.ResultPreview
		record.DurationMs = usage.DurationMs
		if record.Capability == "" {
			record.Capability = usage.Kind
		}
	}
}

func fillWorkspaceRecordUsernames(records []*workspaceRecord) {
	for _, record := range records {
		if record.Username != "" || record.UserId <= 0 {
			continue
		}
		if cache, err := model.GetUserCache(record.UserId); err == nil && cache != nil {
			record.Username = cache.Username
		}
	}
	// 批量补齐学生档案信息，便于教师在筛选结果中通过「姓名 + 学号 + 班级」区分重名。
	userIds := make([]int, 0, len(records))
	for _, record := range records {
		if record.UserId > 0 {
			userIds = append(userIds, record.UserId)
		}
	}
	students, err := model.GetWorkspaceStudentsByUserIds(userIds)
	if err != nil {
		return
	}
	for _, record := range records {
		student := students[record.UserId]
		if student == nil {
			continue
		}
		record.StudentName = student.DisplayName
		record.StudentNo = student.StudentNo
		record.ClassName = student.ClassName
		record.GradeName = student.GradeName
	}
}

// workspaceKindForModel 依据能力配置中的模型名推断记录所属的能力类型。
func workspaceKindForModel(modelName string) string {
	modelName = strings.TrimSpace(modelName)
	for _, capability := range setting.GetWorkspaceCapabilities() {
		if capability.Model != "" && capability.Model == modelName {
			return capability.Kind
		}
	}
	return ""
}

// ---------- 教师点数操作 ----------

// resolveWorkspaceStudentUserId 由学生记录 id 或用户 id 解析出用户 id。
func resolveWorkspaceStudentUserId(studentId, userId int) (int, error) {
	if studentId > 0 {
		student, err := model.GetWorkspaceStudentById(studentId)
		if err != nil {
			return 0, common.NewMessage("学生记录不存在")
		}
		userId = student.UserId
	}
	if userId <= 0 {
		return 0, common.NewMessage("学生不能为空")
	}
	return userId, nil
}

// applyStudentPoints 把学生点数覆盖为指定值，并可选清零各能力已用量。
func applyStudentPoints(c *gin.Context, userId, points int, resetUsage bool) error {
	if points < 0 {
		points = 0
	}
	if _, err := model.AdjustUserQuota(userId, c.GetInt("role"), "override", points); err != nil {
		return err
	}
	if resetUsage {
		if err := model.ResetWorkspaceUserQuotaUsage(userId, ""); err != nil {
			return err
		}
	}
	return nil
}

// SetWorkspaceStudentPoints 调整单个学生点数：mode = clear（清零）/ set（指定值 value）。
func SetWorkspaceStudentPoints(c *gin.Context) {
	var req struct {
		StudentId  int    `json:"student_id"`
		UserId     int    `json:"user_id"`
		Mode       string `json:"mode"`
		Value      int    `json:"value"`
		ResetUsage bool   `json:"reset_usage"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	userId, err := resolveWorkspaceStudentUserId(req.StudentId, req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	mode := strings.TrimSpace(req.Mode)
	points := req.Value
	switch mode {
	case "clear":
		points = 0
	case "set":
	default:
		common.ApiError(c, common.NewMessage("不支持的操作类型"))
		return
	}
	if err := applyStudentPoints(c, userId, points, req.ResetUsage); err != nil {
		common.ApiError(c, err)
		return
	}
	quota, _ := model.GetUserQuota(userId, true)
	common.ApiSuccess(c, map[string]any{
		"user_id": userId,
		"points":  quota,
	})
}

// UpdateWorkspaceStudentAccount 修改学生的登录密码。
func UpdateWorkspaceStudentAccount(c *gin.Context) {
	var req struct {
		StudentId   int    `json:"student_id"`
		UserId      int    `json:"user_id"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	userId, err := resolveWorkspaceStudentUserId(req.StudentId, req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, common.NewMessage("账号不存在"))
		return
	}
	if c.GetInt("role") < common.RoleRootUser && user.Role != common.RoleCommonUser {
		common.ApiError(c, common.NewMessage("仅可修改学生账号"))
		return
	}
	password := strings.TrimSpace(req.Password)
	// 学生登录不依赖密码，密码为可选字段：留空则仅更新显示名。
	if password != "" {
		if len(password) < 6 {
			common.ApiError(c, common.NewMessage("密码长度不能少于 6 位"))
			return
		}
		user.Password = password
		if err := user.Edit(true); err != nil {
			common.ApiError(c, common.NewMessage("密码修改失败"))
			return
		}
		// 教师为学生设置密码后，学生登录必须输入密码。
		if err := model.DB.Model(&model.WorkspaceStudent{}).Where("user_id = ?", userId).
			Update("password_set", true).Error; err != nil {
			common.ApiError(c, common.NewMessage("密码修改失败"))
			return
		}
	}
	common.ApiSuccess(c, nil)
}

// ResetWorkspaceStudentPassword 教师 / 管理员重置学生登录密码。
// 重置后清除「已设置密码」标记，学生恢复为免密登录，旧密码同时失效。
func ResetWorkspaceStudentPassword(c *gin.Context) {
	var req struct {
		StudentId int `json:"student_id"`
		UserId    int `json:"user_id"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	userId, err := resolveWorkspaceStudentUserId(req.StudentId, req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, common.NewMessage("账号不存在"))
		return
	}
	if c.GetInt("role") < common.RoleRootUser && user.Role != common.RoleCommonUser {
		common.ApiError(c, common.NewMessage("仅可重置学生密码"))
		return
	}
	user.Password = common.GetRandomString(16)
	if err := user.Edit(true); err != nil {
		common.ApiError(c, common.NewMessage("密码重置失败"))
		return
	}
	if err := model.DB.Model(&model.WorkspaceStudent{}).Where("user_id = ?", userId).
		Update("password_set", false).Error; err != nil {
		common.ApiError(c, common.NewMessage("密码重置失败"))
		return
	}
	common.ApiSuccess(c, nil)
}
