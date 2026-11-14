package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 教师端备课模式（模块 C） ----------
// 层级：年级（学部+年级序号） → 单元 → 课时 → 分项任务。
// 单元/课时/任务均可增删改，并支持整课时复制实现方案复用。

type workspaceUnitRequest struct {
	Id          int    `json:"id"`
	SectionId   int    `json:"section_id"`
	GradeIndex  int    `json:"grade_index"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
}

type workspaceLessonRequest struct {
	Id          int    `json:"id"`
	UnitId      int    `json:"unit_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	AiCourse    *bool  `json:"ai_course"`
	SortOrder   int    `json:"sort_order"`
}

type workspaceLessonTaskRequest struct {
	Id                int    `json:"id"`
	LessonId          int    `json:"lesson_id"`
	Title             string `json:"title"`
	Requirement       string `json:"requirement"`
	OutputForms       string `json:"output_forms"`
	AllowedExtensions string `json:"allowed_extensions"`
	MaxUploads        *int   `json:"max_uploads"`
	MaxSubmits        *int   `json:"max_submits"`
	// ReferenceArtifacts 任务参考资料素材 id 列表（逗号分隔，留空清空）。
	ReferenceArtifacts string `json:"reference_artifacts"`
	SortOrder          int    `json:"sort_order"`
}

// GetWorkspaceLessonPlans 读取备课方案：返回指定学部+年级下的单元、课时与分项任务。
func GetWorkspaceLessonPlans(c *gin.Context) {
	sectionId, _ := strconv.Atoi(c.Query("section_id"))
	gradeIndex, _ := strconv.Atoi(c.Query("grade_index"))
	list, err := model.GetWorkspaceLessonPlans(sectionId, gradeIndex)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, list)
}

// ---------- 单元 ----------

func CreateWorkspaceUnit(c *gin.Context) {
	var req workspaceUnitRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		common.ApiErrorMsg(c, "单元名称不能为空")
		return
	}
	if req.SectionId <= 0 || req.GradeIndex <= 0 {
		common.ApiErrorMsg(c, "请先选择学部和年级")
		return
	}
	unit := &model.WorkspaceUnit{
		SectionId:   req.SectionId,
		GradeIndex:  req.GradeIndex,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		SortOrder:   req.SortOrder,
	}
	if err := unit.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, unit)
}

func UpdateWorkspaceUnit(c *gin.Context) {
	var req workspaceUnitRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "单元 ID 不能为空")
		return
	}
	unit, err := model.GetWorkspaceUnitById(req.Id)
	if err != nil {
		common.ApiErrorMsg(c, "单元不存在")
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		unit.Name = name
	}
	unit.Description = strings.TrimSpace(req.Description)
	if req.SectionId > 0 {
		unit.SectionId = req.SectionId
	}
	if req.GradeIndex > 0 {
		unit.GradeIndex = req.GradeIndex
	}
	unit.SortOrder = req.SortOrder
	if err := unit.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, unit)
}

func DeleteWorkspaceUnit(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "单元 ID 不能为空")
		return
	}
	if _, err := model.GetWorkspaceUnitById(id); err != nil {
		common.ApiErrorMsg(c, "单元不存在")
		return
	}
	if err := model.DeleteWorkspaceUnit(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---------- 课时 ----------

func CreateWorkspaceLesson(c *gin.Context) {
	var req workspaceLessonRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		common.ApiErrorMsg(c, "课时标题不能为空")
		return
	}
	if req.UnitId <= 0 {
		common.ApiErrorMsg(c, "请先选择单元")
		return
	}
	if _, err := model.GetWorkspaceUnitById(req.UnitId); err != nil {
		common.ApiErrorMsg(c, "单元不存在")
		return
	}
	lesson := &model.WorkspaceLesson{
		UnitId:      req.UnitId,
		Title:       title,
		Description: strings.TrimSpace(req.Description),
		AiCourse:    req.AiCourse != nil && *req.AiCourse,
		SortOrder:   req.SortOrder,
	}
	if err := lesson.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, lesson)
}

func UpdateWorkspaceLesson(c *gin.Context) {
	var req workspaceLessonRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "课时 ID 不能为空")
		return
	}
	lesson, err := model.GetWorkspaceLessonById(req.Id)
	if err != nil {
		common.ApiErrorMsg(c, "课时不存在")
		return
	}
	if title := strings.TrimSpace(req.Title); title != "" {
		lesson.Title = title
	}
	lesson.Description = strings.TrimSpace(req.Description)
	if req.AiCourse != nil {
		lesson.AiCourse = *req.AiCourse
	}
	if req.UnitId > 0 {
		if _, err := model.GetWorkspaceUnitById(req.UnitId); err != nil {
			common.ApiErrorMsg(c, "单元不存在")
			return
		}
		lesson.UnitId = req.UnitId
	}
	lesson.SortOrder = req.SortOrder
	if err := lesson.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, lesson)
}

func DeleteWorkspaceLesson(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "课时 ID 不能为空")
		return
	}
	if _, err := model.GetWorkspaceLessonById(id); err != nil {
		common.ApiErrorMsg(c, "课时不存在")
		return
	}
	if err := model.DeleteWorkspaceLesson(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// CopyWorkspaceLesson 复制课时及其分项任务，可选指定目标单元（方案复用）。
func CopyWorkspaceLesson(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "课时 ID 不能为空")
		return
	}
	var req struct {
		TargetUnitId int `json:"target_unit_id"`
	}
	_ = common.UnmarshalBodyReusable(c, &req)
	copied, err := model.CopyWorkspaceLesson(id, req.TargetUnitId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, copied)
}

// ---------- 分项任务 ----------

func CreateWorkspaceLessonTask(c *gin.Context) {
	var req workspaceLessonTaskRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		common.ApiErrorMsg(c, "任务标题不能为空")
		return
	}
	if req.LessonId <= 0 {
		common.ApiErrorMsg(c, "请先选择课时")
		return
	}
	if _, err := model.GetWorkspaceLessonById(req.LessonId); err != nil {
		common.ApiErrorMsg(c, "课时不存在")
		return
	}
	maxUploads := 1
	if req.MaxUploads != nil && *req.MaxUploads > 0 {
		maxUploads = *req.MaxUploads
	}
	// 提交次数上限：0 表示不限次数。
	maxSubmits := 0
	if req.MaxSubmits != nil && *req.MaxSubmits > 0 {
		maxSubmits = *req.MaxSubmits
	}
	task := &model.WorkspaceLessonTask{
		LessonId:          req.LessonId,
		Title:             title,
		Requirement:       strings.TrimSpace(req.Requirement),
		OutputForms:       model.NormalizeWorkspaceTaskOutputForms(req.OutputForms),
		AllowedExtensions: model.NormalizeWorkspaceTaskExtensions(req.AllowedExtensions),
		MaxUploads:        maxUploads,
		MaxSubmits:        maxSubmits,
		ReferenceArtifacts: normalizeReferenceArtifactIds(req.ReferenceArtifacts),
		SortOrder:         req.SortOrder,
	}
	if err := task.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, task)
}

func UpdateWorkspaceLessonTask(c *gin.Context) {
	var req workspaceLessonTaskRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "任务 ID 不能为空")
		return
	}
	task, err := model.GetWorkspaceLessonTaskById(req.Id)
	if err != nil {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}
	if title := strings.TrimSpace(req.Title); title != "" {
		task.Title = title
	}
	task.Requirement = strings.TrimSpace(req.Requirement)
	task.OutputForms = model.NormalizeWorkspaceTaskOutputForms(req.OutputForms)
	task.AllowedExtensions = model.NormalizeWorkspaceTaskExtensions(req.AllowedExtensions)
	if req.MaxUploads != nil && *req.MaxUploads > 0 {
		task.MaxUploads = *req.MaxUploads
	}
	if req.MaxSubmits != nil && *req.MaxSubmits >= 0 {
		task.MaxSubmits = *req.MaxSubmits
	}
	task.ReferenceArtifacts = normalizeReferenceArtifactIds(req.ReferenceArtifacts)
	task.SortOrder = req.SortOrder
	if err := task.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, task)
}

func DeleteWorkspaceLessonTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "任务 ID 不能为空")
		return
	}
	if _, err := model.GetWorkspaceLessonTaskById(id); err != nil {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}
	if err := model.DeleteWorkspaceLessonTask(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// normalizeReferenceArtifactIds 归一化任务参考资料素材 id 列表（逗号分隔，去重去非法值）。
func normalizeReferenceArtifactIds(value string) string {
	ids := make([]string, 0, 8)
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == ' ' || r == '\t'
	}) {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		if _, err := strconv.Atoi(part); err != nil {
			continue
		}
		seen[part] = true
		ids = append(ids, part)
	}
	return strings.Join(ids, ",")
}
