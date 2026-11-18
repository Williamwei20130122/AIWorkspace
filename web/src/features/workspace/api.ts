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

import type {
  WorkspaceCapability,
  WorkspaceCapabilityKind,
  WorkspaceClassSession,
  WorkspaceClassSessionTask,
  WorkspaceTask,
  WorkspaceTaskSubmission,
} from './types'

export interface WorkspaceCapabilitiesResult {
  capabilities: WorkspaceCapability[]
  // ai_enabled 当前账号（学生）所在小班的 AI 权限总开关：
  // false 时学生端隐藏全部 AI 生成入口（历史记录与账户页仍可见）。
  ai_enabled: boolean
  // html_enabled 所在小班的 HTML 实验室开关（默认关闭）。
  html_enabled: boolean
  // slide_enabled 所在小班的演示实验室开关（默认关闭）。
  slide_enabled: boolean
}

export async function fetchWorkspaceCapabilities(): Promise<WorkspaceCapabilitiesResult> {
  const res = await api.get('/api/workspace/capabilities')
  const data = requireServerSuccess(res.data)?.data
  if (Array.isArray(data)) {
    // 兼容旧结构（直接返回能力数组）。
    return {
      capabilities: data,
      ai_enabled: true,
      html_enabled: true,
      slide_enabled: true,
    }
  }
  return {
    capabilities: data?.capabilities ?? [],
    ai_enabled: data?.ai_enabled ?? true,
    html_enabled: data?.html_enabled ?? true,
    slide_enabled: data?.slide_enabled ?? true,
  }
}

export interface WorkspacePoints {
  quota: number
  used_quota: number
  used_yuan: number
  // 教师教学钱包余额（管理员发放，可自由使用且不占用 API 额度）。
  wallet_balance: number
  // 账户 API 额度（可用余额）。
  api_quota: number
  is_teacher: boolean
}

export async function fetchWorkspacePoints(): Promise<WorkspacePoints> {
  const res = await api.get('/api/workspace/points')
  return (
    requireServerSuccess(res.data)?.data ?? {
      quota: 0,
      used_quota: 0,
      used_yuan: 0,
      wallet_balance: 0,
      api_quota: 0,
      is_teacher: false,
    }
  )
}

export interface WorkspaceStudentProfile {
  student_id: number
  display_name: string
  student_no: string
  username: string
  pinyin_username: string
  // password_set 为 true 表示已设置登录密码，登录时必须输入密码。
  password_set: boolean
  class: {
    class_id?: number
    class_name?: string
    grade_name?: string
  }
}

export async function fetchWorkspaceStudentProfile(): Promise<WorkspaceStudentProfile> {
  const res = await api.get('/api/workspace/student/profile')
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('账户信息加载失败')
  return data as WorkspaceStudentProfile
}

/** 学生自助设置登录密码；已设置过密码时必须传原密码。 */
export async function updateWorkspaceStudentPassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const res = await api.post(
    '/api/workspace/student/password',
    { old_password: oldPassword, new_password: newPassword },
    { skipErrorHandler: true }
  )
  requireServerSuccess(res.data)
}

/** 学生自助保存界面主题偏好（story/juice/cloud/quest，存入账户设置）。 */
export async function updateWorkspaceTheme(theme: string): Promise<void> {
  const res = await api.put(
    '/api/user/self',
    { workspace_theme: theme },
    { skipErrorHandler: true }
  )
  requireServerSuccess(res.data)
}

export interface GenerateOutcome {
  kind: WorkspaceCapabilityKind
  text?: string
  mediaUrl?: string
  /** 一次生成多张图片时的全部结果，用于逐张单独提交课堂任务。 */
  mediaUrls?: string[]
  taskId?: string
  /** TTS 等二进制产物的原始 Blob：blob: 地址无法被教师端打开，提交前据此转 data: URL。 */
  mediaBlob?: Blob
  raw?: unknown
}

/** 参考素材上传结果：url 为受鉴权的内容接口地址。 */
export interface WorkspaceUploadResult {
  id: number
  kind: string
  storage_path: string
  url: string
  size_bytes: number
  mime_type: string
}

/** 上传参考图到本地磁盘（图生图源图 / 视频参考图），返回可被生成请求引用的地址。 */
export async function uploadWorkspaceAsset(
  file: File
): Promise<WorkspaceUploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post('/api/workspace/uploads', form, {
    skipErrorHandler: true,
  })
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('参考图上传失败')
  return data as WorkspaceUploadResult
}

export interface WorkspaceGenerateParams {
  // —— 基础参数（学生与教师均可配置）——
  temperature: number
  size: string
  count: number
  style: string
  strength: number
  videoMode: string
  duration: string
  resolution: string
  // 视频参考图：已上传到对象存储的地址，按模式取 1 张（image）或 2 张（images）。
  videoReferences: string[]
  voice: string
  speed: number
  musicTitle: string
  instrumental: boolean
  model: string
  // —— 进阶参数（仅教师可见；留空/等于默认值时不发送）——
  systemPrompt: string
  topP: number
  topK: number
  maxTokens: number
  repetitionPenalty: number
  frequencyPenalty: number
  presencePenalty: number
  seed: number
  stop: string
  quality: string
  imageStyle: string
  responseFormat: string
  negativePrompt: string
  aspectRatio: string
  cfgScale: number
  musicVersion: string
  musicDescription: string
  ttsFormat: string
  ttsInstructions: string
}

function withStyle(input: string, style: string): string {
  const trimmed = style.trim()
  return trimmed ? `${input}\n风格要求：${trimmed}` : input
}

/** 提取一次生成返回的全部图片地址（url 或 b64），用于多图逐张提交。 */
function pickImageUrls(data: unknown): string[] {
  const list = (data as { data?: { url?: string; b64_json?: string }[] })?.data
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      if (item.url) return item.url
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      return ''
    })
    .filter(Boolean)
}

export async function runWorkspaceGenerate(
  capability: WorkspaceCapability,
  input: string,
  params: WorkspaceGenerateParams,
  imageFile?: File
): Promise<GenerateOutcome> {
  if (capability.kind === 'edit') {
    const form = new FormData()
    form.append('prompt', withStyle(input, params.style))
    form.append('strength', String(params.strength))
    if (imageFile) form.append('image', imageFile)
    if (params.model) form.append('model', params.model)
    // 图生图走 multipart，上游适配器会把全部非文件表单字段原样透传，故进阶项可直达上游。
    if (params.negativePrompt.trim()) {
      form.append('negative_prompt', params.negativePrompt.trim())
    }
    if (params.seed > 0) form.append('seed', String(params.seed))
    if (params.quality) form.append('quality', params.quality)
    if (params.responseFormat) {
      form.append('response_format', params.responseFormat)
    }
    const res = await api.post(capability.path, form, {
      skipErrorHandler: true,
    })
    const urls = pickImageUrls(res.data)
    return {
      kind: capability.kind,
      mediaUrl: urls[0],
      mediaUrls: urls,
      raw: res.data,
    }
  }

  const payload = buildPayload(capability.kind, input, params)
  if (capability.kind === 'tts') {
    const res = await api.post(capability.path, payload, {
      responseType: 'blob',
      skipErrorHandler: true,
    })
    const blob = res.data as Blob
    return {
      kind: capability.kind,
      mediaUrl: URL.createObjectURL(blob),
      mediaBlob: blob,
    }
  }

  const res = await api.post(capability.path, payload, {
    skipErrorHandler: true,
  })
  const data = res.data

  if (capability.kind === 'text') {
    const choices = (data as { choices?: { message?: { content?: string } }[] })
      ?.choices
    return {
      kind: capability.kind,
      text: choices?.[0]?.message?.content ?? '',
      raw: data,
    }
  }
  if (capability.kind === 'image') {
    const urls = pickImageUrls(data)
    return {
      kind: capability.kind,
      mediaUrl: urls[0],
      mediaUrls: urls,
      raw: data,
    }
  }
  const taskId =
    (data as { task_id?: string; id?: string })?.task_id ??
    (data as { id?: string })?.id
  return { kind: capability.kind, taskId, raw: data }
}

function buildPayload(
  kind: WorkspaceCapabilityKind,
  input: string,
  params: WorkspaceGenerateParams
): Record<string, unknown> {
  const model = params.model ? { model: params.model } : {}
  switch (kind) {
    case 'text': {
      // 系统提示词以 system 消息下发，其余进阶项仅在偏离默认值时才发送，
      // 避免把不同厂商的默认行为覆盖掉。
      const messages: { role: string; content: string }[] = []
      if (params.systemPrompt.trim()) {
        messages.push({ role: 'system', content: params.systemPrompt.trim() })
      }
      messages.push({ role: 'user', content: input })
      const stop = parseStopLines(params.stop)
      return {
        messages,
        temperature: params.temperature,
        ...(params.topP !== 1 ? { top_p: params.topP } : {}),
        ...(params.topK > 0 ? { top_k: params.topK } : {}),
        ...(params.maxTokens > 0 ? { max_tokens: params.maxTokens } : {}),
        ...(params.repetitionPenalty !== 1
          ? { repetition_penalty: params.repetitionPenalty }
          : {}),
        ...(params.frequencyPenalty !== 0
          ? { frequency_penalty: params.frequencyPenalty }
          : {}),
        ...(params.presencePenalty !== 0
          ? { presence_penalty: params.presencePenalty }
          : {}),
        ...(params.seed > 0 ? { seed: params.seed } : {}),
        ...(stop.length > 0 ? { stop } : {}),
        ...model,
      }
    }
    case 'image':
      return {
        prompt: withStyle(input, params.style),
        size: params.size,
        n: params.count,
        ...(params.quality ? { quality: params.quality } : {}),
        ...(params.imageStyle ? { style: params.imageStyle } : {}),
        ...(params.responseFormat
          ? { response_format: params.responseFormat }
          : {}),
        ...model,
      }
    case 'tts':
      return {
        input,
        voice: params.voice,
        speed: params.speed,
        ...(params.ttsFormat ? { response_format: params.ttsFormat } : {}),
        ...(params.ttsInstructions.trim()
          ? { instructions: params.ttsInstructions.trim() }
          : {}),
        ...model,
      }
    case 'video': {
      // 视频走任务插件，顶层只保留任务结构体声明的字段；
      // 分辨率/画面比例/提示词强度须放进 metadata 交由插件读取。
      const metadata: Record<string, unknown> = {}
      if (params.resolution) metadata.resolution = params.resolution
      if (params.aspectRatio) metadata.aspect_ratio = params.aspectRatio
      if (params.cfgScale > 0) metadata.cfg_scale = params.cfgScale
      // 参考图（已先上传到对象存储）：单张用 image，首尾帧等多张用 images。
      const references = (params.videoReferences ?? []).filter(Boolean)
      return {
        prompt: withStyle(input, params.style),
        mode: params.videoMode,
        duration: Number(params.duration),
        ...(references.length === 1 ? { image: references[0] } : {}),
        ...(references.length > 1 ? { images: references } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...model,
      }
    }
    case 'music':
      return {
        prompt: input,
        ...(params.style ? { tags: params.style } : {}),
        ...(params.musicTitle ? { title: params.musicTitle } : {}),
        make_instrumental: params.instrumental,
        ...(params.musicVersion ? { mv: params.musicVersion } : {}),
        ...(params.musicDescription.trim()
          ? { gpt_description_prompt: params.musicDescription.trim() }
          : {}),
        ...model,
      }
    default:
      return { prompt: input, ...model }
  }
}

/** 把「每行一条」的停止序列文本解析成数组。 */
function parseStopLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function fetchWorkspaceTask(
  qpath: string,
  taskId: string
): Promise<WorkspaceTask | undefined> {
  const res = await api.get(`${qpath}/${taskId}`, { skipErrorHandler: true })
  // 任务查询接口直接返回任务对象（无 success/data 包装）；
  // 同时兼容可能存在的包装形态，避免取到 undefined 导致轮询永不更新。
  const payload = requireServerSuccess(res.data)
  return (payload?.data ?? payload) as WorkspaceTask | undefined
}

/** 任务产物（视频 / 音乐等异步任务完成后生成的可预览、可下载文件）。 */
export interface WorkspaceTaskArtifact {
  key: string
  /** image / video / audio 等分类。 */
  type: string
  mime_type?: string
  /** 受鉴权的绝对内容地址，可直接用于播放、下载与提交。 */
  content_url: string
}

export interface WorkspaceTaskArtifactsResult {
  task_id?: string
  artifacts: WorkspaceTaskArtifact[]
  /** 部分旧任务的兜底视频地址。 */
  legacy_content_url?: string
}

/** 拉取异步任务（视频 / 音乐）完成后的产物列表。 */
export async function fetchWorkspaceTaskArtifacts(
  qpath: string,
  taskId: string
): Promise<WorkspaceTaskArtifactsResult> {
  const res = await api.get(`${qpath}/${taskId}/artifacts`, {
    skipErrorHandler: true,
  })
  // 该接口直接返回 {task_id, artifacts}（无 success/data 包装），同时兼容包装形态。
  const payload = requireServerSuccess(res.data)
  const data = payload?.data ?? payload
  return {
    artifacts: Array.isArray(data?.artifacts) ? data.artifacts : [],
    legacy_content_url: data?.legacy_content_url,
    task_id: data?.task_id,
  }
}

/** 学生当前课堂会话与分项任务（含本人历史提交）。 */
export interface WorkspaceClassSessionBundle {
  session: WorkspaceClassSession | null
  tasks: WorkspaceClassSessionTask[]
}

export async function fetchMyClassSession(): Promise<WorkspaceClassSessionBundle> {
  const res = await api.get('/api/workspace/class-session', {
    skipErrorHandler: true,
  })
  const data = requireServerSuccess(res.data)?.data
  return {
    session: (data?.session ?? null) as WorkspaceClassSession | null,
    tasks: (data?.tasks ?? []) as WorkspaceClassSessionTask[],
  }
}

export interface TaskSubmissionInput {
  task_id: number
  content_type: 'text' | 'file' | 'ai'
  text?: string
  asset_url?: string
  capability?: string
  prompt?: string
  /** AI 生成的参数快照（JSON 字符串），供教师端详情还原。 */
  params?: string
  result_text?: string
}

/** 提交文字 / AI 作品类任务产出。 */
export async function createTaskSubmission(
  input: TaskSubmissionInput
): Promise<WorkspaceTaskSubmission> {
  const res = await api.post(
    '/api/workspace/class-session/submissions',
    input,
    {
      skipErrorHandler: true,
    }
  )
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('提交失败')
  return data as WorkspaceTaskSubmission
}

/** 上传文件类任务产出（本地磁盘存储，大小上限 200MB）。 */
export async function uploadTaskSubmissionFile(
  taskId: number,
  file: File
): Promise<WorkspaceTaskSubmission> {
  const form = new FormData()
  form.append('task_id', String(taskId))
  form.append('file', file)
  const res = await api.post(
    '/api/workspace/class-session/submissions/file',
    form,
    { skipErrorHandler: true }
  )
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('提交失败')
  return data as WorkspaceTaskSubmission
}
