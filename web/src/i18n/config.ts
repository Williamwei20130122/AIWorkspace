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
import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import {
  convertDetectedLanguage,
  type InterfaceLanguageCode,
} from './languages'

type LocaleBundle = { translation: Record<string, unknown> }

/**
 * Load each locale lazily so only the active language (plus the English
 * fallback) is downloaded on first paint. 项目仅保留英文与简体中文两种界面语言。
 */
const LOCALE_LOADERS: Record<
  InterfaceLanguageCode,
  () => Promise<{ default: LocaleBundle }>
> = {
  en: () => import('./locales/en.json'),
  zhCN: () => import('./locales/zh.json'),
}

const LazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {
    // No backend options to prepare; bundles are imported on demand in `read`.
  },
  read(language, _namespace, callback) {
    const loader = LOCALE_LOADERS[language as InterfaceLanguageCode]
    if (!loader) {
      callback(null, {})
      return
    }
    loader().then(
      ({ default: bundle }) => callback(null, bundle.translation),
      (error: Error) => callback(error, false)
    )
  },
}

/**
 * Resolves once the initial language bundle is ready. `main.tsx` awaits this
 * before rendering so the UI never flashes raw translation keys.
 */
export const i18nReady = i18n
  .use(LazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'zhCN'],
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`
      // code (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
    react: {
      // Resources arrive asynchronously; avoid throwing a promise from
      // `useTranslation` for the brief window while a language bundle loads.
      useSuspense: false,
    },
  })

export default i18n
