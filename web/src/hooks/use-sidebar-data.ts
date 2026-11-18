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
import {
  Activity,
  BookOpen,
  Box,
  Building2,
  ChartColumnIncreasing,
  ClipboardList,
  Cloud,
  FileText,
  GraduationCap,
  History,
  Key,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  PlugZap,
  Receipt,
  Radio,
  Scale,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  UserCog,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import { ROLE } from '@/lib/roles'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    navGroups: [
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('AI 创作'),
            url: '/workspace',
            icon: Sparkles,
          },
          {
            title: t('教师工作台'),
            url: '/studio',
            icon: MessageSquare,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Overview'),
            url: '/dashboard/overview',
            icon: Activity,
            // 概览是管理员视角的全站汇总，教师只看得到自己的数据看板。
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard/models',
            icon: LayoutDashboard,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
          {
            title: t('Audit Logs'),
            url: '/usage-logs/audit',
            icon: ClipboardList,
          },
          {
            title: t('Task Logs'),
            url: '/usage-logs/task',
            activeUrls: ['/usage-logs/drawing'],
            configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
            icon: ListTodo,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Wallet'),
            url: '/wallet',
            icon: Wallet,
          },
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
          {
            title: t('Security & Access'),
            url: '/security',
            icon: ShieldCheck,
          },
        ],
      },
      {
        id: 'ai-hub',
        title: t('AI 中台'),
        items: [
          {
            title: t('模型定价'),
            url: '/ai-hub/pricing',
            icon: Receipt,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('月度对账'),
            url: '/ai-hub/reconciliation',
            icon: Scale,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('使用记录'),
            url: '/ai-hub/records',
            icon: History,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('学情管理'),
            url: '/ai-hub/insights',
            icon: ChartColumnIncreasing,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('学生与班级'),
            url: '/ai-hub/classes',
            icon: GraduationCap,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('课堂概览'),
            url: '/ai-hub/overview',
            icon: LayoutDashboard,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('备课模式'),
            url: '/ai-hub/lesson-plans',
            icon: BookOpen,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('云端素材'),
            url: '/ai-hub/cloud-assets',
            icon: Cloud,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('学部管理'),
            url: '/ai-hub/grades',
            icon: Building2,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('教师点数钱包'),
            url: '/ai-hub/teacher-wallets',
            icon: Wallet,
            requiredRole: ROLE.SUPER_ADMIN,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('账户管理'),
            url: '/ai-hub/accounts',
            icon: UserCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Task Plugins'),
            url: '/task-plugins',
            icon: PlugZap,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            requiredRole: ROLE.SUPER_ADMIN,
          },
        ],
      },
    ],
  }
}
