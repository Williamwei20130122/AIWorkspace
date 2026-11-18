package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/artifactstore"
)

// WorkspaceArtifactMeta 一份素材的元信息。
type WorkspaceArtifactMeta struct {
	UserId    int
	ClassId   int
	Kind      string
	Model     string
	Prompt    string
	SourceURL string
}

// artifactDownloadTimeout 上游素材下载超时（图片 / 音视频）。
const artifactDownloadTimeout = 10 * time.Minute

// artifactMaxBytes 单份素材落盘上限，避免异常大响应占满磁盘。
const artifactMaxBytes = 512 * 1024 * 1024

// WorkspaceInputKind 参考素材的素材类型：用户上传的图生图源图 / 视频参考图。
// 与生成产物区分开，云端素材页面在无显式筛选时默认不展示这类过渡素材。
const WorkspaceInputKind = "input"

// workspaceInputMaxBytes 参考素材单文件上限（与前端 8MB 提示保持宽松一致）。
const workspaceInputMaxBytes = 32 * 1024 * 1024

// countingReader 统计实际写入字节数，用于记录素材大小。
type countingReader struct {
	reader io.Reader
	size   int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.reader.Read(p)
	c.size += int64(n)
	return n, err
}

// SaveWorkspaceArtifact 把 content 落盘并登记 WorkspaceArtifact 记录。
func SaveWorkspaceArtifact(ctx context.Context, meta WorkspaceArtifactMeta, filename, mimeType string, content io.Reader, sourceURL string) error {
	if meta.UserId <= 0 {
		return nil
	}
	counter := &countingReader{reader: io.LimitReader(content, artifactMaxBytes)}
	storagePath, err := artifactstore.Default().Save(ctx, workspaceArtifactScope(meta.UserId, meta.ClassId), filename, counter)
	if err != nil {
		return err
	}
	artifact := &model.WorkspaceArtifact{
		UserId:      meta.UserId,
		ClassId:     meta.ClassId,
		Kind:        meta.Kind,
		Model:       meta.Model,
		Prompt:      meta.Prompt,
		StoragePath: storagePath,
		MimeType:    mimeType,
		SizeBytes:   counter.size,
		SourceURL:   sourceURL,
	}
	return model.InsertWorkspaceArtifact(artifact)
}

// SaveWorkspaceInputArtifact 把用户上传的参考素材（图生图源图 / 视频参考图）写入本地磁盘
// 并登记素材记录，返回登记后的素材（含 id 与 storage_path）。
// 与生成产物不同，参考素材是生成链路的必要输入，不受「素材云端保存」开关约束。
func SaveWorkspaceInputArtifact(ctx context.Context, userId, classId int, filename, mimeType string, content io.Reader) (*model.WorkspaceArtifact, error) {
	if userId <= 0 {
		return nil, nil
	}
	counter := &countingReader{reader: io.LimitReader(content, workspaceInputMaxBytes)}
	storagePath, err := artifactstore.Default().Save(ctx, workspaceArtifactScope(userId, classId), workspaceArtifactFilename(WorkspaceInputKind, path.Ext(filename)), counter)
	if err != nil {
		return nil, err
	}
	if mimeType == "" {
		mimeType = mimeForExtension(path.Ext(storagePath))
	}
	artifact := &model.WorkspaceArtifact{
		UserId:      userId,
		ClassId:     classId,
		Kind:        WorkspaceInputKind,
		// Prompt 复用保存原始文件名：input 素材无提示词，共享/参考资料列表据此展示友好名称。
		Prompt:      trimWorkspaceArtifactText(filename, 500),
		StoragePath: storagePath,
		MimeType:    mimeType,
		SizeBytes:   counter.size,
	}
	if err := model.InsertWorkspaceArtifact(artifact); err != nil {
		return nil, err
	}
	return artifact, nil
}

// CollectWorkspaceSyncArtifact 从同步生成响应体中解析并落盘素材。
// 仅处理图片 / 图生图 / 声音合成 / 文本，异步能力（视频 / 音乐）由
// CollectWorkspaceTaskArtifact 在任务终态后处理。
func CollectWorkspaceSyncArtifact(ctx context.Context, meta WorkspaceArtifactMeta, contentType string, body []byte) error {
	if len(body) == 0 {
		return nil
	}
	switch meta.Kind {
	case "image", "edit":
		return collectWorkspaceImageArtifact(ctx, meta, body)
	case "tts":
		return collectWorkspaceAudioArtifact(ctx, meta, contentType, body)
	default:
		return collectWorkspaceTextArtifact(ctx, meta, body)
	}
}

// collectWorkspaceImageArtifact 处理文生图 / 图生图的两种回传形态：
// 上游 URL（需下载）与 b64_json（直接解码）。
func collectWorkspaceImageArtifact(ctx context.Context, meta WorkspaceArtifactMeta, body []byte) error {
	var payload struct {
		Data []struct {
			Url     string `json:"url"`
			B64Json string `json:"b64_json"`
		} `json:"data"`
		Url string `json:"url"`
	}
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil
	}
	urls := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.Url) != "" {
			urls = append(urls, strings.TrimSpace(item.Url))
			continue
		}
		if strings.TrimSpace(item.B64Json) != "" {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(item.B64Json))
			if err != nil {
				continue
			}
			if err := SaveWorkspaceArtifact(ctx, meta, workspaceArtifactFilename(meta.Kind, ".png"), "image/png", bytes.NewReader(decoded), ""); err != nil {
				common.SysError(common.LogText("workspace artifact save image b64 failed: userId=%d err=%s", meta.UserId, err.Error()))
			}
		}
	}
	if strings.TrimSpace(payload.Url) != "" {
		urls = append(urls, strings.TrimSpace(payload.Url))
	}
	for _, url := range urls {
		if err := downloadWorkspaceArtifact(ctx, meta, url, ".png"); err != nil {
			common.SysError(common.LogText("workspace artifact download image failed: userId=%d url=%s err=%s", meta.UserId, url, err.Error()))
		}
	}
	return nil
}

// collectWorkspaceAudioArtifact 处理 /v1/audio/speech 的原始音频字节。
func collectWorkspaceAudioArtifact(ctx context.Context, meta WorkspaceArtifactMeta, contentType string, body []byte) error {
	mimeType := strings.TrimSpace(strings.Split(contentType, ";")[0])
	if mimeType == "" {
		mimeType = "audio/mpeg"
	}
	ext := extensionForMime(mimeType, ".mp3")
	return SaveWorkspaceArtifact(ctx, meta, workspaceArtifactFilename(meta.Kind, ext), mimeType, bytes.NewReader(body), "")
}

// collectWorkspaceTextArtifact 保存文字生成请求提示词与响应正文。
func collectWorkspaceTextArtifact(ctx context.Context, meta WorkspaceArtifactMeta, body []byte) error {
	response := ""
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err == nil {
		if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]any); ok {
				if message, ok := choice["message"].(map[string]any); ok {
					if content, ok := message["content"].(string); ok {
						response = content
					}
				}
				if text, ok := choice["text"].(string); ok && response == "" {
					response = text
				}
			}
		}
	}
	if response == "" {
		response = string(body)
	}
	payloadOut := map[string]string{
		"prompt":   meta.Prompt,
		"response": trimWorkspaceArtifactText(response, 20000),
	}
	encoded, err := common.Marshal(payloadOut)
	if err != nil {
		return err
	}
	return SaveWorkspaceArtifact(ctx, meta, workspaceArtifactFilename(meta.Kind, ".json"), "application/json", bytes.NewReader(encoded), "")
}

// CollectWorkspaceTaskArtifact 在异步任务（视频 / 音乐）终态成功后下载结果并落盘。
// 仅处理中台入口提交的任务（提交时已打上 workspace 标记）。
func CollectWorkspaceTaskArtifact(task *model.Task) {
	if task == nil || !task.PrivateData.Workspace {
		return
	}
	if task.Status != model.TaskStatusSuccess {
		return
	}
	sourceURL := strings.TrimSpace(task.GetResultURL())
	if !strings.HasPrefix(sourceURL, "http") {
		return
	}
	kind := strings.TrimSpace(task.PrivateData.WorkspaceKind)
	if kind == "" {
		kind = "video"
	}
	ext := ".mp4"
	if kind == "music" {
		ext = ".mp3"
	}
	meta := WorkspaceArtifactMeta{
		UserId:  task.UserId,
		ClassId: model.GetWorkspaceClassIdByUserId(task.UserId),
		Kind:    kind,
		Model:   task.Properties.OriginModelName,
		Prompt:  trimWorkspaceArtifactText(task.Properties.Input, 500),
	}
	ctx, cancel := context.WithTimeout(context.Background(), artifactDownloadTimeout)
	defer cancel()
	if err := downloadWorkspaceArtifact(ctx, meta, sourceURL, ext); err != nil {
		common.SysError(common.LogText("workspace artifact download task failed: taskId=%s url=%s err=%s", task.TaskID, sourceURL, err.Error()))
	}
}

// downloadWorkspaceArtifact 下载上游素材并落盘。
func downloadWorkspaceArtifact(ctx context.Context, meta WorkspaceArtifactMeta, sourceURL, fallbackExt string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d", response.StatusCode)
	}
	mimeType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if mimeType == "application/octet-stream" {
		mimeType = ""
	}
	ext := extensionForMime(mimeType, "")
	if ext == "" {
		ext = path.Ext(sourceURL)
	}
	if len(ext) > 8 {
		ext = ""
	}
	if ext == "" {
		ext = fallbackExt
	}
	if mimeType == "" {
		mimeType = mimeForExtension(ext)
	}
	return SaveWorkspaceArtifact(ctx, meta, workspaceArtifactFilename(meta.Kind, ext), mimeType, response.Body, sourceURL)
}

// workspaceArtifactScope 组装存储目录所需的归属信息（年级 / 届 / 班级 / 学生）。
func workspaceArtifactScope(userId, classId int) artifactstore.Scope {
	scope := artifactstore.Scope{UserId: userId}
	if username, err := model.GetUsernameById(userId, false); err == nil {
		scope.UserName = username
	}
	resolvedClassId := classId
	if resolvedClassId <= 0 {
		resolvedClassId = model.GetWorkspaceClassIdByUserId(userId)
	}
	if resolvedClassId > 0 {
		if class, err := model.GetWorkspaceClassById(resolvedClassId); err == nil && class != nil {
			scope.ClassName = class.Name
			scope.EntryYear = class.EntryYear
			scope.StageName = class.SectionName
		}
	}
	return scope
}

// workspaceArtifactFilename 生成带时间戳与随机后缀的文件名，避免同秒覆盖。
func workspaceArtifactFilename(kind, ext string) string {
	suffix, _ := common.GenerateRandomCharsKey(6)
	return fmt.Sprintf("%s-%s-%s%s", kind, time.Now().Format("20060102-150405"), suffix, ext)
}

// extensionForMime 按 MIME 类型推断扩展名。
func extensionForMime(mimeType, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	case "audio/ogg":
		return ".ogg"
	case "audio/aac":
		return ".aac"
	case "audio/mp4", "audio/m4a":
		return ".m4a"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "application/json":
		return ".json"
	}
	return fallback
}

// mimeForExtension 按扩展名推断 MIME 类型（当上游未返回 Content-Type 时使用）。
func mimeForExtension(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".json":
		return "application/json"
	}
	return "application/octet-stream"
}

// trimWorkspaceArtifactText 按字符截断文本。
func trimWorkspaceArtifactText(value string, limit int) string {
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
