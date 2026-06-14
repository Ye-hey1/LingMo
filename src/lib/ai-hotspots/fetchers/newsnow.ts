import { fetchHotspotJson } from '../http'
import { BaseAiHotspotFetcher, type AiHotspotFetcherOptions } from './base'
import type { AiHotspotRawItem } from '../types'

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

function parseUnixTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  let num = typeof value === 'number' ? value : parseFloat(String(value))
  if (isNaN(num)) return null
  if (num > 10_000_000_000) num = num / 1000
  const d = new Date(num * 1000)
  return isNaN(d.getTime()) ? null : d
}

function parseDate(value: unknown, now: Date): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return parseUnixTimestamp(value)
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{12,}$/.test(s)) return parseUnixTimestamp(parseInt(s))
  if (/^\d{9,11}$/.test(s)) return parseUnixTimestamp(parseInt(s))
  // Chinese relative time
  let m = s.match(/(\d+)\s*分钟前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 60 * 1000)
  m = s.match(/(\d+)\s*小时前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 60 * 60 * 1000)
  m = s.match(/(\d+)\s*天前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 24 * 60 * 60 * 1000)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function parseJuejinId(id: string | undefined, now: Date): Date | null {
  if (!id || !/^\d{18,20}$/.test(id)) return null
  try {
    const epoch = BigInt(-42416499549)
    const timestamp = (BigInt(id) >> BigInt(22)) + epoch
    const date = new Date(Number(timestamp))
    if (date.getTime() > now.getTime() + 86400000) return null
    if (date.getTime() < now.getTime() - 30 * 86400000) return null
    return date
  } catch { return null }
}

const NEWSNOW_SOURCE_IDS = [
  'hackernews', 'producthunt', 'sspai', 'juejin', '36kr',
  'v2ex', 'zhihu', 'weibo', 'bilibili', 'ithome', 'huxiu',
  'solidot', 'guokr', 'oschina',
]

export class NewsNowFetcher extends BaseAiHotspotFetcher {
  sourceId = 'newsnow'
  sourceName = 'NewsNow 聚合'
  kind = 'scraper' as const

  async fetch(now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': 'https://newsnow.busiyi.world',
      'Referer': 'https://newsnow.busiyi.world/',
    }

    let sourceBlocks: NewsNowBlock[] = []

    // Try bulk API first
    try {
      const response = await fetchHotspotJson<{ data?: NewsNowBlock[] } | NewsNowBlock[]>(
        'https://newsnow.busiyi.world/api/s/entire',
        { method: 'POST', headers, body: JSON.stringify({ sources: NEWSNOW_SOURCE_IDS }), timeoutMs: 45000 }
      )
      sourceBlocks = Array.isArray(response) ? response : (response as any).data || []
    } catch {
      // Fallback: fetch per-source
      for (const sid of NEWSNOW_SOURCE_IDS) {
        try {
          const block = await fetchHotspotJson<NewsNowBlock>(
            `https://newsnow.busiyi.world/api/s?id=${sid}`,
            { headers, timeoutMs: 20000 }
          )
          sourceBlocks.push(block)
        } catch { continue }
      }
    }

    const items: AiHotspotRawItem[] = []

    for (const block of sourceBlocks) {
      const sid = String(block.id || 'unknown')
      const sourceTitle = block.title || block.name || block.desc || sid
      const sourceLabel = sourceTitle !== sid ? sourceTitle : sid
      const updated = parseUnixTimestamp(block.updatedTime) || now

      for (const it of block.items || []) {
        const title = (it.title || '').trim()
        const url = (it.url || '').trim()
        if (!title || !url) continue

        let publishedAt = parseDate(it.pubDate, now)
        if (!publishedAt && it.extra?.date) publishedAt = parseDate(it.extra.date, now)
        if (!publishedAt && sid === 'juejin' && it.id) publishedAt = parseJuejinId(it.id, now)
        if (!publishedAt) publishedAt = updated

        items.push(this.createItem({
          feedName: sourceLabel,
          title,
          url,
          publishedAt,
          meta: { newsnowSourceId: sid },
        }))
      }
    }

    return items
  }
}
