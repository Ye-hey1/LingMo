import { Tool, ToolResult } from '../types'
import { BaseDirectory, exists, readTextFile, writeTextFile, rename, copyFile, stat } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { getAllMarkdownFiles, isLinkedFolder, type LinkedResource, type MarkdownFile } from '@/lib/files'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import emitter from '@/lib/emitter'
import { getVectorDocumentKey } from '@/lib/vector-document-key'
import { clearFileKnowledgeIndexes, moveWorkspaceEntryToTrash } from '@/lib/file-trash'
import { ensureRequiredFrontmatter, applyFrontmatterPatch, type NoteFrontmatter, fileNameToTitle } from '@/lib/knowledge/frontmatter'
import { registerNoteFromSave } from '@/lib/knowledge/note-sync'
import { ARTIFACT_ROOTS } from '@/lib/artifacts/destination'

function formatToolError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== '{}') {
      return serialized
    }
  } catch {
    // ignore serialization failures
  }

  return String(error) === '[object Object]' ? '未知文件系统错误' : String(error)
}

function normalizeLinkedCandidate(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getLinkedFileName(path: unknown): string {
  const normalized = normalizeLinkedCandidate(path)
  return normalized.split('/').pop() || normalized
}

function isGlobalSkillMarkdownPath(filePath: string): boolean {
  return /^(?:skills-v2\/skills|skills)\/[^/]+\/.+\.md$/i.test(filePath)
}

async function readMarkdownPath(filePath: string): Promise<{
  content: string
  resolvedReadPath: string
  resolvedBaseDir?: BaseDirectory
  source?: 'skill-resource'
}> {
  if (isGlobalSkillMarkdownPath(filePath) && await exists(filePath, { baseDir: BaseDirectory.AppData })) {
    return {
      content: await readTextFile(filePath, { baseDir: BaseDirectory.AppData }),
      resolvedReadPath: filePath,
      resolvedBaseDir: BaseDirectory.AppData,
      source: 'skill-resource',
    }
  }

  const { path, baseDir } = await getFilePathOptions(filePath)
  return {
    content: baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path),
    resolvedReadPath: path,
    resolvedBaseDir: baseDir,
  }
}

function matchesLinkedFileCandidate(
  candidate: unknown,
  linkedResource: { relativePath?: string; name?: string; path?: string }
): boolean {
  const normalized = normalizeLinkedCandidate(candidate)
  if (!normalized) {
    return false
  }

  const linkedPaths = new Set([
    linkedResource.relativePath,
    linkedResource.name,
    linkedResource.path,
    getLinkedFileName(linkedResource.relativePath),
    getLinkedFileName(linkedResource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function getBatchLinkedFileReadPlan(
  filePaths: string[],
  linkedResources: Array<{ relativePath?: string; name?: string; path?: string }>
): { filesToRead: string[]; skippedFiles: string[] } {
  const filesToRead: string[] = []
  const skippedFiles: string[] = []

  for (const filePath of filePaths) {
    if (linkedResources.some(resource => matchesLinkedFileCandidate(filePath, resource))) {
      skippedFiles.push(filePath)
    } else {
      filesToRead.push(filePath)
    }
  }

  return {
    filesToRead,
    skippedFiles,
  }
}

function getEffectiveLinkedFiles(): LinkedResource[] {
  const { linkedResource, linkedResources } = useChatStore.getState()
  const resources = linkedResources.length > 0
    ? linkedResources
    : linkedResource
      ? [linkedResource]
      : []

  return resources.filter(resource => !isLinkedFolder(resource))
}

function assertNotAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

async function mirrorVectorDocuments(sourcePath: string, targetPath: string): Promise<number | null> {
  const { getVectorDocumentsByFilename, upsertVectorDocument } = await import('@/db/vector')
  const sourceKey = getVectorDocumentKey(sourcePath)
  const targetKey = getVectorDocumentKey(targetPath)
  const sourceDocs = await getVectorDocumentsByFilename(sourceKey)

  if (sourceDocs.length === 0) {
    return null
  }

  let latestUpdatedAt = 0
  for (const doc of sourceDocs) {
    await upsertVectorDocument({
      filename: targetKey,
      chunk_id: doc.chunk_id,
      content: doc.content,
      embedding: doc.embedding,
      updated_at: doc.updated_at,
    })
    latestUpdatedAt = Math.max(latestUpdatedAt, doc.updated_at)
  }

  return latestUpdatedAt
}

async function removeVectorDocumentsForPath(filePath: string): Promise<void> {
  const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
  const vectorKey = getVectorDocumentKey(filePath)
  const legacyFilename = filePath.split('/').pop() || filePath

  await deleteVectorDocumentsByFilename(vectorKey)
  if (legacyFilename !== vectorKey) {
    await deleteVectorDocumentsByFilename(legacyFilename)
  }
}

function updateVectorIndexedState(oldPath: string | null, newPath: string | null, updatedAt?: number | null) {
  const articleState = useArticleStore.getState()
  const nextMap = new Map(articleState.vectorIndexedFiles)

  if (oldPath) {
    nextMap.delete(getVectorDocumentKey(oldPath))
  }

  if (newPath && updatedAt) {
    nextMap.set(getVectorDocumentKey(newPath), updatedAt)
  }

  useArticleStore.setState({ vectorIndexedFiles: nextMap })
}

function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath)
}

async function registerMarkdownKnowledgeObject(filePath: string, content: string, source: string) {
  if (!isMarkdownPath(filePath)) return
  try {
    await registerNoteFromSave(filePath, content, { origin: 'agent_generated' })
  } catch (error) {
    console.error(`[${source}] registerNoteFromSave failed:`, error)
  }
}

export const listMarkdownFilesTool: Tool = {
  name: 'list_markdown_files',
  description: `List all Markdown notes in the workspace.

When to use:
- Getting an overview of available notes before choosing one to act on.
- Resolving a note the user referred to by name rather than by path.

Do NOT use this tool to:
- Search note CONTENTS — use safe_grep for text, or query_knowledge for semantic search.
- List non-Markdown files — use safe_list_files.

MUST: only act on paths this tool returned. NEVER invent or guess a note path.`,
  category: 'note',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const files = await getAllMarkdownFiles()

      return {
        success: true,
        data: files,
        message: `找到 ${files.length} 个 Markdown 文件`,
      }
    } catch (error) {
      console.error('[list_markdown_files] 获取文件列表失败', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `获取 Markdown 文件列表失败: ${error}`,
      }
    }
  },
}

// Read the saved on-disk content for a note file.
// Prefer get_editor_content for the currently open note so unsaved/runtime state is included.
export const readMarkdownFileTool: Tool = {
  name: 'read_markdown_file',
  description: `Read the saved on-disk content of a Markdown note by path.

When to use:
- Reading a note that is NOT currently open in the editor.
- Reading a note before you modify it with update_markdown_file.
- Reading the specific files safe_grep reported in candidateFiles.

Do NOT use this tool to:
- Read the note currently open in the editor — use get_editor_content, which includes unsaved changes and line numbers.
- Read several notes one at a time — use read_markdown_files_batch in a single call.
- Re-read a note you already read this turn and have not changed.

MUST: call this before update_markdown_file on an existing note. NEVER overwrite content you have not read.`,
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file whose saved content should be read (relative path, e.g., "folder/note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    let normalizedFilePath = ''
    let resolvedReadPath = ''
    let resolvedBaseDir: BaseDirectory | undefined

    try {
      normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === normalizedFilePath) {
        return {
          success: true,
          data: {
            filePath: normalizedFilePath,
            content: articleStore.currentArticle || '',
            source: 'active-editor',
          },
          message: `成功读取当前编辑器内容: ${normalizedFilePath}`,
        }
      }

      // 检查是否已关联该文件到对话中（避免重复读取）
      const linkedFile = getEffectiveLinkedFiles().find(resource =>
        matchesLinkedFileCandidate(normalizedFilePath, resource)
      )

      if (linkedFile) {
        return {
          success: true,
          data: {
            filePath: normalizedFilePath,
            content: `[该文件内容已在对话上下文中] 文件 "${linkedFile.name}" (${linkedFile.relativePath}) 已关联到当前对话，其完整内容已在上下文中，无需再次读取。请直接使用上下文中已有的文件内容。`,
            alreadyInContext: true,
          },
          message: `文件 "${linkedFile.name}" 已在对话上下文中，无需再次读取`,
        }
      }

      const readResult = await readMarkdownPath(normalizedFilePath)
      const { content } = readResult
      resolvedReadPath = readResult.resolvedReadPath
      resolvedBaseDir = readResult.resolvedBaseDir

      return {
        success: true,
        data: {
          filePath: normalizedFilePath,
          content,
          source: readResult.source,
        },
        message: `成功读取文件: ${normalizedFilePath}`,
      }
    } catch (error) {
      const errorMessage = formatToolError(error)
      console.warn('[read_markdown_file] 读取失败', {
        filePath: params.filePath,
        normalizedFilePath,
        resolvedReadPath,
        resolvedBaseDir,
        error: errorMessage,
      })
      return {
        success: false,
        error: `读取文件失败: ${errorMessage}`,
        modelHint: normalizedFilePath
          ? 'The note path may not exist. Confirm it with list_markdown_files or safe_grep and retry with the exact path returned. If this note is currently open in the editor, use get_editor_content instead. Do NOT guess variations of the path.'
          : 'Pass a workspace-relative path such as folder/note.md. Use list_markdown_files to find the real path first.',
        data: {
          filePath: params.filePath,
          normalizedFilePath,
          resolvedReadPath,
          hint: normalizedFilePath
            ? '请确认该路径在当前工作区内存在；若读取当前打开文件，请优先使用 get_editor_content。'
            : '请传入工作区相对路径，例如 folder/note.md。',
        },
      }
    }
  },
}

export const createFileTool: Tool = {
  name: 'create_file',
  description: `Create a NEW file in the workspace.

When to use:
- The user explicitly asked for a new note or file to be created.
- You need a real artifact on disk to satisfy a deliverable.

Do NOT use this tool to:
- Modify an existing file — use update_markdown_file, or replace_editor_content for the open note.
- Save a note the user did not ask you to save. "Summarize this" is NOT a request to create a file; ask first if unsure.
- Create a duplicate. Check with list_markdown_files or safe_grep whether the content already exists.

MUST: after creating, report the returned path to the user. NEVER claim a file was created without a successful result from this tool.

Returns: filePath (workspace-relative) and fullPath (absolute, for script execution).`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'fileName',
      type: 'string',
      description: 'Filename (including extension, e.g., "note.md", "config.json", "script.js")',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'File content (plain text)',
      required: true,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: subfolder path, defaults to root directory. For temporary scripts executed by execute_skill_script, prefer paths like "skills/pptx/runtime"',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined

      // 验证内容参数
      if (!params.content || typeof params.content !== 'string') {
        return {
          success: false,
          error: '缺少必需参数 content 或参数类型错误',
        }
      }

      // 如果没有提供 fileName，生成默认文件名
      let fileName = params.fileName
      if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fileName = `file-${timestamp}.txt`
      }
      fileName = fileName.trim().replace(/\\/g, '/')

      if (!normalizedFolderPath && fileName.includes('/')) {
        const parts = fileName.split('/').filter(Boolean)
        fileName = parts.pop() || fileName
        normalizedFolderPath = parts.length > 0
          ? await ensureSafeWorkspaceRelativePath(parts.join('/'))
          : undefined
      }

      const filePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(normalizedFolderPath, fileName))
      const isSpecialSkillPath =
        filePath.startsWith(`${ARTIFACT_ROOTS.skill_runtime}/`) ||
        filePath.startsWith(`${ARTIFACT_ROOTS.skill_output}/`)

      // 统一使用 getFilePathOptions 来处理路径
      const specialArticleRelativePath = isSpecialSkillPath
        ? `article/${filePath}`.replace(/^article\/article\//, 'article/')
        : undefined
      const { path, baseDir } = specialArticleRelativePath
        ? { path: specialArticleRelativePath as string, baseDir: BaseDirectory.AppData }
        : await getFilePathOptions(filePath)

      // 在创建文件前，确保父目录存在
      const parentFolderPath = filePath.substring(0, filePath.lastIndexOf('/'))
      const needsParentFolder = parentFolderPath && parentFolderPath !== filePath

      const { exists } = await import('@tauri-apps/plugin-fs')
      const fileAlreadyExists = baseDir
        ? await exists(path, { baseDir })
        : await exists(path)

      if (fileAlreadyExists) {
        return {
          success: false,
          error: `文件已存在: ${filePath}。create_file 只能创建新文件，请改用 update_markdown_file 或编辑器工具`,
        }
      }

      if (needsParentFolder) {
        const specialParentRelativePath = isSpecialSkillPath
          ? `article/${parentFolderPath}`.replace(/^article\/article\//, 'article/')
          : undefined
        const { path: parentPath, baseDir: parentBaseDir } = specialParentRelativePath
          ? { path: specialParentRelativePath as string, baseDir: BaseDirectory.AppData }
          : await getFilePathOptions(parentFolderPath)
        const { mkdir } = await import('@tauri-apps/plugin-fs')
        if (parentBaseDir) {
          await mkdir(parentPath, { baseDir: parentBaseDir, recursive: true })
        } else {
          await mkdir(parentPath, { recursive: true })
        }
      }

      // 对 .md 文件，自动补全必填 frontmatter 字段（title 回退链、created、updated、status）
      // Phase 0 #2 frontmatter 标准化的关键写入点
      let finalContent = params.content
      if (/\.(md|markdown)$/i.test(filePath)) {
        try {
          const normalized = ensureRequiredFrontmatter(params.content, {
            title: fileNameToTitle(filePath),
            origin: 'agent_generated',
          })
          if (normalized !== params.content) {
            finalContent = normalized
          }
        } catch (error) {
          console.error('[create_file] frontmatter ensure failed:', error)
        }
      }

      if (baseDir) {
        await writeTextFile(path, finalContent, { baseDir })
      } else {
        await writeTextFile(path, finalContent)
      }
      await registerMarkdownKnowledgeObject(filePath, finalContent, 'create_file')

      // 获取完整路径用于返回
      const { getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      const workspacePath = workspace.isCustom
        ? workspace.path
        : `${await appDataDir()}/article`

      // 构建工作区完整路径
      const fullPath = `${workspacePath}/${filePath}`

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(filePath, false)
      await articleStore.ensurePathExpanded(filePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      // 如果是 Markdown 文件，选中并读取
      if (filePath.endsWith('.md')) {
        await articleStore.setActiveFilePath(filePath)
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath,
          output_files: [filePath],
        },
        message: `成功创建文件: ${fullPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建文件失败: ${error}`,
      }
    }
  },
}

export const updateMarkdownFileTool: Tool = {
  name: 'update_markdown_file',
  description: `Replace the content of an existing Markdown note. This is a WHOLE-FILE write.

When to use:
- Modifying a note that is NOT currently open in the editor.

Do NOT use this tool to:
- Edit the note currently open in the editor — use replace_editor_content, which supports ranged edits and preserves unsaved state.
- Make a small localized change without having read the file. This call replaces everything; unread content will be lost.
- Create a new file — use create_file.

MUST:
- Call read_markdown_file first and build the new content from what you actually read. NEVER pass partial content to this tool.
- Pass \`expectedModifiedAt\` from the read so a concurrent change cannot be silently overwritten. If rejected, re-read and rebuild rather than retrying the same payload.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content (Markdown format)',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp of the file\'s last known modified time. If the on-disk file changed since then, the update will be rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 统一使用 getFilePathOptions 来处理路径
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      if (params.expectedModifiedAt) {
        const expectedModifiedAt = new Date(params.expectedModifiedAt)
        if (Number.isNaN(expectedModifiedAt.getTime())) {
          return {
            success: false,
            error: `expectedModifiedAt 无效: ${params.expectedModifiedAt}`,
          }
        }

        const currentStat = baseDir
          ? await stat(path, { baseDir })
          : await stat(path)
        const currentModifiedAt = currentStat.mtime

        if (currentModifiedAt && currentModifiedAt.getTime() !== expectedModifiedAt.getTime()) {
          return {
            success: false,
            error: `文件已在磁盘上发生变化，已取消更新: ${normalizedFilePath}`,
            modelHint: 'The file changed on disk after you read it, so the update was cancelled to protect the newer content. Call read_markdown_file again, rebuild your new content from what it returns, and retry with the fresh expectedModifiedAt. NEVER retry the same payload — that would discard the change you have not seen.',
            data: {
              filePath: normalizedFilePath,
              conflict: true,
              expectedModifiedAt: expectedModifiedAt.toISOString(),
              currentModifiedAt: currentModifiedAt.toISOString(),
            },
          }
        }
      }

      // 对 .md 文件，合并/保留现有 frontmatter：
      // - 如果 agent 写入的内容没有 frontmatter，但磁盘文件有 → 用磁盘 frontmatter 包裹新 body
      // - 自动 bump updated 字段
      // Phase 0 #2 frontmatter 标准化的关键写入点
      let finalContent = params.content
      if (/\.(md|markdown)$/i.test(normalizedFilePath)) {
        try {
          let existingContent: string | null = null
          try {
            existingContent = baseDir
              ? await readTextFile(path, { baseDir })
              : await readTextFile(path)
          } catch {
            existingContent = null
          }
          if (existingContent) {
            const patch: NoteFrontmatter = { updated: new Date().toISOString() }
            const candidate = applyFrontmatterPatch(existingContent, patch)
            // 仅当 agent 给的 content 没有 frontmatter 但磁盘有时，用磁盘 frontmatter 包裹
            // 如果 agent 自己写了 frontmatter，就尊重 agent 的版本（applyFrontmatterPatch 已经合并）
            const { parseNote } = await import('@/lib/knowledge/frontmatter')
            const agentParsed = parseNote(params.content)
            if (!agentParsed.hasFrontmatter) {
              const existingParsed = parseNote(existingContent)
              const merged = { ...existingParsed.frontmatter, ...patch }
              const { serializeNote } = await import('@/lib/knowledge/frontmatter')
              finalContent = serializeNote(merged, params.content)
            } else {
              finalContent = candidate
            }
          } else {
            finalContent = ensureRequiredFrontmatter(params.content, {
              title: fileNameToTitle(normalizedFilePath),
              origin: 'agent_generated',
            })
          }
        } catch (error) {
          console.error('[update_markdown_file] frontmatter merge failed:', error)
        }
      }

      if (baseDir) {
        await writeTextFile(path, finalContent, { baseDir })
      } else {
        await writeTextFile(path, finalContent)
      }
      await registerMarkdownKnowledgeObject(normalizedFilePath, finalContent, 'update_markdown_file')

      // 如果更新的是当前打开的文件，通过 saveCurrentArticle 刷新编辑器内容
      // 注意：不要使用 setCurrentArticle，因为它会触发 clearStack 清空撤销历史
      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === normalizedFilePath) {
        // 使用 emitter 通知编辑器内容已从外部更新
        emitter.emit('external-content-update', params.content)
      }

      const updatedStat = baseDir
        ? await stat(path, { baseDir })
        : await stat(path)

      return {
        success: true,
        data: {
          filePath: normalizedFilePath,
          modifiedAt: updatedStat.mtime?.toISOString(),
        },
        message: `成功更新文件: ${normalizedFilePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新文件失败: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFileTool: Tool = {
  name: 'delete_markdown_file',
  description: `Move one Markdown note to the trash. Recoverable, but still destructive.

When to use:
- The user explicitly asked to delete a specific note.

Do NOT use this tool to:
- Delete several notes one at a time — use delete_markdown_files_batch in a single call.
- Clean up files the user did not name. NEVER delete on your own initiative.
- Replace a note's content — use update_markdown_file.

MUST:
- Only delete a path the user named or confirmed. If the target is ambiguous, ask which note they mean instead of guessing.
- Report exactly which file was trashed.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      if (isCurrentFile) {
        await articleStore.flushPendingSaveForPath(normalizedFilePath)
      }

      await moveWorkspaceEntryToTrash({
        relativePath: normalizedFilePath,
        kind: 'file',
      })

      try {
        await clearFileKnowledgeIndexes([normalizedFilePath])
      } catch (error) {
        console.error(`删除文件 ${normalizedFilePath} 的索引数据失败:`, error)
      }

      const removed = articleStore.removeLocalEntry(normalizedFilePath)
      if (!removed) {
        await articleStore.loadFileTree()
      }

      await articleStore.cleanTabsByDeletedFile(normalizedFilePath)

      return {
        success: true,
        message: `成功删除文件: ${normalizedFilePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除文件失败: ${error}`,
      }
    }
  },
}

export const searchMarkdownFilesTool: Tool = {
  name: 'search_markdown_files',
  description: `Search content within Markdown files in the file system.

**IMPORTANT - Only use when user EXPLICITLY requests search**:
- ✅ CORRECT: User says "搜索关于React的笔记" / "查找包含xxx的内容" / "帮我找找"
- ❌ WRONG: User asks a question without explicitly asking to search (e.g., "What is React?" without asking to search)

Two modes:
- keyword (default): Fast exact matching for specific terms like "useState", "React", "API"
- rag: Semantic search - ONLY use when user explicitly asks for semantic/AI search (e.g., "语义搜索" / "AI搜索" / "相关笔记")

Use folderPath to limit scope to a specific folder.

**Do NOT use this tool to:**
- Answer a question the user asked without requesting a search. Answer from context instead.
- Search code symbols — use code_search_symbols.
- Search non-Markdown files — use safe_grep.

**MUST:** act only on the paths this tool returns. NEVER infer a note path from a search snippet.`,
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword or natural language query',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Search mode: keyword (default, keyword matching) or rag (semantic search)',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: limit search to specified folder (relative path)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      // ponytail: 防 LLM 传空 query 导致 indexOf('',x) 死循环
      const trimmedQuery = String(params.query || '').trim()
      if (!trimmedQuery) {
        return { success: false, error: '搜索关键词不能为空' }
      }

      const normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined

      // RAG 模式：调用 RAG 搜索
      if (params.mode === 'rag') {
        const { getContextForQuery, getContextForQueryInFolder } = await import('@/lib/rag')

        // 将查询转换为关键词格式
        const keywords = [{ text: params.query, weight: 1 }]

        // 根据是否指定文件夹选择不同的 RAG 方法
        const ragResult = normalizedFolderPath
          ? await getContextForQueryInFolder(keywords, normalizedFolderPath)
          : await getContextForQuery(keywords)

        // 获取所有文件列表，用于补全路径（向量数据库只存文件名，需要补全相对路径）
        const allFiles = await getAllMarkdownFiles()
        // 创建文件名到相对路径的映射（处理同名文件）
        const fileNameToPath = new Map<string, string[]>()
        for (const file of allFiles) {
          const name = file.name
          if (!fileNameToPath.has(name)) {
            fileNameToPath.set(name, [])
          }
          fileNameToPath.get(name)!.push(file.relativePath)
        }

        // 格式化返回结果，补全路径
        const formattedResults = ragResult.sourceDetails.map(source => {
          // 向量搜索返回的 filepath 可能只是文件名，需要补全路径
          let filePath = source.filepath
          if (!filePath.includes('/')) {
            // filepath 只是文件名，从映射中获取完整路径
            const paths = fileNameToPath.get(source.filename)
            if (paths && paths.length > 0) {
              // 如果有多个同名文件，使用第一个
              filePath = paths[0]
            }
          }
          return {
            filePath,
            fileName: source.filename,
            matchedContent: source.content,
          }
        })

        return {
          success: true,
          data: formattedResults,
          message: `RAG 搜索找到 ${ragResult.sources.length} 个相关笔记${normalizedFolderPath ? `（文件夹：${normalizedFolderPath}）` : ''}`,
        }
      }

      // 关键词模式：原有的精确匹配搜索
      // 如果指定了文件夹路径，先过滤文件列表
      let allFiles = await getAllMarkdownFiles()
      if (normalizedFolderPath) {
        allFiles = allFiles.filter(file => file.relativePath.startsWith(normalizedFolderPath))
      }

      const queryLower = params.query.toLowerCase()
      const results: Array<{
        filePath: string
        fileName: string
        matchedContent: string
        lineNumber?: number
        _score: number
      }> = []

      for (const file of allFiles) {
        try {
          let content = ''

          // 统一使用 getFilePathOptions 来处理路径
          const { path, baseDir } = await getFilePathOptions(file.relativePath)

          if (baseDir) {
            content = await readTextFile(path, { baseDir })
          } else {
            content = await readTextFile(path)
          }

          const contentLower = content.toLowerCase()
          if (!contentLower.includes(queryLower)) continue

          // Scoring: title match bonus + occurrence count + heading match bonus
          let score = 0
          const titleLower = file.name.toLowerCase()
          if (titleLower.includes(queryLower)) score += 10
          // Count occurrences
          let occIndex = 0
          let occCount = 0
          while ((occIndex = contentLower.indexOf(queryLower, occIndex)) !== -1) {
            occCount++
            occIndex += queryLower.length
          }
          score += Math.min(occCount, 20)
          // Heading bonus: match appears after a markdown heading line
          const lines = content.split('\n')
          let bestMatchLine = -1
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              bestMatchLine = i
              // Check if this line or previous non-empty line is a heading
              if (/^#{1,6}\s/.test(lines[i])) score += 5
              if (i > 0 && /^#{1,6}\s/.test(lines[i - 1])) score += 3
              break // Score based on first match
            }
          }

          // Find match for content display
          if (bestMatchLine >= 0) {
            const i = bestMatchLine
            const contextStart = Math.max(0, i - 2)
            const contextEnd = Math.min(lines.length, i + 3)
            const contextLines = lines.slice(contextStart, contextEnd)

            const formattedLines = contextLines.map((line, idx) => {
              const actualLineNum = contextStart + idx + 1
              const isMatchLine = actualLineNum === i + 1
              const prefix = isMatchLine ? '>' : ' '
              return `${prefix} ${actualLineNum}: ${line}`
            })

            results.push({
              filePath: file.relativePath,
              fileName: file.name,
              matchedContent: formattedLines.join('\n'),
              lineNumber: i + 1,
              _score: score,
            })
          }
        } catch (error) {
          console.error(`读取文件 ${file.path} 失败:`, error)
        }
      }

      // Sort by relevance score (descending)
      results.sort((a, b) => b._score - a._score)

      // Strip internal score from output
      const cleanResults = results.map((result) => ({
        filePath: result.filePath,
        fileName: result.fileName,
        matchedContent: result.matchedContent,
        lineNumber: result.lineNumber,
      }))

      return {
        success: true,
        data: cleanResults,
        message: `找到 ${cleanResults.length} 个匹配的文件${normalizedFolderPath ? `（文件夹：${normalizedFolderPath}）` : ''}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索文件失败: ${error}`,
      }
    }
  },
}

// ⚠️ DEPRECATED: Use replace_editor_content from editor-tools.ts instead
// This tool writes to disk, but since content is saved in real-time,
// replace_editor_content provides the same result with better performance.
// @deprecated since content is saved in real-time, use replace_editor_content instead
export const modifyCurrentNoteTool: Tool = {
  name: 'modify_current_note',
  description: `**DEPRECATED — do not use.**

Use replace_editor_content instead for the note open in the editor, or update_markdown_file for a note on disk.

This tool writes straight to disk and bypasses the editor's unsaved state, which can silently discard the user's in-progress edits.

Do NOT use this tool under any circumstance. It is retained only for backward compatibility.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return {
      success: false,
      error: 'This tool is deprecated. Use replace_editor_content from editor-tools instead.',
    }
  },
}

export const readMarkdownFilesBatchTool: Tool = {
  name: 'read_markdown_files_batch',
  description: `Read the saved on-disk content of MULTIPLE Markdown notes in one call.

When to use:
- You need two or more notes. Always prefer this over repeated read_markdown_file calls.
- Reading the candidateFiles that safe_grep returned.

Do NOT use this tool to:
- Read a note open in the editor — use get_editor_content for that one, which includes unsaved changes.
- Read a single note — use read_markdown_file.

MUST: batch the paths into ONE call. Calling read_markdown_file in a loop wastes iterations and is treated as a repeated-tool anti-pattern.`,
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths whose saved contents should be read',
      required: true,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: '参数 filePaths 必须是非空数组',
        }
      }

      const results = []
      const errors = []
      const skipped = []
      const linkedFiles = getEffectiveLinkedFiles()
      const readPlan = linkedFiles.length > 0
        ? getBatchLinkedFileReadPlan(params.filePaths, linkedFiles)
        : { filesToRead: params.filePaths, skippedFiles: [] }

      for (const filePath of readPlan.skippedFiles) {
        skipped.push({
          filePath,
          alreadyInContext: true,
        })
      }

      for (const filePath of readPlan.filesToRead) {
        assertNotAborted(context?.abortSignal)
        try {
          let content = ''

          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)
          const readResult = await readMarkdownPath(normalizedFilePath)
          content = readResult.content

          results.push({
            filePath: normalizedFilePath,
            content,
            source: readResult.source,
          })
          assertNotAborted(context?.abortSignal)
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      // 只要有任何文件读取失败，就标记为失败状态
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          files: results,
          skipped,
          failed: errors,
          successCount: results.length,
          skippedCount: skipped.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `部分失败：成功读取 ${results.length} 个文件，跳过 ${skipped.length} 个已在上下文中的文件，${errors.length} 个失败`
          : `成功读取 ${results.length} 个文件，跳过 ${skipped.length} 个已在上下文中的文件`,
        error: hasErrors
          ? `部分文件读取失败：${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量读取文件失败: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFilesBatchTool: Tool = {
  name: 'delete_markdown_files_batch',
  description: `Move MULTIPLE Markdown notes to the trash in one call. Recoverable, but destructive and wide-reaching.

When to use:
- The user explicitly asked to delete several specific notes.

Do NOT use this tool to:
- Delete notes the user did not enumerate or confirm. NEVER infer a deletion set on your own.
- Delete one note — use delete_markdown_file.
- Bulk-clean a folder based on your own judgement of what looks obsolete.

MUST:
- Confirm the exact list with the user before calling when the set was not explicitly given. A wrong list here removes multiple files at once.
- Report every path that was trashed, and any that failed.`,
  category: 'note',
  requiresConfirmation: true,
  risk: 'high',
  capabilities: ['delete'],
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths to delete',
      required: true,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: '参数 filePaths 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []

      for (const filePath of params.filePaths) {
        assertNotAborted(context?.abortSignal)
        try {
          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)

          if (articleStore.activeFilePath === normalizedFilePath) {
            await articleStore.flushPendingSaveForPath(normalizedFilePath)
          }

          await moveWorkspaceEntryToTrash({
            relativePath: normalizedFilePath,
            kind: 'file',
          })

          results.push(normalizedFilePath)
          assertNotAborted(context?.abortSignal)
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      try {
        await clearFileKnowledgeIndexes(results)
      } catch (error) {
        console.error('批量删除文件索引数据失败:', error)
      }

      await articleStore.loadFileTree()
      for (const deletedPath of results) {
        await articleStore.cleanTabsByDeletedFile(deletedPath)
      }

      // 只要有任何文件删除失败，就标记为失败状态
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          deleted: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `部分失败：成功删除 ${results.length} 个文件，${errors.length} 个失败`
          : `成功删除 ${results.length} 个文件`,
        error: hasErrors
          ? `部分文件删除失败：${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除文件失败: ${error}`,
      }
    }
  },
}

export const listMarkdownFilesByDateTool: Tool = {
  name: 'list_markdown_files_by_date',
  description: `List Markdown notes by last-modified time. Supports relative ranges (last N days, N days ago) and absolute ranges.

When to use:
- Time-scoped questions: "what did I write this week", "notes from yesterday", "recent changes".
- Narrowing a large workspace to recently touched notes before searching them.

Do NOT use this tool to:
- List every note regardless of date — use list_markdown_files.
- Search note contents — this filters by timestamp only. Combine with read_markdown_files_batch to inspect what it returns.

Returns: matching note paths with their modification times.`,
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'lastNDays',
      type: 'number',
      description: 'Optional: get files modified within the last N days. Mutually exclusive with olderThanDays/startDate/endDate, has highest priority.',
      required: false,
    },
    {
      name: 'olderThanDays',
      type: 'number',
      description: 'Optional: get files modified more than N days ago (excluding recent N days). Mutually exclusive with lastNDays/startDate/endDate.',
      required: false,
    },
    {
      name: 'startDate',
      type: 'string',
      description: 'Optional: start date (ISO 8601 format, e.g., 2024-01-01 or 2024-01-01T00:00:00Z)',
      required: false,
    },
    {
      name: 'endDate',
      type: 'string',
      description: 'Optional: end date (ISO 8601 format, e.g., 2024-12-31 or 2024-12-31T23:59:59Z), defaults to current time',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let startDate: Date | undefined
      let endDate: Date | undefined

      // 优先使用 lastNDays 参数（最近 N 天）
      if (params.lastNDays && typeof params.lastNDays === 'number') {
        const now = new Date()
        startDate = new Date(now.getTime() - params.lastNDays * 24 * 60 * 60 * 1000)
        endDate = now
      }
      // 其次使用 olderThanDays 参数（N 天之前）
      else if (params.olderThanDays && typeof params.olderThanDays === 'number') {
        const now = new Date()
        endDate = new Date(now.getTime() - params.olderThanDays * 24 * 60 * 60 * 1000)
        // startDate 不设置，表示从最早开始到 endDate
      }
      // 最后使用 startDate/ endDate 参数（绝对时间范围）
      else {
        if (params.startDate) {
          startDate = new Date(params.startDate)
          if (isNaN(startDate.getTime())) {
            return {
              success: false,
              error: `无效的 startDate 格式: ${params.startDate}，请使用 ISO 8601 格式（如 2024-01-01）`,
            }
          }
        }
        if (params.endDate) {
          endDate = new Date(params.endDate)
          if (isNaN(endDate.getTime())) {
            return {
              success: false,
              error: `无效的 endDate 格式: ${params.endDate}，请使用 ISO 8601 格式（如 2024-12-31）`,
            }
          }
        } else {
          endDate = new Date()
        }
      }

      // 获取包含元数据的文件列表
      const allFiles = await getAllMarkdownFiles(true)

      // 根据时间范围过滤
      const filteredFiles: MarkdownFile[] = []
      for (const file of allFiles) {
        if (!file.modifiedAt) {
          continue // 没有修改时间的文件跳过
        }

        const modifiedTime = new Date(file.modifiedAt)

        // 检查是否在时间范围内
        if (startDate && modifiedTime < startDate) {
          continue
        }
        if (endDate && modifiedTime > endDate) {
          continue
        }

        filteredFiles.push(file)
      }

      // 按修改时间倒序排列
      filteredFiles.sort((a, b) => {
        const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
        const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
        return bTime - aTime
      })

      return {
        success: true,
        data: filteredFiles.map(({ name, relativePath, modifiedAt, metadata }) => ({
          name,
          relativePath,
          modifiedAt: modifiedAt?.toISOString(),
          size: metadata?.size,
          createdAt: metadata?.createdAt?.toISOString(),
          accessedAt: metadata?.accessedAt?.toISOString(),
          isReadOnly: metadata?.isReadOnly,
        })),
        message: `找到 ${filteredFiles.length} 个符合条件的文件（${startDate ? `从 ${startDate.toISOString()}` : ''}${endDate ? `到 ${endDate.toISOString()}` : ''}）`,
      }
    } catch (error) {
      console.error('[list_markdown_files_by_date] 获取文件列表失败', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `按时间获取 Markdown 文件列表失败: ${error}`,
      }
    }
  },
}

export const renameFileTool: Tool = {
  name: 'rename_file',
  description: `Rename one Markdown note. Changes the filename only; the containing folder is unchanged.

When to use:
- The user asked to rename a specific note.

Do NOT use this tool to:
- Move a note to a different folder — use move_file.
- Rename several notes — use rename_files_batch in one call.
- Tidy up naming on your own initiative. Rename only what the user asked for.

MUST: be aware that renaming can break links from other notes that reference the old filename. Run safe_grep on the old name first when the note may be linked, and tell the user what you found.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to rename',
      required: true,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'New filename (including .md extension, e.g., "new-note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // 验证新文件名以 .md 结尾
      let newName = params.newName
      if (!newName.endsWith('.md')) {
        newName += '.md'
      }

      // 获取原文件的完整路径信息
      const { path: oldPath, baseDir } = await getFilePathOptions(normalizedFilePath)

      // 构建新路径（保持原文件夹，只改文件名）
      const pathParts = normalizedFilePath.split('/')
      pathParts[pathParts.length - 1] = newName
      const newRelativePath = pathParts.join('/')

      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查新文件名是否已存在
      const { exists } = await import('@tauri-apps/plugin-fs')
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      if (targetExists) {
        return {
          success: false,
          error: `文件名 "${newName}" 已存在，请使用其他文件名`,
        }
      }

      // 执行重命名
      if (baseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: newBaseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)

      // 如果重命名的是当前打开的文件，更新 activeFilePath 并重新读取内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
          newName,
        },
        message: `成功将 "${normalizedFilePath}" 重命名为 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[rename_file] 重命名失败', {
        filePath: params.filePath,
        newName: params.newName,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `重命名文件失败: ${error}`,
      }
    }
  },
}

export const moveFileTool: Tool = {
  name: 'move_file',
  description: `Move one Markdown note to another folder. The filename is unchanged.

When to use:
- The user asked to relocate a specific note.

Do NOT use this tool to:
- Rename a note — use rename_file.
- Duplicate a note — use copy_file; this removes it from the original location.
- Move several notes — use move_files_batch in one call.
- Reorganize the workspace on your own initiative.

MUST: verify the destination folder exists (safe_list_files) before moving. Moving can also break links that reference the old path; check with safe_grep when the note may be linked.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to move',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = await ensureSafeWorkspaceRelativePath(params.targetFolderPath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // 提取原文件名
      const fileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      // 构建新路径
      const newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${fileName}`
        : fileName

      // 验证目标文件夹是否存在
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

      const targetFolderExists = targetBaseDir
        ? await exists(targetFolderDir, { baseDir: targetBaseDir })
        : await exists(targetFolderDir)

      if (!targetFolderExists) {
        return {
          success: false,
          error: `目标文件夹 "${normalizedTargetFolderPath}" 不存在，请先创建该文件夹`,
        }
      }

      // 获取原文件和新文件的完整路径信息
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查目标位置是否已存在同名文件
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      if (targetExists) {
        return {
          success: false,
          error: `目标位置已存在同名文件 "${fileName}"，请先重命名或删除该文件`,
        }
      }

      // 执行移动（使用 rename）
      if (oldBaseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: newBaseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)

      // 如果移动的是当前打开的文件，更新 activeFilePath 并重新读取内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
        },
        message: `成功将 "${normalizedFilePath}" 移动到 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[move_file] 移动失败', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `移动文件失败: ${error}`,
      }
    }
  },
}

export const copyFileTool: Tool = {
  name: 'copy_file',
  description: `Copy one Markdown note to another folder. The original stays in place.

When to use:
- The user asked to duplicate a note, or wants a variant while keeping the original.

Do NOT use this tool to:
- Relocate a note — use move_file; this leaves a duplicate behind.
- Copy several notes — use copy_files_batch in one call.
- Create a backup before editing. Editing tools already guard against lost updates via version and expectedModifiedAt.

MUST: verify the destination folder exists (safe_list_files) first, and confirm you are not creating an unwanted duplicate of content that already exists there.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to copy',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes"). Leave empty to copy to current folder',
      required: false,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'Optional: new filename (including .md extension). If not specified, uses the original filename, and automatically adds a number if a file with the same name exists',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = params.targetFolderPath
        ? await ensureSafeWorkspaceRelativePath(params.targetFolderPath)
        : undefined

      // 提取原文件名
      const originalFileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      // 确定新文件名
      let newFileName = params.newName || originalFileName
      if (!newFileName.endsWith('.md')) {
        newFileName += '.md'
      }

      // 构建新路径
      let newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${newFileName}`
        : newFileName

      // 验证目标文件夹是否存在（如果指定了目标文件夹）
      if (normalizedTargetFolderPath) {
        const { exists } = await import('@tauri-apps/plugin-fs')
        const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

        const targetFolderExists = targetBaseDir
          ? await exists(targetFolderDir, { baseDir: targetBaseDir })
          : await exists(targetFolderDir)

        if (!targetFolderExists) {
          return {
            success: false,
            error: `目标文件夹 "${normalizedTargetFolderPath}" 不存在，请先创建该文件夹`,
          }
        }
      }

      // 获取原文件和新文件的完整路径信息
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查目标位置是否已存在同名文件
      const { exists } = await import('@tauri-apps/plugin-fs')
      let targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      // 如果存在同名文件且没有指定新文件名，自动添加序号
      if (targetExists && !params.newName) {
        const baseName = newFileName.replace(/\.md$/, '')
        let counter = 1
        do {
          newFileName = `${baseName} ${counter}.md`
          newRelativePath = normalizedTargetFolderPath
            ? `${normalizedTargetFolderPath}/${newFileName}`
            : newFileName

          const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
          targetExists = checkBaseDir
            ? await exists(checkPath, { baseDir: checkBaseDir })
            : await exists(checkPath)
          counter++
        } while (targetExists && counter < 1000)
      }

      // 重新获取最终的新路径
      const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

      // 执行复制
      if (oldBaseDir && finalNewBaseDir) {
        await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
      } else {
        await copyFile(oldPath, finalNewPath)
      }

      const copiedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (copiedVectorUpdatedAt !== null) {
        updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
      }
      const copiedContent = finalNewBaseDir
        ? await readTextFile(finalNewPath, { baseDir: finalNewBaseDir })
        : await readTextFile(finalNewPath)
      await registerMarkdownKnowledgeObject(newRelativePath, copiedContent, 'copy_file')

      const inserted = articleStore.insertLocalEntry(newRelativePath, false)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: {
          sourcePath: normalizedFilePath,
          newPath: newRelativePath,
          newName: newFileName,
        },
        message: `成功将 "${normalizedFilePath}" 复制为 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[copy_file] 复制失败', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `复制文件失败: ${error}`,
      }
    }
  },
}

export const moveFilesBatchTool: Tool = {
  name: 'move_files_batch',
  description: `Move MULTIPLE Markdown notes to another folder in one call. Filenames unchanged.

When to use:
- The user asked to relocate several specific notes.

Do NOT use this tool to:
- Move one note — use move_file.
- Copy notes — use copy_files_batch; this removes them from their original locations.
- Reorganize a folder based on your own judgement of where things belong.

MUST:
- Verify the destination folder exists before moving.
- Confirm the exact file list with the user when it was not explicitly given. This relocates many files at once and can break many links.
- Report which paths moved and which failed.`,
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to move, each file contains filePath (source path) and targetFolderPath (destination folder)',
      required: true,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileMoved = false

      for (const file of params.files) {
        assertNotAborted(context?.abortSignal)
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = await ensureSafeWorkspaceRelativePath(file.targetFolderPath)

          // 检查是否是当前打开的文件
          if (articleStore.activeFilePath === filePath) {
            currentFileMoved = true
          }

          // 提取原文件名
          const fileName = filePath.split('/').pop() || filePath

          // 构建新路径
          const newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${fileName}`
            : fileName

          // 验证目标文件夹是否存在
          const { exists } = await import('@tauri-apps/plugin-fs')
          const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

          const targetFolderExists = targetBaseDir
            ? await exists(targetFolderDir, { baseDir: targetBaseDir })
            : await exists(targetFolderDir)

          if (!targetFolderExists) {
            errors.push({ filePath, error: `目标文件夹 "${targetFolderPath}" 不存在` })
            continue
          }

          // 获取原文件和新文件的完整路径信息
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查目标位置是否已存在同名文件
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: '目标位置已存在同名文件' })
            continue
          }

          // 执行移动（使用 rename）
          if (oldBaseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: newBaseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({ oldPath: filePath, newPath: newRelativePath })
          assertNotAborted(context?.abortSignal)
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 如果移动了当前打开的文件，需要更新 activeFilePath
      if (currentFileMoved && results.length > 0) {
        const movedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (movedFile) {
          await articleStore.setActiveFilePath(movedFile.newPath)
          await articleStore.readArticle(movedFile.newPath)
        }
      }

      // 只要有任何文件移动失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          moved: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功移动 ${results.length} 个文件`
          : `部分失败：成功移动 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量移动文件失败: ${error}`,
      }
    }
  },
}

export const copyFilesBatchTool: Tool = {
  name: 'copy_files_batch',
  description: `Copy MULTIPLE Markdown notes to other folders in one call. Originals stay in place.

When to use:
- The user asked to duplicate several specific notes.

Do NOT use this tool to:
- Copy one note — use copy_file.
- Relocate notes — use move_files_batch; this leaves duplicates behind.
- Create bulk backups on your own initiative. That clutters the workspace.

MUST: verify destination folders exist, and report which paths were copied and which failed.`,
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to copy, each file contains filePath (source path), targetFolderPath (destination folder), and optionally newName (new filename)',
      required: true,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []

      for (const file of params.files) {
        assertNotAborted(context?.abortSignal)
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = file.targetFolderPath
            ? await ensureSafeWorkspaceRelativePath(file.targetFolderPath)
            : undefined
          const newName = file.newName

          // 提取原文件名
          const originalFileName = filePath.split('/').pop() || filePath

          // 确定新文件名
          let newFileName = newName || originalFileName
          if (!newFileName.endsWith('.md')) {
            newFileName += '.md'
          }

          // 构建新路径
          let newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${newFileName}`
            : newFileName

          // 验证目标文件夹是否存在（如果指定了目标文件夹）
          if (targetFolderPath) {
            const { exists } = await import('@tauri-apps/plugin-fs')
            const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

            const targetFolderExists = targetBaseDir
              ? await exists(targetFolderDir, { baseDir: targetBaseDir })
              : await exists(targetFolderDir)

            if (!targetFolderExists) {
              errors.push({ filePath, error: `目标文件夹 "${targetFolderPath}" 不存在` })
              continue
            }
          }

          // 获取原文件和新文件的完整路径信息
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查目标位置是否已存在同名文件
          const { exists } = await import('@tauri-apps/plugin-fs')
          let targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          // 如果存在同名文件且没有指定新文件名，自动添加序号
          if (targetExists && !newName) {
            const baseName = newFileName.replace(/\.md$/, '')
            let counter = 1
            do {
              newFileName = `${baseName} ${counter}.md`
              newRelativePath = targetFolderPath
                ? `${targetFolderPath}/${newFileName}`
                : newFileName

              const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
              targetExists = checkBaseDir
                ? await exists(checkPath, { baseDir: checkBaseDir })
                : await exists(checkPath)
              counter++
            } while (targetExists && counter < 1000)
          }

          // 重新获取最终的新路径
          const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

          // 执行复制
          if (oldBaseDir && finalNewBaseDir) {
            await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
          } else {
            await copyFile(oldPath, finalNewPath)
          }

          const copiedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (copiedVectorUpdatedAt !== null) {
            updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
          }
          const copiedContent = finalNewBaseDir
            ? await readTextFile(finalNewPath, { baseDir: finalNewBaseDir })
            : await readTextFile(finalNewPath)
          await registerMarkdownKnowledgeObject(newRelativePath, copiedContent, 'copy_files_batch')

          results.push({
            sourcePath: filePath,
            newPath: newRelativePath,
            newName: newFileName,
          })
          assertNotAborted(context?.abortSignal)
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 只要有任何文件复制失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          copied: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功复制 ${results.length} 个文件`
          : `部分失败：成功复制 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量复制文件失败: ${error}`,
      }
    }
  },
}

export const renameFilesBatchTool: Tool = {
  name: 'rename_files_batch',
  description: `Rename MULTIPLE Markdown notes in one call. Filenames only; folders unchanged.

When to use:
- The user asked to rename several specific notes, or to apply a naming convention they described.

Do NOT use this tool to:
- Rename one note — use rename_file.
- Move notes between folders — use move_files_batch.
- Apply a naming scheme you invented. Use the convention the user specified.

MUST:
- Confirm the full old→new mapping with the user before calling when it was not explicitly given.
- Renaming in bulk can break many inter-note links at once. Run safe_grep on the old names first and report what would break.
- Report each rename that succeeded and each that failed.`,
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to rename, each file contains filePath (original path) and newName (new filename including .md extension)',
      required: true,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileRenamed = false

      for (const file of params.files) {
        assertNotAborted(context?.abortSignal)
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          let newName = file.newName

          // 验证新文件名以 .md 结尾
          if (!newName.endsWith('.md')) {
            newName += '.md'
          }

          // 检查是否是当前打开的文件
          if (articleStore.activeFilePath === filePath) {
            currentFileRenamed = true
          }

          // 获取原文件的完整路径信息
          const { path: oldPath, baseDir } = await getFilePathOptions(filePath)

          // 构建新路径（保持原文件夹，只改文件名）
          const pathParts = filePath.split('/')
          pathParts[pathParts.length - 1] = newName
          const newRelativePath = pathParts.join('/')

          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查新文件名是否已存在
          const { exists } = await import('@tauri-apps/plugin-fs')
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: `文件名 "${newName}" 已存在` })
            continue
          }

          // 执行重命名
          if (baseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: newBaseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({
            oldPath: filePath,
            newPath: newRelativePath,
            newName,
          })
          assertNotAborted(context?.abortSignal)
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 如果重命名了当前打开的文件，更新 activeFilePath 并重新读取内容
      if (currentFileRenamed && results.length > 0) {
        const renamedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (renamedFile) {
          await articleStore.setActiveFilePath(renamedFile.newPath)
          await articleStore.readArticle(renamedFile.newPath)
        }
      }

      // 只要有任何文件重命名失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          renamed: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功重命名 ${results.length} 个文件`
          : `部分失败：成功重命名 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      console.error('[rename_files_batch] 批量重命名失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `批量重命名文件失败: ${error}`,
      }
    }
  },
}

export const noteTools: Tool[] = [
  listMarkdownFilesTool,
  readMarkdownFileTool,
  createFileTool,
  updateMarkdownFileTool,
  deleteMarkdownFileTool,
  searchMarkdownFilesTool,
  readMarkdownFilesBatchTool,
  deleteMarkdownFilesBatchTool,
  listMarkdownFilesByDateTool,
  renameFileTool,
  moveFileTool,
  copyFileTool,
  moveFilesBatchTool,
  copyFilesBatchTool,
  renameFilesBatchTool,
]
