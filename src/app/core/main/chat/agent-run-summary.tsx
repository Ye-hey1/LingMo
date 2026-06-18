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
import type { AgentActivity, AgentEvent, AgentTurnTelemetry, ReActStep, ToolCall } from "@/lib/agent"
import { isSupportOnlyToolName } from "@/lib/agent/support-tools"
import { cn } from "@/lib/utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import { CompactToolCalls } from "./compact-tool-calls"

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

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
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
  if (base === "clip_web_content") return "create"
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
  if (base === "clip_web_content") return "保存网页摘录"
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
    const resultDetail = getResultDetail(call)
    const detail = getToolActionDetail(call)
    const statusDetail = call.status === "error" && resultDetail && resultDetail !== detail ? resultDetail : undefined
    const duration = durations.get(call.id)
    const baseName = getBaseToolName(call.toolName)
    return {
      id: `tool-${call.id || index}`,
      label: getToolActionLabel(call),
      detail: [detail, statusDetail].filter(Boolean).join(" · "),
      meta: [baseName, getToolStatusLabel(call), duration].filter(Boolean).join(" · "),
      tone: getToolTone(call),
      kind: classifyToolCall(call),
    }
  })
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

function buildEventSteps(events: AgentEvent[]): RunStep[] {
  const steps: RunStep[] = []

  events.forEach((event, index) => {
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
      case "agent.context.compacted":
        steps.push({ id: `${index}-context`, label: "压缩上下文", detail, tone: "done", kind: "tool" })
        break
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
      case "tool.updated":
      case "tool.execution.finished": {
        const status = String(payload.status || payload.toolCall?.status || "")
        const failed = payload.success === false || status === "error"
        steps.push({
          id: `${index}-tool-finished`,
          label: eventToolCall ? getToolActionLabel(eventToolCall) : toolLabel ? `${failed ? "工具失败" : "工具完成"}：${toolLabel}` : failed ? "工具失败" : "工具完成",
          detail,
          meta: [toolName, formatDurationMs(payload.durationMs)].filter(Boolean).join(" · "),
          tone: failed ? "error" : "done",
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
  if (toolActionSteps.length > 0) {
    return [
      ...buildToolSummarySteps(effectiveToolCalls),
      ...toolActionSteps.slice(-12),
    ]
  }

  const eventSteps = buildEventSteps(input.events)
  if (eventSteps.length > 0) return eventSteps.slice(-8)

  if (input.live && input.activity?.phase === "answering") {
    return [{
      id: "live-answering",
      label: "正在流式输出回答",
      detail: input.activity.detail || "回答正文会直接显示在下方。",
      tone: "running",
      kind: "tool",
    }]
  }

  const visibleThought = compactText(input.currentThought, 140)
  if (input.live && visibleThought) {
    return [{
      id: "live-visible-thought",
      label: "正在梳理下一步",
      detail: visibleThought,
      tone: "running",
      kind: "tool",
    }]
  }

  return [{
    id: input.live ? "no-tool-live" : "no-tool-final",
    label: input.live ? "等待模型返回下一步操作" : "未调用工具",
    detail: input.live
      ? "当前还没有命令、文件、网络或 Git 操作记录。"
      : "这次只生成了会话回复，没有命令、文件、网络或 Git 操作记录。",
    tone: input.live ? "running" : "muted",
    kind: "tool",
  }]
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
  const visibleOutput = input.visibleOutput?.trim() || ""
  if (visibleOutput) return estimateTokens(visibleOutput)
  if (input.live) return 0
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

function getLiveStepSentence(step: RunStep) {
  const label = step.label.replace(/[。.]$/, "")
  if (step.tone === "error") return `${label}失败，正在尝试恢复。`
  if (step.tone === "done") return `已完成：${label}。`
  if (/^(正在|等待)/.test(label)) return `${label}。`
  return `正在${label}。`
}

function getLiveDetailLabel(step: RunStep, toolCall?: ToolCall) {
  if (step.detail) return step.detail
  if (toolCall) return getToolActionDetail(toolCall)
  if (step.meta) return step.meta
  return "查看工具详情"
}

function getLiveSteps(runSteps: RunStep[]) {
  const concreteSteps = runSteps.filter(step => !step.summary)
  const steps = concreteSteps.length > 0 ? concreteSteps : runSteps
  return steps.slice(-4)
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

function LiveStepDetails({
  step,
  toolCall,
}: {
  step: RunStep
  toolCall?: StepToolCall
}) {
  const detailLabel = getLiveDetailLabel(step, toolCall)
  const hasDetail = Boolean(detailLabel || step.meta || toolCall)
  if (!hasDetail) return null

  return (
    <details className="group/details mt-1.5 rounded-md border border-border/12 bg-muted/8 px-2 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground/55 marker:hidden">
        <ChevronDown className="size-3 shrink-0 text-muted-foreground/45 transition-transform group-open/details:rotate-180" />
        <span
          className={cn(
            "min-w-0 truncate",
            step.kind === "command" || step.kind === "git" ? "font-mono" : "",
          )}
          title={detailLabel}
        >
          {detailLabel}
        </span>
        {toolCall?.durationLabel && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/35">
            {toolCall.durationLabel}
          </span>
        )}
      </summary>
      <div className="mt-1.5 space-y-1.5 border-t border-border/10 pt-1.5">
        {step.meta && (
          <div className="truncate font-mono text-[10px] text-muted-foreground/40" title={step.meta}>
            {step.meta}
          </div>
        )}
        {toolCall ? (
          <CompactToolCalls
            toolCalls={[toolCall]}
            grouped={false}
            defaultExpanded={false}
            isStreaming={toolCall.status === "running" || toolCall.status === "pending"}
          />
        ) : step.detail ? (
          <div className="whitespace-pre-wrap break-words rounded border border-border/10 bg-background/30 px-2 py-1 font-mono text-[10px] text-muted-foreground/55">
            {step.detail}
          </div>
        ) : null}
      </div>
    </details>
  )
}

function LiveRunBody({
  runSteps,
  toolCalls,
  events,
}: {
  runSteps: RunStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
}) {
  const liveSteps = getLiveSteps(runSteps)
  if (liveSteps.length === 0) return null

  return (
    <div className="mt-2 space-y-2 border-l border-border/20 pl-3">
      {liveSteps.map((step) => {
        const StepIcon = getStepIcon(step.kind, step.tone, step.summary)
        const toolCall = getStepToolCall(step, toolCalls, events)
        return (
          <div key={`live-${step.id}`} className="min-w-0">
            <div className="grid min-w-0 grid-cols-[16px_1fr] gap-2 text-xs leading-relaxed">
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
                <div className={cn(
                  "text-foreground/78",
                  step.tone === "error" && "text-destructive/80",
                )}>
                  {getLiveStepSentence(step)}
                </div>
                <LiveStepDetails step={step} toolCall={toolCall} />
              </div>
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
  live = false,
}: AgentRunSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const effectiveElapsedMs = elapsedMs ?? telemetry?.elapsedMs
  const elapsedLabel = formatElapsed(effectiveElapsedMs)
  const tokenLabel = formatTokenCount(getVisibleOutputTokens({ telemetry, visibleOutput, live }))
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => call.toolName && !isSupportOnlyToolName(call.toolName)),
    [toolCalls],
  )
  const runSteps = React.useMemo(
    () => buildStepSummary({ steps, toolCalls: visibleToolCalls, events, activity, currentThought, currentAction, currentObservation, live }),
    [activity, currentAction, currentObservation, currentThought, events, live, steps, visibleToolCalls],
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

      {!expanded && live && (
        <LiveRunBody
          runSteps={runSteps}
          toolCalls={visibleToolCalls}
          events={events}
        />
      )}

      {expanded && (
        <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border/15 bg-muted/10 px-3 py-2.5">
          <RunStepList steps={runSteps} />
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
