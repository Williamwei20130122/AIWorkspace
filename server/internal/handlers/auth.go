package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/models"
)

// loginRequest POST /api/auth/login 请求体。
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login POST /api/auth/login：校验邮箱口令，成功后写入 aw_session Cookie。
//
// 登录失败返回 400（"邮箱或密码不正确"）而不是 401：前端的 api 封装会把 401
// 统一跳转到 /login，登录页沿用 400 才不会被全局跳转吞掉错误文案。
func (h *API) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	switch {
	case email == "":
		writeError(w, http.StatusBadRequest, "请输入邮箱")
		return
	case !validEmail(email):
		writeError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	case req.Password == "":
		writeError(w, http.StatusBadRequest, "请输入密码")
		return
	}

	var user models.User
	var passwordHash string
	err := h.DB.QueryRowContext(r.Context(),
		`SELECT id, name, email, role, avatar_color, password_hash FROM users WHERE email = ?`, email,
	).Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.AvatarColor, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "邮箱或密码不正确")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if !auth.VerifyPassword(req.Password, passwordHash) {
		writeError(w, http.StatusBadRequest, "邮箱或密码不正确")
		return
	}

	if err := h.Auth.SetSessionCookie(w, user.ID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
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

// validEmail 做基础的邮箱格式校验（与 v1 zod 的直观行为一致）。
func validEmail(email string) bool {
	if strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".") &&
		!strings.HasPrefix(domain, ".") &&
		!strings.HasSuffix(domain, ".")
}
