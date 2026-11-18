package service

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/artifactstore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newWorkspaceFileServer 返回一个按路径区分类型的极简上游：视频 / 音频 / 图片。
func newWorkspaceFileServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".mp3"):
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("fake-mp3"))
		case strings.HasSuffix(r.URL.Path, ".png"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("fake-png"))
		default:
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("fake-mp4-bytes"))
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// setupWorkspaceArtifactTest 初始化临时数据库与素材根目录。
func setupWorkspaceArtifactTest(t *testing.T) {
	t.Helper()
	previousPath := common.SQLitePath
	previousMaster := common.IsMasterNode
	common.SQLitePath = filepath.Join(t.TempDir(), "workspace-artifact.db")
	// InitDB 仅在主节点执行建表迁移，测试进程需显式声明为主节点。
	common.IsMasterNode = true
	require.NoError(t, model.InitDB())
	common.IsMasterNode = previousMaster
	model.InitOptionMap()
	t.Cleanup(func() {
		// 先释放数据库连接，否则 Windows 下临时目录无法删除。
		if model.DB != nil {
			if sqlDB, err := model.DB.DB(); err == nil {
				_ = sqlDB.Close()
			}
		}
		common.SQLitePath = previousPath
		common.IsMasterNode = previousMaster
	})

	previousStore := artifactstore.Default()
	artifactstore.SetDefault(artifactstore.NewLocalDiskStore(filepath.Join(t.TempDir(), "artifacts")))
	t.Cleanup(func() { artifactstore.SetDefault(previousStore) })
}

func allWorkspaceArtifacts(t *testing.T) []*model.WorkspaceArtifact {
	t.Helper()
	items, err := model.AllWorkspaceArtifacts(model.WorkspaceArtifactQuery{})
	require.NoError(t, err)
	return items
}

func readWorkspaceArtifactFile(t *testing.T, storagePath string) string {
	t.Helper()
	abs, err := artifactstore.Default().LocalPath(storagePath)
	require.NoError(t, err)
	content, err := os.ReadFile(abs)
	require.NoError(t, err)
	return string(content)
}

// TestArtifactStoreRelativeDirRules 校验落盘目录规则与非法字符清洗。
func TestArtifactStoreRelativeDirRules(t *testing.T) {
	full := artifactstore.RelativeDir(artifactstore.Scope{
		StageName: "小学", EntryYear: 2024, ClassName: "三年级1班", LessonId: 7, UserId: 5, UserName: "张三",
	})
	assert.Equal(t, "小学/2024届/三年级1班/第7课/张三", full)

	empty := artifactstore.RelativeDir(artifactstore.Scope{})
	assert.Equal(t, "未分学段/未分届/未分班级/未关联课次/未知学生", empty)

	sanitized := artifactstore.RelativeDir(artifactstore.Scope{
		StageName: "../etc", ClassName: "a:b*c?d", LessonId: 3, UserId: 9, UserName: " 李/四 ",
	})
	assert.Equal(t, "_etc/未分届/a_b_c_d/第3课/李_四", sanitized)
}

// TestCollectWorkspaceTaskArtifact 覆盖异步能力（视频 / 音乐）的终态下载落盘。
func TestCollectWorkspaceTaskArtifact(t *testing.T) {
	setupWorkspaceArtifactTest(t)
	server := newWorkspaceFileServer(t)

	// 非中台任务（无 workspace 标记）不采集。
	plain := &model.Task{UserId: 1, Status: model.TaskStatusSuccess}
	plain.PrivateData.ResultURL = server.URL + "/a.mp4"
	CollectWorkspaceTaskArtifact(plain)

	// 未成功终态不采集。
	failed := &model.Task{UserId: 1, Status: model.TaskStatusFailure}
	failed.PrivateData = model.TaskPrivateData{Workspace: true, WorkspaceKind: "video", ResultURL: server.URL + "/a.mp4"}
	CollectWorkspaceTaskArtifact(failed)

	// 结果地址不是 http 时不采集。
	invalid := &model.Task{UserId: 1, Status: model.TaskStatusSuccess}
	invalid.PrivateData = model.TaskPrivateData{Workspace: true, WorkspaceKind: "video", ResultURL: "not-a-url"}
	CollectWorkspaceTaskArtifact(invalid)

	assert.Empty(t, allWorkspaceArtifacts(t), "非中台任务 / 非成功 / 非法地址都不应产生素材")

	// 成功的中台视频任务：下载并落盘。
	video := &model.Task{UserId: 1, Status: model.TaskStatusSuccess}
	video.PrivateData = model.TaskPrivateData{Workspace: true, WorkspaceKind: "video", ResultURL: server.URL + "/clip.mp4"}
	video.Properties.OriginModelName = "mock-video"
	video.Properties.Input = "一只猫在跑"
	CollectWorkspaceTaskArtifact(video)

	items := allWorkspaceArtifacts(t)
	require.Len(t, items, 1)
	assert.Equal(t, "video", items[0].Kind)
	assert.Equal(t, "mock-video", items[0].Model)
	assert.Equal(t, "video/mp4", items[0].MimeType)
	assert.Equal(t, server.URL+"/clip.mp4", items[0].SourceURL)
	assert.True(t, strings.HasSuffix(items[0].StoragePath, ".mp4"), items[0].StoragePath)
	assert.Equal(t, int64(len("fake-mp4-bytes")), items[0].SizeBytes)
	assert.Equal(t, "fake-mp4-bytes", readWorkspaceArtifactFile(t, items[0].StoragePath))
	assert.True(t, strings.HasPrefix(items[0].StoragePath, "未分学段/未分届/未分班级/未关联课次/"), items[0].StoragePath)

	// 音乐任务：扩展名与 MIME 跟随上游 Content-Type。
	music := &model.Task{UserId: 1, Status: model.TaskStatusSuccess}
	music.PrivateData = model.TaskPrivateData{Workspace: true, WorkspaceKind: "music", ResultURL: server.URL + "/song.mp3"}
	music.Properties.OriginModelName = "mock-music"
	CollectWorkspaceTaskArtifact(music)

	musicItems := allWorkspaceArtifacts(t)
	require.Len(t, musicItems, 2)
	// 最新一条（id 最大）即音乐素材。
	var newest *model.WorkspaceArtifact
	for _, item := range musicItems {
		if newest == nil || item.Id > newest.Id {
			newest = item
		}
	}
	assert.Equal(t, "music", newest.Kind)
	assert.Equal(t, "audio/mpeg", newest.MimeType)
	assert.True(t, strings.HasSuffix(newest.StoragePath, ".mp3"), newest.StoragePath)
}

// TestCollectWorkspaceSyncArtifact 覆盖同步能力产物的解析与落盘。
func TestCollectWorkspaceSyncArtifact(t *testing.T) {
	setupWorkspaceArtifactTest(t)
	server := newWorkspaceFileServer(t)
	meta := WorkspaceArtifactMeta{UserId: 1, ClassId: 0, Kind: "image", Model: "mock-image", Prompt: "一只猫"}

	// 形态一：b64_json 直接解码落盘。
	encoded := base64.StdEncoding.EncodeToString([]byte("fake-png"))
	require.NoError(t, CollectWorkspaceSyncArtifact(t.Context(), meta,
		"application/json", []byte(`{"data":[{"b64_json":"`+encoded+`"}]}`)))
	items := allWorkspaceArtifacts(t)
	require.Len(t, items, 1)
	assert.Equal(t, "image/png", items[0].MimeType)
	assert.Equal(t, "fake-png", readWorkspaceArtifactFile(t, items[0].StoragePath))

	// 形态二：URL 需下载。
	urlMeta := WorkspaceArtifactMeta{UserId: 1, Kind: "edit", Model: "mock-edit", Prompt: "水彩"}
	require.NoError(t, CollectWorkspaceSyncArtifact(t.Context(), urlMeta,
		"application/json", []byte(`{"data":[{"url":"`+server.URL+`/gen.png"}]}`)))
	items = allWorkspaceArtifacts(t)
	require.Len(t, items, 2)
	var editItem *model.WorkspaceArtifact
	for _, item := range items {
		if item.Kind == "edit" {
			editItem = item
		}
	}
	require.NotNil(t, editItem)
	assert.Equal(t, server.URL+"/gen.png", editItem.SourceURL)
	assert.Equal(t, "fake-png", readWorkspaceArtifactFile(t, editItem.StoragePath))

	// 声音合成：原始音频字节按 Content-Type 推断扩展名。
	require.NoError(t, CollectWorkspaceSyncArtifact(t.Context(),
		WorkspaceArtifactMeta{UserId: 1, Kind: "tts", Model: "mock-tts"}, "audio/wav", []byte("RIFF-fake-wav")))
	items = allWorkspaceArtifacts(t)
	require.Len(t, items, 3)
	var ttsItem *model.WorkspaceArtifact
	for _, item := range items {
		if item.Kind == "tts" {
			ttsItem = item
		}
	}
	require.NotNil(t, ttsItem)
	assert.Equal(t, "audio/wav", ttsItem.MimeType)
	assert.True(t, strings.HasSuffix(ttsItem.StoragePath, ".wav"), ttsItem.StoragePath)

	// 文字生成：保存提示词与响应正文。
	textMeta := WorkspaceArtifactMeta{UserId: 1, Kind: "text", Model: "mock-chat", Prompt: "介绍杭州"}
	require.NoError(t, CollectWorkspaceSyncArtifact(t.Context(), textMeta,
		"application/json", []byte(`{"choices":[{"message":{"content":"杭州是浙江省会"}}]}`)))
	items = allWorkspaceArtifacts(t)
	require.Len(t, items, 4)
	var textItem *model.WorkspaceArtifact
	for _, item := range items {
		if item.Kind == "text" {
			textItem = item
		}
	}
	require.NotNil(t, textItem)
	assert.True(t, strings.HasSuffix(textItem.StoragePath, ".json"), textItem.StoragePath)
	content := readWorkspaceArtifactFile(t, textItem.StoragePath)
	assert.Contains(t, content, "介绍杭州")
	assert.Contains(t, content, "杭州是浙江省会")
}
