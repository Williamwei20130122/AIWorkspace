package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/artifactstore"
	"github.com/QuantumNous/new-api/setting"
)

// 中台数据定时清理口径：
//   - 系统日志 logs：保留 6 个月，每 6 个月清理一次（见 system_task.go 的 logCleanupHandler）；
//   - 毕业生账号：毕业停用后保留 1 年，每天检查一次，满 1 年彻底注销（删账号/明细/素材，保留名单档案）。
const (
	// logCleanupScheduleInterval 系统日志定时清理周期（6 个月）。
	logCleanupScheduleInterval = 180 * 24 * time.Hour
	// logCleanupScheduleRetention 系统日志保留时长（6 个月）。
	logCleanupScheduleRetention = 180 * 24 * time.Hour

	// graduatedAccountCheckInterval 毕业生账号注销检查周期（1 天）。
	graduatedAccountCheckInterval = 24 * time.Hour
	// graduatedAccountRetention 毕业生账号保留时长（1 年）。
	graduatedAccountRetention = 365 * 24 * time.Hour
	// graduatedAccountBatchSize 单批注销人数。
	graduatedAccountBatchSize = 200
)

// WorkspaceCleanupPayload 中台数据清理任务的载荷。
type WorkspaceCleanupPayload struct {
	// TargetTimestamp 清理边界：created_at 早于该时间戳的记录会被删除。
	TargetTimestamp int64 `json:"target_timestamp"`
	BatchSize       int   `json:"batch_size"`
}

// workspaceGraduatedPurgeHandler 定时注销毕业满 1 年的学生账号：
// 删除登录账号、生成明细、云端素材与能力额度，仅保留学生名单档案（标记为「已注销」）。
type workspaceGraduatedPurgeHandler struct{}

func (workspaceGraduatedPurgeHandler) Type() string {
	return model.SystemTaskTypeWorkspaceGraduatedPurge
}

func (workspaceGraduatedPurgeHandler) Enabled() bool { return true }

func (workspaceGraduatedPurgeHandler) Interval() time.Duration { return graduatedAccountCheckInterval }

func (workspaceGraduatedPurgeHandler) NewPayload() any {
	return WorkspaceCleanupPayload{
		TargetTimestamp: common.GetTimestamp() - int64(graduatedAccountRetention.Seconds()),
		BatchSize:       graduatedAccountBatchSize,
	}
}

func (workspaceGraduatedPurgeHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := WorkspaceCleanupPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if payload.TargetTimestamp <= 0 {
		payload.TargetTimestamp = common.GetTimestamp() - int64(graduatedAccountRetention.Seconds())
	}
	if payload.BatchSize <= 0 {
		payload.BatchSize = graduatedAccountBatchSize
	}

	store := artifactstore.Default()
	var (
		purged    int
		artifacts int
	)
	for {
		if err := ctx.Err(); err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		students, err := model.ListWorkspaceStudentsPendingDeletion(payload.TargetTimestamp, payload.BatchSize)
		if err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		if len(students) == 0 {
			break
		}
		for _, student := range students {
			if student == nil {
				continue
			}
			if student.UserId > 0 {
				// 1) 云端素材：先删文件再删索引（含已提交的课堂作品，账号注销时一并清理）。
				items, err := model.AllWorkspaceArtifacts(model.WorkspaceArtifactQuery{UserId: student.UserId})
				if err != nil {
					failSystemTask(task, runnerID, err)
					return
				}
				ids := make([]int, 0, len(items))
				for _, item := range items {
					if item == nil {
						continue
					}
					if err := store.Delete(item.StoragePath); err != nil {
						common.SysError(common.LogText("workspace graduated purge delete artifact failed: id=%d path=%s err=%s", item.Id, item.StoragePath, err.Error()))
					}
					ids = append(ids, item.Id)
				}
				if err := model.DeleteWorkspaceArtifactsByIds(ids); err != nil {
					failSystemTask(task, runnerID, err)
					return
				}
				artifacts += len(ids)
				// 2) 生成明细与能力额度。
				if _, err := model.DeleteWorkspaceUsagesByUserId(student.UserId); err != nil {
					failSystemTask(task, runnerID, err)
					return
				}
				if err := model.DeleteWorkspaceUserQuotas(student.UserId); err != nil {
					failSystemTask(task, runnerID, err)
					return
				}
				// 3) 登录账号（彻底删除）。
				if _, err := model.HardDeleteUserById(student.UserId); err != nil {
					failSystemTask(task, runnerID, err)
					return
				}
			}
			// 4) 名单档案保留，标记为「已注销」。
			if err := model.MarkWorkspaceStudentDeactivated(student.Id); err != nil {
				failSystemTask(task, runnerID, err)
				return
			}
			purged++
		}
	}

	result := map[string]any{"purged_count": purged, "artifacts_deleted": artifacts}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}

func init() {
	RegisterSystemTaskHandler(workspaceGraduatedPurgeHandler{})
	RegisterSystemTaskHandler(workspaceArtifactCleanupHandler{})
}

// workspaceArtifactCleanupHandler 云端素材自动清理：
// 素材创建超过配置的保留天数后删除磁盘文件，但保留数据库记录并打清理标记，
// 前端据标记禁止预览与下载；已被课堂作品提交引用的素材不清理。
// 保留天数为 0（默认）时任务不启用。
type workspaceArtifactCleanupHandler struct{}

func (workspaceArtifactCleanupHandler) Type() string {
	return model.SystemTaskTypeWorkspaceArtifactCleanup
}

func (workspaceArtifactCleanupHandler) Enabled() bool {
	return setting.GetWorkspaceArtifactRetentionDays() > 0
}

func (workspaceArtifactCleanupHandler) Interval() time.Duration { return 24 * time.Hour }

func (workspaceArtifactCleanupHandler) NewPayload() any { return nil }

// workspaceArtifactCleanupBatchSize 单批清理条数。
const workspaceArtifactCleanupBatchSize = 500

// workspaceArtifactCleanupMaxBatches 单次任务最多处理的批次数（防止任务过长）。
const workspaceArtifactCleanupMaxBatches = 100

func (workspaceArtifactCleanupHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	days := setting.GetWorkspaceArtifactRetentionDays()
	if days <= 0 {
		result := map[string]any{"retention_days": 0, "purged_count": 0, "released_bytes": 0}
		if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
			logSystemTaskLockError(ctx, task, err)
		}
		return
	}
	cutoff := common.GetTimestamp() - int64(days)*86400
	store := artifactstore.Default()
	var (
		purged   int
		released int64
	)
	for batch := 0; batch < workspaceArtifactCleanupMaxBatches; batch++ {
		if err := ctx.Err(); err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		items, err := model.ListExpiredWorkspaceArtifacts(cutoff, workspaceArtifactCleanupBatchSize)
		if err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		if len(items) == 0 {
			break
		}
		ids := make([]int, 0, len(items))
		for _, item := range items {
			if item == nil {
				continue
			}
			// 删除文件；文件不存在视同已清理，一并打标记。
			if err := store.Delete(item.StoragePath); err != nil {
				common.SysError(common.LogText("workspace artifact cleanup delete file failed: id=%d path=%s err=%s", item.Id, item.StoragePath, err.Error()))
				continue
			}
			ids = append(ids, item.Id)
			released += item.SizeBytes
		}
		if len(ids) == 0 {
			// 本批全部失败，退出避免死循环。
			break
		}
		if err := model.MarkWorkspaceArtifactsFilePurged(ids, common.GetTimestamp()); err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		purged += len(ids)
	}

	result := map[string]any{
		"retention_days": days,
		"purged_count":   purged,
		"released_bytes": released,
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
