'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import type mermaidType from 'mermaid'
import { Check, Code, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

// 懒加载 mermaid 实例（约 2.5MB，避免打入首屏 chunk）
let mermaidInstance: typeof mermaidType | null = null
async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import('mermaid')
    mermaidInstance = mod.default
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    })
  }
  return mermaidInstance
}

// Diagram type configuration with icons
const DIAGRAM_TYPES = [
  { type: 'flowchart', labelKey: 'flowchart', icon: 'GitBranch', alias: ['flowchart', 'flowchart-v2', 'graph', 'td', 'graph TD', 'graph BT', 'graph LR', 'graph RL'] },
  { type: 'sequence', labelKey: 'sequence', icon: 'GitCommit', alias: ['sequence', 'sequenceDiagram'] },
  { type: 'classDiagram', labelKey: 'classDiagram', icon: 'Layers', alias: ['class', 'classDiagram'] },
  { type: 'stateDiagram', labelKey: 'stateDiagram', icon: 'Activity', alias: ['state', 'stateDiagram', 'stateDiagram-v2'] },
  { type: 'er', labelKey: 'erDiagram', icon: 'Database', alias: ['er', 'erDiagram'] },
  { type: 'gantt', labelKey: 'gantt', icon: 'Calendar', alias: ['gantt'] },
  { type: 'pie', labelKey: 'pie', icon: 'PieChart', alias: ['pie'] },
  { type: 'journey', labelKey: 'journey', icon: 'Map', alias: ['journey', 'gitGraph'] },
]

// Detect diagram type from code
function detectDiagramType(code: string): string {
  const trimmed = code.trim()
  for (const config of DIAGRAM_TYPES) {
    // Check first line for type specification
    const firstLine = trimmed.split('\n')[0]?.toLowerCase() || ''
    if (config.alias?.some((alias: string) => firstLine.startsWith(alias) || firstLine === alias)) {
      return config.type
    }
  }
  return 'flowchart'
}

const VIEWER_MIN_SCALE = 0.25
const VIEWER_MAX_SCALE = 10
const VIEWER_SCALE_STEP = 0.25
const VIEWER_HEADER_HEIGHT = 44
const VIEWER_CONTENT_PADDING = 48
const VIEWER_SVG_CROP_PADDING = 28

function clampViewerScale(value: number) {
  return Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, Number(value.toFixed(2))))
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

  return clampViewerScale(Math.max(1, fitScale))
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

  return clampViewerScale(Math.max(1, fitScale))
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

// Mermaid Diagram View Component
function MermaidDiagramView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('editor.mermaid')

  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(node.attrs.code || '')
  const [diagramType, setDiagramType] = useState(node.attrs.type || 'flowchart')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerScale, setViewerScale] = useState(1)
  const [viewerOffset, setViewerOffset] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerContentRef = useRef<HTMLDivElement>(null)
  const previewDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const viewerDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const renderDiagram = useCallback(async () => {
    if (!code.trim()) {
      setSvg('')
      setError(null)
      return
    }

    setError(null)

    try {
      const mermaid = await getMermaid()
      mermaid.parse(code)
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg: renderedSvg } = await mermaid.render(id, code)
      setSvg(renderedSvg)
      setScale(1)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('renderError')
      setError(message)
      setSvg('')
    }
  }, [code, t])

  useEffect(() => {
    renderDiagram()
  }, [])

  useEffect(() => {
    const detected = detectDiagramType(code)
    if (detected !== diagramType) {
      setDiagramType(detected)
    }
  }, [code, diagramType])

  // 退出编辑模式后刷新预览
  useEffect(() => {
    if (!isEditing) {
      renderDiagram()
    }
  }, [isEditing])

  const handleUpdate = () => {
    updateAttributes({ code, type: diagramType })
    setIsEditing(false)
  }

  const stopPreviewAction = (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const resetViewer = useCallback(() => {
    setViewerScale(fitSvgToVisibleContent(viewerContentRef.current) ?? getInitialViewerScale(svg))
    setViewerOffset({ x: 0, y: 0 })
  }, [svg])

  const openViewer = useCallback((event: React.MouseEvent) => {
    stopPreviewAction(event)
    setViewerScale(1)
    setViewerOffset({ x: 0, y: 0 })
    setViewerReady(false)
    setViewerOpen(true)
  }, [])

  useEffect(() => {
    if (!viewerOpen || !svg) {
      return
    }

    setViewerReady(false)
    const frame = requestAnimationFrame(() => {
      const nextScale = fitSvgToVisibleContent(viewerContentRef.current) ?? getInitialViewerScale(svg)
      setViewerScale(nextScale)
      setViewerOffset({ x: 0, y: 0 })
      setViewerReady(true)
    })

    return () => cancelAnimationFrame(frame)
  }, [viewerOpen, svg])

  const handleViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -VIEWER_SCALE_STEP : VIEWER_SCALE_STEP
    setViewerScale((current) => clampViewerScale(current + delta))
  }, [])

  const handlePreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    }
  }, [offset.x, offset.y])

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true
    }

    event.stopPropagation()
    setOffset({
      x: drag.originX + dx,
      y: drag.originY + dy,
    })
  }, [])

  const handlePreviewPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (previewDragRef.current?.pointerId === event.pointerId) {
      previewDragRef.current = null
    }
  }, [])

  const handleViewerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    viewerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewerOffset.x,
      originY: viewerOffset.y,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleUpdate()
    }
    if (e.key === 'Escape') {
      setCode(node.attrs.code || '')
      setIsEditing(false)
    }
  }

  const getLabel = (key: string) => {
    return t(`diagramTypes.${key}`)
  }

  const handlePreviewClick = useCallback((event: React.MouseEvent) => {
    if (previewDragRef.current?.moved) {
      event.preventDefault()
      event.stopPropagation()
      previewDragRef.current.moved = false
      return
    }
    setIsEditing(true)
  }, [])

  return (
    <NodeViewWrapper className="mermaid-diagram-wrapper my-4">
      {/* Preview Mode */}
      {!isEditing && (
        <div
          className="mermaid-preview rounded-lg border border-border bg-card"
          onClick={handlePreviewClick}
        >
          {error ? (
            <div className="p-4 text-red-500 text-sm">
              <p className="font-medium">{t('renderError')}</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted-foreground">{t('clickToEdit')}</p>
            </div>
          ) : svg ? (
            <div
              ref={containerRef}
              className="mermaid-svg p-4"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerEnd}
              onPointerCancel={handlePreviewPointerEnd}
            >
              <div
                className="mermaid-svg-inner"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <span>{t('clickToAdd')}</span>
            </div>
          )}

          {svg ? (
            <div className="mermaid-view-toolbar">
              <button
                type="button"
                title="放大"
                className="mermaid-toolbar-btn"
                onClick={(event) => {
                  stopPreviewAction(event)
                  setScale((current) => Math.min(3, current + 0.15))
                }}
              >
                <ZoomIn />
              </button>
              <button
                type="button"
                title="缩小"
                className="mermaid-toolbar-btn"
                onClick={(event) => {
                  stopPreviewAction(event)
                  setScale((current) => Math.max(0.35, current - 0.15))
                }}
              >
                <ZoomOut />
              </button>
              <div className="mermaid-toolbar-sep" />
              <button
                type="button"
                title="展开查看"
                className="mermaid-toolbar-btn"
                onClick={openViewer}
              >
                <Maximize2 />
              </button>
              <button
                type="button"
                title="编辑源码"
                className="mermaid-toolbar-btn"
                onClick={(event) => {
                  stopPreviewAction(event)
                  setIsEditing(true)
                }}
              >
                <Code />
              </button>
            </div>
          ) : (
            <div className="mermaid-overlay opacity-0 hover:opacity-100 transition-opacity absolute top-2 right-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
            >
              <Code className="size-4" />
            </Button>
            </div>
          )}
        </div>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <div className="mermaid-editor rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 p-2 border-b bg-muted/50">
            <Select value={diagramType} onValueChange={setDiagramType}>
              <SelectTrigger className="w-35 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAGRAM_TYPES.map((item) => (
                  <SelectItem key={item.type} value={item.type}>
                    {getLabel(item.type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleUpdate}
              title={t('done')}
            >
              <Check className="size-4" />
            </Button>
          </div>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-48 p-3 font-mono text-sm bg-background resize-y focus:outline-none"
            placeholder={t('placeholder')}
            spellCheck={false}
          />

          {error && (
            <div className="px-3 py-2 text-xs text-red-500 bg-red-50 border-t">
              {error}
            </div>
          )}
        </div>
      )}

      {viewerOpen && svg && typeof document !== 'undefined' ? createPortal(
        <div className="fixed inset-0 z-[10060] flex flex-col bg-background text-foreground" contentEditable={false}>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
            <div className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
              {diagramType}
            </div>
            <div className="inline-flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="放大"
                className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                onClick={() => setViewerScale((current) => clampViewerScale(current + VIEWER_SCALE_STEP))}
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                type="button"
                title="缩小"
                className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                onClick={() => setViewerScale((current) => clampViewerScale(current - VIEWER_SCALE_STEP))}
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                type="button"
                title="适屏重置"
                className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                onClick={resetViewer}
              >
                <RotateCcw className="size-4" />
              </button>
              <span className="min-w-12 px-1 text-center text-xs text-muted-foreground">{Math.round(viewerScale * 100)}%</span>
              <span className="mx-1 h-5 w-px bg-border" />
              <button
                type="button"
                title="关闭"
                className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                onClick={() => setViewerOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-hidden cursor-grab select-none active:cursor-grabbing"
            style={{
              touchAction: 'none',
              backgroundImage:
                'linear-gradient(hsl(var(--border) / 0.22) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.22) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
            onWheel={handleViewerWheel}
            onPointerDown={handleViewerPointerDown}
            onPointerMove={handleViewerPointerMove}
            onPointerUp={handleViewerPointerEnd}
            onPointerCancel={handleViewerPointerEnd}
            onDoubleClick={() => setViewerOpen(false)}
          >
            <div
              ref={viewerContentRef}
              className="pointer-events-none absolute left-1/2 top-1/2 w-max max-w-none select-none rounded-lg border bg-background p-3 shadow-2xl [&_svg]:!max-w-none [&_svg]:!h-auto"
              style={{
                opacity: viewerReady ? 1 : 0,
                transformOrigin: 'center center',
                transform: `translate(calc(-50% + ${viewerOffset.x}px), calc(-50% + ${viewerOffset.y}px)) scale(${viewerScale})`,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>,
        document.body
      ) : null}
    </NodeViewWrapper>
  )
}

// Mermaid Code Block Extension
export const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: '',
      },
      type: {
        default: 'flowchart',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="mermaid-diagram"]' },
      { tag: 'pre[data-mermaid]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-diagram' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidDiagramView)
  },

  markdownTokenName: 'mermaid',

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^```mermaid\r?\n/)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src, tokens, lexer) => {
      const match = /^```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(src)
      if (!match) return undefined

      const code = match[1]
      const type = detectDiagramType(code)

      return {
        type: 'mermaid',
        raw: match[0],
        content: code,
        attrs: { type },
        tokens: lexer.blockTokens(match[1]),
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `\n\`\`\`mermaid\n${node.attrs?.code ?? ''}\n\`\`\`\n`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    const code = token.content || ''
    const type = detectDiagramType(code)
    return {
      type: 'mermaidDiagram',
      attrs: { code, type },
    }
  },
})

export default MermaidDiagram
