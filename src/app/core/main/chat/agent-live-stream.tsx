"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { CompactToolCalls } from "./compact-tool-calls"
import { cn } from "@/lib/utils"
import type { AgentActivity, AgentEvent, AgentState, AgentTurnTelemetry, ToolCall, AgentPartSnapshot } from "@/lib/agent"
import { sanitizeVisibleAssistantContent } from "@/lib/agent/parse-action-input"
import { isSupportOnlyObservationText, isSupportOnlyToolName } from "@/lib/agent/support-tools"
import { formatClawStatusLabel, getClawStatusGlyph } from "./claw-stream-format"

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
  partSnapshot?: AgentPartSnapshot
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

function getLatestVisibleTool(toolCalls: ToolCall[]) {
  return [...toolCalls]
    .reverse()
    .find(call => call.status === "running" || call.status === "pending") ||
    [...toolCalls].reverse().find(call =>
      call.status === "error" ||
      call.status === "success" ||
      call.status === "blocked" ||
      call.status === "skipped" ||
      call.status === "adjusted" ||
      call.status === "cached"
    )
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
  partSnapshot?: AgentPartSnapshot
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  agentEvents: AgentEvent[]
}) {
  if (input.partSnapshot?.visibleStatus) {
    const status = input.partSnapshot.visibleStatus
    const isInitialPreparingStatus = status.tone === "running" && status.label === "准备中"
    if (isInitialPreparingStatus && input.isRunning && (input.isThinking || input.activity?.phase === "thinking")) {
      return {
        tone: "running" as const,
        label: "思考中",
        detail: "",
      }
    }
    return input.partSnapshot.visibleStatus
  }
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

  if (latestTool?.status === "blocked" || latestTool?.status === "skipped" || latestTool?.status === "adjusted") {
    return {
      tone: "running" as const,
      label: latestTool.status === "blocked"
        ? "工具被策略阻止"
        : latestTool.status === "skipped"
          ? "已跳过额外工具调用"
          : "工具选择已调整",
      detail: compactText(latestTool?.result?.message || latestTool?.result?.error) || observation,
    }
  }

  if (latestTool?.status === "cached") {
    return {
      tone: "running" as const,
      label: "使用缓存结果",
      detail: compactText(latestTool?.result?.message) || observation,
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

function useClawSpinnerFrame(active: boolean) {
  const [frameIndex, setFrameIndex] = React.useState(0)

  React.useEffect(() => {
    if (!active) {
      setFrameIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setFrameIndex(value => value + 1)
    }, 120)
    return () => window.clearInterval(timer)
  }, [active])

  return frameIndex
}

function formatThinkingElapsedSeconds(elapsedMs?: number) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return ""
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`
}

function useLiveElapsedMs(input: {
  isRunning: boolean
  telemetry?: AgentTurnTelemetry
  currentStepStartTime?: number
  activity?: AgentActivity
}) {
  const getElapsed = React.useCallback(() => {
    const startedAt = input.telemetry?.startedAt || input.currentStepStartTime || input.activity?.startedAt
    if (!startedAt) return input.telemetry?.elapsedMs
    if (!input.isRunning) return input.telemetry?.elapsedMs ?? Math.max(0, Date.now() - startedAt)
    return Math.max(0, Date.now() - startedAt)
  }, [input.activity?.startedAt, input.currentStepStartTime, input.isRunning, input.telemetry?.elapsedMs, input.telemetry?.startedAt])

  const [elapsedMs, setElapsedMs] = React.useState<number | undefined>(() => getElapsed())

  React.useEffect(() => {
    setElapsedMs(getElapsed())
    if (!input.isRunning) return
    const timer = window.setInterval(() => {
      setElapsedMs(getElapsed())
    }, 97)
    return () => window.clearInterval(timer)
  }, [getElapsed, input.isRunning])

  return elapsedMs
}

function StatusGlyph({
  tone,
  frameIndex,
}: {
  tone: "running" | "done" | "error"
  frameIndex: number
}) {
  return (
    <span className={cn(
      "w-4 shrink-0 font-mono text-xs leading-none",
      tone === "error" ? "text-destructive/75" : tone === "done" ? "text-emerald-600" : "text-muted-foreground/70",
    )}>
      {getClawStatusGlyph(tone, frameIndex)}
    </span>
  )
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
  partSnapshot,
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
      call.status === "error" ||
      call.status === "blocked" ||
      call.status === "skipped" ||
      call.status === "adjusted"
    )
    return (activeOrError.length > 0 ? activeOrError : visibleToolCalls.slice(-2)).slice(-4)
  }, [visibleToolCalls])

  const status = getStatus({
    isRunning,
    isThinking,
    activity,
    partSnapshot,
    currentAction,
    currentObservation,
    toolCalls: visibleToolCalls,
    agentEvents,
  })

  const thoughtPreview = compactText(currentThought, 180)
  const fullThought = cleanLiveText(currentThought)
  const spinnerFrame = useClawSpinnerFrame(status.tone === "running" && isRunning)
  const statusLabel = formatClawStatusLabel(status.label)
  const elapsedMs = useLiveElapsedMs({ isRunning, telemetry, currentStepStartTime, activity })
  const elapsedLabel = formatThinkingElapsedSeconds(elapsedMs)
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
        <StatusGlyph tone={status.tone} frameIndex={spinnerFrame} />
        <span className={cn(
          "min-w-0 flex-1 truncate font-mono text-xs",
          status.tone === "error" ? "text-destructive/80" : "text-muted-foreground",
        )}>
          {statusLabel}
          {elapsedLabel && (
            <span className="ml-2 text-muted-foreground/45">
              {elapsedLabel}
            </span>
          )}
        </span>
        {hasDetails && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground/45 transition-colors hover:bg-muted/15"
            onClick={() => setDetailsExpanded(value => !value)}
            aria-label={detailsExpanded ? "Collapse details" : "Expand details"}
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
          className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded-sm pl-6 pr-1 text-left font-mono text-[11px] leading-relaxed text-muted-foreground/55 hover:bg-muted/15"
          onClick={() => hasDetails && setDetailsExpanded(value => !value)}
        >
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
