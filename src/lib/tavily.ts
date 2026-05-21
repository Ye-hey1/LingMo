import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { invokeAiJson } from '@/lib/ai/tauri-client'
import useSettingStore from '@/stores/setting'

export type TavilySearchDepth = 'basic' | 'advanced'
export type TavilyExtractFormat = 'markdown' | 'text'
export type WebSearchProvider = 'tavily' | 'duckduckgo'

export interface TavilySearchResult {
  title: string
  url: string
  content: string
  score?: number
  publishedDate?: string
}

export interface TavilySearchResponse {
  query: string
  answer?: string
  results: TavilySearchResult[]
  responseTime?: number
  provider: WebSearchProvider
  degraded?: boolean
  fallbackReason?: string
}

export interface TavilyExtractResult {
  url: string
  rawContent: string
  images?: string[]
  favicon?: string
}

export interface TavilyExtractFailedResult {
  url: string
  error?: string
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[]
  failedResults: TavilyExtractFailedResult[]
  responseTime?: number
  requestId?: string
}

interface TavilyRawResult {
  title?: unknown
  url?: unknown
  content?: unknown
  score?: unknown
  published_date?: unknown
}

interface TavilyRawResponse {
  query?: unknown
  answer?: unknown
  results?: unknown
  response_time?: unknown
  detail?: unknown
}

interface TavilyExtractRawResult {
  url?: unknown
  raw_content?: unknown
  images?: unknown
  favicon?: unknown
}

interface TavilyExtractRawFailedResult {
  url?: unknown
  error?: unknown
}

interface TavilyExtractRawResponse {
  results?: unknown
  failed_results?: unknown
  response_time?: unknown
  request_id?: unknown
  detail?: unknown
}

export interface TavilySearchOptions {
  query: string
  maxResults?: number
  searchDepth?: TavilySearchDepth
  includeAnswer?: boolean
  includeDomains?: string[]
  excludeDomains?: string[]
  signal?: AbortSignal
}

export interface TavilyExtractOptions {
  urls: string | string[]
  extractDepth?: TavilySearchDepth
  format?: TavilyExtractFormat
  includeImages?: boolean
  includeFavicon?: boolean
  timeout?: number
  query?: string
  chunksPerSource?: number
  signal?: AbortSignal
}

interface TavilyTransportResult {
  status: number
  ok: boolean
  text: string
}

interface TavilyHealthCheckResult {
  ok: boolean
  mode: 'plugin-http' | 'rust-fallback' | 'failed'
  status?: number
  message: string
}

interface DuckDuckGoRawTopic {
  Text?: unknown
  FirstURL?: unknown
  Topics?: unknown
}

interface DuckDuckGoRawResponse {
  Heading?: unknown
  AbstractText?: unknown
  AbstractURL?: unknown
  Answer?: unknown
  RelatedTopics?: unknown
  Results?: unknown
}

const DUCKDUCKGO_QUERY_CHAR_LIMIT = 500

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function normalizeFallbackSearchQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, DUCKDUCKGO_QUERY_CHAR_LIMIT)
}

function normalizeSearchDepth(value: unknown): TavilySearchDepth {
  return value === 'advanced' ? 'advanced' : 'basic'
}

function normalizeExtractFormat(value: unknown): TavilyExtractFormat {
  return value === 'text' ? 'text' : 'markdown'
}

function normalizeDomainList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const domains = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)

  return domains.length > 0 ? domains : undefined
}

async function getPersistedTavilySetting<T>(key: string): Promise<T | undefined> {
  try {
    const store = await Store.load('store.json')
    return await store.get<T>(key)
  } catch {
    return undefined
  }
}

export async function getTavilyRuntimeConfig() {
  const state = useSettingStore.getState()
  const apiKey = state.tavilyApiKey?.trim()
    || (await getPersistedTavilySetting<string>('tavilyApiKey'))?.trim()
    || ''
  const persistedSearchDepth = await getPersistedTavilySetting<string>('tavilySearchDepth')
  const searchDepth = normalizeSearchDepth(persistedSearchDepth ?? state.tavilySearchDepth)

  return {
    apiKey,
    searchDepth,
  }
}

function toTavilyResults(raw: unknown): TavilySearchResult[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((item) => {
    const result = item as TavilyRawResult
    return {
      title: typeof result.title === 'string' ? result.title : '',
      url: typeof result.url === 'string' ? result.url : '',
      content: typeof result.content === 'string' ? result.content : '',
      score: typeof result.score === 'number' ? result.score : undefined,
      publishedDate: typeof result.published_date === 'string' ? result.published_date : undefined,
    }
  }).filter(result => result.title || result.url || result.content)
}

function toTavilyExtractResults(raw: unknown): TavilyExtractResult[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((item) => {
    const result = item as TavilyExtractRawResult
    const images = Array.isArray(result.images)
      ? result.images.filter((image): image is string => typeof image === 'string')
      : undefined

    return {
      url: typeof result.url === 'string' ? result.url : '',
      rawContent: typeof result.raw_content === 'string' ? result.raw_content : '',
      images,
      favicon: typeof result.favicon === 'string' ? result.favicon : undefined,
    }
  }).filter(result => result.url || result.rawContent)
}

function toTavilyExtractFailedResults(raw: unknown): TavilyExtractFailedResult[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((item) => {
    const result = item as TavilyExtractRawFailedResult
    return {
      url: typeof result.url === 'string' ? result.url : '',
      error: typeof result.error === 'string' ? result.error : undefined,
    }
  }).filter(result => result.url || result.error)
}

function getDomainHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function matchesDomainFilters(url: string, includeDomains?: string[], excludeDomains?: string[]) {
  const hostname = getDomainHostname(url)
  if (!hostname) {
    return false
  }

  const normalizedInclude = includeDomains?.map(item => item.toLowerCase())
  const normalizedExclude = excludeDomains?.map(item => item.toLowerCase())

  if (normalizedInclude && normalizedInclude.length > 0) {
    const included = normalizedInclude.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    if (!included) {
      return false
    }
  }

  if (normalizedExclude && normalizedExclude.length > 0) {
    const excluded = normalizedExclude.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    if (excluded) {
      return false
    }
  }

  return true
}

function buildDuckDuckGoResultTitle(text: string, fallbackUrl: string): string {
  const compact = text.trim()
  if (!compact) {
    return fallbackUrl
  }

  const separatorIndex = compact.indexOf(' - ')
  if (separatorIndex > 0) {
    return compact.slice(0, separatorIndex).trim()
  }

  return compact.length > 80 ? compact.slice(0, 80).trim() : compact
}

function flattenDuckDuckGoTopics(raw: unknown, collector: TavilySearchResult[] = []): TavilySearchResult[] {
  if (!Array.isArray(raw)) {
    return collector
  }

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const topic = item as DuckDuckGoRawTopic
    if (Array.isArray(topic.Topics)) {
      flattenDuckDuckGoTopics(topic.Topics, collector)
      continue
    }

    const text = typeof topic.Text === 'string' ? topic.Text.trim() : ''
    const url = typeof topic.FirstURL === 'string' ? topic.FirstURL.trim() : ''
    if (!text && !url) {
      continue
    }

    collector.push({
      title: buildDuckDuckGoResultTitle(text, url),
      url,
      content: text,
    })
  }

  return collector
}

function toDuckDuckGoResults(
  payload: DuckDuckGoRawResponse,
  maxResults: number,
  includeDomains?: string[],
  excludeDomains?: string[],
): TavilySearchResult[] {
  const results: TavilySearchResult[] = []

  if (typeof payload.AbstractText === 'string' && payload.AbstractText.trim()) {
    const abstractUrl = typeof payload.AbstractURL === 'string' ? payload.AbstractURL.trim() : ''
    results.push({
      title: typeof payload.Heading === 'string' && payload.Heading.trim()
        ? payload.Heading.trim()
        : buildDuckDuckGoResultTitle(payload.AbstractText, abstractUrl),
      url: abstractUrl,
      content: payload.AbstractText.trim(),
    })
  }

  flattenDuckDuckGoTopics(payload.Results, results)
  flattenDuckDuckGoTopics(payload.RelatedTopics, results)

  const seen = new Set<string>()
  return results
    .filter(result => result.url || result.content)
    .filter(result => {
      if (!result.url) {
        return true
      }
      return matchesDomainFilters(result.url, includeDomains, excludeDomains)
    })
    .filter(result => {
      const key = `${result.url}|${result.content}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .slice(0, maxResults)
}

function toErrorMessage(payload: TavilyRawResponse | null, text: string): string {
  if (payload && typeof payload.detail === 'string') {
    return payload.detail
  }

  return text.slice(0, 300)
}

function toExtractErrorMessage(payload: TavilyExtractRawResponse | null, text: string): string {
  if (payload && typeof payload.detail === 'string') {
    return payload.detail
  }

  return text.slice(0, 300)
}

function parseTavilyPayload(text: string): TavilyRawResponse | null {
  try {
    return text ? JSON.parse(text) as TavilyRawResponse : null
  } catch {
    return null
  }
}

function parseTavilyExtractPayload(text: string): TavilyExtractRawResponse | null {
  try {
    return text ? JSON.parse(text) as TavilyExtractRawResponse : null
  } catch {
    return null
  }
}

async function requestTavilyViaPluginHttp(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TavilyTransportResult> {
  const response = await tauriFetch('https://api.tavily.com/search', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  return {
    status: response.status,
    ok: response.ok,
    text: await response.text(),
  }
}

async function requestTavilyExtractViaPluginHttp(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TavilyTransportResult> {
  const response = await tauriFetch('https://api.tavily.com/extract', {
    method: 'POST',
    connectTimeout: 15000,
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  return {
    status: response.status,
    ok: response.ok,
    text: await response.text(),
  }
}

async function requestTavilyViaRustFallback(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TavilyTransportResult> {
  signal?.throwIfAborted()
  const payload = await invokeAiJson<TavilyRawResponse>({
    config: {
      baseUrl: 'https://api.tavily.com',
      apiKey,
    },
    path: '/search',
    method: 'POST',
    body,
  })

  return {
    status: 200,
    ok: true,
    text: JSON.stringify(payload),
  }
}

async function requestTavilyExtractViaRustFallback(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TavilyTransportResult> {
  signal?.throwIfAborted()
  const payload = await invokeAiJson<TavilyExtractRawResponse>({
    config: {
      baseUrl: 'https://api.tavily.com',
      apiKey,
    },
    path: '/extract',
    method: 'POST',
    body,
  })

  return {
    status: 200,
    ok: true,
    text: JSON.stringify(payload),
  }
}

async function requestDuckDuckGoFallback(
  query: string,
  maxResults: number,
  includeDomains?: string[],
  excludeDomains?: string[],
  signal?: AbortSignal,
): Promise<TavilySearchResponse> {
  signal?.throwIfAborted()
  const normalizedQuery = normalizeFallbackSearchQuery(query)
  const encodedQuery = encodeURIComponent(normalizedQuery)
  const payload = await invokeAiJson<DuckDuckGoRawResponse>({
    config: {
      baseUrl: 'https://api.duckduckgo.com',
    },
    path: `/?q=${encodedQuery}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
    method: 'GET',
  })

  const results = toDuckDuckGoResults(payload, maxResults, includeDomains, excludeDomains)
  const answer = typeof payload.Answer === 'string' && payload.Answer.trim()
    ? payload.Answer.trim()
    : typeof payload.AbstractText === 'string' && payload.AbstractText.trim()
      ? payload.AbstractText.trim()
      : undefined

  return {
    query: normalizedQuery,
    answer,
    results,
    provider: 'duckduckgo',
    degraded: true,
  }
}

function classifyTavilyStatus(status: number, text: string): string {
  if (status === 401 || status === 403) {
    return 'Tavily API Key 无效或没有权限，请检查设置中的 Key。'
  }
  if (status === 429) {
    return 'Tavily 请求过于频繁或额度已用尽，请稍后重试。'
  }
  if (status >= 500) {
    return `Tavily 服务端异常（HTTP ${status}）。`
  }
  return `Tavily 返回异常状态（HTTP ${status}）：${text.slice(0, 120)}`
}

export async function testTavilyHealth(): Promise<TavilyHealthCheckResult> {
  const { apiKey } = await getTavilyRuntimeConfig()
  if (!apiKey) {
    return {
      ok: false,
      mode: 'failed',
      message: '未配置 Tavily API Key。',
    }
  }

  const body: Record<string, unknown> = {
    query: 'health check',
    max_results: 1,
    search_depth: 'basic',
    include_answer: false,
    include_raw_content: false,
  }

  try {
    const pluginResult = await requestTavilyViaPluginHttp(apiKey, body)
    if (!pluginResult.ok) {
      return {
        ok: false,
        mode: 'failed',
        status: pluginResult.status,
        message: classifyTavilyStatus(pluginResult.status, pluginResult.text),
      }
    }

    return {
      ok: true,
      mode: 'plugin-http',
      message: 'Tavily 正常，可直接通过前端网络层访问。',
    }
  } catch (pluginError) {
    try {
      await requestTavilyViaRustFallback(apiKey, body)
      return {
        ok: true,
        mode: 'rust-fallback',
        message: 'Tavily 可用，但前端 plugin-http 发送失败；当前会自动切换到 Rust fallback。',
      }
    } catch (fallbackError) {
      const pluginMessage = pluginError instanceof Error ? pluginError.message : String(pluginError)
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      return {
        ok: false,
        mode: 'failed',
        message: `Tavily 检查失败。plugin-http：${pluginMessage}；fallback：${fallbackMessage}`,
      }
    }
  }
}

export async function tavilySearch(options: TavilySearchOptions): Promise<TavilySearchResponse> {
  options.signal?.throwIfAborted()
  const query = options.query.trim()
  if (!query) {
    throw new Error('query is required')
  }

  const { apiKey, searchDepth: defaultSearchDepth } = await getTavilyRuntimeConfig()
  if (!apiKey) {
    throw new Error('Tavily API Key is not configured. Please configure it in Settings > Web Search.')
  }

  const maxResults = clampNumber(options.maxResults, 5, 1, 10)
  const searchDepth = normalizeSearchDepth(options.searchDepth || defaultSearchDepth)
  const includeDomains = normalizeDomainList(options.includeDomains)
  const excludeDomains = normalizeDomainList(options.excludeDomains)
  const body: Record<string, unknown> = {
    query,
    max_results: maxResults,
    search_depth: searchDepth,
    include_answer: options.includeAnswer !== false,
    include_raw_content: false,
  }

  if (includeDomains) {
    body.include_domains = includeDomains
  }
  if (excludeDomains) {
    body.exclude_domains = excludeDomains
  }

  let transportResult: TavilyTransportResult
  try {
    transportResult = await requestTavilyViaPluginHttp(apiKey, body, options.signal)
  } catch (pluginError) {
    options.signal?.throwIfAborted()
    try {
      transportResult = await requestTavilyViaRustFallback(apiKey, body, options.signal)
    } catch (fallbackError) {
      const pluginMessage = pluginError instanceof Error ? pluginError.message : String(pluginError)
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(`Tavily transport failed in plugin-http and Rust fallback. plugin-http: ${pluginMessage}; fallback: ${fallbackMessage}`)
    }
  }

  const text = transportResult.text
  const payload = parseTavilyPayload(text)

  if (!transportResult.ok) {
    const message = toErrorMessage(payload, text)
    throw new Error(`Tavily search failed: HTTP ${transportResult.status}${message ? ` - ${message}` : ''}`)
  }

  return {
    query: typeof payload?.query === 'string' ? payload.query : query,
    answer: typeof payload?.answer === 'string' ? payload.answer : undefined,
    results: toTavilyResults(payload?.results),
    responseTime: typeof payload?.response_time === 'number' ? payload.response_time : undefined,
    provider: 'tavily',
  }
}

export async function tavilyExtract(options: TavilyExtractOptions): Promise<TavilyExtractResponse> {
  options.signal?.throwIfAborted()
  const urls = (Array.isArray(options.urls) ? options.urls : [options.urls])
    .map(url => url.trim())
    .filter(Boolean)

  if (urls.length === 0) {
    throw new Error('urls is required')
  }

  const { apiKey, searchDepth: defaultSearchDepth } = await getTavilyRuntimeConfig()
  if (!apiKey) {
    throw new Error('Tavily API Key is not configured. Please configure it in Settings > Web Search.')
  }

  const extractDepth = normalizeSearchDepth(options.extractDepth || defaultSearchDepth)
  const format = normalizeExtractFormat(options.format)
  const timeout = clampNumber(options.timeout, extractDepth === 'advanced' ? 30 : 10, 1, 60)
  const body: Record<string, unknown> = {
    urls: urls.length === 1 ? urls[0] : urls,
    extract_depth: extractDepth,
    format,
    include_images: options.includeImages === true,
    include_favicon: options.includeFavicon === true,
    timeout,
  }

  if (typeof options.query === 'string' && options.query.trim()) {
    body.query = options.query.trim()
    body.chunks_per_source = clampNumber(options.chunksPerSource, 3, 1, 5)
  }

  let transportResult: TavilyTransportResult
  try {
    transportResult = await requestTavilyExtractViaPluginHttp(apiKey, body, options.signal)
  } catch (pluginError) {
    options.signal?.throwIfAborted()
    try {
      transportResult = await requestTavilyExtractViaRustFallback(apiKey, body, options.signal)
    } catch (fallbackError) {
      const pluginMessage = pluginError instanceof Error ? pluginError.message : String(pluginError)
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(`Tavily extract transport failed in plugin-http and Rust fallback. plugin-http: ${pluginMessage}; fallback: ${fallbackMessage}`)
    }
  }

  const text = transportResult.text
  const payload = parseTavilyExtractPayload(text)

  if (!transportResult.ok) {
    const message = toExtractErrorMessage(payload, text)
    throw new Error(`Tavily extract failed: HTTP ${transportResult.status}${message ? ` - ${message}` : ''}`)
  }

  return {
    results: toTavilyExtractResults(payload?.results),
    failedResults: toTavilyExtractFailedResults(payload?.failed_results),
    responseTime: typeof payload?.response_time === 'number' ? payload.response_time : undefined,
    requestId: typeof payload?.request_id === 'string' ? payload.request_id : undefined,
  }
}

export async function searchWeb(options: TavilySearchOptions): Promise<TavilySearchResponse> {
  try {
    return await tavilySearch(options)
  } catch (tavilyError) {
    options.signal?.throwIfAborted()
    const fallback = await requestDuckDuckGoFallback(
      options.query.trim(),
      clampNumber(options.maxResults, 5, 1, 10),
      normalizeDomainList(options.includeDomains),
      normalizeDomainList(options.excludeDomains),
      options.signal,
    )

    return {
      ...fallback,
      fallbackReason: tavilyError instanceof Error ? tavilyError.message : String(tavilyError),
    }
  }
}
