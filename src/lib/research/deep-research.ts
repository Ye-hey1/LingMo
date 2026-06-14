import OpenAI from 'openai'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import type { MCPServerConfig, MCPTool } from '@/lib/mcp/types'
import { useMcpStore } from '@/stores/mcp'
import useSettingStore from '@/stores/setting'
import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import { buildXiaoMoDeepResearchSystemPrompt } from '@/lib/ai/xiaomo-prompt'
import { tavilyExtract, requestDuckDuckGoFallback, searchWeb, type TavilySearchDepth } from '@/lib/tavily'
import type { AgentEventBus } from '@/lib/agent'
import { saveSessionState, loadSessionState } from './session-store'
import { assessResearchQuality, type ResearchQualityScore } from './research-enhancements'

interface ProviderState {
  name: string
  failureCount: number
  lastFailureTime: number
  isBroken: boolean
  responseTime: number
}

export type ResearchProviderHealth = ProviderState

class SearchProviderRegistry {
  private states = new Map<string, ProviderState>()
  private cooldownMs = 5 * 60 * 1000 // 5分钟

  recordSuccess(name: string, responseTime: number) {
    const state = this.getOrCreateState(name)
    state.failureCount = 0
    state.isBroken = false
    state.responseTime = responseTime
  }

  recordFailure(name: string, responseTime: number) {
    const state = this.getOrCreateState(name)
    state.failureCount++
    state.lastFailureTime = Date.now()
    state.responseTime = responseTime
    if (state.failureCount >= 3) {
      state.isBroken = true
      console.warn(`[DeepResearch] Provider ${name} has been tripped due to 3 consecutive failures.`)
    }
  }

  isBroken(name: string): boolean {
    const state = this.getOrCreateState(name)
    if (state.isBroken) {
      if (Date.now() - state.lastFailureTime > this.cooldownMs) {
        state.isBroken = false
        state.failureCount = 0
        return false
      }
      return true
    }
    return false
  }

  getOrCreateState(name: string): ProviderState {
    let state = this.states.get(name)
    if (!state) {
      state = { name, failureCount: 0, lastFailureTime: 0, isBroken: false, responseTime: 0 }
      this.states.set(name, state)
    }
    return state
  }

  snapshot(names?: string[]): ResearchProviderHealth[] {
    const targets = names?.length
      ? names.map(name => this.getOrCreateState(name))
      : Array.from(this.states.values())

    return targets.map(state => ({ ...state }))
  }
}

export const searchProviderRegistry = new SearchProviderRegistry()

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

type EvidenceStats = {
  total: number
  highConfidence: number
  mediumConfidence: number
  lowConfidence: number
  singleSourceClaims: number
  conflictingClaims: number
  confirmedClaims: number
}

export type ResearchLocalSourceInput = {
  title: string
  content: string
  url?: string
  sourceType?: 'current' | 'linked' | 'quote' | 'rag' | 'local'
  path?: string
  startLine?: number
  endLine?: number
}

export type ResearchLocalContext = {
  brief: string
  sources: ResearchLocalSourceInput[]
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
  sourceCount?: number
  confirmedClaimsCount?: number
  disputedClaimsCount?: number
  lowConfidenceCount?: number
  singleSourceCount?: number
  localSourcesCount?: number
  providerStatus?: string
  strategy?: ResearchStrategyId
  estimatedMinutes?: string
  cacheHits?: number
  cacheMisses?: number
  providerHealth?: ResearchProviderHealth[]
}

export type BuiltInResearchStrategyId = 'quick' | 'comprehensive' | 'academic' | 'technical' | 'news'
export type ResearchStrategyId = BuiltInResearchStrategyId | (string & {})

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
  quality?: ResearchQualityScore
  breadth?: number
  depth?: number
  cacheStats?: ResearchSearchCacheStats
  providerHealth?: ResearchProviderHealth[]
}

export type DeepResearchResult = {
  report: string
  learnings: string[]
  visitedUrls: string[]
  sources: ResearchSource[]
  evidences: ResearchEvidence[]
  session: ResearchSession
  quality?: ResearchQualityScore
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
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 250

export type ResearchSearchCacheStats = {
  hits: number
  misses: number
  writes: number
  bypasses: number
}

export type ResearchStrategyConfig = {
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

const STRATEGY_CONFIGS: Record<BuiltInResearchStrategyId, ResearchStrategyConfig> = {
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

function cloneResearchStrategyConfig(config: ResearchStrategyConfig): ResearchStrategyConfig {
  return {
    ...config,
    includeDomains: config.includeDomains ? [...config.includeDomains] : undefined,
  }
}

class ResearchStrategyRegistry {
  private configs = new Map<ResearchStrategyId, ResearchStrategyConfig>()

  constructor(defaults: Record<BuiltInResearchStrategyId, ResearchStrategyConfig>) {
    Object.values(defaults).forEach(config => {
      this.configs.set(config.id, cloneResearchStrategyConfig(config))
    })
  }

  has(id: string): id is ResearchStrategyId {
    return this.configs.has(id as ResearchStrategyId)
  }

  get(id: ResearchStrategyId | string, fallback: ResearchStrategyId = 'comprehensive'): ResearchStrategyConfig {
    const config = this.configs.get(id as ResearchStrategyId)
      || this.configs.get(fallback)
      || STRATEGY_CONFIGS.comprehensive
    return cloneResearchStrategyConfig(config)
  }

  list(): ResearchStrategyConfig[] {
    return Array.from(this.configs.values()).map(cloneResearchStrategyConfig)
  }

  register(config: ResearchStrategyConfig): ResearchStrategyConfig {
    const normalized: ResearchStrategyConfig = {
      ...cloneResearchStrategyConfig(config),
      breadth: clampInteger(config.breadth, DEFAULT_BREADTH, 1, 6),
      depth: clampInteger(config.depth, DEFAULT_DEPTH, 1, 4),
      maxResults: clampInteger(config.maxResults, 6, 1, 10),
    }
    this.configs.set(normalized.id, normalized)
    return cloneResearchStrategyConfig(normalized)
  }
}

export const researchStrategyRegistry = new ResearchStrategyRegistry(STRATEGY_CONFIGS)

export function registerResearchStrategy(config: ResearchStrategyConfig): ResearchStrategyConfig {
  return researchStrategyRegistry.register(config)
}

export function getResearchStrategyConfig(id: ResearchStrategyId | string): ResearchStrategyConfig {
  return researchStrategyRegistry.get(id)
}

export function listResearchStrategies(): ResearchStrategyConfig[] {
  return researchStrategyRegistry.list()
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

function createResearchSearchCacheStats(): ResearchSearchCacheStats {
  return {
    hits: 0,
    misses: 0,
    writes: 0,
    bypasses: 0,
  }
}

function snapshotSearchCacheStats(stats: ResearchSearchCacheStats): ResearchSearchCacheStats {
  return { ...stats }
}

type ResearchSearchCacheEntry = {
  expiresAt: number
  results: FirecrawlSearchItem[]
}

const researchSearchCache = new Map<string, ResearchSearchCacheEntry>()
const researchSearchInflight = new Map<string, Promise<FirecrawlSearchItem[]>>()

function cloneSearchItems(items: FirecrawlSearchItem[]): FirecrawlSearchItem[] {
  return items.map(item => ({ ...item }))
}

function buildResearchSearchCacheKey(input: {
  providerName: string
  query: string
  maxResults: number
  searchDepth: TavilySearchDepth
  includeDomains?: string[]
}) {
  return JSON.stringify({
    provider: input.providerName,
    query: input.query.replace(/\s+/g, ' ').trim().toLowerCase(),
    maxResults: input.maxResults,
    searchDepth: input.searchDepth,
    includeDomains: [...(input.includeDomains || [])].map(domain => domain.toLowerCase()).sort(),
  })
}

function trimResearchSearchCache(now = Date.now()) {
  for (const [key, entry] of researchSearchCache) {
    if (entry.expiresAt <= now) {
      researchSearchCache.delete(key)
    }
  }

  while (researchSearchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = researchSearchCache.keys().next().value
    if (!oldestKey) break
    researchSearchCache.delete(oldestKey)
  }
}

async function searchProviderWithCache(input: {
  provider: ResearchSearchProvider
  query: string
  options: Parameters<ResearchSearchProvider['search']>[1]
  stats: ResearchSearchCacheStats
}): Promise<FirecrawlSearchItem[]> {
  input.options.abortSignal?.throwIfAborted()

  const cacheKey = buildResearchSearchCacheKey({
    providerName: input.provider.name,
    query: input.query,
    maxResults: input.options.maxResults,
    searchDepth: input.options.searchDepth,
    includeDomains: input.options.includeDomains,
  })
  const now = Date.now()
  trimResearchSearchCache(now)

  const cached = researchSearchCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    input.stats.hits += 1
    return cloneSearchItems(cached.results)
  }

  const inflight = researchSearchInflight.get(cacheKey)
  if (inflight) {
    input.stats.hits += 1
    return cloneSearchItems(await inflight)
  }

  input.stats.misses += 1
  const request = input.provider.search(input.query, input.options)
    .then(results => {
      const normalized = cloneSearchItems(results)
      researchSearchCache.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        results: normalized,
      })
      input.stats.writes += 1
      trimResearchSearchCache()
      return cloneSearchItems(normalized)
    })
    .finally(() => {
      researchSearchInflight.delete(cacheKey)
    })

  researchSearchInflight.set(cacheKey, request)
  return request
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

function createLocalResearchInputs(localContext?: ResearchLocalContext): {
  sources: ResearchSource[]
  evidences: ResearchEvidence[]
  learnings: string[]
} {
  if (!localContext || (!localContext.brief.trim() && localContext.sources.length === 0)) {
    return { sources: [], evidences: [], learnings: [] }
  }

  const retrievedAt = new Date().toISOString()
  const localSources = localContext.sources
    .map((source, index): ResearchSource | null => {
      const title = source.title.trim() || source.path || `本地材料 ${index + 1}`
      const content = source.content.replace(/\r\n/g, '\n').trim()
      if (!title && !content) {
        return null
      }

      const sourceKind = source.sourceType || 'local'
      const url = source.url || `local:${sourceKind}:${encodeURIComponent(source.path || title || String(index + 1))}`
      return {
        id: `S${index + 1}`,
        title,
        url,
        engine: `local:${sourceKind}`,
        snippet: content ? trimText(content, 1200) : undefined,
        retrievedAt,
        credibilityScore: sourceKind === 'quote' || sourceKind === 'current' ? 0.78 : 0.7,
      }
    })
    .filter((source): source is ResearchSource => !!source)

  const evidences = localSources
    .filter(source => source.snippet?.trim())
    .map((source, index): ResearchEvidence => ({
      id: `E${index + 1}`,
      sourceId: source.id,
      sourceUrl: source.url,
      claim: `本地材料「${source.title}」包含与研究问题相关的上下文，应作为研究 brief 的事实背景参与分析。`,
      quote: source.snippet ? trimText(source.snippet, 600) : undefined,
      relevanceScore: 0.75,
      confidence: 'medium',
    }))

  const learnings = [
    localContext.brief.trim() ? `本地研究 brief：${trimText(localContext.brief, 800)}` : '',
    ...localSources.map(source => `本地来源：${source.title}${source.snippet ? ` - ${trimText(source.snippet, 240)}` : ''}`),
  ].filter(Boolean)

  return { sources: localSources, evidences, learnings }
}

function formatLocalContextForPrompt(localContext?: ResearchLocalContext) {
  if (!localContext || (!localContext.brief.trim() && localContext.sources.length === 0)) {
    return ''
  }

  const sourceBlocks = localContext.sources
    .filter(source => source.title.trim() || source.content.trim())
    .slice(0, 12)
    .map((source, index) => [
      `<local_source index="${index + 1}" type="${source.sourceType || 'local'}">`,
      `Title: ${source.title || source.path || `本地材料 ${index + 1}`}`,
      source.path ? `Path: ${source.path}` : '',
      source.startLine && source.endLine ? `Lines: ${source.startLine}-${source.endLine}` : '',
      trimText(source.content, 2000),
      '</local_source>',
    ].filter(Boolean).join('\n'))

  return [
    '<local_research_brief>',
    localContext.brief ? trimText(localContext.brief, 5000) : '',
    sourceBlocks.join('\n\n'),
    '</local_research_brief>',
  ].filter(Boolean).join('\n')
}

function computeEvidenceStats(evidences: ResearchEvidence[]): EvidenceStats {
  const normalizedClaims = new Map<string, {
    sources: Set<string>
    low: number
    high: number
    total: number
  }>()

  for (const evidence of evidences) {
    const key = evidence.claim
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      .slice(0, 80)
      .toLowerCase()
    const entry = normalizedClaims.get(key) || {
      sources: new Set<string>(),
      low: 0,
      high: 0,
      total: 0,
    }
    entry.sources.add(hostFromUrl(evidence.sourceUrl) || evidence.sourceUrl)
    entry.total += 1
    if (evidence.confidence === 'low') entry.low += 1
    if (evidence.confidence === 'high') entry.high += 1
    normalizedClaims.set(key, entry)
  }

  let singleSourceClaims = 0
  let confirmedClaims = 0
  normalizedClaims.forEach(entry => {
    if (entry.sources.size <= 1) {
      singleSourceClaims += 1
    }
    if (entry.sources.size >= 2 && entry.low === 0) {
      confirmedClaims += 1
    }
  })

  const lowConfidence = evidences.filter(evidence => evidence.confidence === 'low').length
  return {
    total: evidences.length,
    highConfidence: evidences.filter(evidence => evidence.confidence === 'high').length,
    mediumConfidence: evidences.filter(evidence => evidence.confidence === 'medium').length,
    lowConfidence,
    singleSourceClaims,
    conflictingClaims: 0,
    confirmedClaims,
  }
}

function buildProgressStats(sources: ResearchSource[], evidences: ResearchEvidence[], localSourcesCount = 0, override?: Partial<EvidenceStats>) {
  const stats = {
    ...computeEvidenceStats(evidences),
    ...override,
  }

  return {
    sourceCount: sources.length,
    evidenceCount: evidences.length,
    confirmedClaimsCount: stats.confirmedClaims,
    disputedClaimsCount: stats.conflictingClaims,
    lowConfidenceCount: stats.lowConfidence,
    singleSourceCount: stats.singleSourceClaims,
    localSourcesCount,
  }
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

function parseUnknownSearchItems(payload: unknown): FirecrawlSearchItem[] {
  if (!payload) {
    return []
  }

  const rawItems = Array.isArray(payload)
    ? payload
    : typeof payload === 'object'
      ? Array.isArray((payload as { results?: unknown }).results)
        ? (payload as { results: unknown[] }).results
        : Array.isArray((payload as { data?: unknown }).data)
          ? (payload as { data: unknown[] }).data
          : Array.isArray((payload as { organic_results?: unknown }).organic_results)
            ? (payload as { organic_results: unknown[] }).organic_results
            : []
      : []

  return rawItems
    .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => {
      const title = firstString(item.title, item.name)
      const url = firstString(item.url, item.link)
      const content = firstString(item.text, item.content, item.snippet, item.description)
      return {
        title,
        url,
        markdown: content,
        content,
        description: firstString(item.snippet, item.description),
        score: typeof item.score === 'number' ? item.score : undefined,
        publishedDate: firstString(item.publishedDate, item.published_date, item.date),
      }
    })
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
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

function createDuckDuckGoProvider(): ResearchSearchProvider {
  return {
    name: 'duckduckgo',
    async search(query, options) {
      const response = await requestDuckDuckGoFallback(
        query,
        options.maxResults,
        options.includeDomains,
        undefined,
        options.abortSignal
      )
      return response.results.map(result => ({
        title: result.title,
        url: result.url,
        markdown: result.content,
        content: result.content,
        score: result.score || 0.5,
        publishedDate: result.publishedDate,
        provider: 'duckduckgo',
      }))
    }
  }
}

function createTavilyProvider(): ResearchSearchProvider {
  const ddg = createDuckDuckGoProvider()
  return {
    name: 'tavily',
    async search(query, options) {
      // 检查 Tavily 熔断器状态
      const isTripped = searchProviderRegistry.isBroken('tavily')
      if (isTripped) {
        console.warn('[DeepResearch] Tavily 处于熔断中，自动降级为 DuckDuckGo 搜索')
        return ddg.search(query, options)
      }

      const startTime = Date.now()
      try {
        const response = await searchWeb({
          query,
          maxResults: options.maxResults,
          searchDepth: options.searchDepth,
          includeAnswer: true,
          includeDomains: options.includeDomains,
          signal: options.abortSignal,
        })
        const duration = Date.now() - startTime
        searchProviderRegistry.recordSuccess('tavily', duration)
        return tavilyResultToSearchItems(response.results).map(item => ({
          ...item,
          provider: response.provider,
        }))
      } catch (err) {
        const duration = Date.now() - startTime
        searchProviderRegistry.recordFailure('tavily', duration)
        console.warn('[DeepResearch] Tavily 搜索失败，自动降级为 DuckDuckGo. 错误:', err)
        return ddg.search(query, options)
      }
    },
  }
}

function createSerpApiProvider(apiKey: string): ResearchSearchProvider {
  return {
    name: 'serpapi',
    async search(query, options) {
      const url = new URL('https://serpapi.com/search.json')
      url.searchParams.set('engine', 'google')
      url.searchParams.set('q', query)
      url.searchParams.set('api_key', apiKey)
      url.searchParams.set('num', String(Math.min(Math.max(options.maxResults, 1), 10)))
      if (options.includeDomains?.length) {
        url.searchParams.set('as_sitesearch', options.includeDomains[0])
      }

      const response = await tauriFetch(url.toString(), {
        method: 'GET',
        signal: options.abortSignal,
        headers: {
          Accept: 'application/json',
        },
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`SerpAPI search failed (${response.status}): ${text.slice(0, 240)}`)
      }

      const parsed = extractJsonObject(text)
      const organicResults = Array.isArray(parsed?.organic_results) ? parsed.organic_results : []
      return organicResults
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(item => ({
          title: firstString(item.title),
          url: firstString(item.link),
          markdown: firstString(item.snippet),
          content: firstString(item.snippet),
          description: firstString(item.snippet),
          publishedDate: firstString(item.date),
          provider: 'serpapi',
        }))
    },
  }
}

function createExaProvider(apiKey: string): ResearchSearchProvider {
  return {
    name: 'exa',
    async search(query, options) {
      const response = await tauriFetch('https://api.exa.ai/search', {
        method: 'POST',
        signal: options.abortSignal,
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          numResults: Math.min(Math.max(options.maxResults, 1), 10),
          type: 'auto',
          includeDomains: options.includeDomains,
          text: true,
        }),
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Exa search failed (${response.status}): ${text.slice(0, 240)}`)
      }

      const parsed = extractJsonObject(text)
      const results = Array.isArray(parsed?.results) ? parsed.results : []
      return results
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(item => {
          const content = firstString(item.text, item.summary, item.highlights)
          return {
            title: firstString(item.title),
            url: firstString(item.url),
            markdown: content,
            content,
            description: firstString(item.summary),
            score: typeof item.score === 'number' ? item.score : undefined,
            publishedDate: firstString(item.publishedDate, item.published_date),
            provider: 'exa',
          }
        })
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

function createAnySearchMcpProvider(binding: FirecrawlBinding): ResearchSearchProvider {
  return {
    name: `anysearch:${binding.server.name || binding.server.id}`,
    async search(query) {
      const searchTimeout = 25000
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AnySearch MCP search timeout (25s)')), searchTimeout)
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
        throw new Error('AnySearch MCP returned an empty response.')
      }
      if (result.isError) {
        throw new Error(getTextContent(result) || `AnySearch MCP search failed for ${query}`)
      }

      const text = getTextContent(result)
      const parsed = extractJsonObject(text)
      const items = parseUnknownSearchItems(parsed || text)
      if (items.length === 0) {
        throw new Error('AnySearch MCP response did not contain parseable search results.')
      }

      return items.map(item => ({
        ...item,
        provider: 'anysearch',
      }))
    },
  }
}

async function buildSearchProviders(): Promise<ResearchSearchProvider[]> {
  const providers: ResearchSearchProvider[] = []
  const settings = useSettingStore.getState()

  try {
    const binding = await findMcpSearchBinding('anysearch', { optional: true })
    if (binding) {
      providers.push(createAnySearchMcpProvider(binding))
    }
  } catch (error) {
    console.warn('[DeepResearch] AnySearch MCP provider unavailable:', error)
  }

  try {
    const binding = await findMcpSearchBinding('firecrawl', { optional: true })
    if (binding) {
      providers.push(createFirecrawlProvider(binding))
    }
  } catch (error) {
    console.warn('[DeepResearch] Firecrawl provider unavailable:', error)
  }

  if (settings.researchSearchSerpApiEnabled && settings.serpApiKey.trim()) {
    providers.push(createSerpApiProvider(settings.serpApiKey.trim()))
  }

  if (settings.researchSearchExaEnabled && settings.exaApiKey.trim()) {
    providers.push(createExaProvider(settings.exaApiKey.trim()))
  }

  if (settings.researchSearchTavilyEnabled !== false) {
    providers.push(createTavilyProvider())
  }

  providers.push(createDuckDuckGoProvider())
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

async function findMcpSearchBinding(kind: 'firecrawl' | 'anysearch', options: { optional?: boolean } = {}): Promise<FirecrawlBinding | null> {
  await ensureMcpInitialized()
  const store = useMcpStore.getState()
  const matcher = kind === 'firecrawl' ? /firecrawl/i : /any\s*search|anysearch|any-search/i

  const servers = store.servers.filter(server =>
    server.enabled && matcher.test(`${server.name} ${server.command || ''} ${(server.args || []).join(' ')}`)
  )

  for (const server of servers) {
    let state = store.getServerState(server.id)
    if (state?.status !== 'connected') {
      await mcpServerManager.connectServer(server)
      state = store.getServerState(server.id)
    }

    const tools = state?.tools || mcpServerManager.getServerTools(server.id)
    const searchTool = tools.find(tool => {
      const haystack = `${tool.name} ${tool.description || ''}`
      if (kind === 'firecrawl') {
        return /search/i.test(tool.name)
      }
      return /search|web|query/i.test(haystack)
    })
    if (searchTool) {
      return { server, searchTool }
    }
  }

  if (options.optional) {
    return null
  }

  throw new Error(`未找到可用的 ${kind === 'firecrawl' ? 'Firecrawl' : 'AnySearch'} MCP 搜索工具。请在 MCP 设置中启用对应服务，并确认它能正常连接。`)
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
            content: buildXiaoMoDeepResearchSystemPrompt(),
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
  localContextBrief?: string
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
    '- If local context is provided, use it to infer scope and avoid asking questions that the local material already answers.',
    '',
    `<user_query>${params.query}</user_query>`,
    params.localContextBrief ? `<local_context>${trimText(params.localContextBrief, 3000)}</local_context>` : '',
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
  localContextBrief?: string
  abortSignal?: AbortSignal
}): Promise<{ canStart: boolean; missingQuestions: string[]; researchBrief: string }> {
  const parsed = await askJson([
    'You are reviewing user answers before starting deep research.',
    'Return strict JSON: {"canStart":true,"missingQuestions":["..."],"researchBrief":"..."}',
    'Rules:',
    '- If the answer provides enough scope to start useful research, canStart=true.',
    '- If important information is still missing, ask at most 3 concrete missingQuestions in Simplified Chinese.',
    '- researchBrief must combine the original query, the clarification questions, and the user answer into a focused research plan.',
    '- If local context is provided, fold it into the researchBrief as background constraints and local evidence to verify or extend.',
    '',
    `<original_query>${params.originalQuery}</original_query>`,
    '<clarification_questions>',
    params.questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    '</clarification_questions>',
    `<user_answer>${params.answer}</user_answer>`,
    params.localContextBrief ? `<local_context>${trimText(params.localContextBrief, 3000)}</local_context>` : '',
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
  localContextBrief?: string
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
    params.localContextBrief ? `<local_context>${trimText(params.localContextBrief, 2000)}</local_context>` : '',
  ].join('\n'), params.abortSignal)

  const strategy = typeof parsed?.strategy === 'string' ? parsed.strategy : ''
  return researchStrategyRegistry.has(strategy) ? strategy : 'comprehensive'
}

async function generateSerpQueries(params: {
  query: string
  breadth: number
  learnings: string[]
  strategy: ResearchStrategyConfig
  localContextBrief?: string
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
    '- When local context is provided, generate queries that verify, expand, or challenge the local material instead of ignoring it.',
    `- Strategy: ${params.strategy.label}. ${params.strategy.queryHint}`,
    '- If the prompt is already clear, produce fewer focused queries.',
    'Each researchGoal should explain what this query should verify and what deeper direction it may open.',
    '',
    `<user_prompt>${params.query}</user_prompt>`,
    params.localContextBrief ? `<local_context>${trimText(params.localContextBrief, 3000)}</local_context>` : '',
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
  cacheStats: ResearchSearchCacheStats
  abortSignal?: AbortSignal
}): Promise<FirecrawlSearchItem[]> {
  const execute = (includeDomains?: string[]) => Promise.allSettled(
    params.providers.map(provider =>
      searchProviderWithCache({
        provider,
        query: params.query,
        stats: params.cacheStats,
        options: {
          maxResults: params.strategy.maxResults,
          searchDepth: params.strategy.searchDepth,
          includeDomains,
          abortSignal: params.abortSignal,
        },
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

async function selectCrawlerUrls(
  query: string,
  allExtractedUrls: string[],
  abortSignal?: AbortSignal
): Promise<string[]> {
  if (allExtractedUrls.length === 0) return []
  const prompt = [
    '你是一个深入研究的爬虫筛选助手。根据以下的研究主题/查询，从提取出的一组外链中，筛选出最相关、置信度最高、最值得进一步爬取的网页 URL。',
    '筛选规则：',
    '1. 优先选择官方文档、官方博客、规范标准、权威学术、著名技术社区、或高置信度的媒体链接。',
    '2. 排除垃圾链接、社交媒体（如 twitter, facebook, youtube, linkedin）、登录/注册页面、分享按钮链接、以及与主题明显无关的链接。',
    '3. 最多选择 3 个链接。',
    '请以 JSON 对象格式返回所选的链接，例如：{"urls":["https://example.com/page1","https://example.com/page2"]}',
    '',
    `<research_query>${query}</research_query>`,
    '<extracted_urls>',
    allExtractedUrls.slice(0, 50).join('\n'),
    '</extracted_urls>'
  ].join('\n')

  const parsed = await askJson(prompt, abortSignal)
  if (Array.isArray(parsed?.urls)) {
    return parsed.urls.map(String).map(url => url.trim()).filter(Boolean)
  }
  return []
}

async function runDeepCrawler(params: {
  query: string
  seedItems: FirecrawlSearchItem[]
  existingSources: ResearchSource[]
  abortSignal?: AbortSignal
}): Promise<ResearchSource[]> {
  const crawlerSources: ResearchSource[] = []
  const topItems = params.seedItems.slice(0, 2)
  const urlsToExtract = topItems.map(item => item.url).filter((url): url is string => !!url)
  if (urlsToExtract.length === 0) return []

  let mainContents = ''
  try {
    const extractResponse = await tavilyExtract({
      urls: urlsToExtract,
      format: 'markdown',
      signal: params.abortSignal,
    })

    for (const res of extractResponse.results) {
      if (res.rawContent) {
        mainContents += `\n${res.rawContent}`
      }
    }
  } catch (err) {
    console.warn('[DeepResearch] tavilyExtract failed during crawler seed phase:', err)
    mainContents = topItems.map(item => item.content || item.markdown || item.description || '').join('\n')
  }

  if (!mainContents.trim()) return []

  const urlRegex = /https?:\/\/[^\s'"\)\>\]]+/g
  const allExtractedUrls = [...new Set(mainContents.match(urlRegex) || [])]
    .map(url => normalizeUrl(url))
    .filter(url => {
      const host = hostFromUrl(url)
      if (!host) return false
      const ignoreList = [
        'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'youtube.com',
        'instagram.com', 'reddit.com', 'pinterest.com', 'github.com/login',
        'github.com/join', 't.me', 'medium.com/p', 'accounts.google.com'
      ]
      return !ignoreList.some(domain => host.includes(domain))
    })

  if (allExtractedUrls.length === 0) return []

  const selectedUrls = await selectCrawlerUrls(params.query, allExtractedUrls, params.abortSignal)
  if (selectedUrls.length === 0) return []

  try {
    console.log('[DeepResearch] Crawling deep links:', selectedUrls)
    const crawlResponse = await tavilyExtract({
      urls: selectedUrls,
      format: 'markdown',
      signal: params.abortSignal,
    })

    crawlResponse.results.forEach((res, index) => {
      if (!res.rawContent) return
      const url = normalizeUrl(res.url)
      const host = hostFromUrl(url)
      const sourceId = `C${params.existingSources.length + crawlerSources.length + 1}`
      crawlerSources.push({
        id: sourceId,
        title: host || `Deep Link ${index + 1}`,
        url,
        engine: 'crawler',
        snippet: trimText(res.rawContent, 1500),
        retrievedAt: new Date().toISOString(),
        credibilityScore: 0.65,
      })
    })
  } catch (err) {
    console.warn('[DeepResearch] tavilyExtract failed for deep links:', err)
  }

  return crawlerSources
}

export async function performCrossVerification(
  sources: ResearchSource[],
  evidences: ResearchEvidence[],
  abortSignal?: AbortSignal
): Promise<{
  evidences: ResearchEvidence[]
  verificationSummary: string
  stats: EvidenceStats
}> {
  if (evidences.length === 0) {
    return {
      evidences,
      verificationSummary: '未收集到足够证据以进行交叉印证。',
      stats: computeEvidenceStats(evidences),
    }
  }

  const prompt = [
    '你是一个深度研究的交叉印证与证据链审查专家。你需要阅读以下收集到的证据列表，将表达相同事实或主张的证据进行聚类（Fact Cluster），检测它们是否由多个独立域名支持，并特别注意它们是否存在逻辑矛盾或相反的主张。',
    '请以 JSON 对象格式返回，格式如下：',
    '{',
    '  "clusters": [',
    '    {',
    '      "factClaim": "这一事实集群的核心主张（中文描述）",',
    '      "supportingEvidenceIds": ["E1", "E2"],',
    '      "contradictingEvidenceIds": [] // 如有反面证据，列出其 ID；如无则为空',
    '    }',
    '  ]',
    '}',
    '',
    '<evidences>',
    evidences.map(e => `[${e.id}] Claim: ${e.claim} (Source URL: ${e.sourceUrl})`).join('\n\n'),
    '</evidences>'
  ].join('\n')

  const parsed = await askJson(prompt, abortSignal)
  const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : []

  const updatedEvidences = [...evidences]
  const hasConflictMap = new Set<string>()
  const hostSupportCountMap = new Map<string, Set<string>>()

  clusters.forEach((cluster: any, cIndex: number) => {
    const cId = `cluster-${cIndex}`
    const hosts = new Set<string>()
    const suppIds: string[] = Array.isArray(cluster.supportingEvidenceIds) ? cluster.supportingEvidenceIds.map(String) : []
    const contraIds: string[] = Array.isArray(cluster.contradictingEvidenceIds) ? cluster.contradictingEvidenceIds.map(String) : []

    suppIds.forEach((id: string) => {
      const ev = updatedEvidences.find(e => e.id === id)
      if (ev) {
        const host = hostFromUrl(ev.sourceUrl)
        if (host) hosts.add(host)
      }
    })

    if (contraIds.length > 0) {
      suppIds.forEach((id: string) => hasConflictMap.add(id))
      contraIds.forEach((id: string) => hasConflictMap.add(id))
    }

    hostSupportCountMap.set(cId, hosts)

    suppIds.forEach((id: string) => {
      const evIndex = updatedEvidences.findIndex(e => e.id === id)
      if (evIndex !== -1) {
        const ev = updatedEvidences[evIndex]
        let confidence = ev.confidence

        if (hosts.size >= 3) {
          confidence = 'high'
        } else if (hosts.size === 1) {
          if (confidence === 'high') {
            confidence = 'medium'
          }
        }

        if (hasConflictMap.has(id)) {
          confidence = 'low'
        }

        updatedEvidences[evIndex] = {
          ...ev,
          confidence
        }
      }
    })

    contraIds.forEach((id: string) => {
      const evIndex = updatedEvidences.findIndex(e => e.id === id)
      if (evIndex !== -1) {
        updatedEvidences[evIndex] = {
          ...updatedEvidences[evIndex],
          confidence: 'low'
        }
      }
    })
  })

  const summaryLines: string[] = ['### 证据链交叉印证分析评估报告：']
  let conflictCount = 0
  let highConfCount = 0
  let singleSourceCount = 0

  clusters.forEach((cluster: any, index: number) => {
    const cId = `cluster-${index}`
    const hosts = hostSupportCountMap.get(cId)
    const hostList = hosts ? [...hosts].join(', ') : ''
    const suppIds = Array.isArray(cluster.supportingEvidenceIds) ? cluster.supportingEvidenceIds.map(String) : []
    const contraIds = Array.isArray(cluster.contradictingEvidenceIds) ? cluster.contradictingEvidenceIds.map(String) : []

    summaryLines.push(`${index + 1}. **事实主张**：${cluster.factClaim}`)
    summaryLines.push(`   - 支持域名 (数量: ${hosts?.size || 0})：[${hostList}]`)

    if (hosts && hosts.size >= 3) {
      highConfCount++
      summaryLines.push(`   - 状态：**多源印证（置信度高）**，支持证据：[${suppIds.join(', ')}]`)
    } else if (hosts && hosts.size === 1) {
      singleSourceCount++
      summaryLines.push(`   - 状态：**孤证引用**（置信度受限，仅来源于单个域），支持证据：[${suppIds.join(', ')}]`)
    } else {
      summaryLines.push(`   - 状态：**多方提及**，支持证据：[${suppIds.join(', ')}]`)
    }

    if (contraIds.length > 0) {
      conflictCount++
      summaryLines.push(`   - ⚠️ **冲突警告**：存在冲突或相反的主张！冲突证据：[${contraIds.join(', ')}]`)
    }
  })

  if (conflictCount > 0) {
    summaryLines.unshift(`> ⚠️ 【交叉验证预警】：在本次研究中共检测到 ${conflictCount} 处逻辑矛盾的事实，已对相关证据的置信度执行降级，并在生成最终报告时特别标出。`)
  } else {
    summaryLines.unshift(`> 【交叉验证结果】：证据一致性高。共提取并分析了 ${clusters.length} 个核心事实集群，其中 ${highConfCount} 个事实得到了 3 个及以上独立域名的交叉印证。`)
  }

  return {
    evidences: updatedEvidences,
    verificationSummary: summaryLines.join('\n'),
    stats: {
      ...computeEvidenceStats(updatedEvidences),
      singleSourceClaims: singleSourceCount || computeEvidenceStats(updatedEvidences).singleSourceClaims,
      conflictingClaims: conflictCount,
      confirmedClaims: highConfCount,
    },
  }
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

function formatCompactReferenceSection(sources: ResearchSource[]) {
  // Only keep top sources sorted by credibility, max 15
  const topSources = sources
    .slice()
    .sort((a, b) => b.credibilityScore - a.credibilityScore)
    .slice(0, 15)

  const rows = topSources.map((source, index) => {
    const published = source.publishedAt ? `，${source.publishedAt}` : ''
    const host = hostFromUrl(source.url)
    const label = source.title || host || source.url
    const score = `（置信度 ${(source.credibilityScore * 100).toFixed(0)}%）`
    if (source.url.startsWith('local:')) {
      return `${index + 1}. ${label}，本地来源${published} ${score}`
    }
    return `${index + 1}. [${label}](${source.url})${host ? `，${host}` : ''}${published} ${score}`
  })

  const omittedCount = sources.length - topSources.length
  const omittedNote = omittedCount > 0
    ? [``, `> 共 ${sources.length} 个来源，已按置信度排序，展示前 ${topSources.length} 个。`]
    : []

  return [
    '## 参考来源',
    '',
    '<details>',
    `<summary>📊 点击展开 ${topSources.length} 个核心来源${omittedCount > 0 ? `（共 ${sources.length} 个）` : ''}</summary>`,
    '',
    ...rows,
    ...omittedNote,
    '',
    '</details>',
  ].join('\n')
}

function appendFallbackSourceSection(report: string, sources: ResearchSource[]) {
  if (report.includes('## 参考来源') || report.includes('## 来源') || sources.length === 0) {
    return report.trim()
  }

  return `${report.trim()}\n\n${formatCompactReferenceSection(sources)}`
}

function formatEvidenceAppendix(sources: ResearchSource[], evidences: ResearchEvidence[]) {
  if (evidences.length === 0) {
    return ''
  }

  // Only keep high/medium confidence evidences, sorted by relevance, max 20
  const filteredEvidences = evidences
    .filter(ev => ev.confidence !== 'low')
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 20)

  if (filteredEvidences.length === 0) {
    return ''
  }

  const rows = filteredEvidences.map(ev => {
    const source = sources.find(s => s.id === ev.sourceId)
    const sourceTitle = source ? source.title : '未知来源'
    const sourceRef = ev.sourceUrl.startsWith('local:')
      ? `${sourceTitle}（本地来源）`
      : `[${sourceTitle}](${ev.sourceUrl})`
    const confidenceEmoji = ev.confidence === 'high' ? '🟢' : '🟡'
    return `| ${confidenceEmoji} ${ev.confidence.toUpperCase()} | ${ev.claim.slice(0, 80)}${ev.claim.length > 80 ? '…' : ''} | ${sourceRef} |`
  })

  const omittedCount = evidences.length - filteredEvidences.length
  const omittedNote = omittedCount > 0
    ? [``, `> 共 ${evidences.length} 条证据，展示置信度中/高的前 ${filteredEvidences.length} 条。`]
    : []

  return [
    '## 附录：证据索引',
    '',
    '以下内容用于追溯事实依据，默认折叠。',
    '',
    '<details>',
    `<summary>📋 点击展开 ${filteredEvidences.length} 条核心证据</summary>`,
    '',
    '| 置信度 | 事实主张 | 引用来源 |',
    '|---|---|---|',
    ...rows,
    ...omittedNote,
    '',
    '</details>',
  ].join('\n')
}

export async function runDeepResearch(params: {
  query: string
  breadth?: number
  depth?: number
  abortSignal?: AbortSignal
  onProgress?: (progress: DeepResearchProgress) => void
  sessionId?: string
  localContext?: ResearchLocalContext
  eventBus?: AgentEventBus
}): Promise<DeepResearchResult> {
  const startedAt = new Date().toISOString()
  const localContextPrompt = formatLocalContextForPrompt(params.localContext)
  const localResearchInputs = createLocalResearchInputs(params.localContext)
  const strategyId = await classifyResearchIntent({
    query: params.query,
    localContextBrief: localContextPrompt,
    abortSignal: params.abortSignal,
  })
  const strategy = researchStrategyRegistry.get(strategyId)
  const defaultBreadth = clampInteger(params.breadth, strategy.breadth || DEFAULT_BREADTH, 1, 6)
  const defaultDepth = clampInteger(params.depth, strategy.depth || DEFAULT_DEPTH, 1, 4)
  const providers = await buildSearchProviders()
  const cacheStats = createResearchSearchCacheStats()
  const getProviderHealth = () => searchProviderRegistry.snapshot(providers.map(provider => provider.name))

  let sessionId = params.sessionId || createResearchId()
  let allLearnings: string[] = []
  let allUrls: string[] = []
  let allSources: ResearchSource[] = []
  let allEvidences: ResearchEvidence[] = []
  let pendingQueries: Array<{ query: string; researchGoal: string; depth: number; breadth: number }> = []
  let localSourcesCount = localResearchInputs.sources.length

  // 尝试加载 Session 状态
  if (params.sessionId) {
    const savedState = await loadSessionState(params.sessionId)
    if (savedState) {
      sessionId = savedState.id
      allLearnings = savedState.learnings || []
      allUrls = savedState.visitedUrls || []
      allSources = savedState.sources || []
      allEvidences = savedState.evidences || []
      pendingQueries = savedState.pendingQueries || []
      localSourcesCount = allSources.filter(source => source.engine.startsWith('local:')).length
      if (savedState.cacheStats) {
        cacheStats.hits = savedState.cacheStats.hits || 0
        cacheStats.misses = savedState.cacheStats.misses || 0
        cacheStats.writes = savedState.cacheStats.writes || 0
        cacheStats.bypasses = savedState.cacheStats.bypasses || 0
      }
      console.log(`[DeepResearch] Resumed from session ${sessionId}. Pending queries count: ${pendingQueries.length}`)
    }
  }

  // 若无可用 Session 则初始化任务队列
  if (pendingQueries.length === 0) {
    allSources = mergeSources(allSources, localResearchInputs.sources)
    allEvidences = remapEvidenceSources([...allEvidences, ...localResearchInputs.evidences], allSources)
    allLearnings = uniqueStrings([...allLearnings, ...localResearchInputs.learnings])

    params.onProgress?.({
      stage: 'initializing',
      currentDepth: defaultDepth,
      totalDepth: defaultDepth,
      currentBreadth: defaultBreadth,
      totalBreadth: defaultBreadth,
      completedQueries: 0,
      totalQueries: 0,
      learningsCount: allLearnings.length,
      visitedUrlsCount: 0,
      providerStatus: providers.map(provider => provider.name).join(', '),
      strategy: strategy.id,
      estimatedMinutes: `${Math.max(3, defaultDepth * defaultBreadth)}-${Math.max(5, defaultDepth * defaultBreadth * 2)} 分钟`,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
      providerHealth: getProviderHealth(),
      ...buildProgressStats(allSources, allEvidences, localSourcesCount),
    })

    params.eventBus?.emit('research.started', {
      query: params.query,
      sessionId,
      strategy: strategy.id,
      breadth: defaultBreadth,
      depth: defaultDepth,
      cacheStats: snapshotSearchCacheStats(cacheStats),
      providerHealth: getProviderHealth(),
    })

    const serpQueries = await generateSerpQueries({
      query: params.query,
      breadth: defaultBreadth,
      learnings: allLearnings,
      strategy,
      localContextBrief: localContextPrompt,
      abortSignal: params.abortSignal,
    })

    pendingQueries = serpQueries.map(q => ({
      query: q.query,
      researchGoal: q.researchGoal,
      depth: defaultDepth,
      breadth: defaultBreadth,
    }))

    await saveSessionState({
      id: sessionId,
      query: params.query,
      strategy: strategy.id,
      startedAt,
      visitedUrls: allUrls,
      sources: allSources,
      evidences: allEvidences,
      learnings: allLearnings,
      pendingQueries,
      currentDepth: defaultDepth,
      totalDepth: defaultDepth,
      currentBreadth: defaultBreadth,
      totalBreadth: defaultBreadth,
      cacheStats: snapshotSearchCacheStats(cacheStats),
      providerHealth: getProviderHealth(),
    })
  } else {
    params.eventBus?.emit('research.started', {
      query: params.query,
      sessionId,
      strategy: strategy.id,
      isResumed: true,
      breadth: defaultBreadth,
      depth: defaultDepth,
      cacheStats: snapshotSearchCacheStats(cacheStats),
      providerHealth: getProviderHealth(),
    })
  }

  let completedQueriesCount = 0

  // 扁平任务循环，支持断点续传
  while (pendingQueries.length > 0) {
    params.abortSignal?.throwIfAborted()

    const currentBatch = pendingQueries.slice(0, MAX_PARALLEL_SEARCHES)
    pendingQueries = pendingQueries.slice(MAX_PARALLEL_SEARCHES)

    const providerNames = providers.map(p => {
      if (searchProviderRegistry.isBroken(p.name)) {
        return `${p.name} (熔断降级)`
      }
      return p.name
    }).join(', ')

    params.onProgress?.({
      stage: 'searching',
      currentDepth: currentBatch[0]?.depth || 1,
      totalDepth: defaultDepth,
      currentBreadth: currentBatch[0]?.breadth || 1,
      totalBreadth: defaultBreadth,
      currentQuery: currentBatch.map(q => q.query).join(' | '),
      completedQueries: completedQueriesCount,
      totalQueries: completedQueriesCount + currentBatch.length + pendingQueries.length,
      learningsCount: allLearnings.length,
      visitedUrlsCount: allUrls.length,
      providerStatus: providerNames,
      strategy: strategy.id,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
      providerHealth: getProviderHealth(),
      ...buildProgressStats(allSources, allEvidences, localSourcesCount),
    })

    params.eventBus?.emit('research.progress', {
      stage: 'searching',
      currentQuery: currentBatch.map(q => q.query).join(' | '),
      completedQueries: completedQueriesCount,
      totalQueries: completedQueriesCount + currentBatch.length + pendingQueries.length,
      learningsCount: allLearnings.length,
      cacheStats: snapshotSearchCacheStats(cacheStats),
      providerHealth: getProviderHealth(),
      ...buildProgressStats(allSources, allEvidences, localSourcesCount),
      sessionId,
    })

    const searchResults = await Promise.allSettled(
      currentBatch.map(task => runSearch({
        providers,
        query: task.query,
        strategy,
        cacheStats,
        abortSignal: params.abortSignal,
      }))
    )

    const batchItems: { task: typeof currentBatch[0]; items: SearchHit[]; sources: ResearchSource[] }[] = []

    for (let i = 0; i < currentBatch.length; i++) {
      const task = currentBatch[i]
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

        nextSources.forEach(source => {
          params.eventBus?.emit('research.source_added', { source, sessionId })
        })

        // 定向爬取二级链接 (Deep Crawler)
        params.onProgress?.({
          stage: 'searching',
          currentDepth: task.depth,
          totalDepth: defaultDepth,
          currentBreadth: task.breadth,
          totalBreadth: defaultBreadth,
          currentQuery: `定向爬取二级链接: ${task.query}`,
          completedQueries: completedQueriesCount,
          totalQueries: completedQueriesCount + currentBatch.length + pendingQueries.length,
          learningsCount: allLearnings.length,
          visitedUrlsCount: allUrls.length,
          providerStatus: `${providerNames} | crawler`,
          strategy: strategy.id,
          cacheHits: cacheStats.hits,
          cacheMisses: cacheStats.misses,
          providerHealth: getProviderHealth(),
          ...buildProgressStats(allSources, allEvidences, localSourcesCount),
        })

        const crawledSources = await runDeepCrawler({
          query: task.query,
          seedItems: items,
          existingSources: allSources,
          abortSignal: params.abortSignal,
        })

        if (crawledSources.length > 0) {
          allSources = mergeSources(allSources, crawledSources)
          crawledSources.forEach(source => {
            params.eventBus?.emit('research.source_added', { source, sessionId })
          })

          items.push(...crawledSources.map(cs => ({
            title: cs.title,
            url: cs.url,
            content: cs.snippet || '',
            markdown: cs.snippet || '',
            provider: 'crawler',
            sourceId: cs.id,
          })))
        }

        batchItems.push({
          task,
          items,
          sources: allSources.filter(source => items.some(item => item.sourceId === source.id)),
        })

        allUrls.push(...items.map(item => item.url || '').filter(Boolean).map(normalizeUrl))
      } else if (result.status === 'rejected') {
        console.warn('[DeepResearch] Batch search failed:', task.query, result.reason)
      }
    }

    if (batchItems.length > 0) {
      params.onProgress?.({
        stage: 'analyzing',
        currentDepth: currentBatch[0]?.depth || 1,
        totalDepth: defaultDepth,
        currentBreadth: currentBatch[0]?.breadth || 1,
        totalBreadth: defaultBreadth,
        currentQuery: batchItems.map(b => b.task.query).join(' | '),
        completedQueries: completedQueriesCount,
        totalQueries: completedQueriesCount + currentBatch.length + pendingQueries.length,
        learningsCount: allLearnings.length,
        visitedUrlsCount: allUrls.length,
        strategy: strategy.id,
        cacheHits: cacheStats.hits,
        cacheMisses: cacheStats.misses,
        providerHealth: getProviderHealth(),
        ...buildProgressStats(allSources, allEvidences, localSourcesCount),
      })

      params.eventBus?.emit('research.progress', {
        stage: 'analyzing',
        currentQuery: batchItems.map(b => b.task.query).join(' | '),
        completedQueries: completedQueriesCount + currentBatch.length,
        totalQueries: completedQueriesCount + currentBatch.length + pendingQueries.length,
        learningsCount: allLearnings.length,
        cacheStats: snapshotSearchCacheStats(cacheStats),
        providerHealth: getProviderHealth(),
        ...buildProgressStats(allSources, allEvidences, localSourcesCount),
        sessionId,
      })

      const nextBreadth = Math.max(1, Math.ceil((currentBatch[0]?.breadth || defaultBreadth) / 2))
      const nextDepth = (currentBatch[0]?.depth || defaultDepth) - 1

      const analysisResults = await Promise.allSettled(
        batchItems.map(({ task, items, sources }) =>
          processSerpResult({
            query: task.query,
            items,
            sources,
            followUpCount: nextBreadth,
            abortSignal: params.abortSignal,
          })
        )
      )

      const followUpTasks: Array<{ query: string; researchGoal: string; depth: number; breadth: number }> = []

      for (let i = 0; i < analysisResults.length; i++) {
        const result = analysisResults[i]
        const task = batchItems[i].task
        if (result.status === 'fulfilled') {
          allLearnings.push(...result.value.learnings)
          allEvidences.push(...result.value.evidences)

          result.value.evidences.forEach(evidence => {
            params.eventBus?.emit('research.evidence_added', { evidence, sessionId })
          })

          if (nextDepth > 0 && result.value.followUpQuestions.length > 0) {
            const nextQueryText = [
              `Previous research goal: ${task.researchGoal}`,
              'Follow-up research directions:',
              ...result.value.followUpQuestions.map(question => `- ${question}`),
            ].join('\n')

            followUpTasks.push({
              query: nextQueryText,
              researchGoal: `Follow-up research from topic: ${task.query}`,
              depth: nextDepth,
              breadth: nextBreadth,
            })
          }
        }
      }

      if (followUpTasks.length > 0) {
        pendingQueries.push(...followUpTasks)
      }
    }

    completedQueriesCount += currentBatch.length

    allLearnings = uniqueStrings(allLearnings)
    allUrls = uniqueStrings(allUrls)
    allSources = mergeSources(allSources, [])
    allEvidences = remapEvidenceSources(allEvidences, allSources)

    await saveSessionState({
      id: sessionId,
      query: params.query,
      strategy: strategy.id,
      startedAt,
      visitedUrls: allUrls,
      sources: allSources,
      evidences: allEvidences,
      learnings: allLearnings,
      pendingQueries,
      currentDepth: currentBatch[0]?.depth || 1,
      totalDepth: defaultDepth,
      currentBreadth: currentBatch[0]?.breadth || 1,
      totalBreadth: defaultBreadth,
      cacheStats: snapshotSearchCacheStats(cacheStats),
      providerHealth: getProviderHealth(),
    })
  }

  // 1. 证据交叉验证置信度重算 (Cross-Verification)
  params.onProgress?.({
    stage: 'verifying',
    currentDepth: 0,
    totalDepth: defaultDepth,
    currentBreadth: 0,
    totalBreadth: defaultBreadth,
    completedQueries: completedQueriesCount,
    totalQueries: completedQueriesCount,
    learningsCount: allLearnings.length,
    visitedUrlsCount: allUrls.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    cacheHits: cacheStats.hits,
    cacheMisses: cacheStats.misses,
    providerHealth: getProviderHealth(),
    ...buildProgressStats(allSources, allEvidences, localSourcesCount),
  })

  params.eventBus?.emit('research.progress', {
    stage: 'verifying',
    detail: '正在进行多源交叉验证与冲突检测中...',
    sessionId,
    cacheStats: snapshotSearchCacheStats(cacheStats),
    providerHealth: getProviderHealth(),
  })

  const verificationResult = await performCrossVerification(allSources, allEvidences, params.abortSignal)
  allEvidences = verificationResult.evidences
  const verifiedProgressStats = buildProgressStats(allSources, allEvidences, localSourcesCount, verificationResult.stats)

  // 2. 生成最终报告
  params.onProgress?.({
    stage: 'writing',
    currentDepth: 0,
    totalDepth: defaultDepth,
    currentBreadth: 0,
    totalBreadth: defaultBreadth,
    completedQueries: completedQueriesCount,
    totalQueries: completedQueriesCount,
    learningsCount: allLearnings.length,
    visitedUrlsCount: allUrls.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    cacheHits: cacheStats.hits,
    cacheMisses: cacheStats.misses,
    providerHealth: getProviderHealth(),
    ...verifiedProgressStats,
  })

  params.eventBus?.emit('research.progress', {
    stage: 'writing',
    sessionId,
    cacheStats: snapshotSearchCacheStats(cacheStats),
    providerHealth: getProviderHealth(),
  })

  const learnings = allLearnings.slice(0, MAX_LEARNINGS_FOR_REPORT)
  const report = await askText([
    'Write a substantial deep-research article in Markdown. It must read like a knowledgeable human analyst wrote it, not like AI-generated content.',
    'Your visible role is 小墨: wise, considerate, root-cause oriented, and clear enough that a non-expert can follow.',
    '',
    '## Language & Strategy',
    '- Write in Simplified Chinese. Section headings use sentence case (e.g. "背景与发展" not "背景与发展概述").',
    `- Research strategy: ${strategy.label}. ${strategy.reportFocus}`,
    '',
    '## Structure — Self-directed, NOT a fixed template',
    '- Design the report structure yourself based on the topic and the evidence. Do NOT use a preset skeleton.',
    '- The ONLY structural requirements:',
    '  1. Open with a short orientation (1–2 paragraphs) on the question and why it matters.',
    '  2. Core body MUST be ≥70% of total output. Develop arguments in depth with multiple sections and subsections.',
    '  3. End with a compact reference section.',
    '- Let the topic guide structure: chronological narrative, thematic decomposition, problem→solution arc, comparative review — choose what fits.',
    '',
    '## Visual Richness',
    '- Include Mermaid diagrams (flowchart, sequence, timeline, mindmap) wherever they genuinely clarify a process, relationship, or timeline.',
    '- Use Markdown tables for comparisons instead of prose.',
    '- Use blockquote callouts (> **💡** / > **⚠️**) sparingly to highlight key points.',
    '- Use **bold** only for genuine key terms on first mention. Do not bold entire phrases mechanically.',
    '',
    '## Human Writing Style (CRITICAL — anti-AI patterns)',
    'This is the most important section. The report MUST NOT read like typical AI output. Follow ALL of these rules:',
    '',
    '### Ban these AI tell-tale patterns:',
    '- NO significance inflation: "标志着…的重要时刻", "具有深远意义", "起到了关键作用", "展现了…的魅力", "为…奠定了基础", "体现了…的精神".',
    '- NO promotional language: "蓬勃发展", "丰富多彩", "令人瞩目", "令人印象深刻", "备受关注", "层出不穷", "异彩纷呈".',
    '- NO -ing analysis tacking: "…，展现了…"，"…，体现了…"，"…，推动了…的发展". End the sentence at the fact; don\'t attach a significance clause.',
    '- NO vague attribution: "业内人士认为", "专家指出", "有分析称". Either name a specific source or drop the attribution.',
    '- NO AI vocabulary: "值得注意的是", "不可或缺", "至关重要", "毋庸置疑", "纵观全局", "深入探讨", "全方位", "多维度", "赋能", "助力".',
    '- NO filler hedging: "在一定程度上", "可以说", "不难发现", "显而易见", "总而言之". Cut them.',
    '- NO formulaic "challenges and prospects" endings: "尽管面临挑战，但未来依然光明" style wrap-ups. End with specifics or don\'t write a conclusion section at all.',
    '- NO em dashes (—). Use commas, periods, colons, or parentheses instead.',
    '- NO rule-of-three lists where items are parallel adjectives padded for rhythm.',
    '- NO signposting: "让我们来看看…", "接下来将探讨…", "下面将从几个方面进行分析…". Just say the thing.',
    '- NO bullet-point paragraphs. Write prose paragraphs with at least 2–3 sentences each. Bullets are only for genuine lists.',
    '- NO inline-header lists ("- **标题：** 内容" format). Write real paragraphs.',
    '',
    '### Write like a human analyst:',
    '- Use simple, direct constructions: "是", "有", "能" instead of "被视为", "拥有", "具备…的能力".',
    '- Vary sentence length. Mix short, punchy sentences with longer ones. Even rhythm is the biggest AI tell.',
    '- Prefer specific details (names, numbers, dates, URLs) over vague summaries.',
    '- When evidence is thin, say so plainly: "公开资料中未找到…" is fine; padding with speculation is not.',
    '- When opinions differ, present the disagreement concretely, not as "一方面…另一方面…".',
    '- State conclusions directly instead of building up with ceremony.',
    '',
    '## Writing Quality',
    '- Build arguments layer by layer: orient, present evidence, then conclude.',
    '- Structure proportional to evidence: rich evidence → detailed report; thin evidence → honest, concise coverage.',
    '- Ground claims in evidences, but do NOT show inline citation markers [S1] or source IDs in body text.',
    '- Clearly call out single-source, low-confidence, or contradicted conclusions in prose.',
    '- If local materials are provided, distinguish local-context conclusions from externally verified ones.',
    '- Preserve concrete names, numbers, dates, and URLs.',
    '- Every source mention with an available URL must be a clickable Markdown link, both in the body and in the references.',
    '- If evidence is insufficient for a requested angle, say so and explain what is missing.',
    '',
    '## Reference Section',
    '- End with a compact "参考来源" section in a folded <details> block, max 15 sources by credibility.',
    '- Keep references lightweight — they must not dominate the report.',
    '',
    `<user_query>${params.query}</user_query>`,
    localContextPrompt,
    '<verification_summary>',
    verificationResult.verificationSummary,
    '</verification_summary>',
    '<evidence_quality_stats>',
    JSON.stringify(verificationResult.stats, null, 2),
    '</evidence_quality_stats>',
    '<sources>',
    allSources.map(source => [
      `[${source.id}] ${source.title}`,
      `URL: ${source.url}`,
      `Engine: ${source.engine}`,
      `Credibility: ${source.credibilityScore.toFixed(2)}`,
      source.publishedAt ? `Published: ${source.publishedAt}` : '',
    ].filter(Boolean).join('\n')).join('\n\n'),
    '</sources>',
    '<evidences>',
    formatEvidenceForReport(allSources, allEvidences),
    '</evidences>',
    '<learnings>',
    learnings.map(learning => `<learning>${learning}</learning>`).join('\n'),
    '</learnings>',
  ].join('\n'), params.abortSignal)

  const finalReport = appendFallbackSourceSection(report, allSources)

  // 整理并附加可折叠的证据索引，避免干扰正文阅读。
  let appendedReport = finalReport.trim()
  const evidenceAppendix = formatEvidenceAppendix(allSources, allEvidences)
  if (evidenceAppendix) {
    appendedReport += `\n\n${evidenceAppendix}`
  }

  // 5. 广播研究结束
  const visitedUrls = uniqueStrings(allSources.map(source => source.url).concat(allUrls))
  const session: ResearchSession = {
    id: sessionId,
    query: params.query,
    strategy: strategy.id,
    startedAt,
    completedAt: new Date().toISOString(),
    searchProviders: providers.map(provider => provider.name),
    sources: allSources,
    evidences: allEvidences,
    learnings: allLearnings,
    visitedUrls,
    breadth: defaultBreadth,
    depth: defaultDepth,
    cacheStats: snapshotSearchCacheStats(cacheStats),
    providerHealth: getProviderHealth(),
  }

  const finalResult: DeepResearchResult = {
    report: appendedReport,
    learnings: allLearnings,
    visitedUrls,
    sources: allSources,
    evidences: allEvidences,
    session,
  }
  const quality = assessResearchQuality(finalResult)
  finalResult.quality = quality
  finalResult.session.quality = quality

  params.onProgress?.({
    stage: 'done',
    currentDepth: 0,
    totalDepth: defaultDepth,
    currentBreadth: 0,
    totalBreadth: defaultBreadth,
    completedQueries: completedQueriesCount,
    totalQueries: completedQueriesCount,
    learningsCount: allLearnings.length,
    visitedUrlsCount: visitedUrls.length,
    providerStatus: providers.map(provider => provider.name).join(', '),
    strategy: strategy.id,
    estimatedMinutes: `0 分钟`,
    cacheHits: cacheStats.hits,
    cacheMisses: cacheStats.misses,
    providerHealth: getProviderHealth(),
    ...buildProgressStats(allSources, allEvidences, localSourcesCount, verificationResult.stats),
  })

  params.eventBus?.emit('research.completed', {
    report: appendedReport,
    sessionId,
    sourceCount: allSources.length,
    evidenceCount: allEvidences.length,
    visitedUrlsCount: visitedUrls.length,
    quality,
    strategy: strategy.id,
    breadth: defaultBreadth,
    depth: defaultDepth,
    cacheStats: snapshotSearchCacheStats(cacheStats),
    providerHealth: getProviderHealth(),
  })

  return finalResult
}
