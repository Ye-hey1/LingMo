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
import { AiConfig, ModelConfig, ModelType, builtinProviderTemplates, cleanupConfiguredModels, inferModelTypeFromId, mergeProviderTemplateModels } from "../config"
import useSettingStore from "@/stores/setting"

import { BotMessageSquare, Eye, EyeOff, LoaderCircle, Minus, Plus, Search, Trash2, X } from "lucide-react"
import { OpenBroswer } from "@/components/open-broswer"
import ModelCard from "./model-card"
import CreateConfig from "./create"
import { getCachedProviderTemplates, getProviderTemplateMatch, loadProviderTemplates } from "@/lib/ai/provider-templates-runtime"
import { getConfiguredProviderDisplayTitle, normalizeProviderConfigTitle } from "@/lib/ai/provider-display"
import { cn } from "@/lib/utils"
import { createOpenAIClient } from "@/lib/ai/utils"
import { inferModelContextWindow } from "@/lib/ai/context-window"

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

  const getBuiltinProviderFallback = (config: AiConfig | undefined) => {
    if (!config) {
      return undefined
    }

    return builtinProviderTemplates.find((template) => {
      if (config.templateKey && config.templateKey === template.key) {
        return true
      }
      if (config.key === template.key) {
        return true
      }
      return normalizeBaseUrl(config.baseURL) === normalizeBaseUrl(template.baseURL)
    })
  }

  const getConfigIcon = (config: AiConfig) => {
    return getProviderTemplateMatch(config, providerTemplates)?.icon || config.icon || getBuiltinProviderFallback(config)?.icon
  }

  const getConfigModelCount = (config: AiConfig) => {
    return config.models?.length || 0
  }

  const getProviderDisplayTitle = (config: AiConfig | undefined) => {
    const providerTemplate = getProviderTemplateMatch(config, providerTemplates)
    const builtinProviderTemplate = getBuiltinProviderFallback(config)
    return getConfiguredProviderDisplayTitle(config, providerTemplate) || getConfiguredProviderDisplayTitle(config, builtinProviderTemplate)
  }

  const getConfigListTitle = (config: AiConfig | undefined) => {
    return getProviderDisplayTitle(config) || config?.baseURL?.trim() || '未命名配置'
  }

  const getCurrentProviderDisplayTitle = () => {
    if (!currentConfig) {
      return t('selectConfig')
    }

    return getConfigListTitle(currentConfig) || t('selectConfig')
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
      const modelType = inferModelTypeFromId(value)
      return [
        ...prev,
        {
          id: v4(),
          model: value,
          modelType,
          temperature: 0.7,
          topP: 1,
          contextWindow: modelType === 'chat' ? inferModelContextWindow(value) : undefined,
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
      const modelType = targetModelConfig?.modelType || inferModelTypeFromId(pickedModel)

      let lastError = ''
      for (const candidate of candidates) {
        try {
          const openai = await createOpenAIClient({
            ...currentConfig,
            baseURL: candidate,
            model: pickedModel,
            modelType,
            temperature: targetModelConfig?.temperature,
            topP: targetModelConfig?.topP,
            enableStream: false,
          })

          // 根据模型类型选择对应的测试端点
          if (modelType === 'stt' || modelType === 'embedding' || modelType === 'rerank' || modelType === 'tts') {
            // 非对话模型：通过 models.list() 验证连通性和 API Key 有效性
            const modelList = await openai.models.list()
            const found = modelList.data?.some((m: any) => m.id === pickedModel)
            if (!found) {
              throw new Error(`API 连通但未找到模型 ${pickedModel}，请确认模型名称是否正确。`)
            }
          } else {
            // Chat / 图像 / 视频模型：用 chat completions 测试
            await openai.chat.completions.create({
              model: pickedModel,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 8,
            })
          }

          await updateAiConfig({
            ...currentConfig,
            baseURL: candidate,
          })

          const testLabel = modelType === 'stt' || modelType === 'embedding' || modelType === 'rerank' || modelType === 'tts'
            ? '连接' : '模型'
          const message = `${testLabel} ${pickedModel} 测试通过。`
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

    const templateConfig: AiConfig = {
      ...template,
      key: id,
      templateKey: template.templateKey || template.key,
      templateSource: template.templateSource === 'remote' ? 'remote' : 'builtin',
      modelType: template.modelType,
      enabled: template.enabled !== false,
    }
    const newConfig = cleanupConfiguredModels(mergeProviderTemplateModels(templateConfig).config).config

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
    const providerIcon = getConfigIcon(template) || (linkedConfig ? getConfigIcon(linkedConfig) : undefined)
    const providerTitle = getConfigListTitle(template)
    const modelCount = linkedConfig ? getConfigModelCount(linkedConfig) : 0

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
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
          isSelected
            ? 'bg-primary/8 ring-1 ring-primary/25'
            : 'hover:bg-muted/50'
        )}
      >
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          isSelected ? 'bg-primary/10' : 'bg-muted/60'
        )}>
          {providerIcon ? (
            <Image src={providerIcon} alt={providerTitle} width={18} height={18} className="size-[18px] rounded" />
          ) : (
            <BotMessageSquare className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className={cn('line-clamp-1 text-[13px] font-medium', !isSelected && 'text-foreground/90')}>{providerTitle}</span>
          {linkedConfig && modelCount > 0 && (
            <span className="text-[11px] text-muted-foreground/70">{modelCount} 个模型</span>
          )}
        </div>
        {linkedConfig && (
          <span className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isEnabled ? 'bg-emerald-500' : 'bg-slate-300'
          )} />
        )}
      </button>
    )
  }

  const renderProviderConfigItem = (item: AiConfig) => {
    const isSelected = selectedAiConfig === item.key
    const modelCount = getConfigModelCount(item)
    const providerIcon = getConfigIcon(item)
    const providerTitle = getConfigListTitle(item)

    return (
      <button
        key={item.key}
        type="button"
        onClick={() => setSelectedAiConfig(item.key)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
          isSelected
            ? 'bg-primary/8 ring-1 ring-primary/25'
            : 'hover:bg-muted/50'
        )}
      >
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          isSelected ? 'bg-primary/10' : 'bg-muted/60'
        )}>
          {providerIcon ? (
            <Image src={providerIcon} alt={providerTitle} width={18} height={18} className="size-[18px] rounded" />
          ) : (
            <BotMessageSquare className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className={cn('line-clamp-1 text-[13px] font-medium', !isSelected && 'text-foreground/90')}>{providerTitle}</span>
          {modelCount > 0 ? (
            <span className="text-[11px] text-muted-foreground/70">{modelCount} 个模型</span>
          ) : (
            <span className="text-[11px] text-amber-600/70">待配置</span>
          )}
        </div>
        <span className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          isConfigUsable(item) ? 'bg-emerald-500' : 'bg-amber-400'
        )} />
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
          'rounded-lg',
          hasSelected && 'ring-1 ring-primary/20'
        )}
      >
        <div className="space-y-0.5">
          {group.items.map((item) => {
            const isSelected = selectedAiConfig === item.key
            const isEnabled = item.enabled !== false
            const modelCount = getConfigModelCount(item)
            const providerIcon = getConfigIcon(item)
            const providerTitle = getConfigListTitle(item)

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedAiConfig(item.key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
                  isSelected
                    ? 'bg-primary/8 ring-1 ring-primary/25'
                    : 'hover:bg-muted/50'
                )}
              >
                <div className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                  isSelected ? 'bg-primary/10' : 'bg-muted/60'
                )}>
                  {providerIcon ? (
                    <Image src={providerIcon} alt={providerTitle} width={18} height={18} className="size-[18px] rounded" />
                  ) : (
                    <BotMessageSquare className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={cn('line-clamp-1 text-[13px] font-medium', !isSelected && 'text-foreground/90')}>{providerTitle}</span>
                  {modelCount > 0 ? (
                    <span className="text-[11px] text-muted-foreground/70">{modelCount} 个模型</span>
                  ) : (
                    <span className="text-[11px] text-amber-600/70">待配置</span>
                  )}
                </div>
                <span className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  isEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                )} />
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

    const updatedModels = (currentConfig.models || []).map((item) => {
      if (item.id !== modelId) return item

      const updatedModel = { ...item, [field]: value }
      if (field === 'model') {
        const inferredType = inferModelTypeFromId(String(value || ''))
        if (inferredType !== 'chat' && item.modelType === 'chat') {
          return {
            ...updatedModel,
            modelType: inferredType,
            contextWindow: undefined,
          }
        }
      }

      return updatedModel
    })

    const updatedConfig: AiConfig = {
      ...currentConfig,
      models: updatedModels,
    }

    await updateAiConfig(updatedConfig)
  }

  const updateAiConfig = async (config: AiConfig) => {
    const normalizedConfig = normalizeProviderConfigTitle(config)
    const store = await Store.load('store.json')
    const aiModelListInStore = (await store.get<AiConfig[]>('aiModelList')) || []
    const index = aiModelListInStore.findIndex((item) => item.key === normalizedConfig.key)

    if (index >= 0) {
      aiModelListInStore[index] = normalizedConfig
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
    const templateMerged = mergeProviderTemplateModels(config)
    config = cleanupConfiguredModels(templateMerged.config).config

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

      const migratedList = (aiModelListFromStore || []).map(migrateOldConfig)
      if (aiModelListFromStore) {
        const hasChanges = migratedList.some((config, index) => {
          return JSON.stringify(config) !== JSON.stringify(aiModelListFromStore[index])
        })

        if (hasChanges) {
          await store.set('aiModelList', migratedList)
          await store.save()
          setAiModelList(migratedList)
        }
      }

      const allModels = migratedList
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
                <div className="text-sm font-medium">{t('modelConfigTitle')}</div>
                <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {allModelConfigs.length}
                </span>
              </div>

              <div className="relative mb-2.5">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="搜索"
                  className="h-8 pl-8 text-xs"
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
                  <div className="py-8 text-center text-xs text-muted-foreground/50">
                    无匹配结果
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-0.5">
                      <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground/50">供应商</div>
                      {filteredOfficialTemplates.length > 0 ? (
                        filteredOfficialTemplates.map((item) => renderOfficialTemplateItem(item))
                      ) : (
                        <div className="py-4 text-center text-xs text-muted-foreground/50">
                          无匹配
                        </div>
                      )}
                    </div>

                    <div className="space-y-0.5">
                      <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground/50">自定义</div>
                      {customModelConfigs.length > 0 ? (
                        groupedCustomModelConfigs.map((group) => renderGroupedCustomConfigItem(group))
                      ) : (
                        <div className="py-4 text-center text-xs text-muted-foreground/50">
                          无匹配
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="line-clamp-1 text-base font-semibold">
                            {getCurrentProviderDisplayTitle()}
                          </h3>
                          <span className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
                            currentConfig.enabled === false
                              ? 'bg-zinc-100 text-zinc-500'
                              : isConfigUsable(currentConfig)
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-amber-50 text-amber-600'
                          )}>
                            <span className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              currentConfig.enabled === false
                                ? 'bg-zinc-400'
                                : isConfigUsable(currentConfig)
                                  ? 'bg-emerald-500'
                                  : 'bg-amber-400'
                            )} />
                            {currentConfig.enabled === false
                              ? '已关闭'
                              : isConfigUsable(currentConfig)
                                ? '已就绪'
                                : '待完善'}
                          </span>
                        </div>
                        {currentConfig.baseURL && (
                          <p className="mt-1 truncate text-xs text-muted-foreground/60">
                            {currentConfig.baseURL}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <Switch
                          checked={currentConfig.enabled !== false}
                          onCheckedChange={setCurrentConfigEnabled}
                        />
                        {!isOfficialConfig(currentConfig) && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-md text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                            onClick={deleteCurrentCustomConfig}
                            aria-label="删除配置"
                            title="删除配置"
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

                  <FormItem title="BaseURL" desc={currentProviderTemplate ? '修改后将覆盖默认地址，留空可恢复默认。' : undefined}>
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

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">API 密钥</p>
                      {currentApiKeyUrl && (
                        <OpenBroswer
                          type="link"
                          url={currentApiKeyUrl}
                          title="获取密钥 →"
                          className="text-xs text-primary/70 no-underline hover:text-primary hover:underline"
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Input
                          value={currentConfig.apiKey || ''}
                          type={apiKeyVisible ? 'text' : 'password'}
                          onChange={(e) => updateAiConfig({ ...currentConfig, apiKey: e.target.value })}
                          placeholder="sk-..."
                          className="h-9 pr-20"
                        />
                        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setApiKeyVisible(!apiKeyVisible)}
                            title={apiKeyVisible ? '隐藏密钥' : '显示密钥'}
                          >
                            {apiKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-primary/80 hover:text-primary"
                            onClick={openTestModelPicker}
                            disabled={testingConnection}
                          >
                            {testingConnection ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : null}
                            测试
                          </Button>
                        </div>
                      </div>
                    </div>

                    {apiTestFeedback && (
                      <div
                        className={cn(
                          'rounded-md border px-3 py-2 text-xs',
                          apiTestFeedback.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-destructive/30 bg-destructive/5 text-destructive'
                        )}
                      >
                        {apiTestFeedback.message}
                      </div>
                    )}
                  </div>

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

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">模型</p>
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                          {currentConfig.models?.length || 0}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-primary/80 hover:text-primary"
                          onClick={fetchModelList}
                          disabled={fetchingModelList}
                        >
                          {fetchingModelList ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                          {fetchingModelList ? '获取中...' : '拉取模型'}
                        </Button>
                        <span className="h-4 w-px bg-border" />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary/80 hover:text-primary"
                          onClick={addNewModel}
                          title="手动添加模型"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {currentConfig.models && currentConfig.models.length > 0 && getModelTypeFilterOptions().length > 2 && (
                      <div className="flex flex-wrap gap-1">
                        {getModelTypeFilterOptions().map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                              currentModelTypeFilter === option.value
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                            )}
                            onClick={() => setCurrentModelTypeFilter(option.value as 'all' | ModelType)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="rounded-xl border bg-background/50 p-3">
                      {modelFetchFeedback && (
                        <div
                          className={cn(
                            'rounded-md border px-3 py-2 text-xs',
                            modelFetchFeedback.type === 'success'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-destructive/30 bg-destructive/5 text-destructive'
                          )}
                        >
                          {modelFetchFeedback.message}
                        </div>
                      )}

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
                        <div className="py-6 text-center text-xs text-muted-foreground/40">
                          暂无模型
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground/40">
                  ← 选择一个服务商
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <Dialog open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xl p-0"
        >
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <DialogTitle>选择模型</DialogTitle>
              <DialogClose className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <Input
                value={modelPickerQuery}
                onChange={(e) => setModelPickerQuery(e.target.value)}
                placeholder="搜索模型 ID"
                className="h-9"
              />
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                已选 {modelDraftList.length}
              </span>
              {modelDraftList.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 px-2 text-xs text-muted-foreground"
                  onClick={() => setModelDraftList([])}
                >
                  清空
                </Button>
              )}
            </div>

            <ScrollArea className="h-[380px] rounded-md border">
              <div className="space-y-0.5 p-1.5">
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
                          'flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                          selected ? 'bg-emerald-50/70' : 'hover:bg-muted/50'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="line-clamp-1 font-medium">{item}</div>
                          <div className="text-xs text-muted-foreground">{getModelTypeLabel(modelType)}</div>
                        </div>

                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className={cn(
                            'h-7 w-7 shrink-0 rounded-md',
                            selected
                              ? 'border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive'
                              : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                          )}
                          onClick={() => {
                            if (selected) {
                              removeModelFromDraftByName(item)
                            } else {
                              addModelToDraft(item)
                            }
                          }}
                        >
                          {selected ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    )
                  })
                ) : (
                  <div className="p-3 text-sm text-muted-foreground">没有匹配的候选模型</div>
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="border-t px-4 py-3">
            <Button variant="outline" onClick={() => setModelPickerOpen(false)}>取消</Button>
            <Button onClick={saveModelDraft}>应用变更</Button>
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
