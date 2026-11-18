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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  fetchClasses,
  fetchClassSessions,
  fetchClassSessionDetail,
  downloadClassSessionPackage,
  fetchInsights,
  fetchSectionGradeOptions,
  fetchSections,
  fetchSmallClasses,
  type AiHubClassSessionDetail,
} from '../api'
import {
  Badge,
  Button,
  DatePicker,
  Field,
  PageShell,
  Panel,
  Select,
  Switch,
  Table,
  Td,
  TextInput,
} from '../components/kit'
import { CAPABILITY_KIND_LABEL } from '../types'
import { ClassReport } from './report'

/** formatTime 渲染 unix 秒为「YYYY-MM-DD HH:mm」，0 返回占位符。 */
function formatTime(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** toUnix 把 YYYY-MM-DD 转 unix 秒，空值返回 0。 */
function toUnix(value: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000)
}

/** monthStart 返回本月 1 日的 YYYY-MM-DD 字符串（学情默认统计区间）。 */
function monthStart(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
}

/** today 返回今天的 YYYY-MM-DD 字符串。 */
function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// InsightsSection 学情管理：分「使用统计」与「历史课堂」两个标签页。
// 使用统计：按学生聚合的生成次数/点数/金额与能力分布（原页面能力保留）。
// 历史课堂（v1.1）：按小班或班级筛选查看备课发起的课堂提交数据，独立成页避免混排。
export function InsightsSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'stats' | 'report' | 'history'>('stats')
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [includeGraduated, setIncludeGraduated] = useState(false)
  const [sectionId, setSectionId] = useState('')
  const [gradeIndex, setGradeIndex] = useState('')
  const [classId, setClassId] = useState('')
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(today())

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

  const insightsQuery = useQuery({
    queryKey: [
      'ai-hub',
      'insights',
      page,
      keyword,
      includeGraduated,
      sectionId,
      gradeIndex,
      classId,
      start,
      end,
    ],
    queryFn: () =>
      fetchInsights({
        p: page,
        page_size: 20,
        keyword: keyword.trim() || undefined,
        include_graduated: includeGraduated || undefined,
        class_id: classId ? Number(classId) : undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        grade_index: gradeIndex ? Number(gradeIndex) : undefined,
        start: toUnix(start) || undefined,
        end: toUnix(end) || undefined,
      }),
  })

  const data = insightsQuery.data
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1
  const summary = data?.summary

  // 学部 / 年级 / 班级级联：与使用记录同款选择范围收敛逻辑。
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
        .filter(
          (item) => !gradeIndex || String(item.grade_index) === gradeIndex
        )
        .map((item) => ({
          label: `${item.name}${item.grade_name ? `（${item.grade_name}）` : ''}`,
          value: String(item.id),
        })),
    ],
    [classesQuery.data, sectionId, gradeIndex, t]
  )

  // 上游筛选变化时重置下级选择与页码，避免残留无效组合。
  useEffect(() => {
    setClassId('')
    setPage(1)
  }, [sectionId, gradeIndex])

  const resetFilters = () => {
    setKeyword('')
    setSectionId('')
    setGradeIndex('')
    setClassId('')
    setStart(monthStart())
    setEnd(today())
    setIncludeGraduated(false)
    setPage(1)
  }

  return (
    <PageShell
      title={t('学情管理')}
      description={t(
        '按学生统计指定时间范围内的生成次数、消耗点数与消费金额，并展示各能力分布'
      )}
      actions={
        <div className='flex items-center gap-2'>
          <div className='border-border flex overflow-hidden rounded-lg border'>
            <button
              type='button'
              onClick={() => setTab('stats')}
              className={
                tab === 'stats'
                  ? 'bg-primary px-3 py-1.5 text-[13px] text-white'
                  : 'text-muted-foreground hover:bg-accent px-3 py-1.5 text-[13px]'
              }
            >
              {t('使用统计')}
            </button>
            <button
              type='button'
              onClick={() => setTab('report')}
              className={
                tab === 'report'
                  ? 'bg-primary px-3 py-1.5 text-[13px] text-white'
                  : 'text-muted-foreground hover:bg-accent px-3 py-1.5 text-[13px]'
              }
            >
              {t('学习报告')}
            </button>
            <button
              type='button'
              onClick={() => setTab('history')}
              className={
                tab === 'history'
                  ? 'bg-primary px-3 py-1.5 text-[13px] text-white'
                  : 'text-muted-foreground hover:bg-accent px-3 py-1.5 text-[13px]'
              }
            >
              {t('历史课堂')}
            </button>
          </div>
          <Button variant='outline' onClick={resetFilters}>
            {t('重置筛选')}
          </Button>
        </div>
      }
    >
      {tab === 'history' ? (
        <HistorySessions />
      ) : tab === 'report' ? (
        <ClassReport />
      ) : (
        <>
          {/* 汇总卡片：一眼看出区间内整体活跃度与消费规模 */}
          <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
            {[
              { label: t('学生总数'), value: summary?.student_count ?? 0 },
              { label: t('有生成学生'), value: summary?.active_count ?? 0 },
              { label: t('生成次数'), value: summary?.count ?? 0 },
              {
                label: t('消耗点数'),
                value: (summary?.points ?? 0).toLocaleString(),
              },
              {
                label: t('消费金额'),
                value: `¥${(summary?.amount_yuan ?? 0).toFixed(2)}`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className='border-border bg-card rounded-xl border p-4 shadow-sm'
              >
                <p className='text-muted-foreground text-xs'>{card.label}</p>
                <p className='text-foreground mt-1 text-xl font-semibold'>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <Panel
            title={t('筛选条件')}
            description={t('默认统计本月数据，可按学部 → 年级 → 班级逐级收敛')}
          >
            <div className='flex flex-wrap items-end gap-3'>
              <Field label={t('开始日期')}>
                <DatePicker
                  className='w-40'
                  value={start}
                  onChange={(value) => {
                    setStart(value)
                    setPage(1)
                  }}
                />
              </Field>
              <Field label={t('结束日期')}>
                <DatePicker
                  className='w-40'
                  value={end}
                  onChange={(value) => {
                    setEnd(value)
                    setPage(1)
                  }}
                />
              </Field>
              <Field label={t('学部')}>
                <Select
                  className='w-44'
                  value={sectionId}
                  options={sectionOptions}
                  onChange={(value) => {
                    setSectionId(value)
                    setGradeIndex('')
                  }}
                />
              </Field>
              <Field label={t('年级')}>
                <Select
                  className='w-40'
                  value={gradeIndex}
                  options={gradeOptions}
                  disabled={!sectionId}
                  onChange={(value) => setGradeIndex(value)}
                />
              </Field>
              <Field label={t('班级')}>
                <Select
                  className='w-52'
                  value={classId}
                  options={classOptions}
                  onChange={(value) => {
                    setClassId(value)
                    setPage(1)
                  }}
                />
              </Field>
              <Field label={t('学生姓名')}>
                <TextInput
                  className='w-44'
                  value={keyword}
                  placeholder={t('姓名 / 学号 / 账户名')}
                  onChange={(value) => {
                    setKeyword(value)
                    setPage(1)
                  }}
                />
              </Field>
              <div className='pb-1.5'>
                <Switch
                  checked={includeGraduated}
                  label={t('包含已毕业')}
                  onChange={(checked) => {
                    setIncludeGraduated(checked)
                    setPage(1)
                  }}
                />
              </div>
            </div>
          </Panel>

          <Panel bodyClassName='p-0'>
            <Table
              headers={[
                t('姓名'),
                t('学号'),
                t('班级'),
                t('年级'),
                t('生成次数'),
                t('消耗点数'),
                t('消费金额'),
                t('最近活跃'),
                t('能力分布'),
              ]}
              isEmpty={
                !insightsQuery.isLoading && (data?.items.length ?? 0) === 0
              }
              empty={t('当前筛选条件下暂无学生数据')}
            >
              {(data?.items ?? []).map((row) => (
                <tr
                  key={row.student_id || row.user_id}
                  className='border-border/60 border-b last:border-0'
                >
                  <Td className='font-medium whitespace-nowrap'>
                    {row.display_name || row.username || '-'}
                  </Td>
                  <Td className='text-muted-foreground whitespace-nowrap'>
                    {row.student_no || '-'}
                  </Td>
                  <Td className='whitespace-nowrap'>{row.class_name || '-'}</Td>
                  <Td className='whitespace-nowrap'>{row.grade_name || '-'}</Td>
                  <Td className='whitespace-nowrap'>
                    {row.count > 0 ? (
                      row.count
                    ) : (
                      <span className='text-muted-foreground'>无生成</span>
                    )}
                  </Td>
                  <Td className='whitespace-nowrap'>
                    {row.points.toLocaleString()}
                  </Td>
                  <Td className='whitespace-nowrap'>
                    ¥{row.amount_yuan.toFixed(2)}
                  </Td>
                  <Td className='text-muted-foreground whitespace-nowrap'>
                    {formatTime(row.last_active_at)}
                  </Td>
                  <Td>
                    {row.breakdown.length > 0 ? (
                      <div className='flex flex-wrap gap-1 py-1'>
                        {row.breakdown.map((item) => (
                          <Badge key={item.capability_id}>
                            {CAPABILITY_KIND_LABEL[item.capability_id] ??
                              item.capability_id}
                            ×{item.count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className='text-muted-foreground'>-</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <div className='text-muted-foreground flex items-center justify-between px-3 py-2 text-xs'>
              <span>
                {t('第')} {data?.page ?? 1} / {totalPages} {t('页')} · {t('共')}{' '}
                {data?.total ?? 0} {t('条')}
              </span>
              <div className='flex items-center gap-2'>
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
        </>
      )}
    </PageShell>
  )
}

/** HistorySessions 历史课堂（v1.1）：按小班/班级筛选查看备课发起的课堂提交数据。 */
function HistorySessions() {
  const { t } = useTranslation()
  const [classId, setClassId] = useState('')
  const [smallClassId, setSmallClassId] = useState('')
  const [sessionId, setSessionId] = useState(0)
  const [busy, setBusy] = useState(false)

  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
  })
  const smallClassesQuery = useQuery({
    queryKey: ['ai-hub', 'small-classes'],
    queryFn: () => fetchSmallClasses(),
  })
  const classes = classesQuery.data ?? []
  const smallClasses = smallClassesQuery.data ?? []

  const classOptions = useMemo(
    () => [
      { label: t('全部班级'), value: '' },
      ...classes.map((item) => ({
        label: `${item.name}${item.grade_name ? `（${item.grade_name}）` : ''}`,
        value: String(item.id),
      })),
    ],
    [classes, t]
  )

  // 小班选项：受已选班级过滤（小班可挂多个行政班）。
  const smallClassOptions = useMemo(() => {
    const filtered = classId
      ? smallClasses.filter((item) =>
          (item.parent_class_ids ?? []).includes(Number(classId))
        )
      : smallClasses
    return [
      { label: t('全部小班'), value: '' },
      ...filtered.map((item) => ({
        label: `${item.name}${item.code ? `（${item.code}）` : ''}`,
        value: String(item.id),
      })),
    ]
  }, [smallClasses, classId, t])

  useEffect(() => {
    setSmallClassId('')
    setSessionId(0)
  }, [classId])

  const sessionsQuery = useQuery({
    queryKey: ['ai-hub', 'insights-history', smallClassId],
    queryFn: () =>
      fetchClassSessions(smallClassId ? Number(smallClassId) : undefined),
    enabled: Boolean(smallClassId),
  })
  const sessions = sessionsQuery.data ?? []

  useEffect(() => {
    if (!sessions.length) {
      setSessionId(0)
      return
    }
    if (sessions.some((item) => item.id === sessionId)) return
    setSessionId(sessions[0].id)
  }, [sessions, sessionId])

  const detailQuery = useQuery({
    queryKey: ['ai-hub', 'insights-history-detail', sessionId],
    queryFn: () => fetchClassSessionDetail(sessionId),
    enabled: sessionId > 0,
  })
  const detail: AiHubClassSessionDetail | null = detailQuery.data ?? null

  const handlePackage = async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      await downloadClassSessionPackage(sessionId)
    } catch (error) {
      // 失败提示交给全局 toast 语义（保持简洁）
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel
        title={t('选择小班或班级')}
        description={t(
          '先选班级可收敛小班范围，选定小班后查看其全部历史课堂与提交'
        )}
      >
        <div className='flex flex-wrap items-end gap-3'>
          <Field label={t('班级')}>
            <Select
              className='w-52'
              value={classId}
              options={classOptions}
              onChange={(value) => setClassId(value)}
            />
          </Field>
          <Field label={t('小班')}>
            <Select
              className='w-56'
              value={smallClassId}
              options={smallClassOptions}
              placeholder={t('请先选择小班')}
              onChange={(value) => setSmallClassId(value)}
            />
          </Field>
        </div>
      </Panel>

      {smallClassId && (
        <Panel title={t('历史课堂')} bodyClassName='p-0'>
          <Table
            headers={[
              t('状态'),
              t('单元 / 课时'),
              t('主题'),
              t('任务数'),
              t('提交数'),
              t('开始时间'),
              t('操作'),
            ]}
            isEmpty={!sessionsQuery.isLoading && sessions.length === 0}
            empty={t('该小班暂无历史课堂')}
          >
            {sessions.map((item) => (
              <tr
                key={item.id}
                className='border-border hover:bg-accent/40 border-b last:border-0'
              >
                <Td>
                  {item.status === 'active' ? (
                    <Badge tone='success'>{t('进行中')}</Badge>
                  ) : (
                    <Badge tone='muted'>{t('已结束')}</Badge>
                  )}
                </Td>
                <Td className='text-muted-foreground text-xs'>
                  {item.unit_name || '-'}
                </Td>
                <Td>{item.theme || item.lesson_title}</Td>
                <Td>{item.task_count}</Td>
                <Td>{item.submission_count}</Td>
                <Td className='text-muted-foreground text-xs'>
                  {formatTime(item.started_at)}
                </Td>
                <Td>
                  <Button
                    variant={item.id === sessionId ? 'primary' : 'outline'}
                    onClick={() => setSessionId(item.id)}
                  >
                    {t('查看提交')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {sessionId > 0 && (
        <Panel
          title={t('课堂提交明细')}
          description={
            detail
              ? `${t('共')} ${detail.tasks.length} ${t('个任务')}，${t('已收到')} ${detail.submissions.length} ${t('条提交')}`
              : t('加载中…')
          }
          actions={
            <Button variant='outline' disabled={busy} onClick={handlePackage}>
              {t('打包下载 ZIP')}
            </Button>
          }
          bodyClassName='p-0'
        >
          <Table
            headers={[
              t('学生'),
              t('学号'),
              t('任务'),
              t('形式'),
              t('内容 / 产物'),
              t('提交时间'),
            ]}
            isEmpty={Boolean(detail && detail.submissions.length === 0)}
            empty={t('该课堂暂无学生提交')}
          >
            {(detail?.submissions ?? []).map((item) => (
              <tr
                key={item.id}
                className='border-border border-b last:border-0'
              >
                <Td>{item.student_name || `用户 ${item.user_id}`}</Td>
                <Td className='text-muted-foreground text-xs'>
                  {item.student_no || '-'}
                </Td>
                <Td>{item.task_title || `任务 ${item.task_id}`}</Td>
                <Td>
                  {' '}
                  <Badge
                    tone={item.content_type === 'ai' ? 'default' : 'muted'}
                  >
                    {item.content_type === 'text'
                      ? t('文字')
                      : item.content_type === 'file'
                        ? t('文件')
                        : t('AI 作品')}
                  </Badge>{' '}
                </Td>
                <Td>
                  <span className='line-clamp-2 max-w-[320px] text-[13px]'>
                    {item.content_type === 'text'
                      ? item.text_content
                      : item.content_type === 'ai'
                        ? item.result_text || item.file_name || t('AI 作品')
                        : item.file_name || t('文件')}
                  </span>
                </Td>
                <Td className='text-muted-foreground text-xs'>
                  {formatTime(item.created_at)}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  )
}
