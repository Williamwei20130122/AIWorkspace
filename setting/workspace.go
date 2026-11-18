package setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// WorkspaceModelCapabilitiesKey 模型能力声明：按模型记录它支持哪些生成模态。
// 学生在模型管理里为每个模型勾选能力，学生端据此派生固定的六张能力卡片。
const WorkspaceModelCapabilitiesKey = "WorkspaceModelCapabilities"

// WorkspacePlatformNameKey 平台名称由管理端「定价规则」页维护，用于替换面向学生展示的中台名称。
const WorkspacePlatformNameKey = "WorkspacePlatformName"

// WorkspaceArtifactRetentionDaysKey 云端素材自动清理的保留天数配置项。
// 值为 0 或非数字表示关闭自动清理。
const WorkspaceArtifactRetentionDaysKey = "WorkspaceArtifactRetentionDays"

// GetWorkspaceArtifactRetentionDays 读取云端素材保留天数，非法值回落 0（关闭）。
func GetWorkspaceArtifactRetentionDays() int {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspaceArtifactRetentionDaysKey]
	}
	common.OptionMapRWMutex.RUnlock()
	days, _ := strconv.Atoi(strings.TrimSpace(raw))
	return days
}

// NormalizeWorkspaceArtifactRetentionDays 校验并归一化保留天数（0 表示关闭，上限 3650 天）。
func NormalizeWorkspaceArtifactRetentionDays(value string) (string, error) {
	days, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || days < 0 || days > 3650 {
		return "", common.NewMessage("素材保留天数须为 0-3650 之间的整数（0 表示关闭自动清理）")
	}
	return strconv.Itoa(days), nil
}

// DefaultWorkspacePlatformName 未配置时的中台展示名称。
const DefaultWorkspacePlatformName = "AI Workspace"

// workspaceKindMeta 单个模态的固定展示信息与生成入口。
type workspaceKindMeta struct {
	Kind  string
	Name  string
	Desc  string
	QPath string
	// Hidden 仅在管理端可见（用于「HTML 编程实验室」这类不作为能力卡片展示的功能）。
	Hidden bool
}

// workspaceKindMetas 学生端能力卡片的固定顺序（文生文/文生图/图生图/视频/音乐/声音）。
func workspaceKindMetas() []workspaceKindMeta {
	return []workspaceKindMeta{
		{Kind: "text", Name: "文生文", Desc: "输入主题或问题，生成文本内容"},
		{Kind: "image", Name: "文生图", Desc: "输入文字描述，生成图片"},
		{Kind: "edit", Name: "图生图", Desc: "上传图片并输入要求，生成新图片"},
		{Kind: "video", Name: "视频生成", Desc: "输入文字描述，生成视频", QPath: "/api/workspace/task"},
		{Kind: "music", Name: "音乐生成", Desc: "输入歌词或风格描述，生成音乐", QPath: "/api/workspace/task"},
		{Kind: "tts", Name: "声音合成", Desc: "输入文字，合成语音朗读"},
		// HTML 编程实验室：常驻独立入口，不参与能力卡片渲染，但保留定价与模型声明。
		{Kind: "html", Name: "HTML 编程", Desc: "通过 AI 对话生成与修改 HTML 页面", Hidden: true},
		// 演示实验室（Slide Lab）：常驻独立入口，不参与能力卡片渲染，但保留定价与模型声明。
		{Kind: "slide", Name: "演示文稿", Desc: "通过 AI 生成网页版演示文稿", Hidden: true},
	}
}

// WorkspaceKindHTML HTML 编程实验室的能力标识。
const WorkspaceKindHTML = "html"

// WorkspaceKindSlide 演示实验室（Slide Lab）的能力标识。
const WorkspaceKindSlide = "slide"

func isWorkspaceKind(kind string) bool {
	for _, meta := range workspaceKindMetas() {
		if meta.Kind == kind {
			return true
		}
	}
	return false
}

// DefaultWorkspaceMusicPlugin 音乐生成默认使用的任务插件。
const DefaultWorkspaceMusicPlugin = "sunoapi"

// 模型能力的开放范围：仅学生 / 仅教师 / 两者。
const (
	WorkspaceAudienceStudent = "student"
	WorkspaceAudienceTeacher = "teacher"
	WorkspaceAudienceBoth    = "both"
)

// workspaceAudienceAllows 判断某个开放范围是否对当前角色可见。
func workspaceAudienceAllows(audience string, isTeacher bool) bool {
	switch normalizeWorkspaceAudience(audience) {
	case WorkspaceAudienceStudent:
		return !isTeacher
	case WorkspaceAudienceTeacher:
		return isTeacher
	default:
		return true
	}
}

// normalizeWorkspaceAudience 归一化开放范围，非法值一律回落「两者」。
func normalizeWorkspaceAudience(audience string) string {
	switch strings.ToLower(strings.TrimSpace(audience)) {
	case WorkspaceAudienceStudent:
		return WorkspaceAudienceStudent
	case WorkspaceAudienceTeacher:
		return WorkspaceAudienceTeacher
	default:
		return WorkspaceAudienceBoth
	}
}

// WorkspaceModelEndpoint 单个「模型 × 功能」的上游接口配置。
// 每个厂家同一模型在文生文/文生图等不同功能下的接口路径、请求格式并不相同，
// 因此按「模型 + 功能」维度各存一份配置，缺省时沿用系统内置的标准链路。
type WorkspaceModelEndpoint struct {
	Kind string `json:"kind"`
	// Format 请求格式：openai（标准 OpenAI 对话/图片格式）| json（通用 JSON 原样转发）。
	Format string `json:"format,omitempty"`
	// Path 上游接口路径，如 /chat/completions、/images/generations；留空沿用内置路径。
	Path string `json:"path,omitempty"`
	// QPath 异步任务的结果查询接口；留空沿用内置查询地址。
	QPath string `json:"qpath,omitempty"`
	// Method 请求方法：POST | GET，缺省 POST。
	Method string `json:"method,omitempty"`
	// Extra 附加参数 JSON（对象），会深合并覆盖到该「模型 × 功能」的生成请求体上。
	Extra string `json:"extra,omitempty"`
}

// 请求格式取值。
const (
	WorkspaceEndpointFormatOpenAI = "openai"
	WorkspaceEndpointFormatJSON   = "json"
)

// 请求方法取值。
const (
	WorkspaceEndpointMethodPost = "POST"
	WorkspaceEndpointMethodGet  = "GET"
)

// 附加参数 JSON 的大小与路径长度上限。
const (
	workspaceMaxExtraBytes = 8192
	workspaceMaxPathRunes  = 256
	workspaceMaxQPathRunes = 256
)

// 异步扩展配置 JSON 的大小上限（含场景/模型微调表，允许比普通附加参数更大）。
const workspaceMaxAsyncConfigBytes = 32768

// 异步轮询间隔的上下限（秒）：禁止毫秒级高频轮询，避免触发厂商限流。
const (
	workspaceMinPollInterval = 3
	workspaceMaxPollInterval = 3600
)

// WorkspaceAsyncConfig 异步模型的通用扩展配置：适配不同厂商异步接口规范。
// 以 JSON 字符串存储在模型能力声明上，提交/查询链路按此构建统一异步任务调用。
type WorkspaceAsyncConfig struct {
	// Vendor 厂商标识（volcengine | zhipu | minimax | aliyun | tencent | generic），
	// 内置参数微调与状态映射按此匹配；未知厂商走通用映射规则。
	Vendor string `json:"vendor,omitempty"`
	// SubmitPath 提交任务的上游接口路径（相对渠道 base_url，或绝对地址）。
	SubmitPath string `json:"submit_path,omitempty"`
	// QueryPath 查询任务状态的接口路径，支持 {task_id} 占位。
	QueryPath string `json:"query_path,omitempty"`
	// QueryMethod 查询方法：GET | POST，缺省 GET。
	QueryMethod string `json:"query_method,omitempty"`
	// TaskIDPath 从提交响应提取任务 ID 的点分路径（如 id / task_id / data.id / output.task_id）。
	TaskIDPath string `json:"task_id_path,omitempty"`
	// StatusPath 从查询响应提取状态的点分路径（如 status / data.status / task_status）。
	StatusPath string `json:"status_path,omitempty"`
	// StatusMap 厂商状态 → 通用状态（queued | running | succeeded | failed | canceled）的映射。
	StatusMap map[string]string `json:"status_map,omitempty"`
	// ResultPath 从查询响应提取结果地址的点分路径（视频/图片/音频 URL）。
	ResultPath string `json:"result_path,omitempty"`
	// ErrorPath 从查询响应提取失败原因的点分路径。
	ErrorPath string `json:"error_path,omitempty"`
	// Headers 提交与查询需要的附加请求头（如阿里云 X-DashScope-Async: enable）。
	Headers map[string]string `json:"headers,omitempty"`
	// PollInterval 轮询基础间隔（秒；最小 3，缺省 10）。
	PollInterval int `json:"poll_interval,omitempty"`
	// PollMaxInterval 轮询最大间隔（秒；指数退避上限，缺省 60，且不小于 PollInterval）。
	PollMaxInterval int `json:"poll_max_interval,omitempty"`
	// SceneParams 按视频场景的请求体覆盖：t2v（文字生成视频）| first_last_frame（首尾帧）| subject（主体参考）。
	SceneParams map[string]map[string]any `json:"scene_params,omitempty"`
	// ModelParams 按常用模型名的请求体微调（模型名 → 覆盖参数）；未命中的模型走通用参数映射。
	ModelParams map[string]map[string]any `json:"model_params,omitempty"`
}

// WorkspaceModelCapability 单个模型声明的生成能力（在模型管理里按模型设置）。
type WorkspaceModelCapability struct {
	Model    string   `json:"model"`
	Kinds    []string `json:"kinds"`
	Audience string   `json:"audience,omitempty"` // student | teacher | both，缺省 both
	Plugin   string   `json:"plugin,omitempty"`   // 仅音乐生成使用：任务插件标识
	Action   string   `json:"action,omitempty"`
	// Voices 仅声音合成（tts）使用：该模型可选的音色标识列表（如 alloy / zh-CN-XiaoxiaoNeural）。
	// 学生端据此渲染音色下拉框，逐模型独立配置。
	Voices []string `json:"voices,omitempty"`
	// Endpoints 按「模型 × 功能」维度独立配置的上游接口参数（请求格式/路径/查询地址/方法/附加参数）。
	Endpoints []WorkspaceModelEndpoint `json:"endpoints,omitempty"`
	// Async 标识该模型为异步生成模型（视频/音乐/图片通用）：提交后返回任务 ID，由服务端轮询取结果。
	Async bool `json:"async,omitempty"`
	// AsyncConfig 异步扩展配置 JSON（WorkspaceAsyncConfig 序列化），仅 Async 为 true 时生效。
	// 留空时使用内置的通用参数映射与默认轮询策略。
	AsyncConfig string `json:"async_config,omitempty"`
}

// workspaceMaxVoices 单个模型可配置的音色数量上限。
const workspaceMaxVoices = 50

// workspaceMaxVoiceRunes 单个音色标识的长度上限（字符）。
const workspaceMaxVoiceRunes = 64

// normalizeWorkspaceVoices 归一化音色列表：去空白、去重、限制单条长度与总条数。
func normalizeWorkspaceVoices(voices []string) []string {
	if len(voices) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(voices))
	result := make([]string, 0, len(voices))
	for _, voice := range voices {
		voice = strings.TrimSpace(voice)
		if voice == "" {
			continue
		}
		if runes := []rune(voice); len(runes) > workspaceMaxVoiceRunes {
			voice = string(runes[:workspaceMaxVoiceRunes])
		}
		if seen[voice] {
			continue
		}
		seen[voice] = true
		result = append(result, voice)
		if len(result) >= workspaceMaxVoices {
			break
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// WorkspaceCapability 学生端/教师端可选的一项生成能力。
// 由模型能力声明按模态聚合派生：Enabled 表示已有模型声明该模态，Models 为可选模型列表。
type WorkspaceCapability struct {
	Id      string   `json:"id"`
	Name    string   `json:"name"`
	Desc    string   `json:"desc"`
	Kind    string   `json:"kind"` // text | image | edit | tts | video | music
	Model   string   `json:"model"`
	Path    string   `json:"path"`
	QPath   string   `json:"qpath"`
	Format  string   `json:"fmt"`    // openai | json
	Method  string   `json:"method"` // POST | GET
	Enabled bool     `json:"enabled"`
	Cost    int      `json:"cost"`   // 每次消耗点数（由定价规则派生）
	Points  int      `json:"points"` // 每次消耗点数（面向学生展示）
	Plugin  string   `json:"plugin,omitempty"`
	Action  string   `json:"action,omitempty"`
	Models  []string `json:"models,omitempty"`
	// Voices 声音合成（tts）可选音色：全部已开放模型的音色并集（去重，保持声明顺序）。
	Voices []string `json:"voices,omitempty"`
	// ModelVoices 声音合成（tts）按模型分组的可选音色，供前端「所选模型 → 音色下拉」联动。
	ModelVoices map[string][]string `json:"model_voices,omitempty"`
	// ModelQPaths 按模型分组的结果查询接口，供前端轮询异步任务时按所选模型取地址。
	ModelQPaths map[string]string `json:"model_qpaths,omitempty"`
	// ModelAsync 按模型分组的异步标识：true 表示该模型为异步生成模型，
	// 学生端据此展示「任务生成中」提示并禁止重复提交。
	ModelAsync map[string]bool `json:"model_async,omitempty"`
}

// GetWorkspacePlatformName 读取中台展示名称，未配置时回落默认名称。
func GetWorkspacePlatformName() string {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspacePlatformNameKey]
	}
	common.OptionMapRWMutex.RUnlock()
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultWorkspacePlatformName
	}
	return raw
}

// NormalizeWorkspacePlatformName 校验并归一化平台名称。
func NormalizeWorkspacePlatformName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", common.NewMessage("platform name cannot be empty")
	}
	if len([]rune(name)) > 32 {
		return "", common.NewMessage("platform name too long (max 32 chars)")
	}
	return name, nil
}

// GetWorkspaceModelCapabilities 读取模型能力声明，未配置时返回空列表。
func GetWorkspaceModelCapabilities() []WorkspaceModelCapability {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspaceModelCapabilitiesKey]
	}
	common.OptionMapRWMutex.RUnlock()

	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []WorkspaceModelCapability{}
	}
	var items []WorkspaceModelCapability
	if err := common.UnmarshalJsonStr(raw, &items); err != nil {
		return []WorkspaceModelCapability{}
	}
	if items == nil {
		return []WorkspaceModelCapability{}
	}
	return items
}

// NormalizeWorkspaceModelCapability 校验并归一化单个模型的能力声明。
func NormalizeWorkspaceModelCapability(item WorkspaceModelCapability) (WorkspaceModelCapability, error) {
	item.Model = strings.TrimSpace(item.Model)
	if item.Model == "" {
		return item, common.NewMessage("model name cannot be empty")
	}
	seen := make(map[string]bool, len(item.Kinds))
	kinds := make([]string, 0, len(item.Kinds))
	for _, kind := range item.Kinds {
		kind = strings.TrimSpace(kind)
		if !isWorkspaceKind(kind) {
			return item, common.NewMessage("unsupported capability kind: " + kind)
		}
		if seen[kind] {
			continue
		}
		seen[kind] = true
		kinds = append(kinds, kind)
	}
	item.Kinds = kinds
	item.Audience = normalizeWorkspaceAudience(item.Audience)
	item.Plugin = strings.TrimSpace(item.Plugin)
	item.Action = strings.TrimSpace(item.Action)
	// 音色仅对声音合成有意义；未勾选 tts 时直接丢弃，避免残留脏数据。
	if workspaceContainsKind(item.Kinds, "tts") {
		item.Voices = normalizeWorkspaceVoices(item.Voices)
	} else {
		item.Voices = nil
	}
	endpoints, err := normalizeWorkspaceEndpoints(item.Endpoints, item.Kinds)
	if err != nil {
		return item, err
	}
	item.Endpoints = endpoints
	// 异步标识仅对生成类模态有意义；未勾选生成模态时清理，避免残留脏数据。
	if !workspaceContainsAnyKind(item.Kinds, "video", "music", "image", "edit") {
		item.Async = false
	}
	if !item.Async {
		item.AsyncConfig = ""
		return item, nil
	}
	asyncConfig, err := normalizeWorkspaceAsyncConfig(item.AsyncConfig)
	if err != nil {
		return item, err
	}
	item.AsyncConfig = asyncConfig
	return item, nil
}

// normalizeWorkspaceAsyncConfig 校验并归一化异步扩展配置：
// 留空返回空串（沿用内置通用规则）；否则必须是合法 JSON 对象，
// 轮询间隔收敛到 [3, 3600] 秒（禁止毫秒级轮询），最大间隔不小于基础间隔。
func normalizeWorkspaceAsyncConfig(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > workspaceMaxAsyncConfigBytes {
		return "", common.NewMessage("async config too large (max 32KB)")
	}
	var cfg map[string]any
	if err := common.UnmarshalJsonStr(raw, &cfg); err != nil {
		return "", common.NewMessage("async config is not a valid JSON object")
	}
	// 轮询间隔：只接受秒级整数，钳制到 [3, 3600]，杜绝毫秒级高频轮询。
	for _, key := range []string{"poll_interval", "poll_max_interval"} {
		if v, ok := cfg[key]; ok {
			n, ok := v.(float64)
			if !ok || n != float64(int(n)) {
				return "", common.NewMessage("poll interval must be an integer number of seconds")
			}
			interval := int(n)
			if interval < workspaceMinPollInterval {
				interval = workspaceMinPollInterval
			}
			if interval > workspaceMaxPollInterval {
				interval = workspaceMaxPollInterval
			}
			cfg[key] = interval
		}
	}
	if base, ok := cfg["poll_interval"].(float64); ok {
		if max, ok := cfg["poll_max_interval"].(float64); ok && int(max) < int(base) {
			cfg["poll_max_interval"] = int(base)
		}
	}
	encoded, err := common.Marshal(cfg)
	if err != nil {
		return "", common.NewMessage("async config serialization failed")
	}
	return string(encoded), nil
}

// workspaceContainsAnyKind 判断能力声明是否包含任一指定模态。
func workspaceContainsAnyKind(kinds []string, targets ...string) bool {
	for _, kind := range kinds {
		for _, target := range targets {
			if kind == target {
				return true
			}
		}
	}
	return false
}

// ParseWorkspaceAsyncConfig 解析模型的异步扩展配置；未配置或解析失败时返回 nil（沿用内置通用规则）。
func ParseWorkspaceAsyncConfig(raw string) *WorkspaceAsyncConfig {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var cfg WorkspaceAsyncConfig
	if err := common.UnmarshalJsonStr(raw, &cfg); err != nil {
		return nil
	}
	return &cfg
}

// WorkspaceModelIsAsync 判断指定模型在指定模态下是否被标记为异步生成模型。
func WorkspaceModelIsAsync(modelName, kind string) bool {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return false
	}
	for _, mc := range GetWorkspaceModelCapabilities() {
		if mc.Model != modelName || !workspaceContainsKind(mc.Kinds, kind) {
			continue
		}
		return mc.Async
	}
	return false
}

// WorkspaceAsyncConfigForModel 按模型名查找异步配置（不区分模态），供轮询链路在
// 只知道任务模型名时解析配置。多模态命中时优先 video，其次 music、image。
// 返回配置、模态与是否命中；未标记异步或配置缺失时 cfg 为 nil（沿用内置通用规则）。
func WorkspaceAsyncConfigForModel(modelName string) (*WorkspaceAsyncConfig, string, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil, "", false
	}
	for _, want := range []string{"video", "music", "image", "edit"} {
		for _, mc := range GetWorkspaceModelCapabilities() {
			if mc.Model != modelName || !mc.Async || !workspaceContainsKind(mc.Kinds, want) {
				continue
			}
			return ParseWorkspaceAsyncConfig(mc.AsyncConfig), want, true
		}
	}
	return nil, "", false
}

// normalizeWorkspaceEndpoints 归一化「模型 × 功能」接口配置：
// 仅保留已勾选模态的配置、去重、裁剪长度并校验附加参数为合法 JSON 对象。
func normalizeWorkspaceEndpoints(endpoints []WorkspaceModelEndpoint, kinds []string) ([]WorkspaceModelEndpoint, error) {
	if len(endpoints) == 0 {
		return nil, nil
	}
	enabled := make(map[string]bool, len(kinds))
	for _, kind := range kinds {
		enabled[kind] = true
	}
	seen := make(map[string]bool, len(endpoints))
	result := make([]WorkspaceModelEndpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		kind := strings.TrimSpace(endpoint.Kind)
		// 未勾选该模态时丢弃对应接口配置，避免残留脏数据。
		if kind == "" || !enabled[kind] || seen[kind] {
			continue
		}
		seen[kind] = true
		normalized, err := normalizeWorkspaceEndpoint(kind, endpoint)
		if err != nil {
			return nil, err
		}
		result = append(result, normalized)
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

// normalizeWorkspaceEndpoint 归一化单个接口配置。
func normalizeWorkspaceEndpoint(kind string, endpoint WorkspaceModelEndpoint) (WorkspaceModelEndpoint, error) {
	normalized := WorkspaceModelEndpoint{Kind: kind}
	switch strings.ToLower(strings.TrimSpace(endpoint.Format)) {
	case WorkspaceEndpointFormatJSON, "json_format", "generic", "通用":
		normalized.Format = WorkspaceEndpointFormatJSON
	default:
		normalized.Format = WorkspaceEndpointFormatOpenAI
	}
	normalized.Path = trimWorkspaceRunes(endpoint.Path, workspaceMaxPathRunes)
	normalized.QPath = trimWorkspaceRunes(endpoint.QPath, workspaceMaxQPathRunes)
	if strings.EqualFold(strings.TrimSpace(endpoint.Method), WorkspaceEndpointMethodGet) {
		normalized.Method = WorkspaceEndpointMethodGet
	} else {
		normalized.Method = WorkspaceEndpointMethodPost
	}
	extra := strings.TrimSpace(endpoint.Extra)
	if extra != "" {
		if len(extra) > workspaceMaxExtraBytes {
			return normalized, common.NewMessage("附加参数 JSON 过大（上限 8KB）")
		}
		// 只接受 JSON 对象，保证能安全地深合并进请求体。
		var probe map[string]any
		if err := common.UnmarshalJsonStr(extra, &probe); err != nil {
			return normalized, common.NewMessage("附加参数不是合法的 JSON 对象")
		}
		encoded, err := common.Marshal(probe)
		if err != nil {
			return normalized, common.NewMessage("附加参数序列化失败")
		}
		normalized.Extra = string(encoded)
	}
	return normalized, nil
}

// trimWorkspaceRunes 去空白并按字符数截断。
func trimWorkspaceRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if runes := []rune(value); len(runes) > limit {
		value = string(runes[:limit])
	}
	return value
}

// WorkspaceModelEndpointFor 返回指定模型在指定功能下的接口配置。
// 未配置时返回零值与 false，调用方沿用内置链路。
func WorkspaceModelEndpointFor(modelName, kind string) (WorkspaceModelEndpoint, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || kind == "" {
		return WorkspaceModelEndpoint{}, false
	}
	for _, mc := range GetWorkspaceModelCapabilities() {
		if mc.Model != modelName {
			continue
		}
		for _, endpoint := range mc.Endpoints {
			if endpoint.Kind == kind {
				return endpoint, true
			}
		}
	}
	return WorkspaceModelEndpoint{}, false
}

// SetWorkspaceModelCapability 写入/更新（或清空）单个模型的能力声明，返回可持久化的 JSON。
// 持久化由控制器调用 model.UpdateOption 完成（避免 setting → model 循环导入）。
func SetWorkspaceModelCapability(item WorkspaceModelCapability) (string, error) {
	normalized, err := NormalizeWorkspaceModelCapability(item)
	if err != nil {
		return "", err
	}
	existing := GetWorkspaceModelCapabilities()
	next := make([]WorkspaceModelCapability, 0, len(existing)+1)
	for _, one := range existing {
		if one.Model == normalized.Model {
			continue
		}
		next = append(next, one)
	}
	// 未勾选任何模态表示删除该模型的声明。
	if len(normalized.Kinds) > 0 {
		next = append(next, normalized)
	}
	encoded, err := common.Marshal(next)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// RemoveWorkspaceModelCapabilities 从模型能力声明里剔除指定模型（模型被删除时调用），
// 返回可持久化的 JSON。传入的模型名一个都没命中时返回原声明。
func RemoveWorkspaceModelCapabilities(models []string) (string, error) {
	existing := GetWorkspaceModelCapabilities()
	removed := make(map[string]struct{}, len(models))
	for _, name := range models {
		if name = strings.TrimSpace(name); name != "" {
			removed[name] = struct{}{}
		}
	}
	if len(existing) == 0 || len(removed) == 0 {
		encoded, err := common.Marshal(existing)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	}
	next := make([]WorkspaceModelCapability, 0, len(existing))
	for _, one := range existing {
		if _, drop := removed[one.Model]; drop {
			continue
		}
		next = append(next, one)
	}
	encoded, err := common.Marshal(next)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// WorkspaceModelCapabilities2JsonString 序列化默认模型能力声明（空列表）。
func WorkspaceModelCapabilities2JsonString() string {
	return "[]"
}

// GetWorkspaceCapabilities 按模态聚合全部模型能力声明（不区分角色），
// 供管理端展示与生成入口校验使用。
func GetWorkspaceCapabilities() []WorkspaceCapability {
	return buildWorkspaceCapabilities(nil)
}

// GetWorkspaceCapabilitiesForRole 按模态聚合「对当前角色开放」的模型能力声明，
// 学生端与教师端的模型下拉只列出该角色可用的模型。
func GetWorkspaceCapabilitiesForRole(isTeacher bool) []WorkspaceCapability {
	return buildWorkspaceCapabilities(&isTeacher)
}

// WorkspaceModelVoices 返回指定模型在指定模态下声明的音色列表（当前仅 tts 有意义）。
// 未声明或模型不匹配时返回 nil。
func WorkspaceModelVoices(modelName, kind string) []string {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil
	}
	for _, mc := range GetWorkspaceModelCapabilities() {
		if mc.Model != modelName || !workspaceContainsKind(mc.Kinds, kind) {
			continue
		}
		return mc.Voices
	}
	return nil
}

// WorkspaceModelAllowedForRole 校验请求使用的模型是否对当前角色开放。
// 仅当该模型确实为某模态做过声明、但未对当前角色开放时才拒绝；
// 未声明的模型（例如音乐生成的默认模型）不在此处拦截。
func WorkspaceModelAllowedForRole(modelName, kind string, isTeacher bool) bool {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return true
	}
	for _, mc := range GetWorkspaceModelCapabilities() {
		if mc.Model != modelName || !workspaceContainsKind(mc.Kinds, kind) {
			continue
		}
		return workspaceAudienceAllows(mc.Audience, isTeacher)
	}
	return true
}

// buildWorkspaceCapabilities 按模态聚合模型能力声明；isTeacher 为 nil 时不按角色过滤。
func buildWorkspaceCapabilities(isTeacher *bool) []WorkspaceCapability {
	modelCaps := GetWorkspaceModelCapabilities()

	result := make([]WorkspaceCapability, 0, len(workspaceKindMetas()))
	for _, meta := range workspaceKindMetas() {
		// 隐藏能力（如 HTML 编程）只在管理端全量列表中出现，学生端/教师端不渲染能力卡片。
		if meta.Hidden && isTeacher != nil {
			continue
		}
		models := make([]string, 0, len(modelCaps))
		plugin, action := "", ""
		var voices []string
		modelVoices := map[string][]string{}
		voiceSeen := map[string]bool{}
		modelQPaths := map[string]string{}
		modelAsync := map[string]bool{}
		for _, mc := range modelCaps {
			if !workspaceContainsKind(mc.Kinds, meta.Kind) {
				continue
			}
			if isTeacher != nil && !workspaceAudienceAllows(mc.Audience, *isTeacher) {
				continue
			}
			models = append(models, mc.Model)
			if mc.Async {
				modelAsync[mc.Model] = true
			}
			if meta.Kind == "music" && plugin == "" {
				plugin, action = mc.Plugin, mc.Action
			}
			if meta.Kind == "tts" && len(mc.Voices) > 0 {
				modelVoices[mc.Model] = mc.Voices
				for _, voice := range mc.Voices {
					if voiceSeen[voice] {
						continue
					}
					voiceSeen[voice] = true
					voices = append(voices, voice)
				}
			}
			// 该模型为该功能单独配置了结果查询接口时，供前端按模型取用。
			for _, endpoint := range mc.Endpoints {
				if endpoint.Kind == meta.Kind && endpoint.QPath != "" {
					modelQPaths[mc.Model] = endpoint.QPath
				}
			}
		}
		// HTML 编程 / 演示实验室未单独声明模型时，复用文生文的可用模型，避免管理员漏配导致入口不可用。
		if (meta.Kind == "html" || meta.Kind == "slide") && len(models) == 0 {
			for _, mc := range modelCaps {
				if !workspaceContainsKind(mc.Kinds, "text") {
					continue
				}
				if isTeacher != nil && !workspaceAudienceAllows(mc.Audience, *isTeacher) {
					continue
				}
				models = append(models, mc.Model)
			}
		}
		points := GetWorkspacePointsForKind(meta.Kind)
		capability := WorkspaceCapability{
			Id:      meta.Kind,
			Name:    meta.Name,
			Desc:    meta.Desc,
			Kind:    meta.Kind,
			Model:   "",
			Path:    "/api/workspace/generate/" + meta.Kind,
			QPath:   meta.QPath,
			Format:  "openai",
			Method:  "POST",
			Enabled: len(models) > 0,
			Cost:    points,
			Points:  points,
			Models:  models,
		}
		if meta.Kind == "tts" {
			capability.Voices = voices
			if len(modelVoices) > 0 {
				capability.ModelVoices = modelVoices
			}
		}
		if meta.Kind == "music" {
			if plugin == "" {
				plugin = DefaultWorkspaceMusicPlugin
			}
			capability.Plugin = plugin
			capability.Action = action
		}
		if len(modelQPaths) > 0 {
			capability.ModelQPaths = modelQPaths
		}
		if len(modelAsync) > 0 {
			capability.ModelAsync = modelAsync
		}
		result = append(result, capability)
	}
	return result
}

func workspaceContainsKind(kinds []string, kind string) bool {
	for _, one := range kinds {
		if one == kind {
			return true
		}
	}
	return false
}

// GetWorkspaceCapability 按能力 id（即模态）查找能力配置。
func GetWorkspaceCapability(id string) (WorkspaceCapability, bool) {
	for _, cap := range GetWorkspaceCapabilities() {
		if cap.Id == id {
			return cap, true
		}
	}
	return WorkspaceCapability{}, false
}

// GetEnabledWorkspaceCapability 仅返回已启用能力，供生成入口校验。
func GetEnabledWorkspaceCapability(id string) (WorkspaceCapability, bool) {
	cap, ok := GetWorkspaceCapability(id)
	if !ok || !cap.Enabled {
		return WorkspaceCapability{}, false
	}
	return cap, true
}
