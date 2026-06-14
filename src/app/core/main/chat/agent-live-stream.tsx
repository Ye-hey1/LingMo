"use client"

import * as React from "react"
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Loader2,
} from "lucide-react"
import { CompactToolCalls } from "./compact-tool-calls"
import { cn } from "@/lib/utils"
import type { AgentActivity, AgentEvent, AgentState, AgentTurnTelemetry, ToolCall } from "@/lib/agent"
import { sanitizeVisibleAssistantContent } from "@/lib/agent/parse-action-input"
import { isSupportOnlyObservationText, isSupportOnlyToolName } from "@/lib/agent/support-tools"

type AgentLiveStreamProps = {
  isRunning: boolean
  isThinking: boolean
  currentThought?: string
  currentAction?: string
  currentObservation?: string
  toolCalls?: ToolCall[]
  agentEvents?: AgentEvent[]
  activity?: AgentActivity
  telemetry?: AgentTurnTelemetry
  currentStepStartTime?: number
  taskPlan?: AgentState["taskPlan"]
}

function getActionToolName(currentAction?: string) {
  if (!currentAction) return ""
  const match = currentAction.match(/^(\w+)\(/)
  return match?.[1] || currentAction
}

function cleanLiveText(value?: string) {
  if (!value) return ""
  const cleaned = sanitizeVisibleAssistantContent(value)
    .replace(/^Thought:\s*/i, "")
    .replace(/^思考[:：]?\s*/i, "")
    .replace(/Final Answer[:：][\s\S]*$/i, "")
    .replace(/最终答案[：:]?[\s\S]*$/i, "")
    .trim()

  if (
    /^【系统提示[:：]/.test(cleaned) ||
    cleaned.includes("由于工具输出内容过长") ||
    cleaned.includes("--- 截断元数据 ---")
  ) {
    return ""
  }

  return cleaned
}

function compactText(value?: string, maxLength = 96) {
  const cleaned = cleanLiveText(value).replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function useLiveElapsed({
  isRunning,
  telemetry,
  currentStepStartTime,
  activity,
}: {
  isRunning: boolean
  telemetry?: AgentTurnTelemetry
  currentStepStartTime?: number
  activity?: AgentActivity
}) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  const startedAt = telemetry?.startedAt || currentStepStartTime || activity?.startedAt
  if (!startedAt) {
    return telemetry?.elapsedMs || 0
  }

  if (isRunning) {
    return Math.max(0, now - startedAt)
  }

  return telemetry?.elapsedMs || Math.max(0, (telemetry?.updatedAt || now) - startedAt)
}

function getLatestVisibleTool(toolCalls: ToolCall[]) {
  return [...toolCalls]
    .reverse()
    .find(call => call.status === "running" || call.status === "pending") ||
    [...toolCalls].reverse().find(call => call.status === "error" || call.status === "success")
}

function getLatestVisibleEvent(events: AgentEvent[]) {
  return [...events].reverse().find(event => {
    const payload = event.payload || {}
    if (payload.internal === true || payload.visibility === "hidden") return false

    const toolName = typeof payload.toolName === "string"
      ? payload.toolName
      : typeof payload.tool === "string"
        ? payload.tool
        : typeof payload.toolCall?.toolName === "string"
          ? payload.toolCall.toolName
          : ""

    if (isSupportOnlyToolName(toolName)) return false
    if (isSupportOnlyObservationText(String(payload.observation || payload.content || ""))) return false

    return [
      "tool.updated",
      "action.parsed",
      "confirmation.waiting",
      "final.answer.rejected",
      "error",
    ].includes(event.type)
  })
}

function getStatus(input: {
  isRunning: boolean
  isThinking: boolean
  activity?: AgentActivity
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  agentEvents: AgentEvent[]
}) {
  const visibleToolCalls = input.toolCalls.filter(call => !isSupportOnlyToolName(call.toolName))
  const latestTool = getLatestVisibleTool(visibleToolCalls)
  const latestEvent = getLatestVisibleEvent(input.agentEvents)
  const actionToolName = getActionToolName(input.currentAction)
  const visibleActionTool = isSupportOnlyToolName(actionToolName) ? "" : actionToolName
  const observation = compactText(input.currentObservation)

  if (input.activity?.phase === "answering") {
    return {
      tone: "done" as const,
      label: "已思考",
      detail: "",
    }
  }

  if (input.activity?.phase === "error") {
    return {
      tone: "error" as const,
      label: "工具调用失败",
      detail: compactText(latestTool?.result?.error || latestTool?.result?.message) || observation,
    }
  }

  if (latestTool?.status === "error") {
    return input.isRunning
      ? {
          tone: "running" as const,
          label: "工具步骤失败，正在恢复",
          detail: compactText(latestTool?.result?.error || latestTool?.result?.message) || observation,
        }
      : {
          tone: "error" as const,
          label: "工具调用失败",
          detail: compactText(latestTool?.result?.error || latestTool?.result?.message) || observation,
        }
  }

  if (latestEvent?.type === "confirmation.waiting") {
    return {
      tone: "running" as const,
      label: "等待确认",
      detail: "",
    }
  }

  if (latestTool?.status === "running" || latestTool?.status === "pending") {
    return {
      tone: "running" as const,
      label: "正在调用工具",
      detail: compactText(latestTool.result?.message) || observation,
    }
  }

  if (visibleActionTool && input.isRunning) {
    return {
      tone: "running" as const,
      label: "准备调用工具",
      detail: observation,
    }
  }

  if (input.isThinking || input.activity?.phase === "thinking") {
    return {
      tone: "running" as const,
      label: "思考中",
      detail: "",
    }
  }

  if (input.isRunning) {
    return {
      tone: "running" as const,
      label: "处理中",
      detail: "",
    }
  }

  return {
    tone: "done" as const,
    label: "已思考",
    detail: "",
  }
}

function StatusIcon({ tone }: { tone: "running" | "done" | "error" }) {
  if (tone === "error") {
    return <CircleAlert className="size-3.5 shrink-0 text-destructive/70" />
  }

  if (tone === "running") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground/55" />
  }

  return <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground/55" />
}

export function AgentLiveStream({
  isRunning,
  isThinking,
  currentThought,
  currentAction,
  currentObservation,
  toolCalls = [],
  agentEvents = [],
  activity,
  telemetry,
  currentStepStartTime,
}: AgentLiveStreamProps) {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false)
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => !isSupportOnlyToolName(call.toolName)),
    [toolCalls],
  )
  const recentToolCalls = React.useMemo(() => {
    const activeOrError = visibleToolCalls.filter(call =>
      call.status === "running" ||
      call.status === "pending" ||
      call.status === "error"
    )
    return (activeOrError.length > 0 ? activeOrError : visibleToolCalls.slice(-2)).slice(-4)
  }, [visibleToolCalls])

  const status = getStatus({
    isRunning,
    isThinking,
    activity,
    currentAction,
    currentObservation,
    toolCalls: visibleToolCalls,
    agentEvents,
  })

  const thoughtPreview = compactText(currentThought, 180)
  const fullThought = cleanLiveText(currentThought)
  const elapsedMs = useLiveElapsed({ isRunning, telemetry, currentStepStartTime, activity })
  const hasDetails = Boolean(fullThought || status.detail || recentToolCalls.length > 0)

  if (!isRunning && visibleToolCalls.length === 0 && !fullThought && status.tone !== "error") {
    return null
  }

  return (
    <div className={cn(
      "w-full rounded-md px-3 py-2 transition-colors",
      isRunning
        ? "border border-border/20 bg-background/45"
        : "border border-transparent bg-transparent px-0 py-0",
    )}>
      <div className="flex min-w-0 items-center gap-2">
        <StatusIcon tone={status.tone} />
        <span className={cn(
          "min-w-0 flex-1 truncate text-xs",
          status.tone === "error" ? "text-destructive/80" : "text-muted-foreground",
        )}>
          {status.label}
        </span>
        {elapsedMs > 0 && (
          <span className={cn(
            "shrink-0 text-[11px] tabular-nums text-muted-foreground/55",
            status.tone === "running" && "rounded-sm bg-muted/25 px-1.5 py-0.5 text-[10px]",
          )}>
            {formatElapsed(elapsedMs)}
          </span>
        )}
        {hasDetails && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground/45 transition-colors hover:bg-muted/15"
            onClick={() => setDetailsExpanded(value => !value)}
            aria-label={detailsExpanded ? "收起思考详情" : "展开思考详情"}
          >
            <ChevronDown className={cn(
              "size-3.5 transition-transform",
              detailsExpanded && "rotate-180",
            )} />
          </button>
        )}
      </div>

      {isRunning && (thoughtPreview || status.detail) && (
        <button
          type="button"
          className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded-sm pl-5 pr-1 text-left text-[11px] leading-relaxed text-muted-foreground/55 hover:bg-muted/15"
          onClick={() => hasDetails && setDetailsExpanded(value => !value)}
        >
          {thoughtPreview ? <Brain className="size-3 shrink-0 text-muted-foreground/45" /> : null}
          <span className="min-w-0 flex-1 truncate">
            {thoughtPreview || status.detail}
          </span>
          {hasDetails && (
            <ChevronDown className={cn(
              "size-3 shrink-0 text-muted-foreground/35 transition-transform",
              detailsExpanded && "rotate-180",
            )} />
          )}
        </button>
      )}

      {detailsExpanded && hasDetails && (
        <div className={cn(
          "mt-2 max-h-48 overflow-auto rounded-md border border-border/15 bg-muted/8 px-2.5 py-1.5",
          "text-[11px] leading-relaxed text-muted-foreground/60",
        )}>
          {(fullThought || status.detail) && (
            <div className="whitespace-pre-wrap break-words">
              {fullThought || status.detail}
            </div>
          )}
          {recentToolCalls.length > 0 && (
            <div className={(fullThought || status.detail) ? "mt-2" : undefined}>
              <CompactToolCalls
                toolCalls={recentToolCalls}
                isStreaming={isRunning}
                grouped={false}
                defaultExpanded={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
