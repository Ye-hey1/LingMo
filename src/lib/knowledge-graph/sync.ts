import type { KnowledgeObject } from '@/db/knowledge-objects'
import { parseKnowledgeObjectAliases, parseKnowledgeObjectMetadata, parseKnowledgeObjectTags } from '@/db/knowledge-objects'
import type { NoteRelation } from '@/db/note-relations'
import { getAllRelations } from '@/db/note-relations'
import {
  bulkUpsertKnowledgeGraphEdges,
  bulkUpsertKnowledgeGraphNodes,
  queryKnowledgeGraphNodes,
  softDeleteKnowledgeGraphEdgesBySource,
  type KnowledgeGraphEdgeInput,
  type KnowledgeGraphNodeInput,
} from '@/db/knowledge-graph'
import { objectRegistry } from '@/lib/knowledge/object-registry'
import { extractWikiLinksWithContext, normalizeWikiLinkTarget } from '@/lib/wikilink-extension'

export interface NoteLinkSyncInput {
  filePath: string
  content: string
}

export function knowledgeObjectNodeId(object: Pick<KnowledgeObject, 'id' | 'sourceType' | 'sourceId'>) {
  return object.id || `ko_${object.sourceType}_${object.sourceId}`
}

export function sourceNodeId(sourceType: string, sourceId: string) {
  return `ko_${sourceType}_${sourceId}`
}

function nodeTypeForObject(object: KnowledgeObject) {
  if (object.sourceType === 'note' || object.sourceType === 'diagram' || object.sourceType === 'agent_run') return object.sourceType
  return 'knowledge_object'
}

function objectToNode(object: KnowledgeObject): KnowledgeGraphNodeInput {
  return {
    id: knowledgeObjectNodeId(object),
    objectId: object.id,
    nodeType: nodeTypeForObject(object),
    label: object.title || object.path || object.sourceId,
    sourceType: object.sourceType,
    sourceId: object.sourceId,
      tags: parseKnowledgeObjectTags(object.tags),

    confidence: 1,
    metadata: {
      path: object.path,
      sourceUrl: object.sourceUrl,
      status: object.status,
      origin: object.origin,
      aliases: parseKnowledgeObjectAliases(object.aliases),
      sourceRunId: object.sourceRunId,
      contentHash: object.contentHash,
      vectorIndexedAt: object.vectorIndexedAt,
      ...parseKnowledgeObjectMetadata(object.metadata),
    },
  }
}

export async function syncKnowledgeObjectToGraph(object: KnowledgeObject) {
  await bulkUpsertKnowledgeGraphNodes([objectToNode(object)])
}

export async function syncKnowledgeObjectsToGraph(objects: KnowledgeObject[]) {
  await bulkUpsertKnowledgeGraphNodes(objects.map(objectToNode))
}

function normalizeLookup(value?: string | null) {
  return (value || '')
    .replace(/\\/g, '/')
    .replace(/\.(md|markdown)$/i, '')
    .trim()
    .toLowerCase()
}

function buildNoteLookup(objects: KnowledgeObject[]) {
  const lookup = new Map<string, KnowledgeObject>()
  for (const object of objects) {
    if (object.sourceType !== 'note') continue
    const keys = [object.sourceId, object.path, object.title, ...(parseKnowledgeObjectAliases(object.aliases) || [])]
    for (const key of keys) {
      const normalized = normalizeLookup(key)
      if (normalized && !lookup.has(normalized)) lookup.set(normalized, object)
    }
  }
  return lookup
}

export async function syncNoteLinksToGraph(notes: NoteLinkSyncInput[]) {
  if (!notes.length) return
  const noteObjects = await objectRegistry.query({ sourceType: 'note', status: ['active', 'inbox', 'archived'], limit: 5000 })
  await syncKnowledgeObjectsToGraph(noteObjects)
  const lookup = buildNoteLookup(noteObjects)
  const edges: KnowledgeGraphEdgeInput[] = []

  for (const note of notes) {
    const sourceObject = lookup.get(normalizeLookup(note.filePath))
    if (!sourceObject) continue
    const sourceNode = knowledgeObjectNodeId(sourceObject)
    await softDeleteKnowledgeGraphEdgesBySource('wikilink', sourceNode)
    for (const link of extractWikiLinksWithContext(note.content)) {
      const rawTarget = link.target
      const normalizedTarget = normalizeWikiLinkTarget(rawTarget)
      const targetObject = lookup.get(normalizeLookup(normalizedTarget)) || lookup.get(normalizeLookup(rawTarget))
      if (!targetObject || targetObject.sourceId === sourceObject.sourceId) continue
      edges.push({
        sourceNodeId: sourceNode,
        targetNodeId: knowledgeObjectNodeId(targetObject),
        edgeType: 'wikilink',
        sourceMethod: 'wikilink',
        label: 'wikilink',
        weight: 1,
        confidence: 1,
        evidence: link.context || `[[${rawTarget}]]`,
        metadata: {
          sourcePath: note.filePath,
          target: rawTarget,
          line: link.line,
        },
      })
    }
  }

  await bulkUpsertKnowledgeGraphEdges(edges)
}

export async function syncNoteRelationsToGraph(relations?: NoteRelation[]) {
  const noteRelations = relations || await getAllRelations()
  if (!noteRelations.length) return
  const noteObjects = await objectRegistry.query({ sourceType: 'note', status: ['active', 'inbox', 'archived'], limit: 5000 })
  await syncKnowledgeObjectsToGraph(noteObjects)
  const lookup = buildNoteLookup(noteObjects)
  const edges: KnowledgeGraphEdgeInput[] = []

  for (const relation of noteRelations) {
    const source = lookup.get(normalizeLookup(relation.source_note))
    const target = lookup.get(normalizeLookup(relation.target_note))
    if (!source || !target) continue
    edges.push({
      sourceNodeId: knowledgeObjectNodeId(source),
      targetNodeId: knowledgeObjectNodeId(target),
      edgeType: relation.relation_type || 'semantic',
      sourceMethod: relation.source_method || 'note_relation',
      label: relation.relation_type || 'semantic',
      weight: relation.confidence || 1,
      confidence: relation.confidence || 1,
      evidence: relation.evidence,
      metadata: {
        relationId: relation.id,
        keywordOverlapScore: relation.keyword_overlap_score,
        cosineSimScore: relation.cosine_sim_score,
        llmConfirmed: relation.llm_confirmed,
      },
    })
  }

  await bulkUpsertKnowledgeGraphEdges(edges)
}

export async function refreshKnowledgeGraph(options: { includeRelations?: boolean } = {}) {
  const objects = await objectRegistry.query({ status: ['active', 'inbox', 'archived'], limit: 10000 })
  await syncKnowledgeObjectsToGraph(objects)
  if (options.includeRelations !== false) {
    await syncNoteRelationsToGraph()
  }
  return {
    objectCount: objects.length,
    relationSync: options.includeRelations !== false,
  }
}

export async function findKnowledgeGraphNodeIdForSource(sourceType: string, sourceId: string) {
  const nodes = await queryKnowledgeGraphNodes({ sourceType, sourceId, limit: 1 })
  return nodes[0]?.id || sourceNodeId(sourceType, sourceId)
}
