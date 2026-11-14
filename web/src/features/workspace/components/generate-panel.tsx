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
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'

import { CustomSelect } from '@/components/ui/native-select'
import { Markdown } from '@/components/ui/markdown'
import {
  AudioPlayer,
  VideoPlayer,
  downloadMediaFile,
  downloadTextFile,
  withExtension,
} from '@/components/ui/media-player'
import {
  createTaskSubmission,
  fetchWorkspaceTask,
  fetchWorkspaceTaskArtifacts,
  runWorkspaceGenerate,
  uploadWorkspaceAsset,
  type GenerateOutcome,
  type WorkspaceGenerateParams,
  type WorkspaceTaskArtifact,
} from '@/features/workspace/api'
import type {
  WorkspaceCapability,
  WorkspaceClassSessionTask,
  WorkspaceTask,
} from '@/features/workspace/types'
import { cn } from '@/lib/utils'

interface GeneratePanelProps {
  capability: WorkspaceCapability
  icon: ReactNode
  /** 教师专业版：在基础参数之外展开进阶参数。 */
  advanced?: boolean
  /** 当前课堂课时中允许提交 AI 作品的任务。 */
  sessionTasks?: WorkspaceClassSessionTask[]
  /** AI 作品提交成功后刷新右侧课堂任务面板。 */
  onTaskSubmitted?: () => void
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: { message?: string }
      message?: string
    }
  }
}

const VIDEO_MODES: { id: string; label: string; hint: string }[] = [
  { id: 'text', label: '文生视频', hint: '只有文字描述生成视频' },
  { id: 'img2img', label: '图生视频', hint: '上传一张参考图，结合文字描述生成视频' },
  { id: 'frames', label: '首尾帧生视频', hint: '上传首尾帧图片，生成过渡视频' },
  { id: 'subject', label: '主体参考', hint: '上传主体图片，视频中将保持主体一致' },
]

/** 每种视频模式需要的参考图数量：0 表示纯文字，1 单图，2 首尾帧。 */
const VIDEO_REFERENCE_COUNT: Record<string, number> = {
  text: 0,
  img2img: 1,
  frames: 2,
  subject: 1,
}

const IMAGE_SIZES = [
  { value: '1024x1024', label: '1024×1024 方图' },
  { value: '1024x1792', label: '1024×1792 竖图' },
  { value: '1792x1024', label: '1792×1024 横图' },
]

const FIELD_CLASS =
  'h-[42px] w-full rounded-[10px] border border-[#e4e2f2] bg-white px-3.5 text-[13.5px] text-[#1c1b31] outline-none transition-[border-color,box-shadow] placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'

const LABEL_CLASS =
  'mb-1.5 block text-[13px] font-semibold tracking-[-.01em] text-[#3a3954]'

const SELECT_CLASS = cn(FIELD_CLASS, 'cursor-pointer')

const ADVANCED_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-3'
const ADVANCED_GRID_2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2'

/** 进阶参数里的数字输入：留空/0 表示沿用上游默认值。 */
function NumberField(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  hint?: string
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type='number'
        className={cn(FIELD_CLASS, 'tabular-nums')}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      {props.hint && (
        <span className='mt-1.5 block text-[11px] text-[#a3a2b8]'>
          {props.hint}
        </span>
      )}
    </div>
  )
}

function resolveErrorMessage(error: unknown): string {
  const shape = error as ApiErrorShape
  return (
    shape?.response?.data?.error?.message ??
    shape?.response?.data?.message ??
    '生成失败，请稍后重试'
  )
}

/** Blob 转 data: URL：blob: 地址教师端无法打开，提交前必须转换。 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function defaultParams(capability: WorkspaceCapability): WorkspaceGenerateParams {
  return {
    temperature: 0.7,
    size: '1024x1024',
    count: 1,
    style: '',
    strength: 0.6,
    videoMode: 'text',
    duration: '6',
    resolution: '720P',
    videoReferences: [],
    voice: 'alloy',
    speed: 1,
    musicTitle: '',
    instrumental: false,
    model: capability.model || capability.models?.[0] || '',
    systemPrompt: '',
    topP: 1,
    topK: 0,
    maxTokens: 0,
    repetitionPenalty: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    seed: 0,
    stop: '',
    quality: '',
    imageStyle: '',
    responseFormat: '',
    negativePrompt: '',
    aspectRatio: '',
    cfgScale: 0,
    musicVersion: '',
    musicDescription: '',
    ttsFormat: '',
    ttsInstructions: '',
  }
}

const SECTION_CLASS = 'mb-4'

export function GeneratePanel(props: GeneratePanelProps) {
  const { t } = useTranslation()
  const capability = props.capability
  const [input, setInput] = useState('')
  const [params, setParams] = useState<WorkspaceGenerateParams>(() =>
    defaultParams(capability)
  )
  const [imageFile, setImageFile] = useState<File | undefined>(undefined)
  const [running, setRunning] = useState(false)
  // 生成耗时：按钮上实时累计的已生成秒数，用于给等待中的用户以反馈。
  const [elapsed, setElapsed] = useState(0)
  const [outcome, setOutcome] = useState<GenerateOutcome | null>(null)
  const [task, setTask] = useState<WorkspaceTask | undefined>(undefined)
  // 异步任务（视频 / 音乐）成功后拉取的产物列表，用于预览、下载与提交。
  const [taskArtifacts, setTaskArtifacts] = useState<WorkspaceTaskArtifact[]>([])
  const [legacyContentUrl, setLegacyContentUrl] = useState('')
  const [error, setError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  // AI 作品提交到课堂任务：任务下拉与提交状态。
  const [submitTaskId, setSubmitTaskId] = useState('')
  const [submittingTask, setSubmittingTask] = useState(false)

  const aiTasks = (props.sessionTasks ?? []).filter((item) =>
    item.output_forms
      .split(',')
      .map((form) => form.trim())
      .includes('ai')
  )
  const selectedTaskId =
    submitTaskId || (aiTasks.length > 0 ? String(aiTasks[0].id) : '')

  const handleSubmitAi = async (payload: {
    asset_url?: string
    result_text?: string
  }) => {
    if (!selectedTaskId) {
      toast.error(t('当前课时没有可提交 AI 作品的任务'))
      return
    }
    setSubmittingTask(true)
    try {
      await createTaskSubmission({
        task_id: Number(selectedTaskId),
        content_type: 'ai',
        capability: capability.kind,
        prompt: input.slice(0, 1000),
        // 生成参数快照：随提交落库，供教师端「AI 作品详情」还原本次生成配置。
        params: JSON.stringify(params),
        ...payload,
      })
      toast.success(t('AI 作品已提交'))
      props.onTaskSubmitted?.()
    } catch (err) {
      toast.error(resolveErrorMessage(err))
    } finally {
      setSubmittingTask(false)
    }
  }

  // TTS 产物提交：blob: 地址教师端打不开，先转成 data: URL 落盘提交。
  const handleSubmitTts = async () => {
    if (!outcome?.mediaUrl) return
    try {
      let assetUrl = outcome.mediaUrl
      if (outcome.mediaBlob) {
        assetUrl = await blobToDataUrl(outcome.mediaBlob)
      } else {
        // 兜底：没有原始 Blob 时从 blob 地址重新取回内容。
        const blob = await fetch(outcome.mediaUrl).then((r) => r.blob())
        assetUrl = await blobToDataUrl(blob)
      }
      await handleSubmitAi({ asset_url: assetUrl })
    } catch (err) {
      toast.error(resolveErrorMessage(err))
    }
  }

  // 音色下拉：优先取「所选模型」的专属音色，模型未配置时回落到全体音色并集。
  const voiceOptions =
    capability.model_voices?.[params.model] ?? capability.voices ?? []

  // 切换模型后，若当前音色不在新模型的候选内，自动落到首个可用音色。
  useEffect(() => {
    if (voiceOptions.length === 0) return
    if (voiceOptions.includes(params.voice)) return
    patch({ voice: voiceOptions[0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.model, capability.voices, capability.model_voices])

  // 切换视频模式后清空多余的参考图，避免把上一模式的图片误带到新请求里。
  useEffect(() => {
    const required = VIDEO_REFERENCE_COUNT[params.videoMode] ?? 0
    setParams((prev) =>
      prev.videoReferences.length > required
        ? { ...prev, videoReferences: prev.videoReferences.slice(0, required) }
        : prev
    )
  }, [params.videoMode])

  // 生成中每秒刷新已生成秒数，结束后归零。
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 上传单张参考图到对象存储，返回可被生成请求引用的地址。
  const handleUploadReference = async (
    file: File,
    slot: number
  ): Promise<void> => {
    setError('')
    setUploading(true)
    try {
      const result = await uploadWorkspaceAsset(file)
      setParams((prev) => {
        const next = [...prev.videoReferences]
        next[slot] = result.url
        return { ...prev, videoReferences: next }
      })
    } catch (err) {
      setError(resolveErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const taskId = outcome?.taskId
  const qpath = capability.qpath

  useEffect(() => {
    if (!taskId || !qpath) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const latest = await fetchWorkspaceTask(qpath, taskId)
          if (cancelled || !latest) return
          setTask(latest)
          if (latest.status === 'SUCCESS' || latest.status === 'FAILURE') {
            window.clearInterval(timer)
            if (latest.status === 'SUCCESS') {
              // 成功后拉取产物（视频 / 音乐等二进制结果）用于预览与下载。
              try {
                const result = await fetchWorkspaceTaskArtifacts(qpath, taskId)
                if (cancelled) return
                setTaskArtifacts(result.artifacts)
                setLegacyContentUrl(result.legacy_content_url ?? '')
              } catch {
                // 产物拉取失败不阻塞任务状态展示
              }
            }
          }
        } catch {
          // 轮询失败时静默忽略，下个周期重试
        }
      })()
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [taskId, qpath])

  const patch = (next: Partial<WorkspaceGenerateParams>) =>
    setParams((prev) => ({ ...prev, ...next }))

  const handleRun = async () => {
    if (running) return
    if (!input.trim()) return
    if (capability.kind === 'edit' && !imageFile) {
      setError(t('请先选择要修改的图片'))
      return
    }
    setRunning(true)
    setError('')
    setOutcome(null)
    setTask(undefined)
    setTaskArtifacts([])
    setLegacyContentUrl('')
    try {
      const result = await runWorkspaceGenerate(
        capability,
        input,
        params,
        imageFile
      )
      setOutcome(result)
    } catch (err) {
      setError(resolveErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const videoHint =
    VIDEO_MODES.find((mode) => mode.id === params.videoMode)?.hint ?? ''
  const requiredRefs = VIDEO_REFERENCE_COUNT[params.videoMode] ?? 0

  return (
    <section
      className='workspace-enter overflow-hidden rounded-[18px] border border-[#e9e7f8] bg-white shadow-[0_30px_70px_-46px_rgba(25,24,51,.95)]'
      style={{ animationDelay: '60ms' }}
    >
      <div className='flex items-center gap-3 border-b border-[#f1f0f9] bg-gradient-to-r from-[#faf9ff] to-white px-5 py-3'>
        <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-[15px] font-bold text-white shadow-[0_8px_16px_-9px_rgba(108,92,231,.95)]'>
          {props.icon}
        </span>
        <div className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5'>
          <div className='text-[15px] font-bold tracking-[-.01em] text-[#17162b]'>
            {capability.name}
          </div>
          <div className='truncate text-[11.5px] text-[#8a89a0]'>
            {capability.desc}
          </div>
        </div>
      </div>

      <div className='px-5 py-4'>
        <div className={SECTION_CLASS}>
          <label className={LABEL_CLASS} htmlFor='workspace-prompt'>
            {t('创作要求')}
          </label>
          {capability.kind === 'tts' ? (
            <input
              id='workspace-prompt'
              className={FIELD_CLASS}
              placeholder={t('输入要朗读的文字')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          ) : (
            <textarea
              id='workspace-prompt'
              className='min-h-[92px] w-full resize-y rounded-[12px] border border-[#e4e2f2] bg-white px-4 py-3 text-[13.5px] leading-[1.7] text-[#1c1b31] outline-none transition-[border-color,box-shadow] placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
              placeholder={t('请清楚描述你希望 AI 生成的内容…')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          )}
        </div>

        {capability.kind === 'text' && (
          <div className={SECTION_CLASS}>
            <div className='mb-1.5 flex items-center justify-between'>
              <label
                className='block text-[13px] font-semibold tracking-[-.01em] text-[#3a3954]'
                htmlFor='workspace-temperature'
              >
                {t('创造性 temperature')}
              </label>
              <span className='rounded-full bg-[#f1eeff] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#6c5ce7] tabular-nums'>
                {params.temperature.toFixed(1)}
              </span>
            </div>
            <input
              id='workspace-temperature'
              type='range'
              min={0}
              max={1}
              step={0.1}
              value={params.temperature}
              className='h-[22px] w-full accent-[#6c5ce7]'
              onChange={(event) =>
                patch({ temperature: Number(event.target.value) })
              }
            />
          </div>
        )}

        {capability.kind === 'image' && (
          <div className={cn(SECTION_CLASS, 'grid grid-cols-1 gap-5 sm:grid-cols-3')}>
            <div>
              <label className={LABEL_CLASS} htmlFor='workspace-size'>
                {t('尺寸')}
              </label>
              <CustomSelect
                id='workspace-size'
                triggerClassName={SELECT_CLASS}
                value={params.size}
                onChange={(value) => patch({ size: value })}
                options={IMAGE_SIZES.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor='workspace-count'>
                {t('张数')}
              </label>
              <CustomSelect
                id='workspace-count'
                triggerClassName={SELECT_CLASS}
                value={String(params.count)}
                onChange={(value) => patch({ count: Number(value) })}
                options={[1, 2, 4].map((count) => ({
                  value: String(count),
                  label: `${count} ${t('张')}`,
                }))}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor='workspace-style'>
                {t('风格')}
              </label>
              <input
                id='workspace-style'
                className={FIELD_CLASS}
                placeholder={t('可选，如 水彩 / 3D / 国风')}
                value={params.style}
                onChange={(event) => patch({ style: event.target.value })}
              />
            </div>
          </div>
        )}

        {capability.kind === 'edit' && (
          <>
            <div className={SECTION_CLASS}>
              <label
                className={cn(
                  'flex cursor-pointer flex-col items-center rounded-[14px] border border-[#e4e2f2] bg-[#fbfbfe] px-4 py-5 text-center transition',
                  'hover:border-[#6c5ce7] hover:bg-[#f8f6ff]'
                )}
                htmlFor='workspace-image-file'
              >
                <span className='flex h-11 w-11 items-center justify-center rounded-[13px] bg-[#f1eeff] text-[20px] leading-none text-[#6c5ce7]'>
                  ＋
                </span>
                <span className='mt-3 text-[13.5px] font-semibold text-[#2a2941]'>
                  {imageFile ? imageFile.name : t('上传参考图片')}
                </span>
                <span className='mt-1.5 text-[11.5px] text-[#8a89a0]'>
                  {t('支持 JPG、PNG，最大 8MB')}
                </span>
              </label>
              <input
                id='workspace-image-file'
                type='file'
                accept='image/png,image/jpeg'
                className='hidden'
                onChange={(event) =>
                  setImageFile(event.target.files?.[0] ?? undefined)
                }
              />
            </div>
            <div className={cn(SECTION_CLASS, 'grid grid-cols-1 gap-5 sm:grid-cols-2')}>
              <div>
                <label className={LABEL_CLASS} htmlFor='workspace-edit-style'>
                  {t('风格')}
                </label>
                <input
                  id='workspace-edit-style'
                  className={FIELD_CLASS}
                  placeholder={t('可选，如 动漫化 / 油画')}
                  value={params.style}
                  onChange={(event) => patch({ style: event.target.value })}
                />
              </div>
              <div>
                <div className='mb-1.5 flex items-center justify-between'>
                  <label
                    className='block text-[13px] font-semibold tracking-[-.01em] text-[#3a3954]'
                    htmlFor='workspace-strength'
                  >
                    {t('参考强度')}
                  </label>
                  <span className='rounded-full bg-[#f1eeff] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#6c5ce7] tabular-nums'>
                    {params.strength.toFixed(1)}
                  </span>
                </div>
                <input
                  id='workspace-strength'
                  type='range'
                  min={0}
                  max={1}
                  step={0.1}
                  value={params.strength}
                  className='h-[22px] w-full accent-[#6c5ce7]'
                  onChange={(event) =>
                    patch({ strength: Number(event.target.value) })
                  }
                />
              </div>
            </div>
          </>
        )}

        {capability.kind === 'video' && (
          <>
            <div className={SECTION_CLASS}>
              <label className={LABEL_CLASS}>{t('生成方式')}</label>
              <div className='flex flex-wrap gap-2.5'>
                {VIDEO_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type='button'
                    className={cn(
                      'rounded-[9px] px-4 py-2 text-[12.5px] font-medium transition',
                      params.videoMode === mode.id
                        ? 'bg-[#6c5ce7] text-white shadow-[0_8px_18px_-10px_rgba(108,92,231,.95)]'
                        : 'bg-[#f4f3fa] text-[#5f5e78] hover:bg-[#eceafa] hover:text-[#6c5ce7]'
                    )}
                    onClick={() => patch({ videoMode: mode.id })}
                  >
                    {t(mode.label)}
                  </button>
                ))}
              </div>
              <div className='mt-3 text-[12px] text-[#8a89a0]'>
                {t(videoHint)}
              </div>
            </div>
            {requiredRefs > 0 && (
              <div
                className={cn(
                  SECTION_CLASS,
                  'grid grid-cols-1 gap-4 sm:grid-cols-2'
                )}
              >
                {Array.from({ length: requiredRefs }).map((_, slot) => {
                  const url = params.videoReferences[slot]
                  const inputId = `workspace-video-ref-${slot}`
                  const label =
                    params.videoMode === 'frames'
                      ? slot === 0
                        ? t('首帧图片')
                        : t('尾帧图片')
                      : t('参考图片')
                  return (
                    <div key={inputId}>
                      <label className={LABEL_CLASS} htmlFor={inputId}>
                        {label}
                      </label>
                      <label
                        className={cn(
                          'flex h-[42px] cursor-pointer items-center justify-center rounded-[10px] border border-[#e4e2f2] bg-[#fbfbfe] px-3.5 text-[13px] font-medium text-[#6c5ce7] transition',
                          'hover:border-[#6c5ce7] hover:bg-[#f8f6ff]',
                          uploading && 'pointer-events-none opacity-60'
                        )}
                        htmlFor={inputId}
                      >
                        {url ? t('已上传，点击更换') : t('上传参考图并同步至云端')}
                      </label>
                      <input
                        id={inputId}
                        type='file'
                        accept='image/png,image/jpeg,image/webp'
                        className='hidden'
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void handleUploadReference(file, slot)
                        }}
                      />
                      {url && (
                        <img
                          alt={label}
                          src={url}
                          className='mt-2 h-20 w-20 rounded-[10px] border border-[#e9e7f8] object-cover'
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div className={cn(SECTION_CLASS, 'grid grid-cols-1 gap-5 sm:grid-cols-3')}>
              <div>
                <label className={LABEL_CLASS} htmlFor='workspace-duration'>
                  {t('时长')}
                </label>
                <CustomSelect
                  id='workspace-duration'
                  triggerClassName={SELECT_CLASS}
                  value={params.duration}
                  onChange={(value) => patch({ duration: value })}
                  options={['6', '5', '10'].map((value) => ({
                    value,
                    label: `${value} ${t('秒')}`,
                  }))}
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor='workspace-resolution'>
                  {t('分辨率')}
                </label>
                <CustomSelect
                  id='workspace-resolution'
                  triggerClassName={SELECT_CLASS}
                  value={params.resolution}
                  onChange={(value) => patch({ resolution: value })}
                  options={['720P', '480P', '1080P'].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor='workspace-style'>
                  {t('运镜 / 风格')}
                </label>
                <input
                  id='workspace-style'
                  className={FIELD_CLASS}
                  placeholder={t('可选，如 缓慢推进 / 电影感')}
                  value={params.style}
                  onChange={(event) => patch({ style: event.target.value })}
                />
              </div>
            </div>
          </>
        )}

        {capability.kind === 'tts' && (
          <div className={cn(SECTION_CLASS, 'grid grid-cols-1 gap-5 sm:grid-cols-2')}>
            <div>
              <label className={LABEL_CLASS} htmlFor='workspace-voice'>
                {t('音色')}
              </label>
              {voiceOptions.length > 0 ? (
                <CustomSelect
                  id='workspace-voice'
                  triggerClassName={SELECT_CLASS}
                  value={params.voice}
                  onChange={(value) => patch({ voice: value })}
                  options={voiceOptions.map((voice) => ({
                    value: voice,
                    label: voice,
                  }))}
                />
              ) : (
                <input
                  id='workspace-voice'
                  className={FIELD_CLASS}
                  placeholder={t('如 alloy / echo / nova')}
                  value={params.voice}
                  onChange={(event) => patch({ voice: event.target.value })}
                />
              )}
            </div>
            <div>
              <div className='mb-1.5 flex items-center justify-between'>
                <label
                  className='block text-[13px] font-semibold tracking-[-.01em] text-[#3a3954]'
                  htmlFor='workspace-speed'
                >
                  {t('语速')}
                </label>
                <span className='rounded-full bg-[#f1eeff] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#6c5ce7] tabular-nums'>
                  {params.speed.toFixed(1)}x
                </span>
              </div>
              <input
                id='workspace-speed'
                type='range'
                min={0.5}
                max={2}
                step={0.1}
                value={params.speed}
                className='h-[22px] w-full accent-[#6c5ce7]'
                onChange={(event) =>
                  patch({ speed: Number(event.target.value) })
                }
              />
            </div>
          </div>
        )}

        {capability.kind === 'music' && (
          <>
            <div className={SECTION_CLASS}>
              <label className={LABEL_CLASS} htmlFor='workspace-music-style'>
                {t('音乐风格标签')}
              </label>
              <input
                id='workspace-music-style'
                className={FIELD_CLASS}
                placeholder={t('可选，用逗号分隔，如 pop, upbeat, female vocal')}
                value={params.style}
                onChange={(event) => patch({ style: event.target.value })}
              />
              <span className='mt-2 block text-[11.5px] text-[#8a89a0]'>
                {t('对应上游 tags 参数，可留空由 AI 自动判断')}
              </span>
            </div>
            <div className={cn(SECTION_CLASS, 'grid grid-cols-1 gap-5 sm:grid-cols-2')}>
              <div>
                <label className={LABEL_CLASS} htmlFor='workspace-music-title'>
                  {t('歌曲标题')}
                </label>
                <input
                  id='workspace-music-title'
                  className={FIELD_CLASS}
                  placeholder={t('可选，留空由 AI 生成')}
                  value={params.musicTitle}
                  onChange={(event) => patch({ musicTitle: event.target.value })}
                />
              </div>
              <div>
                <label
                  className={LABEL_CLASS}
                  htmlFor='workspace-music-instrumental'
                >
                  {t('纯音乐')}
                </label>
                <label className='flex h-[42px] cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#e4e2f2] bg-white px-3.5 text-[13.5px] text-[#3f3e57] transition hover:border-[#cfc9f2]'>
                  <input
                    id='workspace-music-instrumental'
                    type='checkbox'
                    className='h-[16px] w-[16px] accent-[#6c5ce7]'
                    checked={params.instrumental}
                    onChange={(event) =>
                      patch({ instrumental: event.target.checked })
                    }
                  />
                  {t('仅生成伴奏，不要人声')}
                </label>
              </div>
            </div>
          </>
        )}

        {props.advanced && (
          <div className={cn(SECTION_CLASS, 'rounded-[14px] border border-[#eceafa] bg-[#fbfbfe] px-4 py-4')}>
            <button
              type='button'
              className='flex w-full cursor-pointer items-center justify-between gap-x-3 text-left'
              onClick={() => setAdvancedOpen((prev) => !prev)}
              aria-expanded={advancedOpen}
            >
              <span className='text-[13px] font-bold tracking-[-.01em] text-[#3a3954]'>
                {t('高级参数')}
              </span>
              <svg
                className={cn(
                  'h-[16px] w-[16px] shrink-0 text-[#a3a2b8] transition-transform',
                  advancedOpen && 'rotate-180'
                )}
                viewBox='0 0 16 16'
                fill='none'
                aria-hidden='true'
              >
                <path
                  d='M4 6.5 8 10.5 12 6.5'
                  stroke='currentColor'
                  strokeWidth='1.6'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </button>

            {advancedOpen && (
              <div className='mt-3.5'>
            {capability.kind === 'text' && (
              <>
                <div className={SECTION_CLASS}>
                  <label className={LABEL_CLASS} htmlFor='workspace-system-prompt'>
                    {t('系统提示词')}
                  </label>
                  <textarea
                    id='workspace-system-prompt'
                    className='min-h-[64px] w-full resize-y rounded-[10px] border border-[#e4e2f2] bg-white px-3.5 py-2.5 text-[13.5px] leading-[1.6] text-[#1c1b31] outline-none transition-[border-color,box-shadow] placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
                    placeholder={t('以 system 消息下发，如：你是一位严谨的助教')}
                    value={params.systemPrompt}
                    onChange={(event) => patch({ systemPrompt: event.target.value })}
                  />
                </div>
                <div className={cn(SECTION_CLASS, ADVANCED_GRID)}>
                  <NumberField
                    id='workspace-top-p'
                    label={t('核采样 top-p')}
                    value={params.topP}
                    min={0.05}
                    max={1}
                    step={0.05}
                    hint={t('1 表示不启用')}
                    onChange={(value) => patch({ topP: value })}
                  />
                  <NumberField
                    id='workspace-top-k'
                    label={t('候选词 top-k')}
                    value={params.topK}
                    min={0}
                    max={100}
                    step={1}
                    hint={t('0 表示不限制')}
                    onChange={(value) => patch({ topK: value })}
                  />
                  <NumberField
                    id='workspace-max-tokens'
                    label={t('最大回复长度 max_tokens')}
                    value={params.maxTokens}
                    min={0}
                    max={128000}
                    step={64}
                    hint={t('0 表示不限制')}
                    onChange={(value) => patch({ maxTokens: value })}
                  />
                  <NumberField
                    id='workspace-repetition-penalty'
                    label={t('重复惩罚 repetition_penalty')}
                    value={params.repetitionPenalty}
                    min={0.5}
                    max={2}
                    step={0.05}
                    hint={t('1 表示不启用')}
                    onChange={(value) => patch({ repetitionPenalty: value })}
                  />
                  <NumberField
                    id='workspace-frequency-penalty'
                    label={t('频率惩罚 frequency_penalty')}
                    value={params.frequencyPenalty}
                    min={-2}
                    max={2}
                    step={0.1}
                    hint={t('0 表示不启用')}
                    onChange={(value) => patch({ frequencyPenalty: value })}
                  />
                  <NumberField
                    id='workspace-presence-penalty'
                    label={t('存在惩罚 presence_penalty')}
                    value={params.presencePenalty}
                    min={-2}
                    max={2}
                    step={0.1}
                    hint={t('0 表示不启用')}
                    onChange={(value) => patch({ presencePenalty: value })}
                  />
                  <NumberField
                    id='workspace-seed'
                    label={t('随机种子 seed')}
                    value={params.seed}
                    min={0}
                    max={2147483647}
                    step={1}
                    hint={t('0 表示每次随机')}
                    onChange={(value) => patch({ seed: value })}
                  />
                </div>
                <div className={SECTION_CLASS}>
                  <label className={LABEL_CLASS} htmlFor='workspace-stop'>
                    {t('停止序列 stop')}
                  </label>
                  <textarea
                    id='workspace-stop'
                    className='min-h-[56px] w-full resize-y rounded-[10px] border border-[#e4e2f2] bg-white px-3.5 py-2.5 text-[13.5px] leading-[1.6] text-[#1c1b31] outline-none transition-[border-color,box-shadow] placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
                    placeholder={t('每行一条，命中即停止生成')}
                    value={params.stop}
                    onChange={(event) => patch({ stop: event.target.value })}
                  />
                </div>
              </>
            )}

            {capability.kind === 'image' && (
              <div className={cn(SECTION_CLASS, ADVANCED_GRID)}>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-quality'>
                    {t('生成质量')}
                  </label>
                  <CustomSelect
                    id='workspace-quality'
                    triggerClassName={SELECT_CLASS}
                    value={params.quality}
                    onChange={(value) => patch({ quality: value })}
                    options={[
                      { value: '', label: t('默认') },
                      { value: 'standard', label: t('标准 standard') },
                      { value: 'hd', label: t('高清 hd') },
                    ]}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-image-style'>
                    {t('图像风格')}
                  </label>
                  <CustomSelect
                    id='workspace-image-style'
                    triggerClassName={SELECT_CLASS}
                    value={params.imageStyle}
                    onChange={(value) => patch({ imageStyle: value })}
                    options={[
                      { value: '', label: t('默认') },
                      { value: 'vivid', label: t('鲜艳 vivid') },
                      { value: 'natural', label: t('自然 natural') },
                    ]}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-image-format'>
                    {t('返回格式')}
                  </label>
                  <CustomSelect
                    id='workspace-image-format'
                    triggerClassName={SELECT_CLASS}
                    value={params.responseFormat}
                    onChange={(value) => patch({ responseFormat: value })}
                    options={[
                      { value: '', label: t('默认') },
                      { value: 'url', label: 'url' },
                      { value: 'b64_json', label: 'b64_json' },
                    ]}
                  />
                </div>
              </div>
            )}

            {capability.kind === 'edit' && (
              <>
                <div className={SECTION_CLASS}>
                  <label className={LABEL_CLASS} htmlFor='workspace-negative-prompt'>
                    {t('负向提示 negative_prompt')}
                  </label>
                  <input
                    id='workspace-negative-prompt'
                    className={FIELD_CLASS}
                    placeholder={t('可选，描述不希望出现的内容')}
                    value={params.negativePrompt}
                    onChange={(event) =>
                      patch({ negativePrompt: event.target.value })
                    }
                  />
                </div>
                <div className={cn(SECTION_CLASS, ADVANCED_GRID)}>
                  <NumberField
                    id='workspace-edit-seed'
                    label={t('随机种子 seed')}
                    value={params.seed}
                    min={0}
                    max={2147483647}
                    step={1}
                    hint={t('0 表示每次随机')}
                    onChange={(value) => patch({ seed: value })}
                  />
                  <div>
                    <label className={LABEL_CLASS} htmlFor='workspace-edit-quality'>
                      {t('生成质量')}
                    </label>
                    <CustomSelect
                      id='workspace-edit-quality'
                      triggerClassName={SELECT_CLASS}
                      value={params.quality}
                      onChange={(value) => patch({ quality: value })}
                      options={[
                        { value: '', label: t('默认') },
                        { value: 'standard', label: t('标准 standard') },
                        { value: 'hd', label: t('高清 hd') },
                      ]}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS} htmlFor='workspace-edit-format'>
                      {t('返回格式')}
                    </label>
                    <CustomSelect
                      id='workspace-edit-format'
                      triggerClassName={SELECT_CLASS}
                      value={params.responseFormat}
                      onChange={(value) => patch({ responseFormat: value })}
                      options={[
                        { value: '', label: t('默认') },
                        { value: 'url', label: 'url' },
                        { value: 'b64_json', label: 'b64_json' },
                      ]}
                    />
                  </div>
                </div>
              </>
            )}

            {capability.kind === 'video' && (
              <div className={cn(SECTION_CLASS, ADVANCED_GRID)}>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-aspect-ratio'>
                    {t('画面比例')}
                  </label>
                  <CustomSelect
                    id='workspace-aspect-ratio'
                    triggerClassName={SELECT_CLASS}
                    value={params.aspectRatio}
                    onChange={(value) => patch({ aspectRatio: value })}
                    options={[
                      { value: '', label: t('默认') },
                      { value: '16:9', label: '16:9' },
                      { value: '9:16', label: '9:16' },
                      { value: '1:1', label: '1:1' },
                    ]}
                  />
                </div>
                <NumberField
                  id='workspace-cfg-scale'
                  label={t('提示词强度 cfg_scale')}
                  value={params.cfgScale}
                  min={0}
                  max={1}
                  step={0.05}
                  hint={t('0 表示沿用上游默认值')}
                  onChange={(value) => patch({ cfgScale: value })}
                />
                <div className='flex items-end'>
                  <span className='text-[11.5px] leading-[1.6] text-[#a3a2b8]'>
                    {t('画面比例与提示词强度会随 metadata 下发，具体生效取决于所选视频通道。')}
                  </span>
                </div>
              </div>
            )}

            {capability.kind === 'music' && (
              <div className={cn(SECTION_CLASS, ADVANCED_GRID_2)}>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-music-version'>
                    {t('模型版本 mv')}
                  </label>
                  <CustomSelect
                    id='workspace-music-version'
                    triggerClassName={SELECT_CLASS}
                    value={params.musicVersion}
                    onChange={(value) => patch({ musicVersion: value })}
                    options={[
                      { value: '', label: t('上游默认') },
                      { value: 'chirp-v3-0', label: 'chirp-v3-0' },
                      { value: 'chirp-v3-5', label: 'chirp-v3-5' },
                      { value: 'chirp-v4', label: 'chirp-v4' },
                    ]}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-music-desc'>
                    {t('描述提示词 gpt_description_prompt')}
                  </label>
                  <input
                    id='workspace-music-desc'
                    className={FIELD_CLASS}
                    placeholder={t('可选，用于描述型生成而非自定义歌词')}
                    value={params.musicDescription}
                    onChange={(event) =>
                      patch({ musicDescription: event.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {capability.kind === 'tts' && (
              <div className={cn(SECTION_CLASS, ADVANCED_GRID_2)}>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-tts-format'>
                    {t('输出格式')}
                  </label>
                  <CustomSelect
                    id='workspace-tts-format'
                    triggerClassName={SELECT_CLASS}
                    value={params.ttsFormat}
                    onChange={(value) => patch({ ttsFormat: value })}
                    options={[
                      { value: '', label: t('默认') },
                      { value: 'mp3', label: 'mp3' },
                      { value: 'opus', label: 'opus' },
                      { value: 'aac', label: 'aac' },
                      { value: 'flac', label: 'flac' },
                      { value: 'wav', label: 'wav' },
                      { value: 'pcm', label: 'pcm' },
                    ]}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor='workspace-tts-instructions'>
                    {t('朗读指令 instructions')}
                  </label>
                  <input
                    id='workspace-tts-instructions'
                    className={FIELD_CLASS}
                    placeholder={t('可选，如：语速放慢、语气温柔')}
                    value={params.ttsInstructions}
                    onChange={(event) =>
                      patch({ ttsInstructions: event.target.value })
                    }
                  />
                </div>
              </div>
            )}
              </div>
            )}
          </div>
        )}

        <div className='mt-1 flex flex-col items-stretch justify-end gap-3 border-t border-[#f1f0f9] pt-4 sm:flex-row sm:items-center'>
          <div className='flex items-center gap-3'>
            <span className='whitespace-nowrap text-[13px] font-semibold text-[#3a3954]'>
              {t('使用模型')}
            </span>
            <CustomSelect
              className='w-full sm:w-[280px]'
              triggerClassName={SELECT_CLASS}
              value={params.model}
              onChange={(value) => patch({ model: value })}
              options={
                (capability.models ?? []).length === 0
                  ? [
                      {
                        value: params.model,
                        label: params.model || t('默认模型'),
                      },
                    ]
                  : (capability.models ?? []).map((name) => ({
                      value: name,
                      label: name,
                    }))
              }
            />
          </div>
          <button
            type='button'
            className='h-[46px] shrink-0 rounded-[12px] bg-gradient-to-br from-[#7c6cf2] to-[#5b4bd6] px-6 text-[14px] font-semibold text-white shadow-[0_14px_30px_-12px_rgba(108,92,231,.95)] transition-all hover:brightness-[1.06] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={running}
            onClick={() => void handleRun()}
          >
            {running
              ? `${t('生成中…')} ${elapsed}${t('秒')}`
              : `＋ ${t('开始')}${capability.name}`}
          </button>
        </div>

        {error && (
          <p className='mt-4 rounded-[12px] border border-[#fee2e2] bg-[#fef2f2] px-4 py-3.5 text-[13px] text-[#dc2626]'>
            {error}
          </p>
        )}

        {outcome?.text && (
          <>
            <div className='mt-4 rounded-[14px] border border-[#e9e7f8] bg-[#fbfbfe] px-5 py-4'>
              <Markdown className='text-[13.5px] leading-[1.8] text-[#1c1b31] [&_pre]:bg-white [&_pre]:border-[#e9e7f8]'>
                {outcome.text}
              </Markdown>
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <button
                className='inline-flex items-center gap-1.5 rounded-[10px] border border-[#ded9f7] bg-white px-4 py-2 text-[13px] font-semibold text-[#5b4bd6] transition-colors hover:border-[#6c5ce7] hover:bg-[#f4f1ff]'
                onClick={() =>
                  downloadTextFile(
                    outcome.text ?? '',
                    `AI-${capability.name}-${Date.now()}.md`
                  )
                }
                type='button'
              >
                <Download className='h-3.5 w-3.5' />
                {t('下载文本')}
              </button>
              {aiTasks.length > 0 && (
                <div className='flex flex-wrap items-center gap-3 rounded-[12px] border border-[#e9e7f8] bg-[#fbfbfe] px-4 py-3'>
                  <span className='whitespace-nowrap text-[13px] font-semibold text-[#3a3954]'>
                    {t('提交到课堂任务')}
                  </span>
                  <CustomSelect
                    className='w-full sm:w-[220px]'
                    triggerClassName={SELECT_CLASS}
                    value={selectedTaskId}
                    onChange={setSubmitTaskId}
                    options={aiTasks.map((item) => ({
                      value: String(item.id),
                      label: item.title,
                    }))}
                  />
                  <button
                    className='rounded-[10px] bg-[#6c5ce7] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
                    disabled={submittingTask}
                    onClick={() =>
                      void handleSubmitAi({ result_text: outcome.text })
                    }
                    type='button'
                  >
                    {t('提交文字作品')}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {outcome?.mediaUrl && capability.kind === 'tts' && (
          <div className='mt-4'>
            <AudioPlayer
              src={outcome.mediaUrl}
              downloadName={`AI-语音-${Date.now()}`}
            />
            {aiTasks.length > 0 && (
              <div className='mt-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#e9e7f8] bg-[#fbfbfe] px-4 py-3'>
                <span className='whitespace-nowrap text-[13px] font-semibold text-[#3a3954]'>
                  {t('提交到课堂任务')}
                </span>
                <CustomSelect
                  className='w-full sm:w-[220px]'
                  triggerClassName={SELECT_CLASS}
                  value={selectedTaskId}
                  onChange={setSubmitTaskId}
                  options={aiTasks.map((item) => ({
                    value: String(item.id),
                    label: item.title,
                  }))}
                />
                <button
                  className='rounded-[10px] bg-[#6c5ce7] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
                  disabled={submittingTask}
                  onClick={() => void handleSubmitTts()}
                  type='button'
                >
                  {t('提交语音作品')}
                </button>
              </div>
            )}
          </div>
        )}

        {(capability.kind === 'image' || capability.kind === 'edit') &&
          (outcome?.mediaUrls?.length ?? 0) > 0 && (
            <div className='mt-5 flex flex-col gap-4'>
              {aiTasks.length > 0 && (
                <div className='flex flex-wrap items-center gap-3 rounded-[12px] border border-[#e9e7f8] bg-[#fbfbfe] px-4 py-3'>
                  <span className='whitespace-nowrap text-[13px] font-semibold text-[#3a3954]'>
                    {t('提交到课堂任务')}
                  </span>
                  <CustomSelect
                    className='w-full sm:w-[220px]'
                    triggerClassName={SELECT_CLASS}
                    value={selectedTaskId}
                    onChange={setSubmitTaskId}
                    options={aiTasks.map((item) => ({
                      value: String(item.id),
                      label: item.title,
                    }))}
                  />
                  <span className='text-[12px] text-[#8a89a0]'>
                    {t('多张图片可逐张单独提交')}
                  </span>
                </div>
              )}
              {outcome?.mediaUrls?.map((url, index) => (
                <div key={`${index}-${url.slice(0, 32)}`}>
                  <img
                    alt={`${capability.name} ${index + 1}`}
                    className='max-h-[460px] w-auto rounded-[14px] border border-[#e9e7f8] bg-white object-contain shadow-[0_22px_48px_-32px_rgba(25,24,51,.9)]'
                    src={url}
                  />
                  <div className='mt-2 flex flex-wrap items-center gap-3'>
                    <button
                      className='inline-flex items-center gap-1.5 rounded-[10px] border border-[#ded9f7] bg-white px-4 py-2 text-[13px] font-semibold text-[#5b4bd6] transition-colors hover:border-[#6c5ce7] hover:bg-[#f4f1ff]'
                      onClick={() =>
                        void downloadMediaFile(
                          url,
                          withExtension(
                            `AI-${capability.name}-${index + 1}-${Date.now()}`,
                            { url, mime: 'image/png', fallback: 'png' }
                          )
                        )
                      }
                      type='button'
                    >
                      <Download className='h-3.5 w-3.5' />
                      {t('下载')}
                    </button>
                    {aiTasks.length > 0 && (
                      <button
                        className='rounded-[10px] bg-[#6c5ce7] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
                        disabled={submittingTask}
                        onClick={() => void handleSubmitAi({ asset_url: url })}
                        type='button'
                      >
                        {t('提交此图')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        {taskId && (
          <div className='mt-4 rounded-[14px] border border-[#e9e7f8] bg-[#fbfbfe] px-5 py-4 text-[13px] text-[#5f5e78]'>
            <p className='flex flex-wrap gap-x-2'>
              <span className='font-semibold text-[#3a3954]'>
                {t('任务编号')}
              </span>
              <span className='break-all'>{taskId}</span>
            </p>
            <p className='mt-2 flex flex-wrap gap-x-2'>
              <span className='font-semibold text-[#3a3954]'>
                {t('任务状态')}
              </span>
              <span>
                {task?.status ?? t('排队中')}
                {task?.progress ? ` · ${task.progress}` : ''}
              </span>
            </p>
            {task?.fail_reason && (
              <p className='mt-2 text-[#dc2626]'>{task.fail_reason}</p>
            )}
          </div>
        )}

        {/* 视频 / 音乐任务产物：自定义播放器预览 + 下载 + 提交 */}
        {(capability.kind === 'video' || capability.kind === 'music') &&
          task?.status === 'SUCCESS' &&
          (taskArtifacts.length > 0 || legacyContentUrl) && (
            <div className='mt-4 flex flex-col gap-4'>
              {aiTasks.length > 0 && (
                <div className='flex flex-wrap items-center gap-3 rounded-[12px] border border-[#e9e7f8] bg-[#fbfbfe] px-4 py-3'>
                  <span className='whitespace-nowrap text-[13px] font-semibold text-[#3a3954]'>
                    {t('提交到课堂任务')}
                  </span>
                  <CustomSelect
                    className='w-full sm:w-[220px]'
                    triggerClassName={SELECT_CLASS}
                    value={selectedTaskId}
                    onChange={setSubmitTaskId}
                    options={aiTasks.map((item) => ({
                      value: String(item.id),
                      label: item.title,
                    }))}
                  />
                  <span className='text-[12px] text-[#8a89a0]'>
                    {t('多个产物可逐个单独提交')}
                  </span>
                </div>
              )}
              {taskArtifacts.map((artifact, index) => {
                const isVideo =
                  artifact.type === 'video' ||
                  (artifact.mime_type ?? '').startsWith('video/')
                const isAudio =
                  artifact.type === 'audio' ||
                  (artifact.mime_type ?? '').startsWith('audio/')
                const label = `AI-${capability.name}-${index + 1}`
                return (
                  <div key={`${artifact.key}-${index}`}>
                    {isVideo ? (
                      <VideoPlayer
                        src={artifact.content_url}
                        downloadName={label}
                      />
                    ) : isAudio ? (
                      <AudioPlayer
                        src={artifact.content_url}
                        downloadName={label}
                      />
                    ) : (
                      <img
                        alt={label}
                        className='max-h-[460px] w-auto rounded-[14px] border border-[#e9e7f8] bg-white object-contain'
                        src={artifact.content_url}
                      />
                    )}
                    <div className='mt-2 flex flex-wrap items-center gap-3'>
                      {!isVideo && !isAudio && (
                        <button
                          className='inline-flex items-center gap-1.5 rounded-[10px] border border-[#ded9f7] bg-white px-4 py-2 text-[13px] font-semibold text-[#5b4bd6] transition-colors hover:border-[#6c5ce7] hover:bg-[#f4f1ff]'
                          onClick={() =>
                            void downloadMediaFile(
                              artifact.content_url,
                              withExtension(label, {
                                url: artifact.content_url,
                                mime: artifact.mime_type,
                              })
                            )
                          }
                          type='button'
                        >
                          <Download className='h-3.5 w-3.5' />
                          {t('下载')}
                        </button>
                      )}
                      {aiTasks.length > 0 && (
                        <button
                          className='rounded-[10px] bg-[#6c5ce7] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
                          disabled={submittingTask}
                          onClick={() =>
                            void handleSubmitAi({
                              asset_url: artifact.content_url,
                            })
                          }
                          type='button'
                        >
                          {t('提交此作品')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {/* 旧任务没有产物记录时，使用遗留视频地址兜底 */}
              {legacyContentUrl && taskArtifacts.length === 0 && (
                <div>
                  <VideoPlayer
                    src={legacyContentUrl}
                    downloadName={`AI-${capability.name}-${Date.now()}`}
                  />
                  {aiTasks.length > 0 && (
                    <div className='mt-2'>
                      <button
                        className='rounded-[10px] bg-[#6c5ce7] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
                        disabled={submittingTask}
                        onClick={() =>
                          void handleSubmitAi({ asset_url: legacyContentUrl })
                        }
                        type='button'
                      >
                        {t('提交此作品')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </div>
    </section>
  )
}
