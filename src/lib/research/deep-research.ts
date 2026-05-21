import OpenAI from 'openai'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import type { MCPServerConfig, MCPTool } from '@/lib/mcp/types'
import { useMcpStore } from '@/stores/mcp'
import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import { searchWeb, type TavilySearchDepth } from '@/lib/tavily'

type SerpQuery = {
  query: string
  researchGoal: string
}

type ProcessedSerpResult = {
  learnings: string[]
  evidences: ResearchEvidence[]
  followUpQuestions: string[]
}

type FirecrawlSearchItem = {
  title?: string
  url?: string
  markdown?: string
  content?: string
  description?: string
  score?: number
  publishedDate?: string
  provider?: string
}

type FirecrawlBinding = {
  server: MCPServerConfig
  searchTool: MCPTool
}

export type DeepResearchProgress = {
  stage: 'initializing' | 'planning' | 'searching' | 'analyzing' | 'verifying' | 'writing' | 'done'
  currentDepth: number
  totalDepth: number
  currentBreadth: number
  totalBreadth: number
  currentQuery?: string
  completedQueries: number
  totalQueries: number
  learningsCount: number
  visitedUrlsCount: number
  evidenceCount?: number
  providerStatus?: string
  strategy?: ResearchStrategyId
  estimatedMinutes?: string
}

export type ResearchStrategyId = 'quick' | 'comprehensive' | 'academic' | 'technical' | 'news'

export type ResearchSource = {
  id: string
  title: string
  url: string
  engine: string
  snippet?: string
  publishedAt?: string
  retrievedAt: string
  credibilityScore: number
}

export type ResearchEvidence = {
  id: string
  sourceId: string
  sourceUrl: string
  claim: string
  quote?: string
  relevanceScore: number
  confidence: 'low' | 'medium' | 'high'
}

export type ResearchSession = {
  id: string
  query: string
  strategy: ResearchStrategyId
  startedAt: string
  completedAt: string
  searchProviders: string[]
  sources: ResearchSource[]
  evidences: ResearchEvidence[]
  learnings: string[]
  visitedUrls: string[]
}

export type DeepResearchResult = {
  report: string
  learnings: string[]
  visitedUrls: string[]
  sources: ResearchSource[]
  evidences: ResearchEvidence[]
  session: ResearchSession
}

export type ResearchClarification = {
  questions: string[]
  canStart: boolean
  researchBrief: string
}

const DEFAULT_BREADTH = 3
const DEFAULT_DEPTH = 2
const MAX_CONTENT_CHARS_PER_ITEM = 10000
const MAX_LEARNINGS_FOR_REPORT = 60
const MAX_EVIDENCES_FOR_REPORT = 80
const MAX_PARALLEL_SEARCHES = 3
const ASK_JSON_MAX_RETRIES = 2

type ResearchStrategyConfig = {
  id: ResearchStrategyId
  label: string
  breadth: number
  depth: number
  maxResults: number
  searchDepth: TavilySearchDepth
  queryHint: string
  reportFocus: string
  includeDomains?: string[]
}

type ResearchSearchProvider = {
  name: string
  search: (query: string, options: {
    maxResults: number
    searchDepth: TavilySearchDepth
    includeDomains?: string[]
    abortSignal?: AbortSignal
  }) => Promise<FirecrawlSearchItem[]>
}

type SearchHit = FirecrawlSearchItem & {
  sourceId: string
}

const STRATEGY_CONFIGS: Record<ResearchStrategyId, ResearchStrategyConfig> = {
  quick: {
    id: 'quick',
    label: '快速概览',
    breadth: 2,
    depth: 1,
    maxResults: 4,
    searchDepth: 'basic',
    queryHint: 'Prioritize concise overview sources and direct answers.',
    reportFocus: '给出简明结论、关键事实和必要来源。',
  },
  comprehensive: {
    id: 'comprehensive',
    label: '综合研究',
    breadth: 4,
    depth: 3,
    maxResults: 6,
    searchDepth: 'advanced',
    queryHint: 'Cover definitions, current state, comparisons, risks, and practical implications.',
    reportFocus: '覆盖背景、证据、分歧、结论、局限和下一步建议。',
  },
  academic: {
    id: 'academic',
    label: '学术研究',
    breadth: 4,
    depth: 3,
    maxResults: 6,
    searchDepth: 'advanced',
    queryHint: 'Prefer papers, reviews, datasets, benchmarks, and reputable academic sources.',
    reportFocus: '强调方法、证据等级、研究局限、可复现实验和文献来源。',
    includeDomains: ['arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'nature.com', 'science.org', 'acm.org', 'ieee.org', 'semanticscholar.org'],
  },
  technical: {
    id: 'technical',
    label: '技术调研',
    breadth: 4,
    depth: 2,
    maxResults: 6,
    searchDepth: 'advanced',
    queryHint: 'Prefer official documentation, source repositories, release notes, issues, and implementation examples.',
    reportFocus: '强调架构、实现路径、依赖、兼容性、风险和可落地改造点。',
  },
  news: {
    id: 'news',
    label: '最新动态',
    breadth: 4,
    depth: 2,
    maxResults: 6,
    searchDepth: 'advanced',
    queryHint: 'Prioritize recent sources, dates, primary announcements, and independent confirmation.',
    reportFocus: '强调时间线、最新状态、来源发布时间和未确认信息。',
  },
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(value!)))
}

function extractJsonObject(text: string): Record<string, any> | null {
  const content = text.trim()
  if (!content) {
    return null
  }

  try {
    return JSON.parse(content)
  } catch {
    // continue
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // continue
    }
  }

  const objectMatch = content.match(/\{[\s\S]*\}/)
  if (!objectMatch) {
    return null
  }

  try {
    return JSON.parse(objectMatch[0])
  } catch {
    return null
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function createResearchId() {
  return `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ''
    parsed.searchParams.delete('utm_source')
    parsed.searchParams.delete('utm_medium')
    parsed.searchParams.delete('utm_campaign')
    parsed.searchParams.delete('utm_term')
    parsed.searchParams.delete('utm_content')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function clampScore(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(1, Math.max(0, parsed))
}

function estimateSourceCredibility(item: FirecrawlSearchItem) {
  const host = hostFromUrl(item.url || '')
  let score = 0.55

  if (/\.(gov|edu)$/i.test(host) || host.includes('arxiv.org') || host.includes('pubmed') || host.includes('github.com')) {
    score += 0.22
  }
  if (/(docs|developer|learn|support|help|official)/i.test(host) || /(official|documentation|release notes)/i.test(item.title || '')) {
    score += 0.12
  }
  if (item.publishedDate) {
    score += 0.05
  }
  if (typeof item.score === 'number') {
    score = (score + clampScore(item.score, score)) / 2
  }

  return clampScore(score, 0.55)
}

function buildSourceFromItem(item: FirecrawlSearchItem, engine: string, fallbackIndex: number): ResearchSource | null {
  const url = normalizeUrl(item.url || '')
  if (!url) {
    return null
  }

  const title = item.title?.trim() || hostFromUrl(url) || `Source ${fallbackIndex}`
  const snippet = (item.description || item.content || item.markdown || '').replace(/\r\n/g, '\n').trim()
  return {
    id: `S${fallbackIndex}`,
    title,
    url,
    engine,
    snippet: snippet ? trimText(snippet, 1200) : undefined,
    publishedAt: item.publishedDate,
    retrievedAt: new Date().toISOString(),
    credibilityScore: estimateSourceCredibility(item),
  }
}

function formatSourceForPrompt(source: ResearchSource, item: FirecrawlSearchItem, index: number) {
  const body = item.markdown || item.content || item.description || ''
  return [
    `<source index="${index}" id="${source.id}">`,
    `Title: ${source.title}`,
    `URL: ${source.url}`,
    `Engine: ${source.engine}`,
    source.publishedAt ? `Published: ${source.publishedAt}` : '',
    `Credibility: ${source.credibilityScore.toFixed(2)}`,
    trimText(body, MAX_CONTENT_CHARS_PER_ITEM),
    '</source>',
  ].filter(Boolean).join('\n')
}

function mergeSources(existing: ResearchSource[], incoming: ResearchSource[]) {
  const byUrl = new Map(existing.map(source => [normalizeUrl(source.url), source]))
  for (const source of incoming) {
    const key = normalizeUrl(source.url)
    const previous = byUrl.get(key)
    if (!previous) {
      byUrl.set(key, source)
      continue
    }
    previous.credibilityScore = Math.max(previous.credibilityScore, source.credibilityScore)
    previous.snippet = previous.snippet || source.snippet
    previous.publishedAt = previous.publishedAt || source.publishedAt
    previous.engine = uniqueStrings(`${previous.engine},${source.engine}`.split(',')).join(',')
  }

  return [...byUrl.values()].map((source, index) => ({
    ...source,
    id: `S${index + 1}`,
  }))
}

function remapEvidenceSources(evidences: ResearchEvidence[], sources: ResearchSource[]) {
  const byUrl = new Map(sources.map(source => [normalizeUrl(source.url), source]))

  return evidences
    .filter(evidence => evidence.claim.trim())
    .map((evidence) => {
      const source = byUrl.get(normalizeUrl(evidence.sourceUrl))
      if (!source) {
        return null
      }
      return {
        ...evidence,
        sourceId: source.id,
        sourceUrl: source.url,
        relevanceScore: clampScore(evidence.relevanceScore, 0.6),
      }
    })
    .filter((evidence): evidence is ResearchEvidence => !!evidence)
    .map((evidence, index) => ({
      ...evidence,
      id: `E${index + 1}`,
    }))
}

function trimText(text: string, limit: number) {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit).trim()}\n\n[truncated ${normalized.length - limit} chars]`
}

function getTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return ''
      }
      const text = (item as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function parseSearchItems(resultText: string): FirecrawlSearchItem[] {
  const parsed = extractJsonObject(resultText)
  const rawItems = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed)
        ? parsed
        : []

  return rawItems
    .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => ({
      title: typeof item.title === 'string' ? item.title : undefined,
      url: typeof item.url === 'string' ? item.url : undefined,
      markdown: typeof item.markdown === 'string' ? item.markdown : undefined,
      content: typeof item.content === 'string' ? item.content : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
    }))
}

function tavilyResultToSearchItems(results: Awaited<ReturnType<typeof searchWeb>>['results']): FirecrawlSearchItem[] {
  return results.map(result => ({
    title: result.title,
    url: result.url,
    markdown: result.content,
    content: result.content,
    score: result.score,
    publishedDate: result.publishedDate,
    provider: 'tavily',
  }))
}

function createTavilyProvider(): ResearchSearchProvider {
  return {
    name: 'tavily',
    async search(query, options) {
      const response = await searchWeb({
        query,
        maxResults: options.maxResults,
        searchDepth: options.searchDepth,
        includeAnswer: true,
        includeDomains: options.includeDomains,
        signal: options.abortSignal,
      })

      return tavilyResultToSearchItems(response.results).map(item => ({
        ...item,
        provider: response.provider,
      }))
    },
  }
}

function createFirecrawlProvider(binding: FirecrawlBinding): ResearchSearchProvider {
  return {
    name: `firecrawl:${binding.server.name || binding.server.id}`,
    async search(query) {
      const searchTimeout = 20000
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Firecrawl search timeout (20s)')), searchTimeout)
      })

      const result = await Promise.race([
        mcpServerManager.callTool(
          binding.server.id,
          binding.searchTool.name,
          buildSearchArgs(binding.searchTool, query)
        ),
        timeoutPromise,
      ]).finally(() => {
        clearTimeout(timer)
      })

      if (!result) {
        throw new Error('Firecrawl MCP returned an empty response.')
      }
      if (result.isError) {
        throw new Error(getTextContent(result) || `Firecrawl search failed for ${query}`)
      }

      const items = parseSearchItems(getTextContent(result))
      if (items.length === 0) {
        throw new Error('Firecrawl MCP response did not contain parseable search results.')
      }

      return items.map(item => ({
        ...item,
        provider: 'firecrawl',
      }))
    },
  }
}

async function buildSearchProviders(): Promise<ResearchSearchProvider[]> {
  const providers: ResearchSearchProvider[] = []

  try {
    const binding = await findFirecrawlBinding({ optional: true })
    if (binding) {
      providers.push(createFirecrawlProvider(binding))
    }
  } catch (error) {
    console.warn('[DeepResearch] Firecrawl provider unavailable:', error)
  }

  providers.push(createTavilyProvider())
  return providers
}

function buildSearchArgs(tool: MCPTool, query: string) {
  const properties = tool.inputSchema?.properties || {}
  const args: Record<string, unknown> = {}

  if ('query' in properties) {
    args.query = query
  } else if ('q' in properties) {
    args.q = query
  } else {
    args.query = query
  }

  if ('limit' in properties) {
    args.limit = 5
  }
  if ('timeout' in properties) {
    args.timeout = 15000
  }
  if ('scrapeOptions' in properties) {
    args.scrapeOptions = { formats: ['markdown'] }
  }
  if ('formats' in properties) {
    args.formats = ['markdown']
  }

  return args
}

async function ensureMcpInitialized() {
  const store = useMcpStore.getState()
  if (!store.initialized) {
    await store.initMcpData()
  } else {
    await store.loadMcpConfig()
  }
}

async function findFirecrawlBinding(options: { optional?: boolean } = {}): Promise<FirecrawlBinding | null> {
  await ensureMcpInitialized()
  const store = useMcpStore.getState()

  const firecrawlServers = store.servers.filter(server =>
    server.enabled && /firecrawl/i.test(`${server.name} ${server.command || ''} ${(server.args || []).join(' ')}`)
  )

  for (const server of firecrawlServers) {
    let state = store.getServerState(server.id)
    if (state?.status !== 'connected') {
      await mcpServerManager.connectServer(server)
      state = store.getServerState(server.id)
    }

    const tools = state?.tools || mcpServerManager.getServerTools(server.id)
    const searchTool = tools.find(tool => /search/i.test(tool.name))
    if (searchTool) {
      return { server, searchTool }
    }
  }

  if (options.optional) {
    return null
  }

  throw new Error('未找到可用的 Firecrawl MCP 搜索工具。请在 MCP 设置中启用 firecrawl-mcp，并确认它能正常连接。')
}

async function askJson(
  prompt: string,
  abortSignal?: AbortSignal
): Promise<Record<string, any> | null> {
  const aiConfig = await getAISettings()
  if (await validateAIService(aiConfig?.baseURL) === null) {
    return null
  }

  const openai = await createOpenAIClient(aiConfig)

  for (let attempt = 0; attempt <= ASK_JSON_MAX_RETRIES; attempt++) {
    abortSignal?.throwIfAborted()
    try {
      const completion = await openai.chat.completions.create({
        model: aiConfig?.model || '',
        messages: [
          {
            role: 'system',
            content: 'You are a careful deep research assistant. Return strict JSON only. Do not include markdown fences or any other text.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        top_p: aiConfig?.topP ?? 1,
      }, { signal: abortSignal }) as OpenAI.Chat.Completions.ChatCompletion

      const raw = completion.choices[0]?.message?.content || ''
      const parsed = extractJsonObject(raw)
      if (parsed) {
        return parsed
      }

      // JSON 解析失败，如果还有重试机会则继续
      if (attempt < ASK_JSON_MAX_RETRIES) {
        console.warn(`[DeepResearch] askJson parse failed (attempt ${attempt + 1}), retrying...`)
        continue
      }
    } catch (error) {
      // 网络或 API 错误，重试
      if (attempt < ASK_JSON_MAX_RETRIES) {
        console.warn(`[DeepResearch] askJson error (attempt ${attempt + 1}):`, error)
        // 短暂等待后重试
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      throw error
    }
  }

  return null
}

async function askText(
  prompt: string,
  abortSignal?: AbortSignal
): Promise<string> {
  const aiConfig = await getAISettings()
  if (await validateAIService(aiConfig?.baseURL) === null) {
    return ''
  }

  const openai = await createOpenAIClient(aiConfig)

  for (let attempt = 0; attempt <= ASK_JSON_MAX_RETRIES; attempt++) {
    abortSignal?.throwIfAborted()
    try {
      const completion = await openai.chat.completions.create({
        model: aiConfig?.model || '',
        messages: [
          {
            role: 'system',
            content: 'You are a careful deep research assistant. Write in Simplified Chinese. Cite sources by URL when available.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.35,
        top_p: aiConfig?.topP ?? 1,
      }, { signal: abortSignal }) as OpenAI.Chat.Completions.ChatCompletion

      const content = completion.choices[0]?.message?.content || ''
      if (content) {
        return content
      }

      if (attempt < ASK_JSON_MAX_RETRIES) {
        console.warn(`[DeepResearch] askText returned empty (attempt ${attempt + 1}), retrying...`)
        continue
      }
    } catch (error) {
      if (attempt < ASK_JSON_MAX_RETRIES) {
        console.warn(`[DeepResearch] askText error (attempt ${attempt + 1}):`, error)
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      throw error
    }
  }

  return ''
}

export async function generateResearchClarification(params: {
  query: string
  abortSignal?: AbortSignal
}): Promise<ResearchClarification> {
  const parsed = await askJson([
    'You are preparing a deep research task. Before searching the web, decide what clarification is needed.',
    'Return strict JSON: {"canStart":false,"questions":["..."],"researchBrief":"..."}',
    'Rules:',
    '- Ask 3 to 5 concrete questions in Simplified Chinese when the user request is broad, ambiguous, or missing audience/scope/output needs.',
    '- Questions should help clarify role, goal, scope, application scenario, depth, deliverable format, and constraints.',
    '- If the request is already sufficiently specific, set canStart=true and ask no questions.',
    '- researchBrief should summarize the current research intent and known constraints.',
    '',
    `<user_query>${params.query}</user_query>`,
  ].join('\n'), params.abortSignal)

  const questions = Array.isArray(parsed?.questions)
    ? parsed.questions.map(String).map(item => item.trim()).filter(Boolean).slice(0, 5)
    : []

  return {
    canStart: parsed?.canStart === true || questions.length === 0,
    questions,
    researchBrief: typeof parsed?.researchBrief === 'string' ? parsed.researchBrief.trim() : params.query,
  }
}

export async function completeResearchClarification(params: {
  originalQuery: string
  questions: string[]
  answer: string
  abortSignal?: AbortSignal
}): Promise<{ canStart: boolean; missingQuestions: string[]; researchBrief: string }> {
  const parsed = await askJson([
    'You are reviewing user answers before starting deep research.',
    'Return strict JSON: {"canStart":true,"missingQuestions":["..."],"researchBrief":"..."}',
    'Rules:',
    '- If the answer provides enough scope to start useful research, canStart=true.',
    '- If important information is still missing, ask at most 3 concrete missingQuestions in Simplified Chinese.',
    '- researchBrief must combine the original query, the clarification questions, and the user answer into a focused research plan.',
    '',
    `<original_query>${params.originalQuery}</original_query>`,
    '<clarification_questions>',
    params.questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    '</clarification_questions>',
    `<user_answer>${params.answer}</user_answer>`,
  ].join('\n'), params.abortSignal)

  const missingQuestions = Array.isArray(parsed?.missingQuestions)
    ? parsed.missingQuestions.map(String).map(item => item.trim()).filter(Boolean).slice(0, 3)
    : []

  return {
    canStart: parsed?.canStart === true || missingQuestions.length === 0,
    missingQuestions,
    researchBrief: typeof parsed?.researchBrief === 'string' ? parsed.researchBrief.trim() : [
      `Original query: ${params.originalQuery}`,
      `Clarification answer: ${params.answer}`,
    ].join('\n'),
  }
}

async function classifyResearchIntent(params: {
  query: string
  abortSignal?: AbortSignal
}): Promise<ResearchStrategyId> {
  const parsed = await askJson([
    'Classify this deep research task into exactly one strategy.',
    'Return strict JSON: {"strategy":"quick|comprehensive|academic|technical|news"}',
    'Guidance:',
    '- academic: papers, experiments, methods, clinical/scientific literature, datasets, benchmarks.',
    '- technical: programming, architecture, open-source projects, APIs, product implementation.',
    '- news: latest/current events, policies, companies, prices, releases, market changes.',
    '- quick: user asks for a short overview or simple comparison.',
    '- comprehensive: broad analysis, market research, decision support, or unclear depth.',
    '',
    `<user_query>${params.query}</user_query>`,
  ].join('\n'), params.abortSignal)

  const strategy = typeof parsed?.strategy === 'string' ? parsed.strategy : ''
  return strategy in STRATEGY_CONFIGS ? strategy as ResearchStrategyId : 'comprehensive'
}

async function generateSerpQueries(params: {
  query: string
  breadth: number
  learnings: string[]
  strategy: ResearchStrategyConfig
  abortSignal?: AbortSignal
}): Promise<SerpQuery[]> {
  const originalTopic = params.query.split('\n').find(line => line.trim())?.trim() || params.query.trim()
  const parsed = await askJson([
    `Generate up to ${params.breadth} diverse SERP queries for deep research about the user's exact topic.`,
    'Return JSON: {"queries":[{"query":"...","researchGoal":"..."}]}',
    'Hard rules:',
    '- Every query must be directly about the user prompt or a specific subtopic from previous learnings.',
    '- Do not invent unrelated example topics.',
    '- Include the core nouns/entities from the user prompt whenever possible.',
    `- Strategy: ${params.strategy.label}. ${params.strategy.queryHint}`,
    '- If the prompt is already clear, produce fewer focused queries.',
    'Each researchGoal should explain what this query should verify and what deeper direction it may open.',
    '',
    `<user_prompt>${params.query}</user_prompt>`,
    params.learnings.length > 0 ? `<previous_learnings>${params.learnings.join('\n')}</previous_learnings>` : '',
  ].join('\n'), params.abortSignal)

  const rawQueries = Array.isArray(parsed?.queries) ? parsed.queries : []
  const queries = rawQueries
    .map((item: unknown) => {
      const value = item as Partial<SerpQuery>
      return {
        query: typeof value.query === 'string' ? value.query.trim() : '',
        researchGoal: typeof value.researchGoal === 'string' ? value.researchGoal.trim() : '',
      }
    })
    .filter(item => item.query)
    .slice(0, params.breadth)

  if (queries.length === 0) {
    return [{ query: originalTopic, researchGoal: `Research the original user topic: ${originalTopic}` }]
  }

  return queries
}

async function processSerpResult(params: {
  query: string
  items: SearchHit[]
  sources: ResearchSource[]
  followUpCount: number
  abortSignal?: AbortSignal
}): Promise<ProcessedSerpResult> {
  const contents = params.items
    .map((item, index) => {
      const source = params.sources.find(source => source.id === item.sourceId)
      return source ? formatSourceForPrompt(source, item, index + 1) : ''
    })
    .filter(Boolean)
    .join('\n\n')

  if (!contents.trim()) {
    return { learnings: [], evidences: [], followUpQuestions: [] }
  }

  const parsed = await askJson([
    `Extract up to 4 unique learnings and up to 6 evidence claims from SERP results for query: ${params.query}`,
    `Also generate up to ${params.followUpCount} follow-up research questions.`,
    'Return JSON: {"learnings":["..."],"evidences":[{"sourceId":"S1","claim":"...","quote":"...","relevanceScore":0.8,"confidence":"high"}],"followUpQuestions":["..."]}',
    'Learnings must be concise, information dense, and include exact names, numbers, dates, and URLs when present.',
    'Evidence claims must stay grounded in one sourceId from the provided sources. Use confidence=low when the source is weak or only partially supports the claim.',
    '',
    contents,
  ].join('\n'), params.abortSignal)

  const sourceById = new Map(params.sources.map(source => [source.id, source]))
  const evidences = Array.isArray(parsed?.evidences)
    ? parsed.evidences
      .map((item: unknown) => {
        const value = item as Partial<ResearchEvidence>
        const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : ''
        const source = sourceById.get(sourceId)
        const confidence = value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low'
          ? value.confidence
          : 'medium'

        return {
          id: '',
          sourceId,
          sourceUrl: source?.url || '',
          claim: typeof value.claim === 'string' ? value.claim.trim() : '',
          quote: typeof value.quote === 'string' ? trimText(value.quote, 600) : undefined,
          relevanceScore: clampScore(value.relevanceScore, 0.65),
          confidence,
        } satisfies ResearchEvidence
      })
      .filter(item => item.claim && item.sourceUrl)
    : []

  return {
    learnings: Array.isArray(parsed?.learnings)
      ? parsed.learnings.map(String).filter(Boolean)
      : [],
    evidences,
    followUpQuestions: Array.isArray(parsed?.followUpQuestions)
      ? parsed.followUpQuestions.map(String).filter(Boolean)
      : [],
  }
}

async function runSearch(params: {
  providers: ResearchSearchProvider[]
  query: string
  strategy: ResearchStrategyConfig
  abortSignal?: AbortSignal
}): Promise<FirecrawlSearchItem[]> {
  const execute = (includeDomains?: string[]) => Promise.allSettled(
    params.providers.map(provider =>
      provider.search(params.query, {
        maxResults: params.strategy.maxResults,
        searchDepth: params.strategy.searchDepth,
        includeDomains,
        abortSignal: params.abortSignal,
      })
    )
  )

  let settled = await execute(params.strategy.includeDomains)
  const hasResults = settled.some(result => result.status === 'fulfilled' && result.value.length > 0)
  if (!hasResults && params.strategy.includeDomains?.length) {
    settled = await execute(undefined)
  }

  const merged: FirecrawlSearchItem[] = []
  const seen = new Set<string>()
  settled.forEach((result, index) => {
    const providerName = params.providers[index]?.name || 'unknown'
    if (result.status === 'rejected') {
      console.warn('[DeepResearch] Search provider failed:', providerName, result.reason)
      return
    }

    result.value.forEach(item => {
      const key = normalizeUrl(item.url || `${providerName}:${item.title || item.content || ''}`)
      if (!key || seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push({
        ...item,
        provider: item.provider || providerName,
      })
    })
  })

  return merged.slice(0, Math.max(params.strategy.maxResults, 8))
}

async function deepResearchRecursive(params: {
  providers: ResearchSearchProvider[]
  query: string
  strategy: ResearchStrategyConfig
  breadth: number
  depth: number
  totalDepth: number
  learnings: string[]
  sources: ResearchSource[]
  evidences: ResearchEvidence[]
  visitedUrls: string[]
  abortSignal?: AbortSignal
  onProgress?: (progress: DeepResearchProgress) => void
}): Promise<{ learnings: string[]; visitedUrls: string[]; sources: ResearchSource[]; evidences: ResearchEvidence[] }> {
  params.abortSignal?.throwIfAborted()
  params.onProgress?.({
    stage: 'planning',
    currentDepth: params.depth,
    totalDepth: params.totalDepth,
    currentBreadth: params.breadth,
    totalBreadth: params.breadth,
    completedQueries: 0,
    totalQueries: 0,
    learningsCount: params.learnings.length,
    visitedUrlsCount: params.visitedUrls.length,
    evidenceCount: params.evidences.length,
    strategy: params.strategy.id,
  })

  const serpQueries = await generateSerpQueries({
    query: params.query,
    breadth: params.breadth,
    learnings: params.learnings,
    strategy: params.strategy,
    abortSignal: params.abortSignal,
  })

  const nextBreadth = Math.max(1, Math.ceil(params.breadth / 2))
  const nextDepth = params.depth - 1
  const allLearnings = [...params.learnings]
  const allUrls = [...params.visitedUrls]
  let allSources = [...params.sources]
  let allEvidences = [...params.evidences]

  // 并行执行搜索，按 MAX_PARALLEL_SEARCHES 分批
  for (let batchStart = 0; batchStart < serpQueries.length; batchStart += MAX_PARALLEL_SEARCHES) {
    params.abortSignal?.throwIfAborted()
    const batch = serpQueries.slice(batchStart, batchStart + MAX_PARALLEL_SEARCHES)

    params.onProgress?.({
      stage: 'searching',
      currentDepth: params.depth,
      totalDepth: params.totalDepth,
      currentBreadth: params.breadth,
      totalBreadth: params.breadth,
      currentQuery: batch.map(q => q.query).join(' | '),
      completedQueries: batchStart,
      totalQueries: serpQueries.length,
      learningsCount: allLearnings.length,
      visitedUrlsCount: allUrls.length,
      evidenceCount: allEvidences.length,
      providerStatus: params.providers.map(provider => provider.name).join(', '),
      strategy: params.strategy.id,
    })

    const searchResults = await Promise.allSettled(
      batch.map(serpQuery => runSearch({
        providers: params.providers,
        query: serpQuery.query,
        strategy: params.strategy,
        abortSignal: params.abortSignal,
      }))
    )

    // 收集搜索结果
    const batchItems: { serpQuery: SerpQuery; items: SearchHit[]; sources: ResearchSource[] }[] = []
    for (let i = 0; i < batch.length; i++) {
      const result = searchResults[i]
      if (result.status === 'fulfilled' && result.value.length > 0) {
        const nextSources = result.value
          .map((item, index) => buildSourceFromItem(item, item.provider || 'web', allSources.length + index + 1))
          .filter((source): source is ResearchSource => !!source)
        allSources = mergeSources(allSources, nextSources)
        const sourceByUrl = new Map(allSources.map(source => [normalizeUrl(source.url), source.id]))
        const items = result.value
          .map(item => ({
            ...item,
            sourceId: sourceByUrl.get(normalizeUrl(item.url || '')) || '',
          }))
          .filter(item => item.sourceId)

        batchItems.push({
          serpQuery: batch[i],
          items,
          sources: allSources.filter(source => items.some(item => item.sourceId === source.id)),
        })
        allUrls.push(...items.map(item => item.url || '').filter(Boolean).map(normalizeUrl))
      } else if (result.status === 'rejected') {
        console.warn('[DeepResearch] Search failed:', batch[i].query, result.reason)
      }
    }

    if (batchItems.length === 0) continue

    params.onProgress?.({
      stage: 'analyzing',
      currentDepth: params.depth,
      totalDepth: params.totalDepth,
      currentBreadth: params.breadth,
      totalBreadth: params.breadth,
      currentQuery: batchItems.map(b => b.serpQuery.query).join(' | '),
      completedQueries: batchStart + batch.length,
      totalQueries: serpQueries.length,
      learningsCount: allLearnings.length,
      visitedUrlsCount: allUrls.length,
      evidenceCount: allEvidences.length,
      strategy: params.strategy.id,
    })

    const analysisResults = await Promise.allSettled(
      batchItems.map(({ serpQuery, items, sources }) =>
        processSerpResult({
          query: serpQuery.query,
          items,
          sources,
          followUpCount: nextBreadth,
          abortSignal: params.abortSignal,
        })
      )
    )

    // 收集分析结果和追问方向
    const followUpTasks: { serpQuery: SerpQuery; questions: string[] }[] = []
    for (let i = 0; i < analysisResults.length; i++) {
      const result = analysisResults[i]
      if (result.status === 'fulfilled') {
        allLearnings.push(...result.value.learnings)
        allEvidences.push(...result.value.evidences)
        if (nextDepth > 0 && result.value.followUpQuestions.length > 0) {
          followUpTasks.push({
            serpQuery: batchItems[i].serpQuery,
            questions: result.value.followUpQuestions,
          })
        }
      }
    }

    // 递归深入（串行，避免过多并发 API 调用）
    for (const task of followUpTasks) {
      params.abortSignal?.throwIfAborted()
      const nextQuery = [
        `Previous research goal: ${task.serpQuery.researchGoal}`,
        'Follow-up research directions:',
        ...task.questions.map(question => `- ${question}`),
      ].join('\n')

      try {
        const deeper = await deepResearchRecursive({
          ...params,
          query: nextQuery,
          breadth: nextBreadth,
          depth: nextDepth,
          learnings: uniqueStrings(allLearnings),
          sources: allSources,
          evidences: remapEvidenceSources(allEvidences, allSources),
          visitedUrls: uniqueStrings(allUrls),
        })
        allLearnings.push(...deeper.learnings)
        allUrls.push(...deeper.visitedUrls)
        allSources = mergeSources(allSources, deeper.sources)
        allEvidences.push(...deeper.evidences)
      } catch (error) {
        console.warn('[DeepResearch] Recursive research failed:', error)
      }
    }

    params.onProgress?.({
      stage: 'searching',
      currentDepth: params.depth,
      totalDepth: params.totalDepth,
      currentBreadth: params.breadth,
      totalBreadth: params.breadth,
      currentQuery: batch[batch.length - 1]?.query,
      completedQueries: batchStart + batch.length,
      totalQueries: serpQueries.length,
      learningsCount: allLearnings.length,
      visitedUrlsCount: allUrls.length,
      evidenceCount: allEvidences.length,
      strategy: params.strategy.id,
    })
  }

  allSources = mergeSources(allSources, [])
  allEvidences = remapEvidenceSources(allEvidences, allSources)

  return {
    learnings: uniqueStrings(allLearnings),
    visitedUrls: uniqueStrings(allUrls),
    sources: allSources,
    evidences: allEvidences,
  }
}

function buildEvidenceSupportSummary(sources: ResearchSource[], evidences: ResearchEvidence[]) {
  const sourceById = new Map(sources.map(source => [source.id, source]))
  const hostCounts = new Map<string, number>()
  evidences.forEach(evidence => {
    const source = sourceById.get(evidence.sourceId)
    const host = source ? hostFromUrl(source.url) : ''
    if (host) {
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1)
    }
  })

  const independentHosts = hostCounts.size
  const highConfidence = evidences.filter(evidence => evidence.confidence === 'high').length
  const weakEvidence = evidences.filter(evidence => evidence.confidence === 'low').length

  return [
    `Independent source domains: ${independentHosts}`,
    `High confidence evidence items: ${highConfidence}`,
    `Low confidence evidence items: ${weakEvidence}`,
    independentHosts < 2 ? 'Warning: fewer than two independent source domains were found; mark major conclusions as single-source or low-confidence.' : '',
  ].filter(Boolean).join('\n')
}

function formatEvidenceForReport(sources: ResearchSource[], evidences: ResearchEvidence[]) {
  const sourceById = new Map(sources.map(source => [source.id, source]))
  return evidences.slice(0, MAX_EVIDENCES_FOR_REPORT).map(evidence => {
    const source = sourceById.get(evidence.sourceId)
    return [
      `<evidence id="${evidence.id}" sourceId="${evidence.sourceId}" confidence="${evidence.confidence}" relevance="${evidence.relevanceScore.toFixed(2)}">`,
      `Claim: ${evidence.claim}`,
      evidence.quote ? `Quote: ${evidence.quote}` : '',
      source ? `Source: ${source.title} (${source.url})` : '',
      source?.publishedAt ? `Published: ${source.publishedAt}` : '',
      '</evidence>',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

function appendFallbackSourceSection(report: string, sources: ResearchSource[]) {
  if (report.includes('## 来源') || sources.length === 0) {
    return report.trim()
  }

  return `${report.trim()}\n\n## 来源\n\n${sources.map(source => `- [${source.id}] ${source.title}：${source.url}`).join('\n')}`
}

export async function runDeepResearch(params: {
  query: string
  breadth?: number
  depth?: number
  abortSignal?: AbortSignal
  onProgress?: (progress: DeepResearchProgress) => void
}): Promise<DeepResearchResult> {
  const startedAt = new Date().toISOString()
  const strategyId = await classifyResearchIntent({
    query: params.query,
    abortSignal: params.abortSignal,
  })
  const strategy = STRATEGY_CONFIGS[strategyId]
  const breadth = clampInteger(params.breadth, strategy.breadth || DEFAULT_BREADTH, 1, 6)
  const depth = clampInteger(params.depth, strategy.depth || DEFAULT_DEPTH, 1, 4)
  const providers = await buildSearchProviders()

  params.onProgress?.({
    stage: 'initializing',
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    completedQueries: 0,
    totalQueries: 0,
    learningsCount: 0,
    visitedUrlsCount: 0,
    evidenceCount: 0,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  const result = await deepResearchRecursive({
    providers,
    query: params.query,
    strategy,
    breadth,
    depth,
    totalDepth: depth,
    learnings: [],
    sources: [],
    evidences: [],
    visitedUrls: [],
    abortSignal: params.abortSignal,
    onProgress: params.onProgress,
  })

  const sources = mergeSources(result.sources, [])
  const evidences = remapEvidenceSources(result.evidences, sources)

  params.onProgress?.({
    stage: 'verifying',
    currentDepth: 0,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    completedQueries: 0,
    totalQueries: 0,
    learningsCount: result.learnings.length,
    visitedUrlsCount: result.visitedUrls.length,
    evidenceCount: evidences.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  params.onProgress?.({
    stage: 'writing',
    currentDepth: 0,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    completedQueries: 0,
    totalQueries: 0,
    learningsCount: result.learnings.length,
    visitedUrlsCount: result.visitedUrls.length,
    evidenceCount: evidences.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  const learnings = result.learnings.slice(0, MAX_LEARNINGS_FOR_REPORT)
  const report = await askText([
    'Write a detailed deep research report in Markdown for the user query.',
    'Requirements:',
    '- Use Simplified Chinese.',
    `- Research strategy: ${strategy.label}. ${strategy.reportFocus}`,
    '- Include an executive summary, key findings, detailed analysis, confidence/limitations, and source list.',
    '- Ground every major claim in the provided evidences and cite source IDs inline like [S1].',
    '- If a key conclusion has only one independent source or low confidence evidence, explicitly mark it as single-source or uncertain.',
    '- Preserve concrete names, numbers, dates, and URLs.',
    '',
    `<user_query>${params.query}</user_query>`,
    '<verification_summary>',
    buildEvidenceSupportSummary(sources, evidences),
    '</verification_summary>',
    '<sources>',
    sources.map(source => [
      `[${source.id}] ${source.title}`,
      `URL: ${source.url}`,
      `Engine: ${source.engine}`,
      `Credibility: ${source.credibilityScore.toFixed(2)}`,
      source.publishedAt ? `Published: ${source.publishedAt}` : '',
    ].filter(Boolean).join('\n')).join('\n\n'),
    '</sources>',
    '<evidences>',
    formatEvidenceForReport(sources, evidences),
    '</evidences>',
    '<learnings>',
    learnings.map(learning => `<learning>${learning}</learning>`).join('\n'),
    '</learnings>',
  ].join('\n'), params.abortSignal)

  params.onProgress?.({
    stage: 'done',
    currentDepth: 0,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    completedQueries: 0,
    totalQueries: 0,
    learningsCount: result.learnings.length,
    visitedUrlsCount: result.visitedUrls.length,
    evidenceCount: evidences.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  const visitedUrls = uniqueStrings(sources.map(source => source.url).concat(result.visitedUrls))
  const session: ResearchSession = {
    id: createResearchId(),
    query: params.query,
    strategy: strategy.id,
    startedAt,
    completedAt: new Date().toISOString(),
    searchProviders: providers.map(provider => provider.name),
    sources,
    evidences,
    learnings: result.learnings,
    visitedUrls,
  }

  return {
    report: appendFallbackSourceSection(report, sources),
    learnings: result.learnings,
    visitedUrls,
    sources,
    evidences,
    session,
  }
}
