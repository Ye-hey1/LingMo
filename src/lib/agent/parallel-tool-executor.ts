/**
 * 并行工具执行器
 *
 * 借鉴 claude-code-source 的 StreamingToolExecutor 核心设计：
 * - 只读工具（read, list, search, get）可并发执行
 * - 写入工具（create, update, delete, replace）必须串行执行
 * - 并发执行的中间结果按原始顺序收集，保证消息顺序
 * - 一个工具失败不影响其他工具（隔离错误）
 *
 * 优化效果：
 * - 当 LLM 一次返回多个只读工具调用时（如同时读取多个文件），
 *   执行时间从 N*T 降低到 ~T（并行执行）
 */

import type { Tool, ToolResult, ToolExecutionContext } from './types'
import { executeWithTimeout, compressToolResult } from './tool-utils'

// ---------------------------------------------------------------------------
// 工具并发安全判断
// ---------------------------------------------------------------------------

const READ_PREFIXES = [
  'read_', 'list_', 'search_', 'get_', 'safe_grep', 'safe_list',
  'safe_read', 'check_', 'fetch_', 'query_', 'web_search', 'web_extract',
  'web_fetch',
]

/**
 * 判断工具调用是否是只读的（可以安全并发执行）
 */
function isReadOnlyToolCall(toolName: string, tool?: Tool): boolean {
  if (tool) {
    // 使用工具定义的风险级别和 capabilities
    if (tool.risk === 'low') return true
    if (tool.capabilities?.includes('read') && !tool.capabilities.includes('write')) return true
  }

  const baseName = toolName.includes('__')
    ? toolName.split('__').pop()!
    : toolName

  return READ_PREFIXES.some(prefix => baseName.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ParallelToolCall {
  id: string
  toolName: string
  params: Record<string, any>
  tool: Tool
}

export interface ParallelToolResult {
  callId: string
  toolName: string
  params: Record<string, any>
  result: ToolResult
  /** 执行耗时（ms） */
  durationMs: number
  error?: string
}

// ---------------------------------------------------------------------------
// 分组策略
// ---------------------------------------------------------------------------

type Batch = {
  isReadOnly: boolean
  calls: ParallelToolCall[]
}

/**
 * 将工具调用分组为批次：
 * - 连续的只读工具合并为一个批次（可并发执行）
 * - 单个写入工具独占一个批次（串行执行）
 */
export function partitionToolCalls(calls: ParallelToolCall[]): Batch[] {
  const batches: Batch[] = []

  for (const call of calls) {
    const isReadOnly = isReadOnlyToolCall(call.toolName, call.tool)

    if (isReadOnly && batches.length > 0 && batches[batches.length - 1].isReadOnly) {
      // 追加到上一个只读批次
      batches[batches.length - 1].calls.push(call)
    } else {
      // 新批次
      batches.push({ isReadOnly, calls: [call] })
    }
  }

  return batches
}

// ---------------------------------------------------------------------------
// 并行执行器
// ---------------------------------------------------------------------------

/**
 * 并行执行一组只读工具调用
 */
async function executeReadOnlyBatch(
  calls: ParallelToolCall[],
  context?: ToolExecutionContext,
): Promise<ParallelToolResult[]> {
  const promises = calls.map(async (call) => {
    const startTime = Date.now()
    try {
      const result = await executeWithTimeout(call.tool, call.params, context)
      const compressed = compressToolResult(call.tool, result)
      return {
        callId: call.id,
        toolName: call.toolName,
        params: call.params,
        result: compressed,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        callId: call.id,
        toolName: call.toolName,
        params: call.params,
        result: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return Promise.all(promises)
}

/**
 * 串行执行一组写入工具调用
 */
async function executeWriteBatch(
  calls: ParallelToolCall[],
  context?: ToolExecutionContext,
): Promise<ParallelToolResult[]> {
  const results: ParallelToolResult[] = []

  for (const call of calls) {
    const startTime = Date.now()
    try {
      const result = await executeWithTimeout(call.tool, call.params, context)
      const compressed = compressToolResult(call.tool, result)
      results.push({
        callId: call.id,
        toolName: call.toolName,
        params: call.params,
        result: compressed,
        durationMs: Date.now() - startTime,
      })
    } catch (error) {
      results.push({
        callId: call.id,
        toolName: call.toolName,
        params: call.params,
        result: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 按批次执行工具调用列表，保持结果顺序。
 *
 * - 只读批次：Promise.all 并发执行
 * - 写入批次：串行执行
 *
 * 返回的结果顺序与输入的调用顺序一致（不论实际执行顺序）。
 */
export async function executeToolsBatched(
  calls: ParallelToolCall[],
  context?: ToolExecutionContext,
  onResult?: (result: ParallelToolResult) => void,
): Promise<ParallelToolResult[]> {
  if (calls.length === 0) return []
  if (calls.length === 1) {
    // 单个调用，直接执行
    const startTime = Date.now()
    try {
      const result = await executeWithTimeout(calls[0].tool, calls[0].params, context)
      const compressed = compressToolResult(calls[0].tool, result)
      const pr: ParallelToolResult = {
        callId: calls[0].id,
        toolName: calls[0].toolName,
        params: calls[0].params,
        result: compressed,
        durationMs: Date.now() - startTime,
      }
      onResult?.(pr)
      return [pr]
    } catch (error) {
      const pr: ParallelToolResult = {
        callId: calls[0].id,
        toolName: calls[0].toolName,
        params: calls[0].params,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      }
      onResult?.(pr)
      return [pr]
    }
  }

  const batches = partitionToolCalls(calls)
  const allResults: ParallelToolResult[] = []

  for (const batch of batches) {
    let batchResults: ParallelToolResult[]

    if (batch.isReadOnly && batch.calls.length > 1) {
      // 并发执行只读工具
      batchResults = await executeReadOnlyBatch(batch.calls, context)
    } else {
      // 串行执行写入工具（或单个只读工具）
      batchResults = await executeWriteBatch(batch.calls, context)
    }

    for (const result of batchResults) {
      onResult?.(result)
    }
    allResults.push(...batchResults)
  }

  return allResults
}
