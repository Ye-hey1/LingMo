export const LINGMO_FILE_POINTER_DRAG_EVENT = 'lingmo:file-pointer-drag'
export const LINGMO_FILE_POINTER_DRAG_THRESHOLD = 5

export type LingMoFilePointerDragPhase = 'start' | 'move' | 'end' | 'cancel'

export interface LingMoFilePointerDragDetail {
  phase: LingMoFilePointerDragPhase
  path: string
  name: string
  displayName: string
  isDirectory: boolean
  isFile: boolean
  x: number
  y: number
}

export function emitLingMoFilePointerDrag(detail: LingMoFilePointerDragDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LINGMO_FILE_POINTER_DRAG_EVENT, { detail }))
}

export function getLingMoFilePointerDragDetail(event: Event) {
  return (event as CustomEvent<LingMoFilePointerDragDetail>).detail
}

export function isPointInsideElement(element: HTMLElement | null, x: number, y: number) {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
