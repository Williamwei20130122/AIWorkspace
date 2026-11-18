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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PricingCurrencyPreference = 'USD' | 'site'

type PricingPreferences = {
  currency: PricingCurrencyPreference
  setCurrency: (currency: PricingCurrencyPreference) => void
}

export const usePricingPreferencesStore = create<PricingPreferences>()(
  persist(
    (set) => ({
      currency: 'site',
      setCurrency: (currency) => set({ currency }),
    }),
    {
      name: 'model-pricing-preferences',
      version: 2,
      // 系统计价货币已统一为人民币：忽略历史持久化的 USD 选择，默认按站点货币（CNY）展示
      migrate: () => ({ currency: 'site' }) as PricingPreferences,
      partialize: (state) => ({ currency: state.currency }),
    }
  )
)
