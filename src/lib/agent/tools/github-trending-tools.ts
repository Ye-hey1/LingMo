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

// ---------------------------------------------------------------------------
// Repository Analysis Tool
// ---------------------------------------------------------------------------

const REPO_ANALYSIS_SYSTEM_PROMPT = `You are a professional open-source repository analyst. You must respond in the same language as the user's query (Chinese for Chinese queries, English for English queries).

Analyze the given GitHub repository based on its metadata and README content. Provide a structured analysis in the following format (use plain text, not JSON):

## 📦 仓库名称 (owner/repo)
**一句话简介**: 用简洁的一句话概括这个项目是做什么的

### 🎯 核心功能
- 列出 3-6 个核心功能点，每个功能用一句话说明

### 💡 适用场景
- 这个项目适合谁用？在什么场景下使用？

### 🚀 快速上手
1. 安装/引入方式（给出关键命令）
2. 最基础的使用示例（2-5 行代码）

### ⚖️ 优缺点
**优点**:
- ...
**注意**:
- ...

### 📊 关键指标
- Stars / Forks / 主要语言
- 最后更新时间 / 活跃度评价

Rules:
- Be specific, not generic. Mention actual function names, CLI commands, API patterns from the README.
- If README is unavailable, base analysis on repo name, description, topics, and language.
- Keep the quick-start section practical with real commands/code.
- Don't hallucinate features not mentioned in the README or metadata.`

async function fetchRepoMeta(fullName: string): Promise<Record<string, any> | null> {
  // Try GitHub search API first (public, no token needed)
  try {
    const { searchGithubRepositories } = await import('@/lib/github-stars/api')
    const result = await searchGithubRepositories(`repo:${fullName}`, { perPage: 1 })
    if (result.repos && result.repos.length > 0) {
      const repo = result.repos[0]
      return {
        full_name: repo.fullName,
        description: repo.description,
        stargazers_count: repo.stargazersCount,
        forks_count: repo.forksCount,
        language: repo.language,
        topics: repo.topics,
        html_url: repo.htmlUrl,
        updated_at: repo.updatedAt,
        created_at: repo.createdAt,
        owner: { login: repo.ownerLogin, avatar_url: repo.ownerAvatarUrl },
      }
    }
  } catch { /* fall through */ }

  // Fallback: direct GitHub REST API via Tauri
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    const token = (await store.get<string>('accessToken') || '').trim()
    const headers = new Headers()
    if (token) headers.append('Authorization', `Bearer ${token}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')

    const resp = await tauriFetch(`https://api.github.com/repos/${encodeURIComponent(fullName)}`, {
      headers,
      connectTimeout: 10000,
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

async function analyzeRepository(fullName: string): Promise<ToolResult> {
  try {
    // 1. Fetch repo metadata
    const repoMeta = await fetchRepoMeta(fullName)
    if (!repoMeta) {
      return { success: false, error: `找不到仓库 "${fullName}"，请确认仓库名称格式为 owner/repo` }
    }

    // 2. Fetch README
    let readme = ''
    try {
      const { fetchRepositoryReadme } = await import('@/lib/github-stars/api')
      readme = await fetchRepositoryReadme(fullName)
    } catch {
      // README unavailable, continue with metadata only
    }

    // 3. Build prompt
    const truncatedReadme = readme.length > 8000 ? readme.slice(0, 8000) + '\n... (README truncated)' : readme
    const userPrompt = buildAnalysisUserPrompt(repoMeta, truncatedReadme)

    // 4. Call AI model
    const { getAISettings, createOpenAIClient } = await import('@/lib/ai/utils')
    const aiConfig = await getAISettings('primaryModel')
    if (!aiConfig?.model) {
      return { success: true, message: buildFallbackAnalysis(repoMeta), data: repoMeta }
    }

    const client = await createOpenAIClient(aiConfig)
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      messages: [
        { role: 'system', content: REPO_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      stream: false,
    })

    const analysis = completion.choices?.[0]?.message?.content || ''
    if (!analysis) {
      return { success: true, message: buildFallbackAnalysis(repoMeta), data: repoMeta }
    }

    return {
      success: true,
      message: analysis,
      data: {
        fullName: repoMeta.full_name,
        stars: repoMeta.stargazers_count,
        forks: repoMeta.forks_count,
        language: repoMeta.language,
        description: repoMeta.description,
        topics: repoMeta.topics,
        license: repoMeta.license?.spdx_id,
        updatedAt: repoMeta.updated_at,
        openIssues: repoMeta.open_issues_count,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: `分析仓库失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function buildAnalysisUserPrompt(meta: Record<string, any>, readme: string): string {
  const parts: string[] = []
  parts.push(`## Repository Metadata`)
  parts.push(`- Full Name: ${meta.full_name || 'unknown'}`)
  parts.push(`- Description: ${meta.description || '(no description)'}`)
  parts.push(`- Stars: ${meta.stargazers_count ?? 0}`)
  parts.push(`- Forks: ${meta.forks_count ?? 0}`)
  parts.push(`- Language: ${meta.language || 'N/A'}`)
  parts.push(`- License: ${meta.license?.spdx_id || 'N/A'}`)
  parts.push(`- Topics: ${(meta.topics || []).join(', ') || 'N/A'}`)
  parts.push(`- Created: ${meta.created_at || 'N/A'}`)
  parts.push(`- Last Updated: ${meta.updated_at || 'N/A'}`)
  parts.push(`- Open Issues: ${meta.open_issues_count ?? 0}`)
  parts.push(`- Default Branch: ${meta.default_branch || 'main'}`)
  parts.push(`- Homepage: ${meta.homepage || 'N/A'}`)
  parts.push('')
  if (readme) {
    parts.push(`## README Content`)
    parts.push(readme)
  } else {
    parts.push(`(README not available)`)
  }
  return parts.join('\n')
}

function buildFallbackAnalysis(meta: Record<string, any>): string {
  const name = meta.full_name || 'Unknown'
  const desc = meta.description || '暂无描述'
  const stars = meta.stargazers_count ?? 0
  const forks = meta.forks_count ?? 0
  const lang = meta.language || 'N/A'
  const topics = (meta.topics || []).join(', ') || 'N/A'
  const url = meta.html_url || ''
  return `## 📦 ${name}
**简介**: ${desc}

### 📊 关键指标
- ⭐ Stars: ${formatStars(stars)} · 🍴 Forks: ${formatStars(forks)} · 💻 Language: ${lang}
- 🏷️ Topics: ${topics}
- 🔗 ${url}

_(AI 模型未配置，以上为基础元数据摘要。配置 AI 模型后可获得更详细的分析。)_`
}

export const githubAnalyzeTool: Tool = {
  name: 'github_analyze_repo',
  description:
    'Analyze a GitHub repository in depth. Fetches the README, metadata (stars, language, license, topics) and uses AI to generate a structured analysis including: what the project does, core features, use cases, quick-start guide, pros/cons, and key metrics. Use this when the user asks about a specific repository, wants to understand what a project does, how to use it, or asks for a detailed introduction. The fullName parameter should be in "owner/repo" format (e.g. "facebook/react").',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'full_name',
      type: 'string',
      description: 'Repository full name in "owner/repo" format, e.g. "facebook/react", "openai/codex", "vercel/next.js".',
      required: true,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const fullName = String(params.full_name || '').trim()
    if (!fullName || !fullName.includes('/')) {
      return { success: false, error: '请提供有效的仓库全称，格式为 "owner/repo"，例如 "facebook/react"' }
    }
    return analyzeRepository(fullName)
  },
}

export const githubTrendingTools: Tool[] = [
  githubTrendingTool,
  githubSearchTool,
  githubTopicTool,
  githubAnalyzeTool,
]
