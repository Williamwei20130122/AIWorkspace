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
import type { PresetGroup } from './tiered-pricing-editor'

// 生成类（图片/视频）专用计费模板组，供任务计费编辑器复用；
// 放在非组件文件中以满足 fast refresh 仅导出组件的约束。
//
// 两个编辑器的语法规则互斥：普通模型表达式禁用 u() 用量键（须用固定树 + image_count），
// 任务表达式禁用 fixed()（须用 u() 键），因此按场景拆分为两组模板，避免保存被后端拒绝。

// 普通模型编辑器（TieredPricingEditor）用：固定价格树 + image_count / param()
export const GENERATION_PRESET_GROUPS: PresetGroup[] = [
  {
    group: 'Image generation',
    presets: [
      {
        key: 'image-per-image',
        label: 'Fixed price per image',
        expr: 'tier("image", fixed(0.05)) * image_count',
      },
      {
        key: 'image-by-size',
        label: 'By image size',
        expr: '(param("size") == "1024x1792" || param("size") == "1792x1024" ? tier("large", fixed(0.08)) : param("size") == "1024x1024" ? tier("square", fixed(0.05)) : tier("default", fixed(0.05))) * image_count',
      },
    ],
  },
]

// 任务计费编辑器（TaskUsagePricingEditor）用：u() 用量键，禁 fixed()。
// requiresUsageKeys 全部键都在插件 usage schema 中声明时才展示该组。
export const TASK_PRESET_GROUPS: PresetGroup[] = [
  {
    group: 'Image generation',
    requiresUsageKeys: ['image_count'],
    presets: [
      {
        key: 'image-per-image-task',
        label: 'Fixed price per image',
        expr: 'tier("image", u("image_count") * 0.05)',
      },
      {
        key: 'image-by-size-task',
        label: 'By image size',
        expr: '(param("size") == "1024x1792" || param("size") == "1792x1024" ? tier("large", u("image_count") * 0.08) : param("size") == "1024x1024" ? tier("square", u("image_count") * 0.05) : tier("default", u("image_count") * 0.05))',
      },
    ],
  },
  {
    group: 'Video generation',
    requiresUsageKeys: ['resolution', 'tokens'],
    presets: [
      {
        key: 'video-by-resolution',
        label: 'By resolution (per 1M tokens)',
        expr: 'u("resolution") == "480p" ? tier("480p", u("tokens") * 2 / 1000000) : u("resolution") == "720p" ? tier("720p", u("tokens") * 4 / 1000000) : u("resolution") == "1080p" ? tier("1080p", u("tokens") * 8 / 1000000) : tier("default", u("tokens") * 4 / 1000000)',
      },
    ],
  },
]
