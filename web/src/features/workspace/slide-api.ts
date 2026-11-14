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

/** 单张幻灯片：标题 + 自包含 HTML 页面。 */
export interface SlideItem {
  title: string
  html: string
}

export interface SlideLabConfig {
  enabled: boolean
  models: string[]
  points: number
  /** 后台配置的默认思考强度（空串表示跟随模型默认） */
  thinking_effort: string
  /** 思考强度可选档位（首项为空表示跟随模型默认） */
  thinking_effort_options: string[]
}

export interface SlideProjectSummary {
  id: number
  name: string
  created_at: number
  updated_at: number
}

export interface SlideMessage {
  id: number
  project_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export interface SlideProjectDetail {
  id: number
  name: string
  slides: SlideItem[]
  messages?: SlideMessage[]
}

export interface SlideProjectList {
  items: SlideProjectSummary[]
  total: number
  page: number
  page_size: number
}

export interface SlideSendResult {
  projectId: number
  content: string
  slides: SlideItem[]
}

/** 思考强度档位兼容两种后端返回形态：string[] 或 {value,label}[]。 */
function normalizeEffortOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['']
  const values = raw.map((item) =>
    typeof item === 'string'
      ? item
      : String((item as { value?: string })?.value ?? '')
  )
  return values.length > 0 ? values : ['']
}

/** 演示实验室可用模型与单次消耗点数。 */
export async function fetchSlideLabConfig(): Promise<SlideLabConfig> {
  const res = await api.get('/api/workspace/slide/config')
  const data = requireServerSuccess(res.data)?.data
  const fallback: SlideLabConfig = {
    enabled: false,
    models: [],
    points: 0,
    thinking_effort: '',
    thinking_effort_options: [''],
  }
  if (!data) return fallback
  return {
    enabled: Boolean(data.enabled),
    models: data.models ?? [],
    points: data.points ?? 0,
    thinking_effort: data.thinking_effort ?? '',
    thinking_effort_options: normalizeEffortOptions(
      data.thinking_effort_options
    ),
  }
}

/** 我的历史演示项目（分页 + 名称搜索，不含幻灯片内容）。 */
export async function fetchSlideProjects(input?: {
  page?: number
  pageSize?: number
  keyword?: string
}): Promise<SlideProjectList> {
  const res = await api.get('/api/workspace/slide/projects', {
    params: {
      page: input?.page ?? 1,
      page_size: input?.pageSize ?? 10,
      keyword: input?.keyword ?? '',
    },
  })
  const data = requireServerSuccess(res.data)?.data as
    | SlideProjectList
    | undefined
  return data ?? { items: [], total: 0, page: 1, page_size: 10 }
}

/** 重命名项目。同时兼容 name / title 两种后端字段。 */
export async function renameSlideProject(
  projectId: number,
  name: string
): Promise<void> {
  const res = await api.put(`/api/workspace/slide/projects/${projectId}`, {
    name,
    title: name,
  })
  requireServerSuccess(res.data)
}

/** 项目详情：幻灯片列表 + 对话历史，用于历史项目续写。 */
export async function fetchSlideProject(
  projectId: number
): Promise<SlideProjectDetail> {
  const res = await api.get(`/api/workspace/slide/projects/${projectId}`)
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('项目加载失败')
  // 兼容 {project:{...},messages} 与扁平 {id,name,slides,messages} 两种结构。
  const project = (data.project ?? data) as SlideProjectSummary & {
    slides?: SlideItem[]
    title?: string
  }
  return {
    id: project.id ?? projectId,
    name: project.name ?? project.title ?? '',
    slides: (project.slides ?? []) as SlideItem[],
    messages: (data.messages ?? []) as SlideMessage[],
  }
}

/**
 * 从模型回复中提取幻灯片 JSON 数组。
 * 优先解析 ```json 代码围栏，否则取文本中第一个平衡的 [...] 数组。
 * 与服务端 workspaceExtractSlides 的提取规则保持一致。
 */
export function extractSlides(content: string): SlideItem[] {
  const text = content.trim()
  if (!text) return []
  // 1) 代码围栏优先（```json 或 ```）。
  let rest = text
  while (true) {
    const start = rest.indexOf('```')
    if (start < 0) break
    const after = rest.slice(start + 3)
    const lineEnd = after.search(/\r?\n/)
    if (lineEnd < 0) break
    const body = after.slice(lineEnd + 1)
    const end = body.indexOf('```')
    if (end < 0) break
    const block = body.slice(0, end).trim()
    const parsed = parseSlideArray(block)
    if (parsed.length > 0) return parsed
    rest = body.slice(end + 3)
  }
  // 2) 文本中第一个平衡数组。
  const fallback = parseSlideArray(text)
  if (fallback.length > 0) return fallback
  // 3) 从首个 '[' 起逐个尝试到末尾 ']'（容忍数组前后的杂散字符）。
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) {
    return parseSlideArray(text.slice(first, last + 1))
  }
  return []
}

function parseSlideArray(raw: string): SlideItem[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items: SlideItem[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const html = String((entry as { html?: string }).html ?? '').trim()
      if (!html) continue
      items.push({
        title: String((entry as { title?: string }).title ?? '').trim(),
        html,
      })
    }
    return items
  } catch {
    return []
  }
}

/**
 * 发送一次演示文稿生成需求。
 * 服务端会追加系统提示词、携带历史对话与当前幻灯片，并返回模型原文，
 * 幻灯片 JSON 由前端 extractSlides 解析。
 */
export async function sendSlidePrompt(input: {
  model: string
  requirement: string
  projectId: number | null
  slides: SlideItem[]
  /** 思考强度（none/minimal/low/medium/high），空串表示跟随模型默认 */
  reasoningEffort?: string
}): Promise<SlideSendResult> {
  const res = await api.post(
    '/api/workspace/generate/slide',
    {
      model: input.model,
      messages: [{ role: 'user', content: input.requirement }],
      ...(input.reasoningEffort
        ? { reasoning_effort: input.reasoningEffort }
        : {}),
      workspace_slide: {
        project_id: input.projectId ?? 0,
        slides: input.slides ?? [],
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
    (res.headers?.['x-workspace-slide-project-id'] as string | undefined) ?? ''
  const projectId = Number.parseInt(headerValue, 10)
  return {
    projectId: Number.isFinite(projectId) ? projectId : (input.projectId ?? 0),
    content,
    slides: extractSlides(content),
  }
}
