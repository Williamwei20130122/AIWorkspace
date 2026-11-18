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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { formatPoints } from '@/lib/format'

import {
  addSmallClassMembers,
  batchCreateStudents,
  batchSetStudentPoints,
  batchTransferStudents,
  cleanupGraduatedSmallClass,
  deleteClass,
  deleteSmallClass,
  deleteStudent,
  downloadClassTemplate,
  downloadClubImportTemplate,
  exportClassRoster,
  fetchClasses,
  fetchNamePinyin,
  fetchSections,
  fetchSmallClasses,
  fetchSmallClassMembers,
  fetchStatsOverview,
  fetchStudents,
  fetchTeachers,
  fetchUsers,
  importClasses,
  importSmallClassParentStudents,
  importSmallClassStudents,
  downloadSmallClassAccounts,
  removeSmallClassMember,
  removeSmallClassMembers,
  resetStudentPassword,
  saveClass,
  saveSmallClass,
  saveStudent,
  setSmallClassAI,
  setSmallClassHtml,
  setSmallClassSlide,
  setStudentPoints,
  transferWorkspaceStudent,
  updateStudentAccount,
  type BatchCreateStudentRow,
} from '../api'
import {
  Badge,
  Button,
  Field,
  Modal,
  PageShell,
  Panel,
  Select,
  Switch,
  Table,
  Td,
  TextArea,
  TextInput,
} from '../components/kit'
import type {
  AiHubClass,
  AiHubSection,
  AiHubSmallClass,
  AiHubSmallClassImportResult,
  AiHubStudent,
} from '../types'

type PointsMode = 'clear' | 'set'

// parseRosterText 解析「姓名,姓名拼音」多行文本，兼容逗号 / 空格 / 制表符 / 中文逗号。
// 学号由系统按「年级代码 + 届 + 顺位」自动生成，学生可直接用姓名全拼登录。
function parseRosterText(text: string): BatchCreateStudentRow[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\s\t\uFF0C]+/).filter(Boolean)
      const displayName = parts[0] ?? ''
      const pinyin = parts[1] ?? ''
      return {
        student_no: '',
        display_name: displayName,
        pinyin_username: /^[a-zA-Z]+$/.test(pinyin) ? pinyin.toLowerCase() : '',
      }
    })
    .filter((row) => row.display_name)
}

export function ClassesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState<Partial<AiHubClass> | null>(null)
  const [viewClassId, setViewClassId] = useState(0)
  const [addingStudent, setAddingStudent] = useState(false)
  const [studentDraft, setStudentDraft] = useState({
    user_id: '',
    student_no: '',
    pinyin_username: '',
    display_name: '',
  })
  const [busy, setBusy] = useState(false)
  const [profileTarget, setProfileTarget] = useState<AiHubStudent | null>(null)
  const [profileDraft, setProfileDraft] = useState({
    student_no: '',
    display_name: '',
    pinyin_username: '',
    small_class_ids: [] as number[],
  })

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchPassword, setBatchPassword] = useState('')

  const [pointsTarget, setPointsTarget] = useState<AiHubStudent | null>(null)
  const [pointsMode, setPointsMode] = useState<PointsMode>('set')
  const [pointsValue, setPointsValue] = useState('')

  const [batchPointsOpen, setBatchPointsOpen] = useState(false)
  const [batchPointsMode, setBatchPointsMode] = useState<PointsMode>('set')
  const [batchPointsValue, setBatchPointsValue] = useState('')

  const [classPointsOpen, setClassPointsOpen] = useState(false)
  const [classPointsMode, setClassPointsMode] = useState<PointsMode>('set')
  const [classPointsValue, setClassPointsValue] = useState('')

  const [transferTarget, setTransferTarget] = useState<AiHubStudent | null>(
    null
  )
  const [transferClassId, setTransferClassId] = useState('')
  const [transferReason, setTransferReason] = useState('')

  // 批量转班：勾选多名学生统一转入目标班，正课小班归属自动清理、社团保留。
  const [batchTransferOpen, setBatchTransferOpen] = useState(false)
  const [batchTransferClassId, setBatchTransferClassId] = useState('')
  const [batchTransferReason, setBatchTransferReason] = useState('')

  const [passwordTarget, setPasswordTarget] = useState<AiHubStudent | null>(
    null
  )
  const [passwordValue, setPasswordValue] = useState('')
  // pinyinHint 同班拼音冲突提示：由教师决定修改拼音还是放弃保存。
  const [pinyinHint, setPinyinHint] = useState('')

  const [sectionFilter, setSectionFilter] = useState('')

  const importInputRef = useRef<HTMLInputElement | null>(null)

  // ---------- 上课小班 Tab 状态 ----------
  const [manageTab, setManageTab] = useState<'classes' | 'small'>('classes')
  const [smallParentFilter, setSmallParentFilter] = useState('')
  // smallMineOnly 只看当前登录教师授课的小班（教师端自助维护名单）。
  const [smallMineOnly, setSmallMineOnly] = useState(false)
  const [smallEditing, setSmallEditing] =
    useState<Partial<AiHubSmallClass> | null>(null)
  // smallMemberId > 0 时打开小班详情弹窗（成员名单 + 点数分发 + 账户 Excel 导出）
  const [smallMemberId, setSmallMemberId] = useState(0)
  // 社团按届清退的二次确认弹窗。
  const [cleanupOpen, setCleanupOpen] = useState(false)
  // 小班内分发点数：默认对全部成员，勾选后只对所选成员生效。
  const [smallPointsOpen, setSmallPointsOpen] = useState(false)
  const [smallPointsMode, setSmallPointsMode] = useState<PointsMode>('set')
  const [smallPointsValue, setSmallPointsValue] = useState('')
  // 小班导入：目标小班 + 解析结果 + 未匹配行手动配对选择
  const [smallImportTarget, setSmallImportTarget] =
    useState<AiHubSmallClass | null>(null)
  const [smallImportResult, setSmallImportResult] =
    useState<AiHubSmallClassImportResult | null>(null)
  const [pairChoices, setPairChoices] = useState<Record<string, number>>({})
  const smallImportInputRef = useRef<HTMLInputElement | null>(null)
  // 成员管理弹窗的勾选状态（批量移出用）。
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([])
  // 社团选人弹窗：从系统内搜索已有学生并勾选入团。
  const [clubPickerFor, setClubPickerFor] = useState<AiHubSmallClass | null>(
    null
  )
  const [clubSearchKeyword, setClubSearchKeyword] = useState('')
  const [clubSearchText, setClubSearchText] = useState('')
  const [clubSelectedIds, setClubSelectedIds] = useState<number[]>([])
  // Excel 导入失败清单：全量展示在弹窗里，替代只能看前 3 条的 toast。
  const [importFailures, setImportFailures] = useState<
    { row: string; reason: string }[] | null
  >(null)

  const classesQuery = useQuery({
    queryKey: ['ai-hub', 'classes'],
    queryFn: fetchClasses,
  })
  const sectionsQuery = useQuery({
    queryKey: ['ai-hub', 'sections'],
    queryFn: fetchSections,
  })
  const usersQuery = useQuery({
    queryKey: ['ai-hub', 'users'],
    queryFn: fetchUsers,
  })
  const teachersQuery = useQuery({
    queryKey: ['ai-hub', 'teachers'],
    queryFn: fetchTeachers,
  })
  const studentsQuery = useQuery({
    queryKey: ['ai-hub', 'students', viewClassId],
    queryFn: () => fetchStudents(viewClassId),
    enabled: viewClassId > 0,
  })
  const smallClassesQuery = useQuery({
    // mine=1（只看我授课的小班）只在小班 Tab 生效；学生档案弹窗复用时
    // 不带 mine，避免教师在档案里看不到其他小班。
    queryKey: [
      'ai-hub',
      'small-classes',
      smallParentFilter,
      manageTab === 'small' ? smallMineOnly : false,
    ],
    queryFn: () =>
      fetchSmallClasses({
        parent_class_id: smallParentFilter
          ? Number(smallParentFilter)
          : undefined,
        mine: manageTab === 'small' && smallMineOnly ? 1 : undefined,
      }),
    // 编辑学生资料时也要选小班归属，故弹窗打开时一并加载。
    enabled: manageTab === 'small' || !!profileTarget,
  })
  const smallMembersQuery = useQuery({
    queryKey: ['ai-hub', 'small-class-members', smallMemberId],
    queryFn: () => fetchSmallClassMembers(smallMemberId),
    enabled: smallMemberId > 0,
  })
  // 统计概览：班级 Tab 主视图顶部的学部 / 年级汇总卡片。
  const statsQuery = useQuery({
    queryKey: ['ai-hub', 'stats-overview'],
    queryFn: fetchStatsOverview,
    enabled: viewClassId === 0 && manageTab === 'classes',
  })
  // 社团选人：优先按搜索关键词检索学生，无关键词时给出候选名单供挑选。
  const clubPickerQuery = useQuery({
    queryKey: ['ai-hub', 'club-student-search', clubSearchKeyword],
    queryFn: () => fetchStudents(undefined, clubSearchKeyword || undefined),
    enabled: clubPickerFor !== null,
  })

  const classes = classesQuery.data ?? []
  const sections = sectionsQuery.data ?? []
  const users = usersQuery.data ?? []
  const teachers = teachersQuery.data ?? []
  const allStudents = useMemo(
    () => studentsQuery.data ?? [],
    [studentsQuery.data]
  )

  const visibleClasses = useMemo(
    () =>
      classes.filter((item) => {
        if (sectionFilter && item.section_id !== Number(sectionFilter)) {
          return false
        }
        return true
      }),
    [classes, sectionFilter]
  )

  const students = allStudents
  const currentClass = classes.find((item) => item.id === viewClassId)
  const allSelected =
    students.length > 0 && selectedIds.length === students.length
  const batchRows = useMemo(() => parseRosterText(batchText), [batchText])

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'classes'] })
    await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'students'] })
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'small-classes'],
    })
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'small-class-members'],
    })
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'stats-overview'],
    })
  }

  // ---------- 上课小班处理函数 ----------

  const handleSaveSmallClass = async () => {
    if (!smallEditing) return
    if (!(smallEditing.name ?? '').trim()) {
      toast.error(t('小班名称不能为空'))
      return
    }
    const type = smallEditing.type === 'elective' ? 'elective' : 'regular'
    if (
      type === 'regular' &&
      (smallEditing.parent_class_ids ?? []).length !== 1
    ) {
      toast.error(
        t('正课小班必须且只能选择 1 个所属行政大班（同年级同行政班内部拆分）')
      )
      return
    }
    if (type === 'elective' && !(smallEditing.section_id ?? 0)) {
      toast.error(t('社团小班必须选择归属学部'))
      return
    }
    setBusy(true)
    try {
      await saveSmallClass(smallEditing)
      await refresh()
      toast.success(t('小班已保存'))
      setSmallEditing(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleToggleSmallAI 一键开关小班 AI 权限，立即刷新列表反馈。
  const handleToggleSmallAI = async (item: AiHubSmallClass, next: boolean) => {
    setBusy(true)
    try {
      await setSmallClassAI(item.id, next)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      toast.success(
        next
          ? t('已开启「{{name}}」全部 AI 能力', { name: item.name })
          : t('已关闭「{{name}}」全部 AI 能力', { name: item.name })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleToggleSmallHtml 一键开关小班 HTML 实验室权限。
  const handleToggleSmallHtml = async (
    item: AiHubSmallClass,
    next: boolean
  ) => {
    setBusy(true)
    try {
      await setSmallClassHtml(item.id, next)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      toast.success(
        next
          ? t('已开启「{{name}}」HTML 实验室', { name: item.name })
          : t('已关闭「{{name}}」HTML 实验室', { name: item.name })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleToggleSmallSlide 一键开关小班演示实验室权限。
  const handleToggleSmallSlide = async (
    item: AiHubSmallClass,
    next: boolean
  ) => {
    setBusy(true)
    try {
      await setSmallClassSlide(item.id, next)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      toast.success(
        next
          ? t('已开启「{{name}}」演示实验室', { name: item.name })
          : t('已关闭「{{name}}」演示实验室', { name: item.name })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSmallClass = async (item: AiHubSmallClass) => {
    setBusy(true)
    try {
      await deleteSmallClass(item.id)
      await refresh()
      toast.success(t('小班已删除'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('删除失败'))
    } finally {
      setBusy(false)
    }
  }

  // ---------- 社团选人（系统内搜索已有学生） ----------
  const openClubPicker = (item: AiHubSmallClass) => {
    setClubPickerFor(item)
    setClubSearchKeyword('')
    setClubSearchText('')
    setClubSelectedIds([])
  }

  // handleConfirmClubMembers 把勾选的已有学生加入社团小班。
  const handleConfirmClubMembers = async () => {
    if (!clubPickerFor) return
    if (clubSelectedIds.length === 0) {
      toast.error(t('请先勾选要加入社团的学生'))
      return
    }
    setBusy(true)
    try {
      const added = await addSmallClassMembers(
        clubPickerFor.id,
        clubSelectedIds
      )
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      if (smallMemberId === clubPickerFor.id) {
        await queryClient.invalidateQueries({
          queryKey: ['ai-hub', 'small-class-members'],
        })
      }
      toast.success(
        t('已加入 {{name}}：{{added}} 人', {
          name: clubPickerFor.name,
          added,
        })
      )
      setClubPickerFor(null)
      setClubSelectedIds([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('入团失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleSmallImport 上传 Excel 模糊匹配后打开配对弹窗。
  const handleSmallImport = async (file: File) => {
    if (!smallImportTarget) return
    setBusy(true)
    try {
      const result = await importSmallClassStudents(smallImportTarget.id, file)
      setSmallImportResult(result)
      setPairChoices({})
      const summary = t('自动匹配 {{n}} 人', { n: result.matched.length })
      if (result.unmatched.length > 0) {
        toast.warning(
          t('{{summary}}，{{u}} 条未匹配请在弹窗中手动配对', {
            summary,
            u: result.unmatched.length,
          })
        )
      } else {
        toast.success(summary)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导入失败'))
      setSmallImportTarget(null)
    } finally {
      setBusy(false)
    }
  }

  // handleConfirmImport 提交自动匹配 + 手动配对的学生入班。
  const handleConfirmImport = async () => {
    if (!smallImportTarget || !smallImportResult) return
    const ids = [...smallImportResult.matched_student_ids]
    for (const row of smallImportResult.unmatched) {
      const picked = pairChoices[row.row]
      if (picked) ids.push(picked)
    }
    if (ids.length === 0) {
      toast.error(t('没有可入班的学生，请先完成配对'))
      return
    }
    setBusy(true)
    try {
      const added = await addSmallClassMembers(smallImportTarget.id, ids)
      await refresh()
      toast.success(
        t('已加入 {{name}}：{{added}} 人', {
          name: smallImportTarget.name,
          added,
        })
      )
      setSmallImportResult(null)
      setSmallImportTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('入班失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveMember = async (studentId: number) => {
    if (!smallMemberId) return
    setBusy(true)
    try {
      await removeSmallClassMember(smallMemberId, studentId)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-class-members'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      toast.success(t('已移出小班'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleBatchRemoveMembers 成员管理里勾选后批量移出，免去逐个点击。
  const handleBatchRemoveMembers = async () => {
    if (!smallMemberId || selectedMemberIds.length === 0) return
    setBusy(true)
    try {
      const removed = await removeSmallClassMembers(
        smallMemberId,
        selectedMemberIds
      )
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-class-members'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      setSelectedMemberIds([])
      toast.success(t('已移出 {{n}} 人', { n: removed }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleImportParentStudents 把小班所属行政班的在读学生一键拉入小班。
  const handleImportParentStudents = async () => {
    if (!smallMemberId) return
    setBusy(true)
    try {
      const result = await importSmallClassParentStudents(smallMemberId)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-class-members'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      if (result.total === 0) {
        toast.warning(t('所属行政班暂无在读学生'))
      } else {
        toast.success(
          t(
            '已从行政班拉入 {{added}} 人（行政班在读 {{total}} 人，已在班内的自动跳过）',
            {
              added: result.added,
              total: result.total,
            }
          )
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleSmallPoints 在小班内分发点数：未勾选成员时作用于全班，勾选后只对所选成员生效。
  const handleSmallPoints = async () => {
    if (!smallMemberId) return
    if (smallPointsMode === 'set' && !smallPointsValue.trim()) {
      toast.error(t('请输入点数'))
      return
    }
    // 未勾选任何成员 = 全班分发，用全班成员 id 明确圈定范围。
    const targetIds =
      selectedMemberIds.length > 0
        ? selectedMemberIds
        : (smallMembersQuery.data ?? []).map((s) => s.id)
    if (targetIds.length === 0) {
      toast.error(t('该小班暂无成员'))
      return
    }
    setBusy(true)
    try {
      const result = await batchSetStudentPoints({
        studentIds: targetIds,
        mode: smallPointsMode,
        value: smallPointsMode === 'set' ? Number(smallPointsValue) : 0,
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-class-members'],
      })
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'students'] })
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'classes'] })
      toast.success(t('已更新 {{applied}} 人点数', { applied: result.applied }))
      setSmallPointsOpen(false)
      setSmallPointsValue('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleDownloadSmallAccounts 导出小班学生账户信息 Excel，供学生核对自己的账户。
  const handleDownloadSmallAccounts = async () => {
    if (!smallMemberId) return
    setBusy(true)
    try {
      await downloadSmallClassAccounts(smallMemberId)
      toast.success(t('账户信息 Excel 已开始下载'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('下载失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleImportExcel = async (file: File) => {
    setBusy(true)
    try {
      const result = await importClasses(file, '123456')
      await refresh()
      const summary = t(
        '新建班级 {{classes}} 个、更新 {{updated}} 个、学生 {{students}} 人',
        {
          classes: result.classes_created,
          updated: result.classes_updated,
          students: result.students_created,
        }
      )
      const smallCreated = result.small_classes_created ?? 0
      const smallUpdated = result.small_classes_updated ?? 0
      const smallMembers = result.small_members_added ?? 0
      const summaryWithSmall =
        smallCreated > 0 || smallUpdated > 0 || smallMembers > 0
          ? t(
              '{{summary}}；小班新建 {{smallCreated}} 个、更新 {{smallUpdated}} 个、入班 {{smallMembers}} 人',
              {
                summary,
                smallCreated,
                smallUpdated,
                smallMembers,
              }
            )
          : summary
      const skipped = result.students_skipped ?? 0
      const summaryWithSkipped =
        skipped > 0
          ? t('{{summary}}，跳过同名学生 {{skipped}} 人', {
              summary: summaryWithSmall,
              skipped,
            })
          : summaryWithSmall
      if (result.failed.length > 0) {
        setImportFailures(result.failed)
        toast.warning(
          t('导入完成：{{summary}}，{{failed}} 条失败（点击查看全部）', {
            summary: summaryWithSkipped,
            failed: result.failed.length,
          })
        )
      } else {
        toast.success(
          t('导入完成：{{summary}}', { summary: summaryWithSkipped })
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导入失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleSaveClass = async () => {
    if (!editing) return
    if (!(editing.name ?? '').trim()) {
      toast.error(t('班级名称不能为空'))
      return
    }
    setBusy(true)
    try {
      await saveClass(editing)
      await refresh()
      toast.success(t('班级已保存'))
      setEditing(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('保存失败')
      // 同班拼音重复时留在弹窗内提示，教师可直接修改拼音后重新保存。
      if (message.includes('拼音')) {
        setPinyinHint(message)
        return
      }
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleAutoPinyin = async () => {
    const name = profileDraft.display_name.trim()
    if (!name) {
      toast.error(t('请先填写姓名'))
      return
    }
    try {
      const pinyin = await fetchNamePinyin(name)
      if (!pinyin) {
        toast.error(t('无法转换拼音，请手动填写'))
        return
      }
      setProfileDraft((prev) => ({ ...prev, pinyin_username: pinyin }))
      setPinyinHint('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    }
  }

  const handleAutoPinyinForNew = async () => {
    const name = studentDraft.display_name.trim()
    if (!name) {
      toast.error(t('请先填写姓名'))
      return
    }
    try {
      const pinyin = await fetchNamePinyin(name)
      if (!pinyin) {
        toast.error(t('无法转换拼音，请手动填写'))
        return
      }
      setStudentDraft((prev) => ({ ...prev, pinyin_username: pinyin }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    }
  }

  const handleResetToPasswordless = async () => {
    if (!passwordTarget) return
    setBusy(true)
    try {
      await resetStudentPassword({
        studentId: passwordTarget.id,
        userId: passwordTarget.user_id,
      })
      toast.success(t('已恢复免密登录'))
      setPasswordTarget(null)
      setPasswordValue('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleSaveProfile = async () => {
    if (!profileTarget) return
    setBusy(true)
    try {
      await saveStudent({
        id: profileTarget.id,
        user_id: profileTarget.user_id,
        class_id: profileTarget.class_id,
        entry_year: profileTarget.entry_year,
        status: profileTarget.status,
        enabled: profileTarget.enabled,
        student_no: profileDraft.student_no.trim(),
        pinyin_username: profileDraft.pinyin_username.trim().toLowerCase(),
        display_name: profileDraft.display_name.trim(),
        small_class_ids: profileDraft.small_class_ids,
      })
      await refresh()
      toast.success(t('学生资料已更新'))
      setProfileTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddStudent = async () => {
    if (!studentDraft.user_id) {
      toast.error(t('请选择关联账号'))
      return
    }
    setBusy(true)
    try {
      await saveStudent({
        user_id: Number(studentDraft.user_id),
        class_id: viewClassId,
        student_no: studentDraft.student_no.trim(),
        pinyin_username: studentDraft.pinyin_username.trim(),
        display_name: studentDraft.display_name.trim(),
      })
      await refresh()
      toast.success(t('学生已加入班级'))
      setAddingStudent(false)
      setPinyinHint('')
      setStudentDraft({
        user_id: '',
        student_no: '',
        pinyin_username: '',
        display_name: '',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('添加失败')
      // 同班拼音重复时留在弹窗内提示，教师可修改拼音后重新提交。
      if (message.includes('拼音')) {
        setPinyinHint(message)
        return
      }
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleBatchCreate = async () => {
    if (batchRows.length === 0) {
      toast.error(t('请至少填写一名学生'))
      return
    }
    if (batchPassword.trim().length < 6) {
      toast.error(t('默认密码长度至少 6 位'))
      return
    }
    setBusy(true)
    try {
      const result = await batchCreateStudents(
        viewClassId,
        batchRows,
        batchPassword.trim()
      )
      await refresh()
      setBatchCreating(false)
      setBatchText('')
      if (result.failed.length > 0) {
        toast.warning(
          t('已创建 {{created}} 人，{{failed}} 人失败：{{detail}}', {
            created: result.created_count,
            failed: result.failed.length,
            detail: result.failed
              .slice(0, 3)
              .map(
                (item, index) =>
                  `${item.student_no || t('第 {{row}} 行', { row: index + 1 })}（${item.reason}）`
              )
              .join('、'),
          })
        )
      } else {
        toast.success(
          t('已创建 {{count}} 名学生账号', { count: result.created_count })
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('批量创建失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleClassPoints = async () => {
    if (classPointsMode === 'set') {
      const parsed = Number(classPointsValue)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('请输入有效的点数'))
        return
      }
    }
    setBusy(true)
    try {
      const result = await batchSetStudentPoints({
        classId: viewClassId,
        mode: classPointsMode,
        value: classPointsMode === 'set' ? Number(classPointsValue) : 0,
      })
      await refresh()
      setClassPointsOpen(false)
      setClassPointsValue('')
      toast.success(
        t('已为全班 {{applied}} 名学生下发点数', { applied: result.applied })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleSetPoints = async () => {
    if (!pointsTarget) return
    if (pointsMode === 'set') {
      const parsed = Number(pointsValue)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('请输入有效的点数'))
        return
      }
    }
    setBusy(true)
    try {
      const result = await setStudentPoints({
        studentId: pointsTarget.id,
        mode: pointsMode,
        value: pointsMode === 'set' ? Number(pointsValue) : 0,
      })
      await refresh()
      toast.success(
        t('{{name}} 的点数已更新为 {{points}} 点', {
          name: pointsTarget.display_name || pointsTarget.username,
          points: result.points,
        })
      )
      setPointsTarget(null)
      setPointsValue('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleBatchPoints = async () => {
    if (selectedIds.length === 0) return
    if (batchPointsMode === 'set') {
      const parsed = Number(batchPointsValue)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('请输入有效的点数'))
        return
      }
    }
    setBusy(true)
    try {
      const result = await batchSetStudentPoints({
        studentIds: selectedIds,
        mode: batchPointsMode,
        value: batchPointsMode === 'set' ? Number(batchPointsValue) : 0,
      })
      await refresh()
      setBatchPointsOpen(false)
      setBatchPointsValue('')
      setSelectedIds([])
      toast.success(
        t('已批量调整 {{applied}} 名学生的点数', { applied: result.applied })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleTransfer = async () => {
    if (!transferTarget) return
    const classId = Number(transferClassId)
    if (!classId) {
      toast.error(t('请选择目标班级'))
      return
    }
    setBusy(true)
    try {
      await transferWorkspaceStudent({
        studentId: transferTarget.id,
        toClassId: classId,
        reason: transferReason.trim(),
      })
      await refresh()
      toast.success(t('已完成转班'))
      setTransferTarget(null)
      setTransferClassId('')
      setTransferReason('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleExportRoster 导出名单为与导入模板同格式的 Excel，可核对后回传。
  const handleExportRoster = async (params: {
    section_id?: number
    entry_year?: number
    class_id?: number
    small_class_id?: number
  }) => {
    setBusy(true)
    try {
      await exportClassRoster(params)
      toast.success(t('名单已导出'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导出失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleBatchTransfer 批量转班：正课小班归属自动清理、社团保留。
  const handleBatchTransfer = async () => {
    const classId = Number(batchTransferClassId)
    if (!classId) {
      toast.error(t('请选择目标班级'))
      return
    }
    setBusy(true)
    try {
      const result = await batchTransferStudents({
        studentIds: selectedIds,
        toClassId: classId,
        reason: batchTransferReason.trim(),
      })
      await refresh()
      setBatchTransferOpen(false)
      setBatchTransferClassId('')
      setBatchTransferReason('')
      setSelectedIds([])
      toast.success(
        t(
          '已转班 {{transferred}} 人（跳过 {{skipped}} 人），清理原班小班归属 {{cleaned}} 条',
          {
            transferred: result.transferred,
            skipped: result.skipped,
            cleaned: result.cleaned,
          }
        )
      )
      if (result.failures.length > 0) {
        toast.warning(
          t('{{n}} 人转班失败：{{reason}}', {
            n: result.failures.length,
            reason: result.failures[0]?.reason ?? '',
          })
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  // handleCleanupGraduated 社团按届清退：移出毕业届 / 已离校的成员。
  const handleCleanupGraduated = async () => {
    if (!smallMemberId) return
    setBusy(true)
    try {
      const result = await cleanupGraduatedSmallClass(smallMemberId)
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-class-members'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'small-classes'],
      })
      setCleanupOpen(false)
      if (result.removed === 0) {
        toast.info(
          t('没有需要清退的成员（已检查 {{n}} 人）', { n: result.checked })
        )
      } else {
        toast.success(
          t('已清退 {{removed}} 名毕业 / 离校成员（共检查 {{checked}} 人）', {
            removed: result.removed,
            checked: result.checked,
          })
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleResetPassword = async () => {
    if (!passwordTarget) return
    if (passwordValue.trim().length < 6) {
      toast.error(t('密码长度至少 6 位'))
      return
    }
    setBusy(true)
    try {
      await updateStudentAccount({
        studentId: passwordTarget.id,
        password: passwordValue.trim(),
      })
      toast.success(t('密码已重置'))
      setPasswordTarget(null)
      setPasswordValue('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveStudent = async (student: AiHubStudent) => {
    setBusy(true)
    try {
      await deleteStudent(student.id)
      await refresh()
      toast.success(t('已移除'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const pointsTargetLabel = pointsTarget
    ? pointsTarget.display_name || pointsTarget.username
    : ''

  const courseLabel = (mode: PointsMode) => {
    if (mode === 'clear') return t('清零')
    return t('修改为指定点数')
  }

  if (viewClassId > 0) {
    return (
      <PageShell
        title={`${currentClass?.name ?? t('班级')} · ${t('班级详情')}`}
        description={
          currentClass?.description ||
          t('可查看名单、批量新建账号、批量分发点数、转班与编辑班级。')
        }
        actions={
          <div className='flex gap-2'>
            <Button onClick={() => setViewClassId(0)}>
              {t('返回班级列表')}
            </Button>
            {currentClass && (
              <Button
                variant='primary'
                onClick={() => setEditing(currentClass)}
              >
                {t('编辑班级')}
              </Button>
            )}
          </div>
        }
      >
        <Panel title={t('班级信息')}>
          <div className='flex flex-wrap items-center gap-x-8 gap-y-3 text-[13px]'>
            <div>
              <span className='text-muted-foreground'>{t('学部')}：</span>
              <span className='text-foreground font-medium'>
                {currentClass?.section_name || t('未设置')}
              </span>
            </div>
            <div>
              <span className='text-muted-foreground'>{t('年级')}：</span>
              <span className='text-foreground font-medium'>
                {currentClass?.grade_name || t('未设置')}
                {currentClass?.graduated && (
                  <Badge tone='muted'>
                    <span className='ml-1'>{t('已毕业')}</span>
                  </Badge>
                )}
              </span>
            </div>
            <div>
              <span className='text-muted-foreground'>{t('届别')}：</span>
              <span className='text-foreground font-medium'>
                {currentClass?.entry_year
                  ? `${currentClass.entry_year}届`
                  : t('未设置')}
              </span>
            </div>
            <div>
              <span className='text-muted-foreground'>{t('学生数')}：</span>
              <span className='text-foreground font-medium tabular-nums'>
                {allStudents.length}
              </span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='text-muted-foreground'>{t('状态')}：</span>
              <Badge tone={currentClass?.enabled ? 'success' : 'muted'}>
                {currentClass?.enabled ? t('启用') : t('停用')}
              </Badge>
            </div>
            <div className='ml-auto flex flex-wrap gap-2'>
              <Button
                disabled={busy}
                onClick={() =>
                  void handleExportRoster({ class_id: viewClassId })
                }
              >
                {t('导出名单')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => {
                  setClassPointsMode('set')
                  setClassPointsValue('')
                  setClassPointsOpen(true)
                }}
              >
                {t('全班一键下发点数')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setPinyinHint('')
                  setAddingStudent(true)
                }}
              >
                {t('添加已有账号')}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          bodyClassName='p-0'
          title={t('学生名单')}
          description={
            selectedIds.length > 0
              ? t('已选中 {{count}} 名学生', { count: selectedIds.length })
              : t('勾选学生后可批量分发点数。')
          }
          actions={
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                disabled={students.length === 0}
                onClick={() =>
                  setSelectedIds(
                    allSelected ? [] : students.map((item) => item.id)
                  )
                }
              >
                {allSelected ? t('取消全选') : t('全选')}
              </Button>
              <Button
                variant='primary'
                disabled={busy || selectedIds.length === 0}
                onClick={() => {
                  setBatchPointsMode('set')
                  setBatchPointsValue('')
                  setBatchPointsOpen(true)
                }}
              >
                {t('批量分发点数')}
              </Button>
              <Button
                variant='primary'
                disabled={busy || selectedIds.length === 0}
                onClick={() => {
                  setBatchTransferClassId('')
                  setBatchTransferReason('')
                  setBatchTransferOpen(true)
                }}
              >
                {t('批量转班')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => {
                  setBatchPassword('')
                  setBatchText('')
                  setBatchCreating(true)
                }}
              >
                {t('批量新建学生账号')}
              </Button>
            </div>
          }
        >
          <Table
            headers={[
              '',
              t('学号'),
              t('姓名'),
              t('姓名拼音'),
              t('所属小班'),
              t('关联账号'),
              t('剩余点数'),
              t('已用点数'),
              t('状态'),
              t('操作'),
            ]}
            isEmpty={!studentsQuery.isLoading && students.length === 0}
            empty={
              studentsQuery.isLoading ? t('正在加载…') : t('该班级还没有学生')
            }
          >
            {students.map((student: AiHubStudent) => (
              <tr key={student.id} className='border-border/60 border-b'>
                <Td className='w-8'>
                  <input
                    type='checkbox'
                    checked={selectedIds.includes(student.id)}
                    onChange={() => toggleSelect(student.id)}
                  />
                </Td>
                <Td>{student.student_no || '-'}</Td>
                <Td>{student.display_name || '-'}</Td>
                <Td>{student.pinyin_username || '-'}</Td>
                <Td>
                  {(student.small_class_names ?? []).length > 0
                    ? (student.small_class_names ?? []).join('、')
                    : '-'}
                </Td>
                <Td>{student.username || student.user_id}</Td>
                <Td className='tabular-nums'>
                  {formatPoints(student.quota ?? 0)}
                </Td>
                <Td className='tabular-nums'>
                  {formatPoints(student.used_quota ?? 0)}
                </Td>
                <Td>
                  {student.status === 3 ? (
                    <Badge tone='muted'>{t('已注销')}</Badge>
                  ) : student.status === 2 ? (
                    <Badge tone='muted'>{t('已毕业')}</Badge>
                  ) : (
                    <Badge tone={student.enabled ? 'success' : 'muted'}>
                      {student.enabled ? t('启用') : t('停用')}
                    </Badge>
                  )}
                </Td>
                <Td className='whitespace-nowrap'>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setProfileTarget(student)
                        setProfileDraft({
                          student_no: student.student_no || '',
                          display_name: student.display_name || '',
                          pinyin_username: student.pinyin_username || '',
                          small_class_ids: [...(student.small_class_ids ?? [])],
                        })
                      }}
                    >
                      {t('编辑资料')}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setPointsTarget(student)
                        setPointsMode('set')
                        setPointsValue(String(student.quota ?? 0))
                      }}
                    >
                      {t('修改点数')}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setPasswordTarget(student)
                        setPasswordValue('')
                      }}
                    >
                      {t('重置密码')}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setTransferTarget(student)
                        setTransferClassId('')
                        setTransferReason('')
                      }}
                    >
                      {t('转班')}
                    </Button>
                    <Button
                      variant='danger'
                      disabled={busy}
                      onClick={() => void handleRemoveStudent(student)}
                    >
                      {t('移除')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Modal
          open={batchCreating}
          title={t('批量新建学生账号')}
          onClose={() => setBatchCreating(false)}
          footer={
            <>
              <Button onClick={() => setBatchCreating(false)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy || batchRows.length === 0}
                onClick={() => void handleBatchCreate()}
              >
                {t('创建 {{count}} 个账号', { count: batchRows.length })}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('学生清单（每行一个：姓名,姓名拼音）')}>
              <TextArea
                value={batchText}
                onChange={(value) => setBatchText(value)}
              />
            </Field>
            <Field label={t('默认密码（至少 6 位，可被单行覆盖）')}>
              <TextInput
                value={batchPassword}
                onChange={(value) => setBatchPassword(value)}
              />
            </Field>
            <p className='text-muted-foreground text-xs'>
              {t(
                '将自动创建登录账号（账号名为学号）并加入当前班级；已存在的账号会跳过并提示原因。'
              )}
            </p>
          </div>
        </Modal>

        <Modal
          open={batchPointsOpen}
          title={t('批量分发点数 · 已选 {{count}} 人', {
            count: selectedIds.length,
          })}
          onClose={() => setBatchPointsOpen(false)}
          footer={
            <>
              <Button onClick={() => setBatchPointsOpen(false)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleBatchPoints()}
              >
                {t('确定')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('调整方式')}>
              <Select
                value={batchPointsMode}
                options={[
                  { label: courseLabel('set'), value: 'set' },
                  { label: courseLabel('clear'), value: 'clear' },
                ]}
                onChange={(value) => setBatchPointsMode(value as PointsMode)}
              />
            </Field>
            {batchPointsMode === 'set' && (
              <Field label={t('点数')}>
                <TextInput
                  value={batchPointsValue}
                  onChange={(value) => setBatchPointsValue(value)}
                />
              </Field>
            )}
          </div>
        </Modal>

        <Modal
          open={classPointsOpen}
          title={`${t('全班一键下发点数')} · ${currentClass?.name ?? ''}`}
          onClose={() => setClassPointsOpen(false)}
          footer={
            <>
              <Button onClick={() => setClassPointsOpen(false)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleClassPoints()}
              >
                {t('确定')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('调整方式')}>
              <Select
                value={classPointsMode}
                options={[
                  { label: courseLabel('set'), value: 'set' },
                  { label: courseLabel('clear'), value: 'clear' },
                ]}
                onChange={(value) => setClassPointsMode(value as PointsMode)}
              />
            </Field>
            {classPointsMode === 'set' && (
              <Field label={t('每人点数')}>
                <TextInput
                  value={classPointsValue}
                  onChange={(value) => setClassPointsValue(value)}
                />
              </Field>
            )}
          </div>
        </Modal>

        <Modal
          open={pointsTarget !== null}
          title={`${t('调整点数')} · ${pointsTargetLabel}`}
          onClose={() => setPointsTarget(null)}
          footer={
            <>
              <Button onClick={() => setPointsTarget(null)}>{t('取消')}</Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleSetPoints()}
              >
                {t('确定')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('调整方式')}>
              <Select
                value={pointsMode}
                options={[
                  { label: courseLabel('clear'), value: 'clear' },
                  { label: courseLabel('set'), value: 'set' },
                ]}
                onChange={(value) => setPointsMode(value as PointsMode)}
              />
            </Field>
            {pointsMode === 'set' && (
              <Field label={t('点数')}>
                <TextInput
                  value={pointsValue}
                  onChange={(value) => setPointsValue(value)}
                />
              </Field>
            )}
          </div>
        </Modal>

        <Modal
          open={transferTarget !== null}
          title={`${t('转班')} · ${transferTarget?.display_name || transferTarget?.username || ''}`}
          onClose={() => setTransferTarget(null)}
          footer={
            <>
              <Button onClick={() => setTransferTarget(null)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleTransfer()}
              >
                {t('确定')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('目标班级（可跨年级，用于留级/转年级）')}>
              <Select
                value={transferClassId}
                options={[
                  { label: t('请选择班级'), value: '' },
                  ...classes
                    .filter((item) => item.id !== viewClassId)
                    .map((item) => ({
                      label: `${item.name}${
                        item.grade_name ? `（${item.grade_name}）` : ''
                      }`,
                      value: String(item.id),
                    })),
                ]}
                onChange={(value) => setTransferClassId(value)}
              />
            </Field>
            <Field label={t('事由（可选，例如：留级、转入）')}>
              <TextInput
                value={transferReason}
                onChange={(value) => setTransferReason(value)}
              />
            </Field>
          </div>
        </Modal>

        <Modal
          open={batchTransferOpen}
          title={`${t('批量转班')} · ${t('已选 {{count}} 人', { count: selectedIds.length })}`}
          onClose={() => setBatchTransferOpen(false)}
          footer={
            <>
              <Button onClick={() => setBatchTransferOpen(false)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleBatchTransfer()}
              >
                {t('确定')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('目标班级（可跨年级，用于升学/转年级）')}>
              <Select
                value={batchTransferClassId}
                options={[
                  { label: t('请选择班级'), value: '' },
                  ...classes
                    .filter((item) => item.id !== viewClassId)
                    .map((item) => ({
                      label: `${item.name}${
                        item.grade_name ? `（${item.grade_name}）` : ''
                      }`,
                      value: String(item.id),
                    })),
                ]}
                onChange={(value) => setBatchTransferClassId(value)}
              />
            </Field>
            <Field label={t('事由（可选，例如：升学、转班）')}>
              <TextInput
                value={batchTransferReason}
                onChange={(value) => setBatchTransferReason(value)}
              />
            </Field>
            <p className='text-muted-foreground text-xs'>
              {t(
                '正课小班归属随班自动清理（目标班不存在的小班将移出），社团小班保留。'
              )}
            </p>
          </div>
        </Modal>

        <Modal
          open={addingStudent}
          title={`${t('添加已有账号')} · ${currentClass?.name ?? ''}`}
          onClose={() => setAddingStudent(false)}
          footer={
            <>
              <Button onClick={() => setAddingStudent(false)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleAddStudent()}
              >
                {t('添加')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('关联账号')}>
              <Select
                value={studentDraft.user_id}
                options={[
                  { label: t('请选择账号'), value: '' },
                  ...users.map((item) => ({
                    label: `${item.display_name || item.username}（${item.username}）`,
                    value: String(item.id),
                  })),
                ]}
                onChange={(value) =>
                  setStudentDraft((prev) => ({ ...prev, user_id: value }))
                }
              />
            </Field>
            <Field label={t('学号')}>
              <TextInput
                value={studentDraft.student_no}
                onChange={(value) =>
                  setStudentDraft((prev) => ({ ...prev, student_no: value }))
                }
              />
            </Field>
            <Field label={t('姓名')}>
              <TextInput
                value={studentDraft.display_name}
                onChange={(value) =>
                  setStudentDraft((prev) => ({ ...prev, display_name: value }))
                }
              />
            </Field>
            <Field label={t('姓名拼音（全拼，用于登录）')}>
              <div className='flex items-center gap-2'>
                <TextInput
                  className='flex-1'
                  value={studentDraft.pinyin_username}
                  onChange={(value) =>
                    setStudentDraft((prev) => ({
                      ...prev,
                      pinyin_username: value,
                    }))
                  }
                />
                <Button
                  disabled={busy}
                  onClick={() => void handleAutoPinyinForNew()}
                >
                  {t('自动转拼音')}
                </Button>
              </div>
              {pinyinHint ? (
                <p className='text-destructive mt-1 text-xs'>{pinyinHint}</p>
              ) : (
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('同班拼音重复时需修改后再提交。')}
                </p>
              )}
            </Field>
          </div>
        </Modal>

        <Modal
          open={passwordTarget !== null}
          title={`${t('重置密码')} · ${passwordTarget?.display_name || passwordTarget?.username || ''}`}
          onClose={() => setPasswordTarget(null)}
          footer={
            <>
              <Button
                className='mr-auto'
                disabled={busy}
                onClick={() => void handleResetToPasswordless()}
              >
                {t('恢复免密登录')}
              </Button>
              <Button onClick={() => setPasswordTarget(null)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleResetPassword()}
              >
                {t('保存')}
              </Button>
            </>
          }
        >
          <Field label={t('新密码（至少 6 位）')}>
            <TextInput
              value={passwordValue}
              onChange={(value) => setPasswordValue(value)}
            />
          </Field>
        </Modal>

        <Modal
          open={!!profileTarget}
          title={t('编辑学生资料')}
          onClose={() => setProfileTarget(null)}
          footer={
            <>
              <Button onClick={() => setProfileTarget(null)}>
                {t('取消')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleSaveProfile()}
              >
                {t('保存')}
              </Button>
            </>
          }
        >
          <div className='grid gap-3'>
            <Field label={t('学号')}>
              <TextInput
                value={profileDraft.student_no}
                onChange={(value) =>
                  setProfileDraft((prev) => ({ ...prev, student_no: value }))
                }
              />
            </Field>
            <Field label={t('姓名')}>
              <TextInput
                value={profileDraft.display_name}
                onChange={(value) =>
                  setProfileDraft((prev) => ({ ...prev, display_name: value }))
                }
              />
            </Field>
            <Field label={t('姓名拼音（全拼，用于登录）')}>
              <div className='flex items-center gap-2'>
                <TextInput
                  className='flex-1'
                  value={profileDraft.pinyin_username}
                  onChange={(value) => {
                    setProfileDraft((prev) => ({
                      ...prev,
                      pinyin_username: value,
                    }))
                    setPinyinHint('')
                  }}
                />
                <Button disabled={busy} onClick={() => void handleAutoPinyin()}>
                  {t('自动转拼音')}
                </Button>
              </div>
              {pinyinHint ? (
                <p className='text-destructive mt-1 text-xs'>{pinyinHint}</p>
              ) : (
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('同班拼音重复时需修改后再保存。')}
                </p>
              )}
            </Field>
            <Field label={t('所属小班（可多选，留空不入小班）')}>
              <div className='border-border max-h-40 overflow-y-auto rounded-md border p-2'>
                {(smallClassesQuery.data ?? []).length === 0 && (
                  <p className='text-muted-foreground text-sm'>
                    {t('暂无小班')}
                  </p>
                )}
                {(smallClassesQuery.data ?? []).map((item) => (
                  <label
                    key={item.id}
                    className='flex cursor-pointer items-center gap-2 py-1 text-sm'
                  >
                    <Checkbox
                      checked={profileDraft.small_class_ids.includes(item.id)}
                      onCheckedChange={(checked) => {
                        setProfileDraft((prev) => ({
                          ...prev,
                          small_class_ids: checked
                            ? [...prev.small_class_ids, item.id]
                            : prev.small_class_ids.filter(
                                (id) => id !== item.id
                              ),
                        }))
                      }}
                    />
                    <span>
                      {item.code ? `${item.code} · ` : ''}
                      {item.name}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </Modal>

        <ClassEditModal
          editing={editing}
          setEditing={setEditing}
          sections={sections}
          busy={busy}
          onSave={handleSaveClass}
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={t('学生与班级管理')}
      description={
        manageTab === 'classes'
          ? t('点进班级可查看名单、批量新建账号、批量分发点数与转班。')
          : t('从行政大班拆分上课小班，绑定授课教师并一键开关 AI 能力。')
      }
      actions={
        <div className='flex flex-wrap gap-2'>
          <Button disabled={busy} onClick={() => void downloadClassTemplate()}>
            {t('下载导入模板')}
          </Button>
          {manageTab === 'small' && (
            <Button
              disabled={busy}
              onClick={() => void downloadClubImportTemplate()}
            >
              {t('社团导入模板')}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            {t('导入 Excel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void handleExportRoster({
                section_id: sectionFilter ? Number(sectionFilter) : undefined,
              })
            }
          >
            {t('导出名单')}
          </Button>
          {manageTab === 'classes' ? (
            <Button
              variant='primary'
              onClick={() =>
                setEditing({
                  name: '',
                  code: '',
                  description: '',
                  section_id: sections[0]?.id ?? 0,
                  entry_year: 0,
                  enabled: true,
                })
              }
            >
              {t('新建班级')}
            </Button>
          ) : (
            <Button
              variant='primary'
              onClick={() =>
                setSmallEditing({
                  name: '',
                  code: '',
                  parent_class_ids: classes[0]?.id ? [classes[0].id] : [],
                  teacher_ids: teachers[0]?.user_id
                    ? [teachers[0].user_id]
                    : [],
                  type: 'regular',
                  section_id: 0,
                  enabled: true,
                  ai_enabled: true,
                  html_enabled: false,
                  slide_enabled: false,
                })
              }
            >
              {t('新建小班')}
            </Button>
          )}
        </div>
      }
    >
      <div className='border-border mb-3 flex gap-1 border-b'>
        {(
          [
            { key: 'classes', label: t('行政大班') },
            { key: 'small', label: t('上课小班') },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type='button'
            onClick={() => setManageTab(tab.key)}
            className={
              manageTab === tab.key
                ? 'border-primary text-primary border-b-2 px-4 py-2 text-sm font-medium'
                : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent px-4 py-2 text-sm'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {manageTab === 'classes' && statsQuery.data && (
        <div className='mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {statsQuery.data.items.map((section) => (
            <Panel
              key={section.id}
              title={`${section.name} · ${t('统计概览')}`}
            >
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <div>
                  <p className='text-muted-foreground text-xs'>{t('班级数')}</p>
                  <p className='text-xl font-semibold tabular-nums'>
                    {section.class_count}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>{t('学生数')}</p>
                  <p className='text-xl font-semibold tabular-nums'>
                    {section.student_num}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>
                    {t('正课小班数')}
                  </p>
                  <p className='text-xl font-semibold tabular-nums'>
                    {section.regular_small_count}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>
                    {t('社团参与率')}
                  </p>
                  <p className='text-xl font-semibold tabular-nums'>
                    {Math.round(section.club_rate * 100)}%
                  </p>
                </div>
              </div>
              <div className='border-border/60 text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-xs'>
                <span>{t('社团 {{n}} 个', { n: section.club_count })}</span>
                <span>
                  {t('参与 {{n}} 人', { n: section.club_student_count })}
                </span>
                {section.grades.map((grade) => (
                  <span key={grade.grade_index}>
                    {`${grade.grade_name}：${grade.class_count} ${t('班')} · ${grade.student_num} ${t('人')} · ${grade.regular_small_count} ${t('小班')} · ${t('社团')} ${Math.round(grade.club_rate * 100)}%`}
                  </span>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {manageTab === 'classes' && (
        <Panel
          bodyClassName='p-0'
          title={t('班级列表')}
          description={t('按学部筛选班级；点进班级可查看名单并管理点数。')}
          actions={
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                className='w-36'
                value={sectionFilter}
                options={[
                  { label: t('全部学部'), value: '' },
                  ...sections.map((section) => ({
                    label: `${section.name}（${section.code}）`,
                    value: String(section.id),
                  })),
                ]}
                onChange={(value) => setSectionFilter(value)}
              />
            </div>
          }
        >
          <Table
            headers={[
              t('班级编号'),
              t('班级'),
              t('学部'),
              t('年级'),
              t('届别'),
              t('学生数'),
              t('状态'),
              t('操作'),
            ]}
            isEmpty={!classesQuery.isLoading && visibleClasses.length === 0}
            empty={classesQuery.isLoading ? t('正在加载…') : t('暂无班级')}
          >
            {visibleClasses.map((item) => (
              <tr key={item.id} className='border-border/60 border-b'>
                <Td className='whitespace-nowrap tabular-nums'>
                  {item.code || '-'}
                </Td>
                <Td>
                  <button
                    type='button'
                    onClick={() => setViewClassId(item.id)}
                    className='text-primary text-left font-medium hover:underline'
                  >
                    {item.name}
                  </button>
                  {item.description && (
                    <div className='text-muted-foreground text-xs'>
                      {item.description}
                    </div>
                  )}
                </Td>
                <Td className='whitespace-nowrap'>
                  {item.section_name || (
                    <span className='text-muted-foreground text-xs'>
                      {t('未设置')}
                    </span>
                  )}
                </Td>
                <Td className='whitespace-nowrap'>
                  {item.grade_name ? (
                    <span>
                      {item.grade_name}
                      {item.graduated && (
                        <Badge tone='muted'>
                          <span className='ml-1'>{t('已毕业')}</span>
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className='text-muted-foreground text-xs'>
                      {t('未设置')}
                    </span>
                  )}
                </Td>
                <Td className='whitespace-nowrap'>
                  {item.entry_year ? `${item.entry_year}届` : '-'}
                </Td>
                <Td className='tabular-nums'>{item.student_count}</Td>
                <Td>
                  <Badge tone={item.enabled ? 'success' : 'muted'}>
                    {item.enabled ? t('启用') : t('停用')}
                  </Badge>
                </Td>
                <Td className='whitespace-nowrap'>
                  <div className='flex gap-2'>
                    <Button
                      variant='primary'
                      onClick={() => setViewClassId(item.id)}
                    >
                      {t('查看学生')}
                    </Button>
                    <Button onClick={() => setEditing(item)}>
                      {t('编辑')}
                    </Button>
                    <Button
                      variant='danger'
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await deleteClass(item.id)
                          await refresh()
                          toast.success(t('班级已删除'))
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : t('删除失败')
                          )
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      {t('删除')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {manageTab === 'small' && (
        <Panel
          bodyClassName='p-0'
          title={t('上课小班列表')}
          description={t(
            '正课小班仅在同年级同一行政班内部拆分；社团小班归属学部可跨年级组建。AI 开关关闭后学生端隐藏全部 AI 入口。'
          )}
          actions={
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                className='w-44'
                value={smallMineOnly ? 'mine' : ''}
                options={[
                  { label: t('全部小班'), value: '' },
                  { label: t('只看我的小班'), value: 'mine' },
                ]}
                onChange={(value) => setSmallMineOnly(value === 'mine')}
              />
              <Select
                className='w-44'
                value={smallParentFilter}
                options={[
                  { label: t('全部行政班'), value: '' },
                  ...classes.map((item) => ({
                    label: item.name,
                    value: String(item.id),
                  })),
                ]}
                onChange={(value) => setSmallParentFilter(value)}
              />
            </div>
          }
        >
          <Table
            headers={[
              t('小班编码'),
              t('小班名称'),
              t('所属行政班/学部'),
              t('授课教师'),
              t('类型'),
              t('成员数'),
              t('AI 课程'),
              t('HTML 实验室'),
              t('演示实验室'),
              t('操作'),
            ]}
            isEmpty={
              !smallClassesQuery.isLoading &&
              (smallClassesQuery.data ?? []).length === 0
            }
            empty={
              smallClassesQuery.isLoading
                ? t('正在加载…')
                : t('暂无小班，点右上角新建')
            }
          >
            {(smallClassesQuery.data ?? []).map((item) => (
              <tr key={item.id} className='border-border/60 border-b'>
                <Td className='whitespace-nowrap tabular-nums'>
                  {item.code || '-'}
                </Td>
                <Td className='font-medium'>{item.name}</Td>
                <Td className='whitespace-nowrap'>
                  {item.type === 'elective'
                    ? item.section_name || t('社团')
                    : item.parent_class_name || '-'}
                </Td>
                <Td className='whitespace-nowrap'>
                  {item.teacher_name || '-'}
                </Td>
                <Td>
                  <Badge
                    tone={item.type === 'elective' ? 'warning' : 'default'}
                  >
                    {item.type === 'elective' ? t('社团') : t('正课')}
                  </Badge>
                </Td>
                <Td className='tabular-nums'>{item.member_count ?? 0}</Td>
                <Td>
                  <Switch
                    checked={item.ai_enabled}
                    disabled={busy}
                    onChange={(next) => void handleToggleSmallAI(item, next)}
                  />
                </Td>
                <Td>
                  <Switch
                    checked={item.html_enabled ?? false}
                    disabled={busy}
                    onChange={(next) => void handleToggleSmallHtml(item, next)}
                  />
                </Td>
                <Td>
                  <Switch
                    checked={item.slide_enabled ?? false}
                    disabled={busy}
                    onChange={(next) => void handleToggleSmallSlide(item, next)}
                  />
                </Td>
                <Td className='whitespace-nowrap'>
                  <div className='flex gap-2'>
                    <Button
                      variant='primary'
                      onClick={() => setSmallMemberId(item.id)}
                    >
                      {t('详情')}
                    </Button>
                    <Button
                      onClick={() => {
                        setSmallImportTarget(item)
                        setSmallImportResult(null)
                        setTimeout(
                          () => smallImportInputRef.current?.click(),
                          0
                        )
                      }}
                    >
                      {t('导入学生')}
                    </Button>
                    <Button onClick={() => setSmallEditing(item)}>
                      {t('编辑')}
                    </Button>
                    {item.type === 'elective' && (
                      <Button
                        variant='primary'
                        onClick={() => openClubPicker(item)}
                      >
                        {t('选择学生')}
                      </Button>
                    )}
                    <Button
                      variant='danger'
                      disabled={busy}
                      onClick={() => void handleDeleteSmallClass(item)}
                    >
                      {t('删除')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <ClassEditModal
        editing={editing}
        setEditing={setEditing}
        sections={sections}
        busy={busy}
        onSave={handleSaveClass}
      />

      <input
        ref={importInputRef}
        type='file'
        accept='.xlsx'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleImportExcel(file)
        }}
      />

      {/* 小班导入 Excel 文件选择：先选目标小班再选文件 */}
      <input
        ref={smallImportInputRef}
        type='file'
        accept='.xlsx'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleSmallImport(file)
        }}
      />

      {/* 小班新建 / 编辑弹窗 */}
      <Modal
        open={smallEditing !== null}
        title={smallEditing?.id ? t('编辑小班') : t('新建小班')}
        onClose={() => setSmallEditing(null)}
        footer={
          <>
            <Button onClick={() => setSmallEditing(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleSaveSmallClass()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {smallEditing && (
          <div className='grid gap-3'>
            <Field label={t('小班名称')}>
              <TextInput
                value={smallEditing.name ?? ''}
                onChange={(value) =>
                  setSmallEditing({ ...smallEditing, name: value })
                }
              />
            </Field>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field label={t('小班编码')}>
                <TextInput
                  value={smallEditing.code ?? ''}
                  placeholder={t('留空将自动生成')}
                  onChange={(value) =>
                    setSmallEditing({ ...smallEditing, code: value })
                  }
                />
              </Field>
              <Field label={t('小班类型')}>
                <Select
                  value={
                    smallEditing.type === 'elective' ? 'elective' : 'regular'
                  }
                  options={[
                    { label: t('正课'), value: 'regular' },
                    { label: t('社团'), value: 'elective' },
                  ]}
                  onChange={(value) => {
                    if (value === 'elective') {
                      // 社团转正课时清空行政班，反之清空学部，避免残留脏数据。
                      setSmallEditing({
                        ...smallEditing,
                        type: value,
                        parent_class_ids: [],
                      })
                    } else {
                      setSmallEditing({
                        ...smallEditing,
                        type: value,
                        section_id: 0,
                        parent_class_ids:
                          (smallEditing.parent_class_ids ?? []).length === 1
                            ? (smallEditing.parent_class_ids ?? [])
                            : classes[0]?.id
                              ? [classes[0].id]
                              : [],
                      })
                    }
                  }}
                />
              </Field>
            </div>
            {/* 社团小班：归属学部（可跨年级），不挂行政班 */}
            {smallEditing.type === 'elective' && (
              <Field label={t('归属学部')}>
                <Select
                  value={String(smallEditing.section_id ?? 0)}
                  options={[
                    { label: t('请选择学部'), value: '0' },
                    ...sections.map((section) => ({
                      label: section.name,
                      value: String(section.id),
                    })),
                  ]}
                  onChange={(value) =>
                    setSmallEditing({
                      ...smallEditing,
                      section_id: Number(value),
                    })
                  }
                />
              </Field>
            )}
            {/* 功能开关：上移到表单前部并压成开关面板，避免需要滚动到列表底部才能操作。 */}
            <div className='border-border rounded-md border'>
              <p className='border-border text-muted-foreground border-b px-3 py-2 text-xs font-medium'>
                {t('功能开关')}
              </p>
              {[
                {
                  label: t('AI 课程开关'),
                  checked: smallEditing.ai_enabled ?? true,
                  onChange: (next: boolean) =>
                    setSmallEditing({ ...smallEditing, ai_enabled: next }),
                },
                {
                  label: t('HTML 实验室开关'),
                  checked: smallEditing.html_enabled ?? false,
                  onChange: (next: boolean) =>
                    setSmallEditing({ ...smallEditing, html_enabled: next }),
                },
                {
                  label: t('演示实验室开关'),
                  checked: smallEditing.slide_enabled ?? false,
                  onChange: (next: boolean) =>
                    setSmallEditing({ ...smallEditing, slide_enabled: next }),
                },
                {
                  label: t('状态'),
                  checked: smallEditing.enabled !== false,
                  onChange: (next: boolean) =>
                    setSmallEditing({ ...smallEditing, enabled: next }),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className='text-foreground [&:not(:first-child)]:border-border flex items-center justify-between px-3 py-2 text-sm [&:not(:first-child)]:border-t'
                >
                  <span>{item.label}</span>
                  <Switch checked={item.checked} onChange={item.onChange} />
                </div>
              ))}
            </div>
            {/* 正课小班：仅允许在同一个行政大班内部拆分（单选，禁止跨行政班合并） */}
            {smallEditing.type !== 'elective' && (
              <Field
                label={t('所属行政班（单选，仅允许在同一行政班内部拆分）')}
              >
                <div className='border-border max-h-32 overflow-y-auto rounded-md border p-2'>
                  {classes.length === 0 && (
                    <p className='text-muted-foreground text-sm'>
                      {t('暂无行政班')}
                    </p>
                  )}
                  {classes.map((item) => (
                    <label
                      key={item.id}
                      className='flex cursor-pointer items-center gap-2 py-1 text-sm'
                    >
                      <Checkbox
                        checked={(smallEditing.parent_class_ids ?? []).includes(
                          item.id
                        )}
                        onCheckedChange={(checked) => {
                          // 单选：勾选新行政班时替换原选择，取消勾选则清空。
                          const next = checked ? [item.id] : []
                          setSmallEditing({
                            ...smallEditing,
                            parent_class_ids: next,
                          })
                        }}
                      />
                      <span>{item.name}</span>
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <Field label={t('授课教师（可多选）')}>
              <div className='border-border max-h-32 overflow-y-auto rounded-md border p-2'>
                {teachers.length === 0 && (
                  <p className='text-muted-foreground text-sm'>
                    {t('暂无教师')}
                  </p>
                )}
                {teachers.map((teacher) => (
                  <label
                    key={teacher.user_id}
                    className='flex cursor-pointer items-center gap-2 py-1 text-sm'
                  >
                    <Checkbox
                      checked={(smallEditing.teacher_ids ?? []).includes(
                        teacher.user_id
                      )}
                      onCheckedChange={(checked) => {
                        const current = smallEditing.teacher_ids ?? []
                        const next = checked
                          ? [...current, teacher.user_id]
                          : current.filter((id) => id !== teacher.user_id)
                        setSmallEditing({ ...smallEditing, teacher_ids: next })
                      }}
                    />
                    <span>{teacher.display_name || teacher.username}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Modal>

      {/* 社团选人弹窗：搜索系统内已有学生并勾选入团 */}
      <Modal
        open={clubPickerFor !== null}
        title={t('选择学生 · {{name}}', { name: clubPickerFor?.name ?? '' })}
        onClose={() => {
          setClubPickerFor(null)
          setClubSelectedIds([])
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setClubPickerFor(null)
                setClubSelectedIds([])
              }}
            >
              {t('取消')}
            </Button>
            <Button
              variant='primary'
              disabled={busy || clubSelectedIds.length === 0}
              onClick={() => void handleConfirmClubMembers()}
            >
              {t('加入社团（{{n}}）', { n: clubSelectedIds.length })}
            </Button>
          </>
        }
      >
        <div className='grid gap-3'>
          {/* 搜索区：输入关键词后点搜索按钮快速检索学生 */}
          <div className='flex items-end gap-2'>
            <div className='flex-1'>
              <Field label={t('搜索学生')}>
                <TextInput
                  value={clubSearchText}
                  placeholder={t('姓名 / 姓名拼音 / 学号')}
                  onChange={(value) => setClubSearchText(value)}
                />
              </Field>
            </div>
            <Button
              variant='primary'
              onClick={() => setClubSearchKeyword(clubSearchText.trim())}
            >
              {t('搜索')}
            </Button>
            {clubSearchKeyword && (
              <Button
                onClick={() => {
                  setClubSearchKeyword('')
                  setClubSearchText('')
                }}
              >
                {t('清空')}
              </Button>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {clubSearchKeyword
              ? t('关键词「{{kw}}」找到 {{n}} 人，勾选后加入社团', {
                  kw: clubSearchKeyword,
                  n: (clubPickerQuery.data ?? []).length,
                })
              : t(
                  '未输入关键词时展示 {{n}} 名学生；输入关键词并点搜索可快速检索',
                  {
                    n: (clubPickerQuery.data ?? []).length,
                  }
                )}
            {clubSelectedIds.length > 0 &&
              t('，已勾选 {{s}} 人', { s: clubSelectedIds.length })}
          </p>
          <div className='border-border max-h-[50vh] overflow-y-auto rounded-md border'>
            <Table
              headers={[t('选择'), t('学号'), t('姓名'), t('班级'), t('年级')]}
              isEmpty={
                !clubPickerQuery.isLoading &&
                (clubPickerQuery.data ?? []).length === 0
              }
              empty={
                clubPickerQuery.isLoading
                  ? t('正在搜索…')
                  : clubSearchKeyword
                    ? t('没有匹配的学生')
                    : t('暂无学生，输入关键词后点搜索')
              }
            >
              {(clubPickerQuery.data ?? []).map((student) => (
                <tr key={student.id} className='border-border/60 border-b'>
                  <Td className='w-8'>
                    <Checkbox
                      checked={clubSelectedIds.includes(student.id)}
                      onCheckedChange={(checked) =>
                        setClubSelectedIds((prev) =>
                          checked
                            ? [...prev, student.id]
                            : prev.filter((id) => id !== student.id)
                        )
                      }
                    />
                  </Td>
                  <Td className='whitespace-nowrap tabular-nums'>
                    {student.student_no || '-'}
                  </Td>
                  <Td className='font-medium'>{student.display_name || '-'}</Td>
                  <Td className='whitespace-nowrap'>
                    {student.class_name || '-'}
                  </Td>
                  <Td className='whitespace-nowrap'>
                    {student.grade_name || '-'}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </Modal>

      {/* 社团按届清退：移出毕业届 / 已离校成员，先二次确认再执行 */}
      <ConfirmDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        destructive
        title={t('清退毕业成员')}
        desc={t(
          '将把已超出学部学制年限（毕业届）或已离校的成员移出「{{name}}」，届别缺失的成员保留。',
          {
            name:
              (smallClassesQuery.data ?? []).find((c) => c.id === smallMemberId)
                ?.name ?? '',
          }
        )}
        confirmText={t('清退')}
        isLoading={busy}
        handleConfirm={() => void handleCleanupGraduated()}
      />

      {/* 小班详情弹窗：成员名单、小班内分发点数、导出账户信息 Excel、拉入/移出成员 */}
      <Modal
        open={smallMemberId > 0}
        title={t('小班详情 · {{name}}', {
          name:
            (smallClassesQuery.data ?? []).find((c) => c.id === smallMemberId)
              ?.name ?? '',
        })}
        onClose={() => {
          setSmallMemberId(0)
          setSelectedMemberIds([])
          setSmallPointsOpen(false)
        }}
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => void handleDownloadSmallAccounts()}
            >
              {t('下载账户信息 Excel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void handleExportRoster({ small_class_id: smallMemberId })
              }
            >
              {t('导出名单')}
            </Button>
            {(smallClassesQuery.data ?? []).find((c) => c.id === smallMemberId)
              ?.type === 'elective' && (
              <Button
                variant='danger'
                disabled={busy || (smallMembersQuery.data ?? []).length === 0}
                onClick={() => setCleanupOpen(true)}
              >
                {t('清退毕业成员')}
              </Button>
            )}
            <Button
              variant='primary'
              disabled={busy || (smallMembersQuery.data ?? []).length === 0}
              onClick={() => setSmallPointsOpen(true)}
            >
              {t('分发点数')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleImportParentStudents()}
            >
              {t('拉入行政班学生')}
            </Button>
            <Button
              variant='danger'
              disabled={busy || selectedMemberIds.length === 0}
              onClick={() => void handleBatchRemoveMembers()}
            >
              {t('移出所选 {{n}} 人', { n: selectedMemberIds.length })}
            </Button>
            <Button
              onClick={() => {
                setSmallMemberId(0)
                setSelectedMemberIds([])
                setSmallPointsOpen(false)
              }}
            >
              {t('关闭')}
            </Button>
          </>
        }
      >
        {/* 分发点数：勾选成员后仅对所选生效，未勾选则全班分发 */}
        {smallPointsOpen && (
          <div className='border-primary/30 bg-primary/5 mb-3 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
            <Field label={t('调整方式')}>
              <Select
                value={smallPointsMode}
                options={[
                  { label: courseLabel('set'), value: 'set' },
                  { label: courseLabel('clear'), value: 'clear' },
                ]}
                onChange={(value) => setSmallPointsMode(value as PointsMode)}
              />
            </Field>
            {smallPointsMode === 'set' && (
              <Field label={t('每人点数')}>
                <TextInput
                  value={smallPointsValue}
                  onChange={(value) => setSmallPointsValue(value)}
                />
              </Field>
            )}
            <p className='text-muted-foreground pb-2 text-xs'>
              {selectedMemberIds.length > 0
                ? t('将对已勾选的 {{n}} 人生效', {
                    n: selectedMemberIds.length,
                  })
                : t('未勾选成员时，对全班 {{n}} 人分发', {
                    n: (smallMembersQuery.data ?? []).length,
                  })}
            </p>
            <div className='ml-auto flex gap-2'>
              <Button onClick={() => setSmallPointsOpen(false)}>
                {t('收起')}
              </Button>
              <Button
                variant='primary'
                disabled={busy}
                onClick={() => void handleSmallPoints()}
              >
                {t('确定分发')}
              </Button>
            </div>
          </div>
        )}
        <div className='text-muted-foreground mb-2 flex items-center gap-3 text-xs'>
          <label className='flex cursor-pointer items-center gap-1.5'>
            <Checkbox
              checked={
                (smallMembersQuery.data ?? []).length > 0 &&
                selectedMemberIds.length ===
                  (smallMembersQuery.data ?? []).length
              }
              onCheckedChange={(checked) =>
                setSelectedMemberIds(
                  checked ? (smallMembersQuery.data ?? []).map((s) => s.id) : []
                )
              }
            />
            <span>{t('全选')}</span>
          </label>
          <span>{t('已选 {{n}} 人', { n: selectedMemberIds.length })}</span>
        </div>
        <Table
          headers={[
            t('选择'),
            t('学号'),
            t('姓名'),
            t('班级'),
            t('剩余点数'),
            t('已用点数'),
            t('操作'),
          ]}
          isEmpty={
            !smallMembersQuery.isLoading &&
            (smallMembersQuery.data ?? []).length === 0
          }
          empty={
            smallMembersQuery.isLoading
              ? t('正在加载…')
              : t('暂无成员，可点「拉入行政班学生」或「导入学生」入班')
          }
        >
          {(smallMembersQuery.data ?? []).map((student) => (
            <tr key={student.id} className='border-border/60 border-b'>
              <Td>
                <Checkbox
                  checked={selectedMemberIds.includes(student.id)}
                  onCheckedChange={(checked) =>
                    setSelectedMemberIds((prev) =>
                      checked
                        ? [...prev, student.id]
                        : prev.filter((id) => id !== student.id)
                    )
                  }
                />
              </Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {student.student_no || '-'}
              </Td>
              <Td className='font-medium'>{student.display_name}</Td>
              <Td className='whitespace-nowrap'>{student.class_name || '-'}</Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {formatPoints(student.quota ?? 0)}
              </Td>
              <Td className='text-muted-foreground whitespace-nowrap tabular-nums'>
                {formatPoints(student.used_quota ?? 0)}
              </Td>
              <Td>
                <Button
                  variant='danger'
                  disabled={busy}
                  onClick={() => void handleRemoveMember(student.id)}
                >
                  {t('移出')}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Modal>

      {/* 小班导入结果弹窗：展示未匹配清单并手动配对候选学生 */}
      <Modal
        open={smallImportResult !== null}
        title={t('导入结果确认')}
        onClose={() => {
          setSmallImportResult(null)
          setSmallImportTarget(null)
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setSmallImportResult(null)
                setSmallImportTarget(null)
              }}
            >
              {t('取消')}
            </Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleConfirmImport()}
            >
              {t('确认入班')}
            </Button>
          </>
        }
      >
        {smallImportResult && (
          <div className='grid max-h-[60vh] gap-3 overflow-y-auto'>
            <p className='text-muted-foreground text-sm'>
              {t(
                '自动匹配 {{n}} 人，未匹配 {{u}} 条；请为未匹配行选择候选学生后确认入班。',
                {
                  n: smallImportResult.matched.length,
                  u: smallImportResult.unmatched.length,
                }
              )}
            </p>
            {smallImportResult.unmatched.map((row) => (
              <div
                key={row.row}
                className='border-border rounded-lg border p-3'
              >
                <div className='mb-2 flex flex-wrap items-center gap-2 text-sm'>
                  <Badge tone='muted'>#{row.row}</Badge>
                  <span className='font-medium'>{row.display_name}</span>
                  {row.entry_year > 0 && (
                    <span className='text-muted-foreground text-xs'>
                      {row.entry_year}届
                    </span>
                  )}
                  <span className='text-destructive text-xs'>{row.reason}</span>
                </div>
                {row.candidates.length > 0 ? (
                  <Select
                    value={String(pairChoices[row.row] ?? 0)}
                    options={[
                      { label: t('请选择候选学生'), value: '0' },
                      ...row.candidates.map((candidate) => ({
                        label: `${candidate.display_name}（${candidate.student_no || t('无学号')} · ${candidate.class_name || '-'} · ${candidate.entry_year || '-'}届）`,
                        value: String(candidate.student_id),
                      })),
                    ]}
                    onChange={(value) =>
                      setPairChoices((prev) => ({
                        ...prev,
                        [row.row]: Number(value) || 0,
                      }))
                    }
                  />
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    {t('无候选学生，请先在学生管理中创建该学生后重新导入。')}
                  </p>
                )}
              </div>
            ))}
            {smallImportResult.failed.length > 0 && (
              <div className='border-destructive/40 text-destructive rounded-lg border p-3 text-xs'>
                {smallImportResult.failed
                  .slice(0, 5)
                  .map((item) => `${item.row}（${item.reason}）`)
                  .join('、')}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Excel 导入失败清单：全量展示逐行失败原因，便于对照模板修正后重新导入 */}
      <Modal
        open={importFailures !== null}
        title={t('导入失败清单（{{n}} 条）', {
          n: importFailures?.length ?? 0,
        })}
        onClose={() => setImportFailures(null)}
        footer={
          <Button variant='primary' onClick={() => setImportFailures(null)}>
            {t('知道了')}
          </Button>
        }
      >
        <div className='grid max-h-[50vh] gap-1.5 overflow-y-auto text-sm'>
          <p className='text-muted-foreground text-xs'>
            {t(
              '成功导入的数据已保留，仅以下行未导入。修正后可重新上传同一份文件。'
            )}
          </p>
          {(importFailures ?? []).map((item, index) => (
            <div
              key={`${item.row}-${index}`}
              className='border-border flex items-start gap-2 rounded-md border px-3 py-2'
            >
              <span className='text-muted-foreground min-w-16 shrink-0 text-xs'>
                {item.row}
              </span>
              <span className='text-destructive'>{item.reason}</span>
            </div>
          ))}
        </div>
      </Modal>
    </PageShell>
  )
}

function ClassEditModal(props: {
  editing: Partial<AiHubClass> | null
  setEditing: (value: Partial<AiHubClass> | null) => void
  sections: AiHubSection[]
  busy: boolean
  onSave: () => void
}) {
  const { t } = useTranslation()
  const { editing, setEditing, sections, busy, onSave } = props
  return (
    <Modal
      open={editing !== null}
      title={editing?.id ? t('编辑班级') : t('新建班级')}
      onClose={() => setEditing(null)}
      footer={
        <>
          <Button onClick={() => setEditing(null)}>{t('取消')}</Button>
          <Button variant='primary' disabled={busy} onClick={() => onSave()}>
            {t('保存')}
          </Button>
        </>
      }
    >
      {editing && (
        <div className='grid gap-3'>
          <Field label={t('班级名称')}>
            <TextInput
              value={editing.name ?? ''}
              onChange={(value) => setEditing({ ...editing, name: value })}
            />
          </Field>
          <Field label={t('班级编号')}>
            <TextInput
              value={editing.code ?? ''}
              placeholder={t('留空将自动生成')}
              onChange={(value) => setEditing({ ...editing, code: value })}
            />
          </Field>
          <Field label={t('所属学部')}>
            <Select
              value={String(editing.section_id ?? 0)}
              options={[
                { label: t('未设置'), value: '0' },
                ...sections.map((section) => ({
                  label: `${section.name}（${section.code}）`,
                  value: String(section.id),
                })),
              ]}
              onChange={(value) =>
                setEditing({ ...editing, section_id: Number(value) || 0 })
              }
            />
          </Field>
          <Field label={t('届别（入学年份，如 2024）')}>
            <TextInput
              value={String(editing.entry_year ?? 0)}
              onChange={(value) =>
                setEditing({ ...editing, entry_year: Number(value) || 0 })
              }
            />
          </Field>
          <Field label={t('班级说明')}>
            <TextArea
              value={editing.description ?? ''}
              onChange={(value) =>
                setEditing({ ...editing, description: value })
              }
            />
          </Field>
          <Field label={t('状态')}>
            <Select
              value={editing.enabled === false ? 'off' : 'on'}
              options={[
                { label: t('启用'), value: 'on' },
                { label: t('停用'), value: 'off' },
              ]}
              onChange={(value) =>
                setEditing({ ...editing, enabled: value === 'on' })
              }
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
