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
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { AudioPlayer, VideoPlayer } from '@/components/ui/media-player'
import {
  createTaskSubmission,
  uploadTaskSubmissionFile,
} from '@/features/workspace/api'
import type {
  WorkspaceClassSession,
  WorkspaceClassSessionTask,
  WorkspaceTaskSubmission,
} from '@/features/workspace/types'
import { cn } from '@/lib/utils'

interface ClassTaskPanelProps {
  session: WorkspaceClassSession | null
  tasks: WorkspaceClassSessionTask[]
  onRefresh: () => void
  /** page=「我的任务」独立页形态（常驻展开）；floating=开始创作页内悬浮面板（可收起）。 */
  variant?: 'page' | 'floating'
}

function parseForms(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function SubmissionItem(props: { item: WorkspaceTaskSubmission }) {
  const { t } = useTranslation()
  const { item } = props
  // 按 URL 扩展名细分媒体类型：https 的视频/音频地址不能当作图片渲染。
  const assetUrl = item.content_type === 'ai' ? (item.asset_url ?? '') : ''
  const assetPath = assetUrl.split(/[?#]/)[0]?.toLowerCase() ?? ''
  const isVideo =
    item.content_type === 'ai' &&
    !!assetUrl &&
    (/^data:video\//i.test(assetUrl) ||
      /\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(assetPath))
  const isAudio =
    item.content_type === 'ai' &&
    !!assetUrl &&
    (/^data:audio\//i.test(assetUrl) ||
      /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/.test(assetPath))
  const isImage =
    item.content_type === 'ai' &&
    !!assetUrl &&
    !isVideo &&
    !isAudio &&
    /^(data:image\/|https?:|\/)/i.test(assetUrl)

  return (
    <div className='mt-2 rounded-[10px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-3 py-2'>
      <div className='flex items-center justify-between gap-2 text-[11.5px] text-[var(--ws-muted-2)]'>
        <span className='font-semibold text-[var(--ws-primary-text)]'>
          {item.content_type === 'text'
            ? t('文字')
            : item.content_type === 'file'
              ? t('文件')
              : t('AI 作品')}
        </span>
        <span>{formatTime(item.created_at)}</span>
      </div>
      {item.content_type === 'text' && (
        <div className='mt-1 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ws-ink-2)]'>
          {item.text_content}
        </div>
      )}
      {item.content_type === 'file' && (
        <div className='mt-1 text-[12.5px] break-all text-[var(--ws-ink-2)]'>
          {item.file_name}
        </div>
      )}
      {item.content_type === 'ai' && (
        <div className='mt-1'>
          {isVideo && item.asset_url ? (
            <VideoPlayer
              src={item.asset_url}
              downloadName={item.task_title ?? 'AI-作品'}
              className='max-h-[240px] w-full'
            />
          ) : isAudio && item.asset_url ? (
            <AudioPlayer
              src={item.asset_url}
              downloadName={item.task_title ?? 'AI-作品'}
              className='w-full'
            />
          ) : isImage ? (
            <img
              alt={item.task_title ?? t('AI 作品')}
              className='max-h-[140px] w-auto rounded-[8px] border border-[var(--ws-tint)] object-contain'
              src={item.asset_url}
            />
          ) : (
            <div className='text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ws-ink-2)]'>
              {item.result_text || item.asset_url || ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TaskCard(props: {
  task: WorkspaceClassSessionTask
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const { task, onRefresh } = props
  const forms = parseForms(task.output_forms)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fileSubmissions = task.my_submissions.filter(
    (item) => item.content_type === 'file'
  )
  const maxUploads = task.max_uploads > 0 ? task.max_uploads : 1
  const fileFull = fileSubmissions.length >= maxUploads
  // 提交次数上限：含文字/文件/AI 作品，0 表示不限次数，无时间限制。
  const maxSubmits = task.max_submits > 0 ? task.max_submits : 0
  const submitFull = maxSubmits > 0 && task.my_submissions.length >= maxSubmits
  const accepts = task.allowed_extensions
    ? task.allowed_extensions
        .split(',')
        .filter(Boolean)
        .map((ext) => `.${ext}`)
        .join(',')
    : undefined

  const handleSubmitText = async () => {
    if (!text.trim()) {
      toast.error(t('请先填写文字内容'))
      return
    }
    setSubmitting(true)
    try {
      await createTaskSubmission({
        task_id: task.id,
        content_type: 'text',
        text: text.trim(),
      })
      setText('')
      toast.success(t('文字已提交'))
      onRefresh()
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? t('提交失败')
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitFile = async () => {
    if (!file) {
      toast.error(t('请先选择文件'))
      return
    }
    setSubmitting(true)
    try {
      await uploadTaskSubmissionFile(task.id, file)
      setFile(null)
      toast.success(t('文件已提交'))
      onRefresh()
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? t('提交失败')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='rounded-[12px] border border-[var(--ws-tint)] bg-white px-3.5 py-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='text-[13.5px] font-semibold text-[var(--ws-ink-2)]'>
            {task.title}
          </div>
          {task.requirement && (
            <div className='mt-1 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ws-muted)]'>
              {task.requirement}
            </div>
          )}
        </div>
        <div className='flex shrink-0 flex-wrap justify-end gap-1'>
          {forms.map((form) => (
            <span
              key={form}
              className='rounded-full bg-[var(--ws-tint)] px-2 py-[2px] text-[11px] font-medium text-[var(--ws-primary-text)]'
            >
              {form === 'text'
                ? t('文字')
                : form === 'file'
                  ? t('文件')
                  : t('AI 作品')}
            </span>
          ))}
        </div>
      </div>

      {(task.references ?? []).length > 0 && (
        <div className='mt-2 rounded-[9px] bg-[var(--ws-tint-2)] px-3 py-2'>
          <div className='text-[12px] font-semibold text-[var(--ws-primary-text)]'>
            {t('任务参考资料')}
          </div>
          <div className='mt-1 flex flex-wrap gap-1.5'>
            {(task.references ?? []).map((ref) =>
              ref.missing ? (
                <span
                  key={ref.id}
                  className='rounded-[7px] border border-[var(--ws-border)] bg-white px-2 py-1 text-[11.5px] text-[var(--ws-muted-2)]'
                >
                  {ref.name}（{t('已删除')}）
                </span>
              ) : (
                <a
                  key={ref.id}
                  className='rounded-[7px] border border-[var(--ws-border-strong)] bg-white px-2 py-1 text-[11.5px] font-medium text-[var(--ws-primary-text)] transition-opacity hover:opacity-80'
                  href={ref.url}
                  rel='noreferrer'
                  target='_blank'
                >
                  {ref.name}
                </a>
              )
            )}
          </div>
        </div>
      )}

      {forms.includes('text') && (
        <div className='mt-2'>
          <textarea
            className='min-h-[74px] w-full resize-y rounded-[9px] border border-[var(--ws-border)] bg-[var(--ws-tint-2)] px-3 py-2 text-[13px] text-[var(--ws-ink-2)] outline-none focus:border-[var(--ws-primary-light)]'
            onChange={(event) => setText(event.target.value)}
            placeholder={t('输入本次任务的文字内容')}
            value={text}
          />
          <div className='mt-1.5 flex justify-end'>
            <button
              className='rounded-[8px] bg-[var(--ws-primary)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90 disabled:opacity-50'
              disabled={submitting || submitFull}
              onClick={() => void handleSubmitText()}
              type='button'
            >
              {t('提交文字')}
            </button>
          </div>
        </div>
      )}

      {forms.includes('file') && (
        <div className='mt-2'>
          <input
            accept={accepts}
            className='hidden'
            id={`task-file-${task.id}`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type='file'
          />
          <div className='flex flex-wrap items-center gap-2'>
            <label
              className={cn(
                'cursor-pointer rounded-[8px] border border-[var(--ws-border-strong)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ws-primary-text)]',
                fileFull && 'cursor-not-allowed opacity-50'
              )}
              htmlFor={`task-file-${task.id}`}
            >
              {file ? t('重新选择') : t('选择文件')}
            </label>
            <span className='min-w-0 flex-1 truncate text-[12px] text-[var(--ws-muted-2)]'>
              {file ? file.name : t('支持 {{ext}}', { ext: accepts ?? '任意' })}
            </span>
            <button
              className='rounded-[8px] bg-[var(--ws-primary)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ws-on)] transition-opacity hover:opacity-90 disabled:opacity-50'
              disabled={submitting || fileFull || submitFull}
              onClick={() => void handleSubmitFile()}
              type='button'
            >
              {t('提交文件')}
            </button>
          </div>
          <div className='mt-1 text-[11.5px] text-[var(--ws-muted-2)]'>
            {t('已提交 {{count}} / {{max}} 个文件', {
              count: fileSubmissions.length,
              max: maxUploads,
            })}
          </div>
        </div>
      )}

      {forms.includes('ai') && (
        <div className='mt-2 rounded-[8px] bg-[var(--ws-tint)] px-3 py-2 text-[12px] text-[var(--ws-primary-text)]'>
          {submitFull
            ? t('该任务提交次数已达上限（{{max}} 次），无法继续提交。', {
                max: maxSubmits,
              })
            : t('请在下方生成结果处选择「提交到课堂任务」提交 AI 作品。')}
        </div>
      )}

      {submitFull && (
        <div className='mt-2 text-[11.5px] text-[var(--ws-muted-2)]'>
          {t('已提交 {{count}} / {{max}} 次（无时间限制）', {
            count: task.my_submissions.length,
            max: maxSubmits,
          })}
        </div>
      )}

      {task.my_submissions.map((item) => (
        <SubmissionItem item={item} key={item.id} />
      ))}
    </div>
  )
}

/** 学生端课堂任务面板（E1/E2/E6）。
 * page：「我的任务」独立页形态，常驻展开、不可折叠；
 * floating：开始创作页内的悬浮面板，收起为右下角浮动按钮，展开为浮层覆盖创作区。 */
export function ClassTaskPanel(props: ClassTaskPanelProps) {
  const { t } = useTranslation()
  const { session, tasks, onRefresh, variant = 'floating' } = props
  const isPage = variant === 'page'
  // 悬浮形态默认收起，避免遮挡创作区。
  const [collapsed, setCollapsed] = useState(!isPage)

  const submitted = session?.my_submission_count ?? 0
  const total = tasks.length
  const sessionLabel = session
    ? [session.unit_name, session.theme || session.lesson_title]
        .filter(Boolean)
        .join(' / ') || t('当前课时')
    : ''

  const headerInfo = (
    <>
      <div className='mt-1 truncate text-[12px] text-[var(--ws-muted)]'>
        {sessionLabel || t('暂无进行中的课时')}
      </div>
      {session && (
        <div className='mt-0.5 truncate text-[11.5px] text-[var(--ws-muted-2)]'>
          {session.small_class_name}
          {session.small_class_code ? ` · ${session.small_class_code}` : ''}
          {' · '}
          {t('已提交 {{done}} / {{total}}', { done: submitted, total })}
        </div>
      )}
    </>
  )

  const taskList = (
    <div
      className={cn(
        'mt-3 flex flex-col gap-2 pr-0.5',
        isPage ? '' : 'max-h-[calc(100vh-220px)] overflow-y-auto'
      )}
    >
      {!session || tasks.length === 0 ? (
        <div
          className={cn(
            'rounded-[10px] bg-[var(--ws-tint-2)] px-3 py-4 text-center text-[12.5px] text-[var(--ws-muted-2)]',
            isPage && 'px-4 py-10 text-[13.5px]'
          )}
        >
          {session
            ? t('本课时暂无任务')
            : t('老师还没有发布课堂任务，稍后再来看看吧')}
        </div>
      ) : (
        tasks.map((task) => (
          <TaskCard key={task.id} onRefresh={onRefresh} task={task} />
        ))
      )}
    </div>
  )

  // ---------- 独立页形态：常驻展开的大卡片 ----------
  if (isPage) {
    return (
      <div
        className='workspace-enter overflow-hidden rounded-[18px] border border-[var(--ws-border)] bg-white shadow-[0_26px_60px_-40px_rgba(25,24,51,.7)]'
        style={{ animationDelay: '40ms' }}
      >
        <div className='flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ws-tint-2)] bg-[var(--ws-surface)] px-6 py-5'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 text-[16px] font-bold tracking-[-.01em] text-[var(--ws-ink)]'>
              <ClipboardList className='size-[18px] text-[var(--ws-primary-text)]' />
              {t('我的任务')}
            </div>
            {headerInfo}
          </div>
          <div className='flex shrink-0 items-center gap-3'>
            {session && (
              <span className='rounded-full bg-[var(--ws-tint)] px-3 py-1 text-[11.5px] font-semibold text-[var(--ws-primary-text)]'>
                {t('已提交 {{done}} / {{total}}', { done: submitted, total })}
              </span>
            )}
            <button
              className='rounded-[8px] p-1.5 text-[var(--ws-muted-2)] transition-colors hover:bg-[var(--ws-tint)] hover:text-[var(--ws-primary-text)]'
              onClick={onRefresh}
              title={t('刷新')}
              type='button'
            >
              <RefreshCw className='size-4' />
            </button>
          </div>
        </div>
        <div
          className={cn('grid gap-3 p-5', tasks.length > 0 && 'md:grid-cols-2')}
        >
          {!session || tasks.length === 0 ? (
            <div className='rounded-[10px] bg-[var(--ws-tint-2)] px-4 py-10 text-center text-[13.5px] text-[var(--ws-muted-2)] md:col-span-2'>
              {session
                ? t('本课时暂无任务')
                : t('老师还没有发布课堂任务，稍后再来看看吧')}
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard key={task.id} onRefresh={onRefresh} task={task} />
            ))
          )}
        </div>
      </div>
    )
  }

  // ---------- 悬浮形态：无任务时不打扰创作区 ----------
  if (!session || tasks.length === 0) return null

  if (collapsed) {
    return (
      <button
        className='fixed right-6 bottom-10 z-40 flex items-center gap-2 rounded-[14px] border border-[var(--ws-border)] bg-white px-3.5 py-3 text-[12.5px] font-semibold text-[var(--ws-primary-text)] shadow-[0_18px_40px_-24px_rgba(25,24,51,.7)] transition-colors hover:bg-[var(--ws-tint-2)] md:right-8'
        onClick={() => setCollapsed(false)}
        type='button'
      >
        <ChevronLeft className='size-4' />
        <span>{t('课堂任务')}</span>
        <span className='rounded-full bg-[var(--ws-tint)] px-1.5 text-[11px] text-[var(--ws-primary-text)] tabular-nums'>
          {total}
        </span>
      </button>
    )
  }

  return (
    <aside className='fixed right-6 bottom-10 z-40 max-h-[calc(100vh-140px)] w-full overflow-y-auto rounded-[16px] border border-[var(--ws-border)] bg-white p-3 shadow-[0_18px_40px_-32px_rgba(25,24,51,.7)] md:right-8 xl:w-[360px]'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='flex items-center gap-1.5 text-[14px] font-bold text-[var(--ws-ink-2)]'>
            <ClipboardList className='size-4 text-[var(--ws-primary-text)]' />
            {t('课堂任务')}
          </div>
          {headerInfo}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <button
            className='rounded-[8px] p-1.5 text-[var(--ws-muted-2)] transition-colors hover:bg-[var(--ws-tint)] hover:text-[var(--ws-primary-text)]'
            onClick={onRefresh}
            title={t('刷新')}
            type='button'
          >
            <RefreshCw className='size-4' />
          </button>
          <button
            className='rounded-[8px] p-1.5 text-[var(--ws-muted-2)] transition-colors hover:bg-[var(--ws-tint)] hover:text-[var(--ws-primary-text)]'
            onClick={() => setCollapsed(true)}
            title={t('收起')}
            type='button'
          >
            <ChevronRight className='size-4' />
          </button>
        </div>
      </div>
      {taskList}
    </aside>
  )
}
