import { getAISettings, createOpenAIClient } from '@/lib/ai/utils'
import { fetchRepositoryReadme } from '@/lib/github-stars/api'
import type { GithubStarAnalysisResult, GithubStarRepository } from '@/types/github-stars'

type GithubStarAnalysisClient = Awaited<ReturnType<typeof createOpenAIClient>>
type GithubStarAnalysisReadmeMode = 'auto' | 'always' | 'never'
const FAST_ANALYSIS_TIMEOUT_MS = 12000
const DETAILED_ANALYSIS_TIMEOUT_MS = 22000
const README_FETCH_TIMEOUT_MS = 7000

interface GithubStarAnalysisContext {
  aiConfig: NonNullable<Awaited<ReturnType<typeof getAISettings>>>
  client: GithubStarAnalysisClient
}

function normalizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function tryParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        return null
      }
    }
  }

  return null
}

function tryParseJsonArray(content: string): Array<Record<string, unknown>> | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const parse = (value: string) => {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : null
  }

  try {
    return parse(trimmed)
  } catch {
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
  }

  return null
}

function parseAnalysisResponse(content: string): GithubStarAnalysisResult {
  const parsed = tryParseJsonObject(content)
  if (!parsed) {
    return {
      summary: content.trim().slice(0, 80) || '未能生成摘要',
      tags: [],
      platforms: [],
    }
  }

  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 120)
      : '未能生成摘要',
    tags: normalizeStringArray(parsed.tags, 6),
    platforms: normalizeStringArray(parsed.platforms, 8),
  }
}

function parseBatchAnalysisResponse(content: string) {
  const parsed = tryParseJsonArray(content)
  if (!parsed) {
    throw new Error('AI 批量分析结果不是可解析 JSON 数组')
  }

  const results = new Map<number, GithubStarAnalysisResult>()
  parsed.forEach((item) => {
    const id = typeof item.id === 'number' ? item.id : Number(item.id)
    if (!Number.isFinite(id)) return

    results.set(id, {
      summary: typeof item.summary === 'string' && item.summary.trim()
        ? item.summary.trim().slice(0, 120)
        : '未能生成摘要',
      tags: normalizeStringArray(item.tags, 6),
      platforms: normalizeStringArray(item.platforms, 8),
    })
  })

  return results
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId)
    }
  })
}

export function detectPlatforms(repository: GithubStarRepository) {
  const text = [
    repository.name,
    repository.fullName,
    repository.description || '',
    repository.language || '',
    ...repository.topics,
  ].join(' ').toLowerCase()

  const platforms: string[] = []
  const add = (platform: string, patterns: string[]) => {
    if (patterns.some(pattern => text.includes(pattern))) {
      platforms.push(platform)
    }
  }

  add('web', ['web', 'browser', 'frontend', 'react', 'vue', 'next'])
  add('cli', ['cli', 'terminal', 'command', 'shell'])
  add('docker', ['docker', 'container'])
  add('mac', ['mac', 'macos', 'darwin'])
  add('windows', ['windows', 'win32'])
  add('linux', ['linux'])
  add('ios', ['ios', 'iphone'])
  add('android', ['android'])

  return platforms.filter((item, index, array) => array.indexOf(item) === index).slice(0, 6)
}

function normalizeSearchTerms(value: unknown, limit: number) {
  return normalizeStringArray(value, limit)
    .map(item => item.toLowerCase())
    .filter((item, index, array) => array.indexOf(item) === index)
}

function buildSearchIntentPrompt(query: string) {
  return `
请理解用户的 GitHub Star 搜索意图，输出严格 JSON，不要使用 Markdown 代码块。

目标：把自然语言查询扩展成可用于仓库语义匹配的关键词，支持中英文概念匹配。

用户查询：${query}

字段要求：
- keywords：核心关键词，最多 8 个。
- relatedTerms：同义词、英文/中文翻译、相关技术名词，最多 16 个。
- categories：可能相关的应用分类，最多 6 个。
- languages：可能相关的编程语言，最多 6 个。
- platforms：可能相关的平台，从 mac、windows、linux、ios、android、web、cli、docker 中选择。

JSON 格式：
{
  "keywords": ["关键词"],
  "relatedTerms": ["相关词"],
  "categories": ["分类"],
  "languages": ["语言"],
  "platforms": ["web", "cli"]
}
`.trim()
}

function parseSearchIntent(content: string, query: string) {
  const parsed = tryParseJsonObject(content)
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)

  if (!parsed) {
    return queryTerms
  }

  return [
    ...queryTerms,
    ...normalizeSearchTerms(parsed.keywords, 8),
    ...normalizeSearchTerms(parsed.relatedTerms, 16),
    ...normalizeSearchTerms(parsed.categories, 6),
    ...normalizeSearchTerms(parsed.languages, 6),
    ...normalizeSearchTerms(parsed.platforms, 8),
  ].filter((item, index, array) => item && array.indexOf(item) === index)
}

function scoreGithubStarRepository(repository: GithubStarRepository, query: string, terms: string[]) {
  const normalizedQuery = query.toLowerCase()
  const fields = {
    name: repository.name.toLowerCase(),
    fullName: repository.fullName.toLowerCase(),
    description: (repository.description || '').toLowerCase(),
    customDescription: (repository.customDescription || '').toLowerCase(),
    aiSummary: (repository.aiSummary || '').toLowerCase(),
    language: (repository.language || '').toLowerCase(),
    owner: repository.ownerLogin.toLowerCase(),
    topics: repository.topics.join(' ').toLowerCase(),
    aiTags: repository.aiTags.join(' ').toLowerCase(),
    customTags: repository.customTags.join(' ').toLowerCase(),
    aiPlatforms: repository.aiPlatforms.join(' ').toLowerCase(),
  }

  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (fields.name === term) score += 60
    if (fields.name.includes(term)) score += 36
    if (fields.fullName.includes(term)) score += 32
    if (fields.customDescription.includes(term)) score += 25
    if (fields.description.includes(term)) score += 22
    if (fields.aiSummary.includes(term)) score += 18
    if (fields.aiTags.includes(term)) score += 18
    if (fields.customTags.includes(term)) score += 18
    if (fields.topics.includes(term)) score += 16
    if (fields.aiPlatforms.includes(term)) score += 12
    if (fields.language.includes(term)) score += 10
    if (fields.owner.includes(term)) score += 8
  }

  if (normalizedQuery && fields.fullName.includes(normalizedQuery)) score += 24
  if (normalizedQuery && fields.description.includes(normalizedQuery)) score += 12
  if (score > 0) score += Math.log10(Math.max(10, repository.stargazersCount)) * 2

  return score
}

export function searchGithubStarRepositoriesLocally(
  repositories: GithubStarRepository[],
  query: string,
  terms = query.toLowerCase().split(/\s+/).filter(Boolean),
) {
  if (!query.trim()) return repositories

  return repositories
    .map(repository => ({
      repository,
      score: scoreGithubStarRepository(repository, query, terms),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.repository.stargazersCount - a.repository.stargazersCount)
    .map(item => item.repository)
}

export async function searchGithubStarRepositoriesWithAI(
  repositories: GithubStarRepository[],
  query: string,
  context?: GithubStarAnalysisContext,
) {
  if (!query.trim()) {
    return { repositories, mode: 'fallback' as const }
  }

  try {
    const analysisContext = context || await createGithubStarAnalysisContext()
    const completion = await analysisContext.client.chat.completions.create({
      model: analysisContext.aiConfig.model || '',
      messages: [
        {
          role: 'system',
          content: '你是一个 GitHub 仓库语义搜索助手，只输出可解析 JSON。',
        },
        {
          role: 'user',
          content: buildSearchIntentPrompt(query),
        },
      ],
      temperature: 0.1,
      max_tokens: 420,
      stream: false,
    })

    const content = completion.choices?.[0]?.message?.content || ''
    const terms = parseSearchIntent(content, query)
    return {
      repositories: searchGithubStarRepositoriesLocally(repositories, query, terms),
      mode: 'ai' as const,
    }
  } catch (error) {
    console.warn('[GitHubStars] AI semantic search failed, falling back to local ranking:', error)
    return {
      repositories: searchGithubStarRepositoriesLocally(repositories, query),
      mode: 'fallback' as const,
    }
  }
}

function buildAnalysisPrompt(repository: GithubStarRepository, readme: string) {
  return `
【重要】所有输出必须使用简体中文。summary 和 tags 字段禁止使用英文（技术名词除外）。

请分析这个 GitHub 仓库，输出严格 JSON，不要使用 Markdown 代码块。

字段要求：
- summary：一句简体中文摘要，不超过 60 字，说明仓库主要用途。必须用中文重写，严禁照搬英文原文描述。
- tags：3 到 6 个简体中文分类标签，偏应用类型，例如 AI 工具、开发工具、数据库、前端框架、命令行工具。
- platforms：支持的平台，从 mac、windows、linux、ios、android、web、cli、docker 中选择。

仓库名称：${repository.fullName}
描述：${repository.description || '无'}
语言：${repository.language || '未知'}
Topics：${repository.topics.join(', ') || '无'}
Stars：${repository.stargazersCount}

${readme ? `README 摘要材料：\n${readme.slice(0, 3200)}` : 'README 未读取，请根据仓库元数据判断。'}

JSON 格式：
{
  "summary": "一个用于构建现代化 Web 应用的开源前端框架",
  "tags": ["前端框架", "Web开发", "开发工具"],
  "platforms": ["web", "cli"]
}
`.trim()
}

async function fetchRepositoryReadmeWithTimeout(repository: GithubStarRepository) {
  try {
    return await withTimeout(
      fetchRepositoryReadme(repository.fullName),
      README_FETCH_TIMEOUT_MS,
      'README 抓取超时',
    )
  } catch (error) {
    console.warn(`[GitHubStars] README unavailable for ${repository.fullName}:`, error)
    return ''
  }
}

function buildFastAnalysisPrompt(repository: GithubStarRepository) {
  const payload = {
    fullName: repository.fullName,
    description: repository.description || '',
    language: repository.language || '',
    topics: repository.topics.slice(0, 10),
    stars: repository.stargazersCount,
  }

  return `
【重要】所有输出必须使用简体中文。summary 和 tags 字段禁止使用英文（技术名词除外）。

请基于 GitHub 仓库元数据快速分析，输出严格 JSON，不要 Markdown。

要求：
- summary：一句简体中文摘要，40 字以内。严禁照搬英文原文描述。
- tags：3 到 5 个简体中文应用标签，例如 AI工具、开发工具、数据库、前端框架、命令行工具。
- platforms：从 mac、windows、linux、ios、android、web、cli、docker 中选择。

仓库：
${JSON.stringify(payload)}

JSON：
{"summary":"简体中文摘要","tags":["中文标签"],"platforms":["web"]}
`.trim()
}

function buildBatchAnalysisPrompt(repositories: GithubStarRepository[]) {
  const payload = repositories.map(repo => ({
    id: repo.id,
    fullName: repo.fullName,
    description: repo.description || '',
    language: repo.language || '',
    topics: repo.topics.slice(0, 12),
    stars: repo.stargazersCount,
  }))

  return `
【重要】所有输出必须使用简体中文。summary 和 tags 字段禁止使用英文（技术名词除外）。

请批量分析这些 GitHub 仓库，输出严格 JSON 数组，不要使用 Markdown 代码块。

每个数组元素字段：
- id：必须原样返回仓库 id。
- summary：一句简体中文摘要，不超过 50 字。严禁照搬英文原文描述。
- tags：3 到 6 个简体中文分类标签，偏应用类型，例如 AI工具、开发工具、数据库、前端框架。
- platforms：从 mac、windows、linux、ios、android、web、cli、docker 中选择。

仓库列表：
${JSON.stringify(payload)}

JSON 格式：
[
  {
    "id": 123,
    "summary": "一个用于自动化部署的命令行工具",
    "tags": ["开发工具", "命令行工具", "自动化"],
    "platforms": ["cli"]
  }
]
`.trim()
}

function shouldFetchReadme(repository: GithubStarRepository, mode: GithubStarAnalysisReadmeMode) {
  if (mode === 'always') return true
  if (mode === 'never') return false

  const metadataText = [
    repository.description || '',
    repository.language || '',
    ...repository.topics,
  ].join(' ').trim()

  return metadataText.length < 80 && repository.topics.length < 2
}

export async function createGithubStarAnalysisContext(): Promise<GithubStarAnalysisContext> {
  const aiConfig = await getAISettings('markDescModel') || await getAISettings('primaryModel')
  if (!aiConfig?.model) {
    throw new Error('未配置可用的聊天模型')
  }

  const client = await createOpenAIClient(aiConfig)
  return { aiConfig, client }
}

export async function analyzeGithubStarRepository(
  repository: GithubStarRepository,
  context?: GithubStarAnalysisContext,
  options: { readmeMode?: GithubStarAnalysisReadmeMode } = {},
) {
  const analysisContext = context || await createGithubStarAnalysisContext()
  const readme = shouldFetchReadme(repository, options.readmeMode || 'auto')
    ? await fetchRepositoryReadme(repository.fullName)
    : ''

  const completion = await analysisContext.client.chat.completions.create({
    model: analysisContext.aiConfig.model || '',
    messages: [
      {
        role: 'system',
        content: '你是一个严谨的 GitHub 仓库分析助手，只输出可解析 JSON。所有字段必须使用简体中文。',
      },
      {
        role: 'user',
        content: buildAnalysisPrompt(repository, readme),
      },
    ],
    temperature: 0.2,
    max_tokens: 360,
    stream: false,
  })

  const content = completion.choices?.[0]?.message?.content || ''
  return parseAnalysisResponse(content)
}

export async function analyzeGithubStarRepositoryFast(
  repository: GithubStarRepository,
  context?: GithubStarAnalysisContext,
) {
  try {
    const analysisContext = context || await createGithubStarAnalysisContext()
    const completion = await withTimeout(
      analysisContext.client.chat.completions.create({
        model: analysisContext.aiConfig.model || '',
        messages: [
          {
            role: 'system',
            content: '你是一个快速 GitHub 仓库分析助手，只输出可解析 JSON。所有字段必须使用简体中文。',
          },
          {
            role: 'user',
            content: buildFastAnalysisPrompt(repository),
          },
        ],
        temperature: 0.1,
        max_tokens: 220,
        stream: false,
      }),
      FAST_ANALYSIS_TIMEOUT_MS,
      'AI 快速分析超时，已使用本地元数据生成结果',
    )

    const content = completion.choices?.[0]?.message?.content || ''
    return parseAnalysisResponse(content)
  } catch (error) {
    console.warn('[GitHubStars] fast analysis failed:', error)
    throw error
  }
}

export async function analyzeGithubStarRepositoryDetailed(
  repository: GithubStarRepository,
  context?: GithubStarAnalysisContext,
) {
  try {
    const analysisContext = context || await createGithubStarAnalysisContext()
    const readme = await fetchRepositoryReadmeWithTimeout(repository)
    const completion = await withTimeout(
      analysisContext.client.chat.completions.create({
        model: analysisContext.aiConfig.model || '',
        messages: [
          {
            role: 'system',
            content: '你是一个严谨的 GitHub 仓库分析助手，必须基于 README 和仓库元数据输出可解析 JSON。所有字段必须使用简体中文。',
          },
          {
            role: 'user',
            content: buildAnalysisPrompt(repository, readme),
          },
        ],
        temperature: 0.15,
        max_tokens: 420,
        stream: false,
      }),
      DETAILED_ANALYSIS_TIMEOUT_MS,
      'AI README 分析超时，已切换快速分析',
    )

    const content = completion.choices?.[0]?.message?.content || ''
    return parseAnalysisResponse(content)
  } catch (error) {
    console.warn('[GitHubStars] detailed analysis fallback:', error)
    return analyzeGithubStarRepositoryFast(repository, context)
  }
}

export async function analyzeGithubStarRepositoriesBatch(
  repositories: GithubStarRepository[],
  context?: GithubStarAnalysisContext,
) {
  if (repositories.length === 0) return new Map<number, GithubStarAnalysisResult>()

  const analysisContext = context || await createGithubStarAnalysisContext()
  const completion = await withTimeout(
    analysisContext.client.chat.completions.create({
      model: analysisContext.aiConfig.model || '',
      messages: [
        {
          role: 'system',
          content: '你是一个严谨的 GitHub 仓库批量分析助手，只输出可解析 JSON 数组。所有字段必须使用简体中文。',
        },
        {
          role: 'user',
          content: buildBatchAnalysisPrompt(repositories),
        },
      ],
      temperature: 0.15,
      max_tokens: Math.min(1800, Math.max(600, repositories.length * 260)),
      stream: false,
    }),
    25000,
    'AI 批量分析超时',
  )

  const content = completion.choices?.[0]?.message?.content || ''
  return parseBatchAnalysisResponse(content)
}
