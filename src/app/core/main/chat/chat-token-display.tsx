"use client"

import * as React from "react"
import { Coins, AlertTriangle } from "lucide-react"
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
  const [estimatedTokens, setEstimatedTokens] = React.useState(0)
  const contextLimit = React.useMemo(
    () => resolveModelContextWindow(contextWindow, model),
    [contextWindow, model],
  )

  React.useEffect(() => {
    const inputTokens = estimateTokens(inputText)
    const historyTokens = chats.slice(-20).reduce((sum, chat) => {
      return sum + estimateTokens(chat.content || '')
    }, 0)

    setEstimatedTokens(inputTokens + historyTokens)
  }, [inputText, chats])

  if (!inputText && chats.length === 0) {
    return null
  }

  const usage = contextLimit > 0 ? Math.min(estimatedTokens / contextLimit, 1) : 0
  const percentage = Math.round(usage * 100)
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - usage)
  const isNearLimit = percentage >= 85
  const isOverLimit = estimatedTokens > contextLimit

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted/40",
              isOverLimit && "text-red-500",
              isNearLimit && !isOverLimit && "text-amber-500",
              className
            )}
            aria-label={`上下文占用 ${percentage}%`}
          >
            <svg
              viewBox="0 0 18 18"
              className="size-4 -rotate-90"
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
        <TooltipContent side="top" className="space-y-1 text-xs">
          <div className="font-medium text-foreground">上下文</div>
          <div className="tabular-nums">
            {percentage}% · {formatTokenCount(estimatedTokens)} / {formatTokenCount(contextLimit)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})
ChatContextRing.displayName = 'ChatContextRing'
