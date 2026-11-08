// Package handlers 实现 docs/CONTRACT.md 第 5 节的全部 /api 路由。
//
// 约定：
//   - 所有错误响应统一为 { "error": "中文文案" }；
//   - 参数校验失败 400、未登录 401、无权限 403、资源不存在 404；
//   - 所有查询都按当前登录用户过滤（教师只看自己的班，学生只看已加入的班）。
package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/models"
)

const (
	roleTeacher = "TEACHER"
	roleStudent = "STUDENT"

	// maxBodyBytes 请求体大小上限（1MB，足够本系统的文本请求）。
	maxBodyBytes = 1 << 20
)

// API 持有数据库与认证依赖，负责注册 /api 路由。
type API struct {
	DB   *sql.DB
	Auth *auth.Authenticator
}

// New 创建 API 实例。
func New(db *sql.DB, authenticator *auth.Authenticator) *API {
	return &API{DB: db, Auth: authenticator}
}

// Mount 把全部 /api 路由注册到 mux 上。
func (h *API) Mount(mux *http.ServeMux) {
	// 通用
	mux.HandleFunc("GET /api/health", h.Health)

	// 认证
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/auth/logout", h.Logout)
	mux.HandleFunc("GET /api/me", h.Auth.RequireUser(h.Me))

	// 教师端（需 TEACHER）
	mux.HandleFunc("GET /api/teacher/overview", h.Auth.RequireRole(roleTeacher, h.TeacherOverview))
	mux.HandleFunc("GET /api/teacher/classes", h.Auth.RequireRole(roleTeacher, h.TeacherClasses))
	mux.HandleFunc("POST /api/teacher/classes", h.Auth.RequireRole(roleTeacher, h.CreateClass))
	mux.HandleFunc("GET /api/teacher/classes/{id}", h.Auth.RequireRole(roleTeacher, h.TeacherClassDetail))
	mux.HandleFunc("POST /api/teacher/classes/{id}/courses", h.Auth.RequireRole(roleTeacher, h.CreateCourse))
	mux.HandleFunc("POST /api/teacher/classes/{id}/announcements", h.Auth.RequireRole(roleTeacher, h.CreateAnnouncement))
	mux.HandleFunc("GET /api/teacher/assignments", h.Auth.RequireRole(roleTeacher, h.TeacherAssignments))
	mux.HandleFunc("POST /api/teacher/assignments", h.Auth.RequireRole(roleTeacher, h.CreateAssignment))
	mux.HandleFunc("GET /api/teacher/assignments/{id}", h.Auth.RequireRole(roleTeacher, h.TeacherAssignmentDetail))
	mux.HandleFunc("POST /api/teacher/submissions/{id}/grade", h.Auth.RequireRole(roleTeacher, h.GradeSubmission))

	// 学生端（需 STUDENT）
	mux.HandleFunc("GET /api/student/overview", h.Auth.RequireRole(roleStudent, h.StudentOverview))
	mux.HandleFunc("GET /api/student/classes", h.Auth.RequireRole(roleStudent, h.StudentClasses))
	mux.HandleFunc("POST /api/student/classes/join", h.Auth.RequireRole(roleStudent, h.JoinClass))
	mux.HandleFunc("GET /api/student/assignments", h.Auth.RequireRole(roleStudent, h.StudentAssignments))
	mux.HandleFunc("GET /api/student/assignments/{id}", h.Auth.RequireRole(roleStudent, h.StudentAssignmentDetail))
	mux.HandleFunc("POST /api/student/assignments/{id}/submit", h.Auth.RequireRole(roleStudent, h.SubmitAssignment))
	mux.HandleFunc("GET /api/student/grades", h.Auth.RequireRole(roleStudent, h.StudentGrades))

	// 未匹配的 /api 路径统一返回 404 JSON（而不是前端 index.html）。
	notFound := func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "接口不存在")
	}
	mux.HandleFunc("/api", notFound)
	mux.HandleFunc("/api/", notFound)
}

/* ------------------------------------------------------------------ */
/* 响应与请求辅助                                                      */
/* ------------------------------------------------------------------ */

// writeJSON 输出 JSON 响应。
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("写入 JSON 响应失败：%v", err)
	}
}

// writeError 输出统一错误 JSON。
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// serverError 记录内部错误并返回 500（不把内部细节暴露给客户端）。
func serverError(w http.ResponseWriter, err error) {
	log.Printf("服务器内部错误：%v", err)
	writeError(w, http.StatusInternalServerError, "服务器内部错误")
}

// decodeJSON 解析请求体 JSON（限制 1MB）。
func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes)).Decode(dst)
}

// currentUser 取出 requireUser / requireRole 中间件写入的当前用户。
func currentUser(r *http.Request) *models.User {
	user, _ := auth.UserFromContext(r.Context())
	if user == nil {
		// 正常流程不会走到这里（中间件已保证已登录），兜底避免 nil 解引用。
		return &models.User{}
	}
	return user
}

// parseDateTime 解析可空时间参数，统一转成 RFC3339（UTC）字符串。
// 支持 RFC3339、datetime-local（"2006-01-02T15:04"）以及常见变体。
func parseDateTime(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	value := strings.TrimSpace(*raw)
	if value == "" {
		return nil, nil
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			normalized := parsed.UTC().Format(time.RFC3339)
			return &normalized, nil
		}
	}
	return nil, errors.New("截止时间格式不正确")
}

// strPtr 把可空字符串列转成 *string（JSON null）。
func strPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	s := value.String
	return &s
}

// intPtr 把可空整数列转成 *int（JSON null）。
func intPtr(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	n := int(value.Int64)
	return &n
}

// nullString 把 *string 转成 SQL 参数。
func nullString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}

// trimPtr 去掉可空字符串两端空白，空串返回 nil。
func trimPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
