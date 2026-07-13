import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig, ModelConfig, getModelDisplayName } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { ChevronsUpDown, X } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import { getConfiguredProviderDisplayTitle } from "@/lib/ai/provider-display"
import { createConfiguredModelSelectionId, matchesConfiguredModelSelection } from "@/lib/ai/model-selection"

interface GroupedModel {
  value: string
  configKey: string
  providerTitle: string
  model: ModelConfig
}

interface ModelSelectProps {
  modelKey: string
  className?: string
  triggerClassName?: string
  popoverClassName?: string
  hideClear?: boolean
  emptyLabel?: string
  clearTooltip?: string
}

export function ModelSelect({ modelKey, className, triggerClassName, popoverClassName, hideClear, emptyLabel, clearTooltip }: ModelSelectProps) {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const {
    aiModelList,
    setCompletionModel,
    setMarkDescModel,
    setPrimaryModel,
    setImageMethodModel,
    setAudioModel,
    setSttModel,
    setEmbeddingModel,
    setRerankingModel,
    setImageGenerationModel,
    setVideoGenerationModel,
    setCondenseModel,
    setInspirationModel,
    setPromptEnhancerModel,
    setStructuredExtractionModel,
  } = useSettingStore()
  const [model, setModel] = useState<string>('')
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('settings.defaultModel')

  function getCurrentStoreModelValue(): string {
    const state = useSettingStore.getState()
    switch (modelKey) {
      case 'primaryModel': return state.primaryModel
      case 'imageMethod': return state.imageMethodModel
      case 'imageGeneration': return state.imageGenerationModel
      case 'videoGeneration': return state.videoGenerationModel
      case 'completion': return state.completionModel
      case 'markDesc': return state.markDescModel
      case 'audio':
      case 'tts': return state.audioModel
      case 'stt': return state.sttModel
      case 'embedding': return state.embeddingModel
      case 'reranking': return state.rerankingModel
      case 'condense': return state.condenseModel
      case 'inspiration': return state.inspirationModel
      case 'promptEnhancer': return state.promptEnhancerModel
      case 'structuredExtraction': return state.structuredExtractionModel
      default: return ''
    }
  }

  function getStoreKey(modelKey: string): string {
    switch (modelKey) {
      case 'primaryModel': return 'primaryModel'
      case 'imageMethod': return 'imageMethodModel'
      case 'imageGeneration': return 'imageGenerationModel'
      case 'videoGeneration': return 'videoGenerationModel'
      case 'completion': return 'completionModel'
      case 'markDesc': return 'markDescModel'
      case 'audio':
      case 'tts': return 'audioModel'
      case 'stt': return 'sttModel'
      case 'embedding': return 'embeddingModel'
      case 'reranking': return 'rerankingModel'
      case 'condense': return 'condenseModel'
      case 'inspiration': return 'inspirationModel'
      case 'promptEnhancer': return 'promptEnhancerModel'
      case 'structuredExtraction': return 'structuredExtractionModel'
      default: return `${modelKey}Model`
    }
  }

  function setPrimaryModelHandler(primaryModel: string) {
    if (model === primaryModel && getCurrentStoreModelValue() === primaryModel) {
      return
    }

    setModel(primaryModel)
    switch (modelKey) {
      case 'primaryModel': setPrimaryModel(primaryModel); break
      case 'imageMethod': setImageMethodModel(primaryModel); break
      case 'imageGeneration': setImageGenerationModel(primaryModel); break
      case 'videoGeneration': setVideoGenerationModel(primaryModel); break
      case 'completion': setCompletionModel(primaryModel); break
      case 'markDesc': setMarkDescModel(primaryModel); break
      case 'audio':
      case 'tts': setAudioModel(primaryModel); break
      case 'stt': setSttModel(primaryModel); break
      case 'embedding': setEmbeddingModel(primaryModel); break
      case 'reranking': setRerankingModel(primaryModel); break
      case 'condense': setCondenseModel(primaryModel); break
      case 'inspiration': setInspirationModel(primaryModel); break
      case 'promptEnhancer': setPromptEnhancerModel(primaryModel); break
      case 'structuredExtraction': setStructuredExtractionModel(primaryModel); break
    }
  }

  function getTargetModelType(modelKey: string): string {
    switch (modelKey) {
      case 'embedding': return 'embedding'
      case 'reranking': return 'rerank'
      case 'audio':
      case 'tts': return 'tts'
      case 'stt': return 'stt'
      case 'imageGeneration': return 'image'
      case 'videoGeneration': return 'video'
      default: return 'chat'
    }
  }

  function createModelSelectValue(configKey: string, modelId: string): string {
    return createConfiguredModelSelectionId(configKey, modelId)
  }

  function getProviderTitle(config: AiConfig): string {
    return getConfiguredProviderDisplayTitle(config) || config.key || ''
  }

  function modelMatchesSelection(item: GroupedModel, selectedModel: string): boolean {
    if (!selectedModel) return false
    return matchesConfiguredModelSelection({
      configKey: item.configKey,
      modelId: item.model.id,
      selectionId: selectedModel,
    })
  }

  function getModelDedupKey(item: GroupedModel): string {
    return [
      (item.providerTitle || item.configKey).trim().toLowerCase(),
      item.model.modelType,
      item.model.model.trim().toLowerCase(),
    ].join(':')
  }

  function dedupeGroupedModels(models: GroupedModel[], selectedModel = '') {
    const deduped = new Map<string, GroupedModel>()

    for (const item of models) {
      const key = getModelDedupKey(item)
      const existing = deduped.get(key)
      if (existing && !modelMatchesSelection(item, selectedModel)) {
        continue
      }
      deduped.set(key, item)
    }

    return Array.from(deduped.values())
  }

  async function initModelList() {
    const store = await Store.load('store.json');
    const aiConfigs = await store.get<AiConfig[]>('aiModelList')
    if (!aiConfigs) return

    const models: GroupedModel[] = []
    const targetModelType = getTargetModelType(modelKey)

    aiConfigs.forEach(config => {
      if (!config.baseURL) return
      if (config.enabled === false) return
      if (targetModelType === 'stt' && !config.apiKey?.trim()) return

      if (config.models && config.models.length > 0) {
        const providerTitle = getProviderTitle(config)
        config.models.forEach(m => {
          if (m.modelType === targetModelType && m.model) {
            models.push({
              value: createModelSelectValue(config.key, m.id),
              configKey: config.key,
              providerTitle,
              model: m,
            })
          }
        })
      } else if ((config.modelType || 'chat') === targetModelType && config.model) {
        models.push({
          value: config.key,
          configKey: config.key,
          providerTitle: getProviderTitle(config),
          model: {
            id: config.key,
            model: config.model,
            modelType: config.modelType || 'chat',
            temperature: config.temperature,
            topP: config.topP,
            contextWindow: config.contextWindow,
            voice: config.voice,
            enableStream: config.enableStream,
          },
        })
      }
    })

    const storeKey = getStoreKey(modelKey)
    const primaryModel = await store.get<string>(storeKey)
    const visibleModels = dedupeGroupedModels(models, primaryModel)
    setGroupedModels(visibleModels)

    if (!primaryModel) return
    const selectedModel = visibleModels.find(item => modelMatchesSelection(item, primaryModel))
    const nextModel = selectedModel?.value || primaryModel
    if (nextModel !== model || nextModel !== getCurrentStoreModelValue()) {
      setPrimaryModelHandler(nextModel)
    }
  }

  async function modelSelectChangeHandler(e: string) {
    setPrimaryModelHandler(e)
    const store = await Store.load('store.json');
    const storeKey = getStoreKey(modelKey)
    store.set(storeKey, e)
    await store.save()
  }

  async function resetDefaultModel() {
    const store = await Store.load('store.json');
    const storeKey = getStoreKey(modelKey)
    store.set(storeKey, '')
    await store.save()
    setPrimaryModelHandler('')
  }

  const isModelSelected = (modelId: string): boolean => {
    return model === modelId
  }

  const findSelectedModelDisplay = () => {
    if (!model || !groupedModels.length) return null
    const selectedItem = groupedModels.find(item => modelMatchesSelection(item, model))
    if (selectedItem) {
      const displayName = getModelDisplayName(selectedItem.model)
      return selectedItem.providerTitle
        ? `${displayName} (${selectedItem.providerTitle})`
        : displayName
    }
    return null
  }

  // 按真实供应商显示名分组；没有供应商时不显示分组标题。
  const groupedByConfig = groupedModels.reduce((acc, item) => {
    const key = item.providerTitle
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

  useEffect(() => {
    initModelList()
  }, [aiModelList, modelKey])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("flex gap-2", className)}>
        <PopoverTrigger asChild>
          <div className="flex-1 overflow-hidden">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn("w-full justify-between", triggerClassName)}
            >
              <span className="min-w-0 truncate">
                {model
                  ? findSelectedModelDisplay() || t('tooltip')
                  : emptyLabel || (modelKey === 'primaryModel' ? t('noModel') : t('tooltip'))}
              </span>
              <ChevronsUpDown className="shrink-0 opacity-50" />
            </Button>
          </div>
        </PopoverTrigger>
        {!hideClear && (
          <TooltipButton
            disabled={!model}
            icon={<X className="h-4 w-4" />}
            onClick={resetDefaultModel}
            variant="default"
            tooltipText={clearTooltip || t('tooltip')}
          />
        )}
      </div>
      <PopoverContent align="end" className={cn("p-0", popoverClassName)}>
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {Object.entries(groupedByConfig).map(([providerTitle, models]) => (
              <CommandGroup key={providerTitle || 'models-without-provider'} heading={providerTitle || undefined}>
                {models.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={item.value}
                    keywords={[getModelDisplayName(item.model), item.model.model, item.providerTitle, item.configKey]}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    {getModelDisplayName(item.model)}
                    <Check
                      className={cn(
                        "ml-auto",
                        isModelSelected(item.value) ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
