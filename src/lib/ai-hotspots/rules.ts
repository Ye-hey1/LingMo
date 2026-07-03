import { AI_HOTSPOT_CONFIG } from './config'
import { normalizeHotspotTitle, normalizeHotspotUrl } from './normalize'
import {
  classifyByInterest,
  DEFAULT_INTEREST_TEXT,
  parseInterestConfig,
  type InterestConfig,
} from './interests'
import type { AiHotspotItem, AiHotspotTimeRange } from './types'

type AiHotspotRelatedRecord = {
  siteId?: string | null
  title?: string | null
  source?: string | null
  siteName?: string | null
  url?: string | null
  summary?: string | null
  categories?: unknown
  keywords?: unknown
}

/**
 * 兴趣配置缓存。修改配置后调用 invalidateInterestConfig() 重置。
 * 默认使用内置 DSL；运行时可注入用户自定义配置文本。
 */
let cachedConfig: InterestConfig | null = null
let cachedSourceText: string | null = null

export function getInterestConfig(sourceText?: string): InterestConfig {
  const text = sourceText ?? DEFAULT_INTEREST_TEXT
  if (cachedConfig && cachedSourceText === text) return cachedConfig
  cachedConfig = parseInterestConfig(text)
  cachedSourceText = text
  return cachedConfig
}

/** 配置变更后重置缓存（需在 saveSettings 后调用） */
export function invalidateInterestConfig() {
  cachedConfig = null
  cachedSourceText = null
}

function normalizeMetaText(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .join(' ')
  }
  if (typeof value === 'string') return value
  return ''
}

function normalizeMetaList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，、;；|/#\n]+/)
      .map(item => item.trim())
      .filter(Boolean)
  }
  return []
}

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
    record.summary,
    normalizeMetaText(record.categories),
    normalizeMetaText(record.keywords),
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

/**
 * 基于兴趣配置对热点文本进行分类。
 * 若传入 sourceText 则使用该配置，否则用默认配置（缓存）。
 */
export function classifyHotspotTags(text: string, sourceText?: string): string[] {
  const config = getInterestConfig(sourceText)
  return classifyByInterest(text, config).tags
}

/**
 * 热度评分：兴趣词组命中加成 + 可信信源/收藏/沉淀/已读调整。
 * 评分权重透明可调（来自兴趣配置的 scoring）。
 */
export function scoreHotspotItem(item: AiHotspotItem, sourceText?: string): number {
  const config = getInterestConfig(sourceText)
  const categories = normalizeMetaList(item.meta?.categories)
  const keywords = normalizeMetaList(item.meta?.keywords)
  const contentText = typeof item.meta?.contentText === 'string' ? item.meta.contentText : ''
  const text = [
    item.title,
    item.summary,
    item.sourceName,
    item.feedName,
    item.tags.join(' '),
    categories.join(' '),
    keywords.join(' '),
    typeof item.meta?.author === 'string' ? item.meta.author : '',
    contentText.slice(0, 1200),
  ].filter(Boolean).join(' ')

  const result = classifyByInterest(text, config)
  const scoring = config.scoring

  let score = result.groupBonus
  // 未配置任何词组时，回退到全局 AI/技术关键词加权（保持向后兼容）
  if (config.wordGroups.length === 0) {
    const lower = text.toLowerCase()
    for (const keyword of AI_HOTSPOT_CONFIG.filter.aiKeywords) {
      if (lower.includes(keyword)) score += 8
    }
    for (const keyword of AI_HOTSPOT_CONFIG.filter.techKeywords) {
      if (lower.includes(keyword)) score += 4
    }
  }

  if (AI_HOTSPOT_CONFIG.filter.trustedAiSourceIds.includes(item.sourceId.toLowerCase())) score += scoring.trustedSourceBonus
  if ((item.summary || '').trim().length >= 80) score += 2
  if (categories.length > 0) score += 3
  if (keywords.length > 0) score += 2
  if (typeof item.meta?.thumbnail === 'string' && item.meta.thumbnail.trim()) score += 1
  if (contentText.trim().length >= 800) score += 4
  else if (contentText.trim().length >= 240) score += 2
  if (item.title.trim().length < 8) score -= 3
  if (item.isFavorite) score += scoring.favoriteBonus
  if (item.savedNotePath) score += scoring.savedBonus
  if (item.isRead) score -= scoring.readPenalty

  return Math.max(0, Math.round(score))
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
