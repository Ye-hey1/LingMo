import * as React from "react"
import { useEffect, useState } from "react"
import { ModelConfig } from "../../setting/config"
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

interface GroupedModel {
  configKey: string
  configTitle: string
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
    if (aiModelList && aiModelList.length > 0) {
      const models: GroupedModel[] = []

      aiModelList.forEach(config => {
        if (!config.baseURL) return

        if (config.models && config.models.length > 0) {
          config.models.forEach(model => {
            if (model.modelType === 'chat' && model.model) {
              models.push({
                configKey: config.key,
                configTitle: config.title,
                model: model
              })
            }
          })
        } else {
          if ((config.modelType === 'chat' || !config.modelType) && config.model) {
            models.push({
              configKey: config.key,
              configTitle: config.title,
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

      setGroupedModels(models)
    }
  }, [aiModelList])

  const groupedByConfig = groupedModels.reduce((acc, item) => {
    if (!acc[item.configTitle]) {
      acc[item.configTitle] = []
    }
    acc[item.configTitle].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

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
            Object.entries(groupedByConfig).map(([configTitle, models]) => (
              <div key={configTitle}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/60">{configTitle}</div>
                {models.map((item) => (
                  <button
                    key={item.model.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                      primaryModel === item.model.id
                        ? "text-primary bg-primary/10"
                        : "hover:bg-muted/60"
                    )}
                    onClick={() => {
                      modelSelectChangeHandler(item.model.id)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.model.model}</span>
                    {primaryModel === item.model.id && (
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
