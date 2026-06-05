import type { AiConfig } from '@/app/core/setting/config'

const PLACEHOLDER_PROVIDER_TITLES = new Set([
  'custom',
  'custom model configuration',
  '自定义',
  '自定义模型配置',
  '自訂模型配置',
  '自定義',
  'カスタム',
  'personalizado',
  'personalizada',
])

const STALE_PROVIDER_TITLES = new Set([
  'openai whisper',
  'zhipu glm-asr',
])

const STALE_PROVIDER_TITLE_PATTERNS = [
  /^openless\s+asr(?:\s*[-:]\s*.*)?$/i,
]

function normalizeTitleWhitespace(title?: string | null) {
  const rawTitle = (title || '').trim()
  if (!rawTitle) return ''

  return rawTitle.replace(/\s+/g, ' ')
}

function isSuppressedProviderTitle(title: string) {
  const lowerTitle = title.toLowerCase()
  if (PLACEHOLDER_PROVIDER_TITLES.has(lowerTitle) || STALE_PROVIDER_TITLES.has(lowerTitle)) {
    return true
  }

  return STALE_PROVIDER_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

function isStaleProviderTitle(title: string) {
  const lowerTitle = title.toLowerCase()
  return STALE_PROVIDER_TITLES.has(lowerTitle) || STALE_PROVIDER_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

export function normalizeProviderDisplayTitle(title?: string | null) {
  const normalizedTitle = normalizeTitleWhitespace(title)
  if (!normalizedTitle) return ''

  if (PLACEHOLDER_PROVIDER_TITLES.has(normalizedTitle.toLowerCase())) {
    return ''
  }

  if (isSuppressedProviderTitle(normalizedTitle)) {
    return ''
  }

  return normalizedTitle
}

export function getConfiguredProviderDisplayTitle(
  config?: AiConfig | null,
  providerTemplate?: AiConfig | null
) {
  return normalizeProviderDisplayTitle(providerTemplate?.title) || normalizeProviderDisplayTitle(config?.title)
}

export function normalizeProviderConfigTitle(config: AiConfig): AiConfig {
  const title = normalizeTitleWhitespace(config.title)
  const normalizedTitle = isStaleProviderTitle(title) ? '' : title
  if (normalizedTitle === config.title) return config

  return {
    ...config,
    title: normalizedTitle,
  }
}
