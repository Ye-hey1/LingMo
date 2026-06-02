// ============================================================================
// Tool Utils — 工具执行超时保护 + 结果压缩
// ============================================================================

import type { Tool, ToolResult, ToolExecutionContext } from './types'

/**
 * 工具执行超时保护
 * 为每个工具执行添加统一的超时机制，防止 Agent 因单个工具卡死
 */

// 不同类别工具的默认超时时间（毫秒）
const TOOL_TIMEOUT_MAP: Record<string, number> = {
  web: 20000,       // 网络工具 20s
  mcp: 30000,      // MCP 工具 30s
  filesystem: 15000, // 文件系统 15s
  editor: 10000,    // 编辑器 10s
  note: 10000,      // 笔记 10s
  chat: 10000,      // 聊天 10s
  tag: 5000,        // 标签 5s
  mark: 5000,       // 标记 5s
  search: 15000,    // 搜索 15s
  system: 15000,    // 系统 15s
}

const DEFAULT_TIMEOUT = 30000

/**
 * 获取工具的超时时间
 */
function getToolTimeout(tool: Tool): number {
  return TOOL_TIMEOUT_MAP[tool.category] || DEFAULT_TIMEOUT
}

/**
 * 带超时保护的工具执行
 */
export async function executeWithTimeout(
  tool: Tool,
  params: Record<string, any>,
  context?: ToolExecutionContext,
  customTimeoutMs?: number
): Promise<ToolResult> {
  const timeoutMs = customTimeoutMs || getToolTimeout(tool)

  // 如果已经有外部 abort signal，组合使用
  const controller = new AbortController()
  const combinedSignal = context?.abortSignal
    ? combineAbortSignals(context.abortSignal, controller.signal)
    : controller.signal

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await tool.execute(params, {
      ...context,
      abortSignal: combinedSignal,
    })
    return result
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        success: false,
        error: `Tool "${tool.name}" execution timed out after ${timeoutMs}ms. The operation may still be running in the background.`,
      }
    }
    // 外部取消
    if (context?.abortSignal?.aborted) {
      return {
        success: false,
        error: 'Tool execution cancelled by user.',
      }
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 组合多个 AbortSignal
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller.signal
}

// ============================================================================
// Tool Result Compression
// ============================================================================


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
