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

import { formatPoints } from '@/lib/format'

import {
  fetchTeacherWallets,
  grantTeacherWallet,
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
import type { AiHubTeacherWallet } from '../types'

const GRANT_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => index + 1)

interface WalletDraft {
  userId: number
  username: string
  grantAmount: string
  grantDay: string
  autoGrant: boolean
}

export function TeacherWalletsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<WalletDraft | null>(null)
  const [grantTarget, setGrantTarget] = useState<AiHubTeacherWallet | null>(null)
  const [grantAmount, setGrantAmount] = useState('')

  const walletsQuery = useQuery({
    queryKey: ['ai-hub', 'teacher-wallets'],
    queryFn: fetchTeacherWallets,
  })
  const wallets = walletsQuery.data ?? []

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['ai-hub', 'teacher-wallets'],
    })
  }

  const openEdit = (wallet: AiHubTeacherWallet) => {
    setEditing({
      userId: wallet.user_id,
      username: wallet.username,
      grantAmount: String(wallet.grant_amount ?? 0),
      grantDay: String(wallet.grant_day || 15),
      autoGrant: wallet.auto_grant,
    })
  }

  const handleSave = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await saveTeacherWallet({
        userId: editing.userId,
        grantAmount: Number(editing.grantAmount) || 0,
        grantDay: Number(editing.grantDay) || 15,
        autoGrant: editing.autoGrant,
      })
      await refresh()
      toast.success(t('发放配置已保存'))
      setEditing(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleGrant = async () => {
    if (!grantTarget) return
    const amount = Number(grantAmount)
    if (!amount || amount <= 0) {
      toast.error(t('发放点数必须大于 0'))
      return
    }
    setBusy(true)
    try {
      await grantTeacherWallet(grantTarget.user_id, amount)
      await refresh()
      toast.success(
        t('已向 {{name}} 发放 {{points}} 点（教学钱包与 API 额度同步加值）', {
          name: grantTarget.username,
          points: formatPoints(amount),
        })
      )
      setGrantTarget(null)
      setGrantAmount('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('发放失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell
      title={t('教师点数钱包')}
      description={t(
        '为每位教师配置每月固定日期自动发放的教学点数，发放时同时给中台钱包与 API 额度加值。教师使用时优先消耗教学钱包，不占用自身的 API 额度。'
      )}
    >
      <Panel title={t('教师钱包')}>
        <Table
          headers={[
            t('教师'),
            t('教学钱包余额'),
            t('API 可用额度'),
            t('每月发放'),
            t('发放日'),
            t('自动发放'),
            t('上次发放'),
            t('操作'),
          ]}
          isEmpty={wallets.length === 0}
          empty={t('暂无教师账号')}
        >
          {wallets.map((wallet) => (
            <tr key={wallet.user_id} className='border-b border-border/60'>
              <Td>{wallet.username}</Td>
              <Td className='font-mono tabular-nums'>
                {formatPoints(wallet.balance ?? 0)}
              </Td>
              <Td className='font-mono tabular-nums'>
                {formatPoints(wallet.api_quota ?? 0)}
              </Td>
              <Td className='font-mono tabular-nums'>
                {wallet.grant_amount > 0
                  ? formatPoints(wallet.grant_amount)
                  : '—'}
              </Td>
              <Td>{wallet.grant_day ? `${wallet.grant_day} 号` : '—'}</Td>
              <Td>
                {wallet.auto_grant ? (
                  <Badge tone='success'>{t('已开启')}</Badge>
                ) : (
                  <Badge tone='muted'>{t('已关闭')}</Badge>
                )}
              </Td>
              <Td>{wallet.last_grant_month || '—'}</Td>
              <Td className='whitespace-nowrap'>
                <div className='flex gap-2'>
                  <Button onClick={() => openEdit(wallet)}>{t('配置')}</Button>
                  <Button
                    variant='primary'
                    onClick={() => {
                      setGrantTarget(wallet)
                      setGrantAmount('')
                    }}
                  >
                    {t('发放点数')}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Modal
        open={editing !== null}
        title={t('发放配置 · {{name}}', { name: editing?.username ?? '' })}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('取消')}</Button>
            <Button variant='primary' disabled={busy} onClick={handleSave}>
              {t('保存')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className='flex flex-col gap-4'>
            <Field label={t('每月发放点数')}>
              <TextInput
                type='number'
                value={editing.grantAmount}
                onChange={(value) =>
                  setEditing({ ...editing, grantAmount: value })
                }
                placeholder='0'
              />
            </Field>
            <Field label={t('每月发放日')}>
              <Select
                value={editing.grantDay}
                onChange={(value) => setEditing({ ...editing, grantDay: value })}
                options={GRANT_DAY_OPTIONS.map((day) => ({
                  value: String(day),
                  label: t('每月 {{day}} 号', { day }),
                }))}
              />
            </Field>
            <Switch
              checked={editing.autoGrant}
              onChange={(checked) =>
                setEditing({ ...editing, autoGrant: checked })
              }
              label={t('开启每月自动发放')}
            />
            <p className='text-xs text-muted-foreground'>
              {t(
                '发放时同时增加教学钱包余额与账户 API 额度；当月已发放过则不会重复发放。'
              )}
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={grantTarget !== null}
        title={t('发放点数 · {{name}}', { name: grantTarget?.username ?? '' })}
        onClose={() => setGrantTarget(null)}
        footer={
          <>
            <Button onClick={() => setGrantTarget(null)}>{t('取消')}</Button>
            <Button variant='primary' disabled={busy} onClick={handleGrant}>
              {t('确认发放')}
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <Field label={t('发放点数')}>
            <TextInput
              type='number'
              value={grantAmount}
              onChange={setGrantAmount}
              placeholder='0'
            />
          </Field>
          <p className='text-xs text-muted-foreground'>
            {t(
              '发放的点数会同时加入教学钱包与账户 API 额度，教师可自由用于教学生成并参与结算。'
            )}
          </p>
        </div>
      </Modal>
    </PageShell>
  )
}
