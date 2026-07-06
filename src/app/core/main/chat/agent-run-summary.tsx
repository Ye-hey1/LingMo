"use client"

import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileMinus,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  Loader2,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react"
import type { AgentActivity, AgentEvent, AgentPartSnapshot, AgentTurnTelemetry, ReActStep, ToolCall } from "@/lib/agent"
import { isSupportOnlyToolName } from "@/lib/agent/support-tools"
import { cn } from "@/lib/utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import { getClawStatusGlyph } from "./claw-stream-format"
import {
  getAssistantLiveHeadlineLabel,
  getAssistantStatusLabel,
  isAssistantAnsweringLabel,
  isAssistantThinkingLabel,
  type AssistantStatusPhase,
  type AssistantStatusTone,
} from "@/lib/ai/assistant-status-projection"

type AgentRunSummaryProps = {
  elapsedMs?: number
  telemetry?: AgentTurnTelemetry
  visibleOutput?: string
  steps?: ReActStep[]
  toolCalls?: ToolCall[]
  events?: AgentEvent[]
  activity?: AgentActivity
  currentThought?: string
  currentAction?: string
  currentObservation?: string
  partSnapshot?: AgentPartSnapshot
  live?: boolean
}

type RunStep = {
  id: string
  label: string
  detail?: string
  meta?: string
  tone: "running" | "done" | "error" | "muted"
  summary?: boolean
  kind?: OperationKind
}

type TimelineEntry =
  | {
      id: string
      timestamp?: number
      type: "status"
      label: string
      detail?: string
      tone: "running" | "done" | "error" | "muted"
      phase?: AgentActivity["phase"]
      durationLabel?: string
    }
  | {
      id: string
      timestamp?: number
      type: "thought"
      text: string
      omittedChars?: number
      tone: "running" | "done" | "error" | "muted"
      durationLabel?: string
    }
  | {
      id: string
      timestamp?: number
      type: "tool"
      step: RunStep
      toolCall?: StepToolCall
    }

type TimelineGroup = {
  id: string
  statuses: Array<Extract<TimelineEntry, { type: "status" }>>
  thought?: Extract<TimelineEntry, { type: "thought" }>
  tools: Array<Extract<TimelineEntry, { type: "tool" }>>
}

type StepToolCall = ToolCall & {
  durationLabel?: string
}

type OperationKind =
  | "command"
  | "create"
  | "update"
  | "delete"
  | "read"
  | "list"
  | "search"
  | "web_search"
  | "web_read"
  | "git"
  | "skill"
  | "tool"

function formatElapsed(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 1000) return ""
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatLiveElapsed(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return ""
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokenCount(count?: number) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return ""
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return `${Math.round(count)}`
}

function useClawFrame(active: boolean) {
  const [frameIndex, setFrameIndex] = React.useState(0)

  React.useEffect(() => {
    if (!active) {
      setFrameIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setFrameIndex(index => index + 1)
    }, 90)

    return () => window.clearInterval(timer)
  }, [active])

  return frameIndex
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
  return getBaseToolName(toolName)
    .split("__")
    .pop()!
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getBaseToolName(toolName?: string) {
  return (toolName || "tool").split("__").pop() || "tool"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function getPayloadToolName(payload: Record<string, unknown>) {
  return typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool === "string"
      ? payload.tool
      : typeof payload.toolCall === "object" && payload.toolCall !== null && "toolName" in payload.toolCall
        ? String((payload.toolCall as Record<string, unknown>).toolName)
        : undefined
}

function normalizePath(value?: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\\/g, "/")
    : ""
}

function formatPath(value?: unknown) {
  const path = normalizePath(value)
  if (!path) return ""
  const parts = path.split("/").filter(Boolean)
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path
}

function compactList(values: string[], maxItems = 3) {
  const cleaned = values.filter(Boolean)
  if (cleaned.length === 0) return ""
  const preview = cleaned.slice(0, maxItems).join(", ")
  return cleaned.length > maxItems ? `${preview} 等 ${cleaned.length} 项` : preview
}

function joinPath(folderPath?: unknown, fileName?: unknown) {
  const folder = normalizePath(folderPath).replace(/\/+$/, "")
  const file = normalizePath(fileName).replace(/^\/+/, "")
  if (!file) return folder
  return folder ? `${folder}/${file}` : file
}

function formatDurationMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return ""
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function getStringParam(params: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

function getPathParams(params: Record<string, any>) {
  const primaryFilePath = joinPath(params.folderPath, params.fileName)
  const targetFilePath = joinPath(params.targetFolderPath, params.targetFileName)
  const paths = [
    primaryFilePath,
    targetFilePath,
    params.filePath,
    params.path,
    params.targetPath,
    params.sourcePath,
    params.articlePath,
    primaryFilePath ? "" : params.folderPath,
    targetFilePath ? "" : params.targetFolderPath,
  ].map(formatPath).filter(Boolean)

  for (const key of ["filePaths", "folderPaths", "paths"]) {
    const values = params[key]
    if (Array.isArray(values)) {
      paths.push(...values.map(formatPath).filter(Boolean))
    }
  }

  const files = Array.isArray(params.files) ? params.files : []
  for (const file of files) {
    if (!isRecord(file)) continue
    const filePath = joinPath(file.folderPath, file.fileName)
    const targetFilePath = joinPath(file.targetFolderPath, file.targetFileName)
    paths.push(...[
      filePath,
      targetFilePath,
      file.filePath,
      file.path,
      file.sourcePath,
      file.targetPath,
      filePath ? "" : file.folderPath,
      targetFilePath ? "" : file.targetFolderPath,
    ].map(formatPath).filter(Boolean))
  }

  return Array.from(new Set(paths))
}

function quoteCommandArg(value: unknown) {
  const text = String(value)
  if (!text) return ""
  if (!/[\s"'`]/.test(text)) return text
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function formatCommand(params: Record<string, any>) {
  const command = getStringParam(params, ["command", "cmd", "script", "scriptPath", "executable"])
  const args = Array.isArray(params.args)
    ? params.args.map(quoteCommandArg).filter(Boolean).join(" ")
    : getStringParam(params, ["args", "arguments"])
  const inline = getStringParam(params, ["shellCommand", "powershell", "bash", "input", "scriptContent"])
  return compactText([command, args].filter(Boolean).join(" ") || inline, 180)
}

function formatQuery(params: Record<string, any>) {
  return compactText(getStringParam(params, [
    "query",
    "pattern",
    "searchQuery",
    "symbolName",
    "topic",
    "full_name",
    "repo_full_name",
    "url",
    "urls",
  ]), 180)
}

function getArrayParam(params: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = params[key]
    if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
    if (typeof value === "string" && value.trim()) return [value.trim()]
  }
  return []
}

function getUrlParams(params: Record<string, any>) {
  return getArrayParam(params, ["urls", "url", "sourceUrl", "href"]).map(value => compactText(value, 120)).filter(Boolean)
}

function getResultDetail(call: ToolCall) {
  const result = call.result
  if (!result) return ""
  if (result.error) return compactText(result.error, 180)
  const data = result.data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, any>
    const dataPaths = [
      record.filePath,
      record.path,
      record.fullPath,
      ...(Array.isArray(record.output_files) ? record.output_files : []),
      ...(Array.isArray(record.artifacts) ? record.artifacts : []),
    ].map(formatPath).filter(Boolean)
    if (dataPaths.length > 0) return compactList(dataPaths)
    if (typeof record.preview === "string") return compactText(record.preview, 180)
    if (typeof record.output === "string") return compactText(record.output, 180)
    if (typeof record.stdout === "string" && record.stdout.trim()) return compactText(record.stdout, 180)
    if (typeof record.stderr === "string" && record.stderr.trim()) return compactText(record.stderr, 180)
  }
  if (typeof data === "string") return compactText(data, 180)
  if (result.message) return compactText(result.message, 180)
  return ""
}

function getToolTone(call: ToolCall): RunStep["tone"] {
  if (call.status === "error" || call.status === "blocked") return "error"
  if (call.status === "running" || call.status === "pending") return "running"
  if (call.status === "skipped" || call.status === "adjusted" || call.status === "cached" || call.status === "cancelled") return "muted"
  return "done"
}

function classifyToolCall(call: ToolCall): OperationKind {
  const base = getBaseToolName(call.toolName).toLowerCase()
  if (base === "execute_skill_script" || /(^|_)(command|shell|script|exec|run)(_|$)/.test(base)) return "command"
  if (base.startsWith("git_")) return "git"
  if (base === "select_skill" || base === "load_skill_content" || base.includes("skill")) return "skill"
  if (base === "web_search") return "web_search"
  if (base.startsWith("web_") || base.includes("fetch") || base.includes("extract")) return "web_read"
  if (base === "tool_search") return "tool"
  if (base.includes("delete") || base.includes("remove") || base.includes("clear")) return "delete"
  if (base.includes("create")) return "create"
  if (
    base.includes("update") ||
    base.includes("write") ||
    base.includes("replace") ||
    base.includes("modify") ||
    base.includes("rename") ||
    base.includes("move") ||
    base.includes("copy") ||
    base.includes("insert")
  ) return "update"
  if (base.includes("search") || base.includes("grep") || base.includes("find") || base.includes("query")) return "search"
  if (base.includes("list")) return "list"
  if (base.includes("read") || base.includes("get") || base.includes("outline") || base.includes("status") || base.includes("diff") || base.includes("show")) return "read"
  return "tool"
}

function getGitCommand(call: ToolCall) {
  const base = getBaseToolName(call.toolName).toLowerCase()
  const params = call.params || {}
  const path = formatPath(params.path)
  switch (base) {
    case "git_status":
      return "git status --short --branch --untracked-files=all"
    case "git_diff":
      return compactText([
        "git diff --no-ext-diff --no-color",
        params.cached === true ? "--cached" : "",
        path ? `-- ${path}` : "",
      ].filter(Boolean).join(" "), 180)
    case "git_log":
      return compactText([
        "git log",
        params.limit ? `-n${params.limit}` : "",
        path ? `-- ${path}` : "",
      ].filter(Boolean).join(" "), 180)
    case "git_show":
      return compactText([
        "git show",
        getStringParam(params, ["revision"]) || "HEAD",
        path ? `-- ${path}` : "",
      ].filter(Boolean).join(" "), 180)
    case "git_blame":
      return compactText([
        "git blame",
        path,
        params.startLine ? `L${params.startLine}` : "",
        params.endLine ? `-${params.endLine}` : "",
      ].filter(Boolean).join(" "), 180)
    default:
      return compactText(`git ${formatToolName(call.toolName)}`, 180)
  }
}

function formatSearchDetail(params: Record<string, any>) {
  const query = formatQuery(params)
  const paths = getPathParams(params)
  const scope = compactList(paths)
  if (query && scope) return `"${query}" @ ${scope}`
  return query || scope
}

function getToolActionLabel(call: ToolCall) {
  const base = getBaseToolName(call.toolName).toLowerCase()
  const kind = classifyToolCall(call)

  if (kind === "command") return "运行命令"
  if (base === "tool_search") return "搜索可用工具"
  if (base === "code_search_symbols") return "搜索代码符号"
  if (base === "code_find_definition") return "查找定义"
  if (base === "code_find_references") return "查找引用"
  if (base === "code_file_outline") return "读取文件结构"
  if (base === "code_read_context") return "读取代码上下文"
  if (base === "git_status") return "查看 Git 状态"
  if (base === "git_diff") return "查看 Git diff"
  if (base === "git_log") return "查看 Git 日志"
  if (base === "git_show") return "查看 Git 对象"
  if (base === "git_blame") return "查看 Git blame"
  if (base === "web_search") return "搜索网页"
  if (base === "web_fetch" || base === "web_extract") return "读取网页"
  if (base === "safe_read_file" || base === "read_markdown_file") return "读取文件"
  if (base === "safe_list_files") return "列出文件"
  if (base === "safe_grep") return "搜索文件内容"
  if (base.includes("search") || base.includes("grep") || base.includes("find")) return "搜索内容"
  if (base.includes("fetch") || base.includes("extract")) return "读取网页"
  if (base.includes("list")) return "列出文件"
  if (base.includes("read") || base.includes("get") || base.includes("outline")) return "读取内容"
  if (kind === "create") return "创建文件"
  if (base.includes("rename")) return "重命名文件"
  if (base.includes("move")) return "移动文件"
  if (base.includes("copy")) return "复制文件"
  if (kind === "update") return "修改文件"
  if (kind === "delete") return "删除文件"
  if (base === "select_skill") return "选择技能"
  if (base === "load_skill_content") return "加载技能内容"
  return `调用 ${formatToolName(call.toolName)}`
}

function getInlineToolActionLabel(call: ToolCall) {
  const base = getBaseToolName(call.toolName).toLowerCase()
  const kind = classifyToolCall(call)

  if (kind === "command") return "运行"
  if (base === "tool_search") return "搜索工具"
  if (base === "code_search_symbols") return "搜索符号"
  if (base === "code_find_definition") return "查找定义"
  if (base === "code_find_references") return "查找引用"
  if (base === "code_file_outline") return "读取结构"
  if (base === "code_read_context") return "读取上下文"
  if (base === "git_status") return "查看 Git 状态"
  if (base === "git_diff") return "查看 Git diff"
  if (base === "git_log") return "查看 Git 日志"
  if (base === "git_show") return "查看 Git 对象"
  if (base === "git_blame") return "查看 Git blame"
  if (base === "web_search") return "搜索网页"
  if (base === "web_fetch" || base === "web_extract") return "读取网页"
  if (base === "safe_read_file" || base === "read_markdown_file") return "读取"
  if (base === "safe_list_files") return "列出"
  if (base === "safe_grep") return "搜索"
  if (base.includes("search") || base.includes("grep") || base.includes("find")) return "搜索"
  if (base.includes("fetch") || base.includes("extract")) return "读取网页"
  if (base.includes("list")) return "列出"
  if (base.includes("read") || base.includes("get") || base.includes("outline")) return "读取"
  if (base.includes("rename")) return "重命名"
  if (base.includes("move")) return "移动"
  if (base.includes("copy")) return "复制"
  if (kind === "create") return "创建"
  if (kind === "update") return "编辑"
  if (kind === "delete") return "删除"
  if (base === "select_skill") return "选择技能"
  if (base === "load_skill_content") return "加载技能"
  return formatToolName(call.toolName)
}

function getToolActionDetail(call: ToolCall) {
  const params = call.params || {}
  const base = getBaseToolName(call.toolName).toLowerCase()

  if (base.startsWith("git_")) return getGitCommand(call)

  const command = formatCommand(params)
  if (command) return command

  if (base === "select_skill") {
    const skills = getArrayParam(params, ["skill_ids", "skillIds", "skills", "selected_skills"])
    return compactList(skills, 5)
  }

  if (base === "load_skill_content") {
    return [getStringParam(params, ["skill_id", "skillId"]), getStringParam(params, ["file_type", "fileType"])]
      .filter(Boolean)
      .join(" / ")
  }

  if (base === "web_search") {
    const dateWindow = [
      params.days ? `最近 ${params.days} 天` : "",
      params.startDate || params.endDate ? `${params.startDate || "*"} 至 ${params.endDate || "*"}` : "",
      params.topic ? `topic=${params.topic}` : "",
    ].filter(Boolean).join(" · ")
    return [formatQuery(params), dateWindow].filter(Boolean).join(" · ")
  }

  if (base === "web_fetch" || base === "web_extract") {
    return compactList(getUrlParams(params), 2) || formatQuery(params)
  }

  if (base === "tool_search" || base === "safe_grep" || base.startsWith("code_")) {
    return formatSearchDetail(params)
  }

  const paths = getPathParams(params)
  if (paths.length > 0) {
    const target = getStringParam(params, ["newName", "targetFolderPath", "targetPath"])
    return [compactList(paths), target ? `-> ${formatPath(target) || target}` : ""].filter(Boolean).join(" ")
  }

  const query = formatQuery(params)
  if (query) return query

  const skill = getStringParam(params, ["skill_id", "skillId", "file_type", "category", "id", "name", "title"])
  if (skill) return compactText(skill, 180)

  const resultDetail = getResultDetail(call)
  if (resultDetail) return resultDetail

  const firstString = Object.values(params).find((value): value is string => typeof value === "string" && value.trim().length > 0)
  return compactText(firstString || formatToolName(call.toolName), 180)
}

function estimateOperationCount(call: ToolCall) {
  const base = getBaseToolName(call.toolName).toLowerCase()
  if (base === "web_search" || base === "tool_search" || base.startsWith("git_") || base === "execute_skill_script") return 1
  if (base === "web_extract" || base === "web_fetch") {
    const urls = getUrlParams(call.params || {})
    return urls.length || 1
  }
  const paths = getPathParams(call.params || {})
  if (paths.length > 0) return paths.length
  if (Array.isArray(call.params?.files)) return call.params.files.length
  if (Array.isArray(call.params?.urls)) return call.params.urls.length
  return 1
}

function buildToolSummarySteps(toolCalls: ToolCall[]): RunStep[] {
  const countByKind = new Map<OperationKind, number>()
  for (const call of toolCalls) {
    const kind = classifyToolCall(call)
    countByKind.set(kind, (countByKind.get(kind) || 0) + estimateOperationCount(call))
  }

  const summaries: Array<[OperationKind, string]> = [
    ["command", "已运行 {count} 条命令"],
    ["delete", "已删除 {count} 个文件"],
    ["create", "已创建 {count} 个文件"],
    ["update", "已修改 {count} 个文件"],
    ["read", "已读取 {count} 项内容"],
    ["list", "已列出 {count} 次文件"],
    ["git", "已执行 {count} 次 Git 操作"],
    ["search", "已搜索 {count} 次"],
    ["web_search", "已搜索网页 {count} 次"],
    ["web_read", "已读取网页 {count} 个"],
    ["skill", "已处理 {count} 个技能"],
    ["tool", "已调用 {count} 个工具"],
  ]

  return summaries.flatMap(([kind, label]) => {
    const count = countByKind.get(kind) || 0
    return count > 0
      ? [{
          id: `summary-${kind}`,
          label: label.replace("{count}", String(count)),
          tone: "muted" as const,
          summary: true,
          kind,
        }]
      : []
  })
}

function getToolStatusLabel(call: ToolCall) {
  switch (call.status) {
    case "pending":
      return "等待中"
    case "running":
      return "运行中"
    case "success":
      return "完成"
    case "error":
      return "失败"
    case "blocked":
      return "已阻止"
    case "skipped":
      return "已跳过"
    case "adjusted":
      return "已调整"
    case "cached":
      return "缓存"
    case "cancelled":
      return "已取消"
    default:
      return call.status
  }
}

function buildToolDurationMap(events: AgentEvent[]) {
  const durations = new Map<string, string>()
  for (const event of events) {
    if (event.type !== "tool.execution.finished") continue
    const payload = event.payload || {}
    const id = typeof payload.toolCallId === "string" ? payload.toolCallId : payload.toolCall?.id
    const duration = formatDurationMs(payload.durationMs)
    if (id && duration) durations.set(id, duration)
  }
  return durations
}

function buildToolActionSteps(toolCalls: ToolCall[], events: AgentEvent[] = []): RunStep[] {
  const durations = buildToolDurationMap(events)
  return toolCalls.map((call, index) => {
    const detail = getToolActionDetail(call)
    const duration = durations.get(call.id)
    const baseName = getBaseToolName(call.toolName)
    return {
      id: `tool-${call.id || index}`,
      label: getToolActionLabel(call),
      detail,
      meta: [baseName, getToolStatusLabel(call), duration].filter(Boolean).join(" · "),
      tone: getToolTone(call),
      kind: classifyToolCall(call),
    }
  })
}

function getActivityStep(input: {
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
  currentThought?: string
  live: boolean
}): RunStep | undefined {
  const phase = input.partSnapshot?.activity?.phase || input.partSnapshot?.telemetry?.currentPhase || input.activity?.phase
  const visibleStatus = input.partSnapshot?.visibleStatus
  const detail = input.live
    ? undefined
    : compactText(input.activity?.detail || visibleStatus?.detail, 160)

  if (phase === "answering" || isAssistantAnsweringLabel(visibleStatus?.label)) {
    return {
      id: "live-answering",
      label: getAssistantStatusLabel('answering', 'running'),
      detail: input.live ? undefined : detail || "正文会直接显示在下方，前面的动作已收拢为摘要。",
      tone: input.live ? "running" : "done",
      kind: "tool",
    }
  }

  if (phase === "planning" || phase === "thinking" || isAssistantThinkingLabel(visibleStatus?.label)) return undefined

  if (phase === "waiting-confirmation" || visibleStatus?.label === "等待确认") {
    return {
      id: "live-waiting-confirmation",
      label: "等待操作确认",
      detail,
      tone: "running",
      kind: "tool",
    }
  }

  if (visibleStatus?.label && visibleStatus.label !== "准备中") {
    return {
      id: `status-${visibleStatus.label}`,
      label: visibleStatus.label,
      detail,
      tone: visibleStatus.tone === "error" ? "error" : visibleStatus.tone === "done" ? "done" : "running",
      kind: "tool",
    }
  }

  return undefined
}

function parseCurrentActionToolCall(currentAction?: string, currentObservation?: string): ToolCall | undefined {
  const actionText = currentAction?.trim()
  if (!actionText) return undefined
  const match = actionText.match(/^([^(]+)\(([\s\S]*)\)$/)
  if (!match) return undefined

  const toolName = match[1].trim()
  if (!toolName || isSupportOnlyToolName(toolName)) return undefined

  let params: Record<string, any> = {}
  const rawParams = match[2]?.trim()
  if (rawParams) {
    try {
      const parsed = JSON.parse(rawParams)
      if (isRecord(parsed)) params = parsed
    } catch {
      params = { input: rawParams }
    }
  }

  const observation = currentObservation?.trim()
  return {
    id: `current-action-${toolName}`,
    toolName,
    params,
    status: observation ? "success" : "running",
    result: observation ? { success: true, message: observation } : undefined,
    timestamp: Date.now(),
  }
}

function isInternalLifecycleEvent(event: AgentEvent): boolean {
  return (
    event.type === "mcp.runtime.warmup" ||
    event.type === "agent.stream.started" ||
    event.type === "agent.stream.finished" ||
    event.type === "agent.context.compacted"
  )
}

function buildEventSteps(events: AgentEvent[]): RunStep[] {
  const steps: RunStep[] = []

  events.forEach((event, index) => {
    if (isInternalLifecycleEvent(event)) return

    const payload = event.payload || {}
    const toolName = getPayloadToolName(payload)
    const toolLabel = toolName ? formatToolName(toolName) : ""
    const payloadParams = isRecord(payload.params)
      ? payload.params
      : isRecord(payload.toolCall?.params)
        ? payload.toolCall.params
        : {}
    const eventToolCall = toolName
      ? {
          id: typeof payload.toolCallId === "string" ? payload.toolCallId : `${index}-${toolName}`,
          toolName,
          params: payloadParams,
          result: {
            success: payload.success !== false,
            message: typeof payload.message === "string" ? payload.message : undefined,
            error: typeof payload.error === "string" ? payload.error : undefined,
            data: payload.dataRef ? { dataRef: payload.dataRef } : undefined,
          },
          status: (
            event.type === "tool.execution.started"
              ? "running"
              : payload.success === false || payload.status === "error"
                ? "error"
                : payload.status === "blocked"
                  ? "blocked"
                  : "success"
          ) as ToolCall["status"],
          timestamp: event.timestamp,
        }
      : undefined
    const toolDetail = eventToolCall ? getToolActionDetail(eventToolCall) : ""
    const detail = compactText(
      toolDetail || String(payload.message || payload.error || payload.reason || payload.content || ""),
      180,
    )

    switch (event.type) {
      case "action.parsed":
        if (toolName) {
          steps.push({
            id: `${index}-action`,
            label: eventToolCall ? `准备${getToolActionLabel(eventToolCall)}` : `准备调用 ${toolLabel}`,
            detail,
            tone: "running",
            meta: toolName,
            kind: eventToolCall ? classifyToolCall(eventToolCall) : "tool",
          })
        }
        break
      case "tool.execution.started":
        steps.push({
          id: `${index}-tool-start`,
          label: eventToolCall ? getToolActionLabel(eventToolCall) : toolLabel ? `调用 ${toolLabel}` : "调用工具",
          detail,
          tone: "running",
          meta: toolName,
          kind: eventToolCall ? classifyToolCall(eventToolCall) : "tool",
        })
        break
      case "tool.batch.started":
        steps.push({
          id: `${index}-tool-batch-start`,
          label: "准备工具批次",
          detail: typeof payload.runningCount === "number" ? `本轮 ${payload.runningCount} 个工具进入执行` : detail,
          tone: "running",
          kind: "tool",
        })
        break
      case "tool.batch.finished":
        steps.push({
          id: `${index}-tool-batch-end`,
          label: "工具批次完成",
          detail: typeof payload.finishedCount === "number" ? `已处理 ${payload.finishedCount} 个工具结果` : detail,
          tone: "done",
          kind: "tool",
        })
        break
      case "tool.updated":
      case "tool.execution.finished": {
        const status = String(payload.status || payload.toolCall?.status || "")
        const muted = ["blocked", "skipped", "adjusted", "cached", "cancelled"].includes(status)
        const failed = !muted && (payload.success === false || status === "error")
        steps.push({
          id: `${index}-tool-finished`,
          label: eventToolCall ? getToolActionLabel(eventToolCall) : toolLabel ? `${failed ? "工具失败" : "工具完成"}：${toolLabel}` : failed ? "工具失败" : "工具完成",
          detail,
          meta: [toolName, formatDurationMs(payload.durationMs)].filter(Boolean).join(" · "),
          tone: failed ? "error" : muted ? "muted" : "done",
          kind: eventToolCall ? classifyToolCall(eventToolCall) : "tool",
        })
        break
      }
      case "confirmation.waiting":
        steps.push({ id: `${index}-confirmation`, label: "等待操作确认", detail: toolLabel, tone: "running", kind: "tool" })
        break
      case "error":
        steps.push({ id: `${index}-error`, label: "发生异常", detail, tone: "error", kind: "tool" })
        break
      default:
        break
    }
  })

  return steps
}

function buildToolCallsFromReActSteps(steps: ReActStep[]): ToolCall[] {
  return steps.flatMap((step, index) => {
    if (!step.action?.tool) return []
    return [{
      id: `react-step-${index}`,
      toolName: step.action.tool,
      params: step.action.params || {},
      result: step.observation
        ? { success: true, message: step.observation }
        : undefined,
      status: "success" as const,
      timestamp: Date.now() + index,
    }]
  })
}

function buildStepSummary(input: {
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  activity?: AgentActivity
  currentThought?: string
  currentAction?: string
  currentObservation?: string
  partSnapshot?: AgentPartSnapshot
  live: boolean
}): RunStep[] {
  const reactToolCalls = buildToolCallsFromReActSteps(input.steps)
  const currentToolCall = parseCurrentActionToolCall(input.currentAction, input.currentObservation)
  const effectiveToolCalls = input.toolCalls.length > 0
    ? input.toolCalls
    : reactToolCalls.length > 0
      ? reactToolCalls
      : currentToolCall
        ? [currentToolCall]
        : []
  const toolActionSteps = buildToolActionSteps(effectiveToolCalls, input.events)
  const activityStep = getActivityStep({
    activity: input.activity,
    partSnapshot: input.partSnapshot,
    currentThought: input.currentThought,
    live: input.live,
  })
  if (toolActionSteps.length > 0) {
    const recentConcreteSteps = activityStep
      ? [...toolActionSteps, activityStep].slice(-12)
      : toolActionSteps.slice(-12)
    return [
      ...buildToolSummarySteps(effectiveToolCalls),
      ...recentConcreteSteps,
    ]
  }

  const eventSteps = buildEventSteps(input.events)
  if (eventSteps.length > 0) {
    return activityStep
      ? [...eventSteps.slice(-7), activityStep]
      : eventSteps.slice(-8)
  }

  if (activityStep) return [activityStep]

  return []
}

function getStepIcon(kind?: OperationKind, tone?: RunStep["tone"], summary?: boolean) {
  if (tone === "error") return AlertCircle
  if (tone === "running") return Loader2
  switch (kind) {
    case "command":
      return TerminalSquare
    case "create":
      return FilePlus2
    case "update":
      return FilePenLine
    case "delete":
      return FileMinus
    case "read":
      return FileText
    case "list":
      return FolderOpen
    case "search":
      return Search
    case "web_search":
    case "web_read":
      return Globe2
    case "git":
      return GitBranch
    case "skill":
    case "tool":
      return Wrench
    default:
      return summary ? CheckCircle2 : Clock3
  }
}

function getStepIconClassName(step: RunStep) {
  if (step.tone === "error") return "text-destructive/70"
  if (step.tone === "running") return "text-muted-foreground/70"
  if (step.summary) return "text-muted-foreground/55"
  return "text-emerald-600/75"
}

function getVisibleOutputTokens(input: {
  telemetry?: AgentTurnTelemetry
  visibleOutput?: string
  live: boolean
}) {
  if (input.live) return 0
  const measuredTokens = (input.telemetry?.inputTokens || 0) + (input.telemetry?.outputTokens || 0)
  if (measuredTokens > 0) return measuredTokens
  const visibleOutput = input.visibleOutput?.trim() || ""
  if (visibleOutput) return estimateTokens(visibleOutput)
  if (typeof input.telemetry?.outputTokens === "number" && input.telemetry.outputTokens > 0) {
    return input.telemetry.outputTokens
  }
  return 0
}

function getStepToolCall(step: RunStep, toolCalls: ToolCall[], events: AgentEvent[]): StepToolCall | undefined {
  const stepToolId = step.id.startsWith("tool-") ? step.id.slice("tool-".length) : ""
  const direct = stepToolId ? toolCalls.find(call => call.id === stepToolId) : undefined
  if (direct) {
    const durationLabel = events
      .filter(event => event.type === "tool.execution.finished")
      .map(event => event.payload || {})
      .find(payload => payload.toolCallId === direct.id)
    return {
      ...direct,
      durationLabel: durationLabel ? formatDurationMs(durationLabel.durationMs) : undefined,
    }
  }

  const matchingEvent = [...events].reverse().find(event => {
    const payload = event.payload || {}
    const toolName = getPayloadToolName(payload)
    if (!toolName || isSupportOnlyToolName(toolName)) return false
    return step.meta?.includes(toolName) || step.label.includes(formatToolName(toolName))
  })
  const payload = matchingEvent?.payload || {}
  const toolName = getPayloadToolName(payload)
  if (!matchingEvent || !toolName) return undefined

  const params = isRecord(payload.params)
    ? payload.params
    : isRecord(payload.toolCall?.params)
      ? payload.toolCall.params
      : {}
  return {
    id: typeof payload.toolCallId === "string" ? payload.toolCallId : `${matchingEvent.timestamp}-${toolName}`,
    toolName,
    params,
    result: {
      success: payload.success !== false,
      message: typeof payload.message === "string" ? payload.message : undefined,
      error: typeof payload.error === "string" ? payload.error : undefined,
    },
    status: (
      matchingEvent.type === "tool.execution.started"
        ? "running"
        : payload.success === false || payload.status === "error"
          ? "error"
          : payload.status === "blocked"
            ? "blocked"
            : "success"
    ) as ToolCall["status"],
    timestamp: matchingEvent.timestamp,
    durationLabel: formatDurationMs(payload.durationMs),
  }
}

function createThoughtEntry(input: {
  id: string
  text: string
  tone: ThoughtTimelineEntry["tone"]
  timestamp?: number
  durationLabel?: string
}): ThoughtTimelineEntry {
  return {
    id: input.id,
    timestamp: input.timestamp,
    type: "thought",
    text: input.text,
    tone: input.tone,
    durationLabel: input.durationLabel,
  }
}

function createStatusEntry(input: {
  id: string
  label: string
  detail?: string
  tone: StatusTimelineEntry["tone"]
  phase?: AgentActivity["phase"]
  timestamp?: number
  durationLabel?: string
}): StatusTimelineEntry {
  return {
    id: input.id,
    timestamp: input.timestamp,
    type: "status",
    label: input.label,
    detail: input.detail,
    tone: input.tone,
    phase: input.phase,
    durationLabel: input.durationLabel,
  }
}

function getLatestEventTimestamp(events: AgentEvent[], types: AgentEvent["type"][]) {
  let timestamp: number | undefined
  for (const event of events) {
    if (!types.includes(event.type)) continue
    if (typeof event.timestamp !== "number") continue
    timestamp = typeof timestamp === "number" ? Math.max(timestamp, event.timestamp) : event.timestamp
  }
  return timestamp
}

function getLatestEventPayload(events: AgentEvent[], types: AgentEvent["type"][]) {
  for (const event of [...events].reverse()) {
    if (types.includes(event.type)) return event.payload || {}
  }
  return {}
}

function hasEvent(events: AgentEvent[], types: AgentEvent["type"][]) {
  return events.some(event => types.includes(event.type))
}

function getCurrentPhase(input: {
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
}) {
  return input.partSnapshot?.activity?.phase || input.partSnapshot?.telemetry?.currentPhase || input.activity?.phase
}

function getCompletedPreparingLabel(activity?: AgentActivity) {
  const label = activity?.label || ""
  if (label.includes("读取图片")) return "已读取图片"
  if (label.includes("理解创作需求")) return "已理解创作需求"
  if (label.startsWith("正在")) return label.replace(/^正在/, "已")
  return "已准备任务"
}

function hasVisibleReasoningPart(partSnapshot?: AgentPartSnapshot) {
  return Boolean(partSnapshot?.parts?.some(part => (
    part.type === "reasoning" &&
    part.visibility !== "hidden" &&
    Boolean(part.text?.trim())
  )))
}

function hasVisibleFinalOutput(input: {
  visibleOutput?: string
  partSnapshot?: AgentPartSnapshot
}) {
  return Boolean(input.visibleOutput?.trim() || input.partSnapshot?.finalAnswerContent?.trim())
}

function getStatusTone(input: {
  live: boolean
  phase?: AgentActivity["phase"]
  activePhase?: AgentActivity["phase"]
  hasLater?: boolean
  terminal?: boolean
  error?: boolean
}): StatusTimelineEntry["tone"] {
  if (input.error) return "error"
  if (input.terminal) return "done"
  if (input.live && input.phase && input.activePhase === input.phase) return "running"
  if (input.live && !input.hasLater && !input.phase) return "running"
  return "done"
}

function buildLifecycleStatusEntries(input: {
  events: AgentEvent[]
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
  visibleOutput?: string
  hasOperationalEvidence?: boolean
  live: boolean
}): StatusTimelineEntry[] {
  const entries: StatusTimelineEntry[] = []
  const phase = getCurrentPhase(input)
  const started = hasEvent(input.events, ["agent.started"])
  const planning = hasEvent(input.events, ["agent.planning"])
  const requestedModel = hasEvent(input.events, ["model.request.started", "model.response.received"])
  const thought = hasEvent(input.events, ["thought", "thought.updated"])
  const hasTool = input.hasOperationalEvidence || hasEvent(input.events, ["action", "action.parsed", "tool", "tool.updated", "tool.batch.started", "tool.batch.finished", "tool.execution.started", "tool.execution.finished"])
  const waiting = hasEvent(input.events, ["confirmation.waiting"])
  const outputStarted = hasEvent(input.events, ["agent.stream.delta", "final", "final.answer.rendered"])
  const outputFinished = hasEvent(input.events, ["agent.stream.finished", "final.answer.rendered"])
  const completed = hasEvent(input.events, ["agent.completed"]) || input.partSnapshot?.status === "completed"
  const stopped = hasEvent(input.events, ["agent.stopped"]) || input.partSnapshot?.status === "stopped"
  const failed = hasEvent(input.events, ["error"]) || input.partSnapshot?.status === "error"
  const hasAnyEvent = input.events.length > 0
  const hasSnapshot = Boolean(input.partSnapshot)
  const preparing = phase === "preparing" || input.partSnapshot?.visibleStatus?.label === "准备中" || input.activity?.phase === "preparing"
  const hasReasoningText = hasVisibleReasoningPart(input.partSnapshot)
  const hasFinalOutput = hasVisibleFinalOutput(input)
  const terminal = completed || stopped || failed
  const hasReachedModel = requestedModel || thought || hasReasoningText || hasTool || waiting || outputStarted || outputFinished || hasFinalOutput || terminal
  const hasReachedThinking = thought || hasReasoningText || hasTool || waiting || outputStarted || outputFinished || hasFinalOutput || terminal
  const hasReachedOutput = outputStarted || outputFinished || hasFinalOutput || completed
  const hasLaterThanPreparing = planning || hasReachedModel

  if (started || input.live || hasAnyEvent || hasSnapshot || hasTool || hasFinalOutput) {
    entries.push(createStatusEntry({
      id: "status-received",
      label: "已接收任务",
      tone: input.live && !preparing && !hasLaterThanPreparing ? "running" : "done",
      phase: "preparing",
      timestamp: getLatestEventTimestamp(input.events, ["agent.started"]),
    }))
  }

  if (started || input.live || hasAnyEvent || hasSnapshot || hasTool || hasFinalOutput) {
    const running = input.live && preparing && !hasLaterThanPreparing
    entries.push(createStatusEntry({
      id: "status-preparing",
      label: running ? input.activity?.label || "正在准备" : getCompletedPreparingLabel(input.activity),
      detail: compactText(input.activity?.detail || input.partSnapshot?.visibleStatus?.detail, 120),
      tone: running ? "running" : "done",
      phase: "preparing",
      timestamp: input.activity?.startedAt || getLatestEventTimestamp(input.events, ["agent.started"]),
    }))
  }

  if (planning) {
    const running = input.live && phase === "planning"
    entries.push(createStatusEntry({
      id: "status-planning",
      label: running ? "正在组织步骤" : "已组织步骤",
      detail: compactText(String(getLatestEventPayload(input.events, ["agent.planning"]).summary || ""), 120),
      tone: getStatusTone({ live: input.live, phase: "planning", activePhase: phase, hasLater: requestedModel || thought || hasTool || outputStarted || completed || failed }),
      phase: "planning",
      timestamp: getLatestEventTimestamp(input.events, ["agent.planning"]),
    }))
  }

  if (requestedModel || (input.live && phase === "thinking" && !thought)) {
    const running = input.live && phase === "thinking" && !thought && !hasTool && !outputStarted
    entries.push(createStatusEntry({
      id: "status-model-request",
      label: running ? "正在请求模型" : "已请求模型",
      tone: running ? "running" : "done",
      phase: "thinking",
      timestamp: getLatestEventTimestamp(input.events, ["model.request.started", "model.response.received"]),
    }))
  } else if (hasReachedModel) {
    entries.push(createStatusEntry({
      id: "status-model-request",
      label: "已请求模型",
      tone: "done",
      phase: "thinking",
    }))
  }

  if (!hasReasoningText && !thought && (hasReachedThinking || (input.live && phase === "thinking"))) {
    const running = input.live && phase === "thinking" && !hasTool && !hasReachedOutput
    entries.push(createStatusEntry({
      id: "status-thinking",
      label: getAssistantStatusLabel('thinking', running ? 'running' : 'done'),
      detail: running ? compactText(input.activity?.detail || input.partSnapshot?.visibleStatus?.detail, 120) : undefined,
      tone: running ? "running" : "done",
      phase: "thinking",
      timestamp: getLatestEventTimestamp(input.events, ["thought", "thought.updated", "model.response.received"]),
    }))
  }

  if (waiting || phase === "waiting-confirmation") {
    const payload = getLatestEventPayload(input.events, ["confirmation.waiting"])
    entries.push(createStatusEntry({
      id: "status-waiting-confirmation",
      label: "等待确认",
      detail: compactText(String(payload.reason || input.activity?.detail || input.partSnapshot?.visibleStatus?.detail || ""), 120),
      tone: input.live ? "running" : "done",
      phase: "waiting-confirmation",
      timestamp: getLatestEventTimestamp(input.events, ["confirmation.waiting"]),
    }))
  }

  if (hasReachedOutput || phase === "answering" || isAssistantAnsweringLabel(input.partSnapshot?.visibleStatus?.label)) {
    const running = input.live && phase === "answering"
    entries.push(createStatusEntry({
      id: "status-output",
      label: getAssistantStatusLabel('answering', running ? 'running' : 'done'),
      tone: running ? "running" : "done",
      phase: "answering",
      timestamp: getLatestEventTimestamp(input.events, ["agent.stream.delta", "final", "final.answer.rendered"]),
    }))
  } else if (outputFinished) {
    entries.push(createStatusEntry({
      id: "status-output",
      label: getAssistantStatusLabel('answering', 'done'),
      tone: "done",
      phase: "answering",
      timestamp: getLatestEventTimestamp(input.events, ["agent.stream.finished", "final.answer.rendered"]),
    }))
  }

  if (completed) {
    entries.push(createStatusEntry({
      id: "status-completed",
      label: "完成",
      tone: "done",
      phase: "completed",
      timestamp: getLatestEventTimestamp(input.events, ["agent.completed"]),
    }))
  } else if (stopped) {
    entries.push(createStatusEntry({
      id: "status-stopped",
      label: "已停止",
      tone: "done",
      phase: "completed",
      timestamp: getLatestEventTimestamp(input.events, ["agent.stopped"]),
    }))
  } else if (failed) {
    const payload = getLatestEventPayload(input.events, ["error"])
    entries.push(createStatusEntry({
      id: "status-error",
      label: "执行失败",
      detail: compactText(String(payload.friendlyMessage || payload.error || input.partSnapshot?.visibleStatus?.detail || ""), 160),
      tone: "error",
      phase: "error",
      timestamp: getLatestEventTimestamp(input.events, ["error"]),
    }))
  }

  return entries
}

function getThoughtText(input: {
  currentThought?: string
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
  steps?: ReActStep[]
}) {
  // 优先使用 partSnapshot 中最新的 reasoning part 文本，完成后也保留这段过程。
  const parts = input.partSnapshot?.parts
  let reasoningText: string | undefined
  if (Array.isArray(parts) && parts.length > 0) {
    let latestUpdatedAt = -1
    for (const part of parts) {
      if (part.type !== 'reasoning') continue
      if (part.visibility === 'hidden') continue
      if (!part.text) continue
      if (part.updatedAt > latestUpdatedAt) {
        latestUpdatedAt = part.updatedAt
        reasoningText = part.text
      }
    }
  }
  const stepThought = [...(input.steps || [])].reverse().find(step => step.thought?.trim())?.thought
  return compactText(reasoningText || input.currentThought || stepThought, 360)
}

function hasLiveActivity(input: {
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
}) {
  const phase = getCurrentPhase(input)
  return Boolean(phase && phase !== "idle" && phase !== "completed" && phase !== "error")
}

function getThoughtTimelineTone(input: {
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
  live: boolean
}): ThoughtTimelineEntry["tone"] {
  const phase = getCurrentPhase(input)
  if (phase === "error" || input.partSnapshot?.status === "error" || input.partSnapshot?.visibleStatus?.tone === "error") return "error"
  if (
    input.live &&
    (
      phase === "thinking" ||
      phase === "planning" ||
      isAssistantThinkingLabel(input.partSnapshot?.visibleStatus?.label) ||
      (!phase && hasLiveActivity(input))
    )
  ) {
    return "running"
  }
  return "done"
}

function buildThoughtTimeline(input: {
  runSteps: RunStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  steps: ReActStep[]
  currentThought?: string
  activity?: AgentActivity
  partSnapshot?: AgentPartSnapshot
  visibleOutput?: string
  live: boolean
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...buildLifecycleStatusEntries({
      events: input.events,
      activity: input.activity,
      partSnapshot: input.partSnapshot,
      visibleOutput: input.visibleOutput,
      hasOperationalEvidence: input.toolCalls.length > 0 || input.steps.some(step => Boolean(step.action?.tool)) || input.runSteps.some(step => (
        !step.summary &&
        step.id !== "no-tool-final" &&
        step.id !== "no-tool-live"
      )),
      live: input.live,
    }),
  ]
  const toolSteps = input.runSteps.filter(step => (
    !step.summary &&
    step.id !== "no-tool-final" &&
    step.id !== "no-tool-live" &&
    !step.id.startsWith("live-") &&
    !step.id.startsWith("status-")
  ))
  const stepToolKeys = new Set<string>()

  input.steps.forEach((step, index) => {
    const durationLabel = formatDurationMs(step.duration)

    const call = step.action?.tool && !isSupportOnlyToolName(step.action.tool)
      ? ({
          id: `step-${index}-${step.action.tool}-${JSON.stringify(step.action.params || {})}`,
          toolName: step.action.tool,
          params: step.action.params || {},
          result: step.observation ? { success: true, message: step.observation } : undefined,
          status: "success" as const,
          timestamp: Date.now() + index,
          durationLabel,
        } satisfies StepToolCall)
      : undefined

    if (call) {
      stepToolKeys.add(`${call.toolName}:${JSON.stringify(call.params || {})}`)
      entries.push({
        id: `tool-step-${index}`,
        timestamp: undefined,
        type: "tool",
        step: {
          id: `tool-react-step-${index}`,
          label: getToolActionLabel(call),
          detail: getToolActionDetail(call),
          meta: [getBaseToolName(call.toolName), getToolStatusLabel(call), durationLabel].filter(Boolean).join(" · "),
          tone: getToolTone(call),
          kind: classifyToolCall(call),
        },
        toolCall: call,
      })
    }
  })

  const knownToolIds = new Set(
    entries
      .filter((entry): entry is Extract<TimelineEntry, { type: "tool" }> => entry.type === "tool")
      .map(entry => entry.toolCall?.id)
      .filter(Boolean),
  )

  const thoughtText = getThoughtText({
    currentThought: input.currentThought,
    activity: input.activity,
    partSnapshot: input.partSnapshot,
    steps: input.steps,
  })
  const thoughtTimestamp = getLatestEventTimestamp(input.events, ["thought", "thought.updated"])
    ?? input.partSnapshot?.parts
      ?.filter(part => part.type === "reasoning" && part.visibility !== "hidden")
      .reduce<number | undefined>((latest, part) => (
        typeof latest === "number" ? Math.max(latest, part.updatedAt) : part.updatedAt
      ), undefined)
  const phase = getCurrentPhase(input)
  const shouldShowThinking = Boolean(thoughtText) || (input.live && (phase === "thinking" || phase === "planning"))
  if (shouldShowThinking) {
    entries.push(createThoughtEntry({
      id: "thought-live",
      text: thoughtText,
      tone: getThoughtTimelineTone({
        activity: input.activity,
        partSnapshot: input.partSnapshot,
        live: input.live,
      }),
      timestamp: thoughtTimestamp,
    }))
  }

  for (const step of toolSteps) {
    const toolCall = getStepToolCall(step, input.toolCalls, input.events)
    if (toolCall?.id && knownToolIds.has(toolCall.id)) continue
    if (toolCall) {
      const toolKey = `${toolCall.toolName}:${JSON.stringify(toolCall.params || {})}`
      if (stepToolKeys.has(toolKey)) continue
    }
    entries.push({
      id: `timeline-${step.id}`,
      timestamp: toolCall?.timestamp,
      type: "tool",
      step,
      toolCall,
    })
  }

  if (entries.length === 0) {
    const fallback = input.runSteps.find(step => (
      !step.summary &&
      !step.id.startsWith("live-") &&
      !step.id.startsWith("status-") &&
      step.detail
    ))
    if (fallback) {
      entries.push(createThoughtEntry({
        id: "thought-status",
        text: fallback.label,
        tone: fallback.tone,
      }))
    }
  }

  const sortedEntries = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (typeof left.entry.timestamp === "number" && typeof right.entry.timestamp === "number") {
        return (left.entry.timestamp - right.entry.timestamp) || (left.index - right.index)
      }
      return left.index - right.index
    })
    .map(item => item.entry)

  if (sortedEntries.length <= 24) return sortedEntries

  const pinnedEntries = sortedEntries.filter(entry => entry.type !== "tool")
  const toolBudget = Math.max(6, 24 - pinnedEntries.length)
  const retainedToolIds = new Set(
    sortedEntries
      .filter((entry): entry is Extract<TimelineEntry, { type: "tool" }> => entry.type === "tool")
      .slice(-toolBudget)
      .map(entry => entry.id),
  )

  return sortedEntries.filter(entry => entry.type !== "tool" || retainedToolIds.has(entry.id))
}

function buildTimelineGroups(entries: TimelineEntry[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []

  for (const entry of entries) {
    if (entry.type === "status") {
      groups.push({ id: entry.id, statuses: [entry], tools: [] })
      continue
    }

    if (entry.type === "thought") {
      groups.push({ id: entry.id, statuses: [], thought: entry, tools: [] })
      continue
    }

    const current = groups[groups.length - 1]
    if (current) {
      current.tools.push(entry)
    } else {
      groups.push({ id: `tools-${entry.id}`, statuses: [], tools: [entry] })
    }
  }

  const renderableGroups = groups.filter(group => group.statuses.length > 0 || group.thought || group.tools.length > 0)
  const pinnedGroupIds = new Set(
    renderableGroups
      .filter(group => group.statuses.length > 0 || group.thought)
      .map(group => group.id),
  )
  const recentToolGroupIds = new Set(
    renderableGroups
      .filter(group => group.tools.length > 0 && !pinnedGroupIds.has(group.id))
      .slice(-6)
      .map(group => group.id),
  )

  return renderableGroups.filter(group => pinnedGroupIds.has(group.id) || recentToolGroupIds.has(group.id)).map(group => ({
    ...group,
    tools: group.tools.slice(-4),
  }))
}

function compactSettledTimelineEntries(entries: TimelineEntry[]) {
  const tools = entries.filter((entry): entry is Extract<TimelineEntry, { type: "tool" }> => entry.type === "tool")
  const thought = [...entries].reverse().find(entry => entry.type === "thought")
  const thinkingStatus = [...entries].reverse().find(entry => entry.type === "status" && entry.id === "status-thinking")
  const waitingStatus = [...entries].reverse().find(entry => entry.type === "status" && entry.id === "status-waiting-confirmation")
  const outputStatus = [...entries].reverse().find(entry => entry.type === "status" && entry.id === "status-output")
  const terminalStatus = [...entries].reverse().find(entry => (
    entry.type === "status" &&
    ["status-completed", "status-stopped", "status-error"].includes(entry.id)
  ))

  const selectedIds = new Set<string>()
  for (const entry of [
    thought,
    thought ? undefined : thinkingStatus,
    waitingStatus,
    outputStatus,
    terminalStatus,
    ...tools.slice(-8),
  ]) {
    if (entry) selectedIds.add(entry.id)
  }

  if (selectedIds.size === 0) return entries.slice(-8)
  return entries.filter(entry => selectedIds.has(entry.id))
}

function getSummaryTitle(input: {
  live: boolean
  partSnapshot?: AgentPartSnapshot
  activity?: AgentActivity
}) {
  if (!input.live) return "已完成"
  if (input.partSnapshot?.visibleStatus?.label) return input.partSnapshot.visibleStatus.label
  if (input.activity?.label) return input.activity.label
  return "正在处理"
}

function getTimelineEntryRank(entry: TimelineEntry) {
  if (entry.type === "tool") return 30
  if (entry.type === "thought") return 40
  switch (entry.phase) {
    case "waiting-confirmation":
      return 70
    case "answering":
      return 60
    case "thinking":
      return 50
    case "tool":
      return 45
    case "planning":
      return 35
    case "preparing":
      return 20
    case "completed":
      return 10
    case "error":
      return 90
    default:
      return 25
  }
}

function getLivePrimaryEntry(entries: TimelineEntry[]) {
  const running = entries.filter(entry => (
    entry.type === "thought"
      ? entry.tone === "running"
      : entry.type === "status"
        ? entry.tone === "running"
        : entry.step.tone === "running"
  ))
  const source = running.length > 0 ? running : entries
  return [...source].sort((left, right) => getTimelineEntryRank(right) - getTimelineEntryRank(left)).at(0)
}

function getAssistantPhaseFromAgentPhase(phase?: AgentActivity["phase"]): AssistantStatusPhase | undefined {
  switch (phase) {
    case "thinking":
    case "planning":
      return "thinking"
    case "answering":
      return "answering"
    case "error":
      return "blocked"
    case "completed":
      return "done"
    default:
      return undefined
  }
}

function getAssistantToneFromTimelineTone(tone?: "running" | "done" | "error" | "muted"): AssistantStatusTone {
  if (tone === "error") return "error"
  if (tone === "running") return "running"
  if (tone === "muted") return "muted"
  return "done"
}

function getLiveStatusLabel(entry: TimelineEntry | undefined, activity?: AgentActivity) {
  if (!entry) return getAssistantLiveHeadlineLabel({
    phase: getAssistantPhaseFromAgentPhase(activity?.phase),
    label: activity?.label,
    fallback: "正在处理",
  })
  if (entry.type === "status") {
    return getAssistantLiveHeadlineLabel({
      phase: getAssistantPhaseFromAgentPhase(entry.phase),
      label: entry.label,
      tone: getAssistantToneFromTimelineTone(entry.tone),
      fallback: activity?.label,
    })
  }
  if (entry.type === "thought") return getAssistantStatusLabel(
    entry.tone === "error" ? "blocked" : "pending",
    getAssistantToneFromTimelineTone(entry.tone),
  )
  if (entry.toolCall) return getToolProgressVerb(entry.step)
  return entry.step.label
}

function getLiveStatusDetail(input: {
  entry?: TimelineEntry
  activity?: AgentActivity
}) {
  return input.entry?.type === "status"
    ? input.entry.detail
    : input.entry?.type === "thought"
      ? compactText(input.entry.text, 90)
      : input.entry?.type === "tool"
        ? input.entry.step.detail || input.entry.step.meta
        : input.activity?.detail
}

function getLiveStatusTone(entry?: TimelineEntry): "running" | "done" | "error" {
  if (!entry) return "running"
  if (entry.type === "status") return getTimelineStatusTone(entry.tone)
  if (entry.type === "thought") return getThoughtStatusTone(entry.tone)
  if (entry.step.tone === "error") return "error"
  if (entry.step.tone === "running") return "running"
  return "done"
}

function LiveRunStatus({
  entries,
  activity,
  elapsedLabel,
}: {
  entries: TimelineEntry[]
  activity?: AgentActivity
  elapsedLabel?: string
}) {
  const primary = getLivePrimaryEntry(entries)
  const tone = getLiveStatusTone(primary)
  const running = tone === "running"
  const failed = tone === "error"
  const frameIndex = useClawFrame(running)
  const label = getLiveStatusLabel(primary, activity)
  const detail = getLiveStatusDetail({ entry: primary, activity })

  return (
    <div className="w-full" data-agent-live-status>
      <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
        <span
          className={cn(
            "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[12px] leading-none",
            failed ? "text-destructive/70" : running ? "text-primary/70" : "text-emerald-600/65",
          )}
          aria-hidden="true"
        >
          {getClawStatusGlyph(tone, frameIndex)}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "text-sm font-medium leading-6",
                failed ? "text-destructive/80" : running ? "text-foreground/88" : "text-foreground/72",
              )}
            >
              {label}
            </span>
            {elapsedLabel && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground/45">
                {elapsedLabel}
              </span>
            )}
          </div>
          {detail && (
            <div className="mt-0.5 max-w-xl truncate text-[12px] leading-5 text-muted-foreground/55" title={detail}>
              {detail}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getToolProgressVerb(step: RunStep) {
  if (step.tone === "error") return "调用失败"
  if (step.tone === "running") {
    switch (step.kind) {
      case "read":
      case "web_read":
        return "正在读取"
      case "list":
        return "正在列出"
      case "search":
      case "web_search":
        return "正在搜索"
      case "command":
        return "正在运行"
      case "git":
        return "正在查看"
      case "create":
        return "正在创建"
      case "update":
        return "正在编辑"
      case "delete":
        return "正在删除"
      default:
        return "正在调用"
    }
  }

  switch (step.kind) {
    case "read":
    case "web_read":
      return "已读取"
    case "list":
      return "已列出"
    case "search":
    case "web_search":
      return "已搜索"
    case "command":
      return "已运行"
    case "git":
      return "已查看"
    case "create":
      return "已创建"
    case "update":
      return "已编辑"
    case "delete":
      return "已删除"
    default:
      return "已调用"
  }
}

function StepRow({
  step,
}: {
  step: RunStep
}) {
  const StepIcon = getStepIcon(step.kind, step.tone, step.summary)
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[18px_1fr] gap-2 text-[11px] leading-relaxed",
        step.summary && "text-muted-foreground/70",
      )}
    >
      <span className="mt-0.5 flex size-4 items-center justify-center">
        <StepIcon
          className={cn(
            "size-3.5",
            step.tone === "running" && "animate-spin",
            getStepIconClassName(step),
          )}
        />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className={cn(
            "truncate",
            step.summary
              ? "text-muted-foreground/60"
              : step.tone === "error"
                ? "text-destructive/80"
                : "text-foreground/75",
          )}>
            {step.label}
          </div>
          {step.meta && !step.summary && (
            <div className="hidden shrink-0 truncate font-mono text-[10px] text-muted-foreground/35 sm:block">
              {step.meta}
            </div>
          )}
        </div>
        {step.detail && (
          <div
            className={cn(
              "mt-0.5 truncate",
              step.kind === "command" || step.kind === "git"
                ? "font-mono text-muted-foreground/55"
                : "text-muted-foreground/48",
            )}
            title={step.detail}
          >
            {step.detail}
          </div>
        )}
      </div>
    </div>
  )
}

function RunStepList({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-2">
      {steps.map(step => (
        <StepRow key={step.id} step={step} />
      ))}
    </div>
  )
}

function TimelineToolDetails({
  tools,
}: {
  tools: Array<Extract<TimelineEntry, { type: "tool" }>>
}) {
  if (tools.length === 0) return null

  return (
    <div className="mt-1.5 space-y-1">
      {tools.map(tool => (
        <TimelineToolRow key={tool.id} entry={tool} />
      ))}
    </div>
  )
}

type ThoughtTimelineEntry = Extract<TimelineEntry, { type: "thought" }>
type StatusTimelineEntry = Extract<TimelineEntry, { type: "status" }>

function getThoughtStatusTone(tone: ThoughtTimelineEntry["tone"]): "running" | "done" | "error" {
  if (tone === "error") return "error"
  if (tone === "running") return "running"
  return "done"
}

function getTimelineStatusTone(tone: StatusTimelineEntry["tone"]): "running" | "done" | "error" {
  if (tone === "error") return "error"
  if (tone === "running") return "running"
  return "done"
}

function TimelineStatusRow({
  status,
  frameIndex,
}: {
  status: StatusTimelineEntry
  frameIndex: number
}) {
  const statusTone = getTimelineStatusTone(status.tone)
  const running = statusTone === "running"
  const failed = statusTone === "error"

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex h-4 min-w-0 items-center gap-1.5 text-[10px] leading-none",
          failed ? "text-destructive/70" : "text-muted-foreground/50",
        )}
        aria-label={status.label}
      >
        <span
          className={cn(
            "inline-flex w-3 shrink-0 justify-center font-mono text-[11px] leading-none",
            failed ? "text-destructive/70" : running ? "text-primary/65" : "text-emerald-600/60",
          )}
        >
          {getClawStatusGlyph(statusTone, frameIndex)}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] font-medium leading-none tracking-normal",
            running ? "agent-thinking-label-active" : "text-muted-foreground/48",
            failed && "text-destructive/70",
          )}
        >
          {status.label}
        </span>
        {status.durationLabel && (
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/32">
            {status.durationLabel}
          </span>
        )}
      </div>
      {status.detail && (
        <div
          className={cn(
            "mt-1 truncate pl-5 text-[11px] leading-relaxed",
            failed ? "text-destructive/75" : "text-muted-foreground/55",
          )}
          title={status.detail}
        >
          {status.detail}
        </div>
      )}
    </div>
  )
}

function TimelineThought({
  thought,
  frameIndex,
}: {
  thought: ThoughtTimelineEntry
  frameIndex: number
}) {
  const statusTone = getThoughtStatusTone(thought.tone)
  const running = statusTone === "running"
  const failed = statusTone === "error"
  const label = getAssistantStatusLabel(failed ? 'blocked' : 'thinking', statusTone)

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex h-4 min-w-0 items-center gap-1.5 text-[10px] leading-none",
          failed ? "text-destructive/70" : "text-muted-foreground/48",
        )}
        aria-label={label}
      >
        <span
          className={cn(
            "inline-flex w-3 shrink-0 justify-center font-mono text-[11px] leading-none",
            failed ? "text-destructive/70" : running ? "text-primary/65" : "text-muted-foreground/38",
          )}
        >
          {getClawStatusGlyph(statusTone, frameIndex)}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] font-medium leading-none tracking-normal",
            running ? "agent-thinking-label-active" : "text-muted-foreground/42",
            failed && "text-destructive/70",
          )}
        >
          {label}
        </span>
        {thought.durationLabel && (
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/32">
            {thought.durationLabel}
          </span>
        )}
        {thought.omittedChars ? (
          <span className="shrink-0 text-[9px] text-muted-foreground/32">
            已压缩
          </span>
        ) : null}
      </div>
      {thought.text && (
        <div
          className={cn(
            "mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed",
            failed ? "text-destructive/80" : "text-foreground/76",
          )}
        >
          {thought.text}
        </div>
      )}
    </div>
  )
}

function TimelineToolRow({
  entry,
}: {
  entry: Extract<TimelineEntry, { type: "tool" }>
}) {
  const call = entry.toolCall
  const label = call ? getInlineToolActionLabel(call) : entry.step.label
  const detail = call ? getToolActionDetail(call) : entry.step.detail
  const failed = entry.step.tone === "error"
  const verb = getToolProgressVerb(entry.step)

  return (
    <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-[10.5px] leading-5 text-muted-foreground/52">
      <span className={cn("shrink-0", failed && "text-destructive/70")}>→</span>
      <span className={cn("shrink-0", failed ? "text-destructive/75" : "text-muted-foreground/58")}>
        {verb}
      </span>
      <span className={cn("shrink-0 font-semibold", failed ? "text-destructive/75" : "text-muted-foreground/70")}>
        {label}
      </span>
      {detail && (
        <span className="min-w-0 truncate text-muted-foreground/55" title={detail}>
          {detail}
        </span>
      )}
      {entry.toolCall?.durationLabel && (
        <span className="shrink-0 text-[10px] text-muted-foreground/38">
          {entry.toolCall.durationLabel}
        </span>
      )}
    </div>
  )
}

function RunTimeline({
  groups,
  partSnapshot,
}: {
  groups: TimelineGroup[]
  partSnapshot?: AgentPartSnapshot
}) {
  const frameIndex = useClawFrame(groups.some(group => group.thought?.tone === "running" || group.statuses.some(status => status.tone === "running")))
  if (groups.length === 0) return null

  return (
    <div
      className="space-y-2"
      data-agent-stream-status={partSnapshot?.status}
    >
      {groups.map(group => {
        const thought = group.thought
        return (
          <div key={group.id} className="min-w-0">
            {group.statuses.map(status => (
              <TimelineStatusRow key={status.id} status={status} frameIndex={frameIndex} />
            ))}
            {thought ? (
              <TimelineThought thought={thought} frameIndex={frameIndex} />
            ) : null}
            <div className="mt-1.5 pl-5">
              {group.tools.length > 0 && (
                <TimelineToolDetails tools={group.tools} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AgentRunSummary({
  elapsedMs,
  telemetry,
  visibleOutput,
  steps = [],
  toolCalls = [],
  events = [],
  activity,
  currentThought,
  currentAction,
  currentObservation,
  partSnapshot,
  live = false,
}: AgentRunSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const effectiveElapsedMs = elapsedMs ?? telemetry?.elapsedMs
  const elapsedLabel = formatElapsed(effectiveElapsedMs)
  const liveElapsedLabel = formatLiveElapsed(effectiveElapsedMs)
  const tokenLabel = formatTokenCount(getVisibleOutputTokens({ telemetry, visibleOutput, live }))
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => call.toolName && !isSupportOnlyToolName(call.toolName)),
    [toolCalls],
  )
  const runSteps = React.useMemo(
    () => buildStepSummary({ steps, toolCalls: visibleToolCalls, events, activity, currentThought, currentAction, currentObservation, partSnapshot, live }),
    [activity, currentAction, currentObservation, currentThought, events, live, partSnapshot, steps, visibleToolCalls],
  )
  const timelineEntries = React.useMemo(
    () => buildThoughtTimeline({ runSteps, toolCalls: visibleToolCalls, events, steps, currentThought, activity, partSnapshot, visibleOutput, live }),
    [activity, currentThought, events, live, partSnapshot, runSteps, steps, visibleOutput, visibleToolCalls],
  )
  const timelineGroups = React.useMemo(
    () => buildTimelineGroups(live ? timelineEntries : compactSettledTimelineEntries(timelineEntries)),
    [live, timelineEntries],
  )

  const hasSummary = Boolean(elapsedLabel || tokenLabel || runSteps.length > 0 || timelineGroups.length > 0 || visibleToolCalls.length > 0)
  if (!hasSummary) return null

  const title = getSummaryTitle({ live, partSnapshot, activity })
  const meta = [elapsedLabel, tokenLabel ? `${tokenLabel} tokens` : ""].filter(Boolean)
  const canExpand = !live

  if (live) {
    if (timelineEntries.length === 0) return null
    return (
      <div className="w-full" data-agent-run-summary="live">
        <LiveRunStatus
          entries={timelineEntries}
          activity={activity}
          elapsedLabel={liveElapsedLabel}
        />
      </div>
    )
  }

  return (
    <div className="w-full" data-agent-run-summary="folded">
      <button
        type="button"
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5",
          "text-xs text-muted-foreground transition-colors",
          canExpand && "hover:border-border/30 hover:bg-muted/20 hover:text-foreground",
          expanded && canExpand && "border-border/35 bg-muted/20 text-foreground",
        )}
        onClick={() => {
          if (!canExpand) return
          setExpanded(value => !value)
        }}
        aria-label={expanded ? "收起运行步骤" : "展开运行步骤"}
        aria-disabled={!canExpand}
      >
        <span className="shrink-0">{title}</span>
        {meta.length > 0 && (
          <span className="truncate tabular-nums text-muted-foreground/80">
            {meta.join(" · ")}
          </span>
        )}
        <ChevronDown className={cn(
          "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
          expanded && canExpand && "rotate-180",
        )} />
      </button>

      {expanded && (
        <div className="mt-2 max-h-96 overflow-auto rounded-md border border-border/15 bg-muted/10 px-3 py-2.5">
          {timelineGroups.length > 0 && (
            <RunTimeline
              groups={timelineGroups}
              partSnapshot={partSnapshot}
            />
          )}
          {runSteps.length > 0 && (
            <div className={cn(timelineGroups.length > 0 && "mt-3 border-t border-border/10 pt-2.5")}>
              <RunStepList steps={runSteps} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
