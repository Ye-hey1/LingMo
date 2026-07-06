import { getStructuredDocumentBundleByPath } from '../../db/structured-knowledge.ts'
import type {
  ExtractedEntity,
  ExtractedRelation,
  StructuredBlock,
  StructuredGraphEdge,
  StructuredGraphNode,
  StructuredMarkdownDocument,
} from './types.ts'

export interface StructuredGraphBundle {
  document: StructuredMarkdownDocument
  blocks: StructuredBlock[]
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
}

export interface StructuredGraphOptions {
  includeHeadings?: boolean
  includeEvidenceBlocks?: boolean
  minConfidence?: number
}

function entityNodeId(entity: ExtractedEntity) {
  return `structured_entity:${entity.id}`
}

function noteNodeId(document: StructuredMarkdownDocument) {
  return `structured_note:${document.id}`
}

export function buildStructuredGraphForBundle(
  bundle: StructuredGraphBundle,
  options: StructuredGraphOptions = {},
): { nodes: StructuredGraphNode[]; edges: StructuredGraphEdge[] } {
  const minConfidence = options.minConfidence ?? 0.7
  const nodes: StructuredGraphNode[] = []
  const edges: StructuredGraphEdge[] = []
  const noteId = noteNodeId(bundle.document)

  nodes.push({
    id: noteId,
    label: bundle.document.title,
    type: 'note',
    sourceDocumentId: bundle.document.id,
    sourceObjectId: bundle.document.sourceObjectId,
    filePath: bundle.document.filePath,
  })

  if (options.includeHeadings) {
    for (const heading of bundle.document.headings) {
      const headingId = `structured_heading:${heading.id}`
      nodes.push({
        id: headingId,
        label: heading.text,
        type: 'heading',
        sourceDocumentId: bundle.document.id,
        filePath: bundle.document.filePath,
        metadata: { level: heading.level, path: heading.path },
      })
      edges.push({
        id: `structured_edge:${bundle.document.id}:contains:${heading.id}`,
        source: noteId,
        target: headingId,
        type: 'contains',
      })
    }
  }

  const entityById = new Map<string, ExtractedEntity>()
  for (const entity of bundle.entities) {
    if (entity.confidence < minConfidence) continue
    entityById.set(entity.id, entity)
    nodes.push({
      id: entityNodeId(entity),
      label: entity.name,
      type: entity.type === 'claim' ? 'claim' : 'entity',
      sourceDocumentId: bundle.document.id,
      filePath: bundle.document.filePath,
      confidence: entity.confidence,
      metadata: { entityType: entity.type, aliases: entity.aliases },
    })
    edges.push({
      id: `structured_edge:${bundle.document.id}:mentions:${entity.id}`,
      source: noteId,
      target: entityNodeId(entity),
      type: 'mentions',
      confidence: entity.confidence,
      evidenceBlockIds: entity.evidenceBlockIds,
    })
  }

  for (const relation of bundle.relations) {
    if (relation.confidence < minConfidence) continue
    if (!relation.evidenceBlockIds.length) continue
    if (!entityById.has(relation.sourceEntityId) || !entityById.has(relation.targetEntityId)) continue
    edges.push({
      id: `structured_relation:${relation.id}`,
      source: entityNodeId(entityById.get(relation.sourceEntityId)!),
      target: entityNodeId(entityById.get(relation.targetEntityId)!),
      type: relation.relationType,
      label: relation.relationType,
      confidence: relation.confidence,
      evidenceBlockIds: relation.evidenceBlockIds,
    })
  }

  if (options.includeEvidenceBlocks) {
    for (const block of bundle.blocks) {
      const blockId = `structured_block:${block.id}`
      nodes.push({
        id: blockId,
        label: block.headingPath.at(-1) || `Block ${block.order + 1}`,
        type: 'block',
        sourceDocumentId: bundle.document.id,
        filePath: bundle.document.filePath,
        metadata: { order: block.order, headingPath: block.headingPath },
      })
    }
  }

  return { nodes, edges }
}

export async function getStructuredGraphForFile(filePath: string, options: StructuredGraphOptions = {}) {
  const bundle = await getStructuredDocumentBundleByPath(filePath)
  if (!bundle) return { nodes: [], edges: [] }
  return buildStructuredGraphForBundle(bundle, options)
}
