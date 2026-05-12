import { BaseDirectory, exists, mkdir, readDir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

import { Tool, ToolResult } from '../types'
import {
  createDiagramContentFromOutline,
  createDiagramContent,
  DIAGRAM_FILE_SUFFIXES,
  type DiagramOutlineLayout,
  ensureDiagramFileName,
  getDefaultDiagramBaseName,
  isDiagramPath,
  isDrawioPath,
  isExcalidrawPath,
  normalizeDiagramKind,
} from '@/lib/diagram'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import emitter from '@/lib/emitter'

interface DiagramFileEntry {
  name: string
  path: string
  kind: 'drawio' | 'excalidraw'
  modifiedAt?: string
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

function getDiagramKindFromPath(path: string): DiagramFileEntry['kind'] {
  return isExcalidrawPath(path) ? 'excalidraw' : 'drawio'
}

function normalizeOptionalFolderPath(folderPath: unknown): string | undefined {
  return typeof folderPath === 'string' && folderPath.trim()
    ? folderPath.trim().replace(/\\/g, '/')
    : undefined
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeOutlineLayout(layout: unknown): DiagramOutlineLayout {
  return layout === 'flowchart' ? 'flowchart' : 'mindmap'
}

function validateDiagramContent(filePath: string, content: string): string | null {
  if (!content.trim()) {
    return 'Diagram content cannot be empty.'
  }

  if (isDrawioPath(filePath)) {
    return /<mxfile[\s>]|<mxGraphModel[\s>]/.test(content)
      ? null
      : 'Draw.io content must include an mxfile or mxGraphModel XML root.'
  }

  if (isExcalidrawPath(filePath)) {
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.elements)) {
        return null
      }
      return 'Excalidraw JSON must contain an elements array.'
    } catch {
      return 'Excalidraw content must be valid JSON.'
    }
  }

  return 'Unsupported diagram file extension.'
}

async function getAbsoluteWorkspacePath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  if (workspace.isCustom) {
    return await join(workspace.path, relativePath)
  }

  return `${await appDataDir()}/article/${relativePath}`
}

async function ensureParentFolder(relativePath: string): Promise<void> {
  const parentFolderPath = relativePath.split('/').slice(0, -1).join('/')
  if (!parentFolderPath) {
    return
  }

  const { path, baseDir } = await getFilePathOptions(parentFolderPath)
  if (baseDir) {
    await mkdir(path, { baseDir, recursive: true })
  } else {
    await mkdir(path, { recursive: true })
  }
}

async function pathExists(relativePath: string): Promise<boolean> {
  const { path, baseDir } = await getFilePathOptions(relativePath)
  return baseDir ? await exists(path, { baseDir }) : await exists(path)
}

async function createUniqueDiagramPath(folderPath: string | undefined, baseName: string): Promise<string> {
  let fileName = baseName
  let relativePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, fileName))
  let index = 1

  while (await pathExists(relativePath)) {
    const extension = DIAGRAM_FILE_SUFFIXES.find((suffix) => baseName.toLowerCase().endsWith(suffix)) || ''
    const stem = extension ? baseName.slice(0, -extension.length) : baseName
    fileName = `${stem}_${index}${extension}`
    relativePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, fileName))
    index += 1
  }

  return relativePath
}

async function refreshArticleTreeForDiagram(filePath: string, shouldOpen: boolean): Promise<void> {
  const articleStore = useArticleStore.getState()
  const inserted = articleStore.insertLocalEntry(filePath, false)
  await articleStore.ensurePathExpanded(filePath)
  if (!inserted) {
    await articleStore.loadFileTree()
  }

  if (shouldOpen) {
    await articleStore.setActiveFilePath(filePath)
    await articleStore.readArticle(filePath, '', false)
  }
}

async function collectDiagramFiles(): Promise<DiagramFileEntry[]> {
  const workspace = await getWorkspacePath()
  const rootPath = workspace.isCustom ? workspace.path : 'article'
  const files: DiagramFileEntry[] = []

  async function walk(dirPath: string, relativeDir = ''): Promise<void> {
    const entries = workspace.isCustom
      ? await readDir(dirPath)
      : await readDir(dirPath, { baseDir: BaseDirectory.AppData })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        const childPath = workspace.isCustom ? await join(dirPath, entry.name) : `article/${relativePath}`
        await walk(childPath, relativePath)
        continue
      }

      if (!isDiagramPath(relativePath)) {
        continue
      }

      let modifiedAt: string | undefined
      try {
        const { path, baseDir } = await getFilePathOptions(relativePath)
        const metadata = baseDir ? await stat(path, { baseDir }) : await stat(path)
        modifiedAt = metadata.mtime?.toISOString()
      } catch {
        modifiedAt = undefined
      }

      files.push({
        name: entry.name,
        path: relativePath,
        kind: getDiagramKindFromPath(relativePath),
        modifiedAt,
      })
    }
  }

  try {
    await walk(rootPath)
  } catch (error) {
    if (String(error).includes('not found')) {
      return []
    }
    throw error
  }

  return files
}

export const listDiagramFilesTool: Tool = {
  name: 'list_diagram_files',
  description: 'List diagram files in the workspace. Supports .drawio, .drawio.xml, .excalidraw.json, and .diagram.json files.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const files = await collectDiagramFiles()
      return {
        success: true,
        data: files,
        message: `Found ${files.length} diagram file(s).`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list diagram files: ${error}`,
      }
    }
  },
}

export const readDiagramFileTool: Tool = {
  name: 'read_diagram_file',
  description: 'Read a diagram file as raw text/XML/JSON. Use before updating an existing diagram file.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative diagram file path, e.g. "roadmap.drawio" or "sketch.excalidraw.json".',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!isDiagramPath(filePath)) {
        return {
          success: false,
          error: `Unsupported diagram file extension: ${filePath}`,
        }
      }

      const { path, baseDir } = await getFilePathOptions(filePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
      const metadata = baseDir ? await stat(path, { baseDir }) : await stat(path)

      return {
        success: true,
        data: {
          filePath,
          content,
          kind: getDiagramKindFromPath(filePath),
          modifiedAt: metadata.mtime?.toISOString(),
        },
        message: `Read diagram file: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to read diagram file: ${error}`,
      }
    }
  },
}

export const createDiagramFileTool: Tool = {
  name: 'create_diagram_file',
  description: 'Create a new diagram file. Use this when the user asks AI to create or complete a draw.io, mind map, whiteboard, flowchart, architecture diagram, or other standalone diagram.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'kind',
      type: 'string',
      description: 'Diagram kind: drawio, mindmap, or excalidraw. Defaults to drawio.',
      required: false,
    },
    {
      name: 'fileName',
      type: 'string',
      description: 'Optional filename. Extension is added automatically when omitted. If omitted, a unique default name is used.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional workspace-relative folder path.',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Optional raw diagram content. Draw.io must be mxfile/mxGraphModel XML; Excalidraw must be JSON with elements array. If omitted, creates a blank template.',
      required: false,
    },
    {
      name: 'openAfterCreate',
      type: 'boolean',
      description: 'Whether to open the diagram after creating it. Defaults to true.',
      required: false,
      default: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const kind = normalizeDiagramKind(params.kind)
      const folderPath = normalizeOptionalFolderPath(params.folderPath)
        ? await ensureSafeWorkspaceRelativePath(normalizeOptionalFolderPath(params.folderPath) as string)
        : undefined
      const explicitFileName = typeof params.fileName === 'string' && params.fileName.trim()
        ? ensureDiagramFileName(params.fileName.trim(), kind)
        : undefined
      const baseName = explicitFileName || getDefaultDiagramBaseName(kind)
      const filePath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, baseName))
        : await createUniqueDiagramPath(folderPath, ensureDiagramFileName(baseName, kind))

      if (!isDiagramPath(filePath)) {
        return {
          success: false,
          error: `Unsupported diagram file extension: ${filePath}`,
        }
      }

      if (explicitFileName && await pathExists(filePath)) {
        return {
          success: false,
          error: `Diagram file already exists: ${filePath}`,
        }
      }

      const content = typeof params.content === 'string' && params.content.trim()
        ? params.content
        : createDiagramContent(kind)
      const validationError = validateDiagramContent(filePath, content)
      if (validationError) {
        return {
          success: false,
          error: validationError,
        }
      }

      await ensureParentFolder(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      if (baseDir) {
        await writeTextFile(path, content, { baseDir })
      } else {
        await writeTextFile(path, content)
      }

      const shouldOpen = params.openAfterCreate !== false
      await refreshArticleTreeForDiagram(filePath, shouldOpen)

      return {
        success: true,
        data: {
          filePath,
          fullPath: await getAbsoluteWorkspacePath(filePath),
          kind,
        },
        message: `Created diagram file: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create diagram file: ${error}`,
      }
    }
  },
}

export const createDiagramFromOutlineTool: Tool = {
  name: 'create_diagram_from_outline',
  description: 'Create a standalone diagram file from a text outline. Prefer this when the user provides an outline and wants AI to turn it into a diagram structure.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'outline',
      type: 'string',
      description: 'Markdown-style outline. Supports headings, bullets, numbered lists, and indentation.',
      required: true,
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional diagram title or central topic. If omitted, the first outline line is used.',
      required: false,
    },
    {
      name: 'kind',
      type: 'string',
      description: 'Diagram kind: drawio, mindmap, or excalidraw. Defaults to mindmap.',
      required: false,
    },
    {
      name: 'layout',
      type: 'string',
      description: 'Layout style: mindmap or flowchart. Defaults to mindmap.',
      required: false,
    },
    {
      name: 'fileName',
      type: 'string',
      description: 'Optional filename. Extension is added automatically when omitted.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional workspace-relative folder path.',
      required: false,
    },
    {
      name: 'openAfterCreate',
      type: 'boolean',
      description: 'Whether to open the diagram after creating it. Defaults to true.',
      required: false,
      default: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const outline = normalizeOptionalText(params.outline)
      if (!outline) {
        return {
          success: false,
          error: 'Missing required string parameter: outline',
        }
      }

      const kind = normalizeDiagramKind(params.kind || 'mindmap')
      const layout = normalizeOutlineLayout(params.layout)
      const folderPath = normalizeOptionalFolderPath(params.folderPath)
        ? await ensureSafeWorkspaceRelativePath(normalizeOptionalFolderPath(params.folderPath) as string)
        : undefined
      const explicitFileName = typeof params.fileName === 'string' && params.fileName.trim()
        ? ensureDiagramFileName(params.fileName.trim(), kind)
        : undefined
      const baseName = explicitFileName || getDefaultDiagramBaseName(kind)
      const filePath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, baseName))
        : await createUniqueDiagramPath(folderPath, ensureDiagramFileName(baseName, kind))

      if (!isDiagramPath(filePath)) {
        return {
          success: false,
          error: `Unsupported diagram file extension: ${filePath}`,
        }
      }

      if (explicitFileName && await pathExists(filePath)) {
        return {
          success: false,
          error: `Diagram file already exists: ${filePath}`,
        }
      }

      const content = createDiagramContentFromOutline(kind, outline, {
        title: normalizeOptionalText(params.title),
        layout,
      })
      const validationError = validateDiagramContent(filePath, content)
      if (validationError) {
        return {
          success: false,
          error: validationError,
        }
      }

      await ensureParentFolder(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      if (baseDir) {
        await writeTextFile(path, content, { baseDir })
      } else {
        await writeTextFile(path, content)
      }

      const shouldOpen = params.openAfterCreate !== false
      await refreshArticleTreeForDiagram(filePath, shouldOpen)

      // 自动在源笔记中添加对图表的 wikilink（建立知识图谱关联）
      try {
        const articleStore = useArticleStore.getState()
        const sourceNotePath = articleStore.activeFilePath
        if (sourceNotePath && sourceNotePath.endsWith('.md') && sourceNotePath !== filePath) {
          const diagramName = filePath.split('/').pop()?.replace(/\.(drawio|drawio\.xml|excalidraw\.json|diagram\.json)$/i, '') || filePath
          const sourceOpts = await getFilePathOptions(sourceNotePath)
          const sourceContent = sourceOpts.baseDir
            ? await readTextFile(sourceOpts.path, { baseDir: sourceOpts.baseDir })
            : await readTextFile(sourceOpts.path)

          // 只有当源笔记中还没有这个链接时才添加
          if (!sourceContent.includes(`[[${diagramName}]]`)) {
            const updatedContent = sourceContent.trimEnd() + `\n\n---\n相关图表: [[${diagramName}]]\n`
            if (sourceOpts.baseDir) {
              await writeTextFile(sourceOpts.path, updatedContent, { baseDir: sourceOpts.baseDir })
            } else {
              await writeTextFile(sourceOpts.path, updatedContent)
            }
            // 更新反向链接索引
            const { useNoteIndexStore } = await import('@/stores/note-index')
            useNoteIndexStore.getState().updateFileIndex(sourceNotePath, updatedContent)
          }
        }
      } catch {
        // 链接创建失败不影响主流程
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath: await getAbsoluteWorkspacePath(filePath),
          kind,
          layout,
        },
        message: `Created diagram from outline: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create diagram from outline: ${error}`,
      }
    }
  },
}

export const updateDiagramFileTool: Tool = {
  name: 'update_diagram_file',
  description: 'Replace an existing diagram file with raw diagram content. Always read the current diagram first unless the full content is already in context.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative diagram file path.',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Full replacement content. Draw.io must be mxfile/mxGraphModel XML; Excalidraw must be JSON with elements array.',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp from read_diagram_file. If the file changed since then, the update is rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!isDiagramPath(filePath)) {
        return {
          success: false,
          error: `Unsupported diagram file extension: ${filePath}`,
        }
      }

      if (typeof params.content !== 'string') {
        return {
          success: false,
          error: 'Missing required string parameter: content',
        }
      }

      const validationError = validateDiagramContent(filePath, params.content)
      if (validationError) {
        return {
          success: false,
          error: validationError,
        }
      }

      const { path, baseDir } = await getFilePathOptions(filePath)
      if (!(baseDir ? await exists(path, { baseDir }) : await exists(path))) {
        return {
          success: false,
          error: `Diagram file does not exist: ${filePath}`,
        }
      }

      if (params.expectedModifiedAt) {
        const expectedModifiedAt = new Date(params.expectedModifiedAt)
        if (Number.isNaN(expectedModifiedAt.getTime())) {
          return {
            success: false,
            error: `Invalid expectedModifiedAt: ${params.expectedModifiedAt}`,
          }
        }

        const currentStat = baseDir ? await stat(path, { baseDir }) : await stat(path)
        const currentModifiedAt = currentStat.mtime
        if (currentModifiedAt && currentModifiedAt.getTime() !== expectedModifiedAt.getTime()) {
          return {
            success: false,
            error: `Diagram changed on disk; update cancelled: ${filePath}`,
            data: {
              filePath,
              conflict: true,
              expectedModifiedAt: expectedModifiedAt.toISOString(),
              currentModifiedAt: currentModifiedAt.toISOString(),
            },
          }
        }
      }

      if (baseDir) {
        await writeTextFile(path, params.content, { baseDir })
      } else {
        await writeTextFile(path, params.content)
      }

      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === filePath) {
        emitter.emit('external-content-update', params.content)
        await articleStore.readArticle(filePath, '', false)
      }

      const updatedStat = baseDir ? await stat(path, { baseDir }) : await stat(path)

      return {
        success: true,
        data: {
          filePath,
          modifiedAt: updatedStat.mtime?.toISOString(),
        },
        message: `Updated diagram file: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to update diagram file: ${error}`,
      }
    }
  },
}

export const diagramTools: Tool[] = [
  listDiagramFilesTool,
  readDiagramFileTool,
  createDiagramFileTool,
  createDiagramFromOutlineTool,
  updateDiagramFileTool,
]
