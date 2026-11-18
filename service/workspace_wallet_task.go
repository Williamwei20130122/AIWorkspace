package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const workspaceWalletGrantTickInterval = 30 * time.Minute

var (
	workspaceWalletGrantOnce    sync.Once
	workspaceWalletGrantRunning atomic.Bool
)

// StartWorkspaceTeacherWalletGrantTask 启动教师钱包「每月固定日期自动发放」任务。
func StartWorkspaceTeacherWalletGrantTask() {
	workspaceWalletGrantOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), common.LogText("workspace teacher wallet grant task started: tick=%s", workspaceWalletGrantTickInterval))
			ticker := time.NewTicker(workspaceWalletGrantTickInterval)
			defer ticker.Stop()

			runWorkspaceTeacherWalletGrantOnce()
			for range ticker.C {
				runWorkspaceTeacherWalletGrantOnce()
			}
		})
	})
}

func runWorkspaceTeacherWalletGrantOnce() {
	if !workspaceWalletGrantRunning.CompareAndSwap(false, true) {
		return
	}
	defer workspaceWalletGrantRunning.Store(false)

	if granted := model.RunWorkspaceTeacherWalletAutoGrant(time.Now()); granted > 0 {
		logger.LogInfo(context.Background(), common.LogText("workspace teacher wallet auto grant: granted=%d", granted))
	}
}
