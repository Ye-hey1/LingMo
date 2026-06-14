import {
  getAiHotspotItems,
  getAiHotspotSourceStatuses,
  getAiHotspotUserFeeds,
  initAiHotspotsDb,
  insertAiHotspotSnapshot,
  cleanupAiHotspotTrash,
  pruneAiHotspotItems,
  upsertAiHotspotItems,
  upsertAiHotspotSourceStatuses,
  type AiHotspotSnapshot,
} from '@/db/ai-hotspots'
import { AI_HOTSPOT_CONFIG } from './config'
import { createDefaultAiHotspotFetchers, DefaultRssFetcher, runAiHotspotFetcher, UserRssFetcher } from './fetchers'
import type { AiHotspotFetcherOptions } from './fetchers/base'
import { createHotspotId, normalizeHotspotTitle, normalizeHotspotUrl, toIsoString } from './normalize'
export { shouldAutoRefreshAiHotspots } from './refresh-policy'
import {
  classifyHotspotTags,
  dedupeHotspotItems,
  isAiHotspotRelated,
  scoreHotspotItem,
} from './rules'
import type { AiHotspotItem, AiHotspotRawItem, AiHotspotSourceStatus } from './types'

export interface AiHotspotRefreshResult {
  items: AiHotspotItem[]
  statuses: AiHotspotSourceStatus[]
  snapshot: AiHotspotSnapshot
}

export interface AiHotspotRefreshOptions {
  includeUserFeeds?: boolean
  signal?: AbortSignal
  /** 当 true 时跳过 If-Modified-Since 增量逻辑，强制全量拉取 */
  force?: boolean
}

export interface AiHotspotDailyRefreshOptions {
  signal?: AbortSignal
  /** 手动/每日首次进入时默认强制读取最新日报，但仍只请求 daily feed 的第一期 */
  force?: boolean
}

export interface AiHotspotFeaturedRefreshOptions {
  signal?: AbortSignal
  /** 手动刷新精选时默认强制读取官方 feed.xml，但不会触发其它来源 */
  force?: boolean
}

function createRefreshId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `refresh-${crypto.randomUUID()}`
  }
  return `refresh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 优先使用 lastSeenAt（抓取时间） */
function getItemTime(item: AiHotspotItem) {
  const value = item.lastSeenAt ?? item.publishedAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('AI hotspot refresh aborted', 'AbortError')
  }
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getExistingMatcher(existingItems: AiHotspotItem[]) {
  const byId = new Map<string, AiHotspotItem>()
  const byUrl = new Map<string, AiHotspotItem>()
  const byTitle = new Map<string, AiHotspotItem>()

  for (const item of existingItems) {
    byId.set(item.id, item)

    const normalizedUrl = normalizeHotspotUrl(item.url)
    if (normalizedUrl && !byUrl.has(normalizedUrl)) {
      byUrl.set(normalizedUrl, item)
    }

    const normalizedTitle = normalizeHotspotTitle(item.title)
    if (normalizedTitle && !byTitle.has(normalizedTitle)) {
      byTitle.set(normalizedTitle, item)
    }
  }

  return (raw: AiHotspotRawItem, id: string) => {
    const normalizedUrl = normalizeHotspotUrl(raw.url)
    const normalizedTitle = normalizeHotspotTitle(raw.title)

    return byId.get(id) ||
      (normalizedUrl ? byUrl.get(normalizedUrl) : undefined) ||
      (normalizedTitle ? byTitle.get(normalizedTitle) : undefined)
  }
}

export function rawItemToHotspotItem(
  raw: AiHotspotRawItem,
  now: Date,
  existing?: AiHotspotItem,
): AiHotspotItem {
  const nowIso = now.toISOString()
  const title = raw.title.trim()
  const url = normalizeHotspotUrl(raw.url) || raw.url.trim()
  const id = createHotspotId(raw.sourceId, raw.feedName, title, url)
  const titleOriginal = normalizeText(raw.meta.titleOriginal) || existing?.titleOriginal || null
  const tags = classifyHotspotTags([
    title,
    raw.sourceName,
    raw.feedName,
    normalizeText(raw.meta.description),
    normalizeText(raw.meta.summary),
  ].join(' '))

  const item: AiHotspotItem = {
    id,
    sourceId: raw.sourceId,
    sourceName: raw.sourceName,
    feedName: raw.feedName,
    title,
    titleOriginal,
    titleEn: existing?.titleEn || null,
    titleZh: existing?.titleZh || null,
    url,
    publishedAt: toIsoString(raw.publishedAt),
    firstSeenAt: existing?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    summary: existing?.summary || normalizeText(raw.meta.summary) || null,
    tags,
    score: 0,
    isFavorite: existing?.isFavorite ?? false,
    isRead: existing?.isRead ?? false,
    savedNotePath: existing?.savedNotePath || null,
    signalSummary: existing?.signalSummary || null,
    signalEssence: existing?.signalEssence || null,
    impactAudience: existing?.impactAudience || [],
    suggestedAction: existing?.suggestedAction || null,
    relatedSignalIds: existing?.relatedSignalIds || [],
    isIgnored: existing?.isIgnored ?? false,
    deletedAt: existing?.deletedAt || null,
    digestStatus: existing?.digestStatus || 'none',
    snapshotId: existing?.snapshotId || null,
    meta: {
      ...(existing?.meta || {}),
      ...raw.meta,
    },
  }

  item.score = scoreHotspotItem(item)
  return item
}

export function mergeHotspotItems(
  existingItems: AiHotspotItem[],
  rawItems: AiHotspotRawItem[],
  now: Date,
) {
  const findExisting = getExistingMatcher(existingItems)

  const incomingItems = rawItems
    .map((raw) => {
      const id = createHotspotId(raw.sourceId, raw.feedName, raw.title.trim(), normalizeHotspotUrl(raw.url) || raw.url.trim())
      return rawItemToHotspotItem(raw, now, findExisting(raw, id))
    })
    .filter((item) => {
      return isAiHotspotRelated({
        siteId: item.sourceId,
        title: item.title,
        source: item.feedName,
        siteName: item.sourceName,
        url: item.url,
      })
    })

  return dedupeHotspotItems(incomingItems)
    .map((item) => {
      const rescored = { ...item }
      rescored.score = scoreHotspotItem(rescored)
      return rescored
    })
    .sort((left, right) => getItemTime(right) - getItemTime(left))
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
) {
  const results: R[] = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, () => worker()),
  )

  return results
}

/**
 * 构建 sourceId → lastFetchAt 的映射。
 * 从 ai_hotspot_sources 表中读取每个源上次成功拉取的时间。
 */
function buildLastFetchAtMap(statuses: AiHotspotSourceStatus[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const status of statuses) {
    if (status.ok && status.lastOkAt) {
      map.set(status.sourceId, status.lastOkAt)
    }
  }
  return map
}

/**
 * 增量刷新核心逻辑：
 * 1. 读取每个源的上次成功拉取时间 lastFetchAt
 * 2. 将 lastFetchAt 传递给 fetcher，实现 HTTP 层 If-Modified-Since + 条目级时间过滤
 * 3. 只对新增/变更的条目做 merge 和 upsert，避免重复处理已存在的条目
 * 4. 仍然返回全量数据供 UI 使用
 */
export async function refreshAiHotspots(options: AiHotspotRefreshOptions = {}): Promise<AiHotspotRefreshResult> {
  const startedAt = new Date()
  throwIfAborted(options.signal)

  await initAiHotspotsDb()

  // 读取已有的源状态，获取每个源的 lastFetchAt
  const existingStatuses = await getAiHotspotSourceStatuses()
  const lastFetchAtMap = buildLastFetchAtMap(existingStatuses)

  // 判断是否为首次刷新（没有任何源成功过）
  const isFirstRefresh = lastFetchAtMap.size === 0

  const existingItems = await getAiHotspotItems()
  const userFeeds = await getAiHotspotUserFeeds()
  const fetchers = createDefaultAiHotspotFetchers()
  const includeUserFeeds = options.includeUserFeeds ?? true
  const enabledUserFeeds = userFeeds.filter(feed => feed.enabled)

  if (includeUserFeeds && enabledUserFeeds.length > 0) {
    fetchers.push(new UserRssFetcher(enabledUserFeeds))
  }

  throwIfAborted(options.signal)

  const fetchResults = await mapWithConcurrency(fetchers, 5, async (fetcher) => {
    throwIfAborted(options.signal)

    // 增量模式：传递 lastFetchAt 给 fetcher；force 时跳过增量
    const fetchOptions: AiHotspotFetcherOptions = {
      force: options.force ?? false,
      signal: options.signal,
      lastFetchAt: options.force ? null : (lastFetchAtMap.get(fetcher.sourceId) || null),
    }

    return await runAiHotspotFetcher(fetcher, startedAt, fetchOptions)
  })

  throwIfAborted(options.signal)

  const rawItems = fetchResults.flatMap(result => result.items)
  const statuses = fetchResults.map(result => result.status)

  // 合并新旧数据：始终传入 existingItems 以保留用户状态（收藏/已读等）
  // force=true 时 rawItems 是全量数据（无 If-Modified-Since），会正确覆盖旧条目
  const items = mergeHotspotItems(
    isFirstRefresh ? [] : existingItems,
    rawItems,
    startedAt,
  )

  const completedAt = new Date()
  const failedCount = statuses.filter(status => !status.ok).length
  const snapshot: AiHotspotSnapshot = {
    id: createRefreshId(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    rawCount: rawItems.length,
    keptCount: items.length,
    failedCount,
    status: {
      includeUserFeeds,
      sourceCount: statuses.length,
      failedSources: statuses.filter(status => !status.ok).map(status => status.sourceId),
      incremental: !isFirstRefresh,
      newItems: items.length,
    },
  }

  // 只 upsert 新增/变更的条目
  if (items.length > 0) {
    await upsertAiHotspotItems(items)
  }
  await upsertAiHotspotSourceStatuses(statuses)
  await insertAiHotspotSnapshot(snapshot)

  const keepAfter = new Date(
    completedAt.getTime() - AI_HOTSPOT_CONFIG.refresh.archiveDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  const dailyKeepAfter = new Date(
    completedAt.getTime() - AI_HOTSPOT_CONFIG.refresh.dailyArchiveDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  await pruneAiHotspotItems(keepAfter, dailyKeepAfter)

  const trashDeleteBefore = new Date(
    completedAt.getTime() - AI_HOTSPOT_CONFIG.refresh.trashRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  await cleanupAiHotspotTrash(trashDeleteBefore)

  // 返回全量数据供 UI 使用
  const persistedItems = await getAiHotspotItems()

  return {
    items: persistedItems,
    statuses,
    snapshot,
  }
}

export async function refreshAiHotspotDailyLatest(options: AiHotspotDailyRefreshOptions = {}): Promise<AiHotspotRefreshResult> {
  const startedAt = new Date()
  throwIfAborted(options.signal)

  await initAiHotspotsDb()

  const existingStatuses = await getAiHotspotSourceStatuses()
  const lastFetchAtMap = buildLastFetchAtMap(existingStatuses)
  const existingItems = await getAiHotspotItems()
  const force = options.force ?? true
  const fetcher = new DefaultRssFetcher('latest-daily')

  throwIfAborted(options.signal)

  const fetchOptions: AiHotspotFetcherOptions = {
    force,
    signal: options.signal,
    lastFetchAt: force ? null : (lastFetchAtMap.get(fetcher.sourceId) || null),
  }
  const fetchResult = await runAiHotspotFetcher(fetcher, startedAt, fetchOptions)

  throwIfAborted(options.signal)

  const rawItems = fetchResult.items
  const statuses = [fetchResult.status]
  const items = mergeHotspotItems(existingItems, rawItems, startedAt)
  const completedAt = new Date()
  const failedCount = statuses.filter(status => !status.ok).length
  const snapshot: AiHotspotSnapshot = {
    id: createRefreshId(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    rawCount: rawItems.length,
    keptCount: items.length,
    failedCount,
    status: {
      includeUserFeeds: false,
      sourceCount: 1,
      failedSources: statuses.filter(status => !status.ok).map(status => status.sourceId),
      incremental: !force,
      latestDailyOnly: true,
      newItems: items.length,
    },
  }

  if (items.length > 0) {
    await upsertAiHotspotItems(items)
  }
  await upsertAiHotspotSourceStatuses(statuses)
  await insertAiHotspotSnapshot(snapshot)

  const persistedItems = await getAiHotspotItems()
  const persistedStatuses = await getAiHotspotSourceStatuses()

  return {
    items: persistedItems,
    statuses: persistedStatuses,
    snapshot,
  }
}

export async function refreshAiHotspotFeatured(options: AiHotspotFeaturedRefreshOptions = {}): Promise<AiHotspotRefreshResult> {
  const startedAt = new Date()
  throwIfAborted(options.signal)

  await initAiHotspotsDb()

  const existingStatuses = await getAiHotspotSourceStatuses()
  const lastFetchAtMap = buildLastFetchAtMap(existingStatuses)
  const existingItems = await getAiHotspotItems()
  const force = options.force ?? true
  const fetcher = new DefaultRssFetcher('featured')

  throwIfAborted(options.signal)

  const fetchOptions: AiHotspotFetcherOptions = {
    force,
    signal: options.signal,
    lastFetchAt: force ? null : (lastFetchAtMap.get(fetcher.sourceId) || null),
  }
  const fetchResult = await runAiHotspotFetcher(fetcher, startedAt, fetchOptions)

  throwIfAborted(options.signal)

  const rawItems = fetchResult.items
  const statuses = [fetchResult.status]
  const items = mergeHotspotItems(existingItems, rawItems, startedAt)
  const completedAt = new Date()
  const failedCount = statuses.filter(status => !status.ok).length
  const snapshot: AiHotspotSnapshot = {
    id: createRefreshId(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    rawCount: rawItems.length,
    keptCount: items.length,
    failedCount,
    status: {
      includeUserFeeds: false,
      sourceCount: 1,
      failedSources: statuses.filter(status => !status.ok).map(status => status.sourceId),
      featuredOnly: true,
      incremental: !force,
      newItems: items.length,
    },
  }

  if (items.length > 0) {
    await upsertAiHotspotItems(items)
  }
  await upsertAiHotspotSourceStatuses(statuses)
  await insertAiHotspotSnapshot(snapshot)

  const persistedItems = await getAiHotspotItems()
  const persistedStatuses = await getAiHotspotSourceStatuses()

  return {
    items: persistedItems,
    statuses: persistedStatuses,
    snapshot,
  }
}
