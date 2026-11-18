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
import { type SVGProps } from 'react'

import { cn } from '@/lib/utils'

export function IconWeCom({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role='img'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
      width='20'
      height='20'
      className={cn('fill-current', className)}
      {...props}
    >
      <title>WeCom</title>
      <path d='M12 2C6.477 2 2 5.94 2 10.8c0 2.79 1.5 5.28 3.85 6.89L5 22l4.36-2.29c.85.21 1.74.32 2.64.32 5.523 0 10-3.94 10-8.8S17.523 2 12 2Zm-4.2 5.85h8.4a.75.75 0 0 1 0 1.5H7.8a.75.75 0 0 1 0-1.5Zm0 3.6h8.4a.75.75 0 0 1 0 1.5H7.8a.75.75 0 0 1 0-1.5Z' />
    </svg>
  )
}
