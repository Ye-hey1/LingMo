import type { AiHotspotItem, AiHotspotSourceStatus } from '@/lib/ai-hotspots'

export function formatHotspotTime(value: string | null) {
  if (!value) return '时间未知'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '时间未知'

  const diffMs = Date.now() - time
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`

  return new Date(time).toLocaleDateString()
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

export function formatHotspotDateTime(value: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return '时间未知'

  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hour = padDatePart(date.getHours())
  const minute = padDatePart(date.getMinutes())
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function getHotspotDisplayTimeValue(item: AiHotspotItem) {
  return item.publishedAt || item.lastSeenAt || item.firstSeenAt
}

export function getHotspotHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function getPrimaryHotspotTag(item: AiHotspotItem) {
  return getDisplayHotspotTags(item, 1)[0] || '未分类'
}

const GENERIC_DISPLAY_TAGS = new Set([
  'ai',
  'a.i.',
  '人工智能',
  'ai热点',
  'ai 热点',
  'ai信号',
  'ai 信号',
  '热点',
  '信号',
  '新闻',
  '资讯',
])

const DISPLAY_TAG_RULES: Array<[RegExp, string]> = [
  [/deepseek/i, 'DEEPSEEK'],
  [/\bdspark\b/i, 'DSPARK'],
  [/\bprompt\b|提示词/i, 'Prompt'],
  [/\bcontext\b|上下文/i, 'Context'],
  [/\bharness\b/i, 'Harness'],
  [/\bloop\b|循环/i, 'Loop'],
  [/\bagent\b|智能体/i, 'Agent'],
  [/android/i, 'Android'],
  [/技改|需求/i, '技改需求'],
  [/openai|chatgpt|\bgpt[-\s]?\d*/i, 'GPT'],
  [/claude|anthropic/i, 'Claude'],
  [/gemini/i, 'Gemini'],
  [/qwen|通义|千问/i, 'Qwen'],
  [/\bmcp\b|model context protocol/i, 'MCP'],
  [/\brag\b|检索增强/i, 'RAG'],
  [/大模型|\bllm\b|\bmodel\b|模型/i, '模型'],
  [/开源|open[-\s]?source/i, '开源'],
  [/产品|应用|落地/i, '产品应用'],
  [/编程|代码|开发|工程|coding|developer/i, '开发'],
  [/算力|芯片|\bgpu\b|nvidia/i, '算力'],
  [/融资|估值|投资|capital/i, '融资'],
  [/安全|隐私|合规|security/i, '安全'],
  [/机器人|robot/i, '机器人'],
  [/多模态|图像|视频|image|video|multimodal/i, '多模态'],
  [/语音|音频|voice|audio/i, '语音'],
  [/评测|榜单|benchmark/i, '评测'],
  [/浏览器|browser/i, '浏览器'],
]

function normalizeDisplayTag(value: unknown) {
  return String(value || '')
    .replace(/^#+/, '')
    .trim()
}

function isGenericDisplayTag(tag: string, item: AiHotspotItem) {
  const normalized = tag.trim().toLowerCase()
  if (!normalized || GENERIC_DISPLAY_TAGS.has(normalized)) return true

  const sourceName = item.sourceName.trim().toLowerCase()
  const feedName = item.feedName.trim().toLowerCase()
  return normalized === sourceName || normalized === feedName
}

function collectMetaTags(item: AiHotspotItem) {
  const raw = item.meta?.categories ?? item.meta?.category ?? item.meta?.keywords ?? item.meta?.keyword
  if (Array.isArray(raw)) return raw.map(normalizeDisplayTag).filter(Boolean)
  if (typeof raw === 'string') {
    return raw
      .split(/[,，、/|#\s]+/)
      .map(normalizeDisplayTag)
      .filter(Boolean)
  }
  return []
}

function addUniqueTag(tags: string[], tag: string, item: AiHotspotItem) {
  const normalized = normalizeDisplayTag(tag)
  if (!normalized || isGenericDisplayTag(normalized, item)) return
  if (tags.some(existing => existing.toLowerCase() === normalized.toLowerCase())) return
  tags.push(normalized)
}

function deriveDisplayTags(item: AiHotspotItem) {
  const text = [
    item.title,
    item.titleOriginal || '',
    item.titleEn || '',
    item.titleZh || '',
    item.summary || '',
    item.signalSummary || '',
    item.signalEssence || '',
    item.feedName,
  ].join(' ')

  const tags: string[] = []
  for (const [pattern, tag] of DISPLAY_TAG_RULES) {
    if (pattern.test(text)) addUniqueTag(tags, tag, item)
  }
  return tags
}

export function getDisplayHotspotTags(item: AiHotspotItem, limit = 3) {
  const tags: string[] = []

  for (const tag of collectMetaTags(item)) addUniqueTag(tags, tag, item)
  for (const tag of item.tags) addUniqueTag(tags, tag, item)
  for (const tag of deriveDisplayTags(item)) addUniqueTag(tags, tag, item)

  return tags.slice(0, limit)
}

export function buildSourceOptions(items: AiHotspotItem[], sources: AiHotspotSourceStatus[]) {
  const options = new Map<string, string>()

  for (const source of sources) {
    options.set(source.sourceId, source.sourceName)
  }
  for (const item of items) {
    if (!options.has(item.sourceId)) {
      options.set(item.sourceId, item.sourceName)
    }
  }

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function getSourceHealthText(sources: AiHotspotSourceStatus[]) {
  if (sources.length === 0) return '暂无来源状态'
  const ok = sources.filter(source => source.ok).length
  return `${ok}/${sources.length} 来源可用`
}
