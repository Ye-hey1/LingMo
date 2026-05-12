import useArticleStore from '@/stores/article'
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
  const contentLower = content.toLowerCase()
  const lines = content.split('\n')

  // Build regex-safe set of note names (exclude very short names to avoid false positives)
  const candidates = otherNotes
    .map(f => ({ path: f.relativePath, name: f.name.replace(/\.md$/, '') }))
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

    // Check for exact name match in content (not already inside [[...]])
    const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match name with word boundaries
    const mentionRegex = new RegExp(
      `(?<![\\[|])\\b${escapedName}\\b(?![\\] |]\\w)`,
      'gi',
    )

    let matchCount = 0
    let firstLine = -1

    for (let i = 0; i < lines.length; i++) {
      // Skip lines that are inside code blocks
      if (lines[i].startsWith('```')) continue

      const line = lines[i]
      // Remove existing [[...]] links from line to avoid matching inside them
      const cleanLine = line.replace(/\[\[[^\]]*\]\]/g, '')
      const lineMatches = cleanLine.match(mentionRegex)
      if (lineMatches && lineMatches.length > 0) {
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
  let result = content
  const lines = result.split('\n')

  for (const suggestion of suggestions) {
    const escapedName = suggestion.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Only replace first occurrence per suggestion, not inside [[...]] or code blocks
    const regex = new RegExp(
      `(?<![\\[|])\\b${escapedName}\\b(?![\\] |]\\w)`,
      'i',
    )

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('```')) continue
      const cleanLine = lines[i].replace(/\[\[[^\]]*\]\]/g, '')
      if (regex.test(cleanLine)) {
        // Replace in the original line (not the cleaned version)
        lines[i] = lines[i].replace(
          new RegExp(`(?<![\\[|])\\b${escapedName}\\b(?![\\] |]\\w)`, 'i'),
          `[[${suggestion.target}]]`,
        )
        break
      }
    }
  }

  return lines.join('\n')
}
