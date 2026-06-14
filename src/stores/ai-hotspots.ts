import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import {
  addAiHotspotUserFeed,
  cleanupAiHotspotTrash,
  deleteAiHotspotUserFeed,
  getAiHotspotItems,
  getAiHotspotSourceStatuses,
  getAiHotspotUserFeeds,
  initAiHotspotsDb,
  setAiHotspotDeletedAt,
  setAiHotspotDigestStatus,
  setAiHotspotSavedNotePath,
  setAiHotspotFavorite,
  setAiHotspotIgnored,
  setAiHotspotInsight,
  setAiHotspotRead,
  setAiHotspotSnapshotId,
  updateAiHotspotUserFeed,
  type AddAiHotspotUserFeedInput,
  type UpdateAiHotspotUserFeedPatch,
} from '@/db/ai-hotspots'
import {
  AI_HOTSPOT_CONFIG,
  AI_HOT_RSS_SOURCE_ID,
  buildHotspotDigestMarkdown,
  filterHotspotsByWindow,
  parseOpmlFeeds,
  refreshAiHotspotDailyLatest,
  refreshAiHotspotFeatured,
  refreshAiHotspots,
  shouldAutoRefreshAiHotspots,
} from '@/lib/ai-hotspots'
import { seedBuiltinSources } from '@/lib/ai-hotspots/seed-builtin-sources'
import { generateAiHotspotInsight } from '@/lib/ai-hotspots/insights'
import { writeHotspotDigestNote, writeHotspotItemNote } from '@/lib/ai-hotspots/notes'
import type {
  AiHotspotFilters,
  AiHotspotItem,
  AiHotspotSourceStatus,
  AiHotspotTimeRange,
  AiHotspotUserFeed,
  AiHotspotView,
} from '@/lib/ai-hotspots'

type AiHotspotRefreshProgress = {
  stage: 'idle' | 'loading-cache' | 'refreshing' | 'saving'
  message: string
} | null

export interface AiHotspotSettings {
  autoRefreshOnOpen: boolean
  refreshCooldownMinutes: number
  defaultTimeRange: AiHotspotTimeRange
  translateTitles: boolean
  translateMaxNew: number
}

type AiHotspotDigestScope = 'current' | '24h' | '7d' | 'favorites' | 'unread'

interface AiHotspotsState {
  view: AiHotspotView
  items: AiHotspotItem[]
  filteredItems: AiHotspotItem[]
  sources: AiHotspotSourceStatus[]
  userFeeds: AiHotspotUserFeed[]
  filters: AiHotspotFilters
  settings: AiHotspotSettings
  isLoading: boolean
  isRefreshing: boolean
  lastRefreshAt: string | null
  lastDailyRefreshAt: string | null
  lastDailyAutoRefreshDate: string | null
  error: string | null
  refreshProgress: AiHotspotRefreshProgress
  load: (options?: { skipAutoRefresh?: boolean }) => Promise<void>
  loadSettings: () => Promise<AiHotspotSettings>
  saveSettings: (patch: Partial<AiHotspotSettings>) => Promise<void>
  refresh: (options?: { force?: boolean }) => Promise<Awaited<ReturnType<typeof refreshAiHotspots>> | null>
  refreshFeatured: (options?: { force?: boolean }) => Promise<Awaited<ReturnType<typeof refreshAiHotspotFeatured>> | null>
  refreshDaily: (options?: { force?: boolean; autoRefreshDate?: string }) => Promise<Awaited<ReturnType<typeof refreshAiHotspotDailyLatest>> | null>
  setView: (view: AiHotspotView) => void
  setFilters: (partial: Partial<AiHotspotFilters>) => void
  toggleFavorite: (id: string) => Promise<void>
  markRead: (id: string, read: boolean) => Promise<void>
  ignoreItem: (id: string, ignored: boolean) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>
  addItemToDigest: (id: string) => Promise<void>
  generateItemInsight: (id: string) => Promise<AiHotspotItem | null>
  saveItemAsNote: (id: string) => Promise<string | null>
  saveSnapshotAsNote: (id: string) => Promise<string | null>
  generateDigest: (scope?: AiHotspotDigestScope) => Promise<string>
  saveDigestAsNote: (scope?: AiHotspotDigestScope) => Promise<{ markdown: string; path: string }>
  addUserFeed: (input: AddAiHotspotUserFeedInput) => Promise<void>
  updateUserFeed: (id: string, patch: UpdateAiHotspotUserFeedPatch) => Promise<void>
  deleteUserFeed: (id: string) => Promise<void>
  importOpml: (content: string) => Promise<number>
}

const STORE_KEYS = {
  autoRefreshOnOpen: 'aiHotspotsAutoRefreshOnOpen',
  refreshCooldownMinutes: 'aiHotspotsRefreshCooldownMinutes',
  defaultTimeRange: 'aiHotspotsDefaultTimeRange',
  translateTitles: 'aiHotspotsTranslateTitles',
  translateMaxNew: 'aiHotspotsTranslateMaxNew',
  lastRefreshAt: 'aiHotspotsLastRefreshAt',
  lastDailyRefreshAt: 'aiHotspotsDailyLastRefreshAt',
  lastDailyAutoRefreshDate: 'aiHotspotsDailyLastAutoRefreshDate',
} as const

const DEFAULT_SETTINGS: AiHotspotSettings = {
  autoRefreshOnOpen: true,
  refreshCooldownMinutes: AI_HOTSPOT_CONFIG.refresh.defaultCooldownMinutes,
  defaultTimeRange: '24h',
  translateTitles: false,
  translateMaxNew: AI_HOTSPOT_CONFIG.refresh.defaultTranslateMaxNew,
}

const DEFAULT_FILTERS: AiHotspotFilters = {
  query: '',
  timeRange: DEFAULT_SETTINGS.defaultTimeRange,
  sourceId: 'all',
  feedName: 'all',
  status: 'all',
}

async function loadTauriStoreSettings() {
  const store = await Store.load('store.json')
  const settings: AiHotspotSettings = {
    autoRefreshOnOpen: await store.get<boolean>(STORE_KEYS.autoRefreshOnOpen) ?? DEFAULT_SETTINGS.autoRefreshOnOpen,
    refreshCooldownMinutes: await store.get<number>(STORE_KEYS.refreshCooldownMinutes) ?? DEFAULT_SETTINGS.refreshCooldownMinutes,
    defaultTimeRange: await store.get<AiHotspotTimeRange>(STORE_KEYS.defaultTimeRange) ?? DEFAULT_SETTINGS.defaultTimeRange,
    translateTitles: await store.get<boolean>(STORE_KEYS.translateTitles) ?? DEFAULT_SETTINGS.translateTitles,
    translateMaxNew: await store.get<number>(STORE_KEYS.translateMaxNew) ?? DEFAULT_SETTINGS.translateMaxNew,
  }
  const lastRefreshAt = await store.get<string>(STORE_KEYS.lastRefreshAt) || null
  const lastDailyRefreshAt = await store.get<string>(STORE_KEYS.lastDailyRefreshAt) || null
  const lastDailyAutoRefreshDate = await store.get<string>(STORE_KEYS.lastDailyAutoRefreshDate) || null
  return { settings, lastDailyRefreshAt, lastDailyAutoRefreshDate, lastRefreshAt }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** 优先使用 lastSeenAt（抓取时间），让最新抓取的条目排在最前面 */
function getItemTime(item: AiHotspotItem) {
  const value = item.lastSeenAt ?? item.publishedAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function _getItemDay(item: AiHotspotItem) {
  const time = getItemTime(item)
  if (!time) return ''
  return new Date(time).toISOString().slice(0, 10)
}

/** 将 feedName 显示名称映射表（与 filter-bar 中一致） */
const FEED_NAME_MAP: Record<string, string> = {
  'www.axios.com': 'Axios', 'axios.com': 'Axios',
  'www.bbc.com': 'BBC', 'bbc.com': 'BBC',
  'www.newyorker.com': 'The New Yorker', 'newyorker.com': 'The New Yorker',
  'www.producthunt.com': 'Product Hunt', 'producthunt.com': 'Product Hunt',
  'www.theatlantic.com': 'The Atlantic', 'theatlantic.com': 'The Atlantic',
  'econ.st': 'The Economist', 'www.economist.com': 'The Economist',
  'dlvr.it': 'DLVR.it',
  // github removed - not AI news focused
  'zhihu': '知乎', 'weibo': '微博', 'bilibili': 'B站',
  'juejin': '掘金', 'v2ex': 'V2EX', 'sspai': '少数派',
  '36kr': '36氪', 'huxiu': '虎嗅', 'ithome': 'IT之家',
  'solidot': 'Solidot', 'guokr': '果壳', 'oschina': '开源中国',
  'hackernews': 'Hacker News', 'producthunt': 'Product Hunt',
}

function normalizeFeedNameForFilter(raw: string): string {
  const trimmed = raw.trim()
  if (FEED_NAME_MAP[trimmed]) return FEED_NAME_MAP[trimmed]
  const noWww = trimmed.replace(/^www\./, '')
  if (FEED_NAME_MAP[noWww]) return FEED_NAME_MAP[noWww]
  if (/^[a-z0-9-]+\.(com|org|net|io|co|app|dev|cc|st)$/.test(noWww)) {
    const name = noWww.split('.')[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return trimmed
}

function matchesQuery(item: AiHotspotItem, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = [
    item.title,
    item.titleOriginal || '',
    item.titleEn || '',
    item.titleZh || '',
    item.summary || '',
    item.signalSummary || '',
    item.signalEssence || '',
    item.sourceName,
    item.feedName,
    item.url,
    ...item.tags,
    ...item.impactAudience,
  ].join(' ').toLowerCase()

  return words.every(word => haystack.includes(word))
}

/** 按抓取时间倒序排列，最新抓取的在最前面 */
function sortHotspotItems(items: AiHotspotItem[]) {
  return [...items].sort((left, right) => getItemTime(right) - getItemTime(left))
}

function deriveFilteredItems(items: AiHotspotItem[], filters: AiHotspotFilters) {
  return sortHotspotItems(
    filterHotspotsByWindow(items, filters.timeRange).filter((item) => {
      if (filters.status === 'deleted') {
        if (!item.deletedAt) return false
      } else if (item.deletedAt) {
        return false
      }

      if (filters.status === 'ignored') {
        if (!item.isIgnored) return false
      } else if (item.isIgnored) {
        return false
      }

      if (filters.sourceId !== 'all' && item.sourceId !== filters.sourceId) return false
      if (
        filters.feedName !== 'all' &&
        normalizeFeedNameForFilter(item.feedName) !== filters.feedName &&
        normalizeFeedNameForFilter(item.sourceName) !== filters.feedName
      ) return false
      if (filters.status === 'unread' && item.isRead) return false
      if (filters.status === 'favorite' && !item.isFavorite) return false
      if (filters.status === 'saved' && !item.savedNotePath && item.digestStatus !== 'saved') return false
      return matchesQuery(item, filters.query)
    }),
  )
}

function patchItem(items: AiHotspotItem[], id: string, patch: Partial<AiHotspotItem>) {
  return items.map(item => item.id === id ? { ...item, ...patch } : item)
}

function isActiveSignal(item: AiHotspotItem) {
  return !item.deletedAt && !item.isIgnored
}

function getTrashCutoffIso() {
  return new Date(
    Date.now() - AI_HOTSPOT_CONFIG.refresh.trashRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString()
}

/** 追踪 refresh 开始时间，用于检测卡死的 isRefreshing 状态 */
let refreshStartedAt = 0

export const useAiHotspotsStore = create<AiHotspotsState>((set, get) => ({
  view: 'featured',
  items: [],
  filteredItems: [],
  sources: [],
  userFeeds: [],
  filters: DEFAULT_FILTERS,
  settings: DEFAULT_SETTINGS,
  isLoading: false,
  isRefreshing: false,
  lastRefreshAt: null,
  lastDailyRefreshAt: null,
  lastDailyAutoRefreshDate: null,
  error: null,
  refreshProgress: null,

  loadSettings: async () => {
    const { settings, lastDailyAutoRefreshDate, lastDailyRefreshAt, lastRefreshAt } = await loadTauriStoreSettings()
    const filters = {
      ...get().filters,
      timeRange: settings.defaultTimeRange,
    }
    set({
      settings,
      lastRefreshAt,
      lastDailyRefreshAt,
      lastDailyAutoRefreshDate,
      filters,
      filteredItems: deriveFilteredItems(get().items, filters),
    })
    return settings
  },

  saveSettings: async (patch) => {
    const nextSettings = { ...get().settings, ...patch }
    const store = await Store.load('store.json')
    await store.set(STORE_KEYS.autoRefreshOnOpen, nextSettings.autoRefreshOnOpen)
    await store.set(STORE_KEYS.refreshCooldownMinutes, nextSettings.refreshCooldownMinutes)
    await store.set(STORE_KEYS.defaultTimeRange, nextSettings.defaultTimeRange)
    await store.set(STORE_KEYS.translateTitles, nextSettings.translateTitles)
    await store.set(STORE_KEYS.translateMaxNew, nextSettings.translateMaxNew)
    await store.save()

    const filters = {
      ...get().filters,
      ...(patch.defaultTimeRange ? { timeRange: patch.defaultTimeRange } : {}),
    }

    set({
      settings: nextSettings,
      filters,
      filteredItems: deriveFilteredItems(get().items, filters),
    })
  },

  load: async (options = {}) => {
    let shouldRefreshAfterLoad = false
    set({
      isLoading: true,
      error: null,
      refreshProgress: { stage: 'loading-cache', message: '正在读取本地 AI 热点缓存' },
    })

    try {
      await initAiHotspotsDb()
      await seedBuiltinSources()
      await cleanupAiHotspotTrash(getTrashCutoffIso())
      const [{ settings, lastDailyAutoRefreshDate, lastDailyRefreshAt, lastRefreshAt }, items, sources, userFeeds] = await Promise.all([
        loadTauriStoreSettings(),
        getAiHotspotItems(),
        getAiHotspotSourceStatuses(),
        getAiHotspotUserFeeds(),
      ])
      const filters = {
        ...get().filters,
        timeRange: settings.defaultTimeRange,
      }

      set({
        items,
        sources,
        userFeeds,
        settings,
        lastRefreshAt,
        lastDailyRefreshAt,
        lastDailyAutoRefreshDate,
        filters,
        filteredItems: deriveFilteredItems(items, filters),
      })

      shouldRefreshAfterLoad = !options.skipAutoRefresh && shouldAutoRefreshAiHotspots({
        autoRefreshOnOpen: settings.autoRefreshOnOpen,
        lastRefreshAt,
        cooldownMinutes: settings.refreshCooldownMinutes,
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set({ isLoading: false, refreshProgress: null })
    }

    if (shouldRefreshAfterLoad) {
      void get().refresh({ force: false })
    }
  },

  refresh: async (options = {}) => {
    if (get().isRefreshing) {
      // 安全阀：如果 isRefreshing 卡住超过 60 秒，强制重置并继续
      if (refreshStartedAt > 0 && Date.now() - refreshStartedAt > 60_000) {
        console.warn('[ai-hotspots] refresh stuck, force resetting')
        set({ isRefreshing: false, refreshProgress: null, error: null })
      } else {
        return null
      }
    }

    refreshStartedAt = Date.now()
    const _settings = get().settings
    const force = options.force ?? true

    set({
      isRefreshing: true,
      error: null,
      refreshProgress: { stage: 'refreshing', message: '正在聚合 AI 热点来源...' },
    })

    try {
      console.log('[ai-hotspots] refresh start, force=', force)
      const result = await refreshAiHotspots({ includeUserFeeds: true, force })
      console.log('[ai-hotspots] refresh done, items=', result.items.length, 'sources=', result.statuses.length)

      await cleanupAiHotspotTrash(getTrashCutoffIso())
      const userFeeds = await getAiHotspotUserFeeds()
      const lastRefreshAt = result.snapshot.completedAt
      const store = await Store.load('store.json')
      await store.set(STORE_KEYS.lastRefreshAt, lastRefreshAt)
      await store.save()

      const newFilters = { ...get().filters }
      const newFiltered = deriveFilteredItems(result.items, newFilters)

      set({
        items: result.items,
        sources: result.statuses,
        userFeeds,
        lastRefreshAt,
        filters: newFilters,
        filteredItems: newFiltered,
      })

      console.log('[ai-hotspots] state updated, filteredItems=', newFiltered.length)
      return result
    } catch (error) {
      console.error('[ai-hotspots] refresh error:', error)
      set({ error: getErrorMessage(error) })
      return null
    } finally {
      refreshStartedAt = 0
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  refreshFeatured: async (options = {}) => {
    if (get().isRefreshing) {
      if (refreshStartedAt > 0 && Date.now() - refreshStartedAt > 60_000) {
        console.warn('[ai-hotspots] featured refresh stuck, force resetting')
        set({ isRefreshing: false, refreshProgress: null, error: null })
      } else {
        return null
      }
    }

    refreshStartedAt = Date.now()
    const force = options.force ?? true

    set({
      isRefreshing: true,
      error: null,
      refreshProgress: { stage: 'refreshing', message: '正在同步 AI HOT 精选...' },
    })

    try {
      console.log('[ai-hotspots] featured refresh start, force=', force)
      const result = await refreshAiHotspotFeatured({ force })
      console.log('[ai-hotspots] featured refresh done, items=', result.items.length, 'sources=', result.statuses.length)

      const userFeeds = await getAiHotspotUserFeeds()
      const featuredRefreshFailed = result.snapshot.failedCount > 0
      const failedStatus = featuredRefreshFailed
        ? result.statuses.find(status => status.sourceId === AI_HOT_RSS_SOURCE_ID && !status.ok)
        : null

      const newFilters = { ...get().filters }
      const newFiltered = deriveFilteredItems(result.items, newFilters)

      set({
        items: result.items,
        sources: result.statuses,
        userFeeds,
        filters: newFilters,
        filteredItems: newFiltered,
        error: failedStatus?.lastError || null,
      })

      return result
    } catch (error) {
      console.error('[ai-hotspots] featured refresh error:', error)
      set({ error: getErrorMessage(error) })
      return null
    } finally {
      refreshStartedAt = 0
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  refreshDaily: async (options = {}) => {
    if (get().isRefreshing) {
      if (refreshStartedAt > 0 && Date.now() - refreshStartedAt > 60_000) {
        console.warn('[ai-hotspots] daily refresh stuck, force resetting')
        set({ isRefreshing: false, refreshProgress: null, error: null })
      } else {
        return null
      }
    }

    refreshStartedAt = Date.now()
    const force = options.force ?? true

    set({
      isRefreshing: true,
      error: null,
      refreshProgress: { stage: 'refreshing', message: '正在同步 AI HOT 最新日报...' },
    })

    try {
      console.log('[ai-hotspots] daily refresh start, force=', force)
      const result = await refreshAiHotspotDailyLatest({ force })
      console.log('[ai-hotspots] daily refresh done, items=', result.items.length, 'sources=', result.statuses.length)

      const userFeeds = await getAiHotspotUserFeeds()
      const lastDailyRefreshAt = result.snapshot.completedAt
      const dailyRefreshFailed = result.snapshot.failedCount > 0
      const failedStatus = dailyRefreshFailed
        ? result.statuses.find(status => status.sourceId === AI_HOT_RSS_SOURCE_ID && !status.ok)
        : null
      const store = await Store.load('store.json')
      await store.set(STORE_KEYS.lastDailyRefreshAt, lastDailyRefreshAt)
      if (options.autoRefreshDate && !dailyRefreshFailed) {
        await store.set(STORE_KEYS.lastDailyAutoRefreshDate, options.autoRefreshDate)
      }
      await store.save()

      const newFilters = { ...get().filters }
      const newFiltered = deriveFilteredItems(result.items, newFilters)

      set({
        items: result.items,
        sources: result.statuses,
        userFeeds,
        lastDailyRefreshAt,
        lastDailyAutoRefreshDate: options.autoRefreshDate && !dailyRefreshFailed
          ? options.autoRefreshDate
          : get().lastDailyAutoRefreshDate,
        filters: newFilters,
        filteredItems: newFiltered,
        error: failedStatus?.lastError || null,
      })

      return result
    } catch (error) {
      console.error('[ai-hotspots] daily refresh error:', error)
      set({ error: getErrorMessage(error) })
      return null
    } finally {
      refreshStartedAt = 0
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  setView: (view) => {
    set({ view })
  },

  setFilters: (partial) => {
    const filters = { ...get().filters, ...partial }
    set({
      filters,
      filteredItems: deriveFilteredItems(get().items, filters),
    })
  },

  toggleFavorite: async (id) => {
    const item = get().items.find(candidate => candidate.id === id)
    if (!item) return

    const nextFavorite = !item.isFavorite
    await setAiHotspotFavorite(id, nextFavorite)
    const items = patchItem(get().items, id, { isFavorite: nextFavorite })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  markRead: async (id, read) => {
    await setAiHotspotRead(id, read)
    const items = patchItem(get().items, id, { isRead: read })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  ignoreItem: async (id, ignored) => {
    await setAiHotspotIgnored(id, ignored)
    const items = patchItem(get().items, id, { isIgnored: ignored })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  deleteItem: async (id) => {
    const deletedAt = new Date().toISOString()
    await setAiHotspotDeletedAt(id, deletedAt)
    const items = patchItem(get().items, id, { deletedAt })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  restoreItem: async (id) => {
    await setAiHotspotDeletedAt(id, null)
    const items = patchItem(get().items, id, { deletedAt: null })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  addItemToDigest: async (id) => {
    await setAiHotspotDigestStatus(id, 'added')
    const items = patchItem(get().items, id, { digestStatus: 'added' })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
  },

  generateItemInsight: async (id) => {
    const item = get().items.find(candidate => candidate.id === id)
    if (!item) return null
    if (item.signalSummary && item.signalEssence) return item

    const patch = await generateAiHotspotInsight(item, get().items)
    await setAiHotspotInsight(id, patch)
    const items = patchItem(get().items, id, patch)
    const nextItem = items.find(candidate => candidate.id === id) || null
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
    })
    return nextItem
  },

  saveItemAsNote: async (id) => {
    const item = get().items.find(candidate => candidate.id === id)
    if (!item) return null

    const path = await writeHotspotItemNote(item)
    await setAiHotspotSavedNotePath(id, path)
    await setAiHotspotSnapshotId(id, path)
    await setAiHotspotDigestStatus(id, 'saved')
    const items = patchItem(get().items, id, {
      savedNotePath: path,
      snapshotId: path,
      digestStatus: 'saved',
    })
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
      error: null,
    })
    return path
  },

  saveSnapshotAsNote: async (id) => {
    const item = await get().generateItemInsight(id)
    if (!item) return null
    return get().saveItemAsNote(id)
  },

  generateDigest: async (scope = 'current') => {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    let items = get().filteredItems

    if (scope === '24h' || scope === '7d') {
      items = deriveFilteredItems(get().items, { ...get().filters, timeRange: scope })
    } else if (scope === 'favorites') {
      items = get().items.filter(item => isActiveSignal(item) && item.isFavorite)
    } else if (scope === 'unread') {
      items = get().items.filter(item => isActiveSignal(item) && !item.isRead)
    }

    items = items.filter(isActiveSignal)

    return buildHotspotDigestMarkdown({
      date,
      title: scope === '7d' ? 'AI 热点周报' : 'AI 热点日报',
      items: sortHotspotItems(items).slice(0, 30),
    })
  },

  saveDigestAsNote: async (scope = 'current') => {
    const markdown = await get().generateDigest(scope)
    const title = scope === '7d' ? 'AI 热点周报' : 'AI 热点日报'
    const path = await writeHotspotDigestNote(markdown, {
      title,
      date: new Date().toISOString().slice(0, 10),
    })
    return { markdown, path }
  },

  addUserFeed: async (input) => {
    await addAiHotspotUserFeed(input)
    set({ userFeeds: await getAiHotspotUserFeeds() })
  },

  updateUserFeed: async (id, patch) => {
    await updateAiHotspotUserFeed(id, patch)
    set({ userFeeds: await getAiHotspotUserFeeds() })
  },

  deleteUserFeed: async (id) => {
    await deleteAiHotspotUserFeed(id)
    set({ userFeeds: await getAiHotspotUserFeeds() })
  },

  importOpml: async (content) => {
    const feeds = parseOpmlFeeds(content)
    if (feeds.length === 0) return 0

    const existingUrls = new Set(
      get().userFeeds.map(feed => feed.feedUrl.trim().toLowerCase()),
    )
    let importedCount = 0

    for (const feed of feeds) {
      const feedUrl = feed.xmlUrl.trim()
      const key = feedUrl.toLowerCase()
      if (!feedUrl || existingUrls.has(key)) continue

      await addAiHotspotUserFeed({
        title: feed.title.trim() || feedUrl,
        feedUrl,
        groupName: 'OPML',
        enabled: true,
      })
      existingUrls.add(key)
      importedCount += 1
    }

    set({ userFeeds: await getAiHotspotUserFeeds() })
    return importedCount
  },
}))

export default useAiHotspotsStore
