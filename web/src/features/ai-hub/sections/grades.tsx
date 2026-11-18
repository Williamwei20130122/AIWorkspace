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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  createTeacher,
  deleteSection,
  fetchSectionOverview,
  fetchSections,
  fetchTeachers,
  rolloverSchoolYear,
  saveSection,
} from '../api'
import {
  Badge,
  Button,
  Field,
  Modal,
  PageShell,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
} from '../components/kit'
import type { AiHubSection, AiHubTeacherProfile } from '../types'

// roleLabel 把教师角色数值映射为中文标签。
function roleLabel(role: number): string {
  if (role >= 100) return '超级管理员'
  if (role >= 10) return '教师'
  return '普通用户'
}

// parseGradeNames 把「一年级，二年级…」文本解析为年级阶梯数组。
function parseGradeNames(text: string): string[] {
  return text
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function GradesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [sectionDraft, setSectionDraft] =
    useState<Partial<AiHubSection> | null>(null)
  const [gradeNamesText, setGradeNamesText] = useState('')
  const [teacherDraft, setTeacherDraft] = useState<{
    username: string
    display_name: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const sectionsQuery = useQuery({
    queryKey: ['ai-hub', 'sections'],
    queryFn: fetchSections,
  })
  const overviewQuery = useQuery({
    queryKey: ['ai-hub', 'section-overview'],
    queryFn: fetchSectionOverview,
  })
  const teachersQuery = useQuery({
    queryKey: ['ai-hub', 'teachers'],
    queryFn: fetchTeachers,
  })

  const sections = sectionsQuery.data ?? []
  const overview = overviewQuery.data
  const teachers = teachersQuery.data ?? []

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'sections'] })
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'section-overview'],
    })
    await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'teachers'] })
    await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'classes'] })
  }

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      // success 为空表示调用方自行提示，避免弹出空白 toast。
      if (success) toast.success(success)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openSectionDraft = (section?: AiHubSection) => {
    if (section) {
      setSectionDraft({ ...section })
      setGradeNamesText((section.grade_names ?? []).join('，'))
      return
    }
    setSectionDraft({
      code: '',
      name: '',
      years: 3,
      promote_month: 9,
      auto_graduate: true,
      sort_order: sections.length + 1,
      enabled: true,
    })
    setGradeNamesText('')
  }

  const handleSaveSection = async () => {
    if (!sectionDraft) return
    if (!(sectionDraft.name ?? '').trim()) {
      toast.error(t('学部名称不能为空'))
      return
    }
    if (!(sectionDraft.code ?? '').trim()) {
      toast.error(t('学部代码不能为空'))
      return
    }
    const years = Number(sectionDraft.years ?? 0)
    if (years <= 0 || years > 12) {
      toast.error(t('学制年限需在 1-12 之间'))
      return
    }
    const ok = await run(
      () =>
        saveSection({
          ...sectionDraft,
          code: (sectionDraft.code ?? '').trim().toUpperCase(),
          name: (sectionDraft.name ?? '').trim(),
          years,
          grade_names: parseGradeNames(gradeNamesText),
        }),
      sectionDraft.id ? t('学部已更新') : t('学部已创建')
    )
    if (ok) setSectionDraft(null)
  }

  const handleCreateTeacher = async () => {
    if (!teacherDraft) return
    setBusy(true)
    try {
      const result = await createTeacher({
        username: teacherDraft.username.trim(),
        display_name: teacherDraft.display_name.trim(),
      })
      await refresh()
      toast.success(
        t('教师已创建：{{username}}，初始密码 {{password}}', {
          username: result?.username ?? t('（系统分配）'),
          password: result?.password ?? '',
        })
      )
      setTeacherDraft(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('创建失败'))
    } finally {
      setBusy(false)
    }
  }

  const overviewRows = (overview?.items ?? []).flatMap((item) =>
    (item.grades ?? []).map((grade) => ({
      key: `${item.id}-${grade.grade_index}`,
      sectionName: item.name,
      sectionCode: item.code,
      gradeName: grade.grade_name,
      gradeIndex: grade.grade_index,
      classCount: grade.class_count,
      studentNum: grade.student_num,
    }))
  )

  return (
    <PageShell
      title={t('学部管理')}
      description={t(
        '维护小学部、初中部、高中部及其学制年限、年级阶梯与升级规则；学生年级按「届别 + 学制」自动换算，无需手动新建年级。'
      )}
      actions={<Button onClick={() => void refresh()}>{t('刷新')}</Button>}
    >
      <Panel
        bodyClassName='p-0'
        title={t('学部列表')}
        description={t(
          '学部代码为学生账号前缀（如 P/J/S）；升级月份决定每年何时自动升入下一年级。'
        )}
        actions={
          <Button variant='primary' onClick={() => openSectionDraft()}>
            {t('新建学部')}
          </Button>
        }
      >
        <Table
          headers={[
            t('学部代码'),
            t('学部名称'),
            t('学制'),
            t('年级阶梯'),
            t('升级月份'),
            t('毕业冻结'),
            t('班级数'),
            t('在读学生数'),
            t('状态'),
            t('操作'),
          ]}
          isEmpty={!sectionsQuery.isLoading && sections.length === 0}
          empty={sectionsQuery.isLoading ? t('正在加载…') : t('暂无学部')}
        >
          {sections.map((section) => (
            <tr key={section.id} className='border-border/60 border-b'>
              <Td>
                <Badge tone='default'>{section.code}</Badge>
              </Td>
              <Td>{section.name}</Td>
              <Td className='tabular-nums'>
                {t('{{years}} 年', { years: section.years })}
              </Td>
              <Td className='text-muted-foreground max-w-[260px] text-xs'>
                {(section.grade_names ?? []).join(' / ') || '-'}
              </Td>
              <Td className='tabular-nums'>
                {t('{{month}} 月', { month: section.promote_month })}
              </Td>
              <Td>
                <Badge tone={section.auto_graduate ? 'success' : 'muted'}>
                  {section.auto_graduate ? t('开启') : t('关闭')}
                </Badge>
              </Td>
              <Td className='tabular-nums'>{section.class_count ?? 0}</Td>
              <Td className='tabular-nums'>{section.student_num ?? 0}</Td>
              <Td>
                <Badge tone={section.enabled ? 'success' : 'muted'}>
                  {section.enabled ? t('启用') : t('停用')}
                </Badge>
              </Td>
              <Td className='whitespace-nowrap'>
                <div className='flex gap-2'>
                  <Button
                    disabled={busy}
                    onClick={() => openSectionDraft(section)}
                  >
                    {t('编辑')}
                  </Button>
                  <Button
                    variant='danger'
                    disabled={busy}
                    onClick={() =>
                      void run(() => deleteSection(section.id), t('学部已删除'))
                    }
                  >
                    {t('删除')}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        bodyClassName='p-0'
        title={t('学部总览')}
        description={
          overview
            ? `${t('当前学年 {{year}}。', {
                year: overview.academic_year,
              })}${
                overview.last_rollover_academic_year
                  ? t('上次结转学年 {{year}}。', {
                      year: overview.last_rollover_academic_year,
                    })
                  : t('尚未执行过学年结转。')
              }`
            : undefined
        }
        actions={
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await rolloverSchoolYear()
                toast.success(
                  t(
                    '学年结转完成：{{year}} 学年，{{count}} 名学生标记为已毕业。',
                    {
                      year: result.academic_year,
                      count: result.graduated,
                    }
                  )
                )
              }, '')
            }
          >
            {t('一键学年结转')}
          </Button>
        }
      >
        <Table
          headers={[t('学部'), t('年级'), t('班级数'), t('在读学生数')]}
          isEmpty={!overviewQuery.isLoading && overviewRows.length === 0}
          empty={overviewQuery.isLoading ? t('正在加载…') : t('暂无学部数据')}
        >
          {overviewRows.map((row) => (
            <tr key={row.key} className='border-border/60 border-b'>
              <Td>
                {row.sectionName}
                <span className='text-muted-foreground ml-2 text-xs'>
                  {row.sectionCode}
                </span>
              </Td>
              <Td>
                {row.gradeName || '-'}
                <span className='text-muted-foreground ml-2 text-xs'>
                  第 {row.gradeIndex} 年
                </span>
              </Td>
              <Td className='tabular-nums'>{row.classCount}</Td>
              <Td className='tabular-nums'>{row.studentNum}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        bodyClassName='p-0'
        title={t('教师账号')}
        description={t(
          '登录名留空时由系统自动分配；初始密码由服务端生成并在创建后提示。'
        )}
        actions={
          <Button
            variant='primary'
            onClick={() => setTeacherDraft({ username: '', display_name: '' })}
          >
            {t('新建教师')}
          </Button>
        }
      >
        <Table
          headers={[t('教师'), t('登录名'), t('角色'), t('状态')]}
          isEmpty={!teachersQuery.isLoading && teachers.length === 0}
          empty={teachersQuery.isLoading ? t('正在加载…') : t('暂无教师账号')}
        >
          {teachers.map((teacher: AiHubTeacherProfile) => (
            <tr key={teacher.user_id} className='border-border/60 border-b'>
              <Td>{teacher.display_name || teacher.username}</Td>
              <Td>{teacher.username}</Td>
              <Td>
                <Badge tone='default'>{roleLabel(teacher.role)}</Badge>
              </Td>
              <Td>
                <Badge tone={teacher.status === 1 ? 'success' : 'muted'}>
                  {teacher.status === 1 ? t('启用') : t('停用')}
                </Badge>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Modal
        open={sectionDraft !== null}
        title={sectionDraft?.id ? t('编辑学部') : t('新建学部')}
        onClose={() => setSectionDraft(null)}
        footer={
          <>
            <Button onClick={() => setSectionDraft(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleSaveSection()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {sectionDraft && (
          <div className='grid gap-3'>
            <Field label={t('学部代码（单字母，用于学生账号前缀）')}>
              <TextInput
                value={sectionDraft.code ?? ''}
                onChange={(value) =>
                  setSectionDraft({
                    ...sectionDraft,
                    code: value.toUpperCase(),
                  })
                }
              />
            </Field>
            <Field label={t('学部名称')}>
              <TextInput
                value={sectionDraft.name ?? ''}
                onChange={(value) =>
                  setSectionDraft({ ...sectionDraft, name: value })
                }
              />
            </Field>
            <Field label={t('学制年限（年）')}>
              <TextInput
                value={String(sectionDraft.years ?? 0)}
                onChange={(value) =>
                  setSectionDraft({
                    ...sectionDraft,
                    years: Number(value) || 0,
                  })
                }
              />
            </Field>
            <Field label={t('年级阶梯（按顺序用逗号分隔）')}>
              <TextInput
                value={gradeNamesText}
                onChange={(value) => setGradeNamesText(value)}
              />
            </Field>
            <Field label={t('学年升级月份')}>
              <Select
                value={String(sectionDraft.promote_month ?? 9)}
                options={Array.from({ length: 12 }, (_, index) => ({
                  label: t('{{month}} 月', { month: index + 1 }),
                  value: String(index + 1),
                }))}
                onChange={(value) =>
                  setSectionDraft({
                    ...sectionDraft,
                    promote_month: Number(value) || 9,
                  })
                }
              />
            </Field>
            <Field label={t('超出学制自动冻结为已毕业')}>
              <Select
                value={sectionDraft.auto_graduate === false ? 'off' : 'on'}
                options={[
                  { label: t('开启'), value: 'on' },
                  { label: t('关闭'), value: 'off' },
                ]}
                onChange={(value) =>
                  setSectionDraft({
                    ...sectionDraft,
                    auto_graduate: value === 'on',
                  })
                }
              />
            </Field>
            <Field label={t('排序')}>
              <TextInput
                value={String(sectionDraft.sort_order ?? 0)}
                onChange={(value) =>
                  setSectionDraft({
                    ...sectionDraft,
                    sort_order: Number(value) || 0,
                  })
                }
              />
            </Field>
            <Field label={t('状态')}>
              <Select
                value={sectionDraft.enabled === false ? 'off' : 'on'}
                options={[
                  { label: t('启用'), value: 'on' },
                  { label: t('停用'), value: 'off' },
                ]}
                onChange={(value) =>
                  setSectionDraft({ ...sectionDraft, enabled: value === 'on' })
                }
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={teacherDraft !== null}
        title={t('新建教师')}
        onClose={() => setTeacherDraft(null)}
        footer={
          <>
            <Button onClick={() => setTeacherDraft(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleCreateTeacher()}
            >
              {t('创建')}
            </Button>
          </>
        }
      >
        {teacherDraft && (
          <div className='grid gap-3'>
            <Field label={t('登录名（留空自动分配）')}>
              <TextInput
                value={teacherDraft.username}
                onChange={(value) =>
                  setTeacherDraft({ ...teacherDraft, username: value })
                }
              />
            </Field>
            <Field label={t('姓名')}>
              <TextInput
                value={teacherDraft.display_name}
                onChange={(value) =>
                  setTeacherDraft({ ...teacherDraft, display_name: value })
                }
              />
            </Field>
          </div>
        )}
      </Modal>
    </PageShell>
  )
}
