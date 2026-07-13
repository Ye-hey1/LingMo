/**
 * knowledge-workflow-tools - Phase 1 #A 文件管理工作流
 *
 * 在 note-tools 已有的细粒度 CRUD 之上，提供更高层的批量整理工具：
 *   - tag_files: 批量增/删 frontmatter.tags（不重写正文）
 *   - set_note_status: 批量改 frontmatter.status（inbox/active/archived）
 *   - find_unindexed_notes: 查找缺 tags 或 status=inbox 的笔记，作为整理入口
 *   - bulk_ensure_frontmatter: 给一批文件补全必填字段
 *   - reindex_knowledge_objects: 重建/刷新笔记 KO 与向量索引
 *
 * 设计原则：
 *   - 全部走 Phase 0 #2 的 frontmatter 权威解析器，避免污染已有内容
 *   - 写入成功后调用 registerNoteFromSave，让 KO 注册表与文件保持一致
 *   - 不直接操作 article store，依赖 emitter 事件让 UI 自行刷新
 */

import { Tool, ToolResult } from '../types'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions } from '@/lib/workspace'
import { getAllMarkdownFiles } from '@/lib/files'
import {
  applyFrontmatterPatch,
  ensureRequiredFrontmatter,
  parseNote,
  type NoteFrontmatter,
  type NoteStatus,
  fileNameToTitle,
} from '@/lib/knowledge/frontmatter'
import { registerNoteFromSave } from '@/lib/knowledge/note-sync'

function formatToolError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error) === '[object Object]' ? '未知错误' : String(error)
}

async function readWorkspaceFile(relPath: string): Promise<string> {
  const { path, baseDir } = await getFilePathOptions(relPath)
  return baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
}

async function writeWorkspaceFile(relPath: string, content: string): Promise<void> {
  const { path, baseDir } = await getFilePathOptions(relPath)
  if (baseDir) {
    await writeTextFile(path, content, { baseDir })
  } else {
    await writeTextFile(path, content)
  }
}

function mergeTags(current: string[] | undefined, add: string[], remove: string[]): string[] {
  const set = new Set<string>((current || []).map(t => t.trim()).filter(Boolean))
  for (const t of add) if (t.trim()) set.add(t.trim())
  for (const t of remove) set.delete(t.trim())
  return Array.from(set)
}

function issueSummary(issue: { path: string; reason?: string; title?: string }) {
  return `${issue.path}${issue.reason ? ` (${issue.reason})` : ''}${issue.title ? ` - ${issue.title}` : ''}`
}

/**
 * tag_files - 批量为多个文件增/删 frontmatter.tags
 */
export const tagFilesTool: Tool = {
  name: 'tag_files',
  description:
    'Batch add or remove frontmatter tags on multiple Markdown files. ' +
    'Does not modify body content. Use this for organizing notes, not for renaming files.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'List of workspace-relative Markdown file paths',
      required: true,
    },
    {
      name: 'addTags',
      type: 'array',
      description: 'Tags to add (merged with existing, deduped)',
      required: false,
    },
    {
      name: 'removeTags',
      type: 'array',
      description: 'Tags to remove from each file',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const rawPaths = Array.isArray(params.filePaths) ? params.filePaths : []
      if (rawPaths.length === 0) {
        return { success: false, error: 'filePaths 不能为空' }
      }
      const addTags = Array.isArray(params.addTags) ? params.addTags.map(String) : []
      const removeTags = Array.isArray(params.removeTags) ? params.removeTags.map(String) : []
      if (addTags.length === 0 && removeTags.length === 0) {
        return { success: false, error: 'addTags 和 removeTags 至少要传一个' }
      }

      const results: Array<{ path: string; ok: boolean; tags?: string[]; error?: string }> = []
      for (const raw of rawPaths) {
        const rel = await ensureSafeWorkspaceRelativePath(String(raw))
        if (!/\.(md|markdown)$/i.test(rel)) {
          results.push({ path: rel, ok: false, error: '非 Markdown 文件' })
          continue
        }
        try {
          const original = await readWorkspaceFile(rel)
          const parsed = parseNote(original)
          const nextTags = mergeTags(parsed.frontmatter.tags, addTags, removeTags)
          const patched = applyFrontmatterPatch(original, { tags: nextTags })
          if (patched !== original) {
            await writeWorkspaceFile(rel, patched)
            await registerNoteFromSave(rel, patched, { origin: 'agent_generated' })
          }
          results.push({ path: rel, ok: true, tags: nextTags })
        } catch (err) {
          results.push({ path: rel, ok: false, error: formatToolError(err) })
        }
      }

      const succeeded = results.filter(r => r.ok).length
      const failed = results.length - succeeded
      return {
        success: failed === 0,
        data: {
          total: results.length,
          succeeded,
          failed,
          results,
          summary: `已为 ${succeeded}/${results.length} 个文件更新 tags${failed > 0 ? `（${failed} 个失败）` : ''}`,
        },
      }
    } catch (error) {
      return { success: false, error: `批量打标签失败: ${formatToolError(error)}` }
    }
  },
}

/**
 * set_note_status - 批量改 status（inbox/active/archived）
 */
export const setNoteStatusTool: Tool = {
  name: 'set_note_status',
  description:
    'Batch update frontmatter.status for multiple notes. ' +
    'Use "inbox" for unprocessed, "active" for normal, "archived" for cold storage.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'List of workspace-relative Markdown file paths',
      required: true,
    },
    {
      name: 'status',
      type: 'string',
      description: 'Target status: inbox | active | archived',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const status = String(params.status || '').trim().toLowerCase() as NoteStatus
      if (status !== 'inbox' && status !== 'active' && status !== 'archived') {
        return { success: false, error: `status 必须是 inbox/active/archived，收到: ${params.status}` }
      }
      const rawPaths = Array.isArray(params.filePaths) ? params.filePaths : []
      if (rawPaths.length === 0) {
        return { success: false, error: 'filePaths 不能为空' }
      }

      const results: Array<{ path: string; ok: boolean; error?: string }> = []
      for (const raw of rawPaths) {
        const rel = await ensureSafeWorkspaceRelativePath(String(raw))
        try {
          const original = await readWorkspaceFile(rel)
          const patch: NoteFrontmatter = { status }
          const patched = applyFrontmatterPatch(original, patch)
          if (patched !== original) {
            await writeWorkspaceFile(rel, patched)
            await registerNoteFromSave(rel, patched, { origin: 'agent_generated' })
          }
          results.push({ path: rel, ok: true })
        } catch (err) {
          results.push({ path: rel, ok: false, error: formatToolError(err) })
        }
      }

      const succeeded = results.filter(r => r.ok).length
      return {
        success: succeeded === results.length,
        data: {
          total: results.length,
          succeeded,
          status,
          results,
          summary: `已将 ${succeeded}/${results.length} 个笔记标记为 ${status}`,
        },
      }
    } catch (error) {
      return { success: false, error: `批量改状态失败: ${formatToolError(error)}` }
    }
  },
}

/**
 * find_unindexed_notes - 找出缺 tags 或 status=inbox 的笔记
 *
 * 作为整理工作流的入口：先调用此工具发现待整理的文件，再用 tag_files / set_note_status。
 */
export const findUnindexedNotesTool: Tool = {
  name: 'find_unindexed_notes',
  description:
    'Find Markdown notes that need triage: missing tags, status=inbox, or missing title. ' +
    'Returns a ranked list to feed into tag_files / set_note_status.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional workspace-relative folder to scope the scan. Defaults to whole workspace.',
      required: false,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Filter mode: "no_tags" (default), "inbox", "no_title", "all"',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Max results, default 50',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const folder = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(String(params.folderPath))
        : undefined
      const mode = String(params.mode || 'no_tags').toLowerCase()
      const limit = Math.max(1, Math.min(500, Number(params.limit) || 50))

      const allFiles = await getAllMarkdownFiles()
      const scoped = folder
        ? allFiles.filter(f => f.path.startsWith(folder + '/') || f.path === folder)
        : allFiles

      const candidates: Array<{
        path: string
        title: string
        reason: string
        currentTags?: string[]
        status?: string
      }> = []

      for (const file of scoped) {
        if (candidates.length >= limit) break
        try {
          const content = await readWorkspaceFile(file.path)
          const parsed = parseNote(content)
          const tags = parsed.frontmatter.tags || []
          const status = parsed.frontmatter.status
          const title = parsed.frontmatter.title

          const matches =
            mode === 'all' ||
            (mode === 'no_tags' && tags.length === 0) ||
            (mode === 'inbox' && status === 'inbox') ||
            (mode === 'no_title' && !title)
          if (!matches) continue

          candidates.push({
            path: file.path,
            title: title || fileNameToTitle(file.path),
            reason:
              mode === 'all'
                ? 'matched'
                : mode === 'no_tags'
                  ? 'no_tags'
                  : mode === 'inbox'
                    ? 'status=inbox'
                    : 'no_title',
            currentTags: tags,
            status,
          })
        } catch {
          // 跳过读不了的文件
        }
      }

      return {
        success: true,
        data: {
          total: candidates.length,
          mode,
          folder: folder || '<workspace>',
          candidates,
          summary: `发现 ${candidates.length} 个待整理笔记（mode=${mode}）`,
        },
      }
    } catch (error) {
      return { success: false, error: `扫描待整理笔记失败: ${formatToolError(error)}` }
    }
  },
}

/**
 * bulk_ensure_frontmatter - 批量补全必填 frontmatter 字段
 *
 * 用于历史笔记迁移到新标准：补 title 回退链、created、updated、status。
 */
export const bulkEnsureFrontmatterTool: Tool = {
  name: 'bulk_ensure_frontmatter',
  description:
    'Batch normalize frontmatter on multiple files: ensure title/created/updated/status are present. ' +
    'Idempotent — files already meeting the standard are not modified.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'List of workspace-relative Markdown file paths',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const rawPaths = Array.isArray(params.filePaths) ? params.filePaths : []
      if (rawPaths.length === 0) {
        return { success: false, error: 'filePaths 不能为空' }
      }

      const results: Array<{ path: string; ok: boolean; changed: boolean; error?: string }> = []
      for (const raw of rawPaths) {
        const rel = await ensureSafeWorkspaceRelativePath(String(raw))
        try {
          const original = await readWorkspaceFile(rel)
          const normalized = ensureRequiredFrontmatter(original, {
            title: fileNameToTitle(rel),
            origin: 'agent_generated',
          })
          const changed = normalized !== original
          if (changed) {
            await writeWorkspaceFile(rel, normalized)
            await registerNoteFromSave(rel, normalized, { origin: 'agent_generated' })
          }
          results.push({ path: rel, ok: true, changed })
        } catch (err) {
          results.push({ path: rel, ok: false, changed: false, error: formatToolError(err) })
        }
      }

      const succeeded = results.filter(r => r.ok).length
      const changed = results.filter(r => r.changed).length
      return {
        success: succeeded === results.length,
        data: {
          total: results.length,
          succeeded,
          changed,
          results,
          summary: `${succeeded}/${results.length} 文件已检查，${changed} 个被规范化`,
        },
      }
    } catch (error) {
      return { success: false, error: `批量规范化 frontmatter 失败: ${formatToolError(error)}` }
    }
  },
}

/**
 * reindex_knowledge_objects - 刷新统一知识对象与向量索引。
 *
 * 不修改用户文件内容；用于同步/移动/外部编辑后让 Agent 的知识检索恢复一致。
 */
export const reindexKnowledgeObjectsTool: Tool = {
  name: 'reindex_knowledge_objects',
  description:
    'Rebuild or refresh the note knowledge object registry and vector index for the workspace or a single Markdown file. ' +
    'Use when knowledge search seems stale, after external sync, after file organization, or when the user asks to rebuild/refresh the knowledge base.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Optional workspace-relative Markdown file path. If omitted, scans the whole workspace.',
      required: false,
    },
    {
      name: 'force',
      type: 'boolean',
      description: 'When true, reprocess files even when contentHash/vectorIndexedAt indicate they are up to date.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { incrementalReindex, reindexFile } = await import('@/lib/knowledge/reindex')
      const filePath = typeof params.filePath === 'string' && params.filePath.trim()
        ? await ensureSafeWorkspaceRelativePath(params.filePath)
        : ''

      if (filePath) {
        const ok = await reindexFile(filePath)
        return {
          success: ok,
          data: { filePath, indexed: ok },
          message: ok
            ? `已刷新知识索引: ${filePath}`
            : `未能刷新知识索引: ${filePath}`,
        }
      }

      const result = await incrementalReindex({ force: params.force === true })
      return {
        success: result.errors.length === 0,
        data: result,
        message: `知识索引刷新完成：扫描 ${result.scanned}，索引 ${result.indexed}，跳过 ${result.skipped}，清理 ${result.pruned}。`,
      }
    } catch (error) {
      return {
        success: false,
        error: `刷新知识索引失败: ${formatToolError(error)}`,
      }
    }
  },
}

/**
 * get_knowledge_system_health - 聚合知识库索引、向量缓存、语义抽取队列健康。
 *
 * 只读诊断工具：用于在重建索引前先判断瓶颈在哪里，避免盲目全量刷新。
 */
export const getKnowledgeSystemHealthTool: Tool = {
  name: 'get_knowledge_system_health',
  description:
    'Diagnose local knowledge system health: note index freshness, orphan/stale registry rows, vector cache state, and semantic extraction backlog. ' +
    'Use before reindexing when knowledge search is stale, slow, incomplete, or inconsistent.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'sampleLimit',
      type: 'number',
      description: 'Maximum example paths to show per issue type, default 5.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const sampleLimit = Math.max(1, Math.min(20, Number(params.sampleLimit) || 5))
      const pendingLimit = 50
      const [
        { getKnowledgeIndexHealth },
        { getVectorCacheStats },
        { getSemanticExtractionQueue },
        { getStructuredDocumentsNeedingSemanticExtraction },
      ] = await Promise.all([
        import('@/lib/knowledge/reindex'),
        import('@/db/vector'),
        import('@/lib/structured-knowledge/semantic-extraction-queue'),
        import('@/db/structured-knowledge'),
      ])

      const [indexHealth, pendingSemanticDocuments] = await Promise.all([
        getKnowledgeIndexHealth(),
        getStructuredDocumentsNeedingSemanticExtraction({ limit: pendingLimit }),
      ])
      const vectorCache = getVectorCacheStats()
      const semanticQueue = getSemanticExtractionQueue().snapshot()
      const staleSamples = indexHealth.staleNotes.slice(0, sampleLimit)
      const orphanSamples = indexHealth.orphanNotes.slice(0, sampleLimit)
      const pendingSemanticSamples = pendingSemanticDocuments.slice(0, sampleLimit).map(document => ({
        filePath: document.filePath,
        title: document.title,
        semanticExtractionStatus: document.semanticExtractionStatus || 'idle',
        semanticExtractedAt: document.semanticExtractedAt,
        semanticExtractionRequestedAt: document.semanticExtractionRequestedAt,
        semanticExtractionAttempts: document.semanticExtractionAttempts || 0,
      }))

      const warnings = [
        ...indexHealth.warnings,
        indexHealth.orphanNotes.length > 0
          ? `${indexHealth.orphanNotes.length} 个知识对象指向缺失文件`
          : '',
        indexHealth.staleNotes.length > 0
          ? `${indexHealth.staleNotes.length} 个笔记索引陈旧或缺少向量索引`
          : '',
        vectorCache.isComplete ? '' : '向量缓存还没有完整快照，首次语义搜索可能需要加载缓存',
        pendingSemanticDocuments.length > 0
          ? `${pendingSemanticDocuments.length}${pendingSemanticDocuments.length >= pendingLimit ? '+' : ''} 个结构化笔记等待语义抽取`
          : '',
      ].filter(Boolean)

      const messageLines = [
        `知识系统健康: ${indexHealth.healthStatus}`,
        `索引: Markdown 文件 ${indexHealth.totalFiles}，活跃注册 ${indexHealth.activeRegistryNotes}，已索引 ${indexHealth.indexedNotes}，陈旧 ${indexHealth.staleNotes.length}，孤儿 ${indexHealth.orphanNotes.length}`,
        `向量缓存: chunks=${vectorCache.size}, files=${vectorCache.filenames}, complete=${vectorCache.isComplete}, version=${vectorCache.version}`,
        `语义抽取: queued=${semanticQueue.size}, processing=${semanticQueue.isProcessing}, pendingSample=${pendingSemanticDocuments.length}${pendingSemanticDocuments.length >= pendingLimit ? '+' : ''}, lastRecovered=${semanticQueue.lastRecoveredCount ?? 0}`,
        staleSamples.length ? `陈旧样例:\n${staleSamples.map(issue => `- ${issueSummary(issue)}`).join('\n')}` : '',
        orphanSamples.length ? `孤儿样例:\n${orphanSamples.map(issue => `- ${issueSummary(issue)}`).join('\n')}` : '',
        pendingSemanticSamples.length ? `待语义抽取样例:\n${pendingSemanticSamples.map(document => `- ${document.filePath} (${document.semanticExtractionStatus})`).join('\n')}` : '',
        warnings.length ? `Warnings:\n${warnings.slice(0, 8).map(warning => `- ${warning}`).join('\n')}` : '',
      ].filter(Boolean)

      return {
        success: true,
        message: messageLines.join('\n'),
        data: {
          checkedAt: indexHealth.checkedAt,
          indexHealth,
          vectorCache,
          semanticExtraction: {
            queue: semanticQueue,
            pendingSampleCount: pendingSemanticDocuments.length,
            pendingSampleLimit: pendingLimit,
            mayHaveMorePending: pendingSemanticDocuments.length >= pendingLimit,
            pendingSamples: pendingSemanticSamples,
          },
          samples: {
            staleNotes: staleSamples,
            orphanNotes: orphanSamples,
          },
          warnings,
          summary: {
            healthStatus: indexHealth.healthStatus,
            totalFiles: indexHealth.totalFiles,
            activeRegistryNotes: indexHealth.activeRegistryNotes,
            indexedNotes: indexHealth.indexedNotes,
            staleNotes: indexHealth.staleNotes.length,
            orphanNotes: indexHealth.orphanNotes.length,
            vectorChunks: vectorCache.size,
            vectorFilenames: vectorCache.filenames,
            vectorCacheComplete: vectorCache.isComplete,
            semanticQueueSize: semanticQueue.size,
            semanticPendingSampleCount: pendingSemanticDocuments.length,
          },
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `知识系统健康诊断失败: ${formatToolError(error)}`,
      }
    }
  },
}

export const knowledgeWorkflowTools: Tool[] = [
  tagFilesTool,
  setNoteStatusTool,
  findUnindexedNotesTool,
  bulkEnsureFrontmatterTool,
  getKnowledgeSystemHealthTool,
  reindexKnowledgeObjectsTool,
]
