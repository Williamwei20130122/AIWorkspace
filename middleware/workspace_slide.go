package middleware

import (
	"fmt"
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
	// WorkspaceSlideProjectIdKey 保存演示实验室本次生成写入的项目 id。
	WorkspaceSlideProjectIdKey = "workspace_slide_project_id"
	// WorkspaceSlideRequirementKey 保存学生本次提交的原始需求（用于对话落库）。
	WorkspaceSlideRequirementKey = "workspace_slide_requirement"
	// WorkspaceSlideCreatedKey 标记项目是否为本次请求新建（失败时需回滚）。
	WorkspaceSlideCreatedKey = "workspace_slide_created"
	// WorkspaceSlideModelKey 保存本次生成使用的模型名（用于登记云端素材）。
	WorkspaceSlideModelKey = "workspace_slide_model"

	// workspaceSlidePayloadLimit 注入提示词的当前演示文稿内容上限（rune），避免超长内容挤占上下文。
	workspaceSlidePayloadLimit = 60000
	// workspaceSlideHistoryLimit 携带的历史对话条数。
	workspaceSlideHistoryLimit = 12
	// workspaceSlideHistoryContentLimit 单条历史消息的字符上限。
	workspaceSlideHistoryContentLimit = 3000
	// workspaceSlideResponseLimit 响应缓冲上限，保证完整 slides JSON 可被解析。
	workspaceSlideResponseLimit = 2 * 1024 * 1024
	// workspaceSlideTextLimit 落库消息的字符截断上限。
	workspaceSlideTextLimit = 20000
)

// workspaceSlideItem 单页幻灯片：标题 + 单文件完整 HTML 页面。
type workspaceSlideItem struct {
	Title string `json:"title"`
	Html  string `json:"html"`
}

// workspaceSlideSystemPrompt 演示实验室的系统提示词：
// 在学生输入之上补全「必须输出 JSON 数组形式的完整幻灯片页面」等工程约束。
const workspaceSlideSystemPrompt = `你是「AI Workspace」演示实验室（Slide Lab）的演示文稿生成助手，服务对象是中小学生。

你的任务：根据学生的自然语言需求，生成或修改一套网页版演示文稿（PPT 式幻灯片）。

硬性要求：
1. 只输出一个 JSON 数组，形如 [{"title":"第一页标题","html":"<完整自包含HTML>"}]；数组中每个元素的 html 是一个单文件完整幻灯片页面。
2. 每个 html 必须是完整可直接在浏览器打开的 HTML 文档：包含 <!DOCTYPE html>、<html>、<head>、<body>，并在 <head> 中设置 <meta charset="UTF-8"> 与 viewport。
3. 每个页面按 16:9 视口（如 1280x720）布局并居中展示，整套幻灯片风格统一（配色、字体、版式一致），现代、美观、适合中小学生。
4. 允许外链图片与 CSS（如 CDN 样式、在线图片），但不得依赖任何外部 JavaScript 库，交互用原生 JavaScript 或纯 CSS 实现。
5. 文案使用简体中文（学生明确要求其他语言时除外），内容健康、适合青少年。
6. 修改已有演示文稿时，请在「当前演示文稿内容」的基础上增量修改，保留原有可用页面；除非学生明确要求重做或替换。
7. 回复格式：可以先用不超过 3 行中文说明本次改动要点，随后把 JSON 数组放在 ` + "```json" + ` 代码围栏中；JSON 之外不要再输出第二段代码或长篇解释。
8. JSON 必须合法：html 内部的引号、换行等必须正确转义，禁止使用省略号或「其余不变」等方式省略内容。
9. 如果学生的需求不明确，也请直接给出一套合理且完整的演示文稿，而不是反问。`

// WorkspaceSlidePrepare 提示词工程：把学生的简短需求扩展为一份完整的演示文稿生成任务。
//
//  1. 解析前端提交的 project_id / slides；
//  2. 校验项目归属，必要时新建项目并把项目 id 回填到响应头；
//  3. 组装「系统提示词 + 当前演示文稿内容 + 历史对话 + 本次需求」的 messages；
//  4. 强制 stream=false，便于一次性解析并提取 slides JSON。
func WorkspaceSlidePrepare() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "登录状态无效，请重新登录")
			c.Abort()
			return
		}
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
			common.ApiErrorMsg(c, "演示文稿请求必须为 JSON 格式")
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

		requirement := workspaceSlideLastUserMessage(raw)
		if requirement == "" {
			common.ApiErrorMsg(c, "请输入本次的演示文稿需求")
			c.Abort()
			return
		}

		projectId := int(gjson.GetBytes(raw, "workspace_slide.project_id").Int())
		// 前端可直接提交当前 slides JSON 作为上下文；缺省时回落读取项目已保存内容。
		slides := strings.TrimSpace(gjson.GetBytes(raw, "workspace_slide.slides").String())
		created := false
		if projectId > 0 {
			project, pErr := model.GetWorkspaceSlideProject(projectId)
			if pErr != nil || project.UserId != userId {
				common.ApiErrorMsg(c, "项目不存在或无权访问")
				c.Abort()
				return
			}
			if slides == "" {
				slides = project.Slides
			}
		} else {
			name := workspaceSlideName(requirement)
			project, pErr := model.CreateWorkspaceSlideProject(userId, name)
			if pErr != nil {
				common.ApiErrorMsg(c, "创建项目失败")
				c.Abort()
				return
			}
			projectId = project.Id
			created = true
		}

		// 历史对话来自数据库，前端无需重复上传。
		historyMessages, _ := model.ListWorkspaceSlideMessages(projectId, 50)
		messages := make([]map[string]string, 0, len(historyMessages)+2)
		messages = append(messages, map[string]string{
			"role":    "system",
			"content": workspaceSlideSystemMessages(slides),
		})
		if len(historyMessages) > 0 {
			start := 0
			if len(historyMessages) > workspaceSlideHistoryLimit {
				start = len(historyMessages) - workspaceSlideHistoryLimit
			}
			for _, message := range historyMessages[start:] {
				content := strings.TrimSpace(message.Content)
				if content == "" {
					continue
				}
				messages = append(messages, map[string]string{
					"role":    message.Role,
					"content": trimWorkspaceRunes(content, workspaceSlideHistoryContentLimit),
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
			if effort := setting.GetWorkspaceSlideThinkingEffort(); effort != "" {
				patched, _ = sjson.SetBytes(patched, "reasoning_effort", effort)
			}
		}
		patched, _ = sjson.DeleteBytes(patched, "workspace_slide")
		if err := workspaceReplaceBody(c, patched); err != nil {
			common.ApiErrorMsg(c, "改写请求体失败")
			c.Abort()
			return
		}

		c.Set(WorkspaceSlideProjectIdKey, projectId)
		c.Set(WorkspaceSlideRequirementKey, requirement)
		c.Set(WorkspaceSlideCreatedKey, created)
		c.Set(WorkspaceSlideModelKey, strings.TrimSpace(gjson.GetBytes(raw, "model").String()))
		c.Header("X-Workspace-Slide-Project-Id", strconv.Itoa(projectId))
		c.Next()
	}
}

// WorkspaceSlideCapture 缓冲响应、提取 slides JSON，并把本次对话与最新演示文稿落库。
// 失败（非 2xx）时回滚本次新建的空项目，避免历史列表出现垃圾数据。
func WorkspaceSlideCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		projectId := c.GetInt(WorkspaceSlideProjectIdKey)
		if projectId <= 0 {
			c.Next()
			return
		}
		userId := c.GetInt("id")
		requirement := c.GetString(WorkspaceSlideRequirementKey)
		created := c.GetBool(WorkspaceSlideCreatedKey)

		sw := &workspaceHTMLWriter{ResponseWriter: c.Writer}
		c.Writer = sw
		c.Next()

		if sw.Status() < 200 || sw.Status() >= 300 {
			if created {
				model.DeleteWorkspaceSlideProject(projectId)
			}
			return
		}

		content := workspaceHTMLResponseContent(sw.body)
		items := workspaceExtractSlides(content)
		if len(items) > 0 {
			encoded, mErr := common.Marshal(items)
			if mErr != nil {
				common.SysError(common.LogText("workspace slide marshal slides failed: projectId=%d err=%s", projectId, mErr.Error()))
				model.TouchWorkspaceSlideProject(projectId)
			} else {
				name := ""
				if created {
					name = workspaceSlideName(requirement)
				}
				if err := model.UpdateWorkspaceSlideProject(projectId, name, string(encoded)); err != nil {
					common.SysError(common.LogText("workspace slide save slides failed: projectId=%d err=%s", projectId, err.Error()))
				}
			}
		} else {
			model.TouchWorkspaceSlideProject(projectId)
		}
		if requirement != "" {
			if err := model.InsertWorkspaceSlideMessage(projectId, userId, "user", requirement); err != nil {
				common.SysError(common.LogText("workspace slide insert user message failed: %v", err))
			}
		}
		if content != "" {
			if err := model.InsertWorkspaceSlideMessage(projectId, userId, "assistant", trimWorkspaceRunes(content, workspaceSlideTextLimit)); err != nil {
				common.SysError(common.LogText("workspace slide insert assistant message failed: %v", err))
			}
		}
		workspaceSlideSaveArtifact(c, userId, projectId, requirement, content, items)
	}
}

// workspaceSlideSaveArtifact 把本次生成结果登记为云端素材：
// 解析出 slides 时保存 .json 文件（内容为 slides JSON），否则保存文字反馈（.txt），
// 便于教师在「云端素材 / 使用记录」中按班级查看学生作品。
func workspaceSlideSaveArtifact(c *gin.Context, userId, projectId int, requirement, content string, items []workspaceSlideItem) {
	if userId <= 0 {
		return
	}
	modelName := c.GetString(WorkspaceSlideModelKey)
	filename := fmt.Sprintf("slide-%d-%d.txt", projectId, common.GetTimestamp())
	mimeType := "text/plain"
	body := content
	if len(items) > 0 {
		if encoded, err := common.Marshal(items); err == nil {
			body = string(encoded)
			filename = fmt.Sprintf("slide-%d-%d.json", projectId, common.GetTimestamp())
			mimeType = "application/json"
		}
	}
	if strings.TrimSpace(body) == "" {
		return
	}
	meta := service.WorkspaceArtifactMeta{
		UserId:  userId,
		ClassId: model.GetWorkspaceClassIdByUserId(userId),
		Kind:    "slide",
		Model:   modelName,
		Prompt:  requirement,
	}
	if err := service.SaveWorkspaceArtifact(c.Request.Context(), meta, filename, mimeType, strings.NewReader(body), ""); err != nil {
		common.SysError(common.LogText("workspace slide save artifact failed: projectId=%d err=%s", projectId, err.Error()))
	}
}

// workspaceSlideLastUserMessage 取请求体中最后一条 user 消息作为学生本次需求。
func workspaceSlideLastUserMessage(raw []byte) string {
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

// workspaceSlideSystemMessages 拼装系统提示词，附带当前演示文稿内容。
func workspaceSlideSystemMessages(slides string) string {
	if strings.TrimSpace(slides) == "" {
		return workspaceSlideSystemPrompt + "\n\n当前演示文稿内容：\n（空，演示文稿尚未开始，请生成一套全新的完整幻灯片）"
	}
	return workspaceSlideSystemPrompt + "\n\n当前演示文稿内容如下：\n" + trimWorkspaceRunes(slides, workspaceSlidePayloadLimit)
}

// workspaceSlideName 用需求首行生成项目名称。
func workspaceSlideName(requirement string) string {
	line := strings.TrimSpace(requirement)
	if idx := strings.IndexAny(line, "\r\n"); idx >= 0 {
		line = strings.TrimSpace(line[:idx])
	}
	if line == "" {
		return "未命名演示"
	}
	return trimWorkspaceRunes(line, 40)
}

// workspaceExtractSlides 从模型回复中提取幻灯片数组：
// 优先取 ```json 代码围栏，否则取第一个平衡的 [...] 数组；
// 解析失败返回 nil（由调用方回落为 Touch + 纯文本素材）。
func workspaceExtractSlides(content string) []workspaceSlideItem {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	// 优先扫描 ```json 围栏。
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
		block := strings.TrimSpace(body[:end])
		if strings.HasPrefix(lang, "json") || lang == "" {
			if items := decodeWorkspaceSlides(block); items != nil {
				return items
			}
		}
		rest = body[end+3:]
	}
	// 回落到全文中第一个平衡的 [...] 数组。
	if items := decodeWorkspaceSlides(workspaceFirstJSONArray(content)); items != nil {
		return items
	}
	return nil
}

// decodeWorkspaceSlides 把 JSON 数组文本解析为幻灯片列表；非空数组且元素合法时返回。
func decodeWorkspaceSlides(raw string) []workspaceSlideItem {
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.HasPrefix(raw, "[") {
		return nil
	}
	var items []workspaceSlideItem
	if err := common.UnmarshalJsonStr(raw, &items); err != nil {
		return nil
	}
	// 过滤 title/html 均为空的脏元素，全空视为解析失败。
	cleaned := make([]workspaceSlideItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.Title) == "" && strings.TrimSpace(item.Html) == "" {
			continue
		}
		cleaned = append(cleaned, item)
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}

// workspaceFirstJSONArray 从文本中定位第一个平衡（引号感知、支持字符串内转义）的 [...] 数组。
// 未找到平衡数组时返回空串。
func workspaceFirstJSONArray(content string) string {
	start := strings.Index(content, "[")
	for start >= 0 {
		depth := 0
		inString := false
		escaped := false
		for i := start; i < len(content); i++ {
			ch := content[i]
			if inString {
				if escaped {
					escaped = false
					continue
				}
				switch ch {
				case '\\':
					escaped = true
				case '"':
					inString = false
				}
				continue
			}
			switch ch {
			case '"':
				inString = true
			case '[':
				depth++
			case ']':
				depth--
				if depth == 0 {
					return content[start : i+1]
				}
			}
		}
		// 首个 '[' 未闭合，尝试从下一个 '[' 起重新匹配。
		next := strings.Index(content[start+1:], "[")
		if next < 0 {
			return ""
		}
		start = start + 1 + next
	}
	return ""
}
