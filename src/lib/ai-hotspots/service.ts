import {
  getAiHotspotItems,
  getAiHotspotUserFeeds,
  initAiHotspotsDb,
  insertAiHotspotSnapshot,
  pruneAiHotspotItems,
  upsertAiHotspotItems,
  upsertAiHotspotSourceStatuses,
  type AiHotspotSnapshot,
} from '@/db/ai-hotspots'
import { AI_HOTSPOT_CONFIG } from './config'
import { createDefaultAiHotspotFetchers, runAiHotspotFetcher, UserRssFetcher } from './fetchers'
import { createHotspotId, normalizeHotspotTitle, normalizeHotspotUrl, toIsoString } from './normalize'
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
}

function createRefreshId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `refresh-${crypto.randomUUID()}`
  }
  return `refresh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getItemTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
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

export async function refreshAiHotspots(options: AiHotspotRefreshOptions = {}): Promise<AiHotspotRefreshResult> {
  const startedAt = new Date()
  throwIfAborted(options.signal)

  await initAiHotspotsDb()

  const existingItems = await getAiHotspotItems()
  const userFeeds = await getAiHotspotUserFeeds()
  const fetchers = createDefaultAiHotspotFetchers()
  const includeUserFeeds = options.includeUserFeeds ?? true
  const enabledUserFeeds = userFeeds.filter(feed => feed.enabled)

  if (includeUserFeeds && enabledUserFeeds.length > 0) {
    fetchers.push(new UserRssFetcher(enabledUserFeeds))
  }

  throwIfAborted(options.signal)

  const fetchResults = await mapWithConcurrency(fetchers, 3, async (fetcher) => {
    throwIfAborted(options.signal)
    return await runAiHotspotFetcher(fetcher, startedAt)
  })

  throwIfAborted(options.signal)

  const rawItems = fetchResults.flatMap(result => result.items)
  const statuses = fetchResults.map(result => result.status)
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
      includeUserFeeds,
      sourceCount: statuses.length,
      failedSources: statuses.filter(status => !status.ok).map(status => status.sourceId),
    },
  }

  await upsertAiHotspotItems(items)
  await upsertAiHotspotSourceStatuses(statuses)
  await insertAiHotspotSnapshot(snapshot)

  const keepAfter = new Date(
    completedAt.getTime() - AI_HOTSPOT_CONFIG.refresh.archiveDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  await pruneAiHotspotItems(keepAfter)

  const persistedItems = await getAiHotspotItems()

  return {
    items: persistedItems,
    statuses,
    snapshot,
  }
}

export function shouldAutoRefreshAiHotspots(params: {
  autoRefreshOnOpen: boolean
  lastRefreshAt: string | null
  cooldownMinutes: number
  now?: Date
}) {
  if (!params.autoRefreshOnOpen) return false
  if (!params.lastRefreshAt) return true
  if (params.cooldownMinutes <= 0) return true

  const lastRefreshTime = Date.parse(params.lastRefreshAt)
  if (!Number.isFinite(lastRefreshTime)) return true

  const now = params.now ?? new Date()
  const cooldownMs = params.cooldownMinutes * 60 * 1000
  return now.getTime() - lastRefreshTime >= cooldownMs
}
