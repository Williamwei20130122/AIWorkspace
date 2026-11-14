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
import { AuthOperationError } from '@/lib/secure-verification'

import { OAUTH_QR_CALLBACK_MESSAGE, OAUTH_QR_STATE_PREFIX } from '../constants'
import { watchOAuthPopupClosed } from './oauth-bind-window'

export type QrOAuthProvider = 'wecom' | 'lark'
export type QrOAuthMode = 'login' | 'bind'

export interface QrOAuthCallback {
  code: string
  state: string
}

interface QrOAuthCallbackMessage {
  type?: string
  provider?: string
  mode?: string
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

const QR_POPUP_WINDOW_FEATURES = 'width=520,height=640'
const QR_CALLBACK_TIMEOUT_MS = 10 * 60_000

function createNonce(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Build the state value shared with the callback page. The page parses it back
 * into `provider` and `mode`, so the format must stay stable.
 */
export function createQrOAuthState(
  provider: QrOAuthProvider,
  mode: QrOAuthMode
): string {
  return `${OAUTH_QR_STATE_PREFIX}:${provider}:${mode}:${createNonce()}`
}

/**
 * Both providers must redirect to the static callback page served by the site.
 * Prefer the configured server address, falling back to the current origin.
 */
export function resolveOAuthCallbackUri(
  serverAddress?: string | null
): string {
  const base =
    (serverAddress ?? '').trim().replace(/\/+$/, '') || window.location.origin
  return `${base}/oauth-callback.html`
}

export function buildWeComAuthorizeUrl(params: {
  corpId: string
  agentId: string
  redirectUri: string
  state: string
}): string {
  const query = [
    `appid=${encodeURIComponent(params.corpId)}`,
    `agentid=${encodeURIComponent(params.agentId)}`,
    `redirect_uri=${encodeURIComponent(params.redirectUri)}`,
    `state=${encodeURIComponent(params.state)}`,
  ].join('&')
  return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?${query}`
}

export function buildLarkAuthorizeUrl(params: {
  appId: string
  domain?: string | null
  redirectUri: string
  state: string
}): string {
  const base =
    params.domain === 'lark'
      ? 'https://accounts.larksuite.com'
      : 'https://accounts.feishu.cn'
  const query = [
    `client_id=${encodeURIComponent(params.appId)}`,
    'response_type=code',
    `redirect_uri=${encodeURIComponent(params.redirectUri)}`,
    `scope=${encodeURIComponent('contact:user.base:readonly offline_access')}`,
    `state=${encodeURIComponent(params.state)}`,
  ].join('&')
  return `${base}/open-apis/authen/v1/authorize?${query}`
}

export interface OpenQrOAuthWindowOptions {
  url: string
  provider: QrOAuthProvider
  mode: QrOAuthMode
  state: string
  signal?: AbortSignal
}

/**
 * Open the provider authorization page in a popup and resolve once the static
 * callback page hands the authorization code back. A popup (rather than an
 * iframe) is required because the callback page relies on `window.opener` and
 * providers commonly block framing via CSP / X-Frame-Options.
 */
export function openQrOAuthWindow(
  options: OpenQrOAuthWindowOptions
): Promise<QrOAuthCallback> {
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason)
  }
  const popup = window.open(options.url, '_blank', QR_POPUP_WINDOW_FEATURES)
  if (!popup) {
    return Promise.reject(new AuthOperationError('OAuth pop-up was blocked'))
  }
  return new Promise<QrOAuthCallback>((resolve, reject) => {
    let finished = false
    let stopCloseWatcher: (() => void) | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      options.signal?.removeEventListener('abort', onAbort)
      stopCloseWatcher?.()
      if (deadline !== undefined) clearTimeout(deadline)
    }
    const fail = (error: unknown) => {
      if (finished) return
      finished = true
      cleanup()
      if (!popup.closed) popup.close()
      reject(AuthOperationError.from(error))
    }
    const onAbort = () => fail(options.signal?.reason)
    const onMessage = (event: MessageEvent<unknown>) => {
      if (finished) return
      if (event.origin !== window.location.origin) return
      const message = event.data as QrOAuthCallbackMessage | null
      if (!message || message.type !== OAUTH_QR_CALLBACK_MESSAGE) return
      if (
        message.provider !== options.provider ||
        message.mode !== options.mode ||
        message.state !== options.state
      ) {
        return
      }
      if (typeof message.error === 'string' && message.error) {
        fail(
          new AuthOperationError(
            message.errorDescription || 'OAuth authorization failed.'
          )
        )
        return
      }
      if (typeof message.code !== 'string' || !message.code) {
        fail(new AuthOperationError('OAuth authorization was cancelled.'))
        return
      }
      finished = true
      cleanup()
      if (!popup.closed) popup.close()
      resolve({ code: message.code, state: options.state })
    }

    window.addEventListener('message', onMessage)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    deadline = setTimeout(
      () =>
        fail(
          new AuthOperationError(
            'OAuth authorization timed out. Please try again.'
          )
        ),
      QR_CALLBACK_TIMEOUT_MS
    )
    stopCloseWatcher = watchOAuthPopupClosed(popup, () =>
      fail(
        new AuthOperationError(
          'OAuth authorization was cancelled.',
          'AUTH_CANCELLED'
        )
      )
    )
  })
}
