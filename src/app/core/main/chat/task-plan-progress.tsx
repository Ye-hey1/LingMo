"use client"

import React, { useMemo } from "react"
import {
  Clock3, FileSearch, Loader2, Search, ShieldCheck,
  Sparkles, TriangleAlert, ChevronDown, Globe,
  Zap, Brain, Eye, CheckCircle2, CircleX,
} from "lucide-react"
import useChatStore from "@/stores/chat"
import {
  buildResearchProgressView,
  parseResearchProgressView,
  type ResearchProgressView,
  type ResearchProgressStep,
} from "@/lib/research/progress-status"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

type TaskPlanProgressProps = {
  content?: string
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

// 统计指标项
function StatItem({ icon: Icon, label, value, color }: {
  icon: React.ElementType
  label: string
  value: number | string
  color?: string
}) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
      <Icon className={cn("size-2.5", color)} />
      <span>{label}</span>
      <span className="tabular-nums font-medium text-muted-foreground/80">{value}</span>
    </div>
  )
}

export function TaskPlanProgress({ content, compact = true, className }: TaskPlanProgressProps) {
  const { chats, loading, researchRunning, chatMode } = useChatStore()
  const [stepsExpanded, setStepsExpanded] = React.useState(false)

  const progress = useMemo(() => {
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
  }, [chats, chatMode, content, loading, researchRunning])

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
        "rounded-md border transition-colors",
        isDone
          ? "border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/20 dark:bg-emerald-950/10"
          : "border-border/25 bg-muted/8",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}>
        {/* 主行：状态 + 进度 */}
        <div className="flex min-w-0 items-center gap-2.5">
          {/* 状态图标 */}
          <div className={cn(
            "flex shrink-0 items-center justify-center rounded-md border",
            isDone
              ? "border-emerald-300/40 bg-emerald-50/50 dark:border-emerald-700/30 dark:bg-emerald-950/30"
              : "border-border/30 bg-muted/30",
          )} style={{ width: 28, height: 28 }}>
            {isDone ? (
              <Sparkles className="size-3.5 text-emerald-600" />
            ) : (
              <Loader2 className="size-3.5 animate-spin text-blue-500" />
            )}
          </div>

          {/* 信息区 */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium text-foreground/90">
                {activeStep?.title || '准备研究任务'}
              </span>
              <span className={cn(
                "shrink-0 text-[9px] font-medium px-1 rounded",
                isDone
                  ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                  : "text-blue-600 bg-blue-50 dark:bg-blue-950/40",
              )}>
                {isDone ? "完成" : `${doneSteps}/${totalSteps}`}
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/60">
              <Search className="size-2.5 shrink-0" />
              <span className="truncate">{detail}</span>
            </div>
          </div>

          {/* 右侧统计 */}
          <div className="hidden shrink-0 items-center gap-2.5 text-[10px] text-muted-foreground/50 sm:flex">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock3 className="size-2.5" />
              {progress.estimatedMinutes}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <FileSearch className="size-2.5" />
              {progress.sourceCount || progress.visitedUrlsCount} 来源
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Eye className="size-2.5" />
              {progress.evidenceCount} 证据
            </span>
          </div>

          {/* 步骤展开按钮 */}
          <button
            type="button"
            className="shrink-0 p-0.5 rounded hover:bg-muted/30 transition-colors"
            onClick={() => setStepsExpanded(!stepsExpanded)}
          >
            <ChevronDown className={cn(
              "size-3 text-muted-foreground/40 transition-transform",
              stepsExpanded && "rotate-180",
            )} />
          </button>
        </div>

        {/* 进度条 */}
        {!isDone && (
          <div className="mt-1.5 h-0.5 w-full rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500/60 transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* 统计指标行（紧凑） */}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <StatItem icon={ShieldCheck} label="确认" value={progress.confirmedClaimsCount} color="text-emerald-500" />
          <StatItem icon={TriangleAlert} label="争议" value={progress.disputedClaimsCount} color="text-amber-500" />
          <StatItem icon={CircleX} label="低置信" value={progress.lowConfidenceCount} color="text-red-400" />
          {progress.localSourcesCount > 0 && (
            <StatItem icon={FileSearch} label="本地" value={progress.localSourcesCount} color="text-sky-500" />
          )}
          {progress.learningsCount > 0 && (
            <StatItem icon={Brain} label="发现" value={progress.learningsCount} />
          )}
        </div>

        {/* 展开的步骤列表 */}
        <AnimatePresence initial={false}>
          {stepsExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <ol className="mt-2 space-y-0.5 border-t border-border/15 pt-2">
                {progress.steps.map((step, index) => (
                  <li key={step.id} className="flex items-center gap-2 py-0.5">
                    {getStepIcon(step)}
                    <span className={cn(
                      "text-[11px]",
                      step.status === 'done' ? "text-muted-foreground/50 line-through decoration-muted-foreground/20" :
                      step.status === 'active' ? "text-foreground font-medium" :
                      "text-muted-foreground/30",
                    )}>
                      {step.title}
                    </span>
                    {step.status === 'active' && (
                      <span className="text-[9px] text-blue-500 animate-pulse">●</span>
                    )}
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
