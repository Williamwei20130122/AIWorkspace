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
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Check,
  FileText,
  Image as ImageIcon,
  Music,
  PenLine,
  Video,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchRecords } from '@/features/ai-hub/api'
import type { AiHubRecord } from '@/features/ai-hub/types'
import {
  fetchMyClassSession,
  fetchWorkspaceCapabilities,
  fetchWorkspacePoints,
  fetchWorkspaceStudentProfile,
  updateWorkspaceStudentPassword,
  updateWorkspaceTheme,
} from '@/features/workspace/api'
import { ClassTaskPanel } from '@/features/workspace/components/class-task-panel'
import { GeneratePanel } from '@/features/workspace/components/generate-panel'
import { HtmlLab } from '@/features/workspace/components/html-lab'
import { SlideLab } from '@/features/workspace/components/slide-lab'
import type { WorkspaceCapabilityKind } from '@/features/workspace/types'
import { clearAuthenticatedClientState } from '@/lib/auth-session'
import { formatPoints } from '@/lib/format'
import { api } from '@/lib/http-client'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const KIND_ICON: Record<WorkspaceCapabilityKind, LucideIcon> = {
  text: FileText,
  image: ImageIcon,
  edit: PenLine,
  tts: Volume2,
  video: Video,
  music: Music,
}

function CapabilityIcon(props: {
  kind: WorkspaceCapabilityKind
  className?: string
}) {
  const Icon = KIND_ICON[props.kind] ?? FileText
  return <Icon className={props.className} />
}

const KIND_LABEL: Record<string, string> = {
  text: '文生文',
  image: '文生图',
  edit: '图生图',
  tts: '声音合成',
  video: '视频生成',
  music: '音乐生成',
  html: 'HTML 实验室',
  slide: '演示实验室',
}

type WorkspaceThemeId = 'story' | 'juice' | 'cloud' | 'quest'

/** 学生端界面主题（与 styles/workspace-themes.css 中的变量定义一一对应）。 */
const WORKSPACE_THEMES: {
  id: WorkspaceThemeId
  label: string
  swatch: [string, string, string]
}[] = [
  { id: 'cloud', label: '云朵泡泡', swatch: ['#6ec8ff', '#c6a8ff', '#f3faff'] },
  { id: 'story', label: '绘本世界', swatch: ['#e8836b', '#8fbf9f', '#fdf6ec'] },
  { id: 'juice', label: '果汁工厂', swatch: ['#ff9a3d', '#ff5d5d', '#fff9ec'] },
  { id: 'quest', label: '萌绿闯关', swatch: ['#58cc02', '#ffc800', '#f4fbec'] },
]

/** 从账户设置 JSON 读取界面主题，非法或缺失时回落到默认的云朵泡泡。 */
function readWorkspaceTheme(
  setting?: Record<string, unknown> | string
): WorkspaceThemeId {
  let parsed: unknown = setting
  if (typeof setting === 'string') {
    try {
      parsed = JSON.parse(setting)
    } catch {
      return 'cloud'
    }
  }
  const value = (parsed as { workspace_theme?: unknown } | null | undefined)
    ?.workspace_theme
  return WORKSPACE_THEMES.some((theme) => theme.id === value)
    ? (value as WorkspaceThemeId)
    : 'cloud'
}

const RECORD_STATUS: Record<
  string,
  { label: string; dot: string; pill: string }
> = {
  SUCCESS: {
    label: '成功',
    dot: 'bg-[#22c55e]',
    pill: 'bg-[#e9f9ef] text-[#15803d]',
  },
  FAILURE: {
    label: '失败',
    dot: 'bg-[#ef4444]',
    pill: 'bg-[#fdeeee] text-[#dc2626]',
  },
  IN_PROGRESS: {
    label: '生成中',
    dot: 'bg-[#f59e0b]',
    pill: 'bg-[#fef5e7] text-[#b45309]',
  },
  QUEUED: {
    label: '排队中',
    dot: 'bg-[#f59e0b]',
    pill: 'bg-[#fef5e7] text-[#b45309]',
  },
  SUBMITTED: {
    label: '排队中',
    dot: 'bg-[#f59e0b]',
    pill: 'bg-[#fef5e7] text-[#b45309]',
  },
  NOT_START: {
    label: '排队中',
    dot: 'bg-[#f59e0b]',
    pill: 'bg-[#fef5e7] text-[#b45309]',
  },
}

const FALLBACK_STATUS = {
  dot: 'bg-[var(--ws-muted-2)]',
  pill: 'bg-[var(--ws-tint-2)] text-[var(--ws-muted)]',
}

const SCROLL_CLASS =
  '[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--ws-border-strong)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--ws-border-strong)]'

function formatRecordTime(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function splitPoints(points: number | null | undefined): {
  value: string
  unit: string
} {
  const formatted = formatPoints(points)
  const matched = formatted.replace(/\s*点$/, '')
  return { value: matched, unit: '点' }
}

function isImageUrl(value: string): boolean {
  return /^(https?:\/\/|data:image\/).+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(
    value.trim()
  )
}

export function WorkspaceStudio() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const [activeId, setActiveId] = useState('')
  const [view, setView] = useState<
    'create' | 'tasks' | 'html' | 'slide' | 'records' | 'account'
  >('create')
  const [detailRecord, setDetailRecord] = useState<AiHubRecord | null>(null)
  const [pointsOpen, setPointsOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingTheme, setSavingTheme] = useState(false)
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [workspaceTheme, setWorkspaceTheme] = useState<WorkspaceThemeId>(() =>
    readWorkspaceTheme(user?.setting)
  )

  // 账户设置中的主题变化时同步（含登录态刷新后首次拿到 setting）
  useEffect(() => {
    const theme = readWorkspaceTheme(user?.setting)
    setWorkspaceTheme((current) => (current === theme ? current : theme))
  }, [user?.setting])

  // 把当前主题写到 <html data-ws-theme>；未写入时 CSS :root 兜底为云朵泡泡
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ws-theme', workspaceTheme)
  }, [workspaceTheme])

  const capabilitiesQuery = useQuery({
    queryKey: ['workspace', 'capabilities'],
    queryFn: fetchWorkspaceCapabilities,
  })
  const capabilities = capabilitiesQuery.data?.capabilities ?? []
  // 所在小班未开通 AI 课程时隐藏全部 AI 生成入口（历史记录与账户页仍可见）。
  const aiEnabled = capabilitiesQuery.data?.ai_enabled ?? true
  // HTML 实验室按小班开关独立控制（默认关闭）。
  const htmlEnabled = capabilitiesQuery.data?.html_enabled ?? true
  // 演示实验室按小班开关独立控制（默认关闭）。
  const slideEnabled = capabilitiesQuery.data?.slide_enabled ?? true

  const isTeacher = (user?.role ?? 0) >= ROLE.ADMIN

  // 当前课堂会话与分项任务：教师分发课时后学生自动加载，含本人历史提交（E6）。
  const classSessionQuery = useQuery({
    queryKey: ['workspace', 'class-session'],
    queryFn: fetchMyClassSession,
    enabled: !isTeacher,
    refetchInterval: 60000,
  })
  const classSession = classSessionQuery.data?.session ?? null
  const classTasks = classSessionQuery.data?.tasks ?? []
  const refreshClassSession = () => {
    void classSessionQuery.refetch()
  }

  const enabledCapabilities = capabilities.filter((item) => item.enabled)
  const active =
    enabledCapabilities.find((item) => item.id === activeId) ??
    enabledCapabilities[0]

  const recordsQuery = useQuery({
    queryKey: ['workspace', 'my-records'],
    queryFn: () => fetchRecords({ page: 1, page_size: 50 }, false),
    enabled: view === 'records' || view === 'account',
  })
  const records = recordsQuery.data?.items ?? []

  const displayName = user?.display_name || user?.username || ''
  const points = splitPoints(user?.quota)

  // AI 未开通：隐藏「开始创作」与「HTML 实验室」，默认落在「我的记录」。
  useEffect(() => {
    if (!aiEnabled && !isTeacher && (view === 'create' || view === 'html')) {
      setView('records')
    }
    if (!htmlEnabled && !isTeacher && view === 'html') {
      setView('records')
    }
    if (!slideEnabled && !isTeacher && view === 'slide') {
      setView('records')
    }
  }, [aiEnabled, htmlEnabled, slideEnabled, isTeacher, view])

  // 学生端默认页签：无任何任务 → 开始创作；当前课时无 AI 产出任务 → 我的任务；有 AI 任务 → 开始创作。
  const [defaultApplied, setDefaultApplied] = useState(false)
  useEffect(() => {
    if (defaultApplied || isTeacher || classSessionQuery.isLoading) return
    setDefaultApplied(true)
    if (classTasks.length === 0) {
      setView(aiEnabled ? 'create' : 'records')
      return
    }
    const hasAiTask = classTasks.some((task) =>
      task.output_forms
        .split(',')
        .map((item) => item.trim())
        .includes('ai')
    )
    setView(hasAiTask || !aiEnabled ? 'create' : 'tasks')
  }, [
    defaultApplied,
    isTeacher,
    classSessionQuery.isLoading,
    classTasks,
    aiEnabled,
  ])

  const profileQuery = useQuery({
    queryKey: ['workspace', 'student-profile'],
    queryFn: fetchWorkspaceStudentProfile,
    enabled: !isTeacher && view === 'account',
  })

  const pointsQuery = useQuery({
    queryKey: ['workspace', 'points'],
    queryFn: fetchWorkspacePoints,
    enabled: view === 'account',
  })
  const pointSummary = pointsQuery.data
  const recentConsumes = (recordsQuery.data?.items ?? [])
    .filter((item) => (item.points ?? 0) > 0)
    .slice(0, 6)

  const handleSelectTheme = async (theme: WorkspaceThemeId) => {
    if (theme === workspaceTheme || savingTheme) return
    const previousTheme = workspaceTheme
    // 先即时换肤，保存失败再回滚
    setWorkspaceTheme(theme)
    setSavingTheme(true)
    try {
      await updateWorkspaceTheme(theme)
      if (user) {
        let existingSetting: Record<string, unknown> = {}
        if (typeof user.setting === 'string') {
          try {
            existingSetting = JSON.parse(user.setting) as Record<
              string,
              unknown
            >
          } catch {
            existingSetting = {}
          }
        } else if (user.setting) {
          existingSetting = user.setting
        }
        setUser({
          ...user,
          setting: JSON.stringify({
            ...existingSetting,
            workspace_theme: theme,
          }),
        })
      }
      toast.success(t('界面主题已保存'))
    } catch (error) {
      setWorkspaceTheme(previousTheme)
      toast.error(
        (error as Error)?.message || t('界面主题保存失败，请稍后重试')
      )
    } finally {
      setSavingTheme(false)
    }
  }

  const handleSavePassword = async () => {
    if (newPassword.trim().length < 6) {
      toast.error(t('密码长度不能少于 6 位'))
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('两次输入的密码不一致'))
      return
    }
    setSavingPassword(true)
    try {
      await updateWorkspaceStudentPassword(
        oldPassword.trim(),
        newPassword.trim()
      )
      toast.success(t('登录密码已保存，下次登录需输入密码'))
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await profileQuery.refetch()
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? t('密码设置失败')
      )
    } finally {
      setSavingPassword(false)
    }
  }

  const handleLogout = async () => {
    try {
      await api.get('/api/user/logout')
    } catch {
      // 登出失败不阻断本地会话清理
    }
    clearAuthenticatedClientState(queryClient, false)
    await navigate({ to: '/sign-in-student' })
  }

  return (
    <div className='relative min-h-screen overflow-x-hidden bg-[var(--ws-bg)] text-[var(--ws-ink)]'>
      <div aria-hidden className='pointer-events-none fixed inset-0 z-0'>
        <div
          className='absolute inset-0'
          style={{
            background:
              'radial-gradient(900px 520px at 8% -10%, var(--ws-aurora-1), transparent 62%), radial-gradient(760px 480px at 96% 2%, var(--ws-aurora-2), transparent 64%), radial-gradient(820px 560px at 50% 112%, var(--ws-aurora-3), transparent 66%)',
          }}
        />
        <div
          className='absolute inset-0 opacity-60'
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(var(--ws-primary-rgb),.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(var(--ws-primary-rgb),.055) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
            maskImage:
              'radial-gradient(1100px 700px at 50% 0%, #000 20%, transparent 78%)',
            WebkitMaskImage:
              'radial-gradient(1100px 700px at 50% 0%, #000 20%, transparent 78%)',
          }}
        />
      </div>

      <div className='relative z-10'>
        <header className='sticky top-0 z-30 border-b border-[var(--ws-border)] bg-white/95'>
          <div className='flex h-16 w-full items-center justify-between gap-4 px-6 md:px-8'>
            <div className='flex items-center gap-3'>
              <span className='flex h-9 w-9 items-center justify-center rounded-[11px] bg-gradient-to-br from-[var(--ws-primary-light)] to-[var(--ws-primary-hover)] text-[13px] font-extrabold tracking-[.5px] text-[var(--ws-on)] shadow-[0_8px_18px_-6px_rgba(var(--ws-primary-rgb),.75)]'>
                AI
              </span>
              <div className='leading-tight'>
                <div className='text-[15px] font-bold tracking-[-.01em]'>
                  {t('AI 创作工坊')}
                </div>
                <div className='mt-[2px] text-[11px] text-[var(--ws-muted)]'>
                  {t('校园多模态生成中台')}
                </div>
              </div>
            </div>

            <div className='flex items-center gap-3'>
              <div className='hidden items-center gap-2.5 rounded-full border border-[var(--ws-tint)] bg-white/70 py-1 pr-3.5 pl-1 md:flex'>
                <span className='flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[var(--ws-primary-light)] to-[var(--ws-primary)] text-[11px] font-bold text-[var(--ws-on)]'>
                  {displayName.slice(0, 1) || 'U'}
                </span>
                <span className='text-[13px] font-medium text-[var(--ws-ink-2)]'>
                  {displayName}
                </span>
              </div>
              {isTeacher && (
                <>
                  <Link
                    className='rounded-[9px] bg-gradient-to-br from-[var(--ws-primary-light)] to-[var(--ws-primary-hover)] px-3.5 py-2 text-[13.5px] font-semibold text-[var(--ws-on)] shadow-[0_10px_20px_-12px_rgba(var(--ws-primary-rgb),.95)] transition-opacity hover:opacity-90'
                    to='/studio'
                  >
                    {t('专业版')}
                  </Link>
                  <Link
                    className='rounded-[9px] bg-[var(--ws-tint)] px-3.5 py-2 text-[13.5px] font-semibold text-[var(--ws-primary-text)] transition-colors hover:bg-[var(--ws-tint)]'
                    to='/dashboard'
                  >
                    {t('管理中心')}
                  </Link>
                </>
              )}
              <button
                type='button'
                className='text-[13px] text-[var(--ws-muted-2)] transition-colors hover:text-[#ef4444]'
                onClick={() => void handleLogout()}
              >
                {t('退出')}
              </button>
            </div>
          </div>
        </header>

        <div className='w-full px-6 py-5 pb-10 md:px-8'>
          <div className='flex flex-col gap-5 xl:flex-row xl:items-start'>
            <div className='min-w-0 flex-1'>
              <div className='mb-4 inline-flex rounded-[13px] border border-[var(--ws-border)] bg-white p-1 shadow-[0_1px_2px_rgba(25,24,51,.05)]'>
                {(() => {
                  if (!aiEnabled && !isTeacher) {
                    return ['tasks', 'records', 'account'] as const
                  }
                  const keys: string[] = ['create']
                  if (!isTeacher) keys.push('tasks')
                  if (aiEnabled || isTeacher) {
                    if (htmlEnabled || isTeacher) keys.push('html')
                    if (slideEnabled || isTeacher) keys.push('slide')
                  }
                  keys.push('records')
                  if (!isTeacher) keys.push('account')
                  return keys as (typeof view)[]
                })().map((key) => (
                  <button
                    key={key}
                    type='button'
                    className={cn(
                      'rounded-[9px] px-5 py-2 text-[14px] font-semibold transition-colors',
                      view === key
                        ? 'bg-[var(--ws-primary)] text-[var(--ws-on)] shadow-[0_6px_16px_-6px_rgba(var(--ws-primary-rgb),.85)]'
                        : 'text-[var(--ws-muted)] hover:text-[var(--ws-primary-text)]'
                    )}
                    onClick={() => setView(key)}
                  >
                    {key === 'create' ? (
                      t('开始创作')
                    ) : key === 'tasks' ? (
                      t('我的任务')
                    ) : key === 'html' || key === 'slide' ? (
                      <span className='inline-flex items-center gap-1.5'>
                        {key === 'html' ? t('HTML 实验室') : t('演示实验室')}
                        <span className='rounded-full bg-[var(--ws-tint)] px-1.5 py-[1px] text-[10px] font-bold tracking-wide text-[var(--ws-primary-text)] uppercase'>
                          Beta
                        </span>
                      </span>
                    ) : key === 'records' ? (
                      t('我的记录')
                    ) : (
                      t('账户管理')
                    )}
                  </button>
                ))}
              </div>

              {view === 'create' && aiEnabled && (
                <>
                  <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                    <div
                      className='workspace-enter flex flex-wrap items-baseline gap-x-3 gap-y-1'
                      style={{ animationDelay: '40ms' }}
                    >
                      <h1 className='text-[19px] leading-[1.3] font-extrabold tracking-[-.02em] text-[var(--ws-ink)]'>
                        {t('今天想创造什么？')}
                      </h1>
                      <p className='text-[13.5px] text-[var(--ws-muted)]'>
                        {t('选择一种能力，每次生成会消耗对应的课堂点数。')}
                      </p>
                    </div>

                    <div
                      className='workspace-enter inline-flex shrink-0 items-center gap-2.5 rounded-full border border-[var(--ws-border)] bg-white px-4 py-[7px] shadow-[0_10px_24px_-18px_rgba(var(--ws-primary-rgb),.9)]'
                      style={{ animationDelay: '120ms' }}
                    >
                      <span className='text-[12px] font-medium text-[var(--ws-muted)]'>
                        {t('我的可用额度')}
                      </span>
                      <span className='flex items-baseline gap-1'>
                        <span className='text-[21px] leading-none font-extrabold tracking-[-.02em] text-[var(--ws-primary-text)] tabular-nums'>
                          {points.value}
                        </span>
                        <span className='text-[13.5px] font-bold text-[var(--ws-primary-text)]'>
                          {points.unit}
                        </span>
                      </span>
                    </div>
                  </div>

                  {capabilitiesQuery.isLoading && (
                    <p className='text-[13px] text-[var(--ws-muted-2)]'>
                      {t('正在加载能力…')}
                    </p>
                  )}
                  {capabilitiesQuery.isError && (
                    <p className='rounded-[12px] border border-[#fee2e2] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#dc2626]'>
                      {t('能力列表加载失败，请刷新重试')}
                    </p>
                  )}
                  {!capabilitiesQuery.isLoading &&
                    !capabilitiesQuery.isError && (
                      <>
                        {enabledCapabilities.length === 0 && (
                          <p className='mb-4 rounded-[12px] border border-[var(--ws-border)] bg-white/70 px-4 py-3 text-[13px] text-[var(--ws-muted-2)]'>
                            {t('暂无可用生成能力，请联系老师开通')}
                          </p>
                        )}

                        {capabilities.length > 0 && (
                          <div className='mb-2.5 flex items-baseline justify-between'>
                            <h2 className='text-[14px] font-bold tracking-[-.01em] text-[var(--ws-ink)]'>
                              {t('选择创作能力')}
                            </h2>
                            <span className='text-[11.5px] text-[var(--ws-muted-2)]'>
                              {t('共')} {capabilities.length} {t('种')}
                            </span>
                          </div>
                        )}

                        <div className='mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6'>
                          {capabilities.map((capability, index) => {
                            const selected = capability.id === active?.id
                            const modelCount = capability.models?.length ?? 0
                            const locked = !capability.enabled
                            return (
                              <button
                                key={capability.id}
                                type='button'
                                disabled={locked}
                                title={
                                  !capability.enabled
                                    ? capability.desc
                                    : modelCount > 1
                                      ? `${capability.desc} · ${t('共')} ${modelCount} ${t('个模型')}`
                                      : `${capability.desc}${modelCount === 1 ? ` · ${capability.models?.[0]}` : ''}`
                                }
                                className={cn(
                                  'workspace-enter group flex items-center gap-2.5 rounded-[14px] border bg-white px-3 py-3 text-left transition-colors duration-200',
                                  selected
                                    ? 'border-[var(--ws-border-strong)] bg-gradient-to-b from-white to-[var(--ws-tint-2)] shadow-[0_0_0_1.5px_var(--ws-primary),0_18px_34px_-22px_rgba(var(--ws-primary-rgb),.95)]'
                                    : 'border-[var(--ws-border)] shadow-[0_1px_2px_rgba(25,24,51,.04)] hover:-translate-y-[2px] hover:border-[var(--ws-border-strong)] hover:shadow-[0_16px_30px_-24px_rgba(25,24,51,.6)]',
                                  locked &&
                                    'cursor-not-allowed opacity-55 hover:translate-y-0 hover:border-[var(--ws-border)] hover:shadow-[0_1px_2px_rgba(25,24,51,.04)]'
                                )}
                                style={{
                                  animationDelay: `${160 + index * 45}ms`,
                                }}
                                onClick={() => setActiveId(capability.id)}
                              >
                                <span
                                  className={cn(
                                    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[15px] font-bold transition-colors',
                                    selected
                                      ? 'bg-gradient-to-br from-[var(--ws-primary-light)] to-[var(--ws-primary-hover)] text-[var(--ws-on)] shadow-[0_8px_16px_-9px_rgba(var(--ws-primary-rgb),.95)]'
                                      : 'bg-[var(--ws-tint)] text-[var(--ws-primary-text)] group-hover:bg-[var(--ws-tint)]'
                                  )}
                                >
                                  <CapabilityIcon
                                    kind={capability.kind}
                                    className='size-[19px]'
                                  />
                                  <span
                                    className={cn(
                                      'absolute -right-[3px] -top-[3px] h-[7px] w-[7px] rounded-full ring-2 ring-white',
                                      capability.enabled
                                        ? 'bg-[#22c55e]'
                                        : 'bg-[var(--ws-muted-2)]'
                                    )}
                                  />
                                </span>
                                <span className='min-w-0'>
                                  <span className='block truncate text-[13px] leading-tight font-bold tracking-[-.01em] text-[var(--ws-ink)]'>
                                    {capability.name}
                                  </span>
                                  <span
                                    className={cn(
                                      'mt-[3px] block truncate text-[10.5px] font-medium',
                                      capability.enabled
                                        ? 'text-[var(--ws-primary-text)]'
                                        : 'text-[var(--ws-muted-2)]'
                                    )}
                                  >
                                    {!capability.enabled
                                      ? t('未配置')
                                      : capability.points > 0
                                        ? `${capability.points} ${t('点')}${t('/次')}`
                                        : t('按模型计费')}
                                  </span>
                                </span>
                              </button>
                            )
                          })}
                        </div>

                        {active && (
                          <GeneratePanel
                            key={active.id}
                            capability={active}
                            icon={
                              <CapabilityIcon
                                kind={active.kind}
                                className='size-[19px]'
                              />
                            }
                            advanced={isTeacher}
                            onTaskSubmitted={refreshClassSession}
                            sessionTasks={isTeacher ? [] : classTasks}
                          />
                        )}
                      </>
                    )}
                </>
              )}

              {view === 'html' && htmlEnabled && <HtmlLab />}
              {view === 'slide' && slideEnabled && <SlideLab />}

              {view === 'tasks' && (
                <ClassTaskPanel
                  onRefresh={refreshClassSession}
                  session={classSession}
                  tasks={classTasks}
                  variant='page'
                />
              )}

              {view === 'records' && (
                <div
                  className='workspace-enter overflow-hidden rounded-[18px] border border-[var(--ws-border)] bg-white shadow-[0_26px_60px_-40px_rgba(25,24,51,.7)]'
                  style={{ animationDelay: '40ms' }}
                >
                  <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ws-tint-2)] bg-[var(--ws-surface)] px-6 py-5'>
                    <div>
                      <div className='text-[16px] font-bold tracking-[-.01em]'>
                        {t('我的生成记录')}
                      </div>
                      <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                        {t('这里可以看到你生成过的全部内容与消耗。')}
                      </div>
                    </div>
                    <span className='rounded-full bg-[var(--ws-tint)] px-3 py-1 text-[11.5px] font-semibold text-[var(--ws-primary-text)]'>
                      {t('共')} {recordsQuery.data?.total ?? 0} {t('条')}
                    </span>
                  </div>
                  <div className={cn('overflow-x-auto', SCROLL_CLASS)}>
                    <table className='w-full min-w-[720px] border-collapse text-left text-[13.5px]'>
                      <thead>
                        <tr className='bg-[var(--ws-surface)] text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                          <th className='px-6 py-3 font-semibold whitespace-nowrap'>
                            {t('时间')}
                          </th>
                          <th className='px-6 py-3 font-semibold whitespace-nowrap'>
                            {t('能力')}
                          </th>
                          <th className='px-6 py-3 font-semibold whitespace-nowrap'>
                            {t('模型')}
                          </th>
                          <th className='px-6 py-3 font-semibold'>
                            {t('内容摘要')}
                          </th>
                          <th className='px-6 py-3 font-semibold whitespace-nowrap'>
                            {t('状态')}
                          </th>
                          <th className='px-6 py-3 text-right font-semibold whitespace-nowrap'>
                            {t('消耗点数')}
                          </th>
                          <th className='px-6 py-3 text-right font-semibold whitespace-nowrap'>
                            {t('操作')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {recordsQuery.isLoading && (
                          <tr>
                            <td
                              colSpan={7}
                              className='px-6 py-14 text-center text-[13.5px] text-[var(--ws-muted-2)]'
                            >
                              {t('正在加载…')}
                            </td>
                          </tr>
                        )}
                        {!recordsQuery.isLoading && records.length === 0 && (
                          <tr>
                            <td
                              colSpan={7}
                              className='px-6 py-14 text-center text-[13.5px] text-[var(--ws-muted-2)]'
                            >
                              {t('还没有生成记录，去创作一个吧')}
                            </td>
                          </tr>
                        )}
                        {records.map((record: AiHubRecord) => {
                          const status = RECORD_STATUS[record.status]
                          const tone = status ?? FALLBACK_STATUS
                          const label = status?.label ?? record.status ?? '-'
                          return (
                            <tr
                              key={record.key}
                              className='border-b border-[var(--ws-tint-2)] transition-colors last:border-b-0 hover:bg-[var(--ws-tint-2)]'
                            >
                              <td className='px-6 py-3.5 whitespace-nowrap text-[var(--ws-muted-2)] tabular-nums'>
                                {formatRecordTime(record.created_at)}
                              </td>
                              <td className='px-6 py-3.5 font-medium whitespace-nowrap'>
                                {KIND_LABEL[record.capability] ||
                                  record.capability ||
                                  '-'}
                              </td>
                              <td className='px-6 py-3.5 whitespace-nowrap text-[var(--ws-muted)]'>
                                {record.model || '-'}
                              </td>
                              <td className='max-w-[300px] truncate px-6 py-3.5 text-[var(--ws-ink-2)]'>
                                {record.title || '-'}
                              </td>
                              <td className='px-6 py-3.5 whitespace-nowrap'>
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold',
                                    tone.pill
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'h-[5px] w-[5px] rounded-full',
                                      tone.dot
                                    )}
                                  />
                                  {label}
                                </span>
                              </td>
                              <td className='px-6 py-3.5 text-right font-semibold whitespace-nowrap text-[var(--ws-primary-text)] tabular-nums'>
                                {record.points ? record.points : '—'}
                              </td>
                              <td className='px-6 py-3.5 text-right whitespace-nowrap'>
                                <button
                                  className='rounded-[9px] border border-[var(--ws-border)] bg-white px-3 py-[6px] text-[12px] font-semibold text-[var(--ws-primary-text)] transition-colors hover:border-[var(--ws-border-strong)] hover:bg-[var(--ws-tint)]'
                                  onClick={() => setDetailRecord(record)}
                                  type='button'
                                >
                                  {t('详情')}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {view === 'account' && (
                <>
                  <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'>
                    <div className='workspace-enter rounded-[18px] border border-[var(--ws-border)] bg-white p-6'>
                      <div className='text-[16px] font-bold tracking-[-.01em] text-[var(--ws-ink)]'>
                        {t('我的账号')}
                      </div>
                      <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                        {t('账号信息由老师维护，如需修改请联系任课教师。')}
                      </div>
                      {profileQuery.isLoading ? (
                        <div className='mt-6 text-[13px] text-[var(--ws-muted-2)]'>
                          {t('正在加载账号信息…')}
                        </div>
                      ) : (
                        <div className='mt-4 divide-y divide-[var(--ws-tint-2)] text-[13px]'>
                          {[
                            [
                              t('姓名'),
                              profileQuery.data?.display_name || displayName,
                            ],
                            [t('学号'), profileQuery.data?.student_no || '-'],
                            [t('登录账号'), profileQuery.data?.username || '-'],
                            [
                              t('拼音登录名'),
                              profileQuery.data?.pinyin_username || '-',
                            ],
                            [
                              t('所属班级'),
                              profileQuery.data?.class?.class_name
                                ? `${profileQuery.data.class.class_name}${profileQuery.data.class.grade_name ? `（${profileQuery.data.class.grade_name}）` : ''}`
                                : '-',
                            ],
                            [t('剩余点数'), `${points.value} ${points.unit}`],
                          ].map(([label, value]) => (
                            <div
                              className='flex items-center justify-between gap-4 py-2.5'
                              key={String(label)}
                            >
                              <span className='text-[var(--ws-muted-2)]'>
                                {label}
                              </span>
                              <span className='font-semibold text-[var(--ws-ink-2)]'>
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className='mt-4 flex flex-wrap gap-2.5'>
                        <button
                          className='inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--ws-border)] bg-white px-4 text-[13.5px] font-semibold text-[var(--ws-primary-text)] transition-colors hover:border-[var(--ws-border-strong)] hover:bg-[var(--ws-tint)]'
                          onClick={() => setPointsOpen(true)}
                          type='button'
                        >
                          {t('查看剩余点数明细')}
                        </button>
                        <button
                          className='inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border border-[#f3dede] bg-white px-4 text-[13.5px] font-semibold text-[#c2410c] transition-colors hover:border-[#f6c9b8] hover:bg-[#fff7f3]'
                          onClick={() => void handleLogout()}
                          type='button'
                        >
                          {t('退出登录')}
                        </button>
                      </div>
                    </div>

                    <div className='workspace-enter rounded-[18px] border border-[var(--ws-border)] bg-white p-6'>
                      <div className='flex items-center gap-2'>
                        <span className='text-[16px] font-bold tracking-[-.01em] text-[var(--ws-ink)]'>
                          {t('登录密码')}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold',
                            profileQuery.data?.password_set
                              ? 'bg-[#e9f9ef] text-[#15803d]'
                              : 'bg-[var(--ws-tint-2)] text-[var(--ws-muted)]'
                          )}
                        >
                          {profileQuery.data?.password_set
                            ? t('已设置')
                            : t('未设置')}
                        </span>
                      </div>
                      <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                        {t(
                          '设置后登录必须输入密码；未设置时可凭学号或拼音登录名免密进入。'
                        )}
                      </div>
                      <div className='mt-5 grid gap-3'>
                        {profileQuery.data?.password_set && (
                          <label className='grid gap-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)]'>
                            {t('原密码')}
                            <input
                              className='h-11 rounded-[10px] border border-[var(--ws-border)] bg-white px-3 text-[13px] font-normal text-[var(--ws-ink)] transition-colors outline-none focus:border-[var(--ws-primary-light)]'
                              onChange={(event) =>
                                setOldPassword(event.target.value)
                              }
                              placeholder={t('请输入当前密码')}
                              type='password'
                              value={oldPassword}
                            />
                          </label>
                        )}
                        <label className='grid gap-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)]'>
                          {t('新密码')}
                          <input
                            className='h-11 rounded-[10px] border border-[var(--ws-border)] bg-white px-3 text-[13px] font-normal text-[var(--ws-ink)] transition-colors outline-none focus:border-[var(--ws-primary-light)]'
                            onChange={(event) =>
                              setNewPassword(event.target.value)
                            }
                            placeholder={t('至少 6 位')}
                            type='password'
                            value={newPassword}
                          />
                        </label>
                        <label className='grid gap-1.5 text-[13.5px] font-semibold text-[var(--ws-muted)]'>
                          {t('确认新密码')}
                          <input
                            className='h-11 rounded-[10px] border border-[var(--ws-border)] bg-white px-3 text-[13px] font-normal text-[var(--ws-ink)] transition-colors outline-none focus:border-[var(--ws-primary-light)]'
                            onChange={(event) =>
                              setConfirmPassword(event.target.value)
                            }
                            placeholder={t('再次输入新密码')}
                            type='password'
                            value={confirmPassword}
                          />
                        </label>
                        <button
                          className='mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-br from-[var(--ws-primary-light)] to-[var(--ws-primary-hover)] px-4 text-[13px] font-semibold text-[var(--ws-on)] shadow-[0_12px_24px_-14px_rgba(var(--ws-primary-rgb),.95)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
                          disabled={savingPassword || !profileQuery.data}
                          onClick={() => void handleSavePassword()}
                          type='button'
                        >
                          {savingPassword ? t('保存中…') : t('保存密码')}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className='workspace-enter mt-4 rounded-[18px] border border-[var(--ws-border)] bg-white p-6'>
                    <div className='text-[16px] font-bold tracking-[-.01em]'>
                      {t('界面主题')}
                    </div>
                    <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                      {t(
                        '挑选喜欢的配色，只影响你自己的学生端界面，随时可以更换。'
                      )}
                    </div>
                    <div className='mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                      {WORKSPACE_THEMES.map((theme) => {
                        const active = theme.id === workspaceTheme
                        return (
                          <button
                            key={theme.id}
                            className={cn(
                              'flex items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors',
                              active
                                ? 'border-[var(--ws-primary)] bg-[var(--ws-tint)]'
                                : 'border-[var(--ws-border)] hover:border-[var(--ws-border-strong)] hover:bg-[var(--ws-tint-2)]'
                            )}
                            disabled={savingTheme}
                            onClick={() => void handleSelectTheme(theme.id)}
                            type='button'
                          >
                            <span className='flex shrink-0 -space-x-1'>
                              {theme.swatch.map((color) => (
                                <span
                                  key={color}
                                  className='size-5 rounded-full border-2 border-white shadow-sm'
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </span>
                            <span className='flex-1 text-[13.5px] font-semibold text-[var(--ws-ink-2)]'>
                              {t(theme.label)}
                            </span>
                            {theme.id === 'cloud' && !active ? (
                              <span className='rounded-full bg-[var(--ws-tint-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ws-muted)]'>
                                {t('默认')}
                              </span>
                            ) : null}
                            {active ? (
                              <Check className='size-4 shrink-0 text-[var(--ws-primary-text)]' />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {pointsOpen && (
            <div
              className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--ws-ink)]/45 p-4 backdrop-blur-sm'
              onClick={() => setPointsOpen(false)}
            >
              <div
                className='flex max-h-[82vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-[var(--ws-border)] bg-white shadow-[0_40px_90px_-40px_rgba(25,24,51,.65)]'
                onClick={(event) => event.stopPropagation()}
              >
                <div className='flex items-start justify-between gap-4 border-b border-[var(--ws-tint-2)] bg-[var(--ws-surface)] px-6 py-5'>
                  <div>
                    <div className='text-[16px] font-bold tracking-[-.01em]'>
                      {t('剩余点数明细')}
                    </div>
                    <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                      {t('剩余点数、累计消耗与最近扣点记录。')}
                    </div>
                  </div>
                  <button
                    aria-label={t('关闭')}
                    className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--ws-border)] bg-white text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-primary-text)]'
                    onClick={() => setPointsOpen(false)}
                    type='button'
                  >
                    <X className='size-4' />
                  </button>
                </div>
                <div
                  className={cn(
                    'flex-1 overflow-y-auto px-6 py-5',
                    SCROLL_CLASS
                  )}
                >
                  {pointsQuery.isLoading ? (
                    <div className='py-8 text-center text-[13px] text-[var(--ws-muted-2)]'>
                      {t('正在加载点数信息…')}
                    </div>
                  ) : (
                    <>
                      <dl className='grid grid-cols-2 gap-3'>
                        {[
                          [
                            t('剩余点数'),
                            `${pointSummary?.quota ?? points.value} ${points.unit}`,
                          ],
                          [
                            t('累计已用点数'),
                            `${pointSummary?.used_quota ?? 0} ${t('点')}`,
                          ],
                        ].map(([label, value]) => (
                          <div
                            className='rounded-[12px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-4 py-3'
                            key={String(label)}
                          >
                            <div className='text-[11.5px] font-semibold text-[var(--ws-muted-2)]'>
                              {label}
                            </div>
                            <div className='mt-1 text-[17px] font-extrabold text-[var(--ws-primary-text)] tabular-nums'>
                              {value}
                            </div>
                          </div>
                        ))}
                      </dl>
                      <div className='mt-5 text-[13.5px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('最近扣点记录')}
                      </div>
                      {recentConsumes.length === 0 ? (
                        <div className='mt-2 rounded-[12px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-4 py-3 text-[13px] text-[var(--ws-muted-2)]'>
                          {t('暂无扣点记录')}
                        </div>
                      ) : (
                        <div className='mt-2 divide-y divide-[var(--ws-tint-2)] rounded-[12px] border border-[var(--ws-tint)]'>
                          {recentConsumes.map((record) => (
                            <div
                              className='flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]'
                              key={record.key}
                            >
                              <span className='min-w-0 truncate text-[var(--ws-muted)]'>
                                {(KIND_LABEL[record.capability] ||
                                  record.capability) +
                                  ' · ' +
                                  formatRecordTime(record.created_at)}
                              </span>
                              <span className='shrink-0 font-semibold text-[var(--ws-primary-text)] tabular-nums'>
                                -{record.points} {t('点')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {detailRecord && (
            <div
              className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--ws-ink)]/45 p-4 backdrop-blur-sm'
              onClick={() => setDetailRecord(null)}
            >
              <div
                className='flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[20px] border border-[var(--ws-border)] bg-white shadow-[0_40px_90px_-40px_rgba(25,24,51,.65)]'
                onClick={(event) => event.stopPropagation()}
              >
                <div className='flex items-start justify-between gap-4 border-b border-[var(--ws-tint-2)] bg-[var(--ws-surface)] px-6 py-5'>
                  <div>
                    <div className='text-[16px] font-bold tracking-[-.01em]'>
                      {t('生成详情')}
                    </div>
                    <div className='mt-1.5 text-[13.5px] text-[var(--ws-muted-2)]'>
                      {t('本次提交的内容与 AI 返回的结果。')}
                    </div>
                  </div>
                  <button
                    aria-label={t('关闭')}
                    className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--ws-border)] bg-white text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-primary-text)]'
                    onClick={() => setDetailRecord(null)}
                    type='button'
                  >
                    <X className='size-4' />
                  </button>
                </div>

                <div
                  className={cn(
                    'flex-1 overflow-y-auto px-6 py-5',
                    SCROLL_CLASS
                  )}
                >
                  <dl className='grid grid-cols-2 gap-x-6 gap-y-4'>
                    <div>
                      <dt className='text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('时间')}
                      </dt>
                      <dd className='mt-1 text-[14px] text-[var(--ws-ink)] tabular-nums'>
                        {formatRecordTime(detailRecord.created_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('能力')}
                      </dt>
                      <dd className='mt-1 text-[14px] text-[var(--ws-ink)]'>
                        {KIND_LABEL[detailRecord.capability] ||
                          detailRecord.capability ||
                          '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('模型')}
                      </dt>
                      <dd className='mt-1 text-[14px] break-all text-[var(--ws-ink)]'>
                        {detailRecord.model || '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('消耗点数')}
                      </dt>
                      <dd className='mt-1 text-[14px] font-semibold text-[var(--ws-primary-text)] tabular-nums'>
                        {detailRecord.points
                          ? `${detailRecord.points} ${t('点')}`
                          : '—'}
                      </dd>
                    </div>
                    <div className='col-span-2'>
                      <dt className='text-[12px] font-semibold text-[var(--ws-muted-2)]'>
                        {t('状态')}
                      </dt>
                      <dd className='mt-1'>
                        {(() => {
                          const tone =
                            RECORD_STATUS[detailRecord.status] ??
                            FALLBACK_STATUS
                          const label =
                            RECORD_STATUS[detailRecord.status]?.label ??
                            detailRecord.status ??
                            '-'
                          return (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold',
                                tone.pill
                              )}
                            >
                              <span
                                className={cn(
                                  'h-[5px] w-[5px] rounded-full',
                                  tone.dot
                                )}
                              />
                              {label}
                            </span>
                          )
                        })()}
                      </dd>
                    </div>
                  </dl>

                  {detailRecord.fail_reason && (
                    <div className='mt-5 rounded-[12px] border border-[#f6dede] bg-[#fdf6f6] px-4 py-3 text-[13px] text-[#b4232a]'>
                      {detailRecord.fail_reason}
                    </div>
                  )}

                  <div className='mt-5'>
                    <div className='text-[13.5px] font-semibold text-[var(--ws-muted-2)]'>
                      {t('我发送的内容')}
                    </div>
                    <div className='mt-2 rounded-[12px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-4 py-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ws-ink-2)]'>
                      {detailRecord.prompt?.trim() ||
                        t('（本次未记录提交内容）')}
                    </div>
                  </div>

                  <div className='mt-5'>
                    <div className='text-[13.5px] font-semibold text-[var(--ws-muted-2)]'>
                      {t('收到的内容')}
                    </div>
                    {detailRecord.result_preview?.trim() ? (
                      isImageUrl(detailRecord.result_preview) ? (
                        <a
                          className='mt-2 block'
                          href={detailRecord.result_preview}
                          rel='noreferrer'
                          target='_blank'
                        >
                          <img
                            alt={t('生成结果')}
                            className='max-h-[320px] w-auto rounded-[12px] border border-[var(--ws-tint)] object-contain'
                            src={detailRecord.result_preview}
                          />
                        </a>
                      ) : (
                        <div className='mt-2 rounded-[12px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-4 py-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ws-ink-2)]'>
                          {detailRecord.result_preview}
                        </div>
                      )
                    ) : (
                      <div className='mt-2 rounded-[12px] border border-[var(--ws-tint)] bg-[var(--ws-tint-2)] px-4 py-3 text-[14px] text-[var(--ws-muted-2)]'>
                        {t('（本次未记录返回内容）')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {!isTeacher && view === 'create' && (
          <ClassTaskPanel
            onRefresh={refreshClassSession}
            session={classSession}
            tasks={classTasks}
            variant='floating'
          />
        )}
      </div>
    </div>
  )
}
