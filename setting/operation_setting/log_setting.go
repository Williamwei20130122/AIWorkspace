package operation_setting

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	LogMaxRangeDaysOptionKey             = "log_setting.max_range_days"
	LogAutoCleanupEnabledOptionKey       = "log_setting.auto_cleanup_enabled"
	LogAutoCleanupRetentionDaysOptionKey = "log_setting.auto_cleanup_retention_days"
)

// LogSetting limits how far regular users can reach into usage logs.
type LogSetting struct {
	// UserExportEnabled lets regular users export their own usage logs.
	// Administrators can always export.
	UserExportEnabled bool `json:"user_export_enabled"`
	// MaxRangeDays is the longest time range a user can search in their logs
	// and dashboard, and the longest range any export can cover.
	MaxRangeDays int `json:"max_range_days"`
	// AutoCleanupEnabled lets the daily maintenance task delete task, audit,
	// and usage logs older than AutoCleanupRetentionDays.
	AutoCleanupEnabled bool `json:"auto_cleanup_enabled"`
	// AutoCleanupRetentionDays is how many days of task, audit, and usage logs
	// the daily automatic cleanup keeps.
	AutoCleanupRetentionDays int `json:"auto_cleanup_retention_days"`
}

var logSetting = LogSetting{
	UserExportEnabled:        true,
	MaxRangeDays:             365,
	AutoCleanupEnabled:       true,
	AutoCleanupRetentionDays: 120,
}

func init() {
	config.GlobalConfig.Register("log_setting", &logSetting)
}

func GetLogSetting() *LogSetting {
	return &logSetting
}

func (s *LogSetting) MaxRangeSeconds() int64 {
	return int64(max(s.MaxRangeDays, 1)) * 24 * 60 * 60
}

func ValidateLogMaxRangeDays(value string) error {
	days, err := strconv.Atoi(value)
	if err != nil || days < 1 {
		return common.NewMessage("The longest log time range must be at least 1 day")
	}
	return nil
}

// AutoCleanupTargetTimestamp is the oldest timestamp the daily automatic
// cleanup keeps; 0 means automatic deletion is switched off.
func (s *LogSetting) AutoCleanupTargetTimestamp(now int64) int64 {
	if !s.AutoCleanupEnabled || s.AutoCleanupRetentionDays <= 0 {
		return 0
	}
	return now - int64(s.AutoCleanupRetentionDays)*24*60*60
}

func ValidateLogAutoCleanupEnabled(value string) error {
	if _, err := strconv.ParseBool(value); err != nil {
		return common.NewMessage("Automatic log deletion must be true or false")
	}
	return nil
}

func ValidateLogAutoCleanupRetentionDays(value string) error {
	days, err := strconv.Atoi(value)
	if err != nil || days < 1 || days > 3650 {
		return common.NewMessage("The automatic log retention period must be an integer between 1 and 3650 days")
	}
	return nil
}
