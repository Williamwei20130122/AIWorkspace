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
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'

import type { StudioMessage } from '../types'

interface ChatThreadProps {
  messages: StudioMessage[]
  streaming: boolean
  userName: string
  onRegenerate: () => void
  onPickPrompt: (prompt: string) => void
}

const SUGGESTIONS = [
  '帮我把这节课的知识点整理成一份板书提纲',
  '围绕「光合作用」出 5 道选择题并给出答案解析',
  '把这段文言文翻译成白话文，并标注重点字词',
  '设计一个 10 分钟的课堂小组活动方案',
]

function MessageActions(props: {
  message: StudioMessage
  canRegenerate: boolean
  onRegenerate: () => void
}) {
  const { t } = useTranslation()
  const { message } = props
  if (message.role !== 'assistant' || message.error || !message.content) {
    return null
  }
  return (
    <div className='mt-2.5 flex items-center gap-1'>
      <button
        type='button'
        className='rounded-[7px] px-2 py-1 text-[11.5px] text-[#8a89a0] transition hover:bg-[#f1f0f9] hover:text-[#4b3bc4]'
        onClick={() => void navigator.clipboard?.writeText(message.content)}
      >
        {t('复制')}
      </button>
      {props.canRegenerate && (
        <button
          type='button'
          className='rounded-[7px] px-2 py-1 text-[11.5px] text-[#8a89a0] transition hover:bg-[#f1f0f9] hover:text-[#4b3bc4]'
          onClick={props.onRegenerate}
        >
          {t('重新生成')}
        </button>
      )}
    </div>
  )
}

export function ChatThread(props: ChatThreadProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  const lastIndex = props.messages.length - 1

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !stickToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [props.messages, props.streaming])

  const handleScroll = () => {
    const node = scrollRef.current
    if (!node) return
    stickToBottom.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 120
  }

  if (props.messages.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center px-6 py-10'>
        <div className='w-full max-w-[620px] text-center'>
          <span className='mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-[20px] font-extrabold text-white shadow-[0_18px_36px_-16px_rgba(108,92,231,.95)]'>
            AI
          </span>
          <h1 className='mt-5 text-[26px] font-extrabold tracking-[-.02em] text-[#17162b]'>
            {t('今天想和 AI 聊点什么？')}
          </h1>
          <p className='mt-2.5 text-[13.5px] leading-[1.7] text-[#77768c]'>
            {t(
              '这是教师专业版的对话工作台，支持多轮上下文、流式回复与随时中断。'
            )}
          </p>
          <div className='mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2'>
            {SUGGESTIONS.map((prompt) => (
              <button
                key={prompt}
                type='button'
                className='rounded-[14px] border border-[#e9e7f8] bg-white px-4 py-3.5 text-left text-[12.5px] leading-[1.6] text-[#3f3e57] transition hover:-translate-y-[2px] hover:border-[#cfc9f2] hover:shadow-[0_18px_34px_-26px_rgba(25,24,51,.7)]'
                onClick={() => props.onPickPrompt(t(prompt))}
              >
                {t(prompt)}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className='min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#ddd9f0] [&::-webkit-scrollbar-track]:bg-transparent'
      onScroll={handleScroll}
    >
      <div className='mx-auto flex max-w-[880px] flex-col gap-6'>
        {props.messages.map((message, index) => {
          const isUser = message.role === 'user'
          const isStreamingHere =
            props.streaming && index === lastIndex && !isUser
          const canRegenerate =
            !props.streaming && index === lastIndex && !isUser

          let body: ReactNode = null
          if (isUser) {
            body = message.content
          } else if (message.content) {
            body = (
              <Markdown breaks className='text-[14px]'>
                {message.content}
              </Markdown>
            )
          } else if (isStreamingHere) {
            body = (
              <span className='text-[13.5px] text-[#a3a2b8]'>
                {t('正在思考…')}
              </span>
            )
          }

          return (
            <div
              key={message.id}
              className={cn('flex gap-3.5', isUser && 'flex-row-reverse')}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[13px] font-bold',
                  isUser
                    ? 'bg-[#eef0f6] text-[#5f5e78]'
                    : 'bg-gradient-to-br from-[#8b7bf5] to-[#5b4bd6] text-white shadow-[0_10px_20px_-12px_rgba(108,92,231,.95)]'
                )}
              >
                {isUser ? props.userName.slice(0, 1) || '师' : 'AI'}
              </span>

              <div
                className={cn(
                  'min-w-0 max-w-[calc(100%-3.25rem)]',
                  isUser ? 'items-end text-right' : ''
                )}
              >
                {(message.content || message.reasoning || isStreamingHere) && (
                  <div
                    className={cn(
                      'inline-block rounded-[16px] px-4 py-3 text-left text-[14px] leading-[1.8]',
                      isUser
                        ? 'whitespace-pre-wrap bg-[#6c5ce7] text-white shadow-[0_14px_30px_-18px_rgba(108,92,231,.95)]'
                        : 'border border-[#eceafa] bg-white text-[#23223a] shadow-[0_18px_40px_-32px_rgba(25,24,51,.9)]'
                    )}
                  >
                    {message.reasoning && (
                      <details className='mb-2 rounded-[10px] bg-[#f7f6fd] px-3 py-2'>
                        <summary className='cursor-pointer text-[11.5px] font-semibold text-[#8a89a0]'>
                          {t('思考过程')}
                        </summary>
                        <p className='mt-1.5 text-[12px] leading-[1.7] whitespace-pre-wrap text-[#6f6e85]'>
                          {message.reasoning}
                        </p>
                      </details>
                    )}

                    {body}

                    {isStreamingHere && message.content && (
                      <span className='ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-[#6c5ce7] align-middle' />
                    )}
                  </div>
                )}

                {message.error && (
                  <div
                    className={cn(
                      'rounded-[12px] border border-[#fee2e2] bg-[#fef2f2] px-4 py-3 text-left text-[12.5px] text-[#dc2626]',
                      (message.content || message.reasoning) && 'mt-2'
                    )}
                  >
                    {message.error}
                  </div>
                )}

                <MessageActions
                  message={message}
                  canRegenerate={canRegenerate}
                  onRegenerate={props.onRegenerate}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
