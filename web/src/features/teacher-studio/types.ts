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

export type StudioRole = 'user' | 'assistant'

export interface StudioMessage {
  id: string
  role: StudioRole
  content: string
  reasoning?: string
  error?: string
  createdAt: number
  model?: string
}

export interface StudioConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StudioMessage[]
}

/**
 * 教师专业版的对话参数，字段对齐 HuggingFace chat-ui 的「生成参数」面板，
 * 比学生端只暴露温度要完整得多。
 */
export interface StudioSettings {
  model: string
  systemPrompt: string
  // 采样
  temperature: number
  topP: number
  topK: number
  // 长度与惩罚
  maxTokens: number
  repetitionPenalty: number
  frequencyPenalty: number
  presencePenalty: number
  // 随机与停止
  seed: number
  stop: string
}

export interface StudioStore {
  conversations: StudioConversation[]
  activeId: string
  settings: StudioSettings
}

export const STUDIO_DEFAULT_SYSTEM_PROMPT =
  '你是一位耐心、严谨的助教，帮助老师备课、出题、讲解知识点。回答要结构清晰，必要时分点说明。'

export const STUDIO_DEFAULT_SETTINGS: StudioSettings = {
  model: '',
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.95,
  topK: 0,
  repetitionPenalty: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: 0,
  stop: '',
  systemPrompt: STUDIO_DEFAULT_SYSTEM_PROMPT,
}

/** 参考 LibreChat / HuggingFace chat-ui 的预设档位。 */
export const TEMPERATURE_PRESETS = [0, 0.3, 0.7, 1] as const
export const TOP_P_PRESETS = [0.7, 0.9, 0.95, 1] as const
export const REPETITION_PENALTY_PRESETS = [1, 1.05, 1.1, 1.2] as const

/** 把「每行一个」的停止序列文本解析成数组。 */
export function parseStopSequences(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function createStudioId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createStudioConversation(): StudioConversation {
  const now = Date.now()
  return {
    id: createStudioId('conv'),
    title: '新的对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function deriveConversationTitle(text: string): string {
  const compact = text.replaceAll(/\s+/g, ' ').trim()
  if (!compact) return '新的对话'
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact
}
