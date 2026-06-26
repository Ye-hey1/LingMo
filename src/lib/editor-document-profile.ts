export const LARGE_MARKDOWN_CHAR_THRESHOLD = 80_000
export const LARGE_MARKDOWN_LINE_THRESHOLD = 1_500
export const LARGE_MARKDOWN_CODE_FENCE_THRESHOLD = 40
export const LARGE_MARKDOWN_LINE_LENGTH_THRESHOLD = 8_000

export interface MarkdownDocumentProfile {
  charCount: number
  lineCount: number
  codeFenceCount: number
  maxLineLength: number
  isLarge: boolean
}

export function isLargeMarkdownContentFast(content: string): boolean {
  if (content.length >= LARGE_MARKDOWN_CHAR_THRESHOLD) {
    return true
  }

  let codeFenceCount = 0
  let lineCount = 1
  let currentLineLength = 0
  let lineStart = 0

  const countFenceLine = (start: number, end: number) => {
    let cursor = start
    let indent = 0
    while (cursor < end && indent < 4) {
      const code = content.charCodeAt(cursor)
      if (code !== 32 && code !== 9) break
      cursor += 1
      indent += 1
    }

    const marker = content.charCodeAt(cursor)
    if (marker !== 96 && marker !== 126) return false

    let markerCount = 0
    while (cursor < end && content.charCodeAt(cursor) === marker) {
      markerCount += 1
      cursor += 1
    }

    if (markerCount >= 3) {
      codeFenceCount += 1
    }

    return codeFenceCount >= LARGE_MARKDOWN_CODE_FENCE_THRESHOLD
  }

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      if (
        currentLineLength >= LARGE_MARKDOWN_LINE_LENGTH_THRESHOLD ||
        countFenceLine(lineStart, index)
      ) {
        return true
      }

      lineCount += 1
      if (lineCount >= LARGE_MARKDOWN_LINE_THRESHOLD) {
        return true
      }

      currentLineLength = 0
      lineStart = index + 1
    } else {
      currentLineLength += 1
    }
  }

  return (
    currentLineLength >= LARGE_MARKDOWN_LINE_LENGTH_THRESHOLD ||
    countFenceLine(lineStart, content.length)
  )
}

export function getMarkdownDocumentProfile(content: string): MarkdownDocumentProfile {
  const charCount = content.length
  let codeFenceCount = 0
  let lineCount = 1
  let maxLineLength = 0
  let currentLineLength = 0
  let lineStart = 0

  const countFenceLine = (start: number, end: number) => {
    let cursor = start
    let indent = 0
    while (cursor < end && indent < 4) {
      const code = content.charCodeAt(cursor)
      if (code !== 32 && code !== 9) break
      cursor += 1
      indent += 1
    }

    const marker = content.charCodeAt(cursor)
    if (marker !== 96 && marker !== 126) return

    let markerCount = 0
    while (cursor < end && content.charCodeAt(cursor) === marker) {
      markerCount += 1
      cursor += 1
    }

    if (markerCount >= 3) {
      codeFenceCount += 1
    }
  }

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      countFenceLine(lineStart, index)
      lineCount += 1
      maxLineLength = Math.max(maxLineLength, currentLineLength)
      currentLineLength = 0
      lineStart = index + 1
    } else {
      currentLineLength += 1
    }
  }

  countFenceLine(lineStart, content.length)
  maxLineLength = Math.max(maxLineLength, currentLineLength)

  return {
    charCount,
    lineCount,
    codeFenceCount,
    maxLineLength,
    isLarge:
      charCount >= LARGE_MARKDOWN_CHAR_THRESHOLD ||
      lineCount >= LARGE_MARKDOWN_LINE_THRESHOLD ||
      codeFenceCount >= LARGE_MARKDOWN_CODE_FENCE_THRESHOLD ||
      maxLineLength >= LARGE_MARKDOWN_LINE_LENGTH_THRESHOLD,
  }
}
