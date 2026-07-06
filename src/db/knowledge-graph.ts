import { getDb, runDbTransaction, serializedWrite } from './index'

export type KnowledgeGraphNodeType =
  | 'knowledge_object'
  | 'note'
  | 'diagram'
  | 'agent_run'
  | 'tag'
  | 'entity'
  | 'block'
  | string

export type KnowledgeGraphEdgeType =
  | 'wikilink'
  | 'semantic'
  | 'tagged_with'
  | 'mentions'
  | 'contains'
  | 'generated_by'
  | string

export interface KnowledgeGraphNode {
  id: string
  objectId?: string | null
  nodeType: KnowledgeGraphNodeType
  label: string
  sourceType: string
  sourceId: string
  metadataJson?: string | null
  tagsJson?: string | null
  confidence: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export interface KnowledgeGraphEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  edgeType: KnowledgeGraphEdgeType
  sourceMethod: string
  label?: string | null
  weight: number
  confidence: number
  evidence?: string | null
  metadataJson?: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export interface KnowledgeGraphNodeInput {
  id: string
  objectId?: string | null
  nodeType: KnowledgeGraphNodeType
  label: string
  sourceType: string
  sourceId: string
  metadata?: Record<string, unknown> | string | null
  tags?: string[] | string | null
  confidence?: number
}

export interface KnowledgeGraphEdgeInput {
  id?: string
  sourceNodeId: string
  targetNodeId: string
  edgeType: KnowledgeGraphEdgeType
  sourceMethod: string
  label?: string | null
  weight?: number
  confidence?: number
  evidence?: string | null
  metadata?: Record<string, unknown> | string | null
}

export interface KnowledgeGraphNodeQuery {
  id?: string
  ids?: string[]
  sourceType?: string | string[]
  sourceId?: string
  nodeType?: string | string[]
  labelLike?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface KnowledgeGraphEdgeQuery {
  nodeId?: string
  sourceNodeId?: string
  targetNodeId?: string
  edgeType?: string | string[]
  sourceMethod?: string | string[]
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface KnowledgeGraphNeighborhood {
  centerNodeId: string
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  depth: number
}

export function encodeKnowledgeGraphJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function decodeKnowledgeGraphJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function decodeKnowledgeGraphJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function normalizeList(value?: string | string[]) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
}

function edgeId(input: KnowledgeGraphEdgeInput) {
  return input.id || `kg_edge:${input.sourceNodeId}:${input.targetNodeId}:${input.edgeType}:${input.sourceMethod}`
}

function rowToNode(row: any): KnowledgeGraphNode {
  return {
    id: row.id,
    objectId: row.object_id ?? null,
    nodeType: row.node_type,
    label: row.label,
    sourceType: row.source_type,
    sourceId: row.source_id,
    metadataJson: row.metadata_json ?? null,
    tagsJson: row.tags_json ?? null,
    confidence: Number(row.confidence ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at ?? null,
  }
}

function rowToEdge(row: any): KnowledgeGraphEdge {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    edgeType: row.edge_type,
    sourceMethod: row.source_method,
    label: row.label ?? null,
    weight: Number(row.weight ?? 1),
    confidence: Number(row.confidence ?? 1),
    evidence: row.evidence ?? null,
    metadataJson: row.metadata_json ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at ?? null,
  }
}

export async function initKnowledgeGraphDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists knowledge_graph_nodes (
      id text primary key,
      object_id text,
      node_type text not null,
      label text not null,
      source_type text not null,
      source_id text not null,
      metadata_json text,
      tags_json text,
      confidence real default 1,
      created_at integer not null,
      updated_at integer not null,
      deleted_at integer
    )
  `)
  await db.execute(`create unique index if not exists idx_kg_nodes_source on knowledge_graph_nodes(source_type, source_id)`)
  await db.execute(`create index if not exists idx_kg_nodes_type on knowledge_graph_nodes(node_type, updated_at desc)`)
  await db.execute(`create index if not exists idx_kg_nodes_deleted on knowledge_graph_nodes(deleted_at)`)

  await db.execute(`
    create table if not exists knowledge_graph_edges (
      id text primary key,
      source_node_id text not null,
      target_node_id text not null,
      edge_type text not null,
      source_method text not null,
      label text,
      weight real default 1,
      confidence real default 1,
      evidence text,
      metadata_json text,
      created_at integer not null,
      updated_at integer not null,
      deleted_at integer,
      unique(source_node_id, target_node_id, edge_type, source_method)
    )
  `)
  await db.execute(`create index if not exists idx_kg_edges_source on knowledge_graph_edges(source_node_id)`)
  await db.execute(`create index if not exists idx_kg_edges_target on knowledge_graph_edges(target_node_id)`)
  await db.execute(`create index if not exists idx_kg_edges_type on knowledge_graph_edges(edge_type, source_method)`)
  await db.execute(`create index if not exists idx_kg_edges_deleted on knowledge_graph_edges(deleted_at)`)
}

export async function upsertKnowledgeGraphNode(input: KnowledgeGraphNodeInput) {
  await bulkUpsertKnowledgeGraphNodes([input])
}

export async function bulkUpsertKnowledgeGraphNodes(inputs: KnowledgeGraphNodeInput[]) {
  if (!inputs.length) return
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    await runDbTransaction(db, async () => {
      for (const input of inputs) {
        await db.execute(
          `insert into knowledge_graph_nodes (id, object_id, node_type, label, source_type, source_id, metadata_json, tags_json, confidence, created_at, updated_at, deleted_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null)
           on conflict(id) do update set
             object_id = excluded.object_id,
             node_type = excluded.node_type,
             label = excluded.label,
             source_type = excluded.source_type,
             source_id = excluded.source_id,
             metadata_json = excluded.metadata_json,
             tags_json = excluded.tags_json,
             confidence = excluded.confidence,
             updated_at = excluded.updated_at,
             deleted_at = null`,
          [
            input.id,
            input.objectId ?? null,
            input.nodeType,
            input.label || input.id,
            input.sourceType,
            input.sourceId,
            encodeKnowledgeGraphJson(input.metadata),
            encodeKnowledgeGraphJson(input.tags),
            input.confidence ?? 1,
            now,
            now,
          ],
        )
      }
    })
  })
}

export async function upsertKnowledgeGraphEdge(input: KnowledgeGraphEdgeInput) {
  await bulkUpsertKnowledgeGraphEdges([input])
}

export async function bulkUpsertKnowledgeGraphEdges(inputs: KnowledgeGraphEdgeInput[]) {
  if (!inputs.length) return
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    await runDbTransaction(db, async () => {
      for (const input of inputs) {
        await db.execute(
          `insert into knowledge_graph_edges (id, source_node_id, target_node_id, edge_type, source_method, label, weight, confidence, evidence, metadata_json, created_at, updated_at, deleted_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, null)
           on conflict(source_node_id, target_node_id, edge_type, source_method) do update set
             label = excluded.label,
             weight = excluded.weight,
             confidence = excluded.confidence,
             evidence = excluded.evidence,
             metadata_json = excluded.metadata_json,
             updated_at = excluded.updated_at,
             deleted_at = null`,
          [
            edgeId(input),
            input.sourceNodeId,
            input.targetNodeId,
            input.edgeType,
            input.sourceMethod,
            input.label ?? input.edgeType,
            input.weight ?? 1,
            input.confidence ?? 1,
            input.evidence ?? null,
            encodeKnowledgeGraphJson(input.metadata),
            now,
            now,
          ],
        )
      }
    })
  })
}

export async function queryKnowledgeGraphNodes(query: KnowledgeGraphNodeQuery = {}): Promise<KnowledgeGraphNode[]> {
  const db = await getDb()
  const clauses: string[] = []
  const args: unknown[] = []
  const push = (clause: string, value: unknown) => {
    args.push(value)
    clauses.push(clause.replace('?', `$${args.length}`))
  }
  if (!query.includeDeleted) clauses.push('deleted_at is null')
  if (query.id) push('id = ?', query.id)
  if (query.ids?.length) {
    clauses.push(`id in (${query.ids.map((_, index) => `$${args.length + index + 1}`).join(', ')})`)
    args.push(...query.ids)
  }
  for (const [column, value] of [['source_type', query.sourceType], ['node_type', query.nodeType]] as const) {
    const list = normalizeList(value)
    if (list.length === 1) push(`${column} = ?`, list[0])
    if (list.length > 1) {
      clauses.push(`${column} in (${list.map((_, index) => `$${args.length + index + 1}`).join(', ')})`)
      args.push(...list)
    }
  }
  if (query.sourceId) push('source_id = ?', query.sourceId)
  if (query.labelLike) push('lower(label) like ?', `%${query.labelLike.toLowerCase()}%`)
  const limit = Math.max(1, Math.min(500, Number(query.limit) || 100))
  const offset = Math.max(0, Number(query.offset) || 0)
  const rows = await db.select<any[]>(
    `select * from knowledge_graph_nodes ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by updated_at desc limit ${limit} offset ${offset}`,
    args,
  )
  return rows.map(rowToNode)
}

export async function queryKnowledgeGraphEdges(query: KnowledgeGraphEdgeQuery = {}): Promise<KnowledgeGraphEdge[]> {
  const db = await getDb()
  const clauses: string[] = []
  const args: unknown[] = []
  const push = (clause: string, value: unknown) => {
    args.push(value)
    clauses.push(clause.replace('?', `$${args.length}`))
  }
  if (!query.includeDeleted) clauses.push('deleted_at is null')
  if (query.nodeId) {
    args.push(query.nodeId, query.nodeId)
    clauses.push(`(source_node_id = $${args.length - 1} or target_node_id = $${args.length})`)
  }
  if (query.sourceNodeId) push('source_node_id = ?', query.sourceNodeId)
  if (query.targetNodeId) push('target_node_id = ?', query.targetNodeId)
  for (const [column, value] of [['edge_type', query.edgeType], ['source_method', query.sourceMethod]] as const) {
    const list = normalizeList(value)
    if (list.length === 1) push(`${column} = ?`, list[0])
    if (list.length > 1) {
      clauses.push(`${column} in (${list.map((_, index) => `$${args.length + index + 1}`).join(', ')})`)
      args.push(...list)
    }
  }
  const limit = Math.max(1, Math.min(1000, Number(query.limit) || 200))
  const offset = Math.max(0, Number(query.offset) || 0)
  const rows = await db.select<any[]>(
    `select * from knowledge_graph_edges ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by confidence desc, updated_at desc limit ${limit} offset ${offset}`,
    args,
  )
  return rows.map(rowToEdge)
}

export async function getKnowledgeGraphNeighborhood(input: { nodeId: string; depth?: number; limit?: number; edgeTypes?: string[] }): Promise<KnowledgeGraphNeighborhood> {
  const maxDepth = Math.max(1, Math.min(3, Number(input.depth) || 1))
  const limit = Math.max(1, Math.min(500, Number(input.limit) || 80))
  const seenNodes = new Set<string>([input.nodeId])
  const seenEdges = new Map<string, KnowledgeGraphEdge>()
  let frontier = [input.nodeId]

  for (let depth = 0; depth < maxDepth && frontier.length && seenNodes.size < limit; depth++) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const edges = await queryKnowledgeGraphEdges({ nodeId, edgeType: input.edgeTypes, limit })
      for (const edge of edges) {
        seenEdges.set(edge.id, edge)
        for (const candidate of [edge.sourceNodeId, edge.targetNodeId]) {
          if (!seenNodes.has(candidate) && seenNodes.size < limit) {
            seenNodes.add(candidate)
            next.push(candidate)
          }
        }
      }
    }
    frontier = next
  }

  const nodes = await queryKnowledgeGraphNodes({ ids: Array.from(seenNodes), limit })
  return { centerNodeId: input.nodeId, nodes, edges: Array.from(seenEdges.values()).slice(0, limit), depth: maxDepth }
}

export async function softDeleteKnowledgeGraphNodesBySource(sourceType: string, sourceId?: string) {
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    if (sourceId) {
      await db.execute('update knowledge_graph_nodes set deleted_at = $1, updated_at = $1 where source_type = $2 and source_id = $3', [now, sourceType, sourceId])
    } else {
      await db.execute('update knowledge_graph_nodes set deleted_at = $1, updated_at = $1 where source_type = $2', [now, sourceType])
    }
  })
}

export async function softDeleteKnowledgeGraphEdgesBySource(sourceMethod: string, nodeId?: string) {
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    if (nodeId) {
      await db.execute(
        'update knowledge_graph_edges set deleted_at = $1, updated_at = $1 where source_method = $2 and (source_node_id = $3 or target_node_id = $3)',
        [now, sourceMethod, nodeId],
      )
    } else {
      await db.execute('update knowledge_graph_edges set deleted_at = $1, updated_at = $1 where source_method = $2', [now, sourceMethod])
    }
  })
}

export async function softDeleteKnowledgeGraphEdgesForNode(nodeId: string) {
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    await db.execute(
      'update knowledge_graph_edges set deleted_at = $1, updated_at = $1 where source_node_id = $2 or target_node_id = $2',
      [now, nodeId],
    )
  })
}
