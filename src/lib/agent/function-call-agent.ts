import type OpenAI from 'openai'
import type { AgentEvent, ToolCall } from './types'
import { BaseAgent, type BaseAgentConfig } from './base-agent'
import { convertToolsToOpenAIFormat } from './tool-definitions'
import { truncateObservation } from './safety-guards'
import { getToolByName, getAllToolsSync } from './tools'
import { evaluateIntentAwareToolPolicy } from './tool-policy'
import { buildToolExecutionPrompt } from './tool-intent'
import { filterToolsWithCache } from './dynamic-tool-filter'
import { detectAgentLoop } from './loop-detection'
import { formatFriendlyError } from './friendly-errors'
import { MetricsCollector, storeMetrics, formatMetricsSummary } from './metrics-collector'
import { trimMessages, aggressiveTrimForOverflow } from './message-trimmer'
import { shouldTrimMessages } from './token-budget'
import { buildAgentSystemPrompt } from './prompt-assembler'
import useArticleStore from '@/stores/article'
import type { SkillMatchSummary } from '@/lib/skills/types'

/**
 * Function Calling Agent — 基于 OpenAI tool_calls 的稳定 Agent 引擎
 *
 * 优化特性（移植自 CowAgent 设计模式）：
 * - CJK 感知 token 预算管理与智能上下文裁剪
 * - 空响应恢复 & 最大迭代总结
 * - 上下文溢出自动恢复
 * - 流式工具调用去抖（减少前端闪烁）
 * - 瞬态错误重试（timeout / 429 / 5xx）
 * - 动态工具过滤（省 token）
 * - 增强循环检测
 * - 用户友好的错误消息
 * - 执行指标收集
 */

export interface FunctionCallAgentConfig extends BaseAgentConfig {
  maxIterations: number
  webSearchEnabled?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onEvent?: (event: AgentEvent) => void
  onIterationStart?: () => void
  onFinalAnswerRender?: (content: string) => void
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
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
// Transient error detection
// ---------------------------------------------------------------------------

// Context overflow detection
const OVERFLOW_ERROR_RE =
  /context length exceeded|maximum context length|prompt is too long|context overflow|context window|too large|exceeds model context|request_too_large|request exceeds the maximum size|tokens exceed/i

function isContextOverflowError(msg: string): boolean {
  return OVERFLOW_ERROR_RE.test(msg)
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class FunctionCallAgent extends BaseAgent {
  /** Track the current model name for context window detection */
  private currentModelName = ''
  private metricsCollector: MetricsCollector

  constructor(config: FunctionCallAgentConfig) {
    super(config)
    this.metricsCollector = new MetricsCollector('')
  }

  async run(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    this.resetForNewRun(userInput)
    this.metricsCollector = new MetricsCollector(this.eventBus.getRunId())

    this.emitEvent('agent.started', { runId: this.eventBus.getRunId(), userInput, intentPolicy: this.intentPolicy })

    // ---- 动态工具过滤: 使用新的动态过滤模块 ----
    const allTools = getAllToolsSync()
    const availableTools = this.config.webSearchEnabled
      ? allTools
      : allTools.filter(tool => tool.category !== 'web' && !tool.capabilities?.includes('network'))
    const filteredTools = filterToolsWithCache(availableTools, this.steps)
    const openaiTools = convertToolsToOpenAIFormat(filteredTools)
    const toolExecutionPrompt = buildToolExecutionPrompt(this.currentUserInput)

    // 构建初始消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // System prompt（精简版 — Task 5）
    const systemPrompt = await this.buildSystemPrompt()
    messages.push({ role: 'system', content: systemPrompt })

    // 添加上下文/历史消息
    if (Array.isArray(contextOrMessages)) {
      messages.push(...contextOrMessages)
    } else if (contextOrMessages) {
      messages.push({ role: 'system', content: contextOrMessages })
    }

    // 用户消息
    if (imageUrls && imageUrls.length > 0) {
      const content: any[] = []
      for (const url of imageUrls) {
        try {
          const { convertImageToBase64 } = await import('@/lib/ai/utils')
          const base64 = await convertImageToBase64(url)
          if (base64) content.push({ type: 'image_url', image_url: { url: base64 } })
        } catch { /* skip */ }
      }
      content.push({ type: 'text', text: userInput })
      messages.push({ role: 'user', content })
    } else {
      messages.push({ role: 'user', content: userInput })
    }

    // ---- 智能上下文裁剪（Task 2）: 在循环前裁剪一次 ----
    const { createOpenAIClient, getAISettings } = await import('@/lib/ai/utils')
    const aiConfig = await getAISettings()
    if (aiConfig?.model) {
      this.currentModelName = aiConfig.model
      const trimResult = shouldTrimMessages(messages as any[], this.currentModelName, systemPrompt, aiConfig.contextWindow)
      if (trimResult.needsTrim) {
        const trimmed = trimMessages(messages as any[], {
          modelName: this.currentModelName,
          systemPrompt,
          contextWindow: aiConfig.contextWindow,
        })
        messages.length = 0
        messages.push(...trimmed as any)
      }
    }

    // 主循环：调用 LLM → 处理 tool_calls → 返回结果 → 重复
    let finalContent = ''

    while (this.currentIteration < this.config.maxIterations) {
      if (this.stopped) throw new Error('USER_STOPPED')

      // ---- 增强循环检测 ----
      if (this.currentIteration > 3) {
        const loopResult = detectAgentLoop(this.steps)
        if (loopResult.isLoop) {
          console.warn(`[Agent] Loop detected: ${loopResult.reason}`)
          finalContent = loopResult.suggestion
            ? `检测到执行循环：${loopResult.reason}\n\n建议：${loopResult.suggestion}`
            : `检测到执行循环：${loopResult.reason}`
          break
        }
      }

      this.currentIteration++
      this.emitEvent('iteration.started')
      this.config.onIterationStart?.()

      // 记录迭代指标
      this.metricsCollector.recordIteration(true)

      const aiConfigNow = await getAISettings()
      if (!aiConfigNow) {
        finalContent = 'AI 服务未配置，请先在设置中配置模型。'
        break
      }
      if (aiConfigNow.model) this.currentModelName = aiConfigNow.model

      const openai = await createOpenAIClient(aiConfigNow)

      let textContent = ''
      const toolCallsBuffer: any[] = []
      // ---- Task 3: 工具调用去抖 ----
      let lastEmittedToolName = ''
      let lastEmittedArgsLen = -1

      try {
        const forceToolCall = toolExecutionPrompt.length > 0
        const validatedMessages = this.validateAndFixMessages(messages)

        // ---- 上下文溢出恢复包装 ----
        const stream = await this.createStreamWithOverflowRecovery(
          openai, aiConfigNow, validatedMessages, openaiTools, forceToolCall, messages, systemPrompt,
        )

        // 流式响应超时保护：如果 90 秒没有收到任何 chunk，自动中断
        const STREAM_TIMEOUT_MS = 90000
        let lastChunkTime = Date.now()
        const streamTimeoutChecker = setInterval(() => {
          if (Date.now() - lastChunkTime > STREAM_TIMEOUT_MS) {
            console.warn('[Agent] Stream timeout - no chunks received for 90s')
            this.abortController?.abort()
          }
        }, 10000)

        try {
          for await (const chunk of stream) {
            if (this.stopped) break

            lastChunkTime = Date.now() // 收到 chunk，重置计时器
            const choice = chunk.choices[0]
            if (!choice) continue

            const delta = choice.delta
            if (!delta) continue

            const content = delta.content || ''
            if (content) {
              textContent += content
              this.config.onThought?.(textContent)
              this.emitEvent('thought', { content: textContent })
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0
                if (!toolCallsBuffer[index]) {
                  toolCallsBuffer[index] = {
                    id: tc.id || '',
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: ''
                    }
                  }
                }

                if (tc.id) {
                  toolCallsBuffer[index].id = tc.id
                }
                if (tc.function?.name) {
                  toolCallsBuffer[index].function.name = tc.function.name
                }
                if (tc.function?.arguments) {
                  toolCallsBuffer[index].function.arguments += tc.function.arguments
                }

                // 去抖 — 只在 name 确定且参数有实质变化时 emit
                const currentName = toolCallsBuffer[index].function.name
                const currentArgsStr = toolCallsBuffer[index].function.arguments
                if (
                  currentName &&
                  (currentName !== lastEmittedToolName || currentArgsStr.length !== lastEmittedArgsLen)
                ) {
                  lastEmittedToolName = currentName
                  lastEmittedArgsLen = currentArgsStr.length
                  let currentParams = {}
                  try {
                    if (currentArgsStr) currentParams = JSON.parse(currentArgsStr)
                  } catch { /* partial parse, ignore */ }

                  const toolCallId = toolCallsBuffer[index].id || `tc-stream-${index}`
                  const toolCall: ToolCall = {
                    id: toolCallId,
                    toolName: currentName,
                    params: currentParams,
                    status: 'running',
                    timestamp: Date.now(),
                  }
                  this.emitToolCall(toolCall)
                }
              }
            }
          }
        } finally {
          clearInterval(streamTimeoutChecker)
        }
      } catch (error) {
        if (this.stopped) throw new Error('USER_STOPPED')
        const msg = error instanceof Error ? error.message : String(error)

        // ---- 上下文溢出恢复 ----
        if (isContextOverflowError(msg)) {
          const recovered = this.recoverFromOverflow(messages, systemPrompt)
          if (recovered) {
            this.currentIteration--
            continue
          }
          finalContent = '对话上下文过长，请开启新的对话继续。'
          break
        }

        // 使用友好的错误消息
        const friendlyError = formatFriendlyError(msg)
        finalContent = `AI 服务调用失败: ${friendlyError.title}\n${friendlyError.message}`
        if (friendlyError.suggestion) {
          finalContent += `\n\n💡 ${friendlyError.suggestion}`
        }

        // 记录错误指标
        this.metricsCollector.recordError('llm', msg, { iteration: this.currentIteration })
        break
      }

      if (this.stopped) throw new Error('USER_STOPPED')

      const toolCalls = toolCallsBuffer.filter(Boolean)
      const assistantMessage = {
        role: 'assistant' as const,
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      }

      // ---- Task 3: 空响应恢复 ----
      if (!textContent && toolCalls.length === 0) {
        if (this.currentIteration > 1) {
          // 之前有工具执行，LLM 返回空 — 请求总结
          const recovered = await this.recoverEmptyResponse(
            messages, openai, aiConfigNow, openaiTools,
          )
          if (recovered) {
            finalContent = recovered
            break
          }
        }
        finalContent = '未收到 AI 响应，请重试。'
        break
      }

      // 如果没有 tool_calls，说明模型认为任务完成
      if (toolCalls.length === 0) {
        finalContent = textContent || '任务完成。'
        break
      }

      // 将 assistant 消息（含 tool_calls）加入历史
      messages.push(assistantMessage as any)

      // 执行每个 tool_call
      for (const tc of toolCalls) {
        if (this.stopped) throw new Error('USER_STOPPED')

        const toolName = tc.function.name
        let params: Record<string, any> = {}
        try {
          params = JSON.parse(tc.function.arguments || '{}')
        } catch {
          // 参数解析失败
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: Invalid JSON in tool arguments' })
          continue
        }

        const argsHash = this.hashArgs(params)
        const shouldStop = this.checkConsecutiveFailures(toolName, argsHash)
        if (shouldStop.shouldStop) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: shouldStop.reason })
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: shouldStop.reason })
          continue
        }

        this.config.onAction?.(toolName, params)
        this.emitEvent('action.parsed', { tool: toolName, params })

        // 查找工具（降级：如果不在 filtered tools 中，尝试从全量工具中查找）
        let tool = getToolByName(toolName)
        if (!tool) {
          // 动态过滤可能导致工具不在列表中 — 尝试全量查找
          tool = allTools.find(t => t.name === toolName) ?? undefined
        }
        if (!tool) {
          const errorMsg = `工具 "${toolName}" 不存在。`
          messages.push({ role: 'tool', tool_call_id: tc.id, content: errorMsg })
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: errorMsg })
          continue
        }

        if (!this.config.webSearchEnabled && (tool.category === 'web' || tool.capabilities?.includes('network'))) {
          const message = '联网功能未开启。请先点击聊天输入框中的联网按钮，再重新发送需要联网的请求。'
          messages.push({ role: 'tool', tool_call_id: tc.id, content: message })
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: message })
          this.emitEvent('error', {
            source: 'tool',
            toolName,
            error: 'WEB_ACCESS_DISABLED',
          })
          continue
        }

        // 意图策略检查
        const policyResult = evaluateIntentAwareToolPolicy({
          toolName,
          category: tool.category,
          intentPolicy: this.intentPolicy,
        })

        if (!policyResult.allowed) {
          const reason = policyResult.reason || '当前操作不被允许。'
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `操作被阻止: ${reason}` })
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: reason })
          continue
        }

        // 确认机制
        if (policyResult.requiresConfirmation && this.config.requestConfirmation) {
          const confirmed = await this.config.requestConfirmation(toolName, params)
          if (!confirmed) {
            const msg = '用户取消了操作。'
            messages.push({ role: 'tool', tool_call_id: tc.id, content: msg })
            this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: msg })
            continue
          }
        }

        // 检查缓存
        const cached = this.toolCache.get(toolName, params)
        if (cached) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: cached })
          this.config.onObservation?.(cached)
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: cached })
          continue
        }

        // ---- Task 4: 带瞬态重试的工具执行 ----
        const toolCall: ToolCall = {
          id: `tc-${++this.toolCallCounter}`,
          toolName,
          params,
          status: 'running',
          timestamp: Date.now(),
        }
        this.emitToolCall(toolCall)

        const result = await this.executeWithTransientRetry(tool, params)

        if (this.stopped) throw new Error('USER_STOPPED')

        // 构建 observation
        let observation: string
        if (result.success) {
          observation = result.message || `工具 ${toolName} 执行成功。`
          if (result.data && typeof result.data === 'object') {
            observation += `\n${JSON.stringify(result.data, null, 2)}`
          }
          this.toolCache.set(toolName, params, observation)
        } else {
          observation = `工具 ${toolName} 执行失败: ${result.error || '未知错误'}`
        }

        // 截断过长的 observation
        observation = truncateObservation(observation)

        // 更新 toolCall 状态
        toolCall.status = result.success ? 'success' : 'error'
        toolCall.result = result
        this.recordToolResult(toolName, argsHash, result.success)
        this.emitToolCall(toolCall)
        this.config.onObservation?.(observation)
        this.emitEvent('observation.created', { observation })

        // 将工具结果加入消息历史
        messages.push({ role: 'tool', tool_call_id: tc.id, content: observation })

        this.steps.push({
          thought: textContent,
          action: { tool: toolName, params },
          observation,
        })

        // 记录到工作记忆（使用 BaseAgent 的方法）
        this.recordWorkingMemory(toolName, params, result.success, result.error)
      }

      // ---- 最大迭代总结 ----
      if (this.currentIteration >= this.config.maxIterations) {
        const summary = await this.summarizeAtMaxIterations(
          messages, textContent,
        )
        finalContent = summary || textContent || '已达到最大迭代次数。'
        break
      }
    }

    // 完成并记录指标
    const result = finalContent || '任务完成。'
    this.config.onFinalAnswerRender?.(result)
    this.emitEvent('final', { content: result })
    this.emitEvent('agent.completed', { result })

    // 保存执行指标
    const metrics = this.metricsCollector.finalize()
    storeMetrics(metrics)
    console.log('[Agent] Execution metrics:', formatMetricsSummary(metrics))

    return result
  }

  // =========================================================================
  // Task 5: 精简系统提示
  // =========================================================================

  private async buildSystemPrompt(): Promise<string> {
    // 加载统一上下文：用户记忆、Agent 工作记忆、当前笔记知识图谱
    let memoryPrompt = ''
    try {
      const { unifiedContextLoader } = await import('@/lib/context/unified-loader')
      const activeFilePath = useArticleStore.getState().activeFilePath || this.config.currentQuote?.fileName
      const unifiedContext = await unifiedContextLoader.getContextForAgent(this.currentUserInput, {
        activeFilePath,
      })
      if (unifiedContext.prompt.trim()) {
        memoryPrompt = unifiedContext.prompt
      }
    } catch { /* non-critical */ }

    return buildAgentSystemPrompt({
      mode: 'function-call',
      userInput: this.currentUserInput,
      webSearchEnabled: this.config.webSearchEnabled,
      memoryPrompt,
      activeSkills: this.config.activeSkills,
      activeSkillMatches: this.config.activeSkillMatches,
      intentPolicy: this.intentPolicy,
    })
  }

  // =========================================================================
  // Task 3: 空响应恢复
  // =========================================================================

  private async recoverEmptyResponse(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    openai: any,
    aiConfig: any,
    openaiTools: any[],
  ): Promise<string | null> {
    try {
      // 注入提示让 LLM 总结工具执行结果
      const promptIdx = messages.length
      messages.push({ role: 'user', content: '请基于之前的工具执行结果回复用户。' } as any)

      const stream = await openai.chat.completions.create({
        model: aiConfig.model || '',
        messages: this.validateAndFixMessages(messages),
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: 'none', // 强制文本回复
        temperature: aiConfig.temperature,
        top_p: aiConfig.topP,
        stream: true,
      }, { signal: this.abortController?.signal }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      let text = ''
      for await (const chunk of stream) {
        if (this.stopped) break
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          text += delta.content
          this.config.onThought?.(text)
          this.emitEvent('thought', { content: text })
        }
      }

      // 移除注入的提示
      if (messages.length > promptIdx && (messages[promptIdx] as any).role === 'user') {
        messages.splice(promptIdx, 1)
      }

      return text || null
    } catch {
      return null
    }
  }

  // =========================================================================
  // Task 3: 最大迭代总结
  // =========================================================================

  private async summarizeAtMaxIterations(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    _lastTextContent: string,
  ): Promise<string | null> {
    try {
      const promptIdx = messages.length
      const iterationCount = this.currentIteration
      messages.push({
        role: 'user',
        content: `你已执行 ${iterationCount} 步，达到上限。请总结当前进展和结果，不要再调用工具。`,
      } as any)

      const { createOpenAIClient, getAISettings } = await import('@/lib/ai/utils')
      const aiConfig = await getAISettings()
      if (!aiConfig) return null
      const openai = await createOpenAIClient(aiConfig)

      const stream = await openai.chat.completions.create({
        model: aiConfig.model || '',
        messages: this.validateAndFixMessages(messages),
        tool_choice: 'none',
        temperature: aiConfig.temperature,
        top_p: aiConfig.topP,
        stream: true,
      }, { signal: this.abortController?.signal }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      let text = ''
      for await (const chunk of stream) {
        if (this.stopped) break
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          text += delta.content
          this.config.onThought?.(text)
          this.emitEvent('thought', { content: text })
        }
      }

      // 移除注入的提示
      if (messages.length > promptIdx && (messages[promptIdx] as any).role === 'user') {
        messages.splice(promptIdx, 1)
      }

      return text || null
    } catch {
      return null
    }
  }

  // =========================================================================
  // Task 3: 上下文溢出恢复
  // =========================================================================

  private async createStreamWithOverflowRecovery(
    openai: any,
    aiConfig: any,
    validatedMessages: OpenAI.Chat.ChatCompletionMessageParam[],
    openaiTools: any[],
    forceToolCall: boolean,
    _messages: OpenAI.Chat.ChatCompletionMessageParam[], // full list for recovery
    _systemPrompt: string,
  ): Promise<any> {
    try {
      return await openai.chat.completions.create({
        model: aiConfig.model || '',
        messages: validatedMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? (forceToolCall ? 'required' : 'auto') : undefined,
        temperature: aiConfig.temperature,
        top_p: aiConfig.topP,
        stream: true,
      }, {
        signal: this.abortController?.signal,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (isContextOverflowError(msg)) {
        // Will be caught by outer try-catch for recovery
        throw error
      }
      throw error
    }
  }

  private recoverFromOverflow(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    _systemPrompt: string,
  ): boolean {
    const before = messages.length
    const trimmed = aggressiveTrimForOverflow(messages as any[])
    messages.length = 0
    messages.push(...trimmed as any)
    console.warn(
      `[Agent] Context overflow recovery: ${before} -> ${messages.length} messages`
    )
    return messages.length < before
  }
}
