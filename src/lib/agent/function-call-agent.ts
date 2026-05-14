import type OpenAI from 'openai'
import type { AgentEvent, ReActStep, Tool, ToolCall, ToolResult, ToolExecutionContext } from './types'
import { createAgentEventBus, type AgentEventBus } from './event-bus'
import { convertToolsToOpenAIFormat } from './tool-definitions'
import { executeWithTimeout } from './tool-executor'
import { truncateObservation } from './safety-guards'
import { getToolByName, getAllToolsSync } from './tools'
import { deriveIntentPolicy, evaluateIntentAwareToolPolicy, type IntentPolicy } from './tool-policy'
import { ToolResultCache } from './tool-cache'

/**
 * Function Calling Agent — 基于 OpenAI tool_calls 的稳定 Agent 引擎
 * 
 * 与 ReAct 的区别：
 * - 不依赖模型输出特定文本格式（Action: / Action Input:）
 * - 工具调用通过 API 级别的 tool_calls 返回，100% 结构化
 * - 工具结果通过 tool role 消息返回给模型
 * - 模型自行决定何时停止（不再返回 tool_calls 时即为完成）
 */

export interface FunctionCallAgentConfig {
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
}

export class FunctionCallAgent {
  private config: FunctionCallAgentConfig
  private steps: ReActStep[] = []
  private eventBus: AgentEventBus = createAgentEventBus()
  private currentIteration = 0
  private toolCallCounter = 0
  private stopped = false
  private abortController: AbortController | null = null
  private intentPolicy: IntentPolicy = { allowWrite: false, allowDestructive: false, allowExecute: false }
  private toolCache = new ToolResultCache()
  private currentUserInput = ''

  constructor(config: FunctionCallAgentConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 15
    }
  }

  private emitEvent(type: AgentEvent['type'], payload?: Record<string, any>) {
    const event = this.eventBus.emit(type, payload, {
      iteration: this.currentIteration || undefined,
    })
    this.config.onEvent?.(event)
  }

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

  async run(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0
    this.stopped = false
    this.toolCache.invalidateAll()
    this.currentUserInput = userInput
    this.intentPolicy = deriveIntentPolicy(userInput)
    this.abortController = new AbortController()

    this.emitEvent('agent.started', { runId: this.eventBus.getRunId(), userInput })

    // 获取可用工具并转换为 OpenAI 格式
    const allTools = getAllToolsSync()
    const openaiTools = convertToolsToOpenAIFormat(allTools)

    // 构建初始消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // System prompt（精简版，不需要 ReAct 格式说明）
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

    // 主循环：调用 LLM → 处理 tool_calls → 返回结果 → 重复
    let finalContent = ''

    while (this.currentIteration < this.config.maxIterations) {
      if (this.stopped) throw new Error('USER_STOPPED')

      this.currentIteration++
      this.emitEvent('iteration.started')
      this.config.onIterationStart?.()

      // 调用 LLM
      const { createOpenAIClient, getAISettings } = await import('@/lib/ai/utils')
      const aiConfig = await getAISettings()
      if (!aiConfig) {
        finalContent = 'AI 服务未配置，请先在设置中配置模型。'
        break
      }

      const openai = await createOpenAIClient(aiConfig)

      let response: OpenAI.Chat.ChatCompletion
      try {
        response = await openai.chat.completions.create({
          model: aiConfig.model || '',
          messages,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
          temperature: aiConfig.temperature,
          top_p: aiConfig.topP,
        }, {
          signal: this.abortController?.signal,
        }) as OpenAI.Chat.ChatCompletion
      } catch (error) {
        if (this.stopped) throw new Error('USER_STOPPED')
        const msg = error instanceof Error ? error.message : String(error)
        finalContent = `AI 服务调用失败: ${msg}`
        break
      }

      if (this.stopped) throw new Error('USER_STOPPED')

      const choice = response.choices[0]
      if (!choice) {
        finalContent = '未收到 AI 响应。'
        break
      }

      const assistantMessage = choice.message
      const textContent = assistantMessage.content || ''
      const toolCalls = assistantMessage.tool_calls

      // 如果有文本内容，通知 UI
      if (textContent) {
        this.config.onThought?.(textContent)
        this.emitEvent('thought', { content: textContent })
      }

      // 如果没有 tool_calls，说明模型认为任务完成
      if (!toolCalls || toolCalls.length === 0) {
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

        this.config.onAction?.(toolName, params)
        this.emitEvent('action.parsed', { tool: toolName, params })

        // 查找工具
        const tool = getToolByName(toolName)
        if (!tool) {
          const errorMsg = `工具 "${toolName}" 不存在。`
          messages.push({ role: 'tool', tool_call_id: tc.id, content: errorMsg })
          this.steps.push({ thought: textContent, action: { tool: toolName, params }, observation: errorMsg })
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

        // 执行工具
        const toolCall: ToolCall = {
          id: `tc-${++this.toolCallCounter}`,
          toolName,
          params,
          status: 'running',
          timestamp: Date.now(),
        }
        this.config.onToolCall?.(toolCall)

        const result = await executeWithTimeout(tool, params, {
          abortSignal: this.abortController?.signal,
          runId: this.eventBus.getRunId(),
          iteration: this.currentIteration,
          userInput: this.currentUserInput,
        })

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
        this.config.onToolCall?.(toolCall)
        this.config.onObservation?.(observation)
        this.emitEvent('observation.created', { observation })

        // 将工具结果加入消息历史
        messages.push({ role: 'tool', tool_call_id: tc.id, content: observation })

        this.steps.push({
          thought: textContent,
          action: { tool: toolName, params },
          observation,
        })

        // 记录到工作记忆
        import('./working-memory').then(({ recordToolUsage, recordFileAccess, recordFailedAttempt }) => {
          recordToolUsage(toolName)
          const filePath = params.filePath || params.path
          if (typeof filePath === 'string') recordFileAccess(filePath)
          if (!result.success) recordFailedAttempt(toolName, params, result.error || '')
        }).catch(() => {})
      }

      // 如果所有工具都失败了，可能需要终止
      if (this.currentIteration >= this.config.maxIterations) {
        finalContent = textContent || '已达到最大迭代次数。'
        break
      }
    }

    // 完成
    const result = finalContent || '任务完成。'
    this.config.onFinalAnswerRender?.(result)
    this.emitEvent('final', { content: result })
    this.emitEvent('agent.completed', { result })
    return result
  }

  private async buildSystemPrompt(): Promise<string> {
    // 加载记忆
    let memoryPrompt = ''
    try {
      const { contextLoader } = await import('@/lib/context/loader')
      const memoryContext = await contextLoader.getContextForQuery(this.currentUserInput)
      if (memoryContext.preferences.length > 0 || memoryContext.memory.length > 0) {
        memoryPrompt = contextLoader.formatMemoriesForPrompt(memoryContext)
      }
    } catch { /* non-critical */ }

    const webControl = this.config.webSearchEnabled
      ? '联网搜索已启用。可以使用 web_search、web_extract、web_fetch 工具获取实时信息。'
      : '联网搜索未启用。不要调用 web_search 等网络工具。'

    return `你是一个高效的 AI 助手，通过调用工具来帮助用户完成任务。

规则：
- 如果用户的问题可以直接回答，不要调用工具，直接回复。
- 如果需要操作文件、搜索内容等，使用对应的工具。
- 每次只调用必要的工具，避免不必要的调用。
- 工具执行完成后，基于结果给出清晰的回答。
- 使用中文回复用户。

${webControl}

${memoryPrompt ? `## 用户记忆\n${memoryPrompt}` : ''}`
  }
}
