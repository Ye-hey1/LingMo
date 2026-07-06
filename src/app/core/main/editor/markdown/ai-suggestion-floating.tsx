'use client'

import { Editor } from '@tiptap/react'
import { BookOpenText, Brain, Check, ChevronRight, CircleX, Clipboard, Languages, Loader2, Sparkles, X } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'

interface AISuggestionFloatingProps {
  editor: Editor
}

interface SuggestionData {
  originalText: string
  suggestedText: string
  type: string
  generatedRange?: { from: number; to: number }
  targetRange?: { from: number; to: number }
}

interface PositionData {
  position: { top: number; left: number; right: number; bottom: number }
}

function getScrollContainer(editor: Editor) {
  const root = editor.view.dom.closest('.tiptap-editor')
  return root?.querySelector('.overflow-y-auto') as HTMLElement | null
}

function calculateFloatingPosition(
  editor: Editor,
  anchorPosition: { top: number; left: number; right: number; bottom: number },
  panelWidth: number,
  panelHeight: number,
) {
  const scrollContainer = getScrollContainer(editor)

  if (!scrollContainer) {
    return { top: anchorPosition.bottom + 12, left: Math.max(12, anchorPosition.left - panelWidth / 2) }
  }

  const containerBounds = scrollContainer.getBoundingClientRect()
  const centeredLeft = scrollContainer.scrollLeft + (containerBounds.width - panelWidth) / 2
  const minLeft = scrollContainer.scrollLeft + 12
  const maxLeft = scrollContainer.scrollLeft + containerBounds.width - panelWidth - 12

  const relativeAnchorTop = anchorPosition.bottom - containerBounds.top + scrollContainer.scrollTop
  const preferredTop = relativeAnchorTop + 12
  const maxTop = scrollContainer.scrollTop + containerBounds.height - panelHeight - 12
  const minTop = scrollContainer.scrollTop + 12

  return {
    top: Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop)),
    left: Math.min(Math.max(centeredLeft, minLeft), Math.max(minLeft, maxLeft)),
  }
}

function clampRange(range: { from: number; to: number }, docSize: number) {
  const from = Math.max(0, Math.min(range.from, docSize))
  const to = Math.max(from, Math.min(range.to, docSize))
  return { from, to }
}

export function AISuggestionFloating({ editor }: AISuggestionFloatingProps) {
  const t = useTranslations('editor')
  const tCommon = useTranslations()
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingText, setThinkingText] = useState('')
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [hasCopied, setHasCopied] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const thinkingContentRef = useRef<HTMLDivElement>(null)
  const latestSuggestionRef = useRef<SuggestionData | null>(null)
  const anchorPositionRef = useRef<{ top: number; left: number; right: number; bottom: number } | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    latestSuggestionRef.current = suggestion
  }, [suggestion])

  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort()
      }
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [abortController])

  const updatePosition = useCallback(() => {
    if (!anchorPositionRef.current) {
      return
    }

    const panelWidth = panelRef.current?.offsetWidth || (latestSuggestionRef.current?.type === 'explain' ? 360 : 320)
    const panelHeight = panelRef.current?.offsetHeight || (thinkingText ? 132 : 52)
    setPosition(calculateFloatingPosition(editor, anchorPositionRef.current, panelWidth, panelHeight))
  }, [editor, thinkingText])

  const closeSuggestion = useCallback(() => {
    anchorPositionRef.current = null
    setThinkingText('')
    setIsVisible(false)
    setSuggestion(null)
    setHasCopied(false)
  }, [])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    updatePosition()
    const scrollContainer = getScrollContainer(editor)
    if (!scrollContainer) {
      return
    }

    const handleLayoutChange = () => updatePosition()
    scrollContainer.addEventListener('scroll', handleLayoutChange)
    window.addEventListener('resize', handleLayoutChange)

    return () => {
      scrollContainer.removeEventListener('scroll', handleLayoutChange)
      window.removeEventListener('resize', handleLayoutChange)
    }
  }, [editor, isVisible, updatePosition])

  useEffect(() => {
    updatePosition()
  }, [thinkingText, isThinkingExpanded, isStreaming, suggestion?.suggestedText, updatePosition])

  useEffect(() => {
    if (isStreaming && thinkingText) {
      setIsThinkingExpanded(true)
    }
  }, [isStreaming, thinkingText])

  useEffect(() => {
    if (!isStreaming || !isThinkingExpanded || !thinkingContentRef.current) {
      return
    }

    thinkingContentRef.current.scrollTop = thinkingContentRef.current.scrollHeight
  }, [isStreaming, isThinkingExpanded, thinkingText])

  useEffect(() => {
    if (!editor) return

    const handleStartStreaming = (data: {
      originalText: string
      type: string
      position: { top: number; left: number; right: number; bottom: number }
      controller?: AbortController
      targetRange?: { from: number; to: number }
    }) => {
      anchorPositionRef.current = data.position
      setSuggestion({
        originalText: data.originalText,
        suggestedText: '',
        type: data.type,
        targetRange: data.targetRange,
      })
      setThinkingText('')
      setIsThinkingExpanded(false)
      setHasCopied(false)
      setIsVisible(true)
      setIsStreaming(true)
      if (data.controller) {
        setAbortController(data.controller)
      }
    }

    const handleUpdateThinkingContent = (data: {
      thinkingText: string
      position: { top: number; left: number; right: number; bottom: number }
    }) => {
      anchorPositionRef.current = anchorPositionRef.current || data.position
      setThinkingText(data.thinkingText)
    }

    const handleUpdateContent = (data: {
      suggestedText: string
      position: { top: number; left: number; right: number; bottom: number }
    }) => {
      anchorPositionRef.current = anchorPositionRef.current
        ? {
            ...anchorPositionRef.current,
            top: data.position.top,
            bottom: data.position.bottom,
          }
        : data.position

      if (data.suggestedText) {
        setIsThinkingExpanded(false)
      }
      setSuggestion(prev => prev ? {
        ...prev,
        suggestedText: data.suggestedText,
      } : null)
    }

    const handleStreamingComplete = (data?: SuggestionData & PositionData) => {
      if (data) {
        anchorPositionRef.current = data.position
        setSuggestion({
          originalText: data.originalText,
          suggestedText: data.suggestedText,
          type: data.type,
          generatedRange: data.generatedRange,
          targetRange: data.targetRange,
        })
        setIsVisible(true)
      }

      if (!data && !latestSuggestionRef.current?.suggestedText) {
        anchorPositionRef.current = null
        setThinkingText('')
        setIsVisible(false)
        setSuggestion(null)
      }

      setIsStreaming(false)
      setAbortController(null)
    }

    const handleAbortStreaming = () => {
      if (abortController) {
        abortController.abort()
      }

      setIsStreaming(false)
      setAbortController(null)
      closeSuggestion()
    }

    const handleShowSuggestion = (data: SuggestionData & PositionData) => {
      anchorPositionRef.current = data.position
      setSuggestion({
        originalText: data.originalText,
        suggestedText: data.suggestedText,
        type: data.type,
        generatedRange: data.generatedRange,
        targetRange: data.targetRange,
      })
      setIsVisible(true)
      setIsStreaming(false)
    }

    emitter.on('start-ai-streaming', handleStartStreaming)
    emitter.on('update-ai-thinking-content', handleUpdateThinkingContent)
    emitter.on('update-ai-streaming-content', handleUpdateContent)
    emitter.on('ai-streaming-complete', handleStreamingComplete)
    emitter.on('show-ai-suggestion', handleShowSuggestion)
    emitter.on('abort-ai-streaming', handleAbortStreaming)

    return () => {
      emitter.off('start-ai-streaming', handleStartStreaming)
      emitter.off('update-ai-thinking-content', handleUpdateThinkingContent)
      emitter.off('update-ai-streaming-content', handleUpdateContent)
      emitter.off('ai-streaming-complete', handleStreamingComplete)
      emitter.off('show-ai-suggestion', handleShowSuggestion)
      emitter.off('abort-ai-streaming', handleAbortStreaming)
    }
  }, [editor, abortController, closeSuggestion])

  const handleAccept = useCallback(() => {
    const current = latestSuggestionRef.current
    if (!current) return

    if (current.targetRange && current.suggestedText.trim()) {
      const targetRange = clampRange(current.targetRange, editor.state.doc.content.size)
      editor
        .chain()
        .focus()
        .setTextSelection(targetRange)
        .deleteSelection()
        .insertContent(current.suggestedText, { contentType: 'markdown' })
        .run()
    }

    closeSuggestion()
  }, [editor, closeSuggestion])

  const handleReject = useCallback(() => {
    const current = latestSuggestionRef.current
    if (!current) return

    if (!current.targetRange && current.generatedRange) {
      editor.chain()
        .focus()
        .deleteRange(current.generatedRange)
        .insertContent(current.originalText)
        .run()
    } else if (!current.targetRange) {
      editor.chain()
        .focus()
        .deleteSelection()
        .insertContent(current.originalText)
        .run()
    }

    closeSuggestion()
  }, [editor, closeSuggestion])

  const handleAbort = useCallback(() => {
    emitter.emit('abort-ai-streaming')
  }, [])

  const typeLabels: Record<string, string> = {
    polish: t('bubbleMenu.polish'),
    concise: t('bubbleMenu.concise'),
    expand: t('bubbleMenu.expand'),
    explain: t('bubbleMenu.explain'),
    translate: t('bubbleMenu.translate'),
  }

  const showThinkingPanel = Boolean(thinkingText)
  const currentLabel = suggestion && typeLabels[suggestion.type] ? typeLabels[suggestion.type] : t('bubbleMenu.ai')
  const isExplain = suggestion?.type === 'explain'
  const isTranslate = suggestion?.type === 'translate'
  const previewText = suggestion?.suggestedText.trimStart() || ''
  const selectedText = suggestion?.originalText.trim().replace(/\s+/g, ' ') || ''
  const selectedPreview = selectedText.length > 88 ? `${selectedText.slice(0, 88)}...` : selectedText

  const handleClose = useCallback(() => {
    if (isStreaming) {
      handleAbort()
      return
    }

    closeSuggestion()
  }, [closeSuggestion, handleAbort, isStreaming])

  const handleCopy = useCallback(async () => {
    const text = previewText.trim()
    if (!text || !navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setHasCopied(true)
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setHasCopied(false)
        copyResetTimerRef.current = null
      }, 1600)
    } catch {
      setHasCopied(false)
    }
  }, [previewText])

  if (!isVisible) return null

  if (isExplain) {
    return (
      <div
        ref={panelRef}
        className="absolute z-50 w-[360px] max-w-[calc(100%-24px)] overflow-hidden rounded-xl border border-border/70 bg-background text-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        <div className="flex items-start gap-3 border-b border-border/60 px-3 py-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
            <BookOpenText className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {isStreaming ? t('aiSuggestion.explaining') : t('aiSuggestion.explainTitle')}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('aiSuggestion.selectedText')}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isStreaming ? t('aiSuggestion.abort') : t('aiSuggestion.close')}
            type="button"
          >
            {isStreaming ? <CircleX className="size-4" /> : <X className="size-4" />}
          </button>
        </div>

        {selectedPreview && (
          <div className="px-3 pt-3">
            <div className="border-l-2 border-primary/40 bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground break-words">
              {selectedPreview}
            </div>
          </div>
        )}

        <div className="px-3 py-3">
          <div className="min-h-[92px] max-h-64 overflow-y-auto text-sm leading-7 text-foreground whitespace-pre-wrap break-words">
            {previewText || (
              <span className="text-muted-foreground">
                {t('aiSuggestion.explaining')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5">
          {isStreaming ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <Sparkles className="size-4 text-primary" />
          )}
          {isStreaming && (
            <span className="flex-1 text-xs text-muted-foreground">
              {t('aiSuggestion.generating')}
            </span>
          )}
          {!isStreaming && <div className="flex-1" />}
          {!isStreaming && previewText && (
            <button
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
              title={t('aiSuggestion.copy')}
              type="button"
            >
              {hasCopied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
              <span>{hasCopied ? t('aiSuggestion.copied') : t('aiSuggestion.copy')}</span>
            </button>
          )}
          {!isStreaming && (
            <button
              onClick={closeSuggestion}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
              title={t('aiSuggestion.close')}
              type="button"
            >
              <X className="size-3.5" />
              <span>{t('aiSuggestion.close')}</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  if (isTranslate) {
    return (
      <div
        ref={panelRef}
        className="absolute z-50 w-[360px] max-w-[calc(100%-24px)] overflow-hidden rounded-xl border border-border/70 bg-background text-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        <div className="flex items-start gap-3 border-b border-border/60 px-3 py-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
            <Languages className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {isStreaming ? t('aiSuggestion.translating') : t('aiSuggestion.translateTitle')}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('aiSuggestion.selectedText')}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isStreaming ? t('aiSuggestion.abort') : t('aiSuggestion.close')}
            type="button"
          >
            {isStreaming ? <CircleX className="size-4" /> : <X className="size-4" />}
          </button>
        </div>

        {selectedPreview && (
          <div className="px-3 pt-3">
            <div className="line-clamp-2 rounded-md bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground break-words">
              {selectedPreview}
            </div>
          </div>
        )}

        <div className="px-3 py-3">
          <div className="min-h-[92px] max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm leading-7 text-foreground whitespace-pre-wrap break-words">
            {previewText || (
              <span className="text-muted-foreground">
                {t('aiSuggestion.translating')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5">
          {isStreaming ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="flex-1 text-xs text-muted-foreground">
                {t('aiSuggestion.generating')}
              </span>
            </>
          ) : (
            <>
              <div className="flex-1" />
              {previewText && (
                <button
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
                  title={t('aiSuggestion.copy')}
                  type="button"
                >
                  {hasCopied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
                  <span>{hasCopied ? t('aiSuggestion.copied') : t('aiSuggestion.copy')}</span>
                </button>
              )}
              {previewText && (
                <button
                  onClick={handleAccept}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
                  title={t('aiSuggestion.replaceOriginal')}
                  type="button"
                >
                  <Check className="size-3.5" />
                  <span>{t('aiSuggestion.replaceOriginal')}</span>
                </button>
              )}
              <button
                onClick={closeSuggestion}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
                title={t('aiSuggestion.close')}
                type="button"
              >
                <X className="size-3.5" />
                <span>{t('aiSuggestion.close')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[320px] max-w-[calc(100%-24px)] rounded-xl border border-border/60 bg-background/96 text-foreground shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {showThinkingPanel && (
        <div className="border-b border-border/60">
          <button
            type="button"
            onClick={() => setIsThinkingExpanded(prev => !prev)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin text-blue-500" />
            ) : (
              <Brain className="size-4 text-blue-500" />
            )}
            <span className="flex-1 text-sm text-muted-foreground">
              {tCommon('ai.thinking')}
            </span>
            <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
          </button>

          {isThinkingExpanded && (
            <div
              ref={thinkingContentRef}
              className="max-h-36 overflow-y-auto px-3 pb-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words"
            >
              {thinkingText}
            </div>
          )}
        </div>
      )}

      <div className="border-b border-border/60 px-3 py-2.5">
        <div className="max-h-56 overflow-y-auto rounded-md bg-muted/35 px-3 py-2 text-sm leading-6 text-foreground whitespace-pre-wrap break-words">
          {previewText || (
            <span className="text-muted-foreground">
              {isStreaming ? t('aiSuggestion.generating') : currentLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5">
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <span className="flex-1 text-sm font-medium">
          {isStreaming ? t('aiSuggestion.generating') : currentLabel}
        </span>
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="rounded-md p-1 transition-colors hover:bg-muted"
            title={t('aiSuggestion.abort')}
            type="button"
          >
            <CircleX className="size-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={handleAccept}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={t('aiSuggestion.accept')}
              type="button"
            >
              <Check className="size-4" />
            </button>
            <button
              onClick={handleReject}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={t('aiSuggestion.reject')}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AISuggestionFloating
