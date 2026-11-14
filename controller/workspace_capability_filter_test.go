package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 造数：模型管理里存活的模型 + 已删除但渠道残留的模型 + 仅渠道配置的测试模型，
// 三者都出现在能力声明里，验证学生/教师端能力接口只下发「仍可用」的模型。
func setupWorkspaceCapabilityFixtures(t *testing.T) {
	t.Helper()
	db := setupModelListControllerTestDB(t)
	// 模型 Insert/删除会触发元数据同步写 options 表，补齐缺失的表。
	require.NoError(t, db.AutoMigrate(&model.Option{}))

	alive := model.Model{ModelName: "zz-ws-alive", Status: 1}
	require.NoError(t, alive.Insert())
	deleted := model.Model{ModelName: "zz-ws-deleted", Status: 1}
	require.NoError(t, deleted.Insert())
	// 模拟「模型管理删除时未勾选从渠道移除」：软删除元数据，渠道与 abilities 仍保留。
	require.NoError(t, db.Delete(&model.Model{}, deleted.Id).Error)

	channel := model.Channel{
		Name:   "zz-ws-channel",
		Type:   1,
		Key:    "fixture-key",
		Models: "zz-ws-alive,zz-ws-deleted,zz-ws-channel-only",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-ws-alive", ChannelId: channel.Id, Enabled: true},
		{Group: "default", Model: "zz-ws-deleted", ChannelId: channel.Id, Enabled: true},
		{Group: "default", Model: "zz-ws-channel-only", ChannelId: channel.Id, Enabled: true},
	}).Error)

	previousOptionMap := common.OptionMap
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMap[setting.WorkspaceModelCapabilitiesKey] = `[
		{"model":"zz-ws-alive","kinds":["text"],"audience":"both"},
		{"model":"zz-ws-deleted","kinds":["text"],"audience":"both"},
		{"model":"zz-ws-channel-only","kinds":["text"],"audience":"both"}
	]`
	t.Cleanup(func() { common.OptionMap = previousOptionMap })
}

// 删除后仍残留在渠道里的模型不得再出现在能力下拉；
// 仅在渠道里配置（未在模型管理登记）的测试模型必须保留可选。
func TestWorkspaceCapabilitiesOmitDeletedModelResidue(t *testing.T) {
	setupWorkspaceCapabilityFixtures(t)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/workspace/capabilities", nil)
	ctx.Set("id", 0)
	ctx.Set("role", common.RoleAdminUser) // 教师：短路小班 AI/HTML 开关查询

	GetWorkspaceCapabilities(ctx)

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Capabilities []setting.WorkspaceCapability `json:"capabilities"`
			AiEnabled    bool                          `json:"ai_enabled"`
			HtmlEnabled  bool                          `json:"html_enabled"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	require.True(t, payload.Success)

	var text *setting.WorkspaceCapability
	for i := range payload.Data.Capabilities {
		if payload.Data.Capabilities[i].Kind == "text" {
			text = &payload.Data.Capabilities[i]
			break
		}
	}
	require.NotNil(t, text, "文生文能力必须存在")
	assert.ElementsMatch(t, []string{"zz-ws-alive", "zz-ws-channel-only"}, text.Models,
		"已删除模型残留应被过滤，仅渠道测试模型应保留")
	assert.NotContains(t, text.Models, "zz-ws-deleted")
	assert.True(t, text.Enabled)
}

// 模型删除后又重建了同名模型（存在存活行），不得被历史软删记录误过滤。
func TestWorkspaceCapabilitiesKeepsRecreatedModelWithDeletedHistory(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))

	// 先删（软删残留），再以同名重建存活记录。
	original := model.Model{ModelName: "zz-ws-recreated", Status: 1}
	require.NoError(t, original.Insert())
	require.NoError(t, db.Delete(&model.Model{}, original.Id).Error)
	rebuilt := model.Model{ModelName: "zz-ws-recreated", Status: 1}
	require.NoError(t, rebuilt.Insert())

	previousOptionMap := common.OptionMap
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMap[setting.WorkspaceModelCapabilitiesKey] = `[{"model":"zz-ws-recreated","kinds":["text"],"audience":"both"}]`
	t.Cleanup(func() { common.OptionMap = previousOptionMap })

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/workspace/capabilities", nil)
	ctx.Set("id", 0)
	ctx.Set("role", common.RoleAdminUser)

	GetWorkspaceCapabilities(ctx)

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Capabilities []setting.WorkspaceCapability `json:"capabilities"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	require.True(t, payload.Success)
	var text *setting.WorkspaceCapability
	for i := range payload.Data.Capabilities {
		if payload.Data.Capabilities[i].Kind == "text" {
			text = &payload.Data.Capabilities[i]
			break
		}
	}
	require.NotNil(t, text)
	assert.Contains(t, text.Models, "zz-ws-recreated", "重建的同名模型必须仍可选")
	assert.True(t, text.Enabled)
}

// HTML 实验室配置同样不得下发已删除模型（html 未单独声明时复用文生文模型）。
func TestWorkspaceHtmlLabConfigOmitsDeletedModelResidue(t *testing.T) {
	setupWorkspaceCapabilityFixtures(t)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/workspace/html/config", nil)
	ctx.Set("id", 0)
	ctx.Set("role", common.RoleAdminUser)

	GetWorkspaceHtmlLabConfig(ctx)

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Enabled bool     `json:"enabled"`
			Models  []string `json:"models"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	require.True(t, payload.Success)
	assert.ElementsMatch(t, []string{"zz-ws-alive", "zz-ws-channel-only"}, payload.Data.Models)
	assert.NotContains(t, payload.Data.Models, "zz-ws-deleted")
	assert.True(t, payload.Data.Enabled)
}
