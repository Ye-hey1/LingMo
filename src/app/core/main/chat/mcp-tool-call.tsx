'use client'

import { McpToolCall } from '@/stores/chat'
import { CheckCircle2, XCircle, Loader2, ChevronDown, Wrench } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface McpToolCallCardProps {
  toolCall: McpToolCall
}

/**
 * 紧凑型 MCP 工具调用卡片
 * 
 * 设计理念（借鉴 claude-code-source Codex TUI）：
 * - 默认单行展示：图标 + 工具名 + 状态 + 耗时
 * - 点击展开查看参数和结果详情
 * - 不使用 Card 边框，融入消息流中
 */
export function McpToolCallCard({ toolCall }: McpToolCallCardProps) {
  const [expanded, setExpanded] = useState(toolCall.status === 'error')
  
  const statusIcon = (() => {
    switch (toolCall.status) {
      case 'calling':
        return <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
      case 'success':
        return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
      case 'error':
        return <XCircle className="size-3.5 text-red-500 shrink-0" />
    }
  })()

  const isRunning = toolCall.status === 'calling'

  // 参数摘要
  const paramSummary = (() => {
    const params = toolCall.params
    if (!params) return ''
    
    // 文件路径
    const path = params.filePath || params.path || params.folderPath
    if (typeof path === 'string') {
      const parts = path.replace(/\\/g, '/').split('/')
      return parts.length > 1 ? `.../${parts.slice(-2).join('/')}` : path
    }
    
    // 查询
    const query = params.query || params.pattern || params.searchQuery
    if (typeof query === 'string') {
      return query.length > 35 ? query.slice(0, 35) + '…' : query
    }
    
    // 第一个字符串值
    for (const value of Object.values(params)) {
      if (typeof value === 'string' && value.trim()) {
        return value.length > 35 ? value.slice(0, 35) + '…' : value
      }
    }
    
    return ''
  })()

  // 结果摘要
  const resultPreview = toolCall.result
    ? toolCall.result.length > 60
      ? toolCall.result.slice(0, 60).replace(/\s+/g, ' ').trim() + '…'
      : toolCall.result.replace(/\s+/g, ' ').trim()
    : null

  return (
    <div className={cn(
      "group rounded-md transition-colors",
      "hover:bg-muted/20",
      isRunning && "bg-blue-50/30 dark:bg-blue-950/10",
    )}>
      {/* 头部行 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full py-1 px-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="size-3.5 text-orange-500 shrink-0" />
        {statusIcon}
        
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 px-1 rounded">
            {toolCall.serverName}
          </span>
          <span className="text-xs font-medium text-foreground/80 truncate">
            {toolCall.toolName}
          </span>
          {paramSummary && (
            <span className="text-[11px] text-muted-foreground/60 truncate">
              {paramSummary}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {resultPreview && !expanded && (
            <span className="text-[10px] text-muted-foreground/40 truncate max-w-[120px]">
              {resultPreview}
            </span>
          )}
          <ChevronDown className={cn(
            "size-3 text-muted-foreground/40 transition-transform",
            expanded && "rotate-180",
          )} />
        </div>
      </button>

      {/* 展开内容 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="ml-6 pl-2 border-l border-border/30 space-y-1 pb-1">
              {/* 参数 */}
              {toolCall.params && Object.keys(toolCall.params).length > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground/50">参数</span>
                  <pre className="text-[11px] bg-muted/15 rounded px-2 py-1 overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground/60">
                    {JSON.stringify(toolCall.params, null, 2)}
                  </pre>
                </div>
              )}

              {/* 结果 */}
              {toolCall.result && (
                <div>
                  <span className="text-[10px] text-muted-foreground/50">结果</span>
                  <pre className={cn(
                    "text-[11px] bg-muted/15 rounded px-2 py-1 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words",
                    toolCall.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/60',
                  )}>
                    {toolCall.result}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
