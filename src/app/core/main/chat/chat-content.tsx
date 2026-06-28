import React from 'react'
import useChatStore from '@/stores/chat'
import useTagStore from '@/stores/tag'
import { ArrowDownToLine, X, QuoteIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chat } from '@/db/chats'
import ChatPreview from './chat-preview'
import './chat.css'
import { MarkText } from './message-control/mark-text'
import { ChatClipboard } from './chat-clipboard'
import MessageControl from './message-control'
import ChatEmpty from './chat-empty'
import { useTranslations } from 'next-intl'
import ChatThinking from './chat-thinking'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { AgentExecutionStatus } from './agent-execution-status'
import { AgentRunSummary } from './agent-run-summary'
import { MessageCitations } from './message-citations'
import { TaskPlanProgress, ResearchResumeCard } from './task-plan-progress'
import { ChatImages } from "./chat-images"
import { cleanAssistantGeneratedContent } from '@/lib/ai/assistant-content'
import {
  extractWebCitationDetails,
  filterVisibleCitationDetails,
  filterVisibleRagSources,
  parseStoredAgentHistory,
  type MessageCitationDetail,
} from '@/lib/ai/citations'
import { highlightTextReact } from '@/lib/highlight'
import { parseResearchProgressView } from '@/lib/research/progress-status'
import { parseResearchResumeData } from '@/lib/research/session-store'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const BOTTOM_THRESHOLD = 24
const USER_SCROLL_GRACE_MS = 300
const PENDING_AGENT_CHAT_ID = -1

type ChatLayoutProps = {
  expanded?: boolean
}

const ChatContent = React.memo(function ChatContent({ expanded = false }: ChatLayoutProps) {
  const { chats, init, agentState, loading, chatSearchQuery, chatSearchResults, chatSearchCurrentIndex } = useChatStore()
  const { currentTagId } = useTagStore()
  const [isOnBottom, setIsOnBottom] = useState(true)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const pendingAgentChat = useMemo<Chat | null>(() => {
    if (!agentState.isRunning || agentState.activeChatId !== undefined) return null

    return {
      id: PENDING_AGENT_CHAT_ID,
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
      createdAt: agentState.currentStepStartTime || agentState.activity?.startedAt || Date.now(),
    }
  }, [
    agentState.activeChatId,
    agentState.activity?.startedAt,
    agentState.currentStepStartTime,
    agentState.isRunning,
    currentTagId,
  ])
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const bottomAnchorRef = React.useRef<HTMLDivElement>(null)
  const programmaticScrollRef = React.useRef(false)
  const autoScrollEnabledRef = React.useRef(true)
  const delayedScrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUserScrollAtRef = React.useRef(0)
  const lastScrollTimeRef = React.useRef(0)
  const isScrollPendingRef = React.useRef(false)
  const scrollSyncFrameRef = React.useRef<number | null>(null)

  const isNearBottom = useCallback((element: Element) => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD
  }, [])

  const handleScroll = useCallback(() => {
    const md = wrapperRef.current
    if (!md) return

    const onBottom = isNearBottom(md)
    setIsOnBottom(onBottom)

    if (programmaticScrollRef.current) {
      if (onBottom) {
        programmaticScrollRef.current = false
      }
      return
    }

    const isLikelyUserScroll = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_GRACE_MS

    // 只有用户主动离开底部时才关闭自动滚动
    if (onBottom) {
      setAutoScrollEnabled(true)
    } else if (isLikelyUserScroll) {
      setAutoScrollEnabled(false)
    }
  }, [isNearBottom])

  const markUserScrollIntent = useCallback(() => {
    lastUserScrollAtRef.current = Date.now()
  }, [])

  const performAutoScroll = useCallback(() => {
    if (!autoScrollEnabledRef.current) return

    // 如果处于滚动挂起状态，说明近期会触发滚动，避免重复调度
    if (isScrollPendingRef.current) return

    const now = Date.now()
    const timeSinceLastScroll = now - lastScrollTimeRef.current
    const throttleDelay = 60 // 60ms 内限制最多触发一次滚动

    const executeScroll = () => {
      isScrollPendingRef.current = false
      if (!autoScrollEnabledRef.current) return

      const md = wrapperRef.current
      if (!md) return

      // 双重检查，如果在等待期间用户主动滚动离开了底部（例如手动往上滚），不执行滚动
      if (!isNearBottom(md) && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_GRACE_MS) {
        return
      }

      programmaticScrollRef.current = true
      bottomAnchorRef.current?.scrollIntoView({ block: 'end' })
      setIsOnBottom(true)
      lastScrollTimeRef.current = Date.now()

      requestAnimationFrame(() => {
        setTimeout(() => {
          programmaticScrollRef.current = false
          if (md) {
            setIsOnBottom(isNearBottom(md))
          }
        }, 0)
      })
    }

    if (timeSinceLastScroll < throttleDelay) {
      isScrollPendingRef.current = true
      setTimeout(executeScroll, throttleDelay - timeSinceLastScroll)
    } else {
      executeScroll()
    }

    // 保留延迟兜底，以防异步资源（如图片加载、大型渲染）加载完成导致高度突变
    if (delayedScrollTimeoutRef.current) {
      clearTimeout(delayedScrollTimeoutRef.current)
    }
    delayedScrollTimeoutRef.current = setTimeout(() => {
      if (!autoScrollEnabledRef.current) return

      const md = wrapperRef.current
      if (!md) return
      if (!isNearBottom(md) && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_GRACE_MS) {
        return
      }

      programmaticScrollRef.current = true
      bottomAnchorRef.current?.scrollIntoView({ block: 'end' })
      setIsOnBottom(true)

      requestAnimationFrame(() => {
        setTimeout(() => {
          programmaticScrollRef.current = false
          if (md) {
            setIsOnBottom(isNearBottom(md))
          }
        }, 0)
      })
    }, 400)
  }, [isNearBottom])

  const scheduleScrollStateSync = useCallback(() => {
    if (scrollSyncFrameRef.current !== null) return

    scrollSyncFrameRef.current = requestAnimationFrame(() => {
      scrollSyncFrameRef.current = null
      const md = wrapperRef.current
      if (!md) return

      const onBottom = isNearBottom(md)
      if (autoScrollEnabledRef.current) {
        performAutoScroll()
        return
      }

      setIsOnBottom(onBottom)
    })
  }, [isNearBottom, performAutoScroll])

  // 手动滚动到底部并启用自动滚动
  const handleScrollToBottom = useCallback(() => {
    performAutoScroll()
    setAutoScrollEnabled(true)
  }, [performAutoScroll])

  useEffect(() => {
    const md = wrapperRef.current
    if (!md) return

    const handleTouchStart = () => markUserScrollIntent()
    const handleTouchMove = () => markUserScrollIntent()
    const handleWheel = () => markUserScrollIntent()
    const handlePointerDown = () => markUserScrollIntent()

    md.addEventListener('scroll', handleScroll)
    md.addEventListener('touchstart', handleTouchStart, { passive: true })
    md.addEventListener('touchmove', handleTouchMove, { passive: true })
    md.addEventListener('wheel', handleWheel, { passive: true })
    md.addEventListener('pointerdown', handlePointerDown, { passive: true })

    return () => {
      md.removeEventListener('scroll', handleScroll)
      md.removeEventListener('touchstart', handleTouchStart)
      md.removeEventListener('touchmove', handleTouchMove)
      md.removeEventListener('wheel', handleWheel)
      md.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [handleScroll, markUserScrollIntent])

  useEffect(() => {
    init(currentTagId)
  }, [currentTagId, init])

  useEffect(() => {
    autoScrollEnabledRef.current = autoScrollEnabled
  }, [autoScrollEnabled])

  useEffect(() => {
    const md = wrapperRef.current
    const content = contentRef.current
    if (!md || !content) return

    const observer = new ResizeObserver(() => {
      scheduleScrollStateSync()
    })

    observer.observe(content)

    return () => {
      observer.disconnect()
    }
  }, [scheduleScrollStateSync])

  // 监听消息变化，仅在启用自动滚动时才滚动
  useEffect(() => {
    if (autoScrollEnabled) {
      performAutoScroll()
    }
  }, [chats, autoScrollEnabled, performAutoScroll])

  const liveAgentScrollSignal = useMemo(
    () => [
      agentState.activeChatId ?? 'pending',
      agentState.activity?.startedAt || 0,
      agentState.agentEventCursor || 0,
      agentState.currentThought?.length || 0,
      agentState.finalAnswerContent?.length || 0,
      agentState.agentPartSnapshot?.parts.length || 0,
      agentState.toolCalls.length,
      agentState.pendingConfirmation?.toolName || '',
    ].join(':'),
    [
      agentState.activeChatId,
      agentState.activity?.startedAt,
      agentState.agentEventCursor,
      agentState.currentThought,
      agentState.finalAnswerContent,
      agentState.agentPartSnapshot?.parts.length,
      agentState.toolCalls.length,
      agentState.pendingConfirmation?.toolName,
    ],
  )

  // Agent 执行时，仅在启用自动滚动时才滚动到底部
  // 使用 RAF 批处理，避免流式 thought/final answer 的每次状态更新都触发布局测量。
  useEffect(() => {
    if (autoScrollEnabled && (agentState.isRunning || agentState.isFinalAnswerMode)) {
      const rafId = requestAnimationFrame(() => {
        performAutoScroll()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [
    agentState.isFinalAnswerMode,
    agentState.isRunning,
    autoScrollEnabled,
    liveAgentScrollSignal,
    performAutoScroll,
  ])

  // Loading 状态变化时，仅在启用自动滚动时才滚动到底部
  useEffect(() => {
    if (autoScrollEnabled && loading) {
      performAutoScroll()
    }
  }, [loading, autoScrollEnabled, performAutoScroll])

  useEffect(() => {
    return () => {
      if (delayedScrollTimeoutRef.current) {
        clearTimeout(delayedScrollTimeoutRef.current)
      }
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current)
        scrollSyncFrameRef.current = null
      }
    }
  }, [])

  // 搜索结果自动滚动到当前匹配项
  useEffect(() => {
    if (chatSearchResults.length === 0 || chatSearchCurrentIndex < 0) return
    const targetMessageId = chatSearchResults[chatSearchCurrentIndex]
    if (!targetMessageId) return
    const messageEl = document.querySelector(`[data-chat-id="${targetMessageId}"]`)
    if (messageEl) {
      programmaticScrollRef.current = true
      messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => { programmaticScrollRef.current = false }, 300)
    }
  }, [chatSearchCurrentIndex, chatSearchResults])

  return <div
    ref={wrapperRef}
    id="chats-wrapper"
    className={cn(
      "flex-1 relative overflow-y-auto overflow-x-hidden w-full flex flex-col gap-6 [overflow-anchor:none]",
      expanded ? "items-center px-4 py-7 lg:px-8" : "items-end p-4",
    )}
  >
    <div
      ref={contentRef}
      className={cn(
        "w-full flex flex-col gap-6",
        expanded ? "max-w-[1280px] items-stretch" : "items-end",
      )}
    >
      {
        chats.length || pendingAgentChat ? (
          <>
            {chats.map((chat) => {
              return <Message key={chat.id} chat={chat} searchQuery={chatSearchQuery} expanded={expanded} />
            })}
            {pendingAgentChat && (
              <Message key={pendingAgentChat.id} chat={pendingAgentChat} searchQuery={chatSearchQuery} expanded={expanded} />
            )}
          </>
        ) : <ChatEmpty />
      }

      <div ref={bottomAnchorRef} className="h-px w-full" />
    </div>

    {
      !isOnBottom && <Button variant="outline" className='sticky bottom-0 right-0 size-8 self-end' onClick={handleScrollToBottom} aria-label="Scroll to bottom">
        <ArrowDownToLine className='size-4' />
      </Button>
    }
  </div>
})
ChatContent.displayName = 'ChatContent'

const MessageWrapper = React.memo(function MessageWrapper({
  chat,
  children,
  expanded = false,
}: { chat: Chat, children: React.ReactNode } & ChatLayoutProps) {
  // 用户消息：右对齐，内容气泡和操作栏分离，避免工具栏被卡片包裹。
  if (chat.role === 'user') {
    return (
      <div className="flex w-full justify-end" data-chat-id={chat.id}>
        <div className={cn("flex flex-col items-end", expanded ? "max-w-[min(78%,760px)]" : "max-w-[85%]")}>
          <div className={cn(
            "rounded-lg bg-muted/35 text-foreground/90 ring-1 ring-border/35 dark:bg-muted/20",
            expanded ? "px-4 py-2.5" : "px-3 py-2",
          )}>
            <div className={cn("whitespace-pre-wrap break-words text-sm leading-6", expanded ? "max-w-[82ch]" : "max-w-[75ch]")}>
              {children}
            </div>
          </div>
          <div className="max-w-full">
            <MessageControl chat={chat}>
              <></>
            </MessageControl>
          </div>
        </div>
      </div>
    )
  }

  // AI 消息：左对齐，无边框，无图标
  return (
    <div className="flex w-full min-w-0" data-chat-id={chat.id}>
      <div className='text-sm leading-6 flex-1 word-break min-w-0 overflow-hidden'>
        {children}
      </div>
    </div>
  )
})
MessageWrapper.displayName = 'MessageWrapper'

const Message = React.memo(function Message({
  chat,
  searchQuery,
  expanded = false,
}: { chat: Chat; searchQuery?: string } & ChatLayoutProps) {
  const t = useTranslations()
  const { chats, deleteChat, loading, agentState, researchRun } = useChatStore()
  const content = chat.content
  const displayContent = useMemo(
    () => chat.role === 'system' ? cleanAssistantGeneratedContent(content || '') : content,
    [chat.role, content]
  )
  const isPendingAgentMessage = chat.role === 'system'
    && chat.id === PENDING_AGENT_CHAT_ID
    && agentState.isRunning
    && agentState.activeChatId === undefined
  const isActiveAgentMessage = chat.role === 'system' && (
    agentState.activeChatId === chat.id || isPendingAgentMessage
  )
  const isLatestSystemMessage = useMemo(() => {
    if (chat.role !== 'system') return false

    for (let index = chats.length - 1; index >= 0; index -= 1) {
      if (chats[index].role === 'system') {
        return chats[index].id === chat.id
      }
    }

    return false
  }, [chat.id, chat.role, chats])
  const isBaseResponseStreaming = chat.role === 'system' && loading && !isActiveAgentMessage && isLatestSystemMessage
  const liveTextPartContent = useMemo(() => {
    if (!isActiveAgentMessage) return ''
    const textPart = [...(agentState.agentPartSnapshot?.parts || [])]
      .reverse()
      .find(part => part.type === 'text' && part.visibility === 'visible' && typeof part.text === 'string')
    return textPart?.type === 'text' ? textPart.text : ''
  }, [agentState.agentPartSnapshot?.parts, isActiveAgentMessage])
  const liveFinalAnswerContent = useMemo(
    () => cleanAssistantGeneratedContent(liveTextPartContent || agentState.finalAnswerContent || ''),
    [agentState.finalAnswerContent, liveTextPartContent]
  )
  const isLiveAgentActive = isActiveAgentMessage && (agentState.isRunning || agentState.isFinalAnswerMode)
  const isLiveAgentResponseStreaming = isActiveAgentMessage && (
    agentState.isRunning || (agentState.isFinalAnswerMode && loading)
  )
  const isResponseStreaming = chat.role === 'system' && (isBaseResponseStreaming || isLiveAgentResponseStreaming)
  const shouldShowLiveAgentStatus = isActiveAgentMessage
    && agentState.isRunning
    && !agentState.isFinalAnswerMode
    && !liveFinalAnswerContent
  const shouldShowLiveFinalAnswer = isActiveAgentMessage && agentState.isFinalAnswerMode && Boolean(liveFinalAnswerContent)
  const isLiveFinalAnswerStreaming = shouldShowLiveFinalAnswer && (agentState.isRunning || loading)
  const visibleThinkingContent = useMemo(
    () => chat.role === 'system' ? cleanAssistantGeneratedContent(chat.thinking || '') : (chat.thinking || ''),
    [chat.role, chat.thinking],
  )
  const researchProgress = useMemo(
    () => chat.role === 'system' ? parseResearchProgressView(content) : null,
    [chat.role, content],
  )
  const liveResearchProgress = chat.role === 'system'
    && researchRun.activeChatId === chat.id
    && researchRun.progressView
    ? researchRun.progressView
    : null
  const visibleResearchProgress = liveResearchProgress || researchProgress
  const shouldShowStoredContent = !isLiveAgentActive
    && (!visibleResearchProgress || (visibleResearchProgress && visibleResearchProgress.statusText === '研究完成，正在收尾' && displayContent?.trim()))
  const researchResume = useMemo(
    () => chat.role === 'system' ? parseResearchResumeData(content) : null,
    [chat.role, content],
  )

  const handleRemoveClearContext = useCallback(() => {
    deleteChat(chat.id)
  }, [chat.id, deleteChat])

  // 解析 RAG 来源
  const ragSources = useMemo(() => {
    if (!chat.ragSources) return []
    try {
      return filterVisibleRagSources(JSON.parse(chat.ragSources) as string[])
    } catch {
      return []
    }
  }, [chat.ragSources])

  // 解析 RAG 来源详情
  const ragSourceDetails = useMemo(() => {
    if (!chat.ragSourceDetails) return []
    try {
      return filterVisibleCitationDetails(JSON.parse(chat.ragSourceDetails) as MessageCitationDetail[])
    } catch {
      return []
    }
  }, [chat.ragSourceDetails])

  const storedAgentHistory = useMemo(
    () => parseStoredAgentHistory(chat.agentHistory),
    [chat.agentHistory]
  )
  const storedRunSummary = useMemo(() => {
    if (!storedAgentHistory) return null
    const steps = storedAgentHistory.steps || []
    const elapsedMs = storedAgentHistory.telemetry?.elapsedMs ?? steps.reduce(
      (sum: number, step: { duration?: number }) => sum + (typeof step.duration === 'number' ? step.duration : 0),
      0,
    )

    return {
      elapsedMs,
      telemetry: storedAgentHistory.telemetry,
      steps,
      toolCalls: storedAgentHistory.toolCalls || [],
      events: storedAgentHistory.events || [],
      partSnapshot: storedAgentHistory.partSnapshot,
    }
  }, [storedAgentHistory])

  const webCitationDetails = useMemo(() => {
    const storedToolCalls = storedAgentHistory?.toolCalls || []
    const liveToolCalls = isActiveAgentMessage ? agentState.toolCalls : []
    return extractWebCitationDetails([...storedToolCalls, ...liveToolCalls])
  }, [agentState.toolCalls, isActiveAgentMessage, storedAgentHistory])

  const citationDetails = useMemo(
    () => [...ragSourceDetails, ...webCitationDetails],
    [ragSourceDetails, webCitationDetails]
  )

  // 解析图片数组
  const images = useMemo(() => {
    if (!chat.images) return []
    try {
      return JSON.parse(chat.images) as string[]
    } catch {
      return []
    }
  }, [chat.images])

  // 解析引用数据
  const quoteData = useMemo(() => {
    if (!chat.quoteData) return null
    try {
      return JSON.parse(chat.quoteData) as {
        quote: string
        fullContent: string
        fileName: string
        startLine: number
        endLine: number
        from: number
        to: number
        articlePath: string
      }
    } catch {
      return null
    }
  }, [chat.quoteData])

  switch (chat.type) {
    case 'clear':
      return <div className="w-full flex justify-center items-center gap-4 px-10">
        <Separator className='flex-1' />
        <div className="flex justify-center items-center gap-2 w-32 group h-8">
          <p className="text-sm text-center text-muted-foreground">{t('record.chat.input.clearContext.tooltip')}</p>
          <X className="size-4 hidden group-hover:flex cursor-pointer" onClick={handleRemoveClearContext} />
        </div>
        <Separator className='flex-1' />
      </div>

    case 'clipboard':
      return <MessageWrapper chat={chat} expanded={expanded}>
        <ChatClipboard chat={chat} />
      </MessageWrapper>

    case 'note':
      return <MessageWrapper chat={chat} expanded={expanded}>
        {
          <div className='w-full overflow-x-hidden'>
            <div className='flex justify-between'>
              <p>{t('record.chat.content.organize')}</p>
            </div>
            <ChatThinking chat={chat} isStreaming={isResponseStreaming} />
            {
              <div className={`${content ? 'note-wrapper border w-full overflow-y-auto overflow-x-hidden my-2 p-4 rounded-lg' : ''}`}>
                <ChatPreview
                  text={content || ''}
                  streaming={isResponseStreaming}
                  className={expanded ? "flex-1 max-w-full" : undefined}
                />
              </div>
            }
            <MessageControl chat={chat}>
              <></>
            </MessageControl>
          </div>
        }
      </MessageWrapper>

    default:
      // 检查 AI 消息是否有实际内容（没有内容时不渲染）
      const hasContent = chat.role === 'system' && (
        !!content ||
        !!visibleResearchProgress ||
        (!storedAgentHistory && !!visibleThinkingContent) ||
        ragSources.length > 0 ||
        citationDetails.length > 0 ||
        isLiveAgentActive ||
        isResponseStreaming
      )

      // 用户消息或有内容的 AI 消息才渲染
      if (chat.role === 'system' && !hasContent) {
        return null
      }

      return <MessageWrapper chat={chat} expanded={expanded}>
        {chat.role === 'system' ? (
          // AI 消息：优化后的布局结构
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full space-y-2.5"
          >
            {/* 2. Agent 实时执行状态 */}
            {(shouldShowLiveAgentStatus || shouldShowLiveFinalAnswer) && (
              <div className="space-y-2">
                <AgentExecutionStatus />
                {shouldShowLiveFinalAnswer && (
                  <ChatPreview
                    text={liveFinalAnswerContent}
                    streaming={isLiveFinalAnswerStreaming}
                    className={expanded ? "flex-1 max-w-full" : undefined}
                  />
                )}
              </div>
            )}

            {/* 4. 思考内容 - Agent 状态以 Codex 风格轻摘要展示，细节点击后查看 */}
            {!isLiveAgentActive && storedRunSummary && (
              <AgentRunSummary
                elapsedMs={storedRunSummary.elapsedMs}
                telemetry={storedRunSummary.telemetry}
                visibleOutput={displayContent || ''}
                steps={storedRunSummary.steps}
                toolCalls={storedRunSummary.toolCalls}
                events={storedRunSummary.events}
                partSnapshot={storedRunSummary.partSnapshot}
              />
            )}
            {!isLiveAgentActive && !storedAgentHistory && (
              <ChatThinking
                chat={chat}
                isStreaming={isResponseStreaming}
                citationDetails={citationDetails}
                ragSources={ragSources}
              />
            )}

            {/* 5. 恢复研究卡片 + 研究进度 + 正式回复内容 */}
            {researchResume && (
              <ResearchResumeCard data={researchResume} />
            )}
            {visibleResearchProgress && (
              <TaskPlanProgress view={visibleResearchProgress} content={content || ''} compact={false} className="max-w-2xl" />
            )}
            {shouldShowStoredContent && (
              <ChatPreview
                text={displayContent || ''}
                streaming={isResponseStreaming}
                highlightQuery={searchQuery}
                clawFormat={Boolean(storedAgentHistory)}
                className={expanded ? "flex-1 max-w-full" : undefined}
              />
            )}

            {citationDetails.length > 0 && !isLiveAgentActive && (
              <MessageCitations
                details={citationDetails}
                content={displayContent || ''}
                embedded
              />
            )}

            {/* 6. 统一操作栏：标记、复制、翻译、朗读、重试、删除 */}
            {!isPendingAgentMessage && (
              <MessageControl chat={chat}>
                <MarkText chat={chat} />
              </MessageControl>
            )}
          </motion.div>
        ) : (
          // 用户消息
          <div className="w-full space-y-3">
            {/* 显示用户消息中的图片 */}
            {images.length > 0 && <ChatImages images={images} />}
            {/* 显示用户消息中的引用 */}
            {quoteData && (
              <div className="flex flex-col gap-1 text-[11px]">
                <div className="flex items-center gap-1">
                  <QuoteIcon className="size-3 text-primary/75" />
                  <span className="text-primary/75">
                    {quoteData.startLine !== -1 && quoteData.endLine !== -1 ? (
                      quoteData.startLine === quoteData.endLine ? (
                        t('record.chat.quote.lineSingle', { fileName: quoteData.fileName, line: quoteData.startLine })
                      ) : (
                        t('record.chat.quote.lineRange', { fileName: quoteData.fileName, startLine: quoteData.startLine, endLine: quoteData.endLine })
                      )
                    ) : (
                      t('record.chat.quote.noLine', { fileName: quoteData.fileName })
                    )}
                  </span>
                </div>
                <div className="text-primary/50 line-clamp-2 whitespace-pre-wrap pl-4">
                  {quoteData.fullContent}
                </div>
              </div>
            )}
            {content && (
              <div className="whitespace-pre-wrap">{searchQuery ? highlightTextReact(content, searchQuery) : content}</div>
            )}
          </div>
        )}
      </MessageWrapper>
  }
})
Message.displayName = 'Message'

export default ChatContent
