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
  const animationStartRef = useRef(0)

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
    animationStartRef.current = 0
  }, [fitGraph])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let rafId = 0
    let cancelled = false
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const render = (now: number) => {
      if (!animationStartRef.current) animationStartRef.current = now
      const elapsed = reducedMotion ? 900 : now - animationStartRef.current
      const progress = reducedMotion ? 1 : easeOutCubic(clamp(elapsed / 720, 0, 1))
      const pulse = reducedMotion ? 0 : Math.sin(now / 820) * 0.5 + 0.5
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
      drawBackdrop(ctx, rect.width, rect.height, progress)
      ctx.translate(rect.width / 2 + view.pan.x, rect.height / 2 + view.pan.y)
      ctx.scale(view.zoom, view.zoom)

      drawEdges(ctx, graph, keywordById, hovered, selectedId, progress)
      drawClusters(ctx, graph, hovered, selectedId, progress, pulse)
      drawKeywords(ctx, graph, hovered, selectedId, showLabels, progress, pulse)
      ctx.restore()

      if (!cancelled && !reducedMotion && (progress < 1 || hovered || selectedId)) {
        rafId = requestAnimationFrame(render)
      }
    }

    rafId = requestAnimationFrame(render)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
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
  progress: number,
) {
  const focusId = hovered?.id ?? selectedId
  for (const edge of graph.edges) {
    if (edge.type === 'keyword-cooccurrence' && !isFocusedEdge(edge.source, edge.target, focusId)) continue
    const source = getNodePosition(graph, keywordById, edge.source)
    const target = getNodePosition(graph, keywordById, edge.target)
    if (!source || !target) continue
    const active = isFocusedEdge(edge.source, edge.target, focusId)
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    if (edge.type === 'cluster-keyword') {
      const midX = (source.x + target.x) / 2
      const midY = (source.y + target.y) / 2
      ctx.quadraticCurveTo(midX, midY, target.x, target.y)
    } else {
      ctx.lineTo(target.x, target.y)
    }
    ctx.strokeStyle = edge.type === 'cluster-keyword'
      ? withAlpha(source.color ?? '#64748b', (active ? 0.38 : 0.12) * progress)
      : `rgba(100, 116, 139, ${(active ? 0.36 : 0.1) * progress})`
    ctx.lineWidth = edge.type === 'cluster-keyword' ? 0.95 : Math.min(2.2, 0.45 + edge.weight * 0.34)
    ctx.stroke()
  }
}

function drawClusters(
  ctx: CanvasRenderingContext2D,
  graph: KeywordClusterGraph,
  hovered: KeywordClusterSelection | null,
  selectedId: string | null,
  progress: number,
  pulse: number,
) {
  const focusClusterId = hovered?.type === 'keyword'
    ? graph.keywordNodes.find(keyword => keyword.id === hovered.id)?.clusterId
    : hovered?.id ?? selectedId

  for (const cluster of graph.clusters) {
    const active = cluster.id === focusClusterId || cluster.id === selectedId
    const dimmed = Boolean(focusClusterId) && !active
    const enter = getStaggeredProgress(progress, cluster.id, 0.24)
    const radius = cluster.radius * (0.92 + enter * 0.08) + (active ? 2 + pulse * 4 : pulse * 1.2)
    ctx.save()
    ctx.globalAlpha = (dimmed ? 0.32 : 1) * enter
    ctx.shadowColor = withAlpha(cluster.color, active ? 0.22 : 0.08)
    ctx.shadowBlur = active ? 18 : 7
    ctx.beginPath()
    ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(cluster.color, active ? 0.105 : 0.045)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = active ? 2.4 : 1.25
    ctx.strokeStyle = withAlpha(cluster.color, active ? 0.72 : 0.34)
    ctx.stroke()
    ctx.setLineDash([6, 9])
    ctx.lineDashOffset = -pulse * 8
    ctx.beginPath()
    ctx.arc(cluster.x, cluster.y, radius + 14, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(cluster.color, active ? 0.22 : 0.12)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    if (active) {
      ctx.beginPath()
      ctx.arc(cluster.x, cluster.y, radius + 24 + pulse * 5, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(cluster.color, 0.12)
      ctx.lineWidth = 10
      ctx.stroke()
    }
    ctx.fillStyle = getTextColor()
    ctx.font = '650 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    drawFittedText(ctx, cluster.label, cluster.x, cluster.y, Math.max(58, cluster.radius * 1.55))
    ctx.restore()
  }
}

function drawKeywords(
  ctx: CanvasRenderingContext2D,
  graph: KeywordClusterGraph,
  hovered: KeywordClusterSelection | null,
  selectedId: string | null,
  showLabels: boolean,
  progress: number,
  pulse: number,
) {
  const focusClusterId = hovered?.type === 'cluster'
    ? hovered.id
    : graph.keywordNodes.find(keyword => keyword.id === (hovered?.id ?? selectedId))?.clusterId
  const hasClusterFocus = Boolean(focusClusterId)

  for (const keyword of graph.keywordNodes) {
    const cluster = graph.clusters.find(item => item.id === keyword.clusterId)
    const color = cluster?.color ?? getFreeKeywordColor()
    const active = keyword.id === hovered?.id || keyword.id === selectedId || (hasClusterFocus && keyword.clusterId === focusClusterId)
    const dimmed = hasClusterFocus && !active
    const enter = getStaggeredProgress(progress, keyword.id, 0.42)
    const radius = keyword.radius * (0.72 + enter * 0.28) + (active ? 1.4 + pulse * 1.4 : 0)
    ctx.save()
    ctx.globalAlpha = (dimmed ? 0.24 : 1) * enter
    ctx.shadowColor = withAlpha(color, active ? 0.3 : 0.12)
    ctx.shadowBlur = active ? 12 : 5
    ctx.beginPath()
    ctx.arc(keyword.x, keyword.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(color, active ? 0.9 : keyword.clusterId ? 0.68 : 0.5)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = active ? 2 : 0.9
    ctx.strokeStyle = keyword.clusterId
      ? withAlpha('#ffffff', active ? 0.88 : 0.54)
      : withAlpha(color, active ? 0.5 : 0.26)
    ctx.stroke()
    if (showLabels || active) {
      ctx.font = `${active ? 650 : 520} ${active ? 12.5 : 11.5}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const label = trimLabel(keyword.keyword, active ? 18 : 12)
      const width = ctx.measureText(label).width + 12
      const labelY = keyword.y + radius + 7
      ctx.fillStyle = getLabelBackground(active)
      roundRect(ctx, keyword.x - width / 2, labelY, width, 21, 7)
      ctx.fill()
      ctx.strokeStyle = withAlpha(color, active ? 0.22 : 0.09)
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.fillStyle = active ? color : getKeywordTextColor()
      ctx.fillText(label, keyword.x, labelY + 4.3)
    }
    ctx.restore()
  }
}

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, progress: number) {
  ctx.save()
  ctx.globalAlpha = 0.9 * progress
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.48, 40, width * 0.5, height * 0.5, Math.max(width, height) * 0.68)
  if (isDarkMode()) {
    gradient.addColorStop(0, 'rgba(39,39,42,0.28)')
    gradient.addColorStop(1, 'rgba(9,9,11,0)')
  } else {
    gradient.addColorStop(0, 'rgba(244,244,245,0.82)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
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
  return { x: keyword.x, y: keyword.y, color: keywordCluster?.color ?? getFreeKeywordColor() }
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

function distanceBetween(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3)
}

function getStaggeredProgress(progress: number, id: string, spread: number) {
  const delay = (hashString(id) % 100) / 100 * spread
  return easeOutCubic(clamp((progress - delay) / Math.max(0.1, 1 - delay), 0, 1))
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function getCanvasBackground() {
  if (typeof document === 'undefined') return '#ffffff'
  return isDarkMode() ? '#09090b' : '#ffffff'
}

function getTextColor() {
  if (typeof document === 'undefined') return '#18181b'
  return isDarkMode() ? '#f4f4f5' : '#18181b'
}

function getKeywordTextColor() {
  if (typeof document === 'undefined') return '#27272a'
  return isDarkMode() ? '#e4e4e7' : '#27272a'
}

function getFreeKeywordColor() {
  return isDarkMode() ? '#94a3b8' : '#475569'
}

function getLabelBackground(active = false) {
  if (typeof document === 'undefined') return 'rgba(255,255,255,0.9)'
  if (isDarkMode()) return active ? 'rgba(24,24,27,0.92)' : 'rgba(24,24,27,0.78)'
  return active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.84)'
}
