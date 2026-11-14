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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'

import { larkLogin, weComLogin } from '../api'
import {
  buildLarkAuthorizeUrl,
  buildWeComAuthorizeUrl,
  createQrOAuthState,
  openQrOAuthWindow,
  resolveOAuthCallbackUri,
  type QrOAuthProvider,
} from '../lib/oauth-qr'
import type { SystemStatus } from '../types'
import { useAuthRedirect } from './use-auth-redirect'

/**
 * QR-code sign-in for WeCom and Lark. Opens the provider authorization page in
 * a popup and completes the login when the code returns.
 */
export function useQrOAuthLogin(
  status: SystemStatus | null,
  redirectTo?: string
) {
  const { t } = useTranslation()
  const [loadingProvider, setLoadingProvider] =
    useState<QrOAuthProvider | null>(null)
  const operation = useRef<AbortController | null>(null)
  const { handleLoginResult } = useAuthRedirect()

  useEffect(() => () => operation.current?.abort(), [])

  const handleQrLogin = useCallback(
    async (provider: QrOAuthProvider) => {
      if (operation.current) return
      const controller = new AbortController()
      operation.current = controller
      setLoadingProvider(provider)
      try {
        const redirectUri = resolveOAuthCallbackUri(status?.server_address)
        const state = createQrOAuthState(provider, 'login')
        let url: string
        if (provider === 'wecom') {
          const corpId = status?.wecom_corp_id?.trim() ?? ''
          const agentId = status?.wecom_agent_id?.trim() ?? ''
          if (!corpId || !agentId) {
            throw new AuthOperationError('WeCom login is not configured.')
          }
          url = buildWeComAuthorizeUrl({ corpId, agentId, redirectUri, state })
        } else {
          const appId = status?.lark_app_id?.trim() ?? ''
          if (!appId) {
            throw new AuthOperationError('Lark login is not configured.')
          }
          url = buildLarkAuthorizeUrl({
            appId,
            domain: status?.lark_domain,
            redirectUri,
            state,
          })
        }
        const { code } = await openQrOAuthWindow({
          url,
          provider,
          mode: 'login',
          state,
          signal: controller.signal,
        })
        controller.signal.throwIfAborted()
        const res =
          provider === 'wecom' ? await weComLogin(code) : await larkLogin(code)
        if (res?.success) {
          if (await handleLoginResult(res.data, redirectTo)) {
            toast.success(
              provider === 'wecom'
                ? t('Signed in via WeCom')
                : t('Signed in via Lark')
            )
          }
        } else {
          handleServerError(createServerError(res, t('Login failed')))
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        handleServerError(AuthOperationError.from(error, t('Login failed')))
      } finally {
        if (operation.current === controller) {
          operation.current = null
          setLoadingProvider(null)
        }
      }
    },
    [handleLoginResult, redirectTo, status, t]
  )

  return { loadingProvider, handleQrLogin }
}
