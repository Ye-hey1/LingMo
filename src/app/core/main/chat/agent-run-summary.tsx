"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import type { AgentEvent, AgentTurnTelemetry, ReActStep, ToolCall } from "@/lib/agent"
import { cn } from "@/lib/utils"
import { CompactToolCalls } from "./compact-tool-calls"

type AgentRunSummaryProps = {
  elapsedMs?: number
  telemetry?: AgentTurnTelemetry
  steps?: ReActStep[]
  toolCalls?: ToolCall[]
  events?: AgentEvent[]
  live?: boolean
}

type RunStep = {
  id: string
  label: string
  detail?: string
  tone: "running" | "done" | "error" | "muted"
}

function formatElapsed(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 1000) return ""
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTokenCount(count?: number) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return ""
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return `${Math.round(count)}`
}

function compactText(value?: string, maxLength = 100) {
  const cleaned = (value || "")
    .replace(/\s+/g, " ")
    .replace(/^Thought[:：]\s*/i, "")
    .replace(/^思考[:：]?\s*/i, "")
    .trim()
  if (!cleaned) return ""
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

function formatToolName(toolName?: string) {
  return (toolName || "tool")
    .split("__")
    .pop()!
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getPayloadToolName(payload: Record<string, any>) {
  return typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool === "string"
      ? payload.tool
      : typeof payload.toolCall?.toolName === "string"
        ? payload.toolCall.toolName
        : undefined
}

function buildEventSteps(events: AgentEvent[]): RunStep[] {
  const steps: RunStep[] = []

  events.forEach((event, index) => {
    const payload = event.payload || {}
    const toolName = getPayloadToolName(payload)
    const toolLabel = toolName ? formatToolName(toolName) : ""
    const detail = compactText(String(payload.message || payload.error || payload.reason || payload.content || ""), 100)

    switch (event.type) {
      case "agent.started":
        steps.push({ id: `${index}-started`, label: "理解需求", detail: compactText(String(payload.userInput || ""), 100), tone: "done" })
        break
      case "agent.context.compacted":
        steps.push({ id: `${index}-context`, label: "整理上下文", detail, tone: "done" })
        break
      case "agent.planning":
        steps.push({ id: `${index}-planning`, label: "规划步骤", detail: compactText(String(payload.plan?.summary || ""), 100), tone: "done" })
        break
      case "model.request.started":
        steps.push({ id: `${index}-model-start`, label: payload.retry ? "重试模型请求" : "请求模型", detail, tone: payload.retry ? "error" : "done" })
        break
      case "model.response.received":
        steps.push({ id: `${index}-model-response`, label: "读取模型响应", detail, tone: "done" })
        break
      case "action.parsed":
        steps.push({ id: `${index}-action`, label: toolLabel ? `准备调用 ${toolLabel}` : "准备调用工具", detail, tone: "done" })
        break
      case "tool.execution.started":
        steps.push({ id: `${index}-tool-start`, label: toolLabel ? `调用 ${toolLabel}` : "调用工具", detail, tone: "running" })
        break
      case "tool.updated":
      case "tool.execution.finished": {
        const status = String(payload.status || payload.toolCall?.status || "")
        const failed = payload.success === false || status === "error"
        steps.push({
          id: `${index}-tool-finished`,
          label: toolLabel ? `${failed ? "恢复" : "读取"} ${toolLabel} 结果` : failed ? "恢复工具结果" : "读取工具结果",
          detail,
          tone: failed ? "error" : "done",
        })
        break
      }
      case "confirmation.waiting":
        steps.push({ id: `${index}-confirmation`, label: "等待确认", detail: toolLabel, tone: "running" })
        break
      case "final.answer.rendered":
      case "final":
        steps.push({ id: `${index}-final`, label: "整理最终回答", detail, tone: "done" })
        break
      case "agent.completed":
        steps.push({ id: `${index}-completed`, label: "完成回答", detail, tone: "done" })
        break
      case "error":
        steps.push({ id: `${index}-error`, label: "处理异常", detail, tone: "error" })
        break
      default:
        break
    }
  })

  return steps
}

function buildStepSummary(input: {
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  live: boolean
}) {
  const eventSteps = buildEventSteps(input.events)
  if (eventSteps.length > 0) {
    return eventSteps.slice(-8)
  }

  const steps: RunStep[] = []
  if (input.steps.length > 0) {
    steps.push({ id: "understand", label: "理解需求", tone: "done" })
  }
  if (input.steps.length > 1) {
    steps.push({ id: "analyze", label: "分析路径", tone: "done" })
  }
  const latestTool = [...input.toolCalls].reverse().find(call => call.toolName)
  if (latestTool) {
    steps.push({
      id: "tool",
      label: latestTool.status === "error" ? "恢复工具结果" : "调用工具",
      detail: formatToolName(latestTool.toolName),
      tone: latestTool.status === "error" ? "error" : input.live && latestTool.status === "running" ? "running" : "done",
    })
  }
  if (input.live) {
    steps.push({ id: "live", label: "正在处理", tone: "running" })
  } else if (steps.length > 0) {
    steps.push({ id: "answer", label: "整理最终回答", tone: "done" })
  }
  return steps.slice(-8)
}

function getTotalTokens(telemetry?: AgentTurnTelemetry) {
  const inputTokens = telemetry?.inputTokens || 0
  const outputTokens = telemetry?.outputTokens || 0
  return inputTokens + outputTokens
}

export function AgentRunSummary({
  elapsedMs,
  telemetry,
  steps = [],
  toolCalls = [],
  events = [],
  live = false,
}: AgentRunSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const effectiveElapsedMs = elapsedMs ?? telemetry?.elapsedMs
  const elapsedLabel = formatElapsed(effectiveElapsedMs)
  const tokenLabel = formatTokenCount(getTotalTokens(telemetry))
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => call.toolName),
    [toolCalls],
  )
  const runSteps = React.useMemo(
    () => buildStepSummary({ steps, toolCalls: visibleToolCalls, events, live }),
    [events, live, steps, visibleToolCalls],
  )

  const hasSummary = Boolean(elapsedLabel || tokenLabel || runSteps.length > 0 || visibleToolCalls.length > 0)
  if (!hasSummary) return null

  const title = live ? "正在处理" : "已思考"
  const meta = [elapsedLabel, tokenLabel ? `${tokenLabel} tokens` : ""].filter(Boolean)

  return (
    <div className="w-full">
      <button
        type="button"
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5",
          "text-xs text-muted-foreground transition-colors hover:border-border/30 hover:bg-muted/20 hover:text-foreground",
          expanded && "border-border/35 bg-muted/20 text-foreground",
        )}
        onClick={() => setExpanded(value => !value)}
        aria-label={expanded ? "收起运行步骤" : "展开运行步骤"}
      >
        <span className="shrink-0">{title}</span>
        {meta.length > 0 && (
          <span className="truncate tabular-nums text-muted-foreground/80">
            {meta.join(" · ")}
          </span>
        )}
        <ChevronDown className={cn(
          "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
          expanded && "rotate-180",
        )} />
      </button>

      {expanded && (
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border/15 bg-muted/10 px-3 py-2">
          {runSteps.length > 0 && (
            <div className="space-y-1.5">
              {runSteps.map((step) => (
                <div key={step.id} className="grid grid-cols-[10px_1fr] gap-2 text-[11px] leading-relaxed">
                  <span className={cn(
                    "mt-2 size-1.5 rounded-full",
                    step.tone === "error" ? "bg-destructive/70" : step.tone === "running" ? "bg-muted-foreground/70" : "bg-emerald-600/70",
                  )} />
                  <div className="min-w-0">
                    <div className={cn(
                      "truncate",
                      step.tone === "error" ? "text-destructive/75" : "text-muted-foreground/75",
                    )}>
                      {step.label}
                    </div>
                    {step.detail && (
                      <div className="truncate text-muted-foreground/45">
                        {step.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {visibleToolCalls.length > 0 && (
            <div className={runSteps.length > 0 ? "mt-2 border-t border-border/10 pt-2" : undefined}>
              <CompactToolCalls
                toolCalls={visibleToolCalls.slice(-8)}
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
