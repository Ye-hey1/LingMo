export const OUTLINE_PANEL_WIDTH_CLASS = 'w-72'
export const OUTLINE_PANEL_PADDING_CLASS = '19rem'

export function getOutlinePanelClass(
  position: 'left' | 'right' = 'right',
  floating = false
) {
  const placementClass = position === 'left'
    ? `${floating ? 'left-0' : ''} border-r`
    : `${floating ? 'right-0' : ''} border-l`

  const layoutClass = floating
    ? `absolute top-0 bottom-6 z-20 ${OUTLINE_PANEL_WIDTH_CLASS}`
    : `${OUTLINE_PANEL_WIDTH_CLASS} min-w-72 shrink-0`

  return `outline-panel ${layoutClass} ${placementClass} border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden`
}

export function getOutlineHeadingTextClass() {
  return 'block min-w-0 flex-1 truncate leading-6'
}
