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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { fetchClasses, fetchReport } from '../api'
import { DatePicker, Field, Panel, Select } from '../components/kit'
import { CAPABILITY_KIND_LABEL } from '../types'

/** toUnix 把 YYYY-MM-DD 转 unix 秒，空值返回 0。 */
function toUnix(value: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(unix: number, bucketBy: string): string {
  const date = new Date(unix * 1000)
  if (bucketBy === 'month') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
  }
  if (bucketBy === 'week') {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}周`
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** defaultRange 按粒度给出默认统计区间（周=近 4 周，月=近 6 月，天=近 30 天）。 */
function defaultRange(bucketBy: string): { start: string; end: string } {
  const now = new Date()
  const end = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const startDate = new Date(now)
  if (bucketBy === 'week') {
    startDate.setDate(startDate.getDate() - 28)
  } else if (bucketBy === 'month') {
    startDate.setMonth(startDate.getMonth() - 6)
  } else {
    startDate.setDate(startDate.getDate() - 30)
  }
  const start = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`
  return { start, end }
}

// ClassReport 学习报告：按班级的周/月能力使用、完成率与点数消耗趋势图。
export function ClassReport() {
  const { t } = useTranslation()
  const [classId, setClassId] = useState('')
  const [bucketBy, setBucketBy] = useState<'day' | 'week' | 'month'>('week')
  const [range, setRange] = useState(defaultRange('week'))

  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
  })
  const classOptions = useMemo(
    () =>
      (classesQuery.data ?? []).map((item) => ({
        label: `${item.name}${item.grade_name ? `（${item.grade_name}）` : ''}`,
        value: String(item.id),
      })),
    [classesQuery.data]
  )

  // 默认选中第一个班级，减少一次手动操作。
  const effectiveClassId = classId || classOptions[0]?.value || ''

  const reportQuery = useQuery({
    queryKey: [
      'ai-hub',
      'report',
      effectiveClassId,
      bucketBy,
      range.start,
      range.end,
    ],
    queryFn: () =>
      fetchReport({
        class_id: Number(effectiveClassId),
        bucket_by: bucketBy,
        start: toUnix(range.start) || undefined,
        end: toUnix(range.end) || undefined,
      }),
    enabled: Boolean(effectiveClassId),
  })
  const report = reportQuery.data

  // 能力使用趋势：每条线一个能力（按次数）。
  const capabilitySeries = useMemo(() => {
    if (!report) return []
    const buckets = report.points_trend.map((item) => item.bucket)
    const rows = buckets.map((bucket) => {
      const row: Record<string, number | string> = {
        bucket,
        label: formatDate(bucket, report.bucket_by),
      }
      for (const cap of report.capabilities) {
        const point = cap.trend.find((item) => item.bucket === bucket)
        row[cap.capability_id] = point?.count ?? 0
      }
      return row
    })
    return rows
  }, [report])

  // 点数消耗趋势：按桶合计。
  const pointsRows = useMemo(() => {
    if (!report) return []
    return report.points_trend.map((item) => ({
      bucket: item.bucket,
      label: formatDate(item.bucket, report.bucket_by),
      points: item.points,
    }))
  }, [report])

  const capabilityColors = [
    '#6d5df6',
    '#f59e0b',
    '#10b981',
    '#ef4444',
    '#3b82f6',
    '#ec4899',
    '#14b8a6',
    '#8b5cf6',
  ]

  const completion = report?.completion?.[0]
  const summary = report?.summary

  if (!effectiveClassId) {
    return (
      <Panel title={t('学习报告')}>
        <p className='text-sm text-muted-foreground'>{t('暂无班级，请先创建班级')}</p>
      </Panel>
    )
  }

  return (
    <>
      <Panel
        title={t('学习报告')}
        description={t('按班级查看能力使用、完成率与点数消耗的周/月趋势')}
      >
        <div className='flex flex-wrap items-end gap-3'>
          <Field label={t('班级')}>
            <Select
              className='w-56'
              value={effectiveClassId}
              options={classOptions}
              onChange={(value) => setClassId(value)}
            />
          </Field>
          <Field label={t('统计粒度')}>
            <div className='flex overflow-hidden rounded-lg border border-border'>
              {(['day', 'week', 'month'] as const).map((item) => (
                <button
                  key={item}
                  type='button'
                  onClick={() => {
                    setBucketBy(item)
                    setRange(defaultRange(item))
                  }}
                  className={
                    bucketBy === item
                      ? 'bg-primary px-3 py-1.5 text-[13px] text-white'
                      : 'px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent'
                  }
                >
                  {item === 'day' ? t('按天') : item === 'week' ? t('按周') : t('按月')}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('开始日期')}>
            <DatePicker
              className='w-40'
              value={range.start}
              onChange={(value) => setRange((prev) => ({ ...prev, start: value }))}
            />
          </Field>
          <Field label={t('结束日期')}>
            <DatePicker
              className='w-40'
              value={range.end}
              onChange={(value) => setRange((prev) => ({ ...prev, end: value }))}
            />
          </Field>
        </div>
      </Panel>

      {/* 汇总卡片 */}
      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        {[
          { label: t('班级学生数'), value: summary?.student_count ?? 0 },
          { label: t('生成次数'), value: summary?.count ?? 0 },
          { label: t('消耗点数'), value: (summary?.points ?? 0).toLocaleString() },
          {
            label: t('消费金额'),
            value: `¥${(summary?.amount_yuan ?? 0).toFixed(2)}`,
          },
          {
            label: t('任务完成率'),
            value: `${(completion?.completion_pct ?? 0).toFixed(1)}%`,
          },
        ].map((card) => (
          <div
            key={card.label}
            className='rounded-xl border border-border bg-card p-4 shadow-sm'
          >
            <p className='text-xs text-muted-foreground'>{card.label}</p>
            <p className='mt-1 text-xl font-semibold text-foreground'>{card.value}</p>
          </div>
        ))}
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <Panel
          title={t('能力使用趋势')}
          description={t('各生成能力在每个时间桶内的使用次数')}
        >
          {reportQuery.isLoading ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              {t('正在加载…')}
            </p>
          ) : capabilitySeries.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              {t('该区间暂无生成数据')}
            </p>
          ) : (
            <div className='h-64'>
              <ResponsiveContainer height='100%' width='100%'>
                <LineChart data={capabilitySeries}>
                  <CartesianGrid strokeDasharray='3 3' stroke='currentColor' strokeOpacity={0.12} />
                  <XAxis dataKey='label' fontSize={12} tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={12} tickLine={false} width={36} />
                  <Tooltip />
                  {(report?.capabilities ?? []).map((cap, index) => (
                    <Line
                      dataKey={cap.capability_id}
                      dot={false}
                      key={cap.capability_id}
                      name={
                        CAPABILITY_KIND_LABEL[cap.capability_id] ?? cap.capability_id
                      }
                      stroke={capabilityColors[index % capabilityColors.length]}
                      strokeWidth={2}
                      type='monotone'
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title={t('点数消耗趋势')}
          description={t('每个时间桶内全班合计消耗的点数')}
        >
          {reportQuery.isLoading ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              {t('正在加载…')}
            </p>
          ) : pointsRows.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              {t('该区间暂无点数消耗')}
            </p>
          ) : (
            <div className='h-64'>
              <ResponsiveContainer height='100%' width='100%'>
                <AreaChart data={pointsRows}>
                  <defs>
                    <linearGradient id='pointsFill' x1='0' x2='0' y1='0' y2='1'>
                      <stop offset='0%' stopColor='#6d5df6' stopOpacity={0.35} />
                      <stop offset='100%' stopColor='#6d5df6' stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray='3 3' stroke='currentColor' strokeOpacity={0.12} />
                  <XAxis dataKey='label' fontSize={12} tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={12} tickLine={false} width={44} />
                  <Tooltip />
                  <Area
                    dataKey='points'
                    fill='url(#pointsFill)'
                    name={t('消耗点数')}
                    stroke='#6d5df6'
                    strokeWidth={2}
                    type='monotone'
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('能力使用汇总')} bodyClassName='p-0'>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border bg-muted/40 text-left text-xs text-muted-foreground'>
                <th className='px-3 py-2 font-medium'>{t('生成能力')}</th>
                <th className='px-3 py-2 font-medium'>{t('生成次数')}</th>
                <th className='px-3 py-2 font-medium'>{t('消耗点数')}</th>
                <th className='px-3 py-2 font-medium'>{t('次数占比')}</th>
              </tr>
            </thead>
            <tbody>
              {(report?.capabilities ?? []).map((cap) => {
                const total = report?.summary?.count ?? 0
                const pct = total > 0 ? (cap.total / total) * 100 : 0
                return (
                  <tr key={cap.capability_id} className='border-b border-border/60 last:border-0'>
                    <td className='px-3 py-2'>
                      {CAPABILITY_KIND_LABEL[cap.capability_id] ?? cap.capability_id}
                    </td>
                    <td className='px-3 py-2 tabular-nums'>{cap.total}</td>
                    <td className='px-3 py-2 tabular-nums'>{cap.points.toLocaleString()}</td>
                    <td className='px-3 py-2'>
                      <div className='flex items-center gap-2'>
                        <div className='h-2 w-32 overflow-hidden rounded-full bg-muted'>
                          <div
                            className='h-full rounded-full bg-primary'
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className='text-xs text-muted-foreground'>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {(report?.capabilities ?? []).length === 0 && (
                <tr>
                  <td className='px-3 py-6 text-center text-muted-foreground' colSpan={4}>
                    {t('该区间暂无生成数据')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {completion && (
        <Panel title={t('课堂任务完成率')}>
          <div className='flex flex-wrap items-center gap-6'>
            <div>
              <p className='text-xs text-muted-foreground'>{t('完成率')}</p>
              <p className='text-2xl font-semibold text-foreground'>
                {completion.completion_pct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>{t('有提交学生 / 班级学生')}</p>
              <p className='text-2xl font-semibold text-foreground'>
                {completion.active_count} / {completion.student_count}
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>{t('区间提交总数')}</p>
              <p className='text-2xl font-semibold text-foreground'>
                {completion.submit_count}
              </p>
            </div>
            <div className='min-w-56 flex-1'>
              <div className='h-3 overflow-hidden rounded-full bg-muted'>
                <div
                  className='h-full rounded-full bg-primary'
                  style={{ width: `${completion.completion_pct}%` }}
                />
              </div>
              <p className='mt-1.5 text-xs text-muted-foreground'>
                {t('完成率 = 区间内有任意任务提交的学生 ÷ 班级在读学生数')}
              </p>
            </div>
          </div>
        </Panel>
      )}
    </>
  )
}
