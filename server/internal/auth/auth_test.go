package auth

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// nodeScryptHash 由 v1（Next.js）相同的算法生成：
//
//	node -e "const c=require('crypto');const s='0123456789abcdef0123456789abcdef';console.log('scrypt$'+s+'$'+c.scryptSync('demo1234',s,64).toString('hex'))"
//
// 用来确认 Go 实现与 v1 已落库的 scrypt$salt$hash 完全兼容，可直接迁移旧数据库。
const nodeScryptHash = "scrypt$0123456789abcdef0123456789abcdef$5f5a929551ba03c03d6e67dc5aeb73a6632daba0115ce0755ff50929a178c9746d49d3a3bb2bdec8d84d5185cfc7554b1f25384b417ae2aa6fef3418dbddefe3"

func TestVerifyPasswordNodeCompatibility(t *testing.T) {
	if !VerifyPassword("demo1234", nodeScryptHash) {
		t.Fatal("应能校验 v1（Node crypto.scryptSync）生成的哈希")
	}
	if VerifyPassword("wrong-password", nodeScryptHash) {
		t.Fatal("错误密码不应通过校验")
	}
	if VerifyPassword("demo1234", "md5$salt$hash") {
		t.Fatal("非 scrypt 格式不应通过校验")
	}
}

func TestHashPasswordRoundTrip(t *testing.T) {
	stored, err := HashPassword("demo1234")
	if err != nil {
		t.Fatalf("生成口令哈希失败: %v", err)
	}
	if !strings.HasPrefix(stored, "scrypt$") {
		t.Fatalf("哈希格式应为 scrypt$salt$hash，实际为 %q", stored)
	}
	if len(strings.Split(stored, "$")) != 3 {
		t.Fatalf("哈希应由 3 段组成，实际为 %q", stored)
	}
	if !VerifyPassword("demo1234", stored) {
		t.Fatal("应能校验自己生成的哈希")
	}
	if VerifyPassword("demo1234!", stored) {
		t.Fatal("错误密码不应通过校验")
	}
}

func TestSessionToken(t *testing.T) {
	a := New(nil, "test-secret", false)
	token, err := a.CreateToken("u123")
	if err != nil {
		t.Fatalf("生成会话 token 失败: %v", err)
	}
	userID, ok := a.VerifyToken(token)
	if !ok || userID != "u123" {
		t.Fatalf("会话 token 应解析出 u123，实际 ok=%v userID=%q", ok, userID)
	}

	// 篡改签名
	parts := strings.Split(token, ".")
	if _, ok := a.VerifyToken(parts[0] + "." + parts[1] + "x"); ok {
		t.Fatal("签名被篡改后不应通过校验")
	}
	// 篡改 payload 但复用旧签名
	evilPayload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"evil","iat":` + "0" + `}`))
	if _, ok := a.VerifyToken(evilPayload + "." + parts[1]); ok {
		t.Fatal("payload 被篡改后不应通过校验")
	}
	// 缺少签名段
	if _, ok := a.VerifyToken(parts[0]); ok {
		t.Fatal("缺少签名段不应通过校验")
	}
}

func TestSessionTokenExpires(t *testing.T) {
	a := New(nil, "test-secret", false)
	expired := sessionPayload{Sub: "u123", Iat: time.Now().Add(-8 * 24 * time.Hour).UnixMilli()}
	data, err := json.Marshal(expired)
	if err != nil {
		t.Fatalf("序列化 payload 失败: %v", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	token := payload + "." + a.sign(payload)
	if _, ok := a.VerifyToken(token); ok {
		t.Fatal("超过 7 天的 token 不应通过校验")
	}
}

func TestSetAndClearSessionCookie(t *testing.T) {
	a := New(nil, "test-secret", false)
	recorder := httptest.NewRecorder()
	if err := a.SetSessionCookie(recorder, "u123"); err != nil {
		t.Fatalf("写入会话 Cookie 失败: %v", err)
	}
	cookies := recorder.Result().Cookies()
	var session *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == SessionCookieName {
			session = cookie
		}
	}
	if session == nil {
		t.Fatal("响应中缺少 aw_session Cookie")
	}
	if !session.HttpOnly {
		t.Fatal("会话 Cookie 必须是 HttpOnly")
	}
	if session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("SameSite 应为 Lax，实际为 %v", session.SameSite)
	}
	if session.Path != "/" {
		t.Fatalf("Path 应为 /，实际为 %q", session.Path)
	}
	if session.MaxAge != SessionMaxAge {
		t.Fatalf("Max-Age 应为 %d（7 天），实际为 %d", SessionMaxAge, session.MaxAge)
	}
	if SessionMaxAge != 604800 {
		t.Fatalf("SessionMaxAge 常量应为 604800，实际为 %d", SessionMaxAge)
	}
	if session.Secure {
		t.Fatal("开发环境不应设置 Secure（生产环境才设置）")
	}

	clearRecorder := httptest.NewRecorder()
	a.ClearSessionCookie(clearRecorder)
	cleared := clearRecorder.Result().Cookies()
	if len(cleared) == 0 || cleared[0].Name != SessionCookieName || cleared[0].MaxAge >= 0 {
		t.Fatal("清除 Cookie 时应写入过期 Cookie")
	}
}

func TestNewFallsBackToDevSecret(t *testing.T) {
	a := New(nil, "  ", false)
	if string(a.secret) != DevSecret {
		t.Fatal("未配置 AUTH_SECRET 时应回退到开发默认密钥")
	}
	b := New(nil, "real-secret", true)
	if string(b.secret) != "real-secret" || !b.secure {
		t.Fatal("配置了 AUTH_SECRET 时应使用配置值，并保留 secure 标记")
	}
}
