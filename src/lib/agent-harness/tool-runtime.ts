import type { Tool } from '@/lib/agent/types'
import type { ToolObservation } from './types'

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

function summarizeResult(result: Awaited<ReturnType<Tool['execute']>>) {
  return (result.message || result.error || JSON.stringify(result.data || '')).slice(0, 1200)
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
      return {
        toolName: tool.name,
        success: false,
        summary: error,
        errorKind: classifyError(error),
        retryable: isRetryableError(error),
      }
    }

    return {
      toolName: tool.name,
      success: true,
      summary: summarizeResult(result),
      artifacts: Array.isArray(result.data?.output_files) ? result.data.output_files : undefined,
      retryable: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      toolName: tool.name,
      success: false,
      summary: message,
      errorKind: classifyError(message),
      retryable: isRetryableError(message),
    }
  }
}
