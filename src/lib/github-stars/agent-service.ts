import {
  finishGithubStarSync,
  getGithubStarCustomCategories,
  getGithubStarForkRepositories,
  getGithubStarReleases,
  getGithubStarRepositories,
  initGithubStarsDb,
  markGithubStarReleaseRead,
  markGithubStarRepositoryUnstarred,
  updateGithubStarCategory,
  updateGithubStarReleaseSubscription,
  updateGithubStarRepositoryDetails,
  upsertGithubStarForkRepositories,
  upsertGithubStarRepositoriesBatch,
  upsertGithubStarReleases,
} from '@/db/github-stars'
import {
  fetchReleasesForRepositories,
  fetchStarredRepositoriesPage,
  fetchUserForks,
  searchGithubRepositories,
  starGithubRepository,
  unstarGithubRepository,
} from '@/lib/github-stars/api'
import {
  GITHUB_STAR_DEFAULT_CATEGORIES,
  resolveGithubStarCategory,
  type GithubStarCategory,
} from '@/lib/github-stars/categories'
import type {
  GithubStarCustomCategory,
  GithubStarRepository,
  GithubStarRepositoryUpdate,
} from '@/types/github-stars'
import {
  buildRecentStarsSummary,
  filterStarredRepositories,
  isValidGithubFullName,
  toGithubStarAgentRepositoryItems,
  type GithubStarAgentListFilters,
  type GithubStarRecentSummary,
  type GithubStarRecentSummaryOptions,
} from './agent-summary'

const SYNC_PAGE_DELAY_MS = 120
const DEFAULT_RECENT_SUMMARY_SYNC_PAGES = 2

export interface GithubStarRecentSummaryForAgentOptions extends GithubStarRecentSummaryOptions {
  refresh?: boolean
  maxSyncPages?: number
  signal?: AbortSignal
}

export interface GithubStarRecentSummaryForAgentResult extends GithubStarRecentSummary {
  sync: Awaited<ReturnType<typeof syncGithubStarredForAgent>> | null
}

function delay(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

function createCategoryResolver(customCategories: GithubStarCustomCategory[]) {
  const categoryRules: GithubStarCategory[] = [
    ...customCategories.map(category => ({
      id: `custom:${category.name}`,
      name: category.name,
      keywords: category.keywords,
      icon: category.icon,
      custom: true,
    })),
    ...GITHUB_STAR_DEFAULT_CATEGORIES,
  ]

  return (repo: GithubStarRepository) => resolveGithubStarCategory(repo, categoryRules)
}

function assertFullName(fullName: string) {
  const normalized = fullName.trim()
  if (!isValidGithubFullName(normalized)) {
    throw new Error('仓库名称格式无效，请使用 owner/repo，例如 facebook/react')
  }
  return normalized
}

async function loadRepositoriesWithCategories() {
  await initGithubStarsDb()
  const [repositories, customCategories] = await Promise.all([
    getGithubStarRepositories(),
    getGithubStarCustomCategories(),
  ])

  return {
    repositories,
    categoryResolver: createCategoryResolver(customCategories),
  }
}

async function findLocalRepositoryByFullName(fullName: string) {
  await initGithubStarsDb()
  const normalized = fullName.toLowerCase()
  const repositories = await getGithubStarRepositories()
  return repositories.find(repo => repo.fullName.toLowerCase() === normalized) || null
}

export async function syncGithubStarredForAgent(options: { maxPages?: number; signal?: AbortSignal } = {}) {
  await initGithubStarsDb()
  const syncedAt = Date.now()
  const maxPages = Math.max(Number(options.maxPages) || 0, 0)
  let page = 1
  let fetched = 0
  let totalPages: number | null = null

  while (true) {
    if (options.signal?.aborted) {
      throw new Error('GitHub Star 同步已取消')
    }

    const result = await fetchStarredRepositoriesPage(page, { signal: options.signal })
    fetched += result.repositories.length
    totalPages = result.lastPage || totalPages

    await upsertGithubStarRepositoriesBatch(result.repositories, syncedAt)

    const reachedExplicitLimit = maxPages > 0 && page >= maxPages
    const reachedLastPage = result.lastPage ? page >= result.lastPage : !result.hasMore
    if (reachedExplicitLimit || reachedLastPage) break

    page += 1
    await delay(SYNC_PAGE_DELAY_MS)
  }

  const complete = maxPages === 0 || !totalPages || page >= totalPages
  if (complete) {
    await finishGithubStarSync(syncedAt)
  }

  const repositories = await getGithubStarRepositories()
  return {
    fetched,
    pages: page,
    totalPages,
    syncedAt,
    localTotal: repositories.length,
    complete,
  }
}

export async function listGithubStarredForAgent(filters: GithubStarAgentListFilters = {}) {
  const { repositories, categoryResolver } = await loadRepositoriesWithCategories()
  const filtered = filterStarredRepositories(repositories, {
    ...filters,
    categoryResolver,
  })

  return {
    total: filtered.length,
    repositories: toGithubStarAgentRepositoryItems(filtered, categoryResolver),
  }
}

export async function summarizeRecentGithubStarsForAgent(
  options: GithubStarRecentSummaryForAgentOptions = {},
): Promise<GithubStarRecentSummaryForAgentResult> {
  let sync: Awaited<ReturnType<typeof syncGithubStarredForAgent>> | null = null
  if (options.refresh) {
    sync = await syncGithubStarredForAgent({
      maxPages: options.maxSyncPages ?? DEFAULT_RECENT_SUMMARY_SYNC_PAGES,
      signal: options.signal,
    })
  }

  const { repositories, categoryResolver } = await loadRepositoriesWithCategories()
  const summary = buildRecentStarsSummary(repositories, {
    ...options,
    categoryResolver,
  })

  return {
    ...summary,
    sync,
  }
}

export async function searchMyGithubStarsForAgent(
  query: string,
  options: Omit<GithubStarAgentListFilters, 'query'> = {},
) {
  return listGithubStarredForAgent({
    ...options,
    query,
  })
}

export async function listGithubStarReleasesForAgent(options: {
  repoFullName?: string
  unreadOnly?: boolean
  from?: string
  to?: string
  limit?: number
} = {}) {
  await initGithubStarsDb()
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 200)
  const fromTime = options.from ? new Date(options.from).getTime() : null
  const toTime = options.to ? new Date(options.to).getTime() : null
  const repoFilter = options.repoFullName?.trim().toLowerCase()
  const releases = await getGithubStarReleases()

  const filtered = releases
    .filter(release => !repoFilter || release.repository.fullName.toLowerCase() === repoFilter)
    .filter(release => !options.unreadOnly || !release.isRead)
    .filter(release => {
      const publishedTime = new Date(release.publishedAt).getTime()
      if (fromTime !== null && publishedTime < fromTime) return false
      if (toTime !== null && publishedTime > toTime) return false
      return true
    })
    .slice(0, limit)

  return {
    total: filtered.length,
    releases: filtered,
  }
}

export async function refreshGithubStarReleasesForAgent(options: {
  repoFullName?: string
  includePrerelease?: boolean
} = {}) {
  const { repositories } = await loadRepositoriesWithCategories()
  const repoFilter = options.repoFullName?.toLowerCase()
  const selected = repoFilter
    ? repositories.filter(repo => repo.fullName.toLowerCase() === repoFilter)
    : repositories.filter(repo => repo.subscribedToReleases)

  const result = await fetchReleasesForRepositories(selected, {
    includePrerelease: options.includePrerelease,
  })
  await upsertGithubStarReleases(result.releases)

  return {
    repositories: selected.length,
    releases: result.releases.length,
    failedRepositories: result.failedRepositories,
  }
}

export async function listMyGithubForksForAgent(options: { refresh?: boolean } = {}) {
  await initGithubStarsDb()
  if (options.refresh) {
    const forks = await fetchUserForks()
    await upsertGithubStarForkRepositories(forks)
  }

  const forks = await getGithubStarForkRepositories()
  return {
    total: forks.length,
    forks,
  }
}

export async function starGithubRepositoryForAgent(fullName: string) {
  const normalized = assertFullName(fullName)
  await starGithubRepository(normalized)

  const discovered = await searchGithubRepositories(`repo:${normalized}`, {
    perPage: 1,
    sortBy: 'BestMatch',
  })
  const repo = discovered.repos[0]
  if (!repo) {
    return {
      fullName: normalized,
      localUpdated: false,
      message: 'GitHub Star 已添加，但本地未找到仓库详情；下次同步会补齐。',
    }
  }

  const syncedAt = Date.now()
  await upsertGithubStarRepositoriesBatch([{
    ...repo,
    isStarred: true,
    starredAt: new Date().toISOString(),
    syncedAt,
  }], syncedAt)

  return {
    fullName: normalized,
    localUpdated: true,
  }
}

export async function unstarGithubRepositoryForAgent(fullName: string) {
  const normalized = assertFullName(fullName)
  await unstarGithubRepository(normalized)

  const localRepo = await findLocalRepositoryByFullName(normalized)
  if (localRepo) {
    await markGithubStarRepositoryUnstarred(localRepo.id)
  }

  return {
    fullName: normalized,
    localUpdated: Boolean(localRepo),
  }
}

export async function updateGithubStarCategoryForAgent(fullName: string, category: string | null) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')

  const normalizedCategory = category?.trim() || null
  await updateGithubStarCategory(repo.id, normalizedCategory)
  return { fullName: repo.fullName, category: normalizedCategory }
}

export async function updateGithubStarNotesTagsForAgent(fullName: string, update: GithubStarRepositoryUpdate) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')

  await updateGithubStarRepositoryDetails(repo.id, update)
  return { fullName: repo.fullName, update }
}

export async function toggleGithubStarReleaseSubscriptionForAgent(fullName: string, subscribed: boolean) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')

  await updateGithubStarReleaseSubscription(repo.id, subscribed)
  return { fullName: repo.fullName, subscribed }
}

export async function markGithubStarReleaseReadForAgent(releaseId: number) {
  const normalizedReleaseId = Number(releaseId)
  if (!Number.isFinite(normalizedReleaseId)) {
    throw new Error('releaseId 必须是数字')
  }

  await initGithubStarsDb()
  const releases = await getGithubStarReleases()
  const release = releases.find(item => item.id === normalizedReleaseId)
  if (!release) {
    throw new Error(`本地缓存中找不到 release ${normalizedReleaseId}`)
  }

  await markGithubStarReleaseRead(normalizedReleaseId)
  return { releaseId: normalizedReleaseId, isRead: true }
}
