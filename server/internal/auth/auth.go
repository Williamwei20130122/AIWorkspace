// Package auth 负责口令哈希、会话 token 签名 / 验签、Cookie 读写与鉴权中间件。
//
// 口令哈希格式与 v1（Next.js）保持一致：scrypt$<salt hex>$<hash hex>，
// 其中 salt 为 16 字节随机数的 hex 字符串，hash 为
// scrypt(password, salt 字符串, N=16384, r=8, p=1, keyLen=64) 的 hex。
// 注意：Node 的 crypto.scryptSync 把 hex 字符串本身当作 salt 字节，Go 侧保持一致。
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"

	"aiworkspace/server/internal/models"
)

const (
	// SessionCookieName 会话 Cookie 名称。
	SessionCookieName = "aw_session"
	// SessionMaxAge 会话有效期（7 天，单位秒）。
	SessionMaxAge = 7 * 24 * 60 * 60
	// DevSecret 开发环境默认密钥（未配置 AUTH_SECRET 时使用，仅限本地开发）。
	DevSecret = "aiworkspace-dev-secret-do-not-use-in-production"

	scryptN      = 16384
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 64
)

// HashPassword 生成 scrypt$<salt>$<hash> 格式的口令哈希。
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	sum, err := scrypt.Key([]byte(password), []byte(saltHex), scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return "", err
	}
	return "scrypt$" + saltHex + "$" + hex.EncodeToString(sum), nil
}

// VerifyPassword 校验口令是否与哈希匹配（常量时间比较）。
func VerifyPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" || parts[1] == "" || parts[2] == "" {
		return false
	}
	expected, err := hex.DecodeString(parts[2])
	if err != nil || len(expected) == 0 {
		return false
	}
	computed, err := scrypt.Key([]byte(password), []byte(parts[1]), scryptN, scryptR, scryptP, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(computed, expected) == 1
}

// sessionPayload 会话 token 的 payload。
type sessionPayload struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
}

// Authenticator 持有数据库与签名密钥，提供会话读写和鉴权中间件。
type Authenticator struct {
	db     *sql.DB
	secret []byte
	secure bool
}

// New 创建 Authenticator。secret 为空时回退到开发默认密钥；secure 控制 Cookie 的 Secure 标记。
func New(db *sql.DB, secret string, secure bool) *Authenticator {
	if strings.TrimSpace(secret) == "" {
		secret = DevSecret
	}
	return &Authenticator{db: db, secret: []byte(secret), secure: secure}
}

// sign 计算 payload 的 HMAC-SHA256 签名（base64url，无填充）。
func (a *Authenticator) sign(payload string) string {
	mac := hmac.New(sha256.New, a.secret)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// CreateToken 生成 base64url(JSON{sub,iat}).HMAC 形式的会话 token。
func (a *Authenticator) CreateToken(userID string) (string, error) {
	data, err := json.Marshal(sessionPayload{Sub: userID, Iat: time.Now().UnixMilli()})
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	return payload + "." + a.sign(payload), nil
}

// VerifyToken 校验 token 签名与有效期，返回其中的用户 id。
func (a *Authenticator) VerifyToken(token string) (string, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", false
	}
	expected := a.sign(parts[0])
	if subtle.ConstantTimeCompare([]byte(parts[1]), []byte(expected)) != 1 {
		return "", false
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	var payload sessionPayload
	if err := json.Unmarshal(data, &payload); err != nil || payload.Sub == "" {
		return "", false
	}
	// Cookie 自身有 Max-Age，这里再兜底校验 7 天有效期。
	if payload.Iat > 0 && time.Since(time.UnixMilli(payload.Iat)) > SessionMaxAge*time.Second {
		return "", false
	}
	return payload.Sub, true
}

// SetSessionCookie 写入登录会话 Cookie（HttpOnly / SameSite=Lax / Path=/ / Max-Age=604800）。
func (a *Authenticator) SetSessionCookie(w http.ResponseWriter, userID string) error {
	token, err := a.CreateToken(userID)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   SessionMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   a.secure,
	})
	return nil
}

// ClearSessionCookie 清除会话 Cookie。
func (a *Authenticator) ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   a.secure,
	})
}

// CurrentUser 从请求 Cookie 解析当前登录用户；未登录 / token 失效 / 用户不存在时返回 false。
func (a *Authenticator) CurrentUser(r *http.Request) (*models.User, bool) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil, false
	}
	userID, ok := a.VerifyToken(cookie.Value)
	if !ok {
		return nil, false
	}
	var (
		user         models.User
		passwordHash sql.NullString
	)
	err = a.db.QueryRowContext(r.Context(),
		`SELECT id, login_id, name, role, avatar_color, password_hash FROM users WHERE id = ?`, userID,
	).Scan(&user.ID, &user.LoginID, &user.Name, &user.Role, &user.AvatarColor, &passwordHash)
	if err != nil {
		return nil, false
	}
	user.HasPassword = passwordHash.Valid && passwordHash.String != ""
	return &user, true
}

// 用户信息在 context 中的 key。
type userContextKey struct{}

// UserFromContext 取出 requireUser 中间件写入的用户。
func UserFromContext(ctx context.Context) (*models.User, bool) {
	user, ok := ctx.Value(userContextKey{}).(*models.User)
	return user, ok
}

// writeError 输出统一的错误 JSON（与 handlers 中的格式一致）。
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":` + quoteJSON(message) + `}` + "\n"))
}

// quoteJSON 使用标准库转义中文文案。
func quoteJSON(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `"服务器内部错误"`
	}
	return string(b)
}

// RequireUser 要求已登录，否则返回 401 {"error":"未登录"}。
func (a *Authenticator) RequireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := a.CurrentUser(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey{}, user)
		next(w, r.WithContext(ctx))
	}
}

// RequireRole 要求已登录且角色匹配，未登录 401、角色不符 403。
func (a *Authenticator) RequireRole(role string, next http.HandlerFunc) http.HandlerFunc {
	return a.RequireUser(func(w http.ResponseWriter, r *http.Request) {
		user, ok := UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		if user.Role != role {
			writeError(w, http.StatusForbidden, "无权限访问")
			return
		}
		next(w, r)
	})
}
