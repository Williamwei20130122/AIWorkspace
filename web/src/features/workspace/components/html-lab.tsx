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
  Code2,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  fetchHtmlLabConfig,
  fetchHtmlProject,
  fetchHtmlProjects,
  renameHtmlProject,
  sendHtmlPrompt,
} from '@/features/workspace/html-api'
import { cn } from '@/lib/utils'

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
  code?: string
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

const EMPTY_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>我的第一个页面</title>
</head>
<body>
  <h1>你好，AI Workspace！</h1>
</body>
</html>`

export function HtmlLab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const configQuery = useQuery({
    queryKey: ['workspace', 'html-config'],
    queryFn: fetchHtmlLabConfig,
  })
  const config = configQuery.data

  const [projectId, setProjectId] = useState<number | null>(null)
  const [projectTitle, setProjectTitle] = useState('')
  const [model, setModel] = useState('')
  const [code, setCode] = useState('')
  const [previewCode, setPreviewCode] = useState('')
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
    queryKey: ['workspace', 'html-projects', page, keyword],
    queryFn: () =>
      fetchHtmlProjects({ page, pageSize: PROJECT_PAGE_SIZE, keyword }),
  })
  const projectList = projectsQuery.data
  const projects = projectList?.items ?? []
  const totalProjects = projectList?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalProjects / PROJECT_PAGE_SIZE))

  const models = config?.models ?? []
  const activeModel = model || models[0] || ''
  const pointsPerSend = config?.points ?? 0
  const effortOptions = config?.thinking_effort_options ?? ['']

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

  const resetProject = () => {
    setProjectId(null)
    setProjectTitle('')
    setCode('')
    setPreviewCode('')
    setMessages([])
    setInput('')
  }

  const openProject = async (id: number) => {
    setLoadingProject(true)
    try {
      const detail = await fetchHtmlProject(id)
      setProjectId(id)
      setProjectTitle(detail.project.title)
      setCode(detail.project.code ?? '')
      setPreviewCode(detail.project.code ?? '')
      setMessages(
        (detail.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
        }))
      )
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
      toast.error(t('管理员尚未配置可用于 HTML 编程的模型'))
      return
    }
    const previous = messages
    setMessages([...previous, { role: 'user', content: requirement }])
    setInput('')
    setSending(true)
    try {
      const result = await sendHtmlPrompt({
        model: activeModel,
        requirement,
        projectId,
        code,
        reasoningEffort: effort ?? '',
      })
      setProjectId(result.projectId > 0 ? result.projectId : null)
      setMessages([
        ...previous,
        { role: 'user', content: requirement },
        { role: 'assistant', content: result.content, code: result.code },
      ])
      void queryClient.invalidateQueries({
        queryKey: ['workspace', 'html-projects'],
      })
      if (!result.code) {
        toast.warning(t('本次回复未包含完整 HTML，请继续描述你的需求'))
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

  const insertCode = (nextCode: string) => {
    setCode(nextCode)
    toast.success(t('已插入到代码编辑器，点击运行查看效果'))
  }

  const runPreview = () => {
    if (!code.trim()) {
      toast.error(t('代码为空，请先插入生成结果'))
      return
    }
    setPreviewCode(code)
  }

  const openRename = () => {
    if (!projectId) {
      toast.error(t('请先创建或打开一个项目'))
      return
    }
    setRenameValue(projectTitle)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    if (!projectId || renaming) return
    const title = renameValue.trim()
    if (!title) {
      toast.error(t('请输入项目名称'))
      return
    }
    setRenaming(true)
    try {
      await renameHtmlProject(projectId, title)
      setProjectTitle(title)
      setRenameOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ['workspace', 'html-projects'],
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

  return (
    <div className='workspace-enter flex flex-col gap-4'>
      <div className='flex flex-col gap-3 rounded-[16px] border border-[var(--ws-border)] bg-white p-4 shadow-[0_10px_30px_-24px_rgba(var(--ws-primary-rgb),.6)] sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='inline-flex items-center gap-1.5 rounded-full bg-[var(--ws-tint)] px-3 py-1.5 text-[13.5px] font-semibold text-[var(--ws-primary-text)]'>
            <Sparkles className='h-3.5 w-3.5' />
            {projectId ? projectTitle || t('未命名项目') : t('自由创作')}
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
                  {project.title || t('未命名项目')}
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

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)]'>
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
                  '直接描述你想要的网页，例如「做一个 BMI 计算器，输入身高体重后显示结果」；生成后可把代码插入编辑器并运行预览。'
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
                  !message.code && (
                    <div className='mt-2 inline-flex items-center gap-1 rounded-[8px] border border-[#ffe2c2] bg-[#fffaf2] px-2 py-1 text-[11.5px] font-semibold text-[#9a6a1f]'>
                      <AlertCircle className='h-3 w-3' />
                      {t('本次未生成代码')}
                    </div>
                  )}
                {message.role === 'assistant' && message.code && (
                  <button
                    type='button'
                    className='mt-2 flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-[var(--ws-primary)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90'
                    onClick={() => insertCode(message.code as string)}
                  >
                    <Code2 className='h-3.5 w-3.5' />
                    {t('插入到代码')}
                  </button>
                )}
              </div>
            ))}
            {sending && (
              <div className='flex items-center gap-2 rounded-[12px] bg-[var(--ws-tint-2)] px-3.5 py-3 text-[13.5px] text-[var(--ws-primary-text)]'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                {t('AI 正在编写代码')} · {elapsed}s
              </div>
            )}
          </div>
          <div className='border-t border-[var(--ws-tint)] p-3'>
            <textarea
              className='h-[88px] w-full resize-none rounded-[10px] border border-[var(--ws-border)] bg-[var(--ws-tint-2)] px-3 py-2 text-[13.5px] leading-7 text-[var(--ws-ink-2)] outline-none focus:border-[var(--ws-primary)]'
              placeholder={t('描述你想要的网页效果…')}
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

        {/* 中：代码编辑器 */}
        <section className='flex min-h-[560px] flex-col rounded-[16px] border border-[var(--ws-border)] bg-white shadow-[0_10px_30px_-26px_rgba(25,24,51,.35)]'>
          <div className='flex items-center justify-between gap-2 border-b border-[var(--ws-tint)] px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Code2 className='h-4 w-4 text-[var(--ws-primary-text)]' />
              <span className='text-[14px] font-bold text-[var(--ws-ink)]'>
                {t('代码编辑器')}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                className='rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
                onClick={() => setCode((prev) => prev || EMPTY_TEMPLATE)}
              >
                {t('示例模板')}
              </button>
              <button
                type='button'
                className='inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--ws-primary)] px-3 py-1 text-[13px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90'
                onClick={runPreview}
              >
                <Play className='h-3.5 w-3.5' />
                {t('运行')}
              </button>
            </div>
          </div>
          <textarea
            className='flex-1 resize-none rounded-b-[16px] bg-[var(--ws-tint-2)] px-4 py-3 font-mono text-[13px] leading-6 text-[var(--ws-ink-2)] outline-none'
            spellCheck={false}
            placeholder={t('在这里编辑 HTML 代码，或从左侧对话中插入生成结果…')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </section>

        {/* 右：运行预览 */}
        <section className='flex min-h-[560px] flex-col rounded-[16px] border border-[var(--ws-border)] bg-white shadow-[0_10px_30px_-26px_rgba(25,24,51,.35)]'>
          <div className='flex items-center justify-between gap-2 border-b border-[var(--ws-tint)] px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Play className='h-4 w-4 text-[var(--ws-primary-text)]' />
              <span className='text-[14px] font-bold text-[var(--ws-ink)]'>
                {t('运行预览')}
              </span>
            </div>
            <button
              type='button'
              className='rounded-[8px] border border-[var(--ws-border)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-primary)] hover:text-[var(--ws-primary-text)]'
              onClick={runPreview}
            >
              {t('刷新')}
            </button>
          </div>
          <div className='flex-1 overflow-hidden rounded-b-[16px] bg-[var(--ws-tint-2)]'>
            {previewCode.trim() ? (
              <iframe
                className='h-full min-h-[440px] w-full border-0 bg-white'
                sandbox='allow-scripts allow-same-origin allow-forms allow-modals'
                srcDoc={previewCode}
                title='HTML 预览'
              />
            ) : (
              <div className='flex h-full min-h-[440px] items-center justify-center px-6 text-center text-[13.5px] leading-7 text-[var(--ws-muted-2)]'>
                {t('插入代码后点击「运行」，这里会显示网页效果')}
              </div>
            )}
          </div>
        </section>
      </div>

      {config && !config.enabled && (
        <div className='rounded-[12px] border border-[#ffe2c2] bg-[#fffaf2] px-4 py-3 text-[13.5px] text-[#9a6a1f]'>
          {t(
            '管理员尚未在模型管理中声明可用于 HTML 编程的模型，请联系老师开通后再使用。'
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
