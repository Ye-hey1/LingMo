export type OutlinePosition = 'left' | 'right'

export const DEFAULT_OUTLINE_POSITION: OutlinePosition = 'right'

export function normalizeOutlinePosition(value: unknown): OutlinePosition {
  return value === 'left' ? 'left' : DEFAULT_OUTLINE_POSITION
}

export function isOutlineOnLeft(position: OutlinePosition): boolean {
  return position === 'left'
}
