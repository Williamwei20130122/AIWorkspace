package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/models"
)

// loginRequest POST /api/auth/login 请求体；password 可省略。
type loginRequest struct {
	LoginID  string `json:"loginId"`
	Password string `json:"password"`
}

// Login POST /api/auth/login：按邮箱 / 手机号 / 学号登录。
//
// 账号 password_hash 为 NULL（学生默认）时忽略密码直接登录；否则校验密码。
// 登录失败返回 400（"账号或密码不正确"）而不是 401：前端的 api 封装会把 401
// 统一跳转到 /login，登录页沿用 400 才不会被全局跳转吞掉错误文案。
func (h *API) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}

	loginID := normalizeLoginID(req.LoginID)
	if loginID == "" {
		writeError(w, http.StatusBadRequest, "请输入账号")
		return
	}

	user, passwordHash, err := h.getUserByLoginID(r.Context(), loginID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "账号或密码不正确")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	// password_hash 为 NULL / 空：无密码账号，直接登录（忽略传入的 password）。
	if passwordHash.Valid && passwordHash.String != "" {
		if !auth.VerifyPassword(req.Password, passwordHash.String) {
			writeError(w, http.StatusBadRequest, "账号或密码不正确")
			return
		}
	}

	if err := h.Auth.SetSessionCookie(w, user.ID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

// registerRequest POST /api/auth/register 教师自助注册请求体。
type registerRequest struct {
	Name     string `json:"name"`
	LoginID  string `json:"loginId"`
	Password string `json:"password"`
}

// Register POST /api/auth/register：教师自助注册，成功后直接登录。
func (h *API) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入姓名")
		return
	}
	if len([]rune(name)) > 100 {
		writeError(w, http.StatusBadRequest, "姓名过长")
		return
	}

	loginID := normalizeLoginID(req.LoginID)
	if loginID == "" {
		writeError(w, http.StatusBadRequest, "请使用邮箱或手机号注册")
		return
	}
	switch {
	case strings.Contains(loginID, "@"):
		if !validEmail(loginID) {
			writeError(w, http.StatusBadRequest, "邮箱格式不正确")
			return
		}
	case isAllDigits(loginID):
		if !isPhoneLoginID(loginID) {
			writeError(w, http.StatusBadRequest, "手机号格式不正确")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "请使用邮箱或手机号注册")
		return
	}

	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "密码至少 8 位")
		return
	}
	if len(req.Password) > 200 {
		writeError(w, http.StatusBadRequest, "密码过长")
		return
	}

	var existing int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE login_id = ?`, loginID,
	).Scan(&existing); err != nil {
		serverError(w, err)
		return
	}
	if existing > 0 {
		writeError(w, http.StatusConflict, "该邮箱/手机号已注册")
		return
	}

	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	timestamp := now()
	user := models.User{
		ID:          newID("u"),
		LoginID:     loginID,
		Name:        name,
		Role:        roleTeacher,
		AvatarColor: pickAvatarColor(loginID + name),
		HasPassword: true,
	}
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO users (id, login_id, name, role, password_hash, avatar_color, created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
		user.ID, user.LoginID, user.Name, user.Role, hashed, user.AvatarColor, timestamp, timestamp,
	); err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "该邮箱/手机号已注册")
			return
		}
		serverError(w, err)
		return
	}

	if err := h.Auth.SetSessionCookie(w, user.ID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

// Logout POST /api/auth/logout：清除会话 Cookie，返回 204。
func (h *API) Logout(w http.ResponseWriter, r *http.Request) {
	h.Auth.ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// Me GET /api/me：返回当前登录用户。
func (h *API) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

// updatePasswordRequest POST /api/me/password 请求体；newPassword 为空表示清除密码。
type updatePasswordRequest struct {
	NewPassword string `json:"newPassword"`
}

// UpdateMyPassword POST /api/me/password：学生自助设置 / 修改 / 清除自己的密码。
func (h *API) UpdateMyPassword(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req updatePasswordRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if len(req.NewPassword) > 200 {
		writeError(w, http.StatusBadRequest, "密码过长")
		return
	}

	var hash any
	if req.NewPassword == "" {
		hash = nil
	} else {
		hashed, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			serverError(w, err)
			return
		}
		hash = hashed
	}

	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		hash, now(), user.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

/* ------------------------------------------------------------------ */
/* 账号标识校验                                                        */
/* ------------------------------------------------------------------ */

// normalizeLoginID 统一账号标识：去掉两端空白；邮箱形式统一转小写。
func normalizeLoginID(raw string) string {
	loginID := strings.TrimSpace(raw)
	if strings.Contains(loginID, "@") {
		loginID = strings.ToLower(loginID)
	}
	return loginID
}

// validEmail 做基础的邮箱格式校验。
func validEmail(email string) bool {
	if strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	if strings.Count(email, "@") != 1 {
		return false
	}
	at := strings.Index(email, "@")
	if at <= 0 || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".") &&
		!strings.HasPrefix(domain, ".") &&
		!strings.HasSuffix(domain, ".")
}

// isAllDigits 判断字符串是否全部由数字组成。
func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// isPhoneLoginID 校验大陆手机号（^1\d{10}$）。
func isPhoneLoginID(value string) bool {
	if len(value) != 11 || value[0] != '1' {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// studentLookup 查询账号是否已存在（教师添加学生前的预检查）。
func (h *API) studentLookup(w http.ResponseWriter, r *http.Request) {
	teacher := currentUser(r)
	loginID := normalizeLoginID(r.URL.Query().Get("loginId"))
	if loginID == "" {
		writeError(w, http.StatusBadRequest, "请输入用户名")
		return
	}
	ctx := r.Context()
	student, _, err := h.getUserByLoginID(ctx, loginID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"exists": false})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	info, err := h.buildStudentAccountInfo(ctx, student, teacher.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"exists": true, "user": info})
}

// studentAccountInfo 是创建学生冲突 / 预检查时展示的已有账号信息。
type studentAccountInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	LoginID     string   `json:"loginId"`
	HasPassword bool     `json:"hasPassword"`
	ManagedByMe bool     `json:"managedByMe"`
	CreatedBy   []string `json:"createdBy"`
}

// studentAccountInfo 组装已有账号信息（不含任何密码哈希）。
func (h *API) buildStudentAccountInfo(ctx context.Context, student *models.User, teacherID string) (*studentAccountInfo, error) {
	info := &studentAccountInfo{
		ID:          student.ID,
		Name:        student.Name,
		LoginID:     student.LoginID,
		HasPassword: student.HasPassword,
		CreatedBy:   []string{},
	}
	var managed int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM teacher_students WHERE teacher_id = ? AND student_id = ?`,
		teacherID, student.ID,
	).Scan(&managed); err != nil {
		return nil, err
	}
	info.ManagedByMe = managed > 0

	rows, err := h.DB.QueryContext(ctx,
		`SELECT creator.name FROM users student JOIN users creator ON creator.id = student.created_by
		 WHERE student.id = ?`, student.ID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		info.CreatedBy = append(info.CreatedBy, name)
	}
	return info, rows.Err()
}
