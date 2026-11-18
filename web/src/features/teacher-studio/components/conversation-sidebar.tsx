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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatTimestampRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { StudioConversation } from '../types'

interface ConversationSidebarProps {
  conversations: StudioConversation[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function ConversationSidebar(props: ConversationSidebarProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')

  const visible = useMemo(() => {
    const sorted = [...props.conversations].sort(
      (a, b) => b.updatedAt - a.updatedAt
    )
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed) return sorted
    return sorted.filter((item) => item.title.toLowerCase().includes(trimmed))
  }, [props.conversations, keyword])

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='shrink-0 px-4 pt-4 pb-3'>
        <button
          type='button'
          className='flex h-[42px] w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-br from-[#7c6cf2] to-[#5b4bd6] text-[13.5px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(108,92,231,.95)] transition hover:brightness-[1.06] active:brightness-95'
          onClick={props.onCreate}
        >
          <span className='text-[16px] leading-none'>＋</span>
          {t('新建对话')}
        </button>
        <div className='relative mt-3'>
          <input
            className='h-[38px] w-full rounded-[10px] border border-[#e4e2f2] bg-[#fafaff] pr-3.5 pl-3.5 text-[13px] text-[#1c1b31] transition outline-none placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:bg-white focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
            placeholder={t('搜索对话')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#ddd9f0] [&::-webkit-scrollbar-track]:bg-transparent'>
        {visible.length === 0 && (
          <p className='px-3 py-6 text-center text-[12.5px] text-[#a3a2b8]'>
            {t('没有匹配的对话')}
          </p>
        )}
        {visible.map((conversation) => {
          const active = conversation.id === props.activeId
          const last = conversation.messages.at(-1)
          const preview =
            last?.content?.replaceAll(/\s+/g, ' ').slice(0, 40) ?? ''
          return (
            <div
              key={conversation.id}
              className={cn(
                'group relative mb-1 flex cursor-pointer items-start gap-2.5 rounded-[11px] px-3 py-2.5 transition',
                active
                  ? 'bg-[#f1eeff] shadow-[inset_0_0_0_1px_#ded7fb]'
                  : 'hover:bg-[#f7f6fd]'
              )}
              onClick={() => props.onSelect(conversation.id)}
            >
              <span
                className={cn(
                  'mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full',
                  active ? 'bg-[#6c5ce7]' : 'bg-[#ddd9f0]'
                )}
              />
              <div className='min-w-0 flex-1'>
                <div
                  className={cn(
                    'truncate text-[13.5px] font-medium',
                    active ? 'text-[#4b3bc4]' : 'text-[#2a2941]'
                  )}
                >
                  {conversation.title}
                </div>
                <div className='mt-1 flex items-center gap-2 text-[11px] text-[#a3a2b8]'>
                  <span className='shrink-0'>
                    {formatTimestampRelative(conversation.updatedAt / 1000)}
                  </span>
                  {preview && <span className='truncate'>{preview}</span>}
                </div>
              </div>
              <button
                type='button'
                aria-label={t('删除对话')}
                className='absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-[7px] text-[13px] text-[#a3a2b8] transition group-hover:flex hover:bg-[#fdeeee] hover:text-[#dc2626]'
                onClick={(event) => {
                  event.stopPropagation()
                  props.onDelete(conversation.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
