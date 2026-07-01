import type { AiConfig } from '@/app/core/setting/config'

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'auto'

export type ThinkingRequestMode =
  | 'disabled'
  | 'reasoning_effort'
  | 'thinking_budget'
  | 'provider_default'

export interface ModelCapabilityProfile {
  supportsFunctionCalling: boolean
  supportsToolChoice: boolean
  prefersTextReAct: boolean
  supportsReasoningContent: boolean
  supportsThinkingLevel: boolean
  thinkingRequestMode: ThinkingRequestMode
  defaultThinkingLevel: ThinkingLevel
  supportedThinkingLevels: ThinkingLevel[]
  reason?: string
}

function getModelCapabilitySource(config?: AiConfig) {
  return [
    config?.templateKey,
    config?.key,
    config?.title,
    config?.baseURL,
    config?.model,
  ].filter(Boolean).join(' ').toLowerCase()
}

export function getModelCapabilityProfile(config?: AiConfig): ModelCapabilityProfile {
  const source = getModelCapabilitySource(config)
  const model = (config?.model || '').toLowerCase()
  const baseUrl = (config?.baseURL || '').toLowerCase()

  const common = resolveThinkingCapability(source, model, baseUrl)

  if (model.includes('deepseek-reasoner')) {
    return {
      supportsFunctionCalling: false,
      supportsToolChoice: false,
      prefersTextReAct: true,
      ...common,
      supportsReasoningContent: true,
      supportsThinkingLevel: true,
      thinkingRequestMode: 'provider_default',
      defaultThinkingLevel: 'auto',
      reason: 'deepseek-reasoner does not support tool_choice/function calling reliably; use text ReAct orchestration.',
    }
  }

  if (
    model.includes('text-davinci') ||
    model.includes('gpt-3.5-turbo-instruct') ||
    (baseUrl.includes('ollama') && (model.includes('phi-2') || model.includes('tinyllama')))
  ) {
    return {
      supportsFunctionCalling: false,
      supportsToolChoice: false,
      prefersTextReAct: true,
      ...common,
      supportsReasoningContent: false,
      supportsThinkingLevel: false,
      thinkingRequestMode: 'disabled',
      defaultThinkingLevel: 'none',
      supportedThinkingLevels: ['none'],
      reason: 'model is treated as text-only for agent orchestration.',
    }
  }

  if (source.includes('deepseek')) {
    return {
      supportsFunctionCalling: true,
      supportsToolChoice: false,
      prefersTextReAct: false,
      ...common,
      supportsReasoningContent: true,
      reason: 'DeepSeek-compatible APIs may reject tool_choice; omit it and let tools be auto-selected.',
    }
  }

  return {
    supportsFunctionCalling: true,
    supportsToolChoice: true,
    prefersTextReAct: false,
    ...common,
  }
}

function resolveThinkingCapability(_source: string, model: string, baseUrl: string): Pick<
  ModelCapabilityProfile,
  'supportsReasoningContent' | 'supportsThinkingLevel' | 'thinkingRequestMode' | 'defaultThinkingLevel' | 'supportedThinkingLevels'
> {
  const supportsOpenAiReasoning = /\b(o[134]|gpt-5)\b/i.test(model)
    || model.includes('reasoning')
  if (baseUrl.includes('generativelanguage.googleapis.com') || model.includes('gemini')) {
    return {
      supportsReasoningContent: true,
      supportsThinkingLevel: true,
      thinkingRequestMode: 'thinking_budget',
      defaultThinkingLevel: 'auto',
      supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'auto'],
    }
  }

  if (model.includes('deepseek') || model.includes('qwen') || model.includes('qwq')) {
    return {
      supportsReasoningContent: true,
      supportsThinkingLevel: true,
      thinkingRequestMode: 'provider_default',
      defaultThinkingLevel: 'auto',
      supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'auto'],
    }
  }

  if (supportsOpenAiReasoning) {
    return {
      supportsReasoningContent: true,
      supportsThinkingLevel: true,
      thinkingRequestMode: 'reasoning_effort',
      defaultThinkingLevel: 'medium',
      supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'auto'],
    }
  }

  return {
    supportsReasoningContent: false,
    supportsThinkingLevel: false,
    thinkingRequestMode: 'disabled',
    defaultThinkingLevel: 'none',
    supportedThinkingLevels: ['none'],
  }
}

export function normalizeThinkingLevel(level: unknown, profile: ModelCapabilityProfile): ThinkingLevel {
  const requested = typeof level === 'string' ? level.toLowerCase() as ThinkingLevel : profile.defaultThinkingLevel
  if (profile.supportedThinkingLevels.includes(requested)) return requested
  if (requested === 'auto' && profile.supportsThinkingLevel) return profile.defaultThinkingLevel
  return profile.defaultThinkingLevel
}

export function getThinkingLevelRequestPatch(
  profile: ModelCapabilityProfile,
  level?: ThinkingLevel,
): Record<string, any> {
  const normalized = normalizeThinkingLevel(level, profile)
  if (!profile.supportsThinkingLevel || normalized === 'none') return {}

  if (profile.thinkingRequestMode === 'reasoning_effort') {
    const effort = normalized === 'auto' ? profile.defaultThinkingLevel : normalized
    if (effort === 'none' || effort === 'auto') return {}
    return { reasoning_effort: effort }
  }

  if (profile.thinkingRequestMode === 'thinking_budget') {
    const budgetByLevel: Record<Exclude<ThinkingLevel, 'none'>, number | undefined> = {
      low: 1024,
      medium: 4096,
      high: 8192,
      auto: undefined,
    }
    const budget = budgetByLevel[normalized as Exclude<ThinkingLevel, 'none'>]
    return budget ? { thinking: { budget_tokens: budget } } : {}
  }

  return {}
}

export function getConfiguredThinkingLevel(config?: AiConfig): ThinkingLevel | undefined {
  const model = config?.model
  const activeModel = model
    ? config?.models?.find(item => item.model === model || item.id === model)
    : undefined
  const raw = (activeModel as any)?.thinkingLevel ?? (config as any)?.thinkingLevel
  if (raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'auto') {
    return raw
  }
  return undefined
}

export function resolveThinkingSettings(config?: AiConfig, requestedLevel?: unknown): {
  profile: ModelCapabilityProfile
  level: ThinkingLevel
  requestPatch: Record<string, any>
} {
  const profile = getModelCapabilityProfile(config)
  const level = normalizeThinkingLevel(requestedLevel ?? getConfiguredThinkingLevel(config), profile)
  return {
    profile,
    level,
    requestPatch: getThinkingLevelRequestPatch(profile, level),
  }
}
