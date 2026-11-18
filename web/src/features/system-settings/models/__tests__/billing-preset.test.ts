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
import { assert, describe, expect, test } from 'vitest'

import { compileBillingExpression } from '@/features/pricing/lib/billing-expression/parser'

import { GENERATION_PRESET_GROUPS, TASK_PRESET_GROUPS } from '../generation-preset-groups'

function usageKeysOf(expression: string): string[] {
  return [...expression.matchAll(/\bu\("([^"]+)"\)/g)].map(
    (match) => match[1]
  )
}

describe('generation billing presets', () => {
  test('ordinary presets compile without task usage keys', () => {
    for (const group of GENERATION_PRESET_GROUPS) {
      for (const preset of group.presets) {
        expect(
          compileBillingExpression(preset.expr).status,
          `${group.group}/${preset.key}`
        ).toBe('ready')
        expect(usageKeysOf(preset.expr)).toEqual([])
      }
    }
  })

  test('task presets compile without fixed() and only read declared usage keys', () => {
    for (const group of TASK_PRESET_GROUPS) {
      assert(group.requiresUsageKeys)
      for (const preset of group.presets) {
        expect(
          compileBillingExpression(preset.expr).status,
          `${group.group}/${preset.key}`
        ).toBe('ready')
        expect(preset.expr, `${group.group}/${preset.key}`).not.toMatch(
          /\bfixed\(/
        )
        for (const key of usageKeysOf(preset.expr)) {
          expect(group.requiresUsageKeys, `${group.group}/${preset.key}`).toContain(
            key
          )
        }
      }
    }
  })

  test('task presets cover every usage key their group declares', () => {
    for (const group of TASK_PRESET_GROUPS) {
      assert(group.requiresUsageKeys)
      const read = group.presets.flatMap((preset) => usageKeysOf(preset.expr))
      for (const key of group.requiresUsageKeys) {
        expect(read, `${group.group}/${key}`).toContain(key)
      }
    }
  })
})
