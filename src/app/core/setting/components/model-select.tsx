import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig, ModelConfig, builtinProviderTemplates } from "../../setting/config"
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
import { getCachedProviderTemplates, getProviderTemplateMatch } from "@/lib/ai/provider-templates-runtime"
import { getConfiguredProviderDisplayTitle } from "@/lib/ai/provider-display"

interface GroupedModel {
  configKey: string
  providerTitle: string
  model: ModelConfig
}

export function ModelSelect({modelKey}: {modelKey: string}) {
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
    setCondenseModel,
    setInspirationModel,
    setPromptEnhancerModel,
  } = useSettingStore()
  const [model, setModel] = useState<string>('')
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('settings.defaultModel')

  function getStoreKey(modelKey: string): string {
    switch (modelKey) {
      case 'primaryModel': return 'primaryModel'
      case 'imageMethod': return 'imageMethodModel'
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
      default: return `${modelKey}Model`
    }
  }

  function setPrimaryModelHandler(primaryModel: string) {
    setModel(primaryModel)
    switch (modelKey) {
      case 'primaryModel': setPrimaryModel(primaryModel); break
      case 'imageMethod': setImageMethodModel(primaryModel); break
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
    }
  }

  function getTargetModelType(modelKey: string): string {
    switch (modelKey) {
      case 'embedding': return 'embedding'
      case 'reranking': return 'rerank'
      case 'audio':
      case 'tts': return 'tts'
      case 'stt': return 'stt'
      default: return 'chat'
    }
  }

  async function initModelList() {
    const store = await Store.load('store.json');
    const aiConfigs = await store.get<AiConfig[]>('aiModelList')
    if (!aiConfigs) return

    // 加载 provider 模板，用于统一供应商显示名称
    const templates = await getCachedProviderTemplates()

    const models: GroupedModel[] = []
    const targetModelType = getTargetModelType(modelKey)

    const getProviderTitleWithTemplates = (config: AiConfig, tpl: AiConfig[]): string => {
      const matched = getProviderTemplateMatch(config, tpl)
      const builtin = builtinProviderTemplates.find((tpl2) => {
        if (config.templateKey && config.templateKey === tpl2.key) return true
        const norm = (u?: string) => (u || '').trim().replace(/\/+$/, '').toLowerCase()
        return norm(config.baseURL) === norm(tpl2.baseURL)
      })
      return getConfiguredProviderDisplayTitle(config, matched) || getConfiguredProviderDisplayTitle(config, builtin)
    }

    aiConfigs.forEach(config => {
      if (!config.baseURL) return
      if (config.enabled === false) return
      if (targetModelType === 'stt' && !config.apiKey?.trim()) return

      if (config.models && config.models.length > 0) {
        const providerTitle = getProviderTitleWithTemplates(config, templates)
        config.models.forEach(m => {
          if (m.modelType === targetModelType && m.model) {
            models.push({
              configKey: config.key,
              providerTitle,
              model: m,
            })
          }
        })
      }
    })

    setGroupedModels(models)

    const storeKey = getStoreKey(modelKey)
    const primaryModel = await store.get<string>(storeKey)
    if (!primaryModel) return
    setPrimaryModelHandler(primaryModel)
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
    const selectedItem = groupedModels.find(item => item.model.id === model)
    if (selectedItem) {
      return selectedItem.providerTitle
        ? `${selectedItem.model.model} (${selectedItem.providerTitle})`
        : selectedItem.model.model
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
      <div className="flex gap-2">
        <PopoverTrigger asChild>
          <div className="flex-1 overflow-hidden">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[280px] justify-between"
            >
              {model
                ? findSelectedModelDisplay() || t('tooltip')
                : modelKey === 'primaryModel' ? t('noModel') : t('tooltip')}
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </div>
        </PopoverTrigger>
        <TooltipButton
          disabled={!model}
          icon={<X className="h-4 w-4" />}
          onClick={resetDefaultModel}
          variant="default"
          tooltipText={t('tooltip')}
        />
      </div>
      <PopoverContent align="end" className="p-0">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {Object.entries(groupedByConfig).map(([providerTitle, models]) => (
              <CommandGroup key={providerTitle || 'models-without-provider'} heading={providerTitle || undefined}>
                {models.map((item) => (
                  <CommandItem
                    key={item.model.id}
                    value={item.model.id}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    {item.model.model}
                    <Check
                      className={cn(
                        "ml-auto",
                        isModelSelected(item.model.id) ? "opacity-100" : "opacity-0"
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
