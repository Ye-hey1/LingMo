import type { CallToolResult } from './types'

export function normalizeCallToolResult(result: unknown): CallToolResult {
  if (!result || typeof result !== 'object') {
    return {
      content: [{ type: 'text', text: '' }],
      isError: true,
    }
  }

  const typed = result as Partial<CallToolResult>
  return {
    content: Array.isArray(typed.content) ? typed.content : [],
    isError: Boolean(typed.isError),
  }
}
