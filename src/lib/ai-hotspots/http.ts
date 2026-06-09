import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { AI_HOTSPOT_CONFIG } from './config'

export interface AiHotspotFetchOptions extends RequestInit {
  retries?: number
  timeoutMs?: number
  timeout?: number
}

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createHeaders(input?: HeadersInit) {
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

  return headers
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isTransientStatus(status: number) {
  return TRANSIENT_STATUS_CODES.has(status)
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

  const { retries: _retries, timeout: _timeout, timeoutMs: _timeoutMs, signal: _signal, ...fetchOptions } = options
  const request: RequestInit = {
    ...fetchOptions,
    headers: createHeaders(fetchOptions.headers),
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

      if (response.ok) {
        return response
      }

      const message = `HTTP ${response.status} ${response.statusText}`.trim()
      const error = new Error(message)
      if (!isTransientStatus(response.status) || attempt >= retries) {
        throw error
      }
      lastError = error
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    await sleep(AI_HOTSPOT_CONFIG.http.retryDelayMs * (attempt + 1))
  }

  throw lastError || new Error('Fetch failed')
}

export async function fetchHotspotText(url: string, options: AiHotspotFetchOptions = {}) {
  const response = await fetchHotspotWithRetry(url, options)
  return response.text()
}

export async function fetchHotspotJson<T>(url: string, options: AiHotspotFetchOptions = {}) {
  const response = await fetchHotspotWithRetry(url, options)
  return response.json() as Promise<T>
}
