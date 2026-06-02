'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type mermaidType from 'mermaid'
import { Check, Code, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
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
  const [viewerScale, setViewerScale] = useState(1)
  const [viewerOffset, setViewerOffset] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
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
    setViewerScale(1)
    setViewerOffset({ x: 0, y: 0 })
  }, [])

  const openViewer = useCallback((event: React.MouseEvent) => {
    stopPreviewAction(event)
    resetViewer()
    setViewerOpen(true)
  }, [resetViewer])

  const handleViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.12 : 0.12
    setViewerScale((current) => Math.min(6, Math.max(0.2, current + delta)))
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

      {viewerOpen && svg ? (
        <div className="mermaid-fullscreen-viewer" contentEditable={false}>
          <div
            className="mermaid-fullscreen-stage"
            onWheel={handleViewerWheel}
            onPointerDown={handleViewerPointerDown}
            onPointerMove={handleViewerPointerMove}
            onPointerUp={handleViewerPointerEnd}
            onPointerCancel={handleViewerPointerEnd}
            onDoubleClick={() => setViewerOpen(false)}
          >
            <div
              className="mermaid-fullscreen-content"
              style={{
                transform: `translate(calc(-50% + ${viewerOffset.x}px), calc(-50% + ${viewerOffset.y}px)) scale(${viewerScale})`,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
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
