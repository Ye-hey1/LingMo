/**
 * Agent 执行指标收集模块
 *
 * 收集指标：
 * 1. Token 消耗统计
 * 2. 工具执行耗时
 * 3. 失败率统计
 * 4. 平均迭代次数
 * 5. 上下文压缩触发频率
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionMetrics {
  runId: string
  startTime: number
  endTime?: number
  duration?: number

  // Iteration metrics
  totalIterations: number
  successfulIterations: number
  failedIterations: number

  // Tool metrics
  toolCalls: ToolCallMetrics[]
  totalToolCalls: number
  successfulToolCalls: number
  failedToolCalls: number

  // Token metrics (estimated)
  estimatedInputTokens: number
  estimatedOutputTokens: number

  // Compression metrics
  compressionTriggered: number
  compressionSavedChars: number

  // Error metrics
  errors: ErrorMetrics[]
}

export interface ToolCallMetrics {
  toolName: string
  startTime: number
  endTime?: number
  duration?: number
  success: boolean
  cached: boolean
  retryCount: number
  errorMessage?: string
}

export interface ErrorMetrics {
  type: 'tool' | 'llm' | 'policy' | 'timeout' | 'overflow'
  message: string
  toolName?: string
  timestamp: number
  iteration: number
}

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private metrics: ExecutionMetrics
  private toolCallStartTimes = new Map<string, number>()

  constructor(runId: string) {
    this.metrics = {
      runId,
      startTime: Date.now(),
      totalIterations: 0,
      successfulIterations: 0,
      failedIterations: 0,
      toolCalls: [],
      totalToolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      compressionTriggered: 0,
      compressionSavedChars: 0,
      errors: [],
    }
  }

  // ---------------------------------------------------------------------------
  // Iteration tracking
  // ---------------------------------------------------------------------------

  recordIteration(success: boolean): void {
    this.metrics.totalIterations++
    if (success) {
      this.metrics.successfulIterations++
    } else {
      this.metrics.failedIterations++
    }
  }

  // ---------------------------------------------------------------------------
  // Tool call tracking
  // ---------------------------------------------------------------------------

  startToolCall(toolCallId: string, _toolName: string): void {
    this.toolCallStartTimes.set(toolCallId, Date.now())
    this.metrics.totalToolCalls++
  }

  endToolCall(
    toolCallId: string,
    toolName: string,
    success: boolean,
    options: {
      cached?: boolean
      retryCount?: number
      errorMessage?: string
    } = {}
  ): void {
    const startTime = this.toolCallStartTimes.get(toolCallId) || Date.now()
    const endTime = Date.now()
    const duration = endTime - startTime

    this.toolCallStartTimes.delete(toolCallId)

    this.metrics.toolCalls.push({
      toolName,
      startTime,
      endTime,
      duration,
      success,
      cached: options.cached || false,
      retryCount: options.retryCount || 0,
      errorMessage: options.errorMessage,
    })

    if (success) {
      this.metrics.successfulToolCalls++
    } else {
      this.metrics.failedToolCalls++
    }
  }

  // ---------------------------------------------------------------------------
  // Token estimation
  // ---------------------------------------------------------------------------

  estimateTokens(text: string, type: 'input' | 'output'): void {
    // Simple estimation: ~4 chars per token for English, ~2 chars per token for CJK
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const otherChars = text.length - cjkChars
    const estimatedTokens = Math.ceil(cjkChars / 2 + otherChars / 4)

    if (type === 'input') {
      this.metrics.estimatedInputTokens += estimatedTokens
    } else {
      this.metrics.estimatedOutputTokens += estimatedTokens
    }
  }

  // ---------------------------------------------------------------------------
  // Compression tracking
  // ---------------------------------------------------------------------------

  recordCompression(savedChars: number): void {
    this.metrics.compressionTriggered++
    this.metrics.compressionSavedChars += savedChars
  }

  // ---------------------------------------------------------------------------
  // Error tracking
  // ---------------------------------------------------------------------------

  recordError(
    type: ErrorMetrics['type'],
    message: string,
    options: {
      toolName?: string
      iteration?: number
    } = {}
  ): void {
    this.metrics.errors.push({
      type,
      message,
      toolName: options.toolName,
      timestamp: Date.now(),
      iteration: options.iteration || 0,
    })
  }

  // ---------------------------------------------------------------------------
  // Finalize
  // ---------------------------------------------------------------------------

  finalize(): ExecutionMetrics {
    this.metrics.endTime = Date.now()
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime
    return { ...this.metrics }
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics }
  }

  getAverageToolDuration(): number {
    const durations = this.metrics.toolCalls
      .map(tc => tc.duration)
      .filter((d): d is number => d !== undefined)

    if (durations.length === 0) return 0
    return durations.reduce((a, b) => a + b, 0) / durations.length
  }

  getToolFailureRate(): number {
    if (this.metrics.totalToolCalls === 0) return 0
    return this.metrics.failedToolCalls / this.metrics.totalToolCalls
  }

  getTopFailedTools(limit = 5): Array<{ toolName: string; count: number }> {
    const failures = new Map<string, number>()
    for (const tc of this.metrics.toolCalls) {
      if (!tc.success) {
        failures.set(tc.toolName, (failures.get(tc.toolName) || 0) + 1)
      }
    }

    return Array.from(failures.entries())
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  getSlowestTools(limit = 5): Array<{ toolName: string; avgDuration: number }> {
    const toolDurations = new Map<string, number[]>()
    for (const tc of this.metrics.toolCalls) {
      if (tc.duration !== undefined) {
        const durations = toolDurations.get(tc.toolName) || []
        durations.push(tc.duration)
        toolDurations.set(tc.toolName, durations)
      }
    }

    return Array.from(toolDurations.entries())
      .map(([toolName, durations]) => ({
        toolName,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit)
  }
}

// ---------------------------------------------------------------------------
// Metrics summary formatting
// ---------------------------------------------------------------------------

export function formatMetricsSummary(metrics: ExecutionMetrics): string {
  const duration = metrics.duration ? `${(metrics.duration / 1000).toFixed(1)}s` : 'N/A'
  const toolSuccessRate = metrics.totalToolCalls > 0
    ? `${((metrics.successfulToolCalls / metrics.totalToolCalls) * 100).toFixed(1)}%`
    : 'N/A'
  const estimatedTotalTokens = metrics.estimatedInputTokens + metrics.estimatedOutputTokens

  return `## Execution Metrics

**Duration**: ${duration}
**Iterations**: ${metrics.totalIterations} (${metrics.successfulIterations} successful, ${metrics.failedIterations} failed)

**Tool Calls**: ${metrics.totalToolCalls} total
- Success rate: ${toolSuccessRate}
- Successful: ${metrics.successfulToolCalls}
- Failed: ${metrics.failedToolCalls}

**Token Usage** (estimated):
- Input: ~${metrics.estimatedInputTokens.toLocaleString()} tokens
- Output: ~${metrics.estimatedOutputTokens.toLocaleString()} tokens
- Total: ~${estimatedTotalTokens.toLocaleString()} tokens

**Context Compression**:
- Triggered: ${metrics.compressionTriggered} times
- Saved: ~${metrics.compressionSavedChars.toLocaleString()} characters

**Errors**: ${metrics.errors.length} total
${metrics.errors.length > 0 ? metrics.errors.slice(0, 3).map(e => `- ${e.type}: ${e.message.slice(0, 100)}`).join('\n') : '- None'}
`
}

// ---------------------------------------------------------------------------
// Global metrics storage
// ---------------------------------------------------------------------------

const metricsHistory: ExecutionMetrics[] = []
const MAX_HISTORY = 100

export function storeMetrics(metrics: ExecutionMetrics): void {
  metricsHistory.push(metrics)
  if (metricsHistory.length > MAX_HISTORY) {
    metricsHistory.shift()
  }
}

export function getMetricsHistory(limit = 10): ExecutionMetrics[] {
  return metricsHistory.slice(-limit)
}

export function getAggregatedStats(): {
  totalRuns: number
  averageDuration: number
  averageIterations: number
  averageToolCalls: number
  overallToolSuccessRate: number
  mostUsedTools: Array<{ toolName: string; count: number }>
  mostFailedTools: Array<{ toolName: string; count: number }>
} {
  if (metricsHistory.length === 0) {
    return {
      totalRuns: 0,
      averageDuration: 0,
      averageIterations: 0,
      averageToolCalls: 0,
      overallToolSuccessRate: 0,
      mostUsedTools: [],
      mostFailedTools: [],
    }
  }

  const totalDuration = metricsHistory.reduce((sum, m) => sum + (m.duration || 0), 0)
  const totalIterations = metricsHistory.reduce((sum, m) => sum + m.totalIterations, 0)
  const totalToolCalls = metricsHistory.reduce((sum, m) => sum + m.totalToolCalls, 0)
  const totalSuccessfulToolCalls = metricsHistory.reduce((sum, m) => sum + m.successfulToolCalls, 0)

  // Count tool usage
  const toolUsage = new Map<string, number>()
  const toolFailures = new Map<string, number>()
  for (const m of metricsHistory) {
    for (const tc of m.toolCalls) {
      toolUsage.set(tc.toolName, (toolUsage.get(tc.toolName) || 0) + 1)
      if (!tc.success) {
        toolFailures.set(tc.toolName, (toolFailures.get(tc.toolName) || 0) + 1)
      }
    }
  }

  const mostUsedTools = Array.from(toolUsage.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const mostFailedTools = Array.from(toolFailures.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    totalRuns: metricsHistory.length,
    averageDuration: totalDuration / metricsHistory.length,
    averageIterations: totalIterations / metricsHistory.length,
    averageToolCalls: totalToolCalls / metricsHistory.length,
    overallToolSuccessRate: totalToolCalls > 0 ? totalSuccessfulToolCalls / totalToolCalls : 0,
    mostUsedTools,
    mostFailedTools,
  }
}
