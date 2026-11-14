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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { downloadReconciliation, fetchReconciliation } from '../api'
import {
  Button,
  MonthPicker,
  PageShell,
  Panel,
  Table,
  Td,
} from '../components/kit'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function yuan(value: number): string {
  return `¥${(value ?? 0).toFixed(4)}`
}

export function ReconciliationSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isSuperAdmin = (user?.role ?? 0) >= ROLE.SUPER_ADMIN
  const [month, setMonth] = useState(currentMonth())
  const [exporting, setExporting] = useState(false)

  const reportQuery = useQuery({
    queryKey: ['ai-hub', 'reconciliation', month],
    queryFn: () => fetchReconciliation(month),
  })

  const report = reportQuery.data
  const total = report?.total

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadReconciliation(month)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导出失败'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <PageShell
      title={t('月度对账')}
      description={t(
        '按月汇总每个学生、每个班级的消耗点数与折算金额，并对比上游 API 成本总额。'
      )}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          <MonthPicker value={month} onChange={setMonth} />
          <Button variant='outline' onClick={() => void reportQuery.refetch()}>
            {t('查询')}
          </Button>
          <Button
            variant='primary'
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? t('导出中…') : t('导出 CSV')}
          </Button>
        </div>
      }
    >
      <Panel title={`${report?.month ?? month} ${t('汇总')}`}>
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
          <SummaryCard label={t('生成次数')} value={String(total?.count ?? 0)} />
          <SummaryCard label={t('消耗点数')} value={String(total?.points ?? 0)} />
          <SummaryCard
            label={t('学生折算总额')}
            value={yuan(total?.amount_yuan ?? 0)}
          />
          <SummaryCard
            label={t('上游成本总额')}
            value={yuan(total?.cost_yuan ?? 0)}
          />
          <SummaryCard
            label={t('差额（成本 - 折算）')}
            value={yuan(total?.diff_yuan ?? 0)}
            tone={(total?.diff_yuan ?? 0) > 0 ? 'danger' : 'success'}
          />
        </div>
      </Panel>

      <Panel title={t('按学生汇总')}>
        <Table
          headers={[
            t('学生'),
            t('班级'),
            t('次数'),
            t('消耗点数'),
            t('折算金额'),
            t('上游成本'),
          ]}
          isEmpty={!report || report.by_user.length === 0}
        >
          {report?.by_user.map((row) => (
            <tr key={row.user_id} className='border-b border-border/60'>
              <Td>{row.username || `#${row.user_id}`}</Td>
              <Td>{row.class_name || t('未分班')}</Td>
              <Td>{row.count}</Td>
              <Td>{row.points}</Td>
              <Td>{yuan(row.amount_yuan)}</Td>
              <Td>{yuan(row.cost_yuan)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title={t('按班级汇总')}>
        <Table
          headers={[t('班级'), t('次数'), t('消耗点数'), t('折算金额'), t('上游成本')]}
          isEmpty={!report || report.by_class.length === 0}
        >
          {report?.by_class.map((row) => (
            <tr key={row.class_id} className='border-b border-border/60'>
              <Td>{row.class_name || t('未分班')}</Td>
              <Td>{row.count}</Td>
              <Td>{row.points}</Td>
              <Td>{yuan(row.amount_yuan)}</Td>
              <Td>{yuan(row.cost_yuan)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {isSuperAdmin && (
        <Panel title={t('按教师汇总（结算留痕）')}>
          <Table
            headers={[
              t('教师'),
              t('次数'),
              t('消耗点数'),
              t('折算金额'),
              t('上游成本'),
            ]}
            isEmpty={!report || report.by_teacher.length === 0}
          >
            {report?.by_teacher.map((row) => (
              <tr key={row.teacher_id} className='border-b border-border/60'>
                <Td>
                  {row.teacher_name || t('未归属教师')}
                </Td>
                <Td>{row.count}</Td>
                <Td>{row.points}</Td>
                <Td>{yuan(row.amount_yuan)}</Td>
                <Td>{yuan(row.cost_yuan)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </PageShell>
  )
}

const SUMMARY_TONE_CLASS: Record<string, string> = {
  default: 'mt-1 text-lg font-semibold text-foreground',
  danger: 'mt-1 text-lg font-semibold text-destructive',
  success: 'mt-1 text-lg font-semibold text-emerald-600',
}

function SummaryCard(props: {
  label: string
  value: string
  tone?: 'default' | 'danger' | 'success'
}) {
  const toneClass =
    SUMMARY_TONE_CLASS[props.tone ?? 'default'] ?? SUMMARY_TONE_CLASS.default
  return (
    <div className='rounded-lg border border-border bg-background px-3 py-2.5'>
      <div className='text-xs text-muted-foreground'>{props.label}</div>
      <div className={toneClass}>{props.value}</div>
    </div>
  )
}
