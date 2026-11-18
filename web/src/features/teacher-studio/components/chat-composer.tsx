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
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ChatComposerProps {
  value: string
  streaming: boolean
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

const MAX_HEIGHT = 200

export function ChatComposer(props: ChatComposerProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`
  }, [props.value])

  const canSend = props.value.trim().length > 0 && !props.streaming

  return (
    <div className='shrink-0 border-t border-[#eceafa] bg-white px-4 py-3.5 sm:px-6 sm:py-4'>
      <div className='mx-auto w-full max-w-[880px]'>
        <div className='flex items-end gap-2.5 rounded-[16px] border border-[#e4e2f2] bg-white p-2 pl-4 shadow-[0_18px_40px_-34px_rgba(25,24,51,.95)] transition focus-within:border-[#6c5ce7] focus-within:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'>
          <textarea
            ref={textareaRef}
            rows={1}
            className='max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[14px] leading-[1.7] text-[#1c1b31] outline-none placeholder:text-[#b0aec4]'
            placeholder={t('输入消息，Enter 发送，Shift + Enter 换行')}
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return
              }
              event.preventDefault()
              if (canSend) props.onSend()
            }}
          />
          {props.streaming ? (
            <button
              type='button'
              className='flex h-[40px] shrink-0 items-center gap-2 rounded-[12px] border border-[#e4e2f2] bg-white px-4 text-[13px] font-semibold text-[#5f5e78] transition hover:border-[#cfc9f2] hover:text-[#4b3bc4]'
              onClick={props.onStop}
            >
              <span className='h-[9px] w-[9px] rounded-[2px] bg-[#6c5ce7]' />
              {t('停止生成')}
            </button>
          ) : (
            <button
              type='button'
              className='flex h-[40px] shrink-0 items-center gap-2 rounded-[12px] bg-gradient-to-br from-[#7c6cf2] to-[#5b4bd6] px-5 text-[13.5px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(108,92,231,.95)] transition hover:brightness-[1.06] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50'
              disabled={!canSend}
              onClick={props.onSend}
            >
              {t('发送')}
            </button>
          )}
        </div>
        <p className='mt-2 text-center text-[11px] text-[#a3a2b8]'>
          {t('每次成功生成会消耗课堂点数，失败不计费。')}
        </p>
      </div>
    </div>
  )
}
