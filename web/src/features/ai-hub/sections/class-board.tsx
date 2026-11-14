import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { toast } from 'sonner'

import {
  batchSetStudentPoints,
  fetchArtifactBlob,
  fetchArtifactBlobUrl,
  fetchClassSessionDetail,
  fetchClassSessionProgress,
  fetchClassSessions,
  setStudentPoints,
} from '@/features/ai-hub/api'
import {
  Badge,
  Button,
  Field,
  Modal,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
} from '@/features/ai-hub/components/kit'
import {
  AiDetailModal,
  PreviewModal,
  StudentDetailModal,
} from '@/features/ai-hub/sections/class-overview'
import type { AiHubTaskSubmission } from '@/features/ai-hub/api'
import type {
  AiHubClassSession,
  AiHubClassSessionProgress,
} from '@/features/ai-hub/api'
import { downloadCsv, toCsvLine } from '@/features/usage-logs/lib/export'

const route = getRouteApi('/class-board')

/** 课堂数据大屏：独立全屏页面（无侧栏/顶栏），只留一个返回按钮。
 * 展示完成情况矩阵 + 实时提交数据，可查看单个学生详情并就地分发点数。 */
export function ClassBoard() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const sessionId = search.sessionId ?? 0
  const [studentFilter, setStudentFilter] = useState('')
  const [progressStudent, setProgressStudent] = useState<number | null>(null)
  const [preview, setPreview] = useState<{
    title: string
    url: string
    mime: string
  } | null>(null)
  const [aiDetail, setAiDetail] = useState<AiHubTaskSubmission | null>(null)
  // 发点数弹窗：userIds 为空数组表示全班一键分发。
  const [pointTarget, setPointTarget] = useState<{
    userIds: number[]
    names: string
  } | null>(null)
  const [pointMode, setPointMode] = useState<'set' | 'clear'>('set')
  const [pointValue, setPointValue] = useState('100')
  const [pointBusy, setPointBusy] = useState(false)
  // 投屏模式：一键进入浏览器全屏并放大字号，适合教室大屏投影。
  const [projection, setProjection] = useState(false)

  // 用户按 Esc 退出全屏时同步按钮状态。
  useEffect(() => {
    const sync = () => setProjection(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggleProjection = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        setProjection(false)
      } else {
        await document.documentElement.requestFullscreen()
        setProjection(true)
      }
    } catch {
      toast.error('浏览器拒绝进入全屏，请检查是否被其它全屏窗口占用')
    }
  }

  const smallClassId = search.smallClassId ?? 0
  const sessionsQuery = useQuery({
    queryKey: ['ai-hub', 'class-sessions', smallClassId],
    queryFn: () => fetchClassSessions(smallClassId || undefined),
    refetchInterval: 15000,
  })
  const sessions = sessionsQuery.data ?? []
  const currentSession = sessions.find((item) => item.id === sessionId)

  const detailQuery = useQuery({
    queryKey: ['ai-hub', 'class-session-detail', sessionId],
    queryFn: () => fetchClassSessionDetail(sessionId),
    enabled: sessionId > 0,
    refetchInterval: 12000,
  })
  const detail = detailQuery.data ?? null

  const progressQuery = useQuery({
    queryKey: ['ai-hub', 'class-session-progress', sessionId],
    queryFn: () => fetchClassSessionProgress(sessionId),
    enabled: sessionId > 0,
    refetchInterval: 10000,
  })
  const progress = progressQuery.data ?? null

  const students = progress?.students ?? []
  const completedCount = students.filter((item) => item.completed_task > 0).length
  const totalCount = students.length
  const submissionCount = detail?.submissions.length ?? 0
  const taskCount = progress?.tasks.length ?? detail?.tasks.length ?? 0

  const studentOptions = useMemo(() => {
    const map = new Map<number, string>()
    for (const item of students) {
      map.set(
        item.user_id,
        item.student_name
          ? `${item.student_name}${item.student_no ? `（${item.student_no}）` : ''}`
          : `用户 ${item.user_id}`
      )
    }
    return [
      { value: '', label: '全部学生' },
      ...Array.from(map.entries()).map(([id, label]) => ({
        value: String(id),
        label,
      })),
    ]
  }, [students])

  const filteredSubmissions = useMemo(() => {
    const list = detail?.submissions ?? []
    if (!studentFilter) return list
    return list.filter((item) => item.user_id === Number(studentFilter))
  }, [detail?.submissions, studentFilter])

  const back = () => {
    navigate({
      to: '/ai-hub/overview',
      search: search.smallClassId
        ? { smallClassId: search.smallClassId, sessionId }
        : {},
    })
  }

  const openPreview = async (item: AiHubTaskSubmission) => {
    try {
      if (item.artifact_id > 0) {
        const url = await fetchArtifactBlobUrl(item.artifact_id)
        setPreview({
          title: item.file_name || '提交产物',
          url,
          mime: item.mime_type,
        })
        return
      }
      if (item.asset_url) {
        setPreview({
          title: item.file_name || 'AI 作品',
          url: item.asset_url,
          mime: item.mime_type,
        })
        return
      }
      toast.error('该提交没有可预览的产物')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '预览失败')
    }
  }

  const handleDownload = async (item: AiHubTaskSubmission) => {
    try {
      if (item.artifact_id > 0) {
        const blob = await fetchArtifactBlob(item.artifact_id)
        triggerDownload(blob, item.file_name || `submission-${item.id}`)
        return
      }
      if (item.asset_url) {
        window.open(item.asset_url, '_blank', 'noopener')
        return
      }
      triggerDownload(
        new Blob(
          [
            `学生：${item.student_name} ${item.student_no}\n提示词：${item.prompt}\n生成结果：${item.result_text}`,
          ],
          { type: 'text/plain' }
        ),
        `submission-${item.id}.txt`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败')
    }
  }

  const submitPoints = async () => {
    if (pointMode === 'set' && Number(pointValue) < 0) {
      toast.error('点数不能为负数')
      return
    }
    setPointBusy(true)
    try {
      // 全班分发时补齐矩阵中全部学生（矩阵含已移出小班但有提交的学生）。
      const userIds = pointTarget
        ? pointTarget.userIds.length
          ? pointTarget.userIds
          : students.map((item) => item.user_id).filter((id) => id > 0)
        : []
      if (userIds.length === 0) {
        toast.error('没有可操作的学生')
        return
      }
      if (userIds.length === 1) {
        await setStudentPoints({
          userId: userIds[0],
          mode: pointMode,
          value: Number(pointValue),
        })
        toast.success(`已更新 ${pointTarget?.names ?? '该学生'} 的剩余点数`)
      } else {
        const result = await batchSetStudentPoints({
          userIds,
          mode: pointMode,
          value: Number(pointValue),
        })
        toast.success(
          `已处理 ${result.applied} 人${result.failed ? `，${result.failed} 人失败` : ''}`
        )
      }
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'class-session-progress', sessionId],
      })
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'students'] })
      setPointTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分发失败')
    } finally {
      setPointBusy(false)
    }
  }

  if (!sessionId) {
    return (
      <div className='bg-background flex min-h-screen flex-col items-center justify-center gap-4 p-6'>
        <p className='text-sm text-muted-foreground'>未指定课堂会话</p>
        <Button variant='primary' onClick={back}>
          返回
        </Button>
      </div>
    )
  }

  return (
    <div className='bg-background min-h-screen overflow-y-auto'>
      <div
        className={
          projection
            ? 'mx-auto flex max-w-[1800px] flex-col gap-5 p-6 text-[17px]'
            : 'mx-auto flex max-w-[1400px] flex-col gap-4 p-4'
        }
      >
        {/* 顶部：标题 + 返回 + 投屏模式 */}
        <header className='flex flex-wrap items-center justify-between gap-3'>
          <div className='min-w-0'>
            <h1
              className={
                projection
                  ? 'truncate text-2xl font-semibold text-foreground'
                  : 'truncate text-xl font-semibold text-foreground'
              }
            >
              课堂大屏 ·{' '}
              {currentSession
                ? currentSession.theme ||
                  currentSession.lesson_title ||
                  currentSession.small_class_name
                : '课堂实时数据'}
            </h1>
            <p
              className={
                projection
                  ? 'mt-1 text-sm text-muted-foreground'
                  : 'mt-1 text-xs text-muted-foreground'
              }
            >
              {currentSession?.small_class_name}
              {currentSession ? ` · ${currentSession.unit_name} / ${currentSession.lesson_title}` : ''}
              {currentSession?.status === 'active' ? ' · 进行中' : ' · 已结束'}
              ；每 10 秒自动刷新
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant={projection ? 'primary' : 'outline'}
              onClick={() => void toggleProjection()}
            >
              {projection ? '退出投屏（Esc）' : '投屏模式'}
            </Button>
            <Button variant='outline' onClick={back}>
              ← 返回
            </Button>
          </div>
        </header>

        {/* 顶部数据卡：完成情况 / 提交 / 任务 */}
        <div className={projection ? 'grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-3 md:grid-cols-4'}>
          <StatCard
            label='已完成学生'
            value={`${completedCount} / ${totalCount}`}
            hint='至少提交一项任务'
            large={projection}
          />
          <StatCard
            label='提交总数'
            value={String(submissionCount)}
            hint='文字 / 文件 / AI 作品'
            large={projection}
          />
          <StatCard
            label='任务环节'
            value={String(taskCount)}
            hint='本节课分项任务'
            large={projection}
          />
          <div
            className={
              projection
                ? 'rounded-xl border border-border bg-card p-5 shadow-sm'
                : 'rounded-xl border border-border bg-card p-4 shadow-sm'
            }
          >
            <div className='text-xs text-muted-foreground'>全班发点数</div>
            <div className='mt-2 flex items-center justify-between gap-2'>
              <span
                className={
                  projection
                    ? 'text-3xl font-semibold text-foreground'
                    : 'text-2xl font-semibold text-foreground'
                }
              >
                一键
              </span>
              <Button
                variant='primary'
                className='h-8'
                onClick={() =>
                  setPointTarget({ userIds: [], names: `全班 ${totalCount} 人` })
                }
              >
                分发
              </Button>
            </div>
          </div>
        </div>

        {/* 完成情况矩阵 */}
        {progress && progress.tasks.length > 0 && (
          <Panel
            title='完成情况（实时）'
            description={`点击学生查看该生详情并单独发点数；已完成 ${completedCount} / ${totalCount} 人`}
            actions={
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => exportMatrixCsv(progress, currentSession)}
                >
                  导出 Excel
                </Button>
                <Button
                  variant='outline'
                  onClick={() => exportMatrixImage(progress, currentSession)}
                >
                  导出图片
                </Button>
                <Button
                  variant='outline'
                  onClick={() => progressQuery.refetch()}
                >
                  刷新
                </Button>
              </div>
            }
            bodyClassName='p-0'
          >
            <div className='max-h-[52vh] overflow-y-auto'>
              <Table
                headers={[
                  '学生',
                  '学号',
                  ...progress.tasks.map((task) => task.title),
                  '完成度',
                  '剩余点数',
                  '操作',
                ]}
                isEmpty={students.length === 0}
                empty='该小班暂无学生'
              >
                {students.map((student) => (
                  <tr
                    key={student.user_id}
                    className='border-b border-border last:border-0 hover:bg-accent/40'
                  >
                    <Td className='whitespace-nowrap font-medium'>
                      {student.student_name || `用户 ${student.user_id}`}
                    </Td>
                    <Td
                      className={`whitespace-nowrap ${projection ? 'text-sm text-muted-foreground' : 'text-xs text-muted-foreground'}`}
                    >
                      {student.student_no || '-'}
                    </Td>
                    {progress.tasks.map((task) => {
                      const cell = student.tasks.find(
                        (item) => item.task_id === task.id
                      )
                      return (
                        <Td key={task.id} className='whitespace-nowrap'>
                          {cell?.submitted ? (
                            <Badge tone='success'>
                              已完成{cell.count > 1 ? ` ×${cell.count}` : ''}
                            </Badge>
                          ) : (
                            <Badge tone='muted'>未完成</Badge>
                          )}
                        </Td>
                      )
                    })}
                    <Td className='whitespace-nowrap'>
                      {student.completed_task}/{progress.tasks.length}
                    </Td>
                    <Td className='whitespace-nowrap font-medium'>
                      {student.quota ?? 0} 点
                    </Td>
                    <Td>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='ghost'
                          onClick={() => setProgressStudent(student.user_id)}
                        >
                          详情
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() =>
                            setPointTarget({
                              userIds: [student.user_id],
                              names: student.student_name || `用户 ${student.user_id}`,
                            })
                          }
                        >
                          发点数
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Panel>
        )}

        {/* 提交数据 */}
        <Panel
          title='提交数据（实时）'
          description={`已收到 ${submissionCount} 条提交${studentFilter ? `，筛选后 ${filteredSubmissions.length} 条` : ''}`}
          actions={
            <>
              <Select
                className='w-44'
                value={studentFilter}
                onChange={setStudentFilter}
                options={studentOptions}
              />
              <Button variant='outline' onClick={() => detailQuery.refetch()}>
                刷新
              </Button>
            </>
          }
          bodyClassName='p-0'
        >
          <div className='max-h-[52vh] overflow-y-auto'>
            <Table
              headers={[
                '学生',
                '任务',
                '形式',
                '内容 / 产物',
                '提交时间',
                '操作',
              ]}
              isEmpty={filteredSubmissions.length === 0}
              empty='学生尚未提交，页面每 12 秒自动刷新'
            >
              {filteredSubmissions.map((item) => (
                <tr
                  key={item.id}
                  className='border-b border-border last:border-0'
                >
                  <Td className='whitespace-nowrap'>
                    {item.student_name || `用户 ${item.user_id}`}
                  </Td>
                  <Td className='whitespace-nowrap'>
                    {item.task_title || `任务 ${item.task_id}`}
                  </Td>
                  <Td>
                    <Badge tone={item.content_type === 'ai' ? 'default' : 'muted'}>
                      {item.content_type === 'text'
                        ? '文字'
                        : item.content_type === 'file'
                          ? '文件'
                          : 'AI 作品'}
                    </Badge>
                  </Td>
                  <Td>
                    <span
                      className={`line-clamp-2 max-w-[340px] ${projection ? 'text-[15px]' : 'text-[13px]'}`}
                    >
                      {item.content_type === 'text'
                        ? item.text_content
                        : item.content_type === 'ai'
                          ? item.result_text || item.file_name || 'AI 作品'
                          : item.file_name || '文件'}
                    </span>
                  </Td>
                  <Td className='text-xs text-muted-foreground'>
                    {formatTime(item.created_at)}
                  </Td>
                  <Td>
                    <div className='flex items-center gap-1'>
                      {item.content_type === 'ai' && (
                        <Button variant='ghost' onClick={() => setAiDetail(item)}>
                          详情
                        </Button>
                      )}
                      {(item.artifact_id > 0 || item.asset_url) && (
                        <Button
                          variant='ghost'
                          onClick={() => openPreview(item)}
                        >
                          预览
                        </Button>
                      )}
                      <Button variant='ghost' onClick={() => handleDownload(item)}>
                        下载
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </Panel>
      </div>

      {/* 学生详情（含该生全部提交） */}
      <StudentDetailModal
        progress={progress}
        detail={detail}
        userId={progressStudent}
        onClose={() => setProgressStudent(null)}
        onPreview={openPreview}
        onDetail={(item) => setAiDetail(item)}
      />

      {/* 发点数弹窗：单个学生或全班 */}
      <Modal
        open={pointTarget !== null}
        title={`分发点数 · ${pointTarget?.names ?? ''}`}
        onClose={() => setPointTarget(null)}
        footer={
          <>
            <Button variant='outline' onClick={() => setPointTarget(null)}>
              取消
            </Button>
            <Button
              variant='primary'
              disabled={pointBusy}
              onClick={submitPoints}
            >
              {pointBusy ? '处理中…' : '确认'}
            </Button>
          </>
        }
      >
        <div className='space-y-3'>
          <Field label='操作'>
            <Select
              value={pointMode}
              onChange={(value) => setPointMode(value as 'set' | 'clear')}
              options={[
                { value: 'set', label: '设置为指定点数（覆盖）' },
                { value: 'clear', label: '清零剩余点数' },
              ]}
            />
          </Field>
          {pointMode === 'set' && (
            <Field label='点数'>
              <TextInput
                value={pointValue}
                placeholder='例如 100'
                onChange={setPointValue}
              />
            </Field>
          )}
          <p className='text-xs text-muted-foreground'>
            {pointTarget?.userIds.length === 1
              ? '仅覆盖该学生的剩余点数，不影响已用统计。'
              : `将对 ${pointTarget?.names ?? ''} 全部生效，剩余点数会被直接覆盖。`}
          </p>
        </div>
      </Modal>

      <PreviewModal preview={preview} onClose={() => setPreview(null)} />
      <AiDetailModal
        item={aiDetail}
        onClose={() => setAiDetail(null)}
        onPreview={openPreview}
      />
    </div>
  )
}

function StatCard(props: { label: string; value: string; hint: string; large?: boolean }) {
  return (
    <div
      className={
        props.large
          ? 'rounded-xl border border-border bg-card p-5 shadow-sm'
          : 'rounded-xl border border-border bg-card p-4 shadow-sm'
      }
    >
      <div
        className={
          props.large
            ? 'text-sm text-muted-foreground'
            : 'text-xs text-muted-foreground'
        }
      >
        {props.label}
      </div>
      <div
        className={
          props.large
            ? 'mt-1 text-3xl font-semibold text-foreground'
            : 'mt-1 text-2xl font-semibold text-foreground'
        }
      >
        {props.value}
      </div>
      <div className='mt-1 text-xs text-muted-foreground/70'>{props.hint}</div>
    </div>
  )
}

/** 导出文件名前缀：课堂主题 + 导出时间。 */
function exportFileBase(session?: AiHubClassSession | null) {
  const theme =
    session?.theme || session?.lesson_title || session?.small_class_name || '课堂'
  const now = new Date()
  const pad = (input: number) => String(input).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  return `课堂进度矩阵-${theme}-${stamp}`
}

// 导出课堂进度矩阵为 Excel（CSV，Excel 可直接打开），带 UTF-8 BOM 避免中文乱码。
function exportMatrixCsv(
  progress: AiHubClassSessionProgress | null,
  session?: AiHubClassSession | null
) {
  if (!progress || progress.tasks.length === 0) {
    toast.error('暂无可导出的进度矩阵')
    return
  }
  const header = [
    '学生',
    '学号',
    ...progress.tasks.map((task) => task.title),
    '完成度',
    '剩余点数',
    '提交次数',
  ]
  const rows = progress.students.map((student) => [
    student.student_name || `用户 ${student.user_id}`,
    student.student_no || '-',
    ...progress.tasks.map((task) => {
      const cell = student.tasks.find((item) => item.task_id === task.id)
      return cell?.submitted
        ? `已完成${cell.count > 1 ? ` ×${cell.count}` : ''}`
        : '未完成'
    }),
    `${student.completed_task}/${progress.tasks.length}`,
    String(student.quota ?? 0),
    String(student.submission_cnt ?? 0),
  ])
  downloadCsv(
    `${exportFileBase(session)}.csv`,
    [toCsvLine(header), ...rows.map((row) => toCsvLine(row))]
  )
  toast.success('已导出 Excel 文件')
}

// 导出课堂进度矩阵为 PNG 图片，方便归档与群内分享。
function exportMatrixImage(
  progress: AiHubClassSessionProgress | null,
  session?: AiHubClassSession | null
) {
  if (!progress || progress.tasks.length === 0 || progress.students.length === 0) {
    toast.error('暂无可导出的进度矩阵')
    return
  }
  const cellW = 120
  const headH = 46
  const rowH = 34
  const fixedW = [110, 100] // 学生 / 学号
  const tailW = [90, 100, 100] // 完成度 / 剩余点数 / 提交次数
  const tableW =
    fixedW.reduce((sum, w) => sum + w, 0) +
    progress.tasks.length * cellW +
    tailW.reduce((sum, w) => sum + w, 0)
  const padX = 24
  const titleH = 76
  const width = Math.max(tableW + padX * 2, 720)
  const height = titleH + headH + progress.students.length * rowH + 40

  const canvas = document.createElement('canvas')
  const scale = 2 // 高清导出
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    toast.error('当前浏览器不支持导出图片')
    return
  }
  ctx.scale(scale, scale)

  // 背景
  ctx.fillStyle = '#f7f6fc'
  ctx.fillRect(0, 0, width, height)

  // 标题区
  ctx.fillStyle = '#1f1e33'
  ctx.font = '600 22px "Microsoft YaHei", "PingFang SC", sans-serif'
  const theme =
    session?.theme || session?.lesson_title || session?.small_class_name || '课堂'
  ctx.fillText(`课堂进度矩阵 · ${theme}`, padX, 34)
  ctx.fillStyle = '#77768c'
  ctx.font = '14px "Microsoft YaHei", "PingFang SC", sans-serif'
  const exportedAt = formatTime(Math.floor(Date.now() / 1000))
  ctx.fillText(
    `${session?.small_class_name ?? ''} · 导出时间 ${exportedAt} · 共 ${progress.students.length} 名学生 / ${progress.tasks.length} 个任务`,
    padX,
    58
  )

  // 表格
  const tableTop = titleH
  const columns: { width: number; label: string }[] = [
    { width: fixedW[0], label: '学生' },
    { width: fixedW[1], label: '学号' },
    ...progress.tasks.map((task) => ({ width: cellW, label: task.title })),
    { width: tailW[0], label: '完成度' },
    { width: tailW[1], label: '剩余点数' },
    { width: tailW[2], label: '提交次数' },
  ]

  // 表头
  ctx.fillStyle = '#4b3fb3'
  ctx.fillRect(padX, tableTop, tableW, headH)
  let x = padX
  ctx.font = '600 14px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillStyle = '#ffffff'
  for (const col of columns) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, tableTop, col.width, headH)
    ctx.clip()
    ctx.fillText(col.label, x + 8, tableTop + 28)
    ctx.restore()
    x += col.width
  }

  // 数据行
  progress.students.forEach((student, rowIndex) => {
    const y = tableTop + headH + rowIndex * rowH
    ctx.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f2f0fb'
    ctx.fillRect(padX, y, tableW, rowH)
    ctx.strokeStyle = '#e3e0f2'
    ctx.beginPath()
    ctx.moveTo(padX, y + rowH)
    ctx.lineTo(padX + tableW, y + rowH)
    ctx.stroke()

    let cellX = padX
    const drawCell = (
      colIndex: number,
      text: string,
      color: string,
      bold = false
    ) => {
      const col = columns[colIndex]
      ctx.save()
      ctx.beginPath()
      ctx.rect(cellX, y, col.width, rowH)
      ctx.clip()
      ctx.fillStyle = color
      ctx.font = `${bold ? '600 ' : ''}13px "Microsoft YaHei", "PingFang SC", sans-serif`
      ctx.fillText(text, cellX + 8, y + 22)
      ctx.restore()
      cellX += col.width
    }

    drawCell(0, student.student_name || `用户 ${student.user_id}`, '#1f1e33', true)
    drawCell(1, student.student_no || '-', '#77768c')
    progress.tasks.forEach((task, taskIndex) => {
      const cell = student.tasks.find((item) => item.task_id === task.id)
      drawCell(
        2 + taskIndex,
        cell?.submitted
          ? `已完成${cell.count > 1 ? ` ×${cell.count}` : ''}`
          : '未完成',
        cell?.submitted ? '#16a34a' : '#a3a2b8',
        Boolean(cell?.submitted)
      )
    })
    drawCell(
      2 + progress.tasks.length,
      `${student.completed_task}/${progress.tasks.length}`,
      '#1f1e33',
      true
    )
    drawCell(3 + progress.tasks.length, `${student.quota ?? 0} 点`, '#1f1e33', true)
    drawCell(4 + progress.tasks.length, String(student.submission_cnt ?? 0), '#77768c')
  })

  // 边框
  ctx.strokeStyle = '#d8d4ee'
  ctx.strokeRect(padX, tableTop, tableW, headH + progress.students.length * rowH)

  canvas.toBlob((blob) => {
    if (!blob) {
      toast.error('导出图片失败')
      return
    }
    triggerDownload(blob, `${exportFileBase(session)}.png`)
    toast.success('已导出进度矩阵图片')
  }, 'image/png')
}

function formatTime(value?: number) {
  if (!value) return '-'
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
