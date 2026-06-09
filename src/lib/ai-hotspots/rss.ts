import type { AiHotspotRawItem } from './types'

export interface ParsedOpmlFeed {
  title: string
  xmlUrl: string
  htmlUrl: string
}

export interface RssItemSource {
  sourceId: string
  sourceName: string
  feedName: string
  feedUrl?: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanXmlText(value: string) {
  const trimmed = value.trim()
  const cdataMatch = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return decodeXmlEntities(cdataMatch ? cdataMatch[1] : trimmed)
}

function readXmlAttribute(block: string, tagName: string, attrName: string) {
  const tagPattern = new RegExp(`<(?:[\\w-]+:)?${escapeRegExp(tagName)}\\b([^>]*)>`, 'i')
  const tagMatch = block.match(tagPattern)
  const attrs = tagMatch?.[1]
  if (!attrs) return null

  const attrPattern = new RegExp(`\\b${escapeRegExp(attrName)}\\s*=\\s*["']([^"']+)["']`, 'i')
  const attrMatch = attrs.match(attrPattern)
  return attrMatch ? decodeXmlEntities(attrMatch[1]) : null
}

function readAtomLink(entry: string) {
  const linkTags = entry.match(/<link\b[^>]*\/?>/gi) || []
  const alternate = linkTags.find((tag) => /\brel\s*=\s*["']alternate["']/i.test(tag))
  const selected = alternate || linkTags[0]
  if (!selected) return ''

  const hrefMatch = selected.match(/\bhref\s*=\s*["']([^"']+)["']/i)
  return hrefMatch ? decodeXmlEntities(hrefMatch[1]) : ''
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function decodeXmlEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function extractXmlTag(block: string, tagName: string) {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escapeRegExp(tagName)}>`,
    'i'
  )
  const match = block.match(pattern)
  return match ? cleanXmlText(match[1]) : null
}

export function parseRssItems(xml: string, source: RssItemSource): AiHotspotRawItem[] {
  const items: AiHotspotRawItem[] = []
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0])
  const entryBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0])

  for (const block of itemBlocks) {
    const title = extractXmlTag(block, 'title') || ''
    const url = extractXmlTag(block, 'link') || extractXmlTag(block, 'guid') || ''
    if (!title.trim() || !url.trim()) continue

    items.push({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      feedName: source.feedName,
      title: title.trim(),
      url: url.trim(),
      publishedAt: parseDate(extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'published') || extractXmlTag(block, 'updated')),
      meta: {
        feedUrl: source.feedUrl || '',
      },
    })
  }

  for (const block of entryBlocks) {
    const title = extractXmlTag(block, 'title') || ''
    const url = readAtomLink(block) || extractXmlTag(block, 'link') || extractXmlTag(block, 'id') || ''
    if (!title.trim() || !url.trim()) continue

    items.push({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      feedName: source.feedName,
      title: title.trim(),
      url: url.trim(),
      publishedAt: parseDate(extractXmlTag(block, 'published') || extractXmlTag(block, 'updated') || extractXmlTag(block, 'pubDate')),
      meta: {
        feedUrl: source.feedUrl || '',
      },
    })
  }

  return items
}

export function parseOpmlFeeds(opmlContent: string) {
  const feeds: ParsedOpmlFeed[] = []
  const seen = new Set<string>()
  const outlines = opmlContent.match(/<outline\b[^>]*\/?>/gi) || []

  for (const outline of outlines) {
    const xmlUrl = readXmlAttribute(outline, 'outline', 'xmlUrl')?.trim()
    if (!xmlUrl || seen.has(xmlUrl)) continue

    seen.add(xmlUrl)
    const title = readXmlAttribute(outline, 'outline', 'title') ||
      readXmlAttribute(outline, 'outline', 'text') ||
      xmlUrl

    feeds.push({
      title,
      xmlUrl,
      htmlUrl: readXmlAttribute(outline, 'outline', 'htmlUrl') || '',
    })
  }

  return feeds
}
