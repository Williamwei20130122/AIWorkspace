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
import { api } from '@/lib/http-client'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type {
  AiHubAccount,
  AiHubArtifactListResult,
  AiHubCapabilityConfig,
  AiHubCapabilityQuota,
  AiHubClass,
  AiHubGradeOption,
  AiHubLesson,
  AiHubLessonTask,
  AiHubModelCapability,
  AiHubPricingConfig,
  AiHubReconciliation,
  AiHubRecord,
  AiHubSection,
  AiHubSectionOverview,
  AiHubSmallClass,
  AiHubSmallClassImportResult,
  AiHubStudent,
  AiHubTeacherProfile,
  AiHubTeacherWallet,
  AiHubUnit,
  AiHubUserBrief,
  PageResult,
} from './types'

// 超级管理员走全站接口；教师走仅在自身范围生效的教师接口。
const ADMIN_BASE = '/api/workspace/admin'
const TEACHER_BASE = '/api/workspace/teacher'

function scopeBase(): string {
  const role = useAuthStore.getState().auth.user?.role ?? 0
  return role >= ROLE.SUPER_ADMIN ? ADMIN_BASE : TEACHER_BASE
}

const BASE = ADMIN_BASE

// ---------- 能力 / 平台名称 ----------

// fetchCapabilityConfig 读取派生的能力列表与平台名称（账户额度页据此列出各能力）。
export async function fetchCapabilityConfig(): Promise<AiHubCapabilityConfig> {
  const res = await api.get(`${BASE}/capabilities`)
  const data = requireServerSuccess(res.data)?.data
  return {
    capabilities: data?.capabilities ?? [],
    platform_name: data?.platform_name ?? '',
  }
}

// ---------- 模型能力声明 ----------

export async function fetchModelCapabilities(): Promise<
  AiHubModelCapability[]
> {
  const res = await api.get(`${BASE}/model-capabilities`)
  return requireServerSuccess(res.data)?.data ?? []
}

// saveModelCapability 保存单个模型支持的生成模态；kinds 为空表示清除声明。
export async function saveModelCapability(
  payload: AiHubModelCapability
): Promise<AiHubModelCapability[]> {
  const res = await api.put(`${BASE}/model-capabilities`, payload)
  return requireServerSuccess(res.data)?.data ?? []
}

// ---------- 定价规则 ----------

function normalizePricing(data: any): AiHubPricingConfig {
  return {
    kinds: data?.kinds ?? [],
    models: data?.models ?? [],
    unit_options: data?.unit_options ?? [],
    platform_name: data?.platform_name ?? '',
    html_thinking_effort: data?.html_thinking_effort ?? '',
    slide_thinking_effort: data?.slide_thinking_effort ?? '',
    thinking_effort_options: data?.thinking_effort_options ?? [''],
  }
}

export async function fetchPricing(): Promise<AiHubPricingConfig> {
  const res = await api.get(`${BASE}/pricing`)
  return normalizePricing(requireServerSuccess(res.data)?.data)
}

export async function savePricing(
  config: AiHubPricingConfig
): Promise<AiHubPricingConfig> {
  const res = await api.put(`${BASE}/pricing`, config)
  return normalizePricing(requireServerSuccess(res.data)?.data)
}

// ---------- 月度对账 ----------

export async function fetchReconciliation(
  month: string
): Promise<AiHubReconciliation | null> {
  const res = await api.get(`${scopeBase()}/reconciliation`, {
    params: { month },
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// downloadReconciliation 通过带鉴权的请求拉取 CSV 并触发浏览器下载。
export async function downloadReconciliation(month: string): Promise<void> {
  const res = await api.get(`${scopeBase()}/reconciliation/export`, {
    params: { month },
    responseType: 'blob',
  })
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `workspace-reconcile-${month}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ---------- 班级 ----------

export async function fetchClasses(): Promise<AiHubClass[]> {
  const res = await api.get(`${scopeBase()}/classes`)
  return requireServerSuccess(res.data)?.data ?? []
}

// ---------- 学情管理 ----------

/** 学情管理：单个学生在时间范围内的生成汇总 + 各能力分布 */
export interface AiHubInsightBreakdown {
  capability_id: string
  count: number
  points: number
}

export interface AiHubInsightRow {
  user_id: number
  student_id: number
  student_no: string
  display_name: string
  username: string
  class_id: number
  class_name: string
  grade_name: string
  count: number
  points: number
  amount_yuan: number
  last_active_at: number
  breakdown: AiHubInsightBreakdown[]
}

export interface AiHubInsightsResult {
  page: number
  page_size: number
  total: number
  summary: {
    student_count: number
    active_count: number
    count: number
    points: number
    amount_yuan: number
  }
  items: AiHubInsightRow[]
}

export interface InsightQuery {
  start?: number
  end?: number
  class_id?: number
  section_id?: number
  grade_index?: number
  keyword?: string
  include_graduated?: boolean
  p?: number
  page_size?: number
}

// fetchInsights 查询学情管理：按学生聚合的生成次数/点数/金额与能力分布。
export async function fetchInsights(
  query: InsightQuery
): Promise<AiHubInsightsResult> {
  const res = await api.get(`${scopeBase()}/insights`, { params: query })
  const data = requireServerSuccess(res.data)?.data
  return {
    page: data?.page ?? 1,
    page_size: data?.page_size ?? 20,
    total: data?.total ?? 0,
    summary: data?.summary ?? {
      student_count: 0,
      active_count: 0,
      count: 0,
      points: 0,
      amount_yuan: 0,
    },
    items: data?.items ?? [],
  }
}

// ---------- 学习报告（周/月维度） ----------

/** 学习报告：按班级的能力使用、完成率与点数消耗趋势。 */
export interface AiHubReportBucket {
  bucket: number
  count: number
  points: number
}

export interface AiHubReportCapability {
  capability_id: string
  total: number
  points: number
  trend: AiHubReportBucket[]
}

export interface AiHubReportCompletion {
  class_id: number
  class_name: string
  student_count: number
  active_count: number
  submit_count: number
  completion_pct: number
}

export interface AiHubReportResult {
  class_id: number
  class_name: string
  range_start: number
  range_end: number
  bucket_by: string
  summary: {
    student_count: number
    count: number
    points: number
    amount_yuan: number
  }
  capabilities: AiHubReportCapability[]
  points_trend: AiHubReportBucket[]
  completion: AiHubReportCompletion[]
}

export interface ReportQuery {
  class_id: number
  start?: number
  end?: number
  // bucket_by：day | week | month（趋势图时间粒度）。
  bucket_by?: string
}

// fetchReport 查询班级学习报告：能力使用/完成率/点数消耗趋势。
export async function fetchReport(
  query: ReportQuery
): Promise<AiHubReportResult> {
  const res = await api.get(`${scopeBase()}/report`, { params: query })
  return requireServerSuccess(res.data)?.data as AiHubReportResult
}

// saveClass 新建或更新班级；超管与教师均可操作。
export async function saveClass(payload: Partial<AiHubClass>): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess(
      (await api.put(`${scopeBase()}/classes`, payload)).data
    )
    return
  }
  requireServerSuccess((await api.post(`${scopeBase()}/classes`, payload)).data)
}

export async function deleteClass(id: number): Promise<void> {
  requireServerSuccess((await api.delete(`${scopeBase()}/classes/${id}`)).data)
}

// ---------- 上课小班（授课分班） ----------

export async function fetchSmallClasses(params?: {
  parent_class_id?: number
  teacher_id?: number
  // mine=1 只看当前登录教师授课的小班（教师端自助维护）。
  mine?: number
}): Promise<AiHubSmallClass[]> {
  const res = await api.get(`${scopeBase()}/small-classes`, { params })
  return requireServerSuccess(res.data)?.data ?? []
}

// saveSmallClass 新建或更新小班；编码留空由后端自动生成。
export async function saveSmallClass(
  payload: Partial<AiHubSmallClass>
): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess(
      (await api.put(`${scopeBase()}/small-classes`, payload)).data
    )
    return
  }
  requireServerSuccess(
    (await api.post(`${scopeBase()}/small-classes`, payload)).data
  )
}

export async function deleteSmallClass(id: number): Promise<void> {
  requireServerSuccess(
    (await api.delete(`${scopeBase()}/small-classes/${id}`)).data
  )
}

// setSmallClassAI 一键开启/关闭小班全部 AI 生成权限。
export async function setSmallClassAI(
  id: number,
  aiEnabled: boolean
): Promise<AiHubSmallClass | null> {
  const res = await api.put(`${scopeBase()}/small-classes/ai`, {
    id,
    ai_enabled: aiEnabled,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// setSmallClassHtml 一键开启/关闭小班 HTML 实验室权限。
export async function setSmallClassHtml(
  id: number,
  htmlEnabled: boolean
): Promise<AiHubSmallClass | null> {
  const res = await api.put(`${scopeBase()}/small-classes/ai`, {
    id,
    html_enabled: htmlEnabled,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// setSmallClassSlide 一键开启/关闭小班演示实验室权限。
export async function setSmallClassSlide(
  id: number,
  slideEnabled: boolean
): Promise<AiHubSmallClass | null> {
  const res = await api.put(`${scopeBase()}/small-classes/ai`, {
    id,
    slide_enabled: slideEnabled,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

export async function fetchSmallClassMembers(
  id: number
): Promise<AiHubStudent[]> {
  const res = await api.get(`${scopeBase()}/small-classes/${id}/members`)
  return requireServerSuccess(res.data)?.data ?? []
}

export async function addSmallClassMembers(
  id: number,
  studentIds: number[]
): Promise<number> {
  const res = await api.post(`${scopeBase()}/small-classes/${id}/members`, {
    student_ids: studentIds,
  })
  return requireServerSuccess(res.data)?.data?.added ?? 0
}

export async function removeSmallClassMember(
  id: number,
  studentId: number
): Promise<void> {
  requireServerSuccess(
    (
      await api.delete(
        `${scopeBase()}/small-classes/${id}/members/${studentId}`
      )
    ).data
  )
}

// removeSmallClassMembers 批量把学生移出小班，返回实际移出人数。
export async function removeSmallClassMembers(
  id: number,
  studentIds: number[]
): Promise<number> {
  const res = await api.post(
    `${scopeBase()}/small-classes/${id}/members/batch-delete`,
    { student_ids: studentIds }
  )
  return requireServerSuccess(res.data)?.data?.removed ?? 0
}

// cleanupGraduatedSmallClass 社团按届清退：移出毕业届 / 已离校成员，
// 返回移出人数与检查人数。
export async function cleanupGraduatedSmallClass(
  id: number
): Promise<{ removed: number; checked: number }> {
  const res = await api.post(
    `${scopeBase()}/small-classes/${id}/cleanup-graduated`,
    {}
  )
  const data = requireServerSuccess(res.data)?.data
  return { removed: data?.removed ?? 0, checked: data?.checked ?? 0 }
}

// importSmallClassParentStudents 把小班所属行政班的在读学生一键拉入小班。
export async function importSmallClassParentStudents(
  id: number
): Promise<{ added: number; total: number }> {
  const res = await api.post(
    `${scopeBase()}/small-classes/${id}/import-parent-students`,
    {}
  )
  const data = requireServerSuccess(res.data)?.data
  return { added: data?.added ?? 0, total: data?.total ?? 0 }
}

// downloadSmallClassImportTemplate 下载小班导入学生模板（姓名/届/年级）。
export async function downloadSmallClassImportTemplate(): Promise<void> {
  const res = await api.get(`${scopeBase()}/small-classes/import-template`, {
    responseType: 'blob',
  })
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'workspace-import-template.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// downloadClubImportTemplate 下载社团专用导入模板（社团名称/姓名/届，独立于正课表格）。
export async function downloadClubImportTemplate(): Promise<void> {
  const res = await api.get(
    `${scopeBase()}/small-classes/club-import-template`,
    {
      responseType: 'blob',
    }
  )
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'club-import-template.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// downloadSmallClassAccounts 导出小班学生账户信息 Excel（学号/登录名/点数/状态），供学生核对账户。
export async function downloadSmallClassAccounts(id: number): Promise<void> {
  const res = await api.get(
    `${scopeBase()}/small-classes/${id}/accounts/export`,
    {
      responseType: 'blob',
    }
  )
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'small-class-accounts.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// importSmallClassStudents 上传 Excel 按姓名+届次+年级模糊匹配，返回匹配与未匹配清单。
export async function importSmallClassStudents(
  id: number,
  file: File
): Promise<AiHubSmallClassImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post(`${scopeBase()}/small-classes/${id}/import`, form)
  const payload: Partial<AiHubSmallClassImportResult> =
    requireServerSuccess(res.data)?.data ?? {}
  return {
    matched: payload.matched ?? [],
    unmatched: payload.unmatched ?? [],
    failed: payload.failed ?? [],
    matched_student_ids: payload.matched_student_ids ?? [],
  }
}

// ---------- 班级批量导入 ----------

export interface AiHubClassImportResult {
  classes_created: number
  classes_updated: number
  students_created: number
  // students_skipped 班级中已存在同名学生时跳过的条数。
  students_skipped: number
  // 以下为上课小班（合并模板中的「小班」「小班学生」工作表）导入结果。
  small_classes_created?: number
  small_classes_updated?: number
  small_members_added?: number
  small_members_skipped?: number
  failed: { row: string; reason: string }[]
}

// downloadClassTemplate 下载批量建班建号的示例 Excel 模板。
export async function downloadClassTemplate(): Promise<void> {
  const res = await api.get(`${scopeBase()}/classes/import-template`, {
    responseType: 'blob',
  })
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'workspace-import-template.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// exportClassRoster 按学部/届/班级/小班导出当前名单为与导入模板同格式的
// Excel（可核对或二次编辑后回传导入）。
export async function exportClassRoster(params: {
  section_id?: number
  entry_year?: number
  class_id?: number
  small_class_id?: number
}): Promise<void> {
  const res = await api.get(`${scopeBase()}/classes/export`, {
    params: Object.fromEntries(
      Object.entries(params).filter(([, value]) => Boolean(value))
    ),
    responseType: 'blob',
  })
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveBlob(blob, 'workspace-roster-export.xlsx')
}

// importClasses 上传填好的 Excel，批量创建班级与班级下学生账号。
export async function importClasses(
  file: File,
  defaultPassword: string
): Promise<AiHubClassImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('default_password', defaultPassword)
  const res = await api.post(`${scopeBase()}/classes/import`, form)
  const payload: Partial<AiHubClassImportResult> =
    requireServerSuccess(res.data)?.data ?? {}
  return {
    classes_created: payload.classes_created ?? 0,
    classes_updated: payload.classes_updated ?? 0,
    students_created: payload.students_created ?? 0,
    students_skipped: payload.students_skipped ?? 0,
    failed: payload.failed ?? [],
  }
}

// ---------- 学生 ----------

export async function fetchStudents(
  classId?: number,
  keyword?: string
): Promise<AiHubStudent[]> {
  const params: Record<string, string | number> = {}
  if (classId) params.class_id = classId
  if (keyword?.trim()) params.keyword = keyword.trim()
  const res = await api.get(`${scopeBase()}/students`, {
    params: Object.keys(params).length ? params : undefined,
  })
  return requireServerSuccess(res.data)?.data ?? []
}

export async function saveStudent(
  payload: Partial<AiHubStudent>
): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess(
      (await api.put(`${scopeBase()}/students`, payload)).data
    )
    return
  }
  requireServerSuccess(
    (await api.post(`${scopeBase()}/students`, payload)).data
  )
}

export async function deleteStudent(id: number): Promise<void> {
  requireServerSuccess((await api.delete(`${scopeBase()}/students/${id}`)).data)
}

// setStudentPoints 调整单个学生点数：clear 清零 / set 指定值。
// 可传 studentId（学生档案）或 userId（账号），课堂大屏等场景只持有 userId。
export async function setStudentPoints(params: {
  studentId?: number
  userId?: number
  mode: 'clear' | 'set'
  value?: number
}): Promise<{ user_id: number; points: number }> {
  const res = await api.post(`${scopeBase()}/students/points`, {
    student_id: params.studentId ?? 0,
    user_id: params.userId ?? 0,
    mode: params.mode,
    value: params.value ?? 0,
  })
  return requireServerSuccess(res.data)?.data ?? { user_id: 0, points: 0 }
}

// updateStudentAccount 修改学生登录密码。
export async function updateStudentAccount(params: {
  studentId: number
  password: string
}): Promise<void> {
  requireServerSuccess(
    (
      await api.post(`${scopeBase()}/students/account`, {
        student_id: params.studentId,
        password: params.password,
      })
    ).data
  )
}

// resetStudentPassword 重置学生登录密码：清除已设置密码标记，恢复免密登录。
export async function resetStudentPassword(params: {
  studentId: number
  userId?: number
}): Promise<void> {
  requireServerSuccess(
    (
      await api.post(`${scopeBase()}/students/password/reset`, {
        student_id: params.studentId,
        user_id: params.userId ?? 0,
      })
    ).data
  )
}

// fetchNamePinyin 按中文姓名自动转拼音，供名单表格自动填充。
export async function fetchNamePinyin(name: string): Promise<string> {
  if (!name.trim()) return ''
  const res = await api.get(`${scopeBase()}/students/pinyin`, {
    params: { name },
  })
  const items = requireServerSuccess(res.data)?.data as
    | { name: string; pinyin: string }[]
    | undefined
  return items?.[0]?.pinyin ?? ''
}

export interface BatchCreateStudentRow {
  student_no: string
  display_name?: string
  pinyin_username?: string
  username?: string
  password?: string
}

export interface BatchCreateStudentsResult {
  created_count: number
  failed: { student_no: string; reason: string }[]
}

// batchCreateStudents 批量新建学生账号并直接加入班级；超管与教师均可操作。
export async function batchCreateStudents(
  classId: number,
  rows: BatchCreateStudentRow[],
  defaultPassword: string
): Promise<BatchCreateStudentsResult> {
  const res = await api.post(`${scopeBase()}/students/batch-create`, {
    class_id: classId,
    default_password: defaultPassword,
    students: rows,
  })
  const data = requireServerSuccess(res.data)?.data
  return {
    created_count: data?.created_count ?? 0,
    failed: data?.failed ?? [],
  }
}

// batchSetStudentPoints 批量调整点数：传 student_ids 只处理选中学生，
// 传 user_ids 按账号处理（课堂大屏等只持有 userId 的场景），
// 都不传则作用于整个 class_id 班级（全班一键分发）。
export async function batchSetStudentPoints(params: {
  classId?: number
  studentIds?: number[]
  userIds?: number[]
  mode: 'clear' | 'set'
  value?: number
  resetUsage?: boolean
}): Promise<{ applied: number; failed: number; total: number }> {
  const res = await api.post(`${scopeBase()}/students/points/batch`, {
    class_id: params.classId ?? 0,
    student_ids: params.studentIds ?? [],
    user_ids: params.userIds ?? [],
    mode: params.mode,
    value: params.value ?? 0,
    reset_usage: params.resetUsage ?? false,
  })
  return (
    requireServerSuccess(res.data)?.data ?? { applied: 0, failed: 0, total: 0 }
  )
}

// transferStudent 转班：把学生改挂到另一个班级（沿用更新学生接口）。
export async function transferStudent(
  student: AiHubStudent,
  classId: number
): Promise<void> {
  requireServerSuccess(
    (
      await api.put(`${scopeBase()}/students`, {
        id: student.id,
        user_id: student.user_id,
        class_id: classId,
        student_no: student.student_no,
        display_name: student.display_name,
        enabled: student.enabled,
      })
    ).data
  )
}

// ---------- 学部 / 教师 ----------

// fetchSections 读取全部学部（教师端只读）。
export async function fetchSections(): Promise<AiHubSection[]> {
  const res = await api.get(`${scopeBase()}/sections`)
  return requireServerSuccess(res.data)?.data ?? []
}

// saveSection 新建或更新学部（仅超管）。
export async function saveSection(
  payload: Partial<AiHubSection>
): Promise<AiHubSection | null> {
  const res =
    payload.id && payload.id > 0
      ? await api.put(`${ADMIN_BASE}/sections`, payload)
      : await api.post(`${ADMIN_BASE}/sections`, payload)
  return requireServerSuccess(res.data)?.data ?? null
}

// deleteSection 删除学部（仅超管）。
export async function deleteSection(id: number): Promise<void> {
  requireServerSuccess((await api.delete(`${ADMIN_BASE}/sections/${id}`)).data)
}

// fetchSectionOverview 学部总览：各学部的班级与学生数量。
export async function fetchSectionOverview(): Promise<AiHubSectionOverview> {
  const res = await api.get(`${ADMIN_BASE}/section-overview`)
  const data = requireServerSuccess(res.data)?.data
  return {
    academic_year: data?.academic_year ?? 0,
    last_rollover_academic_year: data?.last_rollover_academic_year ?? 0,
    items: data?.items ?? [],
  }
}

// fetchSectionGradeOptions 按学部学制推导的年级选项（学年变化后自动跟随）。
export async function fetchSectionGradeOptions(): Promise<AiHubGradeOption[]> {
  const res = await api.get(`${scopeBase()}/section-options`)
  return requireServerSuccess(res.data)?.data ?? []
}

// rolloverSchoolYear 学年结转：把超出学部学制年限的在读学生标记为「已毕业」（幂等）。
export async function rolloverSchoolYear(): Promise<{
  academic_year: number
  graduated: number
}> {
  const res = await api.post(`${ADMIN_BASE}/school-year/rollover`)
  const data = requireServerSuccess(res.data)?.data
  return {
    academic_year: data?.academic_year ?? 0,
    graduated: data?.graduated ?? 0,
  }
}

// fetchTeachers 读取教师账号列表。
export async function fetchTeachers(): Promise<AiHubTeacherProfile[]> {
  const res = await api.get(`${scopeBase()}/teachers`)
  return requireServerSuccess(res.data)?.data ?? []
}

// createTeacher 新建教师账号，username 留空时由服务端自动分配。
export async function createTeacher(payload: {
  username?: string
  display_name?: string
  password?: string
}): Promise<{
  user_id: number
  username: string
  display_name: string
  password: string
} | null> {
  const res = await api.post(`${ADMIN_BASE}/teachers`, payload)
  const data = requireServerSuccess(res.data)?.data
  if (!data) return null
  return {
    user_id: data.user_id ?? 0,
    username: data.username ?? '',
    display_name: data.display_name ?? '',
    password: data.password ?? '',
  }
}

// transferWorkspaceStudent 转班：把学生改挂到另一个班级。
export async function transferWorkspaceStudent(payload: {
  studentId: number
  toClassId: number
  reason?: string
}): Promise<void> {
  requireServerSuccess(
    (
      await api.post(`${scopeBase()}/students/transfer`, {
        student_id: payload.studentId,
        to_class_id: payload.toClassId,
        reason: payload.reason ?? '',
      })
    ).data
  )
}

// batchTransferStudents 批量转班 / 升学：正课小班归属自动清理、社团保留。
export async function batchTransferStudents(payload: {
  studentIds: number[]
  toClassId: number
  reason?: string
}): Promise<{
  transferred: number
  skipped: number
  cleaned: number
  failures: { student_id: number; reason: string }[]
}> {
  const res = await api.post(`${scopeBase()}/students/batch-transfer`, {
    student_ids: payload.studentIds,
    to_class_id: payload.toClassId,
    reason: payload.reason ?? '',
  })
  const data = requireServerSuccess(res.data)?.data
  return {
    transferred: data?.transferred ?? 0,
    skipped: data?.skipped ?? 0,
    cleaned: data?.cleaned ?? 0,
    failures: data?.failures ?? [],
  }
}

// ---------- 统计概览 ----------

export interface AiHubStatsGrade {
  grade_index: number
  grade_name: string
  class_count: number
  student_num: number
  regular_small_count: number
  club_student_count: number
  club_rate: number
}

export interface AiHubStatsSection {
  id: number
  code: string
  name: string
  years: number
  class_count: number
  student_num: number
  regular_small_count: number
  club_count: number
  club_student_count: number
  club_rate: number
  grades: AiHubStatsGrade[]
}

export interface AiHubStatsOverview {
  academic_year: string
  last_rollover_academic_year: string
  items: AiHubStatsSection[]
}

// fetchStatsOverview 统计概览：各学部/届的班级数、学生数、正课小班数、
// 社团参与率等汇总数据。
export async function fetchStatsOverview(): Promise<AiHubStatsOverview> {
  const res = await api.get(`${scopeBase()}/stats/overview`)
  const data = requireServerSuccess(res.data)?.data
  return {
    academic_year: data?.academic_year ?? '',
    last_rollover_academic_year: data?.last_rollover_academic_year ?? '',
    items: data?.items ?? [],
  }
}

// ---------- 账户与能力额度 ----------

export async function fetchUsers(): Promise<AiHubUserBrief[]> {
  const res = await api.get(`${scopeBase()}/users`)
  return requireServerSuccess(res.data)?.data ?? []
}

export async function fetchAccounts(): Promise<AiHubAccount[]> {
  const res = await api.get(`${scopeBase()}/accounts`)
  return requireServerSuccess(res.data)?.data ?? []
}

export async function saveAccountQuotas(
  userId: number,
  quotas: Record<string, number>
): Promise<AiHubCapabilityQuota[]> {
  const res = await api.put(`${scopeBase()}/accounts/quotas`, {
    user_id: userId,
    quotas,
  })
  return requireServerSuccess(res.data)?.data ?? []
}

export async function resetAccountUsage(
  userId: number,
  capabilityId = ''
): Promise<AiHubCapabilityQuota[]> {
  const res = await api.post(`${scopeBase()}/accounts/reset`, {
    user_id: userId,
    capability_id: capabilityId,
  })
  return requireServerSuccess(res.data)?.data ?? []
}

// ---------- 教师点数钱包 ----------

export async function fetchTeacherWallets(): Promise<AiHubTeacherWallet[]> {
  const res = await api.get(`${BASE}/teacher-wallets`)
  return requireServerSuccess(res.data)?.data ?? []
}

// saveTeacherWallet 保存教师的每月发放配置（发放日 / 数量 / 是否自动发放）。
export async function saveTeacherWallet(params: {
  userId: number
  grantAmount: number
  grantDay: number
  autoGrant: boolean
}): Promise<AiHubTeacherWallet | null> {
  const res = await api.put(`${BASE}/teacher-wallets`, {
    user_id: params.userId,
    grant_amount: params.grantAmount,
    grant_day: params.grantDay,
    auto_grant: params.autoGrant,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// grantTeacherWallet 手动发放点数（同时加到教学钱包与 API 额度）。
export async function grantTeacherWallet(
  userId: number,
  amount: number
): Promise<AiHubTeacherWallet | null> {
  const res = await api.post(`${BASE}/teacher-wallets/grant`, {
    user_id: userId,
    amount,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// setTeacherWalletBalance 直接设置教师的教学钱包余额。
export async function setTeacherWalletBalance(
  userId: number,
  balance: number
): Promise<AiHubTeacherWallet | null> {
  const res = await api.post(`${BASE}/teacher-wallets/balance`, {
    user_id: userId,
    amount: balance,
  })
  return requireServerSuccess(res.data)?.data ?? null
}

// ---------- 使用记录 ----------

export interface RecordQuery {
  user_id?: number
  class_id?: number
  section_id?: number
  grade_index?: number
  // keyword 学生姓名 / 姓名拼音关键词，服务端换算为学生账号范围后再查记录。
  keyword?: string
  /** 包含已毕业学生：转班 / 升年级后仍可追溯历史记录。 */
  include_graduated?: boolean
  kind?: string
  start_timestamp?: number
  end_timestamp?: number
  page?: number
  page_size?: number
}

export async function fetchRecords(
  query: RecordQuery,
  all = true
): Promise<PageResult<AiHubRecord>> {
  const url = all ? `${scopeBase()}/records` : '/api/workspace/records'
  const res = await api.get(url, { params: query })
  const data = requireServerSuccess(res.data)?.data
  return {
    page: data?.page ?? 1,
    page_size: data?.page_size ?? 20,
    total: data?.total ?? 0,
    items: data?.items ?? [],
  }
}

// ---------- 班级统计导出 ----------

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// downloadClassStats 导出整个班级的点数与生成次数为 Excel。
export async function downloadClassStats(classId: number): Promise<void> {
  const res = await api.get(`${scopeBase()}/class-stats/export`, {
    params: { class_id: classId },
    responseType: 'blob',
  })
  saveBlob(
    new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `class-${classId}-stats.xlsx`
  )
}

// ---------- 云端素材 ----------

export interface ArtifactQuery {
  class_id?: number
  section_id?: number
  grade_index?: number
  // keyword 学生姓名 / 姓名拼音关键词，服务端换算为学生账号范围后再查素材。
  keyword?: string
  /** 包含已毕业学生：按学生当前班级 / 年级实时归属素材。 */
  include_graduated?: boolean
  kind?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
  // shared=1 只看班级共享素材；share_class_id 按共享班级精确筛选。
  shared?: boolean
  share_class_id?: number
  // mine=1 只看当前登录账号上传的素材（备课参考资料选择器用）。
  mine?: boolean
}

// uploadSharedArtifact 备课上传任务参考资料：直接写入磁盘并共享到指定班级。
export async function uploadSharedArtifact(
  file: File,
  shareClassId: number
): Promise<{ id: number; url: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('share_class_id', String(shareClassId))
  const res = await api.post('/api/workspace/uploads', form, {
    skipErrorHandler: true,
  })
  const data = requireServerSuccess(res.data)?.data
  if (!data) throw new Error('参考资料上传失败')
  return { id: data.id, url: data.url }
}

// shareArtifact 设置 / 取消素材的班级共享（shareClassId=0 表示取消）。
export async function shareArtifact(
  id: number,
  shareClassId: number
): Promise<void> {
  const res = await api.post(`${scopeBase()}/artifacts/share`, {
    id,
    share_class_id: shareClassId,
  })
  requireServerSuccess(res.data)
}

// fetchSharedArtifacts 学生端：本班共享素材库。
export async function fetchSharedArtifacts(
  page = 1,
  pageSize = 50
): Promise<AiHubArtifactListResult> {
  const res = await api.get('/api/workspace/shared-artifacts', {
    params: { page, page_size: pageSize },
  })
  const data = requireServerSuccess(res.data)?.data
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    stats: [],
  }
}

// fetchArtifacts 读取云端素材列表（教师仅见自身范围，超管见全站）。
export async function fetchArtifacts(
  query: ArtifactQuery
): Promise<AiHubArtifactListResult> {
  const res = await api.get(`${scopeBase()}/artifacts`, { params: query })
  const data = requireServerSuccess(res.data)?.data
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    stats: data?.stats ?? [],
  }
}

// fetchArtifactBlob 带鉴权拉取素材二进制。
export async function fetchArtifactBlob(id: number): Promise<Blob> {
  const res = await api.get(`${scopeBase()}/artifacts/${id}/content`, {
    responseType: 'blob',
  })
  return res.data as Blob
}

// fetchArtifactBlobUrl 带鉴权拉取素材二进制并返回可直接用于预览/下载的 object URL。
// 调用方负责在不再使用时通过 URL.revokeObjectURL 释放。
export async function fetchArtifactBlobUrl(id: number): Promise<string> {
  return URL.createObjectURL(await fetchArtifactBlob(id))
}

// deleteArtifact 删除一份云端素材；已提交课堂作品会被服务端拒绝。
export async function deleteArtifact(
  id: number
): Promise<{ deleted: number; released_bytes: number }> {
  const res = await api.delete(`${scopeBase()}/artifacts/${id}`)
  const data = requireServerSuccess(res.data)?.data
  return {
    deleted: data?.deleted ?? 0,
    released_bytes: data?.released_bytes ?? 0,
  }
}

// packageArtifacts 把选中的素材打包为 zip 并触发浏览器下载。
export async function packageArtifacts(ids: number[]): Promise<void> {
  const res = await api.post(
    `${scopeBase()}/artifacts/package`,
    { ids },
    { responseType: 'blob' }
  )
  saveBlob(
    new Blob([res.data], { type: 'application/zip' }),
    `workspace-artifacts-${Date.now()}.zip`
  )
}

export interface ArtifactPurgePayload {
  from?: string
  to?: string
  mode?: string
  class_id?: number
  // ids 手动勾选的素材 id 列表。
  ids?: number[]
}

// purgeArtifacts 批量清理云端素材（仅超管）：勾选清理 / 按时间段 / 按班级。
export async function purgeArtifacts(
  payload: ArtifactPurgePayload
): Promise<{ deleted: number; released_bytes: number }> {
  const res = await api.post(`${ADMIN_BASE}/artifacts/purge`, payload)
  const data = requireServerSuccess(res.data)?.data
  return {
    deleted: data?.deleted ?? 0,
    released_bytes: data?.released_bytes ?? 0,
  }
}

// 云端素材自动清理的保留天数配置项（0 表示关闭自动清理）。
export const ARTIFACT_RETENTION_OPTION_KEY = 'WorkspaceArtifactRetentionDays'

// fetchArtifactRetentionDays 读取云端素材自动清理的保留天数（仅超管可访问 option 接口）。
export async function fetchArtifactRetentionDays(): Promise<number> {
  const res = await api.get('/api/option/')
  const data = requireServerSuccess(res.data)?.data ?? []
  const raw = (data as { key: string; value: string }[]).find(
    (item) => item.key === ARTIFACT_RETENTION_OPTION_KEY
  )?.value
  const days = Number.parseInt(String(raw ?? '0'), 10)
  return Number.isFinite(days) && days > 0 ? days : 0
}

// saveArtifactRetentionDays 保存云端素材自动清理的保留天数（0 表示关闭）。
export async function saveArtifactRetentionDays(days: number): Promise<void> {
  requireServerSuccess(
    (
      await api.put('/api/option/', {
        key: ARTIFACT_RETENTION_OPTION_KEY,
        value: days,
      })
    ).data
  )
}

// ---------- 备课模式（单元 / 课时 / 分项任务） ----------

// AiHubLessonImportResult 备课 Excel 导入结果汇总。
export interface AiHubLessonImportResult {
  units_created: number
  units_updated: number
  lessons_created: number
  lessons_updated: number
  tasks_created: number
  tasks_updated: number
  total_rows: number
  failed: { row: string; reason: string }[]
}

// downloadLessonImportTemplate 下载备课批量导入的示例 Excel 模板。
export async function downloadLessonImportTemplate(): Promise<void> {
  const res = await api.get(`${scopeBase()}/lesson-plans/import-template`, {
    responseType: 'blob',
  })
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'workspace-lesson-import-template.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// importLessonPlans 上传填好的 Excel，按名称幂等批量创建/更新单元、课时与分项任务。
export async function importLessonPlans(
  file: File
): Promise<AiHubLessonImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post(`${scopeBase()}/lesson-plans/import`, form)
  const payload: Partial<AiHubLessonImportResult> =
    requireServerSuccess(res.data)?.data ?? {}
  return {
    units_created: payload.units_created ?? 0,
    units_updated: payload.units_updated ?? 0,
    lessons_created: payload.lessons_created ?? 0,
    lessons_updated: payload.lessons_updated ?? 0,
    tasks_created: payload.tasks_created ?? 0,
    tasks_updated: payload.tasks_updated ?? 0,
    total_rows: payload.total_rows ?? 0,
    failed: payload.failed ?? [],
  }
}

// fetchLessonPlans 读取指定学部+年级下的单元、课时与分项任务。
export async function fetchLessonPlans(
  sectionId: number,
  gradeIndex: number
): Promise<AiHubUnit[]> {
  const res = await api.get(`${scopeBase()}/lesson-plans`, {
    params: { section_id: sectionId, grade_index: gradeIndex },
  })
  return requireServerSuccess(res.data)?.data ?? []
}

// saveUnit 新建或更新备课单元。
export async function saveUnit(payload: Partial<AiHubUnit>): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess((await api.put(`${scopeBase()}/units`, payload)).data)
    return
  }
  requireServerSuccess((await api.post(`${scopeBase()}/units`, payload)).data)
}

export async function deleteUnit(id: number): Promise<void> {
  requireServerSuccess((await api.delete(`${scopeBase()}/units/${id}`)).data)
}

// saveLesson 新建或更新课时（ai_course 标记为 AI 课程）。
export async function saveLesson(payload: Partial<AiHubLesson>): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess(
      (await api.put(`${scopeBase()}/lessons`, payload)).data
    )
    return
  }
  requireServerSuccess((await api.post(`${scopeBase()}/lessons`, payload)).data)
}

export async function deleteLesson(id: number): Promise<void> {
  requireServerSuccess((await api.delete(`${scopeBase()}/lessons/${id}`)).data)
}

// copyLesson 复制课时及全部分项任务，实现方案复用。
export async function copyLesson(
  id: number,
  targetUnitId?: number
): Promise<void> {
  requireServerSuccess(
    (
      await api.post(`${scopeBase()}/lessons/${id}/copy`, {
        target_unit_id: targetUnitId ?? 0,
      })
    ).data
  )
}

// saveLessonTask 新建或更新分项任务（规则含后缀白名单/上传数量/产出形式）。
export async function saveLessonTask(
  payload: Partial<AiHubLessonTask>
): Promise<void> {
  if (payload.id && payload.id > 0) {
    requireServerSuccess(
      (await api.put(`${scopeBase()}/lesson-tasks`, payload)).data
    )
    return
  }
  requireServerSuccess(
    (await api.post(`${scopeBase()}/lesson-tasks`, payload)).data
  )
}

export async function deleteLessonTask(id: number): Promise<void> {
  requireServerSuccess(
    (await api.delete(`${scopeBase()}/lesson-tasks/${id}`)).data
  )
}

// ---------- 授课分发与课堂概览（D2 / D3 / D4 / D5） ----------

export interface AiHubClassSession {
  id: number
  small_class_id: number
  lesson_id: number
  unit_id: number
  section_id: number
  grade_index: number
  teacher_id: number
  status: 'active' | 'closed'
  started_at: number
  ended_at: number
  updated_at: number
  /** 本节课主题：分发时默认课时标题，教师可改。 */
  theme: string
  lesson_title: string
  unit_name: string
  small_class_name: string
  small_class_code: string
  ai_course: boolean
  task_count: number
  submission_count: number
}

export interface AiHubTaskSubmission {
  id: number
  created_at: number
  session_id: number
  task_id: number
  user_id: number
  small_class_id: number
  content_type: 'text' | 'file' | 'ai'
  text_content: string
  file_name: string
  artifact_id: number
  mime_type: string
  size_bytes: number
  asset_url: string
  capability: string
  prompt: string
  params: string
  result_text: string
  task_title: string
  student_name: string
  student_no: string
}

export interface AiHubClassSessionDetail {
  session: AiHubClassSession
  tasks: AiHubLessonTask[]
  submissions: AiHubTaskSubmission[]
}

// fetchClassSessions 按小班列出课堂会话（不传小班则返回全部）。
export async function fetchClassSessions(
  smallClassId?: number
): Promise<AiHubClassSession[]> {
  const res = await api.get(`${scopeBase()}/class-sessions`, {
    params: smallClassId ? { small_class_id: smallClassId } : undefined,
  })
  return requireServerSuccess(res.data)?.data ?? []
}

// distributeLesson 把课时一键分发到小班，返回进行中的课堂会话。
// theme 为本节课主题，留空时后端回落课时标题。
export async function distributeLesson(
  smallClassId: number,
  lessonId: number,
  theme?: string
): Promise<AiHubClassSession | null> {
  const res = await api.post(`${scopeBase()}/class-sessions/distribute`, {
    small_class_id: smallClassId,
    lesson_id: lessonId,
    theme: theme ?? '',
  })
  return requireServerSuccess(res.data)?.data ?? null
}

/** 临时课堂的单个任务环节输入（v1.1）。 */
export interface TempClassTaskInput {
  title: string
  requirement: string
  /** 提交内容类型，逗号分隔：text / file / ai。 */
  output_forms: string
}

// createTempClassSession 临时发起课堂：不走备课方案，直接创建任务环节并分发。
export async function createTempClassSession(payload: {
  small_class_id: number
  theme?: string
  tasks: TempClassTaskInput[]
}): Promise<AiHubClassSession | null> {
  const res = await api.post(`${scopeBase()}/class-sessions/temp`, payload)
  return requireServerSuccess(res.data)?.data ?? null
}

/** 完成情况矩阵中单个学生的单任务状态（v1.1）。 */
export interface ClassSessionTaskProgress {
  task_id: number
  submitted: boolean
  count: number
  last_at: number
}

/** 完成情况矩阵中的学生行（v1.1）。 */
export interface ClassSessionStudentProgress {
  user_id: number
  student_name: string
  student_no: string
  /** 剩余点数与已用点数（大屏直接展示、就地发点数）。 */
  quota?: number
  used_quota?: number
  tasks: ClassSessionTaskProgress[]
  completed_task: number
  submission_cnt: number
}

export interface AiHubClassSessionProgress {
  session: AiHubClassSession
  tasks: AiHubLessonTask[]
  students: ClassSessionStudentProgress[]
}

// fetchClassSessionProgress 学生 × 任务完成情况矩阵，用于课堂实时进度表。
export async function fetchClassSessionProgress(
  id: number
): Promise<AiHubClassSessionProgress | null> {
  const res = await api.get(`${scopeBase()}/class-sessions/${id}/progress`)
  const data = requireServerSuccess(res.data)?.data
  if (!data) return null
  return {
    session: data.session,
    tasks: data.tasks ?? [],
    students: data.students ?? [],
  }
}

// fetchClassSessionDetail 读取课堂会话、分项任务与全部学生提交。
export async function fetchClassSessionDetail(
  id: number
): Promise<AiHubClassSessionDetail | null> {
  const res = await api.get(`${scopeBase()}/class-sessions/${id}`)
  const data = requireServerSuccess(res.data)?.data
  if (!data) return null
  return {
    session: data.session,
    tasks: data.tasks ?? [],
    submissions: data.submissions ?? [],
  }
}

export async function closeClassSession(id: number): Promise<void> {
  requireServerSuccess(
    (await api.post(`${scopeBase()}/class-sessions/${id}/close`)).data
  )
}

// downloadClassSessionPackage 把某次课堂的全部提交打包为 ZIP 下载。
export async function downloadClassSessionPackage(id: number): Promise<void> {
  const res = await api.get(`${scopeBase()}/class-sessions/${id}/package`, {
    responseType: 'blob',
  })
  saveBlob(
    new Blob([res.data], { type: 'application/zip' }),
    `class-session-${id}-${Date.now()}.zip`
  )
}

// ---------- 全局异步任务汇总（教师端大屏） ----------

/** 单条异步任务汇总行（与后端 workspaceAsyncTaskItem 对齐）。 */
export interface WorkspaceAsyncTaskItem {
  task_id: string
  model: string
  action: string
  status: string
  progress: string
  submit_time: number
  finish_time: number
  result_url: string
  fail_reason?: string
  username: string
  user_id: number
  platform: string
  paused: boolean
  poll_failures: number
  next_poll_at: number
}

export interface WorkspaceAsyncTaskListResult {
  items: WorkspaceAsyncTaskItem[]
  total: number
  page: number
  page_size: number
}

/** 任务状态变更日志行（含厂商接口原始参数 RawResponse）。 */
export interface WorkspaceAsyncTaskLog {
  id: number
  task_id: string
  platform: string
  user_id: number
  from_status: string
  to_status: string
  source: string
  detail: string
  raw_response: string
  created_at: number
}

// fetchWorkspaceAsyncTasks 全局异步任务汇总列表：按提交时间倒序，支持状态筛选与分页。
export async function fetchWorkspaceAsyncTasks(
  page: number,
  pageSize: number,
  status?: string
): Promise<WorkspaceAsyncTaskListResult> {
  const res = await api.get(`${TEACHER_BASE}/async-tasks`, {
    params: { page, page_size: pageSize, status: status || undefined },
  })
  const data = requireServerSuccess(res.data)?.data
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? page,
    page_size: data?.page_size ?? pageSize,
  }
}

// pauseWorkspaceAsyncTask 教师端手动暂停任务自动轮询。
export async function pauseWorkspaceAsyncTask(
  taskId: string
): Promise<WorkspaceAsyncTaskItem> {
  const res = await api.post(
    `${TEACHER_BASE}/async-tasks/${encodeURIComponent(taskId)}/pause`
  )
  return requireServerSuccess(res.data)?.data
}

// resumeWorkspaceAsyncTask 教师端恢复被暂停任务的自动轮询。
export async function resumeWorkspaceAsyncTask(
  taskId: string
): Promise<WorkspaceAsyncTaskItem> {
  const res = await api.post(
    `${TEACHER_BASE}/async-tasks/${encodeURIComponent(taskId)}/resume`
  )
  return requireServerSuccess(res.data)?.data
}

// queryWorkspaceAsyncTask 教师端手动触发单次厂商状态查询（绕过轮询间隔与暂停）。
export async function queryWorkspaceAsyncTask(
  taskId: string
): Promise<WorkspaceAsyncTaskItem> {
  const res = await api.post(
    `${TEACHER_BASE}/async-tasks/${encodeURIComponent(taskId)}/query`
  )
  return requireServerSuccess(res.data)?.data
}

// fetchWorkspaceAsyncTaskLogs 读取任务状态变更日志（含厂商原始参数详情）。
export async function fetchWorkspaceAsyncTaskLogs(
  taskId: string,
  limit = 100
): Promise<WorkspaceAsyncTaskLog[]> {
  const res = await api.get(
    `${TEACHER_BASE}/async-tasks/${encodeURIComponent(taskId)}/logs`,
    { params: { limit } }
  )
  return requireServerSuccess(res.data)?.data?.items ?? []
}
