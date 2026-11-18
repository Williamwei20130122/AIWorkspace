package middleware

import (
	"bytes"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// workspaceStatusWriter 记录最终写出的 HTTP 状态码，并截留少量响应体用于解析实际用量。
type workspaceStatusWriter struct {
	gin.ResponseWriter
	status  int
	capture []byte
}

// workspaceCaptureLimit 截留响应体的上限，够解析 usage 即可，避免大响应占用内存。
const workspaceCaptureLimit = 64 * 1024

func (w *workspaceStatusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *workspaceStatusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if len(w.capture) < workspaceCaptureLimit {
		remain := workspaceCaptureLimit - len(w.capture)
		if len(b) <= remain {
			w.capture = append(w.capture, b...)
		} else {
			w.capture = append(w.capture, b[:remain]...)
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *workspaceStatusWriter) Status() int {
	if w.status != 0 {
		return w.status
	}
	return w.ResponseWriter.Status()
}

// workspaceTotalTokens 从响应体中解析 usage.total_tokens：
// 既兼容一次性 JSON 响应，也兼容 SSE 分帧（取出现的最大值，即最终统计值）。
func workspaceTotalTokens(body []byte) int {
	maxTokens := 0
	searchFrom := 0
	needle := []byte(`"total_tokens"`)
	for {
		idx := bytes.Index(body[searchFrom:], needle)
		if idx < 0 {
			break
		}
		cursor := searchFrom + idx + len(needle)
		searchFrom = cursor
		// 跳过冒号与空白后读取数字
		for cursor < len(body) && (body[cursor] == ':' || body[cursor] == ' ' || body[cursor] == '\t') {
			cursor++
		}
		start := cursor
		for cursor < len(body) && body[cursor] >= '0' && body[cursor] <= '9' {
			cursor++
		}
		if cursor > start {
			if value, err := strconv.Atoi(string(body[start:cursor])); err == nil && value > maxTokens {
				maxTokens = value
			}
		}
	}
	return maxTokens
}

// WorkspaceMetering 中台按次计费：生成前校验点数，成功生成后扣点数并记录对账明细。
// 失败（非 2xx）不扣费，符合「每成功生成一次才扣」的规则。
func WorkspaceMetering() gin.HandlerFunc {
	return func(c *gin.Context) {
		capId := c.GetString(WorkspaceCapabilityIdKey)
		kind := c.GetString(WorkspaceCapabilityKindKey)
		userId := c.GetInt("id")
		if capId == "" || userId <= 0 {
			c.Next()
			return
		}

		// 点数按能力统一（默认 5 点），折算金额/计价单位/上游单价按模型独立。
		resolvedModel := strings.TrimSpace(c.GetString("resolved_task_model"))
		charge := setting.ResolveWorkspacePricing(kind, resolvedModel)
		points := charge.Points
		if points <= 0 {
			c.Next()
			return
		}

		// ---- 生成前校验：总点数与能力额度 ----
		// 教师优先消耗「教学点数钱包」（管理员发放），钱包余额充足时不占用其 API 额度。
		isTeacher := c.GetInt("role") >= common.RoleAdminUser
		useWallet := false
		if isTeacher {
			if wallet, wErr := model.GetWorkspaceTeacherWallet(userId); wErr == nil && wallet != nil && wallet.Balance >= points {
				useWallet = true
			}
		}
		if !useWallet {
			quota, err := model.GetUserQuota(userId, false)
			if err != nil {
				common.ApiErrorMsg(c, "读取账户点数失败")
				c.Abort()
				return
			}
			if quota < points {
				common.ApiErrorMsg(c, "可用点数不足，请等待额度重置")
				c.Abort()
				return
			}
		}
		if userQuota, qErr := model.GetWorkspaceUserQuota(userId, capId); qErr == nil && userQuota != nil && userQuota.Quota > 0 {
			if userQuota.Used >= userQuota.Quota {
				common.ApiErrorMsg(c, "该能力的可用次数已用完")
				c.Abort()
				return
			}
		}

		// ---- 执行生成 ----
		sw := &workspaceStatusWriter{ResponseWriter: c.Writer}
		c.Writer = sw
		startedAt := time.Now()
		c.Next()
		elapsedMs := int(time.Since(startedAt).Milliseconds())

		status := sw.Status()
		if status < 200 || status >= 300 {
			return
		}

		// ---- 成功：扣点数 + 记明细 ----
		// 教师钱包不足时回落到账户 API 额度扣减。
		if useWallet {
			if err := model.DeductWorkspaceTeacherWallet(userId, points); err != nil {
				useWallet = false
			}
		}
		if !useWallet {
			if err := model.DecreaseUserQuota(userId, points, false); err != nil {
				common.SysError(common.LogText("workspace charge points failed: userId=%d capability=%s points=%d err=%s", userId, capId, points, err.Error()))
				return
			}
		}
		_ = model.IncWorkspaceUserQuotaUsed(userId, capId)

		// 上游成本按实际用量折算：文生文取响应里的总 token 数（计价单位为千 token），
		// 其余能力暂无法从响应体可靠取用量，回落到定价里配置的每次计量数量。
		units := charge.BaseUnits
		if kind == "text" || kind == "html" || kind == "slide" {
			if tokens := workspaceTotalTokens(sw.capture); tokens > 0 {
				units = float64(tokens) / 1000
			}
		}
		usage := &model.WorkspaceUsage{
			UserId:       userId,
			ClassId:      model.GetWorkspaceClassIdByUserId(userId),
			TeacherId:    0,
			CapabilityId: capId,
			Kind:         kind,
			Model:        resolvedModel,
			Units:        units,
			Points:       points,
			AmountYuan:   charge.CostYuan(units),
			CostYuan:     charge.CostYuan(units),
			Status:       "success",
			RequestId:    c.GetString(common.RequestIdKey),
			DurationMs:   elapsedMs,
		}
		usage.Prompt = workspaceExtractPrompt(c)
		// 声音合成：记录「音色 + 待朗读文本」，便于历史详情与对账回溯实际配置。
		if kind == "tts" {
			usage.Prompt = workspaceTSSCaption(c, usage.Prompt)
		}
		usage.ResultPreview = workspaceResultPreview(sw.capture)
		if err := usage.Insert(); err != nil {
			common.SysError(common.LogText("workspace usage insert failed: userId=%d capability=%s err=%s", userId, capId, err.Error()))
		}
	}
}

// workspaceExtractPrompt 从请求体中提取学生本次提交的提示词（截断保存）。
func workspaceExtractPrompt(c *gin.Context) string {
	if strings.Contains(c.GetHeader("Content-Type"), "multipart/form-data") {
		return trimWorkspaceRunes(strings.TrimSpace(c.PostForm("prompt")), 480)
	}
	seeker, err := common.GetRequestBody(c)
	if err != nil {
		return ""
	}
	reader, ok := seeker.(io.Reader)
	if !ok {
		return ""
	}
	body, err := io.ReadAll(reader)
	if err != nil || len(body) == 0 {
		return ""
	}
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err != nil {
		return trimWorkspaceRunes(strings.TrimSpace(string(body)), 480)
	}
	for _, key := range []string{"prompt", "input", "gpt_description_prompt"} {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return trimWorkspaceRunes(strings.TrimSpace(value), 480)
		}
	}
	if messages, ok := payload["messages"].([]any); ok {
		for i := len(messages) - 1; i >= 0; i-- {
			message, ok := messages[i].(map[string]any)
			if !ok {
				continue
			}
			if role, _ := message["role"].(string); role != "" && role != "user" {
				continue
			}
			if content, ok := message["content"].(string); ok && strings.TrimSpace(content) != "" {
				return trimWorkspaceRunes(strings.TrimSpace(content), 480)
			}
		}
	}
	return ""
}

// workspaceTSSCaption 拼装声音合成的可读摘要：实际音色 + 待朗读文本。
func workspaceTSSCaption(c *gin.Context, text string) string {
	voice := strings.TrimSpace(c.GetString(WorkspaceResolvedVoiceKey))
	if voice == "" {
		voice = strings.TrimSpace(c.PostForm("voice"))
	}
	if voice == "" {
		return text
	}
	if text == "" {
		return "音色：" + voice
	}
	return "音色：" + voice + "｜文本：" + text
}

// workspaceResultPreview 从响应体中提取 AI 生成内容的预览（供教师看板展示）。
// 音频 / 视频等二进制响应不写入预览，避免把乱码存进数据库。
func workspaceResultPreview(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return ""
	}
	// 非 JSON 响应（裸文本 / 二进制 / 音频）：仅当其为合法 UTF-8 文本时才保留。
	if trimmed[0] != '{' && trimmed[0] != '[' {
		if !utf8.Valid(trimmed) {
			return ""
		}
		return trimWorkspaceRunes(strings.TrimSpace(string(trimmed)), 800)
	}
	var payload map[string]any
	if err := common.Unmarshal(trimmed, &payload); err == nil {
		if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]any); ok {
				if message, ok := choice["message"].(map[string]any); ok {
					if content, ok := message["content"].(string); ok {
						return trimWorkspaceRunes(strings.TrimSpace(content), 800)
					}
				}
			}
		}
		if url, ok := payload["url"].(string); ok && url != "" {
			return trimWorkspaceRunes(url, 800)
		}
		if data, ok := payload["data"].([]any); ok && len(data) > 0 {
			if first, ok := data[0].(map[string]any); ok {
				if url, ok := first["url"].(string); ok && url != "" {
					return trimWorkspaceRunes(url, 800)
				}
			}
		}
	}
	return trimWorkspaceRunes(strings.TrimSpace(string(trimmed)), 800)
}

// trimWorkspaceRunes 按字符（而非字节）截断，避免把多字节中文截成乱码。
func trimWorkspaceRunes(value string, limit int) string {
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
