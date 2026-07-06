'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from 'codemirror'
import {
  AlignLeft,
  Activity,
  ArrowRightLeft,
  Calendar,
  Code,
  Columns,
  Copy,
  Database,
  Download,
  Eye,
  FileChartColumn,
  GitBranch,
  Layers,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTheme } from 'next-themes'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HtmlCodeEditor } from '../html/html-code-editor'
import { FileCreatedAt } from '../markdown/footer-bar/file-created-at'
import { HistorySheet } from '../markdown/sync/history-sheet'
import { SyncButton } from '../markdown/sync/sync-button'
import useArticleStore from '@/stores/article'
import { getMermaidRenderer } from '@/lib/mermaid'
import { copyTextToClipboard, saveBlobAs } from '@/lib/output-workshop/export'
import { recordFileActivity } from '@/lib/file-activity'
import { toast } from '@/hooks/use-toast'

import './mermaid-editor.css'

// ─── Types ──────────────────────────────────────────────────────────────────

type MermaidEditorMode = 'preview' | 'split' | 'code'
const modeMapRef: Record<string, MermaidEditorMode> = {}
const DEFAULT_MERMAID_EDITOR_MODE: MermaidEditorMode = 'preview'

interface MermaidEditorProps {
  filePath: string
  tabContentsRef: React.RefObject<Record<string, string>>
}

// ─── Constants ──────────────────────────────────────────────────────────────

const editorModeOptions = [
  { value: 'preview' as const, label: '预览', icon: Eye },
  { value: 'split' as const, label: '分屏', icon: Columns },
  { value: 'code' as const, label: '代码', icon: Code },
]

const MERMAID_TEMPLATES = [
  {
    type: 'flowchart',
    label: '流程图',
    description: '流程与决策',
    icon: GitBranch,
    code: 'flowchart TD\n  A[开始] --> B{条件判断}\n  B -- 是 --> C[执行操作]\n  B -- 否 --> D[其他处理]\n  C --> E[结束]\n  D --> E',
  },
  {
    type: 'sequence',
    label: '时序图',
    description: '交互与时序',
    icon: ArrowRightLeft,
    code: 'sequenceDiagram\n  participant A as 用户\n  participant B as 服务器\n  participant C as 数据库\n  A->>B: 发送请求\n  B->>C: 查询数据\n  C-->>B: 返回结果\n  B-->>A: 响应数据',
  },
  {
    type: 'classDiagram',
    label: '类图',
    description: '结构与继承',
    icon: Layers,
    code: 'classDiagram\n  class Animal {\n    +String name\n    +int age\n    +makeSound()\n  }\n  class Dog {\n    +fetch()\n  }\n  Animal <|-- Dog',
  },
  {
    type: 'stateDiagram',
    label: '状态图',
    description: '状态与变迁',
    icon: Activity,
    code: 'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 进行中: 开始\n  进行中 --> 已完成: 完成\n  进行中 --> 已暂停: 暂停\n  已暂停 --> 进行中: 恢复\n  已完成 --> [*]',
  },
  {
    type: 'gantt',
    label: '甘特图',
    description: '计划与排期',
    icon: Calendar,
    code: 'gantt\n  title 项目计划\n  dateFormat  YYYY-MM-DD\n  section 阶段一\n  需求分析     :a1, 2024-01-01, 10d\n  系统设计     :a2, after a1, 8d\n  section 阶段二\n  编码开发     :a3, after a2, 20d\n  测试验收     :a4, after a3, 10d',
  },
  {
    type: 'er',
    label: 'ER 图',
    description: '实体与关系',
    icon: Database,
    code: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }\n  ORDER {\n    int id\n    date created\n  }',
  },
]

const MIN_SCALE = 0.35
const MAX_SCALE = 3
const SCALE_STEP = 0.12
const VIEWER_MIN_SCALE = 0.2
const VIEWER_MAX_SCALE = 10
const VIEWER_SCALE_STEP = 0.25
const VIEWER_HEADER_HEIGHT = 42
const VIEWER_CONTENT_PADDING = 48
const VIEWER_SVG_CROP_PADDING = 28

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMermaidCode(code: string) {
  return code
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clampScale(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))))
}

function parseSvgLength(value: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSvgIntrinsicSize(svgMarkup: string) {
  if (typeof DOMParser === 'undefined') {
    return null
  }

  try {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
    const svgElement = doc.querySelector('svg')
    if (!svgElement) return null

    const width = parseSvgLength(svgElement.getAttribute('width'))
    const height = parseSvgLength(svgElement.getAttribute('height'))
    if (width && height) {
      return { width, height }
    }

    const viewBox = svgElement.getAttribute('viewBox')
    const values = viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))

    if (values && values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
      return { width: values[2], height: values[3] }
    }
  } catch {
    return null
  }

  return null
}

function getInitialViewerScale(svgMarkup: string) {
  if (typeof window === 'undefined') return 1

  const size = getSvgIntrinsicSize(svgMarkup)
  if (!size) return 1.8

  const availableWidth = Math.max(320, window.innerWidth * 0.92)
  const availableHeight = Math.max(240, (window.innerHeight - VIEWER_HEADER_HEIGHT) * 0.9)
  const contentWidth = size.width + VIEWER_CONTENT_PADDING
  const contentHeight = size.height + VIEWER_CONTENT_PADDING
  const fitScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)

  return clampScale(Math.max(1, fitScale), VIEWER_MIN_SCALE, VIEWER_MAX_SCALE)
}

function getScaleForVisibleSize(width: number, height: number) {
  if (typeof window === 'undefined' || width <= 0 || height <= 0) {
    return null
  }

  const availableWidth = Math.max(320, window.innerWidth * 0.94)
  const availableHeight = Math.max(240, (window.innerHeight - VIEWER_HEADER_HEIGHT) * 0.9)
  const fitScale = Math.min(
    availableWidth / (width + VIEWER_CONTENT_PADDING),
    availableHeight / (height + VIEWER_CONTENT_PADDING),
  )

  return clampScale(Math.max(1, fitScale), VIEWER_MIN_SCALE, VIEWER_MAX_SCALE)
}

type SvgBounds = {
  x: number
  y: number
  width: number
  height: number
}

function isValidSvgBounds(bounds: SvgBounds | DOMRect) {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

function mergeSvgBounds(current: SvgBounds | null, next: SvgBounds | DOMRect) {
  if (!isValidSvgBounds(next)) {
    return current
  }

  if (!current) {
    return {
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    }
  }

  const x1 = Math.min(current.x, next.x)
  const y1 = Math.min(current.y, next.y)
  const x2 = Math.max(current.x + current.width, next.x + next.width)
  const y2 = Math.max(current.y + current.height, next.y + next.height)

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  }
}

function readSvgGraphicsBounds(element: Element) {
  if (!(element instanceof SVGGraphicsElement)) {
    return null
  }

  try {
    const box = element.getBBox()
    return isValidSvgBounds(box) ? box : null
  } catch {
    return null
  }
}

function getVisibleSvgBounds(svgElement: SVGSVGElement) {
  const ignoredTags = new Set(['style', 'defs', 'title', 'desc', 'metadata'])
  const directGraphics = Array.from(svgElement.children).filter((child) => (
    child instanceof SVGGraphicsElement &&
    !ignoredTags.has(child.tagName.toLowerCase())
  ))

  let bounds = directGraphics.reduce<SvgBounds | null>(
    (current, child) => {
      const next = readSvgGraphicsBounds(child)
      return next ? mergeSvgBounds(current, next) : current
    },
    null,
  )

  if (bounds) {
    return bounds
  }

  const graphics = svgElement.querySelectorAll('g,path,rect,circle,ellipse,line,polyline,polygon,text,foreignObject,use')
  bounds = Array.from(graphics).reduce<SvgBounds | null>(
    (current, child) => {
      const next = readSvgGraphicsBounds(child)
      return next ? mergeSvgBounds(current, next) : current
    },
    null,
  )

  return bounds
}

function fitSvgToVisibleContent(container: HTMLElement | null) {
  const svgElement = container?.querySelector('svg')
  if (!svgElement) {
    return null
  }

  try {
    const bbox = getVisibleSvgBounds(svgElement)
    if (!bbox) {
      return null
    }

    const x = bbox.x - VIEWER_SVG_CROP_PADDING
    const y = bbox.y - VIEWER_SVG_CROP_PADDING
    const width = bbox.width + VIEWER_SVG_CROP_PADDING * 2
    const height = bbox.height + VIEWER_SVG_CROP_PADDING * 2

    svgElement.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
    svgElement.setAttribute('width', String(width))
    svgElement.setAttribute('height', String(height))
    svgElement.style.maxWidth = 'none'
    svgElement.style.height = 'auto'

    return getScaleForVisibleSize(width, height)
  } catch {
    return null
  }
}

// ─── Drag tracking type ────────────────────────────────────────────────────

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

// ─── MermaidPreview ─────────────────────────────────────────────────────────

function MermaidPreview({
  code,
  autoSync,
  refreshTrigger,
  onSyncStatusChange,
  onSvgChange,
  onOpenFullscreen,
  onTemplateSelect,
}: {
  code: string
  autoSync: boolean
  refreshTrigger: number
  onSyncStatusChange?: (status: 'synced' | 'syncing' | 'pending') => void
  onSvgChange?: (svg: string) => void
  onOpenFullscreen?: () => void
  onTemplateSelect?: (code: string) => void
}) {
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const latestRenderRef = useRef(0)

  // Zoom/pan state
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<DragState | null>(null)

  // Notify parent of SVG changes (via ref to avoid re-renders)
  const onSvgChangeRef = useRef(onSvgChange)
  useEffect(() => { onSvgChangeRef.current = onSvgChange }, [onSvgChange])

  // ── Render mermaid ──────────────────────────────────────────────────────

  const doRender = useCallback(async (source: string) => {
    const renderId = latestRenderRef.current + 1
    latestRenderRef.current = renderId

    if (!source.trim()) {
      setSvg('')
      setError(null)
      onSvgChangeRef.current?.('')
      onSyncStatusChange?.('synced')
      return
    }

    onSyncStatusChange?.('syncing')
    try {
      const mermaid = await getMermaidRenderer(resolvedTheme === 'dark' ? 'dark' : 'light')
      await mermaid.parse(source)
      const id = `mermaid-file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const result = await mermaid.render(id, source)
      if (latestRenderRef.current !== renderId) return
      setSvg(result.svg)
      setError(null)
      onSvgChangeRef.current?.(result.svg)
      onSyncStatusChange?.('synced')
    } catch (renderError) {
      if (latestRenderRef.current !== renderId) return
      setSvg('')
      setError(renderError instanceof Error ? renderError.message : String(renderError))
      onSvgChangeRef.current?.('')
      onSyncStatusChange?.('synced')
    }
  }, [onSyncStatusChange, resolvedTheme])

  // Auto-sync: re-render on code change
  useEffect(() => {
    if (!autoSync) return
    const timer = window.setTimeout(() => { void doRender(code) }, 250)
    return () => window.clearTimeout(timer)
  }, [autoSync, code, doRender])

  // Manual refresh: re-render on refreshTrigger change
  useEffect(() => {
    void doRender(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger])

  // ── Zoom/pan handlers ──────────────────────────────────────────────────

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
    setScale((current) => clampScale(current + delta, MIN_SCALE, MAX_SCALE))
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    }
  }, [offset.x, offset.y])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true
    }
    setOffset({ x: drag.originX + dx, y: drag.originY + dy })
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
  }, [])

  const stopAction = (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const hasContent = svg || error

  return (
    <div className="mermaid-editor-preview-frame">
      {error ? (
        <div className="mermaid-editor-error">
          <div className="mermaid-editor-error-title">Mermaid 渲染失败</div>
          <pre>{error}</pre>
        </div>
      ) : null}

      {hasContent ? (
        <div
          className="mermaid-editor-canvas"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div
            className="mermaid-editor-canvas-viewport"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          {/* Floating toolbar */}
          <div className="mermaid-editor-view-toolbar" onClick={stopAction}>
            <button
              type="button"
              title="放大"
              className="mermaid-editor-toolbar-btn"
              onClick={(e) => { stopAction(e); setScale((c) => clampScale(c + 0.15, MIN_SCALE, MAX_SCALE)) }}
            >
              <ZoomIn />
            </button>
            <button
              type="button"
              title="缩小"
              className="mermaid-editor-toolbar-btn"
              onClick={(e) => { stopAction(e); setScale((c) => clampScale(c - 0.15, MIN_SCALE, MAX_SCALE)) }}
            >
              <ZoomOut />
            </button>
            <button
              type="button"
              title="重置"
              className="mermaid-editor-toolbar-btn"
              onClick={(e) => { stopAction(e); setScale(1); setOffset({ x: 0, y: 0 }) }}
            >
              <RotateCcw />
            </button>
            <div className="mermaid-editor-toolbar-sep" />
            <button
              type="button"
              title="全屏查看"
              className="mermaid-editor-toolbar-btn"
              onClick={(e) => { stopAction(e); onOpenFullscreen?.() }}
            >
              <Maximize2 />
            </button>
          </div>
        </div>
      ) : (
        <div className="mermaid-editor-empty">
          <div className="mermaid-editor-empty-header">
            <div className="mermaid-editor-empty-icon">
              <FileChartColumn className="size-4" />
            </div>
            <span className="mermaid-editor-empty-title">选择图表类型</span>
            <span className="mermaid-editor-empty-hint">点击卡片插入预设模板</span>
          </div>
          <div className="mermaid-editor-template-grid">
            {MERMAID_TEMPLATES.map((template) => (
              <button
                key={template.type}
                type="button"
                className="mermaid-editor-template-card"
                onClick={() => onTemplateSelect?.(template.code)}
              >
                <div className="mermaid-editor-template-icon">
                  <template.icon className="size-4" />
                </div>
                <div className="mermaid-editor-template-text">
                  <span className="mermaid-editor-template-label">{template.label}</span>
                  <span className="mermaid-editor-template-desc">{template.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MermaidEditor (main export) ────────────────────────────────────────────

export function MermaidEditor({ filePath, tabContentsRef }: MermaidEditorProps) {
  const { currentArticle, saveCurrentArticle, isPulling } = useArticleStore()
  const [mode, setMode] = useState<MermaidEditorMode>(() => modeMapRef[filePath] || DEFAULT_MERMAID_EDITOR_MODE)
  const [content, setContent] = useState('')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'pending'>('synced')
  const [autoSync, setAutoSync] = useState(true)
  const fileName = filePath.split('/').pop() || filePath

  // SVG ref for export and fullscreen (avoid re-render callbacks)
  const svgRef = useRef('')

  // Fullscreen viewer state
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerScale, setViewerScale] = useState(1)
  const [viewerOffset, setViewerOffset] = useState({ x: 0, y: 0 })
  const viewerDragRef = useRef<DragState | null>(null)
  const viewerContentRef = useRef<HTMLDivElement>(null)

  // ── Mode sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    setMode(modeMapRef[filePath] || DEFAULT_MERMAID_EDITOR_MODE)
  }, [filePath])

  // ── Content sync ───────────────────────────────────────────────────────

  useEffect(() => {
    const cached = tabContentsRef.current?.[filePath]
    if (cached !== undefined) {
      setContent(cached)
    } else if (currentArticle !== undefined) {
      setContent(currentArticle)
    }
  }, [currentArticle, filePath, tabContentsRef])

  useEffect(() => {
    if (isPulling) return
    if (currentArticle !== undefined && currentArticle !== content) {
      setContent(currentArticle)
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentArticle, isPulling])

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleModeChange = useCallback((nextMode: MermaidEditorMode) => {
    setMode(nextMode)
    modeMapRef[filePath] = nextMode
  }, [filePath])

  const focusEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      editorView?.focus()
    })
  }, [editorView])

  useEffect(() => {
    if (mode === 'preview') return
    focusEditor()
  }, [focusEditor, mode])

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    if (tabContentsRef.current) {
      tabContentsRef.current[filePath] = newContent
    }
    saveCurrentArticle(newContent)
  }, [filePath, saveCurrentArticle, tabContentsRef])

  const handleFormat = useCallback(() => {
    if (!editorView) return
    const current = editorView.state.doc.toString()
    const formatted = formatMermaidCode(current)
    editorView.dispatch({
      changes: { from: 0, to: current.length, insert: formatted },
    })
  }, [editorView])

  const handleTemplateSelect = useCallback((templateCode: string) => {
    handleContentChange(templateCode)
    if (mode === 'preview') {
      handleModeChange('split')
    }
  }, [handleContentChange, handleModeChange, mode])

  const handleCopyCode = useCallback(async () => {
    try {
      await copyTextToClipboard(content)
      toast({ title: '复制成功', description: '已复制 Mermaid 代码' })
    } catch {
      toast({ title: '复制失败', description: '无法复制到剪贴板', variant: 'destructive' })
    }
  }, [content])

  const handleClearCode = useCallback(() => {
    if (content.trim() && !window.confirm('确定要清空当前 Mermaid 代码吗？')) {
      return
    }

    handleContentChange('')
    setRefreshTrigger((t) => t + 1)
    focusEditor()
  }, [content, focusEditor, handleContentChange])

  const handleSvgChange = useCallback((svg: string) => {
    svgRef.current = svg
  }, [])

  // ── Export handlers ────────────────────────────────────────────────────

  const handleCopySvg = useCallback(async () => {
    if (!svgRef.current) return
    try {
      await copyTextToClipboard(svgRef.current)
      toast({ title: '复制成功', description: '已复制 SVG 代码' })
    } catch {
      toast({ title: '复制失败', description: '无法复制到剪贴板', variant: 'destructive' })
    }
  }, [])

  const handleExportPng = useCallback(async () => {
    if (!svgRef.current) return

    const container = document.createElement('div')
    container.innerHTML = svgRef.current
    const svgEl = container.querySelector('svg')
    if (!svgEl) return

    const svgData = new XMLSerializer().serializeToString(svgEl)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = async () => {
      canvas.width = img.width * 2
      canvas.height = img.height * 2
      ctx?.scale(2, 2)
      ctx?.drawImage(img, 0, 0)
      canvas.toBlob(async (blob) => {
        if (!blob) return
        const outputName = fileName.replace(/\.(mmd|mermaid)$/i, '') + '.png'
        try {
          await saveBlobAs(blob, outputName)
          toast({ title: '导出成功', description: outputName })
          void recordFileActivity({
            path: filePath,
            type: 'export',
            title: '导出 Mermaid PNG',
            description: outputName,
          })
        } catch {
          toast({ title: '导出失败', variant: 'destructive' })
        }
      }, 'image/png')
    }

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }, [fileName, filePath])

  const handleRestoreContent = useCallback((restoredContent: string) => {
    handleContentChange(restoredContent)
    setRefreshTrigger((t) => t + 1)
  }, [handleContentChange])

  // ── Fullscreen viewer handlers ─────────────────────────────────────────

  const handleOpenFullscreen = useCallback(() => {
    setViewerScale(1)
    setViewerOffset({ x: 0, y: 0 })
    setViewerReady(false)
    setViewerOpen(true)
  }, [])

  useEffect(() => {
    if (!viewerOpen || !svgRef.current) {
      return
    }

    setViewerReady(false)
    const frame = requestAnimationFrame(() => {
      setViewerScale(fitSvgToVisibleContent(viewerContentRef.current) ?? getInitialViewerScale(svgRef.current))
      setViewerOffset({ x: 0, y: 0 })
      setViewerReady(true)
    })

    return () => cancelAnimationFrame(frame)
  }, [viewerOpen])

  const handleViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -VIEWER_SCALE_STEP : VIEWER_SCALE_STEP
    setViewerScale((current) => clampScale(current + delta, VIEWER_MIN_SCALE, VIEWER_MAX_SCALE))
  }, [])

  const handleViewerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    viewerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewerOffset.x,
      originY: viewerOffset.y,
      moved: false,
    }
  }, [viewerOffset.x, viewerOffset.y])

  const handleViewerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = viewerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setViewerOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const handleViewerPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (viewerDragRef.current?.pointerId === event.pointerId) {
      viewerDragRef.current = null
    }
  }, [])

  // ── Sub-renderers ──────────────────────────────────────────────────────

  const characterCount = content.length

  const syncLabel = {
    synced: '已同步',
    syncing: '渲染中',
    pending: '待刷新',
  }[syncStatus]

  const syncTitle = {
    synced: '预览已与最新代码同步',
    syncing: '正在渲染更新中',
    pending: '手动模式，内容待刷新',
  }[syncStatus]

  const editorPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mermaid-editor-code-toolbar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mermaid-editor-toolbar-button"
              title="插入 Mermaid 模板"
            >
              <FileChartColumn className="size-3.5" />
              <span>模板</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 p-1">
            {MERMAID_TEMPLATES.map((template) => (
              <DropdownMenuItem
                key={template.type}
                className="gap-2 rounded-md px-2 py-1.5"
                onSelect={() => handleTemplateSelect(template.code)}
              >
                <template.icon className="size-3.5 text-muted-foreground" />
                <span className="truncate text-xs">{template.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={handleFormat}
          className="mermaid-editor-toolbar-button"
          title="格式化代码"
        >
          <AlignLeft className="size-3.5" />
          <span>格式化</span>
        </button>
        <button
          type="button"
          onClick={handleCopyCode}
          className="mermaid-editor-toolbar-button"
          title="复制 Mermaid 代码"
        >
          <Copy className="size-3.5" />
          <span>复制</span>
        </button>
        <button
          type="button"
          onClick={handleClearCode}
          className="mermaid-editor-toolbar-button"
          title="清空代码"
        >
          <Trash2 className="size-3.5" />
          <span>清空</span>
        </button>
        <span className="mermaid-editor-code-toolbar-spacer" />
        <button
          type="button"
          onClick={() => handleModeChange('preview')}
          className="mermaid-editor-toolbar-button"
          title="返回预览"
        >
          <Eye className="size-3.5" />
          <span>预览</span>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <HtmlCodeEditor
          content={content}
          onChange={handleContentChange}
          onEditorMount={setEditorView}
          language="plain"
        />
      </div>
    </div>
  )

  const previewPanel = (
    <MermaidPreview
      code={content}
      autoSync={autoSync}
      refreshTrigger={refreshTrigger}
      onSyncStatusChange={setSyncStatus}
      onSvgChange={handleSvgChange}
      onOpenFullscreen={handleOpenFullscreen}
      onTemplateSelect={handleTemplateSelect}
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="mermaid-editor-shell">
      {/* Top toolbar */}
      <div className="mermaid-editor-main-toolbar">
        <div className="mermaid-editor-file-block">
          <span className="mermaid-editor-file-icon" aria-hidden="true">
            <FileChartColumn className="h-4 w-4" />
          </span>
          <div className="mermaid-editor-file-copy">
            <span className="mermaid-editor-file-name" title={fileName}>{fileName}</span>
            <span className="mermaid-editor-file-meta">Mermaid 图表</span>
          </div>
        </div>

        <div className="mermaid-editor-mode-switch" role="tablist" aria-label="Mermaid 编辑器视图模式">
          {editorModeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => handleModeChange(value)}
              className={`mermaid-editor-mode-button ${mode === value ? 'is-active' : ''}`}
              title={value === 'preview' ? '仅预览' : value === 'code' ? '仅代码' : '代码 + 预览'}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Workspace */}
      <div className="mermaid-editor-workspace">
        {mode === 'code' ? (
          <div className="mermaid-editor-preview-frame">
            {editorPanel}
          </div>
        ) : mode === 'preview' ? (
          previewPanel
        ) : (
          <PanelGroup direction="horizontal" className="mermaid-editor-split-group">
            <Panel defaultSize={48} minSize={25}>
              <div className="mermaid-editor-preview-frame">
                {editorPanel}
              </div>
            </Panel>
            <PanelResizeHandle className="mermaid-editor-resize-handle">
              <span className="mermaid-editor-resize-grip" />
            </PanelResizeHandle>
            <Panel defaultSize={52} minSize={25}>
              {previewPanel}
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Footer toolbar */}
      <div className="mermaid-editor-footer-toolbar">
        <div className="mermaid-editor-footer-left">
          <span className="mermaid-editor-footer-info" title={`字符数：${characterCount}`}>
            <Type className="size-3" />
            <span>{characterCount}</span>
          </span>

          <FileCreatedAt />

          <button
            type="button"
            onClick={handleCopySvg}
            className="mermaid-editor-footer-icon-button"
            title="复制 SVG"
          >
            <Copy className="size-3" />
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            className="mermaid-editor-footer-icon-button"
            title="导出 PNG"
          >
            <Download className="size-3" />
          </button>

          <div className={`mermaid-editor-sync-state ${syncStatus === 'syncing' ? 'is-syncing' : ''}`} title={syncTitle}>
            <span className="mermaid-editor-sync-dot" />
            <span>{syncLabel}</span>
          </div>

          <label className="mermaid-editor-auto-refresh" title="自动刷新预览">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="sr-only peer"
            />
            <span className={`mermaid-editor-switch ${autoSync ? 'is-on' : ''}`} aria-hidden="true" />
            <span>自动刷新</span>
          </label>

          <button
            type="button"
            onClick={() => setRefreshTrigger((t) => t + 1)}
            className="mermaid-editor-footer-icon-button"
            title="手动刷新预览"
          >
            <RefreshCw className="size-3" />
          </button>
        </div>

        <div className="mermaid-editor-footer-right">
          <HistorySheet onRestoreContent={handleRestoreContent} restoreContentType="markdown" />
          <SyncButton />
        </div>
      </div>

      {/* Fullscreen Viewer */}
      {viewerOpen && svgRef.current ? (
        <div className="mermaid-editor-fullscreen">
          <div className="mermaid-editor-fullscreen-header">
            <div className="mermaid-editor-file-copy">
              <span className="mermaid-editor-file-name">{fileName}</span>
            </div>
            <div className="mermaid-editor-mode-switch">
              <button
                type="button"
                title="放大"
                className="mermaid-editor-toolbar-btn"
                onClick={() => setViewerScale((s) => clampScale(s + VIEWER_SCALE_STEP, VIEWER_MIN_SCALE, VIEWER_MAX_SCALE))}
              >
                <ZoomIn />
              </button>
              <button
                type="button"
                title="缩小"
                className="mermaid-editor-toolbar-btn"
                onClick={() => setViewerScale((s) => clampScale(s - VIEWER_SCALE_STEP, VIEWER_MIN_SCALE, VIEWER_MAX_SCALE))}
              >
                <ZoomOut />
              </button>
              <button
                type="button"
                title="重置"
                className="mermaid-editor-toolbar-btn"
                onClick={() => { setViewerScale(fitSvgToVisibleContent(viewerContentRef.current) ?? getInitialViewerScale(svgRef.current)); setViewerOffset({ x: 0, y: 0 }) }}
              >
                <RotateCcw />
              </button>
              <div className="mermaid-editor-toolbar-sep" />
              <button
                type="button"
                title="关闭 (双击画布也可关闭)"
                className="mermaid-editor-toolbar-btn"
                onClick={() => setViewerOpen(false)}
              >
                <X />
              </button>
            </div>
          </div>
          <div
            className="mermaid-editor-fullscreen-stage"
            onWheel={handleViewerWheel}
            onPointerDown={handleViewerPointerDown}
            onPointerMove={handleViewerPointerMove}
            onPointerUp={handleViewerPointerEnd}
            onPointerCancel={handleViewerPointerEnd}
            onDoubleClick={() => setViewerOpen(false)}
          >
            <div
              ref={viewerContentRef}
              className="mermaid-editor-fullscreen-content"
              style={{
                opacity: viewerReady ? 1 : 0,
                transform: `translate(calc(-50% + ${viewerOffset.x}px), calc(-50% + ${viewerOffset.y}px)) scale(${viewerScale})`,
              }}
              dangerouslySetInnerHTML={{ __html: svgRef.current }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
