"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { fetchAiStream, type AiStreamFinishMetadata } from "@/lib/ai/chat"
import { decideAutoWebSearch, type AutoWebSearchDecision } from "@/lib/ai/auto-web-search"
import { decideDocumentGrounding } from "@/lib/ai/document-grounding"
import { type LinkedResource } from "@/lib/files"
import { getWorkspacePath, getFilePathOptions } from "@/lib/workspace"
import {
  AgentHandler,
  createAgentEventBus,
  getToolByName,
  getSessionApprovalScope,
  matchesSessionApproval,
  findMatchingPersistentAgentApproval,
  getPersistentApprovalOptions,
  recordPersistentApprovalHistory,
} from "@/lib/agent"
import { formatFriendlyError } from "@/lib/agent/friendly-errors"
import { AgentOrchestrator } from "@/lib/agent-harness/orchestrator"
import type { ContextItem } from "@/lib/agent-harness/types"
import { classifyAgentTask, shouldBypassAgentRuntime } from "@/lib/agent/task-router"
import { buildWriterSkillInstruction } from "@/lib/agent/writer-executor"
import { skillManager } from "@/lib/skills"
import { estimateTokens } from "@/lib/ai/token-counter"
import { ImageAttachment } from "./image-attachments"
import { cleanAssistantGeneratedContent } from "@/lib/ai/assistant-content"
import {
  completeResearchClarification,
  generateResearchClarification,
  runDeepResearch,
  type DeepResearchProgress,
  type ResearchLocalContext,
  type ResearchLocalSourceInput,
} from "@/lib/research/deep-research"
import {
  listUnfinishedResearchSessions,
  encodeResearchResumeData,
  type DeepResearchSessionSummary,
  type ResearchResumeMeta,
} from "@/lib/research/session-store"
import {
  buildResearchProgressView,
  encodeResearchProgressView,
  type ResearchProgressView,
} from "@/lib/research/progress-status"
import {
  buildUniqueResearchReportTarget,
} from "@/lib/research/report-file"
import type { Chat } from "@/db/chats"
import { toast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import {
  buildChatContext,
  type QuoteData,
  type ChatCitationSource,
} from "@/lib/ai/context-builder"
import { buildMessagesWithHistory } from "@/lib/ai/history-messages"
import {
  analyzeConversationContinuity,
  buildConversationContinuityPrompt,
} from "@/lib/ai/conversation-continuity"

interface ChatSendProps {
  inputValue: string;
  onSent?: (sentText?: string) => void;
  linkedResource?: LinkedResource | null;
  linkedResources?: LinkedResource[];
  linkedResourcePreviews?: Record<string, string | null>;
  attachedImages?: ImageAttachment[];
  quoteData?: QuoteData | null;
  webSearchEnabled?: boolean;
  allowAutoCurrentFileContext?: boolean;
  getLiveInputValue?: () => string;
  onSubmitOverride?: (text: string) => boolean | void;
  canSubmitOverride?: boolean;
  hideButton?: boolean;
  hideIdleButton?: boolean;
}

export interface ChatSendOptions {
  maxTokens?: number
  temperature?: number
  forcedSkillIds?: string[]
  displayText?: string
  modeOverride?: 'chat' | 'agent' | 'research'
  routeOverride?: 'writer' | 'advisor' | 'agent' | 'workflow' | 'chat' | 'research'
  researchDepthPreset?: 'auto' | 'quick' | 'deep'
  researchBreadth?: number
  researchDepth?: number
}

const MIN_AUTO_EXTRACT_CHAR_COUNT = 500
const AGENT_CONTEXT_TOTAL_LIMIT = 70000
const CHAT_DEFAULT_HISTORY_TURNS = 8
const CHAT_FOLLOW_UP_HISTORY_TURNS = 12
const CHAT_DEFAULT_HISTORY_TOKEN_BUDGET = 6000
const CHAT_FOLLOW_UP_HISTORY_TOKEN_BUDGET = 9000
const CHAT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS = 1800
const AGENT_DEFAULT_HISTORY_TURNS = 6
const AGENT_FOLLOW_UP_HISTORY_TURNS = 10
const AGENT_DEFAULT_HISTORY_TOKEN_BUDGET = 8000
const AGENT_FOLLOW_UP_HISTORY_TOKEN_BUDGET = 14000
const AGENT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS = 5000
const AGENT_LIVE_ANSWER_UPDATE_INTERVAL_MS = 120
const CHAT_LIVE_MESSAGE_UPDATE_INTERVAL_MS = 120
const AI_DOC_COMMAND_PREFIX = '你正在执行一个应用内命令：'
const KNOWLEDGE_CAPTURE_INTENT_PATTERN = /总结|教程|方案|沉淀|笔记|整理|归纳|提炼|复盘|要点|大纲|知识库|保存|存成|存为|save|note|notes|summary|summarize|tutorial|guide|plan|organize|capture|extract|outline/i

function buildHarnessContextItems(input: {
  userInput: string
  context: string
  ragSourceDetails: ChatCitationSource[]
  forcedSkillIds?: string[]
}): ContextItem[] {
  const items: ContextItem[] = [{
    id: 'user-goal',
    source: 'user',
    priority: 100,
    content: input.userInput,
    tokenEstimate: estimateTokens(input.userInput),
  }]

  if (input.context.trim()) {
    items.push({
      id: 'assembled-chat-context',
      source: 'history',
      priority: 70,
      content: input.context,
      tokenEstimate: estimateTokens(input.context),
    })
  }

  input.ragSourceDetails.slice(0, 20).forEach((source, index) => {
    const content = source.content || ''
    if (!content.trim()) return
    items.push({
      id: `source-${index + 1}`,
      source: source.sourceType === 'quote'
        ? 'quote'
        : source.sourceType === 'current' || source.sourceType === 'linked'
          ? 'file'
          : 'history',
      priority: source.sourceType === 'quote' ? 95 : 80 - index,
      content,
      tokenEstimate: estimateTokens(content),
      ref: source.filepath || source.filename,
    })
  })

  for (const skillId of input.forcedSkillIds || []) {
    items.push({
      id: `skill-${skillId}`,
      source: 'skill',
      priority: 90,
      content: skillId,
      tokenEstimate: estimateTokens(skillId),
      ref: skillId,
    })
  }

  return items
}

function formatResearchQualityNote(result: Awaited<ReturnType<typeof runDeepResearch>>) {
  if (!result.quality) return ''
  return [
    `> 研究质量：${result.quality.grade}（${result.quality.overall}/100）。${result.quality.summary}`,
    '',
  ].join('\n')
}

function buildAutoNoteTitle(userInput: string) {
  const normalized = userInput
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')

  const fallback = `对话要点-${new Date().toISOString().slice(0, 10)}`
  return (normalized || fallback).slice(0, 28)
}

function isLikelyErrorContent(content: string) {
  return /^工具 .+执行失败[:：]|^工具 .+执行出错[:：]|^Error:|^请求失败[:：]|^执行异常[:：]|^上游服务异常[:：]|^余额不足[:：]|^请求频率超限[:：]/.test(content.trim())
}

function formatUserVisibleError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '未知错误')
  const friendly = formatFriendlyError(error instanceof Error ? error : raw)
  if (friendly.category !== 'unknown') {
    return [
      friendly.title,
      friendly.message,
      friendly.suggestion,
    ].filter(Boolean).join('：')
  }

  return raw
    .replace(/^Error:\s*/i, '')
    .replace(/\s*详情[:：]\s*AI_HTTP_ERROR[\s\S]*$/i, '')
    .replace(/\s*body=\{[\s\S]*$/i, '')
    .trim() || '请求失败，请稍后重试。'
}

function formatEmptyAiResponseMessage(meta?: AiStreamFinishMetadata | null, thinkingContent?: string) {
  const finishReason = meta?.finishReason || meta?.finishReasons.find(Boolean)
  const details = [
    finishReason ? `finish_reason: ${finishReason}` : '',
    thinkingContent?.trim() ? '模型只返回了思考内容，没有返回可展示正文' : '',
  ].filter(Boolean)

  return [
    '模型本次响应已结束，但没有返回可展示正文。',
    details.length > 0 ? `（${details.join('；')}）` : '',
    '请重试一次；如果仍然出现，建议切换到非推理模型，或检查当前模型服务是否把正文放在 reasoning_content 而不是 content。',
  ].filter(Boolean).join('\n')
}

function formatAgentNoVisibleAnswerMessage() {
  return '这次没有生成可展示的正式回答。内部工具结果和错误已保留在运行记录中，请重试或换一个可用的数据源。'
}

/** 判断内容是否包含值得沉淀的知识性结构（而非简单问答/闲聊） */
function hasKnowledgeRichContent(content: string): boolean {
  // 多个列表项（知识点罗列）
  const listMatches = content.match(/(^|\n)\s*[-*]\s+/g)
  if (listMatches && listMatches.length >= 3) return true
  // 多个标题层级（系统性内容）
  const headingMatches = content.match(/(^|\n)\s*#{1,3}\s+/g)
  if (headingMatches && headingMatches.length >= 2) return true
  // 代码块（技术教程）
  if (/```[\s\S]*?```/.test(content)) return true
  // 步骤/流程
  if (/(^|\n)\s*(第一步|第二步|步骤\s*\d|Step\s*\d)/i.test(content)) return true
  // 对比/因果
  if (/对比|比较|区别|优势|劣势|原理|原因|因为.*所以|如果.*那么/.test(content)) return true
  return false
}

function hasExplicitKnowledgeCaptureIntent(userInput: string) {
  return KNOWLEDGE_CAPTURE_INTENT_PATTERN.test(userInput.trim())
}

function shouldSuggestExtractToNote(content: string, hasSuccessfulToolCall: boolean, userInput: string) {
  if (!hasExplicitKnowledgeCaptureIntent(userInput)) return false

  const trimmed = cleanAssistantGeneratedContent(content || '').trim()
  if (!trimmed) return false
  if (isLikelyErrorContent(trimmed)) return false

  // 短内容直接跳过（简单问答不需要沉淀）
  if (trimmed.length < 300) return false

  // 长内容 + 知识性结构 → 值得沉淀
  if (trimmed.length >= MIN_AUTO_EXTRACT_CHAR_COUNT && hasKnowledgeRichContent(trimmed)) return true

  // 工具调用产生了实际结果（创建文件等），内容较长时提示
  if (hasSuccessfulToolCall && trimmed.length >= 400) return true

  return false
}

function buildWebSearchQuery(instruction: string): string | null {
  const trimmed = instruction.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith(AI_DOC_COMMAND_PREFIX)) {
    return null
  }

  return trimmed
}

function formatResearchProgress(progress: DeepResearchProgress, query: string, startedAt: number) {
  const view = buildResearchProgressView(progress, {
    query,
    startedAt,
    estimatedMinutes: progress.estimatedMinutes,
  })
  return encodeResearchProgressView(view)
}

function buildResearchBackgroundView(
  status: 'starting' | 'collecting' | 'writing',
  query: string,
  startedAt: number,
): ResearchProgressView {
  const view = buildResearchProgressView(null, {
    query,
    startedAt,
    estimatedMinutes: '3-6 分钟',
  })
  return {
    ...view,
    statusText: {
      starting: '正在准备任务',
      collecting: '正在搜集和分析资料',
      writing: '正在整理研究报告',
    }[status],
    currentStep: {
      starting: '梳理研究目标',
      collecting: '执行联网检索',
      writing: '生成研究报告',
    }[status],
    steps: view.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'active' : 'pending',
    })),
  }
}

const RESEARCH_CLARIFICATION_PREFIX = '<!-- deep-research-clarification '
const RESEARCH_CLARIFICATION_SUFFIX = ' -->'

type ResearchClarificationMeta = {
  originalQuery: string
  questions: string[]
}

function buildWebSearchInstruction(decision: AutoWebSearchDecision) {
  const signals = decision.matchedSignals.length > 0
    ? `触发信号：${decision.matchedSignals.join('、')}。`
    : ''

  return [
    '## 自动联网',
    '',
    `系统已自动判断本轮需要联网搜索。${signals}`,
    '请优先使用 Web 搜索结果回答实时、最新、近期、价格、天气、赛事、新闻、版本、政策等会变化的问题。',
    '引用来源时请使用可点击 Markdown 链接，不要只写来源名称。',
    '总结语气要像给用户做清晰 briefing：说重点、讲影响、少用官方腔和学术腔。',
    '如果搜索结果不足或来源过旧，请明确说明证据不足，不要用训练数据猜测。',
    '',
  ].join('\n')
}

function encodeResearchClarificationMeta(meta: ResearchClarificationMeta) {
  return `${RESEARCH_CLARIFICATION_PREFIX}${encodeURIComponent(JSON.stringify(meta))}${RESEARCH_CLARIFICATION_SUFFIX}`
}

function parseResearchClarificationMeta(content?: string): ResearchClarificationMeta | null {
  if (!content?.startsWith(RESEARCH_CLARIFICATION_PREFIX)) {
    return null
  }

  const endIndex = content.indexOf(RESEARCH_CLARIFICATION_SUFFIX)
  if (endIndex < 0) {
    return null
  }

  try {
    return JSON.parse(decodeURIComponent(content.slice(RESEARCH_CLARIFICATION_PREFIX.length, endIndex)))
  } catch {
    return null
  }
}

function formatResearchClarificationMessage(originalQuery: string, questions: string[]) {
  const meta = encodeResearchClarificationMeta({ originalQuery, questions })
  return [
    meta,
    '为了让深度研究更贴合你的真实目标，我需要先确认几个问题：',
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    '你可以直接按序号简单回答。信息足够后，我会自动开始深度研究。',
    '',
    '如果你想跳过梳理，也可以直接回复“直接开始研究”。',
  ].join('\n')
}

function formatResearchResumeMessage(session: DeepResearchSessionSummary) {
  const started = new Date(session.startedAt)
  const startedText = Number.isNaN(started.getTime()) ? session.startedAt : started.toLocaleString()
  const stageText = session.stage
    ? `**上次阶段：** ${session.stage}`
    : ''
  const currentQueryText = session.currentQuery
    ? `**断点位置：** ${session.currentQuery}`
    : ''
  const meta = encodeResearchResumeData({
    sessionId: session.id,
    query: session.query,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    currentStage: session.stage,
    currentQuery: session.currentQuery,
    pendingQueriesCount: session.pendingQueriesCount,
    sourcesCount: session.sourcesCount,
    evidencesCount: session.evidencesCount,
  })
  return [
    meta,
    '## 发现未完成的研究任务',
    '',
    `**主题：** ${session.query}`,
    `**开始时间：** ${startedText}`,
    stageText,
    currentQueryText,
    `**剩余查询：** ${session.pendingQueriesCount}`,
    `**已找到来源：** ${session.sourcesCount}`,
    `**已提取证据：** ${session.evidencesCount}`,
    '',
    '点击下方「继续研究」按钮，或输入「继续研究」可从断点恢复。若要新建研究，请发送新主题并包含「直接开始研究」。',
  ].join('\n')
}

function formatResearchInterruptedMessage(input: {
  sessionId?: string
  query: string
  startedAt: number
  reason?: string
}) {
  if (!input.sessionId) {
    return '深度研究已停止。'
  }

  const startedAt = new Date(input.startedAt).toISOString()
  const meta = encodeResearchResumeData({
    sessionId: input.sessionId,
    query: input.query,
    startedAt,
    pendingQueriesCount: 1,
    sourcesCount: 0,
    evidencesCount: 0,
  })

  return [
    meta,
    input.reason ? '## 深度研究已保存断点' : '## 深度研究已中断',
    '',
    `**主题：** ${input.query}`,
    input.reason ? `**原因：** ${input.reason}` : '',
    '',
    '已保存当前断点。点击下方「继续研究」按钮，或输入「继续研究」从断点恢复。',
  ].filter(Boolean).join('\n')
}

function normalizeResearchTopicText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getResearchTopicTokens(text: string) {
  const normalized = normalizeResearchTopicText(text)
  const latinTokens = normalized.match(/[a-z0-9]{2,}/g) || []
  const cjkTokens = normalized.match(/[\p{Script=Han}]{2,}/gu) || []
  return new Set([...latinTokens, ...cjkTokens].filter(token => token.length >= 2))
}

function isSameResearchTopic(a: string, b: string) {
  const normalizedA = normalizeResearchTopicText(a)
  const normalizedB = normalizeResearchTopicText(b)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA === normalizedB) return true
  if (normalizedA.length >= 12 && normalizedB.includes(normalizedA)) return true
  if (normalizedB.length >= 12 && normalizedA.includes(normalizedB)) return true

  const aTokens = getResearchTopicTokens(normalizedA)
  const bTokens = getResearchTopicTokens(normalizedB)
  if (aTokens.size === 0 || bTokens.size === 0) return false

  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap / Math.min(aTokens.size, bTokens.size) >= 0.6
}

function stripResearchDirectStartWords(text: string) {
  return text
    .replace(/直接开始研究|直接研究|开始研究|跳过|不用问|no questions/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimResearchLocalText(text: string, limit = 12000) {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit).trim()}\n\n[local context truncated: ${normalized.length - limit} chars omitted]`
}

function citationDetailToResearchLocalSource(detail: ChatCitationSource, index: number): ResearchLocalSourceInput | null {
  const content = typeof detail.content === 'string' ? detail.content.trim() : ''
  const title = detail.title || detail.filename || detail.filepath || `本地材料 ${index + 1}`
  if (!content && !title) {
    return null
  }

  const sourceType = detail.sourceType === 'current'
    || detail.sourceType === 'linked'
    || detail.sourceType === 'quote'
    || detail.sourceType === 'rag'
    ? detail.sourceType
    : 'local'

  return {
    title,
    content: trimResearchLocalText(content || title, 10000),
    url: detail.url,
    sourceType,
    path: detail.filepath,
    startLine: detail.startLine,
    endLine: detail.endLine,
  }
}

export const ChatSend = forwardRef<{
  sendChat: (instructionOverride?: string, options?: ChatSendOptions) => void
  stopChat: () => Promise<void>
}, ChatSendProps>(({
  inputValue,
  onSent,
  linkedResource,
  linkedResources = [],
  linkedResourcePreviews = {},
  attachedImages = [],
  quoteData = null,
  webSearchEnabled = false,
  allowAutoCurrentFileContext = true,
  getLiveInputValue,
  onSubmitOverride,
  canSubmitOverride = false,
  hideButton = false,
  hideIdleButton = false,
}, ref) => {
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const {
    insert,
    loading,
    researchRunning,
    agentState,
    chatMode,
    setLoading,
    setResearchRunning,
    startResearchRun,
    updateResearchProgressView,
    finishResearchRun,
    ensureCurrentConversation,
    saveChat,
    setAgentState,
    maybeCondense,
    linkedResourcePreview,
  } = useChatStore()
  const { isRagEnabled } = useVectorStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const submitInFlightRef = useRef(false)
  const lastAutoSuggestMessageIdRef = useRef<number | null>(null)
  const [liveInputValue, setLiveInputValue] = useState(inputValue)
  // 冷却：同一对话只提示一次可沉淀，记录已提示的 conversationId
  const suggestedConversationIds = useRef<Set<number | undefined>>(new Set())
  const t = useTranslations()
  const effectiveLinkedResources = linkedResources.length > 0
    ? linkedResources
    : linkedResource
      ? [linkedResource]
      : []
  const isAgentMode = chatMode === 'agent'
  const isRunning = researchRunning || (isAgentMode ? agentState.isRunning : loading)
  const effectiveInputValue = liveInputValue || inputValue
  const syncLiveInputValue = () => {
    const nextInputValue = getLiveInputValue?.() || inputValue
    setLiveInputValue(nextInputValue)
    return nextInputValue
  }
  const resolveAutoWebSearchDecision = (userInput: string) => decideAutoWebSearch({
    userInput,
    manualDefaultEnabled: webSearchEnabled,
    hasSearchProvider: true,
  })

  const resolveGroundedWebSearchDecision = (userInput: string, hasDocumentContext: boolean) => {
    const webDecision = resolveAutoWebSearchDecision(userInput)
    const documentDecision = decideDocumentGrounding({ userInput, hasDocumentContext })
    if (!documentDecision.suppressWebSearch || !webDecision.enabled) {
      return { webDecision, documentDecision, effectiveWebSearchEnabled: webDecision.enabled }
    }

    return {
      webDecision: {
        ...webDecision,
        enabled: false,
        detail: `${webDecision.detail} 当前问题指向已打开/已关联文档，本轮优先使用文档上下文。`,
      },
      documentDecision,
      effectiveWebSearchEnabled: false,
    }
  }

  // 跟踪上一次的 loading 状态
  const wasLoadingRef = useRef(false)

  useEffect(() => {
    setLiveInputValue(inputValue)
  }, [inputValue])

  // 持久化 ref：让 resume-research 事件监听器始终能拿到最新闭包
  const resumeContextRef = useRef<{
    insertTagId: number | undefined
    doInsert: typeof insert
    doSetLoading: typeof setLoading
    doBuildLocalCtx: typeof buildResearchLocalContext
    doStartResearch: typeof startBackgroundDeepResearch
  } | null>(null)

  resumeContextRef.current = {
    insertTagId: currentTagId ?? undefined,
    doInsert: insert,
    doSetLoading: setLoading,
    doBuildLocalCtx: buildResearchLocalContext,
    doStartResearch: startBackgroundDeepResearch,
  }

  // 监听来自 ResearchResumeCard 的 custom event
  useEffect(() => {
    const handleResumeEvent = async (e: Event) => {
      const data = (e as CustomEvent<ResearchResumeMeta>).detail
      if (!data?.sessionId || !data?.query) return

      const ctx = resumeContextRef.current
      if (!ctx) return

      const placeholderMessage = await ctx.doInsert({
        tagId: ctx.insertTagId,
        role: 'system',
        content: '',
        type: 'chat',
        inserted: false,
      })
      if (!placeholderMessage) return

      const resumeController = new AbortController()
      abortControllerRef.current = resumeController
      ctx.doSetLoading(true)

      const localCtx = await ctx.doBuildLocalCtx(data.query)
      ctx.doStartResearch(placeholderMessage, data.query, resumeController, {
        sessionId: data.sessionId,
        localContext: localCtx?.localContext,
        localRagSources: localCtx?.ragSources,
        localRagSourceDetails: localCtx?.ragSourceDetails,
      })
    }

    document.addEventListener('resume-research', handleResumeEvent)
    return () => document.removeEventListener('resume-research', handleResumeEvent)
  }, [])

  // 在 AI 响应完成后，触发压缩检查
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      // loading 从 true 变为 false，AI 响应完成
      // 异步触发，不等待完成
      maybeCondense()
    }
    wasLoadingRef.current = loading
  }, [loading, maybeCondense])

  const shouldCarryUserHistoryForAgent = (input: string) => {
    const normalized = input.trim().toLowerCase()
    if (!normalized) {
      return false
    }

    return /^(继续|接着|然后|再来|再生成|再做|顺便|另外|刚才|基于刚才|在此基础上|那个|这个|它|继续用|再用)/.test(normalized)
      || /(继续|接着|然后|再来|再生成|再做|顺便|另外|刚才|基于刚才|在此基础上|那个|这个|它)/.test(normalized)
  }

  const getAgentHistoryTurnLimit = (input: string, isFollowUp?: boolean) => (
    (isFollowUp ?? shouldCarryUserHistoryForAgent(input))
      ? AGENT_FOLLOW_UP_HISTORY_TURNS
      : AGENT_DEFAULT_HISTORY_TURNS
  )

  const getAgentHistoryTokenBudget = (input: string, isFollowUp?: boolean) => (
    (isFollowUp ?? shouldCarryUserHistoryForAgent(input))
      ? AGENT_FOLLOW_UP_HISTORY_TOKEN_BUDGET
      : AGENT_DEFAULT_HISTORY_TOKEN_BUDGET
  )

  const getChatHistoryTurnLimit = (input: string, isFollowUp?: boolean) => (
    (isFollowUp ?? shouldCarryUserHistoryForAgent(input))
      ? CHAT_FOLLOW_UP_HISTORY_TURNS
      : CHAT_DEFAULT_HISTORY_TURNS
  )

  const getChatHistoryTokenBudget = (input: string, isFollowUp?: boolean) => (
    (isFollowUp ?? shouldCarryUserHistoryForAgent(input))
      ? CHAT_FOLLOW_UP_HISTORY_TOKEN_BUDGET
      : CHAT_DEFAULT_HISTORY_TOKEN_BUDGET
  )

  const buildPartialSuccessContent = (result: string, toolCalls: { result?: { success?: boolean; data?: any; error?: string } }[]) => {
    const generatedOutputFiles = toolCalls.flatMap((toolCall) => {
      const outputFiles = toolCall.result?.data?.output_files
      return Array.isArray(outputFiles) ? outputFiles : []
    })

    const uniqueOutputFiles = Array.from(new Set(generatedOutputFiles.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)))
    if (uniqueOutputFiles.length === 0) {
      return null
    }

    const failedToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.result?.success === false)
    const failureMessage = failedToolCall?.result?.error || result

    return [
      `已成功生成文件：`,
      uniqueOutputFiles.map((file) => `- ${file}`).join('\n'),
      '',
      `后续校验或附加步骤失败：${failureMessage}`,
    ].join('\n')
  }

  async function buildResearchLocalContext(userQuery: string): Promise<{
    localContext?: ResearchLocalContext
    ragSources: string[]
    ragSourceDetails: ChatCitationSource[]
  }> {
    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    const contextResult = await buildChatContext({
      linkedResources: effectiveLinkedResources,
      linkedResourcePreviews,
      linkedResourcePreview,
      quoteData,
      isRagEnabled,
      webSearchEnabled: false,
      userQuery,
      contextBudget: 50000,
      currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
      activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
    })

    const localSources = contextResult.ragSourceDetails
      .map((detail, index) => citationDetailToResearchLocalSource(detail, index))
      .filter((source): source is ResearchLocalSourceInput => !!source)

    const diagnosticsSource: ResearchLocalSourceInput = {
      title: '本地上下文诊断',
      content: [
        `策略：${contextResult.diagnostics.strategy}`,
        contextResult.diagnostics.ragSkippedReason ? `跳过原因：${contextResult.diagnostics.ragSkippedReason}` : '',
        contextResult.diagnostics.ragQuery ? `RAG query：${contextResult.diagnostics.ragQuery}` : '',
        contextResult.diagnostics.ragKeywords.length ? `关键词：${contextResult.diagnostics.ragKeywords.join('、')}` : '',
        `当前笔记：${contextResult.diagnostics.currentNoteInjected ? '已纳入' : '未纳入'}`,
        `关联文件：${contextResult.diagnostics.linkedFileInjectedCount}/${contextResult.diagnostics.linkedFileCount}`,
        `RAG 命中：${contextResult.diagnostics.ragSourceCount}`,
        `注入字符：当前 ${contextResult.diagnostics.injectedChars.current} / 关联 ${contextResult.diagnostics.injectedChars.linked} / 引用 ${contextResult.diagnostics.injectedChars.quote} / RAG ${contextResult.diagnostics.injectedChars.rag}`,
        ...contextResult.diagnostics.warnings.map(warning => `警告：${warning}`),
      ].filter(Boolean).join('\n'),
      sourceType: 'local',
      path: 'research-local-context-diagnostics',
    }

    const brief = [
      '以下是用户当前工作区材料，应纳入 Research brief，并作为本地来源参与证据判断。',
      '',
      contextResult.context ? trimResearchLocalText(contextResult.context, 30000) : '',
      '',
      diagnosticsSource.content,
    ].filter(Boolean).join('\n')

    const hasLocalMaterial = Boolean(contextResult.context.trim()) || localSources.length > 0
    const localContext = hasLocalMaterial
      ? {
          brief,
          sources: localSources,
        }
      : undefined

    return {
      localContext,
      ragSources: contextResult.ragSources,
      ragSourceDetails: contextResult.ragSourceDetails,
    }
  }

  async function getLatestUnfinishedResearchSession(query?: string): Promise<DeepResearchSessionSummary | null> {
    const sessions = await listUnfinishedResearchSessions(query ? 10 : 1)
    if (query?.trim()) {
      return sessions.find(session => isSameResearchTopic(session.query, query)) || null
    }
    return sessions[0] || null
  }

  function notifyResearchResumeAvailable(session: DeepResearchSessionSummary, onResume: () => void) {
    const stageText = session.stage ? `，阶段 ${session.stage}` : ''
    toast({
      title: '发现未完成的研究任务',
      description: `还有 ${session.pendingQueriesCount} 个查询未完成${stageText}，来源 ${session.sourcesCount} 个。点击下方按钮或输入「继续研究」恢复。`,
      duration: 15000,
      action: (
        <ToastAction
          altText="继续研究"
          onClick={onResume}
        >
          继续研究
        </ToastAction>
      ),
    })
  }

  const sanitizeAgentFinalContent = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) {
      return trimmed
    }

    const visibleContent = cleanAssistantGeneratedContent(trimmed)
    if (visibleContent && visibleContent !== trimmed) {
      return visibleContent
    }

    const markers = ['\nThought:', '\nAction:', '\nAction Input:']
    let cutoff = trimmed.length

    for (const marker of markers) {
      const index = trimmed.indexOf(marker)
      if (index !== -1) {
        cutoff = Math.min(cutoff, index)
      }
    }

    const leadingActionIndex = trimmed.search(/^(Thought:|Action:|Action Input:)/)
    if (leadingActionIndex === 0) {
      const finalAnswerMatch = trimmed.match(/Final Answer[:：]\s*([\s\S]*)/i)
      if (finalAnswerMatch) {
        return cleanAssistantGeneratedContent(finalAnswerMatch[1].trim())
      }
    }

    return cleanAssistantGeneratedContent(trimmed.slice(0, cutoff).trim())
  }

  const finishVisibleAgentRun = () => {
    setAgentState({
      activeChatId: undefined,
      isRunning: false,
      isThinking: false,
      pendingConfirmation: undefined,
      isFinalAnswerMode: false,
      finalAnswerContent: undefined,
      currentStepStartTime: undefined,
    })
    setLoading(false)
  }

  const createLiveAgentAnswerUpdater = (placeholderMessage: Chat) => {
    let lastContent = ''
    let pendingContent = ''
    let lastAppliedAt = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const applyContent = (content: string) => {
      if (cancelled) {
        return
      }
      const visibleContent = sanitizeAgentFinalContent(content)
      if (!visibleContent || visibleContent === lastContent) {
        return
      }

      lastContent = visibleContent
      lastAppliedAt = Date.now()
      const currentMessage = useChatStore.getState().chats.find(c => c.id === placeholderMessage.id)
      void saveChat({
        id: placeholderMessage.id,
        tagId: placeholderMessage.tagId,
        conversationId: placeholderMessage.conversationId,
        role: placeholderMessage.role,
        type: placeholderMessage.type,
        inserted: placeholderMessage.inserted,
        createdAt: placeholderMessage.createdAt,
        ragSources: currentMessage?.ragSources,
        ragSourceDetails: currentMessage?.ragSourceDetails,
        content: visibleContent,
      }, false)
    }

    const flush = () => {
      if (cancelled) {
        return
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (!pendingContent) {
        return
      }
      const nextContent = pendingContent
      pendingContent = ''
      applyContent(nextContent)
    }

    const onAnswerDelta = (content: string) => {
      pendingContent = content
      const elapsed = Date.now() - lastAppliedAt
      if (elapsed >= AGENT_LIVE_ANSWER_UPDATE_INTERVAL_MS) {
        flush()
        return
      }
      if (!timeoutId) {
        timeoutId = setTimeout(flush, AGENT_LIVE_ANSWER_UPDATE_INTERVAL_MS - elapsed)
      }
    }

    const cancel = () => {
      cancelled = true
      pendingContent = ''
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const clear = () => {
      pendingContent = ''
      lastContent = ''
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      const currentMessage = useChatStore.getState().chats.find(c => c.id === placeholderMessage.id)
      void saveChat({
        id: placeholderMessage.id,
        tagId: placeholderMessage.tagId,
        conversationId: placeholderMessage.conversationId,
        role: placeholderMessage.role,
        type: placeholderMessage.type,
        inserted: placeholderMessage.inserted,
        createdAt: placeholderMessage.createdAt,
        ragSources: currentMessage?.ragSources,
        ragSourceDetails: currentMessage?.ragSourceDetails,
        content: '',
      }, false)
    }

    return { onAnswerDelta, flush, cancel, clear }
  }

  const createLiveChatStreamUpdater = (
    placeholderMessage: Chat,
    options?: {
      visibleRagSources?: unknown[]
      visibleRagSourceDetails?: unknown[]
      sanitizeContent?: (content: string) => string
    },
  ) => {
    const ragSources = JSON.stringify(options?.visibleRagSources || [])
    const ragSourceDetails = JSON.stringify(options?.visibleRagSourceDetails || [])
    const sanitizeContent = options?.sanitizeContent || ((content: string) => content)

    let pendingContent = ''
    let pendingThinking = ''
    let lastContent = ''
    let lastThinking = ''
    let lastAppliedAt = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const applySnapshot = () => {
      if (cancelled) {
        return
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      const nextContent = sanitizeContent(pendingContent)
      const nextThinking = pendingThinking
      if (nextContent === lastContent && nextThinking === lastThinking) {
        return
      }

      lastContent = nextContent
      lastThinking = nextThinking
      lastAppliedAt = Date.now()
      void saveChat({
        ...placeholderMessage,
        content: nextContent,
        thinking: nextThinking || undefined,
        ragSources,
        ragSourceDetails,
      }, false)
    }

    const scheduleApply = () => {
      const elapsed = Date.now() - lastAppliedAt
      if (elapsed >= CHAT_LIVE_MESSAGE_UPDATE_INTERVAL_MS) {
        applySnapshot()
        return
      }
      if (!timeoutId) {
        timeoutId = setTimeout(applySnapshot, CHAT_LIVE_MESSAGE_UPDATE_INTERVAL_MS - elapsed)
      }
    }

    const updateContent = (content: string) => {
      pendingContent = content
      scheduleApply()
    }

    const updateThinking = (thinking: string) => {
      pendingThinking = thinking
      scheduleApply()
    }

    const flush = () => {
      applySnapshot()
    }

    const cancel = () => {
      cancelled = true
      pendingContent = ''
      pendingThinking = ''
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    return { updateContent, updateThinking, flush, cancel }
  }

  const isLikelyVisualCreationRequest = (text: string) => (
    /绘画|画一|画个|画张|生成图|生成一张|图片生成|出图|插画|海报|封面|视觉设计|draw|image|poster|illustration/i.test(text)
  )

  const createPreparingAgentActivity = (
    startedAt: number,
    context?: { userInput?: string; imageCount?: number },
  ) => {
    const imageCount = context?.imageCount || 0
    const userInput = context?.userInput || ''

    if (imageCount > 0) {
      return {
        label: '正在读取图片',
        detail: imageCount === 1
          ? '已接收图片，正在整理视觉上下文。'
          : `已接收 ${imageCount} 张图片，正在整理视觉上下文。`,
        phase: 'preparing' as const,
        startedAt,
      }
    }

    if (isLikelyVisualCreationRequest(userInput)) {
      return {
        label: '正在理解创作需求',
        detail: '正在把描述整理成可执行的绘画任务。',
        phase: 'preparing' as const,
        startedAt,
      }
    }

    return {
      label: '正在准备任务',
      detail: '正在整理上下文、历史消息和可用工具。',
      phase: 'preparing' as const,
      startedAt,
    }
  }

  const primeAgentRunStatus = (
    activeChatId?: number,
    startedAt = Date.now(),
    context?: { userInput?: string; imageCount?: number },
  ) => {
    setAgentState({
      agentRunId: undefined,
      agentEventCursor: undefined,
      activeChatId,
      isRunning: true,
      isThinking: true,
      currentThought: '',
      thoughtHistory: [],
      completedSteps: [],
      currentAction: undefined,
      currentObservation: undefined,
      toolCalls: [],
      agentEvents: [],
      currentIteration: 0,
      pendingConfirmation: undefined,
      loadedSkills: undefined,
      selectedSkills: undefined,
      currentStepStartTime: startedAt,
      ragSources: undefined,
      ragSourceDetails: undefined,
      agentContextSnapshot: undefined,
      agentPartSnapshot: undefined,
      agentParts: [],
      isFinalAnswerMode: false,
      finalAnswerContent: undefined,
      activity: createPreparingAgentActivity(startedAt, context),
      telemetry: undefined,
      taskPlan: undefined,
    })
  }

  const triggerAutoExtractSuggestion = async (params: {
    finalContent: string
    placeholderMessageId: number
    conversationId?: number
    userInput: string
    hasSuccessfulToolCall: boolean
  }) => {
    const {
      finalContent,
      placeholderMessageId,
      conversationId,
      userInput,
      hasSuccessfulToolCall,
    } = params

    if (lastAutoSuggestMessageIdRef.current === placeholderMessageId) {
      return
    }

    // 同一对话只提示一次
    if (suggestedConversationIds.current.has(conversationId)) {
      return
    }

    if (!shouldSuggestExtractToNote(finalContent, hasSuccessfulToolCall, userInput)) {
      return
    }

    lastAutoSuggestMessageIdRef.current = placeholderMessageId
    suggestedConversationIds.current.add(conversationId)
    const title = buildAutoNoteTitle(userInput)

    toast({
      title: '检测到可沉淀内容',
      description: '可一键保存为笔记，后续可被知识库检索复用。',
      action: (
        <ToastAction
          altText="保存对话要点"
          onClick={() => {
            void (async () => {
              const extractTool = getToolByName('extract_to_note')
              if (!extractTool) {
                toast({
                  title: '保存失败',
                  description: '未找到 extract_to_note 工具',
                  variant: 'destructive',
                })
                return
              }

              const extractResult = await extractTool.execute({
                title,
                folderPath: 'agent-notes',
                format: 'summary',
                maxMessages: 40,
                conversationId,
              })

              if (!extractResult.success) {
                toast({
                  title: '保存失败',
                  description: extractResult.error || '提取对话要点失败',
                  variant: 'destructive',
                })
                return
              }

              toast({
                title: '已保存对话要点',
                description: extractResult.data?.filePath
                  ? `笔记路径：${extractResult.data.filePath}`
                  : '已生成笔记并完成索引',
              })
            })()
          }}
        >
          保存要点
        </ToastAction>
      ),
    })
  }

  async function handleChatMode(imageUrls: string[], instructionOverride?: string, options?: ChatSendOptions) {
    const effectiveInstruction = instructionOverride ?? inputValue
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    let streamUpdater: ReturnType<typeof createLiveChatStreamUpdater> | null = null

    try {
      const { chats: chatsForContinuity } = useChatStore.getState()
      const continuity = analyzeConversationContinuity(chatsForContinuity, effectiveInstruction)
      const continuityPrompt = buildConversationContinuityPrompt(continuity)
      const contextQuery = continuity.retrievalQuery || effectiveInstruction

      // 使用统一的上下文构建器
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()
      const hasDocumentContext = Boolean(
        (allowAutoCurrentFileContext && articleStore.currentArticle && articleStore.activeFilePath) ||
        effectiveLinkedResources.length > 0 ||
        quoteData
      )
      const { webDecision, documentDecision, effectiveWebSearchEnabled } =
        resolveGroundedWebSearchDecision(contextQuery, hasDocumentContext)

      const contextResult = await buildChatContext({
        linkedResources: effectiveLinkedResources,
        linkedResourcePreviews,
        linkedResourcePreview,
        quoteData,
        isRagEnabled,
        webSearchEnabled: effectiveWebSearchEnabled,
        userQuery: contextQuery,
        webSearchQuery: effectiveWebSearchEnabled ? buildWebSearchQuery(contextQuery) || undefined : undefined,
        contextBudget: 15000,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const visibleRagSourceDetails = ragSourceDetails
      const visibleRagSources = ragSources
      const systemContextBase = documentDecision.instruction
        ? `${documentDecision.instruction}\n\n${context}`
        : context
      const groundedSystemContext = effectiveWebSearchEnabled
        ? `${buildWebSearchInstruction(webDecision)}${systemContextBase}`
        : systemContextBase
      const systemContext = [continuityPrompt, groundedSystemContext].filter(section => section.trim()).join('\n\n')

      const { chats: currentChats } = useChatStore.getState()
      const messages = buildMessagesWithHistory(
        currentChats,
        undefined,
        systemContext,
        effectiveInstruction,
        {
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          maxUserMessages: getChatHistoryTurnLimit(effectiveInstruction, continuity.isFollowUp),
          maxHistoryTokens: getChatHistoryTokenBudget(effectiveInstruction, continuity.isFollowUp),
          maxSingleMessageTokens: CHAT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS,
        }
      )

      if (ragSources.length > 0 || ragSourceDetails.length > 0) {
        await saveChat({
          ...placeholderMessage,
          ragSources: JSON.stringify(visibleRagSources),
          ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
        }, true)
      }

      let finalContent = ''
      let thinkingContent = ''
      let streamMeta: AiStreamFinishMetadata | null = null
      streamUpdater = createLiveChatStreamUpdater(placeholderMessage, {
        visibleRagSources,
        visibleRagSourceDetails,
      })
      const result = await fetchAiStream({
        text: effectiveInstruction,
        onUpdate: (content) => {
          finalContent = content
          streamUpdater?.updateContent(content)
        },
        abortSignal: abortController.signal,
        t,
        chatId: placeholderMessage.id,
        imageUrls,
        onThinkingUpdate: (thinking: string) => {
          thinkingContent = thinking
          streamUpdater?.updateThinking(thinking)
        },
        messages,
        maxTokens: options?.maxTokens,
        onStreamFinish: (metadata) => {
          streamMeta = metadata
        },
        memoryRetrievalQuery: contextQuery,
      })
      if (!finalContent && result) {
        finalContent = result
      }

      if (!abortController.signal.aborted && !cleanAssistantGeneratedContent(finalContent).trim()) {
        finalContent = formatEmptyAiResponseMessage(streamMeta, thinkingContent)
      }

      streamUpdater.flush()
      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? (finalContent || t('record.chat.input.stopped')) : finalContent,
        thinking: thinkingContent || undefined,
        ragSources: JSON.stringify(visibleRagSources),
        ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
      }, true)
      streamUpdater.cancel()
    } catch (error) {
      streamUpdater?.cancel()
      await saveChat({
        ...placeholderMessage,
        content: formatUserVisibleError(error),
      }, true)
    } finally {
      abortControllerRef.current = null
    }
  }

  async function handleWriterMode(imageUrls: string[], instructionOverride?: string, options?: ChatSendOptions): Promise<string> {
    const effectiveInstruction = instructionOverride ?? inputValue
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return ''

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    let streamUpdater: ReturnType<typeof createLiveChatStreamUpdater> | null = null

    try {
      const { chats: chatsForContinuity } = useChatStore.getState()
      const continuity = analyzeConversationContinuity(chatsForContinuity, effectiveInstruction)
      const continuityPrompt = buildConversationContinuityPrompt(continuity)
      const contextQuery = continuity.retrievalQuery || effectiveInstruction

      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()
      const hasDocumentContext = Boolean(
        (allowAutoCurrentFileContext && articleStore.currentArticle && articleStore.activeFilePath) ||
        effectiveLinkedResources.length > 0 ||
        quoteData
      )
      const { webDecision, documentDecision, effectiveWebSearchEnabled } =
        resolveGroundedWebSearchDecision(contextQuery, hasDocumentContext)

      const contextResult = await buildChatContext({
        linkedResources: effectiveLinkedResources,
        linkedResourcePreviews,
        linkedResourcePreview,
        quoteData,
        isRagEnabled,
        webSearchEnabled: effectiveWebSearchEnabled,
        userQuery: contextQuery,
        webSearchQuery: effectiveWebSearchEnabled ? buildWebSearchQuery(contextQuery) || undefined : undefined,
        contextBudget: 24000,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const visibleRagSourceDetails = ragSourceDetails
      const visibleRagSources = ragSources
      const systemContextBase = documentDecision.instruction
        ? `${documentDecision.instruction}\n\n${context}`
        : context
      const systemContext = effectiveWebSearchEnabled
        ? `${buildWebSearchInstruction(webDecision)}${systemContextBase}`
        : systemContextBase

      if (ragSources.length > 0 || ragSourceDetails.length > 0) {
        await saveChat({
          ...placeholderMessage,
          ragSources: JSON.stringify(visibleRagSources),
          ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
        }, true)
      }

      const skillId = options?.forcedSkillIds?.find(id => id.trim())
      let writerInstruction = effectiveInstruction
      if (skillId) {
        try {
          const { ensureSkillsReadyForAgent } = await import('@/lib/skills/agent-ready')
          await ensureSkillsReadyForAgent()
          const skill = skillManager.getSkill(skillId)
          if (skill) {
            writerInstruction = buildWriterSkillInstruction(skill, effectiveInstruction)
          }
        } catch (error) {
          console.warn('[WriterSkill] Failed to load invoked skill, falling back to plain writer mode:', error)
        }
      }

      const { chats: currentChats } = useChatStore.getState()
      const writerSystemContext = [
        '你正在执行一个写作型 Skill。请直接输出用户可用的正文，保持自然连贯。',
        '不要输出工具调用、执行日志、JSON 包装、Action/Observation、Final Answer 标签或对 Skill 包装提示的解释。',
        '中文内容必须保持 UTF-8 正常字符，避免 mojibake、替换字符和乱码。',
        continuityPrompt,
        systemContext ? `\n## 可用上下文\n\n${systemContext}` : '',
      ].filter(Boolean).join('\n')
      const messages = buildMessagesWithHistory(
        currentChats,
        undefined,
        writerSystemContext,
        writerInstruction,
        {
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          maxUserMessages: getChatHistoryTurnLimit(effectiveInstruction, continuity.isFollowUp),
          maxHistoryTokens: getChatHistoryTokenBudget(effectiveInstruction, continuity.isFollowUp),
          maxSingleMessageTokens: CHAT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS,
        }
      )

      let finalContent = ''
      let thinkingContent = ''
      let streamMeta: AiStreamFinishMetadata | null = null
      streamUpdater = createLiveChatStreamUpdater(placeholderMessage, {
        visibleRagSources,
        visibleRagSourceDetails,
        sanitizeContent: cleanAssistantGeneratedContent,
      })
      const result = await fetchAiStream({
        text: writerInstruction,
        onUpdate: (content) => {
          finalContent = cleanAssistantGeneratedContent(content)
          streamUpdater?.updateContent(content)
        },
        abortSignal: abortController.signal,
        t,
        chatId: placeholderMessage.id,
        imageUrls,
        onThinkingUpdate: (thinking: string) => {
          thinkingContent = thinking
          streamUpdater?.updateThinking(thinking)
        },
        messages,
        maxTokens: options?.maxTokens,
        onStreamFinish: (metadata) => {
          streamMeta = metadata
        },
        memoryRetrievalQuery: contextQuery,
      })

      if (!finalContent && result) {
        finalContent = cleanAssistantGeneratedContent(result)
      }

      if (!abortController.signal.aborted && !finalContent.trim()) {
        finalContent = formatEmptyAiResponseMessage(streamMeta, thinkingContent)
      }

      const savedContent = abortController.signal.aborted
        ? (finalContent || t('record.chat.input.stopped'))
        : finalContent
      streamUpdater.flush()
      await saveChat({
        ...placeholderMessage,
        content: savedContent,
        thinking: thinkingContent || undefined,
        ragSources: JSON.stringify(visibleRagSources),
        ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
      }, true)
      streamUpdater.cancel()

      return savedContent
    } catch (error) {
      streamUpdater?.cancel()
      const errorContent = formatUserVisibleError(error)
      await saveChat({
        ...placeholderMessage,
        content: errorContent,
      }, true)
      return errorContent
    } finally {
      abortControllerRef.current = null
    }
  }

  async function executeDeepResearch(
    placeholderMessage: Chat,
    query: string,
    abortController: AbortController,
    options: {
      sessionId?: string
      localContext?: ResearchLocalContext
      localRagSources?: string[]
      localRagSourceDetails?: ChatCitationSource[]
      researchDepthPreset?: ChatSendOptions['researchDepthPreset']
      researchBreadth?: number
      researchDepth?: number
    } = {}
  ) {
    if (!placeholderMessage) return
    const startedAt = Date.now()
    let researchFinished = false
    let lastProgressSavedAt = 0
    let activeSessionId = options.sessionId
    const researchRunId = `research-${placeholderMessage.id}-${startedAt}`
    const eventBus = createAgentEventBus({
      runId: researchRunId,
      onEvent: (event) => {
        if (event.type === 'research.started' && typeof event.payload?.sessionId === 'string') {
          activeSessionId = event.payload.sessionId
        }
        useChatStore.getState().recordResearchEvent(event)
      },
    })
    setResearchRunning(true)
    startResearchRun({
      runId: researchRunId,
      activeChatId: placeholderMessage.id,
      query,
      startedAt,
      sessionId: activeSessionId,
    })

    try {
      const startingView = buildResearchBackgroundView('starting', query, startedAt)
      updateResearchProgressView(startingView)
      await saveChat({
        ...placeholderMessage,
        content: encodeResearchProgressView(startingView),
      }, true)

      const result = await runDeepResearch({
        query,
        breadth: options.researchBreadth,
        depth: options.researchDepth,
        abortSignal: abortController.signal,
        sessionId: options.sessionId,
        localContext: options.localContext,
        eventBus,
        onProgress: (progress) => {
          if (researchFinished) {
            return
          }

          const progressView = buildResearchProgressView(progress, {
            query,
            startedAt,
            estimatedMinutes: progress.estimatedMinutes,
          })
          updateResearchProgressView(progressView)

          const now = Date.now()
          const shouldSaveImmediately = progress.stage === 'writing' || progress.stage === 'done'
          if (!shouldSaveImmediately && now - lastProgressSavedAt < 1500) {
            return
          }
          lastProgressSavedAt = now

          void saveChat({
            ...placeholderMessage,
            content: formatResearchProgress(progress, query, startedAt),
          }, true).catch(error => {
            console.error('[DeepResearch] Failed to save progress:', error)
          })
        },
      })
      researchFinished = true
      activeSessionId = result.session.id

      const evidenceBySource = new Map<string, string[]>()
      result.evidences.forEach((evidence) => {
        const claims = evidenceBySource.get(evidence.sourceId) || []
        claims.push(evidence.claim)
        evidenceBySource.set(evidence.sourceId, claims)
      })

      const ragSourceDetails: ChatCitationSource[] = result.sources.map((source) => {
        const localType = source.engine.replace(/^local:/, '')
        const sourceType = source.engine.startsWith('local:')
          && (localType === 'current' || localType === 'linked' || localType === 'quote' || localType === 'rag')
          ? localType
          : source.engine.startsWith('local:')
            ? 'rag'
            : 'web'

        return {
          url: source.url,
          title: source.title,
          filepath: source.url,
          filename: source.title || source.url,
          content: evidenceBySource.get(source.id)?.join('\n') || source.snippet || '',
          sourceType,
          engine: source.engine,
          credibilityScore: source.credibilityScore,
          publishedAt: source.publishedAt,
        }
      })
      const mergedRagSources = Array.from(new Set([
        ...(options.localRagSources || []),
        ...result.sources.map(source => source.title || source.url),
      ].filter(Boolean)))
      const mergedRagSourceDetails = [
        ...(options.localRagSourceDetails || []),
        ...ragSourceDetails,
      ]

      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? t('record.chat.input.stopped') : result.report,
        ragSources: mergedRagSources.length > 0 ? JSON.stringify(mergedRagSources) : undefined,
        ragSourceDetails: mergedRagSourceDetails.length > 0 ? JSON.stringify(mergedRagSourceDetails) : undefined,
      }, true)
      finishResearchRun()

      if (!abortController.signal.aborted) {
        // 保存报告为文件并在编辑器中打开
        try {
          const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

          const workspace = await getWorkspacePath()
          const now = new Date()
          const researchDir = 'research'
          const reportTarget = await buildUniqueResearchReportTarget({
            query,
            report: result.report,
            date: now,
            researchDir,
          })
          const qualityNote = formatResearchQualityNote(result)
          const reportFileContent = [
            qualityNote,
            result.report,
          ].filter(Boolean).join('\n')

          // 确保 research 目录存在
          const dirOptions = await getFilePathOptions(researchDir)
          if (workspace.isCustom) {
            const dirExists = await exists(dirOptions.path)
            if (!dirExists) await mkdir(dirOptions.path, { recursive: true })
          } else {
            const dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
            if (!dirExists) await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir, recursive: true })
          }

          // 写入文件
          const fileOptions = await getFilePathOptions(reportTarget.relativeFilePath)
          const sessionOptions = await getFilePathOptions(reportTarget.relativeSessionFilePath)
          const sessionDir = reportTarget.relativeSessionFilePath.split('/').slice(0, -1).join('/')
          const sessionDirOptions = await getFilePathOptions(sessionDir)
          const sessionPayload = {
            ...result.session,
            report: {
              title: reportTarget.title,
              filePath: reportTarget.relativeFilePath,
              savedAt: now.toISOString(),
            },
            mode: {
              breadth: result.session.breadth,
              depth: result.session.depth,
            },
          }
          const sessionJson = JSON.stringify(sessionPayload, null, 2)
          if (workspace.isCustom) {
            const sessionDirExists = await exists(sessionDirOptions.path)
            if (!sessionDirExists) await mkdir(sessionDirOptions.path, { recursive: true })
          } else {
            const sessionDirExists = await exists(sessionDirOptions.path, { baseDir: sessionDirOptions.baseDir })
            if (!sessionDirExists) await mkdir(sessionDirOptions.path, { baseDir: sessionDirOptions.baseDir, recursive: true })
          }
          if (workspace.isCustom) {
            await writeTextFile(fileOptions.path, reportFileContent)
            await writeTextFile(sessionOptions.path, sessionJson)
          } else {
            await writeTextFile(fileOptions.path, reportFileContent, { baseDir: fileOptions.baseDir })
            await writeTextFile(sessionOptions.path, sessionJson, { baseDir: sessionOptions.baseDir })
          }
          try {
            const { upsertResearchHistorySession } = await import('@/lib/research/history-index-store')
            await upsertResearchHistorySession({
              session: result.session,
              reportContent: reportFileContent,
              reportPath: reportTarget.relativeFilePath,
              sessionPath: reportTarget.relativeSessionFilePath,
            })
          } catch (indexError) {
            console.warn('[DeepResearch] Failed to update research history index:', indexError)
          }

          // 在编辑器中打开
          const useArticleStore = (await import('@/stores/article')).default
          const { useSidebarStore } = await import('@/stores/sidebar')
          const articleStore = useArticleStore.getState()
          const sidebarStore = useSidebarStore.getState()

          await articleStore.loadFileTree({ skipRemoteSync: true })
          await sidebarStore.setLeftSidebarTab('files')
          // 先设置路径，再手动设置内容（避免 readArticle 的竞态问题）
          await articleStore.setActiveFilePath(reportTarget.relativeFilePath)
          // 确保编辑器显示报告内容
          articleStore.setCurrentArticle(reportFileContent)

          toast({
            title: '深度研究已完成',
            description: `报告已保存为 ${reportTarget.fileName} 并在编辑器中打开。`,
          })
        } catch (fileError) {
          console.error('[DeepResearch] Failed to save report as file:', fileError, 
            fileError instanceof Error ? fileError.stack : '')
          toast({
            title: '深度研究已完成',
            description: '报告已生成，但保存文件失败，可在对话中查看。',
          })
        }
      }
    } catch (error) {
      researchFinished = true
      eventBus.emit('research.error', {
        sessionId: activeSessionId,
        error: error instanceof Error ? error.message : String(error),
      }, { level: 'error' })
      await saveChat({
        ...placeholderMessage,
        content: activeSessionId
          ? formatResearchInterruptedMessage({
              sessionId: activeSessionId,
              query,
              startedAt,
              reason: abortController.signal.aborted
                ? undefined
                : (error instanceof Error ? error.message : String(error)),
            })
          : `## 深度研究失败\n\n${error instanceof Error ? error.message : String(error)}`,
      }, true)

      if (!abortController.signal.aborted) {
        toast({
          title: '深度研究失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
      finishResearchRun()
    } finally {
      researchFinished = true
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setResearchRunning(false)
      setLoading(false)
      finishResearchRun()
    }
  }

  function startBackgroundDeepResearch(
    placeholderMessage: Chat,
    query: string,
    abortController: AbortController,
    options: {
      sessionId?: string
      localContext?: ResearchLocalContext
      localRagSources?: string[]
      localRagSourceDetails?: ChatCitationSource[]
      researchDepthPreset?: ChatSendOptions['researchDepthPreset']
      researchBreadth?: number
      researchDepth?: number
    } = {}
  ) {
    void executeDeepResearch(placeholderMessage, query, abortController, options)
      .catch(error => {
        console.error('[DeepResearch] Unhandled error in background research:', error)
      })
      .finally(() => {
        void maybeCondense()
      })
  }

  async function handleClarifiedResearchMode(instructionOverride?: string, options?: ChatSendOptions) {
    const effectiveInstruction = instructionOverride ?? inputValue
    const trimmedInstruction = effectiveInstruction.trim()
    let backgroundResearchStarted = false
    let researchLocalContextResult: Awaited<ReturnType<typeof buildResearchLocalContext>> | null = null
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const wantsDirectStart = /直接开始研究|直接研究|开始研究|跳过|不用问|no questions/i.test(trimmedInstruction)
      const directStartTopic = stripResearchDirectStartWords(trimmedInstruction)
      const isBareDirectStart = wantsDirectStart && directStartTopic.length === 0
      const wantsResume = /继续研究|恢复研究|接着研究|继续.*研究|resume\s*research/i.test(trimmedInstruction)

      // ── 恢复研究：用户输入"继续研究"等关键词时，直接从断点恢复 ──
      if (wantsResume) {
        const resumeSession = await getLatestUnfinishedResearchSession()

        if (!resumeSession) {
          await saveChat({
            ...placeholderMessage,
            content: '当前没有未完成的研究任务。请直接发送研究主题开始新的深度研究。',
          }, true)
          return
        }

        researchLocalContextResult = await buildResearchLocalContext(resumeSession.query)
        backgroundResearchStarted = true

        startBackgroundDeepResearch(placeholderMessage, resumeSession.query, abortController, {
          sessionId: resumeSession.id,
          localContext: researchLocalContextResult?.localContext,
          localRagSources: researchLocalContextResult?.ragSources,
          localRagSourceDetails: researchLocalContextResult?.ragSourceDetails,
          researchDepthPreset: options?.researchDepthPreset,
          researchBreadth: options?.researchBreadth,
          researchDepth: options?.researchDepth,
        })
        return
      }

      const effectiveResearchQuery = wantsDirectStart && directStartTopic
        ? directStartTopic
        : trimmedInstruction

      researchLocalContextResult = await buildResearchLocalContext(effectiveResearchQuery)
      const { chats: currentChats } = useChatStore.getState()
      const previousResearchMessage = [...currentChats]
        .reverse()
        .find(chat => chat.role === 'system' && chat.type === 'chat' && chat.content)
      let pendingClarification = parseResearchClarificationMeta(previousResearchMessage?.content)

      // 如果当前会话中找不到澄清消息，但用户想直接开始研究，
      // 尝试从最近的其他会话中查找（处理会话切换/重建的情况）
      if (!pendingClarification && isBareDirectStart) {
        try {
          const { getDb } = await import('@/db')
          const db = await getDb()
          const recentMessages = await db.select<{ content: string }[]>(
            `select content from chats where role = 'system' and type = 'chat' and content like '%deep-research-clarification%' order by createdAt desc limit 1`,
            [],
          )
          if (recentMessages.length > 0) {
            pendingClarification = parseResearchClarificationMeta(recentMessages[0].content)
          }
        } catch (error) {
          console.warn('[DeepResearch] Failed to search clarification from other conversations:', error)
        }
      }

      if (pendingClarification && !wantsDirectStart) {
        await saveChat({
          ...placeholderMessage,
          content: '正在整理你的补充信息，判断是否可以开始深度研究...',
        }, false)

        const completed = await completeResearchClarification({
          originalQuery: pendingClarification.originalQuery,
          questions: pendingClarification.questions,
          answer: trimmedInstruction,
          localContextBrief: researchLocalContextResult.localContext?.brief,
          abortSignal: abortController.signal,
        })

        if (!completed.canStart && completed.missingQuestions.length > 0) {
          await saveChat({
            ...placeholderMessage,
            content: formatResearchClarificationMessage(pendingClarification.originalQuery, completed.missingQuestions),
          }, true)
          return
        }

        backgroundResearchStarted = true
        startBackgroundDeepResearch(placeholderMessage, completed.researchBrief, abortController, {
          localContext: researchLocalContextResult.localContext,
          localRagSources: researchLocalContextResult.ragSources,
          localRagSourceDetails: researchLocalContextResult.ragSourceDetails,
          researchDepthPreset: options?.researchDepthPreset,
          researchBreadth: options?.researchBreadth,
          researchDepth: options?.researchDepth,
        })
        return
      }

      if (pendingClarification && wantsDirectStart) {
        backgroundResearchStarted = true
        startBackgroundDeepResearch(placeholderMessage, pendingClarification.originalQuery, abortController, {
          localContext: researchLocalContextResult.localContext,
          localRagSources: researchLocalContextResult.ragSources,
          localRagSourceDetails: researchLocalContextResult.ragSourceDetails,
          researchDepthPreset: options?.researchDepthPreset,
          researchBreadth: options?.researchBreadth,
          researchDepth: options?.researchDepth,
        })
        return
      }

      await saveChat({
        ...placeholderMessage,
        content: wantsDirectStart ? '正在开始深度研究...' : '正在梳理你的研究需求...',
      }, false)

      const clarification = wantsDirectStart
        ? {
            canStart: true,
            questions: [],
            researchBrief: effectiveResearchQuery,
          }
        : await generateResearchClarification({
            query: effectiveResearchQuery,
            localContextBrief: researchLocalContextResult.localContext?.brief,
            abortSignal: abortController.signal,
          })

      if (!clarification.canStart && clarification.questions.length > 0) {
        await saveChat({
          ...placeholderMessage,
          content: formatResearchClarificationMessage(effectiveResearchQuery, clarification.questions),
        }, true)
        return
      }

      backgroundResearchStarted = true
      const researchBrief = clarification.researchBrief || trimmedInstruction
      const resumeSession = await getLatestUnfinishedResearchSession(researchBrief)

      if (resumeSession && !wantsDirectStart) {
        await saveChat({
          ...placeholderMessage,
          content: formatResearchResumeMessage(resumeSession),
        }, true)
        backgroundResearchStarted = false
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
        notifyResearchResumeAvailable(resumeSession, () => {
          const resumeController = new AbortController()
          abortControllerRef.current = resumeController
          setLoading(true)
          startBackgroundDeepResearch(placeholderMessage, researchBrief, resumeController, {
            sessionId: resumeSession.id,
            localContext: researchLocalContextResult?.localContext,
            localRagSources: researchLocalContextResult?.ragSources,
            localRagSourceDetails: researchLocalContextResult?.ragSourceDetails,
            researchDepthPreset: options?.researchDepthPreset,
            researchBreadth: options?.researchBreadth,
            researchDepth: options?.researchDepth,
          })
        })
        return
      }

      startBackgroundDeepResearch(placeholderMessage, researchBrief, abortController, {
        localContext: researchLocalContextResult.localContext,
        localRagSources: researchLocalContextResult.ragSources,
        localRagSourceDetails: researchLocalContextResult.ragSourceDetails,
        researchDepthPreset: options?.researchDepthPreset,
        researchBreadth: options?.researchBreadth,
        researchDepth: options?.researchDepth,
      })
    } catch (error) {
      await saveChat({
        ...placeholderMessage,
        content: `## 深度研究失败\n\n${error instanceof Error ? error.message : String(error)}`,
      }, true)
    } finally {
      if (!backgroundResearchStarted && abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      if (!backgroundResearchStarted) {
        setResearchRunning(false)
      }
    }
  }

  // Agent 确认回调 - 使用内联确认而不是弹窗
  const requestConfirmation = async (
    toolName: string,
    params: Record<string, unknown>,
    context?: {
      previewParams?: Record<string, unknown>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
    }
  ): Promise<boolean> => {
    const tool = getToolByName(toolName)
    const sessionApprovalScope = getSessionApprovalScope(toolName, tool, params)
    const canApproveForSession = !!sessionApprovalScope
    const persistentApprovalOptions = getPersistentApprovalOptions(toolName, tool, params)

    const currentChatState = useChatStore.getState()
    const activeConversationId = currentChatState.currentConversationId
    const autoApproveConversationId = currentChatState.agentAutoApproveConversationId
    const autoApproveRuntimeSkillId = currentChatState.agentAutoApproveRuntimeSkillId

    if (matchesSessionApproval(
      autoApproveConversationId,
      activeConversationId,
      autoApproveRuntimeSkillId,
      sessionApprovalScope
    )) {
      try {
        await recordPersistentApprovalHistory({
          toolName,
          params,
          status: 'confirmed',
          timestamp: Date.now(),
          scope: 'conversation',
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalSkillId: sessionApprovalScope?.skillId,
        }, activeConversationId)
      } catch (error) {
        console.error('[Agent Approval] Failed to record session approval history:', error)
      }
      return true
    }

    let persistentRule = null
    try {
      persistentRule = await findMatchingPersistentAgentApproval(toolName, tool, params)
    } catch (error) {
      console.error('[Agent Approval] Failed to read persistent approval rules:', error)
    }
    if (persistentRule) {
      try {
        await recordPersistentApprovalHistory({
          toolName,
          params,
          status: 'confirmed',
          timestamp: Date.now(),
          scope: persistentRule.scope,
        }, activeConversationId)
      } catch (error) {
        console.error('[Agent Approval] Failed to record persistent approval history:', error)
      }
      return true
    }

    return new Promise((resolve) => {
      const requestedAt = Date.now()

      // 将确认请求保存到 store，在对话中显示
      setAgentState({
        pendingConfirmation: {
          toolName,
          params,
          previewParams: context?.previewParams,
          ...context,
          canApproveForSession,
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalSkillId: sessionApprovalScope?.skillId,
          persistentApprovalOptions,
        }
      })
      
      // 轮询检查用户是否已确认或取消
      const checkInterval = setInterval(() => {
        const currentState = useChatStore.getState()
        
        // 如果 pendingConfirmation 被清除，说明用户已操作
        if (!currentState.agentState.pendingConfirmation) {
          clearInterval(checkInterval)
          const decision = [...currentState.agentState.confirmationHistory]
            .reverse()
            .find(record =>
              record.timestamp >= requestedAt &&
              record.toolName === toolName &&
              JSON.stringify(record.params) === JSON.stringify(params)
            )
          resolve(decision?.status === 'confirmed')
          return
        }

        if (!currentState.agentState.isRunning) {
          clearInterval(checkInterval)
          setAgentState({ pendingConfirmation: undefined })
          resolve(false)
        }
      }, 100)
    })
  }

  // Agent 模式处理
  async function handleAgentMode(imageUrls: string[], instructionOverride?: string, options?: ChatSendOptions) {
    const effectiveInstruction = instructionOverride ?? inputValue
    let effectiveWebSearchEnabled = resolveAutoWebSearchDecision(effectiveInstruction).enabled
    // 先创建一个占位的 AI 消息
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) {
      finishVisibleAgentRun()
      return
    }

    // 绑定真实占位消息，让会话区的即时状态从临时行平滑接管到 AI 消息行。
    primeAgentRunStatus(
      placeholderMessage.id,
      useChatStore.getState().agentState.currentStepStartTime || Date.now(),
      { userInput: effectiveInstruction, imageCount: imageUrls.length },
    )
    const liveAnswerUpdater = createLiveAgentAnswerUpdater(placeholderMessage)

    try {
      const { chats: chatsForContinuity } = useChatStore.getState()
      const continuity = analyzeConversationContinuity(chatsForContinuity, effectiveInstruction)
      const continuityPrompt = buildConversationContinuityPrompt(continuity)
      const contextQuery = continuity.retrievalQuery || effectiveInstruction
      if (!effectiveWebSearchEnabled && continuity.isFollowUp) {
        const contextualWebDecision = resolveAutoWebSearchDecision(contextQuery)
        if (contextualWebDecision.enabled) {
          effectiveWebSearchEnabled = true
        }
      }
      const routeDecision = classifyAgentTask({
        userInput: effectiveInstruction,
        imageCount: imageUrls.length,
        forcedSkillIds: options?.forcedSkillIds,
        webSearchEnabled: effectiveWebSearchEnabled,
        hasLinkedContext: effectiveLinkedResources.length > 0,
        hasQuote: Boolean(quoteData),
        hasRag: isRagEnabled,
        hasConversationHistory: continuity.hasHistory,
        conversationDependent: continuity.isFollowUp,
      })

      if (shouldBypassAgentRuntime(routeDecision)) {
        const { chats } = useChatStore.getState()
        const messages = buildMessagesWithHistory(
          chats,
          continuityPrompt || undefined,
          undefined,
          effectiveInstruction,
          {
            includeAssistantMessages: true,
            includeLatestUserMessage: false,
            maxUserMessages: getAgentHistoryTurnLimit(effectiveInstruction, continuity.isFollowUp),
            maxHistoryTokens: getAgentHistoryTokenBudget(effectiveInstruction, continuity.isFollowUp),
            maxSingleMessageTokens: AGENT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS,
          }
        )

        const agentHandler = new AgentHandler({
          activeChatId: placeholderMessage.id,
          webSearchEnabled: effectiveWebSearchEnabled,
          forcedSkillIds: options?.forcedSkillIds,
          taskRouteDecision: routeDecision,
          contextRetrievalQuery: contextQuery,
          requestConfirmation,
          currentQuote: quoteData
            ? {
                fileName: quoteData.fileName,
                startLine: quoteData.startLine,
                endLine: quoteData.endLine,
                from: quoteData.from,
                to: quoteData.to,
                fullContent: quoteData.fullContent,
              }
            : undefined,
          onAnswerDelta: liveAnswerUpdater.onAnswerDelta,
          onAnswerRejected: liveAnswerUpdater.clear,
          onComplete: async (result, steps, stopped) => {
            liveAnswerUpdater.flush()
            const { agentState } = useChatStore.getState()
            const completedSteps = steps && steps.length > 0
              ? steps
              : agentState.completedSteps || []

            let finalContent = sanitizeAgentFinalContent(
              stopped ? (result || t('record.chat.input.stopped')) : result
            )
            const currentState = useChatStore.getState()
            const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
            if (!stopped && !finalContent.trim()) {
              finalContent = sanitizeAgentFinalContent(
                agentState.finalAnswerContent
                  || agentState.agentPartSnapshot?.finalAnswerContent
                  || ''
              )
            }
            if (!stopped && !finalContent.trim()) {
              finalContent = formatAgentNoVisibleAnswerMessage()
            }
            const agentHistory = {
              steps: completedSteps,
              toolCalls: agentState.toolCalls,
              events: agentState.agentEvents,
              telemetry: agentState.telemetry,
              partSnapshot: agentState.agentPartSnapshot,
              contextSnapshot: agentState.agentContextSnapshot,
              runId: agentState.agentRunId,
              iterations: agentState.currentIteration,
              route: routeDecision,
            }

            await saveChat({
              id: placeholderMessage.id,
              tagId: placeholderMessage.tagId,
              conversationId: placeholderMessage.conversationId,
              role: placeholderMessage.role,
              type: placeholderMessage.type,
              inserted: placeholderMessage.inserted,
              createdAt: placeholderMessage.createdAt,
              ragSources: currentMessage?.ragSources,
              ragSourceDetails: currentMessage?.ragSourceDetails,
              content: finalContent,
              agentHistory: JSON.stringify(agentHistory),
            }, true)

            liveAnswerUpdater.cancel()
            finishVisibleAgentRun()
            agentHandlerRef.current = null
          },
          onError: async (error) => {
            liveAnswerUpdater.cancel()
            await saveChat({
              ...placeholderMessage,
              content: formatUserVisibleError(error),
            }, true)
            finishVisibleAgentRun()
            agentHandlerRef.current = null
          },
        })

        agentHandlerRef.current = agentHandler
        await agentHandler.execute(effectiveInstruction, messages, imageUrls)
        return
      }

      const orchestrator = new AgentOrchestrator()
      await orchestrator.run({
        userInput: effectiveInstruction,
        route: options?.routeOverride === 'workflow' ? 'workflow' : 'agent',
        conversationId: placeholderMessage.conversationId ?? null,
        assistantChatId: placeholderMessage.id,
        forcedSkillIds: options?.forcedSkillIds,
        webSearchEnabled: effectiveWebSearchEnabled,
        agentExecutor: async (runControl) => {
          setAgentState({
            activeChatId: placeholderMessage.id,
            agentRunId: runControl.runId,
          })

          // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
          const agentHandler = new AgentHandler({
            runControl,
            activeChatId: placeholderMessage.id,
            webSearchEnabled: effectiveWebSearchEnabled,
            forcedSkillIds: options?.forcedSkillIds,
            taskRouteDecision: routeDecision,
            contextRetrievalQuery: contextQuery,
            requestConfirmation,
            currentQuote: quoteData
              ? {
                  fileName: quoteData.fileName,
                  startLine: quoteData.startLine,
                  endLine: quoteData.endLine,
                  from: quoteData.from,
                  to: quoteData.to,
                  fullContent: quoteData.fullContent,
                }
              : undefined,
            onAnswerDelta: liveAnswerUpdater.onAnswerDelta,
            onAnswerRejected: liveAnswerUpdater.clear,
            onComplete: async (result, steps, stopped) => {
              liveAnswerUpdater.flush()
              // 获取 Agent 执行历史，保存完整的 ReAct 步骤
              const { agentState } = useChatStore.getState()
              const completedSteps = steps && steps.length > 0
                ? steps
                : agentState.completedSteps || []

              // 如果是被终止的，构建包含终止信息的消息
              let finalContent = result
              if (stopped) {
                // 保留已产生的步骤，并添加终止信息
                const stepCount = completedSteps.length
                if (stepCount > 0) {
                  // 有已完成的步骤，显示这些步骤的内容
                  finalContent = `${t('record.chat.input.stopped')}\n\n已完成 ${stepCount} 个步骤：\n${completedSteps.map((step, i) =>
                    `${i + 1}. ${step.action?.tool || '思考'}`
                  ).join('\n')}`
                } else {
                  // 没有已完成步骤，显示简单的终止信息
                  finalContent = t('record.chat.input.stopped')
                }
              }

              if (!stopped) {
                const partialSuccessContent = buildPartialSuccessContent(result, agentState.toolCalls)
                if (partialSuccessContent && isLikelyErrorContent(finalContent)) {
                  finalContent = partialSuccessContent
                }
              }

              finalContent = sanitizeAgentFinalContent(finalContent)

              if (finalContent) {
                await runControl.writeDraft('final-answer.md', finalContent, finalContent.replace(/\s+/g, ' ').slice(0, 240))
              }

              const agentHistory = {
                steps: completedSteps,
                toolCalls: agentState.toolCalls,
                events: agentState.agentEvents,
                telemetry: agentState.telemetry,
                partSnapshot: agentState.agentPartSnapshot,
                contextSnapshot: agentState.agentContextSnapshot,
                harnessSnapshot: runControl.getSnapshot(),
                runId: agentState.agentRunId || runControl.runId,
                iterations: agentState.currentIteration,
              }

              // 获取当前消息状态，保留 ragSources 和 ragSourceDetails
              const currentState = useChatStore.getState()
              const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
              if (!stopped && !finalContent.trim()) {
                finalContent = sanitizeAgentFinalContent(
                  agentState.finalAnswerContent
                    || agentState.agentPartSnapshot?.finalAnswerContent
                    || ''
                )
              }
              if (!stopped && !finalContent.trim()) {
                finalContent = formatAgentNoVisibleAnswerMessage()
              }

              // 更新占位消息，保留 RAG 相关字段
              await saveChat({
                id: placeholderMessage.id,
                tagId: placeholderMessage.tagId,
                conversationId: placeholderMessage.conversationId,
                role: placeholderMessage.role,
                type: placeholderMessage.type,
                inserted: placeholderMessage.inserted,
                createdAt: placeholderMessage.createdAt,
                // 保留来自 currentMessage 的 RAG 相关字段
                ragSources: currentMessage?.ragSources,
                ragSourceDetails: currentMessage?.ragSourceDetails,
                // 设置新的内容
                content: finalContent,
                agentHistory: JSON.stringify(agentHistory),
              }, true)

              liveAnswerUpdater.cancel()
              finishVisibleAgentRun()
              agentHandlerRef.current = null

              if (!stopped) {
                const hasSuccessfulToolCall = agentState.toolCalls.some(call => call.result?.success)
                void triggerAutoExtractSuggestion({
                  finalContent,
                  placeholderMessageId: placeholderMessage.id,
                  conversationId: placeholderMessage.conversationId,
                  userInput: options?.displayText || effectiveInstruction,
                  hasSuccessfulToolCall,
                }).catch(error => {
                  console.warn('[Agent] Auto extract suggestion failed:', error)
                })
              }
            },
            onError: async (error) => {
              // 获取当前消息状态，保留 ragSources 和 ragSourceDetails
              const currentState = useChatStore.getState()
              const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)

              // 更新占位消息为错误信息，保留 RAG 相关字段
              liveAnswerUpdater.cancel()
              await saveChat({
                id: placeholderMessage.id,
                tagId: placeholderMessage.tagId,
                conversationId: placeholderMessage.conversationId,
                role: placeholderMessage.role,
                type: placeholderMessage.type,
                inserted: placeholderMessage.inserted,
                createdAt: placeholderMessage.createdAt,
                // 保留来自 currentMessage 的 RAG 相关字段
                ragSources: currentMessage?.ragSources,
                ragSourceDetails: currentMessage?.ragSourceDetails,
                content: formatUserVisibleError(error),
              }, true)

              finishVisibleAgentRun()
              agentHandlerRef.current = null
            },
          })

          // 保存到 ref
          agentHandlerRef.current = agentHandler

          // 使用统一的上下文构建器
          const useArticleStore = (await import('@/stores/article')).default
          const articleStore = useArticleStore.getState()
          const hasDocumentContext = Boolean(
            (allowAutoCurrentFileContext && articleStore.currentArticle && articleStore.activeFilePath) ||
            effectiveLinkedResources.length > 0 ||
            quoteData
          )
          const groundedWeb = resolveGroundedWebSearchDecision(contextQuery, hasDocumentContext)

          const contextResult = await buildChatContext({
            linkedResources: effectiveLinkedResources,
            linkedResourcePreviews,
            linkedResourcePreview,
            quoteData,
            isRagEnabled,
            webSearchEnabled: groundedWeb.effectiveWebSearchEnabled,
            userQuery: contextQuery,
            webSearchQuery: groundedWeb.effectiveWebSearchEnabled ? buildWebSearchQuery(contextQuery) || undefined : undefined,
            contextBudget: AGENT_CONTEXT_TOTAL_LIMIT,
            currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
            activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
          })

          const { context, ragSources, ragSourceDetails, sections: chatContextSections } = contextResult
          const visibleRagSourceDetails = ragSourceDetails
          const visibleRagSources = ragSources

          // Phase 1 #B：把结构化 sections 写回 agentHandler
          // 必须在 execute() 之前调用；setContextSections 会替换 config.contextSections
          agentHandler.setContextSections({
            currentDoc: chatContextSections?.current || chatContextSections?.quote,
            linkedFiles: chatContextSections?.linked,
            rag: chatContextSections?.rag,
            webSearch: chatContextSections?.web,
            extras: [
              ...(continuityPrompt
                ? [{
                    id: 'conversation-continuity',
                    content: continuityPrompt,
                    priority: 90,
                    truncateStrategy: 'drop-subsection' as const,
                    minTokens: 80,
                  }]
                : []),
              ...(groundedWeb.documentDecision.instruction
                ? [{
                    id: 'document-grounding-instruction',
                    content: groundedWeb.documentDecision.instruction,
                    priority: 85,
                    truncateStrategy: 'drop-whole' as const,
                    minTokens: 60,
                  }]
                : []),
            ],
          })

          // 如果启用了 Web 搜索，添加提示
          let agentContext = groundedWeb.documentDecision.instruction
            ? `${groundedWeb.documentDecision.instruction}\n\n${context}`
            : context
          if (groundedWeb.effectiveWebSearchEnabled) {
            agentContext = `${buildWebSearchInstruction(groundedWeb.webDecision)}请优先使用 web_search 获取实时网页资料；需要读取具体网页正文时优先使用 web_extract，只有在需要原始响应或正文提取不可用时再使用 web_fetch。\n\n${agentContext}`
          }

          await runControl.setContextPack({
            tokenBudget: AGENT_CONTEXT_TOTAL_LIMIT,
            items: buildHarnessContextItems({
              userInput: effectiveInstruction,
              context: [continuityPrompt, agentContext].filter(section => section.trim()).join('\n\n'),
              ragSourceDetails: visibleRagSourceDetails,
              forcedSkillIds: options?.forcedSkillIds,
            }),
          })

          // 设置到 agentState，用于实时显示
          if (visibleRagSources.length > 0) {
            const filteredSourceDetails = visibleRagSourceDetails
              .filter(d => d.sourceType !== 'web')
              .map(d => ({
                filepath: d.filepath,
                filename: d.filename,
                content: d.content,
                sourceType: d.sourceType as 'rag' | 'current' | 'linked' | 'quote' | undefined,
                startLine: d.startLine,
                endLine: d.endLine,
                from: d.from,
                to: d.to,
              }))
            setAgentState({
              ragSources: visibleRagSources,
              ragSourceDetails: filteredSourceDetails,
            })
          }

          // 保存本轮上下文来源到 AI 消息中
          if (visibleRagSources.length > 0 || visibleRagSourceDetails.length > 0) {
            await saveChat({
              ...placeholderMessage,
              ragSources: JSON.stringify(visibleRagSources),
              ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
            }, true)
          }

          // 构建消息数组
          const { chats } = useChatStore.getState()

          const messages = buildMessagesWithHistory(
            chats,
            undefined,
            undefined,
            effectiveInstruction,
            {
              includeAssistantMessages: true,
              includeLatestUserMessage: false,
              maxUserMessages: getAgentHistoryTurnLimit(effectiveInstruction, continuity.isFollowUp),
              maxHistoryTokens: getAgentHistoryTokenBudget(effectiveInstruction, continuity.isFollowUp),
              maxSingleMessageTokens: AGENT_MAX_SINGLE_HISTORY_MESSAGE_TOKENS,
            }
          )

          return agentHandler.execute(effectiveInstruction, messages, imageUrls)
        },
      })
    } catch (error) {
      console.error('Agent execution error:', error)
      liveAnswerUpdater.cancel()
      const currentState = useChatStore.getState()
      const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
      const visibleCurrentContent = sanitizeAgentFinalContent(currentMessage?.content || '')
      if (visibleCurrentContent) {
        await saveChat({
          ...currentMessage!,
          content: visibleCurrentContent,
        }, true)
      } else {
        await saveChat({
          ...placeholderMessage,
          ragSources: currentMessage?.ragSources,
          ragSourceDetails: currentMessage?.ragSourceDetails,
          content: formatUserVisibleError(error),
        }, true)
      }
      finishVisibleAgentRun()
    } finally {
      agentHandlerRef.current = null
    }
  }

  // 对话（Agent 模式）
  async function handleSubmit(instructionOverride?: unknown, options?: ChatSendOptions) {
    const effectiveInstruction =
      typeof instructionOverride === 'string' ? instructionOverride : undefined
    const liveInputValue = getLiveInputValue?.() || inputValue
    const requestText = effectiveInstruction ?? liveInputValue
    const displayText = options?.displayText?.trim() || liveInputValue.trim()

    if (!requestText.trim() || !displayText) return
    if (submitInFlightRef.current || isRunning) return

    submitInFlightRef.current = true
    let keepLoading = false
    try {
      const conversationTitle = displayText.replace(/\s+/g, ' ').slice(0, 30) || '新对话'
      await ensureCurrentConversation(conversationTitle)

      onSent?.(displayText)

      const imageUrls = attachedImages.map(img => img.url)
      const effectiveMode = options?.modeOverride || chatMode
      const effectiveRoute = options?.routeOverride || effectiveMode
      const shouldPrimeAgentRunStatus = effectiveRoute === 'agent' || effectiveRoute === 'workflow'
      if (shouldPrimeAgentRunStatus) {
        primeAgentRunStatus(undefined, Date.now(), {
          userInput: requestText,
          imageCount: imageUrls.length,
        })
      }

      const userMessage = await insert({
        tagId: currentTagId,
        role: 'user',
        content: displayText,
        type: 'chat',
        inserted: false,
        images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
        quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
      })
      if (!userMessage) {
        if (shouldPrimeAgentRunStatus) {
          finishVisibleAgentRun()
        }
        return
      }

      setLoading(true)
      const webDecision = resolveAutoWebSearchDecision(requestText)
      const effectiveWebSearchEnabled = webDecision.enabled
      if (effectiveRoute === 'writer' || effectiveRoute === 'advisor') {
        const orchestrator = new AgentOrchestrator()
        await orchestrator.run({
          userInput: requestText,
          route: effectiveRoute,
          forcedSkillIds: options?.forcedSkillIds,
          webSearchEnabled: effectiveWebSearchEnabled,
          writerExecutor: async () => handleWriterMode(imageUrls, effectiveInstruction, options),
        })
      } else if (effectiveRoute === 'chat') {
        await handleChatMode(imageUrls, effectiveInstruction, options)
      } else if (effectiveRoute === 'research') {
        await handleClarifiedResearchMode(effectiveInstruction, options)
        keepLoading = abortControllerRef.current !== null
      } else {
        await handleAgentMode(imageUrls, effectiveInstruction, options)
      }
    } finally {
      submitInFlightRef.current = false
      if (!keepLoading) {
        setLoading(false)
      }
    }
  }

  const handleStop = async () => {
    // 停止普通对话的流式输出
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // 停止 Agent 执行
    const hasActiveAgentHandler = Boolean(agentHandlerRef.current)
    if (agentHandlerRef.current) {
      agentHandlerRef.current.stop()
      // 不立即清空 ref，等待 Agent 的错误处理完成并调用 onComplete
    }

    // 重置 loading 状态
    setAgentState({
      pendingConfirmation: undefined,
      ...(hasActiveAgentHandler
        ? {}
        : {
            activeChatId: undefined,
            isRunning: false,
            isThinking: false,
            isFinalAnswerMode: false,
            finalAnswerContent: undefined,
            currentStepStartTime: undefined,
            activity: undefined,
          }),
    })
    setResearchRunning(false)
    setLoading(false)
  }

  useImperativeHandle(ref, () => ({
    sendChat: (instructionOverride?: string, options?: ChatSendOptions) => {
      void handleSubmit(instructionOverride, options)
    },
    stopChat: handleStop,
  }))

  if (hideButton || (hideIdleButton && !isRunning)) {
    return null
  }

  return (
    <>
      <TooltipButton 
        variant={isRunning ? "destructive" : "ghost"}
        size="icon"
        icon={isRunning ? <Square className="size-4" /> : <Send className="size-4" />} 
        disabled={!isRunning && (!primaryModel || (!effectiveInputValue.trim() && !canSubmitOverride))}
        tooltipText={isRunning ? t('record.chat.input.stop') : t('record.chat.input.send')} 
        buttonClassName={isRunning
          ? "h-8 w-8 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "h-8 w-8 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:bg-muted/50 disabled:text-muted-foreground"
        }
        onClick={() => {
          if (isRunning) {
            void handleStop()
            return
          }

          const currentInputValue = syncLiveInputValue() || effectiveInputValue
          if (onSubmitOverride?.(currentInputValue) === true) {
            return
          }

          void handleSubmit(currentInputValue)
        }} 
      />
    </>
  )
})

ChatSend.displayName = 'ChatSend';
