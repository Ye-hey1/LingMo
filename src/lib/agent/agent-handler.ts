import { ReActAgent, ReActConfig } from './react'
import { FunctionCallAgent, FunctionCallAgentConfig } from './function-call-agent'
import { AgentEvent, ToolCall, ReActStep } from './types'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { useSkillsStore } from '@/stores/skills'
import { reloadMcpTools } from './tools'
import OpenAI from 'openai'

export interface AgentHandlerConfig {
  activeChatId?: number
  webSearchEnabled?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onEvent?: (event: AgentEvent) => void
  onComplete?: (result: string, steps?: any[], stopped?: boolean) => void
  onError?: (error: string) => void
  onFinalAnswerRender?: (markdownContent: string) => void  // 当检测到 Final Answer 时立即渲染 Markdown
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
}

export class AgentHandler {
  private agent: ReActAgent | FunctionCallAgent | null = null
  private config: AgentHandlerConfig
  private executing = false

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  private handleAgentEvent(event: AgentEvent) {
    const store = useChatStore.getState()
    const agentEvents = store.agentState.agentEvents || []
    const snapshot = event.type === 'agent.context.compacted'
      ? event.payload?.snapshot
      : undefined
    const currentIteration = event.type === 'iteration.started' && typeof event.iteration === 'number'
      ? event.iteration
      : store.agentState.currentIteration

    // Handle task plan events
    let taskPlan = store.agentState.taskPlan
    if (event.type === 'agent.planning' && event.payload?.plan) {
      taskPlan = {
        ...event.payload.plan,
        completedStepIndex: -1,
      }
    } else if (event.type === 'iteration.started' && taskPlan && taskPlan.isComplex && currentIteration > 1) {
      // Map iteration to step progress (iteration 2 means step 0 is done)
      const newCompletedIndex = Math.min(currentIteration - 2, taskPlan.steps.length - 1)
      taskPlan = {
        ...taskPlan,
        completedStepIndex: Math.max(taskPlan.completedStepIndex, newCompletedIndex),
      }
    } else if (event.type === 'agent.completed' || event.type === 'agent.stopped') {
      // Mark all steps as completed when agent finishes
      if (taskPlan && taskPlan.isComplex) {
        taskPlan = {
          ...taskPlan,
          completedStepIndex: taskPlan.steps.length - 1,
        }
      }
    }

    store.setAgentState({
      agentEvents: [...agentEvents, event].slice(-500),
      agentRunId: event.runId || store.agentState.agentRunId,
      agentEventCursor: event.sequence || store.agentState.agentEventCursor,
      currentIteration,
      agentContextSnapshot: snapshot || store.agentState.agentContextSnapshot,
      taskPlan,
    })
    this.config.onEvent?.(event)
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    // Execution mutex: stop previous run if still active
    if (this.executing && this.agent) {
      this.agent.stop()
      this.agent = null
    }
    this.executing = true

    const store = useChatStore.getState()

    store.resetAgentState()
    store.setAgentState({
      activeChatId: this.config.activeChatId,
      isRunning: true,
    })

    // 确保 MCP Store 已初始化
    try {
      const { useMcpStore } = await import('@/stores/mcp')
      const mcpStore = useMcpStore.getState()
      if (!mcpStore.initialized) {
        await mcpStore.initMcpData()
      }
    } catch (error) {
      console.error('[Agent Handler] Failed to initialize MCP Store:', error)
    }

    // 预加载 MCP 工具（仅在未加载时加载，避免重复）
    try {
      const { getAllToolsSync } = await import('./tools')
      const currentTools = getAllToolsSync()
      // 只有当没有 MCP 工具时才重新加载
      if (!currentTools.some(t => t.category === 'mcp')) {
        await reloadMcpTools()
      }
    } catch (error) {
      console.error('[Agent Handler] Failed to reload MCP tools:', error)
    }

    // 获取与当前请求相关的 Skills 候选（让 AI 自己决定是否选择）
    const activeSkills = await this.getAvailableSkills(userInput)
    // 获取 Skills 的详细信息用于 UI 显示
    const skillsInfo = await this.getSkillsInfo(activeSkills)
    // 将加载的 Skills 信息存储到状态中，用于 UI 显示
    store.setAgentState({ loadedSkills: skillsInfo })

    const reactConfig: ReActConfig = {
      maxIterations: 15,
      webSearchEnabled: this.config.webSearchEnabled,
      activeSkills,
      onIterationStart: () => {
        // 在新迭代开始时，将完整的 ReAct 循环保存到历史，然后清空当前状态
        const currentState = useChatStore.getState()
        if (currentState.agentState.currentThought ||
            currentState.agentState.currentAction ||
            currentState.agentState.currentObservation) {
          // 检查是否是 Final Answer - 如果是，不添加到 completedSteps，直接清空
          const isFinalAnswer = currentState.agentState.currentThought.includes('Final Answer:') ||
                               currentState.agentState.currentThought.includes('Final Answer：') ||
                               currentState.agentState.currentThought.includes('最终答案')

          if (isFinalAnswer) {
            // Final Answer 不添加到步骤历史，直接清空状态（它会作为 result 在正文中显示）
            store.setAgentState({
              currentThought: '',
              currentAction: undefined,
              currentObservation: undefined,
              currentStepStartTime: undefined,
            })
            return
          }

          // 解析当前动作
          let action = undefined
          if (currentState.agentState.currentAction) {
            const match = currentState.agentState.currentAction.match(/^(\w+)\((.*)\)$/)
            if (match) {
              try {
                action = {
                  tool: match[1],
                  params: match[2] ? JSON.parse(match[2]) : {}
                }
              } catch {
                // 解析失败，忽略
              }
            }
          }

          // 计算步骤耗时
          const duration = currentState.agentState.currentStepStartTime
            ? Date.now() - currentState.agentState.currentStepStartTime
            : undefined

          // 创建完整的步骤
          const completedStep: ReActStep = {
            thought: currentState.agentState.currentThought,
            action: action,
            observation: currentState.agentState.currentObservation,
            duration
          }

          const newHistory = [...currentState.agentState.thoughtHistory, currentState.agentState.currentThought]
          const newCompletedSteps = [...currentState.agentState.completedSteps, completedStep]
          store.setAgentState({
            thoughtHistory: newHistory,
            completedSteps: newCompletedSteps,
            currentThought: '',
            currentAction: undefined,
            currentObservation: undefined,
            currentStepStartTime: Date.now(),  // 记录新步骤的开始时间
            isThinking: true,  // 标记正在等待 AI 生成新的思考
            // Reset Final Answer mode for new iteration
            isFinalAnswerMode: false,
            finalAnswerContent: undefined
          })
        }
      },
      onThought: (thought: string) => {
        // Detect Final Answer in streaming content for immediate rendering
        const faMatch = thought.match(/Final Answer:\s*([\s\S]*)/i) ||
                        thought.match(/Final Answer：\s*([\s\S]*)/i) ||
                        thought.match(/最终答案[：:]\s*([\s\S]*)/i)
        if (faMatch && faMatch[1].trim().length > 0) {
          const finalAnswerContent = faMatch[1].trim()
          store.setAgentState({
            currentThought: thought,
            isThinking: false,
            isFinalAnswerMode: true,
            finalAnswerContent
          })
          this.config.onFinalAnswerRender?.(finalAnswerContent)
        } else {
          store.setAgentState({
            currentThought: thought,
            isThinking: false
          })
        }
        this.config.onThought?.(thought)
      },
      onAction: (action, params) => {
        store.setAgentState({ currentAction: `${action}(${JSON.stringify(params)})` })
        this.config.onAction?.(action, params)
      },
      onObservation: (observation) => {
        store.setAgentState({ currentObservation: observation })
        this.config.onObservation?.(observation)
      },
      onEvent: (event) => {
        this.handleAgentEvent(event)
      },
      onToolCall: (toolCall: ToolCall) => {
        // 获取最新的 store 状态
        const currentState = useChatStore.getState()
        const existingCall = currentState.agentState.toolCalls.find(c => c.id === toolCall.id)
        if (existingCall) {
          currentState.updateAgentToolCall(toolCall.id, toolCall)
        } else {
          currentState.addAgentToolCall(toolCall)
        }
      },
      onSkillsSelected: (skillIds: string[]) => {
        // 当 AI 选择 Skills 后，更新状态
        store.setAgentState({ selectedSkills: skillIds })
      },
      onFinalAnswerRender: (markdownContent: string) => {
        // 检测到 Final Answer 时，触发外部渲染
        this.config.onFinalAnswerRender?.(markdownContent)
      },
      formatAutoFinalAnswer: this.config.formatAutoFinalAnswer,
      requestConfirmation: this.config.requestConfirmation,
      currentQuote: this.config.currentQuote,
    }

    // 在开始执行前设置当前步骤的开始时间（确保第一次思考也有耗时）
    store.setAgentState({
      isThinking: true,
      currentStepStartTime: Date.now()
    })

    // 选择 Agent 模式：优先使用 Function Calling（更稳定），降级到 ReAct
    const useFunctionCalling = await this.shouldUseFunctionCalling()

    if (useFunctionCalling) {
      // Function Calling 模式 — 通过 API 级别的 tool_calls 调用工具
      const fcConfig: FunctionCallAgentConfig = {
        maxIterations: 15,
        webSearchEnabled: this.config.webSearchEnabled,
        onIterationStart: reactConfig.onIterationStart,
        onThought: reactConfig.onThought,
        onAction: reactConfig.onAction,
        onObservation: reactConfig.onObservation,
        onToolCall: reactConfig.onToolCall,
        onEvent: reactConfig.onEvent,
        onFinalAnswerRender: reactConfig.onFinalAnswerRender,
        requestConfirmation: reactConfig.requestConfirmation,
      }
      this.agent = new FunctionCallAgent(fcConfig)
    } else {
      // ReAct 模式 — 文本解析（降级方案）
      this.agent = new ReActAgent(reactConfig)
    }

    try {
      const result = await this.agent.run(userInput, contextOrMessages, imageUrls)

      // 获取完整的 ReAct 步骤
      const steps = this.agent.getSteps()
      store.setAgentState({
        isRunning: false,
        completedSteps: steps,
        currentIteration: this.agent.getCurrentIteration(),
      })
      this.config.onComplete?.(result, steps, false)
      this.executing = false
      return result
    } catch (error) {
      // 检查是否是用户终止
      if (error instanceof Error && error.message === 'USER_STOPPED') {
        // 获取已产生的步骤
        const steps = this.agent.getSteps()

        // 保存中断恢复上下文到 store
        const agentSnapshot = store.agentState.agentContextSnapshot
        if (agentSnapshot) {
          try {
            const { Store: TauriStore } = await import('@tauri-apps/plugin-store')
            const resumeStore = await TauriStore.load('agent-resume.json')
            await resumeStore.set('lastInterrupt', {
              snapshot: agentSnapshot,
              originalUserInput: userInput,
              interruptReason: 'user_stop',
              interruptedAt: Date.now(),
            })
            await (resumeStore as any).save?.()
          } catch {
            // 保存恢复上下文失败不影响主流程
          }
        }

        store.setAgentState({
          isRunning: false,
          completedSteps: steps,
          currentIteration: this.agent.getCurrentIteration(),
        })
        // 调用 onComplete，传入空结果和已产生的步骤，标记为已停止
        this.config.onComplete?.('', steps, true)
        this.executing = false
        return ''
      }

      store.setAgentState({ isRunning: false })
      this.executing = false

      const errorMessage = error instanceof Error ? error.message : String(error)
      this.handleAgentEvent({
        type: 'error',
        timestamp: Date.now(),
        level: 'error',
        payload: {
          source: 'handler',
          error: errorMessage,
        },
      })
      this.config.onError?.(errorMessage)
      throw error
    }
  }

  stop() {
    if (this.agent) {
      this.agent.stop()
      // 不立即清空 agent，等待 run 方法中的错误处理完成
      // 不调用 resetAgentState，让 onComplete 回调保存已产生的内容
    }
  }

  /**
   * 从上次中断处恢复执行
   */
  async resume(): Promise<string> {
    try {
      const { Store: TauriStore } = await import('@tauri-apps/plugin-store')
      const resumeStore = await TauriStore.load('agent-resume.json')
      const resumeData = await resumeStore.get<any>('lastInterrupt')

      if (!resumeData?.snapshot || !resumeData?.originalUserInput) {
        return ''
      }

      const { canResumeFromSnapshot, buildResumePrompt } = await import('./resume')
      if (!canResumeFromSnapshot(resumeData.snapshot)) {
        return ''
      }

      const resumePrompt = buildResumePrompt(resumeData)

      // 清除已使用的恢复数据
      await resumeStore.delete('lastInterrupt')
      await (resumeStore as any).save?.()

      // 使用恢复 prompt 作为上下文执行
      return await this.execute(resumeData.originalUserInput, resumePrompt)
    } catch (error) {
      console.warn('[AgentHandler] Resume failed:', error)
      return ''
    }
  }

  /**
   * 判断是否应该使用 Function Calling 模式
   * 条件：模型支持 function calling（大多数现代模型都支持）
   */
  private async shouldUseFunctionCalling(): Promise<boolean> {
    try {
      const { getAISettings } = await import('@/lib/ai/utils')
      const aiConfig = await getAISettings()
      if (!aiConfig) return false

      // 检查模型是否支持 function calling
      // 大多数现代模型都支持：OpenAI GPT-4/3.5, DeepSeek, Qwen, Claude (via OpenAI compat), etc.
      // 只有非常老的模型或特殊模型不支持
      const model = (aiConfig.model || '').toLowerCase()
      const baseUrl = (aiConfig.baseURL || '').toLowerCase()

      // 已知不支持 function calling 的情况
      const noFunctionCalling = [
        model.includes('text-davinci'),
        model.includes('gpt-3.5-turbo-instruct'),
        // Ollama 的某些小模型可能不支持
        baseUrl.includes('ollama') && (model.includes('phi-2') || model.includes('tinyllama')),
      ]

      if (noFunctionCalling.some(Boolean)) {
        return false
      }

      // 默认使用 Function Calling 模式
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取所有可用的 Skills（只返回元数据，让 AI 先选择）
   */
  private async getAvailableSkills(userInput: string): Promise<string[]> {
    const skillsStore = useSkillsStore.getState()

    // 如果 Skills 功能未启用，返回空数组
    if (!skillsStore.enabled) {
      return []
    }

    // 如果未启用自动匹配，返回空数组
    if (!skillsStore.autoMatch) {
      return []
    }

    try {
      // 确保 Skill 管理器已初始化（initSkills 会处理重复初始化）
      await skillsStore.initSkills()

      // 只保留最相关的 Skill 候选，避免简单问答被大量 Skill 元数据干扰。
      const matchedSkills = await skillManager.matchRelevantSkills(userInput, 5)

      // 返回候选 Skill 的 ID 列表
      // 注意：这里只传递 ID，具体内容在 formatSkillsInstructions 中按需加载
      const skillIds = matchedSkills.map(skill => skill.metadata.id)
      return skillIds
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills:', error)
      return []
    }
  }

  /**
   * 获取 Skills 的详细信息用于 UI 显示
   */
  private async getSkillsInfo(skillIds?: string[]): Promise<Array<{ id: string; name: string; description?: string }>> {
    const skillsStore = useSkillsStore.getState()

    // 如果 Skills 功能未启用，返回空数组
    if (!skillsStore.enabled || !skillsStore.autoMatch) {
      return []
    }

    try {
      // 确保 Skill 管理器已初始化
      await skillsStore.initSkills()
      const candidateSkills = skillIds && skillIds.length > 0
        ? skillIds
            .map(id => skillManager.getSkill(id))
            .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
        : []

      return candidateSkills.map(skill => ({
        id: skill.metadata.id,
        name: skill.metadata.name,
        description: skill.metadata.description
      }))
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills info:', error)
      return []
    }
  }
}
