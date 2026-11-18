import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AudioPlayer, VideoPlayer } from '@/components/ui/media-player'
import {
  closeClassSession,
  createTempClassSession,
  distributeLesson,
  downloadClassSessionPackage,
  fetchArtifactBlob,
  fetchArtifactBlobUrl,
  fetchClassSessionDetail,
  fetchClassSessionProgress,
  fetchClassSessions,
  fetchClasses,
  fetchLessonPlans,
  fetchSectionGradeOptions,
  fetchSmallClasses,
  fetchWorkspaceAsyncTaskLogs,
  fetchWorkspaceAsyncTasks,
  pauseWorkspaceAsyncTask,
  queryWorkspaceAsyncTask,
  resumeWorkspaceAsyncTask,
  type AiHubTaskSubmission,
  type TempClassTaskInput,
  type WorkspaceAsyncTaskItem,
} from '@/features/ai-hub/api'
import {
  Badge,
  Button,
  Field,
  Modal,
  PageShell,
  Panel,
  Select,
  Switch,
  Table,
  TextArea,
  Td,
  TextInput,
} from '@/features/ai-hub/components/kit'
import type { AiHubLessonTask, AiHubUnit } from '@/features/ai-hub/types'

const route = getRouteApi('/_authenticated/ai-hub/overview')

/** 课堂概览：授课分发 + 实时提交查看 + ZIP 打包 + AI 作品详情（模块 D）。
 * search 带 smallClassId/sessionId 时进入单班上课视图：只显示该小班实时数据，
 * 隐藏学部→年级→小班→课时四段级联，支持按任务/学生筛选提交。 */
export function ClassOverview() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const focused = Boolean(search.smallClassId)
  const [sectionId, setSectionId] = useState(0)
  const [gradeIndex, setGradeIndex] = useState(0)
  const [smallClassId, setSmallClassId] = useState(search.smallClassId ?? 0)
  const [lessonId, setLessonId] = useState(0)
  // 本节课主题（D2）：默认带出课时标题，教师可改（遗留待办 4 已确认口径）。
  const [theme, setTheme] = useState('')
  const [themeTouched, setThemeTouched] = useState(false)
  const [sessionId, setSessionId] = useState(search.sessionId ?? 0)
  // 提交筛选：按任务 / 按学生（纯前端过滤 detail.submissions）。
  const [taskFilter, setTaskFilter] = useState('')
  const [studentFilter, setStudentFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    title: string
    url: string
    mime: string
  } | null>(null)
  const [aiDetail, setAiDetail] = useState<AiHubTaskSubmission | null>(null)
  // v1.1：临时发起课堂弹窗。
  const [tempOpen, setTempOpen] = useState(false)
  const [tempCount, setTempCount] = useState(2)
  const [tempTheme, setTempTheme] = useState('')
  const [tempTasks, setTempTasks] = useState<TempClassTaskInput[]>([])
  const [tempBusy, setTempBusy] = useState(false)
  // 全局异步任务汇总（仅教师端展示与操作）。
  const [asyncPage, setAsyncPage] = useState(1)
  const [asyncStatusFilter, setAsyncStatusFilter] = useState('')
  const [asyncLogTask, setAsyncLogTask] =
    useState<WorkspaceAsyncTaskItem | null>(null)
  const [asyncActionBusy, setAsyncActionBusy] = useState('')

  const gradeQuery = useQuery({
    queryKey: ['ai-hub', 'grade-options'],
    queryFn: fetchSectionGradeOptions,
  })
  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
  })
  const smallClassesQuery = useQuery({
    queryKey: ['ai-hub', 'small-classes'],
    queryFn: () => fetchSmallClasses(),
  })
  const gradeOptions = useMemo(() => gradeQuery.data ?? [], [gradeQuery.data])
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data])
  const smallClasses = useMemo(
    () => smallClassesQuery.data ?? [],
    [smallClassesQuery.data]
  )

  const sectionOptions = useMemo(
    () => [
      ...new Map(
        gradeOptions.map((option) => [
          option.section_id,
          { label: option.section_name, value: String(option.section_id) },
        ])
      ).values(),
    ],
    [gradeOptions]
  )
  const currentGradeOptions = gradeOptions.filter(
    (option) => option.section_id === sectionId
  )

  useEffect(() => {
    if (focused || sectionId > 0 || sectionOptions.length === 0) return
    setSectionId(Number(sectionOptions[0].value))
  }, [focused, sectionOptions, sectionId])

  useEffect(() => {
    if (!sectionId) return
    const exists = currentGradeOptions.some(
      (option) => option.grade_index === gradeIndex
    )
    if (exists) return
    setGradeIndex(currentGradeOptions[0]?.grade_index ?? 0)
  }, [currentGradeOptions, gradeIndex, sectionId])

  // 当前年级下的行政大班，用于把上课小班映射回年级。
  const gradeClassIds = useMemo(() => {
    const ids = new Set<number>()
    for (const item of classes) {
      if (item.section_id === sectionId && item.grade_index === gradeIndex) {
        ids.add(item.id)
      }
    }
    return ids
  }, [classes, sectionId, gradeIndex])
  const gradeClassMap = useMemo(() => {
    const map = new Map<number, { name: string; code: string }>()
    for (const item of classes) {
      map.set(item.id, { name: item.name, code: item.code })
    }
    return map
  }, [classes])

  const smallClassOptions = useMemo(
    () =>
      smallClasses
        .filter((item) =>
          (item.parent_class_ids ?? []).some((id) => gradeClassIds.has(id))
        )
        .map((item) => {
          const firstParentId = (item.parent_class_ids ?? []).find((id) =>
            gradeClassIds.has(id)
          )
          const parent =
            firstParentId !== undefined
              ? gradeClassMap.get(firstParentId)
              : undefined
          const suffix = parent ? `（${parent.code || parent.name}）` : ''
          return {
            value: String(item.id),
            label: `${item.name}${suffix}`,
          }
        }),
    [smallClasses, gradeClassIds, gradeClassMap]
  )

  // 单班上课视图下 smallClassId 由 search 固定，跳过级联自动选择逻辑。
  useEffect(() => {
    if (focused) return
    if (!smallClassOptions.length) {
      setSmallClassId(0)
      return
    }
    if (
      smallClassOptions.some((option) => option.value === String(smallClassId))
    ) {
      return
    }
    setSmallClassId(Number(smallClassOptions[0].value))
  }, [focused, smallClassOptions, smallClassId])

  const plansQuery = useQuery({
    queryKey: ['ai-hub', 'lesson-plans', sectionId, gradeIndex],
    queryFn: () => fetchLessonPlans(sectionId, gradeIndex),
    enabled: sectionId > 0 && gradeIndex > 0,
  })
  const units = useMemo<AiHubUnit[]>(
    () => plansQuery.data ?? [],
    [plansQuery.data]
  )
  const lessonOptions = useMemo(
    () =>
      units.flatMap((unit) =>
        (unit.lessons ?? []).map((lesson) => ({
          value: String(lesson.id),
          label: `${unit.name} / ${lesson.title}`,
          lesson,
        }))
      ),
    [units]
  )
  useEffect(() => {
    if (!lessonOptions.length) {
      setLessonId(0)
      return
    }
    if (lessonOptions.some((option) => option.value === String(lessonId))) {
      return
    }
    setLessonId(Number(lessonOptions[0].value))
  }, [lessonOptions, lessonId])

  // 切换课时后，未被手动编辑过的主题自动跟随课时标题。
  useEffect(() => {
    if (themeTouched) return
    const hit = lessonOptions.find(
      (option) => option.value === String(lessonId)
    )
    setTheme(hit?.lesson.title ?? '')
  }, [lessonId, lessonOptions, themeTouched])

  const sessionsQuery = useQuery({
    queryKey: ['ai-hub', 'class-sessions', smallClassId],
    queryFn: () => fetchClassSessions(smallClassId || undefined),
    refetchInterval: 15000,
  })
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])

  useEffect(() => {
    // 首次拉取前不重置，避免把 search 带入的 sessionId 清掉。
    if (sessionsQuery.isPending) return
    if (!sessions.length) {
      setSessionId(0)
      return
    }
    if (sessions.some((item) => item.id === sessionId)) return
    const active = sessions.find((item) => item.status === 'active')
    setSessionId((active ?? sessions[0]).id)
  }, [sessions, sessionId, sessionsQuery.isPending])

  const detailQuery = useQuery({
    queryKey: ['ai-hub', 'class-session-detail', sessionId],
    queryFn: () => fetchClassSessionDetail(sessionId),
    enabled: sessionId > 0,
    refetchInterval: 12000,
  })
  const detail = detailQuery.data ?? null

  // v1.1：学生 × 任务完成情况矩阵，10 秒轮询实时刷新。
  const progressQuery = useQuery({
    queryKey: ['ai-hub', 'class-session-progress', sessionId],
    queryFn: () => fetchClassSessionProgress(sessionId),
    enabled: sessionId > 0,
    refetchInterval: 10000,
  })
  const progress = progressQuery.data ?? null
  const [progressStudent, setProgressStudent] = useState<number | null>(null)

  // 全局异步任务汇总：15 秒自动刷新，按提交时间倒序（后端倒序返回）。
  const asyncTasksQuery = useQuery({
    queryKey: ['ai-hub', 'async-tasks', asyncPage, asyncStatusFilter],
    queryFn: () =>
      fetchWorkspaceAsyncTasks(asyncPage, 20, asyncStatusFilter || undefined),
    refetchInterval: 15000,
  })
  const asyncTasks = asyncTasksQuery.data
  const asyncTotalPages = Math.max(
    1,
    Math.ceil((asyncTasks?.total ?? 0) / (asyncTasks?.page_size ?? 20))
  )

  // 任务状态变更日志（含厂商接口原始参数详情），仅在弹窗打开时请求。
  const asyncLogsQuery = useQuery({
    queryKey: ['ai-hub', 'async-task-logs', asyncLogTask?.task_id],
    queryFn: () => {
      const taskId = asyncLogTask?.task_id
      if (!taskId) return Promise.resolve([])
      return fetchWorkspaceAsyncTaskLogs(taskId, 200)
    },
    enabled: Boolean(asyncLogTask?.task_id),
  })

  // 教师端专属操作：暂停 / 恢复轮询、手动触发单次厂商查询。
  const handleAsyncAction = async (
    task: WorkspaceAsyncTaskItem,
    action: 'pause' | 'resume' | 'query'
  ) => {
    setAsyncActionBusy(`${task.task_id}:${action}`)
    try {
      if (action === 'pause') await pauseWorkspaceAsyncTask(task.task_id)
      else if (action === 'resume') await resumeWorkspaceAsyncTask(task.task_id)
      else await queryWorkspaceAsyncTask(task.task_id)
      let message = '已恢复该任务的自动轮询'
      if (action === 'query') message = '已查询一次厂商状态'
      else if (action === 'pause') message = '已暂停该任务的自动轮询'
      toast.success(message)
      await asyncTasksQuery.refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setAsyncActionBusy('')
    }
  }

  // 筛选选项与过滤结果（纯前端，detail 全量返回 tasks + submissions）。
  const taskFilterOptions = useMemo(
    () => [
      { value: '', label: '全部任务' },
      ...(detail?.tasks ?? []).map((task) => ({
        value: String(task.id),
        label: task.title,
      })),
    ],
    [detail?.tasks]
  )
  const studentFilterOptions = useMemo(() => {
    const map = new Map<number, string>()
    for (const item of detail?.submissions ?? []) {
      if (!map.has(item.user_id)) {
        map.set(
          item.user_id,
          item.student_name
            ? `${item.student_name}${item.student_no ? `（${item.student_no}）` : ''}`
            : `用户 ${item.user_id}`
        )
      }
    }
    return [
      { value: '', label: '全部学生' },
      ...[...map.entries()].map(([id, label]) => ({
        value: String(id),
        label,
      })),
    ]
  }, [detail?.submissions])
  const filteredSubmissions = useMemo(() => {
    const list = detail?.submissions ?? []
    return list.filter((item) => {
      if (taskFilter && item.task_id !== Number(taskFilter)) return false
      if (studentFilter && item.user_id !== Number(studentFilter)) return false
      return true
    })
  }, [detail?.submissions, taskFilter, studentFilter])
  const hasFilter = Boolean(taskFilter || studentFilter)

  const refreshAll = async () => {
    await Promise.all([
      sessionsQuery.refetch(),
      sessionId > 0 ? detailQuery.refetch() : Promise.resolve(),
    ])
  }

  const handleDistribute = async () => {
    if (!smallClassId || !lessonId) {
      toast.error('请先选择小班与课时')
      return
    }
    setBusy(true)
    try {
      const session = await distributeLesson(
        smallClassId,
        lessonId,
        theme.trim()
      )
      if (session?.id) setSessionId(session.id)
      await sessionsQuery.refetch()
      toast.success('课时已分发到小班')
      // 跳转到单班实时数据视图：只显示该小班，不再展示全部班级。
      navigate({
        search: (prev: { smallClassId?: number; sessionId?: number }) => ({
          ...prev,
          smallClassId,
          sessionId: session?.id ?? prev.sessionId,
        }),
        replace: true,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分发失败')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      await closeClassSession(sessionId)
      await refreshAll()
      toast.success('已结束本次授课')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const handlePackage = async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      await downloadClassSessionPackage(sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打包失败')
    } finally {
      setBusy(false)
    }
  }

  // v1.1：调整任务环节数量时同步输入数组，保留已填写内容。
  const syncTempCount = (count: number) => {
    setTempCount(count)
    setTempTasks((prev) =>
      Array.from({ length: count }, (_, index) => ({
        title: prev[index]?.title ?? `任务${index + 1}`,
        requirement: prev[index]?.requirement ?? '',
        output_forms: prev[index]?.output_forms ?? 'text',
      }))
    )
  }

  const openTempModal = () => {
    setTempTheme('')
    syncTempCount(Math.max(2, tempTasks.length || tempCount))
    setTempOpen(true)
  }

  const updateTempTask = (
    index: number,
    patch: Partial<TempClassTaskInput>
  ) => {
    setTempTasks((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    )
  }

  const handleTempSubmit = async () => {
    if (!smallClassId) {
      toast.error('请先选择小班')
      return
    }
    if (!tempTasks.length) {
      toast.error('请设置任务环节')
      return
    }
    setTempBusy(true)
    try {
      const session = await createTempClassSession({
        small_class_id: smallClassId,
        theme: tempTheme.trim(),
        tasks: tempTasks.map((item) => ({
          ...item,
          title: item.title.trim() || '',
        })),
      })
      if (session?.id) setSessionId(session.id)
      await sessionsQuery.refetch()
      setTempOpen(false)
      toast.success('临时课堂已发起，学生端任务面板已更新')
      navigate({
        search: (prev: { smallClassId?: number; sessionId?: number }) => ({
          ...prev,
          smallClassId,
          sessionId: session?.id ?? prev.sessionId,
        }),
        replace: true,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发起失败')
    } finally {
      setTempBusy(false)
    }
  }

  const openStudentDetail = (userId: number) => setProgressStudent(userId)

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
        new Blob([buildSubmissionNote(item)], { type: 'text/plain' }),
        `submission-${item.id}.txt`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败')
    }
  }

  const currentSession =
    sessions.find((item) => item.id === sessionId) ?? detail?.session ?? null

  // 单班视图 → 全部课堂视图：清掉 search 中的 smallClassId/sessionId。
  const exitFocused = () => {
    navigate({
      search: (prev: { smallClassId?: number; sessionId?: number }) => ({
        ...prev,
        smallClassId: undefined,
        sessionId: undefined,
      }),
      replace: true,
    })
    setSmallClassId(0)
    setSessionId(0)
    setTaskFilter('')
    setStudentFilter('')
  }

  return (
    <PageShell
      title={
        focused
          ? `课堂 · ${currentSession?.small_class_name ?? '单班实时数据'}`
          : '课堂概览'
      }
      description={
        focused
          ? '仅显示本班实时提交数据，每 12 秒自动刷新；下课后未完成的任务，下次上课可继续查看与提交。'
          : '选择年级、小班与课时一键分发，实时查看学生提交并打包下载全部成果。'
      }
      actions={
        <>
          <Button
            variant='primary'
            disabled={(!focused && !smallClassId) || busy}
            onClick={openTempModal}
          >
            临时发起课堂
          </Button>
          <Button variant='outline' disabled={busy} onClick={refreshAll}>
            刷新
          </Button>
          {focused && (
            <Button variant='outline' onClick={exitFocused}>
              返回全部课堂
            </Button>
          )}
        </>
      }
    >
      {!focused && (
        <Panel
          title='授课分发'
          description='分发后学生端右侧任务面板立即出现该课时的分项任务。'
        >
          <div className='grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end'>
            <label className='space-y-1'>
              <span className='text-muted-foreground text-xs'>学部</span>
              <Select
                value={String(sectionId)}
                onChange={(value) => setSectionId(Number(value))}
                options={sectionOptions}
              />
            </label>
            <label className='space-y-1'>
              <span className='text-muted-foreground text-xs'>年级</span>
              <Select
                value={String(gradeIndex)}
                onChange={(value) => setGradeIndex(Number(value))}
                options={currentGradeOptions.map((option) => ({
                  value: String(option.grade_index),
                  label: option.grade_name,
                }))}
              />
            </label>
            <label className='space-y-1'>
              <span className='text-muted-foreground text-xs'>上课小班</span>
              <Select
                value={String(smallClassId)}
                onChange={(value) => setSmallClassId(Number(value))}
                options={smallClassOptions}
                placeholder='该年级暂无小班'
              />
            </label>
            <label className='space-y-1'>
              <span className='text-muted-foreground text-xs'>课时</span>
              <Select
                value={String(lessonId)}
                onChange={(value) => setLessonId(Number(value))}
                options={lessonOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                placeholder='该年级暂无课时'
              />
            </label>
          </div>
          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end'>
            <label className='space-y-1'>
              <span className='text-muted-foreground text-xs'>
                本节课主题
                <span className='text-muted-foreground/70 ml-1'>
                  （默认课时标题，可修改）
                </span>
              </span>
              <input
                value={theme}
                onChange={(event) => {
                  setThemeTouched(true)
                  setTheme(event.target.value)
                }}
                placeholder='请输入本节课主题'
                className='border-input bg-background text-foreground focus-visible:border-ring h-9 w-full rounded-lg border px-3 text-sm outline-none'
              />
            </label>
            <Button
              variant='primary'
              disabled={busy || !smallClassId || !lessonId}
              onClick={handleDistribute}
            >
              开始上课（一键分发）
            </Button>
          </div>
          <div className='mt-3 flex flex-wrap items-center gap-2'>
            {currentSession && (
              <span className='text-muted-foreground text-xs'>
                当前课堂：{currentSession.small_class_name} ·{' '}
                {currentSession.theme || currentSession.lesson_title}
              </span>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title='课堂会话'
        description={
          focused
            ? '本班全部课堂；未完成的课堂下次上课仍可打开继续提交，提交实时回流。'
            : '按所选小班展示最近分发的课堂，可切换查看历史提交。'
        }
        bodyClassName='p-0'
      >
        <Table
          headers={
            focused
              ? ['状态', '单元 / 课时', '任务数', '提交数', '分发时间', '操作']
              : [
                  '状态',
                  '小班',
                  '单元 / 课时',
                  '任务数',
                  '提交数',
                  '分发时间',
                  '操作',
                ]
          }
          isEmpty={sessions.length === 0}
          empty={focused ? '暂无课堂会话' : '暂无课堂会话，先在上方分发课时'}
        >
          {sessions.map((item) => (
            <tr
              key={item.id}
              className='border-border hover:bg-accent/40 border-b last:border-0'
            >
              <Td>
                {item.status === 'active' ? (
                  <Badge tone='success'>进行中</Badge>
                ) : (
                  <Badge tone='muted'>已结束</Badge>
                )}
              </Td>
              {!focused && (
                <Td>
                  {item.small_class_name}
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {item.small_class_code}
                  </span>
                </Td>
              )}
              <Td>
                <div className='text-[13px]'>{item.unit_name}</div>
                <div className='text-muted-foreground text-xs'>
                  {item.theme || item.lesson_title}
                </div>
              </Td>
              <Td>{item.task_count}</Td>
              <Td>{item.submission_count}</Td>
              <Td className='text-muted-foreground text-xs'>
                {formatTime(item.started_at)}
              </Td>
              <Td>
                <div className='flex items-center gap-1'>
                  <Button
                    variant={item.id === sessionId ? 'primary' : 'outline'}
                    onClick={() => setSessionId(item.id)}
                  >
                    查看
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() =>
                      navigate({
                        to: '/class-board',
                        search: {
                          sessionId: item.id,
                          smallClassId: item.small_class_id,
                        },
                      })
                    }
                  >
                    大屏
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {currentSession && progress && progress.tasks.length > 0 && (
        <Panel
          title='完成情况（实时）'
          description={`每 10 秒自动刷新；点击学生查看该生本节课全部提交详情。已完成 ${
            progress.students.filter((s) => s.completed_task > 0).length
          } / ${progress.students.length} 人`}
          actions={
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => progressQuery.refetch()}
            >
              刷新进度
            </Button>
          }
          bodyClassName='p-0'
        >
          <Table
            headers={[
              '学生',
              '学号',
              ...progress.tasks.map((task) => task.title),
              '完成度',
              '操作',
            ]}
            isEmpty={progress.students.length === 0}
            empty='该小班暂无学生'
          >
            {progress.students.map((student) => (
              <tr
                key={student.user_id}
                className='border-border hover:bg-accent/40 border-b last:border-0'
              >
                <Td className='font-medium whitespace-nowrap'>
                  {student.student_name || `用户 ${student.user_id}`}
                </Td>
                <Td className='text-muted-foreground text-xs whitespace-nowrap'>
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
                <Td>
                  <Button
                    variant='ghost'
                    onClick={() => openStudentDetail(student.user_id)}
                  >
                    查看详情
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {currentSession && (
        <Panel
          title={`${currentSession.small_class_name} · ${currentSession.theme || currentSession.lesson_title}`}
          description={`共 ${detail?.tasks.length ?? currentSession.task_count} 个任务，已收到 ${detail?.submissions.length ?? currentSession.submission_count} 条提交${hasFilter ? `，筛选后 ${filteredSubmissions.length} 条` : ''}`}
          actions={
            <>
              <Button variant='outline' disabled={busy} onClick={refreshAll}>
                刷新提交
              </Button>
              <Button variant='outline' disabled={busy} onClick={handlePackage}>
                打包下载 ZIP
              </Button>
              {currentSession.status === 'active' && (
                <Button variant='danger' disabled={busy} onClick={handleClose}>
                  结束授课
                </Button>
              )}
            </>
          }
          bodyClassName='p-0'
        >
          <div className='border-border flex flex-wrap items-center gap-3 border-b px-4 py-3'>
            <span className='text-muted-foreground text-xs'>筛选提交：</span>
            <Select
              className='w-48'
              value={taskFilter}
              onChange={setTaskFilter}
              options={taskFilterOptions}
            />
            <Select
              className='w-48'
              value={studentFilter}
              onChange={setStudentFilter}
              options={studentFilterOptions}
            />
            {hasFilter && (
              <Button
                variant='ghost'
                onClick={() => {
                  setTaskFilter('')
                  setStudentFilter('')
                }}
              >
                清除筛选
              </Button>
            )}
          </div>
          <Table
            headers={[
              '学生',
              '学号',
              '任务',
              '形式',
              '内容 / 产物',
              '提交时间',
              '操作',
            ]}
            isEmpty={!detail || filteredSubmissions.length === 0}
            empty={
              hasFilter
                ? '当前筛选条件下暂无提交'
                : '学生尚未提交，页面每 12 秒自动刷新'
            }
          >
            {filteredSubmissions.map((item) => (
              <tr
                key={item.id}
                className='border-border border-b last:border-0'
              >
                <Td>{item.student_name || `用户 ${item.user_id}`}</Td>
                <Td className='text-muted-foreground text-xs'>
                  {item.student_no || '-'}
                </Td>
                <Td>
                  {item.task_title || taskTitle(detail?.tasks, item.task_id)}
                </Td>
                <Td>
                  {' '}
                  <Badge
                    tone={item.content_type === 'ai' ? 'default' : 'muted'}
                  >
                    {submissionTypeLabel(item.content_type)}
                  </Badge>{' '}
                </Td>
                <Td>
                  <SubmissionContent item={item} />
                </Td>
                <Td className='text-muted-foreground text-xs'>
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
                      <>
                        <Button
                          variant='ghost'
                          onClick={() => openPreview(item)}
                        >
                          预览
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() => handleDownload(item)}
                        >
                          下载
                        </Button>
                      </>
                    )}
                    {item.content_type === 'text' && (
                      <Button
                        variant='ghost'
                        onClick={() => handleDownload(item)}
                      >
                        下载
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel
        title='全局异步任务汇总'
        description='全部学生的异步生成任务统一展示，按提交时间倒序，每 15 秒自动刷新；暂停 / 恢复 / 单次查询 / 原始参数仅教师端可操作。'
        actions={
          <>
            <Select
              className='w-36'
              value={asyncStatusFilter}
              onChange={(value) => {
                setAsyncStatusFilter(value)
                setAsyncPage(1)
              }}
              options={[
                { value: '', label: '全部状态' },
                { value: 'QUEUED', label: '排队中' },
                { value: 'SUBMITTED', label: '已提交' },
                { value: 'IN_PROGRESS', label: '执行中' },
                { value: 'SUCCESS', label: '成功' },
                { value: 'FAILURE', label: '失败' },
              ]}
            />
            <Button
              variant='outline'
              disabled={asyncTasksQuery.isFetching}
              onClick={() => asyncTasksQuery.refetch()}
            >
              刷新
            </Button>
          </>
        }
        bodyClassName='p-0'
      >
        <Table
          headers={[
            '排队 / 执行状态',
            '模型',
            '场景',
            '学生',
            '提交时间',
            '完成时间',
            '操作',
          ]}
          isEmpty={(asyncTasks?.items ?? []).length === 0}
          empty='暂无异步任务'
        >
          {(asyncTasks?.items ?? []).map((task) => {
            const busyKey = asyncActionBusy.split(':')[0]
            const acting = asyncActionBusy.startsWith(task.task_id)
            return (
              <tr
                key={task.task_id}
                className='border-border hover:bg-accent/40 border-b last:border-0'
              >
                <Td>
                  <div className='flex flex-wrap items-center gap-1'>
                    <AsyncStatusBadge status={task.status} />
                    {task.paused && <Badge tone='warning'>已暂停</Badge>}
                    {task.progress && task.status === 'IN_PROGRESS' && (
                      <span className='text-muted-foreground text-xs'>
                        {task.progress}%
                      </span>
                    )}
                  </div>
                  {task.fail_reason && (
                    <div className='text-destructive mt-1 max-w-[240px] text-xs break-all'>
                      {task.fail_reason}
                    </div>
                  )}
                </Td>
                <Td className='text-[13px] whitespace-nowrap'>{task.model}</Td>
                <Td className='text-muted-foreground text-xs whitespace-nowrap'>
                  {task.action || '-'}
                </Td>
                <Td className='whitespace-nowrap'>
                  {task.username || `用户 ${task.user_id}`}
                </Td>
                <Td className='text-muted-foreground text-xs whitespace-nowrap'>
                  {formatTime(task.submit_time)}
                </Td>
                <Td className='text-muted-foreground text-xs whitespace-nowrap'>
                  {formatTime(task.finish_time)}
                </Td>
                <Td>
                  <div className='flex items-center gap-1'>
                    {task.paused ? (
                      <Button
                        variant='outline'
                        disabled={Boolean(asyncActionBusy)}
                        onClick={() => handleAsyncAction(task, 'resume')}
                      >
                        {acting && busyKey === task.task_id
                          ? '恢复中…'
                          : '恢复轮询'}
                      </Button>
                    ) : (
                      <Button
                        variant='outline'
                        disabled={Boolean(asyncActionBusy)}
                        onClick={() => handleAsyncAction(task, 'pause')}
                      >
                        {acting && busyKey === task.task_id
                          ? '暂停中…'
                          : '暂停任务'}
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      disabled={Boolean(asyncActionBusy)}
                      onClick={() => handleAsyncAction(task, 'query')}
                    >
                      {acting && busyKey === task.task_id
                        ? '查询中…'
                        : '查询一次'}
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => setAsyncLogTask(task)}
                    >
                      原始参数
                    </Button>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
        {asyncTotalPages > 1 && (
          <div className='border-border flex items-center justify-between border-t px-4 py-2'>
            <span className='text-muted-foreground text-xs'>
              共 {asyncTasks?.total ?? 0} 条 · 第 {asyncPage} /{' '}
              {asyncTotalPages} 页
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                disabled={asyncPage <= 1}
                onClick={() => setAsyncPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </Button>
              <Button
                variant='outline'
                disabled={asyncPage >= asyncTotalPages}
                onClick={() => setAsyncPage((prev) => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* 异步任务状态变更日志：厂商接口完整原始参数详情（仅教师端）。 */}
      <Modal
        open={Boolean(asyncLogTask)}
        title={`任务原始参数 · ${asyncLogTask?.task_id ?? ''}`}
        onClose={() => setAsyncLogTask(null)}
      >
        <div className='max-h-[65vh] space-y-3 overflow-y-auto pr-1'>
          {asyncLogsQuery.isPending && asyncLogTask && (
            <div className='text-muted-foreground text-sm'>日志加载中…</div>
          )}
          {(asyncLogsQuery.data ?? []).map((log) => (
            <div
              key={log.id}
              className='border-border space-y-2 rounded-lg border p-3'
            >
              <div className='flex flex-wrap items-center gap-2 text-xs'>
                <Badge tone='muted'>{formatTime(log.created_at)}</Badge>
                <Badge tone='default'>{log.source}</Badge>
                <span className='text-muted-foreground'>
                  {log.from_status} → {log.to_status}
                </span>
              </div>
              {log.detail && (
                <div className='text-muted-foreground text-xs break-all'>
                  {log.detail}
                </div>
              )}
              <pre className='bg-muted/60 max-h-60 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap'>
                {formatParams(log.raw_response || '(无原始返回)')}
              </pre>
            </div>
          ))}
          {!asyncLogsQuery.isPending && !(asyncLogsQuery.data ?? []).length && (
            <div className='text-muted-foreground text-sm'>
              暂无状态变更日志
            </div>
          )}
        </div>
      </Modal>

      <PreviewModal preview={preview} onClose={() => setPreview(null)} />
      <AiDetailModal
        item={aiDetail}
        onClose={() => setAiDetail(null)}
        onPreview={openPreview}
      />

      {/* v1.1：临时发起课堂弹窗 */}
      <Modal
        open={tempOpen}
        title='临时发起课堂'
        onClose={() => setTempOpen(false)}
        footer={
          <>
            <Button variant='outline' onClick={() => setTempOpen(false)}>
              取消
            </Button>
            <Button
              variant='primary'
              disabled={tempBusy || !smallClassId}
              onClick={handleTempSubmit}
            >
              {tempBusy ? '发起中…' : '发起课堂'}
            </Button>
          </>
        }
      >
        <div className='max-h-[65vh] space-y-3 overflow-y-auto pr-1'>
          <div className='text-muted-foreground text-xs'>
            当前小班：
            <span className='text-foreground'>
              {focused
                ? (currentSession?.small_class_name ??
                  smallClasses.find((item) => item.id === smallClassId)?.name ??
                  '-')
                : (smallClasses.find((item) => item.id === smallClassId)
                    ?.name ?? '-')}
            </span>
            （在左上方选择小班）
          </div>
          <Field label='本节课主题'>
            <TextInput
              value={tempTheme}
              placeholder='留空默认「临时课堂」'
              onChange={setTempTheme}
            />
          </Field>
          <div className='flex items-end gap-3'>
            <Field label='任务环节数量'>
              <Select
                className='w-32'
                value={String(tempCount)}
                onChange={(value) => syncTempCount(Number(value))}
                options={Array.from({ length: 12 }, (_, index) => ({
                  value: String(index + 1),
                  label: `${index + 1} 个环节`,
                }))}
              />
            </Field>
            <span className='text-muted-foreground pb-1.5 text-xs'>
              每个环节独立选择提交内容类型
            </span>
          </div>

          {tempTasks.map((task, index) => (
            <div
              // oxlint-disable-next-line react/no-array-index-key 临时环节按位置对齐，增删时整体重建。
              key={index}
              className='border-border bg-muted/30 space-y-2 rounded-lg border p-3'
            >
              <div className='flex items-center justify-between'>
                <span className='text-foreground text-xs font-medium'>
                  环节 {index + 1}
                </span>
                <TextInput
                  className='mx-2 h-8 flex-1'
                  value={task.title}
                  placeholder='环节名称（留空自动命名）'
                  onChange={(value) => updateTempTask(index, { title: value })}
                />
              </div>
              <TextArea
                value={task.requirement}
                placeholder='任务要求（学生端可见，可留空）'
                onChange={(value) =>
                  updateTempTask(index, { requirement: value })
                }
              />
              <div className='flex flex-wrap items-center gap-3'>
                <span className='text-muted-foreground text-xs'>
                  提交内容：
                </span>
                <Switch
                  checked={task.output_forms.includes('text')}
                  label='文字'
                  onChange={(checked) =>
                    updateTempTask(index, {
                      output_forms: mergeForm(
                        task.output_forms,
                        'text',
                        checked
                      ),
                    })
                  }
                />
                <Switch
                  checked={task.output_forms.includes('file')}
                  label='文件'
                  onChange={(checked) =>
                    updateTempTask(index, {
                      output_forms: mergeForm(
                        task.output_forms,
                        'file',
                        checked
                      ),
                    })
                  }
                />
                <Switch
                  checked={task.output_forms.includes('ai')}
                  label='AI 作品'
                  onChange={(checked) =>
                    updateTempTask(index, {
                      output_forms: mergeForm(task.output_forms, 'ai', checked),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* v1.1：点击学生查看该生本节课全部提交详情 */}
      <StudentDetailModal
        progress={progress}
        detail={detail}
        userId={progressStudent}
        onClose={() => setProgressStudent(null)}
        onPreview={openPreview}
        onDetail={(item) => setAiDetail(item)}
      />
    </PageShell>
  )
}

/** mergeForm 增删产出形式（text/file/ai），至少保留一项。 */
function mergeForm(forms: string, form: string, checked: boolean): string {
  const list = forms
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const next = checked
    ? [...new Set([...list, form])]
    : list.filter((item) => item !== form)
  if (!next.length) return form
  return next.join(',')
}

/** StudentDetailModal 单个学生在本节课的全部提交详情（v1.1）。 */
export function StudentDetailModal(props: {
  progress: import('@/features/ai-hub/api').AiHubClassSessionProgress | null
  detail: import('@/features/ai-hub/api').AiHubClassSessionDetail | null
  userId: number | null
  onClose: () => void
  onPreview: (item: AiHubTaskSubmission) => void
  onDetail: (item: AiHubTaskSubmission) => void
}) {
  const { progress, detail, userId } = props
  if (!progress || userId === null) return null
  const row = progress.students.find((item) => item.user_id === userId)
  if (!row) return null
  // 优先使用实时矩阵的学生信息（未提交学生也有的展示）。
  const studentName = row.student_name || `用户 ${userId}`
  const submissions = (detail?.submissions ?? []).filter(
    (item) => item.user_id === userId
  )
  return (
    <Modal
      open
      title={`${studentName} · 本节课完成详情`}
      onClose={props.onClose}
    >
      <div className='max-h-[65vh] space-y-3 overflow-y-auto pr-1'>
        <div className='flex flex-wrap gap-2'>
          <Badge tone='default'>
            完成 {row.completed_task}/{progress.tasks.length}
          </Badge>
          <Badge tone='muted'>提交 {row.submission_cnt} 条</Badge>
          {row.student_no && <Badge tone='muted'>学号 {row.student_no}</Badge>}
        </div>
        <div className='space-y-2'>
          {progress.tasks.map((task, index) => {
            const cell = row.tasks.find((item) => item.task_id === task.id)
            return (
              <div
                key={task.id}
                className='border-border rounded-lg border p-3'
              >
                <div className='flex items-center justify-between'>
                  <span className='text-foreground text-[13px] font-medium'>
                    {index + 1}. {task.title}
                  </span>
                  {cell?.submitted ? (
                    <Badge tone='success'>已完成</Badge>
                  ) : (
                    <Badge tone='warning'>未完成</Badge>
                  )}
                </div>
                {task.requirement && (
                  <div className='text-muted-foreground mt-1 text-xs'>
                    要求：{task.requirement}
                  </div>
                )}
                <div className='mt-2 space-y-1.5'>
                  {submissions
                    .filter((item) => item.task_id === task.id)
                    .map((item) => (
                      <div
                        key={item.id}
                        className='bg-muted/50 flex items-start justify-between gap-2 rounded-md p-2'
                      >
                        <div className='min-w-0 flex-1'>
                          <span className='text-muted-foreground mr-2 text-xs'>
                            {submissionTypeLabel(item.content_type)} ·{' '}
                            {formatTime(item.created_at)}
                          </span>
                          <div className='text-[13px] break-all'>
                            {submissionBodyText(item)}
                          </div>
                          {item.prompt && (
                            <div className='text-muted-foreground mt-1 text-xs break-all'>
                              提示词：{item.prompt}
                            </div>
                          )}
                        </div>
                        <div className='flex shrink-0 flex-col gap-1'>
                          {item.content_type === 'ai' && (
                            <Button
                              variant='ghost'
                              onClick={() => props.onDetail(item)}
                            >
                              详情
                            </Button>
                          )}
                          {(item.artifact_id > 0 || item.asset_url) && (
                            <Button
                              variant='ghost'
                              onClick={() => props.onPreview(item)}
                            >
                              预览
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  {!submissions.some((item) => item.task_id === task.id) && (
                    <div className='text-muted-foreground text-xs'>
                      暂无提交
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

function SubmissionContent(props: { item: AiHubTaskSubmission }) {
  const item = props.item
  if (item.content_type === 'text') {
    return (
      <span className='line-clamp-2 max-w-[320px] text-[13px]'>
        {item.text_content}
      </span>
    )
  }
  if (item.content_type === 'file') {
    return (
      <span className='text-[13px]'>
        {item.file_name || '文件'}
        <span className='text-muted-foreground ml-1 text-xs'>
          {formatSize(item.size_bytes)}
        </span>
      </span>
    )
  }
  return (
    <span className='line-clamp-2 max-w-[320px] text-[13px]'>
      {item.result_text || item.file_name || 'AI 作品'}
    </span>
  )
}

export function PreviewModal(props: {
  preview: { title: string; url: string; mime: string } | null
  onClose: () => void
}) {
  const revokeRef = useRef('')
  const { preview } = props
  useEffect(() => {
    revokeRef.current = preview?.url?.startsWith('blob:') ? preview.url : ''
    return () => {
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current)
    }
  }, [preview])

  if (!preview) return null
  const kind = previewKind(preview.mime, preview.url)
  return (
    <Modal open title={preview.title} onClose={props.onClose}>
      <div className='flex items-center justify-center'>
        {kind === 'image' && (
          <img
            src={preview.url}
            alt={preview.title}
            className='max-h-[55vh] w-auto'
          />
        )}
        {kind === 'video' && (
          <VideoPlayer
            src={preview.url}
            downloadName={preview.title}
            className='max-h-[55vh] w-full'
          />
        )}
        {kind === 'audio' && (
          <AudioPlayer
            src={preview.url}
            downloadName={preview.title}
            className='w-full'
          />
        )}
        {kind === 'other' && (
          <a
            href={preview.url}
            target='_blank'
            rel='noreferrer'
            className='text-primary text-sm underline'
          >
            该类型不支持在线预览，点击打开
          </a>
        )}
      </div>
    </Modal>
  )
}

export function AiDetailModal(props: {
  item: AiHubTaskSubmission | null
  onClose: () => void
  onPreview: (item: AiHubTaskSubmission) => void
}) {
  const item = props.item
  if (!item) return null
  return (
    <Modal
      open
      title='AI 作品详情'
      onClose={props.onClose}
      footer={
        item.artifact_id > 0 || item.asset_url ? (
          <Button variant='primary' onClick={() => props.onPreview(item)}>
            预览产物
          </Button>
        ) : undefined
      }
    >
      <div className='space-y-3 text-[13px]'>
        <DetailRow
          label='学生'
          value={`${item.student_name} ${item.student_no}`}
        />
        <DetailRow label='生成能力' value={item.capability || '-'} />
        <DetailRow label='提示词' value={item.prompt || '-'} pre />
        <DetailRow label='生成参数' value={item.params || '-'} pre />
        <DetailRow label='生成结果' value={item.result_text || '-'} pre />
        {item.asset_url && (
          <DetailRow label='作品地址' value={item.asset_url} />
        )}
      </div>
    </Modal>
  )
}

function DetailRow(props: { label: string; value: string; pre?: boolean }) {
  return (
    <div>
      <div className='text-muted-foreground mb-1 text-xs'>{props.label}</div>
      {props.pre ? (
        <pre className='bg-muted/60 max-h-40 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap'>
          {formatParams(props.value)}
        </pre>
      ) : (
        <div className='break-all'>{props.value}</div>
      )}
    </div>
  )
}

function formatParams(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function buildSubmissionNote(item: AiHubTaskSubmission) {
  const lines = [
    `学生：${item.student_name} ${item.student_no}`,
    `生成能力：${item.capability}`,
    `提示词：${item.prompt}`,
    `生成参数：${formatParams(item.params)}`,
    `生成结果：${item.result_text}`,
    `作品地址：${item.asset_url}`,
  ]
  return lines.join('\n')
}

function taskTitle(tasks: AiHubLessonTask[] | undefined, taskId: number) {
  const hit = tasks?.find((task) => task.id === taskId)
  if (hit) return hit.title
  return `任务 ${taskId}`
}

/** submissionBodyText 单条提交的正文展示：文本直出，AI 与文件回退到文件名。 */
function submissionBodyText(item: AiHubTaskSubmission): string {
  if (item.content_type === 'text') return item.text_content
  if (item.content_type === 'ai') {
    return item.result_text || item.file_name || 'AI 作品'
  }
  return item.file_name || '文件'
}

/** AsyncStatusBadge 异步任务状态徽标：排队 / 执行 / 成功 / 失败。 */
function AsyncStatusBadge(props: { status: string }) {
  const status = props.status
  if (status === 'SUCCESS') return <Badge tone='success'>成功</Badge>
  if (status === 'FAILURE') return <Badge tone='danger'>失败</Badge>
  if (status === 'IN_PROGRESS') return <Badge tone='default'>执行中</Badge>
  if (status === 'QUEUED' || status === 'SUBMITTED' || status === 'NOT_START') {
    return <Badge tone='warning'>排队中</Badge>
  }
  return <Badge tone='muted'>{status || '未知'}</Badge>
}

function submissionTypeLabel(type: string) {
  if (type === 'text') return '文字'
  if (type === 'file') return '文件'
  if (type === 'ai') return 'AI 作品'
  return type
}

function previewKind(mime: string, url: string) {
  const value = (mime || '').toLowerCase()
  if (value.startsWith('image/')) return 'image' as const
  if (value.startsWith('video/')) return 'video' as const
  if (value.startsWith('audio/')) return 'audio' as const
  const lower = url.toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?|$)/.test(lower))
    return 'image' as const
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) return 'video' as const
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(lower)) return 'audio' as const
  return 'other' as const
}

function formatTime(value?: number) {
  if (!value) return '-'
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
