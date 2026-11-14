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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchModelCapabilities, fetchPricing, savePricing } from '../api'
import { RatioSettingsCard } from '@/features/system-settings/models/ratio-settings-card'
import {
  Button,
  Dropdown,
  Field,
  PageShell,
  Panel,
  Table,
  Td,
  TextInput,
} from '../components/kit'
import {
  CAPABILITY_KIND_LABEL,
  type AiHubCapabilityCost,
  type AiHubModelPricing,
} from '../types'

/** 各能力默认计价单位（与后端 DefaultWorkspaceUnitForKind 保持一致）。 */
const KIND_DEFAULT_UNIT: Record<string, string> = {
  text: '千token',
  tts: '分钟',
  music: '首',
  image: '张',
  edit: '张',
  video: '次',
  html: '千token',
  slide: '千token',
}

const FALLBACK_UNIT_OPTIONS = ['次', '张', '首', '分钟', '千token']

/** 思考强度档位中文名（空串表示跟随模型默认，在选项里单独翻译）。 */
const EFFORT_LABEL: Record<string, string> = {
  none: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
}

/** CAPABILITY_KINDS 排序，保证同一模型的功能按固定顺序展示。 */
const KIND_ORDER = ['text', 'image', 'edit', 'video', 'music', 'tts', 'html', 'slide']

/** 模型倍率表单的空兜底值；真实值在组件内由定价接口回填。 */
const EMPTY_MODEL_PRICING_DEFAULTS = {
  ModelPrice: '{}',
  ModelRatio: '{}',
  CacheRatio: '{}',
  CreateCacheRatio: '{}',
  CompletionRatio: '{}',
  ImageRatio: '{}',
  AudioRatio: '{}',
  AudioCompletionRatio: '{}',
  ExposeRatioEnabled: false,
  BillingMode: '{}',
  BillingExpr: '{}',
  PluginBillingExpr: '{}',
}

const EMPTY_GROUP_PRICING_DEFAULTS = {
  GroupRatio: '{}',
  UserUsableGroups: '{}',
  GroupGroupRatio: '{}',
  AutoGroups: '[]',
  MaxTokenAutoGroups: 1,
  DefaultUseAutoGroup: false,
  GroupSpecialUsableGroup: '{}',
}

export function PricingSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [platformName, setPlatformName] = useState('')
  const [htmlThinkingEffort, setHtmlThinkingEffort] = useState('')
  const [slideThinkingEffort, setSlideThinkingEffort] = useState('')
  const [effortOptions, setEffortOptions] = useState<string[]>([''])
  const [kinds, setKinds] = useState<AiHubCapabilityCost[]>([])
  const [models, setModels] = useState<AiHubModelPricing[]>([])
  const [unitOptions, setUnitOptions] = useState<string[]>(FALLBACK_UNIT_OPTIONS)
  const [saving, setSaving] = useState(false)

  const pricingQuery = useQuery({
    queryKey: ['ai-hub', 'pricing'],
    queryFn: fetchPricing,
  })

  // 声明了生成能力的模型：定价表需要把新声明的模型也列出来直接计价。
  const capabilitiesQuery = useQuery({
    queryKey: ['ai-hub', 'model-capabilities'],
    queryFn: fetchModelCapabilities,
  })

  useEffect(() => {
    if (!pricingQuery.data) return
    setPlatformName(pricingQuery.data.platform_name)
    setHtmlThinkingEffort(pricingQuery.data.html_thinking_effort)
    setSlideThinkingEffort(pricingQuery.data.slide_thinking_effort)
    if (pricingQuery.data.thinking_effort_options.length > 0) {
      setEffortOptions(pricingQuery.data.thinking_effort_options)
    }
    setKinds(pricingQuery.data.kinds)
    setModels(pricingQuery.data.models)
    if (pricingQuery.data.unit_options.length > 0) {
      setUnitOptions(pricingQuery.data.unit_options)
    }
  }, [pricingQuery.data])

  const updateKind = (kind: string, points: number) => {
    setKinds((prev) =>
      prev.map((item) => (item.kind === kind ? { ...item, points } : item))
    )
  }

  // 只列出「现存模型已声明的功能」：模型被删除或功能被关闭后，其残留计价不再展示。
  const modelRows = useMemo(() => {
    const rows: { model: string; kind: string }[] = []
    for (const item of capabilitiesQuery.data ?? []) {
      if (!item.model) continue
      for (const kind of item.kinds ?? []) {
        rows.push({ model: item.model, kind })
      }
    }
    return rows.sort((a, b) => {
      if (a.model !== b.model) return a.model.localeCompare(b.model)
      return (
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      )
    })
  }, [capabilitiesQuery.data])

  // 未配置过的「模型 × 功能」按默认值临时呈现，方便管理员直接填写后保存。
  const pricingOf = (model: string, kind: string): AiHubModelPricing => {
    const found = models.find(
      (item) => item.model === model && item.kind === kind
    )
    if (found) return found
    return {
      model,
      kind,
      unit: KIND_DEFAULT_UNIT[kind] ?? '次',
      unit_price: 0,
      base_units: 1,
    }
  }

  const updateModel = (
    model: string,
    kind: string,
    patch: Partial<AiHubModelPricing>
  ) => {
    setModels((prev) => {
      const index = prev.findIndex(
        (item) => item.model === model && item.kind === kind
      )
      if (index >= 0) {
        const next = [...prev]
        next[index] = { ...next[index], ...patch }
        return next
      }
      return [...prev, { ...pricingOf(model, kind), ...patch }]
    })
  }

  const numberPatch = (
    model: string,
    kind: string,
    key: 'base_units',
    value: string
  ) => {
    updateModel(model, kind, { [key]: Math.max(0, Number(value) || 0) })
  }

  // 上游单价完全由模型倍率页自动换算，管理端只读展示，不再手工填写。
  const autoUnitPrice = (model: string, kind: string) => {
    const found = models.find(
      (item) => item.model === model && item.kind === kind
    )
    return found?.auto_pricing?.unit_price ?? 0
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await savePricing({
        kinds,
        models: modelRows.map((row) => pricingOf(row.model, row.kind)),
        platform_name: platformName,
        unit_options: unitOptions,
        html_thinking_effort: htmlThinkingEffort,
        slide_thinking_effort: slideThinkingEffort,
        thinking_effort_options: effortOptions,
      })
      await queryClient.invalidateQueries({ queryKey: ['ai-hub', 'pricing'] })
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'capabilities'],
      })
      toast.success(t('定价规则已保存'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const unitChoices = unitOptions.map((unit) => ({ label: unit, value: unit }))

  return (
    <PageShell
      title={t('模型定价与计费规则')}
      description={t(
        '单次消耗点数按生成能力统一设置；上游单价由「模型倍率 / 补全倍率 × 汇率」自动换算，无需手工填写。'
      )}
      actions={
        <Button
          variant='primary'
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? t('保存中…') : t('保存定价')}
        </Button>
      }
    >
      <Panel title={t('平台设置')}>
        <div className='grid gap-3 md:grid-cols-2'>
          <Field label={t('中台展示名称')}>
            <TextInput
              value={platformName}
              placeholder='AI Workspace'
              onChange={setPlatformName}
            />
          </Field>
          <Field label={t('HTML 实验室默认思考强度')}>
            <Dropdown
              value={htmlThinkingEffort}
              options={effortOptions.map((value) => ({
                label:
                  value === ''
                    ? t('跟随模型默认')
                    : EFFORT_LABEL[value] ?? value,
                value,
              }))}
              onChange={setHtmlThinkingEffort}
            />
          </Field>
          <Field label={t('演示实验室默认思考强度')}>
            <Dropdown
              value={slideThinkingEffort}
              options={effortOptions.map((value) => ({
                label:
                  value === ''
                    ? t('跟随模型默认')
                    : EFFORT_LABEL[value] ?? value,
                value,
              }))}
              onChange={setSlideThinkingEffort}
            />
          </Field>
          <div className='flex items-end text-xs text-muted-foreground md:col-span-2'>
            {t(
              '该名称会显示在学生端与教师端页面顶部；思考强度为学生进入 HTML 编程实验室 / 演示实验室时的初始档位，学生仍可手动切换。'
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title={t('能力点数（按能力统一）')}
        description={t(
          '同类生成能力的全部模型共用同一个单次消耗点数，学生每成功生成一次扣一次。'
        )}
      >
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {kinds.map((item) => (
            <Field
              key={item.kind}
              label={`${t(CAPABILITY_KIND_LABEL[item.kind] ?? item.kind)}${t('单次消耗点数')}`}
            >
              <TextInput
                type='number'
                value={String(item.points)}
                onChange={(value) =>
                  updateKind(item.kind, Math.max(0, Number(value) || 0))
                }
              />
            </Field>
          ))}
          {kinds.length === 0 && (
            <p className='text-sm text-muted-foreground'>{t('暂无能力配置')}</p>
          )}
        </div>
      </Panel>

      <Panel
        title={t('按模型 × 功能计价')}
        description={t(
          '同一模型的不同功能计价单位与折算规则不同（图片按张、声音按分钟、文本按千 token），需逐个「模型 × 功能」设置计价单位。上游单价由模型倍率页自动换算，金额按实际用量自动计算。'
        )}
      >
        <Table
          headers={[
            t('模型'),
            t('功能'),
            t('计价单位'),
            t('上游单价（元/单位，自动换算）'),
            t('每次计量数量'),
            t('单次折算（元）'),
          ]}
          isEmpty={modelRows.length === 0}
          empty={t('暂无模型：请先在「模型管理」里为模型声明生成能力')}
        >
          {modelRows.map((row) => {
            const pricing = pricingOf(row.model, row.kind)
            const autoPrice = autoUnitPrice(row.model, row.kind)
            return (
              <tr
                key={`${row.model}::${row.kind}`}
                className='border-b border-border/60'
              >
                <Td className='font-medium'>{row.model}</Td>
                <Td className='text-xs text-muted-foreground'>
                  {t(CAPABILITY_KIND_LABEL[row.kind] ?? row.kind)}
                </Td>
                <Td className='w-[130px]'>
                  <Dropdown
                    value={pricing.unit}
                    options={unitChoices}
                    onChange={(value) =>
                      updateModel(row.model, row.kind, { unit: value })
                    }
                  />
                </Td>
                <Td className='w-[150px]'>
                  {autoPrice > 0 ? (
                    <span className='text-sm font-medium'>
                      ¥{autoPrice.toFixed(4)}
                    </span>
                  ) : (
                    <span className='text-xs text-muted-foreground'>
                      {t('请在「模型倍率」中配置倍率/价格')}
                    </span>
                  )}
                </Td>
                <Td className='w-[120px]'>
                  <TextInput
                    type='number'
                    value={String(pricing.base_units)}
                    onChange={(value) =>
                      numberPatch(row.model, row.kind, 'base_units', value)
                    }
                  />
                </Td>
                <Td className='text-xs text-muted-foreground'>
                  {(autoPrice * (pricing.base_units || 1)).toFixed(4)}
                </Td>
              </tr>
            )
          })}
        </Table>
      </Panel>

      <Panel
        title={t('模型倍率与上游定价')}
        description={t(
          '模型倍率、补全倍率与工具价格即上游计费口径：文本类按「倍率 × $0.002 × 汇率」换算为元/千 token，按次类优先取模型价格 × 汇率。上方「上游单价」即此处自动换算结果。'
        )}
      >
        <RatioSettingsCard
          titleKey='Model Pricing'
          modelDefaults={EMPTY_MODEL_PRICING_DEFAULTS}
          groupDefaults={EMPTY_GROUP_PRICING_DEFAULTS}
          toolPricesDefault='{}'
          visibleTabs={['models', 'unset-models', 'tool-prices', 'upstream-sync']}
        />
      </Panel>
    </PageShell>
  )
}
