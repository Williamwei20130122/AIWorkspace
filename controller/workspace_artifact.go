package controller

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/artifactstore"

	"github.com/gin-gonic/gin"
)

// ---------- 参考素材上传：图生图源图 / 视频参考图 ----------

// workspaceUploadMaxBytes 参考素材单文件大小上限。
const workspaceUploadMaxBytes = 32 << 20

// workspaceUploadTimeout 上传落盘（写入本地磁盘）超时。
const workspaceUploadTimeout = 2 * time.Minute

// UploadWorkspaceAsset 接收用户上传的参考素材，写入本地磁盘并返回可引用的访问地址。
// 图生图会在 multipart 表单中直接携带文件（另在生成链路中落盘）；
// 视频参考图则先用本接口拿到 URL，再放进生成请求的 image / images 字段。
func UploadWorkspaceAsset(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "登录状态无效，请重新登录")
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	if fileHeader.Size > workspaceUploadMaxBytes {
		common.ApiErrorMsg(c, fmt.Sprintf("文件过大，最大支持 %dMB", workspaceUploadMaxBytes>>20))
		return
	}
	source, err := fileHeader.Open()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer source.Close()

	mimeType := strings.TrimSpace(fileHeader.Header.Get("Content-Type"))
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mimeTypeForUploadName(fileHeader.Filename)
	}
	ctx, cancel := context.WithTimeout(context.Background(), workspaceUploadTimeout)
	defer cancel()
	artifact, err := service.SaveWorkspaceInputArtifact(
		ctx,
		userId,
		model.GetWorkspaceClassIdByUserId(userId),
		fileHeader.Filename,
		mimeType,
		source,
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if artifact == nil {
		common.ApiErrorMsg(c, "上传失败，请重新登录后重试")
		return
	}
	// share_class_id >0 时直接标记为班级共享素材（教师备课上传参考资料用）。
	if shareClassId, _ := strconv.Atoi(c.PostForm("share_class_id")); shareClassId > 0 {
		if err := model.SetWorkspaceArtifactShare(artifact.Id, shareClassId); err == nil {
			artifact.ShareClassId = shareClassId
		}
	}
	// 素材统一走受鉴权的内容接口访问（纯内网本地磁盘存储）。
	url := fmt.Sprintf("/api/workspace/artifacts/%d/content", artifact.Id)
	common.ApiSuccess(c, gin.H{
		"id":           artifact.Id,
		"kind":         artifact.Kind,
		"storage_path": artifact.StoragePath,
		"url":          url,
		"size_bytes":   artifact.SizeBytes,
		"mime_type":    artifact.MimeType,
	})
}

// mimeTypeForUploadName 按文件名后缀推断上传素材的类型。
func mimeTypeForUploadName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	default:
		return "application/octet-stream"
	}
}

// ---------- 云端素材：列表 / 预览 / 删除 / 批量清理 ----------

// GetWorkspaceArtifacts 查询素材列表（教师仅能看到自己名下学生的素材）。
func GetWorkspaceArtifacts(c *gin.Context) {
	query, ok := workspaceArtifactQueryFromRequest(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	items, total, err := model.ListWorkspaceArtifacts(query, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.AggregateWorkspaceArtifactStats(query)
	if err != nil {
		stats = nil
	}
	common.ApiSuccess(c, gin.H{
		"items": items,
		"total": total,
		"stats": stats,
	})
}

// GetWorkspaceArtifactContent 读取素材文件（教师端预览 / 下载）。
func GetWorkspaceArtifactContent(c *gin.Context) {
	artifact, ok := workspaceArtifactById(c)
	if !ok {
		return
	}
	if artifact.FilePurged {
		common.ApiError(c, common.NewMessage("该素材已超过保留期限自动清理，记录保留但不可预览下载"))
		return
	}
	reader, err := artifactstore.Default().Open(artifact.StoragePath)
	if err != nil {
		common.ApiError(c, common.NewMessage("素材文件不存在或已被清理"))
		return
	}
	defer reader.Close()

	mimeType := artifact.MimeType
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	c.Header("Content-Type", mimeType)
	disposition := "inline"
	if c.Query("download") == "1" {
		disposition = "attachment"
	}
	c.Header("Content-Disposition", disposition+`; filename="`+filepath.Base(artifact.StoragePath)+`"`)
	c.Status(200)
	if _, err := io.Copy(c.Writer, reader); err != nil {
		common.SysError(common.LogText("workspace artifact serve failed: id=%d err=%s", artifact.Id, err.Error()))
	}
}

// SetWorkspaceArtifactShare 设置 / 取消素材的班级共享：
// body {id, share_class_id}，share_class_id=0 表示取消共享。
type workspaceArtifactShareRequest struct {
	Id           int `json:"id"`
	ShareClassId int `json:"share_class_id"`
}

func ShareWorkspaceArtifact(c *gin.Context) {
	var req workspaceArtifactShareRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id <= 0 {
		common.ApiError(c, common.NewMessage("素材不存在"))
		return
	}
	if req.ShareClassId > 0 {
		if _, err := model.GetWorkspaceClassById(req.ShareClassId); err != nil {
			common.ApiError(c, common.NewMessage("班级不存在"))
			return
		}
	}
	if err := model.SetWorkspaceArtifactShare(req.Id, req.ShareClassId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": req.Id, "share_class_id": req.ShareClassId})
}

// GetWorkspaceSharedArtifacts 学生端：本班共享素材库（含其他同学与教师共享的素材）。
// 只读列表，素材内容仍走 /artifacts/:id/content 统一鉴权分发。
func GetWorkspaceSharedArtifacts(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "登录状态无效，请重新登录")
		return
	}
	classId := model.GetWorkspaceClassIdByUserId(userId)
	if classId <= 0 {
		common.ApiSuccess(c, gin.H{"items": []any{}, "total": 0})
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	query := model.WorkspaceArtifactQuery{ShareClassId: classId}
	items, total, err := model.ListWorkspaceArtifacts(query, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total})
}

// DeleteWorkspaceArtifact 删除单份素材。
func DeleteWorkspaceArtifact(c *gin.Context) {
	artifact, ok := workspaceArtifactById(c)
	if !ok {
		return
	}
	removed, released := purgeWorkspaceArtifacts([]*model.WorkspaceArtifact{artifact})
	common.ApiSuccess(c, gin.H{"deleted": removed, "released_bytes": released})
}

type workspaceArtifactPurgeRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Mode    string `json:"mode"`
	ClassId int    `json:"class_id"`
	Ids     []int  `json:"ids"`
}

// workspacePackageMaxFiles 单次打包下载的文件数上限。
const workspacePackageMaxFiles = 200

type workspaceArtifactPackageRequest struct {
	Ids []int `json:"ids"`
}

// PackageWorkspaceArtifacts 把选中的云端素材打包为 zip 流式下载。
// 复用 GetWorkspaceArtifactContent 的取文件逻辑（artifactstore.Open），
// 逐个写入 zip 条目直接输出到 c.Writer。
func PackageWorkspaceArtifacts(c *gin.Context) {
	var req workspaceArtifactPackageRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	seen := make(map[int]bool, len(req.Ids))
	ids := make([]int, 0, len(req.Ids))
	for _, id := range req.Ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= workspacePackageMaxFiles {
			break
		}
	}
	if len(ids) == 0 {
		common.ApiError(c, common.NewMessage("请选择要打包下载的素材"))
		return
	}
	items, err := model.GetWorkspaceArtifactsByIds(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(items) == 0 {
		common.ApiError(c, common.NewMessage("素材不存在"))
		return
	}
	store := artifactstore.Default()
	filename := fmt.Sprintf("workspace-artifacts-%s.zip", time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Status(200)
	writer := zip.NewWriter(c.Writer)
	defer writer.Close()
	used := make(map[string]int, len(items))
	for _, item := range items {
		if item.FilePurged {
			continue
		}
		reader, openErr := store.Open(item.StoragePath)
		if openErr != nil {
			common.SysError(common.LogText("workspace artifact package open failed: id=%d path=%s err=%s", item.Id, item.StoragePath, openErr.Error()))
			continue
		}
		name := filepath.Base(item.StoragePath)
		if used[name] > 0 {
			ext := filepath.Ext(name)
			name = fmt.Sprintf("%s-%d%s", strings.TrimSuffix(name, ext), item.Id, ext)
		}
		used[filepath.Base(item.StoragePath)]++
		entry, createErr := writer.Create(name)
		if createErr != nil {
			_ = reader.Close()
			common.SysError(common.LogText("workspace artifact package create failed: id=%d err=%s", item.Id, createErr.Error()))
			continue
		}
		if _, copyErr := io.Copy(entry, reader); copyErr != nil {
			common.SysError(common.LogText("workspace artifact package copy failed: id=%d err=%s", item.Id, copyErr.Error()))
		}
		_ = reader.Close()
	}
}

// PurgeWorkspaceArtifacts 批量清理素材，body 支持三种方式：
// {ids} 清理勾选的素材、{from,to} 按时间段、{mode:"class",class_id} 按班级。
func PurgeWorkspaceArtifacts(c *gin.Context) {
	var req workspaceArtifactPurgeRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	// 勾选清理：直接按素材 id 清理。
	if len(req.Ids) > 0 {
		items, err := model.GetWorkspaceArtifactsByIds(req.Ids)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		removed, released := purgeWorkspaceArtifacts(items)
		common.ApiSuccess(c, gin.H{"deleted": removed, "released_bytes": released})
		return
	}
	query := model.WorkspaceArtifactQuery{}
	switch {
	case strings.TrimSpace(req.Mode) == "class" && req.ClassId > 0:
		query.ClassId = req.ClassId
	case strings.TrimSpace(req.From) != "" || strings.TrimSpace(req.To) != "":
		start, end := workspaceArtifactDateRange(req.From, req.To)
		if start == 0 && end == 0 {
			common.ApiError(c, common.NewMessage("时间格式不正确，应为 YYYY-MM-DD"))
			return
		}
		query.StartTimestamp = start
		query.EndTimestamp = end
	default:
		common.ApiError(c, common.NewMessage("请指定清理范围：ids / from,to / mode+class_id"))
		return
	}

	items, err := model.AllWorkspaceArtifacts(query)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	removed, released := purgeWorkspaceArtifacts(items)
	common.ApiSuccess(c, gin.H{"deleted": removed, "released_bytes": released})
}

// purgeWorkspaceArtifacts 删除素材文件与记录，返回删除条数与释放字节数。
func purgeWorkspaceArtifacts(items []*model.WorkspaceArtifact) (int, int64) {
	if len(items) == 0 {
		return 0, 0
	}
	store := artifactstore.Default()
	ids := make([]int, 0, len(items))
	var released int64
	for _, item := range items {
		if err := store.Delete(item.StoragePath); err != nil {
			common.SysError(common.LogText("workspace artifact delete file failed: id=%d path=%s err=%s", item.Id, item.StoragePath, err.Error()))
			continue
		}
		ids = append(ids, item.Id)
		released += item.SizeBytes
	}
	if err := model.DeleteWorkspaceArtifactsByIds(ids); err != nil {
		common.SysError(common.LogText("workspace artifact delete records failed: %s", err.Error()))
	}
	return len(ids), released
}

// workspaceArtifactIdFromMediaUrl 从素材内容地址中解析素材 id
// （形如 /api/workspace/teacher/artifacts/12/content 或 /admin/artifacts/12/content）。
func workspaceArtifactIdFromMediaUrl(mediaUrl string) int {
	mediaUrl = strings.TrimSpace(mediaUrl)
	idx := strings.Index(mediaUrl, "/artifacts/")
	if idx < 0 {
		return 0
	}
	rest := mediaUrl[idx+len("/artifacts/"):]
	if end := strings.IndexAny(rest, "/?"); end >= 0 {
		rest = rest[:end]
	}
	id, err := strconv.Atoi(rest)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

// workspaceArtifactQueryFromRequest 组装素材查询条件。
// 教师 / 管理员可查看全部学生的素材，仅按请求参数过滤，不做教师维度限制。
func workspaceArtifactQueryFromRequest(c *gin.Context) (model.WorkspaceArtifactQuery, bool) {
	query := model.WorkspaceArtifactQuery{}
	query.ClassId, _ = strconv.Atoi(c.Query("class_id"))
	query.UserId, _ = strconv.Atoi(c.Query("user_id"))
	// mine=1 只看当前登录账号上传的素材（备课参考资料选择器用）。
	if c.Query("mine") == "1" || strings.EqualFold(c.Query("mine"), "true") {
		query.UserId = c.GetInt("id")
	}
	query.Kind = strings.TrimSpace(c.Query("kind"))
	// 按学生姓名 / 年级 / 班级筛选：把组织维度换算为学生 userId 列表，
	// 避免前端直接暴露或依赖原生 user_id。
	sectionId, _ := strconv.Atoi(c.Query("section_id"))
	gradeIndex, _ := strconv.Atoi(c.Query("grade_index"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	includeGraduated := c.Query("include_graduated") == "1" || strings.EqualFold(c.Query("include_graduated"), "true")
	// shared=1 只看班级共享素材；share_class_id 直接按共享范围查询（不换算学生列表）。
	if c.Query("share_class_id") != "" {
		query.ShareClassId, _ = strconv.Atoi(c.Query("share_class_id"))
	}
	onlyShared := c.Query("shared") == "1" || strings.EqualFold(c.Query("shared"), "true")
	if onlyShared {
		query.SharedOnly = true
	}
	onlyMine := c.Query("mine") == "1" || strings.EqualFold(c.Query("mine"), "true")
	if !onlyShared && query.ShareClassId <= 0 &&
		(query.ClassId > 0 || sectionId > 0 || keyword != "") {
		ids, err := model.FindWorkspaceStudentUserIds(query.ClassId, sectionId, gradeIndex, keyword, includeGraduated)
		if err != nil {
			common.ApiError(c, err)
			return query, false
		}
		query.UserIds = ids
		query.ClassId = 0
	}
	// 未显式筛选类型时，默认隐藏参考素材（图生图源图 / 视频参考图）等过渡输入，
	// 云端素材页面只展示真正的生成产物；班级共享素材不受此限制（参考资料本身就是 input）。
	if query.Kind == "" && !onlyShared && !onlyMine && query.ShareClassId <= 0 {
		query.ExcludeKind = service.WorkspaceInputKind
	}
	start, end := workspaceArtifactDateRange(c.Query("from"), c.Query("to"))
	if strings.TrimSpace(c.Query("from")) != "" && start == 0 {
		common.ApiError(c, common.NewMessage("时间格式不正确，应为 YYYY-MM-DD"))
		return query, false
	}
	query.StartTimestamp = start
	query.EndTimestamp = end
	return query, true
}

// workspaceArtifactById 读取素材并做可见性校验：归属者本人始终可见，教师 / 管理员可查看全部。
func workspaceArtifactById(c *gin.Context) (*model.WorkspaceArtifact, bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiError(c, common.NewMessage("素材不存在"))
		return nil, false
	}
	artifact, err := model.GetWorkspaceArtifactById(id)
	if err != nil {
		common.ApiError(c, common.NewMessage("素材不存在"))
		return nil, false
	}
	return artifact, true
}

// workspaceArtifactDateRange 把 YYYY-MM-DD 日期解析为左闭右开时间戳区间。
// from 为空表示不限起点，to 为空表示不限终点；非法格式返回 0,0。
func workspaceArtifactDateRange(from, to string) (int64, int64) {
	var start, end int64
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from != "" {
		parsed, err := time.ParseInLocation("2006-01-02", from, time.Local)
		if err != nil {
			return 0, 0
		}
		start = parsed.Unix()
	}
	if to != "" {
		parsed, err := time.ParseInLocation("2006-01-02", to, time.Local)
		if err != nil {
			return 0, 0
		}
		end = parsed.AddDate(0, 0, 1).Unix()
	}
	return start, end
}
