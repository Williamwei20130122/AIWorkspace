package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// workspaceAsyncTaskItem 教师端大屏的单条异步任务汇总行。
type workspaceAsyncTaskItem struct {
	TaskID       string `json:"task_id"`
	Model        string `json:"model"`
	Action       string `json:"action"`
	Status       string `json:"status"`
	Progress     string `json:"progress"`
	SubmitTime   int64  `json:"submit_time"`
	FinishTime   int64  `json:"finish_time"`
	ResultURL    string `json:"result_url"`
	FailReason   string `json:"fail_reason,omitempty"`
	Username     string `json:"username"`
	UserId       int    `json:"user_id"`
	Platform     string `json:"platform"`
	Paused       bool   `json:"paused"`
	PollFailures int    `json:"poll_failures"`
	NextPollAt   int64  `json:"next_poll_at"`
}

func workspaceAsyncTaskToItem(task *model.Task) workspaceAsyncTaskItem {
	modelName := task.Properties.OriginModelName
	if modelName == "" {
		modelName = task.Properties.UpstreamModelName
	}
	username := ""
	if name, err := model.GetUsernameById(task.UserId, false); err == nil {
		username = name
	}
	return workspaceAsyncTaskItem{
		TaskID:       task.TaskID,
		Model:        modelName,
		Action:       task.Action,
		Status:       string(task.Status),
		Progress:     task.Progress,
		SubmitTime:   task.SubmitTime,
		FinishTime:   task.FinishTime,
		ResultURL:    task.PrivateData.ResultURL,
		FailReason:   task.FailReason,
		Username:     username,
		UserId:       task.UserId,
		Platform:     string(task.Platform),
		Paused:       task.PrivateData.PollPaused,
		PollFailures: task.PrivateData.PollFailures,
		NextPollAt:   task.PrivateData.NextPollAt,
	}
}

// GetWorkspaceAsyncTasks 教师端全局异步任务汇总列表：全部学生的异步任务统一展示，
// 按提交时间（id 即提交顺序）倒序，支持按状态筛选与分页。
func GetWorkspaceAsyncTasks(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	params := model.SyncTaskQueryParams{Status: c.Query("status")}
	tasks := model.TaskGetAllTasks((page-1)*pageSize, pageSize, params)
	total := model.TaskCountAllTasks(params)
	items := make([]workspaceAsyncTaskItem, 0, len(tasks))
	for _, task := range tasks {
		items = append(items, workspaceAsyncTaskToItem(task))
	}
	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// workspaceLoadTeacherTask 按公开任务 ID 加载任务（教师操作的统一入口）。
func workspaceLoadTeacherTask(c *gin.Context) (*model.Task, bool) {
	taskID := c.Param("id")
	if taskID == "" {
		common.ApiError(c, errors.New("task_id is required"))
		return nil, false
	}
	task, exist, err := model.GetByOnlyTaskId(taskID)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if !exist {
		common.ApiError(c, errors.New("task not found"))
		return nil, false
	}
	return task, true
}

// workspaceSetTaskPollPaused 写入暂停/恢复标记并追加操作日志。
func workspaceSetTaskPollPaused(c *gin.Context, paused bool) {
	task, ok := workspaceLoadTeacherTask(c)
	if !ok {
		return
	}
	operator, _ := model.GetUsernameById(c.GetInt("id"), false)
	task.PrivateData.PollPaused = paused
	if err := model.DB.Model(&model.Task{}).Where("id = ?", task.ID).
		Update("private_data", task.PrivateData).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	source := "pause"
	detail := "paused by " + operator
	if !paused {
		source = "resume"
		detail = "resumed by " + operator
	}
	model.InsertTaskStatusLog(&model.TaskStatusLog{
		TaskID:     task.TaskID,
		Platform:   string(task.Platform),
		UserId:     task.UserId,
		FromStatus: string(task.Status),
		ToStatus:   string(task.Status),
		Source:     source,
		Detail:     detail,
	})
	refreshed, _, err := model.GetByOnlyTaskId(task.TaskID)
	if err == nil && refreshed != nil {
		task = refreshed
	}
	common.ApiSuccess(c, workspaceAsyncTaskToItem(task))
}

// PauseWorkspaceAsyncTask 教师端手动暂停任务的自动轮询（仅教师端有此权限）。
func PauseWorkspaceAsyncTask(c *gin.Context) {
	workspaceSetTaskPollPaused(c, true)
}

// ResumeWorkspaceAsyncTask 教师端恢复被暂停任务的自动轮询。
func ResumeWorkspaceAsyncTask(c *gin.Context) {
	workspaceSetTaskPollPaused(c, false)
}

// QueryWorkspaceAsyncTask 教师端手动触发单次厂商状态查询：绕过轮询间隔与暂停状态，
// 立即查询一次并落库（状态变更日志来源记为 manual）。
func QueryWorkspaceAsyncTask(c *gin.Context) {
	task, ok := workspaceLoadTeacherTask(c)
	if !ok {
		return
	}
	refreshed, err := service.ManualPollTaskByID(c.Request.Context(), task.TaskID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, workspaceAsyncTaskToItem(refreshed))
}

// GetWorkspaceAsyncTaskLogs 教师端查看任务状态变更日志（含厂商接口原始参数详情）。
func GetWorkspaceAsyncTaskLogs(c *gin.Context) {
	taskID := c.Param("id")
	limit, _ := strconv.Atoi(c.Query("limit"))
	logs, err := model.GetTaskStatusLogs(taskID, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": logs, "total": len(logs)})
}
