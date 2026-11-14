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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { AudioPlayer, VideoPlayer } from '@/components/ui/media-player'
import {
  Badge,
  Button,
  DateTimePicker,
  Field,
  Modal,
  PageShell,
  Panel,
  Select,
  Switch,
  Table,
  Td,
  TextInput,
} from '../components/kit'
import {
  deleteArtifact,
  fetchArtifactBlob,
  fetchArtifactBlobUrl,
  fetchClasses,
  fetchSectionGradeOptions,
  fetchSections,
  fetchRecords,
  packageArtifacts,
} from '../api'
import { CAPABILITY_KIND_LABEL, type AiHubRecord } from '../types'

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  SUCCESS: 'success',
  NOT_START: 'warning',
  SUBMITTED: 'warning',
  QUEUED: 'warning',
  IN_PROGRESS: 'warning',
  FAILURE: 'danger',
}

/** 生成模式（能力类型）下拉的展示顺序。 */
const KIND_ORDER = ['text', 'image', 'edit', 'tts', 'video', 'music', 'html', 'slide']

/** 可删除的产物类型：图片、视频、音乐（含图生图与声音合成），文字稿与记录保留。 */
const DELETABLE_KINDS = new Set(['image', 'edit', 'tts', 'video', 'music'])

function formatTime(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'SUCCESS':
      return t('成功')
    case 'FAILURE':
      return t('失败')
    case 'IN_PROGRESS':
      return t('生成中')
    case 'QUEUED':
    case 'SUBMITTED':
    case 'NOT_START':
      return t('排队中')
    default:
      return status || '-'
  }
}

function toUnix(value: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000)
}

// recordMediaKind 依据能力类型决定预览方式：图片走 <img>，音视频走对应播放器。
function recordMediaKind(kind: string): 'image' | 'audio' | 'video' | 'text' | 'none' {
  if (kind === 'text') return 'text'
  if (kind === 'image' || kind === 'edit') return 'image'
  if (kind === 'tts' || kind === 'music') return 'audio'
  if (kind === 'video') return 'video'
  return 'none'
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'text/plain': '.txt',
}

function extFromMime(mime: string): string {
  return MIME_EXT[mime] ?? ''
}

export function RecordsSection(props: { admin: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  // 包含已毕业学生：学生升年级 / 转班后仍可按当前班级追溯历史记录。
  const [includeGraduated, setIncludeGraduated] = useState(false)
  const [sectionId, setSectionId] = useState('')
  const [gradeIndex, setGradeIndex] = useState('')
  const [classId, setClassId] = useState('')
  const [kind, setKind] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [detailRecord, setDetailRecord] = useState<AiHubRecord | null>(null)
  const [detailUrl, setDetailUrl] = useState('')
  const [preview, setPreview] = useState<{ record: AiHubRecord; url: string } | null>(
    null
  )
  const [pendingDelete, setPendingDelete] = useState<AiHubRecord | null>(null)
  const [busy, setBusy] = useState(false)

  const sectionsQuery = useQuery({
    queryKey: ['ai-hub', 'sections'],
    queryFn: fetchSections,
    enabled: props.admin,
  })

  const gradeOptionsQuery = useQuery({
    queryKey: ['ai-hub', 'section-options'],
    queryFn: fetchSectionGradeOptions,
    enabled: props.admin,
  })

  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
    enabled: props.admin,
  })

  const recordsQuery = useQuery({
    queryKey: [
      'ai-hub',
      'records',
      props.admin,
      page,
      keyword,
      includeGraduated,
      sectionId,
      gradeIndex,
      classId,
      kind,
      start,
      end,
    ],
    queryFn: () =>
      fetchRecords(
        {
          page,
          page_size: 20,
          keyword: keyword.trim() || undefined,
          include_graduated: includeGraduated || undefined,
          class_id: classId ? Number(classId) : undefined,
          section_id: sectionId ? Number(sectionId) : undefined,
          grade_index: gradeIndex ? Number(gradeIndex) : undefined,
          kind: kind || undefined,
          start_timestamp: toUnix(start) || undefined,
          end_timestamp: toUnix(end) || undefined,
        },
        props.admin
      ),
  })

  const data = recordsQuery.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  // 预览对象 URL 随预览关闭或组件卸载释放。
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ai-hub', 'records'] })

  const sectionOptions = useMemo(
    () => [
      { label: t('全部学部'), value: '' },
      ...(sectionsQuery.data ?? []).map((section) => ({
        label: `${section.name}（${section.code}）`,
        value: String(section.id),
      })),
    ],
    [sectionsQuery.data, t]
  )

  // 年级选项来自后端按「届别 + 学制」实时换算，仅展示已选学部下的年级。
  const gradeOptions = useMemo(
    () => [
      { label: t('全部年级'), value: '' },
      ...(sectionId
        ? (gradeOptionsQuery.data ?? [])
            .filter((opt) => opt.section_id === Number(sectionId))
            .map((opt) => ({
              label: opt.grade_name,
              value: String(opt.grade_index),
            }))
        : []),
    ],
    [gradeOptionsQuery.data, sectionId, t]
  )

  const classOptions = useMemo(
    () => [
      { label: t('全部班级'), value: '' },
      ...(classesQuery.data ?? [])
        .filter((item) => !sectionId || String(item.section_id) === sectionId)
        .filter((item) => !gradeIndex || String(item.grade_index) === gradeIndex)
        .map((item) => ({
          label: `${item.name}${item.grade_name ? `（${item.grade_name}）` : ''}`,
          value: String(item.id),
        })),
    ],
    [classesQuery.data, sectionId, gradeIndex, t]
  )

  const kindOptions = useMemo(
    () => [
      { label: t('全部生成模式'), value: '' },
      ...KIND_ORDER.map((value) => ({
        label: CAPABILITY_KIND_LABEL[value] ?? value,
        value,
      })),
    ],
    [t]
  )

  const resetFilters = () => {
    setKeyword('')
    setSectionId('')
    setGradeIndex('')
    setClassId('')
    setKind('')
    setStart('')
    setEnd('')
    setPage(1)
    setSelected([])
  }

  const toggleSelect = (artifactId: number) => {
    setSelected((prev) =>
      prev.includes(artifactId)
        ? prev.filter((id) => id !== artifactId)
        : [...prev, artifactId]
    )
  }

  const openPreview = async (record: AiHubRecord) => {
    if (!record.artifact_id) {
      toast.error(t('该记录暂无关联产物'))
      return
    }
    if (preview?.url) URL.revokeObjectURL(preview.url)
    if (recordMediaKind(record.capability) === 'text') {
      setPreview({ record, url: '' })
      return
    }
    setBusy(true)
    try {
      const url = await fetchArtifactBlobUrl(record.artifact_id)
      setPreview({ record, url })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('预览失败'))
    } finally {
      setBusy(false)
    }
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  // openDetail 打开详情弹窗；图片 / 音视频类型同时拉取产物用于内嵌预览。
  const openDetail = async (record: AiHubRecord) => {
    setDetailRecord(record)
    if (detailUrl) {
      URL.revokeObjectURL(detailUrl)
      setDetailUrl('')
    }
    const media = recordMediaKind(record.capability)
    if (media !== 'text' && media !== 'none' && record.artifact_id) {
      try {
        setDetailUrl(await fetchArtifactBlobUrl(record.artifact_id))
      } catch {
        // 拉取失败不阻断详情，文本信息仍可查看。
      }
    }
  }

  const closeDetail = () => {
    if (detailUrl) URL.revokeObjectURL(detailUrl)
    setDetailUrl('')
    setDetailRecord(null)
  }

  const handleDownload = async (record: AiHubRecord) => {
    if (!record.artifact_id) {
      toast.error(t('该记录暂无关联产物'))
      return
    }
    setBusy(true)
    try {
      const blob = await fetchArtifactBlob(record.artifact_id)
      const ext = extFromMime(blob.type)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `workspace-artifact-${record.artifact_id}${ext}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('下载失败'))
    } finally {
      setBusy(false)
    }
  }

  const handlePackage = async () => {
    if (selected.length === 0) return
    setBusy(true)
    try {
      await packageArtifacts(selected)
      toast.success(t('已开始打包下载 {{count}} 个产物', { count: selected.length }))
      setSelected([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('打包下载失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete?.artifact_id) return
    setBusy(true)
    try {
      const result = await deleteArtifact(pendingDelete.artifact_id)
      if (result.deleted > 0) {
        toast.success(t('已删除该产物'))
      } else {
        toast.error(t('删除失败，该产物可能已提交或已被清理'))
      }
      setSelected((prev) => prev.filter((id) => id !== pendingDelete.artifact_id))
      setPendingDelete(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('删除失败'))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const previewRecord = preview?.record ?? null
  const previewUrl = preview?.url ?? ''

  return (
    <PageShell
      title={props.admin ? t('使用记录') : t('我的记录')}
      description={
        props.admin
          ? t(
              '查看全部学生的生成记录，可按学生姓名、学部、年级、班级、时间段与生成模式筛选。'
            )
          : t('这里可以看到你生成过的全部内容与消耗。')
      }
      actions={
        props.admin ? (
          <Button
            variant='primary'
            disabled={busy || selected.length === 0}
            onClick={() => void handlePackage()}
          >
            {t('打包下载（{{count}}）', { count: selected.length })}
          </Button>
        ) : undefined
      }
    >
      <Panel>
        <div className='grid gap-3 md:grid-cols-4'>
          {props.admin && (
            <Field label={t('学部')}>
              <Select
                value={sectionId}
                options={sectionOptions}
                onChange={(value) => {
                  setSectionId(value)
                  setGradeIndex('')
                  setClassId('')
                  setPage(1)
                  setSelected([])
                }}
              />
            </Field>
          )}
          {props.admin && (
            <Field label={t('年级')}>
              <Select
                value={gradeIndex}
                disabled={!sectionId}
                options={gradeOptions}
                onChange={(value) => {
                  setGradeIndex(value)
                  setClassId('')
                  setPage(1)
                  setSelected([])
                }}
              />
            </Field>
          )}
          {props.admin && (
            <Field label={t('班级')}>
              <Select
                value={classId}
                options={classOptions}
                onChange={(value) => {
                  setClassId(value)
                  setPage(1)
                  setSelected([])
                }}
              />
            </Field>
          )}
          {props.admin && (
            <Field label={t('学生姓名')}>
              <TextInput
                value={keyword}
                onChange={(value) => {
                  setKeyword(value)
                  setPage(1)
                  setSelected([])
                }}
                placeholder={t('输入姓名或姓名拼音关键词')}
              />
            </Field>
          )}
          {props.admin && (
            <Field label={t('学生范围')}>
              <Switch
                checked={includeGraduated}
                onChange={(checked) => {
                  setIncludeGraduated(checked)
                  setPage(1)
                  setSelected([])
                }}
                label={t('包含已毕业')}
              />
            </Field>
          )}
          <Field label={t('开始时间')}>
            <DateTimePicker
              value={start}
              placeholder={t('选择开始时间')}
              onChange={(value) => {
                setStart(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
          <Field label={t('结束时间')}>
            <DateTimePicker
              value={end}
              placeholder={t('选择结束时间')}
              onChange={(value) => {
                setEnd(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
          <Field label={t('生成模式')}>
            <Select
              value={kind}
              options={kindOptions}
              onChange={(value) => {
                setKind(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
          <div className='flex items-end gap-2'>
            <Button onClick={resetFilters}>{t('重置筛选')}</Button>
          </div>
        </div>
      </Panel>

      <Panel
        bodyClassName='p-0'
        title={`${t('生成记录')}${data ? `（${data.total}）` : ''}`}
      >
        <Table
          headers={[
            ...(props.admin ? [t('选择')] : []),
            t('时间'),
            ...(props.admin ? [t('账号')] : []),
            t('能力'),
            t('模型'),
            t('内容摘要'),
            t('状态'),
            t('消耗点数'),
            t('操作'),
          ]}
          isEmpty={!recordsQuery.isLoading && (data?.items.length ?? 0) === 0}
          empty={recordsQuery.isLoading ? t('正在加载…') : t('暂无生成记录')}
        >
          {(data?.items ?? []).map((record: AiHubRecord) => (
            <tr key={record.key} className='border-b border-border/60'>
              {props.admin && (
                <Td className='whitespace-nowrap'>
                  <input
                    type='checkbox'
                    disabled={!record.artifact_id}
                    checked={
                      record.artifact_id ? selected.includes(record.artifact_id) : false
                    }
                    onChange={() =>
                      record.artifact_id && toggleSelect(record.artifact_id)
                    }
                  />
                </Td>
              )}
              <Td className='whitespace-nowrap text-muted-foreground'>
                {formatTime(record.created_at)}
              </Td>
              {props.admin && (
                <Td className='whitespace-nowrap'>
                  <div>{record.student_name || record.username || record.user_id}</div>
                  {record.student_no ? (
                    <div className='text-xs text-muted-foreground'>
                      {t('学号')} {record.student_no}
                      {record.class_name ? ` · ${record.class_name}` : ''}
                      {record.grade_name ? ` · ${record.grade_name}` : ''}
                    </div>
                  ) : null}
                </Td>
              )}
              <Td className='whitespace-nowrap'>
                {CAPABILITY_KIND_LABEL[record.capability] || '-'}
              </Td>
              <Td className='whitespace-nowrap'>{record.model || '-'}</Td>
              <Td className='max-w-[280px] truncate' >{record.title || '-'}</Td>
              <Td className='whitespace-nowrap'>
                <Badge tone={STATUS_TONE[record.status] ?? 'muted'}>
                  {statusLabel(record.status, t)}
                </Badge>
              </Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {record.points ? record.points : '—'}
              </Td>
              <Td className='whitespace-nowrap'>
                <div className='flex gap-2'>
                  <Button onClick={() => void openDetail(record)}>
                    {t('详情')}
                  </Button>
                  <Button
                    disabled={busy || !record.artifact_id}
                    onClick={() => void openPreview(record)}
                  >
                    {t('预览')}
                  </Button>
                  <Button
                    disabled={busy || !record.artifact_id}
                    onClick={() => void handleDownload(record)}
                  >
                    {t('下载')}
                  </Button>
                  {props.admin &&
                    record.artifact_id &&
                    DELETABLE_KINDS.has(record.capability) && (
                      <Button
                        variant='danger'
                        disabled={busy}
                        onClick={() => setPendingDelete(record)}
                      >
                        {t('删除')}
                      </Button>
                    )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
        <div className='flex items-center justify-between px-3 py-2 text-xs text-muted-foreground'>
          <span>
            {t('第')} {data?.page ?? 1} / {totalPages} {t('页')}
          </span>
          <div className='flex gap-2'>
            <Button
              disabled={page <= 1}
              onClick={() => {
                setPage((prev) => Math.max(1, prev - 1))
                setSelected([])
              }}
            >
              {t('上一页')}
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => {
                setPage((prev) => prev + 1)
                setSelected([])
              }}
            >
              {t('下一页')}
            </Button>
          </div>
        </div>
      </Panel>

      <Modal
        open={Boolean(detailRecord)}
        title={t('生成详情')}
        onClose={closeDetail}
      >
        {detailRecord && (
          <div className='flex flex-col gap-4 text-sm'>
            <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
              <div>
                <dt className='text-xs text-muted-foreground'>{t('时间')}</dt>
                <dd className='mt-1 tabular-nums text-foreground'>
                  {formatTime(detailRecord.created_at)}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>{t('消耗点数')}</dt>
                <dd className='mt-1 font-semibold tabular-nums text-foreground'>
                  {detailRecord.points ? `${detailRecord.points} ${t('点')}` : '—'}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>{t('生成耗时')}</dt>
                <dd className='mt-1 tabular-nums text-foreground'>
                  {detailRecord.duration_ms
                    ? `${(detailRecord.duration_ms / 1000).toFixed(1)} ${t('秒')}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>{t('能力')}</dt>
                <dd className='mt-1 text-foreground'>
                  {CAPABILITY_KIND_LABEL[detailRecord.capability] || '-'}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>{t('模型')}</dt>
                <dd className='mt-1 break-all text-foreground'>
                  {detailRecord.model || '-'}
                </dd>
              </div>
              {props.admin && (
                <div>
                  <dt className='text-xs text-muted-foreground'>{t('账号')}</dt>
                  <dd className='mt-1 text-foreground'>
                    {detailRecord.username || detailRecord.user_id}
                  </dd>
                </div>
              )}
              <div>
                <dt className='text-xs text-muted-foreground'>{t('状态')}</dt>
                <dd className='mt-1'>
                  <Badge tone={STATUS_TONE[detailRecord.status] ?? 'muted'}>
                    {statusLabel(detailRecord.status, t)}
                  </Badge>
                </dd>
              </div>
            </dl>

            {detailRecord.fail_reason && (
              <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
                {detailRecord.fail_reason}
              </div>
            )}

            <div>
              <div className='text-xs font-medium text-muted-foreground'>
                {t('我发送的内容')}
              </div>
              <div className='mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2 leading-relaxed text-foreground'>
                {detailRecord.prompt?.trim() || t('（本次未记录提交内容）')}
              </div>
            </div>

            <div>
              <div className='text-xs font-medium text-muted-foreground'>
                {t('收到的内容')}
              </div>
              {detailRecord.result_preview?.trim() ? (
                <div className='mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2 leading-relaxed text-foreground'>
                  {detailRecord.result_preview}
                </div>
              ) : (
                <div className='mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground'>
                  {t('（本次未记录返回内容）')}
                </div>
              )}
            </div>

            {detailUrl &&
              (() => {
                const media = recordMediaKind(detailRecord.capability)
                if (media !== 'image' && media !== 'video' && media !== 'audio') {
                  return null
                }
                return (
                  <div>
                    <div className='text-xs font-medium text-muted-foreground'>
                      {t('生成结果预览')}
                    </div>
                    <div className='mt-2 flex flex-col items-center gap-3 rounded-md border border-border bg-muted/30 p-3'>
                      {media === 'image' && (
                        <img
                          src={detailUrl}
                          alt={t('生成结果')}
                          className='max-h-[50vh] w-auto object-contain'
                        />
                      )}
                      {media === 'video' && (
                        <VideoPlayer
                          src={detailUrl}
                          downloadName={`产物-${detailRecord.key}`}
                          className='max-h-[50vh] w-full'
                        />
                      )}
                      {media === 'audio' && (
                        <AudioPlayer
                          src={detailUrl}
                          downloadName={`产物-${detailRecord.key}`}
                          className='w-full'
                        />
                      )}
                      <Button
                        variant='primary'
                        disabled={busy}
                        onClick={() => void handleDownload(detailRecord)}
                      >
                        {t('下载该产物')}
                      </Button>
                    </div>
                  </div>
                )
              })()}
          </div>
        )}
      </Modal>

      <Modal
        open={preview !== null}
        title={t('产物预览')}
        onClose={closePreview}
        footer={
          <>
            <Button onClick={closePreview}>{t('关闭')}</Button>
            <Button
              variant='primary'
              disabled={busy || !previewRecord}
              onClick={() => previewRecord && void handleDownload(previewRecord)}
            >
              {t('下载')}
            </Button>
          </>
        }
      >
        {previewRecord && (
          <div className='grid gap-3'>
            <div className='flex min-h-[160px] items-center justify-center rounded-md border border-border bg-muted/30 p-3'>
              {recordMediaKind(previewRecord.capability) === 'text' && (
                <p className='w-full whitespace-pre-wrap break-words text-[13px] text-foreground'>
                  {previewRecord.result_preview?.trim() ||
                    t('该产物无预览内容，请下载查看。')}
                </p>
              )}
              {recordMediaKind(previewRecord.capability) === 'image' && previewUrl && (
                <img
                  src={previewUrl}
                  alt={t('生成结果')}
                  className='max-h-[50vh] w-auto object-contain'
                />
              )}
              {recordMediaKind(previewRecord.capability) === 'audio' && previewUrl && (
                <AudioPlayer
                  src={previewUrl}
                  downloadName={`产物-${previewRecord.key}`}
                  className='w-full'
                />
              )}
              {recordMediaKind(previewRecord.capability) === 'video' && previewUrl && (
                <VideoPlayer
                  src={previewUrl}
                  downloadName={`产物-${previewRecord.key}`}
                  className='max-h-[50vh] w-full'
                />
              )}
              {recordMediaKind(previewRecord.capability) === 'none' && (
                <p className='text-[13px] text-muted-foreground'>
                  {t('该类型暂不支持在线预览，请下载后查看。')}
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title={t('确认删除产物')}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>{t('取消')}</Button>
            <Button
              variant='danger'
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {t('确认删除')}
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-foreground'>
          {t('将删除该条生成记录对应的产物文件，删除后不可恢复。生成记录与文字稿会保留。')}
        </p>
      </Modal>
    </PageShell>
  )
}
