"use client"

import React, { useMemo } from "react"
import {
  Clock3, FileSearch, Loader2, Search, ShieldCheck,
  Sparkles, TriangleAlert, ChevronDown, Play,
  Brain, Eye, CheckCircle2, CircleX,
} from "lucide-react"
import useChatStore from "@/stores/chat"
import {
  buildResearchProgressView,
  parseResearchProgressView,
  type ResearchProgressView,
  type ResearchProgressStep,
} from "@/lib/research/progress-status"
import type { ResearchResumeMeta } from "@/lib/research/session-store"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

type TaskPlanProgressProps = {
  content?: string
  view?: ResearchProgressView | null
  compact?: boolean
  className?: string
}

function getLatestResearchProgress(chats: ReturnType<typeof useChatStore.getState>['chats']) {
  const activeResearchChat = [...chats]
    .reverse()
    .find(chat => chat.role === 'system' && chat.type === 'chat' && parseResearchProgressView(chat.content))

  return activeResearchChat?.content ? parseResearchProgressView(activeResearchChat.content) : null
}

function getDetailText(progress: ResearchProgressView) {
  if (!progress.currentDetail) return '正在推进研究任务'
  return progress.currentDetail.replace(/^当前查询：/, '').replace(/^研究主题：/, '')
}

// 阶段图标映射
function getStepIcon(step: ResearchProgressStep) {
  const iconClass = "size-3 shrink-0"
  if (step.status === 'done') return <CheckCircle2 className={`${iconClass} text-emerald-500`} />
  if (step.status === 'active') return <Loader2 className={`${iconClass} animate-spin text-blue-500`} />
  return <div className={`${iconClass} rounded-full border border-border/30`} />
}

// 统计指标项 — 横向紧凑胶囊
function StatPill({ icon: Icon, label, value, color }: {
  icon: React.ElementType
  label: string
  value: number | string
  color?: string
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full bg-muted/20 px-1.5 py-0.5",
      "text-[10px] text-muted-foreground/60 select-none",
    )}>
      <Icon className={cn("size-2.5", color)} />
      <span className="tabular-nums font-medium text-muted-foreground/80">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function TaskPlanProgress({ content, view, compact = true, className }: TaskPlanProgressProps) {
  const { chats, loading, researchRunning, chatMode } = useChatStore()
  const [stepsExpanded, setStepsExpanded] = React.useState(false)

  const progress = useMemo(() => {
    if (view) {
      return view
    }

    if (content) {
      const parsed = parseResearchProgressView(content)
      if (parsed) return parsed
    }

    const latest = getLatestResearchProgress(chats)
    if (latest) return latest

    if (researchRunning || (loading && chatMode === 'research')) {
      return buildResearchProgressView(null, {
        query: '',
        startedAt: Date.now(),
        estimatedMinutes: '3-6 分钟',
      })
    }

    return null
  }, [chats, chatMode, content, loading, researchRunning, view])

  if (!progress) return null

  const activeStep = progress.steps.find(step => step.status === 'active') || progress.steps[0]
  const isDone = progress.statusText === '研究完成，正在收尾'
  const detail = getDetailText(progress)
  const doneSteps = progress.steps.filter(s => s.status === 'done').length
  const totalSteps = progress.steps.length
  const progressPct = Math.round((doneSteps / totalSteps) * 100)

  return (
    <div className={className}>
      <div className={cn(
        "rounded-lg border transition-all duration-300",
        isDone
          ? "border-emerald-200/40 dark:border-emerald-800/25 bg-emerald-50/15 dark:bg-emerald-950/10"
          : "border-border/20 bg-muted/5",
        compact ? "px-3 py-2.5" : "px-4 py-3",
      )}>
        {/* 顶行：状态 + 标题 + 展开按钮 */}
        <div className="flex min-w-0 items-center gap-2.5">
          {/* 状态图标 — 更精致的容器 */}
          <div className={cn(
            "relative flex shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
            isDone
              ? "bg-emerald-50/60 dark:bg-emerald-950/40"
              : "bg-blue-50/50 dark:bg-blue-950/25",
          )} style={{ width: 32, height: 32 }}>
            {isDone ? (
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
              >
                <Sparkles className="size-4 text-emerald-500" />
              </motion.div>
            ) : (
              <Loader2 className="size-4 animate-spin text-blue-500" />
            )}
            {/* 活跃脉冲环 */}
            {!isDone && (
              <motion.div
                className="absolute inset-0 rounded-lg border border-blue-400/30"
                animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>

          {/* 信息区 */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground/85">
                {activeStep?.title || '准备研究任务'}
              </span>
              <span className={cn(
                "shrink-0 text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums",
                isDone
                  ? "text-emerald-600 bg-emerald-100/60 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "text-blue-600 bg-blue-100/60 dark:bg-blue-900/30 dark:text-blue-400",
              )}>
                {isDone ? "完成" : `${doneSteps}/${totalSteps}`}
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/55">
              <Search className="size-2.5 shrink-0" />
              <span className="truncate">{detail}</span>
            </div>
          </div>

          {/* 右侧统计 — 只显示两个关键指标 */}
          <div className="hidden shrink-0 items-center gap-2.5 text-[10px] text-muted-foreground/45 sm:flex">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock3 className="size-2.5" />
              {progress.estimatedMinutes}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <FileSearch className="size-2.5" />
              {progress.sourceCount || progress.visitedUrlsCount}
            </span>
          </div>

          {/* 步骤展开按钮 */}
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-md p-1 transition-colors",
              "hover:bg-muted/25 active:bg-muted/40",
              stepsExpanded && "bg-muted/15",
            )}
            onClick={() => setStepsExpanded(!stepsExpanded)}
            aria-label={stepsExpanded ? '收起步骤' : '展开步骤'}
          >
            <ChevronDown className={cn(
              "size-3.5 text-muted-foreground/35 transition-transform duration-200",
              stepsExpanded && "rotate-180",
            )} />
          </button>
        </div>

        {/* 进度条 — 加粗 + 渐变 + shimmer */}
        {!isDone && (
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted/30">
            <motion.div
              className={cn(
                "h-full rounded-full",
                "bg-gradient-to-r from-blue-500 via-blue-400 to-cyan-400",
                "relative overflow-hidden",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* shimmer 光效 */}
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer-slide 2s ease-in-out infinite",
                }}
              />
            </motion.div>
          </div>
        )}

        {/* 统计指标行 — 胶囊式排列 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatPill icon={ShieldCheck} label="确认" value={progress.confirmedClaimsCount} color="text-emerald-500" />
          <StatPill icon={TriangleAlert} label="争议" value={progress.disputedClaimsCount} color="text-amber-500" />
          <StatPill icon={CircleX} label="低置信" value={progress.lowConfidenceCount} color="text-red-400" />
          {progress.localSourcesCount > 0 && (
            <StatPill icon={FileSearch} label="本地" value={progress.localSourcesCount} color="text-sky-500" />
          )}
          {progress.learningsCount > 0 && (
            <StatPill icon={Brain} label="发现" value={progress.learningsCount} color="text-violet-500" />
          )}
          {progress.evidenceCount > 0 && (
            <StatPill icon={Eye} label="证据" value={progress.evidenceCount} color="text-blue-500" />
          )}
          {(progress.cacheHits || progress.cacheMisses) ? (
            <StatPill
              icon={Search}
              label="缓存"
              value={`${progress.cacheHits || 0}/${(progress.cacheHits || 0) + (progress.cacheMisses || 0)}`}
              color="text-cyan-500"
            />
          ) : null}
        </div>

        {/* 展开的步骤列表 — 带连线 + stagger */}
        <AnimatePresence initial={false}>
          {stepsExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-border/10 pt-2">
                {progress.steps.map((step, index) => (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: index * 0.04,
                      ease: [0.4, 0, 0.2, 1],
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors duration-150",
                      step.status === 'active' && "bg-blue-50/40 dark:bg-blue-950/20",
                    )}
                  >
                    {/* 步骤图标 */}
                    {getStepIcon(step)}

                    {/* 步骤标题 */}
                    <span className={cn(
                      "text-[11px] leading-tight",
                      step.status === 'done' ? "text-muted-foreground/45 line-through decoration-muted-foreground/15" :
                      step.status === 'active' ? "text-foreground/80 font-medium" :
                      "text-muted-foreground/25",
                    )}>
                      {step.title}
                    </span>

                    {/* 活跃指示点 */}
                    {step.status === 'active' && (
                      <motion.span
                        className="ml-auto size-1.5 rounded-full bg-blue-500"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResearchResumeCard — 持久化的"继续研究"卡片（渲染在聊天消息中）
// ---------------------------------------------------------------------------

type ResearchResumeCardProps = {
  data: ResearchResumeMeta
}

export function ResearchResumeCard({ data }: ResearchResumeCardProps) {
  const started = new Date(data.startedAt)
  const startedText = Number.isNaN(started.getTime())
    ? data.startedAt
    : started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const handleResume = () => {
    document.dispatchEvent(new CustomEvent('resume-research', { detail: data }))
  }

  return (
    <div className="max-w-2xl rounded-lg border border-amber-200/30 dark:border-amber-800/20 bg-amber-50/8 dark:bg-amber-950/8">
      {/* 主信息区 */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex shrink-0 items-center justify-center rounded-lg bg-amber-100/50 dark:bg-amber-900/25" style={{ width: 32, height: 32 }}>
            <FileSearch className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-foreground/85">发现未完成的研究任务</h3>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/55">{data.query}</p>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/35 tabular-nums">{startedText}</span>
        </div>

        {/* 统计指标 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            <FileSearch className="size-2.5 text-blue-500" />
            <span className="tabular-nums font-medium text-muted-foreground/80">{data.sourcesCount}</span> 来源
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            <Eye className="size-2.5 text-violet-500" />
            <span className="tabular-nums font-medium text-muted-foreground/80">{data.evidencesCount}</span> 证据
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            <Search className="size-2.5 text-amber-500" />
            <span className="tabular-nums font-medium text-muted-foreground/80">{data.pendingQueriesCount}</span> 待查
          </span>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between border-t border-amber-200/15 dark:border-amber-800/10 px-4 py-2">
        <span className="text-[10px] text-muted-foreground/35">从上次断点继续执行</span>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
            "text-xs font-medium text-primary",
            "bg-primary/8 hover:bg-primary/15 active:bg-primary/20",
            "transition-colors duration-150",
          )}
          onClick={handleResume}
        >
          <Play className="size-3" />
          继续研究
        </button>
      </div>
    </div>
  )
}
