package operation_setting

import (
	"fmt"
	"math"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/setting/config"
)

type MonitorSetting struct {
	AutoTestChannelEnabled bool    `json:"auto_test_channel_enabled"`
	AutoTestChannelMinutes float64 `json:"auto_test_channel_minutes"`
	ChannelTestMode        string  `json:"channel_test_mode"`
	ChannelTestConcurrency int     `json:"channel_test_concurrency"`
	// AutoBalanceCheckEnabled 每日自动检查全部启用渠道的剩余余额。
	AutoBalanceCheckEnabled bool `json:"auto_balance_check_enabled"`
	// ChannelBalanceAlertThreshold 余额预警阈值；<= 0 表示关闭预警，只刷新余额。
	// 支持小数（上游余额多以美元计），0.01 即“余额低于 0.01 就提醒”。
	ChannelBalanceAlertThreshold float64 `json:"channel_balance_alert_threshold"`
	// ChannelBalanceAlertEmails 余额预警额外收件邮箱，逗号分隔；留空表示只通知管理员。
	ChannelBalanceAlertEmails string `json:"channel_balance_alert_emails"`
	// ChannelBalanceAlertWecomWebhook 企业微信群机器人 webhook，留空表示不推送。
	ChannelBalanceAlertWecomWebhook string `json:"channel_balance_alert_wecom_webhook"`
	// ChannelBalanceAlertFeishuWebhook 飞书群机器人 webhook，留空表示不推送。
	ChannelBalanceAlertFeishuWebhook string `json:"channel_balance_alert_feishu_webhook"`
}

const (
	ChannelTestModeScheduledAll    = "scheduled_all"
	ChannelTestModeAutoBanOnly     = "auto_ban_only"
	ChannelTestModePassiveRecovery = "passive_recovery"

	ChannelTestConcurrencyOptionKey = "monitor_setting.channel_test_concurrency"
	DefaultChannelTestConcurrency   = 1
	MaxChannelTestConcurrency       = 32
)

// 默认配置
var monitorSetting = MonitorSetting{
	AutoTestChannelEnabled:           false,
	AutoTestChannelMinutes:           10,
	ChannelTestMode:                  ChannelTestModeScheduledAll,
	ChannelTestConcurrency:           DefaultChannelTestConcurrency,
	AutoBalanceCheckEnabled:          false,
	ChannelBalanceAlertThreshold:     0,
	ChannelBalanceAlertEmails:        "",
	ChannelBalanceAlertWecomWebhook:  "",
	ChannelBalanceAlertFeishuWebhook: "",
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("monitor_setting", &monitorSetting)
}

func GetMonitorSetting() *MonitorSetting {
	if os.Getenv("CHANNEL_TEST_FREQUENCY") != "" {
		frequency, err := strconv.Atoi(os.Getenv("CHANNEL_TEST_FREQUENCY"))
		if err == nil && frequency > 0 {
			monitorSetting.AutoTestChannelEnabled = true
			monitorSetting.AutoTestChannelMinutes = float64(frequency)
			monitorSetting.ChannelTestMode = ChannelTestModeScheduledAll
		}
	}
	if enabled, ok := os.LookupEnv("CHANNEL_TEST_ENABLED"); ok {
		parsed, err := strconv.ParseBool(enabled)
		if err == nil {
			monitorSetting.AutoTestChannelEnabled = parsed
		}
	}
	switch monitorSetting.ChannelTestMode {
	case ChannelTestModeAutoBanOnly, ChannelTestModePassiveRecovery:
	default:
		monitorSetting.ChannelTestMode = ChannelTestModeScheduledAll
	}
	monitorSetting.ChannelTestConcurrency = NormalizeChannelTestConcurrency(monitorSetting.ChannelTestConcurrency)
	return &monitorSetting
}

func NormalizeChannelTestConcurrency(concurrency int) int {
	if concurrency < 1 {
		return DefaultChannelTestConcurrency
	}
	if concurrency > MaxChannelTestConcurrency {
		return MaxChannelTestConcurrency
	}
	return concurrency
}

func ValidateChannelTestConcurrency(value string) error {
	concurrency, err := strconv.Atoi(value)
	if err != nil || concurrency < 1 || concurrency > MaxChannelTestConcurrency {
		return fmt.Errorf("channel test concurrency must be between 1 and %d", MaxChannelTestConcurrency)
	}
	return nil
}

// ValidateChannelBalanceAlertThreshold 校验余额预警阈值：允许留空（= 关闭预警）
// 或 0~1e9 的数值（含小数，上游余额多以美元计）。
func ValidateChannelBalanceAlertThreshold(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	threshold, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || threshold > 1e9 {
		return fmt.Errorf("channel balance alert threshold must be a number between 0 and 1e9")
	}
	return nil
}

// SplitChannelBalanceAlertEmails 把预警收件人配置拆成单个邮箱，支持用逗号、
// 分号或空白分隔。
func SplitChannelBalanceAlertEmails(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || unicode.IsSpace(r)
	})
}

// ValidateChannelBalanceAlertEmails 校验余额预警收件邮箱：允许留空，否则每个
// 地址必须是合法且不含显示名的单个邮箱。
func ValidateChannelBalanceAlertEmails(value string) error {
	for _, email := range SplitChannelBalanceAlertEmails(value) {
		addr, err := mail.ParseAddress(email)
		if err != nil || addr.Address != email {
			return fmt.Errorf("invalid balance alert email: %s", email)
		}
	}
	return nil
}

// ValidateChannelBalanceAlertWebhook 校验余额预警机器人 webhook：允许留空，
// 否则必须是 https 地址（企业微信 / 飞书群机器人）。
func ValidateChannelBalanceAlertWebhook(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("balance alert webhook must be an https URL")
	}
	return nil
}
