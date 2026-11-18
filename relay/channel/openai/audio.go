package openai

import (
	"bytes"
	"encoding/base64"
	"io"
	"math"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// 对话协议 TTS（如 MiMo 复用 /v1/chat/completions）的请求结构：
// 朗读指令作为 user 角色、待合成文本作为 assistant 角色，音频参数放进 audio 字段。
type chatTTSMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatTTSAudioParam struct {
	Format string `json:"format"`
	Voice  string `json:"voice,omitempty"`
}

type chatTTSRequest struct {
	Model    string            `json:"model"`
	Messages []chatTTSMessage  `json:"messages"`
	Audio    chatTTSAudioParam `json:"audio"`
	Stream   bool              `json:"stream"`
}

// chatTTSFormat 把 OpenAI 的输出格式归一化到对话协议 TTS 支持的 mp3/wav，
// 其余格式（opus/aac/flac/pcm 或未指定）一律回落 mp3。
func chatTTSFormat(responseFormat string) string {
	if responseFormat == "wav" {
		return "wav"
	}
	return "mp3"
}

func chatTTSContentType(format string) string {
	if format == "wav" {
		return "audio/wav"
	}
	return "audio/mpeg"
}

// buildChatTTSBody 把音频合成请求转成对话协议 TTS 请求体；
// speed 等对话协议不支持的字段直接丢弃。
func buildChatTTSBody(request dto.AudioRequest) ([]byte, error) {
	messages := make([]chatTTSMessage, 0, 2)
	if request.Instructions != "" {
		messages = append(messages, chatTTSMessage{Role: "user", Content: request.Instructions})
	}
	messages = append(messages, chatTTSMessage{Role: "assistant", Content: request.Input})
	body := chatTTSRequest{
		Model:    request.Model,
		Messages: messages,
		Audio:    chatTTSAudioParam{Format: chatTTSFormat(request.ResponseFormat), Voice: request.Voice},
		Stream:   false,
	}
	return common.Marshal(body)
}

// decodeChatTTSAudio 从对话协议 TTS 的 JSON 响应中提取 base64 音频字节。
func decodeChatTTSAudio(body []byte) ([]byte, bool) {
	var payload struct {
		Choices []struct {
			Message struct {
				Audio struct {
					Data string `json:"data"`
				} `json:"audio"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, false
	}
	for _, choice := range payload.Choices {
		if choice.Message.Audio.Data == "" {
			continue
		}
		audio, err := base64.StdEncoding.DecodeString(choice.Message.Audio.Data)
		if err != nil {
			return nil, false
		}
		return audio, true
	}
	return nil, false
}

func OpenaiTTSHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) *dto.Usage {
	// the status code has been judged before, if there is a body reading failure,
	// it should be regarded as a non-recoverable error, so it should not return err for external retry.
	// Analogous to nginx's load balancing, it will only retry if it can't be requested or
	// if the upstream returns a specific status code, once the upstream has already written the header,
	// the subsequent failure of the response body should be regarded as a non-recoverable error,
	// and can be terminated directly.
	defer service.CloseResponseBodyGracefully(resp)
	usage := &dto.Usage{}
	usage.PromptTokens = info.GetEstimatePromptTokens()
	usage.TotalTokens = info.GetEstimatePromptTokens()

	// 对话协议 TTS（如 MiMo）：上游返回 JSON，音频以 base64 放在
	// choices[0].message.audio.data，先解码成音频字节并把 Content-Type 改回音频类型，
	// 后续流程按原始音频照常复制头部、写回与按时长计费。
	if !info.IsStream && common.GetContextKeyBool(c, constant.ContextKeyWorkspaceTTSChatUpstream) {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			if audio, ok := decodeChatTTSAudio(bodyBytes); ok {
				format := chatTTSFormat("")
				if audioReq, reqOk := info.Request.(*dto.AudioRequest); reqOk {
					format = chatTTSFormat(audioReq.ResponseFormat)
				}
				resp.Header.Set("Content-Type", chatTTSContentType(format))
				resp.Body = io.NopCloser(bytes.NewReader(audio))
			} else {
				// 上游未按约定返回音频（如错误信息），保留原始响应交由下游展示。
				logger.LogError(c, common.LogText("chat tts response carries no audio data"))
				resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			}
		}
	}

	for k, v := range resp.Header {
		if !service.ShouldCopyUpstreamHeader(c, k, v) {
			continue
		}
		c.Writer.Header().Set(k, v[0])
	}
	c.Writer.WriteHeader(resp.StatusCode)

	if info.IsStream {
		helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
			if service.SundaySearch(data, "usage") {
				var simpleResponse dto.SimpleResponse
				if err := common.Unmarshal([]byte(data), &simpleResponse); err != nil {
					logger.LogError(c, err.Error())
					sr.Error(err)
				} else if simpleResponse.Usage.TotalTokens != 0 {
					usage.PromptTokens = simpleResponse.Usage.InputTokens
					usage.CompletionTokens = simpleResponse.OutputTokens
					usage.TotalTokens = simpleResponse.TotalTokens
				}
			}
			if err := helper.StringData(c, data); err != nil {
				sr.Error(err)
			}
		})
	} else {
		common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
		// 读取响应体到缓冲区
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.LogError(c, common.LogText("failed to read TTS response body: %v", err))
			c.Writer.WriteHeaderNow()
			return usage
		}

		// 写入响应到客户端
		c.Writer.WriteHeaderNow()
		_, err = c.Writer.Write(bodyBytes)
		if err != nil {
			logger.LogError(c, common.LogText("failed to write TTS response: %v", err))
		}

		// 计算音频时长并更新 usage
		audioFormat := "mp3" // 默认格式
		if audioReq, ok := info.Request.(*dto.AudioRequest); ok && audioReq.ResponseFormat != "" {
			audioFormat = audioReq.ResponseFormat
		}
		// 对话协议 TTS 的实际输出已被归一化到 mp3/wav，时长解析按实际格式计算。
		if common.GetContextKeyBool(c, constant.ContextKeyWorkspaceTTSChatUpstream) {
			audioFormat = chatTTSFormat(audioFormat)
		}

		var duration float64
		var durationErr error

		if audioFormat == "pcm" {
			// PCM 格式没有文件头，根据 OpenAI TTS 的 PCM 参数计算时长
			// 采样率: 24000 Hz, 位深度: 16-bit (2 bytes), 声道数: 1
			const sampleRate = 24000
			const bytesPerSample = 2
			const channels = 1
			duration = float64(len(bodyBytes)) / float64(sampleRate*bytesPerSample*channels)
		} else {
			ext := "." + audioFormat
			reader := bytes.NewReader(bodyBytes)
			duration, durationErr = common.GetAudioDuration(c.Request.Context(), reader, ext)
		}

		usage.PromptTokensDetails.TextTokens = usage.PromptTokens

		if durationErr != nil {
			logger.LogWarn(c, common.LogText("failed to get audio duration: %v", durationErr))
			// 如果无法获取时长，则设置保底的 CompletionTokens，根据body大小计算
			sizeInKB := float64(len(bodyBytes)) / 1000.0
			estimatedTokens := int(math.Ceil(sizeInKB)) // 粗略估算每KB约等于1 token
			usage.CompletionTokens = estimatedTokens
			usage.CompletionTokenDetails.AudioTokens = estimatedTokens
		} else if duration > 0 {
			// 计算 token: ceil(duration) / 60.0 * 1000，即每分钟 1000 tokens。
			// duration 解析自上游返回的音频元数据，饱和转换防止 int 回绕。
			completionTokens := common.QuotaRound(math.Ceil(duration) / 60.0 * 1000)
			usage.CompletionTokens = completionTokens
			usage.CompletionTokenDetails.AudioTokens = completionTokens
		}
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}

	return usage
}

func OpenaiSTTHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo, responseFormat string) (*types.NewAPIError, *dto.Usage) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError), nil
	}
	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	var responseData struct {
		Usage *dto.Usage `json:"usage"`
	}
	if err := common.Unmarshal(responseBody, &responseData); err == nil && responseData.Usage != nil {
		if responseData.Usage.TotalTokens > 0 {
			usage := responseData.Usage
			if usage.PromptTokens == 0 {
				usage.PromptTokens = usage.InputTokens
			}
			if usage.CompletionTokens == 0 {
				usage.CompletionTokens = usage.OutputTokens
			}
			return nil, usage
		}
	}

	usage := &dto.Usage{}
	usage.PromptTokens = info.GetEstimatePromptTokens()
	usage.CompletionTokens = 0
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return nil, usage
}
