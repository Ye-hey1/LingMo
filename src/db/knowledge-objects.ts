import { getDb, serializedWrite, runDbTransaction } from './index'

/**
 * 知识对象类型枚举。
 * 每种类型对应一个原表（notes / marks / agent_runs / ...），
 * 通过 (sourceType, sourceId) 在 knowledge_objects 表中建立统一索引行。
 */
export type KnowledgeObjectType =
  | 'note'
  | 'folder'
  | 'mark'
  | 'ai_hotspot'
  | 'chat'
  | 'pdf_annotation'
  | 'web_clip'
  | 'agent_run'
  | 'diagram'

export type KnowledgeObjectOrigin =
  | 'manual'
  | 'capture'
  | 'agent_generated'
  | 'synced'
  | 'imported'

export type KnowledgeObjectStatus =
  | 'inbox'
  | 'active'
  | 'archived'
  | 'deleted'

/**
 * 统一知识对象。这是把 note / mark / agent_run / ai_hotspot 等
 * 各异的数据源抽象成同一形态的索引层。
 *
 * 不替代原表，只作为统一查询入口。
 * 原表的完整字段仍由各 db-xxx.ts 维护。
 */
export interface KnowledgeObject {
  id: string
  sourceType: KnowledgeObjectType
  /** 对应原表的主键（字符串化，兼容 number / string） */
  sourceId: string
  /** 文件路径（如适用），用于文件管理操作 */
  path?: string
  title: string
  /** JSON 序列化的 tag 数组 */
  tags?: string
  /** JSON 序列化的别名数组，用于 wikilink / 搜索匹配 */
  aliases?: string
  sourceUrl?: string
  origin: KnowledgeObjectOrigin
  status: KnowledgeObjectStatus
  /** 内容哈希，用于增量重索引判断 */
  contentHash?: string
  /** 向量索引最近更新时间（ms），null 表示未索引 */
  vectorIndexedAt?: number | null
  /** agent 生成时对应的 runId，用于归因 */
  sourceRunId?: string
  createdAt: number
  updatedAt: number
  /** type-specific 扩展字段，JSON 字符串 */
  metadata?: string
}

/**
 * 查询过滤器。所有字段都是可选的，组合 AND 关系。
 */
export interface KnowledgeObjectQuery {
  sourceType?: KnowledgeObjectType | KnowledgeObjectType[]
  status?: KnowledgeObjectStatus | KnowledgeObjectStatus[]
  /** 标签子串匹配（任一命中即可） */
  tag?: string
  /** 路径前缀，用于按文件夹过滤 */
  pathPrefix?: string
  /** 时间窗口（ms epoch） */
  updatedSince?: number
  updatedBefore?: number
  /** 模糊标题匹配 */
  titleLike?: string
  /** 排除某些 sourceId */
  excludeSourceIds?: string[]
  limit?: number
  offset?: number
  /** 排序字段，默认 updatedAt desc */
  orderBy?: 'updatedAt' | 'createdAt' | 'title'
  orderDir?: 'asc' | 'desc'
}

export async function initKnowledgeObjectsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists knowledge_objects (
      id text primary key,
      source_type text not null,
      source_id text not null,
      path text,
      title text not null default '',
      tags text,
      aliases text,
      source_url text,
      origin text not null default 'manual',
      status text not null default 'active',
      content_hash text,
      vector_indexed_at integer,
      source_run_id text,
      created_at integer not null,
      updated_at integer not null,
      metadata text
    )
  `)
  // 唯一约束：同一来源类型 + 来源 ID 只能有一条索引行
  await db.execute(`
    create unique index if not exists idx_ko_source
    on knowledge_objects (source_type, source_id)
  `)
  // 按路径索引（文件管理高频用）
  await db.execute(`
    create index if not exists idx_ko_path
    on knowledge_objects (path)
  `)
  // 按状态过滤
  await db.execute(`
    create index if not exists idx_ko_status
    on knowledge_objects (status)
  `)
  // 按更新时间倒序（默认排序）
  await db.execute(`
    create index if not exists idx_ko_updated
    on knowledge_objects (updated_at desc)
  `)
  // 按来源类型列出
  await db.execute(`
    create index if not exists idx_ko_type_updated
    on knowledge_objects (source_type, updated_at desc)
  `)
}

function normalizeJsonArray(value: string | string[] | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value)
  return undefined
}

function parseJsonArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Upsert 知识对象。按 (sourceType, sourceId) 唯一约束决定插入或更新。
 * 返回写入后的对象 id。
 */
export async function upsertKnowledgeObject(input: {
  sourceType: KnowledgeObjectType
  sourceId: string | number
  path?: string
  title: string
  tags?: string | string[]
  aliases?: string | string[]
  sourceUrl?: string
  origin?: KnowledgeObjectOrigin
  status?: KnowledgeObjectStatus
  contentHash?: string
  vectorIndexedAt?: number | null
  sourceRunId?: string
  metadata?: Record<string, unknown> | string
}): Promise<string> {
  const id = `ko_${input.sourceType}_${input.sourceId}`
  const now = Date.now()
  const tags = normalizeJsonArray(input.tags)
  const aliases = normalizeJsonArray(input.aliases)
  const metadata =
    typeof input.metadata === 'string'
      ? input.metadata
      : input.metadata
        ? JSON.stringify(input.metadata)
        : undefined

  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into knowledge_objects (
        id, source_type, source_id, path, title, tags, aliases,
        source_url, origin, status, content_hash, vector_indexed_at,
        source_run_id, created_at, updated_at, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      on conflict(source_type, source_id) do update set
        path = excluded.path,
        title = excluded.title,
        tags = excluded.tags,
        aliases = excluded.aliases,
        source_url = excluded.source_url,
        origin = excluded.origin,
        status = excluded.status,
        content_hash = excluded.content_hash,
        vector_indexed_at = excluded.vector_indexed_at,
        source_run_id = excluded.source_run_id,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata`,
      [
        id,
        input.sourceType,
        String(input.sourceId),
        input.path ?? null,
        input.title || '',
        tags ?? null,
        aliases ?? null,
        input.sourceUrl ?? null,
        input.origin ?? 'manual',
        input.status ?? 'active',
        input.contentHash ?? null,
        input.vectorIndexedAt ?? null,
        input.sourceRunId ?? null,
        now,
        now,
        metadata ?? null,
      ],
    )
    return id
  })
}

/**
 * 局部更新已有对象。仅传需要修改的字段，其余保留。
 */
export async function touchKnowledgeObject(
  sourceType: KnowledgeObjectType,
  sourceId: string | number,
  patch: {
    path?: string
    title?: string
    tags?: string | string[]
    aliases?: string | string[]
    sourceUrl?: string
    origin?: KnowledgeObjectOrigin
    status?: KnowledgeObjectStatus
    contentHash?: string
    vectorIndexedAt?: number | null
    sourceRunId?: string
    metadata?: Record<string, unknown> | string
  },
): Promise<void> {
  const sets: string[] = []
  const args: unknown[] = []
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = $${args.length + 1}`)
    args.push(value)
  }

  if (patch.path !== undefined) push('path', patch.path)
  if (patch.title !== undefined) push('title', patch.title)
  if (patch.tags !== undefined) push('tags', normalizeJsonArray(patch.tags))
  if (patch.aliases !== undefined) push('aliases', normalizeJsonArray(patch.aliases))
  if (patch.sourceUrl !== undefined) push('source_url', patch.sourceUrl)
  if (patch.origin !== undefined) push('origin', patch.origin)
  if (patch.status !== undefined) push('status', patch.status)
  if (patch.contentHash !== undefined) push('content_hash', patch.contentHash)
  if (patch.vectorIndexedAt !== undefined) push('vector_indexed_at', patch.vectorIndexedAt)
  if (patch.sourceRunId !== undefined) push('source_run_id', patch.sourceRunId)
  if (patch.metadata !== undefined) {
    push('metadata', typeof patch.metadata === 'string' ? patch.metadata : JSON.stringify(patch.metadata))
  }

  if (sets.length === 0) return
  push('updated_at', Date.now())
  args.push(sourceType, String(sourceId))

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update knowledge_objects set ${sets.join(', ')} where source_type = $${args.length - 1} and source_id = $${args.length}`,
      args,
    )
  })
}

export async function getKnowledgeObjectById(id: string): Promise<KnowledgeObject | undefined> {
  const db = await getDb()
  const rows = await db.select<KnowledgeObject[]>(
    'select * from knowledge_objects where id = $1 limit 1',
    [id],
  )
  return rows[0]
}

export async function getKnowledgeObjectBySource(
  sourceType: KnowledgeObjectType,
  sourceId: string | number,
): Promise<KnowledgeObject | undefined> {
  const db = await getDb()
  const rows = await db.select<KnowledgeObject[]>(
    'select * from knowledge_objects where source_type = $1 and source_id = $2 limit 1',
    [sourceType, String(sourceId)],
  )
  return rows[0]
}

function buildWhereClause(query: KnowledgeObjectQuery): { sql: string; args: unknown[] } {
  const conditions: string[] = []
  const args: unknown[] = []

  if (query.sourceType) {
    if (Array.isArray(query.sourceType)) {
      if (query.sourceType.length === 0) {
        // 空数组 = 故意不命中任何行
        conditions.push('1 = 0')
      } else {
        const placeholders = query.sourceType.map((_, i) => `$${args.length + i + 1}`).join(', ')
        args.push(...query.sourceType)
        conditions.push(`source_type in (${placeholders})`)
      }
    } else {
      args.push(query.sourceType)
      conditions.push(`source_type = $${args.length}`)
    }
  }

  if (query.status) {
    if (Array.isArray(query.status)) {
      if (query.status.length === 0) {
        conditions.push('1 = 0')
      } else {
        const placeholders = query.status.map((_, i) => `$${args.length + i + 1}`).join(', ')
        args.push(...query.status)
        conditions.push(`status in (${placeholders})`)
      }
    } else {
      args.push(query.status)
      conditions.push(`status = $${args.length}`)
    }
  }

  if (query.tag) {
    args.push(`%"${query.tag.replace(/"/g, '\\"')}"%`)
    conditions.push(`tags like $${args.length}`)
  }

  if (query.pathPrefix) {
    args.push(`${query.pathPrefix}%`)
    conditions.push(`path like $${args.length}`)
  }

  if (query.updatedSince !== undefined) {
    args.push(query.updatedSince)
    conditions.push(`updated_at >= $${args.length}`)
  }

  if (query.updatedBefore !== undefined) {
    args.push(query.updatedBefore)
    conditions.push(`updated_at < $${args.length}`)
  }

  if (query.titleLike) {
    args.push(`%${query.titleLike}%`)
    conditions.push(`title like $${args.length}`)
  }

  if (query.excludeSourceIds && query.excludeSourceIds.length > 0) {
    const placeholders = query.excludeSourceIds.map((_, i) => `$${args.length + i + 1}`).join(', ')
    args.push(...query.excludeSourceIds)
    conditions.push(`source_id not in (${placeholders})`)
  }

  return {
    sql: conditions.length > 0 ? `where ${conditions.join(' and ')}` : '',
    args,
  }
}

export async function queryKnowledgeObjects(query: KnowledgeObjectQuery = {}): Promise<KnowledgeObject[]> {
  const db = await getDb()
  const { sql, args } = buildWhereClause(query)
  const orderBy = query.orderBy ?? 'updatedAt'
  const orderColumn = orderBy === 'updatedAt' ? 'updated_at' : orderBy === 'createdAt' ? 'created_at' : 'title'
  const orderDir = query.orderDir === 'asc' ? 'asc' : orderBy === 'title' && query.orderDir !== 'desc' ? 'asc' : 'desc'
  const limit = typeof query.limit === 'number' && query.limit > 0 ? Math.min(query.limit, 500) : 100
  const offset = typeof query.offset === 'number' && query.offset > 0 ? query.offset : 0

  const argIndex = args.length
  return await db.select<KnowledgeObject[]>(
    `select * from knowledge_objects ${sql} order by ${orderColumn} ${orderDir} limit $${argIndex + 1} offset $${argIndex + 2}`,
    [...args, limit, offset],
  )
}

export async function countKnowledgeObjects(query: KnowledgeObjectQuery = {}): Promise<number> {
  const db = await getDb()
  const { sql, args } = buildWhereClause(query)
  const rows = await db.select<Array<{ count: number }>>(
    `select count(*) as count from knowledge_objects ${sql}`,
    args,
  )
  return rows[0]?.count ?? 0
}

/**
 * 按 source 软删除（status -> deleted），保留行用于撤销。
 * 真实数据仍由原表 db 层决定。
 */
export async function softDeleteKnowledgeObject(
  sourceType: KnowledgeObjectType,
  sourceId: string | number,
): Promise<void> {
  await touchKnowledgeObject(sourceType, sourceId, { status: 'deleted' })
}

/**
 * 硬删除索引行。原表数据由调用方负责。
 */
export async function deleteKnowledgeObject(
  sourceType: KnowledgeObjectType,
  sourceId: string | number,
): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'delete from knowledge_objects where source_type = $1 and source_id = $2',
      [sourceType, String(sourceId)],
    )
  })
}

/**
 * 批量写入。所有写入在一个事务中，用于初始化或重索引。
 */
export async function bulkUpsertKnowledgeObjects(
  inputs: Parameters<typeof upsertKnowledgeObject>[0][],
): Promise<void> {
  if (inputs.length === 0) return

  const db = await getDb()
  await runDbTransaction(db, async () => {
    for (const input of inputs) {
      const id = `ko_${input.sourceType}_${input.sourceId}`
      const now = Date.now()
      const tags = normalizeJsonArray(input.tags)
      const aliases = normalizeJsonArray(input.aliases)
      const metadata =
        typeof input.metadata === 'string'
          ? input.metadata
          : input.metadata
            ? JSON.stringify(input.metadata)
            : undefined

      await db.execute(
        `insert into knowledge_objects (
          id, source_type, source_id, path, title, tags, aliases,
          source_url, origin, status, content_hash, vector_indexed_at,
          source_run_id, created_at, updated_at, metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        on conflict(source_type, source_id) do update set
          path = excluded.path,
          title = excluded.title,
          tags = excluded.tags,
          aliases = excluded.aliases,
          source_url = excluded.source_url,
          origin = excluded.origin,
          status = excluded.status,
          content_hash = excluded.content_hash,
          vector_indexed_at = excluded.vector_indexed_at,
          source_run_id = excluded.source_run_id,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata`,
        [
          id,
          input.sourceType,
          String(input.sourceId),
          input.path ?? null,
          input.title || '',
          tags ?? null,
          aliases ?? null,
          input.sourceUrl ?? null,
          input.origin ?? 'manual',
          input.status ?? 'active',
          input.contentHash ?? null,
          input.vectorIndexedAt ?? null,
          input.sourceRunId ?? null,
          now,
          now,
          metadata ?? null,
        ],
      )
    }
  })
}

/**
 * 辅助：解析 JSON tags 字段为 string[]
 */
export function parseKnowledgeObjectTags(value?: string): string[] {
  return parseJsonArray(value)
}

/**
 * 辅助：解析 JSON aliases 字段为 string[]
 */
export function parseKnowledgeObjectAliases(value?: string): string[] {
  return parseJsonArray(value)
}

/**
 * 辅助：解析 JSON metadata 字段为 Record
 */
export function parseKnowledgeObjectMetadata(value?: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
