"use client"

import React, { useMemo } from "react"
import { Clock3, Loader2, Search, Sparkles } from "lucide-react"
import useChatStore from "@/stores/chat"
import {
  buildResearchProgressView,
  parseResearchProgressView,
  type ResearchProgressView,
} from "@/lib/research/progress-status"

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

export function TaskPlanProgress({ content, compact = true, className }: TaskPlanProgressProps) {
  const { chats, loading, researchRunning, chatMode } = useChatStore()

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

  if (!progress) {
    return null
  }

  const activeStep = progress.steps.find(step => step.status === 'active') || progress.steps[0]
  const isDone = progress.statusText === '研究完成，正在收尾'
  const detail = getDetailText(progress)

  return (
    <div className={className}>
      <div className={compact
        ? "rounded-lg border border-border/70 bg-background/95 px-3 py-2 shadow-sm"
        : "rounded-lg border border-border/70 bg-background px-4 py-3 shadow-sm"}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40">
            {isDone ? (
              <Sparkles className="size-4 text-primary" />
            ) : (
              <Loader2 className="size-4 animate-spin text-primary" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{activeStep?.title || '准备研究任务'}</span>
              <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                研究中
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Search className="size-3 shrink-0" />
              <span className="truncate">{detail}</span>
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" />
              {progress.estimatedMinutes}
            </span>
            <span>发现 {progress.learningsCount}</span>
            <span>来源 {progress.visitedUrlsCount}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
