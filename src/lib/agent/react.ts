import { AgentEvent, ReActStep, ToolCall, ToolResult } from './types'
import { getToolByName, getToolDescriptions } from './tools'
import { createAgentEventBus, AgentEventBus } from './event-bus'
import { buildAgentHistoryContext } from './context-compression'
import { skillManager } from '@/lib/skills'
import useChatStore from '@/stores/chat'
import useArticleStore from '@/stores/article'
import { isLinkedFolder, type LinkedResource } from '@/lib/files'
import {
  getAutoFinalAnswerDescriptor,
  shouldRecoverWithAutoFinalAnswer,
} from './auto-final-answer'
import {
  isIncompleteStructuredAgentJson,
  isStructuredThoughtOnlyJson,
  parseActionInputJson,
  parseStructuredActionJson,
  parseStructuredFinalAnswerJson,
  parseBatchActionJson,
} from './parse-action-input'
import {
  IntentPolicy,
  deriveIntentPolicy,
  evaluateIntentAwareToolPolicy,
  formatIntentPolicyForPrompt,
  READ_ONLY_TOOLS,
} from './tool-policy'
import { ToolResultCache } from './tool-cache'
import { generateTaskPlan, isTaskLikelyComplex, formatTaskPlanForPrompt, type TaskPlan } from './task-planner'
import OpenAI from 'openai'

const WEB_ACCESS_TOOL_NAMES = new Set([
  'web_search',
  'web_fetch',
  'web_extract',
  'clip_web_content',
])

type ParseActionResult =
  | { type: 'single'; tool: string; params: Record<string, any> }
  | { type: 'batch'; actions: Array<{ tool: string; params: Record<string, any> }> }

function buildIterationUserMessage(
  iteration: number,
  userInput: string,
  lastObservation?: string
): string {
  if (iteration <= 1) {
    return `This is iteration ${iteration}, please give your Thought and Action (or Final Answer):\n\nUser Request: ${userInput}`
  }

  return `## User Request
${userInput}

## Previous Step Result
${lastObservation || 'No previous result'}

---
Keep working toward the user request above.
If the task is completed, respond with Final Answer.
If you need to continue, provide your next Thought and Action.`
}

function normalizeLinkedCandidate(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getLinkedFileName(path: unknown): string {
  const normalized = normalizeLinkedCandidate(path)
  return normalized.split('/').pop() || normalized
}

function matchesLinkedFileCandidate(
  candidate: unknown,
  linkedResource: { relativePath?: string; name?: string; path?: string }
): boolean {
  const normalized = normalizeLinkedCandidate(candidate)
  if (!normalized) {
    return false
  }

  const linkedPaths = new Set([
    linkedResource.relativePath,
    linkedResource.name,
    linkedResource.path,
    getLinkedFileName(linkedResource.relativePath),
    getLinkedFileName(linkedResource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function shouldBlockRedundantLinkedFileRead(
  toolName: string,
  params: Record<string, any>,
  linkedResources: Array<{ relativePath?: string; name?: string; path?: string }>
): boolean {
  if (toolName === 'read_markdown_file') {
    return typeof params.filePath === 'string' &&
      linkedResources.some(resource => matchesLinkedFileCandidate(params.filePath, resource))
  }

  if (toolName === 'read_markdown_files_batch') {
    if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
      return false
    }

    return params.filePaths.every((filePath: unknown) =>
      typeof filePath === 'string' &&
      linkedResources.some(resource => matchesLinkedFileCandidate(filePath, resource))
    )
  }

  if (toolName === 'check_folder_exists') {
    return typeof params.folderPath === 'string' &&
      linkedResources.some(resource => matchesLinkedFileCandidate(params.folderPath, resource))
  }

  return false
}

function getEffectiveLinkedResources(): LinkedResource[] {
  const { linkedResource, linkedResources } = useChatStore.getState()
  return linkedResources.length > 0
    ? linkedResources
    : linkedResource
      ? [linkedResource]
      : []
}

function isExplicitTagOrMarkIntent(userInput: string): boolean {
  return /标签|標籤|tag|记录|紀錄|mark|摘录|摘錄|收集箱|inbox/i.test(userInput)
}

function shouldKeepFocusOnLinkedNote(
  userInput: string,
  linkedResource: { relativePath?: string; name?: string; path?: string },
  toolName: string
): boolean {
  const tagMarkToolNames = new Set([
    'list_tags',
    'search_tags',
    'read_marks',
    'search_marks',
    'search_all_marks',
  ])

  if (!tagMarkToolNames.has(toolName) || isExplicitTagOrMarkIntent(userInput)) {
    return false
  }

  const linkedPath = linkedResource.relativePath || linkedResource.path || linkedResource.name || ''
  return /\.md$/i.test(linkedPath)
}

function isSuccessfulObservation(observation?: string): boolean {
  if (!observation) {
    return false
  }

  return !observation.includes('失败') &&
    !observation.includes('错误') &&
    !observation.includes('阻止')
}

function isLegacyThoughtOnlyResponse(content: string): boolean {
  const trimmed = content.trim()
  return /^Thought[:：]/i.test(trimmed) &&
    !/Action[:：]/i.test(trimmed) &&
    !/(Final Answer[:：]|最终答案)/i.test(trimmed)
}

type CheckboxTargetState = 'checked' | 'unchecked'

function getCheckboxTargetState(userInput: string): CheckboxTargetState | null {
  if (/未完成|取消勾选|取消完成|unchecked|not completed|todo|待办/.test(userInput)) {
    return 'unchecked'
  }

  if (/已完成|勾选|打勾|checked|completed|完成状态/.test(userInput)) {
    return 'checked'
  }

  return null
}

function truncatePreviewContent(content: string, maxLength = 5000): string {
  if (content.length <= maxLength) {
    return content
  }

  return `${content.slice(0, maxLength)}\n... (${content.length - maxLength} more characters)`
}

function extractChangedRegionPreview(original: string, modified: string, contextLines = 3) {
  const originalLines = original.split('\n')
  const modifiedLines = modified.split('\n')
  let firstDiff = -1
  let lastDiff = -1
  const maxLines = Math.max(originalLines.length, modifiedLines.length)

  for (let i = 0; i < maxLines; i++) {
    if (originalLines[i] !== modifiedLines[i]) {
      if (firstDiff === -1) {
        firstDiff = i
      }
      lastDiff = i
    }
  }

  if (firstDiff === -1) {
    const previewLines = 50
    return {
      original: originalLines.slice(0, previewLines).join('\n'),
      modified: modifiedLines.slice(0, previewLines).join('\n'),
    }
  }

  const start = Math.max(0, firstDiff - contextLines)
  const end = Math.min(maxLines, lastDiff + contextLines + 1)

  return {
    original: originalLines.slice(start, end).join('\n'),
    modified: modifiedLines.slice(start, end).join('\n'),
  }
}

function shouldBlockRepeatedNoteExploration(
  toolName: string,
  params: Record<string, any>,
  steps: ReActStep[]
): boolean {
  const hasSuccessfulBatchRead = steps.some((step) =>
    step.action?.tool === 'read_markdown_files_batch' &&
    isSuccessfulObservation(step.observation) &&
    step.observation?.includes('成功读取')
  )

  if (toolName === 'list_markdown_files' && hasSuccessfulBatchRead) {
    return true
  }

  if (toolName !== 'read_markdown_files_batch') {
    return false
  }

  const currentParams = JSON.stringify(params || {})
  return steps.some((step) =>
    step.action?.tool === 'read_markdown_files_batch' &&
    JSON.stringify(step.action?.params || {}) === currentParams &&
    isSuccessfulObservation(step.observation)
  )
}

export interface ReActConfig {
  maxIterations: number
  webSearchEnabled?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onEvent?: (event: AgentEvent) => void
  onIterationStart?: () => void
  onSkillsSelected?: (skillIds: string[]) => void  // 当 AI 选择 Skills 时调用
  onFinalAnswerRender?: (markdownContent: string) => void  // 当检测到 Final Answer 时立即渲染 Markdown
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (toolName: string, params: Record<string, any>, context?: {
    previewParams?: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
  }) => Promise<boolean>
  activeSkills?: string[]  // 当前激活的 Skills
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
}

export class ReActAgent {
  private config: ReActConfig
  private steps: ReActStep[] = []
  private eventBus: AgentEventBus = createAgentEventBus()
  private currentIteration = 0
  private toolCallCounter = 0
  private stopped = false
  private abortController: AbortController | null = null
  private selectedSkills: Set<string> = new Set() // 记录 AI 选择的 Skills
  private currentUserInput = ''
  private toolCache = new ToolResultCache()
  private taskPlan: TaskPlan | null = null
  private cachedStaticPrompt: string | null = null
  private _cachedMemoryPrompt: string = ''
  private intentPolicy: IntentPolicy = {
    allowWrite: false,
    allowDestructive: false,
    allowExecute: false,
  }

  constructor(config: ReActConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 15
    }
  }

  private emitEvent(type: AgentEvent['type'], payload?: Record<string, any>) {
    const event = this.eventBus.emit(type, payload, {
      iteration: this.currentIteration || undefined,
      level: type === 'error' ? 'error' : undefined,
    })
    this.config.onEvent?.(event)
  }

  private emitToolCall(toolCall: ToolCall) {
    this.config.onToolCall?.(toolCall)
    this.emitEvent('tool', {
      toolCall: {
        ...toolCall,
        params: { ...toolCall.params },
        result: toolCall.result ? { ...toolCall.result } : undefined,
      },
    })
    this.emitEvent('tool.updated', {
      toolCall: {
        ...toolCall,
        params: { ...toolCall.params },
        result: toolCall.result ? { ...toolCall.result } : undefined,
      },
    })
  }

  private emitObservation(observation: string) {
    this.config.onObservation?.(observation)
    this.emitEvent('observation', { observation })
    this.emitEvent('observation.created', { observation })
  }

  stop() {
    this.stopped = true
    this.emitEvent('agent.stopped')
    // 终止所有正在进行的异步操作
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  isStopped(): boolean {
    return this.stopped
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
    this.eventBus.reset()
    this.selectedSkills.clear()
    this.toolCache.invalidateAll()
    this.cachedStaticPrompt = null
    this.currentUserInput = userInput
    this.intentPolicy = deriveIntentPolicy(userInput)
    this.taskPlan = null
    this.emitEvent('agent.started', {
      runId: this.eventBus.getRunId(),
      userInput,
      intentPolicy: this.intentPolicy,
    })
    // 创建新的 AbortController
    this.abortController = new AbortController()

    let finalAnswer = ''

    // Planning phase: generate a brief plan for complex tasks
    if (isTaskLikelyComplex(userInput)) {
      try {
        const { getAllToolsSync } = await import('./tools')
        const toolNames = getAllToolsSync().map(t => t.name)
        this.taskPlan = await generateTaskPlan(userInput, toolNames, this.abortController?.signal)
        if (this.taskPlan.isComplex) {
          this.emitEvent('agent.planning', { plan: this.taskPlan })

          // 自适应迭代上限：根据任务复杂度动态调整
          const { computeAdaptiveIterationLimit } = await import('./safety-guards')
          const iterConfig = computeAdaptiveIterationLimit(this.taskPlan, userInput)
          this.config.maxIterations = iterConfig.maxIterations
        }
      } catch {
        // Planning failure is non-critical, proceed with normal ReAct
        this.taskPlan = null
      }
    }

    // 检测 contextOrMessages 的类型
    const isMessagesArray = Array.isArray(contextOrMessages)
    const contextString = isMessagesArray ? undefined : contextOrMessages as string | undefined
    const messagesArray = isMessagesArray ? contextOrMessages as OpenAI.Chat.ChatCompletionMessageParam[] : undefined

    while (this.currentIteration < this.config.maxIterations) {
      // 检查是否已停止
      if (this.stopped) {
        // 返回特殊标记表示被用户终止，但保留已产生的步骤
        throw new Error('USER_STOPPED')
      }

      this.currentIteration++
      this.emitEvent('iteration.started')

      // 语义循环检测：防止 Agent 陷入无效循环（只在 5 次迭代后才检测）
      if (this.currentIteration > 5) {
        const { detectSemanticLoop } = await import('./safety-guards')
        const loopResult = detectSemanticLoop(this.steps)
        if (loopResult.isLoop) {
          console.warn(`[Agent] Loop detected: ${loopResult.reason}`)
          // 尝试从已有步骤中提取有用信息作为最终答案
          const successfulSteps = this.steps.filter(s => s.action && s.observation && !s.observation.includes('失败') && !s.observation.includes('无法解析') && !s.observation.includes('你只输出'))
          if (successfulSteps.length > 0) {
            const lastSuccess = successfulSteps[successfulSteps.length - 1]
            finalAnswer = `基于已完成的分析：\n\n${lastSuccess.observation}`
          } else {
            finalAnswer = '抱歉，执行过程中遇到了格式问题，请重试。'
          }
          break
        }
      }

      // 在新迭代开始时，通知保存上一次的思考到历史
      if (this.currentIteration > 1) {
        this.config.onIterationStart?.()
      }

      // 每次迭代都重新构建系统提示词，因为 Skills 指令依赖于当前迭代次数
      const systemPrompt = await this.buildSystemPrompt()

      const thought = await this.think(userInput, contextString, messagesArray, systemPrompt, imageUrls)

      // 再次检查是否已停止
      if (this.stopped) {
        // 返回特殊标记表示被用户终止，但保留已产生的步骤
        throw new Error('USER_STOPPED')
      }

      const lastCompletedStep = this.steps[this.steps.length - 1]
      if (lastCompletedStep?.action && shouldRecoverWithAutoFinalAnswer(thought)) {
        const descriptor = getAutoFinalAnswerDescriptor({
          toolName: lastCompletedStep.action.tool,
          params: lastCompletedStep.action.params,
          observation: lastCompletedStep.observation || '',
        })
        if (descriptor) {
          finalAnswer = this.config.formatAutoFinalAnswer?.(descriptor.key, descriptor.values) || descriptor.fallback
          break
        }
      }

      // 检查是否包含 Final Answer（支持多种格式，包括换行的情况）
      // 处理 "Action: Final\nAnswer:" 的特殊情况
      const normalizedThought = thought.replace(/\s+/g, ' ')
      const hasFinalAnswer = normalizedThought.includes('Final Answer:') ||
                             normalizedThought.includes('Final Answer：') ||
                             normalizedThought.includes('最终答案') ||
                             /Action:\s*Final\s*Answer/i.test(thought)

      if (hasFinalAnswer) {
        // 直接提取 Final Answer 后面的内容作为 Markdown 格式返回
        if (thought.includes('Final Answer:')) {
          finalAnswer = thought.split('Final Answer:')[1].trim()
        } else if (thought.includes('Final Answer：')) {
          finalAnswer = thought.split('Final Answer：')[1].trim()
        } else if (thought.includes('最终答案')) {
          finalAnswer = thought.split('最终答案')[1].trim()
        } else if (/Action:\s*Final\s*Answer:\s*([\s\S]*)/i.test(thought)) {
          // 处理 "Action: Final\nAnswer:" 的情况
          const match = thought.match(/Action:\s*Final\s*Answer:\s*([\s\S]*)/i)
          if (match) {
            finalAnswer = match[1].trim()
          }
        } else if (/Final Answer:\s*([\s\S]*)/i.test(thought)) {
          // 处理 "Final Answer:\n..." 多行内容的情况
          const match = thought.match(/Final Answer:\s*([\s\S]*)/i)
          if (match) {
            finalAnswer = match[1].trim()
          }
        }

        const finalAnswerValidation = this.validateFinalAnswerReadiness(userInput, finalAnswer || '')
        if (!finalAnswerValidation.ok) {
          const observation = finalAnswerValidation.reason || '最终答案校验未通过，请继续执行实际工具。'
          this.emitObservation(observation)
          this.steps.push({
            thought,
            action: undefined,
            observation,
          })
          finalAnswer = ''
          continue
        }
        break
      }

      const structuredFinalAnswer = parseStructuredFinalAnswerJson(thought)
      if (structuredFinalAnswer) {
        finalAnswer = structuredFinalAnswer
        const finalAnswerValidation = this.validateFinalAnswerReadiness(userInput, finalAnswer)
        if (!finalAnswerValidation.ok) {
          const observation = finalAnswerValidation.reason || '最终答案校验未通过，请继续执行实际工具。'
          this.emitObservation(observation)
          this.steps.push({
            thought,
            action: undefined,
            observation,
          })
          finalAnswer = ''
          continue
        }
        break
      }

      // 根据当前进展生成不同的提示
      const hasSuccessfulSteps = this.steps.some(s => s.action && s.observation && !s.observation.includes('失败'))
      const reasoningOnlyObservation = hasSuccessfulSteps
        ? '你已经获得了工具执行结果，现在请直接用 Final Answer 输出最终分析报告。格式：\n{"final_answer": "你的完整回答（Markdown 格式）"}'
        : '你只输出了思考内容，没有给出 Action 或 Final Answer。如果需要工具，请输出：\n{"action": "工具名", "action_input": {"参数": "值"}}\n如果可以直接回答，请输出：\n{"final_answer": "你的回答"}'
      if (isIncompleteStructuredAgentJson(thought) || isStructuredThoughtOnlyJson(thought) || isLegacyThoughtOnlyResponse(thought)) {
        // 如果连续 2 次格式错误且已有工具结果，直接把内容当作 Final Answer
        const consecutiveFormatErrors = this.steps.slice(-2).filter(s => !s.action).length
        if (consecutiveFormatErrors >= 2 && hasSuccessfulSteps) {
          const content = thought.replace(/^(?:Thought|思考)[：:]\s*/i, '').replace(/\{[\s\S]*\}/, '').trim()
          if (content.length > 20) {
            finalAnswer = content
            break
          }
        }

        this.emitObservation(reasoningOnlyObservation)
        this.steps.push({
          thought,
          action: undefined,
          observation: reasoningOnlyObservation,
        })
        continue
      }

      // 检查是否是纯思考而没有 Action（说明 AI 认为任务已完成但忘记用 Final Answer 格式）
      if (!thought.includes('Action:') && thought.includes('Thought:') && this.currentIteration > 1) {
        const thoughtContent = thought.replace(/Thought:\s*/i, '').trim()
        if (thoughtContent.length > 0 && !thoughtContent.includes('Action:')) {
          this.emitObservation(reasoningOnlyObservation)
          this.steps.push({
            thought,
            action: undefined,
            observation: reasoningOnlyObservation,
          })
          continue
        }
      }

      const action = this.parseAction(thought)
      if (!action) {
        if (thought.includes('Action:')) {
          const observation = 'Action Input JSON 无法解析。请保持动作不变，并只重新输出一次有效的 JSON 参数。'
          this.emitObservation(observation)
          this.steps.push({
            thought,
            action: undefined,
            observation,
          })
          continue
        }

        const thoughtContent = thought.replace(/Thought:\s*/i, '').trim()
        if (
          thoughtContent &&
          thoughtContent.length > 10 &&
          !thoughtContent.includes('Action:') &&
          !isIncompleteStructuredAgentJson(thought) &&
          !isStructuredThoughtOnlyJson(thought) &&
          !isLegacyThoughtOnlyResponse(thought)
        ) {
          // 检查思考内容中是否提到了工具名——如果提到了，说明 AI 还想继续执行
          const toolMentionMatch = thoughtContent.match(/\b(safe_grep|safe_read_file|safe_list_files|web_search|web_fetch|web_extract|create_file|read_markdown_file|list_markdown_files|get_editor_content|replace_editor_content|insert_at_cursor|create_diagram_from_outline|generate_flashcards|get_connected_notes|get_graph_overview|suggest_links_for_note|search_markdown_files|analyze_note_topics|build_semantic_relations|get_semantic_relations)\b/i)

          if (toolMentionMatch && this.currentIteration < this.config.maxIterations - 1) {
            // AI 提到了工具但没有正确格式化——自动构造 Action 让它继续
            const mentionedTool = toolMentionMatch[1]

            // 尝试从上下文推断参数
            const autoParams: Record<string, any> = {}
            if (mentionedTool === 'safe_grep') {
              // 从文本中提取可能的搜索关键词
              const keywordMatch = thoughtContent.match(/搜索[""「]?([^""」\n,，。]+)[""」]?|search.*?["']([^"']+)["']/i)
              if (keywordMatch) {
                autoParams.query = (keywordMatch[1] || keywordMatch[2]).trim()
              }
            } else if (mentionedTool === 'get_connected_notes' || mentionedTool === 'suggest_links_for_note') {
              // 使用当前活跃文件
              const { default: useArticleStore } = await import('@/stores/article')
              const activePath = useArticleStore.getState().activeFilePath
              if (activePath) autoParams.filePath = activePath
            }

            // 如果能推断出参数，直接执行；否则提示 AI 重新格式化
            if (Object.keys(autoParams).length > 0) {
              const observation = `检测到你想使用 ${mentionedTool}，已自动执行。请根据结果继续。`
              this.config.onAction?.(mentionedTool, autoParams)
              this.emitEvent('action.parsed', { tool: mentionedTool, params: autoParams })
              const toolResult = await this.act(mentionedTool, autoParams, thought)
              const { truncateObservation } = await import('./safety-guards')
              const truncatedResult = truncateObservation(toolResult)
              this.emitObservation(truncatedResult)
              this.steps.push({ thought, action: { tool: mentionedTool, params: autoParams }, observation: truncatedResult })
              continue
            }

            // 无法推断参数，提示重新格式化
            const observation = `你提到了要使用 ${mentionedTool}，但没有按格式输出。请直接输出：\n{"action": "${mentionedTool}", "action_input": {"参数名": "参数值"}}`
            this.emitObservation(observation)
            this.steps.push({ thought, action: undefined, observation })
            continue
          }

          finalAnswer = thoughtContent
          break
        }

        // 如果是第一次迭代，可能是 AI 没理解用户意图
        // 尝试让 AI 直接回答而不是调用工具
        if (this.currentIteration === 1) {
          finalAnswer = thoughtContent || '抱歉，我不太理解您的需求。您能详细说明一下吗？'
          break
        }

        // 多次迭代后仍然失败，给出提示
        finalAnswer = thoughtContent || '抱歉，我遇到了一些问题。您能换种方式说明一下您的需求吗？'
        break
      }

      // 检测重复操作（仅对 single 类型）
      if (action.type === 'single') {
        const lastStep = this.steps[this.steps.length - 1]
        if (lastStep && lastStep.action) {
          // 检查是否是相同的工具和参数
          const isSameTool = lastStep.action.tool === action.tool
          const isSameParams = JSON.stringify(lastStep.action.params) === JSON.stringify(action.params)
          const lastStepWasPolicyAdjustment = this.isPolicyAdjustmentObservation(lastStep.observation)

          if (isSameTool && isSameParams) {
            if (lastStepWasPolicyAdjustment) {
            } else {
              // 检测到重复操作，给出警告并结束
              console.warn(`检测到重复操作: ${action.tool}`, action.params)
              finalAnswer = `操作已完成。${lastStep.observation}`
              break
            }
          }

          // 检查是否连续多次执行完全相同的操作（超过 5 次且工具和参数都相同）
          // 只检查参数完全相同的情况，避免误判合法的批量操作
          let sameActionCount = 0
          for (let i = this.steps.length - 1; i >= 0; i--) {
            const step = this.steps[i]
            if (step.action && step.action.tool === action.tool) {
              const stepParamsSame = JSON.stringify(step.action.params) === JSON.stringify(action.params)
              if (stepParamsSame) {
                sameActionCount++
              } else {
                break
              }
            } else {
              break
            }
          }

          if (sameActionCount >= 5) {
            console.warn(`检测到连续多次执行相同操作: ${action.tool}, 次数: ${sameActionCount}`)
            finalAnswer = `检测到连续多次执行相同操作，已自动停止。最后操作结果：${lastStep.observation}`
            break
          }
        }
      }

      // Execute actions (single or batch)
      if (action.type === 'batch') {
        // Batch execution for read-only tools
        const batchResults: Array<{ tool: string; params: Record<string, any>; result: string }> = []

        for (const batchAction of action.actions) {
          if (this.stopped) break

          this.config.onAction?.(batchAction.tool, batchAction.params)
          this.emitEvent('action', { tool: batchAction.tool, params: batchAction.params })
          this.emitEvent('action.parsed', { tool: batchAction.tool, params: batchAction.params })

          const obs = await this.act(batchAction.tool, batchAction.params, thought)
          batchResults.push({ tool: batchAction.tool, params: batchAction.params, result: obs })
        }

        if (this.stopped) {
          throw new Error('USER_STOPPED')
        }

        const combinedObservation = batchResults.length === 1
          ? batchResults[0].result
          : batchResults.map((r, i) => `### Batch Result ${i + 1}: ${r.tool}\n${r.result}`).join('\n\n---\n\n')

        this.emitObservation(combinedObservation)
        this.steps.push({
          thought,
          action: { tool: 'batch', params: { actions: action.actions } },
          observation: combinedObservation,
        })
      } else {
        // Single action execution (original logic)
        this.config.onAction?.(action.tool, action.params)
        this.emitEvent('action', {
          tool: action.tool,
          params: action.params,
        })
        this.emitEvent('action.parsed', {
          tool: action.tool,
          params: action.params,
        })

        let observation = await this.act(action.tool, action.params, thought)

        // 检查是否已停止
        if (this.stopped) {
          // 返回特殊标记表示被用户终止，但保留已产生的步骤
          throw new Error('USER_STOPPED')
        }

        // Observation 硬截断防护（防止 context window 溢出）
        const { truncateObservation } = await import('./safety-guards')
        observation = truncateObservation(observation)

        this.emitObservation(observation)

        // Invalidate cache after successful write operations
        if (!this.toolCache.isCacheable(action.tool)) {
          this.toolCache.invalidateAll()
        }

        this.steps.push({
          thought,
          action,
          observation,
        })
      }

      const lastStepForErrorCheck = this.steps[this.steps.length - 1]
      if (lastStepForErrorCheck?.observation?.includes('错误') || lastStepForErrorCheck?.observation?.includes('失败')) {
        if (this.currentIteration >= this.config.maxIterations - 1) {
          finalAnswer = `执行过程中遇到问题：${lastStepForErrorCheck.observation}`
          break
        }
      }
    }

    if (!finalAnswer && this.currentIteration >= this.config.maxIterations) {
      finalAnswer = '已达到最大迭代次数，任务可能未完全完成。'
    }

    const result = finalAnswer || '任务执行完成。'
    this.config.onFinalAnswerRender?.(result)
    this.emitEvent('final', { content: result })
    this.emitEvent('final.answer.rendered', { content: result })
    this.emitEvent('agent.completed', { result })
    return result
  }

  private async buildSystemPrompt(): Promise<string> {
    // Dynamic parts that change per iteration
    const skillsInstructions = this.formatSkillsInstructions()
    const intentPolicyPrompt = formatIntentPolicyForPrompt(this.intentPolicy)
    const webSearchControl = this.config.webSearchEnabled
      ? '- Current request web access: ENABLED. Use `web_search` for current external facts, `web_extract` for readable page bodies, and `web_fetch` only when you need raw page contents from a specific URL.'
      : '- Current request web access: DISABLED. Do not call `web_search`, `web_extract`, `web_fetch`, or other web tools; if current web data is required, ask the user to enable the web-search button in the chat input.'

    // Load user memories — only on first iteration, cache for subsequent iterations
    let memoryPrompt = ''
    if (this.currentIteration <= 1) {
      try {
        const { contextLoader } = await import('@/lib/context/loader')
        const memoryContext = await contextLoader.getContextForQuery(this.currentUserInput)
        if (memoryContext.preferences.length > 0 || memoryContext.memory.length > 0) {
          memoryPrompt = contextLoader.formatMemoriesForPrompt(memoryContext)
          // 缓存记忆 prompt，后续迭代直接复用
          this._cachedMemoryPrompt = memoryPrompt
        }
      } catch (error) {
        console.error('[Agent] Failed to load memories:', error)
      }
    } else {
      memoryPrompt = this._cachedMemoryPrompt || ''
    }

    // Build or reuse cached static prompt portion (tool descriptions, rules, examples)
    if (!this.cachedStaticPrompt) {
      const toolDescriptions = getToolDescriptions()
      this.cachedStaticPrompt = `## Core Rules

**Intent First**: Analyze intent before acting. Question → \`{"final_answer":"..."}\` directly. Action → tools. Uncertain → ask. If context/RAG/quoted content already answers → Final Answer immediately.
**Skills ≠ Tools**: Skills are guidance docs. Use real tools (create_file etc.) to execute, never \`Action: skill_name\`.
**Efficiency**: Minimum steps. One WRITE tool per iteration, batch up to 3 independent READ tools. No unnecessary tool calls.

## Core Concepts (Notes vs Tags vs Marks)

- **Notes** (笔记): .md files. Tool pattern: *_markdown_file. Use for: read/write file content.
- **Tags** (标签): SQLite categories. Tool pattern: *_tag. Use for: organize/group marks.
- **Marks** (记录): SQLite records. Tool pattern: *_mark. Use for: bookmarks, captures, OCR.

## Available Tools

${toolDescriptions}

## Safe Tools

\`safe_list_files\`/ \`safe_read_file\`/ \`safe_grep\`: workspace-scoped reads. \`safe_write_file\`: approved writes. \`web_search\`/ \`web_fetch\`: public web access (no localhost/private).

## Diagram Guide

- Inline diagrams → Mermaid code blocks via editor tools. Standalone files → diagram tools.
- Outline → prefer \`create_diagram_from_outline\`. Blank/custom → \`create_diagram_file\`.
- Before updating → \`read_diagram_file\` first. Supported: .drawio, .drawio.xml, .excalidraw.json, .diagram.json.

## Search Guide

RAG results appear in context automatically. If insufficient: \`search_markdown_files\` (keyword/rag), \`search_marks\` (records). Only use when user explicitly requests search.

## Output Format (JSON only)

- **Tool call**: \`{"thought":"reason","action":"tool_name","action_input":{"param":"value"}}\`
- **Batch reads** (max 3, all read-only): \`{"thought":"reason","actions":[{"action":"...","action_input":{...}},...]}\`
- **Final answer**: \`{"thought":"reason","final_answer":"answer"}\`
- **Direct answer** (no tools): \`{"final_answer":"answer"}\`

No source boilerplate in Final Answer (no "> 基于笔记", "Sources:", etc.). UI handles citations.

## Critical Rules

1. **File safety**: Never claim files missing without tool confirmation. For .md paths use \`read_markdown_file\`, not \`check_folder_exists\`. Include \`expectedModifiedAt\` when updating saved files.
2. **Editor edits**: Prefer \`startLine\`/\`endLine\` + \`version\` for \`replace_editor_content\`. On \`searchContent\` failure → get fresh content and retry with line numbers.
3. **Quoted content**: Explain/summarize/analyze → answer directly. Only edit when user explicitly requests modification.
4. **Task completion**: After tool success, if done → Final Answer immediately. If next step needed → continue. Never repeat same action.
5. **State-based reasoning**: Base next action on PREVIOUS observation, not original request. Build on results.
6. **Checkbox edits**: "已完成/勾选" → \`- [x]\`, "未完成/取消勾选" → \`- [ ]\`. "改回/还是/恢复为" = target state, not current.
7. **Don't repeat**: After modify → Final Answer. After search → act on results. After create → confirm and stop.

## Runtime Tool Policy

${intentPolicyPrompt}

Now start executing the task!`
    }

    // Assemble: header + dynamic memory + static cached body + dynamic skills/plan/web
    let prompt = `You are an efficient AI agent that uses tools to help users complete tasks. Follow the ReAct framework: Thought → Action → Observation.

${memoryPrompt ? `## User Memories\n\n${memoryPrompt}\n` : ''}
${this.cachedStaticPrompt}`

    // Dynamic: Agent working memory (cross-session context) — only first iteration
    if (this.currentIteration <= 1) {
      try {
        const { loadWorkingMemory, formatWorkingMemoryForPrompt } = await import('./working-memory')
        const workingMemory = await loadWorkingMemory()
        const workingMemoryPrompt = formatWorkingMemoryForPrompt(workingMemory)
        if (workingMemoryPrompt) {
          prompt += `\n\n${workingMemoryPrompt}`
        }
      } catch {
        // Working memory is non-critical
      }
    }

    // Dynamic: Skills instructions
    if (skillsInstructions) {
      prompt += `

## Available Skills

${skillsInstructions}`
    }

    // Dynamic: Task plan
    const planPrompt = this.taskPlan?.isComplex ? formatTaskPlanForPrompt(this.taskPlan) : ''
    if (planPrompt) {
      prompt += `

${planPrompt}`
    }

    // Dynamic: Web search control
    prompt += `

${webSearchControl}`

    return prompt
  }

  private async think(
    userInput: string,
    context: string | undefined,
    messages: OpenAI.Chat.ChatCompletionMessageParam[] | undefined,
    systemPrompt: string,
    imageUrls?: string[]
  ): Promise<string> {
    const history = buildAgentHistoryContext({
      userGoal: userInput,
      steps: this.steps,
      toolCalls: this.eventBus.getEvents()
        .map(event => event.payload?.toolCall)
        .filter((toolCall): toolCall is ToolCall => Boolean(toolCall?.id && toolCall?.toolName)),
      events: this.eventBus.getEvents(),
    })
    const historyContext = history.text

    if (history.snapshot) {
      this.emitEvent('agent.context.compacted', { snapshot: history.snapshot })
    }

    // If messages array is provided, use it; otherwise use old string concatenation
    if (messages && messages.length > 0) {
      // Use messages array mode - build messages and add user request
      const messagesForAI: OpenAI.Chat.ChatCompletionMessageParam[] = []

      // Add system prompt (if any)
      if (systemPrompt) {
        messagesForAI.push({
          role: 'system',
          content: systemPrompt
        })
      }

      // Add conversation history
      messagesForAI.push(...messages)

      // Add current iteration context (ReAct step history)
      if (historyContext) {
        messagesForAI.push({
          role: 'system',
          content: `## Previous Iterations\n${historyContext}`
        })
      }

      // 【关键修改】按照 LangChain 最佳实践：
      // 第一次迭代：发送原始用户请求
      // 后续迭代：只发送上一步操作的结果，不再重复发送原始请求
      if (this.currentIteration === 1) {
        messagesForAI.push({
          role: 'user',
          content: buildIterationUserMessage(this.currentIteration, userInput)
        })
      } else {
        // 后续迭代：只发送上一步的结果
        const lastStep = this.steps[this.steps.length - 1]
        const lastObservation = lastStep?.observation || 'No previous result'
        messagesForAI.push({
          role: 'user',
          content: buildIterationUserMessage(this.currentIteration, userInput, lastObservation)
        })
      }

      // 调用实际的 LLM API
      try {
        const { fetchAiStream } = await import('@/lib/ai')
        let response = ''
        let lastUpdateLength = 0
        let lastUpdateTime = 0

        // 传递 AbortSignal 以支持终止，同时传递图片URL（仅在第一次迭代时）
        const imagesForThisIteration = this.currentIteration === 1 ? imageUrls : undefined
        await fetchAiStream('', (content) => {
          // 检查是否已终止
          if (this.stopped) {
            return
          }

          response = content

          // 自适应节流：最小 30 字符增长 + 150ms 间隔，关键词立即触发
          const now = Date.now()
          const hasKeyword = content.includes('Action:') || content.includes('Final Answer:')
          const charsGrown = content.length - lastUpdateLength
          const timeSinceUpdate = now - lastUpdateTime

          if (hasKeyword || (charsGrown > 30 && timeSinceUpdate > 150)) {
            this.config.onThought?.(content)
            this.emitEvent('thought', { content })
            this.emitEvent('thought.updated', { content })
            lastUpdateLength = content.length
            lastUpdateTime = now
          }
        }, this.abortController?.signal, undefined, undefined, undefined, imagesForThisIteration, undefined, messagesForAI)

        // 检查是否已终止
        if (this.stopped) {
          throw new Error('USER_STOPPED')
        }

        // 确保最终内容被更新
        if (response.length !== lastUpdateLength) {
          this.config.onThought?.(response)
          this.emitEvent('thought', { content: response })
          this.emitEvent('thought.updated', { content: response })
        }

        // 第一次迭代后，不再根据文本提及自动选择 Skills。
        // 只有显式调用 select_skill 工具才会生效，避免误命中无关 Skill。
        if (this.currentIteration === 1) {
          this.config.onSkillsSelected?.([])
        }

        return response
      } catch (error) {
        // 检查是否是因为终止导致的错误
        if (this.stopped || (error instanceof Error && error.name === 'AbortError')) {
          throw new Error('USER_STOPPED')
        }

        console.error('LLM API call failed:', error)
        this.emitEvent('error', {
          source: 'llm',
          error: error instanceof Error ? error.message : String(error),
        })
        // 如果 API 调用失败，返回错误提示
        return `Thought: Sorry, AI service is temporarily unavailable
Final Answer: Unable to complete task, please retry later or check AI configuration`
      }
    }

    // 旧的字符串拼接模式（向后兼容）
    // 【关键修改】按照 LangChain 最佳实践：
    // 第一次迭代：发送完整请求
    // 后续迭代：只发送上一步结果，不再重复发送原始请求
    let prompt: string
    if (this.currentIteration === 1) {
      prompt = `${systemPrompt}

${context ? `## 上下文信息\n${context}\n` : ''}

## 对话历史
${historyContext}

${buildIterationUserMessage(this.currentIteration, userInput)}`
    } else {
      // 后续迭代：只发送上一步的结果
      const lastStep = this.steps[this.steps.length - 1]
      const lastObservation = lastStep?.observation || '无'
      prompt = `${systemPrompt}

## 已完成的步骤
${historyContext}

${buildIterationUserMessage(this.currentIteration, userInput, lastObservation)}`
    }

    // 调用实际的 LLM API
    try {
      const { fetchAiStream } = await import('@/lib/ai')
      let response = ''
      let lastUpdateLength = 0

      // 传递 AbortSignal 以支持终止，同时传递图片URL（仅在第一次迭代时）
      const imagesForThisIteration = this.currentIteration === 1 ? imageUrls : undefined
      await fetchAiStream(prompt, (content) => {
        // 检查是否已终止
        if (this.stopped) {
          return
        }

        response = content

        // 实时更新，但只在内容有实质性增长时更新（避免频繁更新）
        if (content.length - lastUpdateLength > 10 || content.includes('Action:') || content.includes('Final Answer:')) {
          this.config.onThought?.(content)
          this.emitEvent('thought', { content })
          this.emitEvent('thought.updated', { content })
          lastUpdateLength = content.length
        }
      }, this.abortController?.signal, undefined, undefined, undefined, imagesForThisIteration)
      
      // 检查是否已终止
      if (this.stopped) {
        throw new Error('USER_STOPPED')
      }
      
      // 确保最终内容被更新
      if (response.length !== lastUpdateLength) {
        this.config.onThought?.(response)
        this.emitEvent('thought', { content: response })
        this.emitEvent('thought.updated', { content: response })
      }

      // 第一次迭代后，不再根据文本提及自动选择 Skills。
      // 只有显式调用 select_skill 工具才会生效，避免误命中无关 Skill。
      if (this.currentIteration === 1) {
        this.config.onSkillsSelected?.([])
      }

      return response
    } catch (error) {
      // 检查是否是因为终止导致的错误
      if (this.stopped || (error instanceof Error && error.name === 'AbortError')) {
        throw new Error('USER_STOPPED')
      }
      
      console.error('LLM API call failed:', error)
      this.emitEvent('error', {
        source: 'llm',
        error: error instanceof Error ? error.message : String(error),
      })
      // 如果 API 调用失败，返回错误提示
      return `Thought: 抱歉，AI 服务暂时不可用
Final Answer: 无法完成任务，请稍后重试或检查 AI 配置`
    }
  }

  private parseAction(thought: string): ParseActionResult | null {
    try {
      // 首先检查是否包含 Final Answer - 如果是，返回 null
      // 需要处理换行的情况，如 "Action: Final\nAnswer: ..."
      const normalizedThought = thought.replace(/\s+/g, ' ')
      if (normalizedThought.includes('Final Answer:') ||
          normalizedThought.includes('Final Answer：') ||
          normalizedThought.includes('最终答案') ||
          // 处理 "Action: Final\nAnswer:" 的情况
          /Action:\s*Final\s*Answer/i.test(thought)) {
        return null
      }

      // Try batch action parsing first
      const batchResult = parseBatchActionJson(thought)
      if (batchResult && batchResult.actions.length > 1) {
        // Validate all tools are read-only
        const allReadOnly = batchResult.actions.every(a => READ_ONLY_TOOLS.has(a.tool))
        if (allReadOnly) {
          return { type: 'batch', actions: batchResult.actions }
        }
        // If not all read-only, fall through to single-action parsing (use first action only)
      }

      const structuredAction = parseStructuredActionJson(thought)
      if (structuredAction) {
        return {
          type: 'single',
          tool: structuredAction.tool,
          params: structuredAction.params,
        }
      }

      // 修改正则表达式，支持工具名称中的连字符、下划线等字符
      const actionMatch = thought.match(/Action:\s*([a-zA-Z0-9_-]+)/i)

      if (!actionMatch) {
        return null
      }

      const tool = actionMatch[1]
      let params = {}
      
      // 使用更宽松的正则匹配，获取 Action Input 后的所有内容
      const inputMatch = thought.match(/Action Input:\s*([\s\S]*)/i)
      
      if (inputMatch) {
        let jsonStr = inputMatch[1].trim()
        
        // 移除可能的标记符号（如 <|begin_of_box|> 和 <|end_of_box|>）
        jsonStr = jsonStr.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '').trim()
        
        // 尝试找到完整的 JSON 对象
        let braceCount = 0
        let jsonEnd = -1
        let inString = false
        let escapeNext = false
        
        for (let i = 0; i < jsonStr.length; i++) {
          const char = jsonStr[i]
          
          if (escapeNext) {
            escapeNext = false
            continue
          }
          
          if (char === '\\') {
            escapeNext = true
            continue
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString
            continue
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++
            } else if (char === '}') {
              braceCount--
              if (braceCount === 0) {
                jsonEnd = i + 1
                break
              }
            }
          }
        }
        
        // 如果找到了完整的 JSON，截取它
        if (jsonEnd > 0) {
          jsonStr = jsonStr.substring(0, jsonEnd)
        }
        
        const parsed = parseActionInputJson(jsonStr)
        if (!parsed) {
          // 返回 null 而不是空对象，让调用方知道解析失败
          return null
        }

        params = parsed
      }

      return { type: 'single', tool, params }
    } catch (error) {
      console.error('Failed to parse action:', error)
      return null
    }
  }

  private async act(toolName: string, params: Record<string, any>, thought?: string): Promise<string> {
    const tool = getToolByName(toolName)

    if (!tool) {
      this.emitEvent('error', {
        source: 'tool',
        toolName,
        error: 'Tool not found',
      })
      return `错误：未找到工具 "${toolName}"。请使用可用的工具列表中的工具。`
    }

    params = this.normalizeToolParams(toolName, params)

    this.toolCallCounter++
    const toolCall: ToolCall = {
      id: `${Date.now()}-${this.toolCallCounter}-${Math.random().toString(36).substring(2, 11)}`,
      toolName,
      params,
      status: 'pending',
      timestamp: Date.now(),
    }

    // Check tool result cache for read-only tools
    if (this.toolCache.isCacheable(toolName)) {
      const cached = this.toolCache.get(toolName, params)
      if (cached) {
        toolCall.status = 'success'
        toolCall.result = { success: true, message: cached, data: null }
        this.emitToolCall(toolCall)
        return `[cached] ${cached}`
      }
    }

    if ((tool.category === 'web' || WEB_ACCESS_TOOL_NAMES.has(toolName)) && !this.config.webSearchEnabled) {
      const message = '联网功能未开启。请先点击聊天输入框中的联网按钮，再重新发送需要联网的请求。'
      toolCall.status = 'error'
      toolCall.result = {
        success: false,
        error: 'WEB_ACCESS_DISABLED',
        message,
      }
      this.emitToolCall(toolCall)
      this.emitEvent('error', {
        source: 'tool',
        toolName,
        error: 'WEB_ACCESS_DISABLED',
      })
      return message
    }

    const policyCheck = this.evaluateToolPolicy(toolName, tool, params)
    if (!policyCheck.allowed) {
      const blockedMessage = this.getPolicyAdjustmentMessage(toolName, policyCheck.reason || '已调整工具选择')
      const isBenignAdjustment = Boolean(policyCheck.reason?.includes('完整内容已在上下文中'))
      toolCall.status = isBenignAdjustment ? 'success' : 'error'
      toolCall.result = {
        success: isBenignAdjustment,
        error: isBenignAdjustment ? undefined : `BLOCKED_BY_POLICY: ${policyCheck.reason}`,
        message: blockedMessage,
      }
      if (!isBenignAdjustment) {
        this.emitEvent('error', {
          source: 'policy',
          toolName,
          error: policyCheck.reason || 'Blocked by policy',
        })
      }
      this.emitToolCall(toolCall)
      return blockedMessage
    }

    // 查找哪个 Skill 授权了这个工具
    const authorizingSkills: string[] = []
    if (this.config.activeSkills && this.config.activeSkills.length > 0) {
      for (const skillId of this.config.activeSkills) {
        const skill = skillManager.getSkill(skillId)
        // 移除 enabled 判断，只要 Skill 存在就检查授权
        if (skill && skill.metadata.allowedTools?.includes(toolName)) {
          authorizingSkills.push(skill.metadata.name)
        }
      }
    }

    this.emitToolCall(toolCall)

    // 检查工具是否在当前激活的 Skills 中被授权
    const isAuthorized = this.isToolAuthorized(toolName)
    const requiresConfirmation = policyCheck.requiresConfirmation || (tool.requiresConfirmation && !isAuthorized)

    if (requiresConfirmation && !this.config.requestConfirmation) {
      this.emitEvent('approval', {
        status: 'blocked',
        toolName,
        params,
        reason: 'confirmation callback missing',
      })
      toolCall.status = 'error'
      toolCall.result = {
        success: false,
        error: 'BLOCKED_BY_POLICY: 操作需要确认，但未配置确认回调',
      }
      this.emitToolCall(toolCall)
      return '这个操作需要你的确认，当前先不执行。'
    }

    if (requiresConfirmation && this.config.requestConfirmation) {
      // 准备确认上下文信息（原始内容、修改后内容、文件路径）
      const confirmContext: {
        previewParams?: Record<string, any>
        originalContent?: string
        modifiedContent?: string
        filePath?: string
      } = {}

      if (toolName === 'delete_markdown_file' && typeof params.filePath === 'string') {
        confirmContext.filePath = params.filePath
        confirmContext.previewParams = {
          filePath: params.filePath,
        }
      }

      if (toolName === 'delete_markdown_files_batch' && Array.isArray(params.filePaths)) {
        const filePaths = params.filePaths.filter((value): value is string => typeof value === 'string')
        confirmContext.previewParams = {
          count: filePaths.length,
          filesPreview: filePaths.slice(0, 10),
        }
      }

      if (toolName === 'delete_folder' && typeof params.folderPath === 'string') {
        try {
          const { getAllMarkdownFiles } = await import('@/lib/files')
          const folderPath = params.folderPath.replace(/\/+$/, '')
          const files = (await getAllMarkdownFiles())
            .map((file) => file.relativePath)
            .filter((path) => path === folderPath || path.startsWith(`${folderPath}/`))

          confirmContext.filePath = folderPath
          confirmContext.previewParams = {
            folderPath,
            fileCount: files.length,
            filesPreview: files.slice(0, 10),
          }
        } catch (error) {
          console.error('[Agent] Failed to prepare delete folder preview:', error)
          confirmContext.previewParams = {
            folderPath: params.folderPath,
          }
        }
      }

      if (toolName === 'delete_folders_batch' && Array.isArray(params.folderPaths)) {
        try {
          const { getAllMarkdownFiles } = await import('@/lib/files')
          const folderPaths = params.folderPaths.filter((value): value is string => typeof value === 'string')
          const files = (await getAllMarkdownFiles()).map((file) => file.relativePath)
          const normalizedFolders = folderPaths.map((folderPath) => folderPath.replace(/\/+$/, ''))
          const affectedFiles = files.filter((filePath) =>
            normalizedFolders.some((folderPath) => filePath === folderPath || filePath.startsWith(`${folderPath}/`))
          )

          confirmContext.previewParams = {
            count: normalizedFolders.length,
            fileCount: affectedFiles.length,
            foldersPreview: normalizedFolders.slice(0, 10),
            filesPreview: affectedFiles.slice(0, 10),
          }
        } catch (error) {
          console.error('[Agent] Failed to prepare delete folders batch preview:', error)
          const folderPaths = params.folderPaths.filter((value): value is string => typeof value === 'string')
          confirmContext.previewParams = {
            count: folderPaths.length,
            foldersPreview: folderPaths.slice(0, 10),
          }
        }
      }

      // 对于 modify_current_note 工具，获取原始内容和修改后的内容用于 diff 显示
      if (toolName === 'create_diagram_file') {
        const content = typeof params.content === 'string' ? params.content : ''
        confirmContext.previewParams = {
          kind: params.kind || 'drawio',
          fileName: params.fileName,
          folderPath: params.folderPath,
          contentPreview: content ? truncatePreviewContent(content) : 'Blank diagram template',
          openAfterCreate: params.openAfterCreate !== false,
        }
      }

      if (toolName === 'create_diagram_from_outline') {
        confirmContext.previewParams = {
          title: params.title,
          kind: params.kind || 'mindmap',
          layout: params.layout || 'mindmap',
          fileName: params.fileName,
          folderPath: params.folderPath,
          outline: typeof params.outline === 'string' ? params.outline : '',
        }
      }

      if (toolName === 'update_diagram_file' && typeof params.filePath === 'string' && typeof params.content === 'string') {
        confirmContext.filePath = params.filePath

        try {
          const { getFilePathOptions } = await import('@/lib/workspace')
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const { path, baseDir } = await getFilePathOptions(params.filePath)
          const originalContent = baseDir
            ? await readTextFile(path, { baseDir })
            : await readTextFile(path)
          const changedRegion = extractChangedRegionPreview(originalContent, params.content)

          confirmContext.originalContent = changedRegion.original
          confirmContext.modifiedContent = changedRegion.modified
        } catch (error) {
          console.error('[Agent] Failed to prepare diagram diff context:', error)
          confirmContext.previewParams = {
            filePath: params.filePath,
            contentPreview: truncatePreviewContent(params.content),
            expectedModifiedAt: params.expectedModifiedAt,
          }
        }
      }

      if (toolName === 'modify_current_note') {
        try {
          const { getFilePathOptions } = await import('@/lib/workspace')
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const useArticleStore = (await import('@/stores/article')).default

          const articleStore = useArticleStore.getState()
          const currentFilePath = articleStore.activeFilePath

          if (currentFilePath) {
            confirmContext.filePath = currentFilePath

            // 读取原始内容
            const { path, baseDir } = await getFilePathOptions(currentFilePath)
            let originalContent = ''
            if (baseDir) {
              originalContent = await readTextFile(path, { baseDir })
            } else {
              originalContent = await readTextFile(path)
            }

            // 导入工具函数来计算修改后的内容
            const { searchReplaceContent, insertLinesAtPosition, deleteLinesInRange, replaceLinesInRange } = await import('./react-diff-helpers')

            // 计算修改后的内容（用于 diff 显示）
            let modifiedContent = originalContent

            if (params.searchReplace) {
              const sr = params.searchReplace
              modifiedContent = searchReplaceContent(
                modifiedContent,
                sr.searchPattern || '',
                sr.replacement || '',
                sr.useRegex || false,
                sr.caseSensitive || false,
                sr.replaceAll !== false
              )
            } else if (params.insertLines) {
              const il = params.insertLines
              const newLines = Array.isArray(il.newLines) ? il.newLines : [il.newLines]
              modifiedContent = insertLinesAtPosition(
                modifiedContent,
                il.afterLine || 0,
                newLines
              )
            } else if (params.deleteLines) {
              const dl = params.deleteLines
              modifiedContent = deleteLinesInRange(
                modifiedContent,
                dl.startLine,
                dl.endLine
              )
            } else if (params.lineEdits && Array.isArray(params.lineEdits)) {
              // 处理 lineEdits
              const sortedEdits = [...params.lineEdits].sort((a, b) => b.startLine - a.startLine)
              for (const edit of sortedEdits) {
                modifiedContent = replaceLinesInRange(
                  modifiedContent,
                  edit.startLine,
                  edit.endLine,
                  edit.newLines
                )
              }
            } else if (params.content) {
              modifiedContent = params.content
            }

            const changedRegion = extractChangedRegionPreview(originalContent, modifiedContent)
            confirmContext.originalContent = changedRegion.original
            confirmContext.modifiedContent = changedRegion.modified

          }
        } catch (error) {
          console.error('[Agent] Failed to prepare diff context:', error)
        }
      }

      this.emitEvent('approval', {
        status: 'requested',
        toolName,
        params,
        context: confirmContext,
      })
      const confirmed = await this.config.requestConfirmation(toolName, params, confirmContext)

      if (!confirmed) {
        this.emitEvent('approval', {
          status: 'rejected',
          toolName,
          params,
        })
        toolCall.status = 'error'
        toolCall.result = {
          success: false,
          error: '用户取消了操作',
        }
        this.emitToolCall(toolCall)
        this.stop()
        return '用户取消了操作，任务已停止。'
      }

      this.emitEvent('approval', {
        status: 'confirmed',
        toolName,
        params,
      })
    }

    toolCall.status = 'running'
    this.emitToolCall(toolCall)

    try {
      if (this.stopped) {
        throw new Error('USER_STOPPED')
      }

      // Execute tool with retry for transient errors + timeout protection
      const MAX_RETRIES = 2
      let result!: ToolResult
      let lastError: string | null = null

      const { executeWithTimeout } = await import('./tool-executor')

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

        // Only retry on transient errors (not policy/user errors)
        if (result.success || attempt === MAX_RETRIES) break

        const errMsg = (result.error || '').toLowerCase()
        const isTransient = /timeout|network|fetch|econnrefused|econnreset|enotfound|rate.?limit|429|503|502|500|internal.?server|temporar/i.test(errMsg)
        if (!isTransient) break

        lastError = result.error || 'Unknown error'
        console.warn(`[Agent] Tool ${toolName} attempt ${attempt + 1} failed (transient), retrying...`, lastError)
      }

      if (this.stopped) {
        throw new Error('USER_STOPPED')
      }

      toolCall.status = result.success ? 'success' : 'error'
      toolCall.result = result
      this.emitToolCall(toolCall)

        if (result.success) {
        // 特殊处理 select_skill 工具
        if (toolName === 'select_skill' && result.data?.selected_skills) {
          const selectedSkillIds: string[] = result.data.selected_skills

          // 更新 selectedSkills
          for (const skillId of selectedSkillIds) {
            this.selectedSkills.add(skillId)
          }

          // 通知外部选择的 Skills
          this.config.onSkillsSelected?.(selectedSkillIds)
          this.emitEvent('skills.selected', { skillIds: selectedSkillIds })
        }

        let observation = result.message || `工具 ${toolName} 执行成功。`

        // 如果有数据，根据数据类型进行格式化
          if (result.data) {
          // 特殊处理 MCP 搜索结果（category 为 'mcp' 的工具）
          if (tool.category === 'mcp') {
            // 从思考内容中提取简短标题
            const shortTitle = thought ? this.extractTitleFromThought(thought) : tool.description
            observation = this.formatMcpResult(shortTitle, result.data)
          } else if (Array.isArray(result.data)) {
            if (result.data.length > 0) {
              observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
            }
          } else {
            // 对于对象数据，也格式化显示
            observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
          }
        }

        const previousObservation = this.steps[this.steps.length - 1]?.observation || ''
        if (
          toolName === 'get_editor_content' &&
          previousObservation.includes('replace_editor_content 执行失败') &&
          previousObservation.includes('找不到文本')
        ) {
          const checkboxTargetState = getCheckboxTargetState(this.currentUserInput)
          if (checkboxTargetState === 'unchecked') {
            observation += '\n\n这是一个复选框状态修改请求。用户的目标状态是未完成，也就是 `- [ ]`。如果当前文档里该项仍是 `- [x]`，下一步必须使用 replace_editor_content(startLine/endLine + version) 完成修改，不能直接结束。'
          } else if (checkboxTargetState === 'checked') {
            observation += '\n\n这是一个复选框状态修改请求。用户的目标状态是已完成，也就是 `- [x]`。如果当前文档里该项仍是 `- [ ]`，下一步必须使用 replace_editor_content(startLine/endLine + version) 完成修改，不能直接结束。'
          }
        }

        // Cache the result for read-only tools
        this.toolCache.set(toolName, params, observation)

        // 记录工具使用和文件访问到工作记忆
        import('./working-memory').then(({ recordToolUsage, recordFileAccess }) => {
          recordToolUsage(toolName)
          const filePath = params.filePath || params.path || params.folderPath
          if (typeof filePath === 'string' && filePath.trim()) {
            recordFileAccess(filePath)
          }
        }).catch(() => {})

        return observation
      } else {
        const errorMsg = result.error || '未知错误'

        // 记录失败尝试到工作记忆
        import('./working-memory').then(({ recordFailedAttempt }) => {
          recordFailedAttempt(toolName, params, errorMsg)
        }).catch(() => {})

        if (
          toolName === 'replace_editor_content' &&
          typeof result.error === 'string' &&
          result.error.includes('找不到文本')
        ) {
          return `工具 ${toolName} 执行失败：${errorMsg}

下一步不要直接结束，也不要声称编辑已完成。请先使用 get_editor_content 获取最新的 numberedLines 和 version，再用 startLine/endLine + version 重试当前编辑。`
        }
        return `工具 ${toolName} 执行失败：${errorMsg}`
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'USER_STOPPED') {
        throw error
      }

      toolCall.status = 'error'
      const errorStr = error instanceof Error ? error.message : String(error)
      toolCall.result = {
        success: false,
        error: errorStr,
      }
      this.emitToolCall(toolCall)
      this.emitEvent('error', {
        source: 'tool',
        toolName,
        error: errorStr,
      })
      return `工具 ${toolName} 执行出错：${errorStr}`
    }
  }

  private normalizeToolParams(toolName: string, params: Record<string, any>): Record<string, any> {
    if (toolName === 'create_file') {
      return this.normalizeCreateFileParams(params)
    }

    if (toolName !== 'replace_editor_content') {
      return params
    }

    const currentQuote = this.config.currentQuote
    if (!currentQuote) {
      return params
    }

    if (currentQuote.from < 0 || currentQuote.to < currentQuote.from) {
      return params
    }

    const normalizedParams = { ...params }
    const insertDirective = this.getQuotedInsertDirective()
    const rawContent = typeof normalizedParams.content === 'string'
      ? normalizedParams.content
      : typeof normalizedParams.replaceContent === 'string'
        ? normalizedParams.replaceContent
        : ''

    if (insertDirective && rawContent.trim().length > 0) {
      delete normalizedParams.startLine
      delete normalizedParams.endLine
      delete normalizedParams.searchContent
      delete normalizedParams.occurrence
      delete normalizedParams.replaceContent

      normalizedParams.from = currentQuote.from
      normalizedParams.to = currentQuote.to
      normalizedParams.content = this.buildQuotedInsertContent(
        insertDirective,
        rawContent,
        currentQuote.fullContent
      )

      return normalizedParams
    }

    delete normalizedParams.startLine
    delete normalizedParams.endLine
    delete normalizedParams.searchContent
    delete normalizedParams.occurrence

    normalizedParams.from = currentQuote.from
    normalizedParams.to = currentQuote.to

    if (normalizedParams.replaceContent !== undefined && normalizedParams.content === undefined) {
      normalizedParams.content = normalizedParams.replaceContent
    }

    return normalizedParams
  }

  private normalizeCreateFileParams(params: Record<string, any>): Record<string, any> {
    if (this.selectedSkills.size !== 1) {
      return params
    }

    const rawFileName = typeof params.fileName === 'string' ? params.fileName.trim() : ''
    if (!rawFileName) {
      return params
    }

    const rawFolderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
    const scriptPattern = /\.(?:js|mjs|cjs|ts|py|sh|bash)$/i
    const selectedSkillId = Array.from(this.selectedSkills)[0]
    const runtimeFolder = `skills/${selectedSkillId}/runtime`
    const runtimePrefix = `${runtimeFolder}/`

    const fileNameLooksLikeScript = scriptPattern.test(rawFileName)
    const folderLooksLikeScriptTarget = scriptPattern.test(rawFolderPath)
    if (!fileNameLooksLikeScript && !folderLooksLikeScriptTarget) {
      return params
    }

    const normalizedParams = { ...params }

    if (rawFileName.startsWith(runtimePrefix)) {
      normalizedParams.fileName = rawFileName.slice(runtimePrefix.length)
      normalizedParams.folderPath = runtimeFolder
    } else if (rawFileName.includes('/')) {
      const segments = rawFileName.split('/').filter(Boolean)
      const extractedFileName = segments.pop()
      if (extractedFileName) {
        normalizedParams.fileName = extractedFileName
        normalizedParams.folderPath = segments.join('/')
      }
    }

    const currentFolderPath = typeof normalizedParams.folderPath === 'string'
      ? normalizedParams.folderPath.trim()
      : ''

    if (!currentFolderPath) {
      normalizedParams.folderPath = runtimeFolder
    } else if (currentFolderPath === `skills/${selectedSkillId}`) {
      normalizedParams.folderPath = runtimeFolder
    } else if (currentFolderPath === 'runtime') {
      normalizedParams.folderPath = runtimeFolder
    } else if (currentFolderPath.startsWith('runtime/')) {
      normalizedParams.folderPath = `${runtimeFolder}/${currentFolderPath.slice('runtime/'.length)}`
    }

    return normalizedParams
  }

  private getQuotedInsertDirective(): 'before' | 'after' | 'around' | null {
    if (!/插入|添加|补充|加入|增加/.test(this.currentUserInput)) {
      return null
    }

    const hasBefore = /前面|前边|上面|之前|前方/.test(this.currentUserInput)
    const hasAfter = /后面|后边|下面|之后|后方/.test(this.currentUserInput)

    if (hasBefore && hasAfter) {
      return 'around'
    }

    if (hasBefore) {
      return 'before'
    }

    if (hasAfter) {
      return 'after'
    }

    return null
  }

  private buildQuotedInsertContent(
    directive: 'before' | 'after' | 'around',
    insertedContent: string,
    quoteContent?: string
  ): string {
    const normalizedInserted = insertedContent.trim()
    const normalizedQuote = quoteContent?.trim()

    if (!normalizedQuote) {
      return normalizedInserted
    }

    if (normalizedInserted.includes(normalizedQuote)) {
      return normalizedInserted
    }

    if (directive === 'before') {
      return `${normalizedInserted}\n${normalizedQuote}`
    }

    if (directive === 'around') {
      const structuredAround = normalizedInserted.match(
        /^<<BEFORE>>\s*([\s\S]*?)\s*<<AFTER>>\s*([\s\S]*)$/i
      )

      if (structuredAround) {
        const beforeContent = structuredAround[1].trim()
        const afterContent = structuredAround[2].trim()

        return [
          beforeContent,
          normalizedQuote,
          afterContent,
        ].filter(Boolean).join('\n\n')
      }

      // Fallback: preserve the quoted content and append the generated content once.
      return `${normalizedQuote}\n\n${normalizedInserted}`
    }

    return `${normalizedQuote}\n${normalizedInserted}`
  }

  /**
   * 从思考内容中提取简短标题
   */
  private extractTitleFromThought(thought: string): string {
    // 移除 "Thought:" 前缀
    const content = thought.replace(/^Thought:\s*/i, '').trim()

    // 提取第一句话或前50个字符
    const firstSentence = content.split(/[。！？.!?]/)[0]
    if (firstSentence && firstSentence.length > 0 && firstSentence.length < 100) {
      return firstSentence.trim()
    }

    // 如果第一句话太长或没有句子结束符，截取前50个字符
    if (content.length > 50) {
      return content.substring(0, 50) + '...'
    }

    return content
  }

  /**
   * 格式化 MCP 工具的返回结果
   */
  private formatMcpResult(toolDescription: string, data: any): string {
    // 处理搜索结果
    if (data.results && Array.isArray(data.results)) {
      const results = data.results
      let formatted = `MCP: ${toolDescription}，找到 ${results.length} 条结果：\n\n`

      results.forEach((item: any, index: number) => {
        formatted += `${index + 1}. ${item.title || '无标题'}\n`
        formatted += `   ${item.snippet || item.description || '无描述'}\n`
        formatted += `   UUID: ${item.uuid}\n`
        if (item.url) {
          formatted += `   URL: ${item.url}\n`
        }
        formatted += '\n'
      })

      return formatted
    }

    // 处理网页抓取结果
    if (data.content && typeof data.content === 'string') {
      return `MCP: ${toolDescription}：\n\n${data.content}`
    }

    // 其他情况使用 JSON 格式化
    return `MCP: ${toolDescription}\n\n返回结果：\n${JSON.stringify(data, null, 2)}`
  }

  getSteps(): ReActStep[] {
    return this.steps
  }

  getCurrentIteration(): number {
    return this.currentIteration
  }

  /**
   * 格式化 Skills 指令为系统提示
   * 只发送元数据和简要说明，完整指令由 AI 根据描述理解并执行
   */
  private formatSkillsInstructions(): string {
    const activeSkillIds = this.config.activeSkills
    if (!activeSkillIds || activeSkillIds.length === 0) {
      return ''
    }

    // First iteration: only send brief info (name and description), let AI choose
    if (this.currentIteration === 1) {
      const skillsList: string[] = []
      const skillsDebugInfo: any[] = []

      for (const skillId of activeSkillIds) {
        const skill = skillManager.getSkill(skillId)
        if (!skill) {
          continue
        }

        // Only send brief information
        let skillText = `### ${skill.metadata.name}\n\n`
        skillText += `- Description: ${skill.metadata.description}\n`
        skillText += `- ID: ${skill.metadata.id}\n\n`

        skillsList.push(skillText)
        skillsDebugInfo.push({
          id: skill.metadata.id,
          name: skill.metadata.name,
          description: skill.metadata.description
        })
      }

      if (skillsList.length === 0) {
        return ''
      }

      const result = `## Available Skills

**Optional Step: Use select_skill only when a Skill is clearly relevant**

Please review the available Skills. If one or more Skills are highly relevant to the user task, select them with the select_skill tool. If the user request can be answered directly or no Skill is clearly relevant, do not call select_skill; give a Final Answer or use the normal tool needed for the task.

${skillsList.join('\n---\n\n')}

Correct way to select Skill:
\`\`\`
Thought: User wants to write web fiction, I need to select style-detector Skill to guide writing style.
Action: select_skill
Action Input: {"skill_ids": ["style-detector"]}
\`\`\`

After selecting Skill, you will receive complete Skill instructions in next iteration. Then you can use actual tools (like create_file) to complete the task.

**Important Notes**:
- Carefully read each Skill's description
- Use \`select_skill\` only for high-confidence Skill matches
- If no Skill is clearly relevant, skip Skill selection and continue directly
- Pass Skill ID array in Action Input (e.g.: ["style-detector", "weekly"])
- After selection, wait for next iteration, complete Skill instructions will be provided
- NEVER use Skill name directly as Action`

      return result
    }

    // Subsequent iterations: only send complete content of selected Skills
    if (this.selectedSkills.size === 0) {
      return ''
    }

    const skillsList: string[] = []
    const skillsDebugInfo: any[] = []

    for (const skillId of this.selectedSkills) {
      const skill = skillManager.getSkill(skillId)
      if (!skill) {
        continue
      }

      // Send complete Skill information
      let skillText = `### ${skill.metadata.name}\n\n`

      // YAML metadata section
      skillText += `**Metadata**:\n`
      skillText += `- Description: ${skill.metadata.description}\n`
      skillText += `- Version: ${skill.metadata.version}\n`
      if (skill.metadata.author) {
        skillText += `- Author: ${skill.metadata.author}\n`
      }
      if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
        skillText += `- Authorized Tools: ${skill.metadata.allowedTools.join(', ')}\n`
      }
      skillText += `\n`

      // 添加可用脚本列表
      if (skill.scripts && skill.scripts.length > 0) {
        skillText += `**Available Scripts**:\n`
        for (const script of skill.scripts) {
          skillText += `  - \`${script.name}\` (${script.type})\n`
        }
        skillText += `\n`
      }

      // Complete instructions section (Markdown content)
      skillText += `**Instructions**:\n${skill.instructions}\n\n`

      skillsList.push(skillText)

      // Collect debug info
      skillsDebugInfo.push({
        id: skill.metadata.id,
        name: skill.metadata.name,
        description: skill.metadata.description,
        instructionLength: skill.instructions.length
      })
    }

    if (skillsList.length === 0) {
      return ''
    }

    const result = `## Selected Skills

You selected the following Skills to guide current task:

${skillsList.join('\n---\n\n')}

**📋 How to use these Skills**:

1. **Carefully read complete instructions of above Skills**
2. **Understand Skill requirements, then apply directly to your work**
3. **Don't ask user for confirmation** - Execute tasks directly following Skill guidance
4. **Don't try to read additional files** - Skills already contain all necessary information
5. **Use actual tools to complete tasks** - Like create_file, update_markdown_file, replace_editor_content, etc.

**⚠️ Important Reminders**:
- Strictly follow above Skill requirements to execute tasks
- Don't try to call Skill as a tool
- Don't ask user for style selection - directly apply most relevant style
- If it's style-detector Skill, directly apply corresponding style (like web fiction style) to your content`

    return result
  }

  /**
   * 从思考内容中提取提到的 Skills
   */
  private extractMentionedSkills(thought: string): string[] {
    const mentioned: string[] = []
    if (!this.config.activeSkills || this.config.activeSkills.length === 0) {
      return mentioned
    }

    for (const skillId of this.config.activeSkills) {
      const skill = skillManager.getSkill(skillId)
      if (skill) {
        // 检查是否提到了 Skill 的名称或描述中的关键词
        const skillName = skill.metadata.name.toLowerCase()
        const keywords = [
          skillName,
          ...skill.metadata.name.split(/\s+/),
          ...skill.metadata.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        ]

        const thoughtLower = thought.toLowerCase()
        if (keywords.some(keyword => thoughtLower.includes(keyword))) {
          mentioned.push(skill.metadata.name)
        }
      }
    }

    return mentioned
  }

  /**
   * 从内容中提取 Final Answer（用于流式渲染 Markdown）
   */
  private extractFinalAnswer(content: string): string | null {
    // 检测是否包含 Final Answer
    const normalizedContent = content.replace(/\s+/g, ' ')
    const hasFinalAnswer = normalizedContent.includes('Final Answer:') ||
                           normalizedContent.includes('Final Answer：') ||
                           normalizedContent.includes('最终答案') ||
                           /Action:\s*Final\s*Answer/i.test(content)

    if (!hasFinalAnswer) {
      return null
    }

    // 提取 Final Answer 后面的内容
    let result: string | null = null
    if (content.includes('Final Answer:')) {
      result = content.split('Final Answer:')[1].trim()
    } else if (content.includes('Final Answer：')) {
      result = content.split('Final Answer：')[1].trim()
    } else if (content.includes('最终答案')) {
      result = content.split('最终答案')[1].trim()
    } else if (/Action:\s*Final\s*Answer:\s*([\s\S]*)/i.test(content)) {
      const match = content.match(/Action:\s*Final\s*Answer:\s*([\s\S]*)/i)
      if (match) {
        result = match[1].trim()
      }
    }

    return result
  }

  /**
   * 检查工具是否在当前激活的 Skills 中被授权（移除 enabled 判断）
   */
  isToolAuthorized(toolName: string): boolean {
    if (this.selectedSkills.size === 0) {
      return false
    }

    for (const skillId of this.selectedSkills) {
      const skill = skillManager.getSkill(skillId)
      // 移除 enabled 判断，只要 Skill 存在且授权了工具就返回 true
      if (skill && skill.metadata.allowedTools?.includes(toolName)) {
        return true
      }
    }

    return false
  }

  private evaluateToolPolicy(
    toolName: string,
    tool: { category: string; requiresConfirmation: boolean },
    params: Record<string, any> = {}
  ): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
    const folderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
    const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
    const linkedFiles = getEffectiveLinkedResources().filter(resource => !isLinkedFolder(resource))
    const articleStore = useArticleStore.getState()

    if (toolName === 'check_folder_exists' && /\.md$/i.test(folderPath)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: 'Markdown 文件路径应使用 read_markdown_file，而不是 check_folder_exists',
      }
    }

    if (toolName === 'update_markdown_file' && filePath && articleStore.activeFilePath === filePath) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: '当前打开的文件应使用 replace_editor_content 进行修改，以避免覆盖编辑器中的实时内容',
      }
    }

    if ((toolName === 'read_markdown_file' || toolName === 'read_markdown_files_batch') && articleStore.activeFilePath) {
      const activePath = articleStore.activeFilePath

      if (toolName === 'read_markdown_file' && filePath === activePath) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: '当前打开的文件应使用 get_editor_content 读取，以避免读取到过时的磁盘内容',
        }
      }

      if (toolName === 'read_markdown_files_batch' && Array.isArray(params.filePaths) && params.filePaths.includes(activePath)) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: '批量读取包含当前打开的文件时，应先使用 get_editor_content 获取实时内容，再单独读取其他文件',
        }
      }
    }

    if (linkedFiles.some(resource => shouldKeepFocusOnLinkedNote(this.currentUserInput, resource, toolName))) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: '当前任务应聚焦关联笔记文件内容，不应切换到标签或记录工具',
      }
    }

    if (shouldBlockRepeatedNoteExploration(toolName, params, this.steps)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: '已经获得足够的笔记文件内容，无需重复列出或读取，请直接基于已有内容继续整理并给出最终答案',
      }
    }

    if (this.isRedundantLinkedFileRead(toolName, params)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: '当前关联文件的完整内容已在上下文中，无需再次读取或检查',
      }
    }

    return evaluateIntentAwareToolPolicy({
      toolName,
      category: tool.category,
      intentPolicy: this.intentPolicy,
    })
  }

  private getPolicyAdjustmentMessage(toolName: string, reason: string): string {
    if (reason.includes('Markdown 文件路径')) {
      return `已调整工具选择：Markdown 文件会按笔记文件读取，而不是按文件夹处理。不要再次调用 ${toolName}，请改用 read_markdown_file。`
    }

    if (reason.includes('完整内容已在上下文中')) {
      return '已直接使用关联文件上下文：这篇笔记的完整内容已经在当前对话中，无需再次读取。'
    }

    if (reason.includes('聚焦关联笔记文件内容')) {
      return '已保持任务聚焦：当前应先基于关联笔记文件继续分析或整理，不要切换到标签/记录工具。'
    }

    if (reason.includes('已经获得足够的笔记文件内容')) {
      return '已避免重复探索：你已经拿到足够的笔记内容，请直接基于已读取内容继续整理，并给出 Final Answer。'
    }

    if (reason.includes('replace_editor_content')) {
      return '已切换到编辑器写入路径：当前打开的文件请使用 replace_editor_content，而不是直接覆盖磁盘文件。'
    }

    if (reason.includes('get_editor_content')) {
      return '已切换到编辑器读取路径：当前打开的文件请使用 get_editor_content，而不是读取可能过时的磁盘内容。'
    }

    if (reason.includes('执行命令或脚本')) {
      return '已保持分析模式：不会执行命令或脚本。'
    }

    if (reason.includes('删除或清空')) {
      return '已避免高风险操作：当前不会删除或清空内容。'
    }

    if (reason.includes('默认只读模式') || reason.includes('修改意图')) {
      return '已保持分析优先：先分析内容，需要修改时再确认。'
    }

    return '已调整工具选择，继续采用更合适的处理方式。'
  }

  private isPolicyAdjustmentObservation(observation?: string): boolean {
    if (!observation) {
      return false
    }

    return observation.includes('已调整工具选择：') ||
      observation.includes('已保持任务聚焦：') ||
      observation.includes('已避免重复探索：')
  }

  private isRedundantLinkedFileRead(toolName: string, params: Record<string, any>): boolean {
    const linkedFiles = getEffectiveLinkedResources().filter(resource => !isLinkedFolder(resource))

    if (linkedFiles.length === 0) {
      return false
    }

    return shouldBlockRedundantLinkedFileRead(toolName, params, linkedFiles)
  }

  private isSupportOnlyTool(toolName?: string): boolean {
    if (!toolName) {
      return false
    }

    return toolName === 'select_skill' || toolName === 'load_skill_content'
  }

  private hasSubstantiveSuccessfulAction(): boolean {
    return this.steps.some((step) => {
      const toolName = step.action?.tool
      if (!toolName || this.isSupportOnlyTool(toolName)) {
        return false
      }

      const observation = step.observation || ''
      if (!observation) {
        return false
      }

      return !observation.includes('失败') && !observation.includes('错误') && !observation.includes('阻止')
    })
  }

  private isMutationTool(toolName?: string): boolean {
    if (!toolName || this.isSupportOnlyTool(toolName)) {
      return false
    }

    if (toolName === 'replace_editor_content' || toolName === 'insert_at_cursor') {
      return true
    }

    return /^(create_|update_|delete_|rename_|move_|copy_)/.test(toolName)
  }

  private hasSuccessfulMutationAction(): boolean {
    return this.steps.some((step) => {
      const toolName = step.action?.tool
      if (!this.isMutationTool(toolName)) {
        return false
      }

      const observation = step.observation || ''
      if (!observation) {
        return false
      }

      return !observation.includes('失败') && !observation.includes('错误') && !observation.includes('阻止')
    })
  }

  private validateFinalAnswerReadiness(userInput: string, finalAnswer: string): { ok: boolean; reason?: string } {
    const normalizedInput = userInput.toLowerCase()
    const normalizedAnswer = finalAnswer.toLowerCase()
    const actionLikeRequest = this.intentPolicy.allowWrite || this.intentPolicy.allowExecute || this.intentPolicy.allowDestructive
    const hasOnlySupportSteps = this.steps.length > 0 && this.steps.every((step) => this.isSupportOnlyTool(step.action?.tool))
    const claimsExecution = /已生成|已创建|已保存|已完成|已导出|已验证|成功使用|generated|created|saved|exported|verified|completed/.test(finalAnswer)
    const claimsEditApplied = /已修改|已更新|已改为|已改回|已删除|已移动|已重命名|已复制|现在为|已经是|updated|changed|modified|deleted|moved|renamed|copied/.test(finalAnswer)
    const requestedArtifact = /生成|创建|制作|导出|保存|输出|pptx|pdf|docx|xlsx|文件|演示文稿|generate|create|export|save|file|presentation/.test(normalizedInput)
    const requestedEdit = /修改|编辑|改成|改为|改回|替换|删除|移动|重命名|复制|插入|rewrite|edit|modify|change|replace|delete|move|rename|copy|insert/.test(normalizedInput)

    if (actionLikeRequest && requestedArtifact && claimsExecution && !this.hasSubstantiveSuccessfulAction()) {
      return {
        ok: false,
        reason: hasOnlySupportSteps
          ? '仅完成了 Skill 选择或说明读取，尚未真正执行创建/脚本工具，不能宣称文件已生成。请继续执行实际工具。'
          : '尚未获得真实工具成功结果，不能宣称文件已生成、已保存或已验证。请继续执行实际工具。',
      }
    }

    if (this.selectedSkills.size > 0 && claimsExecution && !this.hasSubstantiveSuccessfulAction()) {
      return {
        ok: false,
        reason: '已选择 Skill，但还没有真正完成执行步骤。请先完成 create_file、execute_skill_script 或其他实际工具调用，再给最终答案。',
      }
    }

    if (normalizedAnswer.includes('验证通过') && !this.hasSubstantiveSuccessfulAction()) {
      return {
        ok: false,
        reason: '还没有真实执行结果可供验证，不能声称“已验证通过”。请先执行实际工具。',
      }
    }

    if (actionLikeRequest && requestedEdit && claimsEditApplied && !this.hasSuccessfulMutationAction()) {
      return {
        ok: false,
        reason: '还没有成功的写入/编辑工具结果，不能声称内容已修改。请继续执行实际编辑工具，再给最终答案。',
      }
    }

    return { ok: true }
  }
}
