package middleware

import (
	"bytes"
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// workspaceArtifactCaptureLimit 同步生成响应体的截留上限（图片 / 音频可能较大）。
const workspaceArtifactCaptureLimit = 64 * 1024 * 1024

// workspaceArtifactSaveTimeout 素材落盘（含上游下载）超时。
const workspaceArtifactSaveTimeout = 3 * time.Minute

// workspaceArtifactWriter 在写穿响应体的同时截留一份副本，供产物采集使用。
type workspaceArtifactWriter struct {
	gin.ResponseWriter
	capture *bytes.Buffer
	limit   int
	status  int
}

func (w *workspaceArtifactWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *workspaceArtifactWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.capture.Len() < w.limit {
		remain := w.limit - w.capture.Len()
		if len(b) <= remain {
			w.capture.Write(b)
		} else {
			w.capture.Write(b[:remain])
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *workspaceArtifactWriter) Status() int {
	if w.status != 0 {
		return w.status
	}
	return w.ResponseWriter.Status()
}

// WorkspaceArtifactCapture 中台生成链路的云端素材采集。
//
// 仅当请求经中台入口发起（WorkspaceSessionToken 打上 WorkspaceBillingContextKey）
// 时落盘；通过 API 直连（如 /v1/chat/completions）的请求不带该标记，因此不会被采集。
// 视频 / 音乐属异步任务，结果在任务终态后由轮询链路下载，这里跳过。
func WorkspaceArtifactCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !c.GetBool(service.WorkspaceBillingContextKey) {
			c.Next()
			return
		}
		kind := c.GetString(WorkspaceCapabilityKindKey)
		if kind == "" || kind == "video" || kind == "music" {
			c.Next()
			return
		}

		userId := c.GetInt("id")

		writer := &workspaceArtifactWriter{
			ResponseWriter: c.Writer,
			capture:        &bytes.Buffer{},
			limit:          workspaceArtifactCaptureLimit,
		}
		c.Writer = writer
		c.Next()

		status := writer.Status()
		if status < 200 || status >= 300 || writer.capture.Len() == 0 {
			return
		}
		meta := service.WorkspaceArtifactMeta{
			UserId:  userId,
			ClassId: model.GetWorkspaceClassIdByUserId(userId),
			Kind:    kind,
			Model:   c.GetString("resolved_task_model"),
			Prompt:  workspaceExtractPrompt(c),
		}
		ctx, cancel := context.WithTimeout(context.Background(), workspaceArtifactSaveTimeout)
		defer cancel()
		if err := service.CollectWorkspaceSyncArtifact(ctx, meta, writer.Header().Get("Content-Type"), writer.capture.Bytes()); err != nil {
			common.SysError(common.LogText("workspace artifact capture failed: userId=%d kind=%s err=%s", meta.UserId, meta.Kind, err.Error()))
		}
	}
}
