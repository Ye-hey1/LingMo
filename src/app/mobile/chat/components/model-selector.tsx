"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { ModelConfig, getBuiltinProviderTemplateMatch } from "@/app/core/setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { BotMessageSquare, BotOff, Check, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import { getCachedProviderTemplates, getProviderTemplateMatch } from "@/lib/ai/provider-templates-runtime"
import { getConfiguredProviderDisplayTitle } from "@/lib/ai/provider-display"

interface GroupedModel {
  configKey: string
  providerTitle: string
  model: ModelConfig
}

function ModelListContent({
  groupedByConfig,
  primaryModel,
  onSelect,
}: {
  groupedByConfig: Record<string, GroupedModel[]>
  primaryModel?: string
  onSelect: (modelId: string) => void
}) {
  return (
    <div className="space-y-4">
      {Object.entries(groupedByConfig).map(([providerTitle, models]) => (
        <div key={providerTitle || 'models-without-provider'} className="space-y-1">
          {providerTitle && (
            <div className="px-2 text-xs font-medium text-muted-foreground">
              {providerTitle}
            </div>
          )}
          {models.map((item) => {
            const isSelected = primaryModel === item.model.id

            return (
              <button
                key={item.model.id}
                onClick={() => onSelect(item.model.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                  isSelected ? "bg-accent" : "hover:bg-muted/50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{item.model.model}</div>
                </div>
                <div
                  className={cn(
                    "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                >
                  {isSelected && <Check className="size-3.5" />}
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function ModelSelector() {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const [open, setOpen] = useState(false)
  const { primaryModel, setPrimaryModel, aiModelList, initSettingData } = useSettingStore()
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(modelId: string) {
    setPrimaryModel(modelId)
    const store = await Store.load('store.json')
    store.set('primaryModel', modelId)
    await store.save()
  }

  useEffect(() => {
    initSettingData()
  }, [])

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
                configKey: config.key,
                providerTitle,
                model: model
              })
            }
          })
        } else {
          if ((config.modelType === 'chat' || !config.modelType) && config.model) {
            models.push({
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

  const selectedModel = groupedModels.find((item) => item.model.id === primaryModel)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-16 flex items-center justify-between w-full px-0"
      >
        <div className="flex items-center gap-2">
          {groupedModels.length > 0 ? (
            <BotMessageSquare className="size-4" />
          ) : (
            <BotOff className="size-4" />
          )}
          <Label className="text-sm font-medium">{t('tooltip')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-40">
            {selectedModel?.model.model || t('placeholder')}
          </span>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </div>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader>
            <DrawerTitle>{t('tooltip')}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4 overflow-auto">
            <ModelListContent
              groupedByConfig={groupedByConfig}
              primaryModel={primaryModel}
              onSelect={async (modelId) => {
                await modelSelectChangeHandler(modelId)
                setOpen(false)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
