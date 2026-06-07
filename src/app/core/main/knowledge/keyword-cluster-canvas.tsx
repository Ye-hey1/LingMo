'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeywordClusterGraph,
  KeywordClusterKeyword,
  KeywordClusterSelection,
} from './keyword-cluster-data'

interface KeywordClusterCanvasProps {
  graph: KeywordClusterGraph
  selectedId: string | null
  onSelect: (selection: KeywordClusterSelection | null) => void
  onOpenNote: (path: string) => void
  showLabels: boolean
}

interface ViewTransform {
  zoom: number
  pan: { x: number; y: number }
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3.8

export function KeywordClusterCanvas({
  graph,
  selectedId,
  onSelect,
  onOpenNote,
  showLabels,
}: KeywordClusterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  })
  const [view, setView] = useState<ViewTransform>({ zoom: 1, pan: { x: 0, y: 0 } })
  const [hovered, setHovered] = useState<KeywordClusterSelection | null>(null)

  const keywordById = useMemo(() => {
    const index = new Map<string, KeywordClusterKeyword>()
    for (const keyword of graph.keywordNodes) index.set(keyword.id, keyword)
    return index
  }, [graph.keywordNodes])

  const fitGraph = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || (graph.clusters.length === 0 && graph.keywordNodes.length === 0)) return
    const rect = canvas.getBoundingClientRect()
    const bounds = getGraphBounds(graph)
    const width = Math.max(bounds.right - bounds.left, 1)
    const height = Math.max(bounds.bottom - bounds.top, 1)
    const zoom = clamp(Math.min(rect.width / width, rect.height / height) * 0.76, MIN_ZOOM, 1.3)
    setView({
      zoom,
      pan: {
        x: -((bounds.left + bounds.right) / 2) * zoom,
        y: -((bounds.top + bounds.bottom) / 2) * zoom,
      },
    })
  }, [graph])

  useEffect(() => {
    fitGraph()
  }, [fitGraph])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.floor(rect.width * dpr))
      const height = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.fillStyle = getCanvasBackground()
      ctx.fillRect(0, 0, rect.width, rect.height)
      ctx.translate(rect.width / 2 + view.pan.x, rect.height / 2 + view.pan.y)
      ctx.scale(view.zoom, view.zoom)

      drawEdges(ctx, graph, keywordById, hovered, selectedId)
      drawClusters(ctx, graph, hovered, selectedId)
      drawKeywords(ctx, graph, hovered, selectedId, showLabels)
      ctx.restore()
    }

    render()
  }, [graph, hovered, keywordById, selectedId, showLabels, view])

  const toWorldPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - rect.width / 2 - view.pan.x) / view.zoom,
      y: (clientY - rect.top - rect.height / 2 - view.pan.y) / view.zoom,
    }
  }, [view])

  const hitTest = useCallback((clientX: number, clientY: number): KeywordClusterSelection | null => {
    const point = toWorldPoint(clientX, clientY)
    if (!point) return null

    let nearestKeyword: KeywordClusterSelection | null = null
    let nearestKeywordDistance = Number.POSITIVE_INFINITY
    for (const keyword of graph.keywordNodes) {
      const distance = distanceBetween(point.x, point.y, keyword.x, keyword.y)
      const hitRadius = Math.max(keyword.radius + 6, 10) / Math.max(view.zoom, 0.7)
      if (distance <= hitRadius && distance < nearestKeywordDistance) {
        nearestKeyword = { type: 'keyword', id: keyword.id }
        nearestKeywordDistance = distance
      }
    }
    if (nearestKeyword) return nearestKeyword

    let nearestCluster: KeywordClusterSelection | null = null
    let nearestClusterDistance = Number.POSITIVE_INFINITY
    for (const cluster of graph.clusters) {
      const distance = distanceBetween(point.x, point.y, cluster.x, cluster.y)
      if (distance <= cluster.radius + 8 && distance < nearestClusterDistance) {
        nearestCluster = { type: 'cluster', id: cluster.id }
        nearestClusterDistance = distance
      }
    }
    return nearestCluster
  }, [graph.clusters, graph.keywordNodes, toWorldPoint, view.zoom])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.active) {
      const deltaX = event.clientX - dragRef.current.lastX
      const deltaY = event.clientY - dragRef.current.lastY
      dragRef.current.lastX = event.clientX
      dragRef.current.lastY = event.clientY
      if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
        dragRef.current.moved = true
      }
      setView(current => ({
        ...current,
        pan: {
          x: current.pan.x + deltaX,
          y: current.pan.y + deltaY,
        },
      }))
      return
    }

    const hit = hitTest(event.clientX, event.clientY)
    setHovered(hit)
    event.currentTarget.style.cursor = hit ? 'pointer' : 'grab'
  }, [hitTest])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    }
  }, [])

  const stopDragging = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current.active = false
  }, [])

  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.moved) return
    onSelect(hitTest(event.clientX, event.clientY))
  }, [hitTest, onSelect])

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTest(event.clientX, event.clientY)
    if (hit?.type === 'keyword') {
      const keyword = keywordById.get(hit.id)
      const firstNote = keyword?.notePaths[0]
      if (firstNote) onOpenNote(firstNote)
      return
    }
    fitGraph()
  }, [fitGraph, hitTest, keywordById, onOpenNote])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left - rect.width / 2
    const mouseY = event.clientY - rect.top - rect.height / 2
    setView(current => {
      const nextZoom = clamp(current.zoom * (event.deltaY > 0 ? 0.88 : 1.12), MIN_ZOOM, MAX_ZOOM)
      const graphX = (mouseX - current.pan.x) / current.zoom
      const graphY = (mouseY - current.pan.y) / current.zoom
      return {
        zoom: nextZoom,
        pan: {
          x: mouseX - graphX * nextZoom,
          y: mouseY - graphY * nextZoom,
        },
      }
    })
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="relative h-full w-full touch-none"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerLeave={(event) => {
        setHovered(null)
        stopDragging(event)
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={event => event.preventDefault()}
    />
  )
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  graph: KeywordClusterGraph,
  keywordById: Map<string, KeywordClusterKeyword>,
  hovered: KeywordClusterSelection | null,
  selectedId: string | null,
) {
  const focusId = hovered?.id ?? selectedId
  for (const edge of graph.edges) {
    const active = isFocusedEdge(edge.source, edge.target, focusId)
    if (edge.type === 'keyword-cooccurrence' && !active && (edge.noteCount ?? 0) < 3) continue
    const source = getNodePosition(graph, keywordById, edge.source)
    const target = getNodePosition(graph, keywordById, edge.target)
    if (!source || !target) continue
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.strokeStyle = edge.type === 'cluster-keyword'
      ? withAlpha(source.color ?? '#64748b', active ? 0.42 : 0.16)
      : `rgba(79, 70, 229, ${active ? 0.34 : 0.1})`
    ctx.lineWidth = edge.type === 'cluster-keyword' ? 1.1 : Math.min(2.5, 0.5 + (edge.noteCount ?? 1) * 0.35)
    ctx.stroke()
  }
}

function drawClusters(
  ctx: CanvasRenderingContext2D,
  graph: KeywordClusterGraph,
  hovered: KeywordClusterSelection | null,
  selectedId: string | null,
) {
  const focusClusterId = hovered?.type === 'keyword'
    ? graph.keywordNodes.find(keyword => keyword.id === hovered.id)?.clusterId
    : hovered?.id ?? selectedId

  for (const cluster of graph.clusters) {
    const active = cluster.id === focusClusterId || cluster.id === selectedId
    const dimmed = Boolean(focusClusterId) && !active
    ctx.save()
    ctx.globalAlpha = dimmed ? 0.32 : 1
    ctx.beginPath()
    ctx.arc(cluster.x, cluster.y, cluster.radius, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(cluster.color, active ? 0.1 : 0.045)
    ctx.fill()
    ctx.lineWidth = active ? 3.2 : 2
    ctx.strokeStyle = withAlpha(cluster.color, active ? 0.82 : 0.5)
    ctx.stroke()
    if (active) {
      ctx.beginPath()
      ctx.arc(cluster.x, cluster.y, cluster.radius + 8, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(cluster.color, 0.2)
      ctx.lineWidth = 8
      ctx.stroke()
    }
    ctx.fillStyle = getTextColor()
    ctx.font = '700 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    drawFittedText(ctx, cluster.label, cluster.x, cluster.y - 7, Math.max(44, cluster.radius * 1.45))
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.fillStyle = getMutedTextColor()
    ctx.fillText(`${cluster.noteCount} 篇 / ${cluster.keywords.length} 词`, cluster.x, cluster.y + 14)
    ctx.restore()
  }
}

function drawKeywords(
  ctx: CanvasRenderingContext2D,
  graph: KeywordClusterGraph,
  hovered: KeywordClusterSelection | null,
  selectedId: string | null,
  showLabels: boolean,
) {
  const focusClusterId = hovered?.type === 'cluster'
    ? hovered.id
    : graph.keywordNodes.find(keyword => keyword.id === (hovered?.id ?? selectedId))?.clusterId

  for (const keyword of graph.keywordNodes) {
    const cluster = graph.clusters.find(item => item.id === keyword.clusterId)
    const color = cluster?.color ?? freeKeywordColor(keyword)
    const active = keyword.id === hovered?.id || keyword.id === selectedId || Boolean(focusClusterId && keyword.clusterId === focusClusterId)
    const dimmed = Boolean(focusClusterId) && !active
    ctx.save()
    ctx.globalAlpha = dimmed ? 0.28 : 1
    ctx.beginPath()
    ctx.arc(keyword.x, keyword.y, keyword.radius, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(color, active ? 0.95 : keyword.clusterId ? 0.78 : 0.72)
    ctx.fill()
    ctx.lineWidth = active ? 2.2 : keyword.clusterId ? 1 : 0.8
    ctx.strokeStyle = withAlpha('#ffffff', active ? 0.9 : 0.48)
    ctx.stroke()
    if (showLabels || active) {
      ctx.font = `${active ? 600 : 500} 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const label = trimLabel(keyword.keyword, active ? 18 : 12)
      const width = ctx.measureText(label).width + 10
      ctx.fillStyle = getLabelBackground()
      roundRect(ctx, keyword.x - width / 2, keyword.y + keyword.radius + 5, width, 20, 6)
      ctx.fill()
      ctx.fillStyle = active ? color : keyword.clusterId ? getTextColor() : getMutedTextColor()
      ctx.fillText(label, keyword.x, keyword.y + keyword.radius + 9)
    }
    ctx.restore()
  }
}

function getNodePosition(
  graph: KeywordClusterGraph,
  keywordById: Map<string, KeywordClusterKeyword>,
  id: string,
) {
  const cluster = graph.clusters.find(item => item.id === id)
  if (cluster) return { x: cluster.x, y: cluster.y, color: cluster.color }
  const keyword = keywordById.get(id)
  if (!keyword) return null
  const keywordCluster = graph.clusters.find(item => item.id === keyword.clusterId)
  return { x: keyword.x, y: keyword.y, color: keywordCluster?.color ?? freeKeywordColor(keyword) }
}

function getGraphBounds(graph: KeywordClusterGraph) {
  const points = [
    ...graph.clusters.map(cluster => ({
      left: cluster.x - cluster.radius - 120,
      right: cluster.x + cluster.radius + 120,
      top: cluster.y - cluster.radius - 90,
      bottom: cluster.y + cluster.radius + 90,
    })),
    ...graph.keywordNodes.map(keyword => ({
      left: keyword.x - 80,
      right: keyword.x + 80,
      top: keyword.y - 50,
      bottom: keyword.y + 50,
    })),
  ]
  if (points.length === 0) return { left: -200, right: 200, top: -160, bottom: 160 }
  return {
    left: Math.min(...points.map(point => point.left)),
    right: Math.max(...points.map(point => point.right)),
    top: Math.min(...points.map(point => point.top)),
    bottom: Math.max(...points.map(point => point.bottom)),
  }
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y)
    return
  }
  let fitted = text
  while (fitted.length > 2 && ctx.measureText(`${fitted}...`).width > maxWidth) {
    fitted = fitted.slice(0, -1)
  }
  ctx.fillText(`${fitted}...`, x, y)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function isFocusedEdge(source: string, target: string, focusId: string | null) {
  return Boolean(focusId && (source === focusId || target === focusId))
}

function withAlpha(color: string, alpha: number) {
  if (!color.startsWith('#')) return color
  const hex = color.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex
  const value = Number.parseInt(full, 16)
  if (Number.isNaN(value)) return `rgba(100, 116, 139, ${alpha})`
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function trimLabel(label: string, limit: number) {
  return label.length > limit ? `${label.slice(0, limit - 1)}...` : label
}

function freeKeywordColor(keyword: KeywordClusterKeyword) {
  const palette = ['#14b8a6', '#06b6d4', '#f59e0b', '#64748b', '#84cc16']
  return palette[Math.abs(hashString(keyword.keyword)) % palette.length]
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return hash
}

function distanceBetween(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getCanvasBackground() {
  if (typeof document === 'undefined') return '#ffffff'
  return document.documentElement.classList.contains('dark') ? '#09090b' : '#ffffff'
}

function getTextColor() {
  if (typeof document === 'undefined') return '#18181b'
  return document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b'
}

function getMutedTextColor() {
  if (typeof document === 'undefined') return '#71717a'
  return document.documentElement.classList.contains('dark') ? '#a1a1aa' : '#71717a'
}

function getLabelBackground() {
  if (typeof document === 'undefined') return 'rgba(255,255,255,0.82)'
  return document.documentElement.classList.contains('dark')
    ? 'rgba(24,24,27,0.78)'
    : 'rgba(255,255,255,0.82)'
}
