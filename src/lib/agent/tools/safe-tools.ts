import { Tool, ToolResult } from '../types'
import { exists, mkdir, readDir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { getFilePathOptions, getWorkspacePath, normalizeWorkspaceRelativePath, ensureSafeWorkspaceRelativePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { searchWeb, tavilyExtract } from '@/lib/tavily'
import { processMarkdownFile } from '@/lib/rag'
import { getVectorDocumentKey } from '@/lib/vector-document-key'
import { collapseWhitespace, htmlToMarkdown, looksLikeHtml, normalizeWebContent } from '@/lib/web/content-extractor'

interface WorkspaceEntry {
  name: string
  path: string
  kind: 'file' | 'folder'
  size?: number
  modifiedAt?: string
}

const DEFAULT_TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.svg',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
])

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function assertNotAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function getExtension(path: string): string {
  const lastSegment = path.split('/').pop() || path
  const index = lastSegment.lastIndexOf('.')
  return index >= 0 ? lastSegment.slice(index).toLowerCase() : ''
}

function normalizeTextExtensions(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_TEXT_EXTENSIONS
  }

  return new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().toLowerCase())
    .map(item => item.startsWith('.') ? item : `.${item}`))
}

async function normalizeOptionalWorkspacePath(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path.trim() || path.trim() === '.') {
    return ''
  }

  return normalizeWorkspaceRelativePath(path)
}

async function getWorkspaceReadDirPath(relativePath: string) {
  return getFilePathOptions(relativePath)
}

async function readDirectory(relativePath: string) {
  const { path, baseDir } = await getWorkspaceReadDirPath(relativePath)
  return baseDir ? readDir(path, { baseDir }) : readDir(path)
}

async function statPath(relativePath: string) {
  const { path, baseDir } = await getFilePathOptions(relativePath)
  return baseDir ? stat(path, { baseDir }) : stat(path)
}

async function readWorkspaceTextFile(relativePath: string, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal)
  const safePath = await ensureSafeWorkspaceRelativePath(relativePath)
  const { path, baseDir } = await getFilePathOptions(safePath)
  const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
  assertNotAborted(signal)
  return content
}

async function collectEntries(
  folderPath: string,
  recursive: boolean,
  maxEntries: number,
  entries: WorkspaceEntry[] = [],
  signal?: AbortSignal
): Promise<WorkspaceEntry[]> {
  assertNotAborted(signal)
  if (entries.length >= maxEntries) {
    return entries
  }

  const dirEntries = await readDirectory(folderPath)

  for (const entry of dirEntries) {
    assertNotAborted(signal)
    if (entries.length >= maxEntries) {
      break
    }

    if (!entry.name) {
      continue
    }

    const relativePath = folderPath ? `${folderPath}/${entry.name}` : entry.name
    const kind: WorkspaceEntry['kind'] = entry.isDirectory ? 'folder' : 'file'
    let metadata: { size?: number; modifiedAt?: string } = {}

    try {
      const itemStat = await statPath(relativePath)
      metadata = {
        size: itemStat.size,
        modifiedAt: itemStat.mtime?.toISOString(),
      }
    } catch {
      metadata = {}
    }

    entries.push({
      name: entry.name,
      path: relativePath,
      kind,
      ...metadata,
    })

    if (recursive && entry.isDirectory) {
      await collectEntries(relativePath, recursive, maxEntries, entries, signal)
    }
  }

  return entries
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isBlockedUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return true
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  ) {
    return true
  }

  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4) {
    return false
  }

  const [a, b] = ipv4.slice(1, 3).map(Number)
  return a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
}

function sanitizeWebClipFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  const fallback = `web-clip-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const name = (cleaned || fallback).slice(0, 80)
  return `${name}.md`
}

function sanitizeWebClipTagToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildWebClipTags(url: URL): string[] {
  const tags = new Set<string>(['web-clip', 'source-web'])
  const normalizedHost = sanitizeWebClipTagToken(url.hostname.replace(/^www\./i, ''))
  if (normalizedHost) {
    tags.add(`source-${normalizedHost}`)
  }

  const firstPathSegment = url.pathname.split('/').find(segment => segment.trim().length > 0)
  if (firstPathSegment) {
    const normalizedPathTag = sanitizeWebClipTagToken(firstPathSegment)
    if (normalizedPathTag) {
      tags.add(`topic-${normalizedPathTag}`)
    }
  }

  return [...tags]
}

async function ensureWorkspaceFolder(folderPath: string) {
  const safeFolder = await ensureSafeWorkspaceRelativePath(folderPath)
  const { path, baseDir } = await getFilePathOptions(safeFolder)
  if (baseDir) {
    await mkdir(path, { baseDir, recursive: true })
  } else {
    await mkdir(path, { recursive: true })
  }
}

async function resolveUniqueWorkspaceFilePath(initialRelativePath: string): Promise<string> {
  const normalizedInitialPath = await ensureSafeWorkspaceRelativePath(initialRelativePath)
  const pathParts = normalizedInitialPath.split('/')
  const fileName = pathParts.pop() || normalizedInitialPath
  const folderPath = pathParts.join('/')
  const extIndex = fileName.lastIndexOf('.')
  const baseName = extIndex > 0 ? fileName.slice(0, extIndex) : fileName
  const extension = extIndex > 0 ? fileName.slice(extIndex) : ''

  let candidate = normalizedInitialPath
  for (let index = 1; index <= 99; index += 1) {
    const { path, baseDir } = await getFilePathOptions(candidate)
    const alreadyExists = baseDir ? await exists(path, { baseDir }) : await exists(path)
    if (!alreadyExists) {
      return candidate
    }

    const nextFileName = `${baseName}-${index + 1}${extension}`
    candidate = folderPath ? `${folderPath}/${nextFileName}` : nextFileName
  }

  throw new Error('无法生成唯一的沉淀文件名，请稍后重试')
}

function buildWebClipMarkdown(params: {
  title: string
  url: string
  tags: string[]
  snippet?: string
  body: string
}) {
  const snippet = params.snippet?.trim()
  const tagsLine = params.tags.length > 0
    ? params.tags.map(tag => `#${tag}`).join(' ')
    : '#web-clip'
  const lines = [
    `# ${params.title}`,
    '',
    `- Source URL: ${params.url}`,
    `- Saved At: ${new Date().toISOString()}`,
    `- Tags: ${tagsLine}`,
    '',
  ]

  if (snippet) {
    lines.push('## 摘要', '', snippet, '')
  }

  lines.push('## 正文', '', params.body || '未抓取到正文内容。', '')
  return lines.join('\n')
}

async function fetchWebClipBody(url: URL, maxChars: number, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal)
  const response = await tauriFetch(url.toString(), {
    method: 'GET',
    signal,
    headers: {
      Accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1',
    },
  })
  assertNotAborted(signal)
  const text = await response.text()
  return normalizeWebContent(text).slice(0, maxChars)
}

export const safeListFilesTool: Tool = {
  name: 'safe_list_files',
  description: 'Safely list files and folders inside the current note workspace. Cannot access paths outside the workspace.',
  category: 'filesystem',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Workspace-relative folder path. Leave empty for workspace root.',
      required: false,
    },
    {
      name: 'recursive',
      type: 'boolean',
      description: 'Whether to recursively list child folders. Default false.',
      required: false,
      default: false,
    },
    {
      name: 'maxEntries',
      type: 'number',
      description: 'Maximum entries to return. Default 100, max 500.',
      required: false,
      default: 100,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const folderPath = await normalizeOptionalWorkspacePath(params.folderPath)
      const recursive = params.recursive === true
      const maxEntries = clampNumber(params.maxEntries, 100, 1, 500)
      const entries = await collectEntries(folderPath, recursive, maxEntries, [], context?.abortSignal)

      return {
        success: true,
        data: {
          folderPath,
          recursive,
          entries,
          truncated: entries.length >= maxEntries,
        },
        message: `Listed ${entries.length} workspace entries${entries.length >= maxEntries ? ' (truncated)' : ''}.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list workspace files: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const safeReadFileTool: Tool = {
  name: 'safe_read_file',
  description: 'Safely read a UTF-8 text file inside the current note workspace. Cannot read outside the workspace.',
  category: 'filesystem',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative file path to read.',
      required: true,
    },
    {
      name: 'maxChars',
      type: 'number',
      description: 'Maximum characters to return. Default 20000, max 100000.',
      required: false,
      default: 20000,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const maxChars = clampNumber(params.maxChars, 20000, 1, 100000)
      const content = await readWorkspaceTextFile(filePath, context?.abortSignal)

      return {
        success: true,
        data: {
          filePath,
          content: content.slice(0, maxChars),
          truncated: content.length > maxChars,
          totalChars: content.length,
        },
        message: `Read ${Math.min(content.length, maxChars)} characters from ${filePath}${content.length > maxChars ? ' (truncated)' : ''}.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to read workspace file: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const safeWriteFileTool: Tool = {
  name: 'safe_write_file',
  description: 'Safely write a UTF-8 text file inside the current note workspace. Requires confirmation and cannot write outside the workspace.',
  category: 'filesystem',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Workspace-relative file path to write.',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Text content to write.',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Write mode: create, overwrite, or append. Default create.',
      required: false,
      default: 'create',
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const filePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const content = typeof params.content === 'string' ? params.content : ''
      const mode = params.mode === 'overwrite' || params.mode === 'append' ? params.mode : 'create'
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { path, baseDir } = await getFilePathOptions(filePath)
      const fileExists = baseDir ? await exists(path, { baseDir }) : await exists(path)

      if (mode === 'create' && fileExists) {
        return {
          success: false,
          error: `File already exists: ${filePath}. Use mode="overwrite" or a note-specific update tool if replacement is intended.`,
        }
      }

      const nextContent = mode === 'append' && fileExists
        ? `${await readWorkspaceTextFile(filePath, context?.abortSignal)}${content}`
        : content
      assertNotAborted(context?.abortSignal)

      if (baseDir) {
        await writeTextFile(path, nextContent, { baseDir })
      } else {
        await writeTextFile(path, nextContent)
      }
      assertNotAborted(context?.abortSignal)

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(filePath, false)
      await articleStore.ensurePathExpanded(filePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: {
          filePath,
          mode,
          charsWritten: nextContent.length,
        },
        message: `Wrote ${nextContent.length} characters to ${filePath}.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to write workspace file: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const safeGrepTool: Tool = {
  name: 'safe_grep',
  description: 'Safely search text files inside the current note workspace without shell access. Supports literal or regex search.',
  category: 'search',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search text or regex pattern.',
      required: true,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Workspace-relative folder path. Leave empty for workspace root.',
      required: false,
    },
    {
      name: 'regex',
      type: 'boolean',
      description: 'Treat query as regex. Default false.',
      required: false,
      default: false,
    },
    {
      name: 'caseSensitive',
      type: 'boolean',
      description: 'Case-sensitive search. Default false.',
      required: false,
      default: false,
    },
    {
      name: 'includeExtensions',
      type: 'array',
      description: 'Optional list of text extensions to include, e.g. [".md", ".ts"].',
      required: false,
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum matches to return. Default 50, max 200.',
      required: false,
      default: 50,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const query = typeof params.query === 'string' ? params.query : ''
      if (!query.trim()) {
        return {
          success: false,
          error: 'query is required',
        }
      }

      const folderPath = await normalizeOptionalWorkspacePath(params.folderPath)
      const maxResults = clampNumber(params.maxResults, 50, 1, 200)
      const includeExtensions = normalizeTextExtensions(params.includeExtensions)
      const flags = params.caseSensitive === true ? 'g' : 'gi'
      const pattern = new RegExp(params.regex === true ? query : escapeRegExp(query), flags)
      const entries = await collectEntries(folderPath, true, 2000, [], context?.abortSignal)
      const matches: Array<{ filePath: string; line: number; preview: string }> = []

      for (const entry of entries) {
        assertNotAborted(context?.abortSignal)
        if (matches.length >= maxResults) {
          break
        }

        if (entry.kind !== 'file' || !includeExtensions.has(getExtension(entry.path))) {
          continue
        }

        let content = ''
        try {
          content = await readWorkspaceTextFile(entry.path, context?.abortSignal)
        } catch {
          continue
        }

        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length; index++) {
          assertNotAborted(context?.abortSignal)
          if (matches.length >= maxResults) {
            break
          }

          pattern.lastIndex = 0
          if (pattern.test(lines[index])) {
            matches.push({
              filePath: entry.path,
              line: index + 1,
              preview: lines[index].trim().slice(0, 240),
            })
          }
        }
      }

      return {
        success: true,
        data: {
          query,
          folderPath,
          matches,
          truncated: matches.length >= maxResults,
        },
        message: `Found ${matches.length} matches${matches.length >= maxResults ? ' (truncated)' : ''}.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search workspace files: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch a public HTTP/HTTPS URL and return a truncated text response. Blocks localhost and private-network targets.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'Public http(s) URL to fetch.',
      required: true,
    },
    {
      name: 'maxChars',
      type: 'number',
      description: 'Maximum response characters. Default 20000, max 100000.',
      required: false,
      default: 20000,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const url = new URL(String(params.url || ''))
      if (isBlockedUrl(url)) {
        return {
          success: false,
          error: 'Blocked URL. Only public http(s) targets are allowed.',
        }
      }

      const maxChars = clampNumber(params.maxChars, 20000, 1, 100000)
      const response = await tauriFetch(url.toString(), {
        method: 'GET',
        signal: context?.abortSignal,
        headers: {
          Accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1',
        },
      })
      assertNotAborted(context?.abortSignal)
      const rawText = await response.text()

      // 检测是否为 HTML 内容，如果是则清洗为 Markdown
      const contentType = response.headers.get('content-type') || ''
      const isHtml = contentType.includes('text/html') || looksLikeHtml(rawText)
      const content = isHtml ? htmlToMarkdown(rawText) : rawText

      return {
        success: response.ok,
        data: {
          url: url.toString(),
          status: response.status,
          content: content.slice(0, maxChars),
          truncated: content.length > maxChars,
          isHtml,
        },
        message: response.ok
          ? `Fetched ${url.toString()} (${response.status}).`
          : `Fetch failed for ${url.toString()} (${response.status}).`,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the public web through Tavily Search API. Use for current external information when web access is enabled or needed.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query.',
      required: true,
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum results to return. Default 5, max 10.',
      required: false,
      default: 5,
    },
    {
      name: 'searchDepth',
      type: 'string',
      description: 'Tavily search depth: basic or advanced. Default follows app settings.',
      required: false,
      default: 'basic',
    },
    {
      name: 'includeAnswer',
      type: 'boolean',
      description: 'Whether Tavily should include a synthesized answer. Default true.',
      required: false,
      default: true,
    },
    {
      name: 'includeDomains',
      type: 'array',
      description: 'Optional list of domains to include, e.g. ["openai.com"].',
      required: false,
    },
    {
      name: 'excludeDomains',
      type: 'array',
      description: 'Optional list of domains to exclude.',
      required: false,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const query = typeof params.query === 'string' ? params.query.trim() : ''
      if (!query) {
        return {
          success: false,
          error: 'query is required',
        }
      }

      const maxResults = clampNumber(params.maxResults, 5, 1, 10)
      const response = await searchWeb({
        query,
        maxResults,
        searchDepth: params.searchDepth === 'advanced' ? 'advanced' : 'basic',
        includeAnswer: params.includeAnswer !== false,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        signal: context?.abortSignal,
      })
      assertNotAborted(context?.abortSignal)

      return {
        success: true,
        data: {
          query: response.query,
          answer: response.answer,
          provider: response.provider,
          degraded: response.degraded === true,
          fallbackReason: response.fallbackReason,
          results: response.results.map(result => ({
            title: result.title,
            url: result.url,
            snippet: result.content,
            score: result.score,
            publishedDate: result.publishedDate,
          })),
          responseTime: response.responseTime,
        },
        message: `Found ${response.results.length} web results for "${query}" via ${response.provider}${response.degraded ? ' (fallback)' : ''}.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search the web: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const webExtractTool: Tool = {
  name: 'web_extract',
  description: 'Extract clean Markdown or text from public HTTP/HTTPS URLs through Tavily Extract. Prefer this over raw web_fetch for article pages, documentation pages, dynamic pages, and pages that need cleaner readable content.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'urls',
      type: 'array',
      description: 'One or more public http(s) URLs to extract.',
      required: true,
    },
    {
      name: 'extractDepth',
      type: 'string',
      description: 'Extraction depth: basic or advanced. Advanced is slower but can handle harder pages.',
      required: false,
      default: 'basic',
    },
    {
      name: 'format',
      type: 'string',
      description: 'Output format: markdown or text. Default markdown.',
      required: false,
      default: 'markdown',
    },
    {
      name: 'maxChars',
      type: 'number',
      description: 'Maximum characters returned per extracted page. Default 20000, max 100000.',
      required: false,
      default: 20000,
    },
    {
      name: 'query',
      type: 'string',
      description: 'Optional focused extraction query. Use only when the user asks for a specific topic within the page.',
      required: false,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const rawUrls = Array.isArray(params.urls)
        ? params.urls
        : typeof params.urls === 'string'
          ? [params.urls]
          : []
      const urls = rawUrls
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
        .map(url => url.trim())

      if (urls.length === 0) {
        return {
          success: false,
          error: 'urls is required',
        }
      }

      for (const rawUrl of urls) {
        assertNotAborted(context?.abortSignal)
        const url = new URL(rawUrl)
        if (isBlockedUrl(url)) {
          return {
            success: false,
            error: 'Blocked URL. Only public http(s) targets are allowed.',
          }
        }
      }

      const maxChars = clampNumber(params.maxChars, 20000, 1, 100000)
      const response = await tavilyExtract({
        urls,
        extractDepth: params.extractDepth === 'advanced' ? 'advanced' : 'basic',
        format: params.format === 'text' ? 'text' : 'markdown',
        query: typeof params.query === 'string' ? params.query : undefined,
        signal: context?.abortSignal,
      })
      assertNotAborted(context?.abortSignal)

      return {
        success: response.results.length > 0,
        data: {
          results: response.results.map(result => ({
            ...result,
            rawContent: result.rawContent.slice(0, maxChars),
            truncated: result.rawContent.length > maxChars,
          })),
          failedResults: response.failedResults,
          responseTime: response.responseTime,
          requestId: response.requestId,
        },
        message: `Extracted ${response.results.length} URL(s)${response.failedResults.length ? `, failed ${response.failedResults.length}` : ''}.`,
        error: response.results.length > 0 ? undefined : 'No extractable content returned.',
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to extract URL content: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const clipWebContentTool: Tool = {
  name: 'clip_web_content',
  description: 'Save web search/fetch content into a Markdown note and update vector index automatically for future RAG reuse.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write', 'network'],
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'Public http(s) URL to clip.',
      required: true,
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional note title. Defaults to page hostname or URL.',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Optional pre-extracted content/snippet. If empty, tool fetches URL body.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional destination folder in workspace. Default "web-clips".',
      required: false,
    },
    {
      name: 'maxChars',
      type: 'number',
      description: 'Maximum chars kept from fetched body. Default 20000, max 100000.',
      required: false,
      default: 20000,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      assertNotAborted(context?.abortSignal)
      const rawUrl = typeof params.url === 'string' ? params.url.trim() : ''
      if (!rawUrl) {
        return {
          success: false,
          error: 'url is required',
        }
      }

      const url = new URL(rawUrl)
      if (isBlockedUrl(url)) {
        return {
          success: false,
          error: 'Blocked URL. Only public http(s) targets are allowed.',
        }
      }

      const maxChars = clampNumber(params.maxChars, 20000, 500, 100000)
      const folderPathInput = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
      const folderPath = folderPathInput ? await ensureSafeWorkspaceRelativePath(folderPathInput) : 'web-clips'
      await ensureWorkspaceFolder(folderPath)

      const title = collapseWhitespace(
        typeof params.title === 'string' && params.title.trim()
          ? params.title
          : url.hostname.replace(/^www\./, '')
      )
      const fileName = sanitizeWebClipFileName(title)
      const uniqueRelativePath = await resolveUniqueWorkspaceFilePath(`${folderPath}/${fileName}`)

      const paramContent = typeof params.content === 'string' ? params.content : ''
      const snippet = normalizeWebContent(paramContent).slice(0, 3000)
      const body = snippet || await fetchWebClipBody(url, maxChars, context?.abortSignal)
      const tags = buildWebClipTags(url)
      assertNotAborted(context?.abortSignal)

      const markdown = buildWebClipMarkdown({
        title,
        url: url.toString(),
        tags,
        snippet,
        body,
      })

      const { path, baseDir } = await getFilePathOptions(uniqueRelativePath)
      if (baseDir) {
        await writeTextFile(path, markdown, { baseDir })
      } else {
        await writeTextFile(path, markdown)
      }
      assertNotAborted(context?.abortSignal)

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(uniqueRelativePath, false)
      await articleStore.ensurePathExpanded(uniqueRelativePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      const indexed = await processMarkdownFile(uniqueRelativePath, markdown)
      if (indexed) {
        const latestState = useArticleStore.getState()
        const nextMap = new Map(latestState.vectorIndexedFiles)
        nextMap.set(getVectorDocumentKey(uniqueRelativePath), Date.now())
        useArticleStore.setState({ vectorIndexedFiles: nextMap })
      }

      const workspace = await getWorkspacePath()
      const fullPath = workspace.isCustom
        ? `${workspace.path}/${uniqueRelativePath}`
        : `${await appDataDir()}/article/${uniqueRelativePath}`

      return {
        success: true,
        data: {
          url: url.toString(),
          filePath: uniqueRelativePath,
          fullPath,
          indexed,
          tags,
        },
        message: indexed
          ? `Saved web clip to ${uniqueRelativePath} and updated vector index.`
          : `Saved web clip to ${uniqueRelativePath}, but vector indexing failed.`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to clip web content: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const safeTools: Tool[] = [
  safeListFilesTool,
  safeReadFileTool,
  safeWriteFileTool,
  safeGrepTool,
  webFetchTool,
  webSearchTool,
  webExtractTool,
  clipWebContentTool,
]
