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
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CustomSelect } from '@/components/ui/native-select'
import {
  fetchWorkspaceCapabilities,
  fetchWorkspacePoints,
} from '@/features/workspace/api'
import { clearAuthenticatedClientState } from '@/lib/auth-session'
import { formatPoints } from '@/lib/format'
import { api } from '@/lib/http-client'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { startChatStream, type ChatStreamHandle } from '../api'
import { loadStudioStore, saveStudioStore } from '../storage'
import {
  createStudioConversation,
  createStudioId,
  deriveConversationTitle,
  type StudioMessage,
  type StudioSettings,
  type StudioStore,
} from '../types'
import { ChatComposer } from './chat-composer'
import { ChatThread } from './chat-thread'
import { ConversationSidebar } from './conversation-sidebar'
import { StudioSettingsDialog } from './studio-settings-dialog'

export function TeacherStudio() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const userId = user?.id

  const [store, setStore] = useState<StudioStore>(() => loadStudioStore(userId))
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const streamRef = useRef<ChatStreamHandle | null>(null)
  const loadedUserRef = useRef<number | undefined>(userId)

  const capabilitiesQuery = useQuery({
    queryKey: ['workspace', 'capabilities'],
    queryFn: fetchWorkspaceCapabilities,
  })
  const pointsQuery = useQuery({
    queryKey: ['workspace', 'points'],
    queryFn: fetchWorkspacePoints,
  })

  // 对话工作台只使用文生文能力，下拉选项取该能力下已对教师开放的模型。
  const textCapability = useMemo(
    () =>
      (capabilitiesQuery.data?.capabilities ?? []).find(
        (item) => item.kind === 'text'
      ),
    [capabilitiesQuery.data]
  )
  const modelOptions = useMemo(
    () => [...new Set(textCapability?.models ?? [])],
    [textCapability]
  )
  const defaultModel = textCapability?.models?.[0] ?? ''

  const active =
    store.conversations.find((item) => item.id === store.activeId) ??
    store.conversations[0]

  // 账号切换时重新载入本地会话快照
  useEffect(() => {
    if (userId === loadedUserRef.current) return
    loadedUserRef.current = userId
    setStore(loadStudioStore(userId))
  }, [userId])

  // 能力配置就绪后校正模型：为空或已不在开放列表里时回落到该能力的首个可选模型
  useEffect(() => {
    setStore((prev) => {
      const currentModel = prev.settings.model
      if (currentModel && modelOptions.includes(currentModel)) return prev
      if (!defaultModel) return prev
      return { ...prev, settings: { ...prev.settings, model: defaultModel } }
    })
  }, [defaultModel, modelOptions])

  useEffect(() => {
    saveStudioStore(userId, store)
  }, [userId, store])

  useEffect(
    () => () => {
      streamRef.current?.close()
    },
    []
  )

  const patchActiveMessages = (
    updater: (messages: StudioMessage[]) => StudioMessage[]
  ) => {
    setStore((prev) => ({
      ...prev,
      conversations: prev.conversations.map((conversation) =>
        conversation.id === prev.activeId
          ? {
              ...conversation,
              messages: updater(conversation.messages),
              updatedAt: Date.now(),
            }
          : conversation
      ),
    }))
  }

  const runStream = (
    requestMessages: StudioMessage[],
    assistantId: string,
    settings: StudioSettings
  ) => {
    setStreaming(true)
    streamRef.current = startChatStream(requestMessages, settings, {
      onDelta: (chunk, kind) => {
        patchActiveMessages((messages) =>
          messages.map((message) => {
            if (message.id !== assistantId) return message
            if (kind === 'reasoning') {
              return {
                ...message,
                reasoning: `${message.reasoning ?? ''}${chunk}`,
              }
            }
            return { ...message, content: `${message.content}${chunk}` }
          })
        )
      },
      onDone: () => {
        setStreaming(false)
        streamRef.current = null
        void queryClient.invalidateQueries({
          queryKey: ['workspace', 'points'],
        })
      },
      onError: (message) => {
        setStreaming(false)
        streamRef.current = null
        patchActiveMessages((messages) =>
          messages.map((item) =>
            item.id === assistantId ? { ...item, error: message } : item
          )
        )
      },
    })
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || streaming || !active) return

    const userMessage: StudioMessage = {
      id: createStudioId('user'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }
    const assistantMessage: StudioMessage = {
      id: createStudioId('ai'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: store.settings.model,
    }
    const isFirstMessage = active.messages.length === 0

    setStore((prev) => ({
      ...prev,
      conversations: prev.conversations.map((conversation) =>
        conversation.id === prev.activeId
          ? {
              ...conversation,
              title: isFirstMessage
                ? deriveConversationTitle(text)
                : conversation.title,
              messages: [
                ...conversation.messages,
                userMessage,
                assistantMessage,
              ],
              updatedAt: Date.now(),
            }
          : conversation
      ),
    }))
    setInput('')
    runStream(
      [...active.messages, userMessage],
      assistantMessage.id,
      store.settings
    )
  }

  const handleStop = () => {
    streamRef.current?.close()
    streamRef.current = null
    setStreaming(false)
  }

  const handleRegenerate = () => {
    if (streaming || !active) return
    let lastUserIndex = -1
    for (let index = active.messages.length - 1; index >= 0; index -= 1) {
      if (active.messages[index].role === 'user') {
        lastUserIndex = index
        break
      }
    }
    if (lastUserIndex < 0) return

    const requestMessages = active.messages.slice(0, lastUserIndex + 1)
    const assistantMessage: StudioMessage = {
      id: createStudioId('ai'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: store.settings.model,
    }

    setStore((prev) => ({
      ...prev,
      conversations: prev.conversations.map((conversation) =>
        conversation.id === prev.activeId
          ? {
              ...conversation,
              messages: [...requestMessages, assistantMessage],
              updatedAt: Date.now(),
            }
          : conversation
      ),
    }))
    runStream(requestMessages, assistantMessage.id, store.settings)
  }

  const handleCreate = () => {
    handleStop()
    const conversation = createStudioConversation()
    setStore((prev) => ({
      ...prev,
      conversations: [conversation, ...prev.conversations],
      activeId: conversation.id,
    }))
    setSidebarOpen(false)
  }

  const handleSelect = (id: string) => {
    handleStop()
    setStore((prev) => ({ ...prev, activeId: id }))
    setSidebarOpen(false)
  }

  const handleDelete = (id: string) => {
    setStore((prev) => {
      if (prev.conversations.length <= 1) {
        const replacement = createStudioConversation()
        return {
          ...prev,
          conversations: [replacement],
          activeId: replacement.id,
        }
      }
      const conversations = prev.conversations.filter((item) => item.id !== id)
      return {
        ...prev,
        conversations,
        activeId: prev.activeId === id ? conversations[0].id : prev.activeId,
      }
    })
  }

  const handleLogout = async () => {
    handleStop()
    try {
      await api.get('/api/user/logout')
    } catch {
      // 登出失败不阻断本地会话清理
    }
    clearAuthenticatedClientState(queryClient, false)
    await navigate({ to: '/sign-in' })
  }

  const sidebar = (
    <ConversationSidebar
      conversations={store.conversations}
      activeId={store.activeId}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onDelete={handleDelete}
    />
  )

  return (
    <div className='flex h-dvh w-full overflow-hidden bg-[#f6f6f9] text-[#191833]'>
      <aside className='hidden w-[292px] shrink-0 flex-col border-r border-[#eceafa] bg-white lg:flex'>
        <div className='flex items-center gap-2.5 border-b border-[#f1f0f9] px-4 py-4'>
          <span className='flex h-9 w-9 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-[13px] font-extrabold tracking-[.5px] text-white shadow-[0_8px_18px_-6px_rgba(108,92,231,.75)]'>
            AI
          </span>
          <div className='leading-tight'>
            <div className='text-[14.5px] font-bold tracking-[-.01em]'>
              {t('教师工作台')}
            </div>
            <div className='mt-[2px] text-[11px] text-[#8786a0]'>
              {t('专业版 · 对话式')}
            </div>
          </div>
        </div>
        <div className='min-h-0 flex-1'>{sidebar}</div>
        <div className='flex items-center justify-between gap-2 border-t border-[#f1f0f9] px-4 py-3'>
          <span className='truncate text-[12.5px] text-[#8a89a0]'>
            {user?.display_name || user?.username}
          </span>
          <button
            type='button'
            className='text-[12.5px] text-[#8a89a0] transition hover:text-[#dc2626]'
            onClick={() => void handleLogout()}
          >
            {t('退出')}
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className='fixed inset-0 z-40 lg:hidden'>
          <button
            type='button'
            aria-label={t('关闭')}
            className='absolute inset-0 cursor-default bg-[#17162b]/35 backdrop-blur-[2px]'
            onClick={() => setSidebarOpen(false)}
          />
          <div className='relative z-10 flex h-full w-[292px] flex-col border-r border-[#eceafa] bg-white shadow-[0_30px_70px_-30px_rgba(25,24,51,.85)]'>
            <div className='flex items-center gap-2.5 border-b border-[#f1f0f9] px-4 py-4'>
              <span className='flex h-9 w-9 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-[13px] font-extrabold text-white'>
                AI
              </span>
              <div className='leading-tight'>
                <div className='text-[14.5px] font-bold'>{t('教师工作台')}</div>
                <div className='mt-[2px] text-[11px] text-[#8786a0]'>
                  {t('专业版 · 对话式')}
                </div>
              </div>
            </div>
            <div className='min-h-0 flex-1'>{sidebar}</div>
          </div>
        </div>
      )}

      <main className='flex min-w-0 flex-1 flex-col'>
        <header className='flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#eceafa] bg-white px-4 sm:px-6'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <button
              type='button'
              aria-label={t('打开对话列表')}
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#e4e2f2] text-[15px] text-[#5f5e78] transition hover:border-[#cfc9f2] hover:text-[#4b3bc4] lg:hidden'
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <label className='flex min-w-0 shrink-0 items-center gap-2 rounded-[10px] border border-[#e4e2f2] bg-white py-[6px] pr-1.5 pl-3 shadow-[0_1px_2px_rgba(28,27,49,.05)] transition-[border-color,box-shadow] focus-within:border-[#6c5ce7] focus-within:shadow-[0_0_0_3px_rgba(108,92,231,.12)] hover:border-[#cfc9f2]'>
              <span className='h-[7px] w-[7px] shrink-0 rounded-full bg-[#22c55e] shadow-[0_0_0_3px_rgba(34,197,94,.16)]' />
              <CustomSelect
                aria-label={t('选择模型')}
                className='max-w-[180px] min-w-[92px] sm:max-w-[260px]'
                triggerClassName='max-w-[180px] min-w-[92px] cursor-pointer border-0 bg-transparent text-[12.5px] font-semibold text-[#3f3e57] outline-none sm:max-w-[260px]'
                align='end'
                menuClassName='min-w-[180px]'
                value={store.settings.model}
                onChange={(value) =>
                  setStore((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, model: value },
                  }))
                }
                options={
                  modelOptions.length === 0
                    ? [{ value: '', label: t('暂无可用模型') }]
                    : modelOptions.map((name) => ({ value: name, label: name }))
                }
              />
            </label>
            <span className='hidden shrink-0 rounded-full bg-[#f1eeff] px-3 py-1.5 text-[12px] font-semibold text-[#6c5ce7] tabular-nums sm:inline'>
              {formatPoints(pointsQuery.data?.quota)}
            </span>
          </div>

          <div className='flex shrink-0 items-center gap-2'>
            <Link
              className='hidden rounded-[9px] px-3 py-2 text-[12.5px] font-medium text-[#5f5e78] transition hover:bg-[#f3f2f9] hover:text-[#4b3bc4] sm:inline-block'
              to='/workspace'
            >
              {t('创作台')}
            </Link>
            <Link
              className='hidden rounded-[9px] px-3 py-2 text-[12.5px] font-medium text-[#5f5e78] transition hover:bg-[#f3f2f9] hover:text-[#4b3bc4] sm:inline-block'
              to='/dashboard'
            >
              {t('管理中心')}
            </Link>
            <button
              type='button'
              className={cn(
                'flex h-9 items-center gap-2 rounded-[10px] border border-[#e4e2f2] px-3.5 text-[12.5px] font-semibold text-[#5f5e78] transition hover:border-[#cfc9f2] hover:text-[#4b3bc4]'
              )}
              onClick={() => setSettingsOpen(true)}
            >
              {t('设置')}
            </button>
          </div>
        </header>

        <ChatThread
          messages={active?.messages ?? []}
          streaming={streaming}
          userName={user?.display_name || user?.username || '师'}
          onRegenerate={handleRegenerate}
          onPickPrompt={(prompt) => setInput(prompt)}
        />

        <ChatComposer
          value={input}
          streaming={streaming}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
        />
      </main>

      <StudioSettingsDialog
        open={settingsOpen}
        settings={store.settings}
        modelOptions={modelOptions}
        onClose={() => setSettingsOpen(false)}
        onChange={(next) => setStore((prev) => ({ ...prev, settings: next }))}
      />
    </div>
  )
}
