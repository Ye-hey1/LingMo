/**
 * BaseAgent - 统一的 Agent 基类
 *
 * 提取 ReActAgent 和 FunctionCallAgent 的公共逻辑：
 * - 事件发射
 * - 步骤管理
 * - 工具执行（含重试、缓存、策略检查）
 * - 确认机制
 * - 工作记忆记录
 * - 循环检测
 */

import type { AgentEvent, ReActStep, ToolCall, ToolResult } from './types'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { createAgentEventBus, type AgentEventBus } from './event-bus'
import { executeWithTimeout } from './tool-executor'
import { compressToolResult } from './tool-result-compression'
import { ToolResultCache } from './tool-cache'
import { IntentPolicy, deriveIntentPolicy } from './tool-policy'

// ---------------------------------------------------------------------------
// Transient error detection
// ---------------------------------------------------------------------------

const TRANSIENT_ERROR_RE =
  /timeout|network|fetch|econnrefused|econnreset|enotfound|rate.?limit|429|503|502|500|internal.?server|temporar/i

function isTransientError(msg: string): boolean {
  return TRANSIENT_ERROR_RE.test(msg)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseAgentConfig {
  maxIterations: number
  webSearchEnabled?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onEvent?: (event: AgentEvent) => void
  onIterationStart?: () => void
  onFinalAnswerRender?: (content: string) => void
  requestConfirmation?: (toolName: string, params: Record<string, any>, context?: any) => Promise<boolean>
  activeSkills?: string[]
  activeSkillMatches?: SkillMatchSummary[]
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
}

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  protected config: BaseAgentConfig
  protected steps: ReActStep[] = []
  protected eventBus: AgentEventBus = createAgentEventBus()
  protected currentIteration = 0
  protected toolCallCounter = 0
  protected stopped = false
  protected abortController: AbortController | null = null
  protected intentPolicy: IntentPolicy = { allowWrite: false, allowDestructive: false, allowExecute: false }
  protected toolCache = new ToolResultCache()
  protected currentUserInput = ''
  protected toolFailureHistory: Array<{ toolName: string; argsHash: string; success: boolean }> = []

  constructor(config: BaseAgentConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 15
    }
  }

  // =========================================================================
  // Abstract methods - subclasses must implement
  // =========================================================================

  abstract run(userInput: string, contextOrMessages?: any, imageUrls?: string[]): Promise<string>

  // =========================================================================
  // Event emission
  // =========================================================================

  protected emitEvent(type: AgentEvent['type'], payload?: Record<string, any>) {
    const event = this.eventBus.emit(type, payload, {
      iteration: this.currentIteration || undefined,
      level: type === 'error' ? 'error' : undefined,
    })
    this.config.onEvent?.(event)
  }

  protected emitToolCall(toolCall: ToolCall) {
    this.config.onToolCall?.(toolCall)
    this.emitEvent('tool.updated', {
      toolCall: {
        ...toolCall,
        params: { ...toolCall.params },
        result: toolCall.result ? { ...toolCall.result } : undefined,
      },
    })
  }

  protected emitObservation(observation: string) {
    this.config.onObservation?.(observation)
    this.emitEvent('observation.created', { observation })
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  stop() {
    this.stopped = true
    this.emitEvent('agent.stopped')
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  isStopped(): boolean {
    return this.stopped
  }

  getSteps(): ReActStep[] {
    return [...this.steps]
  }

  getCurrentIteration(): number {
    return this.currentIteration
  }

  // =========================================================================
  // Argument hashing
  // =========================================================================

  protected hashArgs(args: Record<string, any>): string {
    try {
      const sortedArgs = Object.keys(args).sort().reduce((acc, key) => {
        acc[key] = args[key]
        return acc
      }, {} as Record<string, any>)
      return JSON.stringify(sortedArgs)
    } catch {
      return String(args)
    }
  }

  // =========================================================================
  // Failure tracking
  // =========================================================================

  protected recordToolResult(toolName: string, argsHash: string, success: boolean) {
    this.toolFailureHistory.push({ toolName, argsHash, success })
    if (this.toolFailureHistory.length > 50) {
      this.toolFailureHistory.shift()
    }
  }

  protected checkConsecutiveFailures(toolName: string, argsHash: string): { shouldStop: boolean; reason: string } {
    // Check same args consecutive calls
    let sameArgsCalls = 0
    for (let i = this.toolFailureHistory.length - 1; i >= 0; i--) {
      const record = this.toolFailureHistory[i]
      if (record.toolName === toolName && record.argsHash === argsHash) {
        sameArgsCalls++
      } else {
        break
      }
    }
    if (sameArgsCalls >= 5) {
      return {
        shouldStop: true,
        reason: `【死循环熔断】工具 "${toolName}" 使用相同参数已被连续调用 ${sameArgsCalls} 次。已自动阻止执行以防止无限循环。`,
      }
    }

    // Check same args consecutive failures
    let sameArgsFailures = 0
    for (let i = this.toolFailureHistory.length - 1; i >= 0; i--) {
      const record = this.toolFailureHistory[i]
      if (record.toolName === toolName && record.argsHash === argsHash) {
        if (!record.success) {
          sameArgsFailures++
        } else {
          break
        }
      } else {
        break
      }
    }
    if (sameArgsFailures >= 3) {
      return {
        shouldStop: true,
        reason: `【重试次数超限】工具 "${toolName}" 使用相同参数已连续失败 ${sameArgsFailures} 次。已拦截重复执行。`,
      }
    }

    // Check any args consecutive failures for same tool
    let anyArgsFailures = 0
    for (let i = this.toolFailureHistory.length - 1; i >= 0; i--) {
      const record = this.toolFailureHistory[i]
      if (record.toolName === toolName) {
        if (!record.success) {
          anyArgsFailures++
        } else {
          break
        }
      } else {
        break
      }
    }
    if (anyArgsFailures >= 8) {
      return {
        shouldStop: true,
        reason: `【重试次数超限】工具 "${toolName}" 连续执行失败达 ${anyArgsFailures} 次，已强行终止。请尝试更换方法。`,
      }
    }

    return { shouldStop: false, reason: '' }
  }

  // =========================================================================
  // Tool execution with retry
  // =========================================================================

  protected async executeWithTransientRetry(
    tool: import('./types').Tool,
    params: Record<string, any>,
  ): Promise<ToolResult> {
    const MAX_RETRIES = 2
    let result!: ToolResult

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 2000)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      result = await executeWithTimeout(tool, params, {
        abortSignal: this.abortController?.signal,
        runId: this.eventBus.getRunId(),
        iteration: this.currentIteration,
        userInput: this.currentUserInput,
      })
      result = compressToolResult(tool, result)

      // Only retry on transient errors
      if (result.success || attempt === MAX_RETRIES) break

      const errMsg = (result.error || '').toLowerCase()
      if (!isTransientError(errMsg)) break
    }

    return result
  }

  // =========================================================================
  // Working memory
  // =========================================================================

  protected async recordWorkingMemory(toolName: string, params: Record<string, any>, success: boolean, error?: string) {
    try {
      const { recordToolUsage, recordFileAccess, recordFailedAttempt } = await import('./working-memory')
      recordToolUsage(toolName)
      const filePath = params.filePath || params.path || params.folderPath
      if (typeof filePath === 'string' && filePath.trim()) {
        recordFileAccess(filePath)
      }
      if (!success && error) {
        recordFailedAttempt(toolName, params, error)
      }
    } catch {
      // Non-critical
    }
  }

  // =========================================================================
  // Message validation
  // =========================================================================

  protected validateAndFixMessages(messages: any[]): any[] {
    const fixedMessages: any[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      fixedMessages.push(msg)

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCalls = msg.tool_calls
        for (const tc of toolCalls) {
          const matchingToolResultIndex = this.findMatchingToolResult(messages, i + 1, tc.id)
          if (matchingToolResultIndex === -1) {
            fixedMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `Error: Tool result lost due to context window limits.`,
            })
          }
        }
      }
    }

    return fixedMessages
  }

  protected findMatchingToolResult(messages: any[], startIndex: number, toolCallId: string): number {
    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'tool' && msg.tool_call_id === toolCallId) {
        return i
      }
    }
    return -1
  }

  // =========================================================================
  // Reset for new run
  // =========================================================================

  protected resetForNewRun(userInput?: string) {
    if (typeof userInput === 'string') {
      this.currentUserInput = userInput
    }
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0
    this.stopped = false
    this.eventBus.reset()
    this.toolCache.invalidateAll()
    this.toolFailureHistory = []
    this.abortController = new AbortController()
    this.intentPolicy = deriveIntentPolicy(this.currentUserInput)
  }
}
