"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, Circle, Clock3, Route } from "lucide-react"
import type { AgentEvent, ReActStep, ToolCall } from "@/lib/agent"
import { cn } from "@/lib/utils"
import { CompactToolCalls } from "./compact-tool-calls"
import { getClawStatusGlyph } from "./claw-stream-format"

const MIN_VISIBLE_THINKING_ELAPSED_MS = 1000
const QUIET_STAGE_IDS = new Set(["understand", "answer"])

type AgentThinkingSummaryProps = {
  elapsedMs?: number
  thought?: string
  steps?: ReActStep[]
  toolCalls?: ToolCall[]
  events?: AgentEvent[]
}

type SummaryTone = "running" | "done" | "error" | "muted"

type SummaryStage = {
  id: string
  label: string
  detail?: string
  tone: SummaryTone
}

function compactText(value?: string, maxLength = 180) {
  const cleaned = (value || "")
    .replace(/\s+/g, " ")
    .replace(/^Thought[:：]\s*/i, "")
    .replace(/^思考[:：]?\s*/i, "")
    .trim()
  if (!cleaned) return ""
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

function formatThinkingElapsedSeconds(elapsedMs?: number) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return ""
  if (elapsedMs < MIN_VISIBLE_THINKING_ELAPSED_MS) return ""
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`
}

function formatToolName(toolName?: string) {
  return (toolName || "tool")
    .split("__")
    .pop()!
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getStageGlyph(tone: SummaryTone) {
  if (tone === "error") return <Circle className="size-2.5 fill-destructive/60 text-destructive/60" />
  if (tone === "done") return <CheckCircle2 className="size-3 text-emerald-600" />
  if (tone === "running") return <Clock3 className="size-3 text-muted-foreground/60" />
  return <Circle className="size-2.5 text-muted-foreground/35" />
}

function isArtifactToolCall(call: ToolCall) {
  const data = call.result?.data
  return data && typeof data === "object" && !Array.isArray(data) && (
    data.dataRef || data.filePath || data.path || (Array.isArray(data.artifacts) && data.artifacts.length > 0)
  )
}

function buildHistorySummaryStages(input: {
  thought?: string
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
}): SummaryStage[] {
  const stages: SummaryStage[] = []
  if (input.events.some(event => event.type === "agent.started") || input.steps.length > 0 || input.thought) {
    stages.push({ id: "understand", label: "理解需求", tone: "done" })
  }
  if (input.events.some(event => event.type === "agent.planning")) {
    stages.push({ id: "plan", label: "规划步骤", tone: "done" })
  } else if (input.steps.length > 1) {
    stages.push({ id: "analyze", label: "分析路径", tone: "done" })
  }

  const visibleTools = input.toolCalls.filter(call => call.toolName)
  const failedTool = [...visibleTools].reverse().find(call => call.status === "error")
  const latestTool = [...visibleTools].reverse().find(Boolean)
  if (latestTool) {
    stages.push({
      id: "tool",
      label: failedTool ? "恢复工具结果" : "调用工具",
      detail: formatToolName((failedTool || latestTool).toolName),
      tone: failedTool ? "error" : "done",
    })
  }

  const artifactTool = [...visibleTools].reverse().find(call => {
    return isArtifactToolCall(call)
  })
  if (artifactTool) {
    stages.push({ id: "artifact", label: "生成产物", tone: "done" })
  }

  if (input.events.some(event => event.type === "final.answer.rendered" || event.type === "agent.completed") || input.steps.length > 0) {
    stages.push({ id: "answer", label: "整理输出", tone: "done" })
  }

  if (stages.length === 0 && input.thought) {
    stages.push({ id: "summary", label: "整理线索", detail: compactText(input.thought), tone: "done" })
  }

  return stages.slice(-6)
}

function getMeaningfulStages(stages: SummaryStage[]) {
  return stages.filter(stage => !QUIET_STAGE_IDS.has(stage.id))
}

export function AgentThinkingSummary({
  elapsedMs,
  thought,
  steps = [],
  toolCalls = [],
  events = [],
}: AgentThinkingSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const stages = React.useMemo(
    () => buildHistorySummaryStages({ thought, steps, toolCalls, events }),
    [events, steps, thought, toolCalls],
  )
  const elapsedLabel = formatThinkingElapsedSeconds(elapsedMs)
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => call.toolName),
    [toolCalls],
  )
  const meaningfulStages = React.useMemo(() => getMeaningfulStages(stages), [stages])
  const artifactCount = visibleToolCalls.filter(isArtifactToolCall).length
  const errorCount = visibleToolCalls.filter(call => call.status === "error").length
  const hasDetails = Boolean(meaningfulStages.length > 0 || visibleToolCalls.length > 0)

  if (!hasDetails) return null
  const summaryChips = [
    meaningfulStages.length > 0 ? { label: "阶段", value: meaningfulStages.length } : null,
    visibleToolCalls.length > 0 ? { label: "工具", value: visibleToolCalls.length } : null,
    artifactCount > 0 ? { label: "产物", value: artifactCount } : null,
    errorCount > 0 ? { label: "异常", value: errorCount } : null,
  ].filter(Boolean) as Array<{ label: string; value: number }>

  return (
    <div className="w-full">
      <button
        type="button"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md px-0 py-0.5 text-left",
          "text-xs text-muted-foreground/65 transition-colors hover:text-muted-foreground",
        )}
        onClick={() => hasDetails && setExpanded(value => !value)}
      >
        <span className="w-4 shrink-0 font-mono text-xs text-emerald-600">
          {getClawStatusGlyph("done", 0)}
        </span>
        <span className="shrink-0 font-medium">过程详情</span>
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {summaryChips.map(chip => (
            <span
              key={chip.label}
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/50",
                chip.label === "异常" && "bg-destructive/5 text-destructive/70",
              )}
            >
              <span>{chip.label}</span>
              <span className="font-mono">{chip.value}</span>
            </span>
          ))}
          {elapsedLabel && (
            <span className="truncate font-mono text-[10px] text-muted-foreground/40">
              {elapsedLabel}
            </span>
          )}
        </span>
        {hasDetails && (
          <span className="sr-only">
            展开过程详情
          </span>
        )}
        {hasDetails && (
          <ChevronDown className={cn(
            "size-3.5 shrink-0 text-muted-foreground/45 transition-transform",
            expanded && "rotate-180",
          )} />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="mt-2 max-h-52 overflow-auto rounded-md border border-border/15 bg-muted/8 px-2.5 py-2">
          {stages.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50">
                <Route className="size-3" />
                <span>推理摘要</span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground/55">
                {stages.map((stage, index) => (
                  <React.Fragment key={stage.id}>
                    {index > 0 && <span className="text-muted-foreground/25">-&gt;</span>}
                    <span className={cn(
                      "inline-flex max-w-[150px] items-center gap-1 truncate rounded bg-background/30 px-1.5 py-0.5",
                      stage.tone === "error" && "bg-destructive/5 text-destructive/75",
                      stage.tone === "done" && "text-emerald-700 dark:text-emerald-400",
                    )}>
                      {getStageGlyph(stage.tone)}
                      <span className="truncate">{stage.label}</span>
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          {toolCalls.length > 0 && (
            <div className={stages.length > 0 ? "mt-2" : undefined}>
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
