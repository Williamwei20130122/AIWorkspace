// Package handlers 实现 docs/CONTRACT.md v3 第 4–6 节的全部 /api 路由。
//
// 约定：
//   - 所有错误响应统一为 { "error": "中文文案" }；
//   - 参数校验失败 400、未登录 401、无权限 403、资源不存在 404、冲突 409；
//   - 所有查询都按当前登录用户过滤（教师只看自己管理/协助的课题，学生只看自己加入过的课题）。
package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/db"
	"aiworkspace/server/internal/models"
)

const (
	roleTeacher = "TEACHER"
	roleStudent = "STUDENT"
	roleAdmin   = "ADMIN"

	statusActive = "ACTIVE"
	statusClosed = "CLOSED"

	joinModeAssigned = "ASSIGNED"

	// maxBodyBytes JSON 请求体大小上限（1MB，足够本系统的文本请求）。
	maxBodyBytes = 1 << 20
)

// API 持有数据库、认证与上传目录依赖，负责注册 /api 路由。
type API struct {
	DB        *sql.DB
	Auth      *auth.Authenticator
	UploadDir string
}

// New 创建 API 实例。
func New(database *sql.DB, authenticator *auth.Authenticator, uploadDir string) *API {
	return &API{DB: database, Auth: authenticator, UploadDir: uploadDir}
}

// Mount 把全部 /api 路由注册到 mux 上。
func (h *API) Mount(mux *http.ServeMux) {
	// 通用
	mux.HandleFunc("GET /api/health", h.Health)

	// 认证与当前用户
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/auth/register", h.Register)
	mux.HandleFunc("POST /api/auth/logout", h.Logout)
	mux.HandleFunc("GET /api/me", h.Auth.RequireUser(h.Me))
	mux.HandleFunc("POST /api/me/password", h.Auth.RequireUser(h.UpdateMyPassword))

	// 教师端（需 TEACHER）
	mux.HandleFunc("GET /api/teacher/overview", h.Auth.RequireRole(roleTeacher, h.TeacherOverview))
	mux.HandleFunc("GET /api/teacher/topics", h.Auth.RequireRole(roleTeacher, h.TeacherTopics))
	mux.HandleFunc("POST /api/teacher/topics", h.Auth.RequireRole(roleTeacher, h.CreateTopic))
	mux.HandleFunc("GET /api/teacher/topics/{id}", h.Auth.RequireRole(roleTeacher, h.TeacherTopicDetail))
	mux.HandleFunc("PATCH /api/teacher/topics/{id}", h.Auth.RequireRole(roleTeacher, h.UpdateTopic))

	mux.HandleFunc("POST /api/teacher/topics/{id}/assistants", h.Auth.RequireRole(roleTeacher, h.AddAssistant))
	mux.HandleFunc("DELETE /api/teacher/topics/{id}/assistants/{teacherId}", h.Auth.RequireRole(roleTeacher, h.RemoveAssistant))
	mux.HandleFunc("POST /api/teacher/topics/{id}/transfer", h.Auth.RequireRole(roleTeacher, h.TransferTopic))

	mux.HandleFunc("POST /api/teacher/topics/{id}/students", h.Auth.RequireRole(roleTeacher, h.AddTopicStudent))
	mux.HandleFunc("DELETE /api/teacher/topics/{id}/students/{studentId}", h.Auth.RequireRole(roleTeacher, h.RemoveTopicStudent))

	mux.HandleFunc("GET /api/teacher/topics/{id}/dimensions", h.Auth.RequireRole(roleTeacher, h.TeacherDimensions))
	mux.HandleFunc("POST /api/teacher/topics/{id}/dimensions", h.Auth.RequireRole(roleTeacher, h.CreateDimension))
	mux.HandleFunc("PATCH /api/teacher/topics/{id}/dimensions/{dimId}", h.Auth.RequireRole(roleTeacher, h.UpdateDimension))
	mux.HandleFunc("DELETE /api/teacher/topics/{id}/dimensions/{dimId}", h.Auth.RequireRole(roleTeacher, h.DeleteDimension))

	mux.HandleFunc("GET /api/teacher/students", h.Auth.RequireRole(roleTeacher, h.TeacherStudents))
	mux.HandleFunc("GET /api/teacher/students/lookup", h.Auth.RequireRole(roleTeacher, h.studentLookup))
	mux.HandleFunc("POST /api/teacher/students", h.Auth.RequireRole(roleTeacher, h.CreateStudent))
	mux.HandleFunc("POST /api/teacher/students/{id}/link", h.Auth.RequireRole(roleTeacher, h.LinkStudent))
	mux.HandleFunc("POST /api/teacher/students/{id}/password", h.Auth.RequireRole(roleTeacher, h.ResetStudentPassword))
	mux.HandleFunc("DELETE /api/teacher/students/{id}/password", h.Auth.RequireRole(roleTeacher, h.ClearStudentPassword))

	mux.HandleFunc("GET /api/teacher/submissions/{id}", h.Auth.RequireRole(roleTeacher, h.TeacherSubmissionDetail))
	mux.HandleFunc("POST /api/teacher/submissions/{id}/evaluations", h.Auth.RequireRole(roleTeacher, h.CreateEvaluation))
	mux.HandleFunc("GET /api/teacher/evaluations", h.Auth.RequireRole(roleTeacher, h.TeacherEvaluations))

	// 学生端（需 STUDENT）
	mux.HandleFunc("GET /api/student/overview", h.Auth.RequireRole(roleStudent, h.StudentOverview))
	mux.HandleFunc("GET /api/student/topics", h.Auth.RequireRole(roleStudent, h.StudentTopics))
	mux.HandleFunc("GET /api/student/topics/{id}", h.Auth.RequireRole(roleStudent, h.StudentTopicDetail))
	mux.HandleFunc("POST /api/student/topics/{id}/submission", h.Auth.RequireRole(roleStudent, h.SubmitTopicSubmission))
	mux.HandleFunc("GET /api/student/evaluations", h.Auth.RequireRole(roleStudent, h.StudentEvaluations))

	// 附件下载：学生本人或管理该课题的老师都可以下载，因此只要求登录。
	mux.HandleFunc("GET /api/student/files/{fileId}", h.Auth.RequireUser(h.DownloadFile))

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

// currentUser 取出 RequireUser / RequireRole 中间件写入的当前用户。
func currentUser(r *http.Request) *models.User {
	user, _ := auth.UserFromContext(r.Context())
	if user == nil {
		// 正常流程不会走到这里（中间件已保证已登录），兜底避免 nil 解引用。
		return &models.User{}
	}
	return user
}

// now 返回统一格式的当前 UTC 时间。
func now() string {
	return db.Now()
}

// newID 生成带前缀的随机 id。
func newID(prefix string) string {
	return db.NewID(prefix)
}

// strPtr 把可空字符串列转成 *string（JSON null）。
func strPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	s := value.String
	return &s
}

// nullableString 把 *string 转成 SQL 参数。
func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// trimmedOr 返回去掉两端空白的字符串；为空时使用 fallback。
func trimmedOr(value, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return fallback
}

/* ------------------------------------------------------------------ */
/* 课题 / 成员访问辅助                                                 */
/* ------------------------------------------------------------------ */

// topicRow 是处理权限与详情时用到的课题原始行。
type topicRow struct {
	ID            string
	Title         string
	DescriptionMD string
	Status        string
	JoinMode      string
	OwnerID       string
	OwnerName     string
	CreatedAt     string
	UpdatedAt     string
}

// getTopic 按 id 读取课题（含创建者姓名）；不存在返回 sql.ErrNoRows。
func (h *API) getTopic(ctx context.Context, id string) (*topicRow, error) {
	var topic topicRow
	err := h.DB.QueryRowContext(ctx,
		`SELECT t.id, t.title, t.description_md, t.status, t.join_mode, t.owner_id,
		        COALESCE(u.name, ''), t.created_at, t.updated_at
		 FROM topics t LEFT JOIN users u ON u.id = t.owner_id
		 WHERE t.id = ?`, id,
	).Scan(&topic.ID, &topic.Title, &topic.DescriptionMD, &topic.Status, &topic.JoinMode,
		&topic.OwnerID, &topic.OwnerName, &topic.CreatedAt, &topic.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &topic, nil
}

// isTopicAssistant 判断教师是否为课题助教。
func (h *API) isTopicAssistant(ctx context.Context, topicID, teacherID string) (bool, error) {
	var count int
	err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM topic_assistants WHERE topic_id = ? AND teacher_id = ?`,
		topicID, teacherID,
	).Scan(&count)
	return count > 0, err
}

// canManageTopic 判断用户能否管理课题：创建者或助教（仅教师）。
func (h *API) canManageTopic(ctx context.Context, user *models.User, topic *topicRow) (bool, error) {
	if user == nil || topic == nil {
		return false, nil
	}
	if user.Role != roleTeacher {
		return false, nil
	}
	if topic.OwnerID == user.ID {
		return true, nil
	}
	return h.isTopicAssistant(ctx, topic.ID, user.ID)
}

// requireManageTopic 读取课题并校验「创建者或助教」权限；失败时已写好响应。
func (h *API) requireManageTopic(w http.ResponseWriter, r *http.Request, topicID string) (*topicRow, *models.User, bool) {
	user := currentUser(r)
	topic, err := h.getTopic(r.Context(), topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "课题不存在")
		return nil, nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, nil, false
	}
	allowed, err := h.canManageTopic(r.Context(), user, topic)
	if err != nil {
		serverError(w, err)
		return nil, nil, false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "无权管理该课题")
		return nil, nil, false
	}
	return topic, user, true
}

// requireOwnerTopic 读取课题并校验「创建者本人」权限（编辑课题 / 管理助教 / 移交）。
func (h *API) requireOwnerTopic(w http.ResponseWriter, r *http.Request, topicID string) (*topicRow, *models.User, bool) {
	user := currentUser(r)
	topic, err := h.getTopic(r.Context(), topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "课题不存在")
		return nil, nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, nil, false
	}
	if topic.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, "只有课题创建者可以执行该操作")
		return nil, nil, false
	}
	return topic, user, true
}

// membershipRow 是 topic_members 的原始行。
type membershipRow struct {
	ID        string
	RemovedAt *string
}

// getMembership 读取学生在课题中的成员关系（包含已移出的历史关系）。
func (h *API) getMembership(ctx context.Context, topicID, studentID string) (*membershipRow, error) {
	var (
		membership membershipRow
		removedAt  sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, removed_at FROM topic_members WHERE topic_id = ? AND student_id = ?`,
		topicID, studentID,
	).Scan(&membership.ID, &removedAt)
	if err != nil {
		return nil, err
	}
	membership.RemovedAt = strPtr(removedAt)
	return &membership, nil
}

/* ------------------------------------------------------------------ */
/* 用户辅助                                                            */
/* ------------------------------------------------------------------ */

// getUserByLoginID 按学号 / 工号读取用户。
func (h *API) getUserByLoginID(ctx context.Context, loginID string) (*models.User, sql.NullString, error) {
	var (
		user         models.User
		passwordHash sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, login_id, name, role, avatar_color, password_hash FROM users WHERE login_id = ?`,
		loginID,
	).Scan(&user.ID, &user.LoginID, &user.Name, &user.Role, &user.AvatarColor, &passwordHash)
	if err != nil {
		return nil, sql.NullString{}, err
	}
	user.HasPassword = passwordHash.Valid && passwordHash.String != ""
	return &user, passwordHash, nil
}

// getUserByID 按 id 读取用户。
func (h *API) getUserByID(ctx context.Context, id string) (*models.User, sql.NullString, error) {
	var (
		user         models.User
		passwordHash sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, login_id, name, role, avatar_color, password_hash FROM users WHERE id = ?`, id,
	).Scan(&user.ID, &user.LoginID, &user.Name, &user.Role, &user.AvatarColor, &passwordHash)
	if err != nil {
		return nil, sql.NullString{}, err
	}
	user.HasPassword = passwordHash.Valid && passwordHash.String != ""
	return &user, passwordHash, nil
}

// avatarPalette 是新建学生时轮换使用的头像底色（与设计系统保持一致）。
var avatarPalette = []string{"#D97706", "#2563EB", "#7C3AED", "#DB2777", "#0D9488", "#059669"}

// pickAvatarColor 按 seed 选一个稳定的头像底色。
func pickAvatarColor(seed string) string {
	sum := 0
	for _, r := range seed {
		sum += int(r)
	}
	if len(avatarPalette) == 0 {
		return "#0D9488"
	}
	return avatarPalette[sum%len(avatarPalette)]
}

// 允许的状态值。
func validTopicStatus(status string) bool {
	return status == statusActive || status == statusClosed
}
