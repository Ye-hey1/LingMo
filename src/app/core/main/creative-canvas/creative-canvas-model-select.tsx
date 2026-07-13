'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronsUpDown, Cpu, Settings2 } from 'lucide-react'
import { getModelDisplayName, type ModelConfig } from '@/app/core/setting/config'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createConfiguredModelSelectionId, matchesConfiguredModelSelection } from '@/lib/ai/model-selection'
import { getConfiguredProviderDisplayTitle } from '@/lib/ai/provider-display'
import { cn } from '@/lib/utils'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

interface CanvasImageModelOption {
  value: string
  configKey: string
  providerTitle: string
  model: ModelConfig
}

interface CreativeCanvasModelSelectProps {
  value?: string
  onValueChange: (value?: string) => void
  inheritLabel?: string
  className?: string
  compact?: boolean
}

function buildImageModelOptions(aiModelList: ReturnType<typeof useSettingStore.getState>['aiModelList']) {
  const options: CanvasImageModelOption[] = []
  for (const config of aiModelList) {
    if (config.enabled === false || !config.baseURL) continue
    const providerTitle = getConfiguredProviderDisplayTitle(config) || config.key
    if (config.models?.length) {
      for (const model of config.models) {
        if (model.modelType !== 'image' || !model.model) continue
        options.push({
          value: createConfiguredModelSelectionId(config.key, model.id),
          configKey: config.key,
          providerTitle,
          model,
        })
      }
      continue
    }
    if (config.modelType === 'image' && config.model) {
      options.push({
        value: config.key,
        configKey: config.key,
        providerTitle,
        model: {
          id: config.key,
          model: config.model,
          modelType: 'image',
        },
      })
    }
  }

  return Array.from(new Map(options.map(option => [option.value, option])).values())
}

function matchesOption(option: CanvasImageModelOption, selection?: string) {
  return matchesConfiguredModelSelection({
    configKey: option.configKey,
    modelId: option.model.id,
    selectionId: selection,
  })
}

export function CreativeCanvasModelSelect({
  value,
  onValueChange,
  inheritLabel,
  className,
  compact = false,
}: CreativeCanvasModelSelectProps) {
  const aiModelList = useSettingStore(state => state.aiModelList)
  const t = useTranslations('creativeCanvas')
  const globalSelection = useSettingStore(state => state.imageGenerationModel)
  const openSettings = useSettingsDialogStore(state => state.open)
  const [open, setOpen] = useState(false)
  const options = useMemo(() => buildImageModelOptions(aiModelList), [aiModelList])
  const selected = options.find(option => matchesOption(option, value))
  const globalModel = options.find(option => matchesOption(option, globalSelection))
  const resolvedInheritLabel = inheritLabel || t('model.inheritGlobal')
  const label = selected
    ? `${getModelDisplayName(selected.model)} · ${selected.providerTitle}`
    : globalModel
      ? `${resolvedInheritLabel} · ${getModelDisplayName(globalModel.model)}`
      : resolvedInheritLabel

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'min-w-0 justify-between gap-2 bg-background font-normal',
            compact ? 'h-8 px-2 text-xs' : 'h-9',
            className,
          )}
          onPointerDown={event => event.stopPropagation()}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" onPointerDown={event => event.stopPropagation()}>
        <Command>
          <CommandInput placeholder={t('model.search')} />
          <CommandList>
            <CommandItem
              value="inherit-global-image-model"
              onSelect={() => {
                onValueChange(undefined)
                setOpen(false)
              }}
            >
              <Cpu className="size-4" />
              <span className="min-w-0 flex-1 truncate">{resolvedInheritLabel}</span>
              <Check className={cn('size-4', value ? 'opacity-0' : 'opacity-100')} />
            </CommandItem>
            <CommandEmpty>{t('model.empty')}</CommandEmpty>
            {Array.from(new Set(options.map(option => option.providerTitle))).map(providerTitle => (
              <CommandGroup key={providerTitle} heading={providerTitle}>
                {options.filter(option => option.providerTitle === providerTitle).map(option => (
                  <CommandItem
                    key={option.value}
                    value={`${option.value} ${getModelDisplayName(option.model)} ${option.model.model} ${providerTitle}`}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <Cpu className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{getModelDisplayName(option.model)}</span>
                    <Check className={cn('size-4', matchesOption(option, value) ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="border-t border-border p-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start gap-2 text-xs"
              onClick={() => {
                setOpen(false)
                openSettings('ai')
              }}
            >
              <Settings2 className="size-3.5" />
              {t('model.manage')}
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default CreativeCanvasModelSelect
