import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import {
  addAiHotspotUserFeed,
  deleteAiHotspotUserFeed,
  getAiHotspotItems,
  getAiHotspotSourceStatuses,
  getAiHotspotUserFeeds,
  initAiHotspotsDb,
  setAiHotspotFavorite,
  setAiHotspotRead,
  updateAiHotspotUserFeed,
  type AddAiHotspotUserFeedInput,
  type UpdateAiHotspotUserFeedPatch,
} from '@/db/ai-hotspots'
import {
  AI_HOTSPOT_CONFIG,
  buildHotspotDigestMarkdown,
  filterHotspotsByWindow,
  parseOpmlFeeds,
  refreshAiHotspots,
  shouldAutoRefreshAiHotspots,
} from '@/lib/ai-hotspots'
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
  error: string | null
  refreshProgress: AiHotspotRefreshProgress
  load: () => Promise<void>
  loadSettings: () => Promise<AiHotspotSettings>
  saveSettings: (patch: Partial<AiHotspotSettings>) => Promise<void>
  refresh: (options?: { force?: boolean }) => Promise<void>
  setView: (view: AiHotspotView) => void
  setFilters: (partial: Partial<AiHotspotFilters>) => void
  toggleFavorite: (id: string) => Promise<void>
  markRead: (id: string, read: boolean) => Promise<void>
  saveItemAsNote: (id: string) => Promise<void>
  generateDigest: (scope?: AiHotspotDigestScope) => Promise<string>
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
  return { settings, lastRefreshAt }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getItemTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function getItemDay(item: AiHotspotItem) {
  const time = getItemTime(item)
  if (!time) return ''
  return new Date(time).toISOString().slice(0, 10)
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
    item.sourceName,
    item.feedName,
    item.url,
    ...item.tags,
  ].join(' ').toLowerCase()

  return words.every(word => haystack.includes(word))
}

function sortHotspotItems(items: AiHotspotItem[]) {
  return [...items].sort((left, right) => {
    const leftDay = getItemDay(left)
    const rightDay = getItemDay(right)
    if (leftDay && leftDay === rightDay && left.score !== right.score) {
      return right.score - left.score
    }
    return getItemTime(right) - getItemTime(left)
  })
}

function deriveFilteredItems(items: AiHotspotItem[], filters: AiHotspotFilters) {
  return sortHotspotItems(
    filterHotspotsByWindow(items, filters.timeRange).filter((item) => {
      if (filters.sourceId !== 'all' && item.sourceId !== filters.sourceId) return false
      if (filters.status === 'unread' && item.isRead) return false
      if (filters.status === 'favorite' && !item.isFavorite) return false
      if (filters.status === 'saved' && !item.savedNotePath) return false
      return matchesQuery(item, filters.query)
    }),
  )
}

function patchItem(items: AiHotspotItem[], id: string, patch: Partial<AiHotspotItem>) {
  return items.map(item => item.id === id ? { ...item, ...patch } : item)
}

export const useAiHotspotsStore = create<AiHotspotsState>((set, get) => ({
  view: 'latest',
  items: [],
  filteredItems: [],
  sources: [],
  userFeeds: [],
  filters: DEFAULT_FILTERS,
  settings: DEFAULT_SETTINGS,
  isLoading: false,
  isRefreshing: false,
  lastRefreshAt: null,
  error: null,
  refreshProgress: null,

  loadSettings: async () => {
    const { settings, lastRefreshAt } = await loadTauriStoreSettings()
    const filters = {
      ...get().filters,
      timeRange: settings.defaultTimeRange,
    }
    set({
      settings,
      lastRefreshAt,
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

  load: async () => {
    let shouldRefreshAfterLoad = false
    set({
      isLoading: true,
      error: null,
      refreshProgress: { stage: 'loading-cache', message: '正在读取本地 AI 热点缓存' },
    })

    try {
      await initAiHotspotsDb()
      const [{ settings, lastRefreshAt }, items, sources, userFeeds] = await Promise.all([
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
        filters,
        filteredItems: deriveFilteredItems(items, filters),
      })

      shouldRefreshAfterLoad = shouldAutoRefreshAiHotspots({
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
    if (get().isRefreshing) return

    const settings = get().settings
    const force = options.force ?? true
    if (!force && !shouldAutoRefreshAiHotspots({
      autoRefreshOnOpen: true,
      lastRefreshAt: get().lastRefreshAt,
      cooldownMinutes: settings.refreshCooldownMinutes,
    })) {
      return
    }

    set({
      isRefreshing: true,
      error: null,
      refreshProgress: { stage: 'refreshing', message: '正在聚合 AI 热点来源' },
    })

    try {
      const result = await refreshAiHotspots({ includeUserFeeds: true })
      const userFeeds = await getAiHotspotUserFeeds()
      const lastRefreshAt = result.snapshot.completedAt
      const store = await Store.load('store.json')
      await store.set(STORE_KEYS.lastRefreshAt, lastRefreshAt)
      await store.save()

      set({
        items: result.items,
        sources: result.statuses,
        userFeeds,
        lastRefreshAt,
        filteredItems: deriveFilteredItems(result.items, get().filters),
        refreshProgress: { stage: 'saving', message: 'AI 热点已写入本地缓存' },
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
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

  saveItemAsNote: async (id) => {
    const item = get().items.find(candidate => candidate.id === id)
    if (!item) return
    set({ error: '保存为笔记将在 AI 热点知识沉淀任务中启用' })
  },

  generateDigest: async (scope = 'current') => {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    let items = get().filteredItems

    if (scope === '24h' || scope === '7d') {
      items = deriveFilteredItems(get().items, { ...get().filters, timeRange: scope })
    } else if (scope === 'favorites') {
      items = get().items.filter(item => item.isFavorite)
    } else if (scope === 'unread') {
      items = get().items.filter(item => !item.isRead)
    }

    return buildHotspotDigestMarkdown({
      date,
      title: scope === '7d' ? 'AI 热点周报' : 'AI 热点日报',
      items: sortHotspotItems(items).slice(0, 30),
    })
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
