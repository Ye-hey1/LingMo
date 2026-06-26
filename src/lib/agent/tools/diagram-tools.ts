import { BaseDirectory, exists, mkdir, readDir, readTextFile, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
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
  isMermaidPath,
  normalizeDiagramKind,
} from '@/lib/diagram'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import emitter from '@/lib/emitter'
import { createUniqueArtifactPath, getArtifactFolderPath } from '@/lib/artifacts/destination'
import type { DrawioExportFormat, DrawioExportResult } from '@/lib/emitter'
import {
  appendDrawioCellsToXml,
  applyDrawioCellOperations,
  inspectDrawioXml,
  normalizeDrawioXml,
  type DrawioCellOperation,
} from '@/lib/diagram/drawio-xml'
import {
  decodeDrawioSvgExportData,
  inspectDrawioExportedSvg,
  selectDrawioExportData,
} from '@/lib/diagram/drawio-export'
import {
  formatDrawioShapeLibraryDoc,
  getDrawioShapeLibrary,
  listDrawioShapeLibraries,
} from '@/lib/diagram/drawio-shape-libraries'

interface DiagramFileEntry {
  name: string
  path: string
  kind: 'drawio' | 'excalidraw' | 'mermaid'
  modifiedAt?: string
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

function getDiagramKindFromPath(path: string): DiagramFileEntry['kind'] {
  if (isMermaidPath(path)) return 'mermaid'
  if (isExcalidrawPath(path)) return 'excalidraw'
  return 'drawio'
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeOutlineLayout(layout: unknown): DiagramOutlineLayout {
  return layout === 'flowchart' ? 'flowchart' : 'mindmap'
}

function ensureDrawioFileName(name: string): string {
  const normalized = name.trim()
  if (!normalized) return getDefaultDiagramBaseName('drawio')
  if (/\.drawio(?:\.xml)?$/i.test(normalized)) return normalized
  const withoutKnownDiagramSuffix = normalized.replace(/\.(excalidraw(?:\.json)?|diagram\.json|mmd|mermaid)$/i, '')
  return `${withoutKnownDiagramSuffix}.drawio`
}

function normalizeDrawioExportFormat(value: unknown): DrawioExportFormat {
  return value === 'png' || value === 'xmlpng' || value === 'xmlsvg' ? value : 'svg'
}

function getDrawioExportExtension(format: DrawioExportFormat): string {
  if (format === 'png' || format === 'xmlpng') return '.png'
  return '.svg'
}

function ensureDrawioExportFileName(name: string, format: DrawioExportFormat): string {
  const normalized = name.trim()
  const extension = getDrawioExportExtension(format)
  if (!normalized) return `diagram-export${extension}`
  if (/\.(png|svg)$/i.test(normalized)) {
    return normalized.replace(/\.(png|svg)$/i, extension)
  }
  return `${normalized}${extension}`
}

function getDiagramTitleFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath
  return fileName.replace(/\.(drawio|drawio\.xml|excalidraw|excalidraw\.json|diagram\.json|mmd|mermaid)$/i, '')
}

function prepareDiagramContent(filePath: string, content: string): { content: string; warnings: string[]; fixes: string[] } {
  if (!content.trim()) {
    throw new Error('Diagram content cannot be empty.')
  }

  if (isDrawioPath(filePath)) {
    const normalized = normalizeDrawioXml(content, {
      pageName: getDiagramTitleFromPath(filePath) || 'Page 1',
    })
    return {
      content: normalized.xml,
      warnings: normalized.warnings,
      fixes: normalized.fixes,
    }
  }

  const validationError = validateDiagramContent(filePath, content)
  if (validationError) {
    throw new Error(validationError)
  }

  return { content, warnings: [], fixes: [] }
}

function validateDiagramContent(filePath: string, content: string): string | null {
  if (!content.trim()) {
    return 'Diagram content cannot be empty.'
  }

  if (isDrawioPath(filePath)) {
    try {
      normalizeDrawioXml(content)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
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

  if (isMermaidPath(filePath)) {
    // Mermaid 是纯文本，要求首行是已知图表类型关键字
    const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || ''
    const knownMermaidKeywords = /^(flowchart|graph|mindmap|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|C4Context|requirementDiagram)\b/i
    return knownMermaidKeywords.test(firstLine)
      ? null
      : 'Mermaid content should start with a known diagram type (flowchart, mindmap, sequenceDiagram, etc.).'
  }

  return 'Unsupported diagram file extension.'
}

async function getOpenDrawioXml(filePath: string): Promise<string | null> {
  if (!isDrawioPath(filePath)) {
    return null
  }

  return new Promise((resolve) => {
    let settled = false
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, 200)

    emitter.emit('drawio-get-current-xml', {
      filePath,
      resolve: (data) => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        resolve(data.success && typeof data.xml === 'string' ? data.xml : null)
      },
    })
  })
}

async function loadOpenDrawioXml(filePath: string, xml: string): Promise<boolean> {
  if (!isDrawioPath(filePath)) {
    return false
  }

  return new Promise((resolve) => {
    let settled = false
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(false)
    }, 200)

    emitter.emit('drawio-load-xml', {
      filePath,
      xml,
      modified: false,
      resolve: (result) => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        resolve(result.success)
      },
    })
  })
}

async function exportOpenDrawioDiagram(params: {
  filePath: string
  format: DrawioExportFormat
  xml: string
  scale?: unknown
  border?: unknown
  background?: unknown
  transparent?: unknown
  embedImages?: unknown
  shadow?: unknown
}): Promise<DrawioExportResult> {
  return new Promise((resolve) => {
    let settled = false
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      resolve({
        success: false,
        filePath: params.filePath,
        format: params.format,
        error: 'Draw.io editor is not open or export timed out.',
      })
    }, 25000)

    emitter.emit('drawio-export', {
      filePath: params.filePath,
      format: params.format,
      xml: params.xml,
      scale: typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : 1,
      border: typeof params.border === 'number' && Number.isFinite(params.border) ? params.border : 8,
      background: typeof params.background === 'string' ? params.background : undefined,
      transparent: typeof params.transparent === 'boolean' ? params.transparent : undefined,
      embedImages: typeof params.embedImages === 'boolean' ? params.embedImages : true,
      shadow: typeof params.shadow === 'boolean' ? params.shadow : undefined,
      currentPage: true,
      resolve: (result) => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        resolve(result)
      },
    })
  })
}

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/)
  if (!match) {
    throw new Error('Expected a base64 data URL.')
  }

  const binary = globalThis.atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return {
    mimeType: match[1],
    bytes,
  }
}

async function writeExportedDiagramFile(filePath: string, format: DrawioExportFormat, data: string): Promise<{ bytes: number; mimeType: string }> {
  const { path, baseDir } = await getFilePathOptions(filePath)

  if (format === 'png' || format === 'xmlpng') {
    const decoded = decodeDataUrl(data)
    if (baseDir) {
      await writeFile(path, decoded.bytes, { baseDir })
    } else {
      await writeFile(path, decoded.bytes)
    }
    return { bytes: decoded.bytes.byteLength, mimeType: decoded.mimeType }
  }

  const svg = decodeDrawioSvgExportData(data)
  const svgInspection = inspectDrawioExportedSvg(svg)
  if (!svgInspection.valid) {
    throw new Error(`Draw.io export produced a blank or invalid SVG: ${svgInspection.issues.join(', ')}`)
  }

  if (baseDir) {
    await writeTextFile(path, svg, { baseDir })
  } else {
    await writeTextFile(path, svg)
  }
  return { bytes: new Blob([svg]).size, mimeType: 'image/svg+xml' }
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
  description: 'List diagram files in the workspace. Supports .drawio, .drawio.xml, .excalidraw, .excalidraw.json, and .diagram.json files.',
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
      description: 'Workspace-relative diagram file path, e.g. "roadmap.drawio", "sketch.excalidraw", or "sketch.excalidraw.json".',
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

      const liveContent = await getOpenDrawioXml(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      const content = liveContent ?? (baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path))
      const metadata = baseDir ? await stat(path, { baseDir }) : await stat(path)

      return {
        success: true,
        data: {
          filePath,
          content,
          kind: getDiagramKindFromPath(filePath),
          modifiedAt: metadata.mtime?.toISOString(),
          source: liveContent ? 'open_editor' : 'disk',
        },
        message: liveContent
          ? `Read diagram file from open draw.io editor: ${filePath}`
          : `Read diagram file: ${filePath}`,
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
  description: 'Create a new diagram file. Use this when the user asks AI to create or complete a draw.io, mind map, whiteboard, flowchart, architecture diagram, or other standalone diagram. Prefer kind=mermaid for AI-generated diagrams (lowest token cost, native Markdown-friendly).',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'kind',
      type: 'string',
      description: 'Diagram kind: drawio, mindmap, excalidraw, or mermaid. Defaults to drawio. Prefer mermaid for LLM-generated diagrams (pure text, no XML/JSON overhead).',
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
      const folderPath = await getArtifactFolderPath('diagram', params.folderPath)
      const explicitFileName = typeof params.fileName === 'string' && params.fileName.trim()
        ? ensureDiagramFileName(params.fileName.trim(), kind)
        : undefined
      const baseName = explicitFileName || getDefaultDiagramBaseName(kind)
      const filePath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, baseName))
        : await createUniqueArtifactPath({
          folderPath,
          fileName: ensureDiagramFileName(baseName, kind),
          knownExtensions: [...DIAGRAM_FILE_SUFFIXES],
        })

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

      const rawContent = typeof params.content === 'string' && params.content.trim()
        ? params.content
        : createDiagramContent(kind)
      const prepared = prepareDiagramContent(filePath, rawContent)
      const content = prepared.content

      await ensureParentFolder(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      if (baseDir) {
        await writeTextFile(path, content, { baseDir })
      } else {
        await writeTextFile(path, content)
      }

      const shouldOpen = params.openAfterCreate !== false
      await refreshArticleTreeForDiagram(filePath, shouldOpen)

      // 注册到 KnowledgeObject 表，建立统一索引
      try {
        const { registerDiagramFromSave } = await import('@/lib/knowledge/diagram-sync')
        await registerDiagramFromSave(filePath, content, { origin: 'agent_generated' })
      } catch (error) {
        console.error('[diagram] registerDiagramFromSave failed:', error)
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath: await getAbsoluteWorkspacePath(filePath),
          kind,
          warnings: prepared.warnings,
          fixes: prepared.fixes,
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

export const getDrawioShapeLibraryTool: Tool = {
  name: 'get_drawio_shape_library',
  description: 'Read draw.io shape/icon library guidance before using cloud, Kubernetes, Material Design, flowchart, or other specialized icons. Use this before creating draw.io XML with non-basic icon shapes.',
  category: 'note',
  requiresConfirmation: false,
  capabilities: ['read'],
  parameters: [
    {
      name: 'library',
      type: 'string',
      description: 'Library name, e.g. aws4, azure2, gcp2, kubernetes, material_design, flowchart, basic, arrows2. If omitted or unknown, returns the available library list.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    const requested = normalizeOptionalText(params.library)
    if (!requested) {
      const libraries = listDrawioShapeLibraries().map((library) => ({
        name: library.name,
        title: library.title,
        description: library.description,
        prefix: library.prefix,
      }))
      return {
        success: true,
        data: libraries,
        message: `Available draw.io shape libraries: ${libraries.map((library) => library.name).join(', ')}`,
      }
    }

    const library = getDrawioShapeLibrary(requested)
    if (!library) {
      const available = listDrawioShapeLibraries().map((item) => item.name)
      return {
        success: false,
        error: `Unknown draw.io shape library "${requested}". Available: ${available.join(', ')}`,
        data: { available },
      }
    }

    return {
      success: true,
      data: library,
      message: formatDrawioShapeLibraryDoc(library),
    }
  },
}

export const createDrawioDiagramFromCellsTool: Tool = {
  name: 'create_drawio_diagram_from_cells',
  description: 'Create a .drawio diagram from bare mxCell XML. Generate only mxCell elements; LingMo wraps them in a valid mxfile and adds draw.io root cells automatically. Best for AI-generated draw.io diagrams when Mermaid is not enough.',
  category: 'note',
  requiresConfirmation: true,
  capabilities: ['write'],
  parameters: [
    {
      name: 'cellsXml',
      type: 'string',
      description: 'Bare sibling mxCell elements only. Do not include <mxfile>, <mxGraphModel>, <root>, or root cells id="0"/id="1".',
      required: true,
    },
    {
      name: 'fileName',
      type: 'string',
      description: 'Optional filename. .drawio is added automatically when omitted.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional workspace-relative folder path. Defaults to the standardized diagrams artifact folder.',
      required: false,
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional diagram page title.',
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
      const cellsXml = normalizeOptionalText(params.cellsXml)
      if (!cellsXml) {
        return { success: false, error: 'Missing required string parameter: cellsXml' }
      }

      const folderPath = await getArtifactFolderPath('diagram', params.folderPath)
      const explicitFileName = typeof params.fileName === 'string' && params.fileName.trim()
        ? ensureDrawioFileName(params.fileName.trim())
        : undefined
      const baseName = explicitFileName || getDefaultDiagramBaseName('drawio')
      const filePath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, baseName))
        : await createUniqueArtifactPath({
          folderPath,
          fileName: ensureDiagramFileName(baseName, 'drawio'),
          knownExtensions: [...DIAGRAM_FILE_SUFFIXES],
        })

      if (explicitFileName && await pathExists(filePath)) {
        return { success: false, error: `Diagram file already exists: ${filePath}` }
      }

      const normalized = normalizeDrawioXml(cellsXml, {
        pageName: normalizeOptionalText(params.title) || getDiagramTitleFromPath(filePath),
        rejectIncompleteCells: true,
      })
      const content = normalized.xml

      await ensureParentFolder(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      if (baseDir) {
        await writeTextFile(path, content, { baseDir })
      } else {
        await writeTextFile(path, content)
      }

      const shouldOpen = params.openAfterCreate !== false
      await refreshArticleTreeForDiagram(filePath, shouldOpen)

      try {
        const { registerDiagramFromSave } = await import('@/lib/knowledge/diagram-sync')
        await registerDiagramFromSave(filePath, content, { origin: 'agent_generated' })
      } catch (error) {
        console.error('[diagram] registerDiagramFromSave failed:', error)
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath: await getAbsoluteWorkspacePath(filePath),
          kind: 'drawio',
          warnings: normalized.warnings,
          fixes: normalized.fixes,
        },
        message: `Created draw.io diagram from cells: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create draw.io diagram from cells: ${error}`,
      }
    }
  },
}

export const validateDrawioDiagramTool: Tool = {
  name: 'validate_drawio_diagram',
  description: 'Validate a draw.io diagram structure. Checks XML parsing, duplicate IDs, root cells, edge endpoints, missing geometry, empty diagrams, and likely shape overlaps. Use after creating or editing complex draw.io diagrams.',
  category: 'note',
  requiresConfirmation: false,
  capabilities: ['read'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative .drawio or .drawio.xml path. Required unless content is provided.',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Optional draw.io XML content to validate directly. If omitted, filePath is read, preferring the open draw.io editor when available.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const explicitContent = typeof params.content === 'string' && params.content.trim()
        ? params.content
        : undefined

      let filePath: string | undefined
      let content = explicitContent
      let source: 'param' | 'open_editor' | 'disk' = explicitContent ? 'param' : 'disk'

      if (!content) {
        if (typeof params.filePath !== 'string' || !params.filePath.trim()) {
          return {
            success: false,
            error: 'Missing filePath or content.',
          }
        }

        filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
        if (!isDrawioPath(filePath)) {
          return { success: false, error: `validate_drawio_diagram only supports draw.io files: ${filePath}` }
        }

        const liveContent = await getOpenDrawioXml(filePath)
        if (liveContent) {
          content = liveContent
          source = 'open_editor'
        } else {
          const { path, baseDir } = await getFilePathOptions(filePath)
          content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
          source = 'disk'
        }
      }

      const inspection = inspectDrawioXml(content)
      return {
        success: true,
        data: {
          filePath,
          source,
          valid: inspection.valid,
          issues: inspection.issues,
          warnings: inspection.warnings,
          stats: inspection.stats,
          fixes: inspection.fixes,
        },
        message: inspection.valid
          ? `Draw.io diagram is structurally valid (${inspection.stats.vertices} vertices, ${inspection.stats.edges} edges).`
          : `Draw.io diagram has ${inspection.issues.length} structural issue(s).`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to validate draw.io diagram: ${error}`,
      }
    }
  },
}

export const exportDrawioDiagramTool: Tool = {
  name: 'export_drawio_diagram',
  description: 'Export a draw.io diagram from the open editor to SVG or PNG. Use after validating a generated diagram when the user needs a rendered preview/image file.',
  category: 'note',
  requiresConfirmation: true,
  capabilities: ['write'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative .drawio or .drawio.xml path. The file must be open in the draw.io editor for export.',
      required: true,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Export format: svg, png, xmlsvg, or xmlpng. Defaults to svg. xmlsvg/xmlpng embed editable diagram data.',
      required: false,
    },
    {
      name: 'outputFileName',
      type: 'string',
      description: 'Optional output filename. Extension is adjusted to .svg or .png automatically.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional output folder. Defaults to diagrams/exports.',
      required: false,
    },
    {
      name: 'scale',
      type: 'number',
      description: 'Optional export scale. Defaults to 1.',
      required: false,
    },
    {
      name: 'border',
      type: 'number',
      description: 'Optional export border in pixels. Defaults to 8.',
      required: false,
    },
    {
      name: 'transparent',
      type: 'boolean',
      description: 'Whether to export transparent background when supported.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!isDrawioPath(filePath)) {
        return { success: false, error: `export_drawio_diagram only supports draw.io files: ${filePath}` }
      }

      const format = normalizeDrawioExportFormat(params.format)
      const liveXml = await getOpenDrawioXml(filePath)
      if (!liveXml) {
        return {
          success: false,
          error: `Draw.io editor is not open for export: ${filePath}. Open this diagram in the editor first, then retry export_drawio_diagram.`,
          data: {
            filePath,
            requiresOpenEditor: true,
          },
        }
      }

      const inspection = inspectDrawioXml(liveXml)
      if (!inspection.valid) {
        return {
          success: false,
          error: `Draw.io diagram has structural issue(s); validate and fix before exporting: ${inspection.issues.map((issue) => issue.code).join(', ')}`,
          data: {
            filePath,
            issues: inspection.issues,
            warnings: inspection.warnings,
            stats: inspection.stats,
          },
        }
      }

      const exported = await exportOpenDrawioDiagram({
        filePath,
        format,
        xml: liveXml,
        scale: params.scale,
        border: params.border,
        transparent: params.transparent,
        background: params.background,
        embedImages: params.embedImages,
        shadow: params.shadow,
      })
      const exportData = selectDrawioExportData(exported, format)
      if (!exported.success || !exportData) {
        return {
          success: false,
          error: exported.error || 'Draw.io export failed.',
          data: exported,
        }
      }

      const folderPath = await getArtifactFolderPath('diagram', params.folderPath || 'diagrams/exports')
      const sourceTitle = getDiagramTitleFromPath(filePath) || 'diagram'
      const explicitFileName = typeof params.outputFileName === 'string' && params.outputFileName.trim()
        ? ensureDrawioExportFileName(params.outputFileName.trim(), format)
        : undefined
      const outputPath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, explicitFileName))
        : await createUniqueArtifactPath({
          folderPath,
          fileName: ensureDrawioExportFileName(`${sourceTitle}-export`, format),
          knownExtensions: ['.png', '.svg'],
        })

      await ensureParentFolder(outputPath)
      const written = await writeExportedDiagramFile(outputPath, format, exportData)
      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(outputPath, false)
      await articleStore.ensurePathExpanded(outputPath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: {
          sourceFilePath: filePath,
          outputPath,
          fullPath: await getAbsoluteWorkspacePath(outputPath),
          format,
          mimeType: written.mimeType,
          bytes: written.bytes,
          warnings: inspection.warnings,
          stats: inspection.stats,
        },
        message: `Exported draw.io diagram to ${outputPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to export draw.io diagram: ${error}`,
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
      description: 'Diagram kind: drawio, mindmap, excalidraw, or mermaid. Defaults to mindmap. Prefer mermaid for LLM-generated diagrams from outlines (pure text).',
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
      const folderPath = await getArtifactFolderPath('diagram', params.folderPath)
      const explicitFileName = typeof params.fileName === 'string' && params.fileName.trim()
        ? ensureDiagramFileName(params.fileName.trim(), kind)
        : undefined
      const baseName = explicitFileName || getDefaultDiagramBaseName(kind)
      const filePath = explicitFileName
        ? await ensureSafeWorkspaceRelativePath(joinRelativePath(folderPath, baseName))
        : await createUniqueArtifactPath({
          folderPath,
          fileName: ensureDiagramFileName(baseName, kind),
          knownExtensions: [...DIAGRAM_FILE_SUFFIXES],
        })

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

      // 注册到 KnowledgeObject 表，建立统一索引
      try {
        const { registerDiagramFromSave } = await import('@/lib/knowledge/diagram-sync')
        await registerDiagramFromSave(filePath, content, { origin: 'agent_generated', layout })
      } catch (error) {
        console.error('[diagram] registerDiagramFromSave failed:', error)
      }

      // 自动在源笔记中添加对图表的 wikilink（建立知识图谱关联）
      try {
        const articleStore = useArticleStore.getState()
        const sourceNotePath = articleStore.activeFilePath
        if (sourceNotePath && sourceNotePath.endsWith('.md') && sourceNotePath !== filePath) {
          const diagramName = filePath.split('/').pop()?.replace(/\.(drawio|drawio\.xml|excalidraw|excalidraw\.json|diagram\.json)$/i, '') || filePath
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

      const prepared = prepareDiagramContent(filePath, params.content)
      const content = prepared.content

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
        await writeTextFile(path, content, { baseDir })
      } else {
        await writeTextFile(path, content)
      }

      // 更新 KO 索引（contentHash、可能的新标题）
      try {
        const { registerDiagramFromSave } = await import('@/lib/knowledge/diagram-sync')
        await registerDiagramFromSave(filePath, content, { origin: 'agent_generated' })
      } catch (error) {
        console.error('[diagram] registerDiagramFromSave failed:', error)
      }

      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === filePath) {
        const pushedToCanvas = await loadOpenDrawioXml(filePath, content)
        emitter.emit('external-content-update', content)
        await articleStore.readArticle(filePath, '', false)
        if (!pushedToCanvas && isDrawioPath(filePath)) {
          emitter.emit('drawio-load-xml', { filePath, xml: content, modified: false })
        }
      }

      const updatedStat = baseDir ? await stat(path, { baseDir }) : await stat(path)

      return {
        success: true,
        data: {
          filePath,
          modifiedAt: updatedStat.mtime?.toISOString(),
          warnings: prepared.warnings,
          fixes: prepared.fixes,
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

async function readExistingDiagramForWrite(filePath: string, expectedModifiedAt?: unknown): Promise<{
  path: string
  baseDir?: BaseDirectory
  content: string
}> {
  const { path, baseDir } = await getFilePathOptions(filePath)
  if (!(baseDir ? await exists(path, { baseDir }) : await exists(path))) {
    throw new Error(`Diagram file does not exist: ${filePath}`)
  }

  if (expectedModifiedAt) {
    const expected = new Date(String(expectedModifiedAt))
    if (Number.isNaN(expected.getTime())) {
      throw new Error(`Invalid expectedModifiedAt: ${expectedModifiedAt}`)
    }

    const currentStat = baseDir ? await stat(path, { baseDir }) : await stat(path)
    const currentModifiedAt = currentStat.mtime
    if (currentModifiedAt && currentModifiedAt.getTime() !== expected.getTime()) {
      throw new Error(`Diagram changed on disk; update cancelled: ${filePath}`)
    }
  }

  const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
  const liveContent = await getOpenDrawioXml(filePath)
  return { path, baseDir, content: liveContent ?? content }
}

async function writeDiagramAndRefresh(filePath: string, path: string, baseDir: BaseDirectory | undefined, content: string): Promise<string | undefined> {
  if (baseDir) {
    await writeTextFile(path, content, { baseDir })
  } else {
    await writeTextFile(path, content)
  }

  try {
    const { registerDiagramFromSave } = await import('@/lib/knowledge/diagram-sync')
    await registerDiagramFromSave(filePath, content, { origin: 'agent_generated' })
  } catch (error) {
    console.error('[diagram] registerDiagramFromSave failed:', error)
  }

  const articleStore = useArticleStore.getState()
  if (articleStore.activeFilePath === filePath) {
    const pushedToCanvas = await loadOpenDrawioXml(filePath, content)
    emitter.emit('external-content-update', content)
    await articleStore.readArticle(filePath, '', false)
    if (!pushedToCanvas && isDrawioPath(filePath)) {
      emitter.emit('drawio-load-xml', { filePath, xml: content, modified: false })
    }
  }

  const updatedStat = baseDir ? await stat(path, { baseDir }) : await stat(path)
  return updatedStat.mtime?.toISOString()
}

function normalizeDrawioOperations(value: unknown): DrawioCellOperation[] | null {
  if (!Array.isArray(value)) return null

  const operations: DrawioCellOperation[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const candidate = item as Record<string, unknown>
    const operation = candidate.operation
    const cellId = typeof candidate.cell_id === 'string'
      ? candidate.cell_id
      : typeof candidate.cellId === 'string'
        ? candidate.cellId
        : ''

    if (operation !== 'add' && operation !== 'update' && operation !== 'delete') return null
    operations.push({
      operation,
      cell_id: cellId,
      new_xml: typeof candidate.new_xml === 'string'
        ? candidate.new_xml
        : typeof candidate.newXml === 'string'
          ? candidate.newXml
          : undefined,
    })
  }

  return operations
}

export const appendDrawioDiagramCellsTool: Tool = {
  name: 'append_drawio_diagram_cells',
  description: 'Append bare mxCell elements to an existing .drawio file. Use this to continue a large generated diagram after reading or creating the file. Never include wrapper tags.',
  category: 'note',
  requiresConfirmation: true,
  capabilities: ['write'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative .drawio or .drawio.xml path.',
      required: true,
    },
    {
      name: 'cellsXml',
      type: 'string',
      description: 'Bare sibling mxCell elements to append. IDs must be unique and must not include id="0" or id="1".',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp from read_diagram_file. If the file changed since then, the append is rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!isDrawioPath(filePath)) {
        return { success: false, error: `append_drawio_diagram_cells only supports draw.io files: ${filePath}` }
      }

      const cellsXml = normalizeOptionalText(params.cellsXml)
      if (!cellsXml) {
        return { success: false, error: 'Missing required string parameter: cellsXml' }
      }

      const existing = await readExistingDiagramForWrite(filePath, params.expectedModifiedAt)
      const result = appendDrawioCellsToXml(existing.content, cellsXml)
      if (result.errors.length > 0) {
        return {
          success: false,
          error: result.errors.map((error) => `${error.type}:${error.cellId} ${error.message}`).join('\n'),
          data: { errors: result.errors, warnings: result.warnings },
        }
      }

      const modifiedAt = await writeDiagramAndRefresh(filePath, existing.path, existing.baseDir, result.xml)
      return {
        success: true,
        data: {
          filePath,
          modifiedAt,
          warnings: result.warnings,
        },
        message: `Appended draw.io cells to: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to append draw.io cells: ${error}`,
      }
    }
  },
}

export const editDrawioDiagramTool: Tool = {
  name: 'edit_drawio_diagram',
  description: 'Edit an existing .drawio file using ID-based mxCell operations. Read the diagram first, then add/update/delete by cell id. Delete automatically removes descendants and connected edges. Prefer this over full update_diagram_file for small changes.',
  category: 'note',
  requiresConfirmation: true,
  capabilities: ['write'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative .drawio or .drawio.xml path.',
      required: true,
    },
    {
      name: 'operations',
      type: 'array',
      description: 'Array of operations: {operation:"add"|"update"|"delete", cell_id:"...", new_xml:"<mxCell ...>...</mxCell>"}. add/update require a complete mxCell with matching id.',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp from read_diagram_file. If the file changed since then, the edit is rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!isDrawioPath(filePath)) {
        return { success: false, error: `edit_drawio_diagram only supports draw.io files: ${filePath}` }
      }

      const operations = normalizeDrawioOperations(params.operations)
      if (!operations || operations.length === 0) {
        return { success: false, error: 'Missing required array parameter: operations' }
      }

      const existing = await readExistingDiagramForWrite(filePath, params.expectedModifiedAt)
      const result = applyDrawioCellOperations(existing.content, operations)
      if (result.errors.length > 0) {
        return {
          success: false,
          error: result.errors.map((error) => `${error.type}:${error.cellId} ${error.message}`).join('\n'),
          data: { errors: result.errors, warnings: result.warnings },
        }
      }

      const modifiedAt = await writeDiagramAndRefresh(filePath, existing.path, existing.baseDir, result.xml)
      return {
        success: true,
        data: {
          filePath,
          modifiedAt,
          operationCount: operations.length,
          warnings: result.warnings,
        },
        message: `Edited draw.io diagram: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to edit draw.io diagram: ${error}`,
      }
    }
  },
}

export const diagramTools: Tool[] = [
  listDiagramFilesTool,
  readDiagramFileTool,
  getDrawioShapeLibraryTool,
  createDiagramFileTool,
  createDrawioDiagramFromCellsTool,
  validateDrawioDiagramTool,
  exportDrawioDiagramTool,
  createDiagramFromOutlineTool,
  appendDrawioDiagramCellsTool,
  editDrawioDiagramTool,
  updateDiagramFileTool,
]
