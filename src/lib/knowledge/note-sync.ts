/**
 * note-sync - 把笔记文件保存事件同步到 KnowledgeObject 注册表
 *
 * 调用时机：article store 在写入 .md 文件成功后调用。
 * 职责：
 *   1. 用权威 frontmatter 解析器（@/lib/knowledge/frontmatter）提取
 *      title / tags / aliases / status / source
 *   2. 标题回退链：frontmatter.title → 第一行 H1 → 文件名
 *   3. 计算 contentHash，用于后续增量重索引判断
 *   4. upsert 到 knowledge_objects 表，sourceType='note'，sourceId 用 savePath
 *
 * 不阻塞主保存流程，错误只记录不抛出。
 */

import { objectRegistry, type RegisterObjectInput } from './object-registry'
import { parseNote, fileNameToTitle } from './frontmatter'
import { isUserKnowledgeFilePath } from '@/lib/files'

async function computeContentHash(content: string): Promise<string> {
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

function inferTitleFromBody(body: string, fallback: string): string {
  for (const line of body.split(/\r?\n/, 5)) {
    const trimmed = line.trim()
    if (/^#\s+/.test(trimmed)) {
      return trimmed.replace(/^#\s+/, '').trim()
    }
    if (trimmed && !/^#{1,6}\s/.test(trimmed)) {
      return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed
    }
  }
  return fallback
}

/**
 * 把笔记保存事件注册为 KnowledgeObject。
 * @param savePath 相对 article 工作区的路径，如 "folder/note.md"
 * @param content Markdown 全文
 * @param options 可选：sourceRunId（agent 写入时传入），origin
 */
export async function registerNoteFromSave(
  savePath: string,
  content: string,
  options: { sourceRunId?: string; origin?: RegisterObjectInput['origin'] } = {},
): Promise<void> {
  if (!/\.(md|markdown)$/i.test(savePath)) return
  if (!isUserKnowledgeFilePath(savePath)) return

  const { frontmatter, body, hasFrontmatter } = parseNote(content)
  const fileNameTitle = fileNameToTitle(savePath)
  const title = frontmatter.title || inferTitleFromBody(body, fileNameTitle)

  const contentHash = await computeContentHash(content)

  const objectId = await objectRegistry.register({
    sourceType: 'note',
    sourceId: savePath,
    path: savePath,
    title,
    tags: frontmatter.tags,
    aliases: frontmatter.aliases,
    sourceUrl: frontmatter.source,
    origin: options.origin ?? 'manual',
    status: frontmatter.status ?? 'active',
    contentHash,
    vectorIndexedAt: null,
    sourceRunId: options.sourceRunId ?? frontmatter.source_run_id,
    metadata: {
      length: content.length,
      hasFrontmatter,
      created: frontmatter.created,
      updated: frontmatter.updated,
      review_after: frontmatter.review_after,
    },
  })

  try {
    const { syncKnowledgeObjectToGraph, syncNoteLinksToGraph } = await import('@/lib/knowledge-graph/sync')
    const object = await objectRegistry.getById(objectId)
    if (object) await syncKnowledgeObjectToGraph(object)
    await syncNoteLinksToGraph([{ filePath: savePath, content }])
  } catch (error) {
    console.warn('[KnowledgeGraph] note sync skipped:', error)
  }
}
