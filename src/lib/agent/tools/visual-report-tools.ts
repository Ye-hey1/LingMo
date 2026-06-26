import { BaseDirectory, mkdir, readDir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

import { Tool, ToolResult } from '../types'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { recordFileActivity } from '@/lib/file-activity'
import { buildVisualReportHtml, ensureVisualReportFileName, type VisualReportType } from '@/lib/visual-report'
import { getArtifactTemplate, summarizeArtifactInput, type ArtifactInputFormat, type ArtifactTemplateId } from '@/lib/artifacts'
import { createUniqueArtifactPath, getArtifactFolderPath } from '@/lib/artifacts/destination'
import { VISUAL_REPORTS_ROOT, isVisualReportPath } from '@/lib/visual-report-constants'

interface VisualReportEntry {
  name: string
  path: string
  modifiedAt?: string
}

function formatGeneratedAt(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeInlineMarkdownText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildVisualReportReferenceBlock(options: {
  title: string
  templateName: string
  reportName: string
  filePath: string
  generatedAt: Date
}) {
  return [
    '',
    '---',
    '> **相关可视化报告**',
    `> - 标题：${normalizeInlineMarkdownText(options.title)}`,
    `> - 模板：${normalizeInlineMarkdownText(options.templateName)}`,
    `> - 文件：[[${options.reportName}]]`,
    `> - 路径：\`${options.filePath.replace(/`/g, '')}\``,
    `> - 生成时间：${formatGeneratedAt(options.generatedAt)}`,
    '',
  ].join('\n')
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeReportType(value: unknown): VisualReportType {
  return value === 'note' ||
    value === 'project' ||
    value === 'diff' ||
    value === 'research' ||
    value === 'plan'
    ? value
    : 'general'
}

function normalizeTemplateId(value: unknown): ArtifactTemplateId {
  return getArtifactTemplate(value).id
}

function normalizeSourceFormat(value: unknown, content: string | undefined): ArtifactInputFormat | undefined {
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().toLowerCase()
    if (
      normalized === 'markdown' ||
      normalized === 'html' ||
      normalized === 'json' ||
      normalized === 'csv' ||
      normalized === 'tsv' ||
      normalized === 'sql' ||
      normalized === 'yaml' ||
      normalized === 'text'
    ) {
      return normalized
    }
  }

  return content ? summarizeArtifactInput(content).format : undefined
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

async function getAbsoluteWorkspacePath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  if (workspace.isCustom) {
    return await join(workspace.path, relativePath)
  }

  return `${await appDataDir()}/article/${relativePath}`
}

async function refreshArticleTreeForReport(filePath: string, shouldOpen: boolean): Promise<void> {
  const articleStore = useArticleStore.getState()
  const inserted = articleStore.insertLocalEntry(filePath, false)
  await articleStore.ensurePathExpanded(filePath)
  if (!inserted) {
    await articleStore.loadFileTree({ skipRemoteSync: true })
  }

  if (shouldOpen) {
    await articleStore.setActiveFilePath(filePath)
    await articleStore.readArticle(filePath, '', false)
  }
}

async function collectVisualReportFiles(): Promise<VisualReportEntry[]> {
  const workspace = await getWorkspacePath()
  const rootPath = workspace.isCustom
    ? await join(workspace.path, VISUAL_REPORTS_ROOT)
    : `article/${VISUAL_REPORTS_ROOT}`
  const files: VisualReportEntry[] = []

  async function walk(dirPath: string, relativeDir = ''): Promise<void> {
    const entries = workspace.isCustom
      ? await readDir(dirPath)
      : await readDir(dirPath, { baseDir: BaseDirectory.AppData })

    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) {
        continue
      }

      const workspaceRelativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : `${VISUAL_REPORTS_ROOT}/${entry.name}`

      if (entry.isDirectory) {
        const childPath = workspace.isCustom
          ? await join(dirPath, entry.name)
          : `article/${workspaceRelativePath}`
        await walk(childPath, workspaceRelativePath)
        continue
      }

      if (!/\.html?$/i.test(workspaceRelativePath) || !isVisualReportPath(workspaceRelativePath)) {
        continue
      }

      let modifiedAt: string | undefined
      try {
        const { path, baseDir } = await getFilePathOptions(workspaceRelativePath)
        const metadata = baseDir ? await stat(path, { baseDir }) : await stat(path)
        modifiedAt = metadata.mtime?.toISOString()
      } catch {
        modifiedAt = undefined
      }

      files.push({
        name: entry.name,
        path: workspaceRelativePath,
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

export const listVisualReportFilesTool: Tool = {
  name: 'list_visual_report_files',
  description: 'List HTML visual report files in the workspace.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const files = await collectVisualReportFiles()
      return {
        success: true,
        data: files,
        message: `Found ${files.length} visual report file(s).`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list visual reports: ${error}`,
      }
    }
  },
}

export const readVisualReportFileTool: Tool = {
  name: 'read_visual_report_file',
  description: 'Read an existing HTML visual report as raw text.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative HTML visual report path.',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      if (!/\.html?$/i.test(filePath)) {
        return {
          success: false,
          error: `Unsupported visual report extension: ${filePath}`,
        }
      }

      const { path, baseDir } = await getFilePathOptions(filePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)

      return {
        success: true,
        data: { filePath, content },
        message: `Read visual report: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to read visual report: ${error}`,
      }
    }
  },
}

export const createVisualReportTool: Tool = {
  name: 'create_visual_report',
  description: 'Create a self-contained HTML visual explainer/report from notes, plans, diffs, research material, or project context. Use this for rich visual explanations rather than simple Markdown summaries.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    {
      name: 'title',
      type: 'string',
      description: 'Report title.',
      required: true,
    },
    {
      name: 'subtitle',
      type: 'string',
      description: 'Optional short subtitle or framing sentence.',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Source material or report body. Markdown headings and bullet lists are converted into visual sections.',
      required: false,
    },
    {
      name: 'sections',
      type: 'array',
      description: 'Optional structured sections: [{ title, body, bullets, importance }]. importance can be low, medium, or high.',
      required: false,
    },
    {
      name: 'reportType',
      type: 'string',
      description: 'Report type: general, note, project, diff, research, or plan. Defaults to general.',
      required: false,
      default: 'general',
    },
    {
      name: 'templateId',
      type: 'string',
      description: 'Artifact template: article-report, data-report, deck-brief, or poster-card. Defaults to article-report.',
      required: false,
      default: 'article-report',
    },
    {
      name: 'sourceFormat',
      type: 'string',
      description: 'Input format: markdown, html, json, csv, tsv, sql, yaml, or text. Auto-detected from content when omitted.',
      required: false,
    },
    {
      name: 'fileName',
      type: 'string',
      description: 'Optional filename. .html is added automatically when omitted.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional workspace-relative destination folder. Defaults to visual-reports.',
      required: false,
    },
    {
      name: 'sourceLabel',
      type: 'string',
      description: 'Optional source note, project, or task label displayed in the report.',
      required: false,
    },
    {
      name: 'openAfterCreate',
      type: 'boolean',
      description: 'Whether to open the visual report after creating it. Defaults to true.',
      required: false,
      default: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const title = normalizeOptionalText(params.title)
      if (!title) {
        return {
          success: false,
          error: 'Missing required string parameter: title',
        }
      }

      const folderPath = await getArtifactFolderPath('visual_report', params.folderPath)
      const fileName = ensureVisualReportFileName(normalizeOptionalText(params.fileName), title)
      const filePath = await createUniqueArtifactPath({ folderPath, fileName })
      const content = normalizeOptionalText(params.content)
      const templateId = normalizeTemplateId(params.templateId)
      const templateName = getArtifactTemplate(templateId).name
      const sourceFormat = normalizeSourceFormat(params.sourceFormat, content)
      const generatedAt = new Date()
      const html = buildVisualReportHtml({
        title,
        subtitle: normalizeOptionalText(params.subtitle),
        content,
        sections: params.sections,
        reportType: normalizeReportType(params.reportType),
        templateId,
        sourceFormat,
        sourceLabel: normalizeOptionalText(params.sourceLabel),
        generatedAt,
      })

      await ensureParentFolder(filePath)
      const { path, baseDir } = await getFilePathOptions(filePath)
      if (baseDir) {
        await writeTextFile(path, html, { baseDir })
      } else {
        await writeTextFile(path, html)
      }

      const articleStore = useArticleStore.getState()
      const sourceNotePath = articleStore.activeFilePath
      const shouldOpen = params.openAfterCreate !== false
      await refreshArticleTreeForReport(filePath, shouldOpen)

      try {
        if (sourceNotePath && sourceNotePath.endsWith('.md') && sourceNotePath !== filePath) {
          const sourceOpts = await getFilePathOptions(sourceNotePath)
          const sourceContent = sourceOpts.baseDir
            ? await readTextFile(sourceOpts.path, { baseDir: sourceOpts.baseDir })
            : await readTextFile(sourceOpts.path)
          const reportName = filePath.split('/').pop()?.replace(/\.html?$/i, '') || filePath
          const referenceBlock = buildVisualReportReferenceBlock({
            title,
            templateName,
            reportName,
            filePath,
            generatedAt,
          })

          if (!sourceContent.includes(`[[${reportName}]]`) && !sourceContent.includes(`> - 路径：\`${filePath}\``)) {
            const updatedContent = sourceContent.trimEnd() + referenceBlock
            if (sourceOpts.baseDir) {
              await writeTextFile(sourceOpts.path, updatedContent, { baseDir: sourceOpts.baseDir })
            } else {
              await writeTextFile(sourceOpts.path, updatedContent)
            }
            const { useNoteIndexStore } = await import('@/stores/note-index')
            useNoteIndexStore.getState().updateFileIndex(sourceNotePath, updatedContent)
          }
        }
      } catch {
        // Linking back to the source note is helpful, but report creation should still succeed.
      }

      void recordFileActivity({
        path: filePath,
        type: 'export',
        title: '创建可视化报告',
        description: `${title} · ${templateId}`,
      })

      return {
        success: true,
        data: {
          filePath,
          fullPath: await getAbsoluteWorkspacePath(filePath),
          reportType: normalizeReportType(params.reportType),
          templateId,
          sourceFormat,
          output_files: [filePath],
        },
        message: `Created visual report: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create visual report: ${error}`,
      }
    }
  },
}

export const visualReportTools: Tool[] = [
  listVisualReportFilesTool,
  readVisualReportFileTool,
  createVisualReportTool,
]
