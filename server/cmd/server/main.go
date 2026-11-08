// AIWorkspace 教学系统 —— Go 后端入口。
//
// 启动流程：读环境变量 → 打开 / 迁移 SQLite → 按需写入演示数据 →
// 注册 /api 路由与内嵌前端静态资源 → 监听端口（默认 3100）→ 优雅关闭。
//
// 环境变量：
//
//	PORT          监听端口（默认 3100）
//	DATABASE_PATH SQLite 文件路径（默认 ./data/app.db）
//	UPLOAD_DIR    附件存储目录（默认 ./data/uploads；Docker 为 /data/uploads）
//	AUTH_SECRET   会话签名密钥；生产环境（APP_ENV=production）缺失时拒绝启动
//	SEED_ON_START 首次启动且 users 为空时写入演示数据（默认开启；0/false 关闭）
//	WEB_DIR       可选：用磁盘目录覆盖内嵌前端产物（默认用 go:embed 的 webdist）
//	APP_ENV       development / production（production 时 Cookie 加 Secure 且要求 AUTH_SECRET）
//	COOKIE_SECURE 可选显式覆盖 Cookie 的 Secure 标记（1/0）
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	serverassets "aiworkspace/server"
	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/db"
	"aiworkspace/server/internal/handlers"
)

func main() {
	log.SetFlags(log.LstdFlags)
	log.SetPrefix("[aiworkspace] ")

	port := envOr("PORT", "3100")
	databasePath := envOr("DATABASE_PATH", "./data/app.db")
	uploadDir := envOr("UPLOAD_DIR", "./data/uploads")
	seedOnStart := !isFalse(os.Getenv("SEED_ON_START"))
	webDir := strings.TrimSpace(os.Getenv("WEB_DIR"))
	secret, secureCookie := resolveAuthSecret()

	// ---------- 上传目录 ----------
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Fatalf("初始化上传目录失败：%v", err)
	}
	log.Printf("附件目录：%s", uploadDir)

	// ---------- 数据库：打开 + 迁移 ----------
	database, err := db.Open(databasePath)
	if err != nil {
		log.Fatalf("初始化数据库失败：%v", err)
	}
	defer func() { _ = database.Close() }()
	log.Printf("数据库：%s", databasePath)

	// ---------- 演示数据（仅 users 表为空时） ----------
	if seedOnStart {
		seeded, err := db.Seed(database, uploadDir)
		if err != nil {
			log.Fatalf("写入演示数据失败：%v", err)
		}
		if seeded {
			log.Printf("已写入演示数据：教师 teacher@demo.edu 密码 %s；学生 S001（无密码）", db.DemoPassword)
		} else {
			log.Printf("用户表非空，跳过演示数据")
		}
	} else {
		log.Printf("SEED_ON_START 已关闭，跳过演示数据")
	}

	// ---------- 管理员账号（幂等，任何库结构下都确保存在） ----------
	if err := db.EnsureAdmin(database); err != nil {
		log.Printf("确保管理员账号失败：%v", err)
	}

	// ---------- 路由 ----------
	authenticator := auth.New(database, secret, secureCookie)
	api := handlers.New(database, authenticator, uploadDir)
	mux := http.NewServeMux()
	api.Mount(mux)

	staticHandler, source, err := newStaticHandler(webDir)
	if err != nil {
		log.Fatalf("初始化前端静态资源失败：%v", err)
	}
	mux.Handle("/", staticHandler)
	log.Printf("前端资源：%s", source)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           withAccessLog(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// ---------- 启动 + 优雅关闭 ----------
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("AIWorkspace 已启动：http://localhost:%s（/api/health 健康检查）", port)
		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP 服务异常退出：%v", err)
		}
	case <-ctx.Done():
		log.Printf("收到退出信号，正在优雅关闭…")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("优雅关闭失败：%v", err)
		}
	}
	log.Printf("服务已退出")
}

/* ------------------------------------------------------------------ */
/* 环境变量                                                            */
/* ------------------------------------------------------------------ */

// envOr 读取环境变量，空值时返回默认值。
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// isFalse 判断开关型环境变量是否显式关闭（0 / false / no / off）。
func isFalse(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "no", "off":
		return true
	}
	return false
}

// resolveAuthSecret 读取 AUTH_SECRET，并判断是否需要 Secure Cookie。
// 未配置密钥时：生产环境直接拒绝启动，开发环境使用固定 dev 密钥并打印警告。
func resolveAuthSecret() (secret string, secureCookie bool) {
	env := strings.ToLower(envOr("APP_ENV", envOr("ENV", "development")))
	production := env == "production" || env == "prod"
	secureCookie = production
	if override := strings.TrimSpace(os.Getenv("COOKIE_SECURE")); override != "" {
		secureCookie = !isFalse(override)
	}

	secret = strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	placeholder := secret == "" ||
		secret == "change-me-to-a-long-random-string" ||
		secret == "aiworkspace-dev-secret-change-me"
	if placeholder {
		if production {
			log.Fatal("AUTH_SECRET 未配置：生产环境必须设置强随机密钥（如 openssl rand -base64 48）")
		}
		log.Printf("警告：AUTH_SECRET 未配置，使用开发默认密钥（仅限本地开发，请勿用于生产）")
		return auth.DevSecret, secureCookie
	}
	return secret, secureCookie
}

/* ------------------------------------------------------------------ */
/* 前端静态资源（go:embed + SPA 回退）                                 */
/* ------------------------------------------------------------------ */

// newStaticHandler 构造前端静态资源处理器：优先使用 WEB_DIR 磁盘目录，否则用内嵌产物。
func newStaticHandler(webDir string) (handler http.Handler, source string, err error) {
	if webDir != "" {
		absolute, err := filepath.Abs(webDir)
		if err != nil {
			return nil, "", fmt.Errorf("解析 WEB_DIR 失败: %w", err)
		}
		info, err := os.Stat(absolute)
		if err != nil {
			return nil, "", fmt.Errorf("WEB_DIR 不可用: %w", err)
		}
		if !info.IsDir() {
			return nil, "", fmt.Errorf("WEB_DIR 不是目录: %s", absolute)
		}
		return spaHandler(os.DirFS(absolute)), "磁盘目录 " + absolute, nil
	}

	sub, err := fs.Sub(serverassets.WebDist, "webdist")
	if err != nil {
		return nil, "", fmt.Errorf("读取内嵌 webdist 失败: %w", err)
	}
	return spaHandler(sub), "内嵌 webdist（go:embed）", nil
}

// spaHandler 直出静态文件，未知路径回退 index.html（支持前端 SPA 路由）。
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if relative == "" || relative == "." || relative == "index.html" {
			serveIndex(w, r, root)
			return
		}
		file, err := root.Open(relative)
		if err == nil {
			info, statErr := file.Stat()
			_ = file.Close()
			if statErr == nil && !info.IsDir() {
				setStaticCache(w, relative)
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// 静态文件不存在：带扩展名的资源请求直接 404，避免把 index.html 当成 JS/CSS 返回。
		if path.Ext(relative) != "" {
			http.NotFound(w, r)
			return
		}
		// SPA 回退：/teacher/xxx 之类的前端路由都返回 index.html。
		serveIndex(w, r, root)
	})
}

// serveIndex 输出 index.html。
func serveIndex(w http.ResponseWriter, r *http.Request, root fs.FS) {
	content, err := fs.ReadFile(root, "index.html")
	if err != nil {
		http.Error(w, "前端资源未构建：找不到 index.html", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(content)
	}
}

// setStaticCache 给构建产物设置缓存头：带 hash 的 assets 长缓存，其余不缓存。
func setStaticCache(w http.ResponseWriter, relative string) {
	if strings.HasPrefix(relative, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
}

/* ------------------------------------------------------------------ */
/* 访问日志                                                            */
/* ------------------------------------------------------------------ */

// statusRecorder 记录响应状态码（用于访问日志）。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(code int) {
	rec.status = code
	rec.ResponseWriter.WriteHeader(code)
}

// withAccessLog 打印每个请求的方法、路径、状态码与耗时（静态 assets 不打印）。
func withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			return
		}
		log.Printf("%s %s -> %d（%s）", r.Method, r.URL.Path, recorder.status, time.Since(start).Round(time.Millisecond))
	})
}
