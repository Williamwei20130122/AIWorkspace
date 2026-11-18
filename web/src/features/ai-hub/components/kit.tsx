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
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function PageShell(props: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto px-3 pt-3 pb-3 sm:px-4 sm:pt-5 sm:pb-4'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div className='min-w-0 flex-1'>
          <h1 className='text-foreground text-xl font-semibold'>
            {props.title}
          </h1>
          {props.description && (
            <p className='text-muted-foreground mt-1 text-sm'>
              {props.description}
            </p>
          )}
        </div>
        {props.actions && (
          <div className='flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2'>
            {props.actions}
          </div>
        )}
      </div>
      {props.children}
    </div>
  )
}

export function Panel(props: {
  title?: string
  description?: string
  actions?: ReactNode
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className='border-border bg-card rounded-xl border shadow-sm'>
      {(props.title || props.actions) && (
        <header className='border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
          <div>
            {props.title && (
              <h2 className='text-foreground text-sm font-semibold'>
                {props.title}
              </h2>
            )}
            {props.description && (
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {props.description}
              </p>
            )}
          </div>
          {props.actions && (
            <div className='flex items-center gap-2'>{props.actions}</div>
          )}
        </header>
      )}
      <div className={cn('p-4', props.bodyClassName)}>{props.children}</div>
    </section>
  )
}

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'

export function Button(props: {
  variant?: ButtonVariant
  disabled?: boolean
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const variant = props.variant ?? 'outline'
  return (
    <button
      type='button'
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' &&
          'bg-primary text-primary-foreground hover:opacity-90',
        variant === 'outline' &&
          'border border-border bg-background text-foreground hover:bg-accent',
        variant === 'ghost' && 'text-muted-foreground hover:bg-accent',
        variant === 'danger' &&
          'border border-destructive/40 text-destructive hover:bg-destructive/10',
        props.className
      )}
    >
      {props.children}
    </button>
  )
}

export function TextInput(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <input
      type={props.type ?? 'text'}
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onChange={(event) => props.onChange(event.target.value)}
      className={cn(
        'h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary',
        props.className
      )}
    />
  )
}

export function TextArea(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={props.value}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      onChange={(event) => props.onChange(event.target.value)}
      className='border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-md border px-2.5 py-2 text-[13px] outline-none'
    />
  )
}

// Select 与 Dropdown 同款自研下拉，仅保留历史调用名（不再使用浏览器原生 select）。
export function Select(props: {
  value: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  className?: string
  disabled?: boolean
  placeholder?: string
}) {
  return <Dropdown {...props} />
}

// Dropdown 自研下拉选择：不使用浏览器原生 select，样式与全站统一。
export function Dropdown(props: {
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // 下方空间不足时向上弹出（弹窗内 overflow 滚动容器会裁掉向下展开的面板）。
  const [up, setUp] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const current = props.options.find((one) => one.value === props.value)

  const toggleOpen = () => {
    if (!open && boxRef.current) {
      const rect = boxRef.current.getBoundingClientRect()
      // 面板最高 14rem（max-h-56）+ 间距；实际可用空间以最近的滚动容器为准
      // （弹窗正文是 overflow 容器，会裁掉向下展开的面板，即使窗口还有空间）。
      const panel = Math.min(224, props.options.length * 33 + 10) + 8
      let top = 0
      let bottom = window.innerHeight
      let el: HTMLElement | null = boxRef.current.parentElement
      while (el) {
        const style = getComputedStyle(el)
        if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
          const box = el.getBoundingClientRect()
          top = Math.max(top, box.top)
          bottom = Math.min(bottom, box.bottom)
          break
        }
        el = el.parentElement
      }
      const spaceBelow = bottom - rect.bottom
      const spaceAbove = rect.top - top
      setUp(spaceBelow < panel && spaceAbove > spaceBelow)
    }
    setOpen((prev) => !prev)
  }

  return (
    <div ref={boxRef} className={cn('relative', props.className)}>
      <button
        type='button'
        disabled={props.disabled}
        onClick={toggleOpen}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-primary',
          props.disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={cn('truncate', !current && 'text-muted-foreground')}>
          {current?.label ?? props.placeholder ?? '请选择'}
        </span>
        <span className='text-muted-foreground shrink-0 text-[10px]'>▾</span>
      </button>
      {open && !props.disabled && (
        <div
          className={cn(
            'absolute z-50 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg',
            up ? 'bottom-full mb-1' : 'mt-1'
          )}
        >
          {props.options.length === 0 && (
            <p className='text-muted-foreground px-3 py-2 text-xs'>
              暂无可选项
            </p>
          )}
          {props.options.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => {
                props.onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-muted',
                option.value === props.value
                  ? 'text-primary'
                  : 'text-foreground'
              )}
            >
              <span className='truncate'>{option.label}</span>
              {option.value === props.value && (
                <span className='shrink-0 text-[11px]'>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  // month 为 1-12，下一月第 0 天即本月最后一天
  return new Date(year, month, 0).getDate()
}

function parseYearMonth(value: string, fallback: Date): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '')
  if (!match) return [fallback.getFullYear(), fallback.getMonth() + 1]
  return [Number(match[1]), Number(match[2])]
}

function parseDateValue(
  value: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

// MonthPicker 自研年月选择：年 + 月两个下拉，产出 "YYYY-MM"。
export function MonthPicker(props: {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  yearsBack?: number
  yearsForward?: number
}) {
  const now = new Date()
  const [year, month] = parseYearMonth(props.value, now)
  const back = props.yearsBack ?? 5
  const forward = props.yearsForward ?? 1
  const yearOptions: { label: string; value: string }[] = []
  for (
    let y = now.getFullYear() + forward;
    y >= now.getFullYear() - back;
    y -= 1
  ) {
    yearOptions.push({ label: `${y} 年`, value: String(y) })
  }
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({
    label: `${index + 1} 月`,
    value: String(index + 1),
  }))
  return (
    <div className={cn('flex items-center gap-2', props.className)}>
      <Dropdown
        className='w-[104px]'
        value={String(year)}
        options={yearOptions}
        disabled={props.disabled}
        onChange={(next) => props.onChange(`${next}-${pad2(month)}`)}
      />
      <Dropdown
        className='w-[84px]'
        value={String(month)}
        options={monthOptions}
        disabled={props.disabled}
        onChange={(next) => props.onChange(`${year}-${pad2(Number(next))}`)}
      />
    </div>
  )
}

// DatePicker 自研日期选择：自绘日历浮层，产出 "YYYY-MM-DD"。
export function DatePicker(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const today = new Date()
  const parsed = parseDateValue(props.value)
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(
    parsed?.month ?? today.getMonth() + 1
  )
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    const current = parseDateValue(props.value)
    if (current) {
      setViewYear(current.year)
      setViewMonth(current.month)
    }
  }, [open, props.value])

  const shiftMonth = (delta: number) => {
    let year = viewYear
    let month = viewMonth + delta
    if (month < 1) {
      month = 12
      year -= 1
    } else if (month > 12) {
      month = 1
      year += 1
    }
    setViewYear(year)
    setViewMonth(month)
  }

  const total = daysInMonth(viewYear, viewMonth)
  const firstWeekday = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
  for (let day = 1; day <= total; day += 1) cells.push(day)

  const selectedText = parsed
    ? `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`
    : ''

  return (
    <div ref={boxRef} className={cn('relative', props.className)}>
      <button
        type='button'
        disabled={props.disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-primary',
          props.disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span
          className={cn('truncate', !selectedText && 'text-muted-foreground')}
        >
          {selectedText || props.placeholder || '请选择日期'}
        </span>
        <span className='text-muted-foreground shrink-0 text-[11px]'>📅</span>
      </button>
      {open && !props.disabled && (
        <div className='border-border bg-card absolute z-50 mt-1 w-[248px] rounded-md border p-2 shadow-lg'>
          <div className='mb-2 flex items-center justify-between'>
            <button
              type='button'
              onClick={() => shiftMonth(-1)}
              className='text-muted-foreground hover:bg-muted h-7 w-7 rounded-md'
            >
              ‹
            </button>
            <div className='flex items-center gap-1.5'>
              <Dropdown
                className='w-[92px]'
                value={String(viewYear)}
                options={Array.from({ length: 12 }, (_, i) => {
                  const y = today.getFullYear() - 8 + i
                  return { label: `${y} 年`, value: String(y) }
                })}
                onChange={(next) => setViewYear(Number(next))}
              />
              <Dropdown
                className='w-[76px]'
                value={String(viewMonth)}
                options={Array.from({ length: 12 }, (_, i) => ({
                  label: `${i + 1} 月`,
                  value: String(i + 1),
                }))}
                onChange={(next) => setViewMonth(Number(next))}
              />
            </div>
            <button
              type='button'
              onClick={() => shiftMonth(1)}
              className='text-muted-foreground hover:bg-muted h-7 w-7 rounded-md'
            >
              ›
            </button>
          </div>
          <div className='text-muted-foreground grid grid-cols-7 gap-1 text-center text-[11px]'>
            {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
              <span key={label} className='py-1'>
                {label}
              </span>
            ))}
          </div>
          <div className='grid grid-cols-7 gap-1'>
            {cells.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} />
              const value = `${viewYear}-${pad2(viewMonth)}-${pad2(day)}`
              const isSelected = value === selectedText
              const isToday =
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() + 1 &&
                day === today.getDate()
              return (
                <button
                  key={value}
                  type='button'
                  onClick={() => {
                    props.onChange(value)
                    setOpen(false)
                  }}
                  className={cn(
                    'h-7 rounded-md text-[12px] transition-colors hover:bg-muted',
                    isSelected
                      ? 'bg-primary text-primary-foreground hover:bg-primary'
                      : 'text-foreground',
                    !isSelected && isToday && 'text-primary font-medium'
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
          <div className='border-border mt-2 flex justify-between border-t pt-2'>
            <button
              type='button'
              onClick={() => {
                props.onChange('')
                setOpen(false)
              }}
              className='text-muted-foreground hover:bg-muted rounded-md px-2 py-1 text-[12px]'
            >
              清除
            </button>
            <button
              type='button'
              onClick={() => {
                const value = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
                props.onChange(value)
                setOpen(false)
              }}
              className='text-primary hover:bg-muted rounded-md px-2 py-1 text-[12px]'
            >
              今天
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// DateTimePicker 自研日期时间选择：日期日历 + 时/分下拉，产出 "YYYY-MM-DDTHH:mm"。
export function DateTimePicker(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const datePart = (props.value || '').slice(0, 10)
  const timeMatch = /T(\d{2}):(\d{2})/.exec(props.value || '')
  const hour = timeMatch ? Number(timeMatch[1]) : 0
  const minute = timeMatch ? Number(timeMatch[2]) : 0

  const emit = (nextDate: string, nextHour: number, nextMinute: number) => {
    if (!nextDate) {
      props.onChange('')
      return
    }
    props.onChange(`${nextDate}T${pad2(nextHour)}:${pad2(nextMinute)}`)
  }

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    label: `${pad2(i)} 时`,
    value: String(i),
  }))
  const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
    label: `${pad2(i)} 分`,
    value: String(i),
  }))

  return (
    <div className={cn('flex items-center gap-2', props.className)}>
      <DatePicker
        className='min-w-[150px] flex-1'
        value={datePart}
        disabled={props.disabled}
        placeholder={props.placeholder ?? '选择日期'}
        onChange={(next) => emit(next, hour, minute)}
      />
      <Dropdown
        className='w-[86px]'
        value={String(hour)}
        options={hourOptions}
        disabled={props.disabled || !datePart}
        onChange={(next) => emit(datePart, Number(next), minute)}
      />
      <Dropdown
        className='w-[86px]'
        value={String(minute)}
        options={minuteOptions}
        disabled={props.disabled || !datePart}
        onChange={(next) => emit(datePart, hour, Number(next))}
      />
    </div>
  )
}

export function Switch(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type='button'
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className='text-foreground inline-flex items-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50'
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          props.checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute h-3.5 w-3.5 rounded-full bg-white transition-transform',
            props.checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          )}
        />
      </span>
      {props.label && <span>{props.label}</span>}
    </button>
  )
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-muted-foreground text-xs font-medium'>
        {props.label}
      </span>
      {props.children}
    </label>
  )
}

export function Badge(props: {
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
  children: ReactNode
}) {
  const tone = props.tone ?? 'default'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'default' && 'bg-primary/10 text-primary',
        tone === 'success' && 'bg-emerald-500/12 text-emerald-600',
        tone === 'warning' && 'bg-amber-500/15 text-amber-600',
        tone === 'danger' && 'bg-destructive/12 text-destructive',
        tone === 'muted' && 'bg-muted text-muted-foreground'
      )}
    >
      {props.children}
    </span>
  )
}

export function Table(props: {
  headers: string[]
  children: ReactNode
  empty?: string
  isEmpty?: boolean
}) {
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[640px] border-collapse text-left text-[13px]'>
        <thead>
          <tr className='border-border text-muted-foreground border-b text-xs'>
            {props.headers.map((header) => (
              <th
                key={header}
                className='px-3 py-2 font-medium whitespace-nowrap'
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.isEmpty ? (
            <tr>
              <td
                colSpan={props.headers.length}
                className='text-muted-foreground px-3 py-8 text-center text-xs'
              >
                {props.empty ?? '暂无数据'}
              </td>
            </tr>
          ) : (
            props.children
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Td(props: { children: ReactNode; className?: string }) {
  return (
    <td
      className={cn('px-3 py-2 align-middle text-foreground', props.className)}
    >
      {props.children}
    </td>
  )
}

export function Modal(props: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  if (!props.open) return null
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='border-border bg-card w-full max-w-lg rounded-xl border shadow-xl'>
        <header className='border-border flex items-center justify-between border-b px-4 py-3'>
          <h3 className='text-foreground text-sm font-semibold'>
            {props.title}
          </h3>
          <button
            type='button'
            onClick={props.onClose}
            className='text-muted-foreground hover:text-foreground text-lg leading-none'
            aria-label='关闭'
          >
            ×
          </button>
        </header>
        <div className='max-h-[65vh] overflow-y-auto p-4'>{props.children}</div>
        {props.footer && (
          <footer className='border-border flex justify-end gap-2 border-t px-4 py-3'>
            {props.footer}
          </footer>
        )}
      </div>
    </div>
  )
}
