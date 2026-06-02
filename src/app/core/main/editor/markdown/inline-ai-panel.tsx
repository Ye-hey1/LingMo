'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Editor } from '@tiptap/react'
import { Sparkles, Loader2, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchCompletionStream } from '@/lib/ai/completion'
import { fetchAiPolishStream, fetchAiConciseStream, fetchAiExpandStream } from '@/lib/ai/rewrite'
import { getAISettings, prepareMessages, createOpenAIClient, validateAIService } from '@/lib/ai/utils'
import { createAiStreamContentProcessor } from '@/lib/ai/sanitize'

interface InlineAIPanelProps {
  editor: Editor
  isOpen: boolean
  onClose: () => void
  onDiffSessionStart: (originalText: string, newText: string, from: number, to: number) => void
}

// 自由指令流式接口实现
async function fetchAiCustomInstructionStream(
  instruction: string,
  context: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const aiConfig = await getAISettings('primaryModel')
  if (!aiConfig || (await validateAIService(aiConfig.baseURL)) === null) {
    throw new Error('AI 服务未配置')
  }

  const prompt = `You are a helpful writing assistant. Please process the following text according to the user's instructions.
Instruction: ${instruction}

Never output any thinking, reasoning, analysis, or <think> tags. Output ONLY the final processed text, no explanations, no wrappers.

Input:
${context}

Processed Output:`

  const { messages } = await prepareMessages(prompt)
  const openai = await createOpenAIClient(aiConfig)
  const processor = createAiStreamContentProcessor()

  const stream = await openai.chat.completions.create(
    {
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    },
    { signal: abortSignal }
  )

  let isFirst = true
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      const processed = processor.push(content)
      if (processed.content) {
        onChunk(processed.content, isFirst)
        isFirst = false
      }
    }
  }

  const remaining = processor.flush()
  if (remaining.content) {
    onChunk(remaining.content, isFirst)
  }
}

export function InlineAIPanel({ editor, isOpen, onClose, onDiffSessionStart }: InlineAIPanelProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [hasSelection, setHasSelection] = useState(false)

  // 更新面板的物理坐标位置（对齐编辑器光标）
  const updatePosition = useCallback(() => {
    if (!editor || !editor.view) return

    try {
      const { selection } = editor.state
      const startCoords = editor.view.coordsAtPos(selection.from)
      const scrollContainer = editor.view.dom.closest('.overflow-y-auto') as HTMLElement | null

      if (!scrollContainer) {
        setCoords({
          top: startCoords.bottom + 8,
          left: startCoords.left,
        })
        return
      }

      const containerBounds = scrollContainer.getBoundingClientRect()
      const panelHeight = panelRef.current?.offsetHeight || 135
      const panelWidth = panelRef.current?.offsetWidth || 340

      // 计算相对于 scrollContainer 的坐标，并防止超出视口边界
      let top = startCoords.bottom - containerBounds.top + scrollContainer.scrollTop + 8
      const left = startCoords.left - containerBounds.left + scrollContainer.scrollLeft - panelWidth / 2

      // 防遮挡检测：如果下方空间不足，则弹在光标上方
      if (top + panelHeight > scrollContainer.scrollTop + containerBounds.height - 20) {
        top = startCoords.top - containerBounds.top + scrollContainer.scrollTop - panelHeight - 8
      }

      setCoords({
        top: Math.max(scrollContainer.scrollTop + 8, top),
        left: Math.max(scrollContainer.scrollLeft + 12, Math.min(scrollContainer.scrollLeft + containerBounds.width - panelWidth - 12, left)),
      })
    } catch {
      // 边界处理
    }
  }, [editor])

  useEffect(() => {
    if (!isOpen) return

    // 检查当前是否有文字选区
    const { from, to } = editor.state.selection
    setHasSelection(to - from > 0)

    updatePosition()
    const scrollContainer = editor.view.dom.closest('.overflow-y-auto')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updatePosition)
    }
    window.addEventListener('resize', updatePosition)

    // 自动聚焦输入框
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', updatePosition)
      }
      window.removeEventListener('resize', updatePosition)
      cancelAnimationFrame(raf)
    }
  }, [editor, isOpen, updatePosition])

  // 监听点击外部关闭面板
  useEffect(() => {
    if (!isOpen) return

    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (!isLoading) {
          onClose()
        }
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen, onClose, isLoading])

  // 执行 AI 任务函数
  const handleExecuteAI = useCallback(async (type: 'polish' | 'concise' | 'expand' | 'continue' | 'custom', customInstruction = '') => {
    if (isLoading) return
    setIsLoading(true)

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)
    
    const contextStart = Math.max(0, from - 600)
    const textBefore = editor.state.doc.textBetween(contextStart, from)

    let accumulatedText = ''
    const insertionStart = from

    const removeGeneratedText = () => {
      if (!accumulatedText) return

      editor.chain()
        .focus()
        .deleteRange({ from: insertionStart, to: insertionStart + accumulatedText.length })
        .run()
    }

    // 流式渲染输出回调
    const handleChunk = (chunk: string) => {
      accumulatedText += chunk
      
      // 如果是空行续写，直接流式插入编辑器
      if (!hasSelection) {
        editor.commands.insertContent(chunk)
      }
    }

    try {
      if (hasSelection) {
        // 选区改写模式：完成后展示 Diff Review UI
        if (type === 'polish') {
          await fetchAiPolishStream(selectedText, handleChunk, controller.signal)
        } else if (type === 'concise') {
          await fetchAiConciseStream(selectedText, handleChunk, controller.signal)
        } else if (type === 'expand') {
          await fetchAiExpandStream(selectedText, handleChunk, controller.signal)
        } else if (type === 'custom') {
          await fetchAiCustomInstructionStream(customInstruction, selectedText, handleChunk, controller.signal)
        } else {
          // 续写
          await fetchCompletionStream(selectedText || textBefore, handleChunk, controller.signal)
        }

        // 流式完成后，触发原地对比
        if (accumulatedText && accumulatedText.trim() !== selectedText.trim()) {
          // 先替换内容，然后通知 parent 开启 Diff 模式
          editor.chain().focus().insertContentAt({ from, to }, accumulatedText).run()
          onDiffSessionStart(selectedText, accumulatedText, from, editor.state.selection.from)
        }
      } else {
        // 1. 空行生成/续写模式：流式一边写一边插入
        if (type === 'custom') {
          await fetchAiCustomInstructionStream(customInstruction, textBefore, handleChunk, controller.signal)
        } else {
          await fetchCompletionStream(textBefore, handleChunk, controller.signal)
        }
      }
      
      onClose()
    } catch (error: unknown) {
      if (!hasSelection) {
        removeGeneratedText()
      }

      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('[Inline AI] Error:', error)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [editor, hasSelection, isLoading, onClose, onDiffSessionStart])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      handleExecuteAI(hasSelection ? 'custom' : 'custom', inputValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!isOpen || !coords) return null

  const quickActions = hasSelection
    ? [
        { label: '✨ 润色改写', type: 'polish' as const },
        { label: '📝 更加精炼', type: 'concise' as const },
        { label: '📖 拓展丰富', type: 'expand' as const },
      ]
    : [
        { label: '✍️ 继续往下写', type: 'continue' as const },
      ]

  const element = (
    <div
      ref={panelRef}
      className={cn(
        "absolute z-50 w-[320px] max-w-[calc(100%-24px)] p-3 rounded-xl border border-border/60 bg-background/96 shadow-2xl backdrop-blur-md",
        "animate-in fade-in slide-in-from-bottom-2 duration-150"
      )}
      style={{
        top: coords.top,
        left: coords.left,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles size={14} className="text-primary animate-pulse" />
        <span className="text-xs font-semibold text-muted-foreground">
          {hasSelection ? 'AI 原地改写选区' : 'AI 原地灵感生成'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 bg-muted/50 border border-border/80 rounded-lg p-1">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasSelection ? "输入修改指令，如：翻译成优美的英文..." : "输入生成指令，或直接选择快捷续写..."}
          disabled={isLoading}
          className="flex-1 px-2 py-1 text-sm bg-transparent outline-none border-none placeholder:text-muted-foreground/70"
        />
        <button
          onClick={() => inputValue.trim() && handleExecuteAI('custom', inputValue)}
          disabled={isLoading || !inputValue.trim()}
          className="flex items-center justify-center w-7 h-7 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-40"
        >
          {isLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CornerDownLeft size={13} />
          )}
        </button>
      </div>

      {/* 快捷选项 */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {quickActions.map((act) => (
          <button
            key={act.label}
            onClick={() => handleExecuteAI(act.type)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground rounded-full border border-border/40 transition-all active:scale-95 disabled:opacity-50"
            type="button"
          >
            {act.label}
          </button>
        ))}
      </div>
    </div>
  )

  const container = editor.view.dom.closest('.tiptap-editor') || document.body
  return createPortal(element, container)
}
