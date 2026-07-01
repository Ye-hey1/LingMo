export interface StreamingMarkdownSegment {
  id: string
  text: string
  stable: boolean
}

export interface StreamingMarkdownRenderStats {
  segmentCount: number
  stableSegmentCount: number
  cacheHits: number
}

export interface StreamingMarkdownRenderResult extends StreamingMarkdownRenderStats {
  html: string
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function getLineEnd(text: string, start: number) {
  const newline = text.indexOf('\n', start)
  return newline === -1 ? text.length : newline + 1
}

function getFenceMarker(line: string) {
  const match = line.match(/^\s*(```+|~~~+)/)
  return match?.[1]?.slice(0, 3)
}

function getStableBoundaryOffsets(text: string): number[] {
  const boundaries: number[] = []
  let offset = 0
  let fenceMarker = ''

  while (offset < text.length) {
    const end = getLineEnd(text, offset)
    const line = text.slice(offset, end)
    const lineBody = line.replace(/\r?\n$/, '')
    const marker = getFenceMarker(lineBody)

    if (marker) {
      if (!fenceMarker) {
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        fenceMarker = ''
      }
    }

    if (!fenceMarker && /^\s*$/.test(lineBody)) {
      boundaries.push(end)
    }

    offset = end
  }

  return boundaries
}

export function splitStreamingMarkdownSegments(text: string): StreamingMarkdownSegment[] {
  if (!text) return []

  const boundaries = getStableBoundaryOffsets(text)
  const segments: StreamingMarkdownSegment[] = []
  let start = 0

  for (const boundary of boundaries) {
    if (boundary <= start) continue
    const chunk = text.slice(start, boundary)
    if (chunk) {
      segments.push({
        id: `stable:${segments.length}:${hashText(chunk)}`,
        text: chunk,
        stable: true,
      })
    }
    start = boundary
  }

  const tail = text.slice(start)
  if (tail) {
    segments.push({
      id: `tail:${hashText(tail)}`,
      text: tail,
      stable: false,
    })
  }

  return segments
}

export function pruneStreamingMarkdownSegmentCache(
  cache: Map<string, string>,
  activeKeys: Set<string>,
  maxEntries = 80,
) {
  for (const key of cache.keys()) {
    if (!activeKeys.has(key)) {
      cache.delete(key)
    }
  }

  while (cache.size > maxEntries) {
    const firstKey = cache.keys().next().value
    if (!firstKey) break
    cache.delete(firstKey)
  }
}

export function renderStreamingMarkdownSegments(input: {
  text: string
  cache: Map<string, string>
  renderMarkdown: (text: string) => string
}): StreamingMarkdownRenderResult {
  const segments = splitStreamingMarkdownSegments(input.text)
  const activeKeys = new Set(segments.filter(segment => segment.stable).map(segment => segment.id))
  const html: string[] = []
  let cacheHits = 0
  let stableSegmentCount = 0

  for (const segment of segments) {
    if (!segment.stable) {
      html.push(input.renderMarkdown(segment.text))
      continue
    }

    stableSegmentCount += 1
    const cached = input.cache.get(segment.id)
    if (cached !== undefined) {
      cacheHits += 1
      html.push(cached)
      continue
    }

    const rendered = input.renderMarkdown(segment.text)
    input.cache.set(segment.id, rendered)
    html.push(rendered)
  }

  pruneStreamingMarkdownSegmentCache(input.cache, activeKeys)

  return {
    html: html.join(''),
    segmentCount: segments.length,
    stableSegmentCount,
    cacheHits,
  }
}
