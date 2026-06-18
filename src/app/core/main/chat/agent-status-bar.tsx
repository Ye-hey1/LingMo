"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, Loader2, Wrench } from "lucide-react"
import useChatStore from "@/stores/chat"
import { cn } from "@/lib/utils"

function getToolLabel(toolName: string) {
  return toolName.replace(/_/g, " ")
}

export function AgentStatusBar() {
  const { agentState, loading } = useChatStore()
  const isAgentRunning = agentState.isRunning || loading
  const hasHistory = agentState.completedSteps.length > 0 || agentState.toolCalls.length > 0
  const latestToolCall = [...agentState.toolCalls].reverse().find((toolCall) =>
    toolCall.status === "running" || toolCall.status === "pending"
  )

  if (agentState.pendingConfirmation) {
    return (
      <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-amber-600" />
          <span className="truncate text-foreground">
            等待确认：{getToolLabel(agentState.pendingConfirmation.toolName)}
          </span>
        </div>
      </div>
    )
  }

  if (!isAgentRunning && !hasHistory) return null

  const hasError = !isAgentRunning && agentState.activity?.phase === "error"
  const label = hasError
    ? "执行失败"
    : isAgentRunning
      ? latestToolCall?.status === "running"
        ? `正在处理：${getToolLabel(latestToolCall.toolName)}`
        : "正在处理"
      : "已完成"

  return (
    <div
      className={cn(
        "mb-1 flex min-h-6 items-center gap-2 px-1 text-xs text-muted-foreground",
        !isAgentRunning && "opacity-70"
      )}
    >
      {hasError ? (
        <AlertCircle className="size-3.5 shrink-0 text-destructive/80" />
      ) : isAgentRunning ? (
        latestToolCall?.status === "running" ? (
          <Wrench className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground/70" />
        )
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground/60" />
      )}
      <span className="truncate">{label}</span>
    </div>
  )
}
