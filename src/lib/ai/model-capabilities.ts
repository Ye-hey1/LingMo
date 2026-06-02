import type { AiConfig } from '@/app/core/setting/config'

export interface ModelCapabilityProfile {
  supportsFunctionCalling: boolean
  supportsToolChoice: boolean
  prefersTextReAct: boolean
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

  if (model.includes('deepseek-reasoner')) {
    return {
      supportsFunctionCalling: false,
      supportsToolChoice: false,
      prefersTextReAct: true,
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
      reason: 'model is treated as text-only for agent orchestration.',
    }
  }

  if (source.includes('deepseek')) {
    return {
      supportsFunctionCalling: true,
      supportsToolChoice: false,
      prefersTextReAct: false,
      reason: 'DeepSeek-compatible APIs may reject tool_choice; omit it and let tools be auto-selected.',
    }
  }

  return {
    supportsFunctionCalling: true,
    supportsToolChoice: true,
    prefersTextReAct: false,
  }
}
