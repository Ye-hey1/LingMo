import { exists, mkdir, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, ensureSafeWorkspaceRelativePath } from '@/lib/workspace'
import { getVectorDocumentKey } from '@/lib/vector-document-key'
import { useNoteIndexStore } from '@/stores/note-index'

export type WorkspaceTrashEntryKind = 'file' | 'directory'

export interface WorkspaceTrashEntry {
  id: string
  name: string
  originalPath: string
  trashPath: string
  kind: WorkspaceTrashEntryKind
  deletedAt: number
}

const TRASH_DIR = '.lingmo-trash'
const TRASH_INDEX_PATH = `${TRASH_DIR}/index.json`
let trashMutationQueue: Promise<void> = Promise.resolve()

function normalizeRelativePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
}

function createTrashId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function runTrashMutation<T>(operation: () => Promise<T>) {
  const result = trashMutationQueue.then(operation, operation)
  trashMutationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function getPathName(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function getSafeTrashName(entryId: string, originalPath: string) {
  const name = getPathName(originalPath).replace(/[\\/:*?"<>|]/g, '_') || 'deleted'
  return `${entryId}-${name}`
}

async function pathExists(relativePath: string) {
  const options = await getFilePathOptions(relativePath)
  return options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)
}

async function ensureTrashDirectory() {
  const options = await getFilePathOptions(TRASH_DIR)
  const existsTrash = options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)

  if (!existsTrash) {
    if (options.baseDir) {
      await mkdir(options.path, { baseDir: options.baseDir, recursive: true })
    } else {
      await mkdir(options.path, { recursive: true })
    }
  }
}

async function renameWorkspaceEntry(oldRelativePath: string, newRelativePath: string) {
  const oldOptions = await getFilePathOptions(oldRelativePath)
  const newOptions = await getFilePathOptions(newRelativePath)

  if (oldOptions.baseDir || newOptions.baseDir) {
    await rename(oldOptions.path, newOptions.path, {
      oldPathBaseDir: oldOptions.baseDir,
      newPathBaseDir: newOptions.baseDir,
    })
    return
  }

  await rename(oldOptions.path, newOptions.path)
}

async function readTrashIndex(): Promise<WorkspaceTrashEntry[]> {
  try {
    const options = await getFilePathOptions(TRASH_INDEX_PATH)
    const content = options.baseDir
      ? await readTextFile(options.path, { baseDir: options.baseDir })
      : await readTextFile(options.path)
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed.filter(isTrashEntry) : []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('No such file') || message.includes('not found') || message.includes('系统找不到指定的文件') || message.includes('系统找不到指定的路径')) {
      return []
    }
    console.error('[file-trash] Failed to read trash index:', error)
    return []
  }
}

function isTrashEntry(value: unknown): value is WorkspaceTrashEntry {
  const entry = value as Partial<WorkspaceTrashEntry>
  return Boolean(
    entry
    && typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.originalPath === 'string'
    && typeof entry.trashPath === 'string'
    && (entry.kind === 'file' || entry.kind === 'directory')
    && typeof entry.deletedAt === 'number',
  )
}

async function writeTrashIndex(entries: WorkspaceTrashEntry[]) {
  await ensureTrashDirectory()
  const options = await getFilePathOptions(TRASH_INDEX_PATH)
  const content = JSON.stringify(entries, null, 2)

  if (options.baseDir) {
    await writeTextFile(options.path, content, { baseDir: options.baseDir })
    return
  }

  await writeTextFile(options.path, content)
}

async function ensureParentDirectory(relativePath: string) {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  if (!parentPath) return

  const options = await getFilePathOptions(parentPath)
  const parentExists = options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)

  if (parentExists) return

  if (options.baseDir) {
    await mkdir(options.path, { baseDir: options.baseDir, recursive: true })
    return
  }

  await mkdir(options.path, { recursive: true })
}

function withRestoreSuffix(originalPath: string, index: number, kind: WorkspaceTrashEntryKind) {
  const segments = originalPath.split('/')
  const name = segments.pop() || originalPath
  const parentPath = segments.join('/')
  const suffix = ` 恢复${index === 1 ? '' : index}`

  let restoredName = `${name}${suffix}`
  if (kind === 'file') {
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex > 0) {
      restoredName = `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`
    }
  }

  return parentPath ? `${parentPath}/${restoredName}` : restoredName
}

async function resolveRestoreTarget(entry: WorkspaceTrashEntry) {
  const originalPath = normalizeRelativePath(entry.originalPath)
  if (!(await pathExists(originalPath))) {
    return originalPath
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = withRestoreSuffix(originalPath, index, entry.kind)
    if (!(await pathExists(candidate))) {
      return candidate
    }
  }

  throw new Error('无法找到可用的还原路径')
}

export async function getWorkspaceTrashEntries() {
  const entries = await readTrashIndex()
  return entries.sort((left, right) => right.deletedAt - left.deletedAt)
}

export async function moveWorkspaceEntryToTrash(params: {
  relativePath: string
  kind: WorkspaceTrashEntryKind
}) {
  return runTrashMutation(async () => {
    const originalPath = await ensureSafeWorkspaceRelativePath(params.relativePath)
    const normalizedOriginalPath = normalizeRelativePath(originalPath)

    if (normalizedOriginalPath === TRASH_DIR || normalizedOriginalPath.startsWith(`${TRASH_DIR}/`)) {
      throw new Error('不能删除回收站目录')
    }

    if (!(await pathExists(normalizedOriginalPath))) {
      throw new Error(`文件不存在：${normalizedOriginalPath}`)
    }

    await ensureTrashDirectory()

    const id = createTrashId()
    const trashPath = `${TRASH_DIR}/${getSafeTrashName(id, normalizedOriginalPath)}`
    const entry: WorkspaceTrashEntry = {
      id,
      name: getPathName(normalizedOriginalPath),
      originalPath: normalizedOriginalPath,
      trashPath,
      kind: params.kind,
      deletedAt: Date.now(),
    }

    await renameWorkspaceEntry(normalizedOriginalPath, trashPath)

    try {
      const entries = await readTrashIndex()
      await writeTrashIndex([entry, ...entries.filter(item => item.id !== id)])
    } catch (error) {
      try {
        await renameWorkspaceEntry(trashPath, normalizedOriginalPath)
      } catch (rollbackError) {
        console.error('[file-trash] Failed to rollback trashed file:', rollbackError)
      }
      throw error
    }

    return entry
  })
}

export async function restoreWorkspaceTrashEntry(id: string) {
  return runTrashMutation(async () => {
    const entries = await readTrashIndex()
    const entry = entries.find(item => item.id === id)

    if (!entry) {
      throw new Error('回收站记录不存在')
    }

    if (!(await pathExists(entry.trashPath))) {
      await writeTrashIndex(entries.filter(item => item.id !== id))
      throw new Error('回收站中的文件不存在')
    }

    const restoredPath = await resolveRestoreTarget(entry)
    await ensureParentDirectory(restoredPath)
    try {
      await renameWorkspaceEntry(entry.trashPath, restoredPath)
      await writeTrashIndex(entries.filter(item => item.id !== id))
    } catch (error) {
      try {
        if (await pathExists(restoredPath)) {
          await renameWorkspaceEntry(restoredPath, entry.trashPath)
        }
      } catch (rollbackError) {
        console.error('[file-trash] Failed to rollback restored file:', rollbackError)
      }
      throw error
    }

    return {
      ...entry,
      restoredPath,
    }
  })
}

export async function deleteWorkspaceTrashEntries(ids: string[]) {
  if (ids.length === 0) return

  await runTrashMutation(async () => {
    const idSet = new Set(ids)
    const entries = await readTrashIndex()
    const failed: string[] = []

    for (const entry of entries) {
      if (!idSet.has(entry.id)) continue

      try {
        const options = await getFilePathOptions(entry.trashPath)
        const existsEntry = options.baseDir
          ? await exists(options.path, { baseDir: options.baseDir })
          : await exists(options.path)
        if (!existsEntry) continue

        if (options.baseDir) {
          await remove(options.path, { baseDir: options.baseDir, recursive: entry.kind === 'directory' })
        } else {
          await remove(options.path, { recursive: entry.kind === 'directory' })
        }
      } catch (error) {
        console.error('[file-trash] Failed to delete trash entry:', entry.originalPath, error)
        failed.push(entry.id)
      }
    }

    await writeTrashIndex(entries.filter(entry => !idSet.has(entry.id) || failed.includes(entry.id)))

    if (failed.length > 0) {
      throw new Error(`有 ${failed.length} 个文件未能彻底删除`)
    }
  })
}

export async function emptyWorkspaceTrash() {
  const entries = await readTrashIndex()
  await deleteWorkspaceTrashEntries(entries.map(entry => entry.id))
}

export async function clearFileKnowledgeIndexes(paths: string[]) {
  const markdownPaths = Array.from(new Set(
    paths
      .map(path => normalizeRelativePath(path))
      .filter(path => /\.md$/i.test(path)),
  ))

  if (markdownPaths.length === 0) return []

  const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
  const { deleteTopicsForNote } = await import('@/db/note-topics')
  const { deleteRelationsForNote } = await import('@/db/note-relations')
  const { objectRegistry } = await import('@/lib/knowledge/object-registry')
  const { default: useArticleStore } = await import('@/stores/article')
  const deletedVectorKeys = new Set<string>()

  for (const path of markdownPaths) {
    const vectorKey = getVectorDocumentKey(path)
    const legacyVectorKey = path.split('/').pop() || path

    try {
      await deleteVectorDocumentsByFilename(vectorKey)
      deletedVectorKeys.add(vectorKey)
    } catch (error) {
      console.error('[file-trash] Failed to delete vector docs:', path, error)
    }

    if (legacyVectorKey !== vectorKey) {
      try {
        await deleteVectorDocumentsByFilename(legacyVectorKey)
        deletedVectorKeys.add(legacyVectorKey)
      } catch (error) {
        console.error('[file-trash] Failed to delete legacy vector docs:', path, error)
      }
    }

    try {
      await deleteTopicsForNote(path)
    } catch (error) {
      console.error('[file-trash] Failed to delete note topics:', path, error)
    }

    try {
      await deleteRelationsForNote(path)
    } catch (error) {
      console.error('[file-trash] Failed to delete note relations:', path, error)
    }

    try {
      await objectRegistry.softDelete('note', path)
    } catch (error) {
      console.error('[file-trash] Failed to soft-delete knowledge object:', path, error)
    }

    useNoteIndexStore.getState().updateFileIndex(path, '')
  }

  const articleState = useArticleStore.getState()
  const nextMap = new Map(articleState.vectorIndexedFiles)
  for (const key of deletedVectorKeys) {
    nextMap.delete(key)
  }
  useArticleStore.setState({ vectorIndexedFiles: nextMap })

  return Array.from(deletedVectorKeys)
}
