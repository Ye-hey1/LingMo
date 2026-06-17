/**
 * Agent 流式展示优化 — 工具调用 + 思考过程的紧凑美观渲染
 *
 * 核心改进思路（借鉴 claude-code-source 的 Codex TUI 设计理念）：
 *
 * 1. 工具调用行（ToolCallRow）：单行紧凑展示工具名称 + 参数摘要 + 状态图标
 *    - 而不是当前的 Card 展开式（占据过多垂直空间）
 *
 * 2. 思考过程气泡（ThinkingBubble）：半透明折叠区域，不干扰正文
 *    - 流式中自动展开，完成后自动折叠
 *    - 只显示摘要，点击展开全部
 *
 * 3. 分组展示：将连续的同类型工具调用合并为一组
 *    - 多个 read_file → "读取了 3 个文件"
 *    - 多个 web_search → "搜索了 2 次"
 *
 * 4. 平滑过渡动画：使用 framer-motion 的 layout 动画
 *    - 工具状态变化时平滑过渡（running → completed）
 *    - 新工具调用出现时从上方滑入
 */

"use client"

import * as React from "react"
import {
  ChevronDown,
  Database,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import type { ToolCall } from "@/lib/agent"
import { getBaseAgentToolName, isSupportOnlyToolName } from "@/lib/agent/support-tools"
import { getClawStatusGlyph } from "./claw-stream-format"

// ---------------------------------------------------------------------------
// 工具分类标签
// ---------------------------------------------------------------------------

interface ToolCategoryConfig {
  label: string
}

const TOOL_CATEGORIES: Record<string, ToolCategoryConfig> = {
  read: {
    label: "Read",
  },
  write: {
    label: "Write",
  },
  search: {
    label: "Search",
  },
  web: {
    label: "Web",
  },
  mcp: {
    label: "MCP",
  },
  system: {
    label: "System",
  },
  folder: {
    label: "Files",
  },
  default: {
    label: "Tool",
  },
}

function categorizeTool(toolName: string): ToolCategoryConfig {
  const base = toolName.includes("__") ? toolName.split("__").pop()! : toolName
  const lower = base.toLowerCase()

  if (lower === "select_skill" || lower.includes("skill")) return TOOL_CATEGORIES.system
  if (lower.startsWith("read_") || lower.startsWith("safe_read") || lower.startsWith("get_")) return TOOL_CATEGORIES.read
  if (lower.startsWith("create_") || lower.startsWith("update_") || lower.startsWith("replace_") || lower.startsWith("delete_") || lower.startsWith("write_")) return TOOL_CATEGORIES.write
  if (lower.startsWith("safe_grep") || lower.startsWith("search") || lower.includes("find")) return TOOL_CATEGORIES.search
  if (lower.startsWith("web_") || lower.includes("fetch") || lower.includes("tavily")) return TOOL_CATEGORIES.web
  if (lower.startsWith("mcp") || lower.includes("server")) return TOOL_CATEGORIES.mcp
  if (lower.startsWith("list_") || lower.startsWith("folder") || lower.includes("directory")) return TOOL_CATEGORIES.folder
  if (lower.startsWith("get_current") || lower.startsWith("check_")) return TOOL_CATEGORIES.system

  return TOOL_CATEGORIES.default
}

// ---------------------------------------------------------------------------
// 参数摘要提取
// ---------------------------------------------------------------------------

function extractParamSummary(toolName: string, params: Record<string, any>): string {
  const base = toolName.includes("__") ? toolName.split("__").pop()! : toolName
  const lower = base.toLowerCase()

  if (lower === "select_skill") {
    const skills = params.skill_ids || params.skillIds || params.skills || params.selected_skills
    if (Array.isArray(skills) && skills.length > 0) {
      return skills.slice(0, 3).join(", ")
    }
    if (typeof skills === "string" && skills.trim()) {
      return skills
    }
  }

  // 文件路径类工具 → 显示文件名
  if (lower.includes("read") || lower.includes("file") || lower.includes("create") || lower.includes("update") || lower.includes("replace")) {
    const path = params.filePath || params.path || params.targetPath || params.folderPath || ""
    if (path) {
      const parts = path.replace(/\\/g, "/").split("/")
      return parts.length > 1 ? `.../${parts.slice(-2).join("/")}` : parts[0] || path
    }
  }

  // 搜索类工具 → 显示 query
  if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) {
    const query = params.query || params.pattern || params.searchQuery || ""
    if (query) return query.length > 40 ? query.slice(0, 40) + "…" : query
  }

  // Web 类工具 → 显示 URL 或 query
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("extract")) {
    const url = params.url || params.query || ""
    if (url) return url.length > 50 ? url.slice(0, 50) + "…" : url
  }

  // 通用：取第一个字符串参数
  for (const value of Object.values(params)) {
    if (typeof value === "string" && value.trim()) {
      return value.length > 40 ? value.slice(0, 40) + "…" : value
    }
  }

  return ""
}

function getBaseToolName(toolName: string) {
  return getBaseAgentToolName(toolName)
}

function getToolTone(status: ToolCall["status"]): "running" | "done" | "error" {
  if (status === "error" || status === "blocked") return "error"
  if (status === "running" || status === "pending") return "running"
  return "done"
}

function useClawFrame(active: boolean) {
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

function getToolDisplayName(toolName: string) {
  if (getBaseToolName(toolName).toLowerCase() === "select_skill") {
    return "Select skill"
  }

  return getBaseToolName(toolName)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getHarnessResultMeta(result: ToolCall["result"]) {
  const data = result?.data
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null
  }

  const record = data as {
    compressed?: boolean
    originalType?: string
    itemCount?: number
    preview?: string
    dataRef?: string
    artifacts?: string[]
    retryable?: boolean
    errorKind?: string
    warnings?: string[]
    outputEncoding?: string
  }

  if (
    !record.compressed &&
    !record.dataRef &&
    !record.artifacts?.length &&
    !record.retryable &&
    !record.errorKind &&
    !record.warnings?.length &&
    !record.outputEncoding
  ) {
    return null
  }

  return record
}

// ---------------------------------------------------------------------------
// 工具调用行组件
// ---------------------------------------------------------------------------

interface ToolCallRowProps {
  toolCall: ToolCall
  isStreaming?: boolean
  defaultExpanded?: boolean
}

function ToolCallRow({ toolCall, isStreaming = false, defaultExpanded = false }: ToolCallRowProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const paramSummary = extractParamSummary(toolCall.toolName, toolCall.params)
  const isRunning = toolCall.status === "running" || toolCall.status === "pending"
  const hasError = toolCall.status === "error"
  const harnessMeta = getHarnessResultMeta(toolCall.result)
  const tone = getToolTone(toolCall.status)
  const frameIndex = useClawFrame(isStreaming && tone === "running")

  // 结果摘要
  const resultSummary = React.useMemo(() => {
    if (!toolCall.result) return null
    const text = toolCall.result.success
      ? (typeof toolCall.result.data === "string"
          ? toolCall.result.data
          : toolCall.result.message || "")
      : toolCall.result.error || ""

    if (!text) return null
    const cleaned = text.replace(/\s+/g, " ").trim()
    return cleaned.length > 80 ? cleaned.slice(0, 80) + "…" : cleaned
  }, [toolCall.result])

  return (
    <div className={cn(
      "group flex items-start gap-1.5 rounded-md border border-transparent px-2 py-1 transition-colors",
      "hover:bg-muted/10",
      isRunning && "border-border/10 bg-muted/8",
      hasError && "border-destructive/15 bg-destructive/5",
    )}>
      <span className={cn(
        "mt-0.5 w-4 shrink-0 font-mono text-xs leading-none",
        tone === "error" ? "text-destructive/70" : tone === "done" ? "text-emerald-600" : "text-muted-foreground/60",
      )}>
        {getClawStatusGlyph(tone, frameIndex)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[10px] text-muted-foreground/60">
            {getToolDisplayName(toolCall.toolName)}
          </span>
          {paramSummary && (
            <span className="truncate text-[10px] text-muted-foreground/35">
              {paramSummary}
            </span>
          )}
        </div>

        {!expanded && resultSummary && (
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground/35">
            {resultSummary}
          </div>
        )}

        {harnessMeta && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {harnessMeta.compressed && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/20 px-1 py-0.5 text-[9px] text-muted-foreground/45">
                <Database className="size-2.5" />
                compressed
              </span>
            )}
            {harnessMeta.dataRef && (
              <span className="max-w-full truncate rounded bg-muted/20 px-1 py-0.5 font-mono text-[9px] text-muted-foreground/45" title={harnessMeta.dataRef}>
                {harnessMeta.dataRef}
              </span>
            )}
            {harnessMeta.errorKind && (
              <span className="rounded bg-destructive/10 px-1 py-0.5 text-[9px] text-destructive/70">
                {harnessMeta.errorKind}
              </span>
            )}
            {harnessMeta.retryable && (
              <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-600">
                retryable
              </span>
            )}
            {harnessMeta.outputEncoding === "utf8-replacement" && (
              <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-600">
                utf-8 repaired
              </span>
            )}
            {harnessMeta.warnings?.slice(0, 1).map((warning, index) => (
              <span
                key={`${warning}-${index}`}
                className="max-w-full truncate rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-600"
                title={warning}
              >
                warning
              </span>
            ))}
          </div>
        )}

        {/* 展开的详细内容 */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="mt-1 space-y-1">
                {/* 参数 */}
                {Object.keys(toolCall.params).length > 0 && (
                  <pre className="max-h-24 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-words rounded border border-border/15 bg-muted/8 px-2 py-1 text-[10px] text-muted-foreground/45">
                    {JSON.stringify(toolCall.params, null, 2)}
                  </pre>
                )}
                {/* 结果 */}
                {toolCall.result && (
                  <pre className={cn(
                    "max-h-32 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-words rounded border border-border/15 bg-muted/8 px-2 py-1 text-[10px]",
                    toolCall.result.success ? "text-muted-foreground/45" : "text-destructive/65",
                  )}>
                    {toolCall.result.success
                      ? (typeof toolCall.result.data === "string"
                          ? toolCall.result.data
                          : JSON.stringify(harnessMeta?.preview || toolCall.result.data || toolCall.result.message, null, 2))
                      : toolCall.result.error || "Unknown error"}
                  </pre>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 右侧操作 */}
      <button
        type="button"
        className="shrink-0 rounded p-0.5 opacity-0 transition-colors hover:bg-muted/30 group-hover:opacity-70"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown className={cn(
          "size-3 text-muted-foreground/35 transition-transform",
          expanded && "rotate-180",
        )} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 工具调用分组
// ---------------------------------------------------------------------------

interface ToolCallGroup {
  categoryKey: string
  category: ToolCategoryConfig
  calls: ToolCall[]
}

function groupToolCalls(calls: ToolCall[]): ToolCallGroup[] {
  const groups: ToolCallGroup[] = []

  for (const call of calls) {
    const category = categorizeTool(call.toolName)
    const key = category.label

    // 合并连续同类
    if (groups.length > 0 && groups[groups.length - 1].categoryKey === key) {
      groups[groups.length - 1].calls.push(call)
    } else {
      groups.push({ categoryKey: key, category, calls: [call] })
    }
  }

  return groups
}

// ---------------------------------------------------------------------------
// 分组标题行（多工具合并展示）
// ---------------------------------------------------------------------------

interface GroupHeaderProps {
  group: ToolCallGroup
  isStreaming?: boolean
  onToggleExpand: () => void
  expanded: boolean
}

function GroupHeader({ group, isStreaming, onToggleExpand, expanded }: GroupHeaderProps) {
  const hasRunning = group.calls.some(c => c.status === "running" || c.status === "pending")
  const hasError = group.calls.some(c => c.status === "error")
  const allDone = group.calls.every(c => c.status === "success" || c.status === "error")
  const tone = hasError ? "error" : hasRunning ? "running" : "done"
  const frameIndex = useClawFrame(Boolean(isStreaming && tone === "running"))

  // 合并参数摘要
  const summaries = group.calls.map(c => extractParamSummary(c.toolName, c.params)).filter(Boolean)
  const combinedSummary = summaries.length > 2
    ? `${summaries.slice(0, 2).join(", ")} +${summaries.length - 2} more`
    : summaries.join(", ")

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        "hover:bg-muted/10",
        hasRunning && "border-border/10 bg-muted/8",
        hasError && "border-destructive/15 bg-destructive/5",
      )}
      onClick={onToggleExpand}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60">
            {group.calls.length > 1 ? group.category.label : getToolDisplayName(group.calls[0].toolName)}
          </span>
          {combinedSummary && (
            <span className="truncate text-[10px] text-muted-foreground/35">
              {combinedSummary}
            </span>
          )}
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[9px] tabular-nums">
        <span className={cn(
          "text-xs",
          tone === "error" ? "text-destructive/70" : tone === "done" ? "text-emerald-600" : "text-muted-foreground/60",
        )}>
          {getClawStatusGlyph(tone, frameIndex)}
        </span>
        <span className={cn(
          "text-muted-foreground/35",
          hasError && "text-destructive/60",
        )}>
          {hasError ? "Failed" : allDone ? "Done" : hasRunning ? "Running" : ""}
        </span>
        <ChevronDown className={cn(
          "size-3 text-muted-foreground/30 transition-transform",
          expanded && "rotate-180",
        )} />
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// 主组件：紧凑工具调用面板
// ---------------------------------------------------------------------------

interface CompactToolCallsProps {
  toolCalls: ToolCall[]
  isStreaming?: boolean
  /** 是否使用分组模式（合并同类工具） */
  grouped?: boolean
  /** 是否默认展开工具详情 */
  defaultExpanded?: boolean
}

export function CompactToolCalls({
  toolCalls,
  isStreaming = false,
  grouped = true,
  defaultExpanded = true,
}: CompactToolCallsProps) {
  const visibleToolCalls = toolCalls.filter(call => !isSupportOnlyToolName(call.toolName))
  if (visibleToolCalls.length === 0) return null

  const groups = grouped ? groupToolCalls(visibleToolCalls) : visibleToolCalls.map(c => ({
    categoryKey: categorizeTool(c.toolName).label,
    category: categorizeTool(c.toolName),
    calls: [c],
  }))

  return (
    <div className="w-full space-y-0.5">
      {groups.map((group, gi) => (
        <GroupedToolCalls
          key={`group-${gi}-${group.categoryKey}`}
          group={group}
          isStreaming={isStreaming}
          defaultExpanded={
            group.calls.some(c => c.status === "error") ||
            (defaultExpanded && group.calls.length === 1)
          }
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 分组展示组件（内部）
// ---------------------------------------------------------------------------

interface GroupedToolCallsProps {
  group: ToolCallGroup
  isStreaming?: boolean
  defaultExpanded?: boolean
}

function GroupedToolCalls({ group, isStreaming, defaultExpanded = false }: GroupedToolCallsProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded)

  // 单个工具调用且无错误时，直接渲染行
  if (group.calls.length === 1) {
    return (
      <ToolCallRow
        toolCall={group.calls[0]}
        isStreaming={isStreaming}
        defaultExpanded={defaultExpanded || group.calls[0].status === "error"}
      />
    )
  }

  // 多个工具调用：分组标题 + 展开列表
  return (
    <div>
      <GroupHeader
        group={group}
        isStreaming={isStreaming}
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden ml-3 pl-2 border-l border-border/30"
          >
            {group.calls.map((call, i) => (
              <ToolCallRow
                key={call.id || `${call.toolName}-${i}`}
                toolCall={call}
                isStreaming={isStreaming}
                defaultExpanded={call.status === "error"}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 思考过程紧凑展示
// ---------------------------------------------------------------------------

interface CompactThinkingProps {
  content: string
  isStreaming?: boolean
  /** 最大折叠时显示行数 */
  maxCollapsedLines?: number
}

export function CompactThinking({
  content,
  isStreaming = false,
  maxCollapsedLines = 2,
}: CompactThinkingProps) {
  const [expanded, setExpanded] = React.useState(isStreaming)
  const frameIndex = useClawFrame(isStreaming)

  // 流式时自动展开
  React.useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  if (!content.trim()) return null

  const lines = content.split("\n").filter(Boolean)
  const needsTruncation = lines.length > maxCollapsedLines + 2

  const displayContent = expanded || !needsTruncation
    ? content
    : lines.slice(0, maxCollapsedLines).join("\n") + " …"

  return (
    <div className={cn(
      "w-full rounded-md border border-border/20 bg-muted/8 px-3 py-2",
      "transition-colors",
      isStreaming && "bg-muted/12",
    )}>
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={cn(
          "w-4 shrink-0 font-mono text-xs",
          isStreaming ? "text-muted-foreground/60" : "text-emerald-600",
        )}>
          {getClawStatusGlyph(isStreaming ? "running" : "done", frameIndex)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground/55">
          {isStreaming ? "Thinking..." : "Thought"}
        </span>
        {needsTruncation && (
          <ChevronDown className={cn(
            "size-3 text-muted-foreground/40 transition-transform",
            expanded && "rotate-180",
          )} />
        )}
      </button>

      <AnimatePresence initial={false}>
        <motion.div
          initial={false}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="overflow-hidden"
        >
          <pre className={cn(
            "mt-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words",
            "text-muted-foreground/55 font-mono",
            !expanded && needsTruncation && "max-h-10",
          )}>
            {displayContent}
          </pre>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 工具调用结果气泡（用于单行 inline 展示）
// ---------------------------------------------------------------------------

interface ToolResultBadgeProps {
  toolName: string
  success: boolean
  summary?: string
  durationMs?: number
}

export function ToolResultBadge({ toolName, success, summary, durationMs }: ToolResultBadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
      "border border-border/20",
      success
        ? "bg-muted/10 text-muted-foreground"
        : "bg-destructive/5 text-destructive/75",
    )}>
      <span className={cn("size-1.5 rounded-full", success ? "bg-muted-foreground/35" : "bg-destructive/70")} />
      <span className="truncate max-w-[120px]">{toolName}</span>
      {summary && (
        <span className="truncate max-w-[120px] text-muted-foreground/55">{summary}</span>
      )}
      {durationMs != null && (
        <span className="text-[9px] opacity-60 tabular-nums">
          {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </span>
  )
}
