import OpenAI from 'openai'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import type { MCPServerConfig, MCPTool } from '@/lib/mcp/types'
import { useMcpStore } from '@/stores/mcp'
import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import { searchWeb } from '@/lib/tavily'

type SerpQuery = {
  query: string
  researchGoal: string
}

type ProcessedSerpResult = {
  learnings: string[]
  followUpQuestions: string[]
}

type FirecrawlSearchItem = {
  title?: string
  url?: string
  markdown?: string
  content?: string
  description?: string
}

type FirecrawlBinding = {
  server: MCPServerConfig
  searchTool: MCPTool
}

export type DeepResearchProgress = {
  stage: 'initializing' | 'planning' | 'searching' | 'analyzing' | 'writing' | 'done'
  currentDepth: number
  totalDepth: number
  currentBreadth: number
  totalBreadth: number
  currentQuery?: string
  completedQueries: number
  totalQueries: number
  learningsCount: number
  visitedUrlsCount: number
  estimatedMinutes?: string
}

export type DeepResearchResult = {
  report: string
  learnings: string[]
  visitedUrls: string[]
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
const MAX_PARALLEL_SEARCHES = 3
const ASK_JSON_MAX_RETRIES = 2

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
  }))
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

async function findFirecrawlBinding(): Promise<FirecrawlBinding> {
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

async function generateSerpQueries(params: {
  query: string
  breadth: number
  learnings: string[]
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
  items: FirecrawlSearchItem[]
  followUpCount: number
  abortSignal?: AbortSignal
}): Promise<ProcessedSerpResult> {
  const contents = params.items
    .map((item, index) => {
      const body = item.markdown || item.content || item.description || ''
      return [
        `<content index="${index + 1}">`,
        item.title ? `Title: ${item.title}` : '',
        item.url ? `URL: ${item.url}` : '',
        trimText(body, MAX_CONTENT_CHARS_PER_ITEM),
        '</content>',
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')

  if (!contents.trim()) {
    return { learnings: [], followUpQuestions: [] }
  }

  const parsed = await askJson([
    `Extract up to 4 unique learnings from SERP results for query: ${params.query}`,
    `Also generate up to ${params.followUpCount} follow-up research questions.`,
    'Return JSON: {"learnings":["..."],"followUpQuestions":["..."]}',
    'Learnings must be concise, information dense, and include exact names, numbers, dates, and URLs when present.',
    '',
    contents,
  ].join('\n'), params.abortSignal)

  return {
    learnings: Array.isArray(parsed?.learnings)
      ? parsed.learnings.map(String).filter(Boolean)
      : [],
    followUpQuestions: Array.isArray(parsed?.followUpQuestions)
      ? parsed.followUpQuestions.map(String).filter(Boolean)
      : [],
  }
}

async function runSearch(binding: FirecrawlBinding, query: string) {
  const searchTimeout = 20000 // 20 秒超时

  try {
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
    if (items.length > 0) {
      return items
    }

    throw new Error('Firecrawl MCP response did not contain parseable search results.')
  } catch (error) {
    // 某些 MCP 底层错误可能 reject 非 Error 对象（如 Event）
    const errorMsg = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown search error'
    console.warn('[DeepResearch] Firecrawl search failed, falling back to web search:', errorMsg)
    const fallback = await searchWeb({
      query,
      maxResults: 5,
      includeAnswer: true,
    })
    return tavilyResultToSearchItems(fallback.results)
  }
}

async function deepResearchRecursive(params: {
  binding: FirecrawlBinding
  query: string
  breadth: number
  depth: number
  totalDepth: number
  learnings: string[]
  visitedUrls: string[]
  abortSignal?: AbortSignal
  onProgress?: (progress: DeepResearchProgress) => void
}): Promise<{ learnings: string[]; visitedUrls: string[] }> {
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
  })

  const serpQueries = await generateSerpQueries({
    query: params.query,
    breadth: params.breadth,
    learnings: params.learnings,
    abortSignal: params.abortSignal,
  })

  const nextBreadth = Math.max(1, Math.ceil(params.breadth / 2))
  const nextDepth = params.depth - 1
  const allLearnings = [...params.learnings]
  const allUrls = [...params.visitedUrls]

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
    })

    // 并行搜索
    const searchResults = await Promise.allSettled(
      batch.map(serpQuery => runSearch(params.binding, serpQuery.query))
    )

    // 收集搜索结果
    const batchItems: { serpQuery: SerpQuery; items: FirecrawlSearchItem[] }[] = []
    for (let i = 0; i < batch.length; i++) {
      const result = searchResults[i]
      if (result.status === 'fulfilled' && result.value.length > 0) {
        batchItems.push({ serpQuery: batch[i], items: result.value })
        allUrls.push(...result.value.map(item => item.url || '').filter(Boolean))
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
    })

    // 并行分析搜索结果
    const analysisResults = await Promise.allSettled(
      batchItems.map(({ serpQuery, items }) =>
        processSerpResult({
          query: serpQuery.query,
          items,
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
          visitedUrls: uniqueStrings(allUrls),
        })
        allLearnings.push(...deeper.learnings)
        allUrls.push(...deeper.visitedUrls)
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
    })
  }

  return {
    learnings: uniqueStrings(allLearnings),
    visitedUrls: uniqueStrings(allUrls),
  }
}

export async function runDeepResearch(params: {
  query: string
  breadth?: number
  depth?: number
  abortSignal?: AbortSignal
  onProgress?: (progress: DeepResearchProgress) => void
}): Promise<DeepResearchResult> {
  const breadth = clampInteger(params.breadth, DEFAULT_BREADTH, 1, 6)
  const depth = clampInteger(params.depth, DEFAULT_DEPTH, 1, 4)

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
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  const binding = await findFirecrawlBinding()
  const result = await deepResearchRecursive({
    binding,
    query: params.query,
    breadth,
    depth,
    totalDepth: depth,
    learnings: [],
    visitedUrls: [],
    abortSignal: params.abortSignal,
    onProgress: params.onProgress,
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
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  const learnings = result.learnings.slice(0, MAX_LEARNINGS_FOR_REPORT)
  const report = await askText([
    'Write a detailed deep research report in Markdown for the user query.',
    'Requirements:',
    '- Use Simplified Chinese.',
    '- Include an executive summary, key findings, detailed analysis, limitations, and source list.',
    '- Ground every major claim in the provided learnings.',
    '- Preserve concrete names, numbers, dates, and URLs.',
    '',
    `<user_query>${params.query}</user_query>`,
    '<learnings>',
    learnings.map(learning => `<learning>${learning}</learning>`).join('\n'),
    '</learnings>',
    '<visited_urls>',
    result.visitedUrls.map(url => `- ${url}`).join('\n'),
    '</visited_urls>',
  ].join('\n'), params.abortSignal)

  const sourceSection = result.visitedUrls.length > 0
    ? `\n\n## 来源\n\n${result.visitedUrls.map(url => `- ${url}`).join('\n')}`
    : ''

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
    estimatedMinutes: `${Math.max(3, depth * breadth)}-${Math.max(5, depth * breadth * 2)} 分钟`,
  })

  return {
    report: `${report.trim()}${report.includes('## 来源') ? '' : sourceSection}`.trim(),
    learnings: result.learnings,
    visitedUrls: result.visitedUrls,
  }
}
