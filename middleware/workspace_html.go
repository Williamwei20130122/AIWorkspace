package middleware

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	// WorkspaceHTMLProjectIdKey 保存 HTML 实验室本次生成写入的项目 id。
	WorkspaceHTMLProjectIdKey = "workspace_html_project_id"
	// WorkspaceHTMLRequirementKey 保存学生本次提交的原始需求（用于对话落库）。
	WorkspaceHTMLRequirementKey = "workspace_html_requirement"
	// WorkspaceHTMLCreatedKey 标记项目是否为本次请求新建（失败时需回滚）。
	WorkspaceHTMLCreatedKey = "workspace_html_created"
	// WorkspaceHTMLModelKey 保存本次生成使用的模型名（用于登记云端素材）。
	WorkspaceHTMLModelKey = "workspace_html_model"

	// workspaceHTMLCodeLimit 注入提示词的源码上限，避免超长源码挤占上下文。
	workspaceHTMLCodeLimit = 40000
	// workspaceHTMLHistoryLimit 携带的历史对话条数。
	workspaceHTMLHistoryLimit = 12
	// workspaceHTMLHistoryContentLimit 单条历史消息的字符上限。
	workspaceHTMLHistoryContentLimit = 3000
	// workspaceHTMLResponseLimit 响应缓冲上限，保证完整代码块可被解析。
	workspaceHTMLResponseLimit = 2 * 1024 * 1024
)

// workspaceHTMLSystemPrompt HTML 编程实验室的系统提示词：
// 在学生输入之上补全「必须输出完整可运行单文件 HTML」等工程约束。
const workspaceHTMLSystemPrompt = `你是「AI Workspace」HTML 编程实验室的前端编程助手，服务对象是中小学生。

你的任务：根据学生的自然语言需求，生成或修改一个可以直接在浏览器中打开的 HTML 页面。

硬性要求：
1. 只输出一个完整的、可直接运行的单文件 HTML；HTML、CSS、JavaScript 全部内联在同一个文件中，不引用任何本地文件。
2. 必须包含 <!DOCTYPE html>、<html>、<head>、<body> 完整结构，并在 <head> 中设置 <meta charset="UTF-8"> 与 viewport 移动端适配。
3. 页面要现代、美观、适合中小学生：干净的配色、合适的留白、圆角、清晰的层级，并适配手机与电脑两种尺寸。
4. 交互逻辑使用原生 JavaScript 实现，不依赖需要联网下载的第三方库；图表、动画等优先使用 Canvas 或纯 CSS 实现。
5. 文案使用简体中文（学生明确要求其他语言时除外），内容健康、适合青少年。
6. 修改已有代码时，请在「当前项目源码」的基础上增量修改，保留原有可用功能；除非学生明确要求重做或替换。
7. 回复格式：先用不超过 3 行中文说明本次改动要点，然后输出一个以 ` + "```html" + ` 开头的代码块；代码块内必须是完整的 HTML 文件全文，禁止使用省略号、注释或「其余不变」等方式省略代码。
8. 代码块之外不要再输出第二段代码，也不要输出无关的 Markdown 表格或长篇解释。
9. 如果学生的需求不明确，也请直接给出一个合理且可运行的完整页面，而不是反问。`

// WorkspaceHTMLPrepare 提示词工程：把学生的简短需求扩展为一份完整的编程任务。
//
//  1. 解析前端提交的 project_id / code；
//  2. 校验项目归属，必要时新建项目并把标题回填到响应头；
//  3. 组装「系统提示词 + 历史对话 + 本次需求」的 messages；
//  4. 强制 stream=false，便于一次性解析并提取完整 HTML。
func WorkspaceHTMLPrepare() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "登录状态无效，请重新登录")
			c.Abort()
			return
		}
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
			common.ApiErrorMsg(c, "HTML 编程请求必须为 JSON 格式")
			c.Abort()
			return
		}
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			common.ApiErrorMsg(c, "读取请求体失败")
			c.Abort()
			return
		}
		raw, err := storage.Bytes()
		if err != nil || len(raw) == 0 {
			common.ApiErrorMsg(c, "请求体为空")
			c.Abort()
			return
		}

		requirement := workspaceHTMLLastUserMessage(raw)
		if requirement == "" {
			common.ApiErrorMsg(c, "请输入本次的编程需求")
			c.Abort()
			return
		}

		projectId := int(gjson.GetBytes(raw, "workspace_html.project_id").Int())
		code := strings.TrimSpace(gjson.GetBytes(raw, "workspace_html.code").String())
		created := false
		if projectId > 0 {
			project, pErr := model.GetWorkspaceHtmlProject(projectId)
			if pErr != nil || project.UserId != userId {
				common.ApiErrorMsg(c, "项目不存在或无权访问")
				c.Abort()
				return
			}
			if code == "" {
				code = project.Code
			}
		} else {
			title := workspaceHTMLTitle(requirement)
			project, pErr := model.CreateWorkspaceHtmlProject(userId, title)
			if pErr != nil {
				common.ApiErrorMsg(c, "创建项目失败")
				c.Abort()
				return
			}
			projectId = project.Id
			created = true
		}

		// 历史对话来自数据库，前端无需重复上传。
		historyMessages, _ := model.ListWorkspaceHtmlMessages(projectId, 50)
		messages := make([]map[string]string, 0, len(historyMessages)+2)
		messages = append(messages, map[string]string{
			"role":    "system",
			"content": workspaceHTMLSystemMessages(code),
		})
		if len(historyMessages) > 0 {
			start := 0
			if len(historyMessages) > workspaceHTMLHistoryLimit {
				start = len(historyMessages) - workspaceHTMLHistoryLimit
			}
			for _, message := range historyMessages[start:] {
				content := strings.TrimSpace(message.Content)
				if content == "" {
					continue
				}
				messages = append(messages, map[string]string{
					"role":    message.Role,
					"content": trimWorkspaceRunes(content, workspaceHTMLHistoryContentLimit),
				})
			}
		}
		messages = append(messages, map[string]string{"role": "user", "content": requirement})

		encoded, mErr := common.Marshal(messages)
		if mErr != nil {
			common.ApiErrorMsg(c, "组装提示词失败")
			c.Abort()
			return
		}
		patched, sErr := sjson.SetRawBytes(raw, "messages", encoded)
		if sErr != nil {
			common.ApiErrorMsg(c, "组装提示词失败")
			c.Abort()
			return
		}
		patched, _ = sjson.SetBytes(patched, "stream", false)
		// 思考强度：请求未显式指定时注入后台配置的默认档位（空串表示不注入）。
		if strings.TrimSpace(gjson.GetBytes(patched, "reasoning_effort").String()) == "" {
			if effort := setting.GetWorkspaceHtmlThinkingEffort(); effort != "" {
				patched, _ = sjson.SetBytes(patched, "reasoning_effort", effort)
			}
		}
		patched, _ = sjson.DeleteBytes(patched, "workspace_html")
		if err := workspaceReplaceBody(c, patched); err != nil {
			common.ApiErrorMsg(c, "改写请求体失败")
			c.Abort()
			return
		}

		c.Set(WorkspaceHTMLProjectIdKey, projectId)
		c.Set(WorkspaceHTMLRequirementKey, requirement)
		c.Set(WorkspaceHTMLCreatedKey, created)
		c.Set(WorkspaceHTMLModelKey, strings.TrimSpace(gjson.GetBytes(raw, "model").String()))
		c.Header("X-Workspace-Html-Project-Id", strconv.Itoa(projectId))
		c.Next()
	}
}

// WorkspaceHTMLCapture 缓冲响应、提取完整 HTML，并把本次对话与最新源码落库。
// 失败（非 2xx）时回滚本次新建的空项目，避免历史列表出现垃圾数据。
func WorkspaceHTMLCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		projectId := c.GetInt(WorkspaceHTMLProjectIdKey)
		if projectId <= 0 {
			c.Next()
			return
		}
		userId := c.GetInt("id")
		requirement := c.GetString(WorkspaceHTMLRequirementKey)
		created := c.GetBool(WorkspaceHTMLCreatedKey)

		sw := &workspaceHTMLWriter{ResponseWriter: c.Writer}
		c.Writer = sw
		c.Next()

		if sw.Status() < 200 || sw.Status() >= 300 {
			if created {
				model.DeleteWorkspaceHtmlProject(projectId)
			}
			return
		}

		content := workspaceHTMLResponseContent(sw.body)
		code := workspaceExtractHTMLCode(content)
		if code != "" {
			title := ""
			if created {
				title = workspaceHTMLTitle(requirement)
			}
			if err := model.UpdateWorkspaceHtmlProject(projectId, title, code); err != nil {
				common.SysError(common.LogText("workspace html save code failed: projectId=%d err=%s", projectId, err.Error()))
			}
		} else {
			model.TouchWorkspaceHtmlProject(projectId)
		}
		if requirement != "" {
			if err := model.InsertWorkspaceHtmlMessage(projectId, userId, "user", requirement); err != nil {
				common.SysError(common.LogText("workspace html insert user message failed: %v", err))
			}
		}
		if content != "" {
			if err := model.InsertWorkspaceHtmlMessage(projectId, userId, "assistant", trimWorkspaceRunes(content, 20000)); err != nil {
				common.SysError(common.LogText("workspace html insert assistant message failed: %v", err))
			}
		}
		workspaceHTMLSaveArtifact(c, userId, projectId, requirement, content, code)
	}
}

// workspaceHTMLSaveArtifact 把本次生成结果登记为云端素材：
// 生成了完整 HTML 时保存 .html 文件，否则保存文字反馈（.txt），
// 便于教师在「云端素材 / 使用记录」中按班级查看学生作品。
func workspaceHTMLSaveArtifact(c *gin.Context, userId, projectId int, requirement, content, code string) {
	if userId <= 0 {
		return
	}
	modelName := c.GetString(WorkspaceHTMLModelKey)
	filename := fmt.Sprintf("html-%d-%d.html", projectId, common.GetTimestamp())
	mimeType := "text/html"
	body := code
	if body == "" {
		body = content
		filename = fmt.Sprintf("html-%d-%d.txt", projectId, common.GetTimestamp())
		mimeType = "text/plain"
	}
	if strings.TrimSpace(body) == "" {
		return
	}
	meta := service.WorkspaceArtifactMeta{
		UserId:  userId,
		ClassId: model.GetWorkspaceClassIdByUserId(userId),
		Kind:    "html",
		Model:   modelName,
		Prompt:  requirement,
	}
	if err := service.SaveWorkspaceArtifact(c.Request.Context(), meta, filename, mimeType, bytes.NewReader([]byte(body)), ""); err != nil {
		common.SysError(common.LogText("workspace html save artifact failed: projectId=%d err=%s", projectId, err.Error()))
	}
}

// workspaceHTMLWriter 透传响应的同时完整缓冲正文，便于解析代码块。
type workspaceHTMLWriter struct {
	gin.ResponseWriter
	status int
	body   []byte
}

func (w *workspaceHTMLWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *workspaceHTMLWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if len(w.body) < workspaceHTMLResponseLimit {
		remain := workspaceHTMLResponseLimit - len(w.body)
		if len(b) <= remain {
			w.body = append(w.body, b...)
		} else {
			w.body = append(w.body, b[:remain]...)
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *workspaceHTMLWriter) Status() int {
	if w.status != 0 {
		return w.status
	}
	return w.ResponseWriter.Status()
}

// workspaceHTMLLastUserMessage 取请求体中最后一条 user 消息作为学生本次需求。
func workspaceHTMLLastUserMessage(raw []byte) string {
	messages := gjson.GetBytes(raw, "messages")
	if !messages.IsArray() {
		return strings.TrimSpace(gjson.GetBytes(raw, "prompt").String())
	}
	result := ""
	for _, item := range messages.Array() {
		if role := item.Get("role").String(); role != "" && role != "user" {
			continue
		}
		if content := strings.TrimSpace(item.Get("content").String()); content != "" {
			result = content
		}
	}
	return result
}

// workspaceHTMLSystemMessages 拼装系统提示词，附带当前项目源码。
func workspaceHTMLSystemMessages(code string) string {
	if code == "" {
		return workspaceHTMLSystemPrompt + "\n\n当前项目源码：\n（空，项目尚未开始，请生成一个全新的完整页面）"
	}
	return workspaceHTMLSystemPrompt + "\n\n当前项目源码：\n" + trimWorkspaceRunes(code, workspaceHTMLCodeLimit)
}

// workspaceHTMLTitle 用需求首行生成项目标题。
func workspaceHTMLTitle(requirement string) string {
	line := strings.TrimSpace(requirement)
	if idx := strings.IndexAny(line, "\r\n"); idx >= 0 {
		line = strings.TrimSpace(line[:idx])
	}
	if line == "" {
		return "未命名项目"
	}
	return trimWorkspaceRunes(line, 40)
}

// workspaceExtractHTMLCode 从模型回复中提取完整 HTML：
// 优先取 ```html 代码块，其次取首个代码块（内容为 HTML 时），最后回落到全文。
func workspaceExtractHTMLCode(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	rest := content
	for {
		start := strings.Index(rest, "```")
		if start < 0 {
			break
		}
		after := rest[start+3:]
		lineEnd := strings.IndexAny(after, "\r\n")
		if lineEnd < 0 {
			break
		}
		lang := strings.ToLower(strings.TrimSpace(after[:lineEnd]))
		body := after[lineEnd+1:]
		end := strings.Index(body, "```")
		if end < 0 {
			break
		}
		block := body[:end]
		lower := strings.ToLower(block)
		if strings.HasPrefix(lang, "html") || strings.HasPrefix(lang, "xhtml") {
			return strings.TrimSpace(block)
		}
		if lang == "" && (strings.Contains(lower, "<html") || strings.Contains(lower, "<!doctype")) {
			return strings.TrimSpace(block)
		}
		rest = body[end+3:]
	}
	lower := strings.ToLower(content)
	if strings.HasPrefix(lower, "<!doctype") || strings.HasPrefix(lower, "<html") {
		return content
	}
	return ""
}

// workspaceHTMLResponseContent 从聊天补全 JSON 响应中取助手正文。
func workspaceHTMLResponseContent(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	content := gjson.GetBytes(body, "choices.0.message.content").String()
	if content != "" {
		return strings.TrimSpace(content)
	}
	return strings.TrimSpace(gjson.GetBytes(body, "output_text").String())
}

// workspaceReplaceBody 用改写后的 JSON 替换请求体，后续中间件可继续读取新正文。
func workspaceReplaceBody(c *gin.Context, patched []byte) error {
	newStorage, err := common.CreateBodyStorage(patched)
	if err != nil {
		return err
	}
	if old, sErr := common.GetBodyStorage(c); sErr == nil && old != nil {
		_ = old.Close()
	}
	c.Set(common.KeyBodyStorage, newStorage)
	c.Set(common.KeyRequestBody, nil)
	c.Request.Body = io.NopCloser(bytes.NewReader(patched))
	c.Request.ContentLength = int64(len(patched))
	return nil
}
