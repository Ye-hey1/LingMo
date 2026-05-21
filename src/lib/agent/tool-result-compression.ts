import type { Tool, ToolResult } from './types'

const DEFAULT_MESSAGE_LIMIT = 2400
const DEFAULT_DATA_LIMIT = 9000

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

function truncate(value: string, limit: number) {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit).trim()}\n\n[compressed: ${normalized.length - limit} chars omitted]`
}

function stableStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractReadableData(value: unknown, limit: number) {
  if (typeof value === 'string') {
    return truncate(value, limit)
  }

  if (Array.isArray(value)) {
    const preview = value.slice(0, 20)
    const suffix = value.length > preview.length ? `\n\n[compressed: ${value.length - preview.length} array items omitted]` : ''
    return `${truncate(stableStringify(preview), limit)}${suffix}`
  }

  if (value && typeof value === 'object') {
    return truncate(stableStringify(value), limit)
  }

  return ''
}

export function compressToolResult(tool: Tool, result: ToolResult): ToolResult {
  if (!result.success) {
    return {
      ...result,
      error: result.error ? truncate(result.error, DEFAULT_MESSAGE_LIMIT) : result.error,
      message: result.message ? truncate(result.message, DEFAULT_MESSAGE_LIMIT) : result.message,
    }
  }

  const messageLimit = tool.category === 'mcp' || tool.category === 'web'
    ? 3200
    : DEFAULT_MESSAGE_LIMIT
  const dataLimit = tool.category === 'mcp' || tool.category === 'web'
    ? 12000
    : DEFAULT_DATA_LIMIT

  const compressed: ToolResult = {
    ...result,
    message: result.message ? truncate(result.message, messageLimit) : result.message,
  }

  if (result.data !== undefined) {
    const serialized = extractReadableData(result.data, dataLimit)
    if (serialized) {
      compressed.data = {
        compressed: true,
        originalType: Array.isArray(result.data) ? 'array' : typeof result.data,
        itemCount: Array.isArray(result.data) ? result.data.length : undefined,
        preview: serialized,
      }
    }
  }

  return compressed
}
