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
  createStudioConversation,
  STUDIO_DEFAULT_SETTINGS,
  type StudioConversation,
  type StudioSettings,
  type StudioStore,
} from './types'

const STORAGE_PREFIX = 'aiworkspace:teacher-studio'

function storageKey(userId: number | undefined): string {
  return `${STORAGE_PREFIX}:${userId ?? 'anonymous'}`
}

function isConversation(value: unknown): value is StudioConversation {
  const candidate = value as StudioConversation
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.messages)
  )
}

/** 读取本地会话快照；损坏或结构不符时回落到单个空会话。 */
export function loadStudioStore(userId: number | undefined): StudioStore {
  const empty: StudioStore = {
    conversations: [createStudioConversation()],
    activeId: '',
    settings: { ...STUDIO_DEFAULT_SETTINGS },
  }
  empty.activeId = empty.conversations[0].id

  if (typeof window === 'undefined') return empty

  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StudioStore>
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations.filter(isConversation)
      : []
    if (conversations.length === 0) return empty

    const settings: StudioSettings = {
      ...STUDIO_DEFAULT_SETTINGS,
      ...parsed.settings,
    }
    const activeId = conversations.some((item) => item.id === parsed.activeId)
      ? (parsed.activeId as string)
      : conversations[0].id

    return { conversations, activeId, settings }
  } catch {
    return empty
  }
}

export function saveStudioStore(
  userId: number | undefined,
  store: StudioStore
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(store))
  } catch {
    // 本地存储不可用（隐私模式 / 配额耗尽）时静默降级为仅内存态
  }
}
