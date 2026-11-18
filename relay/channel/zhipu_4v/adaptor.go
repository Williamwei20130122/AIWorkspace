package zhipu_4v

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	channelconstant "github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	result, err := service.ConvertRequest(c, info, types.RelayFormatOpenAI, request)
	if err != nil {
		return nil, err
	}
	openaiRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	return a.ConvertOpenAIRequest(c, info, openaiRequest)
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	claudeAdaptor := claude.Adaptor{}
	return claudeAdaptor.ConvertClaudeRequest(c, info, req)
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	info.ConvOptions().WebSearch = encodeWebSearch(info)
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	baseURL := info.ChannelBaseUrl
	if baseURL == "" {
		baseURL = channelconstant.GetChannelBaseURL(channelconstant.ChannelTypeZhipu_v4)
	}
	specialPlan, hasSpecialPlan := channelconstant.ChannelSpecialBases[baseURL]
	// 渠道可直接填智谱文档地址（已带 /api/paas/v4）。Claude/responses 分支的路径
	// 不在该前缀下，先剥掉前缀，保证与只填域名拼出完全相同的地址。
	bareBaseURL := strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/api/paas/v4")

	switch info.RelayFormat {
	case types.RelayFormatClaude:
		if hasSpecialPlan && specialPlan.ClaudeBaseURL != "" {
			return fmt.Sprintf("%s/v1/messages", specialPlan.ClaudeBaseURL), nil
		}
		return fmt.Sprintf("%s/api/anthropic/v1/messages", bareBaseURL), nil
	default:
		switch info.RelayMode {
		case relayconstant.RelayModeEmbeddings:
			if hasSpecialPlan && specialPlan.OpenAIBaseURL != "" {
				return fmt.Sprintf("%s/embeddings", specialPlan.OpenAIBaseURL), nil
			}
			return fmt.Sprintf("%s/embeddings", channelconstant.ZhipuV4BaseURL(baseURL)), nil
		case relayconstant.RelayModeImagesGenerations:
			if hasSpecialPlan && specialPlan.OpenAIBaseURL != "" {
				return fmt.Sprintf("%s/images/generations", specialPlan.OpenAIBaseURL), nil
			}
			return fmt.Sprintf("%s/images/generations", channelconstant.ZhipuV4BaseURL(baseURL)), nil
		case relayconstant.RelayModeResponses:
			return fmt.Sprintf("%s/api/v1/responses", bareBaseURL), nil
		default:
			if hasSpecialPlan && specialPlan.OpenAIBaseURL != "" {
				return fmt.Sprintf("%s/chat/completions", specialPlan.OpenAIBaseURL), nil
			}
			return fmt.Sprintf("%s/chat/completions", channelconstant.ZhipuV4BaseURL(baseURL)), nil
		}
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if lo.FromPtrOr(request.TopP, 0) >= 1 {
		request.TopP = lo.ToPtr(0.99)
	}
	return requestOpenAI2Zhipu(*request), nil
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		adaptor := claude.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	default:
		if info.RelayMode == relayconstant.RelayModeImagesGenerations {
			return zhipu4vImageHandler(c, resp, info)
		}
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
