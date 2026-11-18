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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  COMMON_TIMEZONES,
  TIME_FUNCS,
} from '@/features/pricing/lib/billing-expr'
import type { VisualComparison } from '@/features/pricing/lib/billing-expression/visual'
import { toIntlLocale } from '@/i18n/languages'

import { DraftNumberInput } from './draft-number-input'

const PROBE_LABELS = {
  hour: 'Hour of day',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month number',
  day: 'Day of month',
  p: 'Billable input tokens',
  c: 'Billable output tokens',
  len: 'Full input length',
  param: 'Request parameter (param)',
  header: 'Request header (header)',
  usage: 'Usage key (u)',
} as const

const KEY_PROBES = new Set(['usage', 'param', 'header'])

export function BillingTimeProbeFields(props: {
  probe: VisualComparison['probe']
  timezone: string
  includeTokens?: boolean
  invalidTimezone?: boolean
  // usageKeys 提供时展示 usage key（u()）探针
  usageKeys?: string[]
  probeKey?: string
  valueType?: 'number' | 'string'
  onChange: (
    probe: VisualComparison['probe'],
    timezone: string,
    patch?: { probeKey?: string; valueType?: 'number' | 'string' }
  ) => void
}) {
  const { t } = useTranslation()
  const probes: VisualComparison['probe'][] = [...TIME_FUNCS]
  if (props.includeTokens) {
    probes.push('len', 'p', 'c')
    if (props.usageKeys?.length) probes.push('usage')
    probes.push('param', 'header')
  }
  const isTime = (TIME_FUNCS as readonly string[]).includes(props.probe)
  const isKeyProbe = KEY_PROBES.has(props.probe)
  const handleProbe = (probe: VisualComparison['probe']) => {
    if (KEY_PROBES.has(probe)) {
      const defaultKey =
        probe === 'usage'
          ? (props.usageKeys?.[0] ?? '')
          : (props.probeKey ?? '')
      props.onChange(probe, props.timezone || 'UTC', {
        probeKey: defaultKey,
        valueType: 'string',
      })
      return
    }
    props.onChange(probe, props.timezone || 'UTC', {
      probeKey: undefined,
      valueType: undefined,
    })
  }
  const zones = COMMON_TIMEZONES.map((zone) => ({
    value: zone.value,
    label: zone.value,
  }))
  if (!zones.some((zone) => zone.value === props.timezone)) {
    zones.push({ value: props.timezone, label: props.timezone || 'UTC' })
  }
  return (
    <>
      <Select
        items={probes.map((probe) => ({
          value: probe,
          label: t(PROBE_LABELS[probe]),
        }))}
        value={props.probe}
        onValueChange={(probe) => probe && handleProbe(probe)}
      >
        <SelectTrigger
          aria-label={t('Condition input')}
          className='w-44'
          size='sm'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {probes.map((probe) => (
            <SelectItem key={probe} value={probe}>
              {t(PROBE_LABELS[probe])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isKeyProbe && (
        <>
          <div className='w-36 max-w-full min-w-0'>
            <Input
              aria-label={t('Condition key')}
              list={
                props.probe === 'usage' && props.usageKeys?.length
                  ? 'condition-usage-key-options'
                  : undefined
              }
              value={props.probeKey ?? ''}
              onChange={(event) =>
                props.onChange(props.probe, props.timezone, {
                  probeKey: event.target.value,
                  valueType: props.valueType ?? 'string',
                })
              }
              className='h-8'
              placeholder={t('key')}
            />
            {props.probe === 'usage' && props.usageKeys?.length ? (
              <datalist id='condition-usage-key-options'>
                {props.usageKeys.map((key) => (
                  <option key={key} value={key} />
                ))}
              </datalist>
            ) : null}
          </div>
          <Select
            items={[
              { value: 'string', label: t('Text') },
              { value: 'number', label: t('Number') },
            ]}
            value={props.valueType ?? 'string'}
            onValueChange={(value) =>
              value &&
              props.onChange(props.probe, props.timezone, {
                probeKey: props.probeKey,
                valueType: value as 'number' | 'string',
              })
            }
          >
            <SelectTrigger
              aria-label={t('Condition value type')}
              className='w-24'
              size='sm'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value='string'>{t('Text')}</SelectItem>
              <SelectItem value='number'>{t('Number')}</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      {isTime && (
        <div className='w-56 max-w-full min-w-0'>
          <Combobox
            aria-label={t('Timezone')}
            aria-invalid={props.invalidTimezone || undefined}
            options={zones}
            value={props.timezone}
            allowCustomValue
            onValueChange={(timezone) =>
              timezone !== null && props.onChange(props.probe, timezone)
            }
            className='w-full'
          />
        </div>
      )}
    </>
  )
}

/** String drafts keep incomplete bounds visible instead of silently changing them to zero. */
export function BillingConditionValueInput(props: {
  value: string
  onChange: (value: string) => void
  label?: string
  invalid?: boolean
  normalizeNumberDrafts?: boolean
  probe?: VisualComparison['probe']
  valueType?: 'number' | 'string'
}) {
  const { t, i18n } = useTranslation()
  if (
    props.probe === 'weekday' &&
    !props.normalizeNumberDrafts &&
    (props.value === '' || /^[0-6]$/.test(props.value))
  ) {
    const formatter = new Intl.DateTimeFormat(
      toIntlLocale(i18n.resolvedLanguage || i18n.language),
      { weekday: 'long', timeZone: 'UTC' }
    )
    const days = Array.from({ length: 7 }, (_, day) => ({
      value: String(day),
      label: formatter.format(new Date(Date.UTC(2026, 0, 4 + day))),
    }))
    return (
      <Select
        items={days}
        value={props.value}
        onValueChange={(value) => value !== null && props.onChange(value)}
      >
        <SelectTrigger
          size='sm'
          className='w-32'
          aria-label={props.label ?? t('Condition value')}
          aria-invalid={props.invalid || undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {days.map((day) => (
            <SelectItem key={day.value} value={day.value}>
              {day.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (props.valueType === 'string') {
    // 枚举值（如 480p / 1024x1024）：自由文本，不做数字归一化
    return (
      <Input
        type='text'
        aria-label={props.label ?? t('Condition value')}
        aria-invalid={props.invalid || undefined}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className='w-32'
      />
    )
  }
  if (props.normalizeNumberDrafts) {
    return (
      <DraftNumberInput
        aria-label={props.label ?? t('Condition value')}
        value={props.value}
        onValueChange={(value) => props.onChange(String(value))}
        className='w-24'
      />
    )
  }
  return (
    <Input
      type='text'
      inputMode='numeric'
      aria-label={props.label ?? t('Condition value')}
      aria-invalid={props.invalid || undefined}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className='w-24'
    />
  )
}

export function BillingTimeRangeFields(props: {
  start: string
  end: string
  startOperator?: ReactNode
  endOperator?: ReactNode
  invalidStart?: boolean
  invalidEnd?: boolean
  normalizeNumberDrafts?: boolean
  probe?: VisualComparison['probe']
  onChange: (start: string, end: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {props.startOperator}
      <BillingConditionValueInput
        label={props.probe === 'weekday' ? t('Start weekday') : t('Start')}
        probe={props.probe}
        normalizeNumberDrafts={props.normalizeNumberDrafts}
        invalid={props.invalidStart}
        value={props.start}
        onChange={(start) => props.onChange(start, props.end)}
      />
      <span className='text-muted-foreground text-xs'>{t('to')}</span>
      {props.endOperator}
      <BillingConditionValueInput
        label={props.probe === 'weekday' ? t('End weekday') : t('End')}
        probe={props.probe}
        normalizeNumberDrafts={props.normalizeNumberDrafts}
        invalid={props.invalidEnd}
        value={props.end}
        onChange={(end) => props.onChange(props.start, end)}
      />
    </>
  )
}
