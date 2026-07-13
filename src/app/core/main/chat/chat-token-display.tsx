"use client"

import * as React from "react"
import { AlertTriangle, Coins } from "lucide-react"
import { cn } from "@/lib/utils"
import useChatStore from "@/stores/chat"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { resolveModelContextWindow } from "@/lib/ai/context-window"
import { buildLatestContextTokenUsage } from "@/lib/ai/chat-token-usage"
import { getConversationTurnCount } from "@/lib/ai/conversation-continuity"

// ============================================================
// Helper Functions
// ============================================================

function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}

// ============================================================
// Component
// ============================================================

interface ChatTokenDisplayProps {
  inputText: string
  model?: string
  contextWindow?: number
  className?: string
}

export const ChatTokenDisplay = React.memo(function ChatTokenDisplay({
  inputText,
  model = 'default',
  contextWindow,
  className,
}: ChatTokenDisplayProps) {
  const { chats } = useChatStore()
  const [estimatedTokens, setEstimatedTokens] = React.useState(0)
  const [contextUsage, setContextUsage] = React.useState(0)

  // 计算 Token 用量
  React.useEffect(() => {
    const calculateTokens = () => {
      const usage = buildLatestContextTokenUsage({
        inputText,
        chats,
        maxFallbackHistoryMessages: 20,
      })
      const totalTokens = usage.totalTokens

      setEstimatedTokens(totalTokens)

      // 计算上下文窗口使用率
      // 这里简化处理，实际应该根据当前使用的模型来判断
      const contextLimit = resolveModelContextWindow(contextWindow, model)
      setContextUsage(Math.min((totalTokens / contextLimit) * 100, 100))
    }

    calculateTokens()
  }, [inputText, chats, model, contextWindow])

  // 如果没有输入，不显示
  if (!inputText && chats.length === 0) {
    return null
  }

  const isNearLimit = contextUsage > 80
  const isOverLimit = contextUsage > 100

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs text-muted-foreground",
      className
    )}>
      <Coins className="size-3" />
      <span className="tabular-nums">
        {formatTokenCount(estimatedTokens)} tokens
      </span>
      {contextUsage > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className={cn(
            "tabular-nums",
            isOverLimit ? "text-red-500" : isNearLimit ? "text-amber-500" : ""
          )}>
            {contextUsage.toFixed(0)}% 上下文
          </span>
          {isNearLimit && (
            <AlertTriangle className={cn(
              "size-3",
              isOverLimit ? "text-red-500" : "text-amber-500"
            )} />
          )}
        </>
      )}
    </div>
  )
})
ChatTokenDisplay.displayName = 'ChatTokenDisplay'

interface ChatContextRingProps {
  inputText: string
  model?: string
  contextWindow?: number
  className?: string
}

export const ChatContextRing = React.memo(function ChatContextRing({
  inputText,
  model = 'default',
  contextWindow,
  className,
}: ChatContextRingProps) {
  const { chats } = useChatStore()
  const conversationTurnCount = React.useMemo(() => getConversationTurnCount(chats), [chats])
  const [tokenStats, setTokenStats] = React.useState({
    inputTokens: 0,
    historyTokens: 0,
    measuredTokens: 0,
    totalTokens: 0,
  })
  const contextLimit = React.useMemo(
    () => resolveModelContextWindow(contextWindow, model),
    [contextWindow, model],
  )

  React.useEffect(() => {
    const usage = buildLatestContextTokenUsage({
      inputText,
      chats,
      maxFallbackHistoryMessages: 20,
    })
    const currentInputTokens = usage.estimatedTokens
    const measuredTokens = usage.hasMeasuredUsage
      ? Math.max(usage.totalTokens - currentInputTokens, 0)
      : 0
    const historyTokens = usage.hasMeasuredUsage
      ? measuredTokens
      : Math.max(usage.totalTokens - currentInputTokens, 0)

    setTokenStats({
      inputTokens: currentInputTokens,
      historyTokens,
      measuredTokens,
      totalTokens: usage.totalTokens,
    })
  }, [inputText, chats])

  if (!inputText && chats.length === 0) {
    return null
  }

  const { inputTokens, historyTokens, measuredTokens, totalTokens } = tokenStats
  const usage = contextLimit > 0 ? Math.min(totalTokens / contextLimit, 1) : 0
  const percentage = Math.round(usage * 100)
  const precisePercentage = contextLimit > 0 ? Math.min((totalTokens / contextLimit) * 100, 999) : 0
  const remainingTokens = Math.max(contextLimit - totalTokens, 0)
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - usage)
  const isNearLimit = percentage >= 85
  const isOverLimit = totalTokens > contextLimit
  const statusLabel = isOverLimit ? '已超出' : isNearLimit ? '接近上限' : '余量充足'
  const statusClassName = isOverLimit
    ? 'text-red-500'
    : isNearLimit
      ? 'text-amber-500'
      : 'text-emerald-600 dark:text-emerald-400'
  const percentageLabel = precisePercentage < 1 && totalTokens > 0 ? '<1%' : `${Math.round(precisePercentage)}%`

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "group relative flex h-7 w-7 items-center justify-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
              isOverLimit && "text-red-500",
              isNearLimit && !isOverLimit && "text-amber-500",
              className
            )}
            aria-label={`上下文占用 ${percentage}%，延续 ${conversationTurnCount} 轮对话，长期记忆按需检索`}
            >
              <svg
                viewBox="0 0 18 18"
                className="size-4 -rotate-90 transition-transform group-hover:scale-105"
                aria-hidden="true"
              >
              <circle
                cx="9"
                cy="9"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.18"
                strokeWidth="2"
              />
              <circle
                cx="9"
                cy="9"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            {conversationTurnCount > 0 && (
              <span
                className="absolute bottom-1 right-1 size-1.5 rounded-full border border-background bg-emerald-500"
                aria-hidden="true"
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="end"
          sideOffset={6}
          className="w-[188px] rounded-md border bg-popover px-2.5 py-2 text-popover-foreground shadow-sm"
        >
          <div className="space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">上下文</span>
              <span className={cn("font-medium", statusClassName)}>{statusLabel}</span>
            </div>

            <div className="flex items-center justify-between gap-2 tabular-nums">
              <span className="text-sm font-semibold text-foreground">{percentageLabel}</span>
              <span className="text-muted-foreground">
                {formatTokenCount(totalTokens)} / {formatTokenCount(contextLimit)}
              </span>
            </div>

            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  isOverLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-emerald-500"
                )}
                style={{ width: `${Math.max(usage * 100, totalTokens > 0 ? 2 : 0)}%` }}
              />
            </div>

            <div className="grid gap-1 border-t border-border/50 pt-2 tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">会话延续</span>
                <span className="text-foreground">
                  {conversationTurnCount > 0 ? `${conversationTurnCount} 轮` : '新会话'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">长期记忆</span>
                <span className="text-foreground">按需检索</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">输入</span>
                <span className="text-foreground">{formatTokenCount(inputTokens)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {measuredTokens > 0 ? '模型上下文' : '历史'}
                </span>
                <span className="text-foreground">{formatTokenCount(historyTokens)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">剩余</span>
                <span className="text-foreground">{formatTokenCount(remainingTokens)}</span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})
ChatContextRing.displayName = 'ChatContextRing'
