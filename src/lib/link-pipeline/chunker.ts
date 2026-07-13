export interface LinkChunkOptions {
  maxChars?: number
  maxChunks?: number
  overlapChars?: number
}

function findNaturalBreak(text: string, start: number, preferredEnd: number) {
  const minimumEnd = start + Math.floor((preferredEnd - start) * 0.6)
  for (const separator of ['\n\n', '\n', '。', '. ', ' ']) {
    const index = text.lastIndexOf(separator, preferredEnd)
    if (index >= minimumEnd) {
      return index + separator.length
    }
  }
  return preferredEnd
}

function selectBalancedChunks(chunks: string[], maxChunks: number) {
  if (chunks.length <= maxChunks) return chunks
  if (maxChunks === 1) return [chunks[0]]

  const indexes = Array.from({ length: maxChunks }, (_, index) => (
    Math.round((index * (chunks.length - 1)) / (maxChunks - 1))
  ))
  return [...new Set(indexes)].map(index => chunks[index])
}

export function chunkLinkContent(content: string, options: LinkChunkOptions = {}) {
  const text = content.replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const maxChars = Math.max(100, options.maxChars ?? 6_000)
  const maxChunks = Math.max(1, options.maxChunks ?? 8)
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? 160, Math.floor(maxChars / 4)))
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const preferredEnd = Math.min(text.length, start + maxChars)
    const end = preferredEnd < text.length
      ? findNaturalBreak(text, start, preferredEnd)
      : preferredEnd
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= text.length) break
    start = Math.max(start + 1, end - overlapChars)
  }

  return selectBalancedChunks(chunks, maxChunks)
}
