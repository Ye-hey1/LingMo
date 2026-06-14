import type OpenAI from 'openai'
import { createOpenAIClient, getAISettings } from '@/lib/ai/utils'
import { prepareMessagesWithImages } from '@/lib/ai/vision-bridge'
import { getModelCapabilityProfile } from '@/lib/ai/model-capabilities'
import { estimateTokens } from '@/lib/ai/token-counter'
import { getToolByName, getAllToolsSync, reloadMcpTools } from '@/lib/agent/tools'
import type { AgentEvent, ReActStep, Tool, ToolCall, ToolResult } from '@/lib/agent/types'
import type { AgentRunControl } from './types'
import { createAgentEventBus, type AgentEventBus } from '@/lib/agent/event-bus'
import { deriveIntentPolicy, READ_ONLY_TOOLS, type IntentPolicy } from '@/lib/agent/tool-policy'
import { buildContextPack } from './context-engine'
import { writeAgentVfsText } from './vfs'
import { buildAgentSystemPrompt } from '@/lib/agent/prompt-assembler'
import { buildAgentHistoryContext } from '@/lib/agent/context-compression'
import { filterToolsWithCache } from '@/lib/agent/dynamic-tool-filter'
import { generateTaskPlan, isTaskLikelyComplex, type TaskPlan } from '@/lib/agent/task-planner'
import { getDirectAgentReply } from '@/lib/agent/orchestration'
import { executeGovernedHarnessTool } from './tool-governance'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { skillManager } from '@/lib/skills'
import { getConcreteToolCompletionBlockReason } from '@/lib/agent/final-answer'
import { isSupportOnlyToolName } from '@/lib/agent/support-tools'
import { createAiStreamContentProcessor } from '@/lib/ai/sanitize'
import { validateFinalAnswer } from '@/lib/agent/final-answer'
import type { LinkedResource } from '@/lib/files'

export interface HarnessAgentRunnerConfig {
  runControl?: AgentRunControl
  maxIterations?: number
  webSearchEnabled?: boolean
  activeSkills?: string[]
  activeSkillMatches?: SkillMatchSummary[]
  forcedSkillIds?: string[]
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
  linkedResources?: LinkedResource[]
  requestConfirmation?: (toolName: string, params: Record<string, any>, context?: any) => Promise<boolean>
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onEvent?: (event: AgentEvent) => void
  onAnswerDelta?: (content: string) => void
  onFinalAnswerRender?: (content: string) => void
}

interface ModelToolCall {
  id: string
  name: string
  argumentsText: string
}

function isLengthTruncated(reason?: string | null) {
  return reason === 'length' || reason === 'max_tokens'
}

function createRunId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function toolToOpenAiTool(tool: Tool) {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const param of tool.parameters) {
    properties[param.name] = {
      type: param.type === 'array' ? 'array' : param.type,
      description: param.description,
    }
    if (param.type === 'array') {
      properties[param.name].items = { type: 'string' }
    }
    if (param.required) required.push(param.name)
  }

  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: [
        tool.description,
        `Category: ${tool.category}.`,
        `Risk: ${tool.risk || 'unspecified'}.`,
        `Capabilities: ${tool.capabilities?.join(', ') || 'unspecified'}.`,
        tool.requiresConfirmation ? 'Requires confirmation before execution.' : '',
      ].filter(Boolean).join(' '),
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  }
}

function parseToolArguments(toolCall: ModelToolCall): Record<string, any> {
  const raw = toolCall.argumentsText.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeToolCalls(toolCalls: ModelToolCall[]): ModelToolCall[] {
  return toolCalls.filter(call => call.name.trim()).map((call, index) => ({
    id: call.id || `tool-call-${Date.now()}-${index}`,
    name: call.name.trim(),
    argumentsText: call.argumentsText || '{}',
  }))
}

function buildToolResultMessage(toolCallId: string, result: ToolResult, observation: string): OpenAI.Chat.ChatCompletionMessageParam {
  const content = result.success
    ? observation
    : `Error: ${result.error || result.message || observation || 'Tool failed'}`
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  } as OpenAI.Chat.ChatCompletionMessageParam
}

function buildSkippedToolResultMessage(toolCall: ModelToolCall, reason: string): OpenAI.Chat.ChatCompletionMessageParam {
  return buildToolResultMessage(
    toolCall.id,
    {
      success: false,
      error: reason,
      message: reason,
    },
    reason,
  )
}

function isSuccessfulStep(step: ReActStep) {
  return Boolean(step.action?.tool) && !isSupportOnlyToolName(step.action?.tool) &&
    Boolean(step.observation) &&
    !/失败|错误|出错|阻止|取消|failed|error|blocked|cancelled/i.test(step.observation || '')
}

function isMutationTool(toolName?: string) {
  if (!toolName || isSupportOnlyToolName(toolName)) return false
  if (toolName === 'replace_editor_content' || toolName === 'insert_at_cursor') return true
  return /^(create_|update_|delete_|rename_|move_|copy_)/.test(toolName)
}

function isConcreteCompletionTool(toolName?: string) {
  if (!toolName || isSupportOnlyToolName(toolName)) return false
  return isMutationTool(toolName) ||
    toolName === 'execute_skill_script' ||
    toolName === 'safe_write_file' ||
    /diagram|visual_report|export|render|pptx|pdf|docx|xlsx/i.test(toolName)
}

function validateHarnessFinalAnswer(input: {
  userInput: string
  finalAnswer: string
  steps: ReActStep[]
  intentPolicy: IntentPolicy
  selectedSkillIds: Set<string>
}) {
  const hasSuccessfulTool = input.steps.some(isSuccessfulStep)
  const validation = validateFinalAnswer(input.finalAnswer, input.userInput, hasSuccessfulTool)
  if (!validation.ok) return validation

  const actionLikeRequest = input.intentPolicy.allowWrite || input.intentPolicy.allowExecute || input.intentPolicy.allowDestructive
  const hasOnlySupportProgress = input.steps.length > 0 &&
    input.steps.every(step => !step.action || isSupportOnlyToolName(step.action.tool))
  const hasConcreteSuccessfulAction = input.steps.some(step => (
    isConcreteCompletionTool(step.action?.tool) &&
    isSuccessfulStep(step)
  ))

  const concreteBlockReason = getConcreteToolCompletionBlockReason({
    userInput: input.userInput,
    actionLikeRequest,
    hasConcreteSuccessfulAction,
    hasOnlySupportProgress,
  })
  if (concreteBlockReason) {
    return { ok: false, reason: concreteBlockReason }
  }

  const normalizedInput = input.userInput.toLowerCase()
  const claimsExecution = /已生成|已创建|已保存|已完成|已导出|已验证|成功使用|generated|created|saved|exported|verified|completed/.test(input.finalAnswer)
  const requestedArtifact = /生成|创建|制作|导出|保存|输出|pptx|pdf|docx|xlsx|文件|演示文稿|generate|create|export|save|file|presentation/.test(normalizedInput)
  const requestedEdit = /修改|编辑|改成|改为|改回|替换|删除|移动|重命名|复制|插入|rewrite|edit|modify|change|replace|delete|move|rename|copy|insert/.test(normalizedInput)
  const claimsEditApplied = /已修改|已更新|已改为|已改回|已删除|已移动|已重命名|已复制|现在为|已经是|updated|changed|modified|deleted|moved|renamed|copied/.test(input.finalAnswer)
  const hasMutationSuccess = input.steps.some(step => isMutationTool(step.action?.tool) && isSuccessfulStep(step))

  if (actionLikeRequest && requestedArtifact && claimsExecution && !hasSuccessfulTool) {
    return {
      ok: false,
      reason: hasOnlySupportProgress
        ? '仅完成了 Skill 选择或说明读取，尚未真正执行创建/脚本工具，不能宣称文件已生成。请继续执行实际工具。'
        : '尚未获得真实工具成功结果，不能宣称文件已生成、已保存或已验证。请继续执行实际工具。',
    }
  }

  if (input.selectedSkillIds.size > 0 && claimsExecution && !hasSuccessfulTool) {
    return {
      ok: false,
      reason: '已选择 Skill，但还没有真正完成执行步骤。请先完成 create_file、execute_skill_script 或其他实际工具调用，再给最终答案。',
    }
  }

  if (actionLikeRequest && requestedEdit && claimsEditApplied && !hasMutationSuccess) {
    return {
      ok: false,
      reason: '还没有成功的写入/编辑工具结果，不能声称内容已修改。请继续执行实际编辑工具，再给最终答案。',
    }
  }

  return { ok: true }
}

function getToolSubset(allTools: Tool[], steps: ReActStep[], forcedSkillIds: string[], selectedSkillIds: Set<string>) {
  const forceInclude = new Set<string>()
  for (const skillId of [...forcedSkillIds, ...selectedSkillIds]) {
    const skill = skillManager.findSkill(skillId)
    for (const toolName of skill?.metadata.allowedTools || []) {
      forceInclude.add(toolName)
    }
  }

  return filterToolsWithCache(allTools, steps, {
    maxTools: 48,
    forceInclude: Array.from(forceInclude),
    alwaysInclude: [
      'select_skill',
      'load_skill_content',
      'get_editor_content',
      'replace_editor_content',
      'read_markdown_file',
      'read_markdown_files_batch',
      'safe_grep',
      'safe_read_file',
      'safe_list_files',
      'create_file',
      'get_current_time',
      'create_reminder',
      'list_reminders',
      'web_search',
      'web_extract',
      'github_summarize_recent_stars',
      'github_search_my_stars',
    ],
  })
}

export class HarnessAgentRunner {
  private eventBus: AgentEventBus
  private abortController: AbortController | null = null
  private stopped = false
  private steps: ReActStep[] = []
  private toolCallCounter = 0
  private selectedSkillIds = new Set<string>()
  private currentIteration = 0
  private taskPlan: TaskPlan | null = null

  constructor(private config: HarnessAgentRunnerConfig) {
    this.eventBus = createAgentEventBus({ runId: config.runControl?.runId || createRunId() })
  }

  stop() {
    this.stopped = true
    this.emitEvent('agent.stopped')
    this.abortController?.abort()
    this.abortController = null
  }

  getSteps() {
    return [...this.steps]
  }

  getCurrentIteration() {
    return this.currentIteration
  }

  private emitEvent(type: AgentEvent['type'], payload?: Record<string, any>) {
    const event = this.eventBus.emit(type, payload, {
      iteration: this.currentIteration || undefined,
      level: type === 'error' ? 'error' : undefined,
    })
    this.config.runControl?.recordEvent(event)
    this.config.onEvent?.(event)
    return event
  }

  private emitObservation(observation: string, options: { internal?: boolean; visibility?: 'visible' | 'hidden'; toolName?: string } = {}) {
    const visibility = options.visibility || (options.internal ? 'hidden' : 'visible')
    if (!options.internal && visibility !== 'hidden') {
      this.config.onObservation?.(observation)
    }
    this.emitEvent('observation.created', { observation, internal: options.internal, visibility, toolName: options.toolName })
  }

  private emitToolCall(toolCall: ToolCall) {
    this.config.onToolCall?.(toolCall)
    this.emitEvent('tool.updated', {
      toolCall: {
        ...toolCall,
        params: { ...toolCall.params },
        result: toolCall.result ? { ...toolCall.result } : undefined,
      },
    })
  }

  private completeStep(step: ReActStep) {
    this.steps.push(step)
    this.emitEvent('step.completed', {
      title: step.action?.tool ? `Completed ${step.action.tool}` : 'Step completed',
      stepIndex: this.steps.length,
      toolName: step.action?.tool,
      action: step.action,
      thought: step.thought?.slice(0, 220),
      observation: step.observation?.slice(0, 220),
      success: step.observation ? !/失败|错误|出错|阻止|取消|failed|error|blocked|cancelled/i.test(step.observation) : undefined,
      visibility: 'visible',
    })
  }

  private async buildSystemPrompt(userInput: string, intentPolicy: IntentPolicy) {
    let memoryPrompt = ''
    try {
      const { unifiedContextLoader } = await import('@/lib/context/unified-loader')
      const activeFilePath = this.config.currentQuote?.fileName
      const unifiedContext = await unifiedContextLoader.getContextForAgent(userInput, { activeFilePath })
      memoryPrompt = unifiedContext.prompt || ''
    } catch {
      memoryPrompt = ''
    }

    const historyContext = buildAgentHistoryContext({
      userGoal: userInput,
      steps: this.steps,
      toolCalls: [],
      events: this.eventBus.getEvents(),
    })
    if (historyContext.snapshot) {
      this.emitEvent('agent.context.compacted', { snapshot: historyContext.snapshot })
    }

    return buildAgentSystemPrompt({
      userInput,
      webSearchEnabled: this.config.webSearchEnabled,
      memoryPrompt,
      activeSkills: Array.from(new Set([...(this.config.activeSkills || []), ...this.selectedSkillIds])),
      activeSkillMatches: this.config.activeSkillMatches,
      forcedSkillIds: this.config.forcedSkillIds,
      intentPolicy,
      extraSections: [
        '## Harness Tool Calling Protocol\n\nUse native tool calls when a tool is needed. Do not emit ReAct JSON. When finished, answer normally in user-visible Markdown.',
        historyContext.text ? `## Prior Harness State\n\n${historyContext.text}` : '',
      ],
    })
  }

  private buildMessages(
    systemPrompt: string,
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (Array.isArray(contextOrMessages) && contextOrMessages.length > 0) {
      const withoutSystem = contextOrMessages.filter(message => message.role !== 'system')
      return [
        { role: 'system', content: systemPrompt },
        ...withoutSystem,
      ]
    }

    return [
      { role: 'system', content: systemPrompt },
      ...(typeof contextOrMessages === 'string'
        ? [{ role: 'system' as const, content: contextOrMessages }]
        : []),
      { role: 'user', content: userInput },
    ]
  }

  private async prepareHarnessModelStep(input: {
    allTools: Tool[]
    userInput: string
    intentPolicy: IntentPolicy
  }): Promise<{ tools: Tool[]; promptSections: string[] }> {
    const selectedSkillIds = Array.from(this.selectedSkillIds)
    const dynamicSubset = getToolSubset(input.allTools, this.steps, this.config.forcedSkillIds || [], this.selectedSkillIds)
    if (!this.config.runControl) {
      return { tools: dynamicSubset, promptSections: [] }
    }

    const prepared = await this.config.runControl.prepareModel({
      iteration: this.currentIteration,
      tools: input.allTools,
      steps: this.steps,
      selectedSkillIds,
      activeSkillIds: this.config.activeSkills || [],
      intentPolicy: input.intentPolicy,
      webSearchEnabled: this.config.webSearchEnabled,
    })

    return {
      tools: prepared.tools || dynamicSubset,
      promptSections: prepared.promptSections || [],
    }
  }

  private async streamModel(input: {
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
    tools: Tool[]
    imageUrls?: string[]
    maxTokens?: number
  }): Promise<{ content: string; toolCalls: ModelToolCall[]; finishReason?: string | null }> {
    const aiConfig = await getAISettings()
    const openai = await createOpenAIClient(aiConfig)
    const capabilities = getModelCapabilityProfile(aiConfig)
    const messages = await prepareMessagesWithImages(input.messages, aiConfig, input.imageUrls, this.abortController?.signal)
    const requestParams: any = {
      model: aiConfig?.model || '',
      messages,
      temperature: aiConfig?.temperature ?? 0.35,
      top_p: aiConfig?.topP ?? 1,
      stream: true,
      tools: input.tools.map(toolToOpenAiTool),
    }
    if (capabilities.supportsToolChoice) requestParams.tool_choice = 'auto'
    if (input.maxTokens && input.maxTokens > 0) requestParams.max_tokens = input.maxTokens

    this.emitEvent('model.request.started', {
      mode: 'harness-tools',
      messageCount: messages.length,
      toolCount: input.tools.length,
      inputTokens: estimateTokens(JSON.stringify(messages)),
    })

    const stream = await openai.chat.completions.create(requestParams, {
      signal: this.abortController?.signal,
    }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

    let content = ''
    let thinking = ''
    let finishReason: string | null | undefined
    const toolCalls: ModelToolCall[] = []
    const streamProcessor = createAiStreamContentProcessor()

    for await (const chunk of stream) {
      if (this.stopped) throw new Error('USER_STOPPED')
      const choice = chunk.choices[0]
      const delta = choice?.delta
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const thinkingContent = (delta as any)?.reasoning_content || ''
      if (thinkingContent) {
        thinking += thinkingContent
        this.config.onThought?.(thinking)
        this.emitEvent('thought.updated', { content: thinking, streaming: true })
      }

      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || '',
              name: toolCall.function?.name || '',
              argumentsText: '',
            }
          }
          if (toolCall.id) toolCalls[index].id = toolCall.id
          if (toolCall.function?.name) toolCalls[index].name = toolCall.function.name
          if (toolCall.function?.arguments) toolCalls[index].argumentsText += toolCall.function.arguments
        }
      }

      const text = delta?.content || ''
      if (text) {
        const processed = streamProcessor.push(text)
        if (processed.thinking) {
          thinking += processed.thinking
          this.config.onThought?.(thinking)
          this.emitEvent('thought.updated', { content: thinking, streaming: true })
        }
        if (processed.content) {
          content += processed.content
          this.config.onAnswerDelta?.(content)
        }
      }
    }

    const remaining = streamProcessor.flush()
    if (remaining.thinking) {
      thinking += remaining.thinking
      this.config.onThought?.(thinking)
      this.emitEvent('thought.updated', { content: thinking, streaming: true })
    }
    if (remaining.content) {
      content += remaining.content
      this.config.onAnswerDelta?.(content)
    }

    this.emitEvent('model.response.received', {
      contentLength: content.length,
      outputTokens: estimateTokens(content),
      finishReason,
      truncated: isLengthTruncated(finishReason),
      toolCallCount: toolCalls.length,
    })

    return { content, toolCalls: normalizeToolCalls(toolCalls), finishReason }
  }

  private async executeModelToolCall(input: {
    toolCall: ModelToolCall
    userInput: string
    intentPolicy: IntentPolicy
  }): Promise<OpenAI.Chat.ChatCompletionMessageParam> {
    const { toolCall, userInput, intentPolicy } = input
    const tool = getToolByName(toolCall.name)
    const params = parseToolArguments(toolCall)
    this.config.onAction?.(toolCall.name, params)
    this.emitEvent('action.parsed', { tool: toolCall.name, params })

    this.toolCallCounter += 1
    const uiToolCall: ToolCall = {
      id: toolCall.id || `${Date.now()}-${this.toolCallCounter}`,
      toolName: toolCall.name,
      params,
      status: 'pending',
      timestamp: Date.now(),
    }

    if (!tool) {
      uiToolCall.status = 'error'
      uiToolCall.result = { success: false, error: `未找到工具 "${toolCall.name}"` }
      this.emitToolCall(uiToolCall)
      const observation = `错误：未找到工具 "${toolCall.name}"。请使用可用工具列表中的工具。`
      this.emitObservation(observation, { toolName: toolCall.name })
      this.completeStep({ thought: `Tool call: ${toolCall.name}`, action: { tool: toolCall.name, params }, observation })
      return buildToolResultMessage(toolCall.id, uiToolCall.result, observation)
    }

    uiToolCall.status = 'running'
    this.emitToolCall(uiToolCall)
    this.emitEvent('tool.execution.started', { toolName: tool.name, params, toolCallId: uiToolCall.id })

    const governed = await executeGovernedHarnessTool({
      tool,
      params,
      userInput,
      steps: this.steps,
      intentPolicy,
      webSearchEnabled: this.config.webSearchEnabled,
      currentQuote: this.config.currentQuote,
      selectedSkillIds: this.selectedSkillIds,
      activeSkillIds: this.config.activeSkills,
      linkedResources: this.config.linkedResources,
      runControl: this.config.runControl,
      context: {
        abortSignal: this.abortController?.signal,
        runId: this.eventBus.getRunId(),
        iteration: this.currentIteration,
        toolCallId: uiToolCall.id,
        stepId: `${this.currentIteration}-${uiToolCall.id}`,
        userInput,
      },
      requestConfirmation: this.config.requestConfirmation,
      onEvent: (type, payload) => this.emitEvent(type as AgentEvent['type'], payload),
    })

    const result = governed.execution.result
    uiToolCall.params = governed.params
    uiToolCall.status = result.success ? 'success' : 'error'
    uiToolCall.result = {
      ...result,
      data: {
        ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result.data !== undefined ? { value: result.data } : {}),
        dataRef: governed.execution.observation.dataRef,
        artifacts: governed.execution.observation.artifacts,
        retryable: governed.execution.observation.retryable,
        errorKind: governed.execution.observation.errorKind,
        cached: governed.cached,
      },
    }
    this.emitToolCall(uiToolCall)
    this.emitEvent('tool.execution.finished', {
      toolName: tool.name,
      params: governed.params,
      toolCallId: uiToolCall.id,
      success: result.success,
      message: result.message,
      error: result.error,
      dataRef: governed.execution.observation.dataRef,
      retryable: governed.execution.observation.retryable,
      errorKind: governed.execution.observation.errorKind,
      cached: governed.cached,
    })

    if (tool.name === 'select_skill' && result.success && Array.isArray(result.data?.selected_skills)) {
      for (const skillId of result.data.selected_skills) {
        this.selectedSkillIds.add(skillId)
      }
      const skillIds = Array.from(this.selectedSkillIds)
      const currentSkillsState = this.config.runControl?.getMiddlewareState().skills
      this.config.runControl?.setMiddlewareState({
        skills: {
          forcedSkillIds: currentSkillsState?.forcedSkillIds || this.config.forcedSkillIds || [],
          activeSkillIds: currentSkillsState?.activeSkillIds || this.config.activeSkills || [],
          selectedSkillIds: skillIds,
          activeSkillMatches: currentSkillsState?.activeSkillMatches || this.config.activeSkillMatches || [],
          warnings: currentSkillsState?.warnings || [],
        },
      })
      this.emitEvent('skills.selected', { skillIds })
    }

    this.emitObservation(governed.observationText, { toolName: tool.name })
    this.completeStep({
      thought: `Tool call: ${tool.name}`,
      action: { tool: tool.name, params: governed.params },
      observation: governed.observationText,
    })

    if (governed.cancelled) {
      this.stop()
    }

    return buildToolResultMessage(toolCall.id, result, governed.observationText)
  }

  async run(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[],
  ): Promise<string> {
    this.abortController = new AbortController()
    this.stopped = false
    this.steps = []
    this.currentIteration = 0
    this.selectedSkillIds = new Set((this.config.forcedSkillIds || []).filter(Boolean))
    const forcedSkillIds = Array.from(this.selectedSkillIds)
    const intentPolicy = deriveIntentPolicy(userInput)

    this.emitEvent('agent.started', { userInput, intentPolicy, forcedSkillIds })
    if (forcedSkillIds.length > 0) this.emitEvent('skills.selected', { skillIds: forcedSkillIds, explicit: true })

    const directReply = forcedSkillIds.length === 0 ? getDirectAgentReply(userInput, imageUrls) : null
    if (directReply) {
      this.config.onFinalAnswerRender?.(directReply)
      this.emitEvent('final', { content: directReply })
      this.emitEvent('final.answer.rendered', { content: directReply })
      this.emitEvent('agent.completed', { result: directReply })
      return directReply
    }

    await reloadMcpTools().catch(() => {})

    if (isTaskLikelyComplex(userInput)) {
      try {
        const toolNames = getAllToolsSync().map(tool => tool.name)
        this.taskPlan = await generateTaskPlan(userInput, toolNames, this.abortController.signal)
        if (this.taskPlan.isComplex) {
          this.emitEvent('agent.planning', { plan: this.taskPlan })
        }
      } catch {
        this.taskPlan = null
      }
    }

    let systemPrompt = await this.buildSystemPrompt(userInput, intentPolicy)
    const messages = this.buildMessages(systemPrompt, userInput, contextOrMessages)

    const contextItems = messages.map((message, index) => ({
      id: `message-${index}`,
      source: message.role === 'user' ? 'user' as const : 'history' as const,
      priority: message.role === 'user' ? 100 : 65,
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''),
      tokenEstimate: estimateTokens(typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '')),
    }))
    const pack = buildContextPack({
      runId: this.eventBus.getRunId(),
      tokenBudget: 70000,
      items: contextItems,
    })
    await writeAgentVfsText(this.eventBus.getRunId(), 'context', 'initial-context-pack.json', JSON.stringify(pack, null, 2), `${pack.included.length} context items`)

    const maxIterations = this.config.maxIterations || 18
    let finalAnswer = ''

    while (this.currentIteration < maxIterations) {
      if (this.stopped) throw new Error('USER_STOPPED')
      this.currentIteration += 1
      this.emitEvent('iteration.started')

      systemPrompt = await this.buildSystemPrompt(userInput, intentPolicy)
      messages[0] = { role: 'system', content: systemPrompt }
      const allTools = getAllToolsSync()
      const preparedStep = await this.prepareHarnessModelStep({ allTools, userInput, intentPolicy })
      const availableTools = preparedStep.tools
      if (preparedStep.promptSections.length > 0) {
        const promptWithMiddleware = [
          systemPrompt,
          ...preparedStep.promptSections,
        ].join('\n\n')
        messages[0] = { role: 'system', content: promptWithMiddleware }
      }
      const response = await this.streamModel({
        messages,
        tools: availableTools,
        imageUrls: this.currentIteration === 1 ? imageUrls : undefined,
      })

      if (response.toolCalls.length === 0) {
        const candidate = response.content.trim()
        const validation = validateHarnessFinalAnswer({
          userInput,
          finalAnswer: candidate,
          steps: this.steps,
          intentPolicy,
          selectedSkillIds: this.selectedSkillIds,
        })
        if (validation.ok || this.currentIteration >= maxIterations) {
          finalAnswer = candidate || validation.reason || '任务执行完成。'
          break
        }

        this.emitEvent('final.answer.rejected', { reason: validation.reason })
        this.emitObservation(validation.reason || '最终答案尚未满足任务要求，请继续执行必要工具。', { internal: true, visibility: 'hidden' })
        messages.push({ role: 'assistant', content: candidate })
        messages.push({
          role: 'user',
          content: `你的上一条回答还不能作为最终答案：${validation.reason} 请继续使用必要工具，或在证据充分后给出最终答案。`,
        })
        continue
      }

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.argumentsText || '{}',
          },
        })),
      } as OpenAI.Chat.ChatCompletionMessageParam)

      const readOnlyBatch = response.toolCalls.length > 1 &&
        response.toolCalls.every(call => {
          const tool = getToolByName(call.name)
          return tool && READ_ONLY_TOOLS.has(tool.name)
        })
      const callsToRun = readOnlyBatch ? response.toolCalls.slice(0, 3) : response.toolCalls.slice(0, 1)
      const callsToSkip = response.toolCalls.slice(callsToRun.length)
      for (const toolCall of callsToRun) {
        messages.push(await this.executeModelToolCall({ toolCall, userInput, intentPolicy }))
        if (this.stopped) throw new Error('USER_STOPPED')
      }
      for (const toolCall of callsToSkip) {
        const reason = readOnlyBatch
          ? 'Skipped extra read-only tool call because this step already reached the maximum parallel read limit. Please request remaining lookups in the next model step if still needed.'
          : 'Skipped extra tool call because write, execute, delete, and uncertain operations must be handled one at a time. Please wait for the completed observation before requesting another tool.'
        messages.push(buildSkippedToolResultMessage(toolCall, reason))
        this.emitEvent('tool.execution.finished', {
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          success: false,
          message: reason,
          error: 'SKIPPED_TOOL_CALL',
          retryable: true,
        })
      }
    }

    if (!finalAnswer) {
      finalAnswer = '已达到最大迭代次数，任务可能未完全完成。'
    }

    this.config.onFinalAnswerRender?.(finalAnswer)
    this.emitEvent('final', { content: finalAnswer })
    this.emitEvent('final.answer.rendered', { content: finalAnswer })
    this.emitEvent('agent.completed', { result: finalAnswer })
    return finalAnswer
  }
}
