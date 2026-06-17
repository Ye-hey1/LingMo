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

const KNOWN_PROVIDER_RULES: Array<{
  title: string
  patterns: RegExp[]
}> = [
  {
    title: 'Groq',
    patterns: [/\bgroq\b/i, /api\.groq\.com/i],
  },
  {
    title: 'SiliconFlow',
    patterns: [/\bsiliconflow\b/i, /siliconflow\.cn/i],
  },
  {
    title: '智谱 AI',
    patterns: [/\bzhipu\b/i, /\bglm\b/i, /bigmodel\.cn/i],
  },
  {
    title: 'OpenAI',
    patterns: [/\bopenai\b/i, /api\.openai\.com/i],
  },
  {
    title: 'Gemini',
    patterns: [/\bgemini\b/i, /generativelanguage\.googleapis\.com/i],
  },
  {
    title: 'Ollama',
    patterns: [/\bollama\b/i, /localhost:11434/i],
  },
  {
    title: 'LM Studio',
    patterns: [/\blmstudio\b/i, /\blm studio\b/i, /localhost:1234/i],
  },
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

export function inferProviderDisplayTitle(config?: AiConfig | null) {
  if (!config) return ''

  const source = [
    config.templateKey,
    config.key,
    config.baseURL,
  ].filter(Boolean).join(' ')

  for (const rule of KNOWN_PROVIDER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(source))) {
      return rule.title
    }
  }

  return ''
}

export function getConfiguredProviderDisplayTitle(
  config?: AiConfig | null,
  providerTemplate?: AiConfig | null
) {
  const inferred = inferProviderDisplayTitle(config)
  const configured = normalizeProviderDisplayTitle(config?.title)
  const template = normalizeProviderDisplayTitle(providerTemplate?.title)

  if (inferred && (!configured || configured === 'OpenAI' || isStaleProviderTitle(configured))) {
    return inferred
  }

  return configured || inferred || template
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
