import { Channel, invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type OpenAI from 'openai'
import type { ModelsPage } from 'openai/resources/models'
import type { AiConfig } from '@/app/core/setting/config'

type JsonValue = Record<string, unknown>

interface JsonRequestPayload {
  config: {
    baseUrl: string
    apiKey?: string
    customHeaders?: Record<string, string>
  }
  path: string
  method?: string
  body?: unknown
  requestId?: string
}

interface MultipartRequestPayload {
  config: {
    baseUrl: string
    apiKey?: string
    customHeaders?: Record<string, string>
  }
  path: string
  fields?: Record<string, string>
  fileFieldName: string
  file: {
    bytes: number[]
    fileName: string
    contentType?: string
  }
  requestId?: string
}

type AiTransportConfig = JsonRequestPayload['config']

type StreamEvent<T> =
  | { type: 'chunk'; data: T }
  | { type: 'error'; data: string }
  | { type: 'done' }

class AbortError extends Error {
  constructor() {
    super('Request was aborted.')
    this.name = 'AbortError'
  }
}

class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private values: T[] = []
  private waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (reason?: unknown) => void }> = []
  private completed = false
  private failure: Error | null = null

  push(value: T) {
    if (this.completed || this.failure) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close() {
    if (this.completed) return
    this.completed = true
    while (this.waiters.length) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: undefined as T, done: true })
    }
  }

  fail(error: Error) {
    if (this.completed || this.failure) return
    this.failure = error
    while (this.waiters.length) {
      const waiter = this.waiters.shift()
      waiter?.reject(error)
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.failure) {
      throw this.failure
    }
    if (this.values.length) {
      const value = this.values.shift() as T
      return { value, done: false }
    }
    if (this.completed) {
      return { value: undefined as T, done: true }
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

function createRequestId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function normalizeConfig(aiConfig?: AiConfig): AiTransportConfig {
  return {
    baseUrl: aiConfig?.baseURL || '',
    apiKey: aiConfig?.apiKey,
    customHeaders: aiConfig?.customHeaders,
  }
}

function toAbortError(error: unknown) {
  if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Request was aborted.')) {
    return new AbortError()
  }
  if (error instanceof Error) return error
  return new Error(String(error))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableTransportError(error: unknown) {
  const message = getErrorMessage(error)
  return /AI_TRANSPORT_ERROR|error sending request|Failed to fetch|NetworkError|Load failed/i.test(message) &&
    !/Request was aborted/i.test(message)
}

function buildRequestUrl(config: AiTransportConfig, path: string) {
  const normalizedBase = config.baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = path.trim().replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedPath}`
}

function buildRequestHeaders(config: AiTransportConfig, includeJsonContentType: boolean) {
  const headers: Record<string, string> = {}

  if (config.apiKey?.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`
  }

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json'
  }

  if (config.customHeaders) {
    for (const [key, value] of Object.entries(config.customHeaders)) {
      headers[key] = value
    }
  }

  return headers
}

function truncateErrorBody(body: string, maxLength = 2000) {
  return body.length > maxLength ? body.slice(0, maxLength) : body
}

function formatHttpError(status: number, body: string) {
  const retryable = status === 429 || status >= 500
  return `AI_HTTP_ERROR status=${status} retryable=${retryable} body=${truncateErrorBody(body)}`
}

async function requestJsonViaPluginHttp<T = JsonValue>(
  payload: Omit<JsonRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<T> {
  const response = await tauriFetch(buildRequestUrl(payload.config, payload.path), {
    method: payload.method || 'POST',
    headers: buildRequestHeaders(payload.config, payload.body !== undefined),
    body: payload.body === undefined ? undefined : JSON.stringify(payload.body),
    connectTimeout: 15000,
    signal,
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(formatHttpError(response.status, text))
  }

  return (text ? JSON.parse(text) : {}) as T
}

function createSyntheticStreamChunk(
  completion: OpenAI.Chat.ChatCompletion
): OpenAI.Chat.Completions.ChatCompletionChunk {
  const firstChoice = completion.choices?.[0]
  const content = typeof firstChoice?.message?.content === 'string'
    ? firstChoice.message.content
    : ''

  return {
    id: completion.id || createRequestId(),
    object: 'chat.completion.chunk',
    created: completion.created || Math.floor(Date.now() / 1000),
    model: completion.model || '',
    choices: [{
      index: firstChoice?.index ?? 0,
      delta: {
        role: 'assistant',
        content,
      },
      finish_reason: firstChoice?.finish_reason || null,
    }],
  }
}

async function cancelRequest(requestId: string) {
  try {
    await invoke('cancel_ai_request', { requestId })
  } catch {
    // ignore cancellation race
  }
}

function attachAbort(signal: AbortSignal | undefined, requestId: string) {
  if (!signal) return () => {}
  if (signal.aborted) {
    void cancelRequest(requestId)
    throw new AbortError()
  }

  const onAbort = () => {
    void cancelRequest(requestId)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

export async function invokeAiJson<T = JsonValue>(
  payload: Omit<JsonRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<T> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    return await invoke<T>('ai_json_request', {
      request: {
        ...payload,
        requestId,
      },
    })
  } catch (error) {
    const normalizedError = toAbortError(error)
    if (isRetryableTransportError(normalizedError)) {
      try {
        return await requestJsonViaPluginHttp<T>(payload, signal)
      } catch (fallbackError) {
        throw new Error(`${normalizedError.message}; plugin-http fallback failed: ${getErrorMessage(fallbackError)}`)
      }
    }
    throw normalizedError
  } finally {
    detachAbort()
  }
}

export async function invokeAiBinary(
  payload: Omit<JsonRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    const response = await invoke<number[]>('ai_binary_request', {
      request: {
        ...payload,
        requestId,
      },
    })
    return Uint8Array.from(response).buffer
  } catch (error) {
    throw toAbortError(error)
  } finally {
    detachAbort()
  }
}

export async function invokeAiMultipart<T = JsonValue>(
  payload: Omit<MultipartRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<T> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    return await invoke<T>('ai_multipart_request', {
      request: {
        ...payload,
        requestId,
      },
    })
  } catch (error) {
    throw toAbortError(error)
  } finally {
    detachAbort()
  }
}

function createStreamingIterable<T>(
  request: {
    config: ReturnType<typeof normalizeConfig>
    requestId: string
    body: unknown
  },
  signal?: AbortSignal
) {
  const queue = new AsyncQueue<T>()
  const detachAbort = attachAbort(signal, request.requestId)
  let receivedAnyChunk = false
  const channel = new Channel<StreamEvent<T>>((event) => {
    if (event.type === 'chunk') {
      receivedAnyChunk = true
      queue.push(event.data)
      return
    }
    if (event.type === 'error') {
      queue.fail(new Error(event.data))
      return
    }
    queue.close()
  })

  void invoke('ai_chat_completion_stream', {
    request,
    onEvent: channel,
  }).then(() => {
    queue.close()
  }).catch((error) => {
    const normalizedError = toAbortError(error)
    if (!receivedAnyChunk && isRetryableTransportError(normalizedError)) {
      const fallbackBody = {
        ...(request.body as Record<string, unknown>),
        stream: false,
      }
      requestJsonViaPluginHttp<OpenAI.Chat.ChatCompletion>({
        config: request.config,
        path: '/chat/completions',
        method: 'POST',
        body: fallbackBody,
      }, signal).then((completion) => {
        queue.push(createSyntheticStreamChunk(completion) as T)
        queue.close()
      }).catch((fallbackError) => {
        queue.fail(new Error(`${normalizedError.message}; plugin-http fallback failed: ${getErrorMessage(fallbackError)}`))
      })
      return
    }
    queue.fail(normalizedError)
  }).finally(() => {
    detachAbort()
  })

  return queue
}

type ChatCompletionCreate = {
  (body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<OpenAI.Chat.ChatCompletion>
  (body: OpenAI.Chat.ChatCompletionCreateParamsStreaming, options?: { signal?: AbortSignal }): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>
}

export type OpenAICompatibleClient = {
  chat: {
    completions: {
      create: ChatCompletionCreate
    }
  }
  models: {
    list: (options?: { signal?: AbortSignal }) => Promise<ModelsPage>
  }
}

export function createTauriOpenAIClient(aiConfig?: AiConfig): OpenAICompatibleClient {
  const config = normalizeConfig(aiConfig)

  return {
    chat: {
      completions: {
        create: (async (body, options) => {
          if ('stream' in body && body.stream) {
            const requestId = createRequestId()
            return createStreamingIterable<OpenAI.Chat.Completions.ChatCompletionChunk>({
              config,
              requestId,
              body,
            }, options?.signal)
          }

          return invokeAiJson<OpenAI.Chat.ChatCompletion>({
            config,
            path: '/chat/completions',
            method: 'POST',
            body,
          }, options?.signal)
        }) as ChatCompletionCreate,
      },
    },
    models: {
      list: async (options) =>
        invokeAiJson<ModelsPage>({
          config,
          path: '/models',
          method: 'GET',
        }, options?.signal),
    },
  }
}

export async function blobToBytes(blob: Blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}
