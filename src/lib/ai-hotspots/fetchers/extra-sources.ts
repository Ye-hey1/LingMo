import { fetchHotspotJson, fetchHotspotText } from '../http'
import { BaseAiHotspotFetcher, type AiHotspotFetcherOptions } from './base'
import type { AiHotspotRawItem } from '../types'

function parseUnixTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  let num = typeof value === 'number' ? value : parseFloat(String(value))
  if (isNaN(num)) return null
  if (num > 10_000_000_000) num = num / 1000
  const d = new Date(num * 1000)
  return isNaN(d.getTime()) ? null : d
}

function parseRelativeTimeZh(text: string, now: Date): Date | null {
  const s = (text || '').trim()
  if (!s) return null
  let m = s.match(/(\d+)\s*分钟前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 60 * 1000)
  m = s.match(/(\d+)\s*小时前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 60 * 60 * 1000)
  m = s.match(/(\d+)\s*天前/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 24 * 60 * 60 * 1000)
  if (s.includes('刚刚')) return now
  return null
}

function parseDateFlexible(value: unknown, now: Date): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return parseUnixTimestamp(value)
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{9,13}$/.test(s)) return parseUnixTimestamp(parseInt(s))
  const rel = parseRelativeTimeZh(s, now)
  if (rel) return rel
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// ======================== Buzzing ========================

interface BuzzingItem {
  title?: string
  url?: string
  source?: string
  site_name?: string
  channel?: string
  category?: string
  date_published?: string
  date_modified?: string
}

interface BuzzingFeed {
  items: BuzzingItem[]
}

export class BuzzingFetcher extends BaseAiHotspotFetcher {
  sourceId = 'buzzing'
  sourceName = 'Buzzing 热榜'
  kind = 'scraper' as const

  async fetch(now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    const data = await fetchHotspotJson<BuzzingFeed>('https://www.buzzing.cc/feed.json', { timeoutMs: 20000 })
    const items: AiHotspotRawItem[] = []
    for (const it of data.items || []) {
      const title = (it.title || '').trim()
      const url = (it.url || '').trim()
      if (!title || !url) continue
      const source = it.source || it.site_name || it.channel || it.category || new URL(url).hostname || this.sourceName
      const publishedAt = parseDateFlexible(it.date_published || it.date_modified, now)
      items.push(this.createItem({ feedName: source, title, url, publishedAt }))
    }
    return items
  }
}

// ======================== Zeli (HackerNews 24h) ========================

interface ZeliPost {
  id?: string
  title?: string
  url?: string
  time?: number
}

interface ZeliResponse {
  posts?: ZeliPost[]
}

export class ZeliFetcher extends BaseAiHotspotFetcher {
  sourceId = 'zeli'
  sourceName = 'Zeli HN'
  kind = 'scraper' as const

  async fetch(now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    const data = await fetchHotspotJson<ZeliResponse>('https://zeli.app/api/hacker-news?type=hot24h', { timeoutMs: 20000 })
    const items: AiHotspotRawItem[] = []
    for (const p of data.posts || []) {
      const title = (p.title || '').trim()
      const url = (p.url || '').trim()
      if (!title || !url) continue
      const publishedAt = parseUnixTimestamp(p.time) || now
      items.push(this.createItem({ feedName: 'Hacker News · 24h最热', title, url, publishedAt, meta: { hnId: p.id } }))
    }
    return items
  }
}

// ======================== TechURLs ========================

export class TechUrlsFetcher extends BaseAiHotspotFetcher {
  sourceId = 'techurls'
  sourceName = 'TechURLs'
  kind = 'scraper' as const

  async fetch(now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    const html = await fetchHotspotText('https://techurls.com/', { timeoutMs: 20000 })
    const items: AiHotspotRawItem[] = []

    // Parse publisher blocks: <div class="publisher-block" data-publisher="...">
    const blockPattern = /<div[^>]*class="publisher-block"[^>]*data-publisher="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
    let blockMatch: RegExpExecArray | null

    while ((blockMatch = blockPattern.exec(html))) {
      const publisher = decodeEntities(blockMatch[1] || 'unknown')
      const blockHtml = blockMatch[2]

      // Extract articles: <a class="article-link" href="...">title</a>
      const linkPattern = /<a[^>]*class="article-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      let linkMatch: RegExpExecArray | null

      while ((linkMatch = linkPattern.exec(blockHtml))) {
        const url = decodeEntities(linkMatch[1] || '').trim()
        const title = stripHtml(linkMatch[2] || '').trim()
        if (!title || !url) continue
        items.push(this.createItem({ feedName: publisher, title, url, publishedAt: now }))
      }
    }

    return items
  }
}

// ======================== IT之家 ========================

export class IthomeFetcher extends BaseAiHotspotFetcher {
  sourceId = 'ithome'
  sourceName = 'IT之家'
  kind = 'rss' as const

  async fetch(_now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    try {
      const xml = await fetchHotspotText('https://www.ithome.com/rss/', { timeoutMs: 15000 })
      return parseSimpleRss(xml, this.sourceId, this.sourceName, 'IT之家')
    } catch { return [] }
  }
}

// ======================== 虎嗅 ========================

export class HuxiuFetcher extends BaseAiHotspotFetcher {
  sourceId = 'huxiu'
  sourceName = '虎嗅'
  kind = 'rss' as const

  async fetch(_now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    try {
      const xml = await fetchHotspotText('https://rsshub.app/huxiu/article', { timeoutMs: 15000 })
      return parseSimpleRss(xml, this.sourceId, this.sourceName, '虎嗅')
    } catch { return [] }
  }
}

// ======================== 36氪 ========================

export class Kr36Fetcher extends BaseAiHotspotFetcher {
  sourceId = '36kr'
  sourceName = '36氪'
  kind = 'rss' as const

  async fetch(_now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    try {
      const xml = await fetchHotspotText('https://rsshub.app/36kr/newsflashes', { timeoutMs: 15000 })
      return parseSimpleRss(xml, this.sourceId, this.sourceName, '36氪快讯')
    } catch { return [] }
  }
}

// ======================== 少数派 ========================

export class SspaiFetcher extends BaseAiHotspotFetcher {
  sourceId = 'sspai'
  sourceName = '少数派'
  kind = 'rss' as const

  async fetch(_now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    try {
      const xml = await fetchHotspotText('https://sspai.com/feed', { timeoutMs: 15000 })
      return parseSimpleRss(xml, this.sourceId, this.sourceName, '少数派')
    } catch { return [] }
  }
}

// ======================== Helper functions ========================

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function parseSimpleRss(xml: string, sourceId: string, sourceName: string, feedName: string): AiHotspotRawItem[] {
  const items: AiHotspotRawItem[] = []
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0])
  const entryBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(m => m[0])

  for (const block of [...itemBlocks, ...entryBlocks]) {
    const title = extractTag(block, 'title')
    const url = extractTag(block, 'link') || extractAtomLink(block) || extractTag(block, 'guid') || ''
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    const summary = stripHtml(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content') || '')

    if (!title.trim() || !url.trim()) continue
    const publishedAt = pubDate ? new Date(pubDate) : null

    items.push({
      sourceId,
      sourceName,
      feedName,
      title: title.trim(),
      url: url.trim(),
      publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
      meta: { summary },
    })
  }
  return items
}

function extractTag(block: string, tagName: string): string {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, 'i')
  const match = block.match(pattern)
  if (!match) return ''
  let value = match[1].trim()
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  if (cdata) value = cdata[1]
  return decodeEntities(value)
}

function extractAtomLink(entry: string): string {
  const linkTags = entry.match(/<link\b[^>]*\/?>/gi) || []
  const alternate = linkTags.find(t => /\brel\s*=\s*["']alternate["']/i.test(t))
  const selected = alternate || linkTags[0]
  if (!selected) return ''
  const href = selected.match(/\bhref\s*=\s*["']([^"']+)["']/i)
  return href ? decodeEntities(href[1]) : ''
}
