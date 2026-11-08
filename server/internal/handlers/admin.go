package handlers

import (
	"net/http"

	"aiworkspace/server/internal/models"
)

// AdminOverview GET /api/admin/overview：管理员总览统计（只读）。
func (h *API) AdminOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var overview models.AdminOverview

	queries := []struct {
		dest *int
		sql  string
	}{
		{&overview.TeacherCount, `SELECT COUNT(*) FROM users WHERE role = 'TEACHER'`},
		{&overview.StudentCount, `SELECT COUNT(*) FROM users WHERE role = 'STUDENT'`},
		{&overview.ClassCount, `SELECT COUNT(*) FROM classes`},
		{&overview.TopicCount, `SELECT COUNT(*) FROM topics`},
		{&overview.SubmissionCount, `SELECT COUNT(*) FROM submissions`},
		{&overview.EvaluationCount, `SELECT COUNT(*) FROM evaluations`},
	}
	for _, q := range queries {
		if err := h.DB.QueryRowContext(ctx, q.sql).Scan(q.dest); err != nil {
			serverError(w, err)
			return
		}
	}

	writeJSON(w, http.StatusOK, overview)
}
