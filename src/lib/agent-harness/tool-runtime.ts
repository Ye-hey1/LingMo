import type { Tool } from '@/lib/agent/types'
import type { ToolObservation } from './types'
import { writeAgentVfsText } from './vfs'

const MAX_INLINE_OBSERVATION_CHARS = 4000

function classifyError(error: string): ToolObservation['errorKind'] {
  if (/timeout|timed out/i.test(error)) return 'timeout'
  if (/permission|unauthorized|forbidden/i.test(error)) return 'permission'
  if (/network|fetch|connect|http/i.test(error)) return 'network'
  if (/invalid|required|schema|参数/i.test(error)) return 'validation'
  return 'tool'
}

function isRetryableError(error: string) {
  return /timeout|network|fetch|connect/i.test(error)
}

function formatResultText(result: Awaited<ReturnType<Tool['execute']>>) {
  return result.message || result.error || JSON.stringify(result.data || '')
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
  context: Parameters<Tool['execute']>[1],
): Promise<ToolObservation> {
  try {
    const result = await tool.execute(params, context)
    if (!result.success) {
      const error = result.error || result.message || 'Tool failed'
      return maybeOffloadObservation({
        toolName: tool.name,
        success: false,
        summary: error,
        errorKind: classifyError(error),
        retryable: isRetryableError(error),
      }, error, tool, context)
    }

    const fullText = formatResultText(result)
    return maybeOffloadObservation({
      toolName: tool.name,
      success: true,
      summary: fullText,
      artifacts: Array.isArray(result.data?.output_files) ? result.data.output_files : undefined,
      retryable: false,
    }, fullText, tool, context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return maybeOffloadObservation({
      toolName: tool.name,
      success: false,
      summary: message,
      errorKind: classifyError(message),
      retryable: isRetryableError(message),
    }, message, tool, context)
  }
}
