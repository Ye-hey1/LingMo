export const NOTE_GEN_FILE_POINTER_DRAG_EVENT = 'note-gen:file-pointer-drag'
export const NOTE_GEN_FILE_POINTER_DRAG_THRESHOLD = 5

export type NoteGenFilePointerDragPhase = 'start' | 'move' | 'end' | 'cancel'

export interface NoteGenFilePointerDragDetail {
  phase: NoteGenFilePointerDragPhase
  path: string
  name: string
  displayName: string
  isDirectory: boolean
  isFile: boolean
  x: number
  y: number
}

export function emitNoteGenFilePointerDrag(detail: NoteGenFilePointerDragDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTE_GEN_FILE_POINTER_DRAG_EVENT, { detail }))
}

export function getNoteGenFilePointerDragDetail(event: Event) {
  return (event as CustomEvent<NoteGenFilePointerDragDetail>).detail
}

export function isPointInsideElement(element: HTMLElement | null, x: number, y: number) {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
