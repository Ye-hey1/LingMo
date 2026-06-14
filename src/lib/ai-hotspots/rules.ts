import { AI_HOTSPOT_CONFIG } from './config'
import { normalizeHotspotTitle, normalizeHotspotUrl } from './normalize'
import type { AiHotspotItem, AiHotspotTimeRange } from './types'

type AiHotspotRelatedRecord = {
  siteId?: string | null
  title?: string | null
  source?: string | null
  siteName?: string | null
  url?: string | null
}

const TAG_RULES: Array<{ tag: string, keywords: string[] }> = [
  { tag: 'AI模型', keywords: [
    'model', 'gpt', 'llm', 'claude', 'gemini', 'deepseek', 'mistral', 'llama', 'qwen',
    '模型', '大模型', '发布', '开源模型', '训练', '推理', '微调', 'fine-tune', 'rlhf',
    'transformer', 'attention', '多模态', 'multimodal', 'vision', '语言模型', 'foundation model',
    'diffusion', 'stable diffusion', 'midjourney', 'dall-e', 'sora',
  ] },
  { tag: '产品应用', keywords: [
    'product', 'app', 'platform', 'tool', 'agent', 'chatbot', 'copilot',
    '产品', '应用', '平台', '工具', '智能体', '助手', '插件', 'plugin',
    'sdk', 'api', 'developer', '开发', '开源', 'github', 'release', 'launch',
    'chatgpt', 'claude code', 'cursor', 'windsurf', 'v0', 'bolt',
  ] },
  { tag: '行业动态', keywords: [
    'industry', 'startup', 'company', 'enterprise', 'business', 'funding', 'acquisition',
    '行业', '企业', '公司', '融资', '收购', '商业化', 'market', '市场',
    'nvidia', 'amd', 'intel', 'google', 'microsoft', 'openai', 'anthropic', 'meta', 'apple',
    '算力', 'gpu', 'chip', '芯片', '数据中心', 'cloud', 'aws', 'azure',
    '政策', 'regulation', '监管', '安全', 'safety',
  ] },
  { tag: '论文研究', keywords: [
    'paper', 'research', 'arxiv', 'benchmark', 'eval', 'study', 'academic',
    '论文', '研究', '评测', '基准', '实验', '突破', '创新', '算法',
    'neurips', 'icml', 'iclr', 'cvpr', 'acl', 'emnlp', 'aaai',
    'technique', 'method', 'approach', 'framework', 'architecture',
  ] },
  { tag: '技巧经验', keywords: [
    'tutorial', 'guide', 'tip', 'trick', 'howto', 'how-to', 'best practice', 'workflow',
    '教程', '技巧', '经验', '实践', '指南', '入门', '进阶', '实战',
    'prompt', '提示词', '工程', 'engineering', '效率', 'productivity',
    'case study', '案例', '分享', '总结', '复盘',
  ] },
]

export function isAiHotspotRelated(record: AiHotspotRelatedRecord): boolean {
  const siteId = (record.siteId ?? '').trim().toLowerCase()
  const url = (record.url ?? '').toLowerCase()
  const filter = AI_HOTSPOT_CONFIG.filter

  // 直接过滤掉 GitHub 相关内容（专注于 AI 热点新闻）
  if (url.includes('github.com') || url.includes('github.io') || url.includes('githubusercontent.com')) {
    return false
  }

  if (filter.trustedAiSourceIds.includes(siteId)) return true

  const text = [
    record.title,
    record.source,
    record.siteName,
    record.url,
  ].filter(Boolean).join(' ').toLowerCase()

  if (!text) return false

  const hasAiSignal = includesAny(text, filter.aiKeywords) || filter.enSignalPattern.test(text)
  const hasTechSignal = includesAny(text, filter.techKeywords)
  const hasNoise = includesAny(text, filter.noiseKeywords)
  const hasCommerceNoise = includesAny(text, filter.commerceNoiseKeywords)

  if (!hasAiSignal && !hasTechSignal) return false
  if ((hasNoise || hasCommerceNoise) && !hasAiSignal) return false
  if (hasNoise && !hasAiSignal && !hasTechSignal) return false

  return true
}

export function dedupeHotspotItems(items: AiHotspotItem[]): AiHotspotItem[] {
  const groups: Array<{
    urls: Set<string>
    titles: Set<string>
    items: AiHotspotItem[]
  }> = []

  for (const item of items) {
    const keys = createDedupeKeys(item)
    const matchingGroups = groups.filter(group => {
      return keys.urls.some(url => group.urls.has(url)) || keys.titles.some(title => group.titles.has(title))
    })

    if (!keys.urls.length && !keys.titles.length) {
      groups.push({ urls: new Set(), titles: new Set(), items: [item] })
      continue
    }

    const group = matchingGroups[0] ?? { urls: new Set<string>(), titles: new Set<string>(), items: [] }

    for (const url of keys.urls) group.urls.add(url)
    for (const title of keys.titles) group.titles.add(title)
    group.items.push(item)

    if (!matchingGroups.length) {
      groups.push(group)
      continue
    }

    for (const duplicateGroup of matchingGroups.slice(1)) {
      for (const url of duplicateGroup.urls) group.urls.add(url)
      for (const title of duplicateGroup.titles) group.titles.add(title)
      group.items.push(...duplicateGroup.items)
      groups.splice(groups.indexOf(duplicateGroup), 1)
    }
  }

  return groups
    .map(group => group.items.reduce((newest, item) => {
      return getItemTime(item) >= getItemTime(newest) ? item : newest
    }))
    .sort((left, right) => getItemTime(right) - getItemTime(left))
}

export function classifyHotspotTags(text: string): string[] {
  const normalized = text.toLowerCase()
  const tags: string[] = []

  for (const rule of TAG_RULES) {
    if (rule.keywords.some(keyword => normalized.includes(keyword.toLowerCase()))) {
      tags.push(rule.tag)
    }
  }

  return tags
}

export function scoreHotspotItem(item: AiHotspotItem): number {
  const text = [
    item.title,
    item.summary,
    item.sourceName,
    item.feedName,
    item.tags.join(' '),
  ].filter(Boolean).join(' ').toLowerCase()

  let score = 0

  for (const keyword of AI_HOTSPOT_CONFIG.filter.aiKeywords) {
    if (text.includes(keyword.toLowerCase())) score += 8
  }

  for (const keyword of AI_HOTSPOT_CONFIG.filter.techKeywords) {
    if (text.includes(keyword.toLowerCase())) score += 4
  }

  score += item.tags.length * 6
  if (AI_HOTSPOT_CONFIG.filter.trustedAiSourceIds.includes(item.sourceId.toLowerCase())) score += 10
  if (item.isFavorite) score += 5
  if (item.savedNotePath) score += 3
  if (item.isRead) score -= 2

  return Math.max(0, score)
}

export function filterHotspotsByWindow(
  items: AiHotspotItem[],
  timeRange: AiHotspotTimeRange,
  now = new Date(),
): AiHotspotItem[] {
  const windowMs = timeRange === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  const cutoff = now.getTime() - windowMs

  return items.filter(item => {
    const time = getItemTime(item)
    return time > 0 && time >= cutoff && time <= now.getTime()
  })
}

function createDedupeKeys(item: AiHotspotItem): { urls: string[], titles: string[] } {
  const normalizedUrl = normalizeHotspotUrl(item.url)
  const normalizedTitle = normalizeHotspotTitle(item.title)
  const scope = getDedupeScope(item)

  return {
    urls: normalizedUrl ? [`${scope}${normalizedUrl}`] : [],
    titles: normalizedTitle ? [`${scope}${normalizedTitle}`] : [],
  }
}

function getDedupeScope(item: AiHotspotItem) {
  if (item.meta?.feedRole !== 'daily-article') return ''

  const issueDate = typeof item.meta.dailyIssueDate === 'string' ? item.meta.dailyIssueDate : ''
  const articleKey = typeof item.meta.dailyArticleKey === 'string' ? item.meta.dailyArticleKey : ''
  const articleIndex = typeof item.meta.dailyArticleIndex === 'number' ? String(item.meta.dailyArticleIndex) : ''
  const dailyScope = [issueDate, articleKey || articleIndex].filter(Boolean).join(':')

  return `daily-article:${dailyScope}:`
}

function getItemTime(item: AiHotspotItem): number {
  const value = item.lastSeenAt ?? item.publishedAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()))
}
