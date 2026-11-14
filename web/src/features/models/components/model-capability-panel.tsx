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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchModelCapabilities,
  fetchPricing,
  saveModelCapability,
  savePricing,
} from '@/features/ai-hub/api'
import {
  AUDIENCE_OPTIONS,
  CAPABILITY_KIND_LABEL,
  type AiHubModelCapability,
  type AiHubModelEndpoint,
} from '@/features/ai-hub/types'

import type { Model } from '../types'

// CAPABILITY_KINDS 中台支持的六种生成模态，顺序与学生端能力卡片一致。
const CAPABILITY_KINDS = ['text', 'image', 'edit', 'video', 'music', 'tts']

const DEFAULT_MUSIC_PLUGIN = 'sunoapi'

const DEFAULT_AUDIENCE = 'both'

const DEFAULT_ENDPOINT_FORMAT = 'openai'

const DEFAULT_ENDPOINT_METHOD = 'POST'

const ENDPOINT_FORMAT_OPTIONS = [
  { value: 'openai', label: 'OpenAI 对话格式' },
  { value: 'json', label: '通用 JSON 格式' },
]

const ENDPOINT_METHOD_OPTIONS = ['POST', 'GET']

/** 各能力默认计价单位（与后端 DefaultWorkspaceUnitForKind 保持一致）。 */
const KIND_DEFAULT_UNIT: Record<string, string> = {
  text: '千token',
  tts: '分钟',
  music: '首',
  image: '张',
  edit: '张',
  video: '次',
}

/** 单个「模型 × 功能」的计价草稿：计价单位与上游成本按功能各自设置。 */
type PricingDraft = {
  unit: string
  unit_price: number
  base_units: number
}

// voiceTextToList 把「每行一个音色」的文本解析为去空去重的音色列表。
function voiceTextToList(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  raw
    .split('\n')
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || seen.has(line)) return
      seen.add(line)
      result.push(line)
    })
  return result
}

export function ModelCapabilityPanel({ model }: { model: Model }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedName, setSelectedName] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE)
  const [plugin, setPlugin] = useState('')
  const [action, setAction] = useState('')
  const [voiceText, setVoiceText] = useState('')
  const [endpoints, setEndpoints] = useState<Record<string, AiHubModelEndpoint>>(
    {}
  )
  const [pricingDrafts, setPricingDrafts] = useState<
    Record<string, PricingDraft>
  >({})
  const [saving, setSaving] = useState(false)

  const requiresPick = model.name_rule !== 0
  const concreteName = requiresPick
    ? selectedName || model.matched_models?.[0] || ''
    : model.model_name

  const capabilitiesQuery = useQuery({
    queryKey: ['ai-hub', 'model-capabilities'],
    queryFn: fetchModelCapabilities,
  })
  const records = capabilitiesQuery.data ?? []

  // 定价规则：用于只读展示该模型的功能计价（点数按能力统一，金额/单位按模型独立）。
  const pricingQuery = useQuery({
    queryKey: ['ai-hub', 'pricing'],
    queryFn: fetchPricing,
  })

  useEffect(() => {
    const current = records.find((item) => item.model === concreteName)
    setKinds(current?.kinds ?? [])
    setAudience(current?.audience || DEFAULT_AUDIENCE)
    setPlugin(current?.plugin ?? '')
    setAction(current?.action ?? '')
    setVoiceText((current?.voices ?? []).join('\n'))
    const endpointMap: Record<string, AiHubModelEndpoint> = {}
    ;(current?.endpoints ?? []).forEach((endpoint) => {
      endpointMap[endpoint.kind] = endpoint
    })
    setEndpoints(endpointMap)
    // 计价草稿按「模型 × 功能」从定价规则回填，未配置的按能力默认单位起步。
    const pricingModels = pricingQuery.data?.models ?? []
    const drafts: Record<string, PricingDraft> = {}
    for (const kind of current?.kinds ?? []) {
      const found = pricingModels.find(
        (item) => item.model === concreteName && item.kind === kind
      )
      drafts[kind] = {
        unit: found?.unit || KIND_DEFAULT_UNIT[kind] || '次',
        unit_price: found?.unit_price ?? 0,
        base_units: found?.base_units ?? 1,
      }
    }
    setPricingDrafts(drafts)
  }, [records, concreteName, pricingQuery.data])

  // draftOf 取某功能的计价草稿；刚开启的功能尚未回填时用默认值。
  const draftOf = (kind: string): PricingDraft =>
    pricingDrafts[kind] ?? {
      unit: KIND_DEFAULT_UNIT[kind] ?? '次',
      unit_price: 0,
      base_units: 1,
    }

  const updateDraft = (kind: string, patch: Partial<PricingDraft>) => {
    setPricingDrafts((prev) => ({
      ...prev,
      [kind]: { ...draftOf(kind), ...patch },
    }))
  }

  const updateEndpoint = (
    kind: string,
    patch: Partial<AiHubModelEndpoint>
  ) => {
    setEndpoints((prev) => ({
      ...prev,
      [kind]: {
        kind,
        format: prev[kind]?.format ?? DEFAULT_ENDPOINT_FORMAT,
        method: prev[kind]?.method ?? DEFAULT_ENDPOINT_METHOD,
        ...prev[kind],
        ...patch,
      },
    }))
  }

  const toggleKind = (kind: string, enabled: boolean) => {
    setKinds((prev) =>
      enabled ? [...new Set([...prev, kind])] : prev.filter((one) => one !== kind)
    )
  }

  const handleSave = async () => {
    if (!concreteName) {
      toast.error(t('请先选择要配置的模型'))
      return
    }
    setSaving(true)
    try {
      await saveModelCapability({
        model: concreteName,
        kinds,
        audience,
        plugin: kinds.includes('music')
          ? plugin || DEFAULT_MUSIC_PLUGIN
          : undefined,
        action: kinds.includes('music') ? action || undefined : undefined,
        voices: kinds.includes('tts') ? voiceTextToList(voiceText) : undefined,
        endpoints: kinds.map((kind) => {
          const endpoint = endpoints[kind] ?? { kind }
          return {
            kind,
            format: endpoint.format || DEFAULT_ENDPOINT_FORMAT,
            path: (endpoint.path ?? '').trim() || undefined,
            qpath: (endpoint.qpath ?? '').trim() || undefined,
            method: endpoint.method || DEFAULT_ENDPOINT_METHOD,
            extra: (endpoint.extra ?? '').trim() || undefined,
          }
        }),
      })
      // 计价：该模型的每个已开启功能各存一条「模型 × 功能」记录，关闭的功能一并清除。
      const pricing = pricingQuery.data
      if (pricing) {
        const others = pricing.models.filter(
          (item) => item.model !== concreteName
        )
        await savePricing({
          ...pricing,
          models: [
            ...others,
            ...kinds.map((kind) => ({
              model: concreteName,
              kind,
              unit: draftOf(kind).unit,
              unit_price: draftOf(kind).unit_price,
              base_units: draftOf(kind).base_units,
            })),
          ],
        })
        await queryClient.invalidateQueries({
          queryKey: ['ai-hub', 'pricing'],
        })
      }
      await queryClient.invalidateQueries({
        queryKey: ['ai-hub', 'model-capabilities'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'capabilities'],
      })
      toast.success(t('生成能力已保存'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const current: AiHubModelCapability | undefined = records.find(
    (item) => item.model === concreteName
  )

  const pointsOfKind = (kind: string) =>
    (pricingQuery.data?.kinds ?? []).find((item) => item.kind === kind)
      ?.points ?? 0

  // 上游单价由模型倍率页自动换算，此处只读展示，不再手工填写。
  const autoPriceOf = (kind: string) =>
    (pricingQuery.data?.models ?? []).find(
      (item) => item.model === concreteName && item.kind === kind
    )?.auto_pricing?.unit_price ?? 0

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'>
      {requiresPick && (
        <div className='space-y-2'>
          <Label>{t('选择要配置的模型')}</Label>
          <Combobox
            value={concreteName}
            onValueChange={(value) => setSelectedName(value ?? '')}
            options={(model.matched_models ?? []).map((name) => ({
              value: name,
              label: name,
            }))}
            aria-label={t('选择要配置的模型')}
            className='w-full'
            placeholder={t('选择模型')}
          />
        </div>
      )}

      <div className='space-y-1'>
        <p className='text-sm font-medium'>{t('支持的生成能力')}</p>
        <p className='text-muted-foreground text-sm'>
          {t(
            '勾选该模型支持的中台生成能力；学生端会按能力聚合出可选模型列表。'
          )}
        </p>
      </div>

      <div className='space-y-2'>
        <Label>{t('开放范围')}</Label>
        <div className='flex flex-wrap gap-2'>
          {AUDIENCE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type='button'
              size='sm'
              variant={audience === option.value ? 'default' : 'outline'}
              onClick={() => setAudience(option.value)}
            >
              {t(option.label)}
            </Button>
          ))}
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('决定该模型出现在谁的可选模型下拉里，未勾选能力的模型不会出现。')}
        </p>
      </div>

      <div className='space-y-3'>
        {CAPABILITY_KINDS.map((kind) => {
          const enabled = kinds.includes(kind)
          const endpoint = endpoints[kind] ?? { kind }
          return (
            <div key={kind} className='rounded-lg border p-3'>
              <div className='flex items-center justify-between gap-4'>
                <div className='flex flex-col gap-0.5'>
                  <span className='text-sm font-medium'>
                    {t(CAPABILITY_KIND_LABEL[kind] ?? kind)}
                  </span>
                  <span className='text-muted-foreground text-xs'>{kind}</span>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => toggleKind(kind, checked)}
                />
              </div>

              {enabled && (
                <div className='mt-3 space-y-3 border-t pt-3'>
                  <div className='space-y-2'>
                    <Label>{t('请求格式')}</Label>
                    <div className='flex flex-wrap gap-2'>
                      {ENDPOINT_FORMAT_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          type='button'
                          size='sm'
                          variant={
                            (endpoint.format || DEFAULT_ENDPOINT_FORMAT) ===
                            option.value
                              ? 'default'
                              : 'outline'
                          }
                          onClick={() =>
                            updateEndpoint(kind, { format: option.value })
                          }
                        >
                          {t(option.label)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='space-y-2'>
                      <Label>{t('接口路径')}</Label>
                      <Input
                        value={endpoint.path ?? ''}
                        placeholder='/chat/completions'
                        onChange={(event) =>
                          updateEndpoint(kind, { path: event.target.value })
                        }
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>{t('结果查询接口（可选）')}</Label>
                      <Input
                        value={endpoint.qpath ?? ''}
                        placeholder='/api/workspace/task'
                        onChange={(event) =>
                          updateEndpoint(kind, { qpath: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label>{t('请求方法')}</Label>
                    <div className='flex flex-wrap gap-2'>
                      {ENDPOINT_METHOD_OPTIONS.map((method) => (
                        <Button
                          key={method}
                          type='button'
                          size='sm'
                          variant={
                            (endpoint.method || DEFAULT_ENDPOINT_METHOD) ===
                            method
                              ? 'default'
                              : 'outline'
                          }
                          onClick={() => updateEndpoint(kind, { method })}
                        >
                          {method}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label>{t('附加参数 JSON')}</Label>
                    <Textarea
                      value={endpoint.extra ?? ''}
                      rows={3}
                      placeholder='{}'
                      onChange={(event) =>
                        updateEndpoint(kind, { extra: event.target.value })
                      }
                    />
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        '留空表示不附加；填写后会深合并覆盖到该功能（模型 × 功能维度）的生成请求体上，教师专业版不受此限制。'
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {kinds.length > 0 && (
        <div className='space-y-3 rounded-lg border p-3'>
          <div className='space-y-0.5'>
            <p className='text-sm font-medium'>{t('该模型功能计价')}</p>
            <p className='text-muted-foreground text-xs'>
              {t(
                '单次消耗点数按能力统一；上游单价由「模型倍率 / 补全倍率 × 汇率」自动换算，无需手工填写。'
              )}
            </p>
          </div>
          {kinds.map((kind) => {
            const draft = draftOf(kind)
            return (
              <div
                key={kind}
                className='space-y-2 rounded-md border bg-muted/20 p-3'
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-medium'>
                    {t(CAPABILITY_KIND_LABEL[kind] ?? kind)}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {pointsOfKind(kind)} {t('点/次')}
                  </span>
                </div>
                <div className='grid gap-2 sm:grid-cols-2'>
                  <div className='space-y-1'>
                    <Label>{t('计价单位')}</Label>
                    <Combobox
                      value={draft.unit}
                      onValueChange={(value) =>
                        updateDraft(kind, { unit: value ?? '' })
                      }
                      options={(pricingQuery.data?.unit_options ?? []).map(
                        (unit) => ({ value: unit, label: unit })
                      )}
                      aria-label={t('计价单位')}
                      className='w-full'
                      placeholder={t('选择计价单位')}
                    />
                  </div>
                  <div className='space-y-1'>
                    <Label>{t('上游单价（元/单位，自动换算）')}</Label>
                    <div className='flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm'>
                      {autoPriceOf(kind) > 0
                        ? `¥${autoPriceOf(kind).toFixed(4)}`
                        : t('请在「模型倍率」中配置倍率/价格')}
                    </div>
                  </div>
                  <div className='space-y-1'>
                    <Label>{t('每次计量数量')}</Label>
                    <Input
                      type='number'
                      value={String(draft.base_units)}
                      onChange={(event) =>
                        updateDraft(kind, {
                          base_units: Math.max(
                            0,
                            Number(event.target.value) || 0
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {kinds.includes('music') && (
        <div className='grid gap-3 rounded-lg border p-3 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label>{t('任务插件')}</Label>
            <Input
              value={plugin}
              placeholder={DEFAULT_MUSIC_PLUGIN}
              onChange={(event) => setPlugin(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('插件动作')}</Label>
            <Input
              value={action}
              placeholder='create'
              onChange={(event) => setAction(event.target.value)}
            />
          </div>
        </div>
      )}

      {kinds.includes('tts') && (
        <div className='space-y-2 rounded-lg border p-3'>
          <Label>{t('音色列表')}</Label>
          <Textarea
            value={voiceText}
            rows={4}
            placeholder={'alloy\nnova\nshimmer'}
            onChange={(event) => setVoiceText(event.target.value)}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              '每行一个音色标识，与学生端下拉选项一一对应；若留空则音色输入框可自由填写。'
            )}
          </p>
        </div>
      )}

      <div className='flex items-center justify-end gap-2 pt-2'>
        {current ? (
          <span className='text-muted-foreground mr-auto text-xs'>
            {t('已声明')} {current.kinds.length} {t('种能力')}
          </span>
        ) : (
          <span className='text-muted-foreground mr-auto text-xs'>
            {t('该模型暂未声明生成能力')}
          </span>
        )}
        <Button disabled={saving || !concreteName} onClick={() => void handleSave()}>
          {saving ? t('Saving...') : t('Save metadata')}
        </Button>
      </div>
    </div>
  )
}
