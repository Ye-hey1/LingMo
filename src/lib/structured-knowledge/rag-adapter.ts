import type { StructuredBlock, StructuredMarkdownDocument } from './types'

export interface StructuredRagChunkMetadata {
  sourceObjectId: string
  structuredDocumentId: string
  blockIds: string[]
  headingPath: string[]
  wikilinks: string[]
  tags: string[]
  chunkType: 'structured_markdown'
}

export interface StructuredRagChunk {
  filename: string
  chunkId: number
  content: string
  metadata: StructuredRagChunkMetadata
}

export interface BuildStructuredRagChunksOptions {
  targetSize?: number
  overlap?: number
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sameHeadingPath(a: string[], b: string[]): boolean {
  return a.join('\u241f') === b.join('\u241f')
}

function chunkContentForBlock(block: StructuredBlock): string {
  const prefix = block.headingPath.length ? `## ${block.headingPath.join(' / ')}\n\n` : ''
  return `${prefix}${block.markdown || block.text}`.trim()
}

function finalizeChunk(document: StructuredMarkdownDocument, chunkId: number, blocks: StructuredBlock[]): StructuredRagChunk {
  const headingPath = blocks[0]?.headingPath || []
  return {
    filename: document.filePath,
    chunkId,
    content: blocks.map(chunkContentForBlock).join('\n\n').trim(),
    metadata: {
      sourceObjectId: document.sourceObjectId,
      structuredDocumentId: document.id,
      blockIds: blocks.map(block => block.id),
      headingPath,
      wikilinks: unique(blocks.flatMap(block => block.wikilinks)),
      tags: unique(blocks.flatMap(block => block.tags)),
      chunkType: 'structured_markdown',
    },
  }
}

export function buildStructuredRagChunks(
  document: StructuredMarkdownDocument,
  blocks: StructuredBlock[],
  options: BuildStructuredRagChunksOptions = {},
): StructuredRagChunk[] {
  const targetSize = options.targetSize ?? 1200
  const chunks: StructuredRagChunk[] = []
  let current: StructuredBlock[] = []
  let currentSize = 0

  for (const block of blocks) {
    if (!block.text.trim() && !block.markdown.trim()) continue
    const blockContent = chunkContentForBlock(block)
    const shouldKeepWhole = block.type === 'code' || block.type === 'table' || block.type === 'quote'
    const headingChanged = current.length > 0 && !sameHeadingPath(current[0].headingPath, block.headingPath)
    const wouldOverflow = current.length > 0 && currentSize + blockContent.length > targetSize

    if (headingChanged || (wouldOverflow && !shouldKeepWhole)) {
      chunks.push(finalizeChunk(document, chunks.length, current))
      current = []
      currentSize = 0
    }

    current.push(block)
    currentSize += blockContent.length + 2

    if (shouldKeepWhole && currentSize >= targetSize) {
      chunks.push(finalizeChunk(document, chunks.length, current))
      current = []
      currentSize = 0
    }
  }

  if (current.length > 0) {
    chunks.push(finalizeChunk(document, chunks.length, current))
  }

  return chunks
}
