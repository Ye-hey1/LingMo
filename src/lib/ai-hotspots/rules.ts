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
  { tag: '模型发布', keywords: ['model', 'gpt', 'llm', 'claude', 'gemini', 'deepseek', '模型', '大模型', '发布'] },
  { tag: '开发工具', keywords: ['sdk', 'api', 'agent', 'developer', 'tool', 'github', '开源', '开发', '工具', '智能体'] },
  { tag: '多模态', keywords: ['multimodal', 'vision', 'video', 'image', 'audio', '多模态', '视觉', '视频', '图像', '语音'] },
  { tag: '算力芯片', keywords: ['gpu', 'chip', 'cuda', 'nvidia', '算力', '芯片'] },
  { tag: '行业应用', keywords: ['enterprise', 'startup', 'industry', '应用', '企业', '商业化'] },
  { tag: '研究进展', keywords: ['paper', 'research', 'benchmark', 'eval', '论文', '研究', '评测'] },
]

export function isAiHotspotRelated(record: AiHotspotRelatedRecord): boolean {
  const siteId = (record.siteId ?? '').trim().toLowerCase()
  const filter = AI_HOTSPOT_CONFIG.filter

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

  return {
    urls: normalizedUrl ? [normalizedUrl] : [],
    titles: normalizedTitle ? [normalizedTitle] : [],
  }
}

function getItemTime(item: AiHotspotItem): number {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()))
}
