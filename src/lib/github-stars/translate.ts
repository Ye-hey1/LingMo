import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'

class AuthExpiredError extends Error {
  readonly isAuthExpired = true
  constructor() {
    super('Auth expired')
    this.name = 'AuthExpiredError'
  }
}

export interface TranslateResult {
  translatedText: string
  detectedLanguage: string
}

interface CachedToken {
  token: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null
let tokenPromise: Promise<string> | null = null

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const TRANSLATE_API_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate'
const AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const FALLBACK_TOKEN_TTL_MS = 8 * 60 * 1000

async function getProxyConfig() {
  try {
    const store = await Store.load('store.json')
    const proxyUrl = await store.get<string>('proxy')
    return proxyUrl ? { all: proxyUrl } : undefined
  } catch {
    return undefined
  }
}

const parseJwtExpiration = (token: string): number => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return 0

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    // 使用 globalThis.atob 支持在不同环境的 Base64 解码
    const payload = JSON.parse(globalThis.atob(base64))
    if (payload.exp) {
      return payload.exp * 1000
    }
    return 0
  } catch {
    return 0
  }
}

const isTokenValid = (cached: CachedToken | null): cached is CachedToken => {
  if (!cached) return false
  return Date.now() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS
}

const getStoredToken = async (): Promise<CachedToken | null> => {
  try {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem('ms_translate_token')
    if (!stored) return null

    const parsed = JSON.parse(stored) as CachedToken
    if (isTokenValid(parsed)) {
      return parsed
    }
    window.localStorage.removeItem('ms_translate_token')
    return null
  } catch {
    return null
  }
}

const storeToken = (token: string): void => {
  try {
    if (typeof window === 'undefined') return
    let expiresAt = parseJwtExpiration(token)
    if (expiresAt <= 0) {
      expiresAt = Date.now() + FALLBACK_TOKEN_TTL_MS
    }
    cachedToken = { token, expiresAt }
    window.localStorage.setItem('ms_translate_token', JSON.stringify(cachedToken))
  } catch {
    // 忽略本地存储写入失败
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = setTimeout(resolve, ms)
    if (signal) {
      const onAbort = () => {
        clearTimeout(id)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Request timeout', 'AbortError'))
  }, timeoutMs)

  const onAbort = () => {
    controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort)
      }
    }
  }
}


const extractHttpStatus = (err: unknown): number | null => {
  const anyErr = err as Record<string, unknown>
  const response = anyErr?.response as Record<string, unknown> | undefined
  const status = response?.status ?? anyErr?.status
  if (typeof status === 'number') return status

  if (err instanceof Error) {
    const match = err.message.match(/(?:status|failed)[:\s]*(\d{3})/i)
    if (match) {
      return parseInt(match[1], 10)
    }
  }

  return null
}

const isTransientError = (err: unknown): boolean => {
  if ((err as { isAuthExpired?: boolean })?.isAuthExpired) return true
  const status = extractHttpStatus(err)
  if (status === null) return true
  return status === 429 || status >= 500
}

const withTranslateRetry = async <T>(
  operation: (token: string) => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<T> => {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const token = await apiMsAuth(signal)
      return await operation(token)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      const name = (err as { name?: string })?.name
      if (name === 'AbortError' || name === 'CanceledError') {
        throw err
      }

      if (attempt >= maxRetries) break

      if (!isTransientError(err)) {
        throw err
      }

      await sleep(baseDelay * Math.pow(2, attempt - 1), signal)
    }
  }

  throw lastError!
}

export const apiMsAuth = async (signal?: AbortSignal): Promise<string> => {
  const storedToken = await getStoredToken()
  if (storedToken) {
    cachedToken = storedToken
    return storedToken.token
  }

  if (isTokenValid(cachedToken)) {
    return cachedToken.token
  }

  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        const proxyConfig = await getProxyConfig()
        const response = await tauriFetch(AUTH_URL, {
          method: 'GET',
          connectTimeout: 8000,
          proxy: proxyConfig,
        })

        if (!response.ok) {
          throw new Error(`Auth failed: ${response.status}`)
        }

        const token = await response.text()
        storeToken(token)
        return token
      } finally {
        tokenPromise = null
      }
    })()
  }

  if (!signal) {
    return tokenPromise
  }

  return Promise.race([
    tokenPromise,
    new Promise<string>((_, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  ])
}

export interface TranslateOptions {
  from?: string
  to: string
  text: string
  signal?: AbortSignal
  textType?: 'html' | 'plain'
}

export const translateText = async (options: TranslateOptions): Promise<TranslateResult> => {
  const { from, to, text, signal, textType } = options

  if (!text || text.trim() === '') {
    return { translatedText: text, detectedLanguage: '' }
  }

  const { signal: combinedSignal, cleanup } = createTimeoutSignal(8000, signal)
  try {
    return await withTranslateRetry(async (token) => {
      const params = new URLSearchParams()
      if (from) params.append('from', from)
      params.append('to', to)
      params.append('api-version', '3.0')
      if (textType === 'html') params.append('textType', 'html')

      const url = `${TRANSLATE_API_URL}?${params.toString()}`
      const proxyConfig = await getProxyConfig()

      const response = await tauriFetch(url, {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify([{ Text: text }]),
        proxy: proxyConfig,
        signal: combinedSignal,
      })

      if (!response.ok) {
        if (response.status === 401) {
          cachedToken = null
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('ms_translate_token')
          }
          throw new AuthExpiredError()
        }
        throw new Error(`Translation failed: ${response.status}`)
      }

      const data = await response.json() as Array<{
        translations?: Array<{ text: string }>
        detectedLanguage?: { language: string }
      }>

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Invalid translation response')
      }

      const result = data[0]
      const translatedText = result.translations?.[0]?.text || text
      const detectedLanguage = result.detectedLanguage?.language || ''

      return {
        translatedText,
        detectedLanguage,
      }
    }, combinedSignal, 3)
  } finally {
    cleanup()
  }
}

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  const paragraphs = text.split('\n')
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 1 > maxChars && current.length > 0) {
      chunks.push(current)
      current = para
    } else if (current.length > 0) {
      current += '\n' + para
    } else {
      current = para
    }

    while (current.length > maxChars) {
      const splitPoint = current.lastIndexOf(' ', maxChars)
      if (splitPoint <= 0) {
        chunks.push(current.slice(0, maxChars))
        current = current.slice(maxChars)
      } else {
        chunks.push(current.slice(0, splitPoint))
        current = current.slice(splitPoint + 1)
      }
    }
  }

  if (current) chunks.push(current)
  return chunks
}

export const translateBatch = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal,
  textType?: 'html' | 'plain',
): Promise<TranslateResult[]> => {
  if (texts.length === 0) return []

  if (texts.length === 1) {
    const result = await translateText({ text: texts[0], to, from, signal, textType })
    return [result]
  }

  const results: TranslateResult[] = []
  const batchSize = 100
  const maxChars = 50000

  for (let i = 0; i < texts.length; i += batchSize) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = texts.slice(i, i + batchSize)
    let currentBatch: string[] = []
    let currentLength = 0

    for (const text of batch) {
      if (text.length > maxChars) {
        if (currentBatch.length > 0) {
          const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType)
          results.push(...batchResults)
          currentBatch = []
          currentLength = 0
        }
        const chunks = splitTextIntoChunks(text, maxChars)
        for (const chunk of chunks) {
          const batchResults = await translateBatchInternal([chunk], to, from, signal, textType)
          results.push(...batchResults)
        }
        continue
      }

      if (currentLength + text.length > maxChars && currentBatch.length > 0) {
        const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType)
        results.push(...batchResults)
        currentBatch = []
        currentLength = 0
      }
      currentBatch.push(text)
      currentLength += text.length
    }

    if (currentBatch.length > 0) {
      const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType)
      results.push(...batchResults)
    }
  }

  return results
}

const translateBatchInternal = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal,
  textType?: 'html' | 'plain',
): Promise<TranslateResult[]> => {
  const { signal: combinedSignal, cleanup } = createTimeoutSignal(8000, signal)
  try {
    return await withTranslateRetry(async (token) => {
      const params = new URLSearchParams()
      if (from) params.append('from', from)
      params.append('to', to)
      params.append('api-version', '3.0')
      if (textType === 'html') params.append('textType', 'html')

      const url = `${TRANSLATE_API_URL}?${params.toString()}`
      const proxyConfig = await getProxyConfig()

      const response = await tauriFetch(url, {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(texts.map(t => ({ Text: t }))),
        proxy: proxyConfig,
        signal: combinedSignal,
      })

      if (!response.ok) {
        if (response.status === 401) {
          cachedToken = null
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('ms_translate_token')
          }
          throw new AuthExpiredError()
        }
        throw new Error(`Translation failed: ${response.status}`)
      }

      const data = await response.json() as Array<{
        translations?: Array<{ text: string }>
        detectedLanguage?: { language: string }
      }>

      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error('Invalid translation response')
      }

      return data.map((result, index) => ({
        translatedText: result.translations?.[0]?.text || texts[index],
        detectedLanguage: result.detectedLanguage?.language || '',
      }))
    }, combinedSignal, 3)
  } finally {
    cleanup()
  }
}

export const clearTranslateCache = (): void => {
  cachedToken = null
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('ms_translate_token')
  }
}
