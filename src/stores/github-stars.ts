import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import {
  addGithubStarCustomCategory,
  deleteGithubStarCustomCategory,
  getGithubStarForkRepositories,
  getGithubStarCustomCategories,
  getGithubStarReleases,
  getGithubStarRepositories,
  initGithubStarsDb,
  markGithubStarAnalysisFailed,
  markGithubStarReleaseRead,
  markGithubStarRepositoryReleasesFetched,
  markGithubStarRepositoryUnstarred,
  updateGithubStarAnalysis,
  updateGithubStarCategory,
  updateGithubStarReleaseSubscription,
  updateGithubStarRepositoryDetails,
  upsertGithubStarForkRepositories,
  upsertGithubStarReleases,
  upsertGithubStarRepositoriesBatch,
} from '@/db/github-stars'
import {
  analyzeGithubStarRepositoriesBatch,
  analyzeGithubStarRepositoryDetailed,
  analyzeGithubStarRepositoryFast,
  createGithubStarAnalysisContext,
  searchGithubStarRepositoriesWithAI,
  detectPlatforms,
} from '@/lib/github-stars/analysis'
import { createOptimizedAIAnalyzer, type AIAnalysisOptimizer, type AnalysisResult } from '@/lib/github-stars/analysis-optimizer'
import {
  fetchHotReleaseRepositories,
  fetchMostPopularRepositories,
  fetchReleasesForRepositories,
  fetchStarredRepositoriesPage,
  fetchTopicRepositories,
  fetchTrendingRepositories,
  fetchUserForks,
  searchGithubRepositories,
  starGithubRepository,
  unstarGithubRepository,
} from '@/lib/github-stars/api'
import {
  GITHUB_STAR_DEFAULT_CATEGORIES,
  matchesGithubStarCategory,
  resolveGithubStarCategory,
  type GithubStarCategory,
} from '@/lib/github-stars/categories'
import { translateBatch } from '@/lib/github-stars/translate'
import type {
  AssetFilter,
  GithubStarAiSearchInfo,
  GithubStarAnalysisProgress,
  GithubStarCustomCategory,
  GithubStarDiscoveryChannelId,
  GithubStarDiscoveryPlatform,
  GithubStarDiscoveryRepository,
  GithubStarFilters,
  GithubStarForkRepository,
  GithubStarProgrammingLanguage,
  GithubStarRelease,
  GithubStarRepository,
  GithubStarRepositoryUpdate,
  GithubStarSortBy,
  GithubStarSortOrder,
  GithubStarStats,
  GithubStarSyncProgress,
  GithubStarTopicCategory,
  GithubStarTrendingRange,
  GithubStarsView,
} from '@/types/github-stars'

const DEFAULT_FILTERS: GithubStarFilters = {
  query: '',
  language: 'all',
  category: 'all',
  analysis: 'all',
  sortBy: 'starred',
}

const ANALYSIS_BATCH_SIZE = 5
const ANALYSIS_BATCH_CONCURRENCY = 2
const SYNC_PAGE_CONCURRENCY = 4

/** 全局优化器引用，供 pause/resume/abort 使用 */
let activeOptimizer: AIAnalysisOptimizer | null = null

function matchesQuery(repo: GithubStarRepository, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = [
    repo.name,
    repo.fullName,
    repo.description || '',
    repo.language || '',
    repo.ownerLogin,
    repo.aiSummary || '',
    repo.customDescription || '',
    ...repo.topics,
    ...repo.aiTags,
    ...repo.aiPlatforms,
    ...repo.customTags,
  ].join(' ').toLowerCase()

  return words.every(word => haystack.includes(word))
}

function sortRepositories(repositories: GithubStarRepository[], sortBy: GithubStarFilters['sortBy']) {
  return [...repositories].sort((a, b) => {
    if (sortBy === 'stars') return b.stargazersCount - a.stargazersCount
    if (sortBy === 'updated') {
      return new Date(b.pushedAt || b.updatedAt || 0).getTime() - new Date(a.pushedAt || a.updatedAt || 0).getTime()
    }
    if (sortBy === 'name') return a.fullName.localeCompare(b.fullName)
    return new Date(b.starredAt || b.updatedAt || 0).getTime() - new Date(a.starredAt || a.updatedAt || 0).getTime()
  })
}

function buildCategoryRules(customCategories: GithubStarCustomCategory[]): GithubStarCategory[] {
  return [
    ...customCategories.map(category => ({
      id: `custom:${category.name}`,
      name: category.name,
      keywords: category.keywords,
      icon: category.icon,
      custom: true,
    })),
    ...GITHUB_STAR_DEFAULT_CATEGORIES,
  ]
}

function filterRepositories(
  repositories: GithubStarRepository[],
  filters: GithubStarFilters,
  categoryRules: GithubStarCategory[],
  aiSearchResultIds: number[] | null,
) {
  const aiOrder = aiSearchResultIds && filters.query.trim()
    ? new Map(aiSearchResultIds.map((repoId, index) => [repoId, index]))
    : null
  const filtered = repositories.filter(repo => {
    if (aiOrder) {
      if (!aiOrder.has(repo.id)) return false
    } else if (!matchesQuery(repo, filters.query)) {
      return false
    }

    if (filters.language !== 'all' && repo.language !== filters.language) return false
    if (!matchesGithubStarCategory(repo, filters.category, categoryRules)) return false
    if (filters.analysis === 'analyzed' && !repo.aiSummary) return false
    if (filters.analysis === 'pending' && (repo.aiSummary || repo.analysisFailed)) return false
    if (filters.analysis === 'failed' && !repo.analysisFailed) return false
    return true
  })

  if (aiOrder) {
    return [...filtered].sort((a, b) => (aiOrder.get(a.id) || 0) - (aiOrder.get(b.id) || 0))
  }

  return sortRepositories(filtered, filters.sortBy)
}

function buildStats(repositories: GithubStarRepository[], categoryRules: GithubStarCategory[] = GITHUB_STAR_DEFAULT_CATEGORIES): GithubStarStats {
  const languages = Array.from(new Set(repositories.map(repo => repo.language).filter((item): item is string => Boolean(item)))).sort()
  const categories = Array.from(new Set(repositories.map(repo => resolveGithubStarCategory(repo, categoryRules)))).sort((a, b) => a.localeCompare(b))
  const lastSyncAt = repositories.reduce<number | null>((latest, repo) => {
    if (!repo.syncedAt) return latest
    return latest === null || repo.syncedAt > latest ? repo.syncedAt : latest
  }, null)

  return {
    total: repositories.length,
    analyzed: repositories.filter(repo => Boolean(repo.aiSummary)).length,
    failed: repositories.filter(repo => repo.analysisFailed).length,
    subscribed: repositories.filter(repo => repo.subscribedToReleases).length,
    languages,
    categories,
    lastSyncAt,
  }
}

function mergeSyncedRepositories(
  currentRepositories: GithubStarRepository[],
  syncedRepositories: GithubStarRepository[],
) {
  const repositoryMap = new Map(currentRepositories.map(repo => [repo.id, repo]))

  syncedRepositories.forEach((repo) => {
    const current = repositoryMap.get(repo.id)
    repositoryMap.set(repo.id, current ? {
      ...repo,
      aiSummary: current.aiSummary,
      aiTags: current.aiTags,
      aiPlatforms: current.aiPlatforms,
      analyzedAt: current.analyzedAt,
      analysisFailed: current.analysisFailed,
      customDescription: current.customDescription,
      customTags: current.customTags,
      customCategory: current.customCategory,
      categoryLocked: current.categoryLocked,
      lastEdited: current.lastEdited,
      subscribedToReleases: current.subscribedToReleases,
      lastReleaseFetchTime: current.lastReleaseFetchTime,
      hasFetchedReleases: current.hasFetchedReleases,
      isStarred: true,
    } : repo)
  })

  return sortRepositories(Array.from(repositoryMap.values()).filter(repo => repo.isStarred), 'starred')
}

interface GithubStarsState {
  view: GithubStarsView
  repositories: GithubStarRepository[]
  filteredRepositories: GithubStarRepository[]
  releases: GithubStarRelease[]
  forks: GithubStarForkRepository[]
  trendingRepositories: GithubStarDiscoveryRepository[]
  customCategories: GithubStarCustomCategory[]
  stats: GithubStarStats
  filters: GithubStarFilters
  isLoading: boolean
  isSyncing: boolean
  isAnalyzing: boolean
  isAiSearching: boolean
  isRefreshingReleases: boolean
  isRefreshingForks: boolean
  isLoadingTrending: boolean
  analyzingRepoId: number | null
  analyzingRepoIds: number[]
  analysisProgress: GithubStarAnalysisProgress | null
  syncProgress: GithubStarSyncProgress | null
  releaseProgress: { completed: number; total: number; failed: number } | null
  aiSearchInfo: GithubStarAiSearchInfo | null
  aiSearchResultIds: number[] | null
  includePrerelease: boolean
  trendingRange: GithubStarTrendingRange
  // ─── Releases 资产过滤与模式状态 ───
  assetFilters: AssetFilter[]
  releaseViewMode: 'timeline' | 'repository'
  releaseSelectedFilters: string[]
  releaseSearchQuery: string
  releaseExpandedRepositories: Set<number>
  releaseIsRefreshing: boolean
  // ─── Discovery 多频道状态 ───
  discoveryChannel: GithubStarDiscoveryChannelId
  discoveryPlatform: GithubStarDiscoveryPlatform
  discoveryLanguage: GithubStarProgrammingLanguage
  discoverySortBy: GithubStarSortBy
  discoverySortOrder: GithubStarSortOrder
  discoverySearchQuery: string
  discoverySelectedTopic: GithubStarTopicCategory | null
  discoveryRepos: Record<GithubStarDiscoveryChannelId, GithubStarDiscoveryRepository[]>
  discoveryIsLoading: Record<GithubStarDiscoveryChannelId, boolean>
  discoveryIsLoadingMore: Record<GithubStarDiscoveryChannelId, boolean>
  discoveryHasMore: Record<GithubStarDiscoveryChannelId, boolean>
  discoveryNextPage: Record<GithubStarDiscoveryChannelId, number>
  discoveryTotalCount: Record<GithubStarDiscoveryChannelId, number>
  discoveryLastRefresh: Record<GithubStarDiscoveryChannelId, string | null>
  discoveryLoadMoreError: Record<GithubStarDiscoveryChannelId, string | null>
  error: string | null
  setView: (view: GithubStarsView) => void
  load: () => Promise<void>
  forceResetSyncState: () => void
  syncStarred: () => Promise<void>
  refreshReleases: () => Promise<void>
  refreshForks: () => Promise<void>
  refreshTrending: (range?: GithubStarTrendingRange) => Promise<void>
  toggleReleaseSubscription: (repoId: number, subscribed: boolean) => Promise<void>
  markReleaseRead: (releaseId: number) => Promise<void>
  setIncludePrerelease: (include: boolean) => void
  setTrendingRange: (range: GithubStarTrendingRange) => void
  // ─── Releases 资产过滤与模式 actions ───
  setReleaseViewMode: (mode: 'timeline' | 'repository') => void
  toggleReleaseSelectedFilter: (filterId: string) => void
  clearReleaseSelectedFilters: () => void
  setReleaseSearchQuery: (query: string) => void
  toggleReleaseExpandedRepository: (repoId: number) => void
  setReleaseIsRefreshing: (isRefreshing: boolean) => void
  addAssetFilter: (filter: AssetFilter) => void
  updateAssetFilter: (filterId: string, filter: AssetFilter) => void
  deleteAssetFilter: (filterId: string) => void
  // ─── Discovery 操作 ───
  setDiscoveryChannel: (channel: GithubStarDiscoveryChannelId) => void
  setDiscoveryPlatform: (platform: GithubStarDiscoveryPlatform) => void
  setDiscoveryLanguage: (language: GithubStarProgrammingLanguage) => void
  setDiscoverySortBy: (sortBy: GithubStarSortBy) => void
  setDiscoverySortOrder: (order: GithubStarSortOrder) => void
  setDiscoverySearchQuery: (query: string) => void
  setDiscoverySelectedTopic: (topic: GithubStarTopicCategory | null) => void
  refreshDiscoveryChannel: (channel?: GithubStarDiscoveryChannelId, page?: number, append?: boolean) => Promise<void>
  updateDiscoveryRepo: (repo: GithubStarDiscoveryRepository) => void
  analyzeDiscoveryRepo: (repoId: number) => Promise<void>
  toggleDiscoveryStar: (repo: GithubStarDiscoveryRepository) => Promise<void>
  translateDiscoveryRepos: () => Promise<void>
  aiSearch: (query: string) => Promise<void>
  analyzePending: (limit?: number) => Promise<void>
  analyzeRepositories: (repoIds: number[]) => Promise<void>
  pauseAnalysis: () => void
  resumeAnalysis: () => void
  abortAnalysis: () => void
  setFilters: (filters: Partial<GithubStarFilters>) => void
  addCategory: (category: Pick<GithubStarCustomCategory, 'name' | 'keywords' | 'icon'>) => Promise<void>
  deleteCategory: (name: string) => Promise<void>
  updateCategory: (repoId: number, category: string | null) => Promise<void>
  updateRepositoryDetails: (repoId: number, update: GithubStarRepositoryUpdate) => Promise<void>
  unstarRepository: (repoId: number) => Promise<void>
}

function getDerivedState(
  repositories: GithubStarRepository[],
  filters: GithubStarFilters,
  customCategories: GithubStarCustomCategory[],
  aiSearchResultIds: number[] | null = null,
) {
  const categoryRules = buildCategoryRules(customCategories)
  return {
    filteredRepositories: filterRepositories(repositories, filters, categoryRules, aiSearchResultIds),
    stats: buildStats(repositories, categoryRules),
  }
}

export const useGithubStarsStore = create<GithubStarsState>((set, get) => ({
  view: 'repositories',
  repositories: [],
  filteredRepositories: [],
  releases: [],
  forks: [],
  trendingRepositories: [],
  customCategories: [],
  stats: buildStats([]),
  filters: DEFAULT_FILTERS,
  isLoading: false,
  isSyncing: false,
  isAnalyzing: false,
  isAiSearching: false,
  isRefreshingReleases: false,
  isRefreshingForks: false,
  isLoadingTrending: false,
  analyzingRepoId: null,
  analyzingRepoIds: [],
  analysisProgress: null,
  syncProgress: null,
  releaseProgress: null,
  aiSearchInfo: null,
  aiSearchResultIds: null,
  includePrerelease: false,
  trendingRange: 'weekly',
  // ─── Releases 资产过滤与模式初始值 ───
  assetFilters: [],
  releaseViewMode: 'timeline',
  releaseSelectedFilters: [],
  releaseSearchQuery: '',
  releaseExpandedRepositories: new Set<number>(),
  releaseIsRefreshing: false,
  // ─── Discovery 多频道初始值 ───
  discoveryChannel: 'trending',
  discoveryPlatform: 'All',
  discoveryLanguage: 'All',
  discoverySortBy: 'BestMatch',
  discoverySortOrder: 'Descending',
  discoverySearchQuery: '',
  discoverySelectedTopic: null,
  discoveryRepos: { trending: [], 'hot-release': [], 'most-popular': [], topic: [], search: [] },
  discoveryIsLoading: { trending: false, 'hot-release': false, 'most-popular': false, topic: false, search: false },
  discoveryIsLoadingMore: { trending: false, 'hot-release': false, 'most-popular': false, topic: false, search: false },
  discoveryHasMore: { trending: false, 'hot-release': false, 'most-popular': false, topic: false, search: false },
  discoveryNextPage: { trending: 1, 'hot-release': 1, 'most-popular': 1, topic: 1, search: 1 },
  discoveryTotalCount: { trending: 0, 'hot-release': 0, 'most-popular': 0, topic: 0, search: 0 },
  discoveryLastRefresh: { trending: null, 'hot-release': null, 'most-popular': null, topic: null, search: null },
  discoveryLoadMoreError: { trending: null, 'hot-release': null, 'most-popular': null, topic: null, search: null },
  error: null,
 
  setView: (view) => set({ view }),

  load: async () => {
    set({ isLoading: true, error: null })
    try {
      await initGithubStarsDb()
      const [repositories, customCategories, releases, forks] = await Promise.all([
        getGithubStarRepositories(),
        getGithubStarCustomCategories(),
        getGithubStarReleases(),
        getGithubStarForkRepositories(),
      ])

      let savedFilters: AssetFilter[] = []
      let savedViewMode: 'timeline' | 'repository' = 'timeline'
      let savedSelectedFilters: string[] = []
      try {
        const tauriStore = await Store.load('store.json')
        savedFilters = await tauriStore.get<AssetFilter[]>('githubStarsAssetFilters') || []
        savedViewMode = await tauriStore.get<'timeline' | 'repository'>('githubStarsReleaseViewMode') || 'timeline'
        savedSelectedFilters = await tauriStore.get<string[]>('githubStarsReleaseSelectedFilters') || []
      } catch (err) {
        console.warn('[GitHubStars] failed to load state from store.json:', err)
      }

      set({
        repositories,
        customCategories,
        releases,
        forks,
        assetFilters: savedFilters,
        releaseViewMode: savedViewMode,
        releaseSelectedFilters: savedSelectedFilters,
        ...getDerivedState(repositories, get().filters, customCategories, get().aiSearchResultIds),
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ isLoading: false })
    }
  },

  /** 强制重置同步状态（用于卡住时恢复） */
  forceResetSyncState: () => {
    set({ isSyncing: false, syncProgress: null })
  },

  syncStarred: async () => {
    if (get().isSyncing) return

    set({ isSyncing: true, syncProgress: { fetched: 0, page: 1, running: 1 }, error: null })

    // 顶层安全超时：确保同步不会永远卡住
    const SYNC_MAX_DURATION = 120_000
    let safetyTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    const safetyTimeout = new Promise<never>((_, reject) => {
      safetyTimer = globalThis.setTimeout(() => {
        reject(new Error('同步超时（超过 2 分钟），请检查网络连接或代理设置。如果使用代理，请确认代理地址和端口正确。'))
      }, SYNC_MAX_DURATION)
    })

    const doSync = async () => {
      const syncedAt = Date.now()
      let fetched = 0
      const allRepositories: GithubStarRepository[] = []
      const firstPage = await fetchStarredRepositoriesPage(1)
      fetched += firstPage.repositories.length
      allRepositories.push(...firstPage.repositories)

      // 快速增量同步判定
      const localRepoMap = new Map(get().repositories.map(r => [r.id, r]))
      let allRemainingExist = false
      let existIndex = -1

      if (get().repositories.length > 0 && firstPage.repositories.length > 0) {
        for (let i = 0; i < firstPage.repositories.length; i++) {
          if (localRepoMap.has(firstPage.repositories[i].id)) {
            const remainingAllExist = firstPage.repositories.slice(i).every(r => {
              const local = localRepoMap.get(r.id)
              return local && local.isStarred
            })
            if (remainingAllExist) {
              allRemainingExist = true
              existIndex = i
              break
            }
          }
        }
      }

      if (allRemainingExist && existIndex !== -1) {
        console.log(`[GitHubStars] 触发快速增量同步，分界索引为: ${existIndex}`)
        await upsertGithubStarRepositoriesBatch(firstPage.repositories, syncedAt)
        const mergedRepositories = mergeSyncedRepositories(get().repositories, firstPage.repositories)
        set({
          repositories: mergedRepositories,
          syncProgress: { fetched: firstPage.repositories.length, page: 1, totalPages: 1, running: 0 },
          ...getDerivedState(mergedRepositories, get().filters, get().customCategories, get().aiSearchResultIds),
        })
        return
      }

      const firstTotalPages = firstPage.lastPage || (firstPage.hasMore ? undefined : 1)
      set({
        syncProgress: { fetched, page: 1, totalPages: firstTotalPages, running: 0 },
      })

      if (firstPage.lastPage && firstPage.lastPage > 1) {
        const pages = Array.from({ length: firstPage.lastPage - 1 }, (_, index) => index + 2)
        let nextPageIndex = 0
        let running = 0

        const runWorker = async () => {
          while (nextPageIndex < pages.length) {
            const page = pages[nextPageIndex]
            nextPageIndex += 1
            running += 1
            set({ syncProgress: { fetched, page, totalPages: firstPage.lastPage || undefined, running } })

            try {
              const result = await fetchStarredRepositoriesPage(page)
              fetched += result.repositories.length
              allRepositories.push(...result.repositories)
              set({
                syncProgress: { fetched, page, totalPages: firstPage.lastPage || undefined, running },
              })
            } finally {
              running -= 1
              set({ syncProgress: { fetched, page, totalPages: firstPage.lastPage || undefined, running } })
            }
          }
        }

        await Promise.all(Array.from(
          { length: Math.min(SYNC_PAGE_CONCURRENCY, pages.length) },
          () => runWorker(),
        ))
      } else {
        let page = firstPage.nextPage
        let hasMore = firstPage.hasMore

        while (hasMore) {
          set({ syncProgress: { fetched, page, running: 1 } })
          const result = await fetchStarredRepositoriesPage(page)
          fetched += result.repositories.length
          allRepositories.push(...result.repositories)
          set({
            syncProgress: { fetched, page, running: 0 },
          })
          hasMore = result.hasMore
          page = result.nextPage
        }
      }

      await upsertGithubStarRepositoriesBatch(allRepositories, syncedAt, { finishSync: true })
      const repositories = await getGithubStarRepositories()
      const customCategories = get().customCategories
      set({
        repositories,
        ...getDerivedState(repositories, get().filters, customCategories, get().aiSearchResultIds),
      })
    }

    try {
      await Promise.race([doSync(), safetyTimeout])
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const hint = msg.includes('JSON 响应解析失败') || msg.includes('Unterminated string')
        ? `同步失败：${msg}。这通常是 GitHub 响应体被代理或网络中断截断，不是 Token 本身无效。请检查代理稳定性后重试。`
        : msg.includes('超时')
        ? msg
        : msg.includes('transaction')
          ? `同步失败：${msg}。已定位为本地数据库写入冲突，不是 GitHub Token 或代理配置本身导致。`
          : `同步失败：${msg}。请检查 GitHub Token 和网络代理设置是否正确。`
      set({ error: hint })
    } finally {
      if (safetyTimer) {
        globalThis.clearTimeout(safetyTimer)
      }
      set({ isSyncing: false, syncProgress: null })
    }
  },

  refreshReleases: async () => {
    if (get().isRefreshingReleases) return

    const subscribedRepositories = get().repositories.filter(repo => repo.subscribedToReleases)
    if (subscribedRepositories.length === 0) {
      set({ error: '请先在仓库卡片中订阅 Release' })
      return
    }

    let completed = 0
    let failed = 0
    const total = subscribedRepositories.length
    set({
      isRefreshingReleases: true,
      releaseProgress: { completed, total, failed },
      error: null,
    })

    try {
      const result = await fetchReleasesForRepositories(subscribedRepositories, {
        includePrerelease: get().includePrerelease,
        onRepositoryComplete: () => {
          completed += 1
          set({ releaseProgress: { completed, total, failed } })
        },
      })
      failed = result.failedRepositories.length
      set({ releaseProgress: { completed, total, failed } })

      await upsertGithubStarReleases(result.releases)

      const fetchedAt = new Date().toISOString()
      const failedRepoIds = new Set(result.failedRepositories.map(item => item.repo.id))
      for (const repo of subscribedRepositories) {
        if (!failedRepoIds.has(repo.id)) {
          await markGithubStarRepositoryReleasesFetched(repo.id, fetchedAt)
        }
      }

      const [repositories, releases] = await Promise.all([
        getGithubStarRepositories(),
        getGithubStarReleases(),
      ])
      set({
        repositories,
        releases,
        ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
        error: result.failedRepositories.length > 0
          ? `${result.failedRepositories.length} 个仓库 Release 刷新失败`
          : null,
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ isRefreshingReleases: false, releaseProgress: null })
    }
  },

  refreshForks: async () => {
    if (get().isRefreshingForks) return

    set({ isRefreshingForks: true, error: null })
    try {
      const forks = await fetchUserForks()
      await upsertGithubStarForkRepositories(forks)
      set({ forks: await getGithubStarForkRepositories() })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ isRefreshingForks: false })
    }
  },

  refreshTrending: async (range) => {
    if (get().isLoadingTrending) return

    const trendingRange = range || get().trendingRange
    set({ isLoadingTrending: true, trendingRange, error: null })
    try {
      const result = await fetchTrendingRepositories(trendingRange, get().discoveryPlatform, 1, 50)
      const trendingRepositories = result.repos

      // 自动翻译无中文描述的 Trending 仓库
      const reposToTranslate = trendingRepositories.filter(r => r.description && !r.aiSummary)
      if (reposToTranslate.length > 0) {
        try {
          const descriptions = reposToTranslate.map(r => r.description!)
          const translateResults = await translateBatch(descriptions, 'zh-Hans')
          reposToTranslate.forEach((repo, idx) => {
            const translated = translateResults[idx]?.translatedText
            if (translated && translated !== repo.description) {
              repo.aiSummary = translated
            }
          })
        } catch (e) {
          console.warn('[GitHubStars] Auto translation for trending failed:', e)
        }
      }

      set({
        trendingRepositories,
        discoveryRepos: { ...get().discoveryRepos, trending: trendingRepositories },
        discoveryHasMore: { ...get().discoveryHasMore, trending: result.hasMore },
        discoveryNextPage: { ...get().discoveryNextPage, trending: result.nextPageIndex },
        discoveryTotalCount: { ...get().discoveryTotalCount, trending: result.totalCount },
        discoveryLastRefresh: { ...get().discoveryLastRefresh, trending: new Date().toISOString() },
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ isLoadingTrending: false })
    }
  },

  toggleReleaseSubscription: async (repoId, subscribed) => {
    await updateGithubStarReleaseSubscription(repoId, subscribed)
    const repositories = get().repositories.map(repo =>
      repo.id === repoId
        ? { ...repo, subscribedToReleases: subscribed, lastEdited: new Date().toISOString() }
        : repo,
    )
    set({
      repositories,
      ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
    })
  },

  markReleaseRead: async (releaseId) => {
    await markGithubStarReleaseRead(releaseId)
    set({
      releases: get().releases.map(release => (
        release.id === releaseId ? { ...release, isRead: true } : release
      )),
    })
  },

  setIncludePrerelease: (include) => set({ includePrerelease: include }),

  setTrendingRange: (range) => set({ trendingRange: range }),

  // ─── Discovery 操作 ───
  setDiscoveryChannel: (channel) => set({ discoveryChannel: channel }),
  setDiscoveryPlatform: (platform) => set({ discoveryPlatform: platform }),
  setDiscoveryLanguage: (language) => set({ discoveryLanguage: language }),
  setDiscoverySortBy: (sortBy) => set({ discoverySortBy: sortBy }),
  setDiscoverySortOrder: (order) => set({ discoverySortOrder: order }),
  setDiscoverySearchQuery: (query) => set({ discoverySearchQuery: query }),
  setDiscoverySelectedTopic: (topic) => set({ discoverySelectedTopic: topic }),

  refreshDiscoveryChannel: async (channelId, page = 1, append = false) => {
    const ch = channelId || get().discoveryChannel
    const state = get()

    if (append) {
      set({ discoveryIsLoadingMore: { ...state.discoveryIsLoadingMore, [ch]: true }, discoveryLoadMoreError: { ...state.discoveryLoadMoreError, [ch]: null } })
    } else {
      set({ discoveryIsLoading: { ...state.discoveryIsLoading, [ch]: true } })
    }

    try {
      const platform = state.discoveryPlatform
      let result

      switch (ch) {
        case 'trending':
          result = await fetchTrendingRepositories(state.trendingRange, platform, page)
          break
        case 'hot-release':
          result = await fetchHotReleaseRepositories(platform, page)
          break
        case 'most-popular':
          result = await fetchMostPopularRepositories(platform, page)
          break
        case 'topic':
          if (state.discoverySelectedTopic) {
            result = await fetchTopicRepositories(state.discoverySelectedTopic, platform, page)
          } else {
            result = await fetchTrendingRepositories(state.trendingRange, platform, page)
          }
          break
        case 'search':
          if (state.discoverySearchQuery.trim()) {
            result = await searchGithubRepositories(state.discoverySearchQuery, {
              page,
              platform,
              language: state.discoveryLanguage,
              sortBy: state.discoverySortBy,
              sortOrder: state.discoverySortOrder,
            })
          } else {
            result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 }
          }
          break
        default:
          result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 }
      }

      const currentRepos = append ? (state.discoveryRepos[ch] || []) : []
      const mergedRepos = [...currentRepos, ...result.repos]

      // 自动翻译无中文描述的发现频道仓库
      const reposToTranslate = result.repos.filter(r => r.description && !r.aiSummary)
      if (reposToTranslate.length > 0) {
        try {
          const descriptions = reposToTranslate.map(r => r.description!)
          const translateResults = await translateBatch(descriptions, 'zh-Hans')
          reposToTranslate.forEach((repo, idx) => {
            const translated = translateResults[idx]?.translatedText
            if (translated && translated !== repo.description) {
              repo.aiSummary = translated
            }
          })
        } catch (e) {
          console.warn('[GitHubStars] Auto translation for discovery failed:', e)
        }
      }

      set({
        discoveryRepos: { ...get().discoveryRepos, [ch]: mergedRepos },
        discoveryHasMore: { ...get().discoveryHasMore, [ch]: result.hasMore },
        discoveryNextPage: { ...get().discoveryNextPage, [ch]: result.nextPageIndex },
        discoveryTotalCount: { ...get().discoveryTotalCount, [ch]: result.totalCount },
        discoveryLastRefresh: { ...get().discoveryLastRefresh, [ch]: new Date().toISOString() },
        discoveryIsLoading: { ...get().discoveryIsLoading, [ch]: false },
        discoveryIsLoadingMore: { ...get().discoveryIsLoadingMore, [ch]: false },
        discoveryLoadMoreError: { ...get().discoveryLoadMoreError, [ch]: null },
        // 同步到旧 trendingRepositories 保持兼容
        trendingRepositories: ch === 'trending' ? mergedRepos : get().trendingRepositories,
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (append) {
        set({
          discoveryIsLoadingMore: { ...get().discoveryIsLoadingMore, [ch]: false },
          discoveryLoadMoreError: { ...get().discoveryLoadMoreError, [ch]: errorMsg },
        })
      } else {
        set({
          discoveryIsLoading: { ...get().discoveryIsLoading, [ch]: false },
          error: errorMsg,
        })
      }
    }
  },

  updateDiscoveryRepo: (repo) => {
    const ch = repo.channel || get().discoveryChannel
    const repos = get().discoveryRepos[ch] || []
    set({
      discoveryRepos: {
        ...get().discoveryRepos,
        [ch]: repos.map(r => r.id === repo.id ? repo : r),
      },
    })
  },

  analyzeDiscoveryRepo: async (repoId) => {
    // 在所有频道中找到该 repo
    const allRepos = Object.values(get().discoveryRepos).flat()
    const repo = allRepos.find(r => r.id === repoId)
    if (!repo) return

    // 将 discovery repo 转换为 GithubStarRepository 进行分析
    const targetRepo: GithubStarRepository = { ...repo }
    try {
      const context = await createGithubStarAnalysisContext()
      const analysis = await analyzeGithubStarRepositoryFast(targetRepo, context)

      // 更新 discovery 仓库中的 AI 分析结果
      const ch = repo.channel || get().discoveryChannel
      const repos = get().discoveryRepos[ch] || []
      set({
        discoveryRepos: {
          ...get().discoveryRepos,
          [ch]: repos.map(r => r.id === repoId ? {
            ...r,
            aiSummary: analysis.summary,
            aiTags: analysis.tags,
            aiPlatforms: analysis.platforms,
            analyzedAt: new Date().toISOString(),
            analysisFailed: false,
          } : r),
        },
      })

      // 如果该 repo 也在本地 starred 列表中，同步更新
      const localRepo = get().repositories.find(r => r.id === repoId)
      if (localRepo) {
        await updateGithubStarAnalysis(repoId, analysis)
        const repositories = get().repositories.map(r =>
          r.id === repoId ? {
            ...r,
            aiSummary: analysis.summary,
            aiTags: analysis.tags,
            aiPlatforms: analysis.platforms,
            analyzedAt: new Date().toISOString(),
            analysisFailed: false,
          } : r
        )
        set({
          repositories,
          ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
        })
      }
    } catch (error) {
      console.warn(`[GitHubStars] discovery repo analysis failed, falling back to Edge translation for ${repo.fullName}:`, error)
      try {
        let summary = ''
        if (repo.description) {
          const trans = await translateBatch([repo.description], 'zh-Hans')
          summary = trans[0]?.translatedText || repo.description
        } else {
          summary = `${repo.name} 仓库`
        }

        const ch = repo.channel || get().discoveryChannel
        const repos = get().discoveryRepos[ch] || []
        const fallbackAnalysis = {
          summary: summary.slice(0, 120),
          tags: [repo.language || '未知', ...repo.topics.slice(0, 4)].filter(Boolean),
          platforms: detectPlatforms(targetRepo),
        }

        set({
          discoveryRepos: {
            ...get().discoveryRepos,
            [ch]: repos.map(r => r.id === repoId ? {
              ...r,
              aiSummary: fallbackAnalysis.summary,
              aiTags: fallbackAnalysis.tags,
              aiPlatforms: fallbackAnalysis.platforms,
              analyzedAt: new Date().toISOString(),
              analysisFailed: false,
            } : r),
          },
        })

        // 如果在本地，也同步更新
        const localRepo = get().repositories.find(r => r.id === repoId)
        if (localRepo) {
          await updateGithubStarAnalysis(repoId, fallbackAnalysis)
          const repositories = get().repositories.map(r =>
            r.id === repoId ? {
              ...r,
              aiSummary: fallbackAnalysis.summary,
              aiTags: fallbackAnalysis.tags,
              aiPlatforms: fallbackAnalysis.platforms,
              analyzedAt: new Date().toISOString(),
              analysisFailed: false,
            } : r
          )
          set({
            repositories,
            ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
          })
        }
      } catch (transErr) {
        console.error('[GitHubStars] discovery fallback translation failed:', transErr)
        const ch = repo.channel || get().discoveryChannel
        const repos = get().discoveryRepos[ch] || []
        set({
          discoveryRepos: {
            ...get().discoveryRepos,
            [ch]: repos.map(r => r.id === repoId ? { ...r, analysisFailed: true } : r),
          },
        })
      }
    }
  },

  toggleDiscoveryStar: async (repo) => {
    const localRepo = get().repositories.find(r => r.id === repo.id)
    if (localRepo) {
      // 已在本地收藏列表 → 取消 Star
      try {
        await unstarGithubRepository(repo.fullName)
        await markGithubStarRepositoryUnstarred(repo.id)
        const repositories = await getGithubStarRepositories()
        set({
          repositories,
          ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
        })
        // 更新 discovery 状态
        const ch = repo.channel || get().discoveryChannel
        const repos = get().discoveryRepos[ch] || []
        set({
          discoveryRepos: {
            ...get().discoveryRepos,
            [ch]: repos.map(r => r.id === repo.id ? { ...r, isStarred: false } : r),
          },
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    } else {
      // 不在本地 → Star 该仓库并添加到本地列表
      try {
        await starGithubRepository(repo.fullName)
        // 将 discovery repo 转换为本地仓库格式并保存到数据库
        const newRepo: GithubStarRepository = {
          ...repo,
          isStarred: true,
          starredAt: new Date().toISOString(),
          syncedAt: Date.now(),
        }
        await upsertGithubStarRepositoriesBatch([newRepo], Date.now())
        // 更新本地仓库列表
        const repositories = await getGithubStarRepositories()
        set({
          repositories,
          ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
        })
        // 更新 discovery 状态
        const ch = repo.channel || get().discoveryChannel
        const repos = get().discoveryRepos[ch] || []
        set({
          discoveryRepos: {
            ...get().discoveryRepos,
            [ch]: repos.map(r => r.id === repo.id ? { ...r, isStarred: true } : r),
          },
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    }
  },

  translateDiscoveryRepos: async () => {
    const ch = get().discoveryChannel
    const repos = get().discoveryRepos[ch] || []
    const reposToTranslate = repos.filter(r => r.description && !r.aiSummary)
    if (reposToTranslate.length === 0) return

    try {
      const descriptions = reposToTranslate.map(r => r.description!)
      const translateResults = await translateBatch(descriptions, 'zh-Hans')
      
      const updatedRepos = repos.map(r => {
        const toTranslateIdx = reposToTranslate.findIndex(tr => tr.id === r.id)
        if (toTranslateIdx !== -1) {
          const translated = translateResults[toTranslateIdx]?.translatedText
          if (translated && translated !== r.description) {
            return { ...r, aiSummary: translated }
          }
        }
        return r
      })

      set({
        discoveryRepos: {
          ...get().discoveryRepos,
          [ch]: updatedRepos
        },
        trendingRepositories: ch === 'trending' ? updatedRepos : get().trendingRepositories,
      })
    } catch (e) {
      console.warn('[GitHubStars] Manual batch translation failed:', e)
      throw e
    }
  },

  analyzePending: async (limit = 5) => {
    const candidates = get().filteredRepositories
      .filter(repo => !repo.aiSummary && !repo.analysisFailed)
      .slice(0, limit)

    await get().analyzeRepositories(candidates.map(repo => repo.id))
  },

  aiSearch: async (query) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      const filters = { ...get().filters, query: '' }
      set({
        filters,
        aiSearchInfo: null,
        aiSearchResultIds: null,
        ...getDerivedState(get().repositories, filters, get().customCategories, null),
      })
      return
    }

    set({ isAiSearching: true, error: null })
    try {
      const baseRepositories = filterRepositories(
        get().repositories,
        { ...get().filters, query: '' },
        buildCategoryRules(get().customCategories),
        null,
      )
      const result = await searchGithubStarRepositoriesWithAI(baseRepositories, trimmedQuery)
      const resultIds = result.repositories.map(repo => repo.id)
      const filters = { ...get().filters, query: trimmedQuery }

      set({
        filters,
        aiSearchResultIds: resultIds,
        aiSearchInfo: {
          query: trimmedQuery,
          mode: result.mode,
          count: resultIds.length,
        },
        ...getDerivedState(get().repositories, filters, get().customCategories, resultIds),
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ isAiSearching: false })
    }
  },

  analyzeRepositories: async (repoIds) => {
    const repoIdSet = new Set(repoIds)
    const candidates = get().repositories.filter(repo => repoIdSet.has(repo.id))

    if (candidates.length === 0) return

    let completed = 0
    let failed = 0
    const total = candidates.length

    const patchRepository = (repoId: number, patch: Partial<GithubStarRepository>) => {
      const repositories = get().repositories.map(repo => (
        repo.id === repoId ? { ...repo, ...patch } : repo
      ))
      set({
        repositories,
        ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
      })
    }

    const setReposRunning = (repoIds: number[], active: boolean) => {
      const runningIds = new Set(get().analyzingRepoIds)
      repoIds.forEach((repoId) => {
        if (active) {
          runningIds.add(repoId)
        } else {
          runningIds.delete(repoId)
        }
      })
      const nextRunningIds = Array.from(runningIds)
      set({
        analyzingRepoIds: nextRunningIds,
        analyzingRepoId: nextRunningIds.at(-1) ?? null,
      })
    }

    set({
      isAnalyzing: true,
      analyzingRepoId: null,
      analyzingRepoIds: [],
      analysisProgress: { completed: 0, total, failed: 0, running: 0 },
      error: null,
    })

    const applySuccessfulAnalysis = async (repo: GithubStarRepository, analysis: Awaited<ReturnType<typeof analyzeGithubStarRepositoryFast>>) => {
      await updateGithubStarAnalysis(repo.id, analysis)
      patchRepository(repo.id, {
        aiSummary: analysis.summary,
        aiTags: analysis.tags,
        aiPlatforms: analysis.platforms,
        analyzedAt: new Date().toISOString(),
        analysisFailed: false,
      })
    }

    const applyFailedAnalysis = async (repo: GithubStarRepository) => {
      failed += 1
      await markGithubStarAnalysisFailed(repo.id)
      patchRepository(repo.id, {
        analysisFailed: true,
      })
    }

    const applyFallbackTranslation = async (repo: GithubStarRepository) => {
      try {
        let summary = ''
        if (repo.description) {
          const trans = await translateBatch([repo.description], 'zh-Hans')
          summary = trans[0]?.translatedText || repo.description
        } else {
          summary = `${repo.name} 仓库`
        }
        const analysis = {
          summary: summary.slice(0, 120),
          tags: [repo.language || '未知', ...repo.topics.slice(0, 4)].filter(Boolean),
          platforms: detectPlatforms(repo),
        }
        await updateGithubStarAnalysis(repo.id, analysis)
        patchRepository(repo.id, {
          aiSummary: analysis.summary,
          aiTags: analysis.tags,
          aiPlatforms: analysis.platforms,
          analyzedAt: new Date().toISOString(),
          analysisFailed: false,
        })
      } catch (err) {
        console.warn(`[GitHubStars] Fallback translation failed for ${repo.fullName}:`, err)
        await applyFailedAnalysis(repo)
      }
    }

    // 数量 > 10 时使用自适应并发优化器
    if (candidates.length > 10) {
      const optimizer = createOptimizedAIAnalyzer({
        initialConcurrency: ANALYSIS_BATCH_CONCURRENCY,
        maxConcurrency: 6,
        minConcurrency: 1,
        targetResponseTime: 8000,
        enableAdaptiveConcurrency: true,
      })
      activeOptimizer = optimizer

      try {
        await optimizer.analyzeRepositories(
          candidates,
          (progCompleted, progTotal, currentConcurrency) => {
            set({ analysisProgress: { completed: progCompleted, total: progTotal, failed, running: currentConcurrency } })
          },
          async (result: AnalysisResult) => {
            if (result.success && result.summary) {
              const analysis = { summary: result.summary, tags: result.tags || [], platforms: result.platforms || [] }
              await updateGithubStarAnalysis(result.repo.id, analysis)
              patchRepository(result.repo.id, {
                aiSummary: analysis.summary,
                aiTags: analysis.tags,
                aiPlatforms: analysis.platforms,
                analyzedAt: new Date().toISOString(),
                analysisFailed: false,
              })
            } else {
              // 失败时走自适应 Edge 翻译兜底
              await applyFallbackTranslation(result.repo)
            }
            setReposRunning([result.repo.id], false)
          },
        )
      } catch (error) {
        console.warn('[GitHubStars] adaptive analysis error, falling back to translation:', error)
      } finally {
        activeOptimizer = null
        const repositories = await getGithubStarRepositories()
        set({
          repositories,
          ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
          isAnalyzing: false,
          analyzingRepoId: null,
          analyzingRepoIds: [],
          analysisProgress: null,
        })
      }
      return
    }

    // 数量 <= 10 时沿用原有批量分析逻辑
    const batches: GithubStarRepository[][] = []
    for (let index = 0; index < candidates.length; index += ANALYSIS_BATCH_SIZE) {
      batches.push(candidates.slice(index, index + ANALYSIS_BATCH_SIZE))
    }

    let nextBatchIndex = 0
    let running = 0

    const updateProgress = () => {
      set({
        analysisProgress: { completed, total, failed, running },
      })
    }

    try {
      const context = await createGithubStarAnalysisContext()
      const workerCount = Math.min(ANALYSIS_BATCH_CONCURRENCY, batches.length)

      const runWorker = async () => {
        while (nextBatchIndex < batches.length) {
          const batch = batches[nextBatchIndex]
          nextBatchIndex += 1
          const batchRepoIds = batch.map(repo => repo.id)

          running += batch.length
          setReposRunning(batchRepoIds, true)
          updateProgress()

          try {
            if (batch.length === 1) {
              const repo = batch[0]
              try {
                const analysis = await analyzeGithubStarRepositoryDetailed(repo, context)
                await applySuccessfulAnalysis(repo, analysis)
              } catch (singleErr) {
                console.warn(`[GitHubStars] Detailed analysis failed, translating: ${repo.fullName}`, singleErr)
                await applyFallbackTranslation(repo)
              }
            } else {
              const batchResults = await analyzeGithubStarRepositoriesBatch(batch, context)
              for (const repo of batch) {
                const analysis = batchResults.get(repo.id)
                if (!analysis) {
                  throw new Error(`AI 批量分析未返回 ${repo.fullName}`)
                }
                await applySuccessfulAnalysis(repo, analysis)
              }
            }
          } catch (error) {
            console.warn('[GitHubStars] batch analysis failed, falling back to single repository analysis & translation:', error)
            for (const repo of batch) {
              try {
                const analysis = await analyzeGithubStarRepositoryFast(repo, context)
                await applySuccessfulAnalysis(repo, analysis)
              } catch (singleError) {
                console.warn(`[GitHubStars] analysis failed for ${repo.fullName}, translating:`, singleError)
                await applyFallbackTranslation(repo)
              }
            }
          } finally {
            completed += batch.length
            running -= batch.length
            setReposRunning(batchRepoIds, false)
            updateProgress()
          }
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

      const repositories = await getGithubStarRepositories()
      set({
        repositories,
        ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
      })
    } catch (error) {
      console.warn('[GitHubStars] failed to create AI context, falling back to Edge translation for candidates:', error)
      for (const repo of candidates) {
        setReposRunning([repo.id], true)
        try {
          await applyFallbackTranslation(repo)
        } finally {
          setReposRunning([repo.id], false)
        }
      }
    } finally {
      set({ isAnalyzing: false, analyzingRepoId: null, analyzingRepoIds: [], analysisProgress: null })
    }
  },

  setFilters: (partial) => {
    const filters = { ...get().filters, ...partial }
    const queryChanged = Object.prototype.hasOwnProperty.call(partial, 'query') && partial.query !== get().filters.query
    const aiSearchResultIds = queryChanged ? null : get().aiSearchResultIds
    set({
      filters,
      aiSearchResultIds,
      aiSearchInfo: queryChanged ? null : get().aiSearchInfo,
      ...getDerivedState(get().repositories, filters, get().customCategories, aiSearchResultIds),
    })
  },

  addCategory: async (category) => {
    await addGithubStarCustomCategory(category)
    const customCategories = await getGithubStarCustomCategories()
    set({
      customCategories,
      ...getDerivedState(get().repositories, get().filters, customCategories, get().aiSearchResultIds),
    })
  },

  deleteCategory: async (name: string) => {
    await deleteGithubStarCustomCategory(name)
    const customCategories = await getGithubStarCustomCategories()
    set({
      customCategories,
      ...getDerivedState(get().repositories, get().filters, customCategories, get().aiSearchResultIds),
    })
  },

  updateCategory: async (repoId, category) => {
    await updateGithubStarCategory(repoId, category)
    const repositories = get().repositories.map(repo =>
      repo.id === repoId
        ? { ...repo, customCategory: category, categoryLocked: Boolean(category), lastEdited: new Date().toISOString() }
        : repo,
    )
    set({
      repositories,
      ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
    })
  },

  updateRepositoryDetails: async (repoId, update) => {
    await updateGithubStarRepositoryDetails(repoId, update)
    const repositories = get().repositories.map(repo =>
      repo.id === repoId
        ? {
            ...repo,
            ...(update.customDescription !== undefined ? { customDescription: update.customDescription } : {}),
            ...(update.customTags !== undefined ? { customTags: update.customTags } : {}),
            ...(update.customCategory !== undefined
              ? { customCategory: update.customCategory, categoryLocked: Boolean(update.customCategory) }
              : {}),
            lastEdited: new Date().toISOString(),
          }
        : repo,
    )
    set({
      repositories,
      ...getDerivedState(repositories, get().filters, get().customCategories, get().aiSearchResultIds),
    })
  },

  unstarRepository: async (repoId) => {
    const repository = get().repositories.find(repo => repo.id === repoId)
    if (!repository) return

    try {
      await unstarGithubRepository(repository.fullName)
      await markGithubStarRepositoryUnstarred(repoId)

      const repositories = await getGithubStarRepositories()
      const aiSearchResultIds = get().aiSearchResultIds?.filter(id => id !== repoId) || null
      set({
        repositories,
        aiSearchResultIds,
        ...getDerivedState(repositories, get().filters, get().customCategories, aiSearchResultIds),
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  pauseAnalysis: () => {
    activeOptimizer?.pause()
  },

  resumeAnalysis: () => {
    activeOptimizer?.resume()
  },

  abortAnalysis: () => {
    activeOptimizer?.abort()
    activeOptimizer = null
  },

  setReleaseViewMode: (mode) => {
    set({ releaseViewMode: mode })
    void saveToTauriStore('githubStarsReleaseViewMode', mode)
  },

  toggleReleaseSelectedFilter: (filterId) => {
    const selected = get().releaseSelectedFilters
    const nextSelected = selected.includes(filterId)
      ? selected.filter(id => id !== filterId)
      : [...selected, filterId]
    set({ releaseSelectedFilters: nextSelected })
    void saveToTauriStore('githubStarsReleaseSelectedFilters', nextSelected)
  },

  clearReleaseSelectedFilters: () => {
    set({ releaseSelectedFilters: [] })
    void saveToTauriStore('githubStarsReleaseSelectedFilters', [])
  },

  setReleaseSearchQuery: (query) => {
    set({ releaseSearchQuery: query })
  },

  toggleReleaseExpandedRepository: (repoId) => {
    const expanded = new Set(get().releaseExpandedRepositories)
    if (expanded.has(repoId)) {
      expanded.delete(repoId)
    } else {
      expanded.add(repoId)
    }
    set({ releaseExpandedRepositories: expanded })
  },

  setReleaseIsRefreshing: (isRefreshing) => {
    set({ releaseIsRefreshing: isRefreshing })
  },

  addAssetFilter: (filter) => {
    const nextFilters = [...get().assetFilters, filter]
    set({ assetFilters: nextFilters })
    void saveToTauriStore('githubStarsAssetFilters', nextFilters)
  },

  updateAssetFilter: (filterId, filter) => {
    const nextFilters = get().assetFilters.map(f => f.id === filterId ? filter : f)
    set({ assetFilters: nextFilters })
    void saveToTauriStore('githubStarsAssetFilters', nextFilters)
  },

  deleteAssetFilter: (filterId) => {
    const nextFilters = get().assetFilters.filter(f => f.id !== filterId)
    set({ assetFilters: nextFilters })
    void saveToTauriStore('githubStarsAssetFilters', nextFilters)
  },
}))

async function saveToTauriStore(key: string, value: unknown) {
  try {
    const tauriStore = await Store.load('store.json')
    await tauriStore.set(key, value)
    await tauriStore.save()
  } catch (err) {
    console.warn(`[GitHubStars] failed to save ${key} to store.json:`, err)
  }
}
