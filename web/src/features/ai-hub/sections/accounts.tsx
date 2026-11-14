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
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { formatPoints } from '@/lib/format'
import { api } from '@/lib/http-client'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  fetchAccounts,
  fetchCapabilityConfig,
  fetchTeacherWallets,
  resetAccountUsage,
  saveAccountQuotas,
  saveTeacherWallet,
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
  TextInput,
} from '../components/kit'
import type { AiHubAccount } from '../types'

const GRANT_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => index + 1)

const ROLE_OPTIONS = [
  { value: String(ROLE.USER), label: '学生' },
  { value: String(ROLE.ADMIN), label: '教师' },
]

const DEFAULT_GRANT_DAY = 15

export function AccountsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const verification = useSecureVerification()
  const [quotaTarget, setQuotaTarget] = useState<AiHubAccount | null>(null)
  const [quotaDraft, setQuotaDraft] = useState<Record<string, number>>({})
  const [creating, setCreating] = useState(false)
  const [newAccount, setNewAccount] = useState({
    username: '',
    password: '',
    display_name: '',
    quota: '0',
    role: String(ROLE.USER),
    grantAmount: '0',
    grantDay: String(DEFAULT_GRANT_DAY),
    autoGrant: false,
  })
  const [walletTarget, setWalletTarget] = useState<AiHubAccount | null>(null)
  const [walletDraft, setWalletDraft] = useState({
    grantAmount: '0',
    grantDay: String(DEFAULT_GRANT_DAY),
    autoGrant: false,
  })
  const [busy, setBusy] = useState(false)

  const accountsQuery = useQuery({
    queryKey: ['ai-hub', 'accounts'],
    queryFn: fetchAccounts,
  })
  const configQuery = useQuery({
    queryKey: ['ai-hub', 'capability-config'],
    queryFn: fetchCapabilityConfig,
  })
  const walletsQuery = useQuery({
    queryKey: ['ai-hub', 'teacher-wallets'],
    queryFn: fetchTeacherWallets,
  })
  const capabilities = configQuery.data?.capabilities ?? []

  const openQuotaEditor = (account: AiHubAccount) => {
    const draft: Record<string, number> = {}
    capabilities.forEach((capability) => {
      const found = account.capability_quotas.find(
        (item) => item.capability_id === capability.id
      )
      draft[capability.id] = found?.quota ?? 0
    })
    setQuotaDraft(draft)
    setQuotaTarget(account)
  }

  const openWalletEditor = (account: AiHubAccount) => {
    const existing = (walletsQuery.data ?? []).find(
      (item) => item.user_id === account.id
    )
    setWalletDraft({
      grantAmount: String(existing?.grant_amount ?? 0),
      grantDay: String(existing?.grant_day || DEFAULT_GRANT_DAY),
      autoGrant: existing?.auto_grant ?? false,
    })
    setWalletTarget(account)
  }

  const handleSaveQuotas = async () => {
    if (!quotaTarget) return
    setBusy(true)
    try {
      await saveAccountQuotas(quotaTarget.id, quotaDraft)
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'accounts'] })
      toast.success(t('能力额度已保存'))
      setQuotaTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleSaveWallet = async () => {
    if (!walletTarget) return
    setBusy(true)
    try {
      await saveTeacherWallet({
        userId: walletTarget.id,
        grantAmount: Math.max(0, Number(walletDraft.grantAmount) || 0),
        grantDay: Number(walletDraft.grantDay) || DEFAULT_GRANT_DAY,
        autoGrant: walletDraft.autoGrant,
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'teacher-wallets'],
      })
      toast.success(t('教师点数发放配置已保存'))
      setWalletTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async (account: AiHubAccount, capabilityId = '') => {
    setBusy(true)
    try {
      await resetAccountUsage(account.id, capabilityId)
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'accounts'] })
      toast.success(t('已清零已用量'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async () => {
    const username = newAccount.username.trim()
    if (!username || newAccount.password.length < 6) {
      toast.error(t('用户名必填，密码至少 6 位'))
      return
    }
    const role = Number(newAccount.role)
    setBusy(true)
    try {
      // 教师属于管理角色，服务端强制要求 step-up 校验。
      let proofToken: string | undefined
      if (role >= ROLE.ADMIN) {
        const proof = await verification.requestVerification({
          scope: 'admin.user.create',
          context: { role },
          title: t('验证身份以创建教师账户'),
          description: t('创建教师账户会授予管理权限，请先完成身份校验。'),
        })
        if (!proof) {
          setBusy(false)
          return
        }
        proofToken = proof.proof_token
      }
      requireServerSuccess(
        (
          await api.post(
            '/api/user/',
            {
              username,
              password: newAccount.password,
              display_name: newAccount.display_name.trim() || username,
              role,
              quota: Math.max(0, Number(newAccount.quota) || 0),
            },
            proofToken
              ? {
                  headers: { 'X-Security-Proof': proofToken },
                  singleUseAuthorization: true,
                }
              : {}
          )
        ).data
      )
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'accounts'] })
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'users'] })
      // 教师账户创建后按填写的发放规则初始化钱包（0 表示暂不自动发放）。
      const grantAmount = Math.max(0, Number(newAccount.grantAmount) || 0)
      if (role >= ROLE.ADMIN && grantAmount > 0) {
        const list = await queryClient.fetchQuery({
          queryKey: ['ai-hub', 'accounts'],
          queryFn: fetchAccounts,
        })
        const created = list.find((item) => item.username === username)
        if (created) {
          await saveTeacherWallet({
            userId: created.id,
            grantAmount,
            grantDay: Number(newAccount.grantDay) || DEFAULT_GRANT_DAY,
            autoGrant: newAccount.autoGrant,
          })
          await queryClient.invalidateQueries({
            queryKey: ['ai-hub', 'teacher-wallets'],
          })
        }
      }
      toast.success(t('账户已创建'))
      setCreating(false)
      setNewAccount({
        username: '',
        password: '',
        display_name: '',
        quota: '0',
        role: String(ROLE.USER),
        grantAmount: '0',
        grantDay: String(DEFAULT_GRANT_DAY),
        autoGrant: false,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('创建失败'))
    } finally {
      setBusy(false)
    }
  }

  const accounts = accountsQuery.data ?? []
  const isTeacherRole = Number(newAccount.role) >= ROLE.ADMIN

  return (
    <PageShell
      title={t('账户管理')}
      description={t(
        '创建学生/教师账户、分配各生成能力的可用额度、查看或清零已用量，并为教师配置每月点数发放规则。'
      )}
      actions={
        <Button variant='primary' onClick={() => setCreating(true)}>
          {t('新建账户')}
        </Button>
      }
    >
      <Panel bodyClassName='p-0'>
        <Table
          headers={[
            t('账号'),
            t('角色'),
            t('总剩余点数'),
            t('已用点数'),
            t('能力额度'),
            t('操作'),
          ]}
          isEmpty={!accountsQuery.isLoading && accounts.length === 0}
          empty={accountsQuery.isLoading ? t('正在加载…') : t('暂无账户')}
        >
          {accounts.map((account) => (
            <tr key={account.id} className='border-b border-border/60'>
              <Td>
                <div className='font-medium'>
                  {account.display_name || account.username}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {account.username}
                </div>
              </Td>
              <Td className='whitespace-nowrap'>
                <Badge tone='muted'>
                  {account.role >= ROLE.SUPER_ADMIN
                    ? t('超级管理员')
                    : account.role >= ROLE.ADMIN
                      ? t('教师')
                      : t('学生')}
                </Badge>
              </Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {formatPoints(account.quota)}
              </Td>
              <Td className='whitespace-nowrap tabular-nums'>
                {formatPoints(account.used_quota)}
              </Td>
              <Td>
                <div className='flex flex-wrap gap-1'>
                  {account.capability_quotas.length === 0 && (
                    <span className='text-xs text-muted-foreground'>
                      {t('未单独限制')}
                    </span>
                  )}
                  {account.capability_quotas.map((quota) => (
                    <Badge key={quota.id} tone='default'>
                      {capabilities.find((item) => item.id === quota.capability_id)
                        ?.name ?? quota.capability_id}
                      {` ${quota.used}/${quota.quota}`}
                    </Badge>
                  ))}
                </div>
              </Td>
              <Td className='whitespace-nowrap'>
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={() => openQuotaEditor(account)}>
                    {t('分配额度')}
                  </Button>
                  {account.role >= ROLE.ADMIN &&
                    account.role < ROLE.SUPER_ADMIN && (
                      <Button onClick={() => openWalletEditor(account)}>
                        {t('点数发放')}
                      </Button>
                    )}
                  <Button
                    variant='danger'
                    disabled={busy}
                    onClick={() => void handleReset(account)}
                  >
                    {t('清零已用')}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Modal
        open={quotaTarget !== null}
        title={`${t('分配能力额度')} · ${quotaTarget?.display_name || quotaTarget?.username || ''}`}
        onClose={() => setQuotaTarget(null)}
        footer={
          <>
            <Button onClick={() => setQuotaTarget(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleSaveQuotas()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        <div className='grid gap-3 md:grid-cols-2'>
          {capabilities.map((capability) => (
            <Field key={capability.id} label={capability.name}>
              <TextInput
                type='number'
                value={String(quotaDraft[capability.id] ?? 0)}
                onChange={(value) =>
                  setQuotaDraft((prev) => ({
                    ...prev,
                    [capability.id]: Math.max(0, Number(value) || 0),
                  }))
                }
              />
            </Field>
          ))}
        </div>
        <p className='mt-3 text-xs text-muted-foreground'>
          {t('设为 0 表示不单独限制，沿用账户的总额度。')}
        </p>
      </Modal>

      <Modal
        open={walletTarget !== null}
        title={`${t('教师点数发放')} · ${walletTarget?.display_name || walletTarget?.username || ''}`}
        onClose={() => setWalletTarget(null)}
        footer={
          <>
            <Button onClick={() => setWalletTarget(null)}>{t('取消')}</Button>
            <Button
              variant='primary'
              disabled={busy}
              onClick={() => void handleSaveWallet()}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <Field label={t('每月发放点数')}>
            <TextInput
              type='number'
              value={walletDraft.grantAmount}
              onChange={(value) =>
                setWalletDraft((prev) => ({ ...prev, grantAmount: value }))
              }
              placeholder='0'
            />
          </Field>
          <Field label={t('每月发放日')}>
            <Select
              value={walletDraft.grantDay}
              onChange={(value) =>
                setWalletDraft((prev) => ({ ...prev, grantDay: value }))
              }
              options={GRANT_DAY_OPTIONS.map((day) => ({
                value: String(day),
                label: t('每月 {{day}} 号', { day }),
              }))}
            />
          </Field>
          <Switch
            checked={walletDraft.autoGrant}
            onChange={(checked) =>
              setWalletDraft((prev) => ({ ...prev, autoGrant: checked }))
            }
            label={t('开启每月自动发放')}
          />
          <p className='text-xs text-muted-foreground'>
            {t(
              '发放时同时增加教学钱包余额与账户 API 额度；当月已发放过则不会重复发放。'
            )}
          </p>
        </div>
      </Modal>

      <Modal
        open={creating}
        title={t('新建账户')}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t('取消')}</Button>
            <Button variant='primary' disabled={busy} onClick={() => void handleCreate()}>
              {t('创建')}
            </Button>
          </>
        }
      >
        <div className='grid gap-3'>
          <Field label={t('角色')}>
            <Select
              value={newAccount.role}
              onChange={(value) =>
                setNewAccount((prev) => ({ ...prev, role: value }))
              }
              options={ROLE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
            />
          </Field>
          <Field label={t('用户名')}>
            <TextInput
              value={newAccount.username}
              onChange={(value) =>
                setNewAccount((prev) => ({ ...prev, username: value }))
              }
            />
          </Field>
          <Field label={t('密码（至少 6 位）')}>
            <TextInput
              type='password'
              value={newAccount.password}
              onChange={(value) =>
                setNewAccount((prev) => ({ ...prev, password: value }))
              }
            />
          </Field>
          <Field label={t('显示名称')}>
            <TextInput
              value={newAccount.display_name}
              onChange={(value) =>
                setNewAccount((prev) => ({ ...prev, display_name: value }))
              }
            />
          </Field>
          <Field label={t('初始总额度（点数）')}>
            <TextInput
              type='number'
              value={newAccount.quota}
              onChange={(value) =>
                setNewAccount((prev) => ({ ...prev, quota: value }))
              }
            />
          </Field>
          {isTeacherRole && (
            <div className='flex flex-col gap-3 rounded-lg border border-border p-3'>
              <p className='text-xs font-medium text-muted-foreground'>
                {t('教师点数发放（可稍后调整）')}
              </p>
              <Field label={t('每月发放点数')}>
                <TextInput
                  type='number'
                  value={newAccount.grantAmount}
                  onChange={(value) =>
                    setNewAccount((prev) => ({ ...prev, grantAmount: value }))
                  }
                  placeholder='0'
                />
              </Field>
              <Field label={t('每月发放日')}>
                <Select
                  value={newAccount.grantDay}
                  onChange={(value) =>
                    setNewAccount((prev) => ({ ...prev, grantDay: value }))
                  }
                  options={GRANT_DAY_OPTIONS.map((day) => ({
                    value: String(day),
                    label: t('每月 {{day}} 号', { day }),
                  }))}
                />
              </Field>
              <Switch
                checked={newAccount.autoGrant}
                onChange={(checked) =>
                  setNewAccount((prev) => ({ ...prev, autoGrant: checked }))
                }
                label={t('开启每月自动发放')}
              />
            </div>
          )}
        </div>
      </Modal>

      <SecureVerificationDialog {...verification.dialogProps} />
    </PageShell>
  )
}
