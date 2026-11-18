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
import { useCallback, useEffect, useState } from 'react'

import { SectionPageLayout } from '@/components/layout'
import { fetchWorkspacePoints } from '@/features/workspace/api'
import { getSelf } from '@/lib/api'

import { WalletStatsCard } from './components/wallet-stats-card'
import type { UserWalletData } from './types'

/**
 * 我的点数。
 *
 * 只展示当前账户自己的点数（学生为可用点数；教师同时展示教学钱包余额与 API 可用余额），
 * 不提供充值 / 推广等入口，由管理员在后台统一分配点数。
 */
export function Wallet() {
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [wallet, setWallet] = useState<{
    balance: number
    apiQuota: number
    isTeacher: boolean
  } | null>(null)

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true)
      const [response, points] = await Promise.all([
        getSelf(),
        fetchWorkspacePoints().catch(() => null),
      ])
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
      if (points) {
        setWallet({
          balance: points.wallet_balance ?? 0,
          apiQuota: points.api_quota ?? 0,
          isTeacher: points.is_teacher ?? false,
        })
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>我的点数</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-3xl'>
          <WalletStatsCard user={user} wallet={wallet} loading={loading} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
