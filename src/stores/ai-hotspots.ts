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
  loadMoreAiHotspotWechatUserFeed,
  parseOpmlFeeds,
  refreshAiHotspotDailyLatest,
  refreshAiHotspotFeatured,
  refreshAiHotspotUserFeed,
  refreshAiHotspots,
  shouldAutoRefreshAiHotspots,
} from '@/lib/ai-hotspots'
import {
  forgetDeletedBuiltinSource,
  getBuiltinSourceByFeedUrl,
  getBuiltinSourceById,
  rememberDeletedBuiltinSource,
  seedBuiltinSources,
} from '@/lib/ai-hotspots/seed-builtin-sources'
import { generateAiHotspotInsight } from '@/lib/ai-hotspots/insights'
import { runAiFilterPipeline, type AiTag } from '@/lib/ai-hotspots/ai-filter'
import { writeHotspotDigestNote, writeHotspotItemNote } from '@/lib/ai-hotspots/notes'
import { DEFAULT_INTEREST_TEXT, DEFAULT_INTERESTS_TEXT } from '@/lib/ai-hotspots/interests'
import { getInterestConfig, invalidateInterestConfig } from '@/lib/ai-hotspots/rules'
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

export type AiHotspotFilterMethod = 'keyword' | 'ai'

export interface AiHotspotSettings {
  autoRefreshOnOpen: boolean
  refreshCooldownMinutes: number
  defaultTimeRange: AiHotspotTimeRange
  translateTitles: boolean
  translateMaxNew: number
  /** 筛选模式：keyword=词组DSL匹配(免token) / ai=AI智能分类 */
  filterMethod: AiHotspotFilterMethod
  /** AI 智能分类的最低相关度阈值 (0-1) */
  aiMinScore: number
  /** 词组 DSL 配置文本（keyword 模式 + ai 模式回退） */
  interestText: string
  /** 自然语言兴趣描述（ai 模式） */
  interestsText: string
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
  /** AI 智能分类缓存的标签集合（两阶段流水线复用，省 token） */
  aiTagsCache: AiTag[]
  /** 上次 AI 分类时兴趣文本的 hash（增量决策） */
  aiInterestsHash: string
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
  refreshUserFeed: (feedId: string, options?: { force?: boolean }) => Promise<Awaited<ReturnType<typeof refreshAiHotspotUserFeed>> | null>
  loadMoreWechatUserFeed: (feedId: string, begin: number, count?: number) => Promise<Awaited<ReturnType<typeof loadMoreAiHotspotWechatUserFeed>> | null>
  setView: (view: AiHotspotView) => void
  setFilters: (partial: Partial<AiHotspotFilters>) => void
  syncItemsFromDb: () => Promise<void>
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
  /** AI 智能分类流水线：从兴趣描述提取标签并对未分类条目批量分类 */
  classifyWithAi: () => Promise<{ classified: number; tags: number }>
}

const STORE_KEYS = {
  autoRefreshOnOpen: 'aiHotspotsAutoRefreshOnOpen',
  refreshCooldownMinutes: 'aiHotspotsRefreshCooldownMinutes',
  defaultTimeRange: 'aiHotspotsDefaultTimeRange',
  translateTitles: 'aiHotspotsTranslateTitles',
  translateMaxNew: 'aiHotspotsTranslateMaxNew',
  filterMethod: 'aiHotspotsFilterMethod',
  aiMinScore: 'aiHotspotsAiMinScore',
  interestText: 'aiHotspotsInterestText',
  interestsText: 'aiHotspotsInterestsText',
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
  filterMethod: 'keyword',
  aiMinScore: 0.6,
  interestText: DEFAULT_INTEREST_TEXT,
  interestsText: DEFAULT_INTERESTS_TEXT,
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
    filterMethod: await store.get<AiHotspotFilterMethod>(STORE_KEYS.filterMethod) ?? DEFAULT_SETTINGS.filterMethod,
    aiMinScore: await store.get<number>(STORE_KEYS.aiMinScore) ?? DEFAULT_SETTINGS.aiMinScore,
    interestText: await store.get<string>(STORE_KEYS.interestText) ?? DEFAULT_SETTINGS.interestText,
    interestsText: await store.get<string>(STORE_KEYS.interestsText) ?? DEFAULT_SETTINGS.interestsText,
  }
  const lastRefreshAt = await store.get<string>(STORE_KEYS.lastRefreshAt) || null
  const lastDailyRefreshAt = await store.get<string>(STORE_KEYS.lastDailyRefreshAt) || null
  const lastDailyAutoRefreshDate = await store.get<string>(STORE_KEYS.lastDailyAutoRefreshDate) || null
  return { settings, lastDailyRefreshAt, lastDailyAutoRefreshDate, lastRefreshAt }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function rememberDeletedSeededFeed(id: string, feed?: AiHotspotUserFeed) {
  const builtinSource = getBuiltinSourceById(id) || (feed ? getBuiltinSourceByFeedUrl(feed.feedUrl) : undefined)
  if (builtinSource) {
    await rememberDeletedBuiltinSource(builtinSource.url)
    return
  }

  if (feed && (feed.groupName || '').startsWith('builtin:')) {
    await rememberDeletedBuiltinSource(feed.feedUrl)
  }
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
let loadStartedAt = 0
let loadPromise: Promise<void> | null = null
const LOAD_TIMEOUT_MS = 12_000
const REFRESH_TIMEOUT_MS = 90_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function withAbortableTimeout<T>(
  timeoutMs: number,
  message: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await withTimeout(run(controller.signal), timeoutMs + 1_000, message)
  } finally {
    clearTimeout(timer)
  }
}

export const useAiHotspotsStore = create<AiHotspotsState>((set, get) => ({
  view: 'featured',
  items: [],
  filteredItems: [],
  sources: [],
  userFeeds: [],
  filters: DEFAULT_FILTERS,
  settings: DEFAULT_SETTINGS,
  aiTagsCache: [],
  aiInterestsHash: '',
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
    await store.set(STORE_KEYS.filterMethod, nextSettings.filterMethod)
    await store.set(STORE_KEYS.aiMinScore, nextSettings.aiMinScore)
    await store.set(STORE_KEYS.interestText, nextSettings.interestText)
    await store.set(STORE_KEYS.interestsText, nextSettings.interestsText)
    await store.save()
    // 兴趣配置变更后，刷新分类/评分缓存
    invalidateInterestConfig()
    getInterestConfig(nextSettings.interestText || DEFAULT_INTEREST_TEXT)

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
    if (loadPromise && loadStartedAt > 0 && Date.now() - loadStartedAt < LOAD_TIMEOUT_MS) {
      return loadPromise
    }

    loadStartedAt = Date.now()
    loadPromise = (async () => {
      let shouldRefreshAfterLoad = false
      set({
        isLoading: true,
        error: null,
        refreshProgress: { stage: 'loading-cache', message: '正在读取本地 AI 热点缓存' },
      })

      try {
        await withTimeout(initAiHotspotsDb(), LOAD_TIMEOUT_MS, '本地数据库初始化超时，请稍后再次打开 AI 热点')
        const [{ settings, lastDailyAutoRefreshDate, lastDailyRefreshAt, lastRefreshAt }, items, sources, userFeeds] = await withTimeout(
          Promise.all([
            loadTauriStoreSettings(),
            getAiHotspotItems(),
            getAiHotspotSourceStatuses(),
            getAiHotspotUserFeeds(),
          ]),
          LOAD_TIMEOUT_MS,
          '读取本地 AI 热点缓存超时，请稍后重试',
        )
        const filters = {
          ...get().filters,
          timeRange: settings.defaultTimeRange,
        }
        // 注入用户兴趣配置（词组 DSL），供分类/评分使用
        getInterestConfig(settings.interestText || DEFAULT_INTEREST_TEXT)

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

        void (async () => {
          try {
            await seedBuiltinSources()
            await cleanupAiHotspotTrash(getTrashCutoffIso())
            const [nextSources, nextUserFeeds] = await Promise.all([
              getAiHotspotSourceStatuses(),
              getAiHotspotUserFeeds(),
            ])
            set({ sources: nextSources, userFeeds: nextUserFeeds })
          } catch (error) {
            console.warn('[ai-hotspots] background maintenance skipped:', error)
          }
        })()
      } catch (error) {
        set({ error: getErrorMessage(error) })
      } finally {
        loadStartedAt = 0
        loadPromise = null
        set({ isLoading: false, refreshProgress: null })
      }

      if (shouldRefreshAfterLoad) {
        void get().refresh({ force: false })
      }
    })()

    return loadPromise
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
      const result = await withAbortableTimeout(
        REFRESH_TIMEOUT_MS,
        '刷新 AI 热点超时，请稍后重试',
        signal => refreshAiHotspots({ includeUserFeeds: true, force, signal }),
      )
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
      const result = await withAbortableTimeout(
        REFRESH_TIMEOUT_MS,
        '刷新精选信号超时，请稍后重试',
        signal => refreshAiHotspotFeatured({ force, signal }),
      )
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
      const result = await withAbortableTimeout(
        REFRESH_TIMEOUT_MS,
        '刷新 AI 日报超时，请稍后重试',
        signal => refreshAiHotspotDailyLatest({ force, signal }),
      )
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

  refreshUserFeed: async (feedId, options = {}) => {
    if (get().isRefreshing) {
      if (refreshStartedAt > 0 && Date.now() - refreshStartedAt > 60_000) {
        console.warn('[ai-hotspots] user feed refresh stuck, force resetting')
        set({ isRefreshing: false, refreshProgress: null, error: null })
      } else {
        return null
      }
    }

    refreshStartedAt = Date.now()
    const force = options.force ?? true
    const targetFeed = get().userFeeds.find(feed => feed.id === feedId)

    set({
      isRefreshing: true,
      error: null,
      refreshProgress: {
        stage: 'refreshing',
        message: `正在刷新订阅源：${targetFeed?.title || '当前源'}`,
      },
    })

    try {
      const result = await withAbortableTimeout(
        REFRESH_TIMEOUT_MS,
        '刷新当前订阅源超时，请稍后重试',
        signal => refreshAiHotspotUserFeed({ feedId, force, signal }),
      )

      await cleanupAiHotspotTrash(getTrashCutoffIso())
      const userFeeds = await getAiHotspotUserFeeds()
      const lastRefreshAt = result.snapshot.completedAt
      const userFeedRefreshFailed = result.snapshot.failedCount > 0
      const failedStatus = userFeedRefreshFailed
        ? result.statuses.find(status => status.sourceId === 'user-rss' && !status.ok)
        : null
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
        error: failedStatus?.lastError || null,
      })

      return result
    } catch (error) {
      console.error('[ai-hotspots] user feed refresh error:', error)
      set({ error: getErrorMessage(error) })
      return null
    } finally {
      refreshStartedAt = 0
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  loadMoreWechatUserFeed: async (feedId, begin, count) => {
    try {
      const result = await withAbortableTimeout(
        REFRESH_TIMEOUT_MS,
        '加载公众号历史文章超时，请稍后重试',
        signal => loadMoreAiHotspotWechatUserFeed({ feedId, begin, count, signal }),
      )

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
        error: null,
      })

      return result
    } catch (error) {
      console.error('[ai-hotspots] wechat load more error:', error)
      set({ error: getErrorMessage(error) })
      return null
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

  syncItemsFromDb: async () => {
    const items = await getAiHotspotItems()
    set({
      items,
      filteredItems: deriveFilteredItems(items, get().filters),
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
    const feed = await addAiHotspotUserFeed(input)
    await forgetDeletedBuiltinSource(feed.feedUrl)
    set({ userFeeds: await getAiHotspotUserFeeds() })
  },

  updateUserFeed: async (id, patch) => {
    const feed = await updateAiHotspotUserFeed(id, patch)
    if (feed?.feedUrl) {
      await forgetDeletedBuiltinSource(feed.feedUrl)
    }
    set({ userFeeds: await getAiHotspotUserFeeds() })
  },

  deleteUserFeed: async (id) => {
    const feed = get().userFeeds.find(candidate => candidate.id === id)
    await rememberDeletedSeededFeed(id, feed)
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
      await forgetDeletedBuiltinSource(feedUrl)
      existingUrls.add(key)
      importedCount += 1
    }

    set({ userFeeds: await getAiHotspotUserFeeds() })
    return importedCount
  },

  classifyWithAi: async () => {
    const { settings, items, aiTagsCache, aiInterestsHash } = get()
    if (settings.filterMethod !== 'ai') {
      return { classified: 0, tags: aiTagsCache.length }
    }
    // 仅对未分类过的活跃条目增量分类（省 token）；标签重建时全量
    const active = items.filter(item => !item.deletedAt && !item.isIgnored)
    const pending = active

    set({ refreshProgress: { stage: 'refreshing', message: 'AI 正在智能分类' } })
    try {
      const result = await runAiFilterPipeline(pending, {
        interestsText: settings.interestsText,
        interestText: settings.interestText,
        minScore: settings.aiMinScore,
        batchSize: 200,
        cachedTags: aiTagsCache,
        cachedInterestsHash: aiInterestsHash,
      })

      // 写回分类结果：把 AI 标签写入 item.tags（保留原标签）
      const tagById = new Map(result.classifications.map(c => [c.id, c.tag]))
      let classified = 0
      for (const item of items) {
        const aiTag = tagById.get(item.id)
        if (aiTag && !item.tags.includes(aiTag)) {
          item.tags = [aiTag, ...item.tags.filter(t => t !== aiTag)]
          await setAiHotspotInsight(item.id, { signalSummary: item.signalSummary } as never)
          classified += 1
        }
      }

      set({
        aiTagsCache: result.tags,
        aiInterestsHash: result.interestsHash,
        items: await getAiHotspotItems(),
      })
      return { classified, tags: result.tags.length }
    } finally {
      set({ refreshProgress: null })
    }
  },
}))

export default useAiHotspotsStore
