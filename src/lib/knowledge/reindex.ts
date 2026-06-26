/**
 * reindex - 增量重索引核心模块
 *
 * 设计：
 * - knowledge_objects.contentHash 是权威 hash 源
 * - 扫描工作区，对每个 .md 文件计算 hash
 * - 与 KO 表的 contentHash 比对，相同则跳过
 * - 不同则调用 processMarkdownFile 重新索引，并更新 KO.vectorIndexedAt
 * - 检测孤儿：KO 存在但文件不存在 → 调用 deleteVectorDocumentsByFilename 清理，KO 标记 deleted
 *
 * 触发时机：
 * - sync-content-updated 事件（debounced）
 * - 文件移动/删除（单文件 API）
 * - 用户手动调用
 */

import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { processMarkdownFile } from '@/lib/rag'
import { getAllMarkdownFiles, isUserKnowledgeFilePath } from '@/lib/files'
import {
  deleteVectorDocumentsByFilename,
  replaceVectorDocumentsForFile,
} from '@/db/vector'
import { objectRegistry, type KnowledgeObject, type KnowledgeObjectStatus } from './object-registry'
import { registerNoteFromSave } from './note-sync'

export interface ReindexResult {
  scanned: number
  indexed: number
  skipped: number
  pruned: number
  errors: Array<{ path: string; message: string }>
}

export interface ReindexProgress {
  current: number
  total: number
  currentPath: string
}

export type KnowledgeIndexIssueReason =
  | 'missing-file'
  | 'missing-registry'
  | 'hash-mismatch'
  | 'missing-vector-index'

export interface KnowledgeIndexHealthIssue {
  path: string
  title?: string
  status?: KnowledgeObjectStatus
  reason: KnowledgeIndexIssueReason
  updatedAt?: number
  vectorIndexedAt?: number | null
}

export interface KnowledgeIndexHealth {
  checkedAt: number
  healthStatus: 'healthy' | 'attention' | 'critical'
  totalFiles: number
  registryNotes: number
  activeRegistryNotes: number
  deletedRegistryNotes: number
  indexedNotes: number
  orphanNotes: KnowledgeIndexHealthIssue[]
  staleNotes: KnowledgeIndexHealthIssue[]
  warnings: string[]
}

namespace ReindexInternals {
  /**
   * 在模块内维护一个"正在重索引"标记，防止并发触发。
   * sync 事件高频，必须串行化。
   */
  let runningPromise: Promise<ReindexResult> | null = null
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingResolve: ((p: Promise<ReindexResult>) => void) | null = null

  export function getRunningPromise() {
    return runningPromise
  }

  export function setRunningPromise(p: Promise<ReindexResult> | null) {
    runningPromise = p
  }

  export function getPendingTimer() {
    return pendingTimer
  }

  export function setPendingTimer(t: ReturnType<typeof setTimeout> | null) {
    pendingTimer = t
  }

  export function consumePendingResolver() {
    const r = pendingResolve
    pendingResolve = null
    return r
  }

  export function setPendingResolver(r: ((p: Promise<ReindexResult>) => void) | null) {
    pendingResolve = r
  }
}

function koField<T>(ko: KnowledgeObject | Record<string, unknown>, camelKey: string, snakeKey: string): T | undefined {
  const row = ko as Record<string, unknown>
  return (row[camelKey] ?? row[snakeKey]) as T | undefined
}

function koSourceId(ko: KnowledgeObject): string {
  return koField<string>(ko, 'sourceId', 'source_id') || ko.path || ''
}

function koTitle(ko: KnowledgeObject): string | undefined {
  return koField<string>(ko, 'title', 'title')
}

function koStatus(ko: KnowledgeObject): KnowledgeObjectStatus | undefined {
  return koField<KnowledgeObjectStatus>(ko, 'status', 'status')
}

function koContentHash(ko: KnowledgeObject): string | undefined {
  return koField<string>(ko, 'contentHash', 'content_hash')
}

function koVectorIndexedAt(ko: KnowledgeObject): number | null | undefined {
  return koField<number | null>(ko, 'vectorIndexedAt', 'vector_indexed_at')
}

function koUpdatedAt(ko: KnowledgeObject): number | undefined {
  return koField<number>(ko, 'updatedAt', 'updated_at')
}

async function queryAllNoteObjects(status?: KnowledgeObjectStatus | KnowledgeObjectStatus[]): Promise<KnowledgeObject[]> {
  const results: KnowledgeObject[] = []
  const limit = 500
  let offset = 0

  while (true) {
    const page = await objectRegistry.query({
      sourceType: 'note',
      status,
      orderBy: 'updatedAt',
      orderDir: 'desc',
      limit,
      offset,
    })
    results.push(...page)
    if (page.length < limit) break
    offset += limit
  }

  return results
}

async function computeFileHash(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(content)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const bytes = Array.from(new Uint8Array(digest))
      return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // fall through
    }
  }
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0
  }
  return `fnv_${(hash >>> 0).toString(16)}`
}

/** 递归扫描工作区下所有 .md 文件，返回相对路径列表 */
async function scanMarkdownFiles(): Promise<string[]> {
  const files = await getAllMarkdownFiles()
  return files.map(file => file.relativePath || file.path).filter(isUserKnowledgeFilePath)
}

async function readFileContent(relativePath: string): Promise<string | null> {
  try {
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(relativePath)
    if (workspace.isCustom) {
      if (!(await exists(pathOptions.path))) return null
      return await readTextFile(pathOptions.path)
    }
    if (!(await exists(pathOptions.path, { baseDir: pathOptions.baseDir }))) return null
    return await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
  } catch {
    return null
  }
}

export async function getKnowledgeIndexHealth(): Promise<KnowledgeIndexHealth> {
  const warnings: string[] = []
  let files: string[] = []

  try {
    files = await scanMarkdownFiles()
  } catch (error) {
    warnings.push(`扫描工作区失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const fileSet = new Set(files)
  let activeNotes: KnowledgeObject[] = []
  let deletedRegistryNotes = 0

  try {
    activeNotes = (await queryAllNoteObjects(['active', 'inbox', 'archived']))
      .filter(ko => isUserKnowledgeFilePath(ko.path || koSourceId(ko)))
    deletedRegistryNotes = await objectRegistry.count({ sourceType: 'note', status: 'deleted' })
  } catch (error) {
    warnings.push(`读取 KnowledgeObject 注册表失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const registryPathSet = new Set<string>()
  const orphanNotes: KnowledgeIndexHealthIssue[] = []
  const staleNotes: KnowledgeIndexHealthIssue[] = []

  for (const ko of activeNotes) {
    const path = ko.path || koSourceId(ko)
    if (!path) continue
    registryPathSet.add(path)
    const vectorIndexedAt = koVectorIndexedAt(ko)
    const issueBase = {
      path,
      title: koTitle(ko),
      status: koStatus(ko),
      updatedAt: koUpdatedAt(ko),
      vectorIndexedAt,
    }

    if (!fileSet.has(path)) {
      orphanNotes.push({ ...issueBase, reason: 'missing-file' })
      continue
    }

    const content = await readFileContent(path)
    if (content === null) {
      orphanNotes.push({ ...issueBase, reason: 'missing-file' })
      continue
    }

    const currentHash = await computeFileHash(content)
    if (!koContentHash(ko) || koContentHash(ko) !== currentHash) {
      staleNotes.push({ ...issueBase, reason: 'hash-mismatch' })
      continue
    }

    if (!vectorIndexedAt) {
      staleNotes.push({ ...issueBase, reason: 'missing-vector-index' })
    }
  }

  for (const file of files) {
    if (!registryPathSet.has(file)) {
      staleNotes.push({
        path: file,
        reason: 'missing-registry',
      })
    }
  }

  const stalePathSet = new Set(staleNotes.map(issue => issue.path))
  const orphanPathSet = new Set(orphanNotes.map(issue => issue.path))
  const indexedNotes = activeNotes.filter(ko => {
    const path = ko.path || koSourceId(ko)
    return path
      && fileSet.has(path)
      && !stalePathSet.has(path)
      && !orphanPathSet.has(path)
      && Boolean(koContentHash(ko))
      && Boolean(koVectorIndexedAt(ko))
  }).length
  const healthStatus = orphanNotes.length > 0
    ? 'critical'
    : staleNotes.length > 0 || warnings.length > 0
      ? 'attention'
      : 'healthy'

  return {
    checkedAt: Date.now(),
    healthStatus,
    totalFiles: files.length,
    registryNotes: activeNotes.length + deletedRegistryNotes,
    activeRegistryNotes: activeNotes.length,
    deletedRegistryNotes,
    indexedNotes,
    orphanNotes,
    staleNotes,
    warnings,
  }
}

/**
 * 增量重索引主入口。
 * - 扫描工作区所有 .md 文件
 * - 按 contentHash 跳过未变更文件
 * - 检测 KO 中存在但文件不存在的孤儿，清理向量索引
 *
 * 并发保护：模块内单实例，重复调用复用正在跑的 Promise。
 */
export async function incrementalReindex(options: {
  force?: boolean
  onProgress?: (p: ReindexProgress) => void
} = {}): Promise<ReindexResult> {
  const existing = ReindexInternals.getRunningPromise()
  if (existing) return await existing

  const promise = (async (): Promise<ReindexResult> => {
    const result: ReindexResult = {
      scanned: 0,
      indexed: 0,
      skipped: 0,
      pruned: 0,
      errors: [],
    }

    let files: string[]
    try {
      files = await scanMarkdownFiles()
    } catch (error) {
      result.errors.push({
        path: '',
        message: `扫描工作区失败: ${error instanceof Error ? error.message : String(error)}`,
      })
      return result
    }

    result.scanned = files.length

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      if (options.onProgress) {
        options.onProgress({ current: i + 1, total: files.length, currentPath: filePath })
      }

      const content = await readFileContent(filePath)
      if (content === null) {
        result.skipped += 1
        continue
      }

      const hash = await computeFileHash(content)

      if (!options.force) {
        const ko = await objectRegistry.getBySource('note', filePath)
        if (ko && ko.contentHash === hash && ko.vectorIndexedAt) {
          result.skipped += 1
          continue
        }
      }

      try {
        await registerNoteFromSave(filePath, content)
        const ok = await processMarkdownFile(filePath, content)
        if (ok) {
          result.indexed += 1
          await objectRegistry.touch('note', filePath, {
            contentHash: hash,
            vectorIndexedAt: Date.now(),
          })
        } else {
          result.skipped += 1
        }
      } catch (error) {
        result.errors.push({
          path: filePath,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 检测孤儿：KO 中的 note 但文件已不存在
    try {
      const pruneResult = await pruneOrphanNoteIndexes()
      result.pruned = pruneResult
    } catch (error) {
      result.errors.push({
        path: '',
        message: `清理残留索引失败: ${error instanceof Error ? error.message : String(error)}`,
      })
    }

    return result
  })()

  ReindexInternals.setRunningPromise(promise)
  try {
    return await promise
  } finally {
    ReindexInternals.setRunningPromise(null)
  }
}

/**
 * 清理残留索引：KO 中 sourceType='note' 但文件不存在的项。
 * 删除 vector_documents 中对应 chunk，KO 标记 status='deleted'。
 */
export async function pruneOrphanNoteIndexes(): Promise<number> {
  const notes = await queryAllNoteObjects(['active', 'inbox', 'archived'])

  let pruned = 0
  for (const ko of notes) {
    if (!ko.path) continue
    if (!isUserKnowledgeFilePath(ko.path)) continue
    const pathOptions = await getFilePathOptions(ko.path)
    const workspace = await getWorkspacePath()
    let fileExists = false
    try {
      fileExists = workspace.isCustom
        ? await exists(pathOptions.path)
        : await exists(pathOptions.path, { baseDir: pathOptions.baseDir ?? BaseDirectory.AppData })
    } catch {
      fileExists = false
    }
    if (fileExists) continue

    try {
      // 删除向量文档
      await deleteVectorDocumentsByFilename(ko.path)
      // KO 标记软删
      await objectRegistry.softDelete('note', ko.path)
      pruned += 1
    } catch (error) {
      console.error(`[reindex] prune orphan ${ko.path} failed:`, error)
    }
  }
  return pruned
}

/**
 * 单文件重索引。文件保存后调用，或外部修改后强制更新。
 * 会重算 hash 并更新 KO。
 */
export async function reindexFile(filePath: string): Promise<boolean> {
  if (!/\.(md|markdown)$/i.test(filePath)) return false
  if (!isUserKnowledgeFilePath(filePath)) return false

  const content = await readFileContent(filePath)
  if (content === null) {
    // 文件不存在 → 清理
    await unindexFile(filePath)
    return false
  }

  const hash = await computeFileHash(content)
  try {
    await registerNoteFromSave(filePath, content)
    const ok = await processMarkdownFile(filePath, content)
    if (ok) {
      await objectRegistry.touch('note', filePath, {
        contentHash: hash,
        vectorIndexedAt: Date.now(),
      })
    }
    return ok
  } catch (error) {
    console.error(`[reindex] reindexFile ${filePath} failed:`, error)
    return false
  }
}

/**
 * 清理单个文件的向量索引和 KO 记录。
 * 用于文件删除场景。
 */
export async function unindexFile(filePath: string): Promise<void> {
  if (!filePath) return
  try {
    await deleteVectorDocumentsByFilename(filePath)
  } catch (error) {
    console.error(`[reindex] unindexFile ${filePath} (vector) failed:`, error)
  }
  try {
    await objectRegistry.softDelete('note', filePath)
  } catch (error) {
    console.error(`[reindex] unindexFile ${filePath} (ko) failed:`, error)
  }
}

/**
 * 文件移动时迁移向量索引和 KO。
 * - vector_documents: 通过 replaceVectorDocumentsForFile 改 filename
 * - knowledge_objects: 通过 moveByPath 批量更新 path
 *
 * 由于移动后内容通常不变，hash 可保留，但 vectorIndexedAt 维持原值。
 */
export async function moveFileIndex(oldPath: string, newPath: string): Promise<void> {
  if (!oldPath || !newPath || oldPath === newPath) return

  // 先读旧路径 KO 拿 hash（如果旧文件已被移动走，这一步可能失败）
  const oldKo = await objectRegistry.getBySource('note', oldPath)
  const contentHash = oldKo?.contentHash
  const vectorIndexedAt = oldKo?.vectorIndexedAt
  const origin = oldKo?.origin
  const sourceRunId = oldKo?.sourceRunId

  // vector_documents: 拉取旧文档列表，写入新 filename
  try {
    const { getDb } = await import('@/db/index')
    const db = await getDb()
    const rows = await db.select<Array<{ content: string; embedding: string; chunk_id: number }>>(
      'select content, embedding, chunk_id from vector_documents where filename = $1',
      [oldPath],
    )
    if (rows.length > 0) {
      // 复用旧 chunks 写入新 filename，避免重新计算 embedding
      await replaceVectorDocumentsForFile(
        newPath,
        rows.map(r => ({
          filename: newPath,
          chunk_id: r.chunk_id,
          content: r.content,
          embedding: r.embedding,
          updated_at: Date.now(),
        })),
        [oldPath],
      )
    }
  } catch (error) {
    console.error(`[reindex] moveFileIndex vector migrate ${oldPath} -> ${newPath} failed:`, error)
  }

  // KO: 软删旧的，注册新的（保留 hash/origin/runId）
  try {
    if (oldKo) {
      await objectRegistry.hardDelete('note', oldPath)
    }
    const content = await readFileContent(newPath)
    const finalHash = contentHash ?? (content ? await computeFileHash(content) : undefined)
    if (content) {
      await registerNoteFromSave(newPath, content, { origin: origin ?? 'manual', sourceRunId })
      await objectRegistry.touch('note', newPath, {
        contentHash: finalHash,
        vectorIndexedAt: vectorIndexedAt ?? null,
        sourceRunId,
      })
    } else {
      await objectRegistry.register({
        sourceType: 'note',
        sourceId: newPath,
        path: newPath,
        title: newPath.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || newPath,
        origin: origin ?? 'manual',
        contentHash: finalHash,
        vectorIndexedAt: vectorIndexedAt ?? null,
        sourceRunId,
      })
    }
  } catch (error) {
    console.error(`[reindex] moveFileIndex ko migrate ${oldPath} -> ${newPath} failed:`, error)
  }
}

/**
 * sync 事件触发的 debounced 重索引入口。
 * 同步过程中可能触发多次 sync-content-updated，这里做 2 秒 debounce，
 * 合并为一次增量重索引。
 *
 * 多次调用返回同一个 Promise（合并）。
 */
export function scheduleDebouncedReindex(delayMs = 2000): Promise<ReindexResult> {
  const existingTimer = ReindexInternals.getPendingTimer()
  if (existingTimer) {
    // 已有 pending：复用其 resolver
    return new Promise<ReindexResult>(resolve => {
      const prevResolver = ReindexInternals.consumePendingResolver()
      const newResolver = (p: Promise<ReindexResult>) => {
        resolve(p)
        if (prevResolver) prevResolver(p)
      }
      ReindexInternals.setPendingResolver(newResolver)
    })
  }

  return new Promise<ReindexResult>(resolve => {
    const timer = setTimeout(() => {
      ReindexInternals.setPendingTimer(null)
      const resolver = ReindexInternals.consumePendingResolver()
      const p = incrementalReindex()
      if (resolver) resolver(p)
      resolve(p)
    }, delayMs)
    ReindexInternals.setPendingTimer(timer)
    ReindexInternals.setPendingResolver(p => resolve(p))
  })
}
