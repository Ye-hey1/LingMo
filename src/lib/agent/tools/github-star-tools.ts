import { Tool, ToolResult } from '../types'

function asErrorResult(prefix: string, error: unknown): ToolResult {
  return {
    success: false,
    error: `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  }
}

function numberParam(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function stringParam(value: unknown) {
  return String(value || '').trim()
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatRepositoryRows(repositories: Array<{
  fullName: string
  description: string | null
  stars: number
  forks: number
  language: string | null
  htmlUrl: string
  starredAt?: string | null
  category?: string
}>) {
  if (repositories.length === 0) return '没有找到匹配的 GitHub Star 项目。'

  return repositories.map((repo, index) => {
    const meta = [
      repo.language || 'Unknown',
      `⭐ ${formatCount(repo.stars)}`,
      `🍴 ${formatCount(repo.forks)}`,
      repo.category,
      repo.starredAt ? `Starred: ${repo.starredAt.slice(0, 10)}` : '',
    ].filter(Boolean).join(' · ')

    return [
      `${index + 1}. **${repo.fullName}**`,
      `   ${meta}`,
      `   ${repo.description || '(无描述)'}`,
      `   ${repo.htmlUrl}`,
    ].join('\n')
  }).join('\n\n')
}

function formatRecentSummary(summary: {
  rangeDays: number
  from: string
  to: string
  total: number
  repositories: Array<{
    fullName: string
    description: string | null
    stars: number
    forks: number
    language: string | null
    htmlUrl: string
    starredAt?: string | null
    category?: string
  }>
  languages: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  topics: Array<{ name: string; count: number }>
  noteworthy: Array<{
    fullName: string
    description: string | null
    stars: number
    forks: number
    language: string | null
    htmlUrl: string
    starredAt?: string | null
    category?: string
  }>
}) {
  const lines = [
    `## 最近 ${summary.rangeDays} 天新增 Star 项目`,
    '',
    `范围: ${summary.from.slice(0, 10)} 至 ${summary.to.slice(0, 10)}`,
    `总数: ${summary.total}`,
    '',
  ]

  if (summary.total === 0) {
    lines.push('这段时间没有同步到新增 Star 项目。')
    return lines.join('\n')
  }

  lines.push('### 新增项目', formatRepositoryRows(summary.repositories.slice(0, 20)), '')
  lines.push(`### 语言分布\n${summary.languages.map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push(`### 分类分布\n${summary.categories.map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push(`### 高频主题\n${summary.topics.slice(0, 10).map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push('### 值得关注', formatRepositoryRows(summary.noteworthy))
  return lines.join('\n')
}

export const githubSyncStarredTool: Tool = {
  name: 'github_sync_starred',
  description: 'Sync the authenticated user GitHub starred repositories into LingMo local storage. Use before personal Star summaries when local data may be empty or stale.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'max_pages',
      type: 'number',
      description: 'Optional max pages to sync. Leave empty or 0 to sync all pages.',
      required: false,
      default: 0,
    },
  ],
  execute: async (params, context) => {
    try {
      const { syncGithubStarredForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await syncGithubStarredForAgent({
        maxPages: numberParam(params.max_pages, 0, 0, 1000),
        signal: context?.abortSignal,
      })
      return {
        success: true,
        data: result,
        message: `GitHub Star 同步完成：拉取 ${result.fetched} 个仓库，本地 Star 总数 ${result.localTotal}。`,
      }
    } catch (error) {
      return asErrorResult('GitHub Star 同步失败', error)
    }
  },
}

export const githubListStarredTool: Tool = {
  name: 'github_list_starred',
  description: 'List the user personal GitHub starred repositories from LingMo local storage with filters for query, language, category, analysis state, and date range.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', description: 'Optional text query.', required: false },
    { name: 'language', type: 'string', description: 'Optional language filter.', required: false },
    { name: 'category', type: 'string', description: 'Optional category filter.', required: false },
    { name: 'analysis', type: 'string', description: 'Optional analysis filter: all, analyzed, pending, failed.', required: false, default: 'all' },
    { name: 'from', type: 'string', description: 'Optional starred-at start date ISO string.', required: false },
    { name: 'to', type: 'string', description: 'Optional starred-at end date ISO string.', required: false },
    { name: 'limit', type: 'number', description: 'Max repositories to return. Default 30, max 200.', required: false, default: 30 },
  ],
  execute: async (params) => {
    try {
      const { listGithubStarredForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listGithubStarredForAgent({
        query: stringParam(params.query),
        language: stringParam(params.language) || undefined,
        category: stringParam(params.category) || undefined,
        analysis: ['analyzed', 'pending', 'failed'].includes(params.analysis) ? params.analysis : 'all',
        from: stringParam(params.from) || undefined,
        to: stringParam(params.to) || undefined,
        limit: numberParam(params.limit, 30, 1, 200),
      })
      return {
        success: true,
        data: result,
        message: formatRepositoryRows(result.repositories),
      }
    } catch (error) {
      return asErrorResult('读取 GitHub Star 列表失败', error)
    }
  },
}

export const githubSummarizeRecentStarsTool: Tool = {
  name: 'github_summarize_recent_stars',
  description: 'Summarize personal GitHub repositories starred in the last N days. Use for questions like "最近一周我 Star 了哪些 GitHub 项目".',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'range_days', type: 'number', description: 'Recent range in days. Default 7.', required: false, default: 7 },
    { name: 'limit', type: 'number', description: 'Max repositories included in summary. Default 50, max 200.', required: false, default: 50 },
  ],
  execute: async (params) => {
    try {
      const { summarizeRecentGithubStarsForAgent } = await import('@/lib/github-stars/agent-service')
      const summary = await summarizeRecentGithubStarsForAgent({
        rangeDays: numberParam(params.range_days, 7, 1, 365),
        limit: numberParam(params.limit, 50, 1, 200),
      })
      return {
        success: true,
        data: summary,
        message: formatRecentSummary(summary),
      }
    } catch (error) {
      return asErrorResult('总结最近 GitHub Star 失败', error)
    }
  },
}

export const githubSearchMyStarsTool: Tool = {
  name: 'github_search_my_stars',
  description: 'Search within the user personal GitHub starred repositories stored in LingMo.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', description: 'Search query.', required: true },
    { name: 'limit', type: 'number', description: 'Max results. Default 20, max 100.', required: false, default: 20 },
  ],
  execute: async (params) => {
    try {
      const query = stringParam(params.query)
      if (!query) return { success: false, error: '请提供搜索关键词 query' }
      const { searchMyGithubStarsForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await searchMyGithubStarsForAgent(query, {
        limit: numberParam(params.limit, 20, 1, 100),
      })
      return {
        success: true,
        data: result,
        message: formatRepositoryRows(result.repositories),
      }
    } catch (error) {
      return asErrorResult('搜索个人 GitHub Star 失败', error)
    }
  },
}

export const githubListStarReleasesTool: Tool = {
  name: 'github_list_star_releases',
  description: 'List locally cached releases for starred repositories, optionally filtered by repository, read state, and date range.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'repo_full_name', type: 'string', description: 'Optional repository full name owner/repo.', required: false },
    { name: 'unread_only', type: 'boolean', description: 'Only include unread releases.', required: false, default: false },
    { name: 'from', type: 'string', description: 'Optional published-at start date ISO string.', required: false },
    { name: 'to', type: 'string', description: 'Optional published-at end date ISO string.', required: false },
    { name: 'limit', type: 'number', description: 'Max releases. Default 30, max 200.', required: false, default: 30 },
  ],
  execute: async (params) => {
    try {
      const { listGithubStarReleasesForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listGithubStarReleasesForAgent({
        repoFullName: stringParam(params.repo_full_name) || undefined,
        unreadOnly: Boolean(params.unread_only),
        from: stringParam(params.from) || undefined,
        to: stringParam(params.to) || undefined,
        limit: numberParam(params.limit, 30, 1, 200),
      })
      const message = result.releases.length === 0
        ? '没有找到匹配的 GitHub Star release。'
        : result.releases.map((release, index) => `${index + 1}. **${release.repository.fullName}** ${release.tagName} · ${release.publishedAt.slice(0, 10)}\n   ${release.htmlUrl}`).join('\n\n')
      return { success: true, data: result, message }
    } catch (error) {
      return asErrorResult('读取 GitHub Star release 失败', error)
    }
  },
}

export const githubListMyForksTool: Tool = {
  name: 'github_list_my_forks',
  description: 'List the user fork repositories from LingMo local storage, optionally refreshing from GitHub.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    { name: 'refresh', type: 'boolean', description: 'Refresh fork list from GitHub before listing.', required: false, default: false },
  ],
  execute: async (params) => {
    try {
      const { listMyGithubForksForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listMyGithubForksForAgent({ refresh: Boolean(params.refresh) })
      const message = result.forks.length === 0
        ? '没有找到 fork 仓库。'
        : result.forks.slice(0, 30).map((fork, index) => `${index + 1}. **${fork.fullName}** · ${fork.language || 'Unknown'} · ⭐ ${formatCount(fork.stargazersCount)}\n   ${fork.description || '(无描述)'}\n   ${fork.htmlUrl}`).join('\n\n')
      return { success: true, data: result, message }
    } catch (error) {
      return asErrorResult('读取 GitHub fork 列表失败', error)
    }
  },
}

export const githubStarRepoTool: Tool = {
  name: 'github_star_repo',
  description: 'Star a GitHub repository for the authenticated user and update the local GitHub Stars cache. Requires explicit user intent and confirmation.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write', 'network'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
  ],
  execute: async (params) => {
    try {
      const fullName = stringParam(params.full_name)
      const { starGithubRepositoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await starGithubRepositoryForAgent(fullName)
      return { success: true, data: result, message: `已 Star ${fullName}。` }
    } catch (error) {
      return asErrorResult('添加 GitHub Star 失败', error)
    }
  },
}

export const githubUnstarRepoTool: Tool = {
  name: 'github_unstar_repo',
  description: 'Unstar a GitHub repository for the authenticated user and mark it unstarred locally. Destructive remote action; requires confirmation.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'high',
  capabilities: ['delete', 'network'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
  ],
  execute: async (params) => {
    try {
      const fullName = stringParam(params.full_name)
      const { unstarGithubRepositoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await unstarGithubRepositoryForAgent(fullName)
      return { success: true, data: result, message: `已取消 Star ${fullName}。` }
    } catch (error) {
      return asErrorResult('取消 GitHub Star 失败', error)
    }
  },
}

export const githubUpdateStarCategoryTool: Tool = {
  name: 'github_update_star_category',
  description: 'Update the local category for a starred GitHub repository. This changes LingMo local metadata only.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'category', type: 'string', description: 'New category. Empty clears category.', required: false },
  ],
  execute: async (params) => {
    try {
      const { updateGithubStarCategoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await updateGithubStarCategoryForAgent(
        stringParam(params.full_name),
        stringParam(params.category) || null,
      )
      return { success: true, data: result, message: `已更新 ${result.fullName} 的分类。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star 分类失败', error)
    }
  },
}

export const githubUpdateStarNotesTagsTool: Tool = {
  name: 'github_update_star_notes_tags',
  description: 'Update local custom description and tags for a starred GitHub repository.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'custom_description', type: 'string', description: 'Custom local description.', required: false },
    { name: 'custom_tags', type: 'array', description: 'Custom local tags.', required: false },
  ],
  execute: async (params) => {
    try {
      const { updateGithubStarNotesTagsForAgent } = await import('@/lib/github-stars/agent-service')
      const customTags = Array.isArray(params.custom_tags)
        ? params.custom_tags.map(item => String(item).trim()).filter(Boolean)
        : []
      const result = await updateGithubStarNotesTagsForAgent(stringParam(params.full_name), {
        customDescription: stringParam(params.custom_description) || null,
        customTags,
      })
      return { success: true, data: result, message: `已更新 ${result.fullName} 的备注和标签。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star 备注标签失败', error)
    }
  },
}

export const githubSubscribeStarReleasesTool: Tool = {
  name: 'github_subscribe_star_releases',
  description: 'Toggle local release subscription for a starred GitHub repository.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'subscribed', type: 'boolean', description: 'Whether to subscribe to releases.', required: true },
  ],
  execute: async (params) => {
    try {
      const { toggleGithubStarReleaseSubscriptionForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await toggleGithubStarReleaseSubscriptionForAgent(
        stringParam(params.full_name),
        Boolean(params.subscribed),
      )
      return { success: true, data: result, message: `${result.subscribed ? '已订阅' : '已取消订阅'} ${result.fullName} 的 release。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star release 订阅失败', error)
    }
  },
}

export const githubMarkReleaseReadTool: Tool = {
  name: 'github_mark_release_read',
  description: 'Mark a locally cached GitHub Star release as read.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    { name: 'release_id', type: 'number', description: 'Release id.', required: true },
  ],
  execute: async (params) => {
    try {
      const { markGithubStarReleaseReadForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await markGithubStarReleaseReadForAgent(Number(params.release_id))
      return { success: true, data: result, message: `已标记 release ${result.releaseId} 为已读。` }
    } catch (error) {
      return asErrorResult('标记 GitHub Star release 已读失败', error)
    }
  },
}

export const githubStarTools: Tool[] = [
  githubSyncStarredTool,
  githubListStarredTool,
  githubSummarizeRecentStarsTool,
  githubSearchMyStarsTool,
  githubListStarReleasesTool,
  githubListMyForksTool,
  githubStarRepoTool,
  githubUnstarRepoTool,
  githubUpdateStarCategoryTool,
  githubUpdateStarNotesTagsTool,
  githubSubscribeStarReleasesTool,
  githubMarkReleaseReadTool,
]
