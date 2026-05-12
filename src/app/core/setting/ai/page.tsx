'use client'

import { useEffect, useState } from "react"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use'
import { Store } from "@tauri-apps/plugin-store"
import { v4 } from 'uuid'
import { confirm } from '@tauri-apps/plugin-dialog'

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Accordion } from "@/components/ui/accordion"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import Image from "next/image"

import { FormItem } from "../components/setting-base"
import { AiConfig, ModelConfig, ModelType, builtinProviderTemplates } from "../config"
import useSettingStore from "@/stores/setting"

import { BotMessageSquare, Eye, EyeOff, LoaderCircle, Minus, Plus, Search, Trash2, X } from "lucide-react"
import { OpenBroswer } from "@/components/open-broswer"
import DefaultModelsSection from "./default-models"
import ModelCard from "./model-card"
import CreateConfig from "./create"
import { getCachedProviderTemplates, getProviderTemplateMatch, loadProviderTemplates } from "@/lib/ai/provider-templates-runtime"
import { cn } from "@/lib/utils"
import { createOpenAIClient } from "@/lib/ai/utils"

export default function AiPage() {
  const t = useTranslations('settings.ai')
  const { aiModelList, setAiModelList } = useSettingStore()

  type ActionFeedback = { type: 'success' | 'error'; message: string } | null

  const allModelConfigs = aiModelList
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [fetchingModelList, setFetchingModelList] = useState(false)
  const [apiTestFeedback, setApiTestFeedback] = useState<ActionFeedback>(null)
  const [modelFetchFeedback, setModelFetchFeedback] = useState<ActionFeedback>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerCandidates, setModelPickerCandidates] = useState<string[]>([])
  const [modelDraftList, setModelDraftList] = useState<ModelConfig[]>([])
  const [testModelPickerOpen, setTestModelPickerOpen] = useState(false)
  const [testModelCandidate, setTestModelCandidate] = useState('')
  const [headerPairs, setHeaderPairs] = useState<Array<{ key: string; value: string; id: string }>>([])
  const [providerTemplates, setProviderTemplates] = useState<AiConfig[]>([])
  const [providerSearch, setProviderSearch] = useState('')

  const [selectedAiConfig, setSelectedAiConfig] = useLocalStorage<string>('ai-config-selected', '')
  const [expandedModelsByConfig, setExpandedModelsByConfig] = useLocalStorage<Record<string, string[]>>(
    'ai-config-expanded-models',
    {}
  )
  const [modelTypeFilterByConfig, setModelTypeFilterByConfig] = useLocalStorage<Record<string, 'all' | ModelType>>(
    'ai-config-model-type-filter',
    {}
  )

  const currentConfig = allModelConfigs.find((item) => item.key === selectedAiConfig)
  const currentProviderTemplate = getProviderTemplateMatch(currentConfig, providerTemplates)
  const currentApiKeyUrl = currentProviderTemplate?.apiKeyUrl || currentConfig?.apiKeyUrl
  const currentExpandedModels = currentConfig ? expandedModelsByConfig?.[currentConfig.key] || [] : []
  const currentModelTypeFilter = currentConfig ? modelTypeFilterByConfig?.[currentConfig.key] || 'all' : 'all'

  const filteredCurrentModels = (currentConfig?.models || []).filter((item) => {
    return currentModelTypeFilter === 'all' ? true : item.modelType === currentModelTypeFilter
  })

  const filteredPickerCandidates = modelPickerCandidates.filter((item) =>
    item.toLowerCase().includes(modelPickerQuery.trim().toLowerCase())
  )
  const draftModelSet = new Set(modelDraftList.map((item) => item.model.trim().toLowerCase()).filter(Boolean))

  const getModelTypeLabel = (type: ModelType) => {
    const labels: Record<ModelType, string> = {
      chat: t('modelType.chat'),
      tts: t('modelType.tts'),
      stt: t('modelType.stt'),
      embedding: t('modelType.embedding'),
      rerank: t('modelType.rerank'),
      image: '图像',
      video: '视频',
    }
    return labels[type] || type
  }

  const getModelTypeFilterOptions = () => {
    const modelTypes = Array.from(new Set((currentConfig?.models || []).map((item) => item.modelType)))
    return [
      { value: 'all' as const, label: '全部' },
      ...modelTypes.map((type) => ({ value: type, label: getModelTypeLabel(type) })),
    ]
  }

  const isOfficialConfig = (config: AiConfig) => {
    const hasTemplateIdentity = Boolean(config.templateKey) || Boolean(getProviderTemplateMatch(config, providerTemplates))
    if (config.templateSource === 'custom' && !hasTemplateIdentity) {
      return false
    }
    if (config.templateSource === 'builtin' || config.templateSource === 'remote') {
      return true
    }
    return hasTemplateIdentity
  }

  const providerSearchKeyword = providerSearch.trim().toLowerCase()
  const matchesProviderSearch = (fields: Array<string | undefined>) => {
    if (!providerSearchKeyword) {
      return true
    }
    return fields
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(providerSearchKeyword)
  }

  const filteredOfficialTemplates = providerTemplates.filter((item) => {
    return matchesProviderSearch([item.title, item.baseURL, item.key, item.templateKey, item.templateSource])
  })

  const customModelConfigs = allModelConfigs.filter((item) => {
    if (isOfficialConfig(item)) {
      return false
    }
    return matchesProviderSearch([item.title, item.baseURL, item.templateKey, item.templateSource])
  })

  const normalizeBaseUrl = (baseURL?: string) => {
    return (baseURL || '').trim().replace(/\/+$/, '').toLowerCase()
  }

  const groupedCustomModelConfigs = (() => {
    const groups = new Map<string, { baseURL: string; items: AiConfig[] }>()

    customModelConfigs.forEach((item) => {
      const rawBaseUrl = (item.baseURL || '').trim()
      const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl)
      const groupKey = normalizedBaseUrl || `__empty__:${item.key}`
      const existed = groups.get(groupKey)

      if (existed) {
        existed.items.push(item)
        return
      }

      groups.set(groupKey, {
        baseURL: rawBaseUrl,
        items: [item],
      })
    })

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      baseURL: value.baseURL,
      items: value.items,
    }))
  })()

  const hasAnyProviderResult = filteredOfficialTemplates.length > 0 || customModelConfigs.length > 0

  const getConfigIcon = (config: AiConfig) => {
    return getProviderTemplateMatch(config, providerTemplates)?.icon || config.icon
  }

  const getConfigModelCount = (config: AiConfig) => {
    return config.models?.length || 0
  }

  const findConfigByTemplate = (template: AiConfig) => {
    return allModelConfigs.find((config) => {
      if (config.templateKey && config.templateKey === template.key) {
        return true
      }
      const matchedTemplate = getProviderTemplateMatch(config, providerTemplates)
      return matchedTemplate?.key === template.key
    })
  }

  const isConfigUsable = (config: AiConfig) => {
    const hasBaseUrl = Boolean(config.baseURL && config.baseURL.trim())
    const hasValidModel = (config.models || []).some((item) => Boolean(item.model && item.model.trim()))
    return hasBaseUrl && hasValidModel
  }

  const setCurrentExpandedModels = (next: string[]) => {
    if (!currentConfig) return
    setExpandedModelsByConfig({
      ...(expandedModelsByConfig || {}),
      [currentConfig.key]: next,
    })
  }

  const setCurrentModelTypeFilter = (next: 'all' | ModelType) => {
    if (!currentConfig) return
    setModelTypeFilterByConfig({
      ...(modelTypeFilterByConfig || {}),
      [currentConfig.key]: next,
    })
  }

  const setCurrentConfigEnabled = async (enabled: boolean) => {
    if (!currentConfig) return
    await updateAiConfig({
      ...currentConfig,
      enabled,
    })
  }

  const inferModelTypeFromId = (modelId: string): ModelType => {
    const value = modelId.toLowerCase()
    if (value.includes('embedding')) return 'embedding'
    if (value.includes('rerank')) return 'rerank'
    if (value.includes('tts') || value.includes('speech')) return 'tts'
    if (value.includes('stt') || value.includes('transcribe') || value.includes('whisper')) return 'stt'
    if (value.includes('image') || value.includes('vision')) return 'image'
    if (value.includes('video')) return 'video'
    return 'chat'
  }

  const parseErrorText = async (response: Response) => {
    const text = (await response.text().catch(() => '')).trim()
    if (!text) return ''
    try {
      const parsed = JSON.parse(text)
      return parsed?.error?.message?.trim() || parsed?.message?.trim() || text
    } catch {
      return text
    }
  }

  const parseModelIdsFromResponse = (data: any): string[] => {
    if (Array.isArray(data?.data)) {
      return data.data
        .map((item: any) => item?.id || item?.model)
        .filter(Boolean)
    }
    if (Array.isArray(data?.models)) {
      return data.models
        .map((item: any) => item?.id || item?.name || item?.model)
        .filter(Boolean)
    }
    return []
  }

  const normalizeApiBaseUrl = (baseURL: string) => {
    return baseURL
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/chat\/completions$/i, '')
  }

  const buildBaseUrlCandidates = (baseURL: string) => {
    const normalized = normalizeApiBaseUrl(baseURL)
    const candidates = [normalized]
    const hasVersion = /\/v\d+$/i.test(normalized)
    if (!hasVersion && !normalized.toLowerCase().includes('/api/tags')) {
      candidates.push(`${normalized}/v1`)
    }
    return Array.from(new Set(candidates.filter(Boolean)))
  }

  const sanitizeMessage = (raw: string) => {
    const compact = raw.replace(/\s+/g, ' ').trim()
    if (!compact) return '请求失败，请检查配置后重试。'

    const cloudflareBlocked =
      /cloudflare|challenge\.cloudflare|attention required/i.test(compact) ||
      (/AI_HTTP_ERROR/i.test(compact) && /status=403/i.test(compact))
    if (cloudflareBlocked) {
      return '请求被服务商网关拒绝（403），请检查 BaseURL、API Key 或中转权限。'
    }

    if (/status=401|unauthorized|invalid api key|incorrect api key/i.test(compact)) {
      return 'API Key 无效或未授权（401），请检查密钥是否正确、是否有调用权限。'
    }

    if (/status=404|not found/i.test(compact)) {
      return '接口地址不存在（404），请确认 BaseURL 是否为服务商给出的 API 网关地址。'
    }

    if (/status=429|rate limit/i.test(compact)) {
      return '请求过于频繁或配额不足（429），请稍后重试或检查账户额度。'
    }

    return compact.length > 240 ? `${compact.slice(0, 240)}...` : compact
  }

  const buildAuthHeaders = (apiKey: string, customHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    Object.entries(customHeaders).forEach(([key, value]) => {
      const safeKey = key.trim()
      if (safeKey && value != null) {
        headers[safeKey] = String(value)
      }
    })
    return headers
  }

  const fetchModelsFromCandidates = async (candidates: string[], headers: Record<string, string>) => {
    let lastError = '未获取到可用模型，请检查当前服务商接口是否支持 /models。'

    for (const candidate of candidates) {
      try {
        let response = await fetch(`${candidate}/models`, {
          method: 'GET',
          headers,
        })

        const isOllamaLike = candidate.includes('11434') || candidate.toLowerCase().includes('ollama')
        if (!response.ok && isOllamaLike) {
          const ollamaBase = candidate
            .replace(/\/v1$/i, '')
            .replace(/\/api$/i, '')
            .replace(/\/chat\/completions$/i, '')
          response = await fetch(`${ollamaBase}/api/tags`, {
            method: 'GET',
            headers,
          })
        }

        if (!response.ok) {
          const errorText = await parseErrorText(response)
          lastError = `获取失败（${response.status}）：${errorText || response.statusText}`
          continue
        }

        const payload = await response.json().catch(() => ({}))
        const ids = Array.from(
          new Set(parseModelIdsFromResponse(payload).map((item) => String(item).trim()).filter(Boolean))
        )

        if (ids.length === 0) {
          lastError = '未获取到可用模型，请检查当前服务商接口是否支持 /models。'
          continue
        }

        return { ids, usedBaseUrl: candidate }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    throw new Error(lastError)
  }

  const cloneModelList = (models: ModelConfig[] = []) => {
    return models.map((item) => ({ ...item }))
  }

  const hasModelInDraft = (list: ModelConfig[], modelName: string) => {
    const normalized = modelName.trim().toLowerCase()
    if (!normalized) return false
    return list.some((item) => item.model.trim().toLowerCase() === normalized)
  }

  const openModelPicker = (candidateIds: string[]) => {
    const ids = Array.from(new Set(candidateIds.map((item) => item.trim()).filter(Boolean)))
    setModelPickerCandidates(ids)
    setModelPickerQuery('')
    setModelDraftList(cloneModelList(currentConfig?.models || []))
    setModelPickerOpen(true)
  }

  const addModelToDraft = (modelName: string) => {
    const value = modelName.trim()
    if (!value) return
    setModelDraftList((prev) => {
      if (hasModelInDraft(prev, value)) return prev
      return [
        ...prev,
        {
          id: v4(),
          model: value,
          modelType: inferModelTypeFromId(value),
          temperature: 0.7,
          topP: 1,
          enableStream: true,
        },
      ]
    })
  }

  const removeModelFromDraftByName = (modelName: string) => {
    const normalized = modelName.trim().toLowerCase()
    setModelDraftList((prev) => prev.filter((item) => item.model.trim().toLowerCase() !== normalized))
  }

  const saveModelDraft = async () => {
    if (!currentConfig) return
    await updateAiConfig({
      ...currentConfig,
      models: cloneModelList(modelDraftList),
    })
    setModelFetchFeedback(null)
    setModelPickerOpen(false)
  }

  const fetchModelList = async () => {
    if (!currentConfig) return
    if (fetchingModelList) return
    setModelFetchFeedback(null)

    const rawBaseUrl = (currentConfig.baseURL || '').trim()
    if (!rawBaseUrl) {
      const message = '请先填写 API 地址后再获取模型列表。'
      setModelFetchFeedback({ type: 'error', message })
      return
    }

    const isLocalProvider = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i.test(rawBaseUrl)
    const apiKey = (currentConfig.apiKey || '').trim()
    if (!isLocalProvider && !apiKey) {
      const message = '请先填写 API Key 后再获取模型列表。'
      setModelFetchFeedback({ type: 'error', message })
      return
    }

    setFetchingModelList(true)
    try {
      const candidates = buildBaseUrlCandidates(rawBaseUrl)
      const headers = buildAuthHeaders(apiKey, currentConfig.customHeaders || {})
      const { ids, usedBaseUrl } = await fetchModelsFromCandidates(candidates, headers)

      if (ids.length === 0) {
        const message = '未获取到可用模型，请检查当前服务商接口是否支持 /models。'
        setModelFetchFeedback({ type: 'error', message })
        return
      }

      await updateAiConfig({
        ...currentConfig,
        baseURL: usedBaseUrl,
      })

      openModelPicker(ids)
      setModelFetchFeedback(null)
    } catch (error) {
      const message = sanitizeMessage(error instanceof Error ? error.message : '获取模型列表失败')
      setModelFetchFeedback({ type: 'error', message })
    } finally {
      setFetchingModelList(false)
    }
  }

  const testCurrentConfigConnection = async (modelId: string) => {
    if (!currentConfig) return
    setApiTestFeedback(null)

    const rawBaseUrl = (currentConfig.baseURL || '').trim()
    const apiKey = (currentConfig.apiKey || '').trim()

    if (!rawBaseUrl || !apiKey) {
      const message = '请先填写 BaseURL 和 API 密钥后再测试。'
      setApiTestFeedback({ type: 'error', message })
      return
    }

    const pickedModel = modelId.trim()
    if (!pickedModel) {
      const message = '请先选择一个模型再测试。'
      setApiTestFeedback({ type: 'error', message })
      return
    }

    const targetModelConfig = (currentConfig.models || []).find(
      (item) => item.model.trim().toLowerCase() === pickedModel.toLowerCase()
    )

    setTestingConnection(true)
    try {
      const candidates = buildBaseUrlCandidates(rawBaseUrl)

      let lastError = ''
      for (const candidate of candidates) {
        try {
          const openai = await createOpenAIClient({
            ...currentConfig,
            baseURL: candidate,
            model: pickedModel,
            modelType: targetModelConfig?.modelType || inferModelTypeFromId(pickedModel),
            temperature: targetModelConfig?.temperature,
            topP: targetModelConfig?.topP,
            enableStream: false,
          })
          await openai.chat.completions.create({
            model: pickedModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 8,
          })

          await updateAiConfig({
            ...currentConfig,
            baseURL: candidate,
          })

          const message = `模型 ${pickedModel} 测试通过。`
          setApiTestFeedback({ type: 'success', message })
          setTestModelPickerOpen(false)
          return
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }
      throw new Error(lastError || '连接测试失败')
    } catch (error) {
      const message = sanitizeMessage(error instanceof Error ? error.message : '连接测试失败')
      setApiTestFeedback({ type: 'error', message })
    } finally {
      setTestingConnection(false)
    }
  }

  const openTestModelPicker = () => {
    if (!currentConfig) return
    setApiTestFeedback(null)
    const available = (currentConfig.models || [])
      .map((item) => item.model.trim())
      .filter(Boolean)
    if (available.length === 0) {
      setApiTestFeedback({ type: 'error', message: '请先获取并添加至少一个模型，再进行测试。' })
      return
    }
    const preferred =
      (currentConfig.models || []).find((item) => item.modelType === 'chat' && item.model?.trim())?.model ||
      available[0]
    setTestModelCandidate(preferred)
    setTestModelPickerOpen(true)
  }

  const createConfigFromOfficialTemplate = async (template: AiConfig) => {
    const existing = findConfigByTemplate(template)
    if (existing) {
      setSelectedAiConfig(existing.key)
      return
    }

    const store = await Store.load('store.json')
    const aiModelListInStore = (await store.get<AiConfig[]>('aiModelList')) || []
    const id = v4()

    const newConfig: AiConfig = {
      ...template,
      key: id,
      templateKey: template.templateKey || template.key,
      templateSource: template.templateSource === 'remote' ? 'remote' : 'builtin',
      modelType: 'chat',
      enabled: template.enabled !== false,
    }

    const updatedList = [newConfig, ...aiModelListInStore]
    await store.set('aiModelList', updatedList)
    await store.save()
    setAiModelList(updatedList)
    setSelectedAiConfig(id)
  }

  const renderOfficialTemplateItem = (template: AiConfig) => {
    const linkedConfig = findConfigByTemplate(template)
    const isSelected = Boolean(linkedConfig && selectedAiConfig === linkedConfig.key)
    const isEnabled = linkedConfig ? linkedConfig.enabled !== false : false
    const providerIcon = template.icon || linkedConfig?.icon

    return (
      <button
        key={`template-${template.key}`}
        type="button"
        onClick={() => {
          if (linkedConfig) {
            setSelectedAiConfig(linkedConfig.key)
            return
          }
          void createConfigFromOfficialTemplate(template)
        }}
        className={cn(
          'w-full rounded-lg border p-3 text-left transition-colors',
          isSelected
            ? 'border-primary/70 bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/40'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-background">
              {providerIcon ? (
                <Image src={providerIcon} alt={template.title} width={20} height={20} className="size-5 rounded" />
              ) : (
                <BotMessageSquare className="size-4 text-muted-foreground" />
              )}
            </div>
            <span className="line-clamp-1 text-sm font-medium">{template.title}</span>
          </div>

          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none',
              isEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', isEnabled ? 'bg-emerald-500' : 'bg-slate-400')} />
            {isEnabled ? '已开启' : '已关闭'}
          </span>
        </div>
      </button>
    )
  }

  const renderProviderConfigItem = (item: AiConfig) => {
    const isSelected = selectedAiConfig === item.key
    const modelCount = getConfigModelCount(item)
    const providerIcon = getConfigIcon(item)

    return (
      <button
        key={item.key}
        type="button"
        onClick={() => setSelectedAiConfig(item.key)}
        className={cn(
          'w-full rounded-lg border p-3 text-left transition-colors',
          isSelected
            ? 'border-primary/70 bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/40'
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-background">
            {providerIcon ? (
              <Image src={providerIcon} alt={item.title} width={20} height={20} className="size-5 rounded" />
            ) : (
              <BotMessageSquare className="size-4 text-muted-foreground" />
            )}
          </div>
          <span className="line-clamp-1 text-sm font-medium">{item.title}</span>
        </div>

        <div className="line-clamp-1 text-xs text-muted-foreground">{item.baseURL || '未设置 BaseURL'}</div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{modelCount} 个模型</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5',
              isConfigUsable(item) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            )}
          >
            {isConfigUsable(item) ? '已就绪' : '待完善'}
          </span>
        </div>
      </button>
    )
  }

  const renderGroupedCustomConfigItem = (group: { key: string; baseURL: string; items: AiConfig[] }) => {
    if (group.items.length === 1) {
      return renderProviderConfigItem(group.items[0])
    }

    const hasSelected = group.items.some((item) => item.key === selectedAiConfig)

    return (
      <div
        key={`custom-group-${group.key}`}
        className={cn(
          'rounded-lg border p-2',
          hasSelected ? 'border-primary/60 bg-primary/5' : 'border-border bg-card/60'
        )}
      >
        <div className="mb-2 px-1 text-[11px] text-muted-foreground">{group.baseURL || '未设置 BaseURL'}</div>

        <div className="space-y-1">
          {group.items.map((item) => {
            const isSelected = selectedAiConfig === item.key
            const isEnabled = item.enabled !== false
            const modelCount = getConfigModelCount(item)
            const providerIcon = getConfigIcon(item)

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedAiConfig(item.key)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted/60'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-background">
                    {providerIcon ? (
                      <Image src={providerIcon} alt={item.title} width={20} height={20} className="size-5 rounded" />
                    ) : (
                      <BotMessageSquare className="size-4 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{modelCount} 个模型</div>
                  </div>
                </div>

                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium leading-none',
                    isEnabled
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', isEnabled ? 'bg-emerald-500' : 'bg-slate-400')} />
                  {isEnabled ? '已开启' : '已关闭'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const parseHeadersToKeyValue = (headers: Record<string, string> = {}) => {
    return Object.entries(headers).map(([key, value]) => ({
      key,
      value: String(value),
      id: Math.random().toString(36).slice(2, 11),
    }))
  }

  const convertKeyValueToJson = (pairs: Array<{ key: string; value: string }>) => {
    const obj: Record<string, string> = {}
    pairs.forEach((pair) => {
      if (pair.key.trim()) {
        obj[pair.key.trim()] = pair.value
      }
    })
    return obj
  }

  const addNewModel = async () => {
    if (!currentConfig) return

    const newModelId = v4()
    const newModel: ModelConfig = {
      id: newModelId,
      model: '',
      modelType: 'chat',
      temperature: 0.7,
      topP: 1,
      enableStream: true,
    }

    const updatedConfig: AiConfig = {
      ...currentConfig,
      models: [...(currentConfig.models || []), newModel],
    }

    await updateAiConfig(updatedConfig)
    setCurrentExpandedModels(Array.from(new Set([...(currentExpandedModels || []), newModelId])))
  }

  const deleteModel = async (modelId: string) => {
    if (!currentConfig) return

    const confirmed = await confirm('确定要删除这个模型吗？')
    if (!confirmed) return

    const updatedConfig: AiConfig = {
      ...currentConfig,
      models: (currentConfig.models || []).filter((item) => item.id !== modelId),
    }

    await updateAiConfig(updatedConfig)
    setCurrentExpandedModels((currentExpandedModels || []).filter((id) => id !== modelId))
  }

  const updateModelConfig = async (modelId: string, field: keyof ModelConfig, value: any) => {
    if (!currentConfig) return

    const updatedModels = (currentConfig.models || []).map((item) =>
      item.id === modelId ? { ...item, [field]: value } : item
    )

    const updatedConfig: AiConfig = {
      ...currentConfig,
      models: updatedModels,
    }

    await updateAiConfig(updatedConfig)
  }

  const updateAiConfig = async (config: AiConfig) => {
    const store = await Store.load('store.json')
    const aiModelListInStore = (await store.get<AiConfig[]>('aiModelList')) || []
    const index = aiModelListInStore.findIndex((item) => item.key === config.key)

    if (index >= 0) {
      aiModelListInStore[index] = config
      await store.set('aiModelList', aiModelListInStore)
      setAiModelList(aiModelListInStore)
    }
  }

  const deleteCurrentCustomConfig = async () => {
    if (!currentConfig) return
    if (isOfficialConfig(currentConfig)) return

    const confirmed = await confirm('确定要删除当前自定义配置吗？')
    if (!confirmed) return

    const store = await Store.load('store.json')
    const aiModelListInStore = (await store.get<AiConfig[]>('aiModelList')) || []
    const updatedList = aiModelListInStore.filter((item) => item.key !== currentConfig.key)

    await store.set('aiModelList', updatedList)
    await store.save()
    setAiModelList(updatedList)

    if (updatedList.length === 0) {
      setSelectedAiConfig('')
      return
    }

    const next = updatedList.find((item) => !isOfficialConfig(item)) || updatedList[0]
    setSelectedAiConfig(next.key)
  }

  const migrateOldConfig = (config: AiConfig): AiConfig => {
    if (config.models && config.models.length > 0) {
      return config
    }

    if (config.model) {
      const migratedModel: ModelConfig = {
        id: v4(),
        model: config.model,
        modelType: config.modelType || 'chat',
        temperature: config.temperature,
        topP: config.topP,
        voice: config.voice,
        enableStream: config.enableStream,
      }

      return {
        ...config,
        models: [migratedModel],
      }
    }

    return config
  }

  useEffect(() => {
    if (currentConfig) {
      setHeaderPairs(parseHeadersToKeyValue(currentConfig.customHeaders))
    } else {
      setHeaderPairs([])
    }
  }, [currentConfig])

  useEffect(() => {
    setApiTestFeedback(null)
    setModelFetchFeedback(null)
    setModelPickerOpen(false)
    setTestModelPickerOpen(false)
  }, [currentConfig?.key])

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json')
      const aiModelListFromStore = await store.get<AiConfig[]>('aiModelList')

      const cachedTemplates = await getCachedProviderTemplates()
      if (cachedTemplates.length > 0) {
        setProviderTemplates(cachedTemplates)
      }

      const templates = await loadProviderTemplates(builtinProviderTemplates)
      setProviderTemplates(templates)

      if (aiModelListFromStore) {
        const migratedList = aiModelListFromStore.map(migrateOldConfig)
        const hasChanges = migratedList.some((config, index) => {
          return JSON.stringify(config) !== JSON.stringify(aiModelListFromStore[index])
        })

        if (hasChanges) {
          await store.set('aiModelList', migratedList)
          setAiModelList(migratedList)
        }
      }

      const allModels = aiModelListFromStore || []
      if (selectedAiConfig && allModels.find((item) => item.key === selectedAiConfig)) {
        return
      }

      if (allModels.length > 0) {
        setSelectedAiConfig(allModels[0].key)
      } else {
        setSelectedAiConfig('')
      }
    }

    init()
  }, [])

  return (
    <div id="ai" className="flex flex-col space-y-4">
      {allModelConfigs.length === 0 && (
        <>
          <DefaultModelsSection />
          <CreateConfig
            hasCustomModels={false}
            onConfigCreated={(configId) => {
              setSelectedAiConfig(configId)
            }}
          />
        </>
      )}

      {allModelConfigs.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="rounded-xl border bg-card/70 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{t('modelConfigTitle')}</div>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {allModelConfigs.length}
                </span>
              </div>

              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="搜索服务商或地址"
                  className="pl-9"
                />
              </div>

              <CreateConfig
                hasCustomModels={true}
                className="mb-3"
                onConfigCreated={(configId) => {
                  setSelectedAiConfig(configId)
                }}
              />

              <div className="max-h-[62vh] overflow-y-auto pr-1">
                {!hasAnyProviderResult ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    没有匹配的服务商配置
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="px-1 text-xs font-medium text-muted-foreground">模型供应商</div>
                      {filteredOfficialTemplates.length > 0 ? (
                        filteredOfficialTemplates.map((item) => renderOfficialTemplateItem(item))
                      ) : (
                        <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                          暂无匹配的官方模板
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="px-1 text-xs font-medium text-muted-foreground">自定义</div>
                      {customModelConfigs.length > 0 ? (
                        groupedCustomModelConfigs.map((group) => renderGroupedCustomConfigItem(group))
                      ) : (
                        <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                          暂无匹配的自定义配置
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="rounded-xl border bg-card/70 p-4 md:p-5">
              {currentConfig ? (
                <div className="space-y-5 text-[13px]">
                  <div className="rounded-xl border bg-background/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="line-clamp-1 text-lg font-semibold">
                            {currentConfig.title || t('selectConfig')}
                          </h3>
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-xs',
                              currentConfig.enabled === false
                                ? 'bg-zinc-200 text-zinc-700'
                                : isConfigUsable(currentConfig)
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                            )}
                          >
                            {currentConfig.enabled === false
                              ? '已关闭'
                              : isConfigUsable(currentConfig)
                                ? '已就绪'
                                : '待完善'}
                          </span>
                        </div>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {currentConfig.baseURL || '请先填写 BaseURL'}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        <span className="text-xs text-muted-foreground">启用</span>
                        <Switch
                          checked={currentConfig.enabled !== false}
                          onCheckedChange={setCurrentConfigEnabled}
                        />
                        {!isOfficialConfig(currentConfig) && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-md text-destructive/90 hover:bg-destructive/10 hover:text-destructive"
                            onClick={deleteCurrentCustomConfig}
                            aria-label="删除自定义配置"
                            title="删除自定义配置"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {!currentProviderTemplate && (
                    <FormItem title={t('modelTitle')}>
                      <Input
                        value={currentConfig.title}
                        onChange={(e) => updateAiConfig({ ...currentConfig, title: e.target.value })}
                      />
                    </FormItem>
                  )}

                  {!currentProviderTemplate && (
                    <FormItem title="BaseURL">
                      <Input
                        value={currentConfig.baseURL || ''}
                        onChange={(e) => updateAiConfig({ ...currentConfig, baseURL: e.target.value })}
                        onBlur={(e) => {
                          const normalized = normalizeApiBaseUrl(e.target.value)
                          if (normalized !== (currentConfig.baseURL || '')) {
                            updateAiConfig({ ...currentConfig, baseURL: normalized })
                          }
                        }}
                      />
                    </FormItem>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">API 密钥</p>
                      {currentApiKeyUrl && (
                        <OpenBroswer
                          type="link"
                          url={currentApiKeyUrl}
                          title="获取密钥"
                          className="text-xs text-primary no-underline hover:underline"
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 rounded-md border bg-background p-1">
                      <Input
                        className="h-9 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={currentConfig.apiKey || ''}
                        type={apiKeyVisible ? 'text' : 'password'}
                        onChange={(e) => updateAiConfig({ ...currentConfig, apiKey: e.target.value })}
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setApiKeyVisible(!apiKeyVisible)}
                      >
                        {apiKeyVisible ? <Eye /> : <EyeOff />}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={openTestModelPicker}
                        disabled={testingConnection}
                      >
                        {testingConnection ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                        测试
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">密钥仅保存在当前配置中，可随时修改。</p>
                    {apiTestFeedback && (
                      <div
                        className={cn(
                          'rounded-md border px-3 py-2 text-xs',
                          apiTestFeedback.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                        )}
                      >
                        {apiTestFeedback.message}
                      </div>
                    )}
                  </div>

                  {!currentProviderTemplate && (
                    <FormItem title={t('customHeaders')} desc={t('customHeadersDesc')}>
                      <div className="space-y-2">
                        {headerPairs.map((pair, index) => (
                          <div key={pair.id} className="flex items-center gap-2">
                            <Input
                              placeholder={t('headerKey')}
                              value={pair.key}
                              onChange={(e) => {
                                const newPairs = [...headerPairs]
                                newPairs[index].key = e.target.value
                                setHeaderPairs(newPairs)
                              }}
                              onBlur={() => {
                                const jsonObj = convertKeyValueToJson(headerPairs)
                                updateAiConfig({ ...currentConfig, customHeaders: jsonObj })
                              }}
                              className="flex-1"
                            />
                            <Input
                              placeholder={t('headerValue')}
                              value={pair.value}
                              onChange={(e) => {
                                const newPairs = [...headerPairs]
                                newPairs[index].value = e.target.value
                                setHeaderPairs(newPairs)
                              }}
                              onBlur={() => {
                                const jsonObj = convertKeyValueToJson(headerPairs)
                                updateAiConfig({ ...currentConfig, customHeaders: jsonObj })
                              }}
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                const newPairs = headerPairs.filter((_, i) => i !== index)
                                setHeaderPairs(newPairs)
                                updateAiConfig({ ...currentConfig, customHeaders: convertKeyValueToJson(newPairs) })
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setHeaderPairs([
                              ...headerPairs,
                              { key: '', value: '', id: Math.random().toString(36).slice(2, 11) },
                            ])
                          }
                          className="w-full"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          {t('addHeader')}
                        </Button>
                      </div>
                    </FormItem>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">模型</p>
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                          {currentConfig.models?.length || 0}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-1 text-xs text-primary"
                          onClick={fetchModelList}
                          disabled={fetchingModelList}
                        >
                          {fetchingModelList ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                          {fetchingModelList ? '获取中...' : '获取模型列表'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary"
                          onClick={addNewModel}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border bg-background/50 p-3 md:p-4">
                      {modelFetchFeedback && (
                        <div
                          className={cn(
                            'rounded-md border px-3 py-2 text-xs',
                            modelFetchFeedback.type === 'success'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-red-200 bg-red-50 text-red-700'
                          )}
                        >
                          {modelFetchFeedback.message}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {currentConfig.models && currentConfig.models.length > 0 && (
                          getModelTypeFilterOptions().map((option) => (
                            <Button
                              key={option.value}
                              type="button"
                              size="sm"
                              className="h-8 text-xs"
                              variant={currentModelTypeFilter === option.value ? 'default' : 'outline'}
                              onClick={() => setCurrentModelTypeFilter(option.value as 'all' | ModelType)}
                            >
                              {option.label}
                            </Button>
                          ))
                        )}
                      </div>

                      {filteredCurrentModels.length > 0 ? (
                        <div className="max-h-[46vh] overflow-y-auto pr-1">
                          <Accordion
                            type="multiple"
                            className="space-y-2"
                            value={currentExpandedModels}
                            onValueChange={setCurrentExpandedModels}
                          >
                            {filteredCurrentModels.map((modelConfig) => (
                              <ModelCard
                                key={modelConfig.id}
                                modelConfig={modelConfig}
                                aiConfig={currentConfig}
                                onUpdate={updateModelConfig}
                                onDelete={deleteModel}
                              />
                            ))}
                          </Accordion>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          当前筛选下没有模型
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  请先在左侧选择一个模型服务商
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <Dialog open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-2xl origin-center scale-[0.6] p-0"
        >
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[24px] leading-none md:text-[24px]">模型列表</DialogTitle>
              <DialogClose className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-7 w-7" />
                <span className="sr-only">关闭</span>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <Input
                value={modelPickerQuery}
                onChange={(e) => setModelPickerQuery(e.target.value)}
                placeholder="搜索模型 ID 或名称"
                className="h-12 text-[22px] leading-tight placeholder:text-[20px] md:text-[22px]"
              />
              <span className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-[18px] text-muted-foreground">
                已选 {modelDraftList.length}
              </span>
              {modelDraftList.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 px-3 text-[18px] text-muted-foreground"
                  onClick={() => setModelDraftList([])}
                >
                  清空
                </Button>
              )}
            </div>

            <ScrollArea className="h-[420px] rounded-md border">
              <div className="space-y-1 p-2">
                {filteredPickerCandidates.length > 0 ? (
                  filteredPickerCandidates.map((item) => {
                    const normalized = item.toLowerCase()
                    const selected = draftModelSet.has(normalized)
                    const configured = modelDraftList.find((model) => model.model.trim().toLowerCase() === normalized)
                    const modelType = configured?.modelType || inferModelTypeFromId(item)
                    return (
                      <div
                        key={item}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-md border px-3 py-3 text-[22px] transition-colors',
                          selected ? 'border-emerald-200 bg-emerald-50/70' : 'border-transparent hover:bg-muted/50'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="line-clamp-1 font-medium">{item}</div>
                          <div className="text-[18px] text-muted-foreground">{getModelTypeLabel(modelType)}</div>
                        </div>

                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className={cn(
                            'h-12 w-12 shrink-0 rounded-md',
                            selected
                              ? 'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700'
                              : 'border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700'
                          )}
                          onClick={() => {
                            if (selected) {
                              removeModelFromDraftByName(item)
                            } else {
                              addModelToDraft(item)
                            }
                          }}
                        >
                          {selected ? <Minus className="h-7 w-7" /> : <Plus className="h-7 w-7" />}
                        </Button>
                      </div>
                    )
                  })
                ) : (
                  <div className="p-3 text-[18px] text-muted-foreground">没有匹配的候选模型</div>
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="border-t px-4 py-3">
            <Button variant="outline" className="h-12 px-5 text-[20px]" onClick={() => setModelPickerOpen(false)}>
              取消
            </Button>
            <Button className="h-12 px-5 text-[20px]" onClick={saveModelDraft}>应用变更</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testModelPickerOpen} onOpenChange={setTestModelPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>选择测试模型</DialogTitle>
            <DialogDescription>选择一个模型后再执行连接测试，便于确认具体可用模型。</DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[300px] rounded-md border">
            <div className="space-y-1 p-2">
              {(currentConfig?.models || []).map((item) => {
                const value = item.model?.trim()
                if (!value) return null
                const selected = testModelCandidate.toLowerCase() === value.toLowerCase()
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTestModelCandidate(value)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors',
                      selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
                    )}
                  >
                    <span className="line-clamp-1">{value}</span>
                    <span className="text-xs text-muted-foreground">{getModelTypeLabel(item.modelType)}</span>
                  </button>
                )
              })}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestModelPickerOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => testCurrentConfigConnection(testModelCandidate)}
              disabled={!testModelCandidate || testingConnection}
            >
              {testingConnection ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              开始测试
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
