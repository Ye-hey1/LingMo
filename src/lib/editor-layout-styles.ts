export function getEditorContentContainerClass(options: {
  centeredContent: boolean
  isMobile: boolean
  outlineOpen?: boolean
  outlinePosition?: 'left' | 'right'
}) {
  if (options.isMobile) {
    return ''
  }

  const outlinePaddingClass = options.outlineOpen
    ? options.outlinePosition === 'left'
      ? 'pl-72'
      : 'pr-72'
    : ''

  if (options.centeredContent) {
    return `editor-content-frame editor-content-frame-centered w-full px-4 ${outlinePaddingClass}`.trim()
  }

  return `editor-content-frame w-full px-10 ${outlinePaddingClass}`.trim()
}
