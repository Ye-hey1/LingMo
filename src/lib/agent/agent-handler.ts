import { AgentActivity, AgentEvent, ToolCall, ReActStep } from './types'
import { replayAgentEvents } from './event-bus'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { useSkillsStore } from '@/stores/skills'
import OpenAI from 'openai'
import type { SkillMatchSummary } from '@/lib/skills/types'
import type { AgentRunControl, AgentRunMiddlewareState } from '@/lib/agent-harness/types'
import { HarnessAgentRunner } from '@/lib/agent-harness/harness-agent-runner'
import {
  SnapshotManager,
  persistSnapshot,
  loadPersistedSnapshots,
  buildResumePrompt,
  canResumeSnapshot,
  getResumeSummary,
} from './enhanced-resume'
import { formatFriendlyError } from './friendly-errors'
import { getDirectAgentReply } from './orchestration'
import {
  extractVisibleFinalAnswer,
  isInternalAgentInstruction,
  sanitizeVisibleAssistantContent,
} from './parse-action-input'
import { isSupportOnlyObservationText, isSupportOnlyToolName } from './support-tools'

export interface AgentHandlerConfig {
  runControl?: AgentRunControl
  activeChatId?: number
  webSearchEnabled?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onEvent?: (event: AgentEvent) => void
  onComplete?: (result: string, steps?: any[], stopped?: boolean) => void
  onError?: (error: string) => void
  onAnswerDelta?: (markdownContent: string) => void
  onFinalAnswerRender?: (markdownContent: string) => void  // 当检测到 Final Answer 时立即渲染 Markdown
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
  forcedSkillIds?: string[]
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
}

function getBaseToolName(toolName: string) {
  return toolName.includes('__') ? toolName.split('__').pop()! : toolName
}

function formatToolLabel(toolName?: string) {
  if (!toolName) return ''
  return getBaseToolName(toolName)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeParams(params?: Record<string, any>) {
  if (!params) return undefined

  const preferred = params.filePath || params.path || params.folderPath || params.query || params.url || params.name || params.skillId
  if (typeof preferred === 'string' && preferred.trim()) {
    const normalized = preferred.replace(/\\/g, '/')
    const short = normalized.includes('/')
      ? normalized.split('/').slice(-2).join('/')
      : normalized
    return short.length > 80 ? `${short.slice(0, 80)}...` : short
  }

  const firstString = Object.values(params).find((value): value is string =>
    typeof value === 'string' && value.trim().length > 0
  )
  if (firstString) {
    return firstString.length > 80 ? `${firstString.slice(0, 80)}...` : firstString
  }

  const keys = Object.keys(params)
  return keys.length > 0 ? keys.slice(0, 3).join(', ') : undefined
}

function summarizeText(value?: string, maxLength = 120) {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return undefined
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

export class AgentHandler {
  private agent: HarnessAgentRunner | null = null
  private config: AgentHandlerConfig
  private executing = false

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  private createActivity(
    label: string,
    phase: AgentActivity['phase'],
    detail?: string,
    options: Partial<Pick<AgentActivity, 'iteration' | 'toolName' | 'outputChars' | 'inputTokens' | 'outputTokens'>> = {},
  ): AgentActivity {
    return {
      phase,
      label,
      detail,
      startedAt: Date.now(),
      ...options,
    }
  }

  private getActivityFromEvent(event: AgentEvent): AgentActivity | undefined {
    const payload = event.payload || {}
    const toolName = typeof payload.toolName === 'string'
      ? payload.toolName
      : typeof payload.tool === 'string'
        ? payload.tool
        : undefined

    switch (event.type) {
      case 'agent.started':
        return this.createActivity('Preparing agent', 'preparing', undefined, { iteration: event.iteration })
      case 'agent.planning':
        return this.createActivity('Planning task', 'planning', undefined, { iteration: event.iteration })
      case 'iteration.started':
      case 'model.request.started':
        return this.createActivity('Thinking', 'thinking', undefined, { iteration: event.iteration })
      case 'model.response.received':
        return this.createActivity(
          'Reading model response',
          'thinking',
          payload.truncated ? '正在续写被截断的输出' : undefined,
          {
            iteration: event.iteration,
            outputChars: typeof payload.contentLength === 'number' ? payload.contentLength : undefined,
            inputTokens: typeof payload.inputTokens === 'number' ? payload.inputTokens : undefined,
            outputTokens: typeof payload.outputTokens === 'number' ? payload.outputTokens : undefined,
          }
        )
      case 'thought':
      case 'thought.updated':
        return this.createActivity(
          'Reasoning',
          'thinking',
          summarizeText(String(payload.content || '')),
          {
            iteration: event.iteration,
            outputChars: typeof payload.content === 'string' ? payload.content.length : undefined,
          }
        )
      case 'action':
      case 'action.parsed':
        if (isSupportOnlyToolName(toolName)) {
          return undefined
        }
        return this.createActivity(
          `Preparing ${formatToolLabel(toolName) || 'tool'}`,
          'tool',
          summarizeParams(payload.params),
          { iteration: event.iteration, toolName }
        )
      case 'tool.updated': {
        const toolCall = payload.toolCall as ToolCall | undefined
        if (!toolCall?.toolName) return undefined
        if (isSupportOnlyToolName(toolCall.toolName)) return undefined

        if (toolCall.status === 'error') {
          return this.createActivity(
            `Failed ${formatToolLabel(toolCall.toolName)}`,
            'error',
            summarizeText(toolCall.result?.error || toolCall.result?.message),
            { iteration: event.iteration, toolName: toolCall.toolName }
          )
        }

        if (toolCall.status === 'success') {
          return this.createActivity(
            `Finished ${formatToolLabel(toolCall.toolName)}`,
            'tool',
            summarizeText(toolCall.result?.message || (typeof toolCall.result?.data === 'string' ? toolCall.result.data : undefined)) || summarizeParams(toolCall.params),
            { iteration: event.iteration, toolName: toolCall.toolName }
          )
        }

        return this.createActivity(
          `Running ${formatToolLabel(toolCall.toolName)}`,
          'tool',
          summarizeParams(toolCall.params),
          { iteration: event.iteration, toolName: toolCall.toolName }
        )
      }
      case 'tool.execution.started':
        if (isSupportOnlyToolName(toolName)) return undefined
        return this.createActivity(`Running ${formatToolLabel(toolName) || 'tool'}`, 'tool', summarizeParams(payload.params), { iteration: event.iteration, toolName })
      case 'tool.execution.finished':
        if (isSupportOnlyToolName(toolName)) return undefined
        return this.createActivity(
          `${payload.success === false ? 'Failed' : 'Finished'} ${formatToolLabel(toolName) || 'tool'}`,
          payload.success === false ? 'error' : 'tool',
          summarizeText(String(payload.result || payload.message || payload.error || '')),
          { iteration: event.iteration, toolName }
        )
      case 'step.completed':
        if (isSupportOnlyToolName(String(payload.toolName || ''))) return undefined
        return this.createActivity(
          payload.toolName ? `Completed ${formatToolLabel(String(payload.toolName))}` : 'Completed step',
          payload.success === false ? 'error' : 'thinking',
          summarizeText(String(payload.observation || '')),
          { iteration: event.iteration, toolName }
        )
      case 'approval':
      case 'confirmation.waiting':
        if (payload.status === 'requested' || event.type === 'confirmation.waiting') {
          return this.createActivity(`Waiting for ${formatToolLabel(toolName) || 'confirmation'}`, 'waiting-confirmation', summarizeParams(payload.params), { iteration: event.iteration, toolName })
        }
        return undefined
      case 'final':
      case 'final.answer.rendered':
        return this.createActivity('Writing answer', 'answering', undefined, { iteration: event.iteration })
      case 'final.answer.rejected':
        return this.createActivity(
          'Continuing work',
          'thinking',
          summarizeText(String(payload.reason || 'Final answer was not ready yet')),
          { iteration: event.iteration },
        )
      case 'skills.selected': {
        const skillIds = Array.isArray(payload.skillIds) ? payload.skillIds.filter((id): id is string => typeof id === 'string') : []
        return this.createActivity('Selected skill', 'preparing', skillIds.slice(0, 2).join(', '), { iteration: event.iteration })
      }
      case 'agent.completed':
        return this.createActivity('Done', 'completed', undefined, { iteration: event.iteration })
      case 'agent.stopped':
        return this.createActivity('Stopped', 'completed', undefined, { iteration: event.iteration })
      case 'error':
        return this.createActivity('Execution error', 'error', summarizeText(String(payload.friendlyMessage || payload.error || '')), { iteration: event.iteration, toolName })
      default:
        return undefined
    }
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
    const hiddenEvent = event.payload?.internal === true || event.payload?.visibility === 'hidden'

    // Handle task plan events
    let taskPlan = store.agentState.taskPlan
    if (event.type === 'agent.planning' && event.payload?.plan) {
      taskPlan = {
        ...event.payload.plan,
        completedStepIndex: -1,
      }
    } else if (event.type === 'observation.created' && taskPlan && taskPlan.isComplex && !hiddenEvent) {
      // Observation created means the current iteration's tool finished
      // Only advance if this observation relates to the next unfinished step
      const nextStepIndex = taskPlan.completedStepIndex + 1
      if (nextStepIndex < taskPlan.steps.length) {
        // Check if the observation content or tool matches the planned step
        const observationContent = String(event.payload?.content || '')
        const hasSuccess = /成功|完成|已创建|已保存|已更新|success|created|saved|updated/i.test(observationContent)
        const hasFailure = /失败|错误|无法|failed|error|cannot/i.test(observationContent)
        if (hasSuccess || hasFailure) {
          taskPlan = {
            ...taskPlan,
            completedStepIndex: nextStepIndex,
          }
        }
      }
    } else if (event.type === 'iteration.started' && taskPlan && taskPlan.isComplex && currentIteration > 1) {
      // Fallback: map iteration to step progress
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

    const nextAgentEvents = [...agentEvents, event].slice(-500)
    const replay = replayAgentEvents(nextAgentEvents)
    const activity = hiddenEvent ? undefined : this.getActivityFromEvent(event)

    if (event.type === 'final.answer.rejected') {
      store.setAgentState({
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
        currentThought: '',
        activity: activity || this.createActivity('Continuing work', 'thinking', undefined, { iteration: event.iteration }),
      })
    }

    if (event.type === 'skills.selected') {
      const skillIds = Array.isArray(event.payload?.skillIds)
        ? event.payload.skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      if (skillIds.length > 0) {
        store.setAgentState({ selectedSkills: skillIds })
      }
    }

    store.setAgentState({
      agentEvents: nextAgentEvents,
      agentRunId: event.runId || store.agentState.agentRunId,
      agentEventCursor: event.sequence || store.agentState.agentEventCursor,
      currentIteration,
      agentContextSnapshot: snapshot || store.agentState.agentContextSnapshot,
      activity: activity || store.agentState.activity,
      telemetry: replay.telemetry,
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
    const runControl = this.config.runControl

    store.resetAgentState()
    store.setAgentState({
      activeChatId: this.config.activeChatId,
      agentRunId: runControl?.runId,
      isRunning: true,
      activity: this.createActivity('Preparing agent', 'preparing'),
    })

    const forcedSkillIds = this.normalizeSkillIds(this.config.forcedSkillIds)
    const directReply = forcedSkillIds.length === 0
      ? getDirectAgentReply(userInput, imageUrls)
      : null
    if (directReply) {
      store.setAgentState({
        isRunning: false,
        isThinking: false,
        currentIteration: 0,
        isFinalAnswerMode: true,
        finalAnswerContent: directReply,
        activity: this.createActivity('Writing answer', 'answering'),
      })
      await this.persistRunSummary(userInput, directReply, [], false)
      this.config.onFinalAnswerRender?.(directReply)
      this.config.onComplete?.(directReply, [], false)
      this.executing = false
      return directReply
    }

    store.setAgentState({
      activity: this.createActivity('Loading runtime', 'preparing'),
    })
    const middlewareState = runControl?.getMiddlewareState()
    if (!middlewareState?.mcp && !middlewareState?.skills) {
      await this.loadLegacyRuntimeState()
    }

    // 获取与当前请求相关的 Skills 候选。Harness middleware 优先；无 Harness 时保留兼容路径。
    const forcedSkillMatches = middlewareState?.skills
      ? this.getForcedSkillMatchesFromState(middlewareState)
      : await this.getForcedSkillMatches(forcedSkillIds)
    store.setAgentState({
      activity: this.createActivity('Selecting skills', 'loading-skills'),
    })
    const autoSkillMatches = middlewareState?.skills
      ? middlewareState.skills.activeSkillMatches.filter(match => !forcedSkillMatches.some(forced => forced.id === match.id))
      : await this.getAvailableSkills(userInput)
    const skillMatches = this.mergeSkillMatches([...forcedSkillMatches, ...autoSkillMatches])
    const activeSkills = skillMatches.map(skill => skill.id)
    const forcedActiveSkillIds = forcedSkillMatches.map(skill => skill.id)
    // 获取 Skills 的详细信息用于 UI 显示
    const skillsInfo = await this.getSkillsInfo(skillMatches)
    // 将加载的 Skills 信息存储到状态中，用于 UI 显示
    store.setAgentState({
      loadedSkills: skillsInfo,
      selectedSkills: forcedActiveSkillIds.length > 0 ? forcedActiveSkillIds : undefined,
      activity: this.createActivity(
        skillsInfo.length > 0 ? 'Skills ready' : 'No matching skill',
        'loading-skills',
        skillsInfo.length > 0
          ? skillsInfo.slice(0, 3).map(skill => skill.name).join(', ')
          : undefined
      ),
    })

    // 智能联网判断：当检测到时效性问题时，自动启用联网搜索
    // 即使 UI 上的联网按钮未开启
    let effectiveWebSearchEnabled = this.config.webSearchEnabled
    if (!effectiveWebSearchEnabled) {
      try {
        const { isTimeSensitiveRequest } = await import('./tool-intent')
        if (isTimeSensitiveRequest(userInput)) {
          effectiveWebSearchEnabled = true
          console.log('[Agent Handler] Auto-enabled web search for time-sensitive query')
        }
      } catch { /* non-critical */ }
    }

    const runnerConfig = {
      maxIterations: 15,
      webSearchEnabled: effectiveWebSearchEnabled,
      activeSkills,
      activeSkillMatches: skillMatches,
      forcedSkillIds: forcedActiveSkillIds,
      onThought: (thought: string) => {
        const finalAnswerContent = extractVisibleFinalAnswer(thought)
        const visibleThought = sanitizeVisibleAssistantContent(thought)

        if (finalAnswerContent) {
          store.setAgentState({
            currentThought: '',
            currentAction: undefined,
            currentObservation: undefined,
            isThinking: false,
            isFinalAnswerMode: true,
            finalAnswerContent,
            activity: this.createActivity('Writing answer', 'answering', undefined, {
              iteration: useChatStore.getState().agentState.currentIteration,
            }),
          })
          this.config.onFinalAnswerRender?.(finalAnswerContent)
        } else if (visibleThought) {
          store.setAgentState({
            currentThought: visibleThought,
            isThinking: false,
            activity: this.createActivity('Reasoning', 'thinking', summarizeText(visibleThought), {
              iteration: useChatStore.getState().agentState.currentIteration,
            }),
          })
          this.config.onThought?.(visibleThought)
        }
      },
      onAction: (action: string, params: Record<string, any>) => {
        store.setAgentState({
          currentAction: `${action}(${JSON.stringify(params)})`,
          activity: this.createActivity(`Preparing ${formatToolLabel(action)}`, 'tool', summarizeParams(params), {
            iteration: useChatStore.getState().agentState.currentIteration,
            toolName: action,
          }),
        })
        this.config.onAction?.(action, params)
      },
      onObservation: (observation: string) => {
        const currentAction = useChatStore.getState().agentState.currentAction
        const currentToolName = currentAction?.match(/^(\w+)\(/)?.[1]
        if (
          isInternalAgentInstruction(observation) ||
          isSupportOnlyToolName(currentToolName) ||
          isSupportOnlyObservationText(observation)
        ) {
          return
        }

        store.setAgentState({
          currentObservation: observation,
          activity: this.createActivity('Processing result', 'thinking', summarizeText(observation), {
            iteration: useChatStore.getState().agentState.currentIteration,
          }),
        })
        this.config.onObservation?.(observation)
      },
      onEvent: (event: AgentEvent) => {
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
      onAnswerDelta: (markdownContent: string) => {
        if (!markdownContent.trim()) {
          return
        }
        store.setAgentState({
          currentThought: '',
          currentAction: undefined,
          currentObservation: undefined,
          isThinking: false,
          isFinalAnswerMode: true,
          finalAnswerContent: markdownContent,
          activity: this.createActivity('Writing answer', 'answering', undefined, {
            iteration: useChatStore.getState().agentState.currentIteration,
          }),
        })
        this.config.onAnswerDelta?.(markdownContent)
      },
      onFinalAnswerRender: (markdownContent: string) => {
        // 检测到 Final Answer 时，触发外部渲染
        this.config.onFinalAnswerRender?.(markdownContent)
      },
      requestConfirmation: this.config.requestConfirmation,
      currentQuote: this.config.currentQuote,
      runControl,
    }

    // 在开始执行前设置当前步骤的开始时间（确保第一次思考也有耗时）
    store.setAgentState({
      isThinking: true,
      currentStepStartTime: Date.now(),
      activity: this.createActivity('Thinking', 'thinking'),
    })

    this.agent = new HarnessAgentRunner(runnerConfig)

    try {
      const result = await this.agent.run(userInput, contextOrMessages, imageUrls)

      const steps = this.agent.getSteps()
      store.setAgentState({
        isRunning: false,
        completedSteps: steps,
        currentIteration: this.agent.getCurrentIteration(),
        activity: this.createActivity('Done', 'completed'),
      })
      await this.persistRunSummary(userInput, result, steps, false)
      this.config.onComplete?.(result, steps, false)
      this.executing = false
      return result
    } catch (error) {
      // 检查是否是用户终止
      if (error instanceof Error && error.message === 'USER_STOPPED') {
        const steps = this.agent.getSteps()
        const toolCalls = store.agentState.toolCalls || []
        const events = store.agentState.agentEvents || []

        // 使用增强的快照管理器保存中断状态
        try {
          const snapshot = new SnapshotManager().createSnapshot(
            store.agentState.agentRunId || '',
            userInput,
            steps,
            toolCalls,
            events,
            this.agent.getCurrentIteration(),
            'user_stop'
          )
          await persistSnapshot(snapshot)
        } catch {
          // 保存恢复上下文失败不影响主流程
        }

        store.setAgentState({
          isRunning: false,
          completedSteps: steps,
          currentIteration: this.agent.getCurrentIteration(),
          activity: this.createActivity('Stopped', 'completed'),
        })
        await this.persistRunSummary(userInput, '', steps, true)
        // 调用 onComplete，传入空结果和已产生的步骤，标记为已停止
        this.config.onComplete?.('', steps, true)
        this.executing = false
        return ''
      }

      store.setAgentState({
        isRunning: false,
        activity: this.createActivity('Execution error', 'error'),
      })
      this.executing = false

      // 使用友好的错误消息
      const rawError = error instanceof Error ? error.message : String(error)
      const friendlyError = formatFriendlyError(rawError)
      const errorMessage = `${friendlyError.title}: ${friendlyError.message}`

      this.handleAgentEvent({
        type: 'error',
        timestamp: Date.now(),
        level: 'error',
        payload: {
          source: 'handler',
          error: rawError,
          friendlyMessage: errorMessage,
        },
      })
      this.config.onError?.(errorMessage)
      throw error
    }
  }

  private async persistRunSummary(
    userInput: string,
    result: string,
    steps: ReActStep[],
    stopped: boolean,
  ) {
    try {
      const store = useChatStore.getState()
      const { buildAgentRunSummary, saveAgentRunSummary } = await import('./resume')
      const summary = buildAgentRunSummary({
        userGoal: userInput,
        result,
        stopped,
        steps,
        events: store.agentState.agentEvents || [],
      })
      await saveAgentRunSummary(summary)
    } catch (error) {
      console.warn('[Agent Handler] Failed to persist run summary:', error)
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
      // 使用增强的快照管理器加载快照
      const snapshots = await loadPersistedSnapshots()
      if (snapshots.length === 0) {
        return ''
      }

      // 获取最新的快照
      const latestSnapshot = snapshots.sort((a, b) => b.updatedAt - a.updatedAt)[0]

      // 检查是否可恢复
      const { canResume, reason } = canResumeSnapshot(latestSnapshot)
      if (!canResume) {
        console.warn('[AgentHandler] Cannot resume:', reason)
        return ''
      }

      // 构建恢复提示
      const resumePrompt = buildResumePrompt(latestSnapshot)

      // 使用恢复 prompt 作为上下文执行
      return await this.execute(latestSnapshot.originalUserInput, resumePrompt)
    } catch (error) {
      console.warn('[AgentHandler] Resume failed:', error)
      return ''
    }
  }

  /**
   * 获取可恢复的快照列表
   */
  async getResumableSnapshots(): Promise<Array<{
    id: string
    title: string
    description: string
    stepCount: number
    interruptedAt: string
    canResume: boolean
    reason?: string
  }>> {
    try {
      const snapshots = await loadPersistedSnapshots()
      return snapshots.map(snapshot => getResumeSummary(snapshot))
    } catch {
      return []
    }
  }

  /**
   * 从指定快照恢复执行
   */
  async resumeFromSnapshot(snapshotId: string): Promise<string> {
    try {
      const snapshots = await loadPersistedSnapshots()
      const snapshot = snapshots.find(s => s.id === snapshotId)

      if (!snapshot) {
        console.warn('[AgentHandler] Snapshot not found:', snapshotId)
        return ''
      }

      const { canResume, reason } = canResumeSnapshot(snapshot)
      if (!canResume) {
        console.warn('[AgentHandler] Cannot resume:', reason)
        return ''
      }

      const resumePrompt = buildResumePrompt(snapshot)
      return await this.execute(snapshot.originalUserInput, resumePrompt)
    } catch (error) {
      console.warn('[AgentHandler] Resume from snapshot failed:', error)
      return ''
    }
  }

  private normalizeSkillIds(skillIds?: string[]): string[] {
    return Array.from(new Set(
      (skillIds || [])
        .map(id => id.trim())
        .filter(Boolean)
    ))
  }

  private async loadLegacyRuntimeState() {
    try {
      const { useMcpStore } = await import('@/stores/mcp')
      const { reloadMcpTools, getAllToolsSync } = await import('./tools')
      const mcpStore = useMcpStore.getState()
      if (!mcpStore.initialized) {
        await mcpStore.initMcpData()
      }
      const currentTools = getAllToolsSync()
      if (!currentTools.some(t => t.category === 'mcp')) {
        await reloadMcpTools()
      }
    } catch (error) {
      console.error('[Agent Handler] Failed to initialize legacy runtime state:', error)
    }
  }

  private getForcedSkillMatchesFromState(state: AgentRunMiddlewareState): SkillMatchSummary[] {
    const forcedSkillIds = new Set(state.skills?.forcedSkillIds || [])
    return (state.skills?.activeSkillMatches || []).filter(match => forcedSkillIds.has(match.id))
  }

  private mergeSkillMatches(skillMatches: SkillMatchSummary[]): SkillMatchSummary[] {
    const matchesById = new Map<string, SkillMatchSummary>()
    for (const match of skillMatches) {
      if (!matchesById.has(match.id)) {
        matchesById.set(match.id, match)
      }
    }
    return Array.from(matchesById.values())
  }

  private async getForcedSkillMatches(skillIds: string[]): Promise<SkillMatchSummary[]> {
    if (skillIds.length === 0) {
      return []
    }

    try {
      const skillsStore = useSkillsStore.getState()
      await skillsStore.initSkills()

      return skillIds
        .map(skillId => skillManager.findSkill(skillId))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
        .map(skill => ({
          id: skill.metadata.id,
          name: skill.metadata.name,
          description: skill.metadata.description,
          score: 1,
          confidence: 'high' as const,
          reasons: ['用户通过 /skill 显式调用'],
          matchedSignals: [],
        }))
    } catch (error) {
      console.error('[Skills Debug] Failed to load forced skills:', error)
      return []
    }
  }

  /**
   * 获取所有可用的 Skills（只返回元数据，让 AI 先选择）
   */
  private async getAvailableSkills(userInput: string): Promise<SkillMatchSummary[]> {
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
      const matchedSkills = await skillManager.matchRelevantSkillScores(userInput, 5)

      // 返回候选 Skill 的可解释匹配结果，具体内容仍在提示词中按需加载
      return matchedSkills.map(score => skillManager.toMatchSummary(score))
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills:', error)
      return []
    }
  }

  /**
   * 获取 Skills 的详细信息用于 UI 显示
   */
  private async getSkillsInfo(skillMatches?: SkillMatchSummary[]): Promise<Array<{
    id: string
    name: string
    description?: string
    score?: number
    confidence?: 'high' | 'medium' | 'low'
    reasons?: string[]
  }>> {
    if (!skillMatches?.length) {
      return []
    }

    try {
      const skillsStore = useSkillsStore.getState()
      // 确保 Skill 管理器已初始化
      await skillsStore.initSkills()
      return (skillMatches || [])
        .filter(match => Boolean(skillManager.findSkill(match.id)))
        .map(match => ({
          id: match.id,
          name: match.name,
          description: match.description,
          score: match.score,
          confidence: match.confidence,
          reasons: match.reasons,
        }))
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills info:', error)
      return []
    }
  }
}
