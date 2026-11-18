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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  History,
  Loader2,
  Pencil,
  Plus,
  Presentation,
  Search,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { SlideItem } from '@/features/workspace/slide-api'
import {
  extractSlides,
  fetchSlideLabConfig,
  fetchSlideProject,
  fetchSlideProjects,
  renameSlideProject,
  sendSlidePrompt,
} from '@/features/workspace/slide-api'
import { cn } from '@/lib/utils'

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
  slides?: SlideItem[]
  failed?: boolean
}

// 历史项目列表每页条数上限（服务端默认同为 10）。
const PROJECT_PAGE_SIZE = 10

// 思考强度档位中文名（空串表示跟随模型默认）。
const EFFORT_LABEL: Record<string, string> = {
  '': '跟随模型默认',
  none: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
}

/**
 * 聊天气泡只展示围栏外的说明文字：
 * 助手回复里的 ```json 围栏可能长达数万字符，整段渲染会刷屏并拖慢页面。
 */
function stripSlideJsonFence(content: string): string {
  const text = content.trim()
  const start = text.indexOf('```')
  if (start < 0) return content
  const after = text.slice(start + 3)
  const lineEnd = after.search(/\r?\n/)
  const body = lineEnd >= 0 ? after.slice(lineEnd + 1) : after
  const end = body.indexOf('```')
  const rest = text.slice(0, start) + (end >= 0 ? body.slice(end + 3) : '')
  return rest.trim()
}

export function SlideLab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const configQuery = useQuery({
    queryKey: ['workspace', 'slide-config'],
    queryFn: fetchSlideLabConfig,
  })
  const config = configQuery.data

  const [projectId, setProjectId] = useState<number | null>(null)
  const [projectName, setProjectName] = useState('')
  const [model, setModel] = useState('')
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [activeSlide, setActiveSlide] = useState(0)
  const [showSource, setShowSource] = useState(false)
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [loadingProject, setLoadingProject] = useState(false)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  // 思考强度初始档位来自后台配置，null 表示尚未从 config 回填。
  const [effort, setEffort] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['workspace', 'slide-projects', page, keyword],
    queryFn: () =>
      fetchSlideProjects({ page, pageSize: PROJECT_PAGE_SIZE, keyword }),
  })
  const projectList = projectsQuery.data
  const projects = projectList?.items ?? []
  const totalProjects = projectList?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalProjects / PROJECT_PAGE_SIZE))

  const models = config?.models ?? []
  const activeModel = model || models[0] || ''
  const pointsPerSend = config?.points ?? 0
  const effortOptions = config?.thinking_effort_options ?? ['']

  const currentSlide =
    activeSlide >= 0 && activeSlide < slides.length ? slides[activeSlide] : null

  // 配置加载后以后台默认档位作为初始值（用户手动切换过则不覆盖）。
  useEffect(() => {
    if (effort === null && config) setEffort(config.thinking_effort ?? '')
  }, [config, effort])

  useEffect(() => {
    if (!sending) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sending])

  useEffect(() => {
    const node = chatRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, sending])

  // 幻灯片数量变化后校正选中页。
  useEffect(() => {
    if (activeSlide >= slides.length) {
      setActiveSlide(slides.length > 0 ? slides.length - 1 : 0)
    }
  }, [slides, activeSlide])

  const resetProject = () => {
    setProjectId(null)
    setProjectName('')
    setSlides([])
    setActiveSlide(0)
    setShowSource(false)
    setMessages([])
    setInput('')
  }

  const applyProject = (
    detail: Awaited<ReturnType<typeof fetchSlideProject>>
  ) => {
    setProjectId(detail.id)
    setProjectName(detail.name)
    setSlides(detail.slides ?? [])
    setActiveSlide(0)
    setShowSource(false)
    setMessages(
      (detail.messages ?? []).map((message) => {
        if (message.role !== 'assistant') {
          return { role: message.role, content: message.content }
        }
        return {
          role: message.role,
          content: stripSlideJsonFence(message.content),
          slides: extractSlides(message.content),
        }
      })
    )
  }

  const openProject = async (id: number) => {
    setLoadingProject(true)
    try {
      const detail = await fetchSlideProject(id)
      applyProject(detail)
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? t('项目加载失败')
      )
    } finally {
      setLoadingProject(false)
    }
  }

  const handleSend = async () => {
    const requirement = input.trim()
    if (!requirement || sending) return
    if (!activeModel) {
      toast.error(t('管理员尚未配置可用于演示文稿的模型'))
      return
    }
    const previous = messages
    setMessages([...previous, { role: 'user', content: requirement }])
    setInput('')
    setSending(true)
    try {
      const result = await sendSlidePrompt({
        model: activeModel,
        requirement,
        projectId,
        slides,
        reasoningEffort: effort ?? '',
      })
      setProjectId(result.projectId > 0 ? result.projectId : null)
      setMessages([
        ...previous,
        { role: 'user', content: requirement },
        {
          role: 'assistant',
          content: stripSlideJsonFence(result.content),
          slides: result.slides,
        },
      ])
      if (result.slides.length > 0) {
        setSlides(result.slides)
        setActiveSlide(0)
        setShowSource(false)
      }
      // 服务端已持久化，重拉详情补齐项目名称（未生成 slides 时也建了项目）。
      if (result.projectId > 0) {
        void fetchSlideProject(result.projectId)
          .then((detail) => setProjectName(detail.name))
          .catch(() => undefined)
      }
      void queryClient.invalidateQueries({
        queryKey: ['workspace', 'slide-projects'],
      })
      if (result.slides.length === 0) {
        toast.warning(t('本次未生成幻灯片，请继续描述你的需求'))
      }
    } catch (error) {
      setMessages([
        ...previous,
        { role: 'user', content: requirement, failed: true },
        {
          role: 'assistant',
          content:
            (error as { response?: { data?: { message?: string } } })?.response
              ?.data?.message ??
            (error as Error)?.message ??
            t('生成失败，请稍后重试'),
          failed: true,
        },
      ])
      toast.error(t('生成失败'))
    } finally {
      setSending(false)
    }
  }

  const openRename = () => {
    if (!projectId) {
      toast.error(t('请先创建或打开一个项目'))
      return
    }
    setRenameValue(projectName)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    if (!projectId || renaming) return
    const name = renameValue.trim()
    if (!name) {
      toast.error(t('请输入项目名称'))
      return
    }
    setRenaming(true)
    try {
      await renameSlideProject(projectId, name)
      setProjectName(name)
      setRenameOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ['workspace', 'slide-projects'],
      })
      toast.success(t('项目已重命名'))
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? t('重命名失败')
      )
    } finally {
      setRenaming(false)
    }
  }

  const copySource = async () => {
    if (!currentSlide) return
    try {
      await navigator.clipboard.writeText(currentSlide.html)
      toast.success(t('已复制本页 HTML 源码'))
    } catch {
      toast.error(t('复制失败，请手动选择源码复制'))
    }
  }

  const downloadSlide = () => {
    if (!currentSlide) return
    const blob = new Blob([currentSlide.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `slide-${activeSlide + 1}-${currentSlide.title || '未命名'}.html`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  const openInWindow = () => {
    if (!currentSlide) return
    const blob = new Blob([currentSlide.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    // 延迟释放，避免新窗口尚未读取就被回收。
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  return (
    <div className='workspace-enter flex flex-col gap-4'>
      <div className='flex flex-col gap-3 rounded-[16px] border border-[var(--ws-border)] bg-white p-4 shadow-[0_10px_30px_-24px_rgba(var(--ws-primary-rgb),.6)] sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='inline-flex items-center gap-1.5 rounded-full bg-[var(--ws-tint)] px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-primary-text)]'>
            <Sparkles className='h-3.5 w-3.5' />
            {projectId ? projectName || t('未命名项目') : t('自由创作')}
          </span>
          <span className='rounded-full bg-[var(--ws-tint)] px-2 py-[3px] text-[10.5px] font-bold tracking-wide text-[var(--ws-primary-text)] uppercase'>
            Beta
          </span>
          {projectId ? (
            <button
              type='button'
              className='inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
              onClick={openRename}
            >
              <Pencil className='h-3.5 w-3.5' />
              {t('重命名')}
            </button>
          ) : null}
          <button
            type='button'
            className='inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
            onClick={resetProject}
          >
            <Plus className='h-3.5 w-3.5' />
            {t('新建项目')}
          </button>
          <div className='inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ws-border)] bg-white px-2.5 py-1.5'>
            <Search className='h-3.5 w-3.5 text-[var(--ws-muted-2)]' />
            <input
              className='w-[120px] bg-transparent text-[13.5px] font-semibold text-[var(--ws-muted)] outline-none placeholder:font-normal placeholder:text-[var(--ws-muted-2)]'
              placeholder={t('搜索项目名称')}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </div>
          <div className='relative inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)]'>
            <History className='h-3.5 w-3.5' />
            <select
              className='max-w-[190px] cursor-pointer appearance-none bg-transparent pr-4 outline-none'
              value={projectId ?? 0}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10)
                if (next > 0) void openProject(next)
                else resetProject()
              }}
            >
              <option value={0}>{t('历史项目')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || t('未命名项目')}
                </option>
              ))}
            </select>
          </div>
          <div className='inline-flex items-center gap-1 rounded-[9px] border border-[var(--ws-border)] bg-white px-1.5 py-1 text-[13px] text-[var(--ws-muted)]'>
            <button
              type='button'
              className='rounded-[6px] p-1 transition-colors hover:bg-[var(--ws-tint)] hover:text-[var(--ws-primary-text)] disabled:opacity-40 disabled:hover:bg-transparent'
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              <ChevronLeft className='h-3.5 w-3.5' />
            </button>
            <span className='whitespace-nowrap'>
              {page} / {totalPages}
            </span>
            <button
              type='button'
              className='rounded-[6px] p-1 transition-colors hover:bg-[var(--ws-tint)] hover:text-[var(--ws-primary-text)] disabled:opacity-40 disabled:hover:bg-transparent'
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              <ChevronRight className='h-3.5 w-3.5' />
            </button>
          </div>
          {loadingProject && (
            <span className='inline-flex items-center gap-1 text-[13px] text-[var(--ws-muted-2)]'>
              <Loader2 className='h-3.5 w-3.5 animate-spin' />
              {t('加载中')}
            </span>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-[13px] text-[var(--ws-muted)]'>
            {t('每次发送消耗')} {pointsPerSend} {t('点')}
          </span>
          <select
            className='cursor-pointer rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--ws-muted)] outline-none'
            value={effort ?? ''}
            onChange={(event) => setEffort(event.target.value)}
            title={t('思考强度')}
          >
            {effortOptions.map((value) => (
              <option key={value} value={value}>
                {t('思考强度')}：{EFFORT_LABEL[value] ?? value}
              </option>
            ))}
          </select>
          <select
            className='max-w-[200px] cursor-pointer rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--ws-muted)] outline-none'
            value={activeModel}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.length === 0 && (
              <option value=''>{t('暂无可用模型')}</option>
            )}
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.3fr)]'>
        {/* 左：AI 对话 */}
        <section className='flex min-h-[560px] flex-col rounded-[16px] border border-[var(--ws-border)] bg-white shadow-[0_10px_30px_-26px_rgba(25,24,51,.35)]'>
          <div className='flex items-center gap-2 border-b border-[var(--ws-tint)] px-4 py-3'>
            <Wand2 className='h-4 w-4 text-[var(--ws-primary-text)]' />
            <span className='text-[14px] font-bold text-[var(--ws-ink)]'>
              {t('AI 对话')}
            </span>
          </div>
          <div
            ref={chatRef}
            className='flex-1 space-y-3 overflow-y-auto px-4 py-3'
            style={{ maxHeight: 520 }}
          >
            {messages.length === 0 && (
              <div className='rounded-[12px] bg-[var(--ws-tint-2)] px-3.5 py-3 text-[13.5px] leading-7 text-[var(--ws-muted)]'>
                {t(
                  '描述你的演示主题，例如「做一个 5 页的恐龙科普演示，面向小学生」；AI 会逐页生成幻灯片，可在右侧翻页预览与下载。'
                )}
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  'rounded-[12px] px-3.5 py-3 text-[13.5px] leading-7 whitespace-pre-wrap break-words',
                  message.role === 'user'
                    ? 'bg-[var(--ws-tint)] text-[var(--ws-ink-2)]'
                    : message.failed
                      ? 'bg-[#fff1f1] text-[#9b2c2c]'
                      : 'bg-[var(--ws-tint-2)] text-[var(--ws-ink-2)]'
                )}
              >
                {message.content}
                {message.role === 'assistant' &&
                  !message.failed &&
                  !message.slides?.length && (
                    <div className='mt-2 inline-flex items-center gap-1 rounded-[8px] border border-[#ffe2c2] bg-[#fffaf2] px-2 py-1 text-[11.5px] font-semibold text-[#9a6a1f]'>
                      <AlertCircle className='h-3 w-3' />
                      {t('本次未生成幻灯片')}
                    </div>
                  )}
                {message.role === 'assistant' &&
                  !message.failed &&
                  !!message.slides?.length && (
                    <div className='mt-2 inline-flex items-center gap-1 rounded-[8px] border border-[var(--ws-border-strong)] bg-[var(--ws-tint)] px-2 py-1 text-[11.5px] font-semibold text-[var(--ws-primary-text)]'>
                      <Presentation className='h-3 w-3' />
                      {t('已生成')} {message.slides.length} {t('页幻灯片')}
                    </div>
                  )}
              </div>
            ))}
            {sending && (
              <div className='flex items-center gap-2 rounded-[12px] bg-[var(--ws-tint-2)] px-3.5 py-3 text-[13.5px] text-[var(--ws-primary-text)]'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                {t('AI 正在编写幻灯片')} · {elapsed}s
              </div>
            )}
          </div>
          <div className='border-t border-[var(--ws-tint)] p-3'>
            <textarea
              className='h-[88px] w-full resize-none rounded-[10px] border border-[var(--ws-border)] bg-[var(--ws-tint-2)] px-3 py-2 text-[13.5px] leading-7 text-[var(--ws-ink-2)] outline-none focus:border-[var(--ws-primary)]'
              placeholder={t('描述演示主题、页数与风格…')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />
            <button
              type='button'
              className='mt-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ws-primary)] px-3 py-2 text-[13px] font-semibold text-[var(--ws-on)] shadow-[0_8px_18px_-10px_rgba(var(--ws-primary-rgb),.9)] transition-opacity disabled:cursor-not-allowed disabled:opacity-60'
              disabled={sending || !input.trim()}
              onClick={() => void handleSend()}
            >
              {sending ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Send className='h-4 w-4' />
              )}
              {sending ? `${t('生成中')} ${elapsed}s` : t('发送需求')}
            </button>
          </div>
        </section>

        {/* 中：幻灯片导航 / 源码 */}
        <section className='flex min-h-[560px] flex-col rounded-[16px] border border-[var(--ws-border)] bg-white shadow-[0_10px_30px_-26px_rgba(25,24,51,.35)]'>
          <div className='flex items-center justify-between gap-2 border-b border-[var(--ws-tint)] px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Presentation className='h-4 w-4 text-[var(--ws-primary-text)]' />
              <span className='text-[14px] font-bold text-[var(--ws-ink)]'>
                {t('幻灯片')}
                {slides.length > 0 && (
                  <span className='ml-1.5 text-[12.5px] font-semibold text-[var(--ws-muted-2)]'>
                    {slides.length} {t('页')}
                  </span>
                )}
              </span>
            </div>
            <button
              type='button'
              className={cn(
                'rounded-[8px] border px-2.5 py-1 text-[13px] font-semibold transition-colors',
                showSource
                  ? 'border-[var(--ws-primary)] bg-[var(--ws-tint)] text-[var(--ws-primary-text)]'
                  : 'border-[var(--ws-border)] text-[var(--ws-muted)] hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
              )}
              disabled={!currentSlide}
              onClick={() => setShowSource((prev) => !prev)}
            >
              {showSource ? t('返回预览') : t('查看源码')}
            </button>
          </div>
          {slides.length === 0 ? (
            <div className='flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[13.5px] leading-7 text-[var(--ws-muted-2)]'>
              <Presentation className='h-7 w-7 text-[var(--ws-border-strong)]' />
              {t('输入需求后，这里会按页展示生成的幻灯片')}
            </div>
          ) : showSource ? (
            <div className='flex flex-1 flex-col'>
              <div className='flex items-center justify-between gap-2 border-b border-[var(--ws-tint)] px-4 py-2'>
                <span className='min-w-0 truncate text-[13px] font-semibold text-[var(--ws-muted)]'>
                  {activeSlide + 1}. {currentSlide?.title || t('未命名页')}
                </span>
                <button
                  type='button'
                  className='inline-flex items-center gap-1 rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
                  onClick={() => void copySource()}
                >
                  <Copy className='h-3.5 w-3.5' />
                  {t('复制源码')}
                </button>
              </div>
              <textarea
                className='flex-1 resize-none rounded-b-[16px] bg-[var(--ws-tint-2)] px-4 py-3 font-mono text-[13px] leading-6 text-[var(--ws-ink-2)] outline-none'
                readOnly
                spellCheck={false}
                value={currentSlide?.html ?? ''}
              />
            </div>
          ) : (
            <div className='flex-1 space-y-2 overflow-y-auto px-3 py-3'>
              {slides.map((slide, index) => (
                <button
                  key={`${slide.title}-${index}`}
                  type='button'
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors',
                    index === activeSlide
                      ? 'border-[var(--ws-border-strong)] bg-[var(--ws-tint)] shadow-[0_0_0_1.5px_var(--ws-primary)]'
                      : 'border-[var(--ws-tint)] bg-white hover:border-[var(--ws-border-strong)] hover:bg-[var(--ws-tint-2)]'
                  )}
                  onClick={() => setActiveSlide(index)}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[12.5px] font-bold',
                      index === activeSlide
                        ? 'bg-[var(--ws-primary)] text-[var(--ws-on)]'
                        : 'bg-[var(--ws-tint)] text-[var(--ws-primary-text)]'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className='min-w-0'>
                    <span className='block truncate text-[13.5px] font-semibold text-[var(--ws-ink)]'>
                      {slide.title || t('未命名页')}
                    </span>
                    <span className='mt-[2px] block truncate text-[11.5px] text-[var(--ws-muted-2)]'>
                      {t('点击右侧预览本页')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {slides.length > 0 && (
            <div className='flex items-center justify-between gap-2 border-t border-[var(--ws-tint)] px-4 py-2.5'>
              <button
                type='button'
                className='inline-flex items-center gap-1 rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)] disabled:opacity-40'
                disabled={activeSlide <= 0}
                onClick={() => setActiveSlide((prev) => Math.max(0, prev - 1))}
              >
                <ChevronLeft className='h-3.5 w-3.5' />
                {t('上一页')}
              </button>
              <span className='text-[13px] font-semibold text-[var(--ws-muted)] tabular-nums'>
                {activeSlide + 1} / {slides.length}
              </span>
              <button
                type='button'
                className='inline-flex items-center gap-1 rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)] disabled:opacity-40'
                disabled={activeSlide >= slides.length - 1}
                onClick={() =>
                  setActiveSlide((prev) =>
                    Math.min(slides.length - 1, prev + 1)
                  )
                }
              >
                {t('下一页')}
                <ChevronRight className='h-3.5 w-3.5' />
              </button>
            </div>
          )}
        </section>

        {/* 右：幻灯片预览 */}
        <section className='flex min-h-[560px] flex-col rounded-[16px] border border-[var(--ws-border)] bg-white shadow-[0_10px_30px_-26px_rgba(25,24,51,.35)]'>
          <div className='flex items-center justify-between gap-2 border-b border-[var(--ws-tint)] px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Presentation className='h-4 w-4 text-[var(--ws-primary-text)]' />
              <span className='text-[14px] font-bold text-[var(--ws-ink)]'>
                {t('幻灯片预览')}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                className='inline-flex items-center gap-1 rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)] disabled:opacity-40'
                disabled={!currentSlide}
                onClick={openInWindow}
              >
                <ExternalLink className='h-3.5 w-3.5' />
                {t('新窗口打开')}
              </button>
              <button
                type='button'
                className='inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--ws-primary)] px-3 py-1 text-[13px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90 disabled:opacity-40'
                disabled={!currentSlide}
                onClick={downloadSlide}
              >
                <Download className='h-3.5 w-3.5' />
                {t('下载本页')}
              </button>
            </div>
          </div>
          <div className='flex-1 overflow-hidden rounded-b-[16px] bg-[var(--ws-tint-2)]'>
            {currentSlide ? (
              <iframe
                key={activeSlide}
                className='h-full min-h-[440px] w-full border-0 bg-white'
                sandbox='allow-scripts allow-same-origin allow-forms allow-modals'
                srcDoc={currentSlide.html}
                title={currentSlide.title || t('幻灯片预览')}
              />
            ) : (
              <div className='flex h-full min-h-[440px] items-center justify-center px-6 text-center text-[13.5px] leading-7 text-[var(--ws-muted-2)]'>
                {t('生成后这里会显示幻灯片效果，可翻页查看每一页')}
              </div>
            )}
          </div>
        </section>
      </div>

      {config && !config.enabled && (
        <div className='rounded-[12px] border border-[#ffe2c2] bg-[#fffaf2] px-4 py-3 text-[13.5px] text-[#9a6a1f]'>
          {t(
            '管理员尚未在模型管理中声明可用于演示文稿的模型，请联系老师开通后再使用。'
          )}
        </div>
      )}

      {renameOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--ws-ink)]/40 px-4'>
          <div className='w-full max-w-[360px] rounded-[16px] border border-[var(--ws-border)] bg-white p-5 shadow-[0_24px_60px_-30px_rgba(23,22,43,.6)]'>
            <div className='text-[15px] font-bold text-[var(--ws-ink)]'>
              {t('重命名项目')}
            </div>
            <input
              className='mt-3 w-full rounded-[10px] border border-[var(--ws-border)] bg-[var(--ws-tint-2)] px-3 py-2 text-[13px] text-[var(--ws-ink-2)] outline-none focus:border-[var(--ws-primary)]'
              placeholder={t('请输入项目名称')}
              value={renameValue}
              maxLength={60}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitRename()
              }}
            />
            <div className='mt-4 flex justify-end gap-2'>
              <button
                type='button'
                className='rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
                onClick={() => setRenameOpen(false)}
              >
                {t('取消')}
              </button>
              <button
                type='button'
                className='inline-flex items-center gap-1.5 rounded-[9px] bg-[var(--ws-primary)] px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90 disabled:opacity-60'
                disabled={renaming}
                onClick={() => void submitRename()}
              >
                {renaming && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                {t('保存')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
