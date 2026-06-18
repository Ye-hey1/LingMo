"use client"

import * as React from "react"
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  Circle,
  Code2,
  Clock3,
  FileText,
  GitCompareArrows,
  Globe2,
  Image,
  ListChecks,
  Route,
  Table2,
  Wrench,
} from "lucide-react"
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

type TimelineTone = "running" | "done" | "error" | "muted"

type TimelineItem = {
  id: string
  tone: TimelineTone
  label: string
  detail?: string
  timestamp: number
}

type ReasoningSummaryItem = {
  id: string
  tone: TimelineTone
  label: string
  detail?: string
}

type ArtifactRendererKind = "file" | "diff" | "table" | "chart" | "image" | "web" | "data"

type ArtifactRef = {
  id: string
  label: string
  path: string
  kind: "artifact" | "data"
  renderer: ArtifactRendererKind
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

function formatToolName(toolName?: string) {
  if (!toolName) return "tool"
  return toolName
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

function compactParamSummary(params?: Record<string, any>) {
  if (!params) return ""
  const preferred = params.filePath || params.path || params.folderPath || params.query || params.url || params.name || params.skillId
  if (typeof preferred === "string" && preferred.trim()) {
    const normalized = preferred.replace(/\\/g, "/")
    return normalized.includes("/") ? normalized.split("/").slice(-2).join("/") : normalized
  }
  const firstString = Object.values(params).find((value): value is string => typeof value === "string" && value.trim().length > 0)
  return firstString ? compactText(firstString, 56) : ""
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
      call.status === "cached" ||
      call.status === "cancelled"
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

function getTimelineItem(event: AgentEvent): TimelineItem | null {
  const payload = event.payload || {}
  if (payload.internal === true || payload.visibility === "hidden") return null

  const toolName = getPayloadToolName(payload)
  if (isSupportOnlyToolName(toolName || "")) return null
  const toolLabel = formatToolName(toolName)
  const paramsSummary = compactParamSummary(payload.params || payload.toolCall?.params)
  const detail = compactText(
    String(payload.reason || payload.message || payload.error || payload.toolCall?.result?.message || payload.toolCall?.result?.error || payload.content || ""),
    86,
  )

  switch (event.type) {
    case "agent.started":
      return { id: getTimelineId(event), tone: "running", label: "启动任务", detail: compactText(String(payload.userInput || ""), 86), timestamp: event.timestamp }
    case "agent.context.compacted":
      return { id: getTimelineId(event), tone: "muted", label: "整理上下文", detail, timestamp: event.timestamp }
    case "agent.planning":
      return { id: getTimelineId(event), tone: "running", label: "规划步骤", detail: compactText(String(payload.plan?.summary || ""), 86), timestamp: event.timestamp }
    case "agent.completed":
      return { id: getTimelineId(event), tone: "done", label: "任务完成", detail, timestamp: event.timestamp }
    case "agent.stopped":
      return { id: getTimelineId(event), tone: "muted", label: "已停止", detail, timestamp: event.timestamp }
    case "iteration.started":
      return { id: getTimelineId(event), tone: "running", label: `第 ${event.iteration || "?"} 轮思考`, timestamp: event.timestamp }
    case "model.request.started":
      return {
        id: getTimelineId(event),
        tone: payload.retry ? "error" : "running",
        label: payload.retry ? "模型请求重试" : "请求模型",
        detail: payload.retry?.reason ? compactText(String(payload.retry.reason), 86) : undefined,
        timestamp: event.timestamp,
      }
    case "model.response.received":
      return { id: getTimelineId(event), tone: "done", label: "模型返回", detail, timestamp: event.timestamp }
    case "action.parsed":
      return { id: getTimelineId(event), tone: "running", label: `准备 ${toolLabel}`, detail: paramsSummary, timestamp: event.timestamp }
    case "tool.execution.started":
      return { id: getTimelineId(event), tone: "running", label: `运行 ${toolLabel}`, detail: paramsSummary, timestamp: event.timestamp }
    case "tool.updated":
    case "tool.execution.finished": {
      const status = String(payload.status || payload.toolCall?.status || "")
      const success = payload.success !== false && status !== "error"
      const adjusted = status === "blocked" || status === "skipped" || status === "adjusted" || status === "cached"
      return {
        id: getTimelineId(event),
        tone: success ? "done" : adjusted ? "muted" : "error",
        label: adjusted
          ? `${status === "blocked" ? "阻止" : status === "skipped" ? "跳过" : status === "cached" ? "缓存" : "调整"} ${toolLabel}`
          : `${success ? "完成" : "失败"} ${toolLabel}`,
        detail,
        timestamp: event.timestamp,
      }
    }
    case "confirmation.waiting":
      return { id: getTimelineId(event), tone: "running", label: "等待确认", detail: toolName ? formatToolName(toolName) : undefined, timestamp: event.timestamp }
    case "confirmation.resolved":
      return { id: getTimelineId(event), tone: "done", label: "确认完成", detail, timestamp: event.timestamp }
    case "step.completed":
      return { id: getTimelineId(event), tone: "done", label: "步骤完成", detail, timestamp: event.timestamp }
    case "final.answer.rejected":
      return { id: getTimelineId(event), tone: "muted", label: "继续执行", detail, timestamp: event.timestamp }
    case "final":
    case "final.answer.rendered":
      return { id: getTimelineId(event), tone: "running", label: "写最终答案", timestamp: event.timestamp }
    case "error":
      return { id: getTimelineId(event), tone: "error", label: "执行异常", detail, timestamp: event.timestamp }
    default:
      return null
  }
}

function getTimelineId(event: AgentEvent) {
  return `${event.sequence || event.timestamp}-${event.type}`
}

function buildTimelineItems(events: AgentEvent[]) {
  const items = events
    .map(getTimelineItem)
    .filter((item): item is TimelineItem => Boolean(item))

  const deduped = items.reduce<TimelineItem[]>((acc, item) => {
    const previous = acc.at(-1)
    if (previous?.label === item.label && previous.detail === item.detail && previous.tone === item.tone) {
      acc[acc.length - 1] = item
      return acc
    }
    acc.push(item)
    return acc
  }, [])

  return deduped.slice(-8)
}

function getPathLabel(path: string) {
  const normalized = path.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).slice(-2).join("/") || normalized
}

function getArtifactRenderer(path: string, kind: ArtifactRef["kind"]): ArtifactRendererKind {
  if (kind === "data") return "data"
  if (/^https?:\/\//i.test(path)) return "web"
  if (/\.(?:diff|patch)$/i.test(path)) return "diff"
  if (/\.(?:csv|tsv|xlsx?|json|jsonl)$/i.test(path)) return "table"
  if (/\.(?:mmd|mermaid|svg|html?)$/i.test(path)) return "chart"
  if (/\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(path)) return "image"
  return "file"
}

function addArtifactRef(map: Map<string, ArtifactRef>, path: unknown, kind: ArtifactRef["kind"]) {
  if (typeof path !== "string" || !path.trim()) return
  const trimmed = path.trim()
  map.set(`${kind}:${trimmed}`, {
    id: `${kind}:${trimmed}`,
    kind,
    path: trimmed,
    label: getPathLabel(trimmed),
    renderer: getArtifactRenderer(trimmed, kind),
  })
}

function extractArtifactRefs(partSnapshot: AgentPartSnapshot | undefined, toolCalls: ToolCall[]) {
  const refs = new Map<string, ArtifactRef>()

  for (const part of partSnapshot?.parts || []) {
    if (part.type === "artifact") {
      addArtifactRef(refs, part.path, "artifact")
    }
  }

  for (const call of toolCalls) {
    const result = call.result
    const data = result?.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, any>
      : {}

    addArtifactRef(refs, data.dataRef || (result as any)?.dataRef, "data")
    for (const artifact of Array.isArray(data.artifacts) ? data.artifacts : []) {
      addArtifactRef(refs, artifact, "artifact")
    }
    for (const outputFile of Array.isArray(data.output_files) ? data.output_files : []) {
      addArtifactRef(refs, outputFile, "artifact")
    }
    addArtifactRef(refs, data.filePath || data.path || data.fullPath, "artifact")
  }

  return Array.from(refs.values()).slice(-4)
}

function getRecoveryHint(message?: string) {
  const text = message || ""
  if (/rate.?limit|429|限流|too many requests/i.test(text)) return "已识别限流，稍后重试或切换模型更稳。"
  if (/insufficient.*balance|余额不足|402|payment required|billing/i.test(text)) return "账户余额或额度不足，请充值、切换模型或更换 API Key。"
  if (/api.?key|unauthorized|401|forbidden|permission/i.test(text)) return "需要检查模型凭据或权限配置。"
  if (/WEB_ACCESS_DISABLED|联网|web access/i.test(text)) return "需要开启联网搜索或改用本地资料路径。"
  if (/messages\.content\.type|image_url|图片|vision/i.test(text)) return "图片输入会自动降级为 Vision Bridge 文本描述。"
  if (/status=5\d\d|upstream error|do_request_failed|上游服务异常|server error|service unavailable|bad gateway/i.test(text)) return "上游模型服务暂时不可用，稍后重试或切换模型更稳。"
  if (/timeout|timed out|network|connect/i.test(text)) return "网络或服务端暂时不可用，可以重试。"
  if (/skipped|blocked|policy/i.test(text)) return "策略已保护当前操作，Agent 会尝试换路径完成。"
  return text ? "已捕获异常，Agent 会优先尝试恢复或给出可执行结果。" : ""
}

function getRecoveryAction(message?: string) {
  const text = message || ""
  if (/rate.?limit|429|限流|too many requests/i.test(text)) return "稍后重试 / 降低上下文"
  if (/insufficient.*balance|余额不足|402|payment required|billing/i.test(text)) return "检查余额 / 切换 Key"
  if (/api.?key|unauthorized|401|forbidden|permission/i.test(text)) return "检查凭据 / 权限"
  if (/messages\.content\.type|image_url|图片|vision/i.test(text)) return "启用视觉模型 / 文本化图片"
  if (/status=5\d\d|upstream error|do_request_failed|上游服务异常|server error|service unavailable|bad gateway/i.test(text)) return "重试 / 切换模型"
  if (/timeout|timed out|network|connect/i.test(text)) return "重试 / 检查网络"
  if (/skipped|blocked|policy/i.test(text)) return "换安全路径"
  return ""
}

function getReasoningStage(item: TimelineItem): ReasoningSummaryItem | null {
  const label = item.label
  const detail = item.detail

  if (label === "启动任务") return { id: item.id, tone: item.tone, label: "理解需求", detail }
  if (label === "整理上下文") return { id: item.id, tone: item.tone, label: "整理上下文", detail }
  if (label === "规划步骤") return { id: item.id, tone: item.tone, label: "规划步骤", detail }
  if (label.startsWith("第 ") || label === "请求模型" || label === "模型返回") {
    return { id: item.id, tone: item.tone, label: "分析路径", detail }
  }
  if (label.startsWith("准备 ")) {
    return { id: item.id, tone: item.tone, label: label.replace(/^准备\s+/, "准备调用 "), detail }
  }
  if (label.startsWith("运行 ")) {
    return { id: item.id, tone: item.tone, label: label.replace(/^运行\s+/, "调用 "), detail }
  }
  if (label.startsWith("完成 ")) {
    return { id: item.id, tone: item.tone, label: label.replace(/^完成\s+/, "读取结果 "), detail }
  }
  if (label.startsWith("失败 ")) {
    return { id: item.id, tone: "error", label: label.replace(/^失败\s+/, "恢复 "), detail }
  }
  if (label === "等待确认") return { id: item.id, tone: item.tone, label: "等待确认", detail }
  if (label === "写最终答案") return { id: item.id, tone: item.tone, label: "整理输出", detail }
  if (label === "任务完成") return { id: item.id, tone: item.tone, label: "完成答复", detail }
  if (label === "执行异常") return { id: item.id, tone: "error", label: "准备恢复", detail }

  return null
}

function buildReasoningSummaryItems(input: {
  timelineItems: TimelineItem[]
  statusLabel: string
  statusTone: TimelineTone
  detail?: string
  hasArtifacts: boolean
  hasTools: boolean
  isRunning: boolean
}) {
  const stages = input.timelineItems
    .map(getReasoningStage)
    .filter((item): item is ReasoningSummaryItem => Boolean(item))

  if (input.hasTools && !stages.some(item => item.label.includes("调用"))) {
    stages.push({
      id: "tools",
      tone: input.isRunning ? "running" : "done",
      label: "调用工具",
    })
  }
  if (input.hasArtifacts && !stages.some(item => item.label.includes("产物") || item.label.includes("输出"))) {
    stages.push({
      id: "artifacts",
      tone: "done",
      label: "生成产物",
    })
  }
  if (stages.length === 0 && input.statusLabel) {
    stages.push({
      id: "status",
      tone: input.statusTone,
      label: input.statusLabel,
      detail: input.detail,
    })
  }

  const deduped = stages.reduce<ReasoningSummaryItem[]>((acc, item) => {
    const previous = acc.at(-1)
    if (previous?.label === item.label && previous.tone === item.tone) {
      acc[acc.length - 1] = { ...item, detail: item.detail || previous.detail }
      return acc
    }
    acc.push(item)
    return acc
  }, [])

  return deduped.slice(-6)
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
  const visibleToolCalls = input.toolCalls.filter(call => !isSupportOnlyToolName(call.toolName))
  const latestTool = getLatestVisibleTool(visibleToolCalls)
  const latestEvent = getLatestVisibleEvent(input.agentEvents)
  const actionToolName = getActionToolName(input.currentAction)
  const visibleActionTool = isSupportOnlyToolName(actionToolName) ? "" : actionToolName
  const observation = compactText(input.currentObservation)

  if (input.activity?.phase === "error") {
    return {
      tone: "error" as const,
      label: "执行失败",
      detail: compactText(latestTool?.result?.error || latestTool?.result?.message) || observation,
    }
  }

  if (input.activity?.phase === "answering") {
    return {
      tone: "done" as const,
      label: "已思考",
      detail: "",
    }
  }

  if (input.activity?.phase === "completed") {
    return {
      tone: "done" as const,
      label: "已思考",
      detail: "",
    }
  }

  if (input.partSnapshot?.visibleStatus) {
    const status = input.partSnapshot.visibleStatus
    if (status.tone === "error") return status
    const isInitialPreparingStatus = status.tone === "running" && status.label === "准备中"
    const isRecoveringToolStatus = status.tone === "running" && status.label === "工具步骤失败，正在恢复"
    if (isInitialPreparingStatus && input.isRunning && (input.isThinking || input.activity?.phase === "thinking")) {
      return {
        tone: "running" as const,
        label: "思考中",
        detail: "",
      }
    }
    if (isRecoveringToolStatus && input.isRunning && input.activity?.phase === "thinking") {
      return {
        tone: "running" as const,
        label: "思考中",
        detail: status.detail || "",
      }
    }
    return input.partSnapshot.visibleStatus
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

function TimelineGlyph({ tone }: { tone: TimelineTone }) {
  if (tone === "error") return <AlertTriangle className="size-3 text-destructive/70" />
  if (tone === "done") return <CheckCircle2 className="size-3 text-emerald-600" />
  if (tone === "running") return <Clock3 className="size-3 text-muted-foreground/65" />
  return <Circle className="size-2.5 text-muted-foreground/35" />
}

function ArtifactIcon({ renderer }: { renderer: ArtifactRendererKind }) {
  if (renderer === "diff") return <GitCompareArrows className="size-3 shrink-0 text-muted-foreground/45" />
  if (renderer === "table" || renderer === "data") return <Table2 className="size-3 shrink-0 text-muted-foreground/45" />
  if (renderer === "chart") return <Code2 className="size-3 shrink-0 text-muted-foreground/45" />
  if (renderer === "image") return <Image className="size-3 shrink-0 text-muted-foreground/45" />
  if (renderer === "web") return <Globe2 className="size-3 shrink-0 text-muted-foreground/45" />
  return <FileText className="size-3 shrink-0 text-muted-foreground/45" />
}

function ArtifactRendererLabel({ renderer }: { renderer: ArtifactRendererKind }) {
  switch (renderer) {
    case "diff":
      return "Diff"
    case "table":
      return "表格"
    case "chart":
      return "图表"
    case "image":
      return "图片"
    case "web":
      return "网页"
    case "data":
      return "数据"
    default:
      return "文件"
  }
}

function StatusChip({
  label,
  value,
  tone = "muted",
}: {
  label: string
  value: string | number
  tone?: "muted" | "running" | "done" | "error"
}) {
  return (
    <span className={cn(
      "inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
      tone === "running" && "border-border/25 bg-muted/10 text-muted-foreground",
      tone === "done" && "border-emerald-500/15 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
      tone === "error" && "border-destructive/20 bg-destructive/5 text-destructive/80",
      tone === "muted" && "border-border/20 bg-background/30 text-muted-foreground/60",
    )}>
      <span className="text-muted-foreground/40">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  )
}

function EventTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50">
        <ListChecks className="size-3" />
        <span>事件流</span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-[14px_1fr] gap-1.5" title={new Date(item.timestamp).toLocaleTimeString()}>
            <div className="mt-0.5 flex justify-center">
              <TimelineGlyph tone={item.tone} />
            </div>
            <div className="min-w-0">
              <div className={cn(
                "truncate font-mono text-[10px]",
                item.tone === "error" ? "text-destructive/75" : "text-muted-foreground/70",
              )}>
                {item.label}
              </div>
              {item.detail && (
                <div className="truncate text-[10px] text-muted-foreground/40">
                  {item.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReasoningSummary({
  items,
  statusLabel,
}: {
  items: ReasoningSummaryItem[]
  statusLabel: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  if (items.length === 0) return null

  const previewItems = items.slice(-4)
  const activeItem = items.at(-1)

  return (
    <div className="rounded-md border border-border/10 bg-background/25">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-[10px] text-muted-foreground/55 transition-colors hover:bg-muted/10"
        onClick={() => setExpanded(value => !value)}
        aria-label={expanded ? "Collapse reasoning summary / 收起推理摘要" : "Expand reasoning summary / 展开推理摘要"}
      >
        <Route className="size-3 shrink-0 text-muted-foreground/45" />
        <span className="shrink-0">推理摘要</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/45">
          {activeItem?.label || statusLabel}
        </span>
        <StatusChip label="阶段" value={items.length} tone={activeItem?.tone === "error" ? "error" : activeItem?.tone === "running" ? "running" : "muted"} />
        <ChevronDown className={cn(
          "size-3 shrink-0 text-muted-foreground/30 transition-transform",
          expanded && "rotate-180",
        )} />
      </button>

      <div className="border-t border-border/10 px-2 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground/50">
          {previewItems.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && <span className="text-muted-foreground/25">-&gt;</span>}
              <span className={cn(
                "inline-flex max-w-[150px] items-center gap-1 truncate rounded bg-muted/10 px-1.5 py-0.5",
                item.tone === "error" && "bg-destructive/5 text-destructive/75",
                item.tone === "done" && "text-emerald-700 dark:text-emerald-400",
              )}>
                <TimelineGlyph tone={item.tone} />
                <span className="truncate">{item.label}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="space-y-1 border-t border-border/10 px-2 py-1.5">
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-[14px_1fr] gap-1.5">
              <div className="mt-0.5 flex justify-center">
                <TimelineGlyph tone={item.tone} />
              </div>
              <div className="min-w-0">
                <div className={cn(
                  "truncate font-mono text-[10px]",
                  item.tone === "error" ? "text-destructive/75" : "text-muted-foreground/70",
                )}>
                  {item.label}
                </div>
                {item.detail && (
                  <div className="truncate text-[10px] text-muted-foreground/40">
                    {item.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ArtifactStrip({ artifacts }: { artifacts: ArtifactRef[] }) {
  if (artifacts.length === 0) return null

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50">
        <Box className="size-3" />
        <span>产物</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {artifacts.map((artifact) => (
          <span
            key={artifact.id}
            className="inline-flex max-w-full items-center gap-1 rounded border border-border/20 bg-background/35 px-1.5 py-0.5 text-[10px] text-muted-foreground/65"
            title={artifact.path}
          >
            <ArtifactIcon renderer={artifact.renderer} />
            <span className="shrink-0 text-muted-foreground/35">
              <ArtifactRendererLabel renderer={artifact.renderer} />
            </span>
            <span className="truncate">{artifact.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function RecoveryNotice({ message }: { message?: string }) {
  if (!message) return null
  const action = getRecoveryAction(message)

  return (
    <div className="rounded-md border border-amber-500/15 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <div className="min-w-0 flex-1">
          <div>{message}</div>
          {action && (
            <div className="mt-0.5 font-mono text-amber-700/70 dark:text-amber-300/70">
              恢复动作：{action}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolSummaryStrip({
  toolCalls,
  isStreaming,
  successfulCount,
  failedCount,
}: {
  toolCalls: ToolCall[]
  isStreaming: boolean
  successfulCount: number
  failedCount: number
}) {
  const [expanded, setExpanded] = React.useState(false)
  if (toolCalls.length === 0) return null

  const runningCount = toolCalls.filter(call => call.status === "running" || call.status === "pending").length
  const latestTool = getLatestVisibleTool(toolCalls)
  const latestLabel = latestTool ? formatToolName(latestTool.toolName) : "工具"
  const tone = failedCount > 0 ? "error" : runningCount > 0 ? "running" : "muted"

  return (
    <div className="rounded-md border border-border/10 bg-background/20">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-[10px] text-muted-foreground/45 transition-colors hover:bg-muted/10"
        onClick={() => setExpanded(value => !value)}
        aria-label={expanded ? "Collapse tool details / 收起工具详情" : "Expand tool details / 展开工具详情"}
      >
        <Wrench className="size-3 shrink-0" />
        <span className="shrink-0">工具</span>
        <span className="min-w-0 flex-1 truncate font-mono">
          {latestLabel}
        </span>
        {runningCount > 0 && <StatusChip label="运行" value={runningCount} tone="running" />}
        {successfulCount > 0 && <StatusChip label="完成" value={successfulCount} tone="muted" />}
        {failedCount > 0 && <StatusChip label="失败" value={failedCount} tone="error" />}
        {failedCount === 0 && runningCount === 0 && successfulCount === 0 && (
          <StatusChip label="记录" value={toolCalls.length} tone={tone} />
        )}
        <ChevronDown className={cn(
          "size-3 shrink-0 text-muted-foreground/30 transition-transform",
          expanded && "rotate-180",
        )} />
      </button>

      {expanded && (
        <div className="border-t border-border/10 px-1.5 py-1">
          <CompactToolCalls
            toolCalls={toolCalls}
            isStreaming={isStreaming}
            grouped={false}
            defaultExpanded={false}
          />
        </div>
      )}
    </div>
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
    const activeOrImportant = visibleToolCalls.filter(call =>
      call.status === "running" ||
      call.status === "pending" ||
      call.status === "error" ||
      call.status === "blocked" ||
      call.status === "skipped" ||
      call.status === "adjusted" ||
      call.status === "cancelled"
    )
    return (activeOrImportant.length > 0 ? activeOrImportant : visibleToolCalls.slice(-2)).slice(-4)
  }, [visibleToolCalls])
  const timelineItems = React.useMemo(
    () => buildTimelineItems(agentEvents),
    [agentEvents],
  )
  const artifactRefs = React.useMemo(
    () => extractArtifactRefs(partSnapshot, visibleToolCalls),
    [partSnapshot, visibleToolCalls],
  )

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

  const fullThought = cleanLiveText(currentThought)
  const spinnerFrame = useClawSpinnerFrame(status.tone === "running" && isRunning)
  const statusLabel = formatClawStatusLabel(status.label)
  const elapsedMs = useLiveElapsedMs({ isRunning, telemetry, currentStepStartTime, activity })
  const elapsedLabel = formatThinkingElapsedSeconds(elapsedMs)
  const latestErrorMessage = status.tone === "error"
    ? status.detail
    : partSnapshot?.recoverableErrors.at(-1) || visibleToolCalls.find(call => call.status === "error")?.result?.error
  const recoveryHint = getRecoveryHint(latestErrorMessage)
  const reasoningSummaryItems = React.useMemo(
    () => buildReasoningSummaryItems({
      timelineItems,
      statusLabel,
      statusTone: status.tone,
      detail: status.detail,
      hasArtifacts: artifactRefs.length > 0,
      hasTools: recentToolCalls.length > 0,
      isRunning,
    }),
    [artifactRefs.length, isRunning, recentToolCalls.length, status.detail, status.tone, statusLabel, timelineItems],
  )
  const activeReasoningItem = reasoningSummaryItems.at(-1)
  const reasoningPreview = activeReasoningItem
    ? [activeReasoningItem.label, activeReasoningItem.detail].filter(Boolean).join(" · ")
    : status.detail
  const hasDetails = Boolean(
    reasoningSummaryItems.length > 0 ||
    status.detail ||
    recentToolCalls.length > 0 ||
    timelineItems.length > 0 ||
    artifactRefs.length > 0 ||
    recoveryHint,
  )
  const successfulToolCount = telemetry?.successfulToolCount || visibleToolCalls.filter(call => call.status === "success").length
  const failedToolCount = telemetry?.failedToolCount || visibleToolCalls.filter(call => call.status === "error").length
  const outputChars = telemetry?.outputChars || partSnapshot?.finalAnswerContent?.length || 0

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
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {visibleToolCalls.length > 0 && (
            <StatusChip label="工具" value={visibleToolCalls.length} tone={failedToolCount > 0 ? "error" : successfulToolCount > 0 ? "done" : "running"} />
          )}
          {outputChars > 0 && (
            <StatusChip label="输出" value={outputChars} />
          )}
        </div>
        {hasDetails && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground/45 transition-colors hover:bg-muted/15"
            onClick={() => setDetailsExpanded(value => !value)}
            aria-label={detailsExpanded ? "Collapse details / 收起 Agent 详情" : "Expand details / 展开 Agent 详情"}
          >
            <ChevronDown className={cn(
              "size-3.5 transition-transform",
              detailsExpanded && "rotate-180",
            )} />
          </button>
        )}
      </div>

      {isRunning && reasoningPreview && (
        <button
          type="button"
          className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded-sm pl-6 pr-1 text-left font-mono text-[11px] leading-relaxed text-muted-foreground/55 hover:bg-muted/15"
          onClick={() => hasDetails && setDetailsExpanded(value => !value)}
        >
          <span className="min-w-0 flex-1 truncate">
            {reasoningPreview}
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
          "mt-2 max-h-72 overflow-auto rounded-md border border-border/15 bg-muted/8 px-2.5 py-2",
          "text-[11px] leading-relaxed text-muted-foreground/60",
        )}>
          <div className="mb-2 flex flex-wrap gap-1">
            <StatusChip label="阶段" value={statusLabel} tone={status.tone === "error" ? "error" : isRunning ? "running" : "done"} />
            {elapsedLabel && <StatusChip label="耗时" value={elapsedLabel} />}
            {visibleToolCalls.length > 0 && <StatusChip label="工具" value={`${successfulToolCount}/${visibleToolCalls.length}`} tone={failedToolCount > 0 ? "error" : "done"} />}
            {outputChars > 0 && <StatusChip label="字符" value={outputChars} />}
          </div>

          <RecoveryNotice message={recoveryHint} />

          <ReasoningSummary
            items={reasoningSummaryItems}
            statusLabel={statusLabel}
          />

          {(status.detail && !recoveryHint) && (
            <div className={cn(
              "whitespace-pre-wrap break-words rounded-md border border-border/10 bg-background/30 px-2 py-1.5 font-mono text-[10px]",
              reasoningSummaryItems.length > 0 && "mt-2",
            )}>
              {status.detail}
            </div>
          )}

          <div className={(reasoningSummaryItems.length > 0 || status.detail || recoveryHint) ? "mt-2 space-y-2" : "space-y-2"}>
            <EventTimeline items={timelineItems} />
            <ArtifactStrip artifacts={artifactRefs} />
            <ToolSummaryStrip
              toolCalls={recentToolCalls}
              isStreaming={isRunning}
              successfulCount={successfulToolCount}
              failedCount={failedToolCount}
            />
          </div>
        </div>
      )}
    </div>
  )
}
