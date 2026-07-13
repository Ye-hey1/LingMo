import type { CreativeCanvasNode, CreativeCanvasViewport } from '@/types/creative-canvas'

export const CREATIVE_CANVAS_MIN_ZOOM = 0.2
export const CREATIVE_CANVAS_MAX_ZOOM = 3

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasRect extends CanvasPoint, CanvasSize {}

export function clampCanvasZoom(value: number) {
  return Math.max(CREATIVE_CANVAS_MIN_ZOOM, Math.min(CREATIVE_CANVAS_MAX_ZOOM, value))
}

export function normalizeCanvasViewport(
  viewport: Partial<CreativeCanvasViewport> | null | undefined,
  fallback: CreativeCanvasViewport = { x: 0, y: 0, k: 1 },
): CreativeCanvasViewport {
  return {
    x: Number.isFinite(viewport?.x) ? Number(viewport?.x) : fallback.x,
    y: Number.isFinite(viewport?.y) ? Number(viewport?.y) : fallback.y,
    k: clampCanvasZoom(Number.isFinite(viewport?.k) ? Number(viewport?.k) : fallback.k),
  }
}

export function clientPointToWorld(
  clientPoint: CanvasPoint,
  canvasRect: Pick<DOMRect, 'left' | 'top'>,
  viewport: CreativeCanvasViewport,
) {
  return {
    x: (clientPoint.x - canvasRect.left - viewport.x) / viewport.k,
    y: (clientPoint.y - canvasRect.top - viewport.y) / viewport.k,
  }
}

export function zoomViewportAtPoint(
  viewport: CreativeCanvasViewport,
  nextZoom: number,
  anchor: CanvasPoint,
) {
  const k = clampCanvasZoom(nextZoom)
  const worldX = (anchor.x - viewport.x) / viewport.k
  const worldY = (anchor.y - viewport.y) / viewport.k
  return {
    x: anchor.x - worldX * k,
    y: anchor.y - worldY * k,
    k,
  }
}

export function getNodeBounds(nodes: Array<Pick<CreativeCanvasNode, 'x' | 'y' | 'width' | 'height'>>) {
  if (!nodes.length) return null
  const minX = Math.min(...nodes.map(node => node.x))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function fitNodesInViewport(
  nodes: Array<Pick<CreativeCanvasNode, 'x' | 'y' | 'width' | 'height'>>,
  canvasSize: CanvasSize,
  padding = 72,
): CreativeCanvasViewport {
  const bounds = getNodeBounds(nodes)
  if (!bounds || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return { x: canvasSize.width / 2, y: canvasSize.height / 2, k: 1 }
  }

  const availableWidth = Math.max(1, canvasSize.width - padding * 2)
  const availableHeight = Math.max(1, canvasSize.height - padding * 2)
  const k = clampCanvasZoom(Math.min(
    availableWidth / Math.max(1, bounds.width),
    availableHeight / Math.max(1, bounds.height),
    1.2,
  ))
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return {
    x: canvasSize.width / 2 - centerX * k,
    y: canvasSize.height / 2 - centerY * k,
    k,
  }
}

export function getCanvasSelectionRect(start: CanvasPoint, current: CanvasPoint): CanvasRect {
  const x = Math.min(start.x, current.x)
  const y = Math.min(start.y, current.y)
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  }
}

export function canvasRectIntersectsNode(
  rect: CanvasRect,
  node: Pick<CreativeCanvasNode, 'x' | 'y' | 'width' | 'height'>,
) {
  return node.x < rect.x + rect.width
    && node.x + node.width > rect.x
    && node.y < rect.y + rect.height
    && node.y + node.height > rect.y
}

export function createCanvasConnectionPath(from: CanvasPoint, to: CanvasPoint) {
  const curve = Math.max(56, Math.abs(to.x - from.x) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`
}
