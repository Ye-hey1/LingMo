import { useNoteIndexStore } from '@/stores/note-index'
import { getAllMarkdownFiles } from '@/lib/files'
import { extractWikiLinks } from '@/lib/wikilink-extension'

export interface BacklinkSuggestion {
  /** The plain text in the note that matches another note's name */
  text: string
  /** The target note name (without .md) for the [[link]] */
  target: string
  /** Why this link was suggested */
  reason: string
  /** 0-based line number where the match occurs */
  line: number
  /** Score for ranking */
  score: number
}

interface MentionRange {
  start: number
  end: number
}

const WIKILINK_RE = /\[\[[^\]]*\]\]/g
const CODE_FENCE_RE = /^\s*(```|~~~)/
const ASCII_WORD_CHAR_RE = /[A-Za-z0-9_-]/

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isAsciiWordChar(value: string | undefined) {
  return Boolean(value && ASCII_WORD_CHAR_RE.test(value))
}

function getWikiLinkRanges(line: string): MentionRange[] {
  const ranges: MentionRange[] = []
  WIKILINK_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = WIKILINK_RE.exec(line)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return ranges
}

function rangesOverlap(start: number, end: number, ranges: MentionRange[]) {
  return ranges.some(range => start < range.end && end > range.start)
}

function isMentionBoundary(line: string, start: number, end: number, mention: string) {
  const previous = start > 0 ? line[start - 1] : undefined
  const next = end < line.length ? line[end] : undefined
  const first = mention[0]
  const last = mention[mention.length - 1]

  if (isAsciiWordChar(previous) && isAsciiWordChar(first)) return false
  if (isAsciiWordChar(next) && isAsciiWordChar(last)) return false

  return true
}

function findPlainTextMentions(line: string, name: string): MentionRange[] {
  if (!line || !name) return []

  const ranges = getWikiLinkRanges(line)
  const mentionRe = new RegExp(escapeRegExp(name), 'giu')
  const mentions: MentionRange[] = []

  let match: RegExpExecArray | null
  while ((match = mentionRe.exec(line)) !== null) {
    const start = match.index
    const end = start + match[0].length

    if (!rangesOverlap(start, end, ranges) && isMentionBoundary(line, start, end, match[0])) {
      mentions.push({ start, end })
    }
  }

  return mentions
}

function replaceFirstPlainTextMention(line: string, name: string, target: string) {
  const mention = findPlainTextMentions(line, name)[0]
  if (!mention) return null

  return `${line.slice(0, mention.start)}[[${target}]]${line.slice(mention.end)}`
}

/**
 * Scan the current note and find opportunities to create [[wiki-links]]
 * to other existing notes whose names appear in the content but are not yet linked.
 */
export async function findBacklinkSuggestions(
  filePath: string,
  content: string,
  maxSuggestions = 12,
): Promise<BacklinkSuggestion[]> {
  const existingLinks = new Set(
    extractWikiLinks(content).map(l => l.toLowerCase()),
  )

  const allFiles = await getAllMarkdownFiles()
  const otherNotes = allFiles.filter(f => f.relativePath !== filePath)
  const lines = content.split('\n')

  // Build regex-safe set of note names (exclude very short names to avoid false positives)
  const candidates = otherNotes
    .map(f => ({ name: f.name.replace(/\.md$/, '') }))
    .filter(c => c.name.length >= 2)

  // Also include backlink sources (notes that already link TO this file)
  const noteIndexStore = useNoteIndexStore.getState()
  const backlinks = noteIndexStore.getBacklinks(filePath) || []
  const backlinkNames = new Set<string>()
  for (const bl of backlinks) {
    const blName = bl.sourcePath.split('/').pop()?.replace(/\.md$/, '') || ''
    if (blName.length >= 2) backlinkNames.add(blName)
  }

  const suggestions: BacklinkSuggestion[] = []

  for (const candidate of candidates) {
    const nameLower = candidate.name.toLowerCase()
    if (existingLinks.has(nameLower)) continue

    let matchCount = 0
    let firstLine = -1
    let insideCodeFence = false

    for (let i = 0; i < lines.length; i++) {
      if (CODE_FENCE_RE.test(lines[i])) {
        insideCodeFence = !insideCodeFence
        continue
      }

      if (insideCodeFence) continue

      const line = lines[i]
      const lineMatches = findPlainTextMentions(line, candidate.name)
      if (lineMatches.length > 0) {
        matchCount += lineMatches.length
        if (firstLine === -1) firstLine = i
      }
    }

    if (matchCount === 0) continue

    let score = matchCount
    // Title area bonus
    if (firstLine <= 3) score += 2
    // Bidirectional bonus: the target already links to us
    if (backlinkNames.has(candidate.name)) score += 3

    suggestions.push({
      text: candidate.name,
      target: candidate.name,
      reason: matchCount > 1
        ? `在正文中出现 ${matchCount} 次`
        : '在正文中出现 1 次',
      line: firstLine,
      score,
    })
  }

  suggestions.sort((a, b) => b.score - a.score)
  return suggestions.slice(0, maxSuggestions)
}

/**
 * Apply suggested backlinks to the content by replacing plain text with [[wiki-links]].
 * Only replaces the first occurrence of each candidate to be conservative.
 */
export function applyBacklinks(
  content: string,
  suggestions: BacklinkSuggestion[],
): string {
  const result = content
  const lines = result.split('\n')
  const orderedSuggestions = [...suggestions].sort((a, b) => b.text.length - a.text.length)

  for (const suggestion of orderedSuggestions) {
    let insideCodeFence = false

    for (let i = 0; i < lines.length; i++) {
      if (CODE_FENCE_RE.test(lines[i])) {
        insideCodeFence = !insideCodeFence
        continue
      }

      if (insideCodeFence) continue

      const updatedLine = replaceFirstPlainTextMention(lines[i], suggestion.text, suggestion.target)
      if (updatedLine !== null) {
        lines[i] = updatedLine
        break
      }
    }
  }

  return lines.join('\n')
}
