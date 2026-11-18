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
import { UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import * as React from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/**
 * CustomSelect 自研下拉选择：不使用浏览器原生 select，浮层与选中态全部自绘，
 * 适用于产品端（创作台、教师端）与后台需要统一视觉的所有下拉。
 */
type CustomSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

type CustomSelectProps = {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  placeholder?: string
  /** 外层容器样式（控制宽度、外边距等）。 */
  className?: string
  /** 触发器按钮样式（控制边框、配色、字号等）。 */
  triggerClassName?: string
  menuClassName?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  align?: 'start' | 'end'
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = '请选择',
  className,
  triggerClassName,
  menuClassName,
  size = 'default',
  disabled,
  id,
  align = 'start',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: CustomSelectProps) {
  const [open, setOpen] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  // 菜单用 Portal 渲染到 body：脱离祖先的 overflow-hidden 裁剪，
  // 也脱离带 transform 的祖先（transform 会成为 fixed 的包含块，使坐标整体偏移）。
  // 坐标按视口由 JS 计算：空间不足时向上弹出。
  const [pos, setPos] = React.useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const [dropUp, setDropUp] = React.useState(false)

  const menuHeight =
    options.length === 0 ? 44 : Math.min(options.length, 7) * 37 + 8
  const gap = 6

  const positionMenu = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - gap
    const up = spaceBelow < menuHeight && rect.top > spaceBelow
    setDropUp(up)
    setPos({
      left: align === 'end' ? rect.right : rect.left,
      width: rect.width,
      top: up ? rect.top - gap - menuHeight : rect.bottom + gap,
    })
  }, [align, menuHeight])

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    positionMenu()
  }, [open, options.length, positionMenu])

  // 打开期间：滚动或缩放窗口时实时跟随；点到组件外则收起。
  React.useEffect(() => {
    if (!open) return
    const onDocPointer = (event: Event) => {
      const target = event.target as Node | null
      if (
        boxRef.current &&
        target &&
        !boxRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const sync = () => positionMenu()
    document.addEventListener('mousedown', onDocPointer)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [open, positionMenu])

  const current = options.find((option) => option.value === value)

  return (
    <div
      ref={boxRef}
      className={cn(
        'group/custom-select relative w-full',
        disabled && 'opacity-50',
        className
      )}
      data-slot='custom-select-wrapper'
      data-size={size}
    >
      <button
        type='button'
        ref={triggerRef}
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-haspopup='listbox'
        aria-expanded={open}
        data-slot='custom-select-trigger'
        data-size={size}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'border-input text-foreground flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-7 data-[size=sm]:rounded-md',
          open && 'border-ring',
          triggerClassName
        )}
      >
        <span
          className={cn(
            'truncate text-left',
            !current && 'text-muted-foreground'
          )}
        >
          {current?.label ?? placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className='text-muted-foreground pointer-events-none size-4 shrink-0 select-none'
          aria-hidden='true'
        />
      </button>
      {open &&
        !disabled &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role='listbox'
            data-slot='custom-select-menu'
            data-placement={dropUp ? 'top' : 'bottom'}
            className={cn(
              'bg-card border-border fixed z-50 max-h-56 overflow-y-auto rounded-lg border py-1 shadow-lg',
              menuClassName
            )}
            style={{
              left: pos.left,
              top: pos.top,
              minWidth: pos.width,
              width: 'max-content',
              transform: align === 'end' ? 'translateX(-100%)' : undefined,
            }}
          >
            {options.length === 0 && (
              <p className='text-muted-foreground px-3 py-2 text-xs'>
                暂无可选项
              </p>
            )}
            {options.map((option) => (
              <button
                key={option.value}
                type='button'
                role='option'
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-sm whitespace-nowrap transition-colors',
                  option.value === value && 'text-primary font-medium',
                  option.disabled && 'pointer-events-none opacity-50'
                )}
              >
                <span className='flex-1 truncate'>{option.label}</span>
                {option.value === value && (
                  <span className='text-primary shrink-0 text-xs'>✓</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

export { CustomSelect }
export type { CustomSelectOption, CustomSelectProps }
