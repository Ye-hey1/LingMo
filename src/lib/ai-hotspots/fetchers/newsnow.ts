import { fetchHotspotJson, fetchHotspotText } from '../http'
import { BaseAiHotspotFetcher } from './base'

const FALLBACK_SOURCE_IDS = ['hackernews', 'producthunt', 'github', 'sspai', 'juejin', '36kr']
const JUEJIN_SNOWFLAKE_EPOCH = BigInt(-42416499549)

interface NewsNowItem {
  id?: string
  title?: string
  url?: string
  pubDate?: string
  extra?: { date?: unknown }
}

interface NewsNowBlock {
  id?: string
  title?: string
  name?: string
  desc?: string
  updatedTime?: number
  items?: NewsNowItem[]
}

function extractBundleUrl(html: string) {
  const scripts = html.match(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi) || []
  const script = scripts.find((tag) => /\/assets\/index-[^"']+\.js/i.test(tag))
  const src = script?.match(/\bsrc=["']([^"']+)["']/i)?.[1]
  if (!src) return null

  return new URL(src, 'https://newsnow.busiyi.world/').toString()
}

function extractSourceIds(js: string) {
  const marker = '{v2ex:vL'
  const start = js.indexOf(marker)
  if (start === -1) return FALLBACK_SOURCE_IDS

  let depth = 0
  let end: number | null = null
  let inStr = false
  let esc = false

  for (let i = start; i < js.length; i += 1) {
    const ch = js[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (ch === '\\') {
        esc = true
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }

    if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }

  if (end === null) return FALLBACK_SOURCE_IDS

  const ignore = new Set(['name', 'column', 'home', 'https', 'color', 'interval', 'title', 'type', 'redirect', 'desc'])
  const keys = [...js.slice(start, end).matchAll(/(['"]?)([a-zA-Z0-9_-]+)\1\s*:/g)].map((match) => match[2])
  const sourceIds: string[] = []

  for (const key of keys) {
    if (!ignore.has(key) && !sourceIds.includes(key)) {
      sourceIds.push(key)
    }
  }

  return sourceIds.length ? sourceIds : FALLBACK_SOURCE_IDS
}

function parseDate(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return parseUnixTimestamp(value)

  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function parseUnixTimestamp(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (Number.isNaN(numberValue)) return null

  const seconds = numberValue > 10_000_000_000 ? numberValue / 1000 : numberValue
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseJuejinId(id: string | undefined, now: Date) {
  if (!id || !/^\d{18,20}$/.test(id)) return null

  try {
    const timestamp = (BigInt(id) >> BigInt(22)) + JUEJIN_SNOWFLAKE_EPOCH
    const date = new Date(Number(timestamp))
    if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null
    if (date.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) return null
    return date
  } catch {
    return null
  }
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }

  return ''
}

export class NewsNowFetcher extends BaseAiHotspotFetcher {
  sourceId = 'newsnow'
  sourceName = 'NewsNow'

  async fetch(now: Date) {
    const homeHtml = await fetchHotspotText('https://newsnow.busiyi.world/')
    const bundleUrl = extractBundleUrl(homeHtml)
    let sourceIds = FALLBACK_SOURCE_IDS

    if (bundleUrl) {
      try {
        sourceIds = extractSourceIds(await fetchHotspotText(bundleUrl))
      } catch {
        sourceIds = FALLBACK_SOURCE_IDS
      }
    }

    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: 'https://newsnow.busiyi.world',
      Referer: 'https://newsnow.busiyi.world/',
    }

    let sourceBlocks: NewsNowBlock[] = []
    try {
      const response = await fetchHotspotJson<{ data?: NewsNowBlock[] } | NewsNowBlock[]>(
        'https://newsnow.busiyi.world/api/s/entire',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ sources: sourceIds }),
        }
      )
      sourceBlocks = Array.isArray(response) ? response : response.data || []
    } catch {
      const results = await Promise.all(
        sourceIds.map(async (sourceId) => {
          try {
            return await fetchHotspotJson<NewsNowBlock>(
              `https://newsnow.busiyi.world/api/s?id=${encodeURIComponent(sourceId)}`,
              { headers, timeoutMs: 20000 }
            )
          } catch {
            return null
          }
        })
      )
      sourceBlocks = results.filter((block): block is NewsNowBlock => block !== null)
    }

    return sourceBlocks.flatMap((block) => {
      const feedId = String(block.id || 'unknown')
      const feedTitle = firstNonEmpty(block.title, block.name, block.desc, feedId)
      const feedName = feedTitle !== feedId ? `${feedTitle} (${feedId})` : feedId
      const updated = parseUnixTimestamp(block.updatedTime) || now

      return (block.items || [])
        .map((item) => {
          const title = (item.title || '').trim()
          const url = (item.url || '').trim()
          if (!title || !url) return null

          const publishedAt = parseDate(item.pubDate) ||
            parseDate(item.extra?.date) ||
            parseJuejinId(item.id, now) ||
            updated

          return this.createItem({
            feedName,
            title,
            url,
            publishedAt,
            meta: {
              rawSourceId: feedId,
              rawItemId: item.id || '',
            },
          })
        })
        .filter((item) => item !== null)
    })
  }
}
