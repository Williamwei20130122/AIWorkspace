package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedAutoLogCleanupRows writes two old and one recent row to each table the
// automatic cleanup empties.
func seedAutoLogCleanupRows(t *testing.T, now int64) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.AuditLog{}))
	t.Cleanup(func() {
		require.NoError(t, model.DB.Exec("DELETE FROM audit_logs").Error)
	})
	for _, createdAt := range []int64{now - 30*24*60*60, now - 20*24*60*60, now - 60} {
		require.NoError(t, model.DB.Create(&model.Log{
			UserId:    1,
			CreatedAt: createdAt,
			Content:   "usage log",
		}).Error)
		require.NoError(t, model.DB.Create(&model.Task{
			TaskID:    fmt.Sprintf("task-%d", createdAt),
			UserId:    1,
			Status:    model.TaskStatusSuccess,
			Progress:  "100%",
			CreatedAt: createdAt,
		}).Error)
		require.NoError(t, model.DB.Create(&model.AuditLog{
			EventId:   fmt.Sprintf("event-%d", createdAt),
			UserId:    1,
			CreatedAt: createdAt,
			Category:  model.AuditCategoryLogin,
		}).Error)
	}
}

func claimAutoLogCleanupTask(t *testing.T, payload AutoLogCleanupPayload) (*model.SystemTask, string) {
	t.Helper()
	task, err := model.CreateSystemTask(model.SystemTaskTypeAutoLogCleanup, payload, nil)
	require.NoError(t, err)
	runnerID := "runner-auto-log"
	claimed, ok, err := model.ClaimSystemTask(task.ID, task.Type, runnerID, common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	return claimed, runnerID
}

func TestRunAutoLogCleanupTaskDeletesOldTaskAuditAndUsageLogs(t *testing.T) {
	truncate(t)
	now := common.GetTimestamp()
	seedAutoLogCleanupRows(t, now)

	cutoff := now - 10*24*60*60
	task, runnerID := claimAutoLogCleanupTask(t, AutoLogCleanupPayload{
		TargetTimestamp: cutoff,
		BatchSize:       1,
	})

	runAutoLogCleanupTask(context.Background(), task, runnerID)

	latest, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, latest.Status)
	assert.Empty(t, latest.Error)

	for _, table := range []string{"logs", "tasks", "audit_logs"} {
		var oldRows, recentRows int64
		require.NoError(t, model.DB.Table(table).Where("created_at < ?", cutoff).Count(&oldRows).Error)
		require.NoError(t, model.DB.Table(table).Where("created_at >= ?", cutoff).Count(&recentRows).Error)
		assert.Zerof(t, oldRows, "expected no %s rows older than the retention window", table)
		assert.Equalf(t, int64(1), recentRows, "expected the recent %s row to survive", table)
	}

	var result AutoLogCleanupResult
	require.NoError(t, common.Unmarshal([]byte(latest.Result), &result))
	assert.Equal(t, int64(6), result.DeletedCount)
	assert.Equal(t, int64(2), result.UsageLogs)
	assert.Equal(t, int64(2), result.TaskLogs)
	assert.Equal(t, int64(2), result.AuditLogs)

	var state LogCleanupState
	require.NoError(t, common.Unmarshal([]byte(latest.State), &state))
	assert.Equal(t, 100, state.Progress)
	assert.Zero(t, state.Remaining)
}

func TestRunAutoLogCleanupTaskFinishesWithoutDeletingWhenDisabled(t *testing.T) {
	truncate(t)
	origSetting := *operation_setting.GetLogSetting()
	t.Cleanup(func() { *operation_setting.GetLogSetting() = origSetting })
	setting := operation_setting.GetLogSetting()
	setting.AutoCleanupEnabled = false
	setting.AutoCleanupRetentionDays = 120

	now := common.GetTimestamp()
	seedAutoLogCleanupRows(t, now)
	task, runnerID := claimAutoLogCleanupTask(t, AutoLogCleanupPayload{})

	runAutoLogCleanupTask(context.Background(), task, runnerID)

	latest, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, latest.Status)

	var oldRows int64
	require.NoError(t, model.DB.Model(&model.Log{}).Where("created_at < ?", now-10*24*60*60).Count(&oldRows).Error)
	assert.Equal(t, int64(2), oldRows, "switching the setting off must not delete anything")
}

func TestAutoLogCleanupHandlerSchedulesDailyWhenEnabled(t *testing.T) {
	handler := autoLogCleanupHandler{}
	require.Equal(t, model.SystemTaskTypeAutoLogCleanup, handler.Type())
	assert.Equal(t, 24*time.Hour, handler.Interval())

	origSetting := *operation_setting.GetLogSetting()
	t.Cleanup(func() { *operation_setting.GetLogSetting() = origSetting })
	setting := operation_setting.GetLogSetting()
	setting.AutoCleanupEnabled = true
	setting.AutoCleanupRetentionDays = 30

	require.True(t, handler.Enabled())
	payload, ok := handler.NewPayload().(AutoLogCleanupPayload)
	require.True(t, ok)
	assert.Equal(t, logCleanupBatchSize, payload.BatchSize)
	assert.InDelta(t, common.GetTimestamp()-30*24*60*60, payload.TargetTimestamp, 60)

	setting.AutoCleanupEnabled = false
	assert.False(t, handler.Enabled())
}
