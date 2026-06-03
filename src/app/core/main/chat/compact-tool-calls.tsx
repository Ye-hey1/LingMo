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
  CheckCircle2,
  CircleX,
  Loader2,
  ChevronDown,
  FileText,
  Globe,
  Search,
  Wrench,
  Eye,
  Brain,
  Zap,
  Copy,
  FolderOpen,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import type { ToolCall } from "@/lib/agent"

// ---------------------------------------------------------------------------
// 工具分类与图标映射
// ---------------------------------------------------------------------------

interface ToolCategoryConfig {
  icon: LucideIcon
  label: string
  color: string // tailwind text color
  bgColor: string // tailwind bg color for badge
}

const TOOL_CATEGORIES: Record<string, ToolCategoryConfig> = {
  read: { icon: FileText, label: "读取", color: "text-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/40" },
  write: { icon: Zap, label: "写入", color: "text-amber-500", bgColor: "bg-amber-50 dark:bg-amber-950/40" },
  search: { icon: Search, label: "搜索", color: "text-violet-500", bgColor: "bg-violet-50 dark:bg-violet-950/40" },
  web: { icon: Globe, label: "联网", color: "text-cyan-500", bgColor: "bg-cyan-50 dark:bg-cyan-950/40" },
  mcp: { icon: Wrench, label: "MCP", color: "text-orange-500", bgColor: "bg-orange-50 dark:bg-orange-950/40" },
  system: { icon: Eye, label: "系统", color: "text-emerald-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/40" },
  folder: { icon: FolderOpen, label: "文件", color: "text-sky-500", bgColor: "bg-sky-50 dark:bg-sky-950/40" },
  default: { icon: Wrench, label: "工具", color: "text-muted-foreground", bgColor: "bg-muted/30" },
}

function categorizeTool(toolName: string): ToolCategoryConfig {
  const base = toolName.includes("__") ? toolName.split("__").pop()! : toolName
  const lower = base.toLowerCase()

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
  const category = categorizeTool(toolCall.toolName)
  const Icon = category.icon
  const paramSummary = extractParamSummary(toolCall.toolName, toolCall.params)
  const isRunning = toolCall.status === "running" || toolCall.status === "pending"

  const statusIcon = (() => {
    switch (toolCall.status) {
      case "success": return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
      case "error": return <CircleX className="size-3.5 text-red-500 shrink-0" />
      default: return <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
    }
  })()

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
      "group flex items-start gap-2 py-1 px-1.5 rounded-md transition-colors",
      "hover:bg-muted/30",
      isRunning && "bg-blue-50/50 dark:bg-blue-950/20",
    )}>
      {/* 左侧图标区 */}
      <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
        <Icon className={cn("size-3.5", category.color)} />
        {statusIcon}
      </div>

      {/* 中间内容 */}
      <div className="flex-1 min-w-0">
        {/* 第一行：工具名 + 参数摘要 */}
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "text-xs font-medium tabular-nums px-1.5 py-0 rounded",
            category.bgColor, category.color,
          )}>
            {toolCall.toolName.includes("__")
              ? toolCall.toolName.split("__").pop()
              : toolCall.toolName}
          </span>
          {paramSummary && (
            <span className="text-xs text-muted-foreground/70 truncate">
              {paramSummary}
            </span>
          )}
        </div>

        {/* 第二行：结果摘要（如果有且未展开） */}
        {!expanded && resultSummary && (
          <div className="text-[11px] text-muted-foreground/50 truncate mt-0.5">
            {resultSummary}
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
                  <pre className="text-[11px] bg-muted/20 rounded px-2 py-1 overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground/60">
                    {JSON.stringify(toolCall.params, null, 2)}
                  </pre>
                )}
                {/* 结果 */}
                {toolCall.result && (
                  <pre className={cn(
                    "text-[11px] bg-muted/20 rounded px-2 py-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-words",
                    toolCall.result.success ? "text-muted-foreground/60" : "text-red-600 dark:text-red-400",
                  )}>
                    {toolCall.result.success
                      ? (typeof toolCall.result.data === "string" ? toolCall.result.data : JSON.stringify(toolCall.result.data || toolCall.result.message, null, 2))
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
        className="shrink-0 p-0.5 rounded hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown className={cn(
          "size-3 text-muted-foreground/50 transition-transform",
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
  const Icon = group.category.icon
  const count = group.calls.length
  const hasRunning = group.calls.some(c => c.status === "running" || c.status === "pending")
  const hasError = group.calls.some(c => c.status === "error")
  const allDone = group.calls.every(c => c.status === "success" || c.status === "error")

  // 合并参数摘要
  const summaries = group.calls.map(c => extractParamSummary(c.toolName, c.params)).filter(Boolean)
  const combinedSummary = summaries.length > 2
    ? `${summaries.slice(0, 2).join(", ")} 等${summaries.length}项`
    : summaries.join(", ")

  return (
    <button
      type="button"
      className={cn(
        "group flex items-center gap-2 w-full py-1.5 px-2 rounded-md transition-colors text-left",
        "hover:bg-muted/30",
        hasRunning && "bg-blue-50/30 dark:bg-blue-950/10",
      )}
      onClick={onToggleExpand}
    >
      <Icon className={cn("size-4 shrink-0", group.category.color)} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground/80">
            {count > 1 ? `${group.category.label} ×${count}` : group.calls[0].toolName}
          </span>
          {combinedSummary && (
            <span className="text-[11px] text-muted-foreground/60 truncate">
              {combinedSummary}
            </span>
          )}
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasRunning && <Loader2 className="size-3 animate-spin text-blue-500" />}
        {hasError && <CircleX className="size-3 text-red-500" />}
        {allDone && !hasError && <CheckCircle2 className="size-3 text-green-500" />}
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {allDone ? "完成" : hasRunning ? "执行中" : ""}
        </span>
        <ChevronDown className={cn(
          "size-3 text-muted-foreground/40 transition-transform",
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
}

export function CompactToolCalls({
  toolCalls,
  isStreaming = false,
  grouped = true,
}: CompactToolCallsProps) {
  if (toolCalls.length === 0) return null

  const groups = grouped ? groupToolCalls(toolCalls) : toolCalls.map(c => ({
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
          defaultExpanded={group.calls.length === 1 || group.calls.some(c => c.status === "error")}
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
        defaultExpanded={group.calls[0].status === "error"}
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
      "w-full rounded-md border border-border/20 bg-muted/10 px-3 py-2",
      "transition-colors",
      isStreaming && "border-blue-200/50 dark:border-blue-800/30 bg-blue-50/20 dark:bg-blue-950/10",
    )}>
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {isStreaming ? (
          <Loader2 className="size-3 animate-spin text-blue-500 shrink-0" />
        ) : (
          <Brain className="size-3 text-muted-foreground/60 shrink-0" />
        )}
        <span className="text-[11px] text-muted-foreground/60">
          {isStreaming ? "思考中…" : "思考过程"}
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
  const category = categorizeTool(toolName)

  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
      "border border-border/20",
      success
        ? "bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
        : "bg-red-50/50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
    )}>
      {success ? (
        <CheckCircle2 className="size-2.5" />
      ) : (
        <CircleX className="size-2.5" />
      )}
      <span className="truncate max-w-[120px]">{toolName}</span>
      {durationMs != null && (
        <span className="text-[9px] opacity-60 tabular-nums">
          {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </span>
  )
}
