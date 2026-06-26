"use client"

import * as React from "react"
import { Coins, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import useChatStore from "@/stores/chat"
import { buildLatestContextTokenUsage } from "@/lib/ai/chat-token-usage"

// ============================================================
// 极简 Token 角标 - 只在 hover 或接近限制时显示
// ============================================================

interface TokenBadgeProps {
  inputText: string
  className?: string
}

export const TokenBadge = React.memo(function TokenBadge({
  inputText,
  className,
}: TokenBadgeProps) {
  const { chats } = useChatStore()
  const [contextUsage, setContextUsage] = React.useState(0)

  React.useEffect(() => {
    const calculateTokens = () => {
      const totalTokens = buildLatestContextTokenUsage({
        inputText,
        chats,
        maxFallbackHistoryMessages: 20,
      }).totalTokens
      
      const contextLimit = 32768
      setContextUsage(Math.min((totalTokens / contextLimit) * 100, 100))
    }

    calculateTokens()
  }, [inputText, chats])

  // 没有输入时不显示
  if (!inputText) return null

  const isNearLimit = contextUsage > 80
  const isOverLimit = contextUsage > 100

  // 只在接近限制时显示警告
  if (!isNearLimit) return null

  return (
    <div className={cn(
      "absolute -top-6 right-0 flex items-center gap-1",
      "text-[10px] tabular-nums",
      "text-muted-foreground/50",
      "transition-opacity duration-200",
      isOverLimit ? "text-red-500" : "text-amber-500",
      className
    )}>
      <AlertTriangle className="size-3" />
      <span>{contextUsage.toFixed(0)}% 上下文</span>
    </div>
  )
})
TokenBadge.displayName = 'TokenBadge'

// ============================================================
// 极简 Token 气泡 - hover 时显示
// ============================================================

interface TokenBubbleProps {
  inputText: string
  visible: boolean
  className?: string
}

export const TokenBubble = React.memo(function TokenBubble({
  inputText,
  visible,
  className,
}: TokenBubbleProps) {
  const { chats } = useChatStore()
  const [estimatedTokens, setEstimatedTokens] = React.useState(0)
  const [contextUsage, setContextUsage] = React.useState(0)

  React.useEffect(() => {
    const calculateTokens = () => {
      const totalTokens = buildLatestContextTokenUsage({
        inputText,
        chats,
        maxFallbackHistoryMessages: 20,
      }).totalTokens
      setEstimatedTokens(totalTokens)
      
      const contextLimit = 32768
      setContextUsage(Math.min((totalTokens / contextLimit) * 100, 100))
    }

    calculateTokens()
  }, [inputText, chats])

  if (!visible || !inputText) return null

  return (
    <div className={cn(
      "absolute -top-8 right-0 z-50",
      "px-2 py-1 rounded-md",
      "bg-popover text-popover-foreground",
      "border shadow-sm",
      "text-[10px] tabular-nums",
      "animate-in fade-in-0 zoom-in-95",
      className
    )}>
      <div className="flex items-center gap-1.5">
        <Coins className="size-3 text-muted-foreground" />
        <span>{estimatedTokens >= 1000 
          ? `${(estimatedTokens / 1000).toFixed(1)}K` 
          : estimatedTokens
        } tokens</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{contextUsage.toFixed(0)}%</span>
      </div>
    </div>
  )
})
TokenBubble.displayName = 'TokenBubble'
