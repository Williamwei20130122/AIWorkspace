package handlers

import (
	"context"
	"log"
	"net/http"
	"time"

	"aiworkspace/server/internal/models"
)

// Health GET /api/health：SQLite ping 成功返回 200，否则 503。
func (h *API) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if err := h.DB.PingContext(ctx); err != nil {
		log.Printf("健康检查失败：数据库不可用：%v", err)
		writeError(w, http.StatusServiceUnavailable, "数据库连接失败")
		return
	}

	writeJSON(w, http.StatusOK, models.Health{
		OK:      true,
		Service: "aiworkspace",
		Time:    time.Now().UTC().Format(time.RFC3339),
	})
}
