package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

// setAsyncCapabilities 在内存 OptionMap 中注入模型能力声明（不落库），用例结束后恢复。
func setAsyncCapabilities(t *testing.T, raw string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	old, existed := common.OptionMap[setting.WorkspaceModelCapabilitiesKey]
	common.OptionMap[setting.WorkspaceModelCapabilitiesKey] = raw
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if existed {
			common.OptionMap[setting.WorkspaceModelCapabilitiesKey] = old
		} else {
			delete(common.OptionMap, setting.WorkspaceModelCapabilitiesKey)
		}
	})
}

func asyncPollTestTask(modelName string, pollCount int) *model.Task {
	return &model.Task{
		Properties:  model.Properties{OriginModelName: modelName},
		PrivateData: model.TaskPrivateData{PollCount: pollCount},
	}
}

func TestAsyncPollDelayZeroForNonAsyncModel(t *testing.T) {
	setAsyncCapabilities(t, `[{"model":"gpt-4o","kinds":["text"],"async":false}]`)
	if delay := asyncPollDelay(asyncPollTestTask("gpt-4o", 0)); delay != 0 {
		t.Errorf("非异步模型应保持既有调度节奏，delay = %d", delay)
	}
	if delay := asyncPollDelay(asyncPollTestTask("", 0)); delay != 0 {
		t.Errorf("空模型名应返回 0，delay = %d", delay)
	}
}

func TestAsyncPollDelayExponentialBackoffWithCap(t *testing.T) {
	setAsyncCapabilities(t, `[{"model":"poll-backoff-video","kinds":["video"],"async":true}]`)
	want := []int{10, 20, 40, 60, 60, 60}
	for pollCount, expected := range want {
		delay := asyncPollDelay(asyncPollTestTask("poll-backoff-video", pollCount))
		if delay != expected {
			t.Errorf("PollCount=%d: delay = %d, want %d", pollCount, delay, expected)
		}
	}
}

func TestAsyncPollDelayNeverBelowThreeSeconds(t *testing.T) {
	// 管理端配置了 1s/2s（保存时会被钳制，这里验证轮询链的运行期兜底）。
	setAsyncCapabilities(t, `[{"model":"poll-clamp-video","kinds":["video"],"async":true,"async_config":"{\"poll_interval\":1,\"poll_max_interval\":2}"}]`)
	for _, pollCount := range []int{0, 1, 5} {
		delay := asyncPollDelay(asyncPollTestTask("poll-clamp-video", pollCount))
		if delay < 3 {
			t.Errorf("PollCount=%d: 轮询间隔 %d 秒低于 3 秒下限", pollCount, delay)
		}
	}
}

func TestAsyncPollDelayRespectsCustomInterval(t *testing.T) {
	setAsyncCapabilities(t, `[{"model":"poll-custom-video","kinds":["video"],"async":true,"async_config":"{\"poll_interval\":5,\"poll_max_interval\":30}"}]`)
	cases := map[int]int{0: 5, 1: 10, 2: 20, 3: 30, 4: 30}
	for pollCount, expected := range cases {
		delay := asyncPollDelay(asyncPollTestTask("poll-custom-video", pollCount))
		if delay != expected {
			t.Errorf("PollCount=%d: delay = %d, want %d", pollCount, delay, expected)
		}
	}
}
