package asyncgen

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/tidwall/gjson"
)

// Platform 通用异步适配器的任务平台标识：提交与轮询链都据此分流到本适配器。
const Platform constant.TaskPlatform = "asyncgen"

// 视频场景标识（对应 WorkspaceAsyncConfig.SceneParams 的键）。
const (
	SceneTextToVideo      = "t2v"              // 文字生成视频
	SceneImageToVideo     = "i2v"              // 单图生成视频
	SceneFirstLastFrame   = "first_last_frame" // 首尾帧生成
	SceneSubjectReference = "subject"          // 主体参考生成
)

// resolved 厂商异步接口的生效配置：内置厂商默认值 + 管理端 AsyncConfig 覆盖。
type resolved struct {
	vendor      string
	submitPath  string
	scenePaths  map[string]string // 场景专用提交路径（腾讯 Vidu 按场景分接口）
	queryPath   string            // 含 {task_id} 占位
	queryMethod string
	taskIDPath  string
	statusPath  string
	resultPath  string
	errorPath   string
	headers     map[string]string
	statusMap   map[string]string // 厂商状态（小写）→ 通用状态
	cfg         *setting.WorkspaceAsyncConfig
}

// vendorSpec 各厂商异步接口的内置默认规格（依据 api-topic 厂商文档）。
func vendorSpec(vendor string) *resolved {
	switch vendor {
	case "volcengine":
		return &resolved{
			vendor:      vendor,
			submitPath:  "/api/v3/contents/generations/tasks",
			queryPath:   "/api/v3/contents/generations/tasks/{task_id}",
			queryMethod: "GET",
			taskIDPath:  "id",
			statusPath:  "status",
			resultPath:  "content.video_url",
			errorPath:   "error.message",
			statusMap: map[string]string{
				"queued": "queued", "running": "running", "succeeded": "succeeded",
				"failed": "failed", "cancelled": "failed", "canceled": "failed", "expired": "failed",
			},
		}
	case "zhipu":
		return &resolved{
			vendor:      vendor,
			submitPath:  "/api/paas/v4/videos/generations",
			queryPath:   "/api/paas/v4/async-result/{task_id}",
			queryMethod: "GET",
			taskIDPath:  "id",
			statusPath:  "task_status",
			resultPath:  "video_result",
			errorPath:   "error.message",
			statusMap: map[string]string{
				"processing": "running", "success": "succeeded",
				"fail": "failed", "failed": "failed",
			},
		}
	case "minimax":
		return &resolved{
			vendor:      vendor,
			submitPath:  "/v2/video_generation",
			queryPath:   "/v2/query/video_generation/{task_id}",
			queryMethod: "GET",
			taskIDPath:  "task.id",
			statusPath:  "task.status",
			resultPath:  "task.content.url",
			errorPath:   "task.error.message",
			statusMap: map[string]string{
				"queued": "queued", "running": "running", "succeeded": "succeeded",
				"failed": "failed", "cancelled": "failed", "canceled": "failed",
			},
		}
	case "aliyun":
		return &resolved{
			vendor:      vendor,
			submitPath:  "/api/v1/services/aigc/video-generation/video-synthesis",
			queryPath:   "/api/v1/tasks/{task_id}",
			queryMethod: "GET",
			taskIDPath:  "output.task_id",
			statusPath:  "output.task_status",
			resultPath:  "output.video_url",
			errorPath:   "output.message",
			headers:     map[string]string{"X-DashScope-Async": "enable"},
			statusMap: map[string]string{
				"pending": "queued", "running": "running", "succeeded": "succeeded",
				"failed": "failed", "canceled": "failed", "cancelled": "failed", "unknown": "submitted",
			},
		}
	case "tencent":
		// 腾讯 TokenHub Vidu：提交按场景分接口，查询统一 /tasks/{task_id}。
		return &resolved{
			vendor: vendor,
			scenePaths: map[string]string{
				SceneTextToVideo:      "/v1/wand/vidu/text-to-video",
				SceneImageToVideo:     "/v1/wand/vidu/image-to-video",
				SceneFirstLastFrame:   "/v1/wand/vidu/start-end-to-video",
				SceneSubjectReference: "/v1/wand/vidu/reference-to-video",
			},
			queryPath:   "/v1/wand/vidu/tasks/{task_id}",
			queryMethod: "GET",
			taskIDPath:  "task_id",
			statusPath:  "state",
			resultPath:  "creations",
			errorPath:   "message",
			statusMap: map[string]string{
				"created": "queued", "queueing": "queued", "processing": "running",
				"success": "succeeded", "failed": "failed", "submitted": "submitted",
			},
		}
	default:
		// generic：完全依赖管理端 AsyncConfig 提供端点与映射。
		return &resolved{vendor: "generic", queryMethod: "GET"}
	}
}

// inferVendor 按模型名关键词推断厂商，用于未显式配置 vendor 时命中内置规则。
func inferVendor(model string) string {
	m := strings.ToLower(model)
	switch {
	case strings.Contains(m, "seedance"), strings.Contains(m, "doubao"), strings.Contains(m, "volc"):
		return "volcengine"
	case strings.Contains(m, "glm"), strings.Contains(m, "cogvideo"), strings.Contains(m, "zhipu"):
		return "zhipu"
	case strings.Contains(m, "minimax"), strings.Contains(m, "hailuo"):
		return "minimax"
	case strings.Contains(m, "wan"), strings.Contains(m, "videocomposer"), strings.Contains(m, "dashscope"):
		return "aliyun"
	case strings.Contains(m, "vidu"), strings.Contains(m, "kling"), strings.Contains(m, "hunyuan"), strings.Contains(m, "vega"):
		return "tencent"
	default:
		return "generic"
	}
}

// resolve 合并模型异步配置与厂商内置默认值，得到生效配置。
func resolve(model string) *resolved {
	cfg, _, _ := setting.WorkspaceAsyncConfigForModel(model)
	vendor := ""
	if cfg != nil {
		vendor = strings.ToLower(strings.TrimSpace(cfg.Vendor))
	}
	if vendor == "" {
		vendor = inferVendor(model)
	}
	r := vendorSpec(vendor)
	r.cfg = cfg
	if cfg == nil {
		return r
	}
	if p := strings.TrimSpace(cfg.SubmitPath); p != "" {
		r.submitPath = p
	}
	if p := strings.TrimSpace(cfg.QueryPath); p != "" {
		r.queryPath = p
	}
	if m := strings.ToUpper(strings.TrimSpace(cfg.QueryMethod)); m != "" {
		r.queryMethod = m
	}
	if p := strings.TrimSpace(cfg.TaskIDPath); p != "" {
		r.taskIDPath = p
	}
	if p := strings.TrimSpace(cfg.StatusPath); p != "" {
		r.statusPath = p
	}
	if p := strings.TrimSpace(cfg.ResultPath); p != "" {
		r.resultPath = p
	}
	if p := strings.TrimSpace(cfg.ErrorPath); p != "" {
		r.errorPath = p
	}
	for name, value := range cfg.Headers {
		if r.headers == nil {
			r.headers = map[string]string{}
		}
		r.headers[name] = value
	}
	for vendorStatus, generic := range cfg.StatusMap {
		if r.statusMap == nil {
			r.statusMap = map[string]string{}
		}
		r.statusMap[strings.ToLower(strings.TrimSpace(vendorStatus))] = strings.ToLower(strings.TrimSpace(generic))
	}
	return r
}

// genericStatusMap 未命中厂商映射时的通用状态归一表。
var genericStatusMap = map[string]string{
	"queued": "queued", "pending": "queued", "created": "queued", "waiting": "queued",
	"submitted": "submitted", "not_start": "submitted",
	"running": "running", "processing": "running", "in_progress": "running",
	"started": "running", "generating": "running", "update": "running",
	"succeeded": "succeeded", "success": "succeeded", "succeed": "succeeded",
	"successful": "succeeded", "completed": "succeeded", "done": "succeeded",
	"failed": "failed", "failure": "failed", "fail": "failed", "error": "failed",
	"cancelled": "failed", "canceled": "failed", "expired": "failed",
}

// mapVendorStatus 把厂商状态字符串归一为通用状态（queued|running|succeeded|failed|submitted）。
// 依次尝试：配置映射精确匹配 → 配置映射小写匹配 → 厂商内置映射 → 通用映射 → submitted（保持非终态）。
func mapVendorStatus(raw string, r *resolved) string {
	status := strings.TrimSpace(raw)
	if status == "" {
		return "submitted"
	}
	if r != nil && r.statusMap != nil {
		if generic, ok := r.statusMap[status]; ok {
			return generic
		}
		if generic, ok := r.statusMap[strings.ToLower(status)]; ok {
			return generic
		}
	}
	if generic, ok := genericStatusMap[strings.ToLower(status)]; ok {
		return generic
	}
	return "submitted"
}

// statusPathCandidates 状态路径未命中时的常见后备路径。
func statusPathCandidates(r *resolved) []string {
	paths := make([]string, 0, 8)
	if r != nil && r.statusPath != "" {
		paths = append(paths, r.statusPath)
	}
	return append(paths, "status", "task_status", "state", "task.status", "data.status", "output.task_status", "data.state")
}

// taskIDPathCandidates 任务 ID 提取的后备路径。
func taskIDPathCandidates(r *resolved) []string {
	paths := make([]string, 0, 8)
	if r != nil && r.taskIDPath != "" {
		paths = append(paths, r.taskIDPath)
	}
	return append(paths, "id", "task_id", "task.id", "data.id", "data.task_id", "output.task_id")
}

// extractFirst 依次尝试点分路径，返回第一个命中的字符串值。
func extractFirst(body []byte, paths []string) string {
	for _, path := range paths {
		if path == "" {
			continue
		}
		value := gjson.GetBytes(body, path)
		if !value.Exists() {
			continue
		}
		if value.Type == gjson.String {
			if text := strings.TrimSpace(value.String()); text != "" {
				return text
			}
			continue
		}
		if value.Type == gjson.Number || value.IsBool() {
			return value.Raw
		}
	}
	return ""
}

// extractURLs 提取结果地址列表：路径可指向字符串、对象（取 url/video_url）或数组。
func extractURLs(body []byte, path string) []string {
	if path == "" {
		return nil
	}
	value := gjson.GetBytes(body, path)
	if !value.Exists() {
		return nil
	}
	urls := make([]string, 0, 2)
	appendValue := func(v gjson.Result) {
		if v.Type == gjson.String {
			if text := strings.TrimSpace(v.String()); text != "" {
				urls = append(urls, text)
			}
			return
		}
		if v.IsObject() {
			for _, key := range []string{"url", "video_url", "file_url"} {
				if child := v.Get(key); child.Exists() && child.Type == gjson.String {
					if text := strings.TrimSpace(child.String()); text != "" {
						urls = append(urls, text)
						return
					}
				}
			}
		}
	}
	if value.IsArray() {
		value.ForEach(func(_, item gjson.Result) bool {
			appendValue(item)
			return true
		})
		return urls
	}
	appendValue(value)
	return urls
}

// extractError 提取失败原因：优先配置路径，其次常见错误字段。
func extractError(body []byte, r *resolved) string {
	paths := make([]string, 0, 6)
	if r != nil && r.errorPath != "" {
		paths = append(paths, r.errorPath)
	}
	paths = append(paths, "error.message", "message", "task.error.message", "output.message", "data.message")
	return extractFirst(body, paths)
}
