package asyncgen

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting"
)

func TestDeriveScene(t *testing.T) {
	cases := []struct {
		name string
		raw  map[string]any
		want string
	}{
		{"空请求默认文字生成视频", nil, SceneTextToVideo},
		{"mode=text 文字生成视频", map[string]any{"mode": "text"}, SceneTextToVideo},
		{"mode=frames 首尾帧", map[string]any{"mode": "frames"}, SceneFirstLastFrame},
		{"mode=subject 主体参考", map[string]any{"mode": "subject"}, SceneSubjectReference},
		{"未知 mode 按图片数量兜底", map[string]any{"mode": "other", "image": "https://a/1.png"}, SceneImageToVideo},
		{"单图兜底图生视频", map[string]any{"image": "https://a/1.png"}, SceneImageToVideo},
		{"双图兜底首尾帧", map[string]any{"images": []any{"https://a/1.png", "https://a/2.png"}}, SceneFirstLastFrame},
	}
	for _, tc := range cases {
		if got := deriveScene(tc.raw); got != tc.want {
			t.Errorf("%s: deriveScene = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestActionForScene(t *testing.T) {
	cases := map[string]string{
		SceneTextToVideo:      constant.TaskActionTextToVideo,
		SceneImageToVideo:     constant.TaskActionImageToVideo,
		SceneFirstLastFrame:   constant.TaskActionFirstTailToVideo,
		SceneSubjectReference: constant.TaskActionReferenceToVideo,
		"":                    constant.TaskActionTextToVideo,
	}
	for scene, want := range cases {
		if got := actionForScene(scene); got != want {
			t.Errorf("actionForScene(%q) = %q, want %q", scene, got, want)
		}
	}
}

func TestBuildBodyAppliesSceneAndModelParams(t *testing.T) {
	r := &resolved{
		vendor: "generic",
		cfg: &setting.WorkspaceAsyncConfig{
			SceneParams: map[string]map[string]any{
				SceneTextToVideo: {"ratio": "16:9"},
			},
			ModelParams: map[string]map[string]any{
				"wan2.2-t2v-flash": {"size": "1280*720"},
			},
		},
	}
	body := r.buildBody("wan2.2-t2v-flash", SceneTextToVideo, map[string]any{
		"prompt":   "一只小猫在草地上奔跑",
		"duration": float64(99999),
		"mode":     "text",
	})
	if body["model"] != "wan2.2-t2v-flash" {
		t.Errorf("缺少 model 兜底字段，got %v", body["model"])
	}
	if body["ratio"] != "16:9" {
		t.Errorf("场景参数未生效，ratio = %v", body["ratio"])
	}
	if body["size"] != "1280*720" {
		t.Errorf("模型参数未生效，size = %v", body["size"])
	}
	if body["prompt"] != "一只小猫在草地上奔跑" {
		t.Errorf("prompt 映射错误，got %v", body["prompt"])
	}
	if relaycommon.MaxTaskDurationSeconds > 0 && body["duration"] != float64(relaycommon.MaxTaskDurationSeconds) {
		t.Errorf("duration 未钳制到计费上限，got %v", body["duration"])
	}
}

func TestBuildVolcengineFrameRoles(t *testing.T) {
	raw := map[string]any{
		"prompt": "镜头缓慢推进",
		"images": []any{"https://a/first.png", "https://a/last.png"},
	}
	body := buildVolcengine("seedance-2-5-t2v", SceneFirstLastFrame, raw)
	content, ok := body["content"].([]any)
	if !ok || len(content) != 3 {
		t.Fatalf("首尾帧 content 结构异常: %#v", body["content"])
	}
	roleOf := func(index int) string {
		item, _ := content[index].(map[string]any)
		role, _ := item["role"].(string)
		return role
	}
	if roleOf(1) != "first_frame" || roleOf(2) != "last_frame" {
		t.Errorf("首尾帧 role 错误: first=%q last=%q", roleOf(1), roleOf(2))
	}
	if body["ratio"] != "adaptive" {
		t.Errorf("seedance 2.5 首尾帧必须 ratio=adaptive, got %v", body["ratio"])
	}

	subject := buildVolcengine("seedance-2-5-t2v", SceneSubjectReference, map[string]any{
		"prompt": "保持人物一致",
		"images": []any{"https://a/ref1.png", "https://a/ref2.png", "https://a/ref3.png", "https://a/ref4.png"},
	})
	content, _ = subject["content"].([]any)
	// text + 最多 3 张主体参考图。
	if len(content) != 4 {
		t.Fatalf("主体参考图数量应限制为 3，content 长度 = %d", len(content))
	}
	if role := roleAt(content, 1); role != "reference_image" {
		t.Errorf("主体参考 role 错误: %q", role)
	}
}

func roleAt(content []any, index int) string {
	item, _ := content[index].(map[string]any)
	role, _ := item["role"].(string)
	return role
}

func TestMapVendorStatus(t *testing.T) {
	if got := mapVendorStatus("queued", nil); got != "queued" {
		t.Errorf("queued 归一错误: %q", got)
	}
	if got := mapVendorStatus("PROCESSING", nil); got != "running" {
		t.Errorf("大小写不敏感归一错误: %q", got)
	}
	if got := mapVendorStatus("SUCCESS", nil); got != "succeeded" {
		t.Errorf("成功态归一错误: %q", got)
	}
	if got := mapVendorStatus("", nil); got != "submitted" {
		t.Errorf("空状态应保持 submitted: %q", got)
	}
	if got := mapVendorStatus("从未见过的状态", nil); got != "submitted" {
		t.Errorf("未知状态应保持非终态 submitted: %q", got)
	}
	custom := &resolved{statusMap: map[string]string{"1": "succeeded", "2": "failed"}}
	if got := mapVendorStatus("1", custom); got != "succeeded" {
		t.Errorf("配置映射未命中: %q", got)
	}
	if got := mapVendorStatus("3", custom); got != "submitted" {
		t.Errorf("配置映射未命中时应回退通用规则: %q", got)
	}
}

func TestExtractFirst(t *testing.T) {
	body := []byte(`{"data":{"task_id":"task-123","id":456},"status":"running"}`)
	if got := extractFirst(body, []string{"id", "data.task_id", "task_id"}); got != "task-123" {
		t.Errorf("任务 ID 提取错误: %q", got)
	}
	if got := extractFirst(body, []string{"data.id", "task_id"}); got != "456" {
		t.Errorf("数字型任务 ID 提取错误: %q", got)
	}
	if got := extractFirst(body, []string{"missing.path", ""}); got != "" {
		t.Errorf("缺失路径应返回空: %q", got)
	}
}

func TestInferVendor(t *testing.T) {
	cases := map[string]string{
		"seedance-2.5-t2v": "volcengine",
		"glm-4-video":      "zhipu",
		"hailuo-01":        "minimax",
		"wan2.2-t2v-flash": "aliyun",
		"kling-v2":         "tencent",
		"mystery-model":    "generic",
	}
	for model, want := range cases {
		if got := inferVendor(model); got != want {
			t.Errorf("inferVendor(%q) = %q, want %q", model, got, want)
		}
	}
}
