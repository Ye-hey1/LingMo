export interface GithubStarRepository {
  id: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  stargazersCount: number
  forksCount: number
  language: string | null
  createdAt: string | null
  updatedAt: string | null
  pushedAt: string | null
  starredAt: string | null
  ownerLogin: string
  ownerAvatarUrl: string | null
  topics: string[]
  /** 是否为 fork 仓库 */
  isFork: boolean
  aiSummary: string | null
  aiTags: string[]
  aiPlatforms: string[]
  analyzedAt: string | null
  analysisFailed: boolean
  customDescription: string | null
  customTags: string[]
  customCategory: string | null
  categoryLocked: boolean
  lastEdited: string | null
  subscribedToReleases: boolean
  lastReleaseFetchTime: string | null
  hasFetchedReleases: boolean
  syncedAt: number
  isStarred: boolean
}

export interface GithubStarReleaseAsset {
  id: number
  name: string
  size: number
  downloadCount: number
  browserDownloadUrl: string
  contentType: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface GithubStarRelease {
  id: number
  tagName: string
  name: string | null
  body: string | null
  publishedAt: string
  htmlUrl: string
  assets: GithubStarReleaseAsset[]
  zipballUrl: string | null
  tarballUrl: string | null
  prerelease: boolean
  repository: {
    id: number
    fullName: string
    name: string
  }
  isRead: boolean
  fetchedAt: number
}

export interface GithubStarForkSource {
  id: number
  fullName: string
  name: string
  description: string | null
  htmlUrl: string
  stargazersCount: number
  forksCount: number
  updatedAt: string | null
  ownerLogin: string
  ownerAvatarUrl: string | null
}

export interface GithubStarForkParent {
  id: number
  fullName: string
  name: string
  htmlUrl: string
}

export interface GithubStarForkRepository {
  id: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  stargazersCount: number
  forksCount: number
  language: string | null
  createdAt: string | null
  updatedAt: string | null
  pushedAt: string | null
  defaultBranch: string
  ownerLogin: string
  ownerAvatarUrl: string | null
  source: GithubStarForkSource | null
  parent: GithubStarForkParent | null
  syncedAt: number
}

export type GithubStarTrendingRange = 'daily' | 'weekly' | 'monthly'

// ─── Discovery 频道类型 ───

export type GithubStarDiscoveryChannelId =
  | 'trending'
  | 'hot-release'
  | 'most-popular'
  | 'topic'
  | 'search'

export type GithubStarDiscoveryChannelIcon =
  | 'trending'
  | 'rocket'
  | 'star'
  | 'tag'
  | 'search'

export interface GithubStarDiscoveryChannel {
  id: GithubStarDiscoveryChannelId
  name: string
  nameEn: string
  icon: GithubStarDiscoveryChannelIcon
  enabled: boolean
}

export type GithubStarDiscoveryPlatform = 'All' | 'Android' | 'Macos' | 'Windows' | 'Linux'

export type GithubStarProgrammingLanguage =
  | 'All'
  | 'JavaScript'
  | 'TypeScript'
  | 'Python'
  | 'Java'
  | 'Kotlin'
  | 'Go'
  | 'Rust'
  | 'CSharp'
  | 'CPlusPlus'
  | 'C'
  | 'Swift'
  | 'Dart'
  | 'Ruby'
  | 'PHP'

export type GithubStarSortBy = 'BestMatch' | 'MostStars' | 'MostForks'

export type GithubStarSortOrder = 'Descending' | 'Ascending'

export type GithubStarTopicCategory =
  | 'ai'
  | 'ml'
  | 'database'
  | 'web'
  | 'mobile'
  | 'devtools'
  | 'security'
  | 'game'

export interface GithubStarDiscoveryRepository extends GithubStarRepository {
  rank: number
  trendingRange: GithubStarTrendingRange
  /** 所属发现频道 */
  channel: GithubStarDiscoveryChannelId
  /** 筛选平台 */
  platform: GithubStarDiscoveryPlatform
}

export interface GithubStarPaginatedDiscoveryResult {
  repos: GithubStarDiscoveryRepository[]
  hasMore: boolean
  nextPageIndex: number
  totalCount: number
}

export const DEFAULT_DISCOVERY_CHANNELS: GithubStarDiscoveryChannel[] = [
  { id: 'trending', name: '趋势', nameEn: 'Trending', icon: 'trending', enabled: true },
  { id: 'hot-release', name: '热门发布', nameEn: 'Hot Releases', icon: 'rocket', enabled: true },
  { id: 'most-popular', name: '最受欢迎', nameEn: 'Most Popular', icon: 'star', enabled: true },
  { id: 'topic', name: '主题', nameEn: 'Topics', icon: 'tag', enabled: true },
  { id: 'search', name: '搜索', nameEn: 'Search', icon: 'search', enabled: true },
]

export interface GithubStarAnalysisResult {
  summary: string
  tags: string[]
  platforms: string[]
}

export interface GithubStarCustomCategory {
  name: string
  keywords: string[]
  icon: string | null
  createdAt: string
}

export interface GithubStarRepositoryUpdate {
  customDescription?: string | null
  customTags?: string[]
  customCategory?: string | null
}

export interface GithubStarSyncProgress {
  fetched: number
  page: number
  totalPages?: number
  running?: number
}

export interface GithubStarAnalysisProgress {
  completed: number
  total: number
  failed: number
  running: number
}

export interface GithubStarStats {
  total: number
  analyzed: number
  failed: number
  subscribed: number
  languages: string[]
  categories: string[]
  lastSyncAt: number | null
}

export type GithubStarAnalysisFilter = 'all' | 'analyzed' | 'pending' | 'failed'

export type GithubStarSortKey = 'starred' | 'stars' | 'updated' | 'name'

export type GithubStarSearchMode = 'text' | 'ai'

export type GithubStarsView = 'repositories' | 'releases' | 'forks' | 'trending'

export interface GithubStarAiSearchInfo {
  query: string
  mode: 'ai' | 'fallback'
  count: number
}

export interface GithubStarFilters {
  query: string
  language: string
  category: string
  analysis: GithubStarAnalysisFilter
  sortBy: GithubStarSortKey
}

export interface AssetFilter {
  id: string
  name: string
  keywords: string[]
  icon?: string
  isPreset?: boolean
}

