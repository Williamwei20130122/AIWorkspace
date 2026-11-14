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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { resolveAuthentication } from '@/lib/auth-session'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/')({
  // AI Workspace 中台不展示 new-api 介绍首页：
  // 已登录教师/管理员直达课堂概览（教师首页），其余已登录用户进入生成工作台，未登录进入登录界面。
  beforeLoad: async () => {
    await resolveAuthentication()
    const { auth } = useAuthStore.getState()
    if (auth.user && auth.accessToken) {
      const target =
        (auth.user.role ?? 0) >= ROLE.ADMIN
          ? '/ai-hub/overview'
          : '/workspace'
      throw redirect({ to: target })
    }
    // 未登录默认展示学生登录窗口，教师/管理员通过登录页上的「教师入口」切换。
    throw redirect({ to: '/sign-in-student' })
  },
  component: () => null,
})
