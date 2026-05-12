'use client'

import '@excalidraw/excalidraw/index.css'
import './diagram-canvas.css'

import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import { Loader2, MessageSquareQuote } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createEmptyDiagramContent } from '@/lib/diagram'
import { readDiagramFileContent, saveDiagramFileContent } from '@/lib/diagram-file-content'
import emitter from '@/lib/emitter'

interface DiagramCanvasProps {
  filePath: string
  isActive?: boolean
}

const SAVE_DEBOUNCE_MS = 700
type ExcalidrawModule = typeof import('@excalidraw/excalidraw')
const EXCALIDRAW_TEXT_REPLACEMENTS: Record<string, string> = {
  Settings: '设置',
  Help: '帮助',
  'Find on canvas': '在画布中查找',
  'Excalidraw links': 'Excalidraw 链接',
  'Follow us': '关注我们',
  'Discord chat': 'Discord 聊天',
  'Canvas background': '画布背景',
  'Export image': '导出图片',
  'Export image...': '导出图片...',
  'Export image…': '导出图片...',
  'Save to...': '保存到...',
  'Save to…': '保存到...',
  'Load from...': '从文件加载...',
  'Load from…': '从文件加载...',
  'Clear canvas': '清空画布',
  'Reset the canvas': '重置画布',
  'Toggle theme': '切换主题',
  'Dark mode': '深色模式',
  'Light mode': '浅色模式',
  'Live collaboration...': '实时协作...',
  'Command palette': '命令面板',
  'Search menus': '搜索菜单',
  'Stats for nerds': '详细统计',
  'Keyboard shortcuts': '键盘快捷键',
  'Frame tool': '框架工具',
  'Web Embed': '网页嵌入',
  'Laser pointer': '激光笔',
  Generate: '生成',
  'Mermaid to Excalidraw': 'Mermaid 转 Excalidraw',
}

const EXCALIDRAW_ATTRIBUTE_NAMES = ['aria-label', 'title', 'placeholder'] as const

function localizeExcalidrawEnglishLabels(root: HTMLElement | null) {
  if (!root) {
    return
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    const text = node.textContent?.trim()
    if (text && EXCALIDRAW_TEXT_REPLACEMENTS[text]) {
      node.textContent = node.textContent?.replace(text, EXCALIDRAW_TEXT_REPLACEMENTS[text]) ?? null
    }
    node = walker.nextNode()
  }

  root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]').forEach((element) => {
    EXCALIDRAW_ATTRIBUTE_NAMES.forEach((attributeName) => {
      const value = element.getAttribute(attributeName)?.trim()
      if (value && EXCALIDRAW_TEXT_REPLACEMENTS[value]) {
        element.setAttribute(attributeName, EXCALIDRAW_TEXT_REPLACEMENTS[value])
      }
    })
  })
}

function createInitialScene(excalidraw: ExcalidrawModule): ExcalidrawInitialDataState {
  const { restore } = excalidraw
  const restored = restore(JSON.parse(createEmptyDiagramContent()), null, null)

  return {
    elements: restored.elements,
    appState: restored.appState,
    files: restored.files,
  }
}

function localizeExcalidrawLabels() {
  localizeExcalidrawEnglishLabels(canvasHostRefSafe())
  localizeExcalidrawEnglishLabels(document.body)
}

function canvasHostRefSafe() {
  return document.querySelector<HTMLElement>('[data-diagram-canvas-host="true"]')
}

function parseDiagramContent(content: string, excalidraw: ExcalidrawModule): ExcalidrawInitialDataState {
  const { restore } = excalidraw
  const raw = content.trim() ? content : createEmptyDiagramContent()
  const restored = restore(JSON.parse(raw), null, null)

  return {
    elements: restored.elements,
    appState: restored.appState,
    files: restored.files,
  }
}

export function DiagramCanvas({ filePath, isActive = true }: DiagramCanvasProps) {
  const [excalidraw, setExcalidraw] = useState<ExcalidrawModule | null>(null)
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const lastSavedRef = useRef('')
  const latestSerializedRef = useRef('')
  const canvasHostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true

    void import('@excalidraw/excalidraw').then((mod) => {
      if (mounted) {
        setExcalidraw(mod)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!excalidraw) {
      return
    }

    const excalidrawModule = excalidraw
    let cancelled = false

    async function loadDiagram() {
      setLoading(true)
      try {
        const content = await readDiagramFileContent(filePath)
        if (cancelled) return

        const parsed = parseDiagramContent(content, excalidrawModule)
        const serialized = excalidrawModule.serializeAsJSON(parsed.elements || [], parsed.appState || {}, parsed.files || {}, 'local')
        lastSavedRef.current = serialized
        latestSerializedRef.current = serialized
        setInitialData(parsed)
        setError(null)
      } catch (err) {
        if (cancelled) return

        const fallback = createInitialScene(excalidrawModule)
        const serialized = excalidrawModule.serializeAsJSON(fallback.elements || [], fallback.appState || {}, fallback.files || {}, 'local')
        lastSavedRef.current = serialized
        latestSerializedRef.current = serialized
        setInitialData(fallback)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadDiagram()

    return () => {
      cancelled = true
    }
  }, [excalidraw, filePath])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      return
    }

    document.body.classList.add('diagram-editor-active')
    localizeExcalidrawLabels()
    const observer = new MutationObserver(localizeExcalidrawLabels)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })

    return () => {
      observer.disconnect()
      document.body.classList.remove('diagram-editor-active')
    }
  }, [excalidraw, isActive])

  const scheduleSave = useCallback(
    (serialized: string) => {
      if (serialized === lastSavedRef.current) {
        return
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = window.setTimeout(() => {
        lastSavedRef.current = serialized
        latestSerializedRef.current = serialized
        void saveDiagramFileContent(filePath, serialized)
      }, SAVE_DEBOUNCE_MS)
    },
    [filePath],
  )

  const handleSendToAI = useCallback(() => {
    let summary = '空白图表'
    try {
      const parsed = JSON.parse(latestSerializedRef.current || createEmptyDiagramContent())
      const elements = Array.isArray(parsed.elements) ? parsed.elements : []
      const typeCounts = elements.reduce((counts: Record<string, number>, element: { type?: string }) => {
        const type = element.type || 'unknown'
        counts[type] = (counts[type] || 0) + 1
        return counts
      }, {})
      summary = [
        `文件：${filePath}`,
        `元素数量：${elements.length}`,
        `元素类型：${Object.entries(typeCounts).map(([type, count]) => `${type}:${count}`).join(', ') || '无'}`,
      ].join('\n')
    } catch {
      summary = `文件：${filePath}\n图表 JSON 暂时无法解析。`
    }

    emitter.emit('insert-quote', {
      quote: summary,
      fullContent: latestSerializedRef.current || createEmptyDiagramContent(filePath),
      fileName: filePath.split('/').pop() || filePath,
      startLine: 1,
      endLine: 1,
      from: 0,
      to: 0,
      articlePath: filePath,
    })
    emitter.emit('diagramSelected', {
      name: filePath.split('/').pop() || filePath,
      path: filePath,
      relativePath: filePath,
    })
  }, [filePath])

  if (loading || !excalidraw || !initialData) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载图表...
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3 text-sm">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">图表</span>
        <button
          type="button"
          onClick={handleSendToAI}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          <MessageSquareQuote className="size-3.5" />
          发送到 AI
        </button>
      </div>
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          图表文件解析失败，已打开空白画布：{error}
        </div>
      ) : null}
      <div ref={canvasHostRef} data-diagram-canvas-host="true" className="min-h-0 flex-1">
        {(() => {
          const Excalidraw = excalidraw.Excalidraw
          return (
            <Excalidraw
              key={filePath}
              langCode="zh-CN"
              initialData={initialData}
              onChange={(elements, appState, files) => {
                const serialized = excalidraw.serializeAsJSON(elements, appState, files, 'local')
                scheduleSave(serialized)
              }}
            />
          )
        })()}
      </div>
    </div>
  )
}

