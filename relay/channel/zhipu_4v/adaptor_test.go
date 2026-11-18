package zhipu_4v

import (
	"testing"

	channelconstant "github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLZhipuV4Base(t *testing.T) {
	tests := []struct {
		name        string
		baseURL     string
		relayMode   int
		relayFormat types.RelayFormat
		want        string
	}{
		{
			name:      "chat with plain domain",
			baseURL:   "https://open.bigmodel.cn",
			relayMode: relayconstant.RelayModeChatCompletions,
			want:      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		},
		{
			name:      "chat with docs address",
			baseURL:   "https://open.bigmodel.cn/api/paas/v4",
			relayMode: relayconstant.RelayModeChatCompletions,
			want:      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		},
		{
			name:      "chat with docs address and trailing slash",
			baseURL:   "https://open.bigmodel.cn/api/paas/v4/",
			relayMode: relayconstant.RelayModeChatCompletions,
			want:      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		},
		{
			name:      "chat with empty base falls back to channel default",
			baseURL:   "",
			relayMode: relayconstant.RelayModeChatCompletions,
			want: channelconstant.GetChannelBaseURL(channelconstant.ChannelTypeZhipu_v4) +
				"/api/paas/v4/chat/completions",
		},
		{
			name:      "embeddings with docs address",
			baseURL:   "https://open.bigmodel.cn/api/paas/v4",
			relayMode: relayconstant.RelayModeEmbeddings,
			want:      "https://open.bigmodel.cn/api/paas/v4/embeddings",
		},
		{
			name:      "images with docs address",
			baseURL:   "https://open.bigmodel.cn/api/paas/v4",
			relayMode: relayconstant.RelayModeImagesGenerations,
			want:      "https://open.bigmodel.cn/api/paas/v4/images/generations",
		},
		{
			name:      "special plan uses coding base",
			baseURL:   "glm-coding-plan",
			relayMode: relayconstant.RelayModeChatCompletions,
			want:      "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
		},
		{
			name:        "claude format with plain domain",
			baseURL:     "https://open.bigmodel.cn",
			relayFormat: types.RelayFormatClaude,
			want:        "https://open.bigmodel.cn/api/anthropic/v1/messages",
		},
		{
			name:        "claude format with docs address",
			baseURL:     "https://open.bigmodel.cn/api/paas/v4",
			relayFormat: types.RelayFormatClaude,
			want:        "https://open.bigmodel.cn/api/anthropic/v1/messages",
		},
		{
			name:        "claude format with international special plan",
			baseURL:     "glm-coding-plan-international",
			relayFormat: types.RelayFormatClaude,
			want:        "https://api.z.ai/api/anthropic/v1/messages",
		},
		{
			name:      "responses with docs address",
			baseURL:   "https://open.bigmodel.cn/api/paas/v4",
			relayMode: relayconstant.RelayModeResponses,
			want:      "https://open.bigmodel.cn/api/v1/responses",
		},
	}
	adaptor := &Adaptor{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayMode:   tt.relayMode,
				RelayFormat: tt.relayFormat,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: tt.baseURL},
			}
			got, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
