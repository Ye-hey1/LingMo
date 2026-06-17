import type { Tool, ToolExecutionContext, ToolResult } from '@/lib/agent/types'
import type { HarnessToolExecutionResult, ToolObservation } from './types'
import { writeAgentVfsText } from './vfs'
import { compressToolResult, executeWithTimeout } from '@/lib/agent/tool-utils'
import { getToolMutationTargets, withMutationQueue } from './mutation-queue'

const MAX_INLINE_OBSERVATION_CHARS = 4000
const MAX_RETRIES = 2
const TRANSIENT_ERROR_RE = /timeout|network|fetch|connect|econnrefused|econnreset|enotfound|rate.?limit|429|503|502|500|internal.?server|temporar/i

function classifyError(error: string): ToolObservation['errorKind'] {
  if (/invalid[_\s-]?api[_\s-]?key|api key|unauthorized|forbidden|permission/i.test(error)) return 'permission'
  if (/timeout|timed out/i.test(error)) return 'timeout'
  if (/network|fetch|connect|http/i.test(error)) return 'network'
  if (/invalid|required|schema|参数/i.test(error)) return 'validation'
  return 'tool'
}

function isRetryableError(error: string) {
  if (/invalid[_\s-]?api[_\s-]?key|api key|unauthorized|forbidden|permission/i.test(error)) return false
  return /timeout|network|fetch|connect/i.test(error)
}

function isResultMarkedRetryable(result: ToolResult) {
  const message = `${result.error || ''}\n${result.message || ''}`
  if (/invalid[_\s-]?api[_\s-]?key|api key|unauthorized|forbidden|permission/i.test(message)) {
    return false
  }

  return Boolean(
    result.data?.retryable ||
    /STALE_MCP_TOOL_REGISTRY|rate.?limit|429|503|502|500|temporar/i.test(message)
  )
}

function formatResultText(result: Awaited<ReturnType<Tool['execute']>>) {
  return result.message || result.error || JSON.stringify(result.data || '')
}

function isTransientError(error?: string) {
  return Boolean(error && TRANSIENT_ERROR_RE.test(error))
}

function abortErrorMessage() {
  return 'Tool execution cancelled.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function assertNotAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  assertNotAborted(signal)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException(abortErrorMessage(), 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function cancelledToolResult(tool: Tool, context: ToolExecutionContext): Promise<HarnessToolExecutionResult> {
  const message = abortErrorMessage()
  const result: ToolResult = {
    success: false,
    error: message,
    message,
  }
  const observation = await maybeOffloadObservation({
    toolName: tool.name,
    success: false,
    summary: message,
    errorKind: 'tool',
    retryable: false,
  }, message, tool, context)
  return { result, observation }
}

async function maybeOffloadObservation(
  observation: ToolObservation,
  fullText: string,
  tool: Tool,
  context: Parameters<Tool['execute']>[1],
): Promise<ToolObservation> {
  if (fullText.length <= MAX_INLINE_OBSERVATION_CHARS) {
    return {
      ...observation,
      summary: fullText,
    }
  }

  if (!context?.runId) {
    return {
      ...observation,
      summary: fullText.slice(0, MAX_INLINE_OBSERVATION_CHARS),
    }
  }

  const ref = await writeAgentVfsText(
    context.runId,
    'observation',
    `${context.stepId || Date.now()}-${tool.name}.txt`,
    fullText,
    fullText.slice(0, 500),
  )

  return {
    ...observation,
    summary: fullText.slice(0, MAX_INLINE_OBSERVATION_CHARS),
    dataRef: ref.uri,
  }
}

export async function executeHarnessTool(
  tool: Tool,
  params: Record<string, any>,
  context: ToolExecutionContext = {},
): Promise<HarnessToolExecutionResult> {
  try {
    let result!: ToolResult

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      assertNotAborted(context.abortSignal)
      if (attempt > 0) {
        const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 2000)
        await sleepWithAbort(delayMs, context.abortSignal)
        assertNotAborted(context.abortSignal)
      }

      const mutationTargets = getToolMutationTargets(tool.name, params)
      const shouldQueueMutation = Boolean(
        mutationTargets.length > 0 &&
        (tool.capabilities?.some(capability => capability === 'write' || capability === 'delete' || capability === 'execute') ||
          tool.requiresConfirmation ||
          tool.risk === 'medium' ||
          tool.risk === 'high')
      )
      result = shouldQueueMutation
        ? await withMutationQueue(mutationTargets, () => executeWithTimeout(tool, params, context))
        : await executeWithTimeout(tool, params, context)
      if (result.success || attempt === MAX_RETRIES || !isTransientError(result.error || result.message)) {
        break
      }
    }

    result = compressToolResult(tool, result)

    if (!result.success) {
      const error = result.error || result.message || 'Tool failed'
      const retryable = isRetryableError(error) || isResultMarkedRetryable(result)
      const observation = await maybeOffloadObservation({
        toolName: tool.name,
        success: false,
        summary: error,
        errorKind: classifyError(error),
        retryable,
      }, error, tool, context)
      return { result, observation }
    }

    const fullText = formatResultText(result)
    const observation = await maybeOffloadObservation({
      toolName: tool.name,
      success: true,
      summary: fullText,
      artifacts: Array.isArray(result.data?.output_files) ? result.data.output_files : undefined,
      retryable: false,
    }, fullText, tool, context)
    return { result, observation }
  } catch (error) {
    if (isAbortError(error)) {
      return cancelledToolResult(tool, context)
    }

    const message = error instanceof Error ? error.message : String(error)
    const result: ToolResult = {
      success: false,
      error: message,
    }
    const observation = await maybeOffloadObservation({
      toolName: tool.name,
      success: false,
      summary: message,
      errorKind: classifyError(message),
      retryable: isRetryableError(message),
    }, message, tool, context)
    return { result, observation }
  }
}
