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

import { CustomSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import {
  REPETITION_PENALTY_PRESETS,
  STUDIO_DEFAULT_SETTINGS,
  TEMPERATURE_PRESETS,
  TOP_P_PRESETS,
  type StudioSettings,
} from '../types'

interface StudioSettingsDialogProps {
  open: boolean
  settings: StudioSettings
  modelOptions: string[]
  onClose: () => void
  onChange: (next: StudioSettings) => void
}

const FIELD_CLASS =
  'h-[42px] w-full rounded-[10px] border border-[#e4e2f2] bg-white px-3.5 text-[13.5px] text-[#1c1b31] outline-none transition placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
const LABEL_CLASS = 'mb-2.5 block text-[13px] font-semibold text-[#3a3954]'
const HINT_CLASS = 'mt-2 text-[11.5px] text-[#a3a2b8]'

// 触发器沿用输入框视觉，箭头与浮层由 CustomSelect 自绘。
const SELECT_CLASS = cn(FIELD_CLASS, 'cursor-pointer')

const SECTION_CLASS =
  'rounded-[14px] border border-[#efedfa] bg-[#fbfaff] px-4 py-4'
const SECTION_TITLE_CLASS =
  'text-[12px] font-bold uppercase tracking-[.08em] text-[#8d8ba6]'

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_TITLE_CLASS}>{props.title}</div>
      <div className='mt-3.5 space-y-4'>{props.children}</div>
    </section>
  )
}

interface SliderFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  presets?: readonly number[]
  valueText?: string
  hint?: string
  onChange: (value: number) => void
}

/** 滑块 + 数值徽章 + 预设档位，交互参考 HuggingFace chat-ui 的生成参数。 */
function SliderField(props: SliderFieldProps) {
  const valueText = props.valueText ?? props.value.toFixed(2)
  return (
    <div>
      <div className='mb-2.5 flex items-center justify-between'>
        <label
          className='block text-[13px] font-semibold text-[#3a3954]'
          htmlFor={props.id}
        >
          {props.label}
        </label>
        <span className='rounded-full bg-[#f1eeff] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#6c5ce7] tabular-nums'>
          {valueText}
        </span>
      </div>
      <input
        id={props.id}
        type='range'
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        className='h-[22px] w-full accent-[#6c5ce7]'
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      {props.presets && props.presets.length > 0 && (
        <div className='mt-2.5 flex flex-wrap gap-2'>
          {props.presets.map((preset) => (
            <button
              key={preset}
              type='button'
              className={cn(
                'rounded-[9px] px-3 py-1.5 text-[12px] font-medium transition',
                props.value === preset
                  ? 'bg-[#6c5ce7] text-white'
                  : 'bg-[#f4f3fa] text-[#5f5e78] hover:bg-[#eceafa] hover:text-[#6c5ce7]'
              )}
              onClick={() => props.onChange(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
      {props.hint && <p className={HINT_CLASS}>{props.hint}</p>}
    </div>
  )
}

interface NumberFieldProps {
  id: string
  label: string
  value: number
  min: number
  step: number
  hint?: string
  onChange: (value: number) => void
}

function NumberField(props: NumberFieldProps) {
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type='number'
        min={props.min}
        step={props.step}
        className={FIELD_CLASS}
        value={props.value}
        onChange={(event) => {
          const next = Number(event.target.value)
          props.onChange(Number.isFinite(next) ? Math.max(props.min, next) : props.min)
        }}
      />
      {props.hint && <p className={HINT_CLASS}>{props.hint}</p>}
    </div>
  )
}

/** 生成参数面板参考 HuggingFace chat-ui 的设置抽屉，用弹窗形式呈现。 */
export function StudioSettingsDialog(props: StudioSettingsDialogProps) {
  const { t } = useTranslation()
  if (!props.open) return null
  const settings = props.settings
  const patch = (next: Partial<StudioSettings>) =>
    props.onChange({ ...settings, ...next })

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center px-4'>
      <button
        type='button'
        aria-label={t('关闭')}
        className='absolute inset-0 cursor-default bg-[#17162b]/35 backdrop-blur-[2px]'
        onClick={props.onClose}
      />
      <div className='relative z-10 max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] border border-[#e9e7f8] bg-white p-6 shadow-[0_40px_90px_-40px_rgba(25,24,51,.85)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#ddd9f0] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='text-[17px] font-bold tracking-[-.01em] text-[#17162b]'>
              {t('生成参数')}
            </div>
            <div className='mt-1 text-[12.5px] text-[#8a89a0]'>
              {t('这些参数会作用在当前账号的每一次对话上，学生端只开放温度一项。')}
            </div>
          </div>
          <button
            type='button'
            aria-label={t('关闭')}
            className='flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[16px] text-[#8a89a0] transition hover:bg-[#f3f2f9] hover:text-[#4b3bc4]'
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <div className='mt-5 space-y-4'>
          <Section title={t('模型与角色')}>
            <div>
              <label className={LABEL_CLASS} htmlFor='studio-model'>
                {t('模型')}
              </label>
              <CustomSelect
                id='studio-model'
                triggerClassName={SELECT_CLASS}
                value={settings.model}
                onChange={(value) => patch({ model: value })}
                options={[
                  { value: '', label: t('使用中台默认模型') },
                  ...props.modelOptions.map((model) => ({
                    value: model,
                    label: model,
                  })),
                ]}
              />
              <p className={HINT_CLASS}>
                {t('选项来自模型管理里已对你开放的能力模型。')}
              </p>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor='studio-system-prompt'>
                {t('系统提示词')}
              </label>
              <textarea
                id='studio-system-prompt'
                className='min-h-[104px] w-full resize-y rounded-[12px] border border-[#e4e2f2] bg-white px-4 py-3.5 text-[13.5px] leading-[1.75] text-[#1c1b31] outline-none transition placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
                placeholder={t('给 AI 设定角色与回答风格，可留空')}
                value={settings.systemPrompt}
                onChange={(event) => patch({ systemPrompt: event.target.value })}
              />
            </div>
          </Section>

          <Section title={t('采样')}>
            <SliderField
              id='studio-temperature'
              label={t('温度 temperature')}
              value={settings.temperature}
              min={0}
              max={2}
              step={0.1}
              presets={TEMPERATURE_PRESETS}
              valueText={settings.temperature.toFixed(1)}
              hint={t('数值越低回答越稳定，越高越有创造性。')}
              onChange={(temperature) => patch({ temperature })}
            />
            <SliderField
              id='studio-top-p'
              label={t('核采样 top-p')}
              value={settings.topP}
              min={0.05}
              max={1}
              step={0.05}
              presets={TOP_P_PRESETS}
              hint={t('只从累计概率前 p 的候选词里挑选，1 表示不启用核采样。')}
              onChange={(topP) => patch({ topP })}
            />
            <NumberField
              id='studio-top-k'
              label={t('候选词数量 top-k')}
              value={settings.topK}
              min={0}
              step={1}
              hint={t('每步只在概率最高的 k 个词中挑选，填 0 表示不限制。')}
              onChange={(topK) => patch({ topK })}
            />
          </Section>

          <Section title={t('长度与惩罚')}>
            <NumberField
              id='studio-max-tokens'
              label={t('最大回复长度 max_tokens')}
              value={settings.maxTokens}
              min={0}
              step={256}
              hint={t('单位 token，填 0 表示不限制。')}
              onChange={(maxTokens) => patch({ maxTokens })}
            />
            <SliderField
              id='studio-repetition-penalty'
              label={t('重复惩罚 repetition_penalty')}
              value={settings.repetitionPenalty}
              min={0.5}
              max={2}
              step={0.05}
              presets={REPETITION_PENALTY_PRESETS}
              hint={t('大于 1 抑制重复用词，小于 1 允许重复，1 表示不惩罚。')}
              onChange={(repetitionPenalty) => patch({ repetitionPenalty })}
            />
            <SliderField
              id='studio-frequency-penalty'
              label={t('频率惩罚 frequency_penalty')}
              value={settings.frequencyPenalty}
              min={-2}
              max={2}
              step={0.1}
              valueText={settings.frequencyPenalty.toFixed(1)}
              hint={t('按词出现次数降低其概率，为正时更不容易反复提同一个词。')}
              onChange={(frequencyPenalty) => patch({ frequencyPenalty })}
            />
            <SliderField
              id='studio-presence-penalty'
              label={t('存在惩罚 presence_penalty')}
              value={settings.presencePenalty}
              min={-2}
              max={2}
              step={0.1}
              valueText={settings.presencePenalty.toFixed(1)}
              hint={t('只要词已出现过就降低其概率，为正时更容易引入新话题。')}
              onChange={(presencePenalty) => patch({ presencePenalty })}
            />
          </Section>

          <Section title={t('随机与停止')}>
            <NumberField
              id='studio-seed'
              label={t('随机种子 seed')}
              value={settings.seed}
              min={0}
              step={1}
              hint={t('固定种子可复现同一结果，填 0 表示每次随机。')}
              onChange={(seed) => patch({ seed })}
            />
            <div>
              <label className={LABEL_CLASS} htmlFor='studio-stop'>
                {t('停止序列 stop')}
              </label>
              <textarea
                id='studio-stop'
                className='min-h-[76px] w-full resize-y rounded-[12px] border border-[#e4e2f2] bg-white px-4 py-3 text-[13.5px] leading-[1.7] text-[#1c1b31] outline-none transition placeholder:text-[#b0aec4] focus:border-[#6c5ce7] focus:shadow-[0_0_0_3px_rgba(108,92,231,.14)]'
                placeholder={t('每行一个，例如：\n---')}
                value={settings.stop}
                onChange={(event) => patch({ stop: event.target.value })}
              />
              <p className={HINT_CLASS}>
                {t('模型命中任一序列即刻停止生成，每行写一条。')}
              </p>
            </div>
          </Section>
        </div>

        <div className='mt-6 flex items-center justify-between gap-3 border-t border-[#f1f0f9] pt-5'>
          <button
            type='button'
            className='rounded-[10px] px-3.5 py-2 text-[13px] font-medium text-[#8a89a0] transition hover:bg-[#f3f2f9] hover:text-[#4b3bc4]'
            onClick={() => props.onChange({ ...STUDIO_DEFAULT_SETTINGS })}
          >
            {t('恢复默认')}
          </button>
          <button
            type='button'
            className='rounded-[11px] bg-gradient-to-br from-[#7c6cf2] to-[#5b4bd6] px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(108,92,231,.95)] transition hover:brightness-[1.06]'
            onClick={props.onClose}
          >
            {t('完成')}
          </button>
        </div>
      </div>
    </div>
  )
}
