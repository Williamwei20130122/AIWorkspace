package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateLogAutoCleanupRetentionDays(t *testing.T) {
	require.NoError(t, ValidateLogAutoCleanupRetentionDays("1"))
	require.NoError(t, ValidateLogAutoCleanupRetentionDays("120"))
	require.NoError(t, ValidateLogAutoCleanupRetentionDays("3650"))
	assert.Error(t, ValidateLogAutoCleanupRetentionDays("0"))
	assert.Error(t, ValidateLogAutoCleanupRetentionDays("-1"))
	assert.Error(t, ValidateLogAutoCleanupRetentionDays("3651"))
	assert.Error(t, ValidateLogAutoCleanupRetentionDays("12.5"))
	assert.Error(t, ValidateLogAutoCleanupRetentionDays("many"))
}

func TestValidateLogAutoCleanupEnabled(t *testing.T) {
	require.NoError(t, ValidateLogAutoCleanupEnabled("true"))
	require.NoError(t, ValidateLogAutoCleanupEnabled("false"))
	assert.Error(t, ValidateLogAutoCleanupEnabled("yes"))
	assert.Error(t, ValidateLogAutoCleanupEnabled(""))
}

func TestLogSettingAutoCleanupTargetTimestamp(t *testing.T) {
	now := int64(1_800_000_000)

	enabled := &LogSetting{AutoCleanupEnabled: true, AutoCleanupRetentionDays: 120}
	assert.Equal(t, now-120*24*60*60, enabled.AutoCleanupTargetTimestamp(now))

	switchedOff := &LogSetting{AutoCleanupEnabled: false, AutoCleanupRetentionDays: 120}
	assert.Zero(t, switchedOff.AutoCleanupTargetTimestamp(now))

	noRetention := &LogSetting{AutoCleanupEnabled: true, AutoCleanupRetentionDays: 0}
	assert.Zero(t, noRetention.AutoCleanupTargetTimestamp(now))
}

func TestLogSettingDefaultsEnableAutomaticCleanup(t *testing.T) {
	setting := GetLogSetting()

	require.True(t, setting.AutoCleanupEnabled)
	assert.Equal(t, 120, setting.AutoCleanupRetentionDays)
}
