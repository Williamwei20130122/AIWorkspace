package controller

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/artifactstore"

	"github.com/gin-gonic/gin"
)

const workspaceSubmissionMaxBytes = 200 << 20 // 单次提交文件上限 200MB

// classSessionReference 参考资料摘要：学生端任务面板直接展示，内容走素材鉴权接口。
type classSessionReference struct {
	Id       int    `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size_bytes"`
	// Url 受鉴权的素材内容地址，学生点击即可预览/下载。
	Url string `json:"url"`
	// Missing 素材已被删除：仅保留占位提示。
	Missing bool `json:"missing"`
}

// classSessionTaskView 学生端任务面板所需的「任务 + 我的提交」视图。
type classSessionTaskView struct {
	Id                int    `json:"id"`
	Title             string `json:"title"`
	Requirement       string `json:"requirement"`
	OutputForms       string `json:"output_forms"`
	AllowedExtensions string `json:"allowed_extensions"`
	MaxUploads        int    `json:"max_uploads"`
	MaxSubmits        int    `json:"max_submits"`
	// ReferenceArtifacts 备课时挂载的参考资料素材 id 列表（逗号分隔）。
	ReferenceArtifacts string                           `json:"reference_artifacts"`
	References         []*classSessionReference         `json:"references"`
	SortOrder          int                              `json:"sort_order"`
	MySubmissions      []*model.WorkspaceTaskSubmission `json:"my_submissions"`
}

// GetWorkspaceClassSession 学生端：返回所在小班当前进行中的课堂会话与全部分项任务。
func GetWorkspaceClassSession(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "登录状态无效，请重新登录")
		return
	}
	session, err := model.GetWorkspaceActiveClassSessionForUser(userId)
	if err != nil {
		// 没有进行中的课堂不是错误，返回空会话供前端展示占位。
		common.ApiSuccess(c, gin.H{"session": nil, "tasks": []classSessionTaskView{}})
		return
	}
	tasks, err := model.ListWorkspaceLessonTasks(session.LessonId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	submissions, err := model.ListWorkspaceSubmissionsBySessionUser(session.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byTask := make(map[int][]*model.WorkspaceTaskSubmission)
	for _, item := range submissions {
		byTask[item.TaskId] = append(byTask[item.TaskId], item)
	}
	views := make([]classSessionTaskView, 0, len(tasks))
	for _, task := range tasks {
		forms := model.NormalizeWorkspaceTaskOutputForms(task.OutputForms)
		item := classSessionTaskView{
			Id:                 task.Id,
			Title:              task.Title,
			Requirement:        task.Requirement,
			OutputForms:        forms,
			AllowedExtensions:  model.NormalizeWorkspaceTaskExtensions(task.AllowedExtensions),
			MaxUploads:         task.MaxUploads,
			MaxSubmits:         task.MaxSubmits,
			ReferenceArtifacts: task.ReferenceArtifacts,
			SortOrder:          task.SortOrder,
		}
		if item.MaxUploads <= 0 {
			item.MaxUploads = 1
		}
		if list := byTask[task.Id]; len(list) > 0 {
			item.MySubmissions = list
		} else {
			item.MySubmissions = []*model.WorkspaceTaskSubmission{}
		}
		item.References = buildClassSessionReferences(task.ReferenceArtifacts)
		views = append(views, item)
	}
	session.MySubmissionCount = len(submissions)
	common.ApiSuccess(c, gin.H{"session": session, "tasks": views})
}

// buildClassSessionReferences 把任务上的参考资料素材 id 列表解析为学生端展示摘要。
// 已删除的素材保留占位（Missing），避免任务保存后引用悬空导致面板报错。
func buildClassSessionReferences(raw string) []*classSessionReference {
	ids := make([]int, 0)
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' '
	}) {
		if id, err := strconv.Atoi(part); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return []*classSessionReference{}
	}
	items, err := model.GetWorkspaceArtifactsByIds(ids)
	if err != nil {
		return []*classSessionReference{}
	}
	byId := make(map[int]*model.WorkspaceArtifact, len(items))
	for _, item := range items {
		byId[item.Id] = item
	}
	refs := make([]*classSessionReference, 0, len(ids))
	for _, id := range ids {
		artifact := byId[id]
		if artifact == nil {
			refs = append(refs, &classSessionReference{Id: id, Missing: true})
			continue
		}
		refs = append(refs, &classSessionReference{
			Id:       artifact.Id,
			Name:     workspaceReferenceDisplayName(artifact),
			Kind:     artifact.Kind,
			MimeType: artifact.MimeType,
			Size:     artifact.SizeBytes,
			Url:      fmt.Sprintf("/api/workspace/artifacts/%d/content", artifact.Id),
			Missing:  artifact.FilePurged,
		})
	}
	return refs
}

// workspaceReferenceDisplayName 参考资料展示名：input 素材的 Prompt 保存了原始文件名，
// 生成类素材回落到提示词摘要或存储文件名。
func workspaceReferenceDisplayName(artifact *model.WorkspaceArtifact) string {
	if prompt := strings.TrimSpace(artifact.Prompt); prompt != "" {
		if runes := []rune(prompt); len(runes) > 30 {
			return string(runes[:30]) + "…"
		}
		return prompt
	}
	return filepath.Base(artifact.StoragePath)
}

// createSubmissionRequest 文字 / AI 作品提交请求体。
type createSubmissionRequest struct {
	TaskId      int    `json:"task_id"`
	ContentType string `json:"content_type"`
	Text        string `json:"text"`
	AssetUrl    string `json:"asset_url"`
	Capability  string `json:"capability"`
	Prompt      string `json:"prompt"`
	Params      string `json:"params"`
	ResultText  string `json:"result_text"`
}

// CreateWorkspaceTaskSubmission 学生端：提交大段文字或 AI 生成作品。
func CreateWorkspaceTaskSubmission(c *gin.Context) {
	userId := c.GetInt("id")
	var req createSubmissionRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiErrorMsg(c, "提交内容格式不正确")
		return
	}
	session, task, err := resolveSessionTaskForSubmission(userId, req.TaskId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = model.WorkspaceSubmissionText
	}
	if !taskAllowsOutputForm(task, contentType) {
		common.ApiErrorMsg(c, "该分项任务不支持当前提交形式")
		return
	}
	if err := checkTaskSubmitLimit(session.Id, task, userId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	submission := &model.WorkspaceTaskSubmission{
		SessionId:    session.Id,
		TaskId:       task.Id,
		UserId:       userId,
		SmallClassId: session.SmallClassId,
		ContentType:  contentType,
		Capability:   strings.TrimSpace(req.Capability),
		Prompt:       truncateRunes(strings.TrimSpace(req.Prompt), 1000),
		Params:       truncateRunes(strings.TrimSpace(req.Params), 4000),
	}
	switch contentType {
	case model.WorkspaceSubmissionText:
		text := strings.TrimSpace(req.Text)
		if text == "" {
			common.ApiErrorMsg(c, "请输入提交内容")
			return
		}
		submission.TextContent = text
	case model.WorkspaceSubmissionAI:
		assetUrl := strings.TrimSpace(req.AssetUrl)
		if assetUrl == "" && strings.TrimSpace(req.ResultText) == "" {
			common.ApiErrorMsg(c, "未找到可提交的作品内容")
			return
		}
		submission.ResultText = req.ResultText
		if strings.HasPrefix(assetUrl, "data:") {
			artifact, err := saveSubmissionDataUrl(userId, session.SmallClassId, assetUrl, submission.Capability)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			if artifact != nil {
				submission.ArtifactId = artifact.Id
				submission.MimeType = artifact.MimeType
				submission.SizeBytes = artifact.SizeBytes
				submission.FileName = submissionArtifactFilename(submission.Capability)
			}
		} else {
			submission.AssetUrl = assetUrl
		}
	default:
		common.ApiErrorMsg(c, "请使用文件上传接口提交文件")
		return
	}

	if err := submission.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	fillSubmissionDisplay([]*model.WorkspaceTaskSubmission{submission})
	common.ApiSuccess(c, submission)
}

// UploadWorkspaceTaskSubmissionFile 学生端：上传文件并提交到指定分项任务（E2/E7）。
func UploadWorkspaceTaskSubmissionFile(c *gin.Context) {
	userId := c.GetInt("id")
	taskId := 0
	if value := strings.TrimSpace(c.PostForm("task_id")); value != "" {
		_, _ = fmt.Sscan(value, &taskId)
	}
	session, task, err := resolveSessionTaskForSubmission(userId, taskId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if !taskAllowsOutputForm(task, model.WorkspaceSubmissionFile) {
		common.ApiErrorMsg(c, "该分项任务不支持文件上传")
		return
	}
	if err := checkTaskSubmitLimit(session.Id, task, userId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	if fileHeader.Size > workspaceSubmissionMaxBytes {
		common.ApiErrorMsg(c, fmt.Sprintf("文件过大，最大支持 %dMB", workspaceSubmissionMaxBytes>>20))
		return
	}
	if !model.WorkspaceTaskAllowsExtension(task, fileHeader.Filename) {
		common.ApiErrorMsg(c, "文件格式不在该任务允许的范围内")
		return
	}
	existing, err := model.CountWorkspaceTaskFileSubmissions(session.Id, task.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	maxUploads := task.MaxUploads
	if maxUploads <= 0 {
		maxUploads = 1
	}
	if int(existing) >= maxUploads {
		common.ApiErrorMsg(c, fmt.Sprintf("该任务最多提交 %d 个文件", maxUploads))
		return
	}

	source, err := fileHeader.Open()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer source.Close()
	mimeType := strings.TrimSpace(fileHeader.Header.Get("Content-Type"))
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mimeTypeForUploadName(fileHeader.Filename)
	}
	ctx, cancel := context.WithTimeout(context.Background(), workspaceUploadTimeout)
	defer cancel()
	artifact, err := service.SaveWorkspaceInputArtifact(
		ctx,
		userId,
		model.GetWorkspaceClassIdByUserId(userId),
		fileHeader.Filename,
		mimeType,
		source,
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if artifact == nil {
		common.ApiErrorMsg(c, "上传失败，请重新登录后重试")
		return
	}
	submission := &model.WorkspaceTaskSubmission{
		SessionId:    session.Id,
		TaskId:       task.Id,
		UserId:       userId,
		SmallClassId: session.SmallClassId,
		ContentType:  model.WorkspaceSubmissionFile,
		FileName:     fileHeader.Filename,
		ArtifactId:   artifact.Id,
		MimeType:     artifact.MimeType,
		SizeBytes:    artifact.SizeBytes,
	}
	if err := submission.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	fillSubmissionDisplay([]*model.WorkspaceTaskSubmission{submission})
	common.ApiSuccess(c, submission)
}

// resolveSessionTaskForSubmission 校验学生身份、当前课堂会话与任务归属。
func resolveSessionTaskForSubmission(userId, taskId int) (*model.WorkspaceClassSession, *model.WorkspaceLessonTask, error) {
	if userId <= 0 {
		return nil, nil, fmt.Errorf("登录状态无效，请重新登录")
	}
	if _, err := model.GetWorkspaceStudentByUserId(userId); err != nil {
		return nil, nil, fmt.Errorf("当前账号不是学生账号，无法提交课堂任务")
	}
	session, err := model.GetWorkspaceActiveClassSessionForUser(userId)
	if err != nil {
		return nil, nil, fmt.Errorf("当前没有进行中的课堂")
	}
	if taskId <= 0 {
		return nil, nil, fmt.Errorf("请选择要提交的分项任务")
	}
	task, err := model.GetWorkspaceLessonTaskById(taskId)
	if err != nil {
		return nil, nil, fmt.Errorf("分项任务不存在")
	}
	if task.LessonId != session.LessonId {
		return nil, nil, fmt.Errorf("该分项任务不属于当前课堂")
	}
	return session, task, nil
}

// checkTaskSubmitLimit 校验学生对该任务的提交次数上限（max_submits，0 为不限，无时间限制）。
func checkTaskSubmitLimit(sessionId int, task *model.WorkspaceLessonTask, userId int) error {
	if task.MaxSubmits <= 0 {
		return nil
	}
	count, err := model.CountWorkspaceTaskSubmissions(sessionId, task.Id, userId)
	if err != nil {
		return err
	}
	if int(count) >= task.MaxSubmits {
		return fmt.Errorf("该任务最多提交 %d 次，已达上限", task.MaxSubmits)
	}
	return nil
}

// taskAllowsOutputForm 判断任务是否允许指定产出形式。
func taskAllowsOutputForm(task *model.WorkspaceLessonTask, form string) bool {
	if task == nil {
		return false
	}
	for _, item := range strings.Split(model.NormalizeWorkspaceTaskOutputForms(task.OutputForms), ",") {
		if strings.TrimSpace(item) == form {
			return true
		}
	}
	return false
}

// saveSubmissionDataUrl 把 data URL（b64）形式的 AI 作品落盘，返回本地素材。
func saveSubmissionDataUrl(userId, classId int, dataUrl, capability string) (*model.WorkspaceArtifact, error) {
	comma := strings.Index(dataUrl, ",")
	if comma < 0 {
		return nil, fmt.Errorf("作品内容格式不正确")
	}
	header := dataUrl[:comma]
	encoded := dataUrl[comma+1:]
	if !strings.Contains(header, ";base64") {
		return nil, fmt.Errorf("作品内容格式不正确")
	}
	mimeType := strings.TrimPrefix(strings.Split(header, ";")[0], "data:")
	if mimeType == "" || !strings.Contains(mimeType, "/") {
		mimeType = "application/octet-stream"
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("作品内容解码失败")
	}
	ext := submissionArtifactExtension(mimeType, capability)
	ctx, cancel := context.WithTimeout(context.Background(), workspaceUploadTimeout)
	defer cancel()
	return service.SaveWorkspaceInputArtifact(ctx, userId, classId, "作品"+ext, mimeType, bytes.NewReader(decoded))
}

func submissionArtifactExtension(mimeType, capability string) string {
	switch capability {
	case "video":
		return ".mp4"
	case "music", "tts":
		return ".mp3"
	}
	switch strings.ToLower(mimeType) {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	}
	return ".bin"
}

func submissionArtifactFilename(capability string) string {
	return "作品" + submissionArtifactExtension("", capability)
}

// fillSubmissionDisplay 回填任务标题与学生姓名，供教师概览与学生端列表展示。
func fillSubmissionDisplay(list []*model.WorkspaceTaskSubmission) {
	for _, item := range list {
		if item == nil {
			continue
		}
		if task, err := model.GetWorkspaceLessonTaskById(item.TaskId); err == nil {
			item.TaskTitle = task.Title
		}
		if student, err := model.GetWorkspaceStudentByUserId(item.UserId); err == nil {
			item.StudentName = student.DisplayName
			item.StudentNo = student.StudentNo
		}
	}
}

// ---------- 教师端：分发与概览 ----------

type distributeLessonRequest struct {
	SmallClassId int `json:"small_class_id"`
	LessonId     int `json:"lesson_id"`
	// Theme 本节课主题：可选，留空由后端回落课时标题。
	Theme string `json:"theme"`
}

// DistributeWorkspaceLesson 教师端：把课时一键分发到小班（D2）。
func DistributeWorkspaceLesson(c *gin.Context) {
	var req distributeLessonRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiErrorMsg(c, "请求参数格式不正确")
		return
	}
	if req.SmallClassId <= 0 {
		common.ApiErrorMsg(c, "请选择小班")
		return
	}
	if req.LessonId <= 0 {
		common.ApiErrorMsg(c, "请选择课时主题")
		return
	}
	session, err := model.DistributeWorkspaceLesson(req.SmallClassId, req.LessonId, c.GetInt("id"), req.Theme)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, session)
}

// tempSessionTaskItem 临时课堂的单个任务环节（v1.1）。
type tempSessionTaskItem struct {
	Title       string `json:"title"`
	Requirement string `json:"requirement"`
	// OutputForms 提交内容类型，逗号分隔：text / file / ai。
	OutputForms string `json:"output_forms"`
}

type createTempSessionRequest struct {
	SmallClassId int                   `json:"small_class_id"`
	Theme        string                `json:"theme"`
	Tasks        []tempSessionTaskItem `json:"tasks"`
}

// CreateTempWorkspaceClassSession 教师端：临时发起课堂（v1.1）。
// 不依赖备课方案，直接按教师选择的任务环节数量与提交内容类型创建一次性课堂。
func CreateTempWorkspaceClassSession(c *gin.Context) {
	var req createTempSessionRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiErrorMsg(c, "请求参数格式不正确")
		return
	}
	if req.SmallClassId <= 0 {
		common.ApiErrorMsg(c, "请选择小班")
		return
	}
	if len(req.Tasks) == 0 || len(req.Tasks) > 20 {
		common.ApiErrorMsg(c, "请设置 1-20 个任务环节")
		return
	}
	tasks := make([]*model.WorkspaceLessonTask, 0, len(req.Tasks))
	for index, item := range req.Tasks {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = fmt.Sprintf("任务%d", index+1)
		}
		forms := model.NormalizeWorkspaceTaskOutputForms(item.OutputForms)
		tasks = append(tasks, &model.WorkspaceLessonTask{
			Title:       truncateRunes(title, 128),
			Requirement: truncateRunes(strings.TrimSpace(item.Requirement), 4000),
			OutputForms: forms,
			MaxUploads:  1,
		})
	}
	session, err := model.CreateTempWorkspaceClassSession(req.SmallClassId, c.GetInt("id"), req.Theme, tasks)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, session)
}

// CloseWorkspaceClassSession 教师端：结束授课。
func CloseWorkspaceClassSession(c *gin.Context) {
	id, _ := parsePathInt(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "课堂会话 ID 不能为空")
		return
	}
	if _, err := model.GetWorkspaceClassSessionById(id); err != nil {
		common.ApiErrorMsg(c, "课堂会话不存在")
		return
	}
	if err := model.CloseWorkspaceClassSession(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetWorkspaceClassSessions 教师端：按小班列出课堂会话。
func GetWorkspaceClassSessions(c *gin.Context) {
	smallClassId, _ := parsePathInt(c.Query("small_class_id"))
	list, err := model.ListWorkspaceClassSessions(smallClassId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, list)
}

// GetWorkspaceClassSessionDetail 教师端：查看某次课堂的任务与全部学生提交（D3/D5）。
func GetWorkspaceClassSessionDetail(c *gin.Context) {
	id, _ := parsePathInt(c.Param("id"))
	session, err := model.GetWorkspaceClassSessionById(id)
	if err != nil {
		common.ApiErrorMsg(c, "课堂会话不存在")
		return
	}
	tasks, err := model.ListWorkspaceLessonTasks(session.LessonId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	submissions, err := model.ListWorkspaceSubmissionsBySession(session.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	fillSubmissionDisplay(submissions)
	common.ApiSuccess(c, gin.H{"session": session, "tasks": tasks, "submissions": submissions})
}

// GetWorkspaceClassSessionProgress 教师端（v1.1）：学生 × 任务完成情况矩阵。
// 行为小班全部学生（含无提交学生），列为本节课的分项任务，便于实时掌握每人进度。
func GetWorkspaceClassSessionProgress(c *gin.Context) {
	id, _ := parsePathInt(c.Param("id"))
	session, err := model.GetWorkspaceClassSessionById(id)
	if err != nil {
		common.ApiErrorMsg(c, "课堂会话不存在")
		return
	}
	tasks, err := model.ListWorkspaceLessonTasks(session.LessonId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	submissions, err := model.ListWorkspaceSubmissionsBySession(session.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	members, err := model.GetWorkspaceSmallClassMembers(session.SmallClassId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	type taskProgress struct {
		TaskId    int   `json:"task_id"`
		Submitted bool  `json:"submitted"`
		Count     int   `json:"count"`
		LastAt    int64 `json:"last_at"`
	}
	type studentProgress struct {
		UserId        int            `json:"user_id"`
		StudentName   string         `json:"student_name"`
		StudentNo     string         `json:"student_no"`
		Quota         int            `json:"quota"`
		UsedQuota     int            `json:"used_quota"`
		Tasks         []taskProgress `json:"tasks"`
		CompletedTask int            `json:"completed_task"`
		SubmissionCnt int            `json:"submission_cnt"`
	}

	// 提交索引：user → task → 统计。
	type submitStat struct {
		count int
		last  int64
	}
	statMap := make(map[int]map[int]*submitStat)
	for _, item := range submissions {
		byTask := statMap[item.UserId]
		if byTask == nil {
			byTask = make(map[int]*submitStat)
			statMap[item.UserId] = byTask
		}
		stat := byTask[item.TaskId]
		if stat == nil {
			stat = &submitStat{}
			byTask[item.TaskId] = stat
		}
		stat.count++
		if item.CreatedAt > stat.last {
			stat.last = item.CreatedAt
		}
	}

	// 学生行：小班成员优先，出现过提交但已被移出小班的学生也保留（避免漏看提交）。
	rows := make([]studentProgress, 0, len(members))
	seen := make(map[int]bool, len(members))
	appendRow := func(userId int, name, no string, quota, usedQuota int) {
		if seen[userId] {
			return
		}
		seen[userId] = true
		row := studentProgress{
			UserId:      userId,
			StudentName: name,
			StudentNo:   no,
			Quota:       quota,
			UsedQuota:   usedQuota,
			Tasks:       make([]taskProgress, 0, len(tasks)),
		}
		for _, task := range tasks {
			tp := taskProgress{TaskId: task.Id}
			if stat := statMap[userId][task.Id]; stat != nil {
				tp.Submitted = true
				tp.Count = stat.count
				tp.LastAt = stat.last
				row.CompletedTask++
				row.SubmissionCnt += stat.count
			}
			row.Tasks = append(row.Tasks, tp)
		}
		rows = append(rows, row)
	}
	for _, member := range members {
		appendRow(member.UserId, member.DisplayName, member.StudentNo, member.Quota, member.UsedQuota)
	}
	for userId := range statMap {
		if seen[userId] {
			continue
		}
		name, no, quota, used := "", "", 0, 0
		if student, err := model.GetWorkspaceStudentByUserId(userId); err == nil {
			name = student.DisplayName
			no = student.StudentNo
		}
		quota, _ = model.GetUserQuota(userId, true)
		used, _ = model.GetUserUsedQuota(userId)
		appendRow(userId, name, no, quota, used)
	}

	common.ApiSuccess(c, gin.H{
		"session":  session,
		"tasks":    tasks,
		"students": rows,
	})
}

// PackageWorkspaceClassSession 教师端：把某次课堂的全部提交打包为 ZIP（D4）。
// 文字提交写入 .txt；文件与 AI 落盘产物直接打包；仅有上游直链的 AI 作品
// 生成说明文件，避免出现空条目。
func PackageWorkspaceClassSession(c *gin.Context) {
	id, _ := parsePathInt(c.Param("id"))
	session, err := model.GetWorkspaceClassSessionById(id)
	if err != nil {
		common.ApiErrorMsg(c, "课堂会话不存在")
		return
	}
	submissions, err := model.ListWorkspaceSubmissionsBySession(session.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(submissions) == 0 {
		common.ApiErrorMsg(c, "该课堂还没有学生提交")
		return
	}
	fillSubmissionDisplay(submissions)
	tasks, _ := model.ListWorkspaceLessonTasks(session.LessonId)
	folders := make(map[int]string, len(tasks))
	for index, task := range tasks {
		folders[task.Id] = fmt.Sprintf("%02d_%s", index+1, sanitizeArchiveName(task.Title))
	}

	store := artifactstore.Default()
	filename := fmt.Sprintf("class-session-%d-%s.zip", session.Id, time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Status(200)
	writer := zip.NewWriter(c.Writer)
	defer writer.Close()
	used := make(map[string]int)

	for _, item := range submissions {
		dir := folders[item.TaskId]
		if dir == "" {
			dir = fmt.Sprintf("task-%d", item.TaskId)
		}
		base := strings.Trim(sanitizeArchiveName(item.StudentName)+"_"+sanitizeArchiveName(item.StudentNo), "_")
		if base == "" {
			base = fmt.Sprintf("user-%d", item.UserId)
		}
		switch item.ContentType {
		case model.WorkspaceSubmissionText:
			// 文字作业连同提示词一并打包，便于教师直接查看要求与内容。
			content := item.TextContent
			if item.Prompt != "" {
				content = "提示词 / 使用要求：\n" + item.Prompt + "\n\n提交内容：\n" + item.TextContent
			}
			writeArchiveText(writer, used, dir, base+"_文字.txt", content)
		case model.WorkspaceSubmissionFile, model.WorkspaceSubmissionAI:
			// 提示词与生成结果始终单独打包成说明文件，纯文字型 AI 作品不丢内容。
			if detail := buildSubmissionDetailNote(item); detail != "" {
				writeArchiveText(writer, used, dir, base+"_说明.txt", detail)
			}
			if item.ArtifactId > 0 {
				artifact, artifactErr := model.GetWorkspaceArtifactById(item.ArtifactId)
				if artifactErr == nil {
					reader, openErr := store.Open(artifact.StoragePath)
					if openErr != nil {
						common.SysError(common.LogText("class session package open failed: artifact=%d err=%s", artifact.Id, openErr.Error()))
					} else {
						name := strings.TrimSpace(item.FileName)
						if name == "" {
							name = filepath.Base(artifact.StoragePath)
						}
						entryName := uniqueArchiveName(used, dir, base+"_"+sanitizeArchiveName(name))
						entry, createErr := writer.Create(entryName)
						if createErr == nil {
							if _, copyErr := io.Copy(entry, reader); copyErr != nil {
								common.SysError(common.LogText("class session package copy failed: artifact=%d err=%s", artifact.Id, copyErr.Error()))
							}
						}
						_ = reader.Close()
						continue
					}
				}
			}
			// 无落盘产物（或读取失败）时写入详情说明，保证作品信息不丢失。
			if strings.TrimSpace(item.ResultText) != "" {
				writeArchiveText(writer, used, dir, base+"_结果文字.txt", item.ResultText)
			}
		}
	}
}

// writeArchiveText 向 zip 写入一个文本条目。
func writeArchiveText(writer *zip.Writer, used map[string]int, dir, name, content string) {
	if strings.TrimSpace(content) == "" {
		content = "（空内容）"
	}
	entry, err := writer.Create(uniqueArchiveName(used, dir, name))
	if err != nil {
		return
	}
	_, _ = entry.Write([]byte(content))
}

// uniqueArchiveName 生成 zip 内唯一路径，重名时追加序号。
func uniqueArchiveName(used map[string]int, dir, name string) string {
	if strings.TrimSpace(name) == "" {
		name = "未命名"
	}
	key := dir + "/" + name
	used[key]++
	if used[key] == 1 {
		return key
	}
	ext := filepath.Ext(name)
	return fmt.Sprintf("%s/%s(%d)%s", dir, strings.TrimSuffix(name, ext), used[key], ext)
}

// sanitizeArchiveName 去掉文件名中的非法字符与路径分隔符。
func sanitizeArchiveName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_", "\n", "_", "\r", "_", " ", "_")
	return replacer.Replace(value)
}

// buildSubmissionDetailNote 生成 AI 作品的说明文本（提示词 / 参数 / 结果 / 直链）。
func buildSubmissionDetailNote(item *model.WorkspaceTaskSubmission) string {
	var builder strings.Builder
	if item.Capability != "" {
		builder.WriteString("生成能力：" + item.Capability + "\n")
	}
	if item.Prompt != "" {
		builder.WriteString("提示词：\n" + item.Prompt + "\n")
	}
	if item.Params != "" {
		builder.WriteString("生成参数：\n" + item.Params + "\n")
	}
	if item.ResultText != "" {
		builder.WriteString("生成结果：\n" + item.ResultText + "\n")
	}
	if item.AssetUrl != "" {
		builder.WriteString("作品地址：\n" + item.AssetUrl + "\n")
	}
	return strings.TrimSpace(builder.String())
}

// parsePathInt 解析路径 / 查询参数中的正整数。
func parsePathInt(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("empty")
	}
	parsed := 0
	_, err := fmt.Sscan(value, &parsed)
	return parsed, err
}

// truncateRunes 按字符截断，避免中文被截半。
func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
