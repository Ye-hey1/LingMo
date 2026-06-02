import { fetch as tauriFetch, Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import type {
  GithubStarDiscoveryChannelId,
  GithubStarDiscoveryPlatform,
  GithubStarDiscoveryRepository,
  GithubStarForkParent,
  GithubStarForkRepository,
  GithubStarForkSource,
  GithubStarPaginatedDiscoveryResult,
  GithubStarProgrammingLanguage,
  GithubStarRelease,
  GithubStarReleaseAsset,
  GithubStarRepository,
  GithubStarSortBy,
  GithubStarSortOrder,
  GithubStarSyncProgress,
  GithubStarTopicCategory,
  GithubStarTrendingRange,
} from '@/types/github-stars'

const GITHUB_API_BASE = 'https://api.github.com'
const PER_PAGE = 100
const REQUEST_TIMEOUT_MS = 18000
const RESPONSE_BODY_TIMEOUT_MS = 10000
const MAX_REQUEST_RETRIES = 2

interface GitHubOwnerResponse {
  login: string
  avatar_url?: string | null
}

interface GitHubRepositoryResponse {
  id: number
  name: string
  full_name: string
  description?: string | null
  html_url: string
  stargazers_count?: number
  forks_count?: number
  forks?: number
  fork?: boolean
  language?: string | null
  created_at?: string | null
  updated_at?: string | null
  pushed_at?: string | null
  owner: GitHubOwnerResponse
  topics?: string[]
}

interface GitHubReleaseAssetResponse {
  id: number
  name: string
  size?: number
  download_count?: number
  browser_download_url: string
  content_type?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface GitHubReleaseResponse {
  id: number
  tag_name: string
  name?: string | null
  body?: string | null
  published_at?: string | null
  html_url: string
  assets?: GitHubReleaseAssetResponse[]
  zipball_url?: string | null
  tarball_url?: string | null
  prerelease?: boolean
}

interface GitHubForkRepositoryResponse extends GitHubRepositoryResponse {
  fork?: boolean
  default_branch?: string | null
  source?: GitHubRepositoryResponse
  parent?: GitHubRepositoryResponse
}

interface GitHubSearchRepositoryResponse {
  items?: GitHubRepositoryResponse[]
  total_count?: number
}

interface GitHubRepositoryDetailsResponse {
  default_branch?: string | null
}

interface GitHubStarredResponse {
  starred_at?: string
  repo?: GitHubRepositoryResponse
}

interface GitHubReadmeResponse {
  content: string
  encoding: string
}

interface GitHubTreeItemResponse {
  path: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItemResponse[]
  truncated?: boolean
}

export interface GithubRepositoryDocumentPath {
  path: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
  kind: 'readme' | 'docs' | 'config' | 'example' | 'source' | 'other'
}

export interface GithubRepositoryDocumentOutline {
  defaultBranch: string | null
  truncated: boolean
  paths: GithubRepositoryDocumentPath[]
}

interface GithubRequestOptions {
  accept?: string
  requireToken?: boolean
  method?: 'GET' | 'DELETE' | 'PUT' | 'POST'
  body?: string
}

async function getGitHubToken() {
  const store = await Store.load('store.json')
  const syncToken = await store.get<string>('accessToken')
  const starToken = await store.get<string>('githubStarsAccessToken')
  const projectToken = await store.get<string>('githubProjectApiToken')
  return (syncToken || starToken || projectToken || '').trim()
}

async function getProxyConfig(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

function buildHeaders(token: string, accept?: string) {
  const headers = new Headers()
  if (token) {
    headers.append('Authorization', `Bearer ${token}`)
  }
  headers.append('Accept', accept || 'application/vnd.github+json')
  headers.append('X-GitHub-Api-Version', '2022-11-28')
  headers.append('If-None-Match', '')
  return headers
}

function delay(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

async function requestGitHub<T>(endpoint: string, options: GithubRequestOptions = {}): Promise<T> {
  const result = await requestGitHubDetailed<T>(endpoint, options)
  return result.data
}

function safeGetHeader(headers: Headers | null | undefined, name: string): string | null {
  if (!headers || typeof headers.get !== 'function') return null
  try {
    return headers.get(name)
  } catch {
    return null
  }
}

function isJsonParseError(error: unknown) {
  if (error instanceof SyntaxError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /json|unterminated string|unexpected end/i.test(message)
}

function isRetryableGitHubError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return isJsonParseError(error) ||
    /timeout|超时|network|fetch|connection|socket|econnreset|econnrefused|request canceled|响应读取/i.test(message)
}

async function requestGitHubDetailed<T>(endpoint: string, options: GithubRequestOptions = {}) {
  const token = await getGitHubToken()
  if (options.requireToken && !token) {
    throw new Error('请先在同步设置中配置 GitHub Token')
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
    try {
      return await requestGitHubDetailedOnce<T>(endpoint, options, token)
    } catch (error) {
      lastError = error
      if (!isRetryableGitHubError(error) || attempt === MAX_REQUEST_RETRIES) {
        if (isJsonParseError(error)) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`GitHub API JSON 响应解析失败，可能是代理或网络中断导致响应被截断：${message}`)
        }
        throw error
      }

      console.warn(`[GitHubStars] GitHub request retry ${attempt + 1}/${MAX_REQUEST_RETRIES}: ${endpoint}`, error)
      await delay(350 * (attempt + 1))
    }
  }

  throw lastError
}

async function requestGitHubDetailedOnce<T>(endpoint: string, options: GithubRequestOptions, token: string) {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
  let bodyTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null

  try {
    const proxyConfig = await getProxyConfig()
    const request = tauriFetch(`${GITHUB_API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: buildHeaders(token, options.accept),
      body: options.body,
      proxy: proxyConfig,
      connectTimeout: 8000,
      signal: controller.signal,
    })
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller.abort()
        reject(new Error('GitHub API 请求超时，请检查网络或代理设置'))
      }, REQUEST_TIMEOUT_MS)
    })
    const response = await Promise.race([request, timeout])

    if (!response.ok) {
      const bodyTimeout = new Promise<never>((_, reject) => {
        bodyTimeoutId = globalThis.setTimeout(() => {
          reject(new Error('GitHub API 响应读取超时'))
        }, RESPONSE_BODY_TIMEOUT_MS)
      })
      const text = await Promise.race([response.text(), bodyTimeout])

      if (response.status === 401) {
        throw new Error('GitHub Token 无效或已过期，请检查同步设置中的 Token 配置')
      }
      if (response.status === 403) {
        const remaining = safeGetHeader(response.headers, 'x-ratelimit-remaining')
        const reset = safeGetHeader(response.headers, 'x-ratelimit-reset')
        if (remaining === '0' && reset) {
          const resetTime = new Date(Number(reset) * 1000).toLocaleString()
          throw new Error(`GitHub API 请求已达限额，请在 ${resetTime} 后重试`)
        }
      }
      throw new Error(`GitHub API 请求失败：${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 300)}` : ''}`)
    }

    if (response.status === 204) {
      return {
        data: null as T,
        headers: response.headers,
      }
    }

    const bodyTimeout = new Promise<never>((_, reject) => {
      bodyTimeoutId = globalThis.setTimeout(() => {
        reject(new Error('GitHub API 响应读取超时'))
      }, RESPONSE_BODY_TIMEOUT_MS)
    })
    const data = await Promise.race([response.json(), bodyTimeout])

    return {
      data: data as T,
      headers: response.headers,
    }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.message.includes('Request canceled'))) {
      throw new Error('GitHub API 请求超时，请检查网络连接和代理设置是否正确')
    }
    throw error
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId)
    }
    if (bodyTimeoutId) {
      globalThis.clearTimeout(bodyTimeoutId)
    }
  }
}

function parseLastPage(linkHeader: string | null) {
  if (!linkHeader) return null
  const lastLink = linkHeader
    .split(',')
    .map(part => part.trim())
    .find(part => part.includes('rel="last"'))
  if (!lastLink) return null

  const match = lastLink.match(/[?&]page=(\d+)/)
  return match ? Number(match[1]) : null
}

function toRepository(item: GitHubRepositoryResponse, starredAt?: string, isStarred = true): GithubStarRepository {
  return {
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    description: item.description ?? null,
    htmlUrl: item.html_url,
    stargazersCount: item.stargazers_count ?? 0,
    forksCount: item.forks_count ?? item.forks ?? 0,
    language: item.language ?? null,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
    pushedAt: item.pushed_at ?? null,
    starredAt: starredAt ?? null,
    ownerLogin: item.owner.login,
    ownerAvatarUrl: item.owner.avatar_url ?? null,
    topics: Array.isArray(item.topics) ? item.topics : [],
    isFork: item.fork === true,
    aiSummary: null,
    aiTags: [],
    aiPlatforms: [],
    analyzedAt: null,
    analysisFailed: false,
    customDescription: null,
    customTags: [],
    customCategory: null,
    categoryLocked: false,
    lastEdited: null,
    subscribedToReleases: false,
    lastReleaseFetchTime: null,
    hasFetchedReleases: false,
    syncedAt: Date.now(),
    isStarred,
  }
}

function toReleaseAsset(item: GitHubReleaseAssetResponse): GithubStarReleaseAsset {
  return {
    id: item.id,
    name: item.name,
    size: item.size ?? 0,
    downloadCount: item.download_count ?? 0,
    browserDownloadUrl: item.browser_download_url,
    contentType: item.content_type ?? null,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
  }
}

function toRelease(repo: GithubStarRepository, item: GitHubReleaseResponse, fetchedAt = Date.now()): GithubStarRelease {
  return {
    id: item.id,
    tagName: item.tag_name,
    name: item.name ?? item.tag_name,
    body: item.body ?? '',
    publishedAt: item.published_at ?? new Date().toISOString(),
    htmlUrl: item.html_url,
    assets: (item.assets || []).map(toReleaseAsset),
    zipballUrl: item.zipball_url ?? null,
    tarballUrl: item.tarball_url ?? null,
    prerelease: Boolean(item.prerelease),
    repository: {
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
    },
    isRead: false,
    fetchedAt,
  }
}

function parseStarredItem(item: GitHubStarredResponse | GitHubRepositoryResponse) {
  if ('repo' in item && item.repo) {
    return toRepository(item.repo, item.starred_at)
  }
  return toRepository(item as GitHubRepositoryResponse)
}

function toForkSource(item: GitHubRepositoryResponse | undefined): GithubStarForkSource | null {
  if (!item) return null

  return {
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    description: item.description ?? null,
    htmlUrl: item.html_url,
    stargazersCount: item.stargazers_count ?? 0,
    forksCount: item.forks_count ?? item.forks ?? 0,
    updatedAt: item.updated_at ?? null,
    ownerLogin: item.owner.login,
    ownerAvatarUrl: item.owner.avatar_url ?? null,
  }
}

function toForkParent(item: GitHubRepositoryResponse | undefined): GithubStarForkParent | null {
  if (!item) return null

  return {
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    htmlUrl: item.html_url,
  }
}

function toForkRepository(item: GitHubForkRepositoryResponse, syncedAt = Date.now()): GithubStarForkRepository {
  return {
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    description: item.description ?? null,
    htmlUrl: item.html_url,
    stargazersCount: item.stargazers_count ?? 0,
    forksCount: item.forks_count ?? item.forks ?? 0,
    language: item.language ?? null,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
    pushedAt: item.pushed_at ?? null,
    defaultBranch: item.default_branch || 'main',
    ownerLogin: item.owner.login,
    ownerAvatarUrl: item.owner.avatar_url ?? null,
    source: toForkSource(item.source),
    parent: toForkParent(item.parent),
    syncedAt,
  }
}

function toDiscoveryRepository(
  item: GitHubRepositoryResponse,
  rank: number,
  trendingRange: GithubStarTrendingRange,
  channel: GithubStarDiscoveryChannelId = 'trending',
  platform: GithubStarDiscoveryPlatform = 'All',
): GithubStarDiscoveryRepository {
  return {
    ...toRepository(item, undefined, false),
    rank,
    trendingRange,
    channel,
    platform,
  }
}

async function requestUrlText(url: string) {
  const response = await tauriFetch(url, {
    method: 'GET',
    headers: new Headers({
      Accept: 'application/rss+xml, application/xml, text/xml',
    }),
    proxy: await getProxyConfig(),
    connectTimeout: 8000,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`)
  }

  return text
}

function decodeXmlText(value: string) {
  if (typeof document === 'undefined') return value.replace(/\s+/g, ' ').trim()

  const element = document.createElement('div')
  element.innerHTML = value
  return (element.textContent || element.innerText || value).replace(/\s+/g, ' ').trim()
}

function parseTrendingRss(text: string, range: GithubStarTrendingRange) {
  if (typeof DOMParser === 'undefined') return []

  const xml = new DOMParser().parseFromString(text, 'text/xml')
  const items = Array.from(xml.querySelectorAll('item'))

  return items.map((item, index) => {
    const title = item.querySelector('title')?.textContent || ''
    const link = item.querySelector('link')?.textContent || ''
    const description = decodeXmlText(item.querySelector('description')?.textContent || '')
    const match = link.match(/github\.com\/([^/]+)\/([^/?#]+)/)
    const owner = match?.[1] || ''
    const repoName = match?.[2] || title
    const starsMatch = description.match(/⭐\s*([\d,]+)/)
    const forksMatch = description.match(/🍴\s*([\d,]+)/)

    return {
      id: index + 1,
      name: repoName,
      fullName: `${owner}/${repoName}`,
      description: description || null,
      htmlUrl: link,
      stargazersCount: starsMatch ? Number(starsMatch[1].replace(/,/g, '')) : 0,
      forksCount: forksMatch ? Number(forksMatch[1].replace(/,/g, '')) : 0,
      language: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pushedAt: new Date().toISOString(),
      starredAt: null,
      ownerLogin: owner,
      ownerAvatarUrl: owner ? `https://github.com/${owner}.png` : null,
      topics: [],
      aiSummary: null,
      aiTags: [],
      aiPlatforms: [],
      analyzedAt: null,
      analysisFailed: false,
      customDescription: null,
      customTags: [],
      customCategory: null,
      categoryLocked: false,
      lastEdited: null,
      subscribedToReleases: false,
      lastReleaseFetchTime: null,
      hasFetchedReleases: false,
      syncedAt: Date.now(),
      isStarred: false,
      isFork: false,
      rank: index + 1,
      trendingRange: range,
      channel: 'trending' as GithubStarDiscoveryChannelId,
      platform: 'All' as GithubStarDiscoveryPlatform,
    } satisfies GithubStarDiscoveryRepository
  })
}

function getDocumentPathKind(path: string): GithubRepositoryDocumentPath['kind'] {
  const lowerPath = path.toLowerCase()
  const fileName = lowerPath.split('/').pop() || lowerPath

  if (/^readme(\.[a-z0-9]+)?$/.test(fileName)) return 'readme'
  if (lowerPath.startsWith('docs/') || lowerPath.includes('/docs/')) return 'docs'
  if (lowerPath.startsWith('examples/') || lowerPath.includes('/examples/')) return 'example'
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements\.txt|composer\.json|gemfile|pom\.xml|build\.gradle|deno\.json)$/.test(fileName)) return 'config'
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|vue|svelte|astro)$/.test(fileName)) return 'source'
  return 'other'
}

function isUsefulDocumentPath(path: string, type: GitHubTreeItemResponse['type']) {
  if (type !== 'blob') return false

  const lowerPath = path.toLowerCase()
  const fileName = lowerPath.split('/').pop() || lowerPath

  if (/^readme(\.[a-z0-9]+)?$/.test(fileName)) return true
  if (/^(contributing|changelog|license|security|code_of_conduct|architecture|design|roadmap|tutorial|quickstart|get-started|getting-started)\.(md|mdx|rst|txt|adoc)$/i.test(fileName)) return true
  if (lowerPath.startsWith('docs/') || lowerPath.includes('/docs/')) return /\.(md|mdx|rst|txt|adoc|json|ya?ml)$/i.test(fileName)
  if (lowerPath.startsWith('examples/') || lowerPath.includes('/examples/')) return /\.(md|mdx|rst|txt|adoc|json|ya?ml)$/i.test(fileName)
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements\.txt|composer\.json|gemfile|pom\.xml|build\.gradle|deno\.json)$/.test(fileName)) return true

  return false
}

export async function fetchAllStarredRepositories(
  onProgress?: (progress: GithubStarSyncProgress) => void,
) {
  const repositories: GithubStarRepository[] = []
  let page = 1

  while (true) {
    const batch = await requestGitHub<Array<GitHubStarredResponse | GitHubRepositoryResponse>>(
      `/user/starred?sort=created&direction=desc&per_page=${PER_PAGE}&page=${page}`,
      {
        accept: 'application/vnd.github.star+json',
        requireToken: true,
      },
    )

    repositories.push(...batch.map(parseStarredItem))
    onProgress?.({ fetched: repositories.length, page })

    if (batch.length < PER_PAGE) break
    page += 1
    await new Promise(resolve => window.setTimeout(resolve, 120))
  }

  return repositories
}

export async function fetchStarredRepositoriesPage(page = 1) {
  const result = await requestGitHubDetailed<Array<GitHubStarredResponse | GitHubRepositoryResponse>>(
    `/user/starred?sort=created&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    {
      accept: 'application/vnd.github.star+json',
      requireToken: true,
    },
  )
  const batch = Array.isArray(result.data) ? result.data : []
  const lastPage = parseLastPage(safeGetHeader(result.headers, 'link'))

  return {
    repositories: batch.map(parseStarredItem),
    hasMore: batch.length === PER_PAGE,
    nextPage: page + 1,
    lastPage,
  }
}

export async function fetchRepositoryReleases(
  repo: GithubStarRepository,
  options: { includePrerelease?: boolean; perPage?: number } = {},
) {
  const [owner, name] = repo.fullName.split('/')
  if (!owner || !name) return []

  const releases = await requestGitHub<GitHubReleaseResponse[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases?per_page=${options.perPage || 20}`,
  )

  return releases
    .filter(release => options.includePrerelease || !release.prerelease)
    .map(release => toRelease(repo, release))
}

export async function fetchReleasesForRepositories(
  repositories: GithubStarRepository[],
  options: {
    includePrerelease?: boolean
    onRepositoryComplete?: (repo: GithubStarRepository, releases: GithubStarRelease[]) => void
  } = {},
) {
  const releases: GithubStarRelease[] = []
  const failedRepositories: Array<{ repo: GithubStarRepository; error: string }> = []
  const concurrency = Math.min(3, repositories.length)
  let nextIndex = 0

  const runWorker = async () => {
    while (nextIndex < repositories.length) {
      const repo = repositories[nextIndex]
      nextIndex += 1

      try {
        const repoReleases = await fetchRepositoryReleases(repo, {
          includePrerelease: options.includePrerelease,
          perPage: repo.hasFetchedReleases ? 10 : 30,
        })
        releases.push(...repoReleases)
        options.onRepositoryComplete?.(repo, repoReleases)
      } catch (error) {
        failedRepositories.push({
          repo,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await new Promise(resolve => window.setTimeout(resolve, 120))
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))

  return {
    releases: releases.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
    failedRepositories,
  }
}

export async function fetchUserForks() {
  const forks: GithubStarForkRepository[] = []
  const syncedAt = Date.now()
  let page = 1

  while (true) {
    const batch = await requestGitHub<GitHubForkRepositoryResponse[]>(
      `/user/repos?type=forks&sort=updated&per_page=${PER_PAGE}&page=${page}`,
      { requireToken: true },
    )

    forks.push(...batch.filter(repo => repo.fork !== false).map(repo => toForkRepository(repo, syncedAt)))

    if (batch.length < PER_PAGE) break
    page += 1
    await new Promise(resolve => window.setTimeout(resolve, 120))
  }

  return forks
}

export async function fetchTrendingRepositories(
  range: GithubStarTrendingRange = 'weekly',
  platform: GithubStarDiscoveryPlatform = 'All',
  page: number = 1,
  perPage: number = 20,
): Promise<GithubStarPaginatedDiscoveryResult> {
  const rssUrl = `https://mshibanami.github.io/GitHubTrendingRSS/${range}/all.xml`
  const rssText = await requestUrlText(rssUrl)
  const allRssRepos = parseTrendingRss(rssText, range)

  const startIndex = (page - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, allRssRepos.length)
  const pageRepos = allRssRepos.slice(startIndex, endIndex)
  const enrichedRepositories: GithubStarDiscoveryRepository[] = []

  for (const repo of pageRepos) {
    const [owner, name] = repo.fullName.split('/')
    if (!owner || !name) {
      enrichedRepositories.push(repo)
      continue
    }

    try {
      const details = await requestGitHub<GitHubRepositoryResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      )
      enrichedRepositories.push(toDiscoveryRepository(details, repo.rank, range, 'trending', platform))
    } catch {
      enrichedRepositories.push(repo)
    }
    await new Promise(resolve => window.setTimeout(resolve, 80))
  }

  return {
    repos: enrichedRepositories,
    hasMore: endIndex < allRssRepos.length,
    nextPageIndex: page + 1,
    totalCount: allRssRepos.length,
  }
}

// ─── 平台/语言/排序辅助 ───

function buildPlatformQuery(platform: GithubStarDiscoveryPlatform): string {
  switch (platform) {
    case 'Android': return 'android'
    case 'Macos': return 'macos OR mac OR osx'
    case 'Windows': return 'windows'
    case 'Linux': return 'linux'
    default: return ''
  }
}

function buildLanguageQuery(language: GithubStarProgrammingLanguage): string {
  if (language === 'All') return ''
  const languageMap: Record<GithubStarProgrammingLanguage, string> = {
    All: '', Kotlin: 'Kotlin', Java: 'Java', JavaScript: 'JavaScript',
    TypeScript: 'TypeScript', Python: 'Python', Swift: 'Swift', Rust: 'Rust',
    Go: 'Go', CSharp: 'C#', CPlusPlus: 'C++', C: 'C', Dart: 'Dart', Ruby: 'Ruby', PHP: 'PHP',
  }
  return `language:${languageMap[language]}`
}

function buildSortParams(sortBy: GithubStarSortBy, sortOrder: GithubStarSortOrder) {
  const sortMap: Record<GithubStarSortBy, string> = {
    BestMatch: 'best-match', MostStars: 'stars', MostForks: 'forks',
  }
  const orderMap: Record<GithubStarSortOrder, string> = {
    Descending: 'desc', Ascending: 'asc',
  }
  return { sort: sortMap[sortBy], order: orderMap[sortOrder] }
}

const TOPIC_KEYWORDS: Record<GithubStarTopicCategory, string> = {
  ai: 'artificial-intelligence machine-learning ai',
  ml: 'machine-learning deep-learning neural-network',
  database: 'database sql nosql mongodb postgresql mysql',
  web: 'web frontend backend react vue angular',
  mobile: 'mobile android ios flutter react-native',
  devtools: 'devtools ide editor tools',
  security: 'security cybersecurity encryption',
  game: 'game game-engine unity unreal',
}

/** 热门发布 —— 14天内更新过的仓库，按更新时间降序 */
export async function fetchHotReleaseRepositories(
  platform: GithubStarDiscoveryPlatform = 'All',
  page: number = 1,
  perPage: number = 20,
): Promise<GithubStarPaginatedDiscoveryResult> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const platformQuery = buildPlatformQuery(platform)
  let query = `stars:>10 archived:false pushed:>=${fourteenDaysAgo}`
  if (platformQuery) query += ` ${platformQuery}`

  const data = await requestGitHub<GitHubSearchRepositoryResponse>(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perPage}&page=${page}`,
  )

  const repos = (data.items || []).map((repo, index) =>
    toDiscoveryRepository(repo, (page - 1) * perPage + index + 1, 'weekly', 'hot-release', platform),
  )

  return {
    repos,
    hasMore: repos.length === perPage,
    nextPageIndex: page + 1,
    totalCount: data.total_count ?? 0,
  }
}

/** 最受欢迎 —— 6个月前创建、近一年活跃、Star>1000 */
export async function fetchMostPopularRepositories(
  platform: GithubStarDiscoveryPlatform = 'All',
  page: number = 1,
  perPage: number = 20,
): Promise<GithubStarPaginatedDiscoveryResult> {
  const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const platformQuery = buildPlatformQuery(platform)
  let query = `stars:>1000 archived:false created:<${sixMonthsAgo} pushed:>=${oneYearAgo}`
  if (platformQuery) query += ` ${platformQuery}`

  const data = await requestGitHub<GitHubSearchRepositoryResponse>(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`,
  )

  const repos = (data.items || []).map((repo, index) =>
    toDiscoveryRepository(repo, (page - 1) * perPage + index + 1, 'weekly', 'most-popular', platform),
  )

  return {
    repos,
    hasMore: repos.length === perPage,
    nextPageIndex: page + 1,
    totalCount: data.total_count ?? 0,
  }
}

/** 主题频道 */
export async function fetchTopicRepositories(
  topic: GithubStarTopicCategory,
  platform: GithubStarDiscoveryPlatform = 'All',
  page: number = 1,
  perPage: number = 20,
): Promise<GithubStarPaginatedDiscoveryResult> {
  const keywords = TOPIC_KEYWORDS[topic]
  const platformQuery = buildPlatformQuery(platform)
  let query = `${keywords} in:name,description,topics stars:>10 archived:false`
  if (platformQuery) query += ` ${platformQuery}`

  const data = await requestGitHub<GitHubSearchRepositoryResponse>(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`,
  )

  const repos = (data.items || []).map((repo, index) =>
    toDiscoveryRepository(repo, (page - 1) * perPage + index + 1, 'weekly', 'topic', platform),
  )

  return {
    repos,
    hasMore: repos.length === perPage,
    nextPageIndex: page + 1,
    totalCount: data.total_count ?? 0,
  }
}

/** 高级搜索 */
export async function searchGithubRepositories(
  query: string,
  options: {
    page?: number
    perPage?: number
    platform?: GithubStarDiscoveryPlatform
    language?: GithubStarProgrammingLanguage
    sortBy?: GithubStarSortBy
    sortOrder?: GithubStarSortOrder
  } = {},
): Promise<GithubStarPaginatedDiscoveryResult> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return { repos: [], hasMore: false, nextPageIndex: 1, totalCount: 0 }

  const page = options.page || 1
  const perPage = options.perPage || 20
  const platform = options.platform || 'All'
  const language = options.language || 'All'
  const sortBy = options.sortBy || 'BestMatch'
  const sortOrder = options.sortOrder || 'Descending'

  const platformQuery = buildPlatformQuery(platform)
  const languageQuery = buildLanguageQuery(language)
  const { sort, order } = buildSortParams(sortBy, sortOrder)

  let searchQuery = `${trimmedQuery} archived:false`
  if (platformQuery) searchQuery += ` ${platformQuery}`
  if (languageQuery) searchQuery += ` ${languageQuery}`

  let url = `/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${perPage}&page=${page}`
  if (sort && sort !== 'best-match') {
    url += `&sort=${sort}&order=${order}`
  }

  const data = await requestGitHub<GitHubSearchRepositoryResponse>(url)

  const repos = (data.items || []).map((repo, index) =>
    toDiscoveryRepository(repo, (page - 1) * perPage + index + 1, 'weekly', 'search', platform),
  )

  return {
    repos,
    hasMore: repos.length === perPage,
    nextPageIndex: page + 1,
    totalCount: data.total_count ?? 0,
  }
}

export async function fetchRepositoryReadme(fullName: string) {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) return ''

  try {
    const readme = await requestGitHub<GitHubReadmeResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    )

    if (readme.encoding !== 'base64') {
      return readme.content || ''
    }

    const binary = atob(readme.content.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder('utf-8').decode(bytes)
  } catch (error) {
    console.warn(`[GitHubStars] README fetch failed for ${fullName}:`, error)
    return ''
  }
}

export async function fetchRepositoryDocumentOutline(fullName: string): Promise<GithubRepositoryDocumentOutline> {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) {
    return { defaultBranch: null, truncated: false, paths: [] }
  }

  try {
    const details = await requestGitHub<GitHubRepositoryDetailsResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    )
    const defaultBranch = details.default_branch || 'main'
    const tree = await requestGitHub<GitHubTreeResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
    )
    const paths = (tree.tree || [])
      .filter(item => isUsefulDocumentPath(item.path, item.type))
      .slice(0, 120)
      .map(item => ({
        path: item.path,
        type: item.type,
        size: item.size,
        kind: getDocumentPathKind(item.path),
      }))

    return {
      defaultBranch,
      truncated: Boolean(tree.truncated),
      paths,
    }
  } catch (error) {
    console.warn(`[GitHubStars] document outline fetch failed for ${fullName}:`, error)
    return { defaultBranch: null, truncated: false, paths: [] }
  }
}

export async function unstarGithubRepository(fullName: string) {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) {
    throw new Error('仓库名称格式无效，无法取消 Star')
  }

  await requestGitHub<void>(
    `/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: 'DELETE',
      requireToken: true,
    },
  )
}

export async function starGithubRepository(fullName: string) {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) {
    throw new Error('仓库名称格式无效，无法添加 Star')
  }

  await requestGitHub<void>(
    `/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: 'PUT',
      requireToken: true,
    },
  )
}
