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
import z from 'zod'

/**
 * 用户表格的 URL 搜索参数契约。
 *
 * 用户管理表格已内嵌进账户管理页（/ai-hub/accounts），旧的 /users 路由
 * 保留同一份 schema 以便带参跳转与既有测试复用。
 */
export const usersSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  filter: z.string().optional().catch(''),
  status: z
    .array(z.enum(['-1', '1', '2']))
    .optional()
    .catch([]),
  role: z
    .array(z.enum(['1', '10', '100']))
    .optional()
    .catch([]),
  group: z.array(z.string()).optional().catch([]),
})
