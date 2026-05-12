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
    setLoading,
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
  async function handleSubmit(instructionOverride?: string) {
    if (inputValue === '') return
    onSent?.()

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
    await handleAgentMode(imageUrls, instructionOverride)
    setLoading(false)
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
    setLoading(false)
  }

  return (
    <>
      <TooltipButton 
        variant={loading ? "destructive" : "default"}
        size="sm"
        icon={loading ? <Square className="size-4" /> : <Send className="size-4" />} 
        disabled={!loading && (!primaryModel || !inputValue.trim())} 
        tooltipText={loading ? t('record.chat.input.stop') : t('record.chat.input.send')} 
        onClick={loading ? handleStop : handleSubmit} 
      />
    </>
  )
})

ChatSend.displayName = 'ChatSend';
