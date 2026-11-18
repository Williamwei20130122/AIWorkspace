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
  visualNodeId,
  type VisualComparison,
  type VisualCondition,
  type VisualPricingNode,
} from './visual'

type TierNode = Extract<VisualPricingNode, { kind: 'tier' }>

export type TierTemplateSegment = {
  // 写入表达式的分档 tier 名称（表达式数据，不走 i18n）
  label: string
  condition: VisualCondition
}

export type TierTemplate = {
  key: string
  // 展示名，组件中通过 t() 渲染
  label: string
  // usage schema 声明了全部键时才展示（如 u("resolution") 模板）
  requiresUsageKeys?: string[]
  // 每次套用都新建条件节点，保证 id 唯一
  segments: () => TierTemplateSegment[]
}

function comparison(
  probe: VisualComparison['probe'],
  operator: VisualComparison['operator'],
  value: string,
  key?: { probeKey: string; valueType?: 'number' | 'string' }
): VisualComparison {
  return {
    id: visualNodeId(),
    kind: 'comparison',
    probe,
    probeKey: key?.probeKey,
    valueType: key?.valueType ?? 'number',
    timezone: 'Asia/Shanghai',
    operator,
    value,
  }
}

export const TIER_TEMPLATES: TierTemplate[] = [
  {
    key: 'context-length',
    label: 'Context length tiers',
    segments: () => [
      { label: 'Within 64K', condition: comparison('len', '<=', '64000') },
      { label: 'Within 256K', condition: comparison('len', '<=', '256000') },
    ],
  },
  {
    key: 'resolution',
    label: 'Resolution tiers',
    requiresUsageKeys: ['resolution'],
    segments: () => [
      {
        label: '480p',
        condition: comparison('usage', '==', '480p', {
          probeKey: 'resolution',
          valueType: 'string',
        }),
      },
      {
        label: '720p',
        condition: comparison('usage', '==', '720p', {
          probeKey: 'resolution',
          valueType: 'string',
        }),
      },
      {
        label: '1080p',
        condition: comparison('usage', '==', '1080p', {
          probeKey: 'resolution',
          valueType: 'string',
        }),
      },
    ],
  },
  {
    key: 'image-size',
    label: 'Image size tiers',
    segments: () => [
      {
        label: 'Large',
        condition: {
          id: visualNodeId(),
          kind: 'any',
          children: [
            comparison('param', '==', '1024x1792', {
              probeKey: 'size',
              valueType: 'string',
            }),
            comparison('param', '==', '1792x1024', {
              probeKey: 'size',
              valueType: 'string',
            }),
          ],
        },
      },
      {
        label: 'Square',
        condition: comparison('param', '==', '1024x1024', {
          probeKey: 'size',
          valueType: 'string',
        }),
      },
    ],
  },
]

/**
 * 把一个 tier 转成按序命中的 branch 链：分段从后往前包裹，原 tier 保留为
 * 最后的兜底（保持 id / origin，与「Add pricing branch」的结构一致）。
 * 分段 tier 复制原 tier 的价格，插入后只需改价格。
 */
export function applyTierTemplate(
  base: TierNode,
  template: TierTemplate
): VisualPricingNode {
  let result: VisualPricingNode = base
  const segments = template.segments()
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    result = {
      id: visualNodeId(),
      kind: 'branch',
      condition: segment.condition,
      yes: {
        id: visualNodeId(),
        kind: 'tier',
        label: segment.label,
        prices: base.prices.map(({ variable, value }) => ({
          variable,
          value,
        })),
        billingUnit: base.billingUnit,
        fixedPrice: base.fixedPrice,
      },
      no: result,
    }
  }
  return result
}
