"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { fetchAiStream, type AiStreamFinishMetadata } from "@/lib/ai/chat"
import { decideAutoWebSearch, type AutoWebSearchDecision } from "@/lib/ai/auto-web-search"
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
  formatYamlScalar,
} from "@/lib/research/report-file"
import type { Chat } from "@/db/chats"
import { toast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import {
  buildChatContext,
  type QuoteData,
  type ChatCitationSource,
} from "@/lib/ai/context-builder"

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
  const meta = encodeResearchResumeData({
    sessionId: session.id,
    query: session.query,
    startedAt: session.startedAt,
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
    `**剩余查询：** ${session.pendingQueriesCount}`,
    `**已找到来源：** ${session.sourcesCount}`,
    `**已提取证据：** ${session.evidencesCount}`,
    '',
    '点击下方「继续研究」按钮，或输入「继续研究」可从断点恢复。若要新建研究，请发送新主题并包含「直接开始研究」。',
  ].join('\n')
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
  const lastAutoSuggestMessageIdRef = useRef<number | null>(null)
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
  const resolveAutoWebSearchDecision = (userInput: string) => decideAutoWebSearch({
    userInput,
    manualDefaultEnabled: webSearchEnabled,
    hasSearchProvider: true,
  })

  // 跟踪上一次的 loading 状态
  const wasLoadingRef = useRef(false)

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

  async function getLatestUnfinishedResearchSession(): Promise<DeepResearchSessionSummary | null> {
    const sessions = await listUnfinishedResearchSessions(1)
    return sessions[0] || null
  }

  function notifyResearchResumeAvailable(session: DeepResearchSessionSummary, onResume: () => void) {
    toast({
      title: '发现未完成的研究任务',
      description: `还有 ${session.pendingQueriesCount} 个查询未完成，来源 ${session.sourcesCount} 个。点击下方按钮或输入「继续研究」恢复。`,
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

  const createPreparingAgentActivity = (startedAt: number) => ({
    label: '正在准备 Agent',
    phase: 'preparing' as const,
    startedAt,
  })

  const primeAgentRunStatus = (activeChatId?: number, startedAt = Date.now()) => {
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
      activity: createPreparingAgentActivity(startedAt),
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
    const webDecision = resolveAutoWebSearchDecision(effectiveInstruction)
    const effectiveWebSearchEnabled = webDecision.enabled
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
      // 使用统一的上下文构建器
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()

      const contextResult = await buildChatContext({
        linkedResources: effectiveLinkedResources,
        linkedResourcePreviews,
        linkedResourcePreview,
        quoteData,
        isRagEnabled,
        webSearchEnabled: effectiveWebSearchEnabled,
        userQuery: effectiveInstruction,
        webSearchQuery: effectiveWebSearchEnabled ? buildWebSearchQuery(effectiveInstruction) || undefined : undefined,
        contextBudget: 15000,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const visibleRagSourceDetails = ragSourceDetails
      const visibleRagSources = ragSources
      const systemContext = effectiveWebSearchEnabled
        ? `${buildWebSearchInstruction(webDecision)}${context}`
        : context

      const { chats: currentChats } = useChatStore.getState()
      const latestUserChatId = currentChats
        .filter(chat => chat.role === 'user')
        .at(-1)?.id
      const messages = [
        ...currentChats
          .filter(chat => chat.id !== latestUserChatId)
          .filter(chat => chat.type === 'chat' && (chat.role === 'user' || chat.role === 'system') && chat.content)
          .map(chat => ({
            role: chat.role === 'user' ? 'user' as const : 'assistant' as const,
            content: chat.condensedContent || chat.content || '',
          })),
        ...(systemContext
          ? [{
              role: 'system' as const,
              content: systemContext,
            }]
          : []),
        {
          role: 'user' as const,
          content: effectiveInstruction,
        },
      ]

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
      const result = await fetchAiStream(
        effectiveInstruction,
        async (content) => {
          finalContent = content
          await saveChat({
            ...placeholderMessage,
            content,
            thinking: thinkingContent || undefined,
            ragSources: JSON.stringify(visibleRagSources),
            ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
          }, false)
        },
        abortController.signal,
        undefined,
        t,
        placeholderMessage.id,
        imageUrls,
        // 思考内容更新回调
        async (thinking: string) => {
          thinkingContent = thinking
          await saveChat({
            ...placeholderMessage,
            thinking,
            ragSources: JSON.stringify(visibleRagSources),
            ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
          }, false)
        },
        messages,
        options?.maxTokens,
        (metadata) => {
          streamMeta = metadata
        },
      )
      if (!finalContent && result) {
        finalContent = result
      }

      if (!abortController.signal.aborted && !cleanAssistantGeneratedContent(finalContent).trim()) {
        finalContent = formatEmptyAiResponseMessage(streamMeta, thinkingContent)
      }

      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? (finalContent || t('record.chat.input.stopped')) : finalContent,
        ragSources: JSON.stringify(visibleRagSources),
        ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
      }, true)
    } catch (error) {
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
    const webDecision = resolveAutoWebSearchDecision(effectiveInstruction)
    const effectiveWebSearchEnabled = webDecision.enabled
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

    try {
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()

      const contextResult = await buildChatContext({
        linkedResources: effectiveLinkedResources,
        linkedResourcePreviews,
        linkedResourcePreview,
        quoteData,
        isRagEnabled,
        webSearchEnabled: effectiveWebSearchEnabled,
        userQuery: effectiveInstruction,
        webSearchQuery: effectiveWebSearchEnabled ? buildWebSearchQuery(effectiveInstruction) || undefined : undefined,
        contextBudget: 24000,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const visibleRagSourceDetails = ragSourceDetails
      const visibleRagSources = ragSources
      const systemContext = effectiveWebSearchEnabled
        ? `${buildWebSearchInstruction(webDecision)}${context}`
        : context

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
      const latestUserChatId = currentChats
        .filter(chat => chat.role === 'user')
        .at(-1)?.id
      const messages = [
        ...currentChats
          .filter(chat => chat.id !== latestUserChatId)
          .filter(chat => chat.type === 'chat' && (chat.role === 'user' || chat.role === 'system') && chat.content)
          .map(chat => ({
            role: chat.role === 'user' ? 'user' as const : 'assistant' as const,
            content: chat.condensedContent || chat.content || '',
          })),
        {
          role: 'system' as const,
          content: [
            '你正在执行一个写作型 Skill。请直接输出用户可用的正文，保持自然连贯。',
            '不要输出工具调用、执行日志、JSON 包装、Action/Observation、Final Answer 标签或对 Skill 包装提示的解释。',
            '中文内容必须保持 UTF-8 正常字符，避免 mojibake、替换字符和乱码。',
            systemContext ? `\n## 可用上下文\n\n${systemContext}` : '',
          ].filter(Boolean).join('\n'),
        },
        {
          role: 'user' as const,
          content: writerInstruction,
        },
      ]

      let finalContent = ''
      let thinkingContent = ''
      let streamMeta: AiStreamFinishMetadata | null = null
      const result = await fetchAiStream(
        writerInstruction,
        async (content) => {
          finalContent = cleanAssistantGeneratedContent(content)
          await saveChat({
            ...placeholderMessage,
            content: finalContent,
            thinking: thinkingContent || undefined,
            ragSources: JSON.stringify(visibleRagSources),
            ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
          }, false)
        },
        abortController.signal,
        undefined,
        t,
        placeholderMessage.id,
        imageUrls,
        async (thinking: string) => {
          thinkingContent = thinking
          await saveChat({
            ...placeholderMessage,
            thinking,
            ragSources: JSON.stringify(visibleRagSources),
            ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
          }, false)
        },
        messages,
        options?.maxTokens,
        (metadata) => {
          streamMeta = metadata
        },
      )

      if (!finalContent && result) {
        finalContent = cleanAssistantGeneratedContent(result)
      }

      if (!abortController.signal.aborted && !finalContent.trim()) {
        finalContent = formatEmptyAiResponseMessage(streamMeta, thinkingContent)
      }

      const savedContent = abortController.signal.aborted
        ? (finalContent || t('record.chat.input.stopped'))
        : finalContent
      await saveChat({
        ...placeholderMessage,
        content: savedContent,
        ragSources: JSON.stringify(visibleRagSources),
        ragSourceDetails: JSON.stringify(visibleRagSourceDetails),
      }, true)

      return savedContent
    } catch (error) {
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
    const researchRunId = `research-${placeholderMessage.id}-${startedAt}`
    const eventBus = createAgentEventBus({
      runId: researchRunId,
      onEvent: (event) => {
        useChatStore.getState().recordResearchEvent(event)
      },
    })
    setResearchRunning(true)
    startResearchRun({
      runId: researchRunId,
      activeChatId: placeholderMessage.id,
      query,
      startedAt,
      sessionId: options.sessionId,
    })

    try {
      const startingView = buildResearchBackgroundView('starting', query, startedAt)
      updateResearchProgressView(startingView)
      await saveChat({
        ...placeholderMessage,
        content: encodeResearchProgressView(startingView),
      }, false)

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
          if (!shouldSaveImmediately && now - lastProgressSavedAt < 700) {
            return
          }
          lastProgressSavedAt = now

          void saveChat({
            ...placeholderMessage,
            content: formatResearchProgress(progress, query, startedAt),
          }, false).catch(error => {
            console.error('[DeepResearch] Failed to save progress:', error)
          })
        },
      })
      researchFinished = true

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
          const quality = result.quality
          const qualityNote = formatResearchQualityNote(result)
          const frontmatter = [
            '---',
            `title: ${formatYamlScalar(reportTarget.title)}`,
            `date: ${now.toISOString()}`,
            'type: research_report',
            `session_id: ${result.session.id}`,
            `strategy: ${result.session.strategy}`,
            typeof result.session.breadth === 'number' ? `research_breadth: ${result.session.breadth}` : '',
            typeof result.session.depth === 'number' ? `research_depth: ${result.session.depth}` : '',
            `sources_count: ${result.sources.length}`,
            `evidence_count: ${result.evidences.length}`,
            `visited_urls: ${result.visitedUrls.length}`,
            result.session.cacheStats ? `search_cache_hits: ${result.session.cacheStats.hits}` : '',
            result.session.cacheStats ? `search_cache_misses: ${result.session.cacheStats.misses}` : '',
            result.session.cacheStats ? `search_cache_writes: ${result.session.cacheStats.writes}` : '',
            result.session.cacheStats
              ? `search_cache_hit_rate: ${(
                  result.session.cacheStats.hits /
                  Math.max(1, result.session.cacheStats.hits + result.session.cacheStats.misses)
                ).toFixed(3)}`
              : '',
            result.session.providerHealth?.length
              ? `search_provider_health: ${formatYamlScalar(JSON.stringify(result.session.providerHealth))}`
              : '',
            quality ? `quality_grade: ${quality.grade}` : '',
            quality ? `quality_score: ${quality.overall}` : '',
            quality ? `quality_source_diversity: ${quality.sourceDiversity}` : '',
            quality ? `quality_evidence_strength: ${quality.evidenceStrength}` : '',
            quality ? `quality_coverage: ${quality.coverage}` : '',
            quality ? `quality_summary: ${formatYamlScalar(quality.summary)}` : '',
            '---',
          ].filter(Boolean)
          const reportFileContent = [
            ...frontmatter,
            '',
            qualityNote,
            result.report,
          ].join('\n')

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
          const sessionJson = JSON.stringify(result.session, null, 2)
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
        sessionId: options.sessionId,
        error: error instanceof Error ? error.message : String(error),
      }, { level: 'error' })
      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted
          ? t('record.chat.input.stopped')
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

      researchLocalContextResult = await buildResearchLocalContext(trimmedInstruction)
      const { chats: currentChats } = useChatStore.getState()
      const previousResearchMessage = [...currentChats]
        .reverse()
        .find(chat => chat.role === 'system' && chat.type === 'chat' && chat.content)
      let pendingClarification = parseResearchClarificationMeta(previousResearchMessage?.content)

      // 如果当前会话中找不到澄清消息，但用户想直接开始研究，
      // 尝试从最近的其他会话中查找（处理会话切换/重建的情况）
      if (!pendingClarification && wantsDirectStart) {
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
        content: '正在梳理你的研究需求...',
      }, false)

      const clarification = await generateResearchClarification({
        query: trimmedInstruction,
        localContextBrief: researchLocalContextResult.localContext?.brief,
        abortSignal: abortController.signal,
      })

      if (!clarification.canStart && clarification.questions.length > 0) {
        await saveChat({
          ...placeholderMessage,
          content: formatResearchClarificationMessage(trimmedInstruction, clarification.questions),
        }, true)
        return
      }

      backgroundResearchStarted = true
      const resumeSession = await getLatestUnfinishedResearchSession()
      const researchBrief = clarification.researchBrief || trimmedInstruction

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
    const webDecision = resolveAutoWebSearchDecision(effectiveInstruction)
    const effectiveWebSearchEnabled = webDecision.enabled
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
    )

    try {
      const routeDecision = classifyAgentTask({
        userInput: effectiveInstruction,
        imageCount: imageUrls.length,
        forcedSkillIds: options?.forcedSkillIds,
        webSearchEnabled: effectiveWebSearchEnabled,
        hasLinkedContext: effectiveLinkedResources.length > 0,
        hasQuote: Boolean(quoteData),
        hasRag: isRagEnabled,
      })

      if (shouldBypassAgentRuntime(routeDecision)) {
        const agentHandler = new AgentHandler({
          activeChatId: placeholderMessage.id,
          webSearchEnabled: effectiveWebSearchEnabled,
          forcedSkillIds: options?.forcedSkillIds,
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
          onComplete: async (result, steps, stopped) => {
            const { agentState } = useChatStore.getState()
            const completedSteps = steps && steps.length > 0
              ? steps
              : agentState.completedSteps || []

            const finalContent = sanitizeAgentFinalContent(
              stopped ? (result || t('record.chat.input.stopped')) : result
            )
            const currentState = useChatStore.getState()
            const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
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

            finishVisibleAgentRun()
            agentHandlerRef.current = null
          },
          onError: async (error) => {
            await saveChat({
              ...placeholderMessage,
              content: formatUserVisibleError(error),
            }, true)
            finishVisibleAgentRun()
            agentHandlerRef.current = null
          },
        })

        agentHandlerRef.current = agentHandler
        await agentHandler.execute(effectiveInstruction, undefined, imageUrls)
        return
      }

      const orchestrator = new AgentOrchestrator()
      await orchestrator.run({
        userInput: effectiveInstruction,
        route: options?.routeOverride === 'workflow' ? 'workflow' : 'agent',
        conversationId: placeholderMessage.conversationId ?? null,
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
            onComplete: async (result, steps, stopped) => {
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

          const contextResult = await buildChatContext({
            linkedResources: effectiveLinkedResources,
            linkedResourcePreviews,
            linkedResourcePreview,
            quoteData,
            isRagEnabled,
            webSearchEnabled: effectiveWebSearchEnabled,
            userQuery: effectiveInstruction,
            webSearchQuery: effectiveWebSearchEnabled ? buildWebSearchQuery(effectiveInstruction) || undefined : undefined,
            contextBudget: AGENT_CONTEXT_TOTAL_LIMIT,
            currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
            activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
          })

          const { context, ragSources, ragSourceDetails, sections: chatContextSections } = contextResult
          const visibleRagSourceDetails = ragSourceDetails
          const visibleRagSources = ragSources

          // Phase 1 #B：把结构化 sections 写回 agentHandler
          // 必须在 execute() 之前调用；setContextSections 会替换 config.contextSections
          if (chatContextSections) {
            agentHandler.setContextSections({
              currentDoc: chatContextSections.current || chatContextSections.quote,
              linkedFiles: chatContextSections.linked,
              rag: chatContextSections.rag,
              webSearch: chatContextSections.web,
            })
          }

          // 如果启用了 Web 搜索，添加提示
          let agentContext = context
          if (effectiveWebSearchEnabled) {
            agentContext = `${buildWebSearchInstruction(webDecision)}请优先使用 web_search 获取实时网页资料；需要读取具体网页正文时优先使用 web_extract，只有在需要原始响应或正文提取不可用时再使用 web_fetch。\n\n${context}`
          }

          await runControl.setContextPack({
            tokenBudget: AGENT_CONTEXT_TOTAL_LIMIT,
            items: buildHarnessContextItems({
              userInput: effectiveInstruction,
              context: agentContext,
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
          const { buildMessagesWithHistory } = await import('@/lib/ai/condense')

          const messages = buildMessagesWithHistory(
            chats,
            undefined,
            agentContext,
            effectiveInstruction,
            {
              includeAssistantMessages: true,
              includeLatestUserMessage: false,
              maxUserMessages: shouldCarryUserHistoryForAgent(effectiveInstruction) ? 3 : 0,
            }
          )

          return agentHandler.execute(effectiveInstruction, messages, imageUrls)
        },
      })
    } catch (error) {
      console.error('Agent execution error:', error)
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

    const conversationTitle = displayText.replace(/\s+/g, ' ').slice(0, 30) || '新对话'
    await ensureCurrentConversation(conversationTitle)

    onSent?.(displayText)

    const imageUrls = attachedImages.map(img => img.url)
    const effectiveMode = options?.modeOverride || chatMode
    const effectiveRoute = options?.routeOverride || effectiveMode
    const shouldPrimeAgentRunStatus = effectiveRoute === 'agent' || effectiveRoute === 'workflow'
    if (shouldPrimeAgentRunStatus) {
      primeAgentRunStatus(undefined, Date.now())
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
    let keepLoading = false
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
    if (!keepLoading) {
      setLoading(false)
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
        disabled={!isRunning && (!primaryModel || (!inputValue.trim() && !canSubmitOverride))} 
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

          const liveInputValue = getLiveInputValue?.() || inputValue
          if (onSubmitOverride?.(liveInputValue) === true) {
            return
          }

          void handleSubmit()
        }} 
      />
    </>
  )
})

ChatSend.displayName = 'ChatSend';
