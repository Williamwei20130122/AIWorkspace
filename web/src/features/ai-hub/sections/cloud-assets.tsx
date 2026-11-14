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

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { AudioPlayer, VideoPlayer } from '@/components/ui/media-player'

import {
  fetchArtifactBlobUrl,
  fetchArtifactRetentionDays,
  fetchArtifacts,
  fetchClasses,
  fetchSectionGradeOptions,
  fetchSections,
  purgeArtifacts,
  saveArtifactRetentionDays,
  shareArtifact,
  type ArtifactPurgePayload,
} from '../api'
import {
  Badge,
  Button,
  DatePicker,
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
import { CAPABILITY_KIND_LABEL, type AiHubArtifact } from '../types'

/** 能力类型下拉的展示顺序。 */
const KIND_ORDER = ['text', 'image', 'edit', 'tts', 'video', 'music', 'html', 'slide']

/** 每页条数。 */
const PAGE_SIZE = 20

/** 批量清理模式：按时间段 / 按班级。 */
const PURGE_MODE_RANGE = 'range'
const PURGE_MODE_CLASS = 'class'

type PurgeMode = typeof PURGE_MODE_RANGE | typeof PURGE_MODE_CLASS

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fileNameOf(artifact: AiHubArtifact): string {
  const name = artifact.storage_path.split(/[\\/]/).pop()
  return name || `artifact-${artifact.id}`
}

// 可内联预览的能力类型：图片类走 <img>，音视频类走对应播放器。
function previewKind(kind: string): 'image' | 'audio' | 'video' | 'text' | 'none' {
  if (kind === 'text') return 'text'
  if (kind === 'image' || kind === 'edit') return 'image'
  if (kind === 'tts' || kind === 'music') return 'audio'
  if (kind === 'video') return 'video'
  return 'none'
}

export function CloudAssetsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const isSuperAdmin = role >= ROLE.SUPER_ADMIN

  // 筛选条件
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // keyword 学生姓名 / 姓名拼音；组织维度按学部 / 年级 / 班级筛选，不再依赖原生 ID。
  const [keyword, setKeyword] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [gradeIndex, setGradeIndex] = useState('')
  const [classId, setClassId] = useState('')
  // includeGraduated 包含已毕业学生：素材归属按学生当前班级实时换算，毕业后仍可追溯。
  const [includeGraduated, setIncludeGraduated] = useState(false)
  // sharedOnly 只看班级共享素材（云端素材按班级共享）。
  const [sharedOnly, setSharedOnly] = useState(false)
  // shareTarget 待共享的素材与目标班级（弹窗内选择）。
  const [shareTarget, setShareTarget] = useState<{
    artifact: AiHubArtifact
    classId: string
  } | null>(null)
  const [page, setPage] = useState(1)

  // 选择与预览
  const [selected, setSelected] = useState<number[]>([])
  const [preview, setPreview] = useState<{ artifact: AiHubArtifact; url: string } | null>(
    null
  )
  // deleteTargets 待清理的素材 id：勾选清理与单行清理共用同一个确认弹窗。
  const [deleteTargets, setDeleteTargets] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  // 批量清理
  const [purgeMode, setPurgeMode] = useState<PurgeMode>(PURGE_MODE_RANGE)
  const [purgeFrom, setPurgeFrom] = useState('')
  const [purgeTo, setPurgeTo] = useState('')
  const [purgeClassId, setPurgeClassId] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(false)

  // 自动清理设置（仅超管）：素材创建超过 N 天后自动删除文件，保留记录但禁止下载。
  const [retentionDays, setRetentionDays] = useState('')
  const [retentionSaving, setRetentionSaving] = useState(false)

  const sectionsQuery = useQuery({
    queryKey: ['ai-hub', 'sections'],
    queryFn: fetchSections,
  })

  const gradeOptionsQuery = useQuery({
    queryKey: ['ai-hub', 'section-options'],
    queryFn: fetchSectionGradeOptions,
  })

  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
  })

  const artifactsQuery = useQuery({
    queryKey: [
      'ai-hub',
      'artifacts',
      page,
      kind,
      from,
      to,
      keyword,
      includeGraduated,
      sharedOnly,
      sectionId,
      gradeIndex,
      classId,
    ],
    queryFn: () =>
      fetchArtifacts({
        page,
        page_size: PAGE_SIZE,
        kind: kind || undefined,
        from: from || undefined,
        to: to || undefined,
        keyword: keyword.trim() || undefined,
        include_graduated: includeGraduated || undefined,
        shared: sharedOnly || undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        grade_index: gradeIndex ? Number(gradeIndex) : undefined,
        class_id: classId ? Number(classId) : undefined,
      }),
  })

  // 自动清理保留天数：仅超管读取，拉取后回填输入框。
  const retentionQuery = useQuery({
    queryKey: ['ai-hub', 'artifact-retention'],
    queryFn: fetchArtifactRetentionDays,
    enabled: isSuperAdmin,
  })

  useEffect(() => {
    if (retentionQuery.data !== undefined) {
      setRetentionDays(String(retentionQuery.data))
    }
  }, [retentionQuery.data])

  const data = artifactsQuery.data
  const items = data?.items ?? []
  const stats = data?.stats ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  const kindOptions = useMemo(
    () => [
      { label: t('全部类型'), value: '' },
      ...KIND_ORDER.map((value) => ({
        label: CAPABILITY_KIND_LABEL[value] ?? value,
        value,
      })),
    ],
    [t]
  )

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

  // 年级选项由后端按「届别 + 学制」实时换算，仅展示已选学部下的年级。
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

  // 批量清理用的班级下拉不随筛选条件联动，直接展示全部班级。
  const purgeClassOptions = useMemo(
    () => [
      { label: t('请选择班级'), value: '' },
      ...(classesQuery.data ?? []).map((item) => ({
        label: `${item.name}${item.grade_name ? `（${item.grade_name}）` : ''}`,
        value: String(item.id),
      })),
    ],
    [classesQuery.data, t]
  )

  // 预览对象 URL 随预览关闭或组件卸载释放。
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ai-hub', 'artifacts'] })

  const resetFilters = () => {
    setKind('')
    setFrom('')
    setTo('')
    setKeyword('')
    setSectionId('')
    setGradeIndex('')
    setClassId('')
    setIncludeGraduated(false)
    setSharedOnly(false)
    setPage(1)
    setSelected([])
  }

  const toggleSelect = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const openPreview = async (artifact: AiHubArtifact) => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    if (previewKind(artifact.kind) === 'text') {
      setPreview({ artifact, url: '' })
      return
    }
    if (artifact.file_purged) {
      toast.error(t('该素材已超过保留期限自动清理，记录保留但不可预览下载'))
      return
    }
    setBusy(true)
    try {
      const url = await fetchArtifactBlobUrl(artifact.id)
      setPreview({ artifact, url })
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

  const handleDownload = async (artifact: AiHubArtifact) => {
    if (artifact.file_purged) {
      toast.error(t('该素材已超过保留期限自动清理，记录保留但不可预览下载'))
      return
    }
    setBusy(true)
    try {
      const url = await fetchArtifactBlobUrl(artifact.id)
      const link = document.createElement('a')
      link.href = url
      link.download = fileNameOf(artifact)
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

  const handleDeleteSelected = async () => {
    if (deleteTargets.length === 0) return
    setBusy(true)
    try {
      const result = await purgeArtifacts({ ids: deleteTargets })
      toast.success(
        t('已清理 {{count}} 个素材，释放 {{size}}', {
          count: result.deleted,
          size: formatSize(result.released_bytes),
        })
      )
      setSelected((prev) => prev.filter((id) => !deleteTargets.includes(id)))
      setDeleteTargets([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('清理失败'))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  // 素材共享：选择目标班级后共享，或取消共享（classId 置空）。
  const handleShare = async () => {
    if (!shareTarget) return
    const target = Number(shareTarget.classId)
    setBusy(true)
    try {
      await shareArtifact(shareTarget.artifact.id, target > 0 ? target : 0)
      toast.success(
        target > 0
          ? t('已共享到班级，全班学生与教师均可查看该素材')
          : t('已取消共享')
      )
      setShareTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('共享设置失败'))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const buildPurgePayload = (): ArtifactPurgePayload | null => {
    if (purgeMode === PURGE_MODE_RANGE) {
      if (!purgeFrom || !purgeTo) return null
      return { from: purgeFrom, to: purgeTo }
    }
    if (!purgeClassId) return null
    return { mode: 'class', class_id: Number(purgeClassId) }
  }

  const handlePurge = async () => {
    const payload = buildPurgePayload()
    if (!payload) {
      toast.error(t('请先完整填写清理条件'))
      return
    }
    setBusy(true)
    try {
      const result = await purgeArtifacts(payload)
      toast.success(
        t('已清理 {{count}} 个素材，释放 {{size}}', {
          count: result.deleted,
          size: formatSize(result.released_bytes),
        })
      )
      setConfirmPurge(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('批量清理失败'))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const previewBody = preview?.artifact ?? null
  const previewUrl = preview?.url ?? ''

  // 保存自动清理保留天数：0 表示关闭，最大 3650 天（约 10 年）。
  const handleSaveRetention = async () => {
    const days = Number.parseInt(retentionDays, 10)
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      toast.error(t('保留天数须为 0-3650 之间的整数（0 表示关闭自动清理）'))
      return
    }
    setRetentionSaving(true)
    try {
      await saveArtifactRetentionDays(days)
      toast.success(
        days > 0
          ? t('已设置素材保留 {{days}} 天，超期素材将自动删除文件并保留记录', { days })
          : t('已关闭素材自动清理')
      )
      queryClient.invalidateQueries({ queryKey: ['ai-hub', 'artifact-retention'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setRetentionSaving(false)
    }
  }

  return (
    <PageShell
      title={t('云端素材')}
      description={t(
        '查看学生在中台生成并落盘的成品文件，可按学生姓名、年级、班级、时间段与能力类型筛选，支持预览、下载、勾选清理；管理员可批量清理。'
      )}
      actions={
        <div className='flex flex-wrap gap-2'>
          <Button
            disabled={items.length === 0}
            onClick={() => {
              const allIds = items.map((item) => item.id)
              const allSelected = allIds.every((id) => selected.includes(id))
              setSelected(allSelected ? [] : allIds)
            }}
          >
            {t('全选本页')}
          </Button>
          <Button
            variant='danger'
            disabled={busy || selected.length === 0}
            onClick={() => setDeleteTargets(selected)}
          >
            {t('清理选中（{{count}}）', { count: selected.length })}
          </Button>
        </div>
      }
    >
      <Panel>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          <Field label={t('学生姓名')}>
            <TextInput
              value={keyword}
              placeholder={t('输入姓名或姓名拼音关键词')}
              onChange={(value) => {
                setKeyword(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
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
          <Field label={t('年级')}>
            <Select
              value={gradeIndex}
              options={gradeOptions}
              onChange={(value) => {
                setGradeIndex(value)
                setClassId('')
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
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
          <Field label={t('共享范围')}>
            <Switch
              checked={sharedOnly}
              onChange={(checked) => {
                setSharedOnly(checked)
                setPage(1)
                setSelected([])
              }}
              label={t('只看班级共享素材')}
            />
          </Field>
          <Field label={t('能力类型')}>
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
          <Field label={t('开始日期')}>
            <DatePicker
              value={from}
              onChange={(value) => {
                setFrom(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
          <Field label={t('结束日期')}>
            <DatePicker
              value={to}
              onChange={(value) => {
                setTo(value)
                setPage(1)
                setSelected([])
              }}
            />
          </Field>
        </div>
        <div className='mt-3 flex justify-end'>
          <Button onClick={resetFilters}>{t('重置筛选')}</Button>
        </div>
      </Panel>

      <Panel
        title={t('空间占用')}
        description={t('按能力类型统计当前筛选结果的素材数量与占用空间。')}
      >
        <div className='flex flex-wrap items-center gap-2'>
          {stats.length === 0 && (
            <span className='text-xs text-muted-foreground'>{t('暂无统计数据')}</span>
          )}
          {stats.map((item) => (
            <Badge key={item.kind} tone='muted'>
              {t('{{label}}：{{count}} 个 · {{size}}', {
                label: CAPABILITY_KIND_LABEL[item.kind] ?? item.kind,
                count: item.count,
                size: formatSize(item.bytes),
              })}
            </Badge>
          ))}
        </div>
      </Panel>

      <Panel
        bodyClassName='p-0'
        title={`${t('素材列表')}${data ? `（${data.total}）` : ''}`}
      >
        <Table
          headers={[
            t('选择'),
            t('类型'),
            t('文件名'),
            t('学生'),
            t('班级'),
            t('模型'),
            t('大小'),
            t('生成时间'),
            t('操作'),
          ]}
          isEmpty={!artifactsQuery.isLoading && items.length === 0}
          empty={artifactsQuery.isLoading ? t('正在加载…') : t('暂无云端素材')}
        >
          {items.map((item) => (
            <tr key={item.id} className='border-b border-border/60'>
              <Td className='whitespace-nowrap'>
                <input
                  type='checkbox'
                  checked={selected.includes(item.id)}
                  onChange={() => toggleSelect(item.id)}
                />
              </Td>
              <Td className='whitespace-nowrap'>
                <Badge tone='muted'>{CAPABILITY_KIND_LABEL[item.kind] ?? item.kind}</Badge>
              </Td>
              <Td className='max-w-[240px] truncate'>
                <span className='flex items-center gap-2'>
                  {fileNameOf(item)}
                  {item.file_purged && <Badge tone='muted'>{t('已清理')}</Badge>}
                </span>
              </Td>
              <Td className='whitespace-nowrap'>{item.user_name || `#${item.user_id}`}</Td>
              <Td className='whitespace-nowrap'>{item.class_name || '-'}</Td>
              <Td className='whitespace-nowrap'>{item.model || '-'}</Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {formatSize(item.size_bytes)}
              </Td>
              <Td className='whitespace-nowrap text-muted-foreground'>
                {formatTime(item.created_at)}
              </Td>
              <Td className='whitespace-nowrap'>
                <div className='flex gap-2'>
                  <Button
                    disabled={busy || item.file_purged}
                    onClick={() => void openPreview(item)}
                  >
                    {t('预览')}
                  </Button>
                  <Button
                    disabled={busy || item.file_purged}
                    onClick={() => void handleDownload(item)}
                  >
                    {t('下载')}
                  </Button>
                  <Button
                    disabled={busy || item.file_purged}
                    onClick={() =>
                      setShareTarget({
                        artifact: item,
                        classId: item.share_class_id
                          ? String(item.share_class_id)
                          : '',
                      })
                    }
                  >
                    {item.share_class_id ? t('已共享') : t('共享')}
                  </Button>
                  <Button
                    variant='danger'
                    disabled={busy}
                    onClick={() => setDeleteTargets([item.id])}
                  >
                    {t('清理')}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
        <div className='flex items-center justify-between px-3 py-2 text-xs text-muted-foreground'>
          <span>
            {t('第')} {page} / {totalPages} {t('页')}
          </span>
          <div className='flex gap-2'>
            <Button
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              {t('上一页')}
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {t('下一页')}
            </Button>
          </div>
        </div>
      </Panel>

      {isSuperAdmin && (
        <Panel
          title={t('自动清理')}
          description={t(
            '设置素材保留时长（天）：素材创建超过该时长后自动删除磁盘文件，保留生成记录但禁止预览与下载；已提交的课堂作品会自动跳过。填 0 表示关闭自动清理，每天检查一次。'
          )}
        >
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Field label={t('保留天数（0 = 关闭）')}>
              <TextInput
                value={retentionDays}
                placeholder={t('例如 60 表示两个月')}
                onChange={setRetentionDays}
              />
            </Field>
          </div>
          <div className='mt-4 flex justify-end'>
            <Button
              variant='primary'
              disabled={retentionSaving}
              onClick={() => void handleSaveRetention()}
            >
              {t('保存设置')}
            </Button>
          </div>
        </Panel>
      )}

      {isSuperAdmin && (
        <Panel
          title={t('批量清理')}
          description={t('按时间段或班级批量清理素材，释放磁盘空间；也可勾选单个或多个素材后清理。')}
        >
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Field label={t('清理模式')}>
              <Select
                value={purgeMode}
                options={[
                  { label: t('按时间段清理'), value: PURGE_MODE_RANGE },
                  { label: t('按班级清理'), value: PURGE_MODE_CLASS },
                ]}
                onChange={(value) => setPurgeMode(value as PurgeMode)}
              />
            </Field>
            {purgeMode === PURGE_MODE_RANGE && (
              <>
                <Field label={t('开始日期')}>
                  <DatePicker value={purgeFrom} onChange={setPurgeFrom} />
                </Field>
                <Field label={t('结束日期')}>
                  <DatePicker value={purgeTo} onChange={setPurgeTo} />
                </Field>
              </>
            )}
            {purgeMode === PURGE_MODE_CLASS && (
              <Field label={t('班级')}>
                <Select
                  value={purgeClassId}
                  options={purgeClassOptions}
                  onChange={setPurgeClassId}
                />
              </Field>
            )}
          </div>
          <div className='mt-4 flex justify-end'>
            <Button
              variant='danger'
              disabled={busy}
              onClick={() => setConfirmPurge(true)}
            >
              {t('执行清理')}
            </Button>
          </div>
        </Panel>
      )}

      <Modal
        open={preview !== null}
        title={t('素材预览')}
        onClose={closePreview}
        footer={
          <>
            <Button onClick={closePreview}>{t('关闭')}</Button>
            <Button
              variant='primary'
              disabled={busy || !previewBody || previewBody.file_purged}
              onClick={() => previewBody && void handleDownload(previewBody)}
            >
              {t('下载')}
            </Button>
          </>
        }
      >
        {previewBody && (
          <div className='grid gap-3'>
            <div className='flex flex-wrap gap-3 text-[13px] text-muted-foreground'>
              <span>
                {t('学生')}：{previewBody.user_name || `#${previewBody.user_id}`}
              </span>
              <span>{t('班级')}：{previewBody.class_name || '-'}</span>
              <span>{t('大小')}：{formatSize(previewBody.size_bytes)}</span>
            </div>
            <div className='flex min-h-[160px] items-center justify-center rounded-md border border-border bg-muted/30 p-3'>
              {previewKind(previewBody.kind) === 'text' && (
                <p className='w-full whitespace-pre-wrap break-words text-[13px] text-foreground'>
                  {previewBody.prompt || t('该素材无预览内容，请下载查看。')}
                </p>
              )}
              {previewKind(previewBody.kind) === 'image' && previewUrl && (
                <img
                  src={previewUrl}
                  alt={fileNameOf(previewBody)}
                  className='max-h-[50vh] w-auto object-contain'
                />
              )}
              {previewKind(previewBody.kind) === 'audio' && previewUrl && (
                <AudioPlayer
                  src={previewUrl}
                  downloadName={fileNameOf(previewBody)}
                  className='w-full'
                />
              )}
              {previewKind(previewBody.kind) === 'video' && previewUrl && (
                <VideoPlayer
                  src={previewUrl}
                  downloadName={fileNameOf(previewBody)}
                  className='max-h-[50vh] w-full'
                />
              )}
              {previewKind(previewBody.kind) === 'none' && (
                <p className='text-[13px] text-muted-foreground'>
                  {t('该类型暂不支持在线预览，请下载后查看。')}
                </p>
              )}
            </div>
            {previewBody.prompt && previewKind(previewBody.kind) !== 'text' && (
              <div>
                <span className='text-xs font-medium text-muted-foreground'>
                  {t('提示词')}
                </span>
                <p className='mt-1 whitespace-pre-wrap break-words text-[13px] text-foreground'>
                  {previewBody.prompt}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={deleteTargets.length > 0}
        title={t('确认清理素材')}
        onClose={() => setDeleteTargets([])}
        footer={
          <>
            <Button onClick={() => setDeleteTargets([])}>{t('取消')}</Button>
            <Button
              variant='danger'
              disabled={busy}
              onClick={() => void handleDeleteSelected()}
            >
              {t('确认清理')}
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-foreground'>
          {t('将清理 {{count}} 个素材（已提交的课堂作品会自动跳过），清理后不可恢复。', {
            count: deleteTargets.length,
          })}
        </p>
      </Modal>

      <Modal
        open={confirmPurge}
        title={t('确认批量清理')}
        onClose={() => setConfirmPurge(false)}
        footer={
          <>
            <Button onClick={() => setConfirmPurge(false)}>{t('取消')}</Button>
            <Button variant='danger' disabled={busy} onClick={() => void handlePurge()}>
              {t('确认清理')}
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-foreground'>
          {t('批量清理会删除符合条件的素材。此操作不可恢复。')}
        </p>
      </Modal>

      {/* 素材班级共享：选择班级共享给全班，留空表示取消共享 */}
      <Modal
        open={shareTarget !== null}
        title={
          shareTarget
            ? t('素材共享 · {{name}}', { name: fileNameOf(shareTarget.artifact) })
            : t('素材共享')
        }
        onClose={() => setShareTarget(null)}
        footer={
          <>
            <Button onClick={() => setShareTarget(null)}>{t('取消')}</Button>
            <Button variant='primary' disabled={busy} onClick={() => void handleShare()}>
              {t('确认')}
            </Button>
          </>
        }
      >
        <div className='space-y-3'>
          <Field label={t('共享班级')}>
            <Select
              value={shareTarget?.classId ?? ''}
              options={[
                { value: '', label: t('不共享（仅自己可见）') },
                ...classOptions,
              ]}
              onChange={(value) =>
                setShareTarget((prev) => (prev ? { ...prev, classId: value } : prev))
              }
            />
          </Field>
          <p className='text-xs text-muted-foreground'>
            {t('共享后该班级全体学生与教师均可在云端素材中查看该素材；备课时可将其挂到任务上作为参考资料。')}
          </p>
        </div>
      </Modal>
    </PageShell>
  )
}
