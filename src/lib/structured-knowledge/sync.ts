import { parseStructuredMarkdown } from './markdown-parser.ts'
import type { StructuredKnowledgeSyncResult } from './types.ts'
import {
  countStructuredEntities,
  countStructuredRelations,
  getStructuredBlocksByDocument,
  getStructuredDocumentByPath,
  upsertStructuredDocument,
} from '../../db/structured-knowledge.ts'

export interface StructuredKnowledgeMetadataInput {
  documentId: string
  blockCount: number
  headingCount: number
  entityCount: number
  relationCount: number
  lastStructuredAt: number
  lastSemanticExtractedAt?: number
}

export function buildStructuredKnowledgeMetadata(input: StructuredKnowledgeMetadataInput) {
  return {
    structuredKnowledge: {
      documentId: input.documentId,
      documentKind: 'markdown' as const,
      blockCount: input.blockCount,
      headingCount: input.headingCount,
      entityCount: input.entityCount,
      relationCount: input.relationCount,
      lastStructuredAt: input.lastStructuredAt,
      ...(input.lastSemanticExtractedAt ? { lastSemanticExtractedAt: input.lastSemanticExtractedAt } : {}),
    },
  }
}

export interface SyncStructuredMarkdownContentInput {
  filePath: string
  content: string
  title?: string
  updateKnowledgeObject?: boolean
  force?: boolean
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function titleFromPath(filePath: string): string {
  const name = normalizePath(filePath).split('/').pop() || filePath
  return name.replace(/\.(md|markdown|mdx)$/i, '') || name
}

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata) return {}
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata as Record<string, unknown>
  if (typeof metadata !== 'string') return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function syncStructuredMarkdownContent(input: SyncStructuredMarkdownContentInput): Promise<StructuredKnowledgeSyncResult> {
  const filePath = normalizePath(input.filePath)
  const sourceId = filePath
  const { objectRegistry } = await import('../knowledge/object-registry.ts')
  let ko = await objectRegistry.getBySource('note', sourceId)
  if (!ko && input.updateKnowledgeObject !== false) {
    const id = await objectRegistry.register({
      sourceType: 'note',
      sourceId,
      path: filePath,
      title: input.title || titleFromPath(filePath),
      origin: 'synced',
      status: 'active',
    })
    ko = await objectRegistry.getById(id)
  }
  const sourceObjectId = ko?.id || `ko_note_${sourceId}`
  const parsed = parseStructuredMarkdown({
    filePath,
    sourceObjectId,
    content: input.content,
    now: Date.now(),
  })

  const existing = await getStructuredDocumentByPath(filePath)
  if (!input.force && existing?.contentHash === parsed.document.contentHash) {
    const blocks = await getStructuredBlocksByDocument(existing.id)
    const entityCount = await countStructuredEntities(existing.id)
    const relationCount = await countStructuredRelations(existing.id)
    return {
      documentId: existing.id,
      filePath,
      skipped: true,
      warningCount: 0,
      warnings: [],
      blockCount: blocks.length,
      headingCount: existing.headings.length,
      entityCount,
      relationCount,
    }
  }

  await upsertStructuredDocument(parsed)
  const entityCount = await countStructuredEntities(parsed.document.id)
  const relationCount = await countStructuredRelations(parsed.document.id)

  if (input.updateKnowledgeObject !== false) {
    await objectRegistry.touch('note', sourceId, {
      path: filePath,
      title: parsed.document.title,
      contentHash: parsed.document.contentHash,
      metadata: {
        ...parseMetadata(ko?.metadata),
        ...buildStructuredKnowledgeMetadata({
          documentId: parsed.document.id,
          blockCount: parsed.blocks.length,
          headingCount: parsed.headings.length,
          entityCount,
          relationCount,
          lastStructuredAt: parsed.document.structuredAt,
          lastSemanticExtractedAt: parsed.document.semanticExtractedAt,
        }),
      },
    })
  }

  return {
    documentId: parsed.document.id,
    filePath,
    skipped: false,
    warningCount: parsed.warnings.length,
    warnings: parsed.warnings,
    blockCount: parsed.blocks.length,
    headingCount: parsed.headings.length,
    entityCount,
    relationCount,
  }
}
