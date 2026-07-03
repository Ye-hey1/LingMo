import { createHash } from 'crypto'
import type {
  ExtractedEntity,
  ParsedMarkdownStructure,
  StructuredBlock,
  StructuredBlockType,
  StructuredHeading,
  StructuredMarkdownDocument,
} from './types'

export interface ParseStructuredMarkdownInput {
  filePath: string
  sourceObjectId: string
  content: string
  now?: number
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

export function createStableId(prefix: string, parts: unknown[]): string {
  return `${prefix}_${hashText(parts.map(part => String(part ?? '')).join('\u241f')).slice(0, 24)}`
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function titleFromPath(filePath: string): string {
  const name = normalizePath(filePath).split('/').pop() || filePath
  return name.replace(/\.(md|markdown|mdx)$/i, '') || name
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const quoted = trimmed.match(/^['"]([\s\S]*)['"]$/)
  if (quoted) return quoted[1]
  const array = trimmed.match(/^\[(.*)]$/)
  if (array) {
    return array[1]
      .split(',')
      .map(item => String(parseScalar(item.trim())).trim())
      .filter(Boolean)
  }
  return trimmed
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string; warnings: string[] } {
  const warnings: string[] = []
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return { frontmatter: {}, body: content, warnings }

  const frontmatter: Record<string, unknown> = {}
  try {
    for (const line of match[1].split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const pair = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (!pair) {
        warnings.push(`Unsupported frontmatter line: ${trimmed}`)
        continue
      }
      frontmatter[pair[1]] = parseScalar(pair[2])
    }
  } catch (error) {
    warnings.push(`Frontmatter parse failed: ${error instanceof Error ? error.message : String(error)}`)
    return { frontmatter: {}, body: content.slice(match[0].length), warnings }
  }

  return { frontmatter, body: content.slice(match[0].length), warnings }
}

export function extractWikilinks(text: string): string[] {
  const links = new Set<string>()
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?]]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const value = match[1]?.trim()
    if (value) links.add(value)
  }
  return Array.from(links)
}

export function extractHashTags(text: string): string[] {
  const tags = new Set<string>()
  const regex = /(^|\s)#([\p{L}\p{N}_-]{2,})/gu
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const value = match[2]?.trim()
    if (value) tags.add(value)
  }
  return Array.from(tags)
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~\[\]()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .slice(0, 80) || 'section'
}

function blockTypeFromLines(lines: string[]): StructuredBlockType {
  const first = lines.find(line => line.trim())?.trim() || ''
  if (/^#{1,6}\s+/.test(first)) return 'heading'
  if (/^```|^~~~/.test(first)) return 'code'
  if (/^>\s?/.test(first)) return 'quote'
  if (/^[-*+]\s+|^\d+\.\s+/.test(first)) return 'list'
  if (/^\|.*\|$/.test(first)) return 'table'
  if (/^<\/?[A-Za-z]/.test(first)) return 'html'
  if (/^\$\$/.test(first)) return 'math'
  return 'paragraph'
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, match => match.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_m, target, label) => label || target)
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHeadingPath(stack: StructuredHeading[]): string[] {
  return stack.map(item => item.text)
}

function createLocalEntity(documentId: string, name: string, type: ExtractedEntity['type'], evidenceBlockIds: string[], now: number): ExtractedEntity {
  const normalizedName = name.trim().toLowerCase()
  return {
    id: createStableId('ske', [documentId, normalizedName, type]),
    documentId,
    name: name.trim(),
    normalizedName,
    type,
    aliases: [],
    evidenceBlockIds,
    confidence: 0.75,
    extractionMethod: 'local',
    createdAt: now,
    updatedAt: now,
  }
}

export function parseStructuredMarkdown(input: ParseStructuredMarkdownInput): ParsedMarkdownStructure {
  const now = input.now ?? 0
  const filePath = normalizePath(input.filePath)
  const documentId = createStableId('smd', [filePath])
  const { frontmatter, body, warnings } = parseFrontmatter(input.content)
  const documentTags = new Set([...stringArray(frontmatter.tags), ...extractHashTags(body)])
  const documentLinks = new Set(extractWikilinks(body))
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : titleFromPath(filePath)

  const headings: StructuredHeading[] = []
  const blocks: StructuredBlock[] = []
  const headingStack: StructuredHeading[] = []
  const lines = body.split(/\r?\n/)
  let buffer: string[] = []
  let bufferStart = 1
  let inFence = false
  let fenceMarker = ''
  let currentHeading: StructuredHeading | undefined

  const flushBlock = (endLine: number) => {
    const markdown = buffer.join('\n').trimEnd()
    if (!markdown.trim()) {
      buffer = []
      bufferStart = endLine + 1
      return
    }
    const text = plainText(markdown)
    const block: StructuredBlock = {
      id: createStableId('skb', [documentId, blocks.length, bufferStart, hashText(markdown)]),
      documentId,
      headingId: currentHeading?.id,
      type: blockTypeFromLines(buffer),
      text,
      markdown,
      order: blocks.length,
      lineStart: bufferStart,
      lineEnd: endLine,
      headingPath: buildHeadingPath(headingStack),
      wikilinks: extractWikilinks(markdown),
      tags: extractHashTags(markdown),
      contentHash: hashText(markdown),
    }
    blocks.push(block)
    buffer = []
    bufferStart = endLine + 1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
      if (buffer.length === 0) bufferStart = lineNo
      buffer.push(line)
      continue
    }

    if (!inFence) {
      const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (headingMatch) {
        flushBlock(lineNo - 1)
        const level = headingMatch[1].length
        const text = headingMatch[2].trim()
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop()
        }
        const heading: StructuredHeading = {
          id: createStableId('skh', [documentId, headings.length, level, text]),
          documentId,
          level,
          text,
          slug: slugify(text),
          order: headings.length,
          parentId: headingStack[headingStack.length - 1]?.id,
          path: [...headingStack.map(item => item.text), text],
          lineStart: lineNo,
          lineEnd: lineNo,
        }
        headings.push(heading)
        headingStack.push(heading)
        currentHeading = heading
        bufferStart = lineNo + 1
        continue
      }

      if (!line.trim()) {
        flushBlock(lineNo - 1)
        continue
      }
    }

    if (buffer.length === 0) bufferStart = lineNo
    buffer.push(line)
  }
  flushBlock(lines.length)

  const entitiesByKey = new Map<string, ExtractedEntity>()
  for (const link of documentLinks) {
    const evidence = blocks.filter(block => block.wikilinks.includes(link)).map(block => block.id)
    entitiesByKey.set(`concept:${link.toLowerCase()}`, createLocalEntity(documentId, link, 'concept', evidence, now))
  }
  for (const tag of documentTags) {
    const evidence = blocks.filter(block => block.tags.includes(tag)).map(block => block.id)
    entitiesByKey.set(`concept:${tag.toLowerCase()}`, createLocalEntity(documentId, tag, 'concept', evidence, now))
  }
  for (const heading of headings) {
    entitiesByKey.set(`concept:${heading.text.toLowerCase()}`, createLocalEntity(documentId, heading.text, 'concept', [], now))
  }

  const document: StructuredMarkdownDocument = {
    id: documentId,
    sourceObjectId: input.sourceObjectId,
    filePath,
    title,
    contentHash: hashText(input.content),
    frontmatter,
    tags: Array.from(documentTags),
    wikilinks: Array.from(documentLinks),
    headings,
    blocks,
    createdAt: now,
    updatedAt: now,
    structuredAt: now,
  }

  return {
    document,
    headings,
    blocks,
    localEntities: Array.from(entitiesByKey.values()),
    warnings,
  }
}
