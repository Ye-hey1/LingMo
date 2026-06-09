import type { GithubStarRepository } from '@/types/github-stars'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 50

export interface GithubStarAgentListFilters {
  query?: string
  language?: string
  category?: string
  analysis?: 'all' | 'analyzed' | 'pending' | 'failed'
  from?: string
  to?: string
  limit?: number
  categoryResolver?: (repo: GithubStarRepository) => string
}

export interface GithubStarRecentSummaryOptions {
  now?: Date
  rangeDays?: number
  limit?: number
  categoryResolver?: (repo: GithubStarRepository) => string
}

export interface GithubStarAgentRepositoryItem {
  id: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  category: string
  starredAt: string | null
  updatedAt: string | null
  pushedAt: string | null
  aiSummary: string | null
  customDescription: string | null
  customTags: string[]
}

export interface GithubStarRecentSummary {
  rangeDays: number
  from: string
  to: string
  total: number
  repositories: GithubStarAgentRepositoryItem[]
  languages: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  topics: Array<{ name: string; count: number }>
  noteworthy: GithubStarAgentRepositoryItem[]
}

function clampCount(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

function toTime(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function defaultCategoryResolver(repo: GithubStarRepository) {
  return repo.customCategory || '未分类'
}

function resolveCategory(repo: GithubStarRepository, resolver?: (repo: GithubStarRepository) => string) {
  return (resolver?.(repo) || defaultCategoryResolver(repo)).trim() || '未分类'
}

function toRepositoryItem(
  repo: GithubStarRepository,
  categoryResolver?: (repo: GithubStarRepository) => string,
): GithubStarAgentRepositoryItem {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    htmlUrl: repo.htmlUrl,
    stars: repo.stargazersCount,
    forks: repo.forksCount,
    language: repo.language,
    topics: repo.topics,
    category: resolveCategory(repo, categoryResolver),
    starredAt: repo.starredAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    aiSummary: repo.aiSummary,
    customDescription: repo.customDescription,
    customTags: repo.customTags,
  }
}

function countValues(values: string[], limit = 12) {
  const counts = new Map<string, { count: number; firstIndex: number }>()
  values.forEach((value, index) => {
    const name = value.trim()
    if (!name) return
    const current = counts.get(name)
    counts.set(name, current
      ? { ...current, count: current.count + 1 }
      : { count: 1, firstIndex: index })
  })

  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, count: value.count, firstIndex: value.firstIndex }))
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
    .slice(0, limit)
    .map(({ name, count }) => ({ name, count }))
}

function matchesQuery(repo: GithubStarRepository, query: string) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
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

export function isValidGithubFullName(value: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim())
}

export function filterStarredRepositories(
  repositories: GithubStarRepository[],
  filters: GithubStarAgentListFilters = {},
) {
  const fromTime = toTime(filters.from)
  const toFilterTime = toTime(filters.to)
  const limit = clampCount(filters.limit, DEFAULT_LIMIT, 500)
  const categoryFilter = filters.category && filters.category !== 'all' ? normalizeText(filters.category) : ''
  const languageFilter = filters.language && filters.language !== 'all' ? normalizeText(filters.language) : ''
  const analysis = filters.analysis || 'all'

  return repositories
    .filter(repo => repo.isStarred !== false)
    .filter(repo => !filters.query || matchesQuery(repo, filters.query))
    .filter(repo => !languageFilter || normalizeText(repo.language || '') === languageFilter)
    .filter(repo => !categoryFilter || normalizeText(resolveCategory(repo, filters.categoryResolver)) === categoryFilter)
    .filter(repo => {
      if (analysis === 'analyzed') return Boolean(repo.aiSummary)
      if (analysis === 'pending') return !repo.aiSummary && !repo.analysisFailed
      if (analysis === 'failed') return repo.analysisFailed
      return true
    })
    .filter(repo => {
      const starredTime = toTime(repo.starredAt)
      if (fromTime !== null && (starredTime === null || starredTime < fromTime)) return false
      if (toFilterTime !== null && (starredTime === null || starredTime > toFilterTime)) return false
      return true
    })
    .sort((a, b) => (toTime(b.starredAt) || 0) - (toTime(a.starredAt) || 0))
    .slice(0, limit)
}

export function buildRecentStarsSummary(
  repositories: GithubStarRepository[],
  options: GithubStarRecentSummaryOptions = {},
): GithubStarRecentSummary {
  const rangeDays = clampCount(options.rangeDays, 7, 365)
  const limit = clampCount(options.limit, DEFAULT_LIMIT, 200)
  const now = options.now || new Date()
  const to = now.toISOString()
  const from = new Date(now.getTime() - rangeDays * DAY_MS).toISOString()
  const recentRepos = filterStarredRepositories(repositories, {
    from,
    to,
    limit,
    categoryResolver: options.categoryResolver,
  })
  const items = recentRepos.map(repo => toRepositoryItem(repo, options.categoryResolver))

  return {
    rangeDays,
    from,
    to,
    total: items.length,
    repositories: items,
    languages: countValues(items.map(item => item.language || 'Unknown')),
    categories: countValues(items.map(item => item.category)),
    topics: countValues(items.flatMap(item => item.topics)),
    noteworthy: [...items]
      .sort((a, b) => (b.stars + b.forks) - (a.stars + a.forks) || a.fullName.localeCompare(b.fullName))
      .slice(0, 5),
  }
}

export function toGithubStarAgentRepositoryItems(
  repositories: GithubStarRepository[],
  categoryResolver?: (repo: GithubStarRepository) => string,
) {
  return repositories.map(repo => toRepositoryItem(repo, categoryResolver))
}
