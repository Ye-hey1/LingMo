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
  feedRole?: string
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

function stripHtmlTags(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateText(value: string, maxLength: number) {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}

function splitKeywordText(value: string | null) {
  if (!value) return []
  return value
    .split(/[,，、;；|/#\n]+/)
    .map(keyword => normalizeWhitespace(stripHtmlTags(keyword)))
    .filter(Boolean)
}

function readItemContentHtml(block: string) {
  return extractXmlTag(block, 'encoded') ||
    extractXmlTag(block, 'content') ||
    extractXmlTag(block, 'description') ||
    extractXmlTag(block, 'summary') ||
    ''
}

function readItemSummary(block: string) {
  const value = extractXmlTag(block, 'description') ||
    extractXmlTag(block, 'summary') ||
    extractXmlTag(block, 'encoded') ||
    extractXmlTag(block, 'content')
  return value ? truncateText(stripHtmlTags(value), 600) : ''
}

function readItemCategories(block: string) {
  const categoryTags = block.match(/<(?:[\w-]+:)?category\b[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w-]+:)?category>)/gi) || []
  const categories: string[] = []

  for (const tag of categoryTags) {
    const attrValue = tag.match(/\b(?:term|label)\s*=\s*["']([^"']+)["']/i)?.[1]
    const bodyValue = tag.match(/>([\s\S]*?)<\/(?:[\w-]+:)?category>/i)?.[1]
    const value = cleanXmlText(attrValue || bodyValue || '')
    if (value && !categories.some(existing => existing.toLowerCase() === value.toLowerCase())) {
      categories.push(value)
    }
  }

  return categories
}

function readItemKeywords(block: string) {
  const keywords = [
    ...splitKeywordText(extractXmlTag(block, 'keywords')),
    ...splitKeywordText(extractXmlTag(block, 'subject')),
  ]

  return keywords.filter((keyword, index) => {
    return keywords.findIndex(existing => existing.toLowerCase() === keyword.toLowerCase()) === index
  })
}

function readItemAuthor(block: string) {
  const value = extractXmlTag(block, 'creator') ||
    extractXmlTag(block, 'author') ||
    extractXmlTag(block, 'name')
  return value ? truncateText(stripHtmlTags(value), 160) : ''
}

function isImageUrl(value: string) {
  return /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(value)
}

function readMediaContentImage(block: string) {
  const tags = block.match(/<(?:media:)?content\b[^>]*\/?>/gi) || []

  for (const tag of tags) {
    const url = readXmlAttribute(tag, 'content', 'url') || ''
    const type = (readXmlAttribute(tag, 'content', 'type') || '').toLowerCase()
    if (url && (type.startsWith('image/') || isImageUrl(url))) {
      return url
    }
  }

  return ''
}

function readFirstImageFromHtml(value: string) {
  const match = value.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
  return match ? decodeXmlEntities(match[1]).trim() : ''
}

function readItemMedia(block: string, contentHtml: string) {
  const enclosureUrl = readXmlAttribute(block, 'enclosure', 'url') || ''
  const enclosureType = readXmlAttribute(block, 'enclosure', 'type') || ''
  const thumbnail = readXmlAttribute(block, 'thumbnail', 'url') ||
    readMediaContentImage(block) ||
    (enclosureType.toLowerCase().startsWith('image/') || isImageUrl(enclosureUrl) ? enclosureUrl : '') ||
    readFirstImageFromHtml(contentHtml)

  return {
    enclosureType,
    enclosureUrl,
    thumbnail,
  }
}

function buildRssItemMeta(block: string, source: RssItemSource, guid: string) {
  const contentHtml = readItemContentHtml(block)
  const contentText = stripHtmlTags(contentHtml)
  const media = readItemMedia(block, contentHtml)
  const categories = readItemCategories(block)
  const keywords = readItemKeywords(block)
  const summary = readItemSummary(block) || truncateText(contentText, 600)

  return {
    author: readItemAuthor(block),
    categories,
    contentHtml: truncateText(contentHtml, 8000),
    contentLength: normalizeWhitespace(contentText).length,
    contentText: truncateText(contentText, 5000),
    enclosureType: media.enclosureType,
    enclosureUrl: media.enclosureUrl,
    feedRole: source.feedRole || '',
    feedUrl: source.feedUrl || '',
    guid,
    keywords,
    summary,
    thumbnail: media.thumbnail,
  }
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
      meta: buildRssItemMeta(block, source, extractXmlTag(block, 'guid') || ''),
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
      meta: buildRssItemMeta(block, source, extractXmlTag(block, 'id') || ''),
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
