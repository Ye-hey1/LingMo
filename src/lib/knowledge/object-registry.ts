/**
 * ObjectRegistry - 知识对象统一注册表门面
 *
 * 设计目标：
 * - 所有 note/mark/agent_run/ai_hotspot/chat 等数据源在写入时，通过此门面注册到
 *   knowledge_objects 表，建立统一索引行。
 * - 文件管理工具（move/rename/delete）通过此门面同步更新 path / tags / relations，
 *   避免"文件搬了但索引没动"的断点。
 * - agent 的高层检索（recall）通过此门面跨类型查询。
 *
 * 不替代原 db-xxx.ts，只作为元数据/索引层的统一入口。
 */

import {
  type KnowledgeObject,
  type KnowledgeObjectOrigin,
  type KnowledgeObjectQuery,
  type KnowledgeObjectStatus,
  type KnowledgeObjectType,
  bulkUpsertKnowledgeObjects,
  countKnowledgeObjects,
  deleteKnowledgeObject,
  getKnowledgeObjectBySource,
  getKnowledgeObjectById,
  parseKnowledgeObjectAliases,
  parseKnowledgeObjectMetadata,
  parseKnowledgeObjectTags,
  queryKnowledgeObjects,
  softDeleteKnowledgeObject,
  touchKnowledgeObject,
  upsertKnowledgeObject,
} from '@/db/knowledge-objects'

export interface RegisterObjectInput {
  sourceType: KnowledgeObjectType
  sourceId: string | number
  path?: string
  title: string
  tags?: string[]
  aliases?: string[]
  sourceUrl?: string
  origin?: KnowledgeObjectOrigin
  status?: KnowledgeObjectStatus
  contentHash?: string
  vectorIndexedAt?: number | null
  sourceRunId?: string
  metadata?: Record<string, unknown>
}

export interface ObjectRegistry {
  /** Upsert 一个对象。如果 (sourceType, sourceId) 已存在则更新。 */
  register(input: RegisterObjectInput): Promise<string>

  /** 批量注册（事务）。用于初始化或重索引。 */
  registerBatch(inputs: RegisterObjectInput[]): Promise<void>

  /** 局部更新。只传需要变更的字段。 */
  touch(
    sourceType: KnowledgeObjectType,
    sourceId: string | number,
    patch: {
      path?: string
      title?: string
      tags?: string[]
      aliases?: string[]
      sourceUrl?: string
      origin?: KnowledgeObjectOrigin
      status?: KnowledgeObjectStatus
      contentHash?: string
      vectorIndexedAt?: number | null
      sourceRunId?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<void>

  /** 按 source 查询单个对象。 */
  getBySource(
    sourceType: KnowledgeObjectType,
    sourceId: string | number,
  ): Promise<KnowledgeObject | undefined>

  /** 按主键 id 查询。 */
  getById(id: string): Promise<KnowledgeObject | undefined>

  /** 按过滤条件查询。 */
  query(query: KnowledgeObjectQuery): Promise<KnowledgeObject[]>

  /** 计数。 */
  count(query: KnowledgeObjectQuery): Promise<number>

  /** 软删除（status -> deleted）。 */
  softDelete(sourceType: KnowledgeObjectType, sourceId: string | number): Promise<void>

  /** 硬删除索引行（原表由调用方处理）。 */
  hardDelete(sourceType: KnowledgeObjectType, sourceId: string | number): Promise<void>

  /**
   * 文件移动时同步索引。同时可触发上层（图谱/向量索引）的失效。
   * 迁移在事务中完成，避免半完成状态。
   */
  moveByPath(oldPathPrefix: string, newPathPrefix: string): Promise<number>
}

function toDbInput(input: RegisterObjectInput) {
  return {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    path: input.path,
    title: input.title,
    tags: input.tags ? JSON.stringify(input.tags) : undefined,
    aliases: input.aliases ? JSON.stringify(input.aliases) : undefined,
    sourceUrl: input.sourceUrl,
    origin: input.origin,
    status: input.status,
    contentHash: input.contentHash,
    vectorIndexedAt: input.vectorIndexedAt,
    sourceRunId: input.sourceRunId,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
  }
}

export const objectRegistry: ObjectRegistry = {
  async register(input) {
    return await upsertKnowledgeObject(toDbInput(input))
  },

  async registerBatch(inputs) {
    if (inputs.length === 0) return
    await bulkUpsertKnowledgeObjects(inputs.map(toDbInput))
  },

  async touch(sourceType, sourceId, patch) {
    await touchKnowledgeObject(sourceType, sourceId, {
      ...patch,
      tags: patch.tags ? JSON.stringify(patch.tags) : undefined,
      aliases: patch.aliases ? JSON.stringify(patch.aliases) : undefined,
      metadata: patch.metadata ? JSON.stringify(patch.metadata) : undefined,
    })
  },

  async getBySource(sourceType, sourceId) {
    return await getKnowledgeObjectBySource(sourceType, sourceId)
  },

  async getById(id) {
    return await getKnowledgeObjectById(id)
  },

  async query(query) {
    return await queryKnowledgeObjects(query)
  },

  async count(query) {
    return await countKnowledgeObjects(query)
  },

  async softDelete(sourceType, sourceId) {
    await softDeleteKnowledgeObject(sourceType, sourceId)
  },

  async hardDelete(sourceType, sourceId) {
    await deleteKnowledgeObject(sourceType, sourceId)
  },

  async moveByPath(oldPathPrefix, newPathPrefix) {
    // 简单实现：查询所有路径命中前缀的对象，逐个 touch 新 path。
    // 高频场景下应改成单条 UPDATE，但项目其它代码也用 serializedWrite 逐行，
    // 这里保持一致以避免破坏现有锁/事务约定。
    if (!oldPathPrefix || oldPathPrefix === newPathPrefix) return 0
    const { runDbTransaction } = await import('@/db/index')
    const { getDb } = await import('@/db/index')
    const db = await getDb()
    let updated = 0
    await runDbTransaction(db, async () => {
      const rows = await db.select<Array<{ id: string; path: string }>>(
        'select id, path from knowledge_objects where path like $1',
        [`${oldPathPrefix}%`],
      )
      for (const row of rows) {
        const newPath = newPathPrefix + row.path.slice(oldPathPrefix.length)
        await db.execute(
          'update knowledge_objects set path = $1, updated_at = $2 where id = $3',
          [newPath, Date.now(), row.id],
        )
        updated += 1
      }
    })
    return updated
  },
}

/** 解析辅助：把 KO 的 JSON 字段反序列化成结构化对象 */
export interface ResolvedKnowledgeObject extends Omit<KnowledgeObject, 'tags' | 'aliases' | 'metadata'> {
  tagsList: string[]
  aliasesList: string[]
  metadataMap: Record<string, unknown>
}

export function resolveKnowledgeObject(ko: KnowledgeObject): ResolvedKnowledgeObject {
  return {
    ...ko,
    tagsList: parseKnowledgeObjectTags(ko.tags),
    aliasesList: parseKnowledgeObjectAliases(ko.aliases),
    metadataMap: parseKnowledgeObjectMetadata(ko.metadata),
  }
}

// 类型 re-export，方便下游使用
export type {
  KnowledgeObject,
  KnowledgeObjectOrigin,
  KnowledgeObjectQuery,
  KnowledgeObjectStatus,
  KnowledgeObjectType,
}
