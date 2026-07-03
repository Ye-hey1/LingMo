import { getDb, runDbTransaction, serializedWrite } from './index.ts'
import type Database from '@tauri-apps/plugin-sql'
import type {
  ExtractedEntity,
  ExtractedRelation,
  ParsedMarkdownStructure,
  StructuredBlock,
  StructuredHeading,
  StructuredMarkdownDocument,
  StructuredSemanticExtractionStatus,
} from '../lib/structured-knowledge/types.ts'

export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function decodeJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function decodeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function ensureStructuredDocumentSemanticColumns(db: Database) {
  const columns = await db.select<Array<{ name: string }>>('pragma table_info(structured_documents)')
  const existing = new Set(columns.map(column => column.name))
  const additions: Array<[string, string]> = [
    ['semantic_extraction_status', "alter table structured_documents add column semantic_extraction_status text default 'idle'"],
    ['semantic_extraction_requested_at', 'alter table structured_documents add column semantic_extraction_requested_at integer'],
    ['semantic_extraction_started_at', 'alter table structured_documents add column semantic_extraction_started_at integer'],
    ['semantic_extraction_error', 'alter table structured_documents add column semantic_extraction_error text'],
    ['semantic_extraction_attempts', 'alter table structured_documents add column semantic_extraction_attempts integer default 0'],
    ['semantic_extraction_content_hash', 'alter table structured_documents add column semantic_extraction_content_hash text'],
  ]
  for (const [name, sql] of additions) {
    if (!existing.has(name)) await db.execute(sql)
  }
}

interface StructuredDocumentRow {
  id: string
  source_object_id: string
  file_path: string
  title: string
  content_hash: string
  frontmatter?: string | null
  tags?: string | null
  wikilinks?: string | null
  headings?: string | null
  summary?: string | null
  created_at: number
  updated_at: number
  structured_at: number
  semantic_extracted_at?: number | null
  semantic_extraction_status?: StructuredSemanticExtractionStatus | null
  semantic_extraction_requested_at?: number | null
  semantic_extraction_started_at?: number | null
  semantic_extraction_error?: string | null
  semantic_extraction_attempts?: number | null
  semantic_extraction_content_hash?: string | null
}

interface StructuredBlockRow {
  id: string
  document_id: string
  heading_id?: string | null
  type: StructuredBlock['type']
  text: string
  markdown: string
  block_order: number
  line_start?: number | null
  line_end?: number | null
  heading_path?: string | null
  wikilinks?: string | null
  tags?: string | null
  content_hash: string
  created_at: number
  updated_at: number
}

interface StructuredEntityRow {
  id: string
  document_id: string
  name: string
  normalized_name: string
  entity_type: ExtractedEntity['type']
  aliases?: string | null
  evidence_block_ids?: string | null
  confidence: number
  extraction_method: ExtractedEntity['extractionMethod']
  created_at: number
  updated_at: number
}

interface StructuredRelationRow {
  id: string
  document_id: string
  source_entity_id: string
  target_entity_id: string
  relation_type: ExtractedRelation['relationType']
  evidence_block_ids?: string | null
  confidence: number
  extraction_method: ExtractedRelation['extractionMethod']
  created_at: number
  updated_at: number
}

export async function initStructuredKnowledgeDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists structured_documents (
      id text primary key,
      source_object_id text not null,
      file_path text not null unique,
      title text not null,
      content_hash text not null,
      frontmatter text,
      tags text,
      wikilinks text,
      headings text,
      summary text,
      created_at integer not null,
      updated_at integer not null,
      structured_at integer not null,
      semantic_extracted_at integer,
      semantic_extraction_status text default 'idle',
      semantic_extraction_requested_at integer,
      semantic_extraction_started_at integer,
      semantic_extraction_error text,
      semantic_extraction_attempts integer default 0,
      semantic_extraction_content_hash text
    )
  `)
  await db.execute(`
    create table if not exists structured_blocks (
      id text primary key,
      document_id text not null,
      heading_id text,
      type text not null,
      text text not null,
      markdown text not null,
      block_order integer not null,
      line_start integer,
      line_end integer,
      heading_path text,
      wikilinks text,
      tags text,
      content_hash text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await ensureStructuredDocumentSemanticColumns(db)
  await db.execute('create index if not exists idx_structured_documents_semantic_status on structured_documents(semantic_extraction_status, semantic_extraction_requested_at)')
  await db.execute('create index if not exists idx_structured_documents_semantic_hash on structured_documents(semantic_extraction_content_hash)')
  await db.execute('create index if not exists idx_structured_blocks_document on structured_blocks(document_id, block_order)')
  await db.execute('create index if not exists idx_structured_blocks_heading on structured_blocks(document_id, heading_id)')
  await db.execute(`
    create table if not exists structured_entities (
      id text primary key,
      document_id text not null,
      name text not null,
      normalized_name text not null,
      entity_type text not null,
      aliases text,
      evidence_block_ids text,
      confidence real not null,
      extraction_method text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await db.execute('create index if not exists idx_structured_entities_document on structured_entities(document_id)')
  await db.execute('create index if not exists idx_structured_entities_normalized_name on structured_entities(normalized_name)')
  await db.execute(`
    create table if not exists structured_relations (
      id text primary key,
      document_id text not null,
      source_entity_id text not null,
      target_entity_id text not null,
      relation_type text not null,
      evidence_block_ids text,
      confidence real not null,
      extraction_method text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await db.execute('create index if not exists idx_structured_relations_document on structured_relations(document_id)')
  await db.execute('create index if not exists idx_structured_relations_source on structured_relations(source_entity_id)')
  await db.execute('create index if not exists idx_structured_relations_target on structured_relations(target_entity_id)')
}

function rowToDocument(row: StructuredDocumentRow, blocks: StructuredBlock[] = []): StructuredMarkdownDocument {
  const headings = decodeJsonRecord(row.headings).items as StructuredHeading[] | undefined
  return {
    id: row.id,
    sourceObjectId: row.source_object_id,
    filePath: row.file_path,
    title: row.title,
    contentHash: row.content_hash,
    frontmatter: decodeJsonRecord(row.frontmatter),
    tags: decodeJsonArray(row.tags),
    wikilinks: decodeJsonArray(row.wikilinks),
    headings: Array.isArray(headings) ? headings : [],
    blocks,
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    structuredAt: row.structured_at,
    semanticExtractedAt: row.semantic_extracted_at ?? undefined,
    semanticExtractionStatus: row.semantic_extraction_status ?? 'idle',
    semanticExtractionRequestedAt: row.semantic_extraction_requested_at ?? undefined,
    semanticExtractionStartedAt: row.semantic_extraction_started_at ?? undefined,
    semanticExtractionError: row.semantic_extraction_error ?? undefined,
    semanticExtractionAttempts: row.semantic_extraction_attempts ?? 0,
    semanticExtractionContentHash: row.semantic_extraction_content_hash ?? undefined,
  }
}

function rowToBlock(row: StructuredBlockRow): StructuredBlock {
  return {
    id: row.id,
    documentId: row.document_id,
    headingId: row.heading_id ?? undefined,
    type: row.type,
    text: row.text,
    markdown: row.markdown,
    order: row.block_order,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    headingPath: decodeJsonArray(row.heading_path),
    wikilinks: decodeJsonArray(row.wikilinks),
    tags: decodeJsonArray(row.tags),
    contentHash: row.content_hash,
  }
}

function rowToEntity(row: StructuredEntityRow): ExtractedEntity {
  return {
    id: row.id,
    documentId: row.document_id,
    name: row.name,
    normalizedName: row.normalized_name,
    type: row.entity_type,
    aliases: decodeJsonArray(row.aliases),
    evidenceBlockIds: decodeJsonArray(row.evidence_block_ids),
    confidence: row.confidence,
    extractionMethod: row.extraction_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRelation(row: StructuredRelationRow): ExtractedRelation {
  return {
    id: row.id,
    documentId: row.document_id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type,
    evidenceBlockIds: decodeJsonArray(row.evidence_block_ids),
    confidence: row.confidence,
    extractionMethod: row.extraction_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function upsertStructuredDocument(parsed: ParsedMarkdownStructure): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      const doc = parsed.document
      await db.execute(
        `insert into structured_documents (
          id, source_object_id, file_path, title, content_hash, frontmatter, tags, wikilinks, headings,
          summary, created_at, updated_at, structured_at, semantic_extracted_at, semantic_extraction_status,
          semantic_extraction_attempts, semantic_extraction_content_hash
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        on conflict(file_path) do update set
          source_object_id = excluded.source_object_id,
          title = excluded.title,
          content_hash = excluded.content_hash,
          frontmatter = excluded.frontmatter,
          tags = excluded.tags,
          wikilinks = excluded.wikilinks,
          headings = excluded.headings,
          summary = excluded.summary,
          updated_at = excluded.updated_at,
          structured_at = excluded.structured_at,
          semantic_extraction_status = case
            when structured_documents.content_hash != excluded.content_hash then 'pending'
            else coalesce(structured_documents.semantic_extraction_status, excluded.semantic_extraction_status, 'idle')
          end,
          semantic_extracted_at = case
            when structured_documents.content_hash != excluded.content_hash then null
            else coalesce(structured_documents.semantic_extracted_at, excluded.semantic_extracted_at)
          end,
          semantic_extraction_content_hash = case
            when structured_documents.content_hash != excluded.content_hash then null
            else coalesce(structured_documents.semantic_extraction_content_hash, excluded.semantic_extraction_content_hash)
          end`,
        [
          doc.id,
          doc.sourceObjectId,
          doc.filePath,
          doc.title,
          doc.contentHash,
          encodeJson(doc.frontmatter),
          encodeJson(doc.tags),
          encodeJson(doc.wikilinks),
          encodeJson({ items: parsed.headings }),
          doc.summary ?? null,
          doc.createdAt,
          doc.updatedAt,
          doc.structuredAt,
          doc.semanticExtractedAt ?? null,
          'idle',
          0,
          doc.semanticExtractedAt ? doc.contentHash : null,
        ],
      )
      await db.execute('delete from structured_blocks where document_id = $1', [doc.id])
      for (const block of parsed.blocks) {
        await db.execute(
          `insert into structured_blocks (
            id, document_id, heading_id, type, text, markdown, block_order, line_start, line_end,
            heading_path, wikilinks, tags, content_hash, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            block.id,
            block.documentId,
            block.headingId ?? null,
            block.type,
            block.text,
            block.markdown,
            block.order,
            block.lineStart ?? null,
            block.lineEnd ?? null,
            encodeJson(block.headingPath),
            encodeJson(block.wikilinks),
            encodeJson(block.tags),
            block.contentHash,
            doc.structuredAt,
            doc.structuredAt,
          ],
        )
      }
      await db.execute('delete from structured_entities where document_id = $1 and extraction_method = $2', [doc.id, 'local'])
      for (const entity of parsed.localEntities) {
        await upsertEntityRow(db, entity)
      }
    })
  })
}

async function upsertEntityRow(db: Database, entity: ExtractedEntity) {
  await db.execute(
    `insert into structured_entities (
      id, document_id, name, normalized_name, entity_type, aliases, evidence_block_ids,
      confidence, extraction_method, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict(id) do update set
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      entity_type = excluded.entity_type,
      aliases = excluded.aliases,
      evidence_block_ids = excluded.evidence_block_ids,
      confidence = excluded.confidence,
      extraction_method = excluded.extraction_method,
      updated_at = excluded.updated_at`,
    [
      entity.id,
      entity.documentId,
      entity.name,
      entity.normalizedName,
      entity.type,
      encodeJson(entity.aliases),
      encodeJson(entity.evidenceBlockIds),
      entity.confidence,
      entity.extractionMethod,
      entity.createdAt,
      entity.updatedAt,
    ],
  )
}

export async function upsertStructuredEntities(
  documentId: string,
  entities: ExtractedEntity[],
  method?: ExtractedEntity['extractionMethod'],
): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      for (const entity of entities.filter(entity => entity.documentId === documentId && (!method || entity.extractionMethod === method))) {
        await upsertEntityRow(db, entity)
      }
    })
  })
}

export async function upsertStructuredRelations(documentId: string, relations: ExtractedRelation[]): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      for (const relation of relations.filter(relation => relation.documentId === documentId)) {
        await db.execute(
          `insert into structured_relations (
            id, document_id, source_entity_id, target_entity_id, relation_type, evidence_block_ids,
            confidence, extraction_method, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          on conflict(id) do update set
            source_entity_id = excluded.source_entity_id,
            target_entity_id = excluded.target_entity_id,
            relation_type = excluded.relation_type,
            evidence_block_ids = excluded.evidence_block_ids,
            confidence = excluded.confidence,
            extraction_method = excluded.extraction_method,
            updated_at = excluded.updated_at`,
          [
            relation.id,
            relation.documentId,
            relation.sourceEntityId,
            relation.targetEntityId,
            relation.relationType,
            encodeJson(relation.evidenceBlockIds),
            relation.confidence,
            relation.extractionMethod,
            relation.createdAt,
            relation.updatedAt,
          ],
        )
      }
    })
  })
}

export async function getStructuredDocumentByPath(filePath: string): Promise<StructuredMarkdownDocument | undefined> {
  const db = await getDb()
  const rows = await db.select<StructuredDocumentRow[]>('select * from structured_documents where file_path = $1', [filePath.replace(/\\/g, '/')])
  return rows[0] ? rowToDocument(rows[0]) : undefined
}

export async function getStructuredBlocksByDocument(documentId: string): Promise<StructuredBlock[]> {
  const db = await getDb()
  const rows = await db.select<StructuredBlockRow[]>('select * from structured_blocks where document_id = $1 order by block_order', [documentId])
  return rows.map(rowToBlock)
}

export async function getStructuredEntitiesByDocument(documentId: string): Promise<ExtractedEntity[]> {
  const db = await getDb()
  const rows = await db.select<StructuredEntityRow[]>('select * from structured_entities where document_id = $1 order by confidence desc, name asc', [documentId])
  return rows.map(rowToEntity)
}

export async function getStructuredRelationsByDocument(documentId: string): Promise<ExtractedRelation[]> {
  const db = await getDb()
  const rows = await db.select<StructuredRelationRow[]>('select * from structured_relations where document_id = $1 order by confidence desc', [documentId])
  return rows.map(rowToRelation)
}

export async function getStructuredDocumentBundleByPath(filePath: string) {
  const document = await getStructuredDocumentByPath(filePath)
  if (!document) return undefined
  const [blocks, entities, relations] = await Promise.all([
    getStructuredBlocksByDocument(document.id),
    getStructuredEntitiesByDocument(document.id),
    getStructuredRelationsByDocument(document.id),
  ])
  return {
    document: { ...document, blocks },
    blocks,
    entities,
    relations,
  }
}

export async function countStructuredEntities(documentId: string): Promise<number> {
  const db = await getDb()
  const rows = await db.select<Array<{ count: number }>>('select count(*) as count from structured_entities where document_id = $1', [documentId])
  return rows[0]?.count || 0
}

export async function countStructuredRelations(documentId: string): Promise<number> {
  const db = await getDb()
  const rows = await db.select<Array<{ count: number }>>('select count(*) as count from structured_relations where document_id = $1', [documentId])
  return rows[0]?.count || 0
}


export async function clearStructuredLlmSemantics(documentId: string): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      await db.execute('delete from structured_relations where document_id = $1 and extraction_method = $2', [documentId, 'llm'])
      await db.execute('delete from structured_entities where document_id = $1 and extraction_method = $2', [documentId, 'llm'])
    })
  })
}

export async function markStructuredSemanticExtractionRequested(documentId: string, contentHash?: string, now = Date.now()): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update structured_documents set
      semantic_extraction_status = 'pending',
      semantic_extraction_requested_at = $2,
      semantic_extraction_error = null,
      semantic_extraction_content_hash = coalesce($3, semantic_extraction_content_hash),
      updated_at = $2
    where id = $1`,
    [documentId, now, contentHash ?? null],
  )
}

export async function markStructuredSemanticExtractionRunning(documentId: string, now = Date.now()): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update structured_documents set
      semantic_extraction_status = 'running',
      semantic_extraction_started_at = $2,
      semantic_extraction_error = null,
      semantic_extraction_attempts = coalesce(semantic_extraction_attempts, 0) + 1,
      updated_at = $2
    where id = $1`,
    [documentId, now],
  )
}

export async function markStructuredSemanticExtractionCompleted(documentId: string, contentHash: string, now = Date.now()): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update structured_documents set
      semantic_extraction_status = 'completed',
      semantic_extracted_at = $2,
      semantic_extraction_content_hash = $3,
      semantic_extraction_error = null,
      updated_at = $2
    where id = $1`,
    [documentId, now, contentHash],
  )
}

export async function markStructuredSemanticExtractionFailed(documentId: string, error: string, now = Date.now()): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update structured_documents set
      semantic_extraction_status = 'failed',
      semantic_extraction_error = $2,
      updated_at = $3
    where id = $1`,
    [documentId, error.slice(0, 1000), now],
  )
}

export async function getStructuredDocumentsNeedingSemanticExtraction(options: {
  limit?: number
  cooldownMs?: number
  now?: number
} = {}): Promise<StructuredMarkdownDocument[]> {
  const db = await getDb()
  const now = options.now ?? Date.now()
  const cooldownMs = Math.max(0, options.cooldownMs ?? 0)
  const limit = Math.max(1, Math.min(50, options.limit ?? 10))
  const rows = await db.select<StructuredDocumentRow[]>(
    `select * from structured_documents
     where (
       semantic_extraction_status = 'pending'
       or semantic_extracted_at is null
       or semantic_extraction_content_hash is null
       or semantic_extraction_content_hash != content_hash
     )
     and (semantic_extraction_started_at is null or semantic_extraction_started_at <= $1)
     order by coalesce(semantic_extraction_requested_at, updated_at, structured_at) asc
     limit $2`,
    [now - cooldownMs, limit],
  )
  return rows.map(row => rowToDocument(row))
}
