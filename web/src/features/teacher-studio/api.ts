/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { SSE } from 'sse.js'

import { getFreshAuthHeaders } from '@/lib/api'

import { parseStopSequences, type StudioMessage, type StudioSettings } from './types'

/** 中台文生文入口：内部会按能力配置改写成 /v1/chat/completions。 */
const CHAT_ENDPOINT = '/api/workspace/generate/text'

const DONE_SENTINEL = '[DONE]'
const FALLBACK_ERROR = '生成失败，请稍后重试'

/** sse.js 的 CLOSED 状态值。 */
const SSE_CLOSED = 2
/** XMLHttpRequest.DONE */
const XHR_DONE = 4

interface SseSource {
  addEventListener: (
    type: string,
    listener: (event: MessageEvent<string> & { readyState?: number }) => void
  ) => void
  close: () => void
  xhr: XMLHttpRequest | null
}

export interface ChatStreamHandle {
  close: () => void
}

export interface ChatStreamCallbacks {
  onDelta: (chunk: string, kind: 'content' | 'reasoning') => void
  onDone: () => void
  onError: (message: string) => void
}

function buildMessages(
  messages: StudioMessage[],
  settings: StudioSettings
): { role: string; content: string }[] {
  const history = messages
    .filter((message) => !message.error && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content }))

  const systemPrompt = settings.systemPrompt.trim()
  return systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...history]
    : history
}

function resolveStreamErrorMessage(data: unknown): string {
  if (typeof data !== 'string' || !data.trim()) return FALLBACK_ERROR
  try {
    const parsed = JSON.parse(data) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message ?? parsed.message ?? data
  } catch {
    return data
  }
}

/**
 * 以 SSE 方式请求中台文生文能力。
 * 交互形式参考 LibreChat / HuggingFace chat-ui：逐字增量推送 + 可中断。
 */
export function startChatStream(
  messages: StudioMessage[],
  settings: StudioSettings,
  callbacks: ChatStreamCallbacks
): ChatStreamHandle {
  let source: SseSource | undefined
  let closed = false

  void (async () => {
    let headers: Record<string, string>
    try {
      headers = await getFreshAuthHeaders()
    } catch (error) {
      if (closed) return
      callbacks.onError(
        error instanceof Error ? error.message : '发起请求失败，请重新登录后再试'
      )
      return
    }
    if (closed) return

    // 参数对齐 HuggingFace chat-ui 的生成参数；取默认值的项不发送，交给上游默认。
    const stopSequences = parseStopSequences(settings.stop)
    const payload = {
      messages: buildMessages(messages, settings),
      temperature: settings.temperature,
      ...(settings.maxTokens > 0 ? { max_tokens: settings.maxTokens } : {}),
      ...(settings.topP < 1 ? { top_p: settings.topP } : {}),
      ...(settings.topK > 0 ? { top_k: settings.topK } : {}),
      ...(settings.repetitionPenalty !== 1
        ? { repetition_penalty: settings.repetitionPenalty }
        : {}),
      ...(settings.frequencyPenalty
        ? { frequency_penalty: settings.frequencyPenalty }
        : {}),
      ...(settings.presencePenalty
        ? { presence_penalty: settings.presencePenalty }
        : {}),
      ...(settings.seed > 0 ? { seed: settings.seed } : {}),
      ...(stopSequences.length > 0 ? { stop: stopSequences } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      stream: true,
    }

    const next = new SSE(CHAT_ENDPOINT, {
      headers,
      method: 'POST',
      payload: JSON.stringify(payload),
    }) as unknown as SseSource

    source = next
    let settled = false
    let received = false

    // 中台的业务失败（如额度不足、能力停用）是 HTTP 200 + JSON 体，不带 `data:` 分帧，
    // sse.js 会直接忽略并静默关闭连接。这里在 XHR 完成时兜底读取响应体，避免界面一直停在思考态。
    const rawXhr = next.xhr
    rawXhr?.addEventListener('readystatechange', () => {
      if (closed || settled || rawXhr.readyState !== XHR_DONE) return
      const text = rawXhr.responseText
      if (!text || !text.trim() || text.includes('data:')) return
      settled = true
      callbacks.onError(resolveStreamErrorMessage(text))
      try {
        next.close()
      } catch {
        // 关闭失败无需处理
      }
    })

    next.addEventListener('message', (event) => {
      if (closed || settled) return
      const data = event.data ?? ''
      if (data === DONE_SENTINEL) {
        settled = true
        next.close()
        callbacks.onDone()
        return
      }
      try {
        const chunk = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string
              reasoning?: string
              reasoning_content?: string
            }
          }[]
        }
        const delta = chunk.choices?.[0]?.delta
        if (!delta) return
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (reasoning) {
          received = true
          callbacks.onDelta(reasoning, 'reasoning')
        }
        if (delta.content) {
          received = true
          callbacks.onDelta(delta.content, 'content')
        }
      } catch {
        // 心跳帧或非 JSON 分片直接忽略
      }
    })

    next.addEventListener('error', (event) => {
      if (closed || settled) return
      settled = true
      callbacks.onError(resolveStreamErrorMessage(event.data))
      try {
        next.close()
      } catch {
        // 关闭失败无需处理
      }
    })

    // 连接关闭但没有 [DONE] 且未收到任何内容时，给出明确失败提示，避免无限等待。
    next.addEventListener('readystatechange', (event) => {
      if (closed || settled || event.readyState !== SSE_CLOSED) return
      settled = true
      if (received) {
        callbacks.onDone()
        return
      }
      callbacks.onError(FALLBACK_ERROR)
    })
  })()

  return {
    close: () => {
      closed = true
      try {
        source?.close()
      } catch {
        // 关闭失败无需处理
      }
    },
  }
}
