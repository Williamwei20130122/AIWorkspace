package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetMonitorSetting_ChannelTestEnabledEnvOverridesEnabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "false")
	t.Setenv("CHANNEL_TEST_FREQUENCY", "5")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: true,
		AutoTestChannelMinutes: 20,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.False(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(5), setting.AutoTestChannelMinutes)
}

func TestGetMonitorSetting_ChannelTestEnabledEnvCanEnableDisabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "true")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: false,
		AutoTestChannelMinutes: 12,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.True(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(12), setting.AutoTestChannelMinutes)
}

func TestGetMonitorSettingPreservesAutoBanOnlyMode(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "")
	t.Setenv("CHANNEL_TEST_FREQUENCY", "")
	monitorSetting = MonitorSetting{ChannelTestMode: ChannelTestModeAutoBanOnly}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.Equal(t, ChannelTestModeAutoBanOnly, setting.ChannelTestMode)
}

func TestGetMonitorSettingNormalizesChannelTestConcurrency(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	tests := []struct {
		name        string
		concurrency int
		want        int
	}{
		{name: "missing uses safe default", concurrency: 0, want: DefaultChannelTestConcurrency},
		{name: "configured value is preserved", concurrency: 8, want: 8},
		{name: "oversized value is capped", concurrency: MaxChannelTestConcurrency + 1, want: MaxChannelTestConcurrency},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			monitorSetting = MonitorSetting{ChannelTestConcurrency: test.concurrency}

			setting := GetMonitorSetting()

			require.NotNil(t, setting)
			assert.Equal(t, test.want, setting.ChannelTestConcurrency)
		})
	}
}

func TestValidateChannelTestConcurrency(t *testing.T) {
	require.NoError(t, ValidateChannelTestConcurrency("1"))
	require.NoError(t, ValidateChannelTestConcurrency("32"))
	assert.Error(t, ValidateChannelTestConcurrency("0"))
	assert.Error(t, ValidateChannelTestConcurrency("33"))
	assert.Error(t, ValidateChannelTestConcurrency("1.5"))
}

func TestValidateChannelBalanceAlertEmails(t *testing.T) {
	require.NoError(t, ValidateChannelBalanceAlertEmails(""))
	require.NoError(t, ValidateChannelBalanceAlertEmails("  "))
	require.NoError(t, ValidateChannelBalanceAlertEmails("ops@example.com"))
	require.NoError(t, ValidateChannelBalanceAlertEmails("ops@example.com, admin@example.com; oncall@example.com"))
	assert.Error(t, ValidateChannelBalanceAlertEmails("not-an-email"))
	assert.Error(t, ValidateChannelBalanceAlertEmails("ops@example.com, bad"))
	assert.Error(t, ValidateChannelBalanceAlertEmails("Name <ops@example.com>"))
}

func TestSplitChannelBalanceAlertEmails(t *testing.T) {
	assert.Empty(t, SplitChannelBalanceAlertEmails(""))
	assert.Equal(t,
		[]string{"a@example.com", "b@example.com", "c@example.com"},
		SplitChannelBalanceAlertEmails("a@example.com, b@example.com;c@example.com"))
}

func TestValidateChannelBalanceAlertWebhook(t *testing.T) {
	require.NoError(t, ValidateChannelBalanceAlertWebhook(""))
	require.NoError(t, ValidateChannelBalanceAlertWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x"))
	require.NoError(t, ValidateChannelBalanceAlertWebhook(" https://open.feishu.cn/open-apis/bot/v2/hook/x "))
	assert.Error(t, ValidateChannelBalanceAlertWebhook("http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x"))
	assert.Error(t, ValidateChannelBalanceAlertWebhook("not a url"))
	assert.Error(t, ValidateChannelBalanceAlertWebhook("ftp://example.com/hook"))
}
