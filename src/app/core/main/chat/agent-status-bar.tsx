"use client"

import * as React from "react"
import {
  Brain,
  ChevronDown,
  Clock,
  Loader2,
  Wrench,
  CheckCircle2,
  XCircle,
  Zap,
  Activity,
  BarChart3,
  ArrowRight,
} from "lucide-react"
import useChatStore from "@/stores/chat"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

// ============================================================
// Constants
// ============================================================

const MAX_ITERATIONS = 15

// ============================================================
// Helper Functions
// ============================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

// ============================================================
// Sub-components
// ============================================================

interface ProgressBarProps {
  current: number
  max: number
  className?: string
}

function ProgressBar({ current, max, className }: ProgressBarProps) {
  const percentage = Math.min((current / max) * 100, 100)
  const isNearLimit = percentage > 80

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden backdrop-blur-sm">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isNearLimit
              ? "bg-gradient-to-r from-amber-500 to-orange-500"
              : "bg-gradient-to-r from-blue-500 to-violet-500"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums font-medium">
        {current}/{max}
      </span>
    </div>
  )
}

interface StatusBadgeProps {
  status: 'running' | 'success' | 'error' | 'pending'
  label: string
  icon?: React.ReactNode
  count?: number
}

function StatusBadge({ status, label, icon, count }: StatusBadgeProps) {
  const statusStyles = {
    running: "from-blue-500/20 to-cyan-500/20 border-blue-500/30 text-blue-400",
    success: "from-emerald-500/20 to-green-500/20 border-emerald-500/30 text-emerald-400",
    error: "from-red-500/20 to-rose-500/20 border-red-500/30 text-red-400",
    pending: "from-muted/50 to-muted/30 border-border text-muted-foreground",
  }

  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
        "bg-gradient-to-r backdrop-blur-sm",
        statusStyles[status]
      )}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">
          {count}
        </span>
      )}
    </motion.span>
  )
}

// ============================================================
// Tool Call Step Component
// ============================================================

interface ToolCallStepProps {
  toolCall: {
    id: string
    toolName: string
    status: string
    result?: { message?: string }
  }
  index: number
  isLast: boolean
}

function ToolCallStep({ toolCall, index, isLast }: ToolCallStepProps) {
  const statusConfig = {
    success: {
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      glow: "shadow-emerald-500/20",
      line: "bg-emerald-500/30",
    },
    error: {
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
      glow: "shadow-red-500/20",
      line: "bg-red-500/30",
    },
    running: {
      icon: Loader2,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      glow: "shadow-blue-500/20",
      line: "bg-blue-500/30",
    },
    pending: {
      icon: Clock,
      color: "text-muted-foreground",
      bg: "bg-muted/50",
      glow: "shadow-muted/20",
      line: "bg-muted/30",
    },
  }

  const config = statusConfig[toolCall.status as keyof typeof statusConfig] || statusConfig.pending
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="relative flex items-start gap-3"
    >
      {/* 连接线 */}
      {!isLast && (
        <div className={cn(
          "absolute left-[15px] top-8 bottom-0 w-[2px]",
          config.line,
        )} />
      )}

      {/* 图标 */}
      <div className={cn(
        "relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
        config.bg,
        "shadow-sm",
        config.glow,
      )}>
        {toolCall.status === 'running' ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          >
            <Icon className={cn("size-3.5", config.color)} />
          </motion.div>
        ) : (
          <Icon className={cn("size-3.5", config.color)} />
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground/90 truncate">
            {toolCall.toolName}
          </span>
          {toolCall.status === 'running' && (
            <motion.span
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="text-xs text-blue-400"
            >
              执行中...
            </motion.span>
          )}
        </div>
        {toolCall.status === 'success' && toolCall.result?.message && (
          <div className="text-xs text-muted-foreground/60 mt-0.5 truncate">
            {toolCall.result.message.slice(0, 60)}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ============================================================
// Main Component
// ============================================================

export function AgentStatusBar() {
  const { agentState, loading } = useChatStore()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const startTimeRef = React.useRef<number | undefined>(undefined)

  const isAgentRunning = agentState.isRunning || loading
  const hasHistory = agentState.completedSteps.length > 0 || agentState.thoughtHistory.length > 0
  const currentIteration = agentState.currentIteration || 0

  // 计时器
  React.useEffect(() => {
    if (isAgentRunning) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now()
      }
      const interval = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Date.now() - startTimeRef.current)
        }
      }, 100)
      return () => clearInterval(interval)
    } else {
      startTimeRef.current = undefined
      setElapsed(0)
    }
  }, [isAgentRunning])

  if (!isAgentRunning && !hasHistory) return null

  const getStatusText = () => {
    if (agentState.pendingConfirmation) {
      return `等待确认: ${agentState.pendingConfirmation.toolName}`
    }
    if (agentState.currentAction) {
      return `执行: ${agentState.currentAction}`
    }
    if (agentState.isThinking) {
      return "思考中..."
    }
    if (isAgentRunning) {
      return "Agent 执行中..."
    }
    return "已完成"
  }

  const getStatusIcon = () => {
    if (!isAgentRunning) {
      return <CheckCircle2 className="size-4 text-emerald-400" />
    }
    if (agentState.pendingConfirmation) {
      return (
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Zap className="size-4 text-amber-400" />
        </motion.div>
      )
    }
    if (agentState.currentAction) {
      return <Wrench className="size-4 text-blue-400" />
    }
    if (agentState.isThinking) {
      return (
        <motion.div
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Brain className="size-4 text-violet-400" />
        </motion.div>
      )
    }
    return (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="size-4 text-blue-400" />
      </motion.div>
    )
  }

  const toolCallStats = {
    total: agentState.toolCalls.length,
    success: agentState.toolCalls.filter(t => t.status === "success").length,
    error: agentState.toolCalls.filter(t => t.status === "error").length,
    running: agentState.toolCalls.filter(t => t.status === "running").length,
  }

  return (
    <motion.div
      layout
      className={cn(
        "relative w-full overflow-hidden",
        "rounded-2xl border",
        "bg-gradient-to-br from-background/80 to-muted/30",
        "backdrop-blur-xl",
        "border-border/50",
        "shadow-lg shadow-black/5",
      )}
    >
      {/* 头部 */}
      <motion.button
        type="button"
        className={cn(
          "relative z-10 flex w-full items-center justify-between gap-3 px-4 py-3",
          "text-left transition-all duration-300",
          "hover:bg-white/5 dark:hover:bg-white/5",
        )}
        onClick={() => setIsExpanded(!isExpanded)}
        whileTap={{ scale: 0.995 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {getStatusIcon()}
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground/90 truncate">
              {getStatusText()}
            </div>
            {isAgentRunning && (
              <div className="text-xs text-muted-foreground/60 mt-0.5 tabular-nums">
                {formatDuration(elapsed)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 进度条 */}
          {isAgentRunning && currentIteration > 0 && (
            <ProgressBar
              current={currentIteration}
              max={MAX_ITERATIONS}
              className="w-24 hidden sm:flex"
            />
          )}

          {/* 统计 */}
          {toolCallStats.total > 0 && (
            <div className="flex items-center gap-1.5">
              {toolCallStats.success > 0 && (
                <span className="text-xs text-emerald-400/70">
                  {toolCallStats.success} 成功
                </span>
              )}
              {toolCallStats.error > 0 && (
                <span className="text-xs text-red-400/70">
                  {toolCallStats.error} 失败
                </span>
              )}
            </div>
          )}

          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="size-4 text-muted-foreground/50" />
          </motion.div>
        </div>
      </motion.button>

      {/* 展开内容 */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.2, delay: 0.1 },
            }}
            className="overflow-hidden"
          >
            <div className={cn(
              "relative z-10 px-4 pb-4 space-y-4",
              "max-h-[300px] overflow-y-auto",
              "scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent",
            )}>
              {/* 进度概览 */}
              {isAgentRunning && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Activity className="size-3.5" />
                    <span>迭代进度</span>
                  </div>
                  <ProgressBar
                    current={currentIteration}
                    max={MAX_ITERATIONS}
                    className="w-full"
                  />
                </div>
              )}

              {/* 工具调用统计 */}
              {toolCallStats.total > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <BarChart3 className="size-3.5" />
                    <span>工具调用</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {toolCallStats.success > 0 && (
                      <StatusBadge
                        status="success"
                        label="成功"
                        icon={<CheckCircle2 className="size-3" />}
                        count={toolCallStats.success}
                      />
                    )}
                    {toolCallStats.error > 0 && (
                      <StatusBadge
                        status="error"
                        label="失败"
                        icon={<XCircle className="size-3" />}
                        count={toolCallStats.error}
                      />
                    )}
                    {toolCallStats.running > 0 && (
                      <StatusBadge
                        status="running"
                        label="运行中"
                        icon={<Loader2 className="size-3 animate-spin" />}
                        count={toolCallStats.running}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 当前思考 */}
              {agentState.currentThought && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-2"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Brain className="size-3.5 text-violet-400" />
                    <span>当前思考</span>
                  </div>
                  <div className={cn(
                    "p-3 rounded-xl",
                    "bg-gradient-to-br from-violet-500/10 to-purple-500/10",
                    "border border-violet-500/20",
                    "backdrop-blur-sm",
                  )}>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {agentState.currentThought}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* 工具调用列表 */}
              {agentState.toolCalls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Wrench className="size-3.5 text-blue-400" />
                    <span>工具调用</span>
                  </div>
                  <div className="space-y-0">
                    {agentState.toolCalls.slice(-5).reverse().map((tc, index) => (
                      <ToolCallStep
                        key={tc.id}
                        toolCall={tc}
                        index={index}
                        isLast={index === Math.min(agentState.toolCalls.length, 5) - 1}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 已完成步骤 */}
              {agentState.completedSteps.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span>执行步骤</span>
                  </div>
                  <div className="space-y-1.5">
                    {agentState.completedSteps.slice(-5).reverse().map((step, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg",
                          "bg-muted/30 backdrop-blur-sm",
                        )}
                      >
                        <ArrowRight className="size-3 text-muted-foreground/50" />
                        {step.action ? (
                          <span className="text-sm">
                            <span className="font-medium text-foreground/90">{step.action.tool}</span>
                            {step.duration && (
                              <span className="text-xs text-muted-foreground/50 ml-2 tabular-nums">
                                {formatDuration(step.duration)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/70 italic">思考</span>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
