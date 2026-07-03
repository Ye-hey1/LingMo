'use client'

import { useEffect, useState } from 'react'
import { BrainCircuit, Clock, FileText, Gauge, ShieldAlert, WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SettingType, FormItem } from '../components/setting-base'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ModelSelect } from '../components/model-select'
import {
  DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS,
  getStructuredSemanticExtractionSettings,
  setStructuredSemanticExtractionSetting,
  type StructuredExtractionMode,
  type StructuredSemanticExtractionSettings,
} from '@/lib/structured-knowledge/semantic-extraction-settings'

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <Input
      className="w-28"
      min={min}
      max={max}
      type="number"
      value={value}
      onChange={(event) => {
        const next = Math.max(min, Math.min(max, Number(event.target.value) || min))
        onChange(next)
      }}
    />
  )
}

export default function StructuredKnowledgeSetting() {
  const t = useTranslations('settings.structuredKnowledge')
  const [settings, setSettings] = useState<StructuredSemanticExtractionSettings>(DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS)

  useEffect(() => {
    void getStructuredSemanticExtractionSettings().then(setSettings)
  }, [])

  async function update<K extends keyof StructuredSemanticExtractionSettings>(key: K, value: StructuredSemanticExtractionSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }))
    await setStructuredSemanticExtractionSetting(key, value)
  }

  const numericSettings = [
    { key: 'maxBlocks' as const, icon: FileText, min: 1, max: 200 },
    { key: 'idleSeconds' as const, icon: Clock, min: 1, max: 600 },
    { key: 'cooldownMinutes' as const, icon: Gauge, min: 0, max: 10080 },
    { key: 'maxNotesPerRun' as const, icon: BrainCircuit, min: 1, max: 20 },
    { key: 'dailyLimit' as const, icon: WalletCards, min: 0, max: 500 },
  ]

  return (
    <SettingType id="structured-knowledge" title={t('title')} desc={t('desc')} icon={<BrainCircuit />}>
      <FormItem title={t('autoExtraction.title')}>
        <ItemGroup className="gap-4">
          <Item variant="outline" className="max-md:flex-col max-md:items-start">
            <ItemMedia variant="icon"><BrainCircuit className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('mode.title')}</ItemTitle>
              <ItemDescription>{t('mode.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select value={settings.mode} onValueChange={(value) => update('mode', value as StructuredExtractionMode)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t('mode.options.off')}</SelectItem>
                  <SelectItem value="manual">{t('mode.options.manual')}</SelectItem>
                  <SelectItem value="onSave">{t('mode.options.onSave')}</SelectItem>
                  <SelectItem value="onIdle">{t('mode.options.onIdle')}</SelectItem>
                </SelectContent>
              </Select>
            </ItemActions>
          </Item>

          <Item variant="outline" className="max-md:flex-col max-md:items-start">
            <ItemMedia variant="icon"><BrainCircuit className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('model.title')}</ItemTitle>
              <ItemDescription>{t('model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="w-72 max-md:w-full">
              <ModelSelect modelKey="structuredExtraction" />
            </ItemActions>
          </Item>

          {numericSettings.map((item) => {
            const Icon = item.icon
            return (
              <Item key={item.key} variant="outline" className="max-md:flex-col max-md:items-start">
                <ItemMedia variant="icon"><Icon className="size-4" /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(`${item.key}.title`)}</ItemTitle>
                  <ItemDescription>{t(`${item.key}.desc`)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <NumberInput value={settings[item.key]} min={item.min} max={item.max} onChange={(value) => update(item.key, value)} />
                </ItemActions>
              </Item>
            )
          })}

          <Item variant="outline" className="max-md:flex-col max-md:items-start">
            <ItemMedia variant="icon"><WalletCards className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('costWarningAccepted.title')}</ItemTitle>
              <ItemDescription>{t('costWarningAccepted.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={settings.costWarningAccepted} onCheckedChange={(value) => update('costWarningAccepted', value)} />
            </ItemActions>
          </Item>

          <Item variant="outline" className="max-md:flex-col max-md:items-start">
            <ItemMedia variant="icon"><ShieldAlert className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('privacyWarningAccepted.title')}</ItemTitle>
              <ItemDescription>{t('privacyWarningAccepted.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={settings.privacyWarningAccepted} onCheckedChange={(value) => update('privacyWarningAccepted', value)} />
            </ItemActions>
          </Item>
        </ItemGroup>
      </FormItem>
    </SettingType>
  )
}
