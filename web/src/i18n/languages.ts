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
// 项目仅保留英文与简体中文两种界面语言，其余语种已移除。
export const INTERFACE_LANGUAGE_OPTIONS = [
  { code: 'zhCN', label: '简体中文' },
  { code: 'en', label: 'English' },
] as const

export type InterfaceLanguageCode =
  (typeof INTERFACE_LANGUAGE_OPTIONS)[number]['code']

export function normalizeInterfaceLanguage(value?: string | null): string {
  if (!value) return 'en'
  // 仅保留 zhCN 与 en：任何中文变体（zh-CN/zh-TW/zh-Hant/zhCN…）归到 zhCN，其余回退英文。
  if (value.trim().replaceAll('_', '-').toLowerCase().startsWith('zh')) {
    return 'zhCN'
  }
  return 'en'
}

/**
 * Map a browser-detected locale onto the interface language codes this project
 * uses with i18next (`zhCN`).
 *
 * 项目仅保留简体中文与英文：任何中文变体（`zh-CN`/`zh-TW`/`zh-Hant`/`zh`…）
 * 一律归到 `zhCN`，其余语言码原样返回交给 i18next 的 `supportedLngs`
 * 匹配（不支持的最终回退到 `en`）。
 */
export function convertDetectedLanguage(value: string): string {
  const lower = value.trim().replaceAll('_', '-').toLowerCase()
  if (!lower.startsWith('zh')) return value
  return 'zhCN'
}

/**
 * Convert an interface language code (the values i18next uses, such as `zhCN`)
 * into a valid BCP-47 locale tag that the `Intl.*` APIs accept.
 *
 * `new Intl.NumberFormat('zhCN')` throws `RangeError: Invalid language tag`, so
 * any locale derived from `i18n.language` / `i18n.resolvedLanguage` MUST be run
 * through this before it reaches an `Intl` constructor. `zhTW` 作为历史遗留的
 * 语言码映射保留（数据侧可能直接传入），界面语言选项仅剩 en/zhCN。
 * Unknown values fall back to `undefined`, which makes `Intl` use the runtime
 * default locale.
 */
export function toIntlLocale(value?: string | null): string | undefined {
  if (!value) return undefined
  switch (value) {
    case 'zhCN':
      return 'zh-CN'
    case 'zhTW':
      return 'zh-TW'
    default:
      break
  }
  try {
    return Intl.getCanonicalLocales(value)[0]
  } catch {
    return undefined
  }
}
