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
import { api } from '@/lib/http-client'
import { requireServerSuccess } from '@/lib/server-error-message'

export interface HtmlLabConfig {
  enabled: boolean
  models: string[]
  points: number
  /** 后台配置的默认思考强度（空串表示跟随模型默认） */
  thinking_effort: string
  /** 思考强度可选档位（首项为空表示跟随模型默认） */
  thinking_effort_options: string[]
}

export interface HtmlProjectSummary {
  id: number
  title: string
  created_at: number
  updated_at: number
}

export interface HtmlMessage {
  id: number
  project_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export interface HtmlProjectDetail {
  project: HtmlProjectSummary & { code: string }
  messages: HtmlMessage[]
}

export interface HtmlProjectList {
  items: HtmlProjectSummary[]
  total: number
  page: number
  page_size: number
}

export interface HtmlSendResult {
  projectId: number
  content: string
  code: string
}

/** HTML 实验室可用模型与单次消耗点数。 */
export async function fetchHtmlLabConfig(): Promise<HtmlLabConfig> {
  const res = await api.get('/api/workspace/html/config')
  const data = requireServerSuccess(res.data)?.data
  return (data ?? {
    enabled: false,
    models: [],
    points: 0,
    thinking_effort: '',
    thinking_effort_options: [''],
  }) as HtmlLabConfig
}

/** 我的历史项目（分页 + 标题搜索，不含源码）。 */
export async function fetchHtmlProjects(input?: {
  page?: number
  pageSize?: number
  keyword?: string
}): Promise<HtmlProjectList> {
  const res = await api.get('/api/workspace/html/projects', {
    params: {
      page: input?.page ?? 1,
      page_size: input?.pageSize ?? 10,
      keyword: input?.keyword ?? '',
    },
  })
  const data = requireServerSuccess(res.data)?.data as
    | HtmlProjectList
    | undefined
  return data ?? { items: [], total: 0, page: 1, page_size: 10 }
}

/** 重命名项目标题。 */
export async function renameHtmlProject(
  projectId: number,
  title: string
): Promise<void> {
  const res = await api.put(`/api/workspace/html/projects/${projectId}`, {
    title,
  })
  requireServerSuccess(res.data)
}

/** 项目详情：源码 + 对话历史，用于历史项目续写。 */
export async function fetchHtmlProject(
  projectId: number
): Promise<HtmlProjectDetail> {
  const res = await api.get(`/api/workspace/html/projects/${projectId}`)
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('项目加载失败')
  return data as HtmlProjectDetail
}

/** 从模型回复中提取完整 HTML（与服务端提取规则保持一致）。 */
export function extractHtmlCode(content: string): string {
  const text = content.trim()
  if (!text) return ''
  let rest = text
  while (true) {
    const start = rest.indexOf('```')
    if (start < 0) break
    const after = rest.slice(start + 3)
    const lineEnd = after.search(/\r?\n/)
    if (lineEnd < 0) break
    const lang = after.slice(0, lineEnd).trim().toLowerCase()
    const body = after.slice(lineEnd + 1)
    const end = body.indexOf('```')
    if (end < 0) break
    const block = body.slice(0, end)
    const lower = block.toLowerCase()
    if (
      lang.startsWith('html') ||
      lang.startsWith('xhtml') ||
      (lang === '' && (lower.includes('<html') || lower.includes('<!doctype')))
    ) {
      return block.trim()
    }
    rest = body.slice(end + 3)
  }
  const lower = text.toLowerCase()
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return text
  }
  return ''
}

/**
 * 发送一次编程需求。
 * 服务端会追加系统提示词、携带历史对话与当前源码，并返回完整 HTML 代码块。
 */
export async function sendHtmlPrompt(input: {
  model: string
  requirement: string
  projectId: number | null
  code: string
  /** 思考强度（none/minimal/low/medium/high），空串表示跟随模型默认 */
  reasoningEffort?: string
}): Promise<HtmlSendResult> {
  const res = await api.post(
    '/api/workspace/generate/html',
    {
      model: input.model,
      messages: [{ role: 'user', content: input.requirement }],
      ...(input.reasoningEffort
        ? { reasoning_effort: input.reasoningEffort }
        : {}),
      workspace_html: {
        project_id: input.projectId ?? 0,
        code: input.code,
      },
      stream: false,
    },
    { skipErrorHandler: true }
  )
  const payload = res.data as {
    success?: boolean
    message?: string
    choices?: { message?: { content?: string } }[]
  }
  if (payload?.success === false) {
    throw new Error(payload.message || '生成失败')
  }
  const content = payload?.choices?.[0]?.message?.content ?? ''
  const headerValue =
    (res.headers?.['x-workspace-html-project-id'] as string | undefined) ?? ''
  const projectId = Number.parseInt(headerValue, 10)
  return {
    projectId: Number.isFinite(projectId) ? projectId : (input.projectId ?? 0),
    content,
    code: extractHtmlCode(content),
  }
}
