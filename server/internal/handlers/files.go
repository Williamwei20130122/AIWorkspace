package handlers

import (
	"database/sql"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	// maxFileBytes 单个上传文件上限：100MB。
	maxFileBytes int64 = 100 << 20
	// maxFilesPerSubmission 单次提交附件数量上限。
	maxFilesPerSubmission = 10
	// multipartMemory 解析 multipart 时内存中保留的上限，超出部分由标准库落临时文件。
	multipartMemory = 32 << 20
	// maxUploadTotalBytes 整个 multipart 请求的上限（10 个 100MB 文件 + 文本与边界开销）。
	maxUploadTotalBytes int64 = maxFilesPerSubmission*maxFileBytes + 8<<20
	// maxTextContentBytes 提交文本上限：1MB。
	maxTextContentBytes = 1 << 20
)

// errFileTooLarge 表示单个上传文件超过大小限制。
var errFileTooLarge = errors.New("单个文件超过大小限制")

// storedFile 是已写入磁盘、等待写入数据库的附件元数据。
type storedFile struct {
	OriginalName string
	MimeType     string
	StoragePath  string
	SizeBytes    int64
}

// DownloadFile GET /api/student/files/{fileId}：附件下载。
//
// 鉴权：学生只能下载自己提交里的附件；教师必须管理该附件所属课题（创建者 / 助教）。
func (h *API) DownloadFile(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	var (
		fileID       string
		originalName string
		mimeType     string
		sizeBytes    int64
		storagePath  string
		studentID    string
		topicID      string
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.storage_path,
		        s.student_id, s.topic_id
		 FROM submission_files f JOIN submissions s ON s.id = f.submission_id
		 WHERE f.id = ?`, r.PathValue("fileId"),
	).Scan(&fileID, &originalName, &mimeType, &sizeBytes, &storagePath, &studentID, &topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "附件不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	allowed := false
	switch user.Role {
	case roleStudent:
		allowed = studentID == user.ID
	case roleTeacher:
		topic, err := h.getTopic(ctx, topicID)
		if err != nil {
			serverError(w, err)
			return
		}
		allowed, err = h.canManageTopic(ctx, user, topic)
		if err != nil {
			serverError(w, err)
			return
		}
	case roleAdmin:
		allowed = true
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "无权下载该附件")
		return
	}

	absolute, err := h.resolveStoragePath(storagePath)
	if err != nil {
		writeError(w, http.StatusNotFound, "附件文件不存在")
		return
	}
	file, err := os.Open(absolute)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "附件文件不存在")
			return
		}
		serverError(w, err)
		return
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		serverError(w, err)
		return
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": originalName,
	}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, originalName, info.ModTime(), file)
}

// resolveStoragePath 把数据库里的相对路径安全地解析为 UPLOAD_DIR 下的绝对路径。
func (h *API) resolveStoragePath(storagePath string) (string, error) {
	uploadRoot, err := filepath.Abs(h.UploadDir)
	if err != nil {
		return "", err
	}
	absolute := filepath.Join(uploadRoot, filepath.FromSlash(storagePath))
	relative, err := filepath.Rel(uploadRoot, absolute)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("非法的附件路径")
	}
	return absolute, nil
}

// saveUploadedFile 把上传文件以随机文件名写入 UPLOAD_DIR，返回数据库元数据。
func saveUploadedFile(uploadDir, submissionID string, header *multipart.FileHeader) (storedFile, error) {
	originalName := cleanOriginalName(header.Filename)
	storedName := newID("f") + safeExtension(originalName)
	relative := path.Join("submissions", submissionID, storedName)
	absolute := filepath.Join(uploadDir, filepath.FromSlash(relative))

	if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
		return storedFile{}, err
	}
	source, err := header.Open()
	if err != nil {
		return storedFile{}, err
	}
	defer func() { _ = source.Close() }()

	destination, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return storedFile{}, err
	}
	written, copyErr := io.Copy(destination, io.LimitReader(source, maxFileBytes+1))
	closeErr := destination.Close()
	if copyErr != nil {
		_ = os.Remove(absolute)
		return storedFile{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(absolute)
		return storedFile{}, closeErr
	}
	if written > maxFileBytes {
		_ = os.Remove(absolute)
		return storedFile{}, errFileTooLarge
	}
	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return storedFile{
		OriginalName: originalName,
		MimeType:     mimeType,
		StoragePath:  relative,
		SizeBytes:    written,
	}, nil
}

// cleanOriginalName 清洗上传文件名：去掉路径、控制字符与首尾点号，保留可读名称。
func cleanOriginalName(raw string) string {
	normalized := strings.ReplaceAll(raw, "\\", "/")
	name := strings.TrimSpace(path.Base(normalized))
	name = strings.Map(func(r rune) rune {
		if r == 0 || r == '\r' || r == '\n' || r == '\t' || unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	name = strings.Trim(name, ".")
	if name == "" {
		return "未命名文件"
	}
	runes := []rune(name)
	if len(runes) > 180 {
		name = string(runes[:180])
	}
	return name
}

// safeExtension 返回安全的扩展名（小写字母数字，长度合理），否则返回空串。
func safeExtension(name string) string {
	extension := strings.ToLower(path.Ext(name))
	if len(extension) < 2 || len(extension) > 11 {
		return ""
	}
	for _, r := range extension[1:] {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return ""
		}
	}
	return extension
}

// isUniqueViolation 判断 SQLite 错误是否为唯一约束冲突。
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "constraint failed")
}
