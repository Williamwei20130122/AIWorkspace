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
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { ClassBoard } from '@/features/ai-hub/sections/class-board'
import { resolveAuthentication } from '@/lib/auth-session'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// 课堂数据大屏：不套管理端布局（无侧栏/顶栏），仅保留返回按钮，供上课投屏使用。
const boardSearchSchema = z.object({
  sessionId: z.number().optional().catch(undefined),
  smallClassId: z.number().optional().catch(undefined),
})

export const Route = createFileRoute('/class-board')({
  beforeLoad: async ({ location }) => {
    await resolveAuthentication()

    const { auth } = useAuthStore.getState()
    if (!auth.user || !auth.accessToken) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    if ((auth.user.role ?? 0) < ROLE.ADMIN) throw redirect({ to: '/403' })
  },
  validateSearch: boardSearchSchema,
  component: ClassBoard,
})
