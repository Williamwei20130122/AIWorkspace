package model

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// TaskStatusLog 异步任务状态变更日志：记录每次状态迁移及厂商接口返回的原始参数，
// 供教师端排查任务卡顿、核对厂商请求/响应。日志只增不改。
type TaskStatusLog struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	TaskID     string `json:"task_id" gorm:"type:varchar(191);index"`
	Platform   string `json:"platform" gorm:"type:varchar(30);index"`
	UserId     int    `json:"user_id" gorm:"index"`
	FromStatus string `json:"from_status" gorm:"type:varchar(20)"`
	ToStatus   string `json:"to_status" gorm:"type:varchar(20)"`
	// Source 变更来源：submit（提交响应）| poll（自动轮询）| manual（教师手动查询）|
	// pause / resume（教师暂停/恢复）| timeout（超时清理）。
	Source string `json:"source" gorm:"type:varchar(20);index"`
	// Detail 补充信息（失败原因、HTTP 状态码、暂停操作人等）。
	Detail string `json:"detail" gorm:"type:text"`
	// RawResponse 厂商接口返回的原始 JSON（提交与查询响应全量保存；超长截断）。
	RawResponse string `json:"raw_response" gorm:"type:text"`
	CreatedAt   int64  `json:"created_at" gorm:"index"`
}

// taskStatusLogMaxRawBytes 单条日志原始返回的保存上限（截断而非丢弃，避免撑爆存储）。
const taskStatusLogMaxRawBytes = 64 * 1024

// InsertTaskStatusLog 写入一条状态变更日志；写库失败仅记系统日志，不阻断任务链路。
func InsertTaskStatusLog(entry *TaskStatusLog) {
	if entry == nil {
		return
	}
	if entry.CreatedAt == 0 {
		entry.CreatedAt = time.Now().Unix()
	}
	if len(entry.RawResponse) > taskStatusLogMaxRawBytes {
		cut := entry.RawResponse[:taskStatusLogMaxRawBytes]
		// 截断可能落在多字节字符中间；Postgres text 拒绝无效 UTF-8。
		entry.RawResponse = strings.ToValidUTF8(cut, "") + "…[truncated]"
	}
	if err := DB.Create(entry).Error; err != nil {
		common.SysError(common.LogText("insert task status log failed: task=%s err=%s", entry.TaskID, err.Error()))
	}
}

// GetTaskStatusLogs 按公开任务 ID 查询状态变更日志（时间倒序，最新在前）。
func GetTaskStatusLogs(taskID string, limit int) ([]*TaskStatusLog, error) {
	if taskID == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var logs []*TaskStatusLog
	err := DB.Where("task_id = ?", taskID).Order("id desc").Limit(limit).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}
