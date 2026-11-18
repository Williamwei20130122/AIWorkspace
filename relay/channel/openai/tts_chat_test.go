package openai

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConvertAudioRequestChatTTS 对话协议 TTS 信号开启时，请求必须转成
// chat messages+audio 格式并把上游地址改写为 /v1/chat/completions；
// 信号关闭时保持标准 OpenAI 音频格式与原路径不变。
func TestConvertAudioRequestChatTTS(t *testing.T) {
	gin.SetMode(gin.TestMode)

	request := dto.AudioRequest{
		Model:          "mimo-v2.5-tts",
		Input:          "你好，世界",
		Voice:          "冰糖",
		Instructions:   "语气温柔",
		ResponseFormat: "opus",
	}

	t.Run("信号开启转对话协议", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyWorkspaceTTSChatUpstream, true)
		info := &relaycommon.RelayInfo{
			RelayMode:      relayconstant.RelayModeAudioSpeech,
			RequestURLPath: "/v1/audio/speech",
		}

		converted, err := (&Adaptor{}).ConvertAudioRequest(c, info, request)
		require.NoError(t, err)
		body, err := io.ReadAll(converted)
		require.NoError(t, err)

		assert.Equal(t, "/v1/chat/completions", info.RequestURLPath)
		assert.JSONEq(t, `{
			"model": "mimo-v2.5-tts",
			"messages": [
				{"role": "user", "content": "语气温柔"},
				{"role": "assistant", "content": "你好，世界"}
			],
			"audio": {"format": "mp3", "voice": "冰糖"},
			"stream": false
		}`, string(body))
	})

	t.Run("信号关闭保持标准音频格式", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := &relaycommon.RelayInfo{
			RelayMode:      relayconstant.RelayModeAudioSpeech,
			RequestURLPath: "/v1/audio/speech",
		}

		converted, err := (&Adaptor{}).ConvertAudioRequest(c, info, request)
		require.NoError(t, err)
		body, err := io.ReadAll(converted)
		require.NoError(t, err)

		assert.Equal(t, "/v1/audio/speech", info.RequestURLPath)
		assert.JSONEq(t, `{
			"model": "mimo-v2.5-tts",
			"input": "你好，世界",
			"voice": "冰糖",
			"instructions": "语气温柔",
			"response_format": "opus"
		}`, string(body))
	})
}

// TestBuildChatTTSBody 无朗读指令时只保留 assistant 消息；
// 输出格式归一化到对话协议支持的 mp3/wav。
func TestBuildChatTTSBody(t *testing.T) {
	body, err := buildChatTTSBody(dto.AudioRequest{
		Model:          "mimo-v2.5-tts",
		Input:          "朗读文本",
		Voice:          "mimo_default",
		ResponseFormat: "wav",
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"model": "mimo-v2.5-tts",
		"messages": [{"role": "assistant", "content": "朗读文本"}],
		"audio": {"format": "wav", "voice": "mimo_default"},
		"stream": false
	}`, string(body))
}

// TestDecodeChatTTSAudio 从 JSON 响应提取 base64 音频；
// 缺少音频字段或 base64 非法时返回失败，交由上层保留原始响应。
func TestDecodeChatTTSAudio(t *testing.T) {
	audio := []byte("fake-mp3-bytes")
	encoded := base64.StdEncoding.EncodeToString(audio)

	t.Run("提取音频成功", func(t *testing.T) {
		body := `{"choices":[{"message":{"audio":{"data":"` + encoded + `"}}}],"usage":{"total_tokens":12}}`
		got, ok := decodeChatTTSAudio([]byte(body))
		require.True(t, ok)
		assert.Equal(t, audio, got)
	})

	t.Run("缺少音频字段", func(t *testing.T) {
		_, ok := decodeChatTTSAudio([]byte(`{"choices":[{"message":{"content":"没有音频"}}]}`))
		assert.False(t, ok)
	})

	t.Run("非法base64", func(t *testing.T) {
		_, ok := decodeChatTTSAudio([]byte(`{"choices":[{"message":{"audio":{"data":"!!!"}}}]}`))
		assert.False(t, ok)
	})
}

// TestOpenaiTTSHandlerChatProtocol 对话协议响应必须被解码为音频字节，
// Content-Type 改回音频类型，供前端直接播放。
func TestOpenaiTTSHandlerChatProtocol(t *testing.T) {
	gin.SetMode(gin.TestMode)

	audio := []byte("fake-mp3-bytes")
	encoded := base64.StdEncoding.EncodeToString(audio)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/audio/speech", nil)
	common.SetContextKey(c, constant.ContextKeyWorkspaceTTSChatUpstream, true)
	info := &relaycommon.RelayInfo{
		Request: &dto.AudioRequest{Model: "mimo-v2.5-tts", ResponseFormat: "mp3"},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"audio":{"data":"` + encoded + `"}}}]}`)),
	}

	usage := OpenaiTTSHandler(c, resp, info)
	require.NotNil(t, usage)
	assert.Equal(t, "audio/mpeg", recorder.Header().Get("Content-Type"))
	assert.Equal(t, audio, recorder.Body.Bytes())
}
