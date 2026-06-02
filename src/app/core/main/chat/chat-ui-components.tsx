"use client"

import React from 'react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { 
  Brain, 
  Sparkles, 
  Clock, 
  CheckCircle2, 
  ExternalLink,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCcw
} from 'lucide-react'

// ============================================================
// 优化后的消息气泡样式
// ============================================================

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  children: React.ReactNode
  isStreaming?: boolean
  className?: string
}

export function MessageBubble({ role, children, isStreaming, className }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      <div className={cn(
        "relative max-w-[85%] rounded-2xl px-4 py-3",
        "transition-all duration-200",
        isUser 
          ? "bg-primary text-primary-foreground rounded-br-md" 
          : "bg-muted/50 backdrop-blur-sm rounded-bl-md",
        isStreaming && "ring-2 ring-primary/20"
      )}>
        {children}
      </div>
    </motion.div>
  )
}

// ============================================================
// 优化后的思考状态指示器
// ============================================================

interface ThinkingIndicatorProps {
  status: 'thinking' | 'searching' | 'generating'
  elapsed: number
  detail?: string
}

export function ThinkingIndicator({ status, elapsed, detail }: ThinkingIndicatorProps) {
  const statusConfig = {
    thinking: { icon: Brain, label: '思考中', color: 'text-violet-500' },
    searching: { icon: Sparkles, label: '检索中', color: 'text-blue-500' },
    generating: { icon: Sparkles, label: '生成中', color: 'text-emerald-500' },
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3 px-4 py-3 bg-muted/30 rounded-xl"
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 animate-pulse", config.color)} />
        <span className="text-sm font-medium">{config.label}</span>
      </div>
      
      {detail && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {detail}
        </span>
      )}
      
      <div className="flex items-center gap-1 ml-auto text-xs text-muted-foreground">
        <Clock className="size-3" />
        <span className="tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
    </motion.div>
  )
}

// ============================================================
// 优化后的引用来源卡片
// ============================================================

interface CitationCardProps {
  title: string
  source: string
  relevance?: number
  onClick?: () => void
}

export function CitationCard({ title, source, relevance, onClick }: CitationCardProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl",
        "bg-background border border-border/50",
        "hover:border-primary/30 hover:shadow-sm",
        "transition-all duration-200 text-left w-full"
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <ExternalLink className="size-4 text-primary" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{source}</div>
        {relevance && (
          <div className="flex items-center gap-1 mt-1">
            <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full"
                style={{ width: `${relevance}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{relevance}%</span>
          </div>
        )}
      </div>
    </motion.button>
  )
}

// ============================================================
// 优化后的消息操作栏
// ============================================================

interface MessageActionsProps {
  onCopy?: () => void
  onLike?: () => void
  onDislike?: () => void
  onRetry?: () => void
  isStreaming?: boolean
}

export function MessageActions({ onCopy, onLike, onDislike, onRetry, isStreaming }: MessageActionsProps) {
  if (isStreaming) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-1 mt-2"
    >
      {onCopy && (
        <ActionButton icon={Copy} label="复制" onClick={onCopy} />
      )}
      {onLike && (
        <ActionButton icon={ThumbsUp} label="有用" onClick={onLike} />
      )}
      {onDislike && (
        <ActionButton icon={ThumbsDown} label="无用" onClick={onDislike} />
      )}
      {onRetry && (
        <ActionButton icon={RotateCcw} label="重试" onClick={onRetry} />
      )}
    </motion.div>
  )
}

function ActionButton({ icon: Icon, label, onClick }: { icon: any, label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-lg",
        "text-xs text-muted-foreground",
        "hover:bg-muted hover:text-foreground",
        "transition-colors duration-150"
      )}
      title={label}
    >
      <Icon className="size-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ============================================================
// 优化后的加载骨架屏
// ============================================================

export function MessageSkeleton() {
  return (
    <div className="flex items-start gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    </div>
  )
}

// ============================================================
// 优化后的进度指示器
// ============================================================

interface ProgressIndicatorProps {
  steps: Array<{
    label: string
    status: 'pending' | 'active' | 'done'
  }>
}

export function ProgressIndicator({ steps }: ProgressIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          <div className={cn(
            "flex items-center gap-1.5",
            step.status === 'active' && "text-primary",
            step.status === 'done' && "text-muted-foreground",
            step.status === 'pending' && "text-muted-foreground/50"
          )}>
            {step.status === 'done' ? (
              <CheckCircle2 className="size-3.5" />
            ) : step.status === 'active' ? (
              <div className="size-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            ) : (
              <div className="size-3.5 rounded-full border border-muted-foreground/30" />
            )}
            <span className="text-xs">{step.label}</span>
          </div>
          
          {index < steps.length - 1 && (
            <div className={cn(
              "flex-1 h-px",
              step.status === 'done' ? "bg-muted-foreground/30" : "bg-muted-foreground/10"
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
