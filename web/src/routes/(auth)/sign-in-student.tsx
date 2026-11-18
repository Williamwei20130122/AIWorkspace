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
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CustomSelect } from '@/components/ui/native-select'
import { AuthLayout } from '@/features/auth/auth-layout'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { resolveAuthentication } from '@/lib/auth-session'
import { handleServerError } from '@/lib/handle-server-error'
import { api } from '@/lib/http-client'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/(auth)/sign-in-student')({
  component: SignInStudent,
  beforeLoad: async () => {
    // 已有会话时不再展示登录页（与教师登录页保持一致的回源确认）。
    await resolveAuthentication()
    const { auth } = useAuthStore.getState()
    if (auth.user) {
      throw redirect({ href: '/dashboard', replace: true })
    }
  },
})

/** 学生登录用的年级（公开班级接口按年级名去重派生）。 */
interface LoginClass {
  id: number
  name: string
  section_name?: string
  grade_index?: number
  grade_name?: string
}

/** 年级选项：按年级名去重，按年级序号排序（同名年级合并展示）。 */
interface GradeOption {
  key: string
  label: string
  gradeIndex: number
}

function buildGradeOptions(classes: LoginClass[]): GradeOption[] {
  const map = new Map<string, GradeOption>()
  for (const item of classes) {
    const label = (item.grade_name ?? '').trim()
    if (!label) continue
    const exist = map.get(label)
    const index = item.grade_index ?? 0
    if (!exist || index < exist.gradeIndex) {
      map.set(label, {
        key: label,
        label,
        gradeIndex: index,
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.gradeIndex - b.gradeIndex || a.label.localeCompare(b.label)
  )
}

const INPUT_CLASS =
  'h-12 w-full rounded-[11px] border border-[#e5e2f7] bg-white px-3.5 text-[15px] font-normal text-[#191833] outline-none transition-colors placeholder:text-[#b3b2c6] focus:border-[#8b7bf5]'

// 与输入框等高的自绘下拉：触发器与菜单配色全部对齐登录卡的紫色主题。
const SELECT_TRIGGER_CLASS =
  'h-12 rounded-[11px] border border-[#e5e2f7] bg-white px-3.5 text-[15px] text-[#191833] transition-colors hover:border-[#c9c2f8] focus-visible:border-[#8b7bf5] data-[size=default]:h-12 data-[size=default]:rounded-[11px]'

const SELECT_MENU_CLASS =
  'rounded-[11px] border border-[#e9e7f8] bg-white py-1.5 shadow-[0_22px_44px_-26px_rgba(45,42,90,.55)]'

function SignInStudent() {
  const { t } = useTranslation()
  const { handleLoginResult } = useAuthRedirect()
  const [classes, setClasses] = useState<LoginClass[]>([])
  const [grade, setGrade] = useState('')
  // 账户名：学号生成的编号 或 姓名拼音全称（教师导入自动生成，重名冲突由教师改）。
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // 公开只读接口：拉取启用中的班级，用年级缩小选择范围，降低重名混淆。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await api.get('/api/workspace/student/classes')
        const payload = requireServerSuccess(res.data)
        const list: LoginClass[] = (payload?.data ?? []) as LoginClass[]
        if (!alive) return
        setClasses(list)
        const grades = buildGradeOptions(list)
        if (grades.length > 0) setGrade(grades[0].key)
      } catch {
        // 拉取失败时保持下拉为空，页面仍可提示用户稍后重试。
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const gradeOptions = useMemo(
    () =>
      buildGradeOptions(classes).map((item) => ({
        value: item.key,
        label: item.label,
      })),
    [classes]
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!grade) {
      toast.error(t('请选择年级'))
      return
    }
    if (!account.trim()) {
      toast.error(t('请输入账户名'))
      return
    }
    setIsLoading(true)
    try {
      const res = await api.post(
        '/api/workspace/student/login',
        {
          grade_name: grade,
          account: account.trim(),
          password: password.trim(),
        },
        { skipAuthRefresh: true }
      )
      const body = requireServerSuccess(res.data)
      if (await handleLoginResult(body?.data)) {
        toast.success(t('登录成功'))
      }
    } catch (error) {
      handleServerError(createServerError(error, t('登录失败')))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      {/* 与创作台同源的紫色氛围背景：固定在视口后方，不随卡片滚动。 */}
      <div aria-hidden className='pointer-events-none fixed inset-0 -z-10'>
        <div
          className='absolute inset-0'
          style={{
            background:
              'radial-gradient(900px 520px at 8% -10%, rgba(124,108,242,.20), transparent 62%), radial-gradient(760px 480px at 96% 2%, rgba(56,189,248,.13), transparent 64%), radial-gradient(820px 560px at 50% 112%, rgba(167,139,250,.16), transparent 66%)',
          }}
        />
        <div
          className='absolute inset-0 opacity-60'
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(108,92,231,.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(108,92,231,.055) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
            maskImage:
              'radial-gradient(1100px 700px at 50% 0%, #000 20%, transparent 78%)',
            WebkitMaskImage:
              'radial-gradient(1100px 700px at 50% 0%, #000 20%, transparent 78%)',
          }}
        />
      </div>
      <div className='workspace-enter w-full rounded-[20px] border border-[#e9e7f8] bg-white/95 p-7 shadow-[0_30px_70px_-40px_rgba(25,24,51,.45)] sm:p-9'>
        <div className='flex items-center gap-3'>
          <span className='flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-[15px] font-extrabold tracking-[.5px] text-white shadow-[0_10px_22px_-8px_rgba(108,92,231,.8)]'>
            AI
          </span>
          <div className='leading-tight'>
            <div className='text-[18px] font-extrabold tracking-[-.01em] text-[#17162b]'>
              {t('AI 创作工坊')}
            </div>
            <div className='mt-[2px] text-[11.5px] text-[#8786a0]'>
              {t('校园多模态生成中台')}
            </div>
          </div>
        </div>

        <div className='mt-7 space-y-1.5'>
          <h2 className='text-[24px] font-extrabold tracking-[-.02em] text-[#17162b]'>
            {t('学生登录')}
          </h2>
          <p className='text-[12.5px] text-[#8786a0]'>
            {t(
              '先选择年级，再输入账户名（学号或姓名拼音全称）；设置过密码后需同时输入密码。'
            )}
          </p>
        </div>

        <form onSubmit={onSubmit} className='mt-6 grid gap-4'>
          <label className='grid gap-1.5 text-[12.5px] font-semibold text-[#5f5e78]'>
            {t('年级')}
            <CustomSelect
              aria-label={t('年级')}
              onChange={setGrade}
              options={gradeOptions}
              placeholder={
                gradeOptions.length === 0 ? t('暂无班级数据') : t('请选择年级')
              }
              triggerClassName={SELECT_TRIGGER_CLASS}
              menuClassName={SELECT_MENU_CLASS}
              value={grade}
            />
          </label>

          <label className='grid gap-1.5 text-[12.5px] font-semibold text-[#5f5e78]'>
            {t('账户名')}
            <input
              autoComplete='username'
              autoFocus
              className={INPUT_CLASS}
              onChange={(event) => setAccount(event.target.value)}
              placeholder={t('学号编号或姓名拼音全称')}
              value={account}
            />
          </label>

          <label className='grid gap-1.5 text-[12.5px] font-semibold text-[#5f5e78]'>
            {t('密码')}
            <input
              autoComplete='current-password'
              className={INPUT_CLASS}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('未设置密码可留空')}
              type='password'
              value={password}
            />
          </label>

          <button
            className='mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-[11px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] px-4 text-[14px] font-bold text-white shadow-[0_14px_28px_-14px_rgba(108,92,231,.95)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={isLoading}
            type='submit'
          >
            {isLoading ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                {t('登录中…')}
              </>
            ) : (
              t('进入创作工坊')
            )}
          </button>
        </form>

        <div className='mt-6 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#8786a0]'>
          <span>{t('忘记密码请联系任课教师重置')}</span>
          <Link
            className='font-semibold text-[#5b4bd6] transition-opacity hover:opacity-80'
            to='/sign-in'
          >
            {t('教师 / 管理员登录')}
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}
