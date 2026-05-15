"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { getContextForQuery, getContextForQueryInFolder } from '@/lib/rag'
import { fetchAiStream } from "@/lib/ai/chat"
import { invoke } from "@tauri-apps/api/core"
import { type LinkedResource, isLinkedFolder } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { getToolByName } from "@/lib/agent/tools"
import { getSessionApprovalScope, matchesSessionApproval } from "@/lib/agent/session-approval"
import {
  findMatchingPersistentAgentApproval,
  getPersistentApprovalOptions,
  recordPersistentApprovalHistory,
} from "@/lib/agent/persistent-approval"
import { ImageAttachment } from "./image-attachments"
import type { RagSource } from "@/lib/rag"
import { cleanAssistantGeneratedContent } from "@/lib/ai/assistant-content"
import { searchWeb } from "@/lib/tavily"
import {
  completeResearchClarification,
  generateResearchClarification,
  runDeepResearch,
  type DeepResearchProgress,
} from "@/lib/research/deep-research"
import {
  buildResearchProgressView,
  encodeResearchProgressView,
} from "@/lib/research/progress-status"
import type { Chat } from "@/db/chats"
import { toast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

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
}

type ChatCitationSource = RagSource & {
  sourceType?: 'rag' | 'current' | 'linked' | 'quote'
  startLine?: number
  endLine?: number
  from?: number
  to?: number
}

const CITATION_CONTENT_LIMIT = 1600
const MIN_AUTO_EXTRACT_CHAR_COUNT = 500
const AGENT_CONTEXT_TOTAL_LIMIT = 70000
const AGENT_CURRENT_NOTE_CONTEXT_LIMIT = 18000
const AGENT_LINKED_FILE_CONTEXT_LIMIT = 16000
const AGENT_RAG_CONTEXT_LIMIT = 24000
const AGENT_QUOTE_CONTEXT_LIMIT = 10000
const AGENT_PREVIEW_CONTEXT_LIMIT = 4000

type AgentContextBudget = {
  remaining: number
}

function takeAgentContextContent(
  content: string,
  perSectionLimit: number,
  budget: AgentContextBudget,
  label: string
): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }

  const allowed = Math.max(0, Math.min(perSectionLimit, budget.remaining))
  if (allowed <= 0) {
    return `[Context omitted: ${label}; total context budget exhausted.]`
  }

  budget.remaining -= Math.min(normalized.length, allowed)
  if (normalized.length <= allowed) {
    return normalized
  }

  return `${normalized.slice(0, allowed).trim()}\n\n[Context truncated: ${label}; ${normalized.length - allowed} characters omitted.]`
}

function buildAutoNoteTitle(userInput: string) {
  const normalized = userInput
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')

  const fallback = `对话要点-${new Date().toISOString().slice(0, 10)}`
  return (normalized || fallback).slice(0, 28)
}

function hasActionableStructure(content: string) {
  return /(^|\n)\s*[-*]\s+/.test(content)
    || /(^|\n)\s*(#+\s+)/.test(content)
    || /(^|\n)\s*(\d+\.\s+)/.test(content)
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

function getLinkedResourceKey(resource: LinkedResource): string {
  return resource.relativePath || resource.path || resource.name
}

function getLinkedFileName(path: unknown): string {
  const normalized = typeof path === 'string' ? path.trim() : ''
  return normalized.split('/').pop() || normalized
}

function matchesLinkedResourcePath(candidate: unknown, resource: LinkedResource): boolean {
  const normalized = typeof candidate === 'string' ? candidate.trim() : ''
  if (!normalized) {
    return false
  }

  const linkedPaths = new Set([
    resource.relativePath,
    resource.path,
    resource.name,
    getLinkedFileName(resource.relativePath),
    getLinkedFileName(resource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function normalizeCitationContent(content: unknown): string {
  if (typeof content !== 'string') {
    return ''
  }

  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= CITATION_CONTENT_LIMIT) {
    return normalized
  }

  return `${normalized.slice(0, CITATION_CONTENT_LIMIT).trim()}\n...`
}

function addCitationSource(
  sources: string[],
  details: ChatCitationSource[],
  detail: ChatCitationSource
) {
  const filepath = detail.filepath?.trim() || ''
  const filename = detail.filename?.trim() || getLinkedFileName(filepath)
  const content = normalizeCitationContent(detail.content)

  if (!filename && !filepath) {
    return
  }

  const nextDetail: ChatCitationSource = {
    ...detail,
    filepath,
    filename,
    content,
  }

  const exists = details.some((item) =>
    (item.filepath || item.filename) === (nextDetail.filepath || nextDetail.filename)
    && (item.sourceType || 'rag') === (nextDetail.sourceType || 'rag')
    && normalizeCitationContent(item.content).slice(0, 120) === content.slice(0, 120)
  )

  if (!exists) {
    details.push(nextDetail)
  }

  if (filename && !sources.includes(filename)) {
    sources.push(filename)
  }
}

async function buildWebSearchContext(
  query: string,
  signal?: AbortSignal
): Promise<{ context: string; sources: ChatCitationSource[] }> {
  const response = await searchWeb({
    query,
    maxResults: 5,
    includeAnswer: true,
    signal,
  })

  const lines = [
    '## Web search results',
    '',
    `Provider: ${response.provider}${response.degraded ? ' (fallback)' : ''}`,
  ]

  if (response.answer?.trim()) {
    lines.push('', `Answer: ${response.answer.trim()}`)
  }

  if (response.results.length > 0) {
    lines.push('', 'Sources:')
    response.results.forEach((result, index) => {
      const title = result.title?.trim() || result.url || `Result ${index + 1}`
      lines.push(`${index + 1}. ${title}`)
      if (result.url?.trim()) {
        lines.push(`   URL: ${result.url.trim()}`)
      }
      if (result.publishedDate?.trim()) {
        lines.push(`   Published: ${result.publishedDate.trim()}`)
      }
      if (result.content?.trim()) {
        lines.push(`   Snippet: ${result.content.trim()}`)
      }
    })
  } else {
    lines.push('', 'No web results were found.')
  }

  const sources = response.results
    .filter(result => result.url || result.title || result.content)
    .map((result, index): ChatCitationSource => ({
      filepath: result.url || `web-search:${query}:${index + 1}`,
      filename: result.title || result.url || `Web result ${index + 1}`,
      content: result.content || response.answer || '',
      sourceType: 'rag',
    }))

  return {
    context: `${lines.join('\n')}\n\n`,
    sources,
  }
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

function stripResearchClarificationMeta(content: string) {
  if (!content.startsWith(RESEARCH_CLARIFICATION_PREFIX)) {
    return content
  }
  const endIndex = content.indexOf(RESEARCH_CLARIFICATION_SUFFIX)
  return endIndex >= 0 ? content.slice(endIndex + RESEARCH_CLARIFICATION_SUFFIX.length).trimStart() : content
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

export const ChatSend = forwardRef<{ sendChat: (instructionOverride?: string, options?: { maxTokens?: number; temperature?: number }) => void }, ChatSendProps>(({
  inputValue,
  onSent,
  linkedResource,
  linkedResources = [],
  linkedResourcePreviews = {},
  attachedImages = [],
  quoteData = null,
  webSearchEnabled = false,
  allowAutoCurrentFileContext = true,
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
  const linkedFolders = effectiveLinkedResources.filter(isLinkedFolder)
  const linkedFiles = effectiveLinkedResources.filter(resource => !isLinkedFolder(resource))
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

  // RAG 关键词停用词过滤
  // 过滤掉没有实际检索意义的虚词
  const filterRAGKeywords = (keywords: {text: string, weight: number}[]) => {
    const stopWords = new Set([
      // 中文虚词/系动词
      '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
      '好', '自己', '这', '那', '里', '就是', '为', '与', '之', '用', '可以',
      '但', '而', '或', '及', '等', '对', '把', '被', '让', '给', '从', '向',
      '什么', '怎么', '怎样', '如何', '为什么', '哪些', '多少',

      // 英文停用词
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
      'what', 'how', 'why', 'where', 'when', 'who', 'which'
    ])

    return keywords.filter(k => {
      const text = k.text.trim().toLowerCase()
      // 过滤掉停用词和单字
      return !stopWords.has(text) && text.length > 1
    })
  }

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
      let context = ''
      const ragSources: string[] = []
      const ragSourceDetails: ChatCitationSource[] = []

      if (webSearchEnabled) {
        try {
          const webSearchContext = await buildWebSearchContext(effectiveInstruction, abortController.signal)
          context += webSearchContext.context
          webSearchContext.sources.forEach(source => {
            addCitationSource(ragSources, ragSourceDetails, source)
          })
        } catch (error) {
          if (abortController.signal.aborted) {
            throw error
          }
          console.error('Failed to get web search context in Chat mode:', error)
          context += `## Web search results\n\nWeb search was enabled, but the search request failed: ${error instanceof Error ? error.message : String(error)}\n\n`
        }
      }

      if (isRagEnabled) {
        try {
          let keywords = await invoke<{ text: string; weight: number }[]>('rank_keywords', {
            text: effectiveInstruction,
            topK: 15,
          })
          keywords = filterRAGKeywords(keywords)

          if (keywords.length > 0) {
            const linkedFolder = linkedFolders[0]
            const ragResult = linkedFolder
              ? await getContextForQueryInFolder(keywords, linkedFolder.relativePath)
              : await getContextForQuery(keywords)

            ragResult.sources.forEach(source => {
              if (!ragSources.includes(source)) {
                ragSources.push(source)
              }
            })
            ragResult.sourceDetails.forEach(sourceDetail => {
              addCitationSource(ragSources, ragSourceDetails, {
                ...sourceDetail,
                sourceType: 'rag',
              })
            })

            if (ragResult.context) {
              context += `## 知识库检索结果\n\n${ragResult.context}\n\n`
            }
          }
        } catch (error) {
          console.error('Failed to get RAG context in Chat mode:', error)
        }
      }

      if (quoteData) {
        context += `## 用户引用内容\n\n文件: ${quoteData.fileName}\n\n---\n${quoteData.fullContent}\n---\n\n`
        addCitationSource(ragSources, ragSourceDetails, {
          filepath: quoteData.articlePath,
          filename: quoteData.fileName,
          content: quoteData.fullContent,
          sourceType: 'quote',
          startLine: quoteData.startLine,
          endLine: quoteData.endLine,
          from: quoteData.from,
          to: quoteData.to,
        })
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
          ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : undefined,
          ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
        }, true)
      }

      let finalContent = ''
      const result = await fetchAiStream(
        effectiveInstruction,
        async (content) => {
          finalContent = content
          await saveChat({
            ...placeholderMessage,
            content,
            ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : undefined,
            ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
          }, false)
        },
        abortController.signal,
        undefined,
        t,
        placeholderMessage.id,
        imageUrls,
        undefined,
        messages
      )
      if (!finalContent && result) {
        finalContent = result
      }

      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? (finalContent || t('record.chat.input.stopped')) : finalContent,
        ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : undefined,
        ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
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
    abortController: AbortController
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

      const ragSourceDetails: ChatCitationSource[] = result.visitedUrls.map((url, index) => ({
        filepath: url,
        filename: url,
        content: result.learnings[index] || '',
        sourceType: 'rag',
      }))

      await saveChat({
        ...placeholderMessage,
        content: abortController.signal.aborted ? t('record.chat.input.stopped') : result.report,
        ragSources: result.visitedUrls.length > 0 ? JSON.stringify(result.visitedUrls) : undefined,
        ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
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
          const researchDir = 'research'
          // 相对于工作区的文件路径（用于 setActiveFilePath）
          const relativeFilePath = `${researchDir}/${fileName}`

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
          if (workspace.isCustom) {
            await writeTextFile(fileOptions.path, result.report)
          } else {
            await writeTextFile(fileOptions.path, result.report, { baseDir: fileOptions.baseDir })
          }

          // 在编辑器中打开
          const useArticleStore = (await import('@/stores/article')).default
          const { default: useSidebarStore } = await import('@/stores/sidebar')
          const articleStore = useArticleStore.getState()
          const sidebarStore = useSidebarStore.getState()

          await articleStore.loadFileTree({ skipRemoteSync: true })
          await sidebarStore.setLeftSidebarTab('files')
          // 先设置路径，再手动设置内容（避免 readArticle 的竞态问题）
          await articleStore.setActiveFilePath(relativeFilePath)
          // 确保编辑器显示报告内容
          articleStore.setCurrentArticle(result.report)

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
    abortController: AbortController
  ) {
    void executeDeepResearch(placeholderMessage, query, abortController)
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
        startBackgroundDeepResearch(placeholderMessage, completed.researchBrief, abortController)
        return
      }

      if (pendingClarification && wantsDirectStart) {
        backgroundResearchStarted = true
        startBackgroundDeepResearch(placeholderMessage, pendingClarification.originalQuery, abortController)
        return
      }

      await saveChat({
        ...placeholderMessage,
        content: '正在梳理你的研究需求...',
      }, false)

      const clarification = await generateResearchClarification({
        query: trimmedInstruction,
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
      startBackgroundDeepResearch(placeholderMessage, clarification.researchBrief || trimmedInstruction, abortController)
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

  useImperativeHandle(ref, () => ({
    sendChat: (instructionOverride?: string, _options?: { maxTokens?: number; temperature?: number }) => {
      void handleSubmit(instructionOverride)
    },
  }))

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
      // 构建上下文信息
      let context = ''
      const contextBudget: AgentContextBudget = { remaining: AGENT_CONTEXT_TOTAL_LIMIT }
      const ragSources: string[] = []
      const ragSourceDetails: ChatCitationSource[] = []

      if (webSearchEnabled) {
        context += `## 联网搜索\n\n用户已为本轮对话开启联网搜索。请优先使用 web_search 获取实时网页资料；需要读取具体网页正文时优先使用 web_extract，只有在需要原始响应或 Tavily Extract 不可用时再使用 web_fetch。搜索与提取结果来自 Tavily Search API。\n\n`
      }

      // 1. 如果有当前打开的笔记，自动传入其内容
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()

      const activeFileAlreadyLinked = linkedFiles.some(resource =>
        matchesLinkedResourcePath(articleStore.activeFilePath, resource)
      )

      if (allowAutoCurrentFileContext && articleStore.activeFilePath && articleStore.currentArticle && !activeFileAlreadyLinked) {
        const currentArticleContext = takeAgentContextContent(
          articleStore.currentArticle,
          AGENT_CURRENT_NOTE_CONTEXT_LIMIT,
          contextBudget,
          `current note ${articleStore.activeFilePath}`
        )
        context += `## 当前打开的笔记\n文件路径: ${articleStore.activeFilePath}\n\n内容:\n${currentArticleContext}\n\n`
        addCitationSource(ragSources, ragSourceDetails, {
          filepath: articleStore.activeFilePath,
          filename: getLinkedFileName(articleStore.activeFilePath),
          content: articleStore.currentArticle,
          sourceType: 'current',
        })
      }

      // 2. 如果启用 RAG，获取知识库相关上下文
      if (isRagEnabled) {
        try {
          // 基于 TextRank 算法提取前 15 个关键词（增加数量以提高召回率）
          let keywords = await invoke<{text: string, weight: number}[]>('rank_keywords', { text: inputValue, topK: 15 })

          // 过滤掉停用词（如"是"、"的"等没有检索意义的虚词）
          keywords = filterRAGKeywords(keywords)

          // 如果过滤后没有有效关键词，明确告知
          if (keywords.length === 0) {
            context += `## 知识库检索结果\n\n由于用户问题中没有有效的关键词（仅包含停用词如"的"、"是"等），无法进行知识库检索。如果用户询问的是具体笔记内容，请告知用户需要提供更多具体信息。\n`
          } else {
            // 根据关联资源类型选择检索方式
            let ragResult: { context: string; sources: string[]; sourceDetails: RagSource[] }

            const linkedFolder = linkedFolders[0]

            if (linkedFolder) {
              // 文件夹关联：限定检索范围到文件夹
              ragResult = await getContextForQueryInFolder(keywords, linkedFolder.relativePath)
            } else {
              // 文件关联或无关联：全局检索
              ragResult = await getContextForQuery(keywords)
            }

            ragResult.sourceDetails.forEach(sourceDetail => {
              addCitationSource(ragSources, ragSourceDetails, {
                ...sourceDetail,
                sourceType: 'rag',
              })
            })
            ragResult.sources.forEach(source => {
              if (!ragSources.includes(source)) {
                ragSources.push(source)
              }
            })

            // 设置到 agentState，用于实时显示
            setAgentState({
              ragSources: ragResult.sources,
              ragSourceDetails: ragResult.sourceDetails,
            })

            if (ragResult.context) {
              // 找到相关内容
              const ragContext = takeAgentContextContent(
                ragResult.context,
                AGENT_RAG_CONTEXT_LIMIT,
                contextBudget,
                'RAG results'
              )
              context += `## 知识库检索结果\n\n已在知识库中找到与用户问题相关的笔记内容。请优先使用以下信息回答用户问题：\n\n${ragContext}\n`
            } else {
              // 未找到相关内容
              const linkedFolder = linkedFolders[0]
              const searchScope = linkedFolder
                ? `在关联文件夹"${linkedFolder.name}"中`
                : '在知识库中'

              context += `## 知识库检索结果\n\n${searchScope}未找到与用户问题相关的笔记内容。\n\n请根据情况处理：\n- 如果用户询问的是具体笔记内容，请告知用户${searchScope}可能没有相关资料\n- 如果问题可以基于一般知识回答，请使用你的知识回答\n- 如果需要更多信息，可以请用户提供更具体的关键词或问题\n`
            }
          }
        } catch (error) {
          console.error('Failed to get RAG context in Agent mode:', error)
          // 检索出错时的处理
          context += `## 知识库检索结果\n\n知识库检索过程中出现错误。如果用户询问的是具体笔记内容，请告知用户暂时无法访问知识库。\n`
        }
      }

      // 3. 如果有关联文件（非文件夹），注入内容作为 Agent 上下文
      if (linkedFiles.length > 0) {
        const workspace = await getWorkspacePath()

        for (const [index, resource] of linkedFiles.entries()) {
          try {
            const resourceKey = getLinkedResourceKey(resource)
            const resourcePath = resource.relativePath || resource.path
            const isActiveResource = matchesLinkedResourcePath(articleStore.activeFilePath, resource)
            const preview = linkedResourcePreviews[resourceKey] ?? (index === 0 ? linkedResourcePreview : null)
            const isPdf = /\.pdf$/i.test(resourcePath)

            if (preview) {
              context += `\n${takeAgentContextContent(
                preview,
                AGENT_PREVIEW_CONTEXT_LIMIT,
                contextBudget,
                `linked preview ${resource.name || resourcePath}`
              )}\n`
            }

            if (isPdf) {
              // PDF 文件：使用已提取的文本（articleStore.currentArticle），不读取二进制
              if (isActiveResource && articleStore.currentArticle) {
                const pdfContext = takeAgentContextContent(
                  articleStore.currentArticle,
                  AGENT_LINKED_FILE_CONTEXT_LIMIT,
                  contextBudget,
                  `linked PDF ${resource.name || resourcePath}`
                )
                context += `\n## 关联文件内容 ${index + 1}（PDF 文本提取）\n\n文件: "${resource.name}" (${resource.relativePath})\n\n---\n${pdfContext}\n---\n`
                addCitationSource(ragSources, ragSourceDetails, {
                  filepath: resource.relativePath || resource.path,
                  filename: resource.name || getLinkedFileName(resource.relativePath || resource.path),
                  content: articleStore.currentArticle,
                  sourceType: 'linked',
                })
              }
              continue
            }

            let linkedFileContent = ''
            if (isActiveResource && articleStore.currentArticle) {
              linkedFileContent = articleStore.currentArticle
            } else if (workspace.isCustom) {
              linkedFileContent = await readTextFile(resource.path)
            } else {
              const { path, baseDir } = await getFilePathOptions(resource.path || resource.relativePath)
              linkedFileContent = baseDir
                ? await readTextFile(path, { baseDir })
                : await readTextFile(path)
            }

            if (linkedFileContent) {
              const linkedContext = takeAgentContextContent(
                linkedFileContent,
                AGENT_LINKED_FILE_CONTEXT_LIMIT,
                contextBudget,
                `linked file ${resource.name || resourcePath}`
              )
              context += `\n## 关联文件内容 ${index + 1}\n\nContent from linked file "${resource.name}" (${resource.relativePath}) is included below. If it is truncated, only call tools to read more when the user task requires missing parts.\n\n---\n${linkedContext}\n---\n`
              addCitationSource(ragSources, ragSourceDetails, {
                filepath: resource.relativePath || resource.path,
                filename: resource.name || getLinkedFileName(resource.relativePath || resource.path),
                content: linkedFileContent,
                sourceType: 'linked',
              })
            }
          } catch (error) {
            console.error('Failed to read linked file in Agent mode:', error)
          }
        }
      }

      // 4. 如果有引用内容，添加引用上下文（在构建消息之前）
      if (quoteData) {
        const { fileName, startLine, endLine, fullContent, from, to } = quoteData
        let lineInfo = ''
        const hasValidLineNumbers = startLine !== -1 && endLine !== -1
        const hasValidRange = from >= 0 && to >= from

        if (hasValidLineNumbers) {
          if (startLine === endLine) {
            lineInfo = `第 ${startLine} 行`
          } else {
            lineInfo = `第 ${startLine}-${endLine} 行`
          }
        }

        const quoteContext = takeAgentContextContent(
          fullContent,
          AGENT_QUOTE_CONTEXT_LIMIT,
          contextBudget,
          `quote ${fileName}`
        )

        context += `\n## 📌 用户引用内容

用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：

---
${quoteContext}
---

${hasValidRange ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须精确替换用户选中的范围**: 当前引用内容来自编辑器选区，必须优先使用 replace_editor_content 的 position-based 模式，只替换这段选中的内容：
- from: ${from}
- to: ${to}
- 使用 content 或 replaceContent 传入新内容
- 只允许替换这个选区，禁止扩大到整篇文档或整段之外

**如果用户说“在这段前面/后面/上面/下面插入、补充、添加”**:
- 仍然使用 replace_editor_content
- 基于当前引用范围整体替换
- 前插: 新内容 + 原引用内容
- 后插: 原引用内容 + 新内容
- 不要使用 insert_at_cursor，因为聊天输入会让编辑器失焦，当前光标位置不可靠

**如果用户明确要求“前面和后面都增加内容”**:
- 仍然使用 replace_editor_content
- 必须先分别生成前插内容和后插内容
- 请在传给工具的 content 中使用这个精确格式：
  <<BEFORE>>
  [前插内容]
  <<AFTER>>
  [后插内容]
- 系统会自动把它拼接成：前插内容 + 原引用内容 + 后插内容
- 不要把前后内容合并成一整段普通文本

**兜底行号信息**:
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止改动选区之外的内容
- 禁止获取整个文档后再重写整篇
- 禁止把 startLine/endLine 擅自改成 1/1` : hasValidLineNumbers ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 replace_editor_content 工具的 line-based 模式，传入精确的行号：
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}
- 必须使用 replaceContent 参数传入新内容

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止使用 from/to 位置参数
- 禁止使用 searchContent 文本搜索模式
- 禁止获取整个文档内容后再操作` : `**注意**: 此引用内容没有有效的行号信息。如果需要修改，请先使用 get_editor_selection 工具获取当前选中的行号信息。`}

请基于这段引用内容回答用户的问题。

`
        addCitationSource(ragSources, ragSourceDetails, {
          filepath: quoteData.articlePath,
          filename: fileName,
          content: fullContent,
          sourceType: 'quote',
          startLine,
          endLine,
          from,
          to,
        })
      }

      // 保存本轮上下文来源到 AI 消息中，最终在回答底部展示为可点击引用。
      if (ragSources.length > 0 || ragSourceDetails.length > 0) {
        const normalizedSources = ragSources.length > 0
          ? ragSources
          : ragSourceDetails.map(source => source.filename).filter((source): source is string => !!source)

        await saveChat({
          ...placeholderMessage,
          ragSources: normalizedSources.length > 0 ? JSON.stringify(normalizedSources) : undefined,
          ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
        }, true)
      }

      // 5. 构建消息数组，包含对话历史（使用压缩摘要替代已压缩的消息）
      const { chats } = useChatStore.getState()
      const { buildMessagesWithHistory } = await import('@/lib/ai/condense')

      // 使用 buildMessagesWithHistory 构建完整的消息数组
      // 注意：Agent 模式下，不传入 systemPrompt（Agent 会自己构建）
      // 将所有上下文（文章、RAG、关联文件、引用）作为 additionalContext
      const messages = buildMessagesWithHistory(
        chats,
        undefined, // systemPrompt - Agent 会自己构建
        context,   // additionalContext - 包含文章、RAG、关联文件、引用等
        effectiveInstruction, // currentUserInput - 当前用户输入（可能来自命令模板）
        {
          // Agent 自己会在 think() 里重新注入当前请求，避免重复。
          // 保留 assistant 历史，优先使用 condensedContent，避免丢失多轮上下文。
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          maxUserMessages: shouldCarryUserHistoryForAgent(effectiveInstruction) ? 3 : 0,
        }
      )

      await agentHandler.execute(effectiveInstruction, messages, imageUrls)
    } catch (error) {
      console.error('Agent execution error:', error)
    } finally {
      // 清空 ref
      agentHandlerRef.current = null
    }
  }

  // 对话（Agent 模式）
  async function handleSubmit(instructionOverride?: unknown) {
    if (inputValue === '') return
    onSent?.()

    const effectiveInstruction =
      typeof instructionOverride === 'string' ? instructionOverride : undefined

    setLoading(true)
    const imageUrls = attachedImages.map(img => img.url)
    await insert({
      tagId: currentTagId,
      role: 'user',
      content: inputValue,
      type: 'chat',
      inserted: false,
      images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
      quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
    })
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

  return (
    <>
      <TooltipButton 
        variant={isRunning ? "destructive" : "default"}
        size="sm"
        icon={isRunning ? <Square className="size-4" /> : <Send className="size-4" />} 
        disabled={!isRunning && (!primaryModel || !inputValue.trim())} 
        tooltipText={isRunning ? t('record.chat.input.stop') : t('record.chat.input.send')} 
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
