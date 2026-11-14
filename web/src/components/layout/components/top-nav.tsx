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
import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { type TopNavLink } from '../types'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: TopNavLink[]
}

/**
 * 桌面端带子项的自研下拉。
 *
 * 不使用浏览器原生 select：外层为普通按钮，点击展开绝对定位面板，点击面板外部自动收起。
 */
function DesktopNavDropdown({ link }: { link: TopNavLink }) {
  const [open, setOpen] = useState(false)
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

  return (
    <div ref={boxRef} className='relative'>
      <button
        type='button'
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'hover:text-primary inline-flex items-center gap-1 text-sm font-medium transition-colors',
          link.isActive ? '' : 'text-muted-foreground'
        )}
      >
        {link.title}
        <span className='text-[10px]'>▾</span>
      </button>
      {open && (
        <div className='absolute left-0 z-50 mt-1 min-w-[220px] rounded-md border border-border bg-card py-1 shadow-lg'>
          {(link.items ?? []).map((item) =>
            item.external ? (
              <a
                key={`${item.title}-${item.href}`}
                href={item.href}
                target='_blank'
                rel='noopener noreferrer'
                onClick={() => setOpen(false)}
                className='block truncate px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted'
              >
                {item.title}
              </a>
            ) : (
              <Link
                key={`${item.title}-${item.href}`}
                to={item.href}
                disabled={item.disabled}
                onClick={() => setOpen(false)}
                className='block truncate px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted'
              >
                {item.title}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 顶部导航栏组件
 * 在大屏幕显示水平导航，在小屏幕显示下拉菜单
 */
export function TopNav({ className, links, ...props }: TopNavProps) {
  // 规范化链接，确保所有可选属性都有默认值
  const normalizedLinks = useMemo(
    () =>
      links.map((link) => ({
        isActive: false,
        disabled: false,
        external: false,
        ...link,
      })),
    [links]
  )

  const hasItems = (link: TopNavLink) =>
    Array.isArray(link.items) && link.items.length > 0

  return (
    <>
      {/* 移动端下拉菜单 */}
      <div className='lg:hidden'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={<Button size='icon' variant='outline' className='size-7' />}
          >
            <Menu />
          </DropdownMenuTrigger>
          <DropdownMenuContent side='bottom' align='start'>
            {normalizedLinks.map((link) => {
              if (hasItems(link)) {
                return (
                  <DropdownMenuGroup key={`${link.title}-group`}>
                    <DropdownMenuLabel>{link.title}</DropdownMenuLabel>
                    {(link.items ?? []).map((item) => (
                      <DropdownMenuItem
                        key={`${item.title}-${item.href}`}
                        render={
                          item.external ? (
                            <a
                              href={item.href}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-muted-foreground'
                            >
                              {item.title}
                            </a>
                          ) : (
                            <Link
                              to={item.href}
                              className='text-muted-foreground'
                              disabled={item.disabled}
                            >
                              {item.title}
                            </Link>
                          )
                        }
                      />
                    ))}
                  </DropdownMenuGroup>
                )
              }

              return (
                <DropdownMenuItem
                  key={`${link.title}-${link.href}`}
                  render={
                    link.external ? (
                      <a
                        href={link.href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className={!link.isActive ? 'text-muted-foreground' : ''}
                      >
                        {link.title}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className={!link.isActive ? 'text-muted-foreground' : ''}
                        disabled={link.disabled}
                      >
                        {link.title}
                      </Link>
                    )
                  }
                />
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 桌面端水平导航 */}
      <nav
        className={cn(
          'hidden items-center space-x-4 lg:flex lg:space-x-4 xl:space-x-6',
          className
        )}
        {...props}
      >
        {normalizedLinks.map((link) => {
          if (hasItems(link)) {
            return (
              <DesktopNavDropdown
                key={`${link.title}-${link.href}`}
                link={link}
              />
            )
          }

          return link.external ? (
            <a
              key={`${link.title}-${link.href}`}
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              className={`hover:text-primary text-sm font-medium transition-colors ${link.isActive ? '' : 'text-muted-foreground'}`}
            >
              {link.title}
            </a>
          ) : (
            <Link
              key={`${link.title}-${link.href}`}
              to={link.href}
              disabled={link.disabled}
              className={`hover:text-primary text-sm font-medium transition-colors ${link.isActive ? '' : 'text-muted-foreground'}`}
            >
              {link.title}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
