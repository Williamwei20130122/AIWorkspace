package asyncgen

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// deriveScene 从客户端请求推导视频场景：优先 mode 字段，其次按图片数量兜底。
func deriveScene(raw map[string]any) string {
	if raw == nil {
		return SceneTextToVideo
	}
	if mode, ok := raw["mode"].(string); ok {
		switch strings.ToLower(strings.TrimSpace(mode)) {
		case "text", "t2v", "text-to-video":
			return SceneTextToVideo
		case "img2img", "i2v", "image":
			return SceneImageToVideo
		case "frames", "first_last_frame", "first-last-frame":
			return SceneFirstLastFrame
		case "subject", "reference":
			return SceneSubjectReference
		}
	}
	images := imagesOf(raw)
	switch {
	case len(images) >= 2:
		return SceneFirstLastFrame
	case len(images) == 1:
		return SceneImageToVideo
	default:
		return SceneTextToVideo
	}
}

// actionForScene 场景 → 任务动作常量。
func actionForScene(scene string) string {
	switch scene {
	case SceneImageToVideo:
		return constant.TaskActionImageToVideo
	case SceneFirstLastFrame:
		return constant.TaskActionFirstTailToVideo
	case SceneSubjectReference:
		return constant.TaskActionReferenceToVideo
	default:
		return constant.TaskActionTextToVideo
	}
}

// imagesOf 收集请求中的图片地址（兼容 image 单图与 images 列表）。
func imagesOf(raw map[string]any) []string {
	if raw == nil {
		return nil
	}
	images := make([]string, 0, 3)
	appendURL := func(value any) {
		text, ok := value.(string)
		if !ok {
			return
		}
		if text = strings.TrimSpace(text); text != "" {
			images = append(images, text)
		}
	}
	switch list := raw["images"].(type) {
	case []any:
		for _, item := range list {
			appendURL(item)
		}
	case []string:
		for _, item := range list {
			appendURL(item)
		}
	}
	if len(images) == 0 {
		appendURL(raw["image"])
	}
	return images
}

func promptOf(raw map[string]any) string {
	if raw == nil {
		return ""
	}
	prompt, _ := raw["prompt"].(string)
	return strings.TrimSpace(prompt)
}

// clientOnlyFields 客户端请求中的工作台私有字段，转发上游前剔除。
var clientOnlyFields = map[string]bool{
	"mode": true, "image": true, "images": true, "metadata": true,
}

// extras 复制客户端原始字段（剔除工作台私有字段与 prompt/model），作为厂商参数底座。
func extras(raw map[string]any) map[string]any {
	body := map[string]any{}
	for key, value := range raw {
		if clientOnlyFields[key] || key == "prompt" || key == "model" {
			continue
		}
		body[key] = value
	}
	return body
}

// clampDuration 把时长钳制到计费允许的上限（billing.md：Duration ≤ MaxTaskDurationSeconds）。
func clampDuration(body map[string]any) {
	raw, ok := body["duration"]
	if !ok {
		return
	}
	switch value := raw.(type) {
	case float64:
		if value <= 0 {
			delete(body, "duration")
			return
		}
		if value > float64(relaycommon.MaxTaskDurationSeconds) {
			body["duration"] = float64(relaycommon.MaxTaskDurationSeconds)
		}
	case int:
		if value <= 0 {
			delete(body, "duration")
			return
		}
		if value > relaycommon.MaxTaskDurationSeconds {
			body["duration"] = relaycommon.MaxTaskDurationSeconds
		}
	}
}

// deepMerge 把 src 深度合并进 dst（src 优先）。
func deepMerge(dst, src map[string]any) {
	for key, value := range src {
		srcMap, srcIsMap := value.(map[string]any)
		dstMap, dstIsMap := dst[key].(map[string]any)
		if srcIsMap && dstIsMap {
			deepMerge(dstMap, srcMap)
			continue
		}
		dst[key] = value
	}
}

// buildBody 按厂商规则编译提交请求体：客户端字段映射 → 场景分支 → 场景/模型微调覆盖。
func (r *resolved) buildBody(model, scene string, raw map[string]any) map[string]any {
	var body map[string]any
	switch r.vendor {
	case "volcengine":
		body = buildVolcengine(model, scene, raw)
	case "zhipu":
		body = buildZhipu(scene, raw)
	case "minimax":
		body = buildMinimax(model, scene, raw)
	case "aliyun":
		body = buildAliyun(scene, raw)
	case "tencent":
		body = buildTencent(scene, raw)
	default:
		body = map[string]any{}
		for key, value := range raw {
			body[key] = value
		}
	}
	if r.cfg != nil {
		if sceneParams := r.cfg.SceneParams[scene]; len(sceneParams) > 0 {
			deepMerge(body, sceneParams)
		}
		if modelParams := r.cfg.ModelParams[model]; len(modelParams) > 0 {
			deepMerge(body, modelParams)
		}
	}
	if _, ok := body["model"]; !ok && model != "" {
		body["model"] = model
	}
	clampDuration(body)
	return body
}

// buildVolcengine 火山方舟：content 数组用 role 区分首帧/尾帧/主体参考图。
func buildVolcengine(model, scene string, raw map[string]any) map[string]any {
	body := extras(raw)
	body["prompt"] = promptOf(raw)
	images := imagesOf(raw)
	content := []any{map[string]any{"type": "text", "text": promptOf(raw)}}
	appendImage := func(url, role string) {
		item := map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}}
		if role != "" {
			item["role"] = role
		}
		content = append(content, item)
	}
	switch scene {
	case SceneImageToVideo:
		if len(images) > 0 {
			appendImage(images[0], "first_frame")
		}
	case SceneFirstLastFrame:
		if len(images) > 0 {
			appendImage(images[0], "first_frame")
		}
		if len(images) > 1 {
			appendImage(images[1], "last_frame")
		}
		// seedance 2.5 首尾帧必须 ratio=adaptive。
		if strings.Contains(strings.ToLower(model), "seedance-2-5") {
			body["ratio"] = "adaptive"
		}
	case SceneSubjectReference:
		for i, url := range images {
			if i >= 3 {
				break
			}
			appendImage(url, "reference_image")
		}
	}
	body["content"] = content
	return body
}

// buildZhipu 智谱：场景靠请求结构区分（首尾帧 image_url 恰 2 张，主体参考 1~3 张）。
func buildZhipu(scene string, raw map[string]any) map[string]any {
	body := extras(raw)
	body["prompt"] = promptOf(raw)
	images := imagesOf(raw)
	switch scene {
	case SceneImageToVideo:
		if len(images) > 0 {
			body["image_url"] = images[0]
		}
	case SceneFirstLastFrame:
		if len(images) > 1 {
			body["image_url"] = []string{images[0], images[1]}
		} else if len(images) == 1 {
			body["image_url"] = images[0]
		}
	case SceneSubjectReference:
		if len(images) > 3 {
			images = images[:3]
		}
		body["image_url"] = images
	}
	return body
}

// buildMiniMax 场景用字段区分；t2v 的 ratio 必填且禁 adaptive，首尾帧恒 adaptive。
func buildMinimax(model string, scene string, raw map[string]any) map[string]any {
	body := extras(raw)
	body["prompt"] = promptOf(raw)
	images := imagesOf(raw)
	lowerModel := strings.ToLower(model)
	switch scene {
	case SceneTextToVideo:
		if ratio, _ := body["ratio"].(string); strings.EqualFold(ratio, "adaptive") {
			body["ratio"] = "16:9"
		} else if _, ok := body["ratio"]; !ok {
			body["ratio"] = "16:9"
		}
	case SceneImageToVideo:
		if len(images) > 0 {
			body["first_frame_image"] = images[0]
		}
	case SceneFirstLastFrame:
		if len(images) > 0 {
			body["first_frame_image"] = images[0]
		}
		if len(images) > 1 {
			body["last_frame_image"] = images[1]
		}
		body["ratio"] = "adaptive"
	case SceneSubjectReference:
		if len(images) > 0 {
			body["reference_images"] = images
		}
		// H3-Lite 等模型主体参考场景禁 adaptive。
		if strings.Contains(lowerModel, "lite") {
			if ratio, ok := body["ratio"].(string); ok && strings.EqualFold(ratio, "adaptive") {
				delete(body, "ratio")
			}
		}
	}
	return body
}

// buildAliyun 阿里万相：input/parameters 两段式；i2v 不携带 ratio。
func buildAliyun(scene string, raw map[string]any) map[string]any {
	extrasBody := extras(raw)
	parameters := extrasBody
	input := map[string]any{"prompt": promptOf(raw)}
	images := imagesOf(raw)
	switch scene {
	case SceneImageToVideo:
		if len(images) > 0 {
			input["image_url"] = images[0]
		}
		delete(parameters, "ratio") // i2v 无 ratio
	case SceneFirstLastFrame, SceneSubjectReference:
		if len(images) > 0 {
			input["ref_image_urls"] = images
		}
	}
	return map[string]any{
		"input":      input,
		"parameters": parameters,
	}
}

// buildTencent 腾讯 TokenHub Vidu：i2v 用 image，首尾帧/主体参考用 images 数组（1~3 张）。
func buildTencent(scene string, raw map[string]any) map[string]any {
	body := extras(raw)
	body["prompt"] = promptOf(raw)
	images := imagesOf(raw)
	switch scene {
	case SceneImageToVideo:
		if len(images) > 0 {
			body["image"] = images[0]
		}
	case SceneFirstLastFrame:
		if len(images) > 1 {
			body["images"] = []string{images[0], images[1]}
		} else if len(images) == 1 {
			body["image"] = images[0]
		}
	case SceneSubjectReference:
		if len(images) > 3 {
			images = images[:3]
		}
		if len(images) > 0 {
			body["images"] = images
		}
	}
	return body
}
