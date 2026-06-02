"use client"

import * as React from "react"
import { AlertTriangle, Coins, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import useChatStore from "@/stores/chat"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { resolveModelContextWindow } from "@/lib/ai/context-window"

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

function formatPreciseTokenCount(count: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(count)))
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
      // 计算输入文本的 token
      const inputTokens = estimateTokens(inputText)

      // 计算历史消息的 token（最近 20 条）
      const recentChats = chats.slice(-20)
      const historyTokens = recentChats.reduce((sum, chat) => {
        return sum + estimateTokens(chat.content || '')
      }, 0)

      // 总 token
      const totalTokens = inputTokens + historyTokens

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
  const [tokenStats, setTokenStats] = React.useState({
    inputTokens: 0,
    historyTokens: 0,
    totalTokens: 0,
  })
  const contextLimit = React.useMemo(
    () => resolveModelContextWindow(contextWindow, model),
    [contextWindow, model],
  )

  React.useEffect(() => {
    const inputTokens = estimateTokens(inputText)
    const recentChats = chats.slice(-20)
    const historyTokens = recentChats.reduce((sum, chat) => {
      return sum + estimateTokens(chat.content || '')
    }, 0)

    setTokenStats({
      inputTokens,
      historyTokens,
      totalTokens: inputTokens + historyTokens,
    })
  }, [inputText, chats])

  if (!inputText && chats.length === 0) {
    return null
  }

  const { inputTokens, historyTokens, totalTokens } = tokenStats
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
  const inputShare = totalTokens > 0 ? Math.min((inputTokens / totalTokens) * 100, 100) : 0
  const historyShare = totalTokens > 0 ? Math.min((historyTokens / totalTokens) * 100, 100) : 0

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-7 w-7 items-center justify-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
              isOverLimit && "text-red-500",
              isNearLimit && !isOverLimit && "text-amber-500",
              className
            )}
            aria-label={`上下文占用 ${percentage}%`}
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
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-[220px] rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium leading-none text-foreground">
                <Gauge className="size-3.5 text-muted-foreground" />
                <span>上下文容量</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                最近 20 条消息 + 当前输入
              </div>
            </div>
            <div className={cn("shrink-0 text-right text-xs font-medium", statusClassName)}>
              {statusLabel}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-2xl font-semibold leading-none tracking-normal tabular-nums text-foreground">
                {precisePercentage < 1 && totalTokens > 0 ? '<1' : Math.round(precisePercentage)}%
              </div>
              <div className="text-right text-[11px] leading-4 text-muted-foreground tabular-nums">
                <div>{formatTokenCount(totalTokens)} / {formatTokenCount(contextLimit)}</div>
                <div>剩余 {formatTokenCount(remainingTokens)}</div>
              </div>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  isOverLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-emerald-500"
                )}
                style={{ width: `${Math.max(usage * 100, totalTokens > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary/70" />
                <span>当前输入</span>
              </div>
              <span className="tabular-nums text-foreground">{formatPreciseTokenCount(inputTokens)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${inputShare}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/45" />
                <span>最近历史</span>
              </div>
              <span className="tabular-nums text-foreground">{formatPreciseTokenCount(historyTokens)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-muted-foreground/45" style={{ width: `${historyShare}%` }} />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})
ChatContextRing.displayName = 'ChatContextRing'
