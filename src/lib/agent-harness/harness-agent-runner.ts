import type OpenAI from 'openai'
import { createOpenAIClient, getAISettings } from '@/lib/ai/utils'
import { isVisionContentUnsupportedError, prepareMessagesWithImages } from '@/lib/ai/vision-bridge'
import { getModelCapabilityProfile } from '@/lib/ai/model-capabilities'
import { estimateTokens } from '@/lib/ai/token-counter'
import { getAllToolsSync, reloadMcpTools } from '@/lib/agent/tools'
import type { AgentEvent, ReActStep, Tool, ToolCall, ToolResult } from '@/lib/agent/types'
import type { AgentRunControl } from './types'
import { createAgentEventBus, type AgentEventBus } from '@/lib/agent/event-bus'
import { deriveIntentPolicy, READ_ONLY_TOOLS, type IntentPolicy } from '@/lib/agent/tool-policy'
import { buildContextPack } from './context-engine'
import { buildAgentSystemPrompt } from '@/lib/agent/prompt-assembler'
import { buildAgentHistoryContext } from '@/lib/agent/context-compression'
import { filterToolsWithCache } from '@/lib/agent/dynamic-tool-filter'
import { generateTaskPlan, isTaskLikelyComplex, type TaskPlan } from '@/lib/agent/task-planner'
import { getDirectAgentReply } from '@/lib/agent/orchestration'
import { classifyAgentTask, type AgentTaskRouteDecision } from '@/lib/agent/task-router'
import { executeGovernedHarnessTool } from './tool-governance'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { skillManager } from '@/lib/skills'
import { getConcreteToolCompletionBlockReason } from '@/lib/agent/final-answer'
import { withTransientRetry } from '@/lib/agent/transient-retry'
import { isSupportOnlyToolName } from '@/lib/agent/support-tools'
import { createAiStreamContentProcessor } from '@/lib/ai/sanitize'
import { validateFinalAnswer } from '@/lib/agent/final-answer'
import type { LinkedResource } from '@/lib/files'
import { AgentLifecycleController } from './turn-lifecycle'
import { getAiRateLimitUserMessage, isAiRateLimitError } from '@/lib/ai/rate-limit'

export interface HarnessAgentRunnerConfig {
  runId?: string
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
  taskRouteDecision?: AgentTaskRouteDecision
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

const THOUGHT_UPDATE_MIN_INTERVAL_MS = 180
const FINAL_ANSWER_RESERVE_ITERATIONS = 1
const REPEATED_TOOL_CALL_THRESHOLD = 3
const OUTPUT_LENGTH_CONTINUATION_LIMIT = 3
const INVALID_OUTPUT_CONTINUATION_LIMIT = 2
const MAX_DYNAMIC_REACT_ITERATIONS = 42
const DEFAULT_READ_ONLY_BATCH_LIMIT = 3
const MAX_READ_ONLY_BATCH_LIMIT = 6
const BUDGET_EXHAUSTION_TEXT_PATTERN = /工具(?:调用)?(?:次数|预算|上限|迭代|step|steps).{0,24}(?:耗尽|不足|用尽|达到|限制|上限)|(?:达到|超过|耗尽|用尽).{0,24}(?:工具(?:调用)?(?:次数|预算|上限)|迭代上限|最大步数|max(?:imum)? steps?|tool budget|tool calls?)/i

class AiRateLimitRunError extends Error {
  readonly partialContent: string

  constructor(error: unknown, partialContent = '') {
    super(getAiRateLimitUserMessage(error))
    this.name = 'AiRateLimitRunError'
    this.partialContent = partialContent
  }
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
      status: 'skipped',
      error: reason,
      message: reason,
    },
    reason,
  )
}

function getBaseToolNameForRunner(toolName: string) {
  return toolName.includes('__') ? toolName.split('__').pop() || toolName : toolName
}

function getGovernedToolCallStatus(input: {
  result: ToolResult
  policyBlocked: boolean
  cached: boolean
  cancelled: boolean
}): ToolCall['status'] {
  if (input.cancelled) return 'cancelled'
  if (input.cached) return 'cached'
  if (input.policyBlocked) return 'blocked'
  if (!input.result.success) return 'error'
  if (input.result.status === 'adjusted') return 'adjusted'
  return 'success'
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

function isInformationQueryRequest(userInput: string) {
  if (/(?:规划|设计|制定|重新规划|输出|保存|写入|生成|创建|整理成).{0,32}(?:攻略|方案|行程|路线|计划|笔记|文档|文件)/.test(userInput)) {
    return false
  }

  return /查看|查询|获取|检索|搜索|总结|汇总|梳理|分析|解读|列出|最新|热点|新闻|资讯|趋势|信息|内容|数据|资料|事实|来源|指南|find|search|fetch|get|retrieve|summari[sz]e|analy[sz]e|latest|news|trending|information|research|source|guide/i.test(userInput)
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

  const actionLikeRequest = input.intentPolicy.allowWrite || input.intentPolicy.allowDestructive
  const informationQuery = isInformationQueryRequest(input.userInput)
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
  const requestedArtifact = !informationQuery &&
    /生成|创建|制作|导出|保存|输出|写入|规划|设计|制定|攻略|方案|行程|路线|计划|笔记|文档|pptx|pdf|docx|xlsx|文件|演示文稿|generate|create|export|save|write|plan|itinerary|file|note|document|presentation/.test(normalizedInput)
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

function getFinalAnswerRejectionDisplayReason(reason?: string) {
  if (!reason) return '最终答案还不完整，正在继续。'
  if (/内容不能为空|empty/i.test(reason)) {
    return '模型没有返回可展示正文，正在继续请求完整回答。'
  }
  return reason
}

function buildFinalAnswerRecoveryPrompt(reason?: string) {
  if (reason && /内容不能为空|empty/i.test(reason)) {
    return '上一轮没有返回可展示正文。请基于已有工具结果直接给出完整、用户可见的 Markdown 回答；不要输出空 JSON、工具调用日志、Action/Observation 或 Final Answer 标签。'
  }

  return `你的上一条回答还不能作为最终答案：${reason || '最终答案尚未满足任务要求'} 请继续使用必要工具，或在证据充分后直接给出完整、用户可见的 Markdown 回答。`
}

function buildOutputLengthContinuationPrompt() {
  return [
    '上一条回答因为模型输出长度限制被截断。',
    '请从截断处继续同一个任务，不要重启、不要重复已经写过的内容。',
    '如果已经足够回答用户，请直接给出完整收尾；只有确实缺少关键信息时才调用工具。',
  ].join('\n')
}

function compactObservationText(value: string, maxChars = 900) {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, maxChars).trim()}...`
}

function buildObservationDigest(steps: ReActStep[], maxSteps = 8) {
  const usefulSteps = steps
    .filter(step => step.observation?.trim())
    .slice(-maxSteps)

  if (usefulSteps.length === 0) return ''

  return usefulSteps.map((step, index) => {
    const toolLabel = step.action?.tool ? ` (${step.action.tool})` : ''
    return `${index + 1}. ${toolLabel} ${compactObservationText(step.observation || '')}`.trim()
  }).join('\n')
}

function buildMaxIterationFallback(steps: ReActStep[]) {
  const digest = buildObservationDigest(steps, 6)

  if (digest) {
    return [
      '我先基于目前已经确认的信息整理如下：',
      '',
      digest,
      '',
      '仍未确认的部分我会标明为待核实，并给出下一步建议。',
    ].join('\n')
  }

  return '这轮暂时没有拿到足够的可展示信息。可以把任务拆成更小的一步继续，我会从当前上下文接着处理。'
}

function buildRateLimitFallback(input: { userInput: string; steps: ReActStep[]; partialContent?: string; error: unknown }) {
  const partial = sanitizeFinalAnswerContent(input.partialContent || '')
  if (partial) {
    return [
      partial,
      '',
      '> 当前模型触发了速率限制，我已停止继续请求以避免反复限流。上面内容是本轮已经生成出的部分结果；稍后重试可以从这里继续补全。',
    ].join('\n').trim()
  }

  const digest = buildObservationDigest(input.steps, 10)
  const notice = getAiRateLimitUserMessage(input.error)
  if (digest) {
    return [
      '我先基于本轮已经拿到的信息整理如下：',
      '',
      digest,
      '',
      `> ${notice}`,
      '> 由于当前模型限流，未继续发起新的模型请求；稍后重试或切换模型后可以继续补全。',
    ].join('\n')
  }

  return [
    notice,
    '',
    '本轮在模型继续生成前触发限流，暂时没有足够的可展示正文。请稍后重试，或切换到更高 TPM 配额/更小上下文的模型。',
  ].join('\n')
}

function buildForcedFinalAnswerPrompt(userInput: string, steps: ReActStep[], _reason: string) {
  const digest = buildObservationDigest(steps, 10)
  return [
    '现在进入最终回答阶段，不再继续调用工具，直到下一轮用户输入为止。',
    '必须基于已有对话和工具 Observation 直接写给用户的最终 Markdown 回答；不要输出 JSON、Action、Observation、Final Answer 标签或工具调用日志。',
    '如果资料仍不完整，请明确区分“目前已确认”和“仍待核实”，然后给出可执行的下一步建议。',
    '不要提及任何未向用户公开的内部控制信息。',
    '回答必须包含：已确认内容、可执行结论、仍待核实项、下一步建议。',
    `用户原始任务：${userInput}`,
    digest ? `已有工具结果摘要：\n${digest}` : '',
  ].filter(Boolean).join('\n\n')
}

function sanitizeFinalAnswerContent(content: string) {
  const cleanedLines = content
    .split(/\r?\n/)
    .filter(line => !BUDGET_EXHAUSTION_TEXT_PATTERN.test(line))

  const cleaned = cleanedLines.join('\n')
    .replace(/此段因[^。\n]*(?:工具调用次数|工具预算|迭代上限|最大步数)[^。\n]*[。\n]?/g, '')
    .replace(/因[^。\n]*(?:工具调用次数|工具预算|迭代上限|最大步数)[^。\n]*未能[^。\n]*[。\n]?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned || content.trim()
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function buildToolStepSignature(toolName?: string, params?: Record<string, any>) {
  if (!toolName || isSupportOnlyToolName(toolName)) return undefined
  return `tool:${toolName}:${stableStringify(params || {})}`
}

function summarizeToolParamsForSessionLog(params: Record<string, any>): string | undefined {
  try {
    return JSON.stringify(params).slice(0, 500)
  } catch {
    return '[unserializable params]'
  }
}

function countRecentMatchingToolSteps(steps: ReActStep[], signature: string) {
  let count = 0
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    const stepSignature = buildToolStepSignature(step.action?.tool, step.action?.params)
    if (!stepSignature) break
    if (stepSignature !== signature) break
    count += 1
  }
  return count
}

function estimateInformationLookupDensity(userInput: string, taskPlan: TaskPlan | null) {
  let density = 0
  if (isInformationQueryRequest(userInput)) density += 1
  if (taskPlan?.isComplex) density += Math.min(5, taskPlan.steps.length)
  if (/批量|多个|多项|所有|全部|每个|分别|逐[一项条段个]|对比|比较|清单|列表|batch|multiple|all|every|each|compare|list/i.test(userInput)) {
    density += 2
  }
  const delimiterCount = userInput.match(/[、,，;；]/g)?.length || 0
  density += Math.min(3, Math.floor(delimiterCount / 2))
  const numberedCount = userInput.match(/\d+[、.．)]/g)?.length || 0
  density += Math.min(4, numberedCount)
  return density
}

function countUsefulReadOnlySteps(steps: ReActStep[]) {
  return steps.filter(step => (
    step.action?.tool &&
    !isSupportOnlyToolName(step.action.tool) &&
    !isMutationTool(step.action.tool) &&
    isSuccessfulStep(step)
  )).length
}

function resolveReActMaxIterations(userInput: string, configuredMaxIterations: number | undefined, taskPlan: TaskPlan | null) {
  const configured = configuredMaxIterations || 18
  const plannedStepBudget = taskPlan?.isComplex
    ? Math.min(MAX_DYNAMIC_REACT_ITERATIONS, Math.max(configured, taskPlan.steps.length * 3 + 6))
    : configured
  const lookupDensity = estimateInformationLookupDensity(userInput, taskPlan)
  const multiLookupBudget = lookupDensity >= 6
    ? Math.max(plannedStepBudget, 34)
    : lookupDensity >= 3
      ? Math.max(plannedStepBudget, 28)
      : lookupDensity >= 2
        ? Math.max(plannedStepBudget, 22)
        : plannedStepBudget

  return Math.min(MAX_DYNAMIC_REACT_ITERATIONS, Math.max(6, multiLookupBudget))
}

function buildReActBudgetPrompt(input: {
  currentIteration: number
  maxToolIterations: number
  maxIterations: number
}) {
  const remainingToolEnabledCycles = Math.max(0, input.maxToolIterations - input.currentIteration)
  const urgency = remainingToolEnabledCycles <= 0
    ? '这是接近收尾的步骤。除非缺少决定性证据，否则不要再调用工具，直接收束。'
    : remainingToolEnabledCycles <= 2
      ? '可用轮次已经不多。只补关键缺口，避免探索性搜索，准备最终回答。'
      : '优先使用最少工具拿到足够证据，证据足够时立即回答。'

  return [
    '## Execution Cadence',
    `- Current cycle: ${input.currentIteration}/${input.maxToolIterations}. A final no-tool answer pass is reserved before the overall cap (${input.maxIterations}).`,
    `- Tool-capable cycles remaining after this one: ${remainingToolEnabledCycles}.`,
    `- ${urgency}`,
    '- Do not repeat deterministic read/search tools with identical arguments. Use previous observations, change strategy, or answer with current evidence.',
    '- Prefer one high-value tool call. Multiple read-only tool calls are allowed only when they answer distinct missing facts.',
    '- When enough evidence exists, stop calling tools and write the user-visible Markdown answer.',
    '- The final user-visible answer must not mention internal control messages.',
  ].join('\n')
}

function buildQuickAnswerSystemPrompt() {
  return [
    '你是小墨，一个响应很快的本地知识管理助手。',
    '当前请求已被判定为简单问题，请直接回答，不要调用工具，不要输出内部思考、Action、Observation 或 JSON 包装。',
    '回答要短而有用；能一句话讲清就不要展开成长篇。需要步骤时最多给 3-5 条。',
    '如果用户实际需要读取本地文件、联网、写入或执行操作，请用一句话说明需要进入完整 Agent 工具模式，而不是假装已经完成。',
  ].join('\n')
}

function isReadOnlyHarnessTool(tool?: Tool) {
  if (!tool) return false
  const baseName = getBaseToolNameForRunner(tool.name)
  if (READ_ONLY_TOOLS.has(tool.name) || READ_ONLY_TOOLS.has(baseName)) return true
  const capabilities = new Set(tool.capabilities || [])
  if (capabilities.has('write') || capabilities.has('delete') || capabilities.has('execute')) return false
  if (capabilities.has('read')) return true
  if (tool.category === 'search' || tool.category === 'web') return true
  if (tool.category !== 'mcp') return false
  if (tool.risk === 'low' && !tool.requiresConfirmation) return true
  return /^(read|list|search|fetch|get|query|find|lookup|describe|inspect|detail|text_search|search_detail|weather)(_|$)/i.test(baseName)
}

function resolveReadOnlyBatchLimit(input: {
  requestedToolCallCount: number
  remainingToolIterations: number
  completedReadOnlySteps: number
  allRequestedToolsReadOnly: boolean
  taskPlan: TaskPlan | null
}) {
  if (!input.allRequestedToolsReadOnly || input.requestedToolCallCount <= 1) return 1

  const requestedCap = Math.min(input.requestedToolCallCount, MAX_READ_ONLY_BATCH_LIMIT)
  const remaining = Math.max(1, input.remainingToolIterations)
  let limit = DEFAULT_READ_ONLY_BATCH_LIMIT

  if (input.requestedToolCallCount > DEFAULT_READ_ONLY_BATCH_LIMIT) {
    limit = Math.min(requestedCap, 4)
  }
  if (input.requestedToolCallCount >= 5 || remaining <= 2) {
    limit = requestedCap
  }
  if (input.taskPlan?.isComplex && input.taskPlan.steps.length >= 3) {
    limit = Math.max(limit, Math.min(requestedCap, 4))
  }
  if (input.completedReadOnlySteps >= 12 && remaining > 2) {
    limit = Math.min(limit, DEFAULT_READ_ONLY_BATCH_LIMIT)
  }

  return Math.max(1, Math.min(requestedCap, limit))
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
  private visibleToolsByName = new Map<string, Tool>()
  private outputLengthContinuations = 0
  private invalidOutputContinuations = 0
  private lifecycle: AgentLifecycleController

  constructor(private config: HarnessAgentRunnerConfig) {
    this.eventBus = createAgentEventBus({ runId: config.runControl?.runId || config.runId || createRunId() })
    this.lifecycle = new AgentLifecycleController(this.eventBus.getRunId())
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

  getLifecycleSnapshot() {
    return this.lifecycle.getSnapshot()
  }

  private flushLifecycleSessionLog() {
    this.config.runControl?.setSessionLog?.(this.lifecycle.getSessionLog())
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

  private setVisibleTools(tools: Tool[]) {
    this.visibleToolsByName = new Map(tools.map(tool => [tool.name, tool]))
  }

  private getVisibleToolByName(name: string): Tool | undefined {
    return this.visibleToolsByName.get(name)
      || [...this.visibleToolsByName.entries()].find(([toolName]) => toolName.split('__').pop() === name)?.[1]
  }

  private async streamModel(input: {
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
    tools: Tool[]
    imageUrls?: string[]
    maxTokens?: number
    streamAnswerDelta?: boolean
  }): Promise<{ content: string; toolCalls: ModelToolCall[]; finishReason?: string | null }> {
    const aiConfig = await getAISettings()
    const openai = await createOpenAIClient(aiConfig)
    const capabilities = getModelCapabilityProfile(aiConfig)
    const textMessages = input.messages
    let messages = await prepareMessagesWithImages(textMessages, aiConfig, input.imageUrls, this.abortController?.signal)
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
    if (input.tools.length === 0) {
      delete requestParams.tools
      delete requestParams.tool_choice
    }

    const modelStartedAt = Date.now()
    this.emitEvent('model.request.started', {
      mode: 'harness-tools',
      messageCount: messages.length,
      toolCount: input.tools.length,
      inputTokens: estimateTokens(JSON.stringify(messages)),
      startedAt: modelStartedAt,
    })

    const createStream = () => withTransientRetry(
      () => openai.chat.completions.create(requestParams, {
        signal: this.abortController?.signal,
      }) as unknown as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>,
      {
        signal: this.abortController?.signal,
        onRetry: ({ attempt, delayMs, reason }) => {
          console.warn(`[Agent Runner] Retrying LLM request (attempt ${attempt}) after ${delayMs}ms: ${reason}`)
          this.emitEvent('model.request.started', {
            mode: 'harness-tools',
            retry: { attempt, delayMs, reason },
            messageCount: messages.length,
          })
        },
      },
    )

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      stream = await createStream()
    } catch (error) {
      if (isAiRateLimitError(error)) {
        throw new AiRateLimitRunError(error)
      }
      if (!input.imageUrls?.length || !isVisionContentUnsupportedError(error)) {
        throw error
      }

      messages = await prepareMessagesWithImages(textMessages, aiConfig, input.imageUrls, this.abortController?.signal, {
        forceBridge: true,
      })
      requestParams.messages = messages
      stream = await createStream()
    }

    let content = ''
    let thinking = ''
    let lastThoughtEmitAt = 0
    let lastThoughtContent = ''
    let finishReason: string | null | undefined
    const toolCalls: ModelToolCall[] = []
    const streamProcessor = createAiStreamContentProcessor()
    const emitThoughtUpdate = (force = false) => {
      if (!thinking || thinking === lastThoughtContent) return
      const now = Date.now()
      if (!force && now - lastThoughtEmitAt < THOUGHT_UPDATE_MIN_INTERVAL_MS) return
      lastThoughtEmitAt = now
      lastThoughtContent = thinking
      this.config.onThought?.(thinking)
      this.emitEvent('thought.updated', { content: thinking, streaming: !force, throttled: !force })
    }

    try {
      for await (const chunk of stream) {
        if (this.stopped) throw new Error('USER_STOPPED')
        const choice = chunk.choices[0]
        const delta = choice?.delta
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const thinkingContent = (delta as any)?.reasoning_content || ''
        if (thinkingContent) {
          thinking += thinkingContent
          emitThoughtUpdate()
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
            emitThoughtUpdate()
          }
          if (processed.content) {
            content += processed.content
            if (input.streamAnswerDelta) {
              this.config.onAnswerDelta?.(content)
            }
          }
        }
      }
    } catch (error) {
      if (isAiRateLimitError(error)) {
        const remaining = streamProcessor.flush()
        const partialContent = sanitizeFinalAnswerContent(`${content}${remaining.content || ''}`)
        if (remaining.thinking) {
          thinking += remaining.thinking
          emitThoughtUpdate(true)
        }
        if (partialContent && input.streamAnswerDelta) {
          this.config.onAnswerDelta?.(partialContent)
        }
        this.emitEvent('model.response.received', {
          contentLength: partialContent.length,
          outputTokens: estimateTokens(partialContent),
          finishReason: 'rate_limit',
          truncated: false,
          toolCallCount: toolCalls.length,
          durationMs: Date.now() - modelStartedAt,
          error: getAiRateLimitUserMessage(error),
        })
        throw new AiRateLimitRunError(error, partialContent)
      }
      throw error
    }

    const remaining = streamProcessor.flush()
    if (remaining.thinking) {
      thinking += remaining.thinking
    }
    emitThoughtUpdate(true)
    if (remaining.content) {
      content += remaining.content
      if (input.streamAnswerDelta) {
        this.config.onAnswerDelta?.(content)
      }
    }

    this.emitEvent('model.response.received', {
      contentLength: content.length,
      outputTokens: estimateTokens(content),
      finishReason,
      truncated: isLengthTruncated(finishReason),
      toolCallCount: toolCalls.length,
      durationMs: Date.now() - modelStartedAt,
    })

    return { content, toolCalls: normalizeToolCalls(toolCalls), finishReason }
  }

  private async runQuickAnswer(input: {
    userInput: string
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[]
    imageUrls?: string[]
    routeDecision: AgentTaskRouteDecision
  }) {
    this.currentIteration = 1
    this.emitEvent('iteration.started', {
      route: input.routeDecision.route,
      complexity: input.routeDecision.complexity,
      reason: input.routeDecision.reason,
    })

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildQuickAnswerSystemPrompt() },
      { role: 'user', content: input.userInput },
    ]

    const response = await this.streamModel({
      messages,
      tools: [],
      imageUrls: input.imageUrls,
      streamAnswerDelta: true,
      maxTokens: 900,
    })
    const finalAnswer = sanitizeFinalAnswerContent(response.content.trim()) || '我暂时没有生成可展示的正文，请再试一次。'

    this.config.onFinalAnswerRender?.(finalAnswer)
    this.emitEvent('final', { content: finalAnswer })
    this.emitEvent('final.answer.rendered', { content: finalAnswer })
    this.emitEvent('agent.completed', {
      result: finalAnswer,
      route: input.routeDecision.route,
      complexity: input.routeDecision.complexity,
    })
    this.lifecycle.finish({ status: 'completed', finalAnswer })
    this.flushLifecycleSessionLog()
    return finalAnswer
  }

  private async executeModelToolCall(input: {
    toolCall: ModelToolCall
    userInput: string
    intentPolicy: IntentPolicy
  }): Promise<OpenAI.Chat.ChatCompletionMessageParam> {
    const { toolCall, userInput, intentPolicy } = input
    const tool = this.getVisibleToolByName(toolCall.name)
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
    const toolStartedAt = Date.now()
    this.emitEvent('tool.execution.started', {
      toolName: tool.name,
      params,
      toolCallId: uiToolCall.id,
      startedAt: toolStartedAt,
      toolCall: {
        ...uiToolCall,
        params: { ...uiToolCall.params },
      },
    })
    this.lifecycle.enqueueEntry({
      type: 'tool_call_started',
      iteration: this.currentIteration,
      toolName: tool.name,
      toolCallId: uiToolCall.id,
      paramsSummary: summarizeToolParamsForSessionLog(params),
    })

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
    uiToolCall.status = getGovernedToolCallStatus({
      result,
      policyBlocked: governed.policyBlocked,
      cached: governed.cached,
      cancelled: governed.cancelled,
    })
    uiToolCall.result = {
      ...result,
      status: uiToolCall.status,
      data: {
        ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result.data !== undefined ? { value: result.data } : {}),
        dataRef: governed.execution.observation.dataRef,
        artifacts: governed.execution.observation.artifacts,
        retryable: governed.execution.observation.retryable,
        errorKind: governed.execution.observation.errorKind,
        cached: governed.cached,
        warnings: Array.isArray(result.data?.warnings) ? result.data.warnings : undefined,
        outputEncoding: typeof result.data?.outputEncoding === 'string' ? result.data.outputEncoding : undefined,
      },
    }
    this.emitToolCall(uiToolCall)
    this.emitEvent('tool.execution.finished', {
      toolName: tool.name,
      params: governed.params,
      toolCallId: uiToolCall.id,
      success: result.success,
      status: uiToolCall.status,
      message: result.message,
      error: result.error,
      dataRef: governed.execution.observation.dataRef,
      retryable: governed.execution.observation.retryable,
      errorKind: governed.execution.observation.errorKind,
      cached: governed.cached,
      durationMs: Date.now() - toolStartedAt,
      toolCall: {
        ...uiToolCall,
        params: { ...uiToolCall.params },
        result: uiToolCall.result ? { ...uiToolCall.result } : undefined,
      },
    })
    this.lifecycle.enqueueEntry({
      type: 'tool_result',
      iteration: this.currentIteration,
      toolName: tool.name,
      toolCallId: uiToolCall.id,
      success: result.success,
      status: uiToolCall.status,
      summary: result.message || result.error || governed.execution.observation.summary || '',
      dataRef: governed.execution.observation.dataRef,
      retryable: governed.execution.observation.retryable,
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

  private async synthesizeFinalAnswer(input: {
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
    userInput: string
    intentPolicy: IntentPolicy
    reason: string
  }): Promise<string> {
    const finalMessages = [
      ...input.messages,
      {
        role: 'user' as const,
        content: buildForcedFinalAnswerPrompt(input.userInput, this.steps, input.reason),
      },
    ]

    this.emitEvent('final.answer.rejected', {
      reason: '工具循环已到收尾阶段，正在基于现有结果生成最终回答。',
      internalReason: input.reason,
    })
    const response = await this.streamModel({
      messages: finalMessages,
      tools: [],
      streamAnswerDelta: true,
      maxTokens: 2400,
    })
    const candidate = sanitizeFinalAnswerContent(response.content)
    const validation = validateHarnessFinalAnswer({
      userInput: input.userInput,
      finalAnswer: candidate,
      steps: this.steps,
      intentPolicy: input.intentPolicy,
      selectedSkillIds: this.selectedSkillIds,
    })

    if (validation.ok && candidate) {
      return candidate
    }

    if (candidate) {
      this.emitEvent('final.answer.rejected', {
        reason: getFinalAnswerRejectionDisplayReason(validation.reason),
        internalReason: validation.reason,
      })
    }

    return sanitizeFinalAnswerContent(buildMaxIterationFallback(this.steps))
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
    this.outputLengthContinuations = 0
    this.invalidOutputContinuations = 0
    this.selectedSkillIds = new Set((this.config.forcedSkillIds || []).filter(Boolean))
    const forcedSkillIds = Array.from(this.selectedSkillIds)
    const intentPolicy = deriveIntentPolicy(userInput)
    const routeDecision = this.config.taskRouteDecision || classifyAgentTask({
      userInput,
      imageCount: imageUrls?.length || 0,
      forcedSkillIds,
      webSearchEnabled: this.config.webSearchEnabled,
      hasLinkedContext: Boolean(this.config.linkedResources?.length),
      hasQuote: Boolean(this.config.currentQuote),
    })

    this.emitEvent('agent.started', { userInput, intentPolicy, forcedSkillIds, taskRoute: routeDecision })
    this.lifecycle = new AgentLifecycleController(this.eventBus.getRunId())
    this.lifecycle.startRun({
      route: this.config.runControl?.route || 'agent',
      userGoal: userInput,
    })
    if (forcedSkillIds.length > 0) this.emitEvent('skills.selected', { skillIds: forcedSkillIds, explicit: true })

    const directReply = forcedSkillIds.length === 0 ? getDirectAgentReply(userInput, imageUrls) : null
    if (directReply) {
      this.config.onFinalAnswerRender?.(directReply)
      this.emitEvent('final', { content: directReply })
      this.emitEvent('final.answer.rendered', { content: directReply })
      this.emitEvent('agent.completed', { result: directReply })
      this.lifecycle.finish({ status: 'completed', finalAnswer: directReply })
      this.flushLifecycleSessionLog()
      return directReply
    }

    if (routeDecision.route === 'quick_answer') {
      return this.runQuickAnswer({ userInput, contextOrMessages, imageUrls, routeDecision })
    }

    try {
      try {
        const { ensureMcpReadyForAgent } = await import('@/lib/mcp/agent-ready')
        await ensureMcpReadyForAgent()
      } catch {
        await reloadMcpTools().catch(() => {})
      }

      try {
        const { ensureSkillsReadyForAgent } = await import('@/lib/skills/agent-ready')
        await ensureSkillsReadyForAgent()
      } catch (error) {
        console.warn('[AgentHarness] Failed to prepare Skills runtime:', error)
      }

      if (routeDecision.allowPlanning && isTaskLikelyComplex(userInput)) {
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
      const pack = this.config.runControl
        ? await this.config.runControl.setContextPack({
          tokenBudget: 70000,
          items: contextItems,
        })
        : buildContextPack({
          runId: this.eventBus.getRunId(),
          tokenBudget: 70000,
          items: contextItems,
        })
      const contextPackRef = this.config.runControl?.getSnapshot().contextPackRef

      const maxIterations = resolveReActMaxIterations(
        userInput,
        this.config.maxIterations || routeDecision.maxIterations,
        this.taskPlan,
      )
      const maxToolIterations = Math.max(1, maxIterations - FINAL_ANSWER_RESERVE_ITERATIONS)
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
        this.setVisibleTools(availableTools)
        this.lifecycle.createTurn({
          runId: this.eventBus.getRunId(),
          iteration: this.currentIteration,
          route: this.config.runControl?.route || 'agent',
          userGoal: userInput,
          systemPrompt,
          tools: availableTools,
          contextPack: pack,
          contextPackRef,
          runtimeSnapshot: this.config.runControl?.getMiddlewareState().runtime?.snapshot,
        })
      if (preparedStep.promptSections.length > 0) {
        const promptWithMiddleware = [
          systemPrompt,
          ...preparedStep.promptSections,
          buildReActBudgetPrompt({ currentIteration: this.currentIteration, maxToolIterations, maxIterations }),
        ].join('\n\n')
        messages[0] = { role: 'system', content: promptWithMiddleware }
      } else {
        messages[0] = {
          role: 'system',
          content: [
            systemPrompt,
            buildReActBudgetPrompt({ currentIteration: this.currentIteration, maxToolIterations, maxIterations }),
          ].join('\n\n'),
        }
      }
      const response = await this.streamModel({
        messages,
        tools: availableTools,
        imageUrls: this.currentIteration === 1 ? imageUrls : undefined,
        streamAnswerDelta: true,
      })
      this.lifecycle.savePoint({
        finishReason: response.finishReason,
        toolCallCount: response.toolCalls.length,
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
        if (validation.ok) {
          finalAnswer = candidate || '任务执行完成。'
          break
        }

        if (
          isLengthTruncated(response.finishReason) &&
          this.currentIteration < maxToolIterations &&
          this.outputLengthContinuations < OUTPUT_LENGTH_CONTINUATION_LIMIT
        ) {
          this.outputLengthContinuations += 1
          this.emitEvent('final.answer.rejected', {
            reason: '模型输出被长度限制截断，正在续写。',
            internalReason: response.finishReason || 'length',
            continuationAttempt: this.outputLengthContinuations,
          })
          messages.push({ role: 'assistant', content: candidate })
          messages.push({
            role: 'user',
            content: buildOutputLengthContinuationPrompt(),
          })
          continue
        }

        if (
          (!candidate || /内容不能为空|empty|Final Answer 内容不能为空/i.test(validation.reason || '')) &&
          this.currentIteration < maxToolIterations &&
          this.invalidOutputContinuations < INVALID_OUTPUT_CONTINUATION_LIMIT
        ) {
          this.invalidOutputContinuations += 1
          const displayReason = getFinalAnswerRejectionDisplayReason(validation.reason)
          this.emitEvent('final.answer.rejected', {
            reason: displayReason,
            internalReason: validation.reason,
            continuationAttempt: this.invalidOutputContinuations,
          })
          this.emitObservation(validation.reason || '上一轮没有可展示正文，正在请求模型直接收尾。', { internal: true, visibility: 'hidden' })
          messages.push({ role: 'assistant', content: candidate })
          messages.push({
            role: 'user',
            content: buildFinalAnswerRecoveryPrompt(validation.reason),
          })
          continue
        }

        if (this.currentIteration >= maxToolIterations) {
          finalAnswer = await this.synthesizeFinalAnswer({
            messages,
            userInput,
            intentPolicy,
            reason: validation.reason || 'final answer validation failed at iteration limit',
          })
          break
        }

        const displayReason = getFinalAnswerRejectionDisplayReason(validation.reason)
        this.emitEvent('final.answer.rejected', { reason: displayReason, internalReason: validation.reason })
        this.emitObservation(validation.reason || '最终答案尚未满足任务要求，请继续执行必要工具。', { internal: true, visibility: 'hidden' })
        messages.push({ role: 'assistant', content: candidate })
        messages.push({
          role: 'user',
          content: buildFinalAnswerRecoveryPrompt(validation.reason),
        })
        continue
      }

      if (this.currentIteration >= maxToolIterations) {
        finalAnswer = await this.synthesizeFinalAnswer({
          messages,
          userInput,
          intentPolicy,
          reason: `model requested ${response.toolCalls.length} additional action(s) during the finalization cycle`,
        })
        break
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
        response.toolCalls.every(call => isReadOnlyHarnessTool(this.getVisibleToolByName(call.name)))
      const remainingToolIterations = Math.max(0, maxToolIterations - this.currentIteration)
      const readOnlyBatchLimit = resolveReadOnlyBatchLimit({
        requestedToolCallCount: response.toolCalls.length,
        remainingToolIterations,
        completedReadOnlySteps: countUsefulReadOnlySteps(this.steps),
        allRequestedToolsReadOnly: readOnlyBatch,
        taskPlan: this.taskPlan,
      })
      const callsToRun = readOnlyBatch ? response.toolCalls.slice(0, readOnlyBatchLimit) : response.toolCalls.slice(0, 1)
      const callsToSkip = response.toolCalls.slice(callsToRun.length)
      for (const toolCall of callsToRun) {
        const params = parseToolArguments(toolCall)
        const signature = buildToolStepSignature(toolCall.name, params)
        const tool = this.getVisibleToolByName(toolCall.name)
        const repeatedTool = tool
          && isReadOnlyHarnessTool(tool)
          && signature
          && countRecentMatchingToolSteps(this.steps, signature) >= REPEATED_TOOL_CALL_THRESHOLD - 1
        if (repeatedTool) {
          const reason = [
            'Skipped repeated tool call because the same tool and arguments have already been used repeatedly without progress.',
            'Change strategy, use a different query/tool, or answer from the existing observations.',
          ].join(' ')
          messages.push(buildSkippedToolResultMessage(toolCall, reason))
          this.emitEvent('tool.execution.finished', {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            success: false,
            status: 'skipped',
            message: reason,
            error: 'REPEATED_TOOL_CALL',
            retryable: true,
            toolCall: {
              id: toolCall.id,
              toolName: toolCall.name,
              params,
              status: 'skipped',
              timestamp: Date.now(),
              result: {
                success: false,
                status: 'skipped',
                error: 'REPEATED_TOOL_CALL',
                message: reason,
                data: { retryable: true },
              },
            },
          })
          this.lifecycle.enqueueEntry({
            type: 'tool_result',
            iteration: this.currentIteration,
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            success: false,
            status: 'skipped',
            summary: reason,
            retryable: true,
          })
          this.completeStep({ thought: `Skipped repeated tool call: ${toolCall.name}`, action: { tool: toolCall.name, params }, observation: reason })
          continue
        }
        this.lifecycle.enterToolPhase()
        messages.push(await this.executeModelToolCall({ toolCall, userInput, intentPolicy }))
        if (this.stopped) throw new Error('USER_STOPPED')
      }
      for (const toolCall of callsToSkip) {
        const reason = readOnlyBatch
          ? 'Deferred extra read-only lookup for the next continuation cycle. Use completed observations first; request the remaining distinct lookup only if it is still necessary.'
          : 'Skipped extra tool call because write, execute, delete, and uncertain operations must be handled one at a time. Please wait for the completed observation before requesting another tool.'
        messages.push(buildSkippedToolResultMessage(toolCall, reason))
        this.emitEvent('tool.execution.finished', {
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          success: false,
          status: 'skipped',
          message: reason,
          error: 'SKIPPED_TOOL_CALL',
          retryable: true,
          toolCall: {
            id: toolCall.id,
            toolName: toolCall.name,
            params: parseToolArguments(toolCall),
            status: 'skipped',
            timestamp: Date.now(),
            result: {
              success: false,
              status: 'skipped',
              error: 'SKIPPED_TOOL_CALL',
              message: reason,
              data: { retryable: true },
            },
          },
        })
        this.lifecycle.enqueueEntry({
          type: 'tool_result',
          iteration: this.currentIteration,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          success: false,
          status: 'skipped',
          summary: reason,
          retryable: true,
        })
      }
      this.lifecycle.savePoint()
    }

    if (!finalAnswer) {
      finalAnswer = await this.synthesizeFinalAnswer({
        messages,
        userInput,
        intentPolicy,
        reason: 'tool loop ended without an accepted final answer',
      })
    }

    this.config.onFinalAnswerRender?.(finalAnswer)
    this.emitEvent('final', { content: finalAnswer })
    this.emitEvent('final.answer.rendered', { content: finalAnswer })
    this.emitEvent('agent.completed', { result: finalAnswer })
    this.lifecycle.finish({ status: 'completed', finalAnswer })
    this.flushLifecycleSessionLog()
    return finalAnswer
  } catch (error) {
    if (error instanceof AiRateLimitRunError) {
      const finalAnswer = buildRateLimitFallback({
        userInput,
        steps: this.steps,
        partialContent: error.partialContent,
        error,
      })
      this.config.onFinalAnswerRender?.(finalAnswer)
      this.emitEvent('final', { content: finalAnswer })
      this.emitEvent('final.answer.rendered', { content: finalAnswer })
      this.emitEvent('agent.completed', { result: finalAnswer, rateLimited: true })
      this.lifecycle.finish({ status: 'completed', finalAnswer })
      this.flushLifecycleSessionLog()
      return finalAnswer
    }
    const message = error instanceof Error ? error.message : String(error)
    if (!['settled', 'failed'].includes(this.lifecycle.getPhase())) {
      this.lifecycle.finish({
        status: message === 'USER_STOPPED' ? 'paused' : 'failed',
        error: message,
      })
    }
    this.flushLifecycleSessionLog()
    throw error
  }
}
}
