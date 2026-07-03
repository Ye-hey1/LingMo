import { getStructuredDocumentBundleByPath } from '../../db/structured-knowledge.ts'
import type { EvidenceBlockResult, StructuredBlock } from './types.ts'

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(query: string): string[] {
  const compact = normalizeText(query).toLowerCase()
  if (!compact) return []
  const tokens = compact
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(item => item.trim())
    .filter(item => item.length >= 2)
  return Array.from(new Set([compact, ...tokens]))
}

export function scoreEvidenceBlock(block: StructuredBlock, query: string): number {
  const tokens = tokenize(query)
  if (!tokens.length) return 0
  const headingText = block.headingPath.join(' ').toLowerCase()
  const haystack = [block.text, block.markdown, headingText, block.wikilinks.join(' '), block.tags.join(' ')]
    .join(' ')
    .toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (!token) continue
    if (haystack.includes(token)) score += token.includes(' ') ? 4 : 1
    if (headingText.includes(token)) score += 2
    if (block.wikilinks.some(link => link.toLowerCase().includes(token))) score += 2
    if (block.tags.some(tag => tag.toLowerCase().includes(token))) score += 1.5
  }
  return score
}

export function createExcerpt(text: string, query: string, maxLength = 260): string {
  const normalized = normalizeText(text)
  if (normalized.length <= maxLength) return normalized
  const tokens = tokenize(query).filter(token => !token.includes(' '))
  const lower = normalized.toLowerCase()
  const firstHit = tokens
    .map(token => lower.indexOf(token))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstHit - Math.floor(maxLength / 3))
  const end = Math.min(normalized.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
}

export function formatEvidenceBlock(result: EvidenceBlockResult): string {
  const heading = result.block.headingPath.length ? ` / ${result.block.headingPath.join(' / ')}` : ''
  return `[${result.document.filePath}${heading} / ${result.block.id}] ${result.excerpt}`
}

export interface FindEvidenceBlocksInput {
  query: string
  filePath: string
  limit?: number
}

export async function findEvidenceBlocks(input: FindEvidenceBlocksInput): Promise<EvidenceBlockResult[]> {
  const bundle = await getStructuredDocumentBundleByPath(input.filePath)
  if (!bundle) return []
  const scored = bundle.blocks
    .map(block => ({
      block,
      document: { id: bundle.document.id, filePath: bundle.document.filePath, title: bundle.document.title },
      score: scoreEvidenceBlock(block, input.query),
      excerpt: createExcerpt(block.text || block.markdown, input.query),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.block.order - b.block.order)
  return scored.slice(0, Math.max(1, input.limit || 8))
}
