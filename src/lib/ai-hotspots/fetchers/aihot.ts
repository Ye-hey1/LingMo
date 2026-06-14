import { fetchHotspotText } from '../http'
import { AiHotspotFetcherOptions, BaseAiHotspotFetcher } from './base'

interface AiHotItem {
  title?: string
  title_trans?: string
  link?: string
  publish_time?: unknown
}

interface AiHotSource {
  id?: string
  title?: string
}

function extractNextFMerged(html: string) {
  const chunks = html.match(/self\.__next_f\.push\(\[1,"[\s\S]*?"\]\)<\/script>/g) || []
  if (!chunks.length) return ''

  const merged = chunks
    .map((chunk) => chunk.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/)?.[1] || '')
    .join('')

  try {
    return JSON.parse(`"${merged}"`) as string
  } catch {
    return merged.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

function extractBalancedJson(decoded: string, key: string): unknown {
  const idx = decoded.indexOf(key)
  if (idx === -1) throw new Error(`Key not found: ${key}`)

  let start = idx + key.length
  while (start < decoded.length && decoded[start] !== ':') start += 1
  start += 1
  while (start < decoded.length && !['{', '['].includes(decoded[start])) start += 1

  const openCh = decoded[start]
  const closeCh = openCh === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  let end: number | null = null

  for (let i = start; i < decoded.length; i += 1) {
    const ch = decoded[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (ch === '\\') {
        esc = true
      } else if (ch === '"') {
        inStr = false
      }
    } else if (ch === '"') {
      inStr = true
    } else if (ch === openCh) {
      depth += 1
    } else if (ch === closeCh) {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }

  if (end === null) throw new Error(`Cannot parse JSON for key: ${key}`)

  return JSON.parse(
    decoded
      .slice(start, end)
      .replace(/\$undefined/g, 'null')
      .replace(/"\$D([^"]+)"/g, '"$1"')
  )
}

function extractNextDataPayload(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/)
  if (!match) return null

  try {
    return JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseDate(value: unknown, now: Date) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const seconds = value > 10_000_000_000 ? value / 1000 : value
    const date = new Date(seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const text = String(value || '').trim().replace(/^\$D/, '')
  if (!text) return null

  if (/^\d{12,}$/.test(text)) return parseDate(Number.parseInt(text, 10), now)
  if (/^\d{9,11}$/.test(text)) return parseDate(Number.parseInt(text, 10), now)

  const minutes = text.match(/(\d+)\s*分钟前/)
  if (minutes) return new Date(now.getTime() - Number.parseInt(minutes[1], 10) * 60 * 1000)

  const hours = text.match(/(\d+)\s*小时前/)
  if (hours) return new Date(now.getTime() - Number.parseInt(hours[1], 10) * 60 * 60 * 1000)

  const days = text.match(/(\d+)\s*天前/)
  if (days) return new Date(now.getTime() - Number.parseInt(days[1], 10) * 24 * 60 * 60 * 1000)

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function firstObject(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function maybeFixMojibake(text: string) {
  return text.replace(/Ã©/g, 'é').replace(/Â/g, '')
}

export class AiHotFetcher extends BaseAiHotspotFetcher {
  sourceId = 'aihot'
  sourceName = 'AI今日热榜'

  async fetch(now: Date, _options?: AiHotspotFetcherOptions) {
    const html = await fetchHotspotText('https://aihot.today/')
    let initialData: Record<string, AiHotItem[]> | null = null
    let sourceList: AiHotSource[] | null = null

    const decoded = extractNextFMerged(html)
    if (decoded) {
      try {
        initialData = extractBalancedJson(decoded, 'initialDataMap') as Record<string, AiHotItem[]>
        sourceList = extractBalancedJson(decoded, 'dataSources') as AiHotSource[]
      } catch {
        initialData = null
        sourceList = null
      }
    }

    if (!initialData || !sourceList) {
      const pageProps = firstObject(firstObject(firstObject(extractNextDataPayload(html))?.props)?.pageProps)
      if (pageProps?.initialDataMap && typeof pageProps.initialDataMap === 'object') {
        initialData = pageProps.initialDataMap as Record<string, AiHotItem[]>
      }
      if (Array.isArray(pageProps?.dataSources)) {
        sourceList = pageProps.dataSources as AiHotSource[]
      }
    }

    if (!initialData || !sourceList) return []

    const sourceMap = new Map<string, string>()
    for (const source of sourceList) {
      if (source.id) sourceMap.set(String(source.id), source.title || String(source.id))
    }

    return Object.entries(initialData).flatMap(([feedId, feedItems]) => {
      if (!Array.isArray(feedItems)) return []

      const feedName = maybeFixMojibake(sourceMap.get(feedId) || feedId)

      return feedItems
        .map((item) => {
          const title = maybeFixMojibake((item.title_trans || item.title || '').trim())
          const url = (item.link || '').trim()
          if (!title || !url) return null

          return this.createItem({
            feedName,
            title,
            url,
            publishedAt: parseDate(item.publish_time, now) || now,
            meta: { rawSourceId: feedId },
          })
        })
        .filter((item) => item !== null)
    })
  }
}
