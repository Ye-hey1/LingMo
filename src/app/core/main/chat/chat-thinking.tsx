"use client"

import { Chat } from "@/db/chats"
import { useState, useEffect, useMemo, useRef } from "react"
import { Brain, ChevronDown, Clock, Link2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import type { MessageCitationDetail } from "@/lib/ai/citations"

interface ChatThinkingProps {
  chat: Chat
  /** 是否为流式模式（正在思考中） */
  isStreaming?: boolean
  citationDetails?: MessageCitationDetail[]
  ragSources?: string[]
}

function formatThinkDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function getCitationLabel(detail: MessageCitationDetail, index: number) {
  return detail.title || detail.filename || detail.url || detail.filepath || detail.articlePath || `来源 ${index + 1}`
}

function getCitationTarget(detail: MessageCitationDetail) {
  return detail.url || detail.filepath || detail.articlePath || ''
}

function getCompactSourceLabel(label: string, target: string) {
  const value = label || target

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const firstPath = url.pathname.split('/').filter(Boolean)[0]
      return firstPath ? `${url.hostname}/${firstPath}` : url.hostname
    } catch {
      return value
    }
  }

  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) || value
}

export default function ChatThinking({
  chat,
  isStreaming = false,
  citationDetails = [],
  ragSources = [],
}: ChatThinkingProps) {
  const thinkingContent = chat.thinking || ''
  const hasThinkingContent = !!thinkingContent.trim()
  const sourceLinks = useMemo(() => {
    const seen = new Set<string>()
    const items: Array<{ key: string; label: string; target: string; external: boolean }> = []

    citationDetails.forEach((detail, index) => {
      const target = getCitationTarget(detail).trim()
      const label = getCitationLabel(detail, index).trim()
      const key = target || label
      if (!key || seen.has(key)) return
      seen.add(key)
      items.push({
        key,
        label: getCompactSourceLabel(label, target),
        target,
        external: /^https?:\/\//i.test(target),
      })
    })

    ragSources.forEach((source) => {
      const target = source.trim()
      if (!target || seen.has(target)) return
      seen.add(target)
      items.push({
        key: target,
        label: getCompactSourceLabel(target, target),
        target,
        external: /^https?:\/\//i.test(target),
      })
    })

    return items
  }, [citationDetails, ragSources])
  const hasCitations = sourceLinks.length > 0
  const isThinking = isStreaming
  const showCitationLinks = !isThinking && hasCitations

  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const wasThinkingRef = useRef(false)

  const durationCacheKey = chat.id ? `chat-thinking-duration:${chat.id}` : null

  useEffect(() => {
    if (!durationCacheKey || typeof window === 'undefined') return

    const cached = window.sessionStorage.getItem(durationCacheKey)
    const cachedDuration = cached ? Number(cached) : 0
    if (Number.isFinite(cachedDuration) && cachedDuration > 0) {
      elapsedRef.current = cachedDuration
      setElapsed(cachedDuration)
    }
  }, [durationCacheKey])

  useEffect(() => {
    if (isThinking) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now()
        elapsedRef.current = 0
        setElapsed(0)
      }
      wasThinkingRef.current = true
      setIsExpanded(true)

      const interval = setInterval(() => {
        if (startTimeRef.current) {
          const nextElapsed = Date.now() - startTimeRef.current
          elapsedRef.current = nextElapsed
          setElapsed(nextElapsed)
        }
      }, 100)

      return () => clearInterval(interval)
    }

    if (wasThinkingRef.current) {
      const finalElapsed = startTimeRef.current
        ? Date.now() - startTimeRef.current
        : elapsedRef.current

      if (finalElapsed > 0) {
        elapsedRef.current = finalElapsed
        setElapsed(finalElapsed)
        if (durationCacheKey && typeof window !== 'undefined') {
          window.sessionStorage.setItem(durationCacheKey, String(finalElapsed))
        }
      }

      startTimeRef.current = null
      wasThinkingRef.current = false
      setIsExpanded(false)
      return
    }

    if (!hasThinkingContent) {
      startTimeRef.current = null
      elapsedRef.current = 0
      wasThinkingRef.current = false
      setElapsed(0)
    }
  }, [durationCacheKey, hasThinkingContent, isThinking])

  useEffect(() => {
    if (isThinking && isExpanded && contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight
        }
      })
    }
  }, [thinkingContent, isThinking, isExpanded])

  if (!hasThinkingContent && !hasCitations && !isThinking) return null

  const showTimer = isThinking || elapsed > 0
  const statusText = isThinking
    ? '思考中...'
    : hasThinkingContent
      ? '已思考'
      : '引用来源'

  return (
    <div className="mb-2 w-full select-none rounded-md border border-border/25 bg-muted/10 px-2 py-1.5">
      <button
        type="button"
        aria-expanded={isExpanded}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5",
          "text-left transition-colors duration-150",
          "hover:bg-muted/35 active:bg-muted/50",
          isThinking && "bg-muted/20"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isThinking ? (
          <Loader2 className="size-3.5 text-muted-foreground animate-spin" />
        ) : (
          <Brain className="size-3.5 text-muted-foreground/70" />
        )}

        <span className="text-xs text-muted-foreground">
          {statusText}
        </span>

        {showTimer && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50 tabular-nums">
            <Clock className="size-2.5" />
            {formatThinkDuration(elapsed)}
          </span>
        )}

        {hasCitations && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground/70">
            <Link2 className="size-2.5" />
            {sourceLinks.length}
          </span>
        )}

        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown className="size-3 text-muted-foreground/50" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.15, ease: "easeOut" },
              opacity: { duration: 0.1 },
            }}
            className="overflow-hidden"
          >
            <div
              ref={contentRef}
              className={cn(
                "max-h-[220px] space-y-2 overflow-y-auto pb-1 pt-1",
                "scrollbar-thin scrollbar-thumb-border/50 scrollbar-track-transparent"
              )}
            >
              {hasThinkingContent && (
                <div className={cn(
                  "rounded-md bg-muted/20 px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words",
                  "text-muted-foreground/65",
                  "font-mono"
                )}>
                  {thinkingContent}
                </div>
              )}

              {isThinking && !hasThinkingContent && (
                <div className="px-1 py-0.5 text-[11px] leading-5 text-muted-foreground/60">
                  正在接收思考内容...
                </div>
              )}

              {showCitationLinks && (
                <div className="flex flex-wrap items-center gap-1 text-[11px] leading-5 text-muted-foreground/80">
                  {sourceLinks.map((source, index) => (
                    <span
                      key={source.key}
                      className={cn(
                        "inline-flex min-w-0 items-center gap-1 rounded-full border border-border/25 bg-background/45 px-1.5 py-0.5",
                        "max-w-[142px]",
                        index % 4 === 1 && "max-w-[104px]",
                        index % 4 === 2 && "max-w-[172px]",
                        index % 4 === 3 && "max-w-[128px]",
                      )}
                    >
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
                        {index + 1}.
                      </span>
                      {source.external ? (
                        <a
                          href={source.target}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate text-primary/85 underline-offset-2 hover:text-primary hover:underline"
                          title={source.target}
                        >
                          {source.label}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate" title={source.target || source.label}>
                          {source.label}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
