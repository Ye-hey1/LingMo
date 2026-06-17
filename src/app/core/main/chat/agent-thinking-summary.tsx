"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import type { ToolCall } from "@/lib/agent"
import { cn } from "@/lib/utils"
import { CompactToolCalls } from "./compact-tool-calls"
import { getClawStatusGlyph } from "./claw-stream-format"

type AgentThinkingSummaryProps = {
  elapsedMs?: number
  thought?: string
  toolCalls?: ToolCall[]
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
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`
}

export function AgentThinkingSummary({
  elapsedMs,
  thought,
  toolCalls = [],
}: AgentThinkingSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const preview = compactText(thought)
  const elapsedLabel = formatThinkingElapsedSeconds(elapsedMs)
  const hasDetails = Boolean(preview || toolCalls.length > 0)

  if (!hasDetails) return null

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
        <span className="shrink-0 font-mono">Done</span>
        {elapsedLabel && (
          <span className="shrink-0 font-mono text-muted-foreground/45">
            {elapsedLabel}
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
          {preview && (
            <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground/60">
              {preview}
            </div>
          )}
          {toolCalls.length > 0 && (
            <div className={preview ? "mt-2" : undefined}>
              <CompactToolCalls
                toolCalls={toolCalls.slice(-8)}
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
