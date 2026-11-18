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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  copyLesson,
  deleteLesson,
  deleteLessonTask,
  deleteUnit,
  downloadLessonImportTemplate,
  fetchArtifacts,
  fetchLessonPlans,
  fetchSectionGradeOptions,
  importLessonPlans,
  saveLesson,
  saveLessonTask,
  saveUnit,
  uploadSharedArtifact,
} from '../api'
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
  Td,
  TextArea,
  TextInput,
} from '../components/kit'
import type {
  AiHubArtifact,
  AiHubGradeOption,
  AiHubLesson,
  AiHubLessonTask,
  AiHubUnit,
} from '../types'

// 产出形式标签：text=大段文字，file=文件上传，ai=AI 生成作品。
const OUTPUT_FORM_OPTIONS = [
  { value: 'text', label: '大段文字' },
  { value: 'file', label: '文件上传' },
  { value: 'ai', label: 'AI 作品' },
]

// referenceAssetName 参考资料展示名：上传文件时后端把原始文件名存在 prompt 里。
function referenceAssetName(item: AiHubArtifact): string {
  const prompt = (item.prompt ?? '').trim()
  if (prompt) {
    return prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt
  }
  return `${item.kind} #${item.id}`
}

// appendIdToList / removeIdFromList 维护逗号分隔的素材 id 列表。
function appendIdToList(list: string, id: number): string {
  const ids = new Set(
    (list ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
  ids.add(String(id))
  return Array.from(ids).join(',')
}

function outputFormLabels(forms: string): string {
  const list = (forms ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(
      (item) =>
        OUTPUT_FORM_OPTIONS.find((option) => option.value === item)?.label ??
        item
    )
  return list.length > 0 ? list.join(' / ') : '大段文字'
}

// toggleOutputForm 在「文字 / 文件 / AI」多选之间切换。
function toggleOutputForm(value: string, form: string): string {
  const list = new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
  if (list.has(form)) {
    list.delete(form)
  } else {
    list.add(form)
  }
  return Array.from(list).join(',')
}

export function LessonPlansSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [sectionId, setSectionId] = useState(0)
  const [gradeIndex, setGradeIndex] = useState(0)
  const [selectedUnitId, setSelectedUnitId] = useState(0)
  const [selectedLessonId, setSelectedLessonId] = useState(0)
  const [unitDraft, setUnitDraft] = useState<Partial<AiHubUnit> | null>(null)
  const [lessonDraft, setLessonDraft] = useState<Partial<AiHubLesson> | null>(
    null
  )
  const [taskDraft, setTaskDraft] = useState<Partial<AiHubLessonTask> | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  // 任务参考资料：待挂载的素材 id（逗号分隔存储在任务上）与上传中状态。
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRef, setUploadingRef] = useState(false)
  const [importFailures, setImportFailures] = useState<
    { row: string; reason: string }[] | null
  >(null)

  const gradeOptionsQuery = useQuery({
    queryKey: ['ai-hub', 'grade-options'],
    queryFn: fetchSectionGradeOptions,
  })
  const gradeOptions: AiHubGradeOption[] = gradeOptionsQuery.data ?? []

  // 学部下拉：按 section_id 去重。
  const sectionOptions = Array.from(
    new Map(
      gradeOptions.map((option) => [
        option.section_id,
        {
          label: option.section_name,
          value: String(option.section_id),
        },
      ])
    ).values()
  )
  const currentGradeOptions = gradeOptions.filter(
    (option) => option.section_id === sectionId
  )

  useEffect(() => {
    if (sectionId > 0 || sectionOptions.length === 0) return
    setSectionId(Number(sectionOptions[0].value))
  }, [sectionOptions, sectionId])

  useEffect(() => {
    if (!sectionId) return
    const exists = currentGradeOptions.some(
      (option) => option.grade_index === gradeIndex
    )
    if (exists) return
    setGradeIndex(currentGradeOptions[0]?.grade_index ?? 0)
  }, [currentGradeOptions, gradeIndex, sectionId])

  const plansQuery = useQuery({
    queryKey: ['ai-hub', 'lesson-plans', sectionId, gradeIndex],
    queryFn: () => fetchLessonPlans(sectionId, gradeIndex),
    enabled: sectionId > 0 && gradeIndex > 0,
  })
  const units: AiHubUnit[] = plansQuery.data ?? []

  const currentUnit =
    units.find((unit) => unit.id === selectedUnitId) ?? units[0] ?? null
  const lessons = currentUnit?.lessons ?? []
  const currentLesson =
    lessons.find((lesson) => lesson.id === selectedLessonId) ??
    lessons[0] ??
    null
  const tasks = currentLesson?.tasks ?? []

  const gradeName =
    currentGradeOptions.find((option) => option.grade_index === gradeIndex)
      ?.grade_name ?? ''

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'lesson-plans', sectionId, gradeIndex],
    })
  }

  // 参考资料候选：本账号上传的全部素材（含 input 类文件），供任务弹窗勾选挂载。
  const refListQuery = useQuery({
    queryKey: ['ai-hub', 'lesson-task-references'],
    queryFn: () => fetchArtifacts({ mine: true, page_size: 200 }),
    enabled: taskDraft !== null,
  })
  const referencePool: AiHubArtifact[] = refListQuery.data?.items ?? []

  const refreshReferences = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'lesson-task-references'],
    })
  }

  // handleReferenceUpload 备课时直接上传参考资料文件，成功后自动挂到当前任务草稿。
  const handleReferenceUpload = async (file: File) => {
    setUploadingRef(true)
    try {
      const res = await uploadSharedArtifact(file, 0)
      setTaskDraft((prev) =>
        prev
          ? {
              ...prev,
              reference_artifacts: appendIdToList(
                prev.reference_artifacts ?? '',
                res.id
              ),
            }
          : prev
      )
      await refreshReferences()
      toast.success(t('参考资料已上传并挂到当前任务'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('上传失败'))
    } finally {
      setUploadingRef(false)
    }
  }

  // toggleReference 在任务草稿上勾选 / 取消勾选一份参考资料。
  const toggleReference = (id: number) => {
    setTaskDraft((prev) => {
      if (!prev) return prev
      const ids = (prev.reference_artifacts ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      const next = ids.includes(String(id))
        ? ids.filter((item) => item !== String(id))
        : [...ids, String(id)]
      return { ...prev, reference_artifacts: next.join(',') }
    })
  }

  // selectedReferenceIds 当前任务草稿已挂载的素材 id 集合。
  const selectedReferenceIds = new Set(
    (taskDraft?.reference_artifacts ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (success) toast.success(success)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
      return false
    } finally {
      setBusy(false)
    }
  }

  // ---------- Excel 批量导入 ----------

  const handleImportExcel = async (file: File) => {
    setBusy(true)
    try {
      const result = await importLessonPlans(file)
      await refresh()
      const summary = t(
        '单元 新建 {{units}} / 更新 {{unitsUp}}，课时 新建 {{lessons}} / 更新 {{lessonsUp}}，任务 新建 {{tasks}} / 更新 {{tasksUp}}（共 {{rows}} 行）',
        {
          units: result.units_created,
          unitsUp: result.units_updated,
          lessons: result.lessons_created,
          lessonsUp: result.lessons_updated,
          tasks: result.tasks_created,
          tasksUp: result.tasks_updated,
          rows: result.total_rows,
        }
      )
      if (result.failed.length > 0) {
        setImportFailures(result.failed)
        toast.warning(
          t('导入完成：{{summary}}，{{failed}} 条失败（点击查看全部）', {
            summary,
            failed: result.failed.length,
          })
        )
      } else {
        toast.success(t('导入完成：{{summary}}', { summary }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导入失败'))
    } finally {
      setBusy(false)
    }
  }

  // ---------- 单元 ----------

  const openUnitDraft = (unit?: AiHubUnit) => {
    if (unit) {
      setUnitDraft({ ...unit })
      return
    }
    setUnitDraft({
      section_id: sectionId,
      grade_index: gradeIndex,
      name: '',
      description: '',
      sort_order: units.length + 1,
    })
  }

  const submitUnit = async () => {
    if (!unitDraft) return
    if (!unitDraft.name?.trim()) {
      toast.error(t('请输入单元名称'))
      return
    }
    const ok = await run(
      () => saveUnit(unitDraft),
      unitDraft.id ? t('单元已更新') : t('单元已创建')
    )
    if (ok) setUnitDraft(null)
  }

  // ---------- 课时 ----------

  const openLessonDraft = (lesson?: AiHubLesson) => {
    if (lesson) {
      setLessonDraft({ ...lesson })
      return
    }
    if (!currentUnit) {
      toast.error(t('请先创建单元'))
      return
    }
    setLessonDraft({
      unit_id: currentUnit.id,
      title: '',
      description: '',
      ai_course: false,
      sort_order: lessons.length + 1,
    })
  }

  const submitLesson = async () => {
    if (!lessonDraft) return
    if (!lessonDraft.title?.trim()) {
      toast.error(t('请输入课时标题'))
      return
    }
    const ok = await run(
      () => saveLesson(lessonDraft),
      lessonDraft.id ? t('课时已更新') : t('课时已创建')
    )
    if (ok) setLessonDraft(null)
  }

  // ---------- 分项任务 ----------

  const openTaskDraft = (task?: AiHubLessonTask) => {
    if (task) {
      setTaskDraft({ ...task })
      return
    }
    if (!currentLesson) {
      toast.error(t('请先创建课时'))
      return
    }
    setTaskDraft({
      lesson_id: currentLesson.id,
      title: '',
      requirement: '',
      output_forms: 'text',
      allowed_extensions: '',
      max_uploads: 1,
      max_submits: 0,
      sort_order: tasks.length + 1,
    })
  }

  const submitTask = async () => {
    if (!taskDraft) return
    if (!taskDraft.title?.trim()) {
      toast.error(t('请输入任务标题'))
      return
    }
    const ok = await run(
      () => saveLessonTask(taskDraft),
      taskDraft.id ? t('任务已更新') : t('任务已创建')
    )
    if (ok) setTaskDraft(null)
  }

  return (
    <PageShell
      title={t('备课模式')}
      description={t(
        '按「年级 → 单元 → 课时 → 分项任务」编排课程；年级随入学年份自动推算，单元与课时可长期复用。'
      )}
      actions={
        <div className='flex flex-wrap gap-2'>
          <Button
            disabled={busy}
            onClick={() => void downloadLessonImportTemplate()}
          >
            {t('下载导入模板')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            {t('Excel 导入')}
          </Button>
          <Button disabled={busy} onClick={() => void refresh()}>
            {t('刷新')}
          </Button>
        </div>
      }
    >
      <Panel title={t('备课范围')}>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          <Field label={t('学部')}>
            <Select
              value={String(sectionId || '')}
              onChange={(value) => {
                setSectionId(Number(value))
                setSelectedUnitId(0)
                setSelectedLessonId(0)
              }}
              options={sectionOptions}
              placeholder={t('请选择学部')}
            />
          </Field>
          <Field label={t('年级')}>
            <Select
              value={String(gradeIndex || '')}
              onChange={(value) => {
                setGradeIndex(Number(value))
                setSelectedUnitId(0)
                setSelectedLessonId(0)
              }}
              options={currentGradeOptions.map((option) => ({
                label: option.grade_name,
                value: String(option.grade_index),
              }))}
              placeholder={t('请选择年级')}
            />
          </Field>
          <Field label={t('当前学年')}>
            <div className='text-muted-foreground flex h-8 items-center text-[13px]'>
              {gradeName
                ? t('当前备课年级：{{grade}}', { grade: gradeName })
                : t('请选择学部与年级')}
            </div>
          </Field>
        </div>
      </Panel>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <div className='flex flex-col gap-4'>
          <Panel
            bodyClassName='p-0'
            title={t('单元')}
            description={t('单元归属于当前年级，可长期保存与复用。')}
            actions={
              <Button
                variant='primary'
                disabled={busy || sectionId <= 0 || gradeIndex <= 0}
                onClick={() => openUnitDraft()}
              >
                {t('新建单元')}
              </Button>
            }
          >
            <Table
              headers={[t('单元名称'), t('课时数'), t('排序'), t('操作')]}
              isEmpty={!plansQuery.isLoading && units.length === 0}
              empty={plansQuery.isLoading ? t('正在加载…') : t('暂无单元')}
            >
              {units.map((unit) => (
                <tr
                  key={unit.id}
                  className={
                    unit.id === currentUnit?.id
                      ? 'border-border/60 bg-primary/5 cursor-pointer border-b'
                      : 'border-border/60 cursor-pointer border-b'
                  }
                  onClick={() => {
                    setSelectedUnitId(unit.id)
                    setSelectedLessonId(0)
                  }}
                >
                  <Td>
                    <div className='font-medium'>{unit.name}</div>
                    {unit.description && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>
                        {unit.description}
                      </div>
                    )}
                  </Td>
                  <Td className='tabular-nums'>{unit.lesson_count ?? 0}</Td>
                  <Td className='tabular-nums'>{unit.sort_order}</Td>
                  <Td className='whitespace-nowrap'>
                    <div
                      className='flex gap-2'
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        disabled={busy}
                        onClick={() => openUnitDraft(unit)}
                      >
                        {t('编辑')}
                      </Button>
                      <Button
                        variant='danger'
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => deleteUnit(unit.id),
                            t('单元及其课时已删除')
                          )
                        }
                      >
                        {t('删除')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel
            bodyClassName='p-0'
            title={t('课时')}
            description={currentUnit ? currentUnit.name : t('请先选择单元')}
            actions={
              <Button
                variant='primary'
                disabled={busy || !currentUnit}
                onClick={() => openLessonDraft()}
              >
                {t('新建课时')}
              </Button>
            }
          >
            <Table
              headers={[t('课时标题'), t('课程类型'), t('任务数'), t('操作')]}
              isEmpty={lessons.length === 0}
              empty={t('暂无课时')}
            >
              {lessons.map((lesson) => (
                <tr
                  key={lesson.id}
                  className={
                    lesson.id === currentLesson?.id
                      ? 'border-border/60 bg-primary/5 cursor-pointer border-b'
                      : 'border-border/60 cursor-pointer border-b'
                  }
                  onClick={() => setSelectedLessonId(lesson.id)}
                >
                  <Td>
                    <div className='font-medium'>{lesson.title}</div>
                    {lesson.description && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>
                        {lesson.description}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={lesson.ai_course ? 'success' : 'muted'}>
                      {lesson.ai_course ? t('AI 课程') : t('普通课程')}
                    </Badge>
                  </Td>
                  <Td className='tabular-nums'>{lesson.task_count ?? 0}</Td>
                  <Td className='whitespace-nowrap'>
                    <div
                      className='flex gap-2'
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        disabled={busy}
                        onClick={() => openLessonDraft(lesson)}
                      >
                        {t('编辑')}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(() => copyLesson(lesson.id), t('课时已复制'))
                        }
                      >
                        {t('复制')}
                      </Button>
                      <Button
                        variant='danger'
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => deleteLesson(lesson.id),
                            t('课时及其任务已删除')
                          )
                        }
                      >
                        {t('删除')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>

        <Panel
          bodyClassName='p-0'
          title={t('分项任务')}
          description={
            currentLesson
              ? t('课时：{{title}}', { title: currentLesson.title })
              : t('请先选择课时')
          }
          actions={
            <Button
              variant='primary'
              disabled={busy || !currentLesson}
              onClick={() => openTaskDraft()}
            >
              {t('新建任务')}
            </Button>
          }
        >
          <Table
            headers={[
              t('任务'),
              t('产出形式'),
              t('允许后缀'),
              t('上传上限'),
              t('提交次数上限'),
              t('参考资料'),
              t('操作'),
            ]}
            isEmpty={tasks.length === 0}
            empty={t('暂无分项任务')}
          >
            {tasks.map((task) => (
              <tr key={task.id} className='border-border/60 border-b'>
                <Td>
                  <div className='font-medium'>{task.title}</div>
                  {task.requirement && (
                    <div className='text-muted-foreground mt-0.5 line-clamp-3 text-xs'>
                      {task.requirement}
                    </div>
                  )}
                </Td>
                <Td className='text-xs'>
                  {outputFormLabels(task.output_forms)}
                </Td>
                <Td className='text-muted-foreground text-xs'>
                  {task.allowed_extensions || t('不限')}
                </Td>
                <Td className='tabular-nums'>{task.max_uploads}</Td>
                <Td className='tabular-nums'>
                  {task.max_submits > 0 ? task.max_submits : t('不限')}
                </Td>
                <Td className='tabular-nums'>
                  {(() => {
                    const count = (task.reference_artifacts ?? '')
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean).length
                    return count > 0 ? `${count} ${t('份')}` : t('—')
                  })()}
                </Td>
                <Td className='whitespace-nowrap'>
                  <div className='flex gap-2'>
                    <Button disabled={busy} onClick={() => openTaskDraft(task)}>
                      {t('编辑')}
                    </Button>
                    <Button
                      variant='danger'
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => deleteLessonTask(task.id),
                          t('任务已删除')
                        )
                      }
                    >
                      {t('删除')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <Modal
        open={unitDraft !== null}
        title={unitDraft?.id ? t('编辑单元') : t('新建单元')}
        onClose={() => setUnitDraft(null)}
        footer={
          <>
            <Button onClick={() => setUnitDraft(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void submitUnit()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {unitDraft && (
          <div className='flex flex-col gap-3'>
            <Field label={t('单元名称')}>
              <TextInput
                value={unitDraft.name ?? ''}
                onChange={(value) =>
                  setUnitDraft({ ...unitDraft, name: value })
                }
                placeholder={t('如：第一单元 图像初识')}
              />
            </Field>
            <Field label={t('单元说明')}>
              <TextArea
                value={unitDraft.description ?? ''}
                onChange={(value) =>
                  setUnitDraft({ ...unitDraft, description: value })
                }
                rows={3}
                placeholder={t('可选：本单元的总体说明')}
              />
            </Field>
            <Field label={t('排序')}>
              <TextInput
                type='number'
                value={String(unitDraft.sort_order ?? 0)}
                onChange={(value) =>
                  setUnitDraft({
                    ...unitDraft,
                    sort_order: Number(value) || 0,
                  })
                }
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={lessonDraft !== null}
        title={lessonDraft?.id ? t('编辑课时') : t('新建课时')}
        onClose={() => setLessonDraft(null)}
        footer={
          <>
            <Button onClick={() => setLessonDraft(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void submitLesson()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {lessonDraft && (
          <div className='flex flex-col gap-3'>
            <Field label={t('课时标题')}>
              <TextInput
                value={lessonDraft.title ?? ''}
                onChange={(value) =>
                  setLessonDraft({ ...lessonDraft, title: value })
                }
                placeholder={t('如：第 1 课时 认识图像生成')}
              />
            </Field>
            <Field label={t('课时说明')}>
              <TextArea
                value={lessonDraft.description ?? ''}
                onChange={(value) =>
                  setLessonDraft({ ...lessonDraft, description: value })
                }
                rows={3}
                placeholder={t('可选：本课时教学说明')}
              />
            </Field>
            <div className='flex items-center gap-2'>
              <Switch
                checked={Boolean(lessonDraft.ai_course)}
                onChange={(checked) =>
                  setLessonDraft({ ...lessonDraft, ai_course: checked })
                }
              />
              <span className='text-foreground text-[13px]'>
                {t('标记为 AI 课程（学生端可使用 AI 创作）')}
              </span>
            </div>
            <Field label={t('排序')}>
              <TextInput
                type='number'
                value={String(lessonDraft.sort_order ?? 0)}
                onChange={(value) =>
                  setLessonDraft({
                    ...lessonDraft,
                    sort_order: Number(value) || 0,
                  })
                }
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={taskDraft !== null}
        title={taskDraft?.id ? t('编辑分项任务') : t('新建分项任务')}
        onClose={() => setTaskDraft(null)}
        footer={
          <>
            <Button onClick={() => setTaskDraft(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void submitTask()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {taskDraft && (
          <div className='flex flex-col gap-3'>
            <Field label={t('任务标题')}>
              <TextInput
                value={taskDraft.title ?? ''}
                onChange={(value) =>
                  setTaskDraft({ ...taskDraft, title: value })
                }
                placeholder={t('如：提交图像生成结果截图')}
              />
            </Field>
            <Field label={t('任务要求')}>
              <TextArea
                value={taskDraft.requirement ?? ''}
                onChange={(value) =>
                  setTaskDraft({ ...taskDraft, requirement: value })
                }
                rows={4}
                placeholder={t('学生端任务面板展示的完成要求')}
              />
            </Field>
            <Field label={t('产出形式（可多选）')}>
              <div className='flex flex-wrap gap-2'>
                {OUTPUT_FORM_OPTIONS.map((option) => {
                  const active = (taskDraft.output_forms ?? '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .includes(option.value)
                  return (
                    <Button
                      key={option.value}
                      variant={active ? 'primary' : 'outline'}
                      onClick={() =>
                        setTaskDraft({
                          ...taskDraft,
                          output_forms: toggleOutputForm(
                            taskDraft.output_forms ?? '',
                            option.value
                          ),
                        })
                      }
                    >
                      {t(option.label)}
                    </Button>
                  )
                })}
              </div>
            </Field>
            <Field label={t('允许上传的后缀（逗号分隔，留空不限）')}>
              <TextInput
                value={taskDraft.allowed_extensions ?? ''}
                onChange={(value) =>
                  setTaskDraft({ ...taskDraft, allowed_extensions: value })
                }
                placeholder='py, html, docx'
              />
            </Field>
            <Field label={t('单任务上传数量上限')}>
              <TextInput
                type='number'
                value={String(taskDraft.max_uploads ?? 1)}
                onChange={(value) =>
                  setTaskDraft({
                    ...taskDraft,
                    max_uploads: Number(value) || 1,
                  })
                }
              />
            </Field>
            <Field
              label={t('每位学生提交次数上限（0 = 不限次数，无时间限制）')}
            >
              <TextInput
                type='number'
                value={String(taskDraft.max_submits ?? 0)}
                onChange={(value) =>
                  setTaskDraft({
                    ...taskDraft,
                    max_submits: Number(value) || 0,
                  })
                }
                placeholder='0'
              />
            </Field>
            <Field label={t('任务参考资料（学生端任务面板可见，可多选）')}>
              <div className='flex flex-col gap-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    variant='outline'
                    disabled={uploadingRef}
                    onClick={() => referenceInputRef.current?.click()}
                  >
                    {uploadingRef ? t('上传中…') : t('上传新参考资料文件')}
                  </Button>
                  <span className='text-muted-foreground text-xs'>
                    {t('已选 {{n}} 份', {
                      n: selectedReferenceIds.size,
                    })}
                  </span>
                </div>
                <div className='border-border grid max-h-52 gap-1.5 overflow-y-auto rounded-md border p-2'>
                  {referencePool.length === 0 ? (
                    <p className='text-muted-foreground px-1 py-2 text-xs'>
                      {refListQuery.isLoading
                        ? t('正在加载素材…')
                        : t('暂无可用素材，可点击上方按钮上传参考资料文件')}
                    </p>
                  ) : (
                    referencePool.map((item) => {
                      const checked = selectedReferenceIds.has(String(item.id))
                      return (
                        <label
                          key={item.id}
                          className='hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5'
                        >
                          <input
                            type='checkbox'
                            checked={checked}
                            onChange={() => toggleReference(item.id)}
                            className='size-4 accent-[#6d5df6]'
                          />
                          <span className='flex-1 truncate text-[13px]'>
                            {referenceAssetName(item)}
                          </span>
                          <span className='text-muted-foreground shrink-0 text-xs'>
                            {item.class_name || t('个人素材')}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    '勾选的素材会作为任务参考资料展示给学生；上传的文件自动挂到当前任务。'
                  )}
                </p>
              </div>
            </Field>
            <Field label={t('排序')}>
              <TextInput
                type='number'
                value={String(taskDraft.sort_order ?? 0)}
                onChange={(value) =>
                  setTaskDraft({
                    ...taskDraft,
                    sort_order: Number(value) || 0,
                  })
                }
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* 备课 Excel 文件选择 */}
      <input
        ref={importInputRef}
        type='file'
        accept='.xlsx'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleImportExcel(file)
        }}
      />

      {/* 任务参考资料文件选择 */}
      <input
        ref={referenceInputRef}
        type='file'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleReferenceUpload(file)
        }}
      />

      {/* Excel 导入失败清单：全量展示逐行失败原因，便于对照模板修正后重新导入 */}
      <Modal
        open={importFailures !== null}
        title={t('导入失败清单（{{n}} 条）', {
          n: importFailures?.length ?? 0,
        })}
        onClose={() => setImportFailures(null)}
        footer={
          <Button variant='primary' onClick={() => setImportFailures(null)}>
            {t('知道了')}
          </Button>
        }
      >
        <div className='grid max-h-[50vh] gap-1.5 overflow-y-auto text-sm'>
          <p className='text-muted-foreground text-xs'>
            {t(
              '成功导入的数据已保留，仅以下行未导入。修正后可重新上传同一份文件。'
            )}
          </p>
          {(importFailures ?? []).map((item, index) => (
            <div
              key={`${item.row}-${index}`}
              className='border-border flex items-start gap-2 rounded-md border px-3 py-2'
            >
              <span className='text-muted-foreground min-w-16 shrink-0 text-xs'>
                {item.row}
              </span>
              <span className='text-destructive'>{item.reason}</span>
            </div>
          ))}
        </div>
      </Modal>
    </PageShell>
  )
}
