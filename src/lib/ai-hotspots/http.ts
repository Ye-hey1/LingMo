import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { AI_HOTSPOT_CONFIG } from './config'

export interface AiHotspotFetchOptions extends RequestInit {
  retries?: number
  timeoutMs?: number
  timeout?: number
  /** 上次拉取时间，用于设置 If-Modified-Since 头 */
  ifModifiedSince?: string | null
}

export interface AiHotspotFetchResult {
  response: Response | null
  /** true 表示服务端返回 304，内容没有变化 */
  notModified: boolean
}

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const NOT_MODIFIED_STATUS = 304

class FetchAttemptError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'FetchAttemptError'
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createHeaders(input?: HeadersInit, ifModifiedSince?: string | null) {
  const headers = new Headers(input)

  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', AI_HOTSPOT_CONFIG.http.userAgent)
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/rss+xml, application/xml, text/xml, application/json, text/html, */*')
  }
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
  }
  if (ifModifiedSince && !headers.has('If-Modified-Since')) {
    headers.set('If-Modified-Since', ifModifiedSince)
  }

  return headers
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isTransientStatus(status: number) {
  return TRANSIENT_STATUS_CODES.has(status)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function isRetryableError(error: Error) {
  return !(error instanceof FetchAttemptError) || error.retryable
}

async function fetchOnce(url: string, options: AiHotspotFetchOptions, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort()

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener('abort', abortFromCaller, { once: true })
    }
  }

  const { retries: _retries, timeout: _timeout, timeoutMs: _timeoutMs, ifModifiedSince: _ims, signal: _signal, ...fetchOptions } = options
  const request: RequestInit = {
    ...fetchOptions,
    headers: createHeaders(fetchOptions.headers, options.ifModifiedSince),
    signal: controller.signal,
  }

  try {
    try {
      return await tauriFetch(url, request)
    } catch (pluginError) {
      if (typeof globalThis.fetch !== 'function') {
        throw pluginError
      }

      try {
        return await globalThis.fetch(url, request)
      } catch (fallbackError) {
        throw new Error(`plugin-http failed: ${getErrorMessage(pluginError)}; global fetch failed: ${getErrorMessage(fallbackError)}`)
      }
    }
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function fetchHotspotWithRetry(url: string, options: AiHotspotFetchOptions = {}) {
  const retries = options.retries ?? AI_HOTSPOT_CONFIG.http.retries
  const timeoutMs = options.timeoutMs ?? options.timeout ?? AI_HOTSPOT_CONFIG.http.timeoutMs
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchOnce(url, options, timeoutMs)

      // 304 Not Modified — 服务端确认内容没有变化
      if (response.status === NOT_MODIFIED_STATUS) {
        return response
      }

      if (response.ok) {
        return response
      }

      const message = `HTTP ${response.status} ${response.statusText}`.trim()
      const error = new FetchAttemptError(message, isTransientStatus(response.status))
      if (!isTransientStatus(response.status) || attempt >= retries) {
        throw error
      }
      lastError = error
    } catch (error) {
      const currentError = toError(error)

      if (options.signal?.aborted || !isRetryableError(currentError) || attempt >= retries) {
        throw currentError
      }

      lastError = currentError
    }

    await sleep(AI_HOTSPOT_CONFIG.http.retryDelayMs * (attempt + 1))
  }

  throw lastError || new Error('Fetch failed')
}

/**
 * 带条件请求的 HTTP 拉取。
 * 支持 If-Modified-Since，当服务端返回 304 时返回 { response: null, notModified: true }。
 */
export async function fetchHotspotConditional(url: string, options: AiHotspotFetchOptions = {}): Promise<AiHotspotFetchResult> {
  const response = await fetchHotspotWithRetry(url, options)

  if (response.status === NOT_MODIFIED_STATUS) {
    return { response: null, notModified: true }
  }

  return { response, notModified: false }
}

export async function fetchHotspotText(url: string, options: AiHotspotFetchOptions = {}) {
  const response = await fetchHotspotWithRetry(url, options)
  return response.text()
}

export async function fetchHotspotJson<T>(url: string, options: AiHotspotFetchOptions = {}) {
  const response = await fetchHotspotWithRetry(url, options)
  return response.json() as Promise<T>
}
