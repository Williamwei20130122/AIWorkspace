// Package artifactstore 提供 AI Workspace 云端素材的本地磁盘存储。
//
// 与 service/task_artifact_store.go 的「上游任务产物代理」语义无关：这里存的是
// 中台生成链路产出的成品文件（图片 / 音频 / 视频 / 音乐 / 文本），统一落到本地磁盘。
package artifactstore

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// DefaultRoot 素材根目录（可用 WORKSPACE_ARTIFACT_DIR 覆盖）。
const DefaultRoot = "data/workspace-artifacts"

// Scope 描述一份素材在目录结构中的归属：<学段>/<届>/<班级>/<课次>/<学生>/。
type Scope struct {
	// StageName 学段名（如「小学」「初中」）。
	StageName string
	// EntryYear 入学年份（届别），0 表示未设置。
	EntryYear int
	// ClassName 班级名。
	ClassName string
	// LessonId 归属课次（上课模式的课 id），0 表示非上课时段。
	LessonId int
	// UserId 生成者用户 id。
	UserId int
	// UserName 生成者用户名（用于目录可读性）。
	UserName string
}

// Store 素材存储抽象：保存 / 删除 / 读取。
// storagePath 一律使用相对路径（相对存储根目录），便于迁移与跨平台。
type Store interface {
	// Save 把 reader 完整写入 scope 目录下的 filename，返回相对 storagePath。
	Save(ctx context.Context, scope Scope, filename string, reader io.Reader) (string, error)
	// Delete 删除 storagePath 对应的文件（不存在时不报错），并清理空目录。
	Delete(storagePath string) error
	// Open 打开 storagePath 对应的文件。
	Open(storagePath string) (io.ReadCloser, error)
	// LocalPath 返回可直接交给 http.ServeFile 的本地绝对路径。
	LocalPath(storagePath string) (string, error)
}

// unsafeSegment 目录/文件名中不允许出现的字符（含 Windows 保留字符与控制字符）。
var unsafeSegment = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

// sanitizeSegment 清洗单个路径片段：替换非法字符、去掉首尾空白与点号、限制长度。
func sanitizeSegment(value, fallback string) string {
	cleaned := unsafeSegment.ReplaceAllString(strings.TrimSpace(value), "_")
	cleaned = strings.Trim(cleaned, " .")
	if cleaned == "" {
		return fallback
	}
	runes := []rune(cleaned)
	if len(runes) > 40 {
		cleaned = string(runes[:40])
	}
	return cleaned
}

// sanitizeFilename 清洗文件名，保留扩展名。
func sanitizeFilename(name, fallback string) string {
	name = strings.TrimSpace(name)
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	ext = unsafeSegment.ReplaceAllString(ext, "")
	if len(ext) > 12 {
		ext = ext[:12]
	}
	return sanitizeSegment(base, fallback) + ext
}

// RelativeDir 返回 scope 对应的相对目录（用于测试与展示）。
func RelativeDir(scope Scope) string {
	stage := sanitizeSegment(scope.StageName, "未分学段")
	cohort := "未分届"
	if scope.EntryYear > 0 {
		cohort = fmt.Sprintf("%d届", scope.EntryYear)
	}
	class := sanitizeSegment(scope.ClassName, "未分班级")
	lesson := "未关联课次"
	if scope.LessonId > 0 {
		lesson = fmt.Sprintf("第%d课", scope.LessonId)
	}
	student := sanitizeSegment(scope.UserName, "")
	if student == "" {
		if scope.UserId > 0 {
			student = fmt.Sprintf("学生%d", scope.UserId)
		} else {
			student = "未知学生"
		}
	}
	return path.Join(stage, cohort, class, lesson, student)
}

type localDiskStore struct {
	root string
}

// NewLocalDiskStore 创建本地磁盘存储；root 为空时使用 DefaultRoot。
func NewLocalDiskStore(root string) Store {
	root = strings.TrimSpace(root)
	if root == "" {
		root = envRoot()
	}
	return &localDiskStore{root: filepath.Clean(root)}
}

func envRoot() string {
	if value := strings.TrimSpace(os.Getenv("WORKSPACE_ARTIFACT_DIR")); value != "" {
		return value
	}
	return DefaultRoot
}

func (s *localDiskStore) absolute(storagePath string) (string, error) {
	cleaned := path.Clean(filepath.ToSlash(strings.TrimSpace(storagePath)))
	if cleaned == "" || cleaned == "." || path.IsAbs(cleaned) || strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("invalid storage path: %q", storagePath)
	}
	abs := filepath.Join(s.root, filepath.FromSlash(cleaned))
	// 双保险：确保最终路径仍在根目录内（防目录穿越）。
	rootAbs, err := filepath.Abs(s.root)
	if err != nil {
		return "", err
	}
	targetAbs, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	if targetAbs != rootAbs && !strings.HasPrefix(targetAbs, rootAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("storage path escapes root: %q", storagePath)
	}
	return targetAbs, nil
}

func (s *localDiskStore) Save(ctx context.Context, scope Scope, filename string, reader io.Reader) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	relPath := path.Join(RelativeDir(scope), sanitizeFilename(filename, "artifact"))
	abs, err := s.absolute(relPath)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	file, err := os.Create(abs)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(file, reader); err != nil {
		_ = file.Close()
		_ = os.Remove(abs)
		return "", err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(abs)
		return "", err
	}
	return relPath, nil
}

func (s *localDiskStore) Delete(storagePath string) error {
	abs, err := s.absolute(storagePath)
	if err != nil {
		return err
	}
	if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
		return err
	}
	pruneEmptyDirs(filepath.Dir(abs), s.root)
	return nil
}

func (s *localDiskStore) Open(storagePath string) (io.ReadCloser, error) {
	abs, err := s.absolute(storagePath)
	if err != nil {
		return nil, err
	}
	return os.Open(abs)
}

func (s *localDiskStore) LocalPath(storagePath string) (string, error) {
	return s.absolute(storagePath)
}

// pruneEmptyDirs 自底向上删除空目录，最多删到 root（含 root 自身以下）。
func pruneEmptyDirs(dir, root string) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return
	}
	current := dir
	for {
		abs, err := filepath.Abs(current)
		if err != nil || abs == rootAbs || !strings.HasPrefix(abs, rootAbs+string(os.PathSeparator)) {
			return
		}
		entries, err := os.ReadDir(abs)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := os.Remove(abs); err != nil {
			return
		}
		current = filepath.Dir(abs)
	}
}

// defaultOverride 显式覆盖（单测注入等），非空时优先于默认的本地磁盘存储。
var (
	defaultMu       sync.RWMutex
	defaultOverride Store

	localOnce  sync.Once
	localStore Store
)

// Default 返回当前生效的存储实现：优先显式覆盖，否则为本地磁盘存储
// （根目录可用 WORKSPACE_ARTIFACT_DIR 覆盖）。
func Default() Store {
	defaultMu.RLock()
	override := defaultOverride
	defaultMu.RUnlock()
	if override != nil {
		return override
	}
	localOnce.Do(func() { localStore = NewLocalDiskStore("") })
	return localStore
}

// SetDefault 显式指定存储实现；传 nil 表示恢复为默认的本地磁盘存储。
func SetDefault(store Store) {
	defaultMu.Lock()
	defaultOverride = store
	defaultMu.Unlock()
}
