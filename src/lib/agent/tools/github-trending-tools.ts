import { Tool, ToolResult } from '../types'

/**
 * GitHub Trending / Discovery 工具集
 *
 * 让 Agent 可以在对话中搜索 GitHub 热门项目、趋势仓库、
 * 主题频道项目，并以结构化的方式呈现给用户。
 *
 * 无需用户 Token（趋势数据来自公开 RSS），搜索 API 有
 * 60 次/小时匿名限额，内部已通过 tauri HTTP + 代理处理。
 */

// ---------------------------------------------------------------------------
// Helper：安全获取趋势数据
// ---------------------------------------------------------------------------

async function fetchTrending(
  range: 'daily' | 'weekly' | 'monthly',
  count: number,
): Promise<ToolResult> {
  try {
    const { fetchTrendingRepositories } = await import('@/lib/github-stars/api')
    const result = await fetchTrendingRepositories(range, 'All', 1, count)

    if (!result.repos || result.repos.length === 0) {
      return {
        success: true,
        message: '暂无趋势数据，可能是网络或代理配置问题导致无法获取 GitHub Trending RSS。',
        data: [],
      }
    }

    const formatted = result.repos.map((repo, idx) => ({
      rank: idx + 1,
      name: repo.fullName,
      description: repo.description || '(无描述)',
      stars: repo.stargazersCount,
      forks: repo.forksCount,
      language: repo.language || '-',
      url: repo.htmlUrl,
      topics: repo.topics?.slice(0, 5) || [],
    }))

    return {
      success: true,
      data: formatted,
      message: formatRepoList(formatted, `GitHub Trending (${rangeLabel(range)})`),
    }
  } catch (error) {
    return {
      success: false,
      error: `获取 GitHub 趋势失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function searchRepos(
  query: string,
  count: number,
): Promise<ToolResult> {
  try {
    const { searchGithubRepositories } = await import('@/lib/github-stars/api')
    const result = await searchGithubRepositories(query, {
      perPage: count,
      sortBy: 'MostStars',
      sortOrder: 'Descending',
    })

    if (!result.repos || result.repos.length === 0) {
      return {
        success: true,
        message: `没有找到与 "${query}" 相关的 GitHub 项目。`,
        data: [],
      }
    }

    const formatted = result.repos.map((repo, idx) => ({
      rank: idx + 1,
      name: repo.fullName,
      description: repo.description || '(无描述)',
      stars: repo.stargazersCount,
      forks: repo.forksCount,
      language: repo.language || '-',
      url: repo.htmlUrl,
      topics: repo.topics?.slice(0, 5) || [],
    }))

    return {
      success: true,
      data: formatted,
      message: formatRepoList(formatted, `GitHub 搜索: "${query}" (共 ${result.totalCount} 个结果, 显示前 ${formatted.length} 个)`),
    }
  } catch (error) {
    return {
      success: false,
      error: `GitHub 搜索失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function fetchTopicRepos(
  topic: string,
  count: number,
): Promise<ToolResult> {
  try {
    const { fetchTopicRepositories } = await import('@/lib/github-stars/api')
    const validTopics = ['ai', 'ml', 'database', 'web', 'mobile', 'devtools', 'security', 'game'] as const
    type TopicType = typeof validTopics[number]
    const normalizedTopic = topic.toLowerCase() as TopicType
    const safeTopic: TopicType = validTopics.includes(normalizedTopic) ? normalizedTopic : 'ai'

    const result = await fetchTopicRepositories(safeTopic, 'All', 1, count)

    if (!result.repos || result.repos.length === 0) {
      return {
        success: true,
        message: `"${topic}" 频道暂无项目数据。`,
        data: [],
      }
    }

    const formatted = result.repos.map((repo, idx) => ({
      rank: idx + 1,
      name: repo.fullName,
      description: repo.description || '(无描述)',
      stars: repo.stargazersCount,
      forks: repo.forksCount,
      language: repo.language || '-',
      url: repo.htmlUrl,
      topics: repo.topics?.slice(0, 5) || [],
    }))

    return {
      success: true,
      data: formatted,
      message: formatRepoList(formatted, `GitHub ${topic.toUpperCase()} 频道热门项目`),
    }
  } catch (error) {
    return {
      success: false,
      error: `获取 ${topic} 频道失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function rangeLabel(range: string): string {
  switch (range) {
    case 'daily': return '今日'
    case 'weekly': return '本周'
    case 'monthly': return '本月'
    default: return range
  }
}

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatRepoList(
  repos: Array<{
    rank: number
    name: string
    description: string
    stars: number
    forks: number
    language: string
    url: string
    topics: string[]
  }>,
  title: string,
): string {
  const lines: string[] = [`## ${title}`, '']
  for (const repo of repos) {
    const topicStr = repo.topics.length > 0 ? `\n   Topics: ${repo.topics.join(', ')}` : ''
    lines.push(
      `${repo.rank}. **${repo.name}** ⭐ ${formatStars(repo.stars)} · 🍴 ${formatStars(repo.forks)} · ${repo.language}`,
      `   ${repo.description.slice(0, 200)}${repo.description.length > 200 ? '...' : ''}`,
      `   ${repo.url}${topicStr}`,
      '',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const githubTrendingTool: Tool = {
  name: 'github_trending',
  description:
    'Fetch GitHub trending repositories. Returns the most popular open-source projects ranked by stars gained in a given time range. Use this when the user asks about hot/popular/trending GitHub projects, what\'s new in open-source, or wants project recommendations.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'range',
      type: 'string',
      description: 'Time range for trending: "daily" (today), "weekly" (this week), or "monthly" (this month). Default: "weekly".',
      required: false,
      default: 'weekly',
    },
    {
      name: 'count',
      type: 'number',
      description: 'Number of repositories to return. Default: 10, max: 25.',
      required: false,
      default: 10,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const range = params.range === 'daily' || params.range === 'monthly' ? params.range : 'weekly'
    const count = Math.min(Math.max(Number(params.count) || 10, 1), 25)
    return fetchTrending(range, count)
  },
}

export const githubSearchTool: Tool = {
  name: 'github_search',
  description:
    'Search GitHub repositories by keyword. Returns repositories sorted by star count. Use this when the user asks to find projects related to a specific technology, topic, or feature (e.g., "find me a React chart library", "search for AI agent frameworks").',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query, e.g. "react chart library", "python web scraper", "LLM agent framework".',
      required: true,
    },
    {
      name: 'count',
      type: 'number',
      description: 'Number of results to return. Default: 10, max: 25.',
      required: false,
      default: 10,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const query = String(params.query || '').trim()
    if (!query) {
      return { success: false, error: '请提供搜索关键词 (query)' }
    }
    const count = Math.min(Math.max(Number(params.count) || 10, 1), 25)
    return searchRepos(query, count)
  },
}

export const githubTopicTool: Tool = {
  name: 'github_topic',
  description:
    'Browse hot repositories in a specific topic/channel on GitHub. Available topics: ai, ml, database, web, mobile, devtools, security, game. Use this when the user asks for project recommendations in a broad field (e.g., "recommend some AI projects", "best dev tools on GitHub").',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'topic',
      type: 'string',
      description: 'Topic channel: ai, ml, database, web, mobile, devtools, security, game.',
      required: true,
    },
    {
      name: 'count',
      type: 'number',
      description: 'Number of repositories to return. Default: 10, max: 25.',
      required: false,
      default: 10,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const topic = String(params.topic || 'ai').trim().toLowerCase()
    const count = Math.min(Math.max(Number(params.count) || 10, 1), 25)
    return fetchTopicRepos(topic, count)
  },
}

export const githubTrendingTools: Tool[] = [
  githubTrendingTool,
  githubSearchTool,
  githubTopicTool,
]
