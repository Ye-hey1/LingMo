'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { History, RotateCcw, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { getNoteHistoriesByNotePath, getNoteHistoryById, NoteHistory } from '@/db/history'
import { diffWordsWithSpace } from 'diff'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'

interface LocalHistoryTimelineProps {
  editor: Editor
  isOpen: boolean
  onClose: () => void
}

export function LocalHistoryTimeline({ editor, isOpen, onClose }: LocalHistoryTimelineProps) {
  const [histories, setHistories] = useState<NoteHistory[]>([])
  const [selectedHistory, setSelectedHistory] = useState<NoteHistory | null>(null)
  const [diffParts, setDiffParts] = useState<{ value: string; added?: boolean; removed?: boolean }[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const activeFilePath = useArticleStore((state) => state.activeFilePath)

  // 1. 加载所有历史快照
  const loadHistories = useCallback(async () => {
    if (!activeFilePath) return
    try {
      const list = await getNoteHistoriesByNotePath(activeFilePath)
      setHistories(list)
    } catch (e) {
      console.error('[History Timeline] Failed to load:', e)
    }
  }, [activeFilePath])

  useEffect(() => {
    if (isOpen) {
      loadHistories()
      setSelectedHistory(null)
      setDiffParts([])
      setExpandedId(null)
    }
  }, [isOpen, loadHistories])

  // 格式化时间戳为相对时间描述
  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const secs = Math.floor(diff / 1000)
    const mins = Math.floor(secs / 60)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)

    if (secs < 60) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    if (hours < 24) return `${hours} 小时前`
    if (days < 30) return `${days} 天前`
    return new Date(timestamp).toLocaleDateString()
  }

  // 2. 点击快照拉取其内容并计算与当前编辑器文本的差异
  const handleViewDiff = async (history: NoteHistory) => {
    if (expandedId === history.id) {
      setExpandedId(null)
      setSelectedHistory(null)
      setDiffParts([])
      return
    }

    try {
      const fullHistory = await getNoteHistoryById(history.id)
      if (!fullHistory) return

      setSelectedHistory(fullHistory)
      setExpandedId(history.id)

      const currentText = editor.getMarkdown()
      // 计算历史版本与当前版本的 Diff 差异
      const diffResult = diffWordsWithSpace(fullHistory.content, currentText)
      setDiffParts(diffResult)
    } catch {
      toast({
        title: '对比失败',
        variant: 'destructive'
      })
    }
  }

  // 3. 一键还原到指定历史快照版本
  const handleRestore = async (history: NoteHistory) => {
    try {
      const fullHistory = await getNoteHistoryById(history.id)
      if (!fullHistory) return

      // 执行编辑器覆盖插入
      editor.chain().focus().setContent(fullHistory.content, { emitUpdate: true }).run()
      
      toast({
        title: '还原成功',
        description: `已成功还原至 ${new Date(history.createdAt).toLocaleString()} 的快照版本。`
      })
      onClose()
    } catch {
      toast({
        title: '还原失败',
        variant: 'destructive'
      })
    }
  }

  if (!isOpen) return null

  return (
    <div className="absolute inset-y-0 right-0 z-50 w-80 bg-background/96 border-l border-border shadow-2xl backdrop-blur-md flex flex-col animate-in slide-in-from-right duration-200">
      
      {/* 头部面板 */}
      <div className="flex h-12 shrink-0 items-center justify-between px-4 border-b border-border/40">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <History className="size-4 text-primary animate-pulse" />
          <span>本地历史时光机</span>
        </div>
        <button 
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted p-1 rounded-md transition-colors"
          type="button"
        >
          关闭
        </button>
      </div>

      {/* 快照列表时间轴 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 outline-panel-scroll">
        {histories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-xs text-muted-foreground space-y-2">
            <Calendar size={18} className="text-muted-foreground/50" />
            <span>该笔记尚无保存的历史快照</span>
          </div>
        ) : (
          histories.map((history) => {
            const isExpanded = expandedId === history.id

            return (
              <div 
                key={history.id}
                className={cn(
                  "p-3 rounded-xl border border-border/60 transition-all duration-300 relative bg-card",
                  isExpanded ? "ring-1 ring-primary/40 shadow-md" : "hover:bg-accent/25 hover:border-border"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <span className="text-[12px] font-semibold text-foreground">
                      {formatRelativeTime(history.createdAt)}
                    </span>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(history.createdAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleViewDiff(history)}
                      className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="对比差异"
                      type="button"
                    >
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                      onClick={() => handleRestore(history)}
                      className="p-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-all active:scale-90"
                      title="还原到此快照"
                      type="button"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                {/* 可折叠的 Diff 差异显示 */}
                {isExpanded && selectedHistory && (
                  <div className="mt-3.5 pt-3 border-t border-border/40 text-[11px] leading-relaxed max-h-48 overflow-y-auto font-mono whitespace-pre-wrap rounded bg-muted/30 p-2 border">
                    {diffParts.length === 0 ? (
                      <span className="text-muted-foreground italic">版本间无任何内容差异</span>
                    ) : (
                      diffParts.map((part, i) => {
                        if (part.added) {
                          return (
                            <span key={i} className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-[2px] rounded-sm">
                              {part.value}
                            </span>
                          )
                        }
                        if (part.removed) {
                          return (
                            <span key={i} className="bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 line-through px-[2px] rounded-sm">
                              {part.value}
                            </span>
                          )
                        }
                        return <span key={i} className="text-muted-foreground opacity-80">{part.value}</span>
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
