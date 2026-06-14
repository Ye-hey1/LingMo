'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Editor } from '@tiptap/react'
import { Sparkles, Loader2, CornerDownLeft, Maximize2, Minimize2, WandSparkles, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { fetchWritingContinuationStream } from '@/lib/ai/completion'
import { buildCompletionContext } from '@/lib/ai/completion-context'
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
  const t = useTranslations('editor.inlineAI')
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
      const anchorPos = selection.empty ? selection.from : selection.to
      const cursorCoords = editor.view.coordsAtPos(anchorPos)
      const panelHeight = panelRef.current?.offsetHeight || 260
      const panelWidth = panelRef.current?.offsetWidth || 384
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const margin = 12
      const gap = 8

      let top = cursorCoords.bottom + gap
      const maxTop = Math.max(margin, viewportHeight - panelHeight - margin)

      if (top > maxTop) {
        top = Math.max(margin, cursorCoords.top - panelHeight - gap)
      }

      const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin)
      const left = Math.max(margin, Math.min(maxLeft, cursorCoords.left))

      setCoords({
        top,
        left,
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
    
    const richContext = buildCompletionContext(editor.state.doc, from, {
      beforeChars: 1800,
      afterChars: 600,
    })
    const textBefore = richContext.textBefore

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
          await fetchWritingContinuationStream(selectedText || textBefore, handleChunk, controller.signal, richContext)
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
          await fetchWritingContinuationStream(textBefore, handleChunk, controller.signal, richContext)
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

  const handleClose = useCallback(() => {
    if (isLoading) {
      abortControllerRef.current?.abort()
    }
    onClose()
  }, [isLoading, onClose])

  if (!isOpen || !coords) return null

  const shortcutLabel = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? '⌘ J'
    : 'Ctrl J'
  const modeTitle = hasSelection ? t('rewriteTitle') : t('generateTitle')
  const modeDescription = hasSelection ? t('rewriteDescription') : t('generateDescription')
  const inputPlaceholder = hasSelection ? t('rewritePlaceholder') : t('generatePlaceholder')

  const quickActions = hasSelection
    ? [
        {
          label: t('polish'),
          description: t('polishDesc'),
          icon: <WandSparkles className="size-4" />,
          type: 'polish' as const,
        },
        {
          label: t('concise'),
          description: t('conciseDesc'),
          icon: <Minimize2 className="size-4" />,
          type: 'concise' as const,
        },
        {
          label: t('expand'),
          description: t('expandDesc'),
          icon: <Maximize2 className="size-4" />,
          type: 'expand' as const,
        },
      ]
    : [
        {
          label: t('continue'),
          description: t('continueDesc'),
          icon: <Sparkles className="size-4" />,
          type: 'continue' as const,
        },
      ]

  const element = (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-50 w-[384px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-border/30",
        "animate-in fade-in slide-in-from-bottom-2 duration-150"
      )}
      style={{
        top: coords.top,
        left: coords.left,
      }}
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {isLoading ? t('generatingTitle') : modeTitle}
            </h3>
            <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              {shortcutLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{modeDescription}</p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t('close')}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-1.5 transition-colors focus-within:border-primary/45 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/10">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            disabled={isLoading}
            className="h-8 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={() => inputValue.trim() && handleExecuteAI('custom', inputValue)}
            disabled={isLoading || !inputValue.trim()}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <CornerDownLeft className="size-3.5" />}
            <span>{isLoading ? t('generating') : t('generate')}</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {quickActions.map((act) => (
            <button
              key={act.label}
              onClick={() => handleExecuteAI(act.type)}
              disabled={isLoading}
              className="group flex w-full items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                {act.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{act.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{act.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return createPortal(element, document.body)
}
