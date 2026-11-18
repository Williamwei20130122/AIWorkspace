package asyncgen

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	kitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Adaptor 多厂商异步生成模型的通用适配器：
// 提交侧按厂商规则编译统一请求体并提取任务 ID，轮询侧按配置查询并归一状态。
// 实例不跨请求共享状态：提交配置在 Validate 阶段解析，轮询配置按任务模型名解析。
type Adaptor struct {
	info      *relaycommon.RelayInfo
	resolved  *resolved
	modelName string
	scene     string
	raw       map[string]any
}

// New 创建通用异步适配器实例。
func New() *Adaptor {
	return &Adaptor{}
}

// Init 记录渠道元数据（提交与轮询均会调用）。
func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.info = info
}

// ValidateRequestAndSetAction 解析请求体、推导视频场景并做基础校验。
func (a *Adaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *taskdto.TaskError {
	a.info = info
	var raw map[string]any
	if err := common.UnmarshalBodyReusable(c, &raw); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if raw == nil {
		raw = map[string]any{}
	}
	modelName := ""
	if info != nil {
		modelName = strings.TrimSpace(info.OriginModelName)
	}
	if modelName == "" {
		modelName, _ = raw["model"].(string)
	}
	// 早于 RelayTaskSubmit 的模型名兜底写入 info，避免平台名拼接污染定价键。
	if info != nil && info.OriginModelName == "" && modelName != "" {
		info.OriginModelName = modelName
	}
	scene := deriveScene(raw)
	a.modelName = modelName
	a.scene = scene
	a.raw = raw
	a.resolved = resolve(modelName)
	return relaycommon.ValidateBasicTaskRequest(c, info, actionForScene(scene))
}

// EstimateBilling 按次计费：不产生 OtherRatios（时长等倍率由定价规则与预扣承担）。
func (a *Adaptor) EstimateBilling(_ *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	return nil
}

// AdjustBillingOnSubmit 提交阶段不调整倍率。
func (a *Adaptor) AdjustBillingOnSubmit(_ *relaycommon.RelayInfo, _ []byte) map[string]float64 {
	return nil
}

// AdjustBillingOnComplete 完成阶段不调整额度（按次计费保持预扣/退款语义）。
func (a *Adaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

// BuildRequestURL 按厂商提交端点构建上游地址（支持绝对地址与 {task_id} 场景分接口）。
func (a *Adaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	r := a.current(info)
	path := r.submitPath
	if path == "" && r.scenePaths != nil {
		path = r.scenePaths[a.scene]
	}
	baseURL := ""
	if info != nil {
		baseURL = info.ChannelBaseUrl
	}
	return joinUpstreamURL(baseURL, path)
}

// BuildRequestHeader 设置鉴权、JSON 类型与厂商附加请求头（如 X-DashScope-Async）。
func (a *Adaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	if req == nil {
		return errors.New("request is nil")
	}
	key := ""
	if info != nil {
		key = info.ApiKey
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	r := a.current(info)
	for name, value := range r.headers {
		req.Header.Set(name, value)
	}
	return nil
}

// BuildRequestBody 编译厂商请求体（场景分支 + 场景/模型微调覆盖），始终非流式。
func (a *Adaptor) BuildRequestBody(_ *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	r := a.current(info)
	body := r.buildBody(a.modelName, a.scene, a.raw)
	encoded, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(encoded), nil
}

// DoRequest 强制非流式提交，复用统一任务请求执行链。
func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	if info == nil {
		return nil, errors.New("relay info is missing")
	}
	wasStream := info.IsStream
	info.IsStream = false
	defer func() { info.IsStream = wasStream }()
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// ParseResponse 从提交响应提取厂商任务 ID，原始响应整体保留为任务数据。
func (a *Adaptor) ParseResponse(_ *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*channel.TaskSubmitResponse, *taskdto.TaskError) {
	if resp == nil || resp.Body == nil {
		return nil, service.TaskErrorWrapperLocal(errors.New("empty vendor response"), "task_submit_response_invalid", http.StatusBadGateway)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, service.TaskErrorWrapperLocal(err, "read_submit_response_failed", http.StatusBadGateway)
	}
	r := a.current(info)
	taskID := extractFirst(body, taskIDPathCandidates(r))
	if taskID == "" {
		return nil, service.TaskErrorWrapperLocal(errors.New("vendor response has no task id"), "task_submit_response_invalid", http.StatusBadGateway)
	}
	return &channel.TaskSubmitResponse{UpstreamTaskID: taskID, TaskData: body}, nil
}

// GetModelList 通用适配器不绑定固定模型列表。
func (a *Adaptor) GetModelList() []string {
	return nil
}

// GetChannelName 渠道展示名。
func (a *Adaptor) GetChannelName() string {
	return "asyncgen"
}

// FetchTask 按配置查询任务状态（秒级轮询由服务端调度，禁止毫秒级高频查询）。
func (a *Adaptor) FetchTask(baseURL, key string, task *model.Task, proxy string) (*http.Response, error) {
	r := resolve(taskModelName(task))
	if r.queryPath == "" {
		return nil, fmt.Errorf("async query path is not configured for model %q", taskModelName(task))
	}
	upstreamID := task.GetUpstreamTaskID()
	if upstreamID == "" {
		return nil, errors.New("task has no upstream task id")
	}
	queryPath := strings.ReplaceAll(r.queryPath, "{task_id}", url.PathEscape(upstreamID))
	queryURL, err := joinUpstreamURL(baseURL, queryPath)
	if err != nil {
		return nil, err
	}
	method := strings.ToUpper(strings.TrimSpace(r.queryMethod))
	if method == "" {
		method = http.MethodGet
	}
	var body io.Reader
	if method == http.MethodPost {
		body = strings.NewReader("{}")
	}
	req, err := http.NewRequest(method, queryURL, body)
	if err != nil {
		return nil, err
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, value := range r.headers {
		req.Header.Set(name, value)
	}
	if a.info != nil {
		if err := channel.ApplyHeaderOverride(a.info, nil, req); err != nil {
			return nil, err
		}
	}
	client, err := service.GetHttpClientWithProxySettings(proxy, a.channelSetting())
	if err != nil {
		return nil, err
	}
	// 复用缓存 transport，但本次查询独立限制重定向：禁止把凭证降级到 HTTP。
	queryClient := *client
	queryClient.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if strings.EqualFold(via[len(via)-1].URL.Scheme, "https") && !strings.EqualFold(next.URL.Scheme, "https") {
			return errors.New("task query redirect cannot downgrade HTTPS")
		}
		if client.CheckRedirect != nil {
			return client.CheckRedirect(next, via)
		}
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}
	return queryClient.Do(req)
}

// ParseTaskResult 把厂商查询响应归一为统一任务状态与结果地址。
func (a *Adaptor) ParseTaskResult(task *model.Task, _ *http.Response, respBody []byte) (*relaycommon.TaskInfo, error) {
	if len(respBody) == 0 {
		return nil, errors.New("empty task query response")
	}
	r := resolve(taskModelName(task))
	statusRaw := extractFirst(respBody, statusPathCandidates(r))
	generic := mapVendorStatus(statusRaw, r)
	var status model.TaskStatus
	switch generic {
	case "succeeded":
		status = model.TaskStatusSuccess
	case "failed":
		status = model.TaskStatusFailure
	case "queued":
		status = model.TaskStatusQueued
	case "running":
		status = model.TaskStatusInProgress
	default:
		status = model.TaskStatusSubmitted
	}
	info := &relaycommon.TaskInfo{Status: string(status)}
	switch status {
	case model.TaskStatusSuccess:
		info.Progress = "100%"
		info.Url = firstResultURL(respBody, r)
	case model.TaskStatusFailure:
		info.Reason = extractError(respBody, r)
		if info.Reason == "" {
			info.Reason = statusRaw
		}
	}
	return info, nil
}

// current 取提交侧生效配置（未初始化时按模型名兜底解析）。
func (a *Adaptor) current(info *relaycommon.RelayInfo) *resolved {
	if a.resolved != nil {
		return a.resolved
	}
	modelName := a.modelName
	if modelName == "" && info != nil {
		modelName = info.OriginModelName
	}
	r := resolve(modelName)
	a.resolved = r
	return r
}

// channelSetting 轮询链携带的渠道设置（无渠道元数据时为零值）。
func (a *Adaptor) channelSetting() kitdto.ChannelSettings {
	if a.info != nil {
		return a.info.ChannelSetting
	}
	return kitdto.ChannelSettings{}
}

// taskModelName 从任务属性取模型名（提交链路写入 OriginModelName，兼容旧任务）。
func taskModelName(task *model.Task) string {
	if task == nil {
		return ""
	}
	if name := strings.TrimSpace(task.Properties.OriginModelName); name != "" {
		return name
	}
	return strings.TrimSpace(task.Properties.UpstreamModelName)
}

// joinUpstreamURL 拼接渠道基地址与上游路径（支持绝对地址）。
func joinUpstreamURL(baseURL, path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("async task endpoint path is not configured")
	}
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path, nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return "", errors.New("channel base url is empty")
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return baseURL + path, nil
}

// firstResultURL 依次按配置与常见路径提取结果地址。
func firstResultURL(body []byte, r *resolved) string {
	paths := make([]string, 0, 8)
	if r != nil && r.resultPath != "" {
		paths = append(paths, r.resultPath)
	}
	paths = append(paths, "url", "video_url", "output.video_url", "content.video_url", "task.content.url", "data.url", "creations")
	for _, path := range paths {
		if urls := extractURLs(body, path); len(urls) > 0 {
			return urls[0]
		}
	}
	return ""
}
