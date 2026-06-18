/**
 * HTTP transient error 指数退避重试
 *
 * 参考 opencode 的 retry.ts 设计：区分「可重试的瞬时错误」（HTTP 429/5xx、网络
 * ECONNRESET/EPIPE/ETIMEDOUT 等）与「不可重试错误」，用指数退避重试，并尊重服务端
 * 返回的 Retry-After header，避免无效轰炸和无限重试。
 *
 * 主要用于包装 LLM / MCP / 外部 API 调用，提升网络抖动下的稳定性。
 */

import { isAiTpmLimitError } from '../ai/rate-limit'

// 可重试的 HTTP 状态码（限流 + 服务端临时故障）
const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504, 529])
// 可重试的网络错误码（连接重置、管道断裂、超时、网络不可达、DNS 临时失败）
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED',
])

export interface TransientRetryOptions {
  /** 最大尝试次数（含首次），默认 4 */
  maxAttempts?: number
  /** 首次退避延迟，默认 500ms */
  initialDelayMs?: number
  /** 退避延迟上限，默认 8000ms */
  maxDelayMs?: number
  /** 退避因子，默认 2 */
  backoffFactor?: number
  /** 是否加全抖动（full jitter）打散重试风暴，默认 true */
  jitter?: boolean
  /** 取消信号 */
  signal?: AbortSignal
  /** 每次重试前的回调（用于日志/上报） */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown; reason?: string }) => void
}

export interface RetryableErrorInfo {
  retryable: boolean
  reason?: string
  /** 从 Retry-After header 解析的延迟（ms） */
  retryAfterMs?: number
}

/**
 * 判断一个错误是否值得重试。
 * 兼容 OpenAI SDK 的 APIError（status）、通用 fetch 错误（code）、超时错误。
 */
export function isRetryableTransientError(error: unknown): RetryableErrorInfo {
  if (isAiTpmLimitError(error)) {
    return { retryable: false, reason: 'TPM rate limit' }
  }

  const anyErr = error as Record<string, any> | null
  const message = String(anyErr?.message || (typeof error === 'string' ? error : ''))

  // 1. HTTP 状态码（OpenAI APIError.status / response.status / statusCode）
  const status = anyErr?.status ?? anyErr?.response?.status ?? anyErr?.statusCode
  if (typeof status === 'number') {
    if (RETRYABLE_HTTP_STATUS.has(status)) {
      return {
        retryable: true,
        reason: `HTTP ${status}`,
        retryAfterMs: parseRetryAfter(anyErr?.headers ?? anyErr?.response?.headers),
      }
    }
    return { retryable: false, reason: `HTTP ${status}` }
  }

  const statusMatch = message.match(/(?:status=|HTTP\s+|\bstatus["']?\s*:\s*)(\d{3})/i)
  const messageStatus = statusMatch ? Number(statusMatch[1]) : undefined
  if (typeof messageStatus === 'number' && !Number.isNaN(messageStatus)) {
    if (RETRYABLE_HTTP_STATUS.has(messageStatus)) {
      return { retryable: true, reason: `HTTP ${messageStatus}` }
    }
    return { retryable: false, reason: `HTTP ${messageStatus}` }
  }

  // 2. 网络错误码
  const code = anyErr?.code
  if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)) {
    return { retryable: true, reason: code }
  }

  // 3. 超时类错误（名称或消息命中）
  const name = String(anyErr?.name || '')
  if (name === 'TimeoutError' || /timeout|timed?\s*out/i.test(message)) {
    return { retryable: true, reason: 'timeout' }
  }

  // 4. OpenAI SDK 的 APIUserAbortError 等主动取消：不重试
  if (name === 'APIUserAbortError' || name === 'AbortError') {
    return { retryable: false, reason: 'aborted' }
  }

  return { retryable: false }
}

/** 解析 Retry-After header（秒数或 HTTP-date），返回 ms。 */
function parseRetryAfter(headers?: Record<string, any> | null): number | undefined {
  if (!headers) return undefined
  const raw = headers['retry-after'] ?? headers['Retry-After']
  if (!raw) return undefined
  const seconds = Number(raw)
  if (!Number.isNaN(seconds)) return seconds * 1000
  const date = Date.parse(raw)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

export function computeBackoffDelay(
  attempt: number,
  opts: { initialDelayMs: number; maxDelayMs: number; backoffFactor: number; jitter: boolean },
  retryAfterMs?: number,
): number {
  // 尊重 Retry-After，但限制在 [initialDelayMs, maxDelayMs] 区间
  if (typeof retryAfterMs === 'number') {
    return Math.min(Math.max(retryAfterMs, opts.initialDelayMs), opts.maxDelayMs)
  }
  const base = Math.min(
    opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1),
    opts.maxDelayMs,
  )
  if (!opts.jitter) return base
  // full jitter: [0, base]，打散并发重试风暴
  return Math.floor(base * Math.random())
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 包装一个异步函数，对其抛出的瞬时错误自动重试。
 *
 * @example
 * const result = await withTransientRetry(() => openai.chat.completions.create(...))
 */
export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4
  const initialDelayMs = options.initialDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 8000
  const backoffFactor = options.backoffFactor ?? 2
  const jitter = options.jitter ?? true

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw new Error('aborted')
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts) break
      const info = isRetryableTransientError(error)
      if (!info.retryable) break
      const delayMs = computeBackoffDelay(
        attempt,
        { initialDelayMs, maxDelayMs, backoffFactor, jitter },
        info.retryAfterMs,
      )
      options.onRetry?.({ attempt, delayMs, error, reason: info.reason })
      try {
        await sleep(delayMs, options.signal)
      } catch {
        // sleep 被取消（abort），直接结束
        break
      }
    }
  }
  throw lastError
}
