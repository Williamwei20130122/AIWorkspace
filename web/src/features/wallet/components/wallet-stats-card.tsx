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
import { Activity, BarChart3, Coins, Cpu } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatPoints, formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

interface WalletMeta {
  balance: number
  apiQuota: number
  isTeacher: boolean
}

interface WalletStatsCardProps {
  user: UserWalletData | null
  wallet?: WalletMeta | null
  loading?: boolean
}

export function WalletStatsCard(props: WalletStatsCardProps) {
  if (props.loading) {
    return (
      <div className='flex flex-col gap-4'>
        <div className='rounded-xl border p-6'>
          <Skeleton className='h-4 w-28' />
          <Skeleton className='mt-4 h-10 w-48' />
        </div>
        <div className='grid grid-cols-2 gap-4'>
          {['usage', 'requests'].map((key) => (
            <div key={key} className='rounded-xl border p-4'>
              <Skeleton className='h-3.5 w-20' />
              <Skeleton className='mt-3 h-6 w-24' />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const isTeacher = props.wallet?.isTeacher ?? false

  const usedMetrics = [
    {
      label: '已用点数',
      value: formatPoints(props.user?.used_quota ?? 0),
      icon: BarChart3,
    },
    {
      label: '调用次数',
      value: (props.user?.request_count ?? 0).toLocaleString(),
      icon: Activity,
    },
  ]

  return (
    <div className='flex flex-col gap-4'>
      {isTeacher ? (
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='rounded-xl border p-6'>
            <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase'>
              <Coins className='size-4' />
              教学剩余点数
            </div>
            <div className='text-foreground mt-3 font-mono text-4xl font-bold tracking-tight tabular-nums'>
              {formatPoints(props.wallet?.balance ?? 0)}
            </div>
            <p className='text-muted-foreground mt-2 text-xs'>
              用于课堂上的文生文、文生图等生成，管理员每月固定日期发放
            </p>
          </div>

          <div className='rounded-xl border p-6'>
            <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase'>
              <Cpu className='size-4' />
              API 可用额度
            </div>
            <div className='text-foreground mt-3 font-mono text-4xl font-bold tracking-tight tabular-nums'>
              {formatQuota(props.wallet?.apiQuota ?? 0)}
            </div>
            <p className='text-muted-foreground mt-2 text-xs'>
              按人民币计费的接口额度，用于接入 Chatbox、Codex 等外部客户端
            </p>
          </div>
        </div>
      ) : (
        <div className='rounded-xl border p-6'>
          <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase'>
            <Coins className='size-4' />
            我的剩余点数
          </div>
          <div className='text-foreground mt-3 font-mono text-4xl font-bold tracking-tight tabular-nums'>
            {formatPoints(props.user?.quota ?? 0)}
          </div>
          <p className='text-muted-foreground mt-2 text-xs'>
            用于课堂上的文生文、文生图等生成，由老师统一分配
          </p>
        </div>
      )}

      <div className='grid grid-cols-2 gap-4'>
        {usedMetrics.map((item) => (
          <div key={item.label} className='rounded-xl border p-4'>
            <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
              <item.icon className='size-3.5' />
              {item.label}
            </div>
            <div className='text-foreground mt-2 font-mono text-xl font-bold tracking-tight tabular-nums'>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
