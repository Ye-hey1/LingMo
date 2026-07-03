import * as React from "react"
import { useEffect, useState } from "react"
import { ModelConfig, getBuiltinProviderTemplateMatch, getModelDisplayName } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { BotMessageSquare, BotOff, Check } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"
import { getCachedProviderTemplates, getProviderTemplateMatch } from "@/lib/ai/provider-templates-runtime"
import { getConfiguredProviderDisplayTitle } from "@/lib/ai/provider-display"
import { createConfiguredModelSelectionId, matchesConfiguredModelSelection } from "@/lib/ai/model-selection"

interface GroupedModel {
  value: string
  configKey: string
  providerTitle: string
  model: ModelConfig
}

interface ModelSelectProps {
  trigger?: React.ReactNode
  triggerClassName?: string
}

export function ModelSelect({ trigger, triggerClassName = "hidden md:block" }: ModelSelectProps) {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const { primaryModel, setPrimaryModel, aiModelList } = useSettingStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(modelId: string) {
    setPrimaryModel(modelId)
    const store = await Store.load('store.json');
    store.set('primaryModel', modelId)
    await store.save()
  }

  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
  }

  useEffect(() => {
    let cancelled = false

    async function initModels() {
      if (!aiModelList || aiModelList.length === 0) {
        setGroupedModels([])
        return
      }

      const providerTemplates = await getCachedProviderTemplates()
      const models: GroupedModel[] = []

      aiModelList.forEach(config => {
        if (!config.baseURL) return
        const providerTemplate = getProviderTemplateMatch(config, providerTemplates)
        const builtinProviderTemplate = getBuiltinProviderTemplateMatch(config)
        const providerTitle =
          getConfiguredProviderDisplayTitle(config, providerTemplate) ||
          getConfiguredProviderDisplayTitle(config, builtinProviderTemplate)

        if (config.models && config.models.length > 0) {
          config.models.forEach(model => {
            if (model.modelType === 'chat' && model.model) {
              models.push({
                value: createConfiguredModelSelectionId(config.key, model.id),
                configKey: config.key,
                providerTitle,
                model: model
              })
            }
          })
        } else {
          if ((config.modelType === 'chat' || !config.modelType) && config.model) {
            models.push({
              value: config.key,
              configKey: config.key,
              providerTitle,
              model: {
                id: config.key,
                model: config.model,
                modelType: config.modelType || 'chat',
                temperature: config.temperature,
                topP: config.topP,
                voice: config.voice,
                enableStream: config.enableStream
              }
            })
          }
        }
      })

      if (!cancelled) {
        setGroupedModels(models)
      }
    }

    void initModels()

    return () => {
      cancelled = true
    }
  }, [aiModelList])

  const groupedByConfig = groupedModels.reduce((acc, item) => {
    const key = item.providerTitle
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

  const modelMatchesSelection = (item: GroupedModel) => matchesConfiguredModelSelection({
    configKey: item.configKey,
    modelId: item.model.id,
    selectionId: primaryModel,
  })

  return (
    <Popover open={open} onOpenChange={handleSetOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          <button
            type="button"
            className={triggerClassName}
            aria-label={t('tooltip')}
          >
            {trigger}
          </button>
        ) : (
          <div className={triggerClassName}>
            <TooltipButton
              icon={groupedModels.length > 0 ? <BotMessageSquare className="size-4" /> : <BotOff className="size-4" />}
              tooltipText={t('tooltip')}
              size="icon"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" side="bottom" align="start">
        <div className="max-h-60 overflow-y-auto">
          {groupedModels.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">{t('noModel')}</div>
          ) : (
            Object.entries(groupedByConfig).map(([providerTitle, models]) => (
              <div key={providerTitle || 'models-without-provider'}>
                {providerTitle && (
                  <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/60">{providerTitle}</div>
                )}
                {models.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                      modelMatchesSelection(item)
                        ? "text-primary bg-primary/10"
                        : "hover:bg-muted/60"
                    )}
                    onClick={() => {
                      modelSelectChangeHandler(item.value)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{getModelDisplayName(item.model)}</span>
                    {modelMatchesSelection(item) && (
                      <Check className="size-3.5 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
