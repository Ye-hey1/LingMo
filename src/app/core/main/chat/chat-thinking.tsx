"use client"

import { Chat } from "@/db/chats"
import { useState, useEffect, useMemo, useRef } from "react"
import { Brain, ChevronDown, Link2, Loader2 } from "lucide-react"
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
    const items: Array<{ key: string; label: string; target: string; external: boolean; engine?: string; credibilityScore?: number }> = []

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
        engine: detail.engine,
        credibilityScore: detail.credibilityScore,
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
  // 仅在流式传输且正式内容尚未开始输出时视为"思考中"
  // 一旦 chat.content 出现，说明模型已完成思考进入输出阶段
  const isThinking = isStreaming && !chat.content?.trim()
  const showCitationLinks = !isThinking && hasCitations

  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isThinking && isExpanded && contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight
        }
      })
    }
  }, [thinkingContent, isThinking, isExpanded])

  if (!hasThinkingContent && !hasCitations) return null

  const statusText = isThinking
    ? '思考中...'
    : hasThinkingContent
      ? `已思考`
      : '引用来源'

  return (
    <div className="mb-0.5 w-full select-none">
      <button
        type="button"
        aria-expanded={isExpanded}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5",
          "text-left transition-all duration-150",
          "text-muted-foreground/60 hover:bg-muted/20 hover:text-muted-foreground/80 active:bg-muted/30",
          isThinking && "bg-blue-50/40 dark:bg-blue-950/20"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isThinking ? (
          <Loader2 className="size-3 text-blue-500 animate-spin" />
        ) : (
          <Brain className="size-3 text-muted-foreground/50" />
        )}

        <span className="text-[11px] font-medium">
          {statusText}
        </span>

        {hasCitations && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/25 px-1.5 py-0 text-[10px] text-muted-foreground/55">
            <span className="size-1.5 rounded-full bg-primary/30" />
            {sourceLinks.length}
          </span>
        )}

        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown className="size-2.5 text-muted-foreground/35" />
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
                  "rounded-md border border-border/15 bg-muted/8 px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words",
                  "text-muted-foreground/55",
                  "font-mono"
                )}>
                  {thinkingContent}
                </div>
              )}

              {showCitationLinks && (
                <div className="flex flex-wrap items-center gap-1 text-[11px] leading-5 text-muted-foreground/70">
                  {sourceLinks.map((source, index) => (
                    <span
                      key={source.key}
                      className={cn(
                        "inline-flex min-w-0 items-center gap-1 rounded-full border border-border/15 bg-background/40 px-1.5 py-0.5",
                        "max-w-[142px]",
                        "transition-colors hover:border-border/30 hover:bg-background/60",
                        index % 4 === 1 && "max-w-[104px]",
                        index % 4 === 2 && "max-w-[172px]",
                        index % 4 === 3 && "max-w-[128px]",
                      )}
                      title={source.engine ? `${source.engine} · ${source.target || source.label}` : (source.target || source.label)}
                    >
                      <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/35">
                        {index + 1}
                      </span>
                      {source.engine && (
                        <span className={cn(
                          "shrink-0 text-[8px] leading-none px-0.5 rounded-sm",
                          source.engine === 'tavily' ? 'text-cyan-600 bg-cyan-50/50' :
                          source.engine === 'duckduckgo' ? 'text-orange-600 bg-orange-50/50' :
                          source.engine.includes('anysearch') ? 'text-violet-600 bg-violet-50/50' :
                          source.engine.includes('firecrawl') ? 'text-amber-600 bg-amber-50/50' :
                          source.engine === 'serpapi' ? 'text-blue-600 bg-blue-50/50' :
                          source.engine === 'exa' ? 'text-emerald-600 bg-emerald-50/50' :
                          source.engine === 'crawler' ? 'text-rose-600 bg-rose-50/50' :
                          'text-muted-foreground/40 bg-muted/20'
                        )}>
                          {source.engine.includes('anysearch') ? 'AS' :
                           source.engine === 'duckduckgo' ? 'DDG' :
                           source.engine === 'crawler' ? 'CR' :
                           source.engine.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {source.external ? (
                        <a
                          href={source.target}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate text-primary/75 underline-offset-2 hover:text-primary hover:underline"
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
