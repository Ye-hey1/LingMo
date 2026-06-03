"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { fetchAiStream } from "@/lib/ai/chat"
import { type LinkedResource } from "@/lib/files"
import { getWorkspacePath, getFilePathOptions } from "@/lib/workspace"
import {
  AgentHandler,
  getToolByName,
  getSessionApprovalScope,
  matchesSessionApproval,
  findMatchingPersistentAgentApproval,
  getPersistentApprovalOptions,
  recordPersistentApprovalHistory,
} from "@/lib/agent"
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
  type DeepResearchSessionSummary,
} from "@/lib/research/session-store"
import {
  buildResearchProgressView,
  encodeResearchProgressView,
} from "@/lib/research/progress-status"
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
  onSent?: () => void;
  linkedResource?: LinkedResource | null;
  linkedResources?: LinkedResource[];
  linkedResourcePreviews?: Record<string, string | null>;
  attachedImages?: ImageAttachment[];
  quoteData?: QuoteData | null;
  webSearchEnabled?: boolean;
  allowAutoCurrentFileContext?: boolean;
  hideButton?: boolean;
  hideIdleButton?: boolean;
}

const MIN_AUTO_EXTRACT_CHAR_COUNT = 500
const AGENT_CONTEXT_TOTAL_LIMIT = 70000
const AI_DOC_COMMAND_PREFIX = '你正在执行一个应用内命令：'

function buildAutoNoteTitle(userInput: string) {
  const normalized = userInput
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')

  const fallback = `对话要点-${new Date().toISOString().slice(0, 10)}`
  return (normalized || fallback).slice(0, 28)
}

function isLikelyErrorContent(content: string) {
  return /^工具 .+执行失败[:：]|^工具 .+执行出错[:：]|^Error:/.test(content.trim())
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

function shouldSuggestExtractToNote(content: string, hasSuccessfulToolCall: boolean) {
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

function formatResearchBackgroundStatus(
  status: 'starting' | 'collecting' | 'writing',
  query: string,
  startedAt: number,
) {
  const view = buildResearchProgressView(null, {
    query,
    startedAt,
    estimatedMinutes: '3-6 分钟',
  })
  return encodeResearchProgressView({
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
  })
}

const RESEARCH_CLARIFICATION_PREFIX = '<!-- deep-research-clarification '
const RESEARCH_CLARIFICATION_SUFFIX = ' -->'

type ResearchClarificationMeta = {
  originalQuery: string
  questions: string[]
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
  return [
    '## 发现未完成的 Research',
    '',
    `主题：${session.query}`,
    `开始时间：${startedText}`,
    `剩余查询：${session.pendingQueriesCount}`,
    `已找到来源：${session.sourcesCount}`,
    `已提取证据：${session.evidencesCount}`,
    '',
    '已在右下角提供“继续研究”入口。点击后会从保存的断点继续执行。若要新建研究，请再次发送并包含“直接开始研究”。',
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
  sendChat: (instructionOverride?: string, options?: { maxTokens?: number; temperature?: number }) => void
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
  hideButton = false,
  hideIdleButton = false,
}, ref) => {
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const {
    insert,
    loading,
    researchRunning,
    chatMode,
    setLoading,
    setResearchRunning,
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
  const isRunning = loading || researchRunning

  // 跟踪上一次的 loading 状态
  const wasLoadingRef = useRef(false)

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
      title: '发现未完成的 Research',
      description: `还有 ${session.pendingQueriesCount} 个查询未完成，来源 ${session.sourcesCount} 个。`,
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

    if (!shouldSuggestExtractToNote(finalContent, hasSuccessfulToolCall)) {
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

  async function handleChatMode(imageUrls: string[], instructionOverride?: string) {
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
        webSearchEnabled,
        userQuery: effectiveInstruction,
        webSearchQuery: webSearchEnabled ? buildWebSearchQuery(effectiveInstruction) || undefined : undefined,
        contextBudget: 15000,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const diagnosticDetail: ChatCitationSource = {
        filepath: 'rag-diagnostics',
        filename: 'RAG 检索诊断',
        content: [
          `策略：${contextResult.diagnostics.strategy}`,
          contextResult.diagnostics.ragSkippedReason ? `跳过原因：${contextResult.diagnostics.ragSkippedReason}` : '',
          contextResult.diagnostics.ragQuery ? `检索 query：${contextResult.diagnostics.ragQuery}` : '',
          contextResult.diagnostics.ragKeywords.length ? `关键词：${contextResult.diagnostics.ragKeywords.join('、')}` : '',
          `当前文档注入：${contextResult.diagnostics.currentNoteInjected ? '是' : '否'}`,
          `关联文件：${contextResult.diagnostics.linkedFileInjectedCount}/${contextResult.diagnostics.linkedFileCount}`,
          `RAG 命中：${contextResult.diagnostics.ragSourceCount}`,
          `注入字符：当前 ${contextResult.diagnostics.injectedChars.current} / 关联 ${contextResult.diagnostics.injectedChars.linked} / 引用 ${contextResult.diagnostics.injectedChars.quote} / RAG ${contextResult.diagnostics.injectedChars.rag} / 总计 ${contextResult.diagnostics.injectedChars.total}`,
          ...contextResult.diagnostics.warnings.map(warning => `警告：${warning}`),
        ].filter(Boolean).join('\n'),
        sourceType: 'rag' as const,
      }
      const enrichedRagSourceDetails = [diagnosticDetail, ...ragSourceDetails]
      const enrichedRagSources = ['RAG 检索诊断', ...ragSources]

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
        ...(context
          ? [{
              role: 'system' as const,
              content: context,
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
          ragSources: JSON.stringify(enrichedRagSources),
          ragSourceDetails: JSON.stringify(enrichedRagSourceDetails),
        }, true)
      }

      let finalContent = ''
      let thinkingContent = ''
      const result = await fetchAiStream(
        effectiveInstruction,
        async (content) => {
          finalContent = content
          await saveChat({
            ...placeholderMessage,
            content,
            thinking: thinkingContent || undefined,
            ragSources: JSON.stringify(enrichedRagSources),
            ragSourceDetails: JSON.stringify(enrichedRagSourceDetails),
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
            ragSources: JSON.stringify(enrichedRagSources),
            ragSourceDetails: JSON.stringify(enrichedRagSourceDetails),
          }, false)
        },
        messages
      )
      if (!finalContent && result) {
        finalContent = result
      }

      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? (finalContent || t('record.chat.input.stopped')) : finalContent,
        ragSources: JSON.stringify(enrichedRagSources),
        ragSourceDetails: JSON.stringify(enrichedRagSourceDetails),
      }, true)
    } catch (error) {
      await saveChat({
        ...placeholderMessage,
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }, true)
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
    } = {}
  ) {
    if (!placeholderMessage) return
    const startedAt = Date.now()
    let researchFinished = false
    let lastProgressSavedAt = 0
    setResearchRunning(true)

    try {
      await saveChat({
        ...placeholderMessage,
        content: formatResearchBackgroundStatus('starting', query, startedAt),
      }, false)

      const result = await runDeepResearch({
        query,
        abortSignal: abortController.signal,
        sessionId: options.sessionId,
        localContext: options.localContext,
        onProgress: (progress) => {
          if (researchFinished) {
            return
          }

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

      if (!abortController.signal.aborted) {
        // 保存报告为文件并在编辑器中打开
        try {
          const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

          const workspace = await getWorkspacePath()
          const now = new Date()
          const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
          const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
          // 从 query 中提取简短标题（取前20个字符，去除特殊字符）
          const shortTitle = query.replace(/[\\/:*?"<>|\n\r]/g, '').trim().slice(0, 20).trim() || '研究报告'
          const fileName = `${dateStr}-${timeStr}-${shortTitle}.md`
          const sessionFileName = `${dateStr}-${timeStr}-${shortTitle}.research.json`
          const researchDir = 'research'
          // 相对于工作区的文件路径（用于 setActiveFilePath）
          const relativeFilePath = `${researchDir}/${fileName}`
          const relativeSessionFilePath = `${researchDir}/${sessionFileName}`
          const reportFileContent = [
            '---',
            `title: "${shortTitle}"`,
            `date: ${now.toISOString()}`,
            'type: research_report',
            `session_id: ${result.session.id}`,
            `sources_count: ${result.sources.length}`,
            `evidence_count: ${result.evidences.length}`,
            `visited_urls: ${result.visitedUrls.length}`,
            '---',
            '',
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
          const fileOptions = await getFilePathOptions(relativeFilePath)
          const sessionOptions = await getFilePathOptions(relativeSessionFilePath)
          const sessionJson = JSON.stringify(result.session, null, 2)
          if (workspace.isCustom) {
            await writeTextFile(fileOptions.path, reportFileContent)
            await writeTextFile(sessionOptions.path, sessionJson)
          } else {
            await writeTextFile(fileOptions.path, reportFileContent, { baseDir: fileOptions.baseDir })
            await writeTextFile(sessionOptions.path, sessionJson, { baseDir: sessionOptions.baseDir })
          }

          // 在编辑器中打开
          const useArticleStore = (await import('@/stores/article')).default
          const { useSidebarStore } = await import('@/stores/sidebar')
          const articleStore = useArticleStore.getState()
          const sidebarStore = useSidebarStore.getState()

          await articleStore.loadFileTree({ skipRemoteSync: true })
          await sidebarStore.setLeftSidebarTab('files')
          // 先设置路径，再手动设置内容（避免 readArticle 的竞态问题）
          await articleStore.setActiveFilePath(relativeFilePath)
          // 确保编辑器显示报告内容
          articleStore.setCurrentArticle(reportFileContent)

          toast({
            title: '深度研究已完成',
            description: '报告已保存并在编辑器中打开。',
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
    } finally {
      researchFinished = true
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setResearchRunning(false)
      setLoading(false)
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

  async function handleClarifiedResearchMode(instructionOverride?: string) {
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
        })
        return
      }

      if (pendingClarification && wantsDirectStart) {
        backgroundResearchStarted = true
        startBackgroundDeepResearch(placeholderMessage, pendingClarification.originalQuery, abortController, {
          localContext: researchLocalContextResult.localContext,
          localRagSources: researchLocalContextResult.ragSources,
          localRagSourceDetails: researchLocalContextResult.ragSourceDetails,
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
          })
        })
        return
      }

      startBackgroundDeepResearch(placeholderMessage, researchBrief, abortController, {
        localContext: researchLocalContextResult.localContext,
        localRagSources: researchLocalContextResult.ragSources,
        localRagSourceDetails: researchLocalContextResult.ragSourceDetails,
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
    params: Record<string, any>,
    context?: {
      previewParams?: Record<string, any>
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
  async function handleAgentMode(imageUrls: string[], instructionOverride?: string) {
    const effectiveInstruction = instructionOverride ?? inputValue
    // 先创建一个占位的 AI 消息
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    setAgentState({
      activeChatId: placeholderMessage.id,
    })

    // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
    const agentHandler = new AgentHandler({
      activeChatId: placeholderMessage.id,
      webSearchEnabled,
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
      onFinalAnswerRender: (markdownContent) => {
        // 检测到 Final Answer 时触发渲染
        setAgentState({
          activeChatId: placeholderMessage.id,
          isFinalAnswerMode: true,
          finalAnswerContent: markdownContent
        })
      },
      formatAutoFinalAnswer: (key, values) => t(key as any, values),
      onComplete: async (result, steps, stopped) => {
        // 获取 Agent 执行历史，保存完整的 ReAct 步骤
        const { agentState } = useChatStore.getState()
        const completedSteps = steps && steps.length > 0
          ? steps
          : agentState.completedSteps || []
        const agentHistory = {
          steps: completedSteps,
          toolCalls: agentState.toolCalls,
          events: agentState.agentEvents,
          contextSnapshot: agentState.agentContextSnapshot,
          runId: agentState.agentRunId,
          iterations: agentState.currentIteration,
        }

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
          if (partialSuccessContent && /^工具 .+执行失败：|^工具 .+执行出错：|^Error:/.test(finalContent.trim())) {
            finalContent = partialSuccessContent
          }
        }

        finalContent = sanitizeAgentFinalContent(finalContent)

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

        if (!stopped) {
          const hasSuccessfulToolCall = agentState.toolCalls.some(call => call.result?.success)
          await triggerAutoExtractSuggestion({
            finalContent,
            placeholderMessageId: placeholderMessage.id,
            conversationId: placeholderMessage.conversationId,
            userInput: inputValue,
            hasSuccessfulToolCall,
          })
        }

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined
        })

        // 清空 ref
        agentHandlerRef.current = null
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
          content: `Error: ${error}`,
        }, true)

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined
        })

        // 清空 ref
        agentHandlerRef.current = null
      },
    })

    // 保存到 ref
    agentHandlerRef.current = agentHandler

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
        webSearchEnabled,
        userQuery: effectiveInstruction,
        contextBudget: AGENT_CONTEXT_TOTAL_LIMIT,
        currentArticle: allowAutoCurrentFileContext ? articleStore.currentArticle : undefined,
        activeFilePath: allowAutoCurrentFileContext ? articleStore.activeFilePath : undefined,
      })

      const { context, ragSources, ragSourceDetails } = contextResult
      const diagnosticDetail: ChatCitationSource = {
        filepath: 'rag-diagnostics',
        filename: 'RAG 检索诊断',
        content: [
          `策略：${contextResult.diagnostics.strategy}`,
          contextResult.diagnostics.ragSkippedReason ? `跳过原因：${contextResult.diagnostics.ragSkippedReason}` : '',
          contextResult.diagnostics.ragQuery ? `检索 query：${contextResult.diagnostics.ragQuery}` : '',
          contextResult.diagnostics.ragKeywords.length ? `关键词：${contextResult.diagnostics.ragKeywords.join('、')}` : '',
          `当前文档注入：${contextResult.diagnostics.currentNoteInjected ? '是' : '否'}`,
          `关联文件：${contextResult.diagnostics.linkedFileInjectedCount}/${contextResult.diagnostics.linkedFileCount}`,
          `RAG 命中：${contextResult.diagnostics.ragSourceCount}`,
          `注入字符：当前 ${contextResult.diagnostics.injectedChars.current} / 关联 ${contextResult.diagnostics.injectedChars.linked} / 引用 ${contextResult.diagnostics.injectedChars.quote} / RAG ${contextResult.diagnostics.injectedChars.rag} / 总计 ${contextResult.diagnostics.injectedChars.total}`,
          ...contextResult.diagnostics.warnings.map(warning => `警告：${warning}`),
        ].filter(Boolean).join('\n'),
        sourceType: 'rag' as const,
      }
      const enrichedRagSourceDetails = [diagnosticDetail, ...ragSourceDetails]
      const enrichedRagSources = ['RAG 检索诊断', ...ragSources]

      // 如果启用了 Web 搜索，添加提示
      let agentContext = context
      if (webSearchEnabled) {
        agentContext = `## 联网搜索\n\n用户已为本轮对话开启联网搜索。请优先使用 web_search 获取实时网页资料；需要读取具体网页正文时优先使用 web_extract，只有在需要原始响应或正文提取不可用时再使用 web_fetch。\n\n${context}`
      }

      // 设置到 agentState，用于实时显示
      if (enrichedRagSources.length > 0) {
        const filteredSourceDetails = enrichedRagSourceDetails
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
          ragSources: enrichedRagSources,
          ragSourceDetails: filteredSourceDetails,
        })
      }

      // 保存本轮上下文来源到 AI 消息中
      if (enrichedRagSources.length > 0 || enrichedRagSourceDetails.length > 0) {
        await saveChat({
          ...placeholderMessage,
          ragSources: JSON.stringify(enrichedRagSources),
          ragSourceDetails: JSON.stringify(enrichedRagSourceDetails),
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

      await agentHandler.execute(effectiveInstruction, messages, imageUrls)
    } catch (error) {
      console.error('Agent execution error:', error)
    } finally {
      agentHandlerRef.current = null
    }
  }

  // 对话（Agent 模式）
  async function handleSubmit(instructionOverride?: unknown) {
    const effectiveInstruction =
      typeof instructionOverride === 'string' ? instructionOverride : undefined
    const requestText = effectiveInstruction ?? inputValue
    const displayText = inputValue.trim()

    if (!requestText.trim() || !displayText) return

    const conversationTitle = displayText.replace(/\s+/g, ' ').slice(0, 30) || '新对话'
    await ensureCurrentConversation(conversationTitle)

    onSent?.()

    const imageUrls = attachedImages.map(img => img.url)
    const userMessage = await insert({
      tagId: currentTagId,
      role: 'user',
      content: displayText,
      type: 'chat',
      inserted: false,
      images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
      quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
    })
    if (!userMessage) return

    setLoading(true)
    let keepLoading = false
    if (chatMode === 'chat') {
      await handleChatMode(imageUrls, effectiveInstruction)
    } else if (chatMode === 'research') {
      await handleClarifiedResearchMode(effectiveInstruction)
      keepLoading = abortControllerRef.current !== null
    } else {
      await handleAgentMode(imageUrls, effectiveInstruction)
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
    if (agentHandlerRef.current) {
      agentHandlerRef.current.stop()
      // 不立即清空 ref，等待 Agent 的错误处理完成并调用 onComplete
    }

    // 重置 loading 状态
    setAgentState({ pendingConfirmation: undefined })
    setResearchRunning(false)
    setLoading(false)
  }

  useImperativeHandle(ref, () => ({
    sendChat: (instructionOverride?: string) => {
      void handleSubmit(instructionOverride)
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
        disabled={!isRunning && (!primaryModel || !inputValue.trim())} 
        tooltipText={isRunning ? t('record.chat.input.stop') : t('record.chat.input.send')} 
        buttonClassName={isRunning
          ? "h-7 w-7 rounded-md"
          : "h-7 w-7 rounded-md bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground disabled:bg-muted/30 disabled:text-muted-foreground/60"
        }
        onClick={() => {
          if (isRunning) {
            void handleStop()
            return
          }

          void handleSubmit()
        }} 
      />
    </>
  )
})

ChatSend.displayName = 'ChatSend';
