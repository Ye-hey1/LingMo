'use client'

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightFromLine,
  ArchiveX,
  BoxSelect,
  Circle,
  Copy,
  Crosshair,
  FileJson,
  Grid3X3,
  ImagePlus,
  Loader2,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Unlink,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  canvasRectIntersectsNode,
  clampCanvasZoom,
  clientPointToWorld,
  createCanvasConnectionPath,
  fitNodesInViewport,
  getCanvasSelectionRect,
  zoomViewportAtPoint,
} from '@/lib/creative-canvas/geometry'
import useCreativeCanvasStore from '@/stores/creative-canvas'
import type { CreativeCanvasAsset, CreativeCanvasNode } from '@/types/creative-canvas'
import type { CreativeCanvasViewport } from '@/types/creative-canvas'
import { CreativeCanvasModelSelect } from './creative-canvas-model-select'

type DragState = {
  nodeIds: string[]
  startClientX: number
  startClientY: number
  startPositions: Record<string, { x: number; y: number }>
}

type PanState = {
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

type SelectionState = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

type ResizeState = {
  nodeId: string
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
}

type ConnectionDragState = {
  fromNodeId: string
  currentX: number
  currentY: number
}

type ContextMenuState = {
  clientX: number
  clientY: number
  worldX: number
  worldY: number
  nodeId?: string
}

type CanvasSize = {
  width: number
  height: number
}

function getSelectionRect(selection: SelectionState) {
  return getCanvasSelectionRect(
    { x: selection.startX, y: selection.startY },
    { x: selection.currentX, y: selection.currentY },
  )
}

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getImageDimensions(width: number, height: number, maxSize: number) {
  const ratio = Math.min(maxSize / width, maxSize / height, 1)
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

async function createThumbnailBytes(url: string) {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('THUMBNAIL_IMAGE_LOAD_FAILED'))
  })
  const size = getImageDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, 320)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('THUMBNAIL_CANVAS_UNAVAILABLE')
  context.drawImage(image, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.82)
  })
  if (!blob) throw new Error('THUMBNAIL_ENCODE_FAILED')
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || 'image/webp',
  }
}

function NodeAssetImage({ asset, remoteUrl }: { asset?: CreativeCanvasAsset; remoteUrl?: string }) {
  const tCanvas = useTranslations('creativeCanvas')
  const getAssetUrl = useCreativeCanvasStore(state => state.getAssetUrl)
  const [url, setUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!asset && remoteUrl) {
      setUrl(remoteUrl)
      return
    }
    if (!asset) {
      setUrl('')
      return
    }
    getAssetUrl(asset)
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [asset, getAssetUrl, remoteUrl])

  if (!asset && !remoteUrl) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{tCanvas('nodes.imageEmpty')}</div>
  }

  if (!url) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  }

  return <img src={url} alt={asset?.title || tCanvas('nodes.imageAlt')} className="h-full w-full object-contain" draggable={false} />
}

function AssetTile({
  asset,
  onInsert,
  onAddToCanvas,
}: {
  asset: CreativeCanvasAsset
  onInsert: (assetId: string) => void
  onAddToCanvas: (assetId: string) => void
}) {
  const tCanvas = useTranslations('creativeCanvas')
  const getAssetUrl = useCreativeCanvasStore(state => state.getAssetUrl)
  const getThumbnailUrl = useCreativeCanvasStore(state => state.getThumbnailUrl)
  const cacheAssetThumbnail = useCreativeCanvasStore(state => state.cacheAssetThumbnail)
  const [url, setUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const nextUrl = asset.thumbnailPath
        ? await getThumbnailUrl(asset)
        : await getAssetUrl(asset)
      if (!cancelled) setUrl(nextUrl)
      if (!asset.thumbnailPath) {
        createThumbnailBytes(nextUrl)
          .then(thumbnail => cacheAssetThumbnail(asset.id, thumbnail.bytes, thumbnail.mimeType))
          .catch(() => undefined)
      }
    }
    void load().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [asset, cacheAssetThumbnail, getAssetUrl, getThumbnailUrl])

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-28 items-center justify-center bg-muted/40">
        {url ? <img src={url} alt={asset.title} className="h-full w-full object-contain" /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2 p-2">
        <div className="truncate text-xs font-medium" title={asset.title}>{asset.title}</div>
        <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-xs" onClick={() => onAddToCanvas(asset.id)}>
          <ImagePlus className="size-3.5" />
          {tCanvas('assets.add')}
        </Button>
        <Button size="sm" variant="secondary" className="h-7 w-full gap-1 text-xs" onClick={() => onInsert(asset.id)}>
          <ArrowDownToLine className="size-3.5" />
          {tCanvas('assets.insert')}
        </Button>
      </div>
    </div>
  )
}

function getStatusTone(status?: string) {
  if (status === 'running') return 'border-blue-400 bg-blue-500/5'
  if (status === 'succeeded') return 'border-emerald-400 bg-emerald-500/5'
  if (status === 'failed') return 'border-red-400 bg-red-500/5'
  if (status === 'stale') return 'border-amber-400 bg-amber-500/5'
  return 'border-border bg-background'
}

function NodeBody({
  node,
  asset,
  onMetadataChange,
}: {
  node: CreativeCanvasNode
  asset?: CreativeCanvasAsset
  onMetadataChange: (metadata: Record<string, unknown>) => void
}) {
  const tCanvas = useTranslations('creativeCanvas')

  if (node.type === 'text') {
    return (
      <Textarea
        defaultValue={node.metadata.content || node.metadata.prompt || ''}
        className="h-full min-h-0 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
        placeholder={tCanvas('nodes.textPlaceholder')}
        onBlur={(event) => {
          const content = event.currentTarget.value
          onMetadataChange({ content, prompt: content })
        }}
      />
    )
  }

  if (node.type === 'config') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 text-xs">
        <Textarea
          defaultValue={node.metadata.prompt || ''}
          className="min-h-20 flex-1 resize-none text-xs"
          placeholder={tCanvas('nodes.configPlaceholder')}
          onBlur={(event) => onMetadataChange({ prompt: event.currentTarget.value, promptSource: 'manual' })}
        />
        <CreativeCanvasModelSelect
          value={node.metadata.modelSelection}
          onValueChange={(modelSelection) => onMetadataChange({ modelSelection })}
          inheritLabel={tCanvas('model.inheritCanvas')}
          compact
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            defaultValue={node.metadata.size || '1024x1024'}
            className="h-8 text-xs"
            placeholder="1024x1024"
            onBlur={(event) => onMetadataChange({ size: event.currentTarget.value })}
          />
          <select
            defaultValue={node.metadata.quality || 'standard'}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            onChange={(event) => onMetadataChange({ quality: event.currentTarget.value })}
          >
            <option value="standard">standard</option>
            <option value="hd">hd</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        {node.metadata.error ? <div className="line-clamp-2 text-xs text-destructive">{String(node.metadata.error)}</div> : null}
      </div>
    )
  }

  if (node.type === 'image') {
    return (
      <div className="h-full min-h-0 overflow-hidden rounded-md bg-muted/40">
        <NodeAssetImage asset={asset} remoteUrl={typeof node.metadata.remoteUrl === 'string' ? node.metadata.remoteUrl : undefined} />
      </div>
    )
  }

  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{tCanvas('nodes.reserved')}</div>
}

function CanvasMiniMap({
  nodes,
  viewport,
  canvasSize,
  onViewportChange,
}: {
  nodes: CreativeCanvasNode[]
  viewport: CreativeCanvasViewport
  canvasSize: CanvasSize
  onViewportChange: (viewport: CreativeCanvasViewport) => void
}) {
  const tCanvas = useTranslations('creativeCanvas')
  const [dragging, setDragging] = useState(false)
  const bounds = useMemo(() => {
    const viewLeft = -viewport.x / viewport.k
    const viewTop = -viewport.y / viewport.k
    const viewWidth = canvasSize.width / viewport.k
    const viewHeight = canvasSize.height / viewport.k
    const minX = Math.min(viewLeft, ...nodes.map(node => node.x))
    const minY = Math.min(viewTop, ...nodes.map(node => node.y))
    const maxX = Math.max(viewLeft + viewWidth, ...nodes.map(node => node.x + node.width))
    const maxY = Math.max(viewTop + viewHeight, ...nodes.map(node => node.y + node.height))
    return {
      minX: Number.isFinite(minX) ? minX - 120 : -120,
      minY: Number.isFinite(minY) ? minY - 120 : -120,
      maxX: Number.isFinite(maxX) ? maxX + 120 : 120,
      maxY: Number.isFinite(maxY) ? maxY + 120 : 120,
      viewLeft,
      viewTop,
      viewWidth,
      viewHeight,
    }
  }, [canvasSize.height, canvasSize.width, nodes, viewport])

  if (!canvasSize.width || !canvasSize.height) return null

  const width = 190
  const height = 132
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min((width - 16) / contentWidth, (height - 16) / contentHeight)
  const offsetX = (width - contentWidth * scale) / 2
  const offsetY = (height - contentHeight * scale) / 2
  const toMiniX = (x: number) => offsetX + (x - bounds.minX) * scale
  const toMiniY = (y: number) => offsetY + (y - bounds.minY) * scale

  const updateViewport = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const worldX = bounds.minX + (event.clientX - rect.left - offsetX) / scale
    const worldY = bounds.minY + (event.clientY - rect.top - offsetY) / scale
    onViewportChange({
      ...viewport,
      x: Math.round(canvasSize.width / 2 - worldX * viewport.k),
      y: Math.round(canvasSize.height / 2 - worldY * viewport.k),
    })
  }

  return (
    <button
      type="button"
      className="absolute bottom-3 right-3 z-30 overflow-hidden rounded-md border border-border bg-background/90 p-0 shadow-sm backdrop-blur"
      style={{ width, height }}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        updateViewport(event)
      }}
      onPointerMove={(event) => {
        if (dragging) updateViewport(event)
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        setDragging(false)
      }}
      title={tCanvas('appearance.minimap')}
    >
      <svg width={width} height={height} className="block">
        <rect width={width} height={height} fill="hsl(var(--muted) / 0.5)" />
        {nodes.map(node => (
          <rect
            key={node.id}
            x={toMiniX(node.x)}
            y={toMiniY(node.y)}
            width={Math.max(2, node.width * scale)}
            height={Math.max(2, node.height * scale)}
            rx="2"
            fill={node.type === 'image' ? 'hsl(var(--primary) / 0.65)' : 'hsl(var(--foreground) / 0.45)'}
          />
        ))}
        <rect
          x={toMiniX(bounds.viewLeft)}
          y={toMiniY(bounds.viewTop)}
          width={Math.max(8, bounds.viewWidth * scale)}
          height={Math.max(8, bounds.viewHeight * scale)}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
        />
      </svg>
    </button>
  )
}

interface CreativeCanvasWorkspaceProps {
  initialPrompt?: string | null
  initialSourcePath?: string | null
  requestId?: number
}

export function CreativeCanvasWorkspace({
  initialPrompt,
  initialSourcePath,
  requestId,
}: CreativeCanvasWorkspaceProps = {}) {
  const tCanvas = useTranslations('creativeCanvas')
  const canvasRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const importPointRef = useRef<{ x: number; y: number } | null>(null)
  const viewportPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedNodeIdsRef = useRef<string[]>([])
  const [promptDraft, setPromptDraft] = useState('')
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [panState, setPanState] = useState<PanState | null>(null)
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null)
  const [draftNodeRects, setDraftNodeRects] = useState<Record<string, { x: number; y: number; width?: number; height?: number }>>({})
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [boxSelectMode, setBoxSelectMode] = useState(false)
  const [spacePressed, setSpacePressed] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const [viewport, setViewportState] = useState<CreativeCanvasViewport>({ x: 0, y: 0, k: 1 })

  const {
    loading,
    error,
    projects,
    project,
    nodes,
    edges,
    assets,
    jobs,
    selectedNodeIds,
    historyPast,
    historyFuture,
    ensureReady,
    createProject,
    deleteProject,
    openProject,
    createGenerationFlow,
    addNode,
    addImageNodeFromAsset,
    importImageAsset,
    updateNode,
    deleteSelectedNodes,
    connectNodes,
    deleteEdge,
    selectNodes,
    setViewport: persistViewport,
    updateProjectSettings,
    moveNodes,
    resizeNode,
    duplicateNodes,
    runGenerationForNode,
    runGenerationForNodes,
    undo,
    redo,
    insertAssetIntoNote,
    exportSnapshot,
    recoverStaleJobs,
    retryGenerationJob,
    analyzeAssetCleanup,
    cleanupAssets,
    importInfiniteCanvasJson,
    cancelGeneration,
  } = useCreativeCanvasStore()
  const activeProjectId = project?.id

  useEffect(() => {
    void ensureReady()
  }, [ensureReady])

  useEffect(() => {
    const activeProject = useCreativeCanvasStore.getState().project
    if (!activeProject || activeProject.id !== activeProjectId) return
    setViewportState(activeProject.viewport)
    setDraftNodeRects({})
    setSelectedEdgeId(null)
    setConnectionDrag(null)
  }, [activeProjectId])

  useEffect(() => {
    setPromptDraft(initialPrompt?.trim() || '')
  }, [initialPrompt, requestId])

  useEffect(() => () => {
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current)
  }, [])

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const updateSize = () => setCanvasSize({ width: element.clientWidth, height: element.clientHeight })
    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const selectedNode = useMemo(
    () => nodes.find(node => selectedNodeIds.includes(node.id)) || null,
    [nodes, selectedNodeIds],
  )
  const displayNodes = useMemo(() => nodes.map(node => {
    const draft = draftNodeRects[node.id]
    return draft ? { ...node, ...draft } : node
  }), [draftNodeRects, nodes])
  const assetById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets])
  const nodeById = useMemo(() => new Map(displayNodes.map(node => [node.id, node])), [displayNodes])
  const selectedConnections = useMemo(() => {
    if (!selectedNode) return []
    return edges
      .filter(edge => edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id)
      .map((edge) => {
        const direction = edge.fromNodeId === selectedNode.id ? 'output' : 'input'
        const connectedNodeId = direction === 'output' ? edge.toNodeId : edge.fromNodeId
        const connectedNodeTitle = nodeById.get(connectedNodeId)?.title
        return { edge, direction, connectedNodeTitle }
      })
  }, [edges, nodeById, selectedNode])
  const relatedNodeIds = useMemo(() => {
    const related = new Set(selectedNodeIds)
    for (const edge of edges) {
      if (selectedNodeIds.includes(edge.fromNodeId) || selectedNodeIds.includes(edge.toNodeId)) {
        related.add(edge.fromNodeId)
        related.add(edge.toNodeId)
      }
    }
    return related
  }, [edges, selectedNodeIds])

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return clientPointToWorld({ x: clientX, y: clientY }, rect, viewport)
  }, [viewport])

  const getFilesFromList = useCallback((fileList: FileList | null) =>
    Array.from(fileList || []).filter(file => file.type.startsWith('image/')), [])

  const importImageFiles = useCallback(async (files: File[], point?: { x: number; y: number }) => {
    if (!files.length) return
    try {
      const basePoint = point || { x: 180, y: 180 }
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        await importImageAsset({
          file,
          fileName: file.name,
          title: file.name,
          x: basePoint.x + index * 34,
          y: basePoint.y + index * 34,
        })
      }
      toast({
        title: tCanvas('assets.importSuccess'),
        description: tCanvas('assets.importSuccessDescription', { count: files.length }),
      })
    } catch (importError) {
      toast({
        title: tCanvas('assets.importFailed'),
        description: importError instanceof Error ? importError.message : String(importError),
        variant: 'destructive',
      })
    }
  }, [importImageAsset, tCanvas])

  const commitViewport = useCallback((nextViewport: CreativeCanvasViewport, delay = 0) => {
    if (!project) return
    const targetProjectId = project.id
    setViewportState(nextViewport)
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current)
    const persist = () => {
      if (useCreativeCanvasStore.getState().activeProjectId === targetProjectId) {
        void persistViewport(nextViewport)
      }
    }
    if (delay > 0) {
      viewportPersistTimerRef.current = setTimeout(persist, delay)
    } else {
      persist()
    }
  }, [persistViewport, project])

  const updateZoom = useCallback((factor: number) => {
    if (!project) return
    commitViewport(zoomViewportAtPoint(
      viewport,
      clampCanvasZoom(viewport.k * factor),
      { x: canvasSize.width / 2, y: canvasSize.height / 2 },
    ))
  }, [canvasSize.height, canvasSize.width, commitViewport, project, viewport])

  const fitCanvas = useCallback(() => {
    commitViewport(fitNodesInViewport(nodes, canvasSize))
  }, [canvasSize, commitViewport, nodes])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!project) return
    const target = event.target as HTMLElement
    if (target.closest('[data-canvas-no-zoom]')) return
    event.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextZoom = clampCanvasZoom(viewport.k * Math.pow(1.0018, -event.deltaY))
    commitViewport(zoomViewportAtPoint(viewport, nextZoom, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }), 180)
  }, [commitViewport, project, viewport])

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-canvas-menu]') || target.closest('[data-canvas-no-zoom]')) return
    const overNode = Boolean(target.closest('[data-canvas-node]'))
    const wantsPan = event.button === 1 || (event.button === 0 && (spacePressed || !overNode))
    if (!wantsPan || (event.button === 0 && overNode && !spacePressed)) return
    setContextMenu(null)
    setSelectedEdgeId(null)
    if (event.button === 0 && !spacePressed && (boxSelectMode || event.ctrlKey || event.metaKey)) {
      const point = clientToWorld(event.clientX, event.clientY)
      setSelectionState({
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (!spacePressed) selectNodes([])
    setPanState({
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [boxSelectMode, clientToWorld, selectNodes, spacePressed, viewport])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (connectionDrag) {
      const point = clientToWorld(event.clientX, event.clientY)
      setConnectionDrag({ ...connectionDrag, currentX: point.x, currentY: point.y })
      return
    }

    if (selectionState) {
      const point = clientToWorld(event.clientX, event.clientY)
      setSelectionState({ ...selectionState, currentX: point.x, currentY: point.y })
      return
    }

    if (dragState) {
      const dx = (event.clientX - dragState.startClientX) / viewport.k
      const dy = (event.clientY - dragState.startClientY) / viewport.k
      const snap = project?.settings?.snapToGrid ? 16 : 1
      const nextRects = Object.fromEntries(dragState.nodeIds.map((nodeId) => {
        const start = dragState.startPositions[nodeId]
        return [nodeId, {
          x: Math.round((start.x + dx) / snap) * snap,
          y: Math.round((start.y + dy) / snap) * snap,
        }]
      }))
      setDraftNodeRects(current => ({ ...current, ...nextRects }))
      return
    }

    if (resizeState) {
      const width = Math.max(180, resizeState.startWidth + (event.clientX - resizeState.startClientX) / viewport.k)
      const height = Math.max(120, resizeState.startHeight + (event.clientY - resizeState.startClientY) / viewport.k)
      setDraftNodeRects(current => ({
        ...current,
        [resizeState.nodeId]: {
          ...(current[resizeState.nodeId] || {}),
          x: nodeById.get(resizeState.nodeId)?.x || 0,
          y: nodeById.get(resizeState.nodeId)?.y || 0,
          width: Math.round(width),
          height: Math.round(height),
        },
      }))
      return
    }

    if (panState) {
      setViewportState({
        ...viewport,
        x: Math.round(panState.startX + event.clientX - panState.startClientX),
        y: Math.round(panState.startY + event.clientY - panState.startClientY),
      })
    }
  }, [clientToWorld, connectionDrag, dragState, nodeById, panState, project?.settings?.snapToGrid, resizeState, selectionState, viewport])

  const stopPointerInteraction = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionState) {
      const rect = getSelectionRect(selectionState)
      const selectedIds = rect.width < 3 && rect.height < 3
        ? []
        : nodes.filter(node => canvasRectIntersectsNode(rect, node)).map(node => node.id)
      selectNodes(selectedIds)
      setBoxSelectMode(false)
    }

    if (dragState) {
      const positions = Object.fromEntries(dragState.nodeIds
        .map(nodeId => [nodeId, draftNodeRects[nodeId]] as const)
        .filter((entry): entry is [string, { x: number; y: number; width?: number; height?: number }] => Boolean(entry[1]))
        .map(([nodeId, rect]) => [nodeId, { x: rect.x, y: rect.y }]))
      void moveNodes(positions)
    }

    if (resizeState) {
      const rect = draftNodeRects[resizeState.nodeId]
      if (rect?.width && rect?.height) void resizeNode(resizeState.nodeId, rect.width, rect.height)
    }

    if (connectionDrag) {
      const target = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-canvas-input-node-id]') as HTMLElement | null
      const toNodeId = target?.dataset.canvasInputNodeId
      if (toNodeId && toNodeId !== connectionDrag.fromNodeId) {
        void connectNodes(connectionDrag.fromNodeId, toNodeId)
      }
    }

    if (panState) commitViewport(viewport)
    setDragState(null)
    setPanState(null)
    setSelectionState(null)
    setResizeState(null)
    setConnectionDrag(null)
    setDraftNodeRects({})
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointer capture may already be released
    }
  }, [commitViewport, connectNodes, connectionDrag, draftNodeRects, dragState, moveNodes, nodes, panState, resizeNode, resizeState, selectNodes, selectionState, viewport])

  const handleCreateFlow = useCallback(async (autoRun = false) => {
    const prompt = promptDraft.trim()
    if (!prompt) {
      toast({ title: tCanvas('prompt.required'), variant: 'destructive' })
      return
    }
    await createGenerationFlow(prompt, { autoRun, sourcePath: initialSourcePath || undefined })
    setPromptDraft('')
  }, [createGenerationFlow, initialSourcePath, promptDraft, tCanvas])

  const handleDeleteProject = useCallback(async (projectId: string, title: string) => {
    setDeletingProjectId(projectId)
    try {
      await deleteProject(projectId)
      toast({ title: tCanvas('project.deleteSuccess'), description: title })
    } catch (deleteError) {
      toast({
        title: tCanvas('project.deleteFailed'),
        description: deleteError instanceof Error ? deleteError.message : String(deleteError),
        variant: 'destructive',
      })
    } finally {
      setDeletingProjectId(null)
    }
  }, [deleteProject, tCanvas])

  const handleRunSelected = useCallback(async () => {
    if (!selectedNodeIds.length) {
      toast({ title: tCanvas('selection.required'), variant: 'destructive' })
      return
    }
    if (selectedNodeIds.length > 1) {
      await runGenerationForNodes(selectedNodeIds)
      return
    }
    const generationStatus = await runGenerationForNode(selectedNodeIds[0])
    if (generationStatus === 'cancelled') {
      toast({ title: tCanvas('generation.cancelled') })
    }
  }, [runGenerationForNode, runGenerationForNodes, selectedNodeIds, tCanvas])

  const handleCancelJob = useCallback(async (jobId: string) => {
    await cancelGeneration(jobId)
    toast({ title: tCanvas('generation.cancelRequested') })
  }, [cancelGeneration, tCanvas])

  const handleInsertAsset = useCallback(async (assetId: string) => {
    try {
      const path = await insertAssetIntoNote(assetId)
      toast({ title: tCanvas('assets.insertSuccess'), description: path })
    } catch (insertError) {
      toast({ title: tCanvas('assets.insertFailed'), description: insertError instanceof Error ? insertError.message : String(insertError), variant: 'destructive' })
    }
  }, [insertAssetIntoNote, tCanvas])

  const handleAddAssetToCanvas = useCallback(async (assetId: string) => {
    try {
      await addImageNodeFromAsset(assetId, { x: 220, y: 220 })
      toast({ title: tCanvas('assets.addSuccess') })
    } catch (addError) {
      toast({
        title: tCanvas('assets.addFailed'),
        description: addError instanceof Error ? addError.message : String(addError),
        variant: 'destructive',
      })
    }
  }, [addImageNodeFromAsset, tCanvas])

  const handleExportSnapshot = useCallback(async () => {
    const snapshot = exportSnapshot()
    if (!snapshot) return
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
    toast({ title: tCanvas('snapshot.copied') })
  }, [exportSnapshot, tCanvas])

  const handleRecoverJobs = useCallback(async () => {
    const result = await recoverStaleJobs()
    const message = result.staleJobIds.length
      ? tCanvas('recovery.restored', { count: result.staleJobIds.length })
      : tCanvas('recovery.none')
    toast({ title: tCanvas('recovery.completed'), description: message })
  }, [recoverStaleJobs, tCanvas])

  const handleRetryJob = useCallback(async (jobId: string) => {
    try {
      await retryGenerationJob(jobId)
      toast({ title: tCanvas('jobs.retrySuccess') })
    } catch (retryError) {
      toast({
        title: tCanvas('jobs.retryFailed'),
        description: retryError instanceof Error ? retryError.message : String(retryError),
        variant: 'destructive',
      })
    }
  }, [retryGenerationJob, tCanvas])

  const handleCleanupAssets = useCallback(async () => {
    const plan = await analyzeAssetCleanup()
    const totalFiles = plan.orphanAssetFiles.length + plan.orphanThumbnailFiles.length
    if (!plan.unusedAssets.length && !totalFiles) {
      toast({ title: tCanvas('cleanup.emptyTitle'), description: tCanvas('cleanup.emptyDescription') })
      return
    }
    const confirmed = window.confirm(tCanvas('cleanup.confirm', {
      assets: plan.unusedAssets.length,
      files: totalFiles,
      bytes: formatBytes(plan.reclaimableBytes),
    }))
    if (!confirmed) return
    const result = await cleanupAssets()
    const message = tCanvas('cleanup.result', {
      assets: result.deletedAssetIds.length,
      files: result.deletedFiles.length,
      failures: result.failedFiles.length ? tCanvas('cleanup.failures', { count: result.failedFiles.length }) : '',
    })
    toast({ title: tCanvas('cleanup.completed'), description: message })
  }, [analyzeAssetCleanup, cleanupAssets, tCanvas])

  const handleImportCanvasJson = useCallback(async (fileList: FileList | null) => {
    const file = Array.from(fileList || []).find(item => item.name.toLowerCase().endsWith('.json') || item.type.includes('json'))
    if (!file) return
    try {
      const report = await importInfiniteCanvasJson(await file.text(), file.name.replace(/\.json$/i, ''))
      const importedNodeIds = report.snapshot.nodes.map(node => node.id)
      selectNodes(importedNodeIds)
      if (report.snapshot.nodes.length && canvasSize.width > 0 && canvasSize.height > 0) {
        commitViewport(fitNodesInViewport(report.snapshot.nodes, canvasSize))
      }
      const summary = tCanvas('jsonImport.summary', {
        nodes: report.snapshot.nodes.length,
        edges: report.snapshot.edges.length,
      })
      const warningMessage = report.warnings.length
        ? tCanvas('jsonImport.warnings', { warnings: report.warnings.join('\n') })
        : ''
      toast({
        title: tCanvas('jsonImport.completed'),
        description: [summary, warningMessage].filter(Boolean).join('\n'),
      })
    } catch (importError) {
      toast({
        title: tCanvas('jsonImport.failed'),
        description: importError instanceof Error ? importError.message : String(importError),
        variant: 'destructive',
      })
    }
  }, [canvasSize, commitViewport, importInfiniteCanvasJson, selectNodes, tCanvas])

  const openImportImageDialog = useCallback((point?: { x: number; y: number }) => {
    importPointRef.current = point || null
    imageInputRef.current?.click()
  }, [])

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const point = clientToWorld(event.clientX, event.clientY)
    const nodeElement = target.closest('[data-canvas-node-id]') as HTMLElement | null
    const nodeId = nodeElement?.dataset.canvasNodeId
    if (nodeId && !selectedNodeIds.includes(nodeId)) {
      selectNodes([nodeId])
    }
    event.preventDefault()
    setContextMenu({
      clientX: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
      clientY: Math.max(8, Math.min(event.clientY, window.innerHeight - 196)),
      worldX: point.x,
      worldY: point.y,
      nodeId,
    })
  }, [clientToWorld, selectNodes, selectedNodeIds])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = getFilesFromList(event.dataTransfer.files)
    if (!files.length) return
    void importImageFiles(files, clientToWorld(event.clientX, event.clientY))
  }, [clientToWorld, getFilesFromList, importImageFiles])

  const handleDuplicateSelected = useCallback(async () => {
    if (!selectedNodeIds.length) return
    const duplicated = await duplicateNodes(selectedNodeIds)
    copiedNodeIdsRef.current = duplicated.map(node => node.id)
  }, [duplicateNodes, selectedNodeIds])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [data-canvas-no-zoom]'))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isEditableTarget(event.target)) {
        event.preventDefault()
        setSpacePressed(true)
        return
      }
      if (isEditableTarget(event.target)) return

      const commandKey = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (commandKey && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) void redo()
        else void undo()
      } else if (commandKey && key === 'y') {
        event.preventDefault()
        void redo()
      } else if (commandKey && key === 'a') {
        event.preventDefault()
        selectNodes(nodes.map(node => node.id))
      } else if (commandKey && key === 'c') {
        event.preventDefault()
        copiedNodeIdsRef.current = [...selectedNodeIds]
      } else if (commandKey && key === 'v') {
        event.preventDefault()
        void duplicateNodes(copiedNodeIdsRef.current).then(duplicated => {
          if (duplicated.length) copiedNodeIdsRef.current = duplicated.map(node => node.id)
        })
      } else if (commandKey && key === 'd') {
        event.preventDefault()
        void handleDuplicateSelected()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selectedEdgeId) void deleteEdge(selectedEdgeId)
        else void deleteSelectedNodes()
        setSelectedEdgeId(null)
      } else if (event.key === 'Escape') {
        setContextMenu(null)
        setConnectionDrag(null)
        setSelectedEdgeId(null)
        setBoxSelectMode(false)
        selectNodes([])
      } else if (event.key === '0') {
        event.preventDefault()
        fitCanvas()
      } else if (event.key === '1') {
        event.preventDefault()
        commitViewport({ x: 0, y: 0, k: 1 })
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        updateZoom(1.12)
      } else if (event.key === '-') {
        event.preventDefault()
        updateZoom(0.88)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [commitViewport, deleteEdge, deleteSelectedNodes, duplicateNodes, fitCanvas, handleDuplicateSelected, nodes, redo, selectNodes, selectedEdgeId, selectedNodeIds, undo, updateZoom])

  const canvasBackgroundStyle = useMemo<React.CSSProperties>(() => {
    const mode = project?.settings?.backgroundMode || 'grid'
    if (mode === 'blank') return {}
    const gridSize = 48 * viewport.k
    const backgroundPosition = `${viewport.x % gridSize}px ${viewport.y % gridSize}px`
    if (mode === 'dots') {
      return {
        backgroundImage: 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.45) 1px, transparent 1.2px)',
        backgroundPosition,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }
    }
    return {
      backgroundImage: 'linear-gradient(to right, hsl(var(--border) / 0.48) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.48) 1px, transparent 1px)',
      backgroundPosition,
      backgroundSize: `${gridSize}px ${gridSize}px`,
    }
  }, [project?.settings?.backgroundMode, viewport.k, viewport.x, viewport.y])

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = getFilesFromList(event.currentTarget.files)
          void importImageFiles(files, importPointRef.current || undefined)
          event.currentTarget.value = ''
          importPointRef.current = null
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          void handleImportCanvasJson(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <Workflow className="size-4" />
              {tCanvas('canvasName')}
            </div>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => void ensureReady()} title={tCanvas('refresh')}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              placeholder={tCanvas('prompt.placeholder')}
              className="h-9"
            />
            <Button size="icon" className="size-9" onClick={() => void handleCreateFlow(false)} title={tCanvas('prompt.create')}>
              <Plus className="size-4" />
            </Button>
          </div>
          <Button className="h-9 w-full gap-2" onClick={() => void handleCreateFlow(true)}>
            <ImagePlus className="size-4" />
            {tCanvas('prompt.createAndRun')}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-3">
            <section className="space-y-2">
              <div className="flex h-7 items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">{tCanvas('project.section')}</div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => void createProject(tCanvas('project.defaultName', { number: projects.length + 1 }))}
                  title={tCanvas('project.new')}
                  aria-label={tCanvas('project.new')}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border border-border/80 bg-background">
                {projects.map((item, index) => {
                  const isActive = project?.id === item.id
                  const isDeleting = deletingProjectId === item.id
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'group/project flex min-w-0 items-center px-1 transition-colors',
                        index > 0 && 'border-t border-border/70',
                        isActive ? 'bg-secondary/80' : 'hover:bg-accent/60',
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex h-9 min-w-0 flex-1 items-center rounded-sm px-2 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          isActive && 'font-medium text-foreground',
                        )}
                        onClick={() => void openProject(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <span className="truncate" title={item.title}>{item.title}</span>
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn(
                              'size-8 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100',
                              isActive && 'opacity-70',
                              'group-hover/project:opacity-70 group-focus-within/project:opacity-70',
                            )}
                            disabled={isDeleting}
                            title={tCanvas('project.delete')}
                            aria-label={tCanvas('project.delete')}
                          >
                            {isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="max-w-sm gap-5">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{tCanvas('project.deleteTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {tCanvas('project.deleteDescription', { title: item.title })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tCanvas('project.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => void handleDeleteProject(item.id, item.title)}
                            >
                              {tCanvas('project.deleteConfirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )
                })}
                {!projects.length ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {tCanvas('project.empty')}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{tCanvas('model.section')}</div>
              <CreativeCanvasModelSelect
                value={project?.settings?.imageModelSelection}
                onValueChange={(imageModelSelection) => void updateProjectSettings({ imageModelSelection })}
                className="w-full"
                compact
              />
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">{tCanvas('appearance.section')}</div>
                <Button
                  size="sm"
                  variant={project?.settings?.snapToGrid ? 'secondary' : 'ghost'}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void updateProjectSettings({ snapToGrid: !project?.settings?.snapToGrid })}
                  title={tCanvas('appearance.snapHint')}
                >
                  <Crosshair className="size-3.5" />
                  {tCanvas('appearance.snap')}
                </Button>
              </div>
              <div
                role="radiogroup"
                aria-label={tCanvas('appearance.section')}
                className="grid grid-cols-3 rounded-md bg-muted p-0.5"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  role="radio"
                  aria-checked={(project?.settings?.backgroundMode || 'grid') === 'grid'}
                  className={cn(
                    'h-8 gap-1 rounded-[6px] px-2 text-xs font-normal text-muted-foreground shadow-none',
                    (project?.settings?.backgroundMode || 'grid') === 'grid' && 'bg-background font-medium text-foreground shadow-sm hover:bg-background',
                  )}
                  onClick={() => void updateProjectSettings({ backgroundMode: 'grid' })}
                >
                  <Grid3X3 className="size-3.5" />
                  {tCanvas('appearance.grid')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  role="radio"
                  aria-checked={project?.settings?.backgroundMode === 'dots'}
                  className={cn(
                    'h-8 gap-1 rounded-[6px] px-2 text-xs font-normal text-muted-foreground shadow-none',
                    project?.settings?.backgroundMode === 'dots' && 'bg-background font-medium text-foreground shadow-sm hover:bg-background',
                  )}
                  onClick={() => void updateProjectSettings({ backgroundMode: 'dots' })}
                >
                  <Circle className="size-3.5" />
                  {tCanvas('appearance.dots')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  role="radio"
                  aria-checked={project?.settings?.backgroundMode === 'blank'}
                  className={cn(
                    'h-8 rounded-[6px] px-2 text-xs font-normal text-muted-foreground shadow-none',
                    project?.settings?.backgroundMode === 'blank' && 'bg-background font-medium text-foreground shadow-sm hover:bg-background',
                  )}
                  onClick={() => void updateProjectSettings({ backgroundMode: 'blank' })}
                >
                  {tCanvas('appearance.blank')}
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">{tCanvas('assets.section')}</div>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => void handleCleanupAssets()} title={tCanvas('assets.cleanup')}>
                  <ArchiveX className="size-3.5" />
                </Button>
              </div>
              {assets.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {assets.map(asset => (
                    <AssetTile
                      key={asset.id}
                      asset={asset}
                      onInsert={handleInsertAsset}
                      onAddToCanvas={handleAddAssetToCanvas}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {tCanvas('assets.empty')}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">{tCanvas('jobs.section')}</div>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => void handleRecoverJobs()} title={tCanvas('jobs.recover')}>
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <div className="space-y-1">
                {jobs.slice(0, 8).map(job => (
                  <div key={job.id} className="rounded-md border border-border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{job.prompt || job.id}</span>
                      <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0 text-[10px]">{tCanvas(`jobs.${job.status}`)}</Badge>
                    </div>
                    {job.status === 'failed' || job.status === 'stale' ? (
                      <Button size="sm" variant="ghost" className="mt-1 h-7 w-full gap-1 text-xs" onClick={() => void handleRetryJob(job.id)}>
                        <RefreshCw className="size-3.5" />
                        {tCanvas('jobs.retry')}
                      </Button>
                    ) : null}
                    {job.status === 'running' || job.status === 'queued' ? (
                      <Button size="sm" variant="ghost" className="mt-1 h-7 w-full gap-1 text-xs" onClick={() => void handleCancelJob(job.id)}>
                        <Trash2 className="size-3.5" />
                        {tCanvas('actions.cancel')}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {!jobs.length ? <div className="text-xs text-muted-foreground">{tCanvas('jobs.empty')}</div> : null}
              </div>
            </section>
          </div>
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="icon" variant="ghost" className="size-8" onClick={() => void undo()} disabled={!historyPast.length} title={tCanvas('toolbar.undo')}>
                <Undo2 className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => void redo()} disabled={!historyFuture.length} title={tCanvas('toolbar.redo')}>
                <Redo2 className="size-4" />
              </Button>
            </div>
            <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="icon" variant={!boxSelectMode ? 'secondary' : 'ghost'} className="size-8" onClick={() => setBoxSelectMode(false)} title={tCanvas('toolbar.select')}>
                <MousePointer2 className="size-4" />
              </Button>
              <Button size="icon" variant={boxSelectMode ? 'secondary' : 'ghost'} className="size-8" onClick={() => setBoxSelectMode(value => !value)} title={tCanvas('toolbar.box')}>
                <BoxSelect className="size-4" />
              </Button>
            </div>
            <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="icon" variant="ghost" className="size-8" onClick={() => void addNode({ type: 'text', x: 180, y: 180 })} title={tCanvas('toolbar.text')}>
                <Plus className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => openImportImageDialog({ x: 220, y: 220 })} title={tCanvas('toolbar.importImage')}>
                <ImagePlus className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => jsonInputRef.current?.click()} title={tCanvas('toolbar.importJson')}>
                <FileJson className="size-4" />
              </Button>
            </div>
            <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="icon" variant="ghost" className="size-8" onClick={handleRunSelected} disabled={!selectedNodeIds.length || selectedNode?.metadata.status === 'running'} title={selectedNodeIds.length > 1 ? tCanvas('toolbar.runMany') : tCanvas('toolbar.run')}>
                {selectedNode?.metadata.status === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => void handleDuplicateSelected()} disabled={!selectedNodeIds.length} title={tCanvas('toolbar.duplicate')}>
                <Copy className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void deleteSelectedNodes()} disabled={!selectedNodeIds.length} title={tCanvas('toolbar.delete')}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={handleExportSnapshot} title={tCanvas('toolbar.export')}>
              <Save className="size-4" />
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="icon" variant="ghost" className="size-8" onClick={fitCanvas} title={tCanvas('toolbar.fit')}>
              <Maximize2 className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={project?.settings?.showMiniMap === false ? 'ghost' : 'secondary'}
              className="size-8"
              onClick={() => void updateProjectSettings({ showMiniMap: project?.settings?.showMiniMap === false })}
              title={tCanvas('appearance.toggleMinimap')}
            >
              <MapIcon className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => updateZoom(0.9)} title={tCanvas('toolbar.zoomOut')}>
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-14 text-center text-xs text-muted-foreground">{Math.round(viewport.k * 100)}%</span>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => updateZoom(1.1)} title={tCanvas('toolbar.zoomIn')}>
              <ZoomIn className="size-4" />
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        ) : null}

        <div
          ref={canvasRef}
          className={cn(
            'relative min-h-0 flex-1 touch-none overflow-hidden bg-background select-none',
            panState || spacePressed ? 'cursor-grabbing' : boxSelectMode ? 'cursor-crosshair' : 'cursor-grab',
          )}
          style={canvasBackgroundStyle}
          onWheel={handleWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointerInteraction}
          onPointerCancel={stopPointerInteraction}
          onContextMenu={handleCanvasContextMenu}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
              transformOrigin: '0 0',
            }}
          >
            <svg className="absolute left-0 top-0 h-px w-px overflow-visible">
              {edges.map(edge => {
                const from = nodeById.get(edge.fromNodeId)
                const to = nodeById.get(edge.toNodeId)
                if (!from || !to) return null
                const path = createCanvasConnectionPath(
                  { x: from.x + from.width, y: from.y + from.height / 2 },
                  { x: to.x, y: to.y + to.height / 2 },
                )
                const active = selectedEdgeId === edge.id
                  || selectedNodeIds.includes(edge.fromNodeId)
                  || selectedNodeIds.includes(edge.toNodeId)
                return (
                  <g key={edge.id}>
                    <path
                      data-canvas-edge-id={edge.id}
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="18"
                      className="cursor-pointer"
                      style={{ pointerEvents: 'stroke' }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        setSelectedEdgeId(edge.id)
                        selectNodes([])
                      }}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                      strokeOpacity={active ? 0.9 : 0.42}
                      strokeWidth={active ? 3 : 2}
                      className="pointer-events-none"
                    />
                  </g>
                )
              })}
              {connectionDrag ? (() => {
                const from = nodeById.get(connectionDrag.fromNodeId)
                if (!from) return null
                return (
                  <path
                    d={createCanvasConnectionPath(
                      { x: from.x + from.width, y: from.y + from.height / 2 },
                      { x: connectionDrag.currentX, y: connectionDrag.currentY },
                    )}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                    strokeDasharray="6 5"
                    className="pointer-events-none"
                  />
                )
              })() : null}
            </svg>

            {selectionState ? (
              <div
                className="pointer-events-none absolute border border-primary bg-primary/10"
                style={{
                  transform: `translate(${getSelectionRect(selectionState).x}px, ${getSelectionRect(selectionState).y}px)`,
                  width: getSelectionRect(selectionState).width,
                  height: getSelectionRect(selectionState).height,
                }}
              />
            ) : null}

            {displayNodes.map(node => {
              const selected = selectedNodeIds.includes(node.id)
              const related = relatedNodeIds.has(node.id)
              const asset = node.metadata.assetId ? assetById.get(String(node.metadata.assetId)) : undefined
              return (
                <div
                  key={node.id}
                  data-canvas-node
                  data-canvas-node-id={node.id}
                  className={cn(
                    'absolute flex flex-col rounded-md border shadow-sm transition-[box-shadow,border-color,opacity]',
                    getStatusTone(node.metadata.status),
                    selected && 'ring-2 ring-primary',
                    !selected && related && 'border-primary/50 shadow-md',
                    selectedNodeIds.length > 0 && !related && 'opacity-65',
                  )}
                  style={{
                    transform: `translate(${node.x}px, ${node.y}px)`,
                    width: node.width,
                    height: node.height,
                  }}
                  onPointerDown={(event) => {
                    if (spacePressed) return
                    event.stopPropagation()
                    setSelectedEdgeId(null)
                    const additive = event.shiftKey || event.ctrlKey || event.metaKey
                    const nextSelection = additive
                      ? selectedNodeIds.includes(node.id)
                        ? selectedNodeIds.filter(id => id !== node.id)
                        : [...selectedNodeIds, node.id]
                      : selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id]
                    selectNodes(nextSelection)
                    const dragNodeIds = nextSelection.includes(node.id) ? nextSelection : [node.id]
                    setDragState({
                      nodeIds: dragNodeIds,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      startPositions: Object.fromEntries(dragNodeIds.map((id) => {
                        const item = nodeById.get(id)
                        return [id, { x: item?.x || 0, y: item?.y || 0 }]
                      })),
                    })
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                >
                  <button
                    type="button"
                    data-canvas-input-node-id={node.id}
                    aria-label={tCanvas('ports.connectTo', { title: node.title })}
                    title={tCanvas('ports.input')}
                    className="absolute -left-2 top-1/2 z-10 size-4 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground shadow-sm transition-transform hover:scale-125 hover:bg-primary"
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                  <button
                    type="button"
                    aria-label={tCanvas('ports.connectFrom', { title: node.title })}
                    title={tCanvas('ports.output')}
                    className="absolute -right-2 top-1/2 z-10 size-4 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm transition-transform hover:scale-125"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const point = clientToWorld(event.clientX, event.clientY)
                      setConnectionDrag({ fromNodeId: node.id, currentX: point.x, currentY: point.y })
                      canvasRef.current?.setPointerCapture(event.pointerId)
                    }}
                  />
                  <div className="flex h-9 shrink-0 cursor-move items-center gap-1 border-b border-border/70 px-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{node.title}</span>
                    {node.metadata.status === 'running' ? <Loader2 className="size-3.5 animate-spin text-blue-500" /> : null}
                  </div>
                  <div
                    className="min-h-0 flex-1 p-3"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <NodeBody
                      key={`${node.id}-${node.updatedAt}`}
                      node={node}
                      asset={asset}
                      onMetadataChange={(metadata) => void updateNode(node.id, { metadata })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={tCanvas('ports.resize', { title: node.title })}
                    title={tCanvas('ports.resizeHint')}
                    className="absolute -bottom-1.5 -right-1.5 z-10 size-4 cursor-se-resize rounded-sm border border-background bg-muted-foreground shadow-sm hover:bg-primary"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectNodes([node.id])
                      setResizeState({
                        nodeId: node.id,
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        startWidth: node.width,
                        startHeight: node.height,
                      })
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                  />
                </div>
              )
            })}
          </div>
          {project?.settings?.showMiniMap !== false ? (
            <CanvasMiniMap
              nodes={displayNodes}
              viewport={viewport}
              canvasSize={canvasSize}
              onViewportChange={(nextViewport) => commitViewport(nextViewport)}
            />
          ) : null}
          {contextMenu ? (
            <div
              data-canvas-menu
              className="fixed z-50 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button className="flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-muted" onClick={() => { void addNode({ type: 'text', x: contextMenu.worldX, y: contextMenu.worldY }); setContextMenu(null) }}>
                {tCanvas('context.text')}
              </button>
              <button className="flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-muted" onClick={() => { void addNode({ type: 'config', x: contextMenu.worldX, y: contextMenu.worldY }); setContextMenu(null) }}>
                {tCanvas('context.config')}
              </button>
              <button className="flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-muted" onClick={() => { openImportImageDialog({ x: contextMenu.worldX, y: contextMenu.worldY }); setContextMenu(null) }}>
                {tCanvas('context.image')}
              </button>
              <button className="flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-muted" disabled={!selectedNodeIds.length} onClick={() => { void handleRunSelected(); setContextMenu(null) }}>
                {tCanvas('context.run')}
              </button>
              <button className="flex h-8 w-full items-center rounded px-2 text-left text-xs text-destructive hover:bg-destructive/10" disabled={!selectedNodeIds.length} onClick={() => { void deleteSelectedNodes(); setContextMenu(null) }}>
                {tCanvas('context.delete')}
              </button>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="flex w-80 min-w-0 shrink-0 flex-col border-l border-border bg-muted/10">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 pr-12">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{tCanvas('inspector.title')}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {selectedNode?.title || tCanvas('inspector.none')}
            </div>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="w-full min-w-0">
            {selectedNode ? (
              <div className="w-full min-w-0 space-y-5 p-3">
                <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                  <span className="text-xs font-medium text-muted-foreground">{tCanvas('inspector.status')}</span>
                  <Badge variant={selectedNode.metadata.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0 shadow-none">
                    {tCanvas(`jobs.${selectedNode.metadata.status || 'idle'}`)}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{tCanvas('inspector.nodeTitle')}</label>
                    <Input
                      key={`${selectedNode.id}-title`}
                      defaultValue={selectedNode.title}
                      className="h-9 shadow-none"
                      onBlur={(event) => void updateNode(selectedNode.id, { title: event.currentTarget.value || selectedNode.title })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tCanvas('inspector.width')}</label>
                      <Input
                        key={`${selectedNode.id}-width`}
                        type="number"
                        defaultValue={selectedNode.width}
                        className="h-9 shadow-none"
                        onBlur={(event) => void resizeNode(selectedNode.id, Number(event.currentTarget.value) || selectedNode.width, selectedNode.height)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tCanvas('inspector.height')}</label>
                      <Input
                        key={`${selectedNode.id}-height`}
                        type="number"
                        defaultValue={selectedNode.height}
                        className="h-9 shadow-none"
                        onBlur={(event) => void resizeNode(selectedNode.id, selectedNode.width, Number(event.currentTarget.value) || selectedNode.height)}
                      />
                    </div>
                  </div>
                  {selectedNode.type === 'config' ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tCanvas('model.node')}</label>
                      <CreativeCanvasModelSelect
                        value={selectedNode.metadata.modelSelection}
                        onValueChange={(modelSelection) => void updateNode(selectedNode.id, { metadata: { modelSelection } })}
                        inheritLabel={tCanvas('model.inheritCanvas')}
                        className="w-full"
                        compact
                      />
                    </div>
                  ) : null}
                </div>

                {selectedNode.metadata.assetId ? (
                  <Button className="w-full gap-2 shadow-none" variant="secondary" onClick={() => void handleInsertAsset(String(selectedNode.metadata.assetId))}>
                    <ArrowDownToLine className="size-4" />
                    {tCanvas('inspector.insertCurrentImage')}
                  </Button>
                ) : null}

                <div className="space-y-2 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-muted-foreground">{tCanvas('inspector.edges')}</label>
                    {selectedConnections.length ? (
                      <span className="text-[11px] text-muted-foreground">
                        {tCanvas('inspector.input')} {selectedConnections.filter(connection => connection.direction === 'input').length}
                        {' / '}
                        {tCanvas('inspector.output')} {selectedConnections.filter(connection => connection.direction === 'output').length}
                      </span>
                    ) : null}
                  </div>
                  {selectedConnections.length ? (
                    <div className="divide-y divide-border rounded-md bg-muted/50 px-2">
                      {selectedConnections.map(connection => (
                        <div key={connection.edge.id} className="flex min-w-0 items-center gap-2 py-2">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border">
                            {connection.direction === 'output'
                              ? <ArrowRightFromLine className="size-3.5" />
                              : <ArrowLeftToLine className="size-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium" title={connection.connectedNodeTitle}>
                              {connection.connectedNodeTitle || tCanvas('inspector.unknownNode')}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {tCanvas(connection.direction === 'output' ? 'inspector.output' : 'inspector.input')}
                            </div>
                          </div>
                          <Button size="icon" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => void deleteEdge(connection.edge.id)} title={tCanvas('inspector.deleteEdge')}>
                            <Unlink className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-xs text-muted-foreground">{tCanvas('inspector.noEdges')}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-48 w-full min-w-0 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <MousePointer2 className="size-5" />
                <div className="max-w-56 break-words whitespace-normal text-sm leading-relaxed">{tCanvas('inspector.help')}</div>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  )
}

export default CreativeCanvasWorkspace
