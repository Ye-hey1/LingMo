"use client"

import * as React from "react"
import { 
  File, 
  Folder, 
  ImageIcon, 
  Quote, 
  X, 
  Coins, 
  AlertTriangle,
  CornerDownLeft
} from "lucide-react"
import { cn } from "@/lib/utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import useChatStore from "@/stores/chat"
import { motion } from "framer-motion"
import type { LinkedResource } from "@/lib/files"
import { isLinkedFolder } from "@/lib/files"
import type { ImageAttachment } from "./image-attachments"
import type { PendingQuote } from "@/stores/chat"

// ============================================================
// Token 用量显示
// ============================================================

interface TokenUsageProps {
  inputText: string
  className?: string
}

export const TokenUsage = React.memo(function TokenUsage({
  inputText,
  className,
}: TokenUsageProps) {
  const { chats } = useChatStore()
  const [estimatedTokens, setEstimatedTokens] = React.useState(0)
  const [contextUsage, setContextUsage] = React.useState(0)

  React.useEffect(() => {
    const calculateTokens = () => {
      const inputTokens = estimateTokens(inputText)
      const recentChats = chats.slice(-20)
      const historyTokens = recentChats.reduce((sum, chat) => {
        return sum + estimateTokens(chat.content || '')
      }, 0)
      const totalTokens = inputTokens + historyTokens
      setEstimatedTokens(totalTokens)
      
      // 简化的上下文窗口计算
      const contextLimit = 32768
      setContextUsage(Math.min((totalTokens / contextLimit) * 100, 100))
    }

    calculateTokens()
  }, [inputText, chats])

  if (!inputText && chats.length === 0) return null

  const isNearLimit = contextUsage > 80
  const isOverLimit = contextUsage > 100

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-[10px] text-muted-foreground/60",
      className
    )}>
      <Coins className="size-2.5" />
      <span className="tabular-nums">
        {estimatedTokens >= 1000 
          ? `${(estimatedTokens / 1000).toFixed(1)}K` 
          : estimatedTokens
        } tokens
      </span>
      {contextUsage > 0 && (
        <>
          <span className="text-muted-foreground/30">·</span>
          <span className={cn(
            "tabular-nums",
            isOverLimit ? "text-red-500" : isNearLimit ? "text-amber-500" : ""
          )}>
            {contextUsage.toFixed(0)}%
          </span>
          {isNearLimit && (
            <AlertTriangle className={cn(
              "size-2.5",
              isOverLimit ? "text-red-500" : "text-amber-500"
            )} />
          )}
        </>
      )}
    </div>
  )
})
TokenUsage.displayName = 'TokenUsage'

// ============================================================
// 上下文指示器
// ============================================================

interface ContextIndicatorProps {
  pendingQuote: PendingQuote | null
  linkedResources: LinkedResource[]
  attachedImages: ImageAttachment[]
  onClearQuote: () => void
  onRemoveResource: (key: string) => void
  onRemoveImage: (id: string) => void
  onClearAll: () => void
  className?: string
}

export const ContextIndicator = React.memo(function ContextIndicator({
  pendingQuote,
  linkedResources,
  attachedImages,
  onClearQuote,
  onRemoveResource,
  onRemoveImage,
  onClearAll,
  className,
}: ContextIndicatorProps) {
  const hasContext = pendingQuote || linkedResources.length > 0 || attachedImages.length > 0

  if (!hasContext) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-3 py-2",
        "bg-muted/30 border-t border-border/30",
        className
      )}
    >
      {/* 引用 */}
      {pendingQuote && (
        <ContextBadge
          icon={<Quote className="size-3" />}
          label={pendingQuote.fileName}
          detail={`第 ${pendingQuote.startLine}-${pendingQuote.endLine} 行`}
          onRemove={onClearQuote}
          color="amber"
        />
      )}

      {/* 关联文件 */}
      {linkedResources.map((resource) => {
        const key = resource.relativePath || resource.path || resource.name
        return (
          <ContextBadge
            key={key}
            icon={isLinkedFolder(resource) 
              ? <Folder className="size-3" />
              : <File className="size-3" />
            }
            label={resource.name}
            onRemove={() => onRemoveResource(key)}
            color="blue"
          />
        )
      })}

      {/* 图片 */}
      {attachedImages.map((image) => (
        <ContextBadge
          key={image.id}
          icon={<ImageIcon className="size-3" />}
          label={image.name || '图片'}
          onRemove={() => onRemoveImage(image.id)}
          color="green"
        />
      ))}

      {/* 清空按钮 */}
      {(linkedResources.length + attachedImages.length > 1) && (
        <button
          onClick={onClearAll}
          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors"
        >
          清空全部
        </button>
      )}
    </motion.div>
  )
})
ContextIndicator.displayName = 'ContextIndicator'

interface ContextBadgeProps {
  icon: React.ReactNode
  label: string
  detail?: string
  onRemove: () => void
  color: 'amber' | 'blue' | 'green'
}

function ContextBadge({ icon, label, detail, onRemove, color }: ContextBadgeProps) {
  const colorStyles = {
    amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    green: 'bg-green-500/10 text-green-600 border-green-500/20',
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border",
      colorStyles[color]
    )}>
      {icon}
      <span className="truncate max-w-[100px]">{label}</span>
      {detail && (
        <span className="text-[10px] opacity-60">{detail}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="ml-0.5 hover:opacity-70 transition-opacity"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

// ============================================================
// 快捷键提示
// ============================================================

interface ShortcutHintsProps {
  className?: string
}

export const ShortcutHints = React.memo(function ShortcutHints({
  className
}: ShortcutHintsProps) {
  return (
    <div className={cn(
      "flex items-center gap-3 text-[10px] text-muted-foreground/40",
      className
    )}>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[9px]">
          <CornerDownLeft className="size-2.5" />
        </kbd>
        发送
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[9px]">
          Shift
        </kbd>
        +
        <kbd className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[9px]">
          <CornerDownLeft className="size-2.5" />
        </kbd>
        换行
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[9px]">
          @
        </kbd>
        附加文件
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[9px]">
          /
        </kbd>
        命令
      </span>
    </div>
  )
})
ShortcutHints.displayName = 'ShortcutHints'

// ============================================================
// 输入框底部信息栏
// ============================================================

interface InputFooterProps {
  inputText: string
  pendingQuote: PendingQuote | null
  linkedResources: LinkedResource[]
  attachedImages: ImageAttachment[]
  onClearQuote: () => void
  onRemoveResource: (key: string) => void
  onRemoveImage: (id: string) => void
  onClearAll: () => void
  showShortcuts?: boolean
  className?: string
}

export const InputFooter = React.memo(function InputFooter({
  inputText,
  pendingQuote,
  linkedResources,
  attachedImages,
  onClearQuote: _onClearQuote,
  onRemoveResource: _onRemoveResource,
  onRemoveImage: _onRemoveImage,
  onClearAll: _onClearAll,
  showShortcuts = true,
  className,
}: InputFooterProps) {
  const hasContext = pendingQuote || linkedResources.length > 0 || attachedImages.length > 0
  const hasInput = !!inputText

  return (
    <div className={cn(
      "flex items-center justify-between gap-2 px-3 py-1.5",
      "border-t border-border/20",
      className
    )}>
      {/* 左侧：Token 用量 */}
      <div className="flex items-center gap-3">
        <TokenUsage inputText={inputText} />
      </div>

      {/* 右侧：快捷键提示 */}
      {showShortcuts && !hasInput && !hasContext && (
        <ShortcutHints />
      )}
    </div>
  )
})
InputFooter.displayName = 'InputFooter'
