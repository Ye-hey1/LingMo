import type { Tool, ToolResult } from '../types'
import { clampNumber } from '@/lib/clamp'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, normalizeWorkspaceRelativePath } from '@/lib/workspace'

interface WorkspaceEntry {
  name: string
  path: string
  kind: 'file' | 'folder'
}

interface CodeSymbol {
  name: string
  kind: string
  filePath: string
  line: number
  column: number
  preview: string
}

const DEFAULT_CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.cs',
  '.php',
  '.rb',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.mdx',
])

const DEFAULT_MAX_FILES = 2000
const DEFAULT_MAX_RESULTS = 80
const MAX_RESULTS = 300
const MAX_CONTEXT_LINES = 80

const SYMBOL_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'function', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
  { kind: 'function', pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
  { kind: 'class', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'interface', pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'type', pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'component', pattern: /^\s*(?:export\s+)?(?:const|function)\s+([A-Z][A-Za-z0-9_$]*)\b/ },
  { kind: 'python_function', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/ },
  { kind: 'python_class', pattern: /^\s*class\s+([A-Za-z_]\w*)\b/ },
  { kind: 'rust_function', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/ },
  { kind: 'rust_type', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)\b/ },
  { kind: 'go_function', pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/ },
  { kind: 'go_type', pattern: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/ },
  { kind: 'jvm_type', pattern: /^\s*(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+)*?(?:class|interface|enum)\s+([A-Za-z_]\w*)\b/ },
  { kind: 'markdown_heading', pattern: /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/ },
]


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
    return DEFAULT_CODE_EXTENSIONS
  }

  return new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().toLowerCase())
    .map(item => item.startsWith('.') ? item : `.${item}`))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function symbolReferencePattern(symbolName: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(symbolName)}([^A-Za-z0-9_$]|$)`)
}

function isMissingDirectoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /系统找不到指定的路径|os error 3|not found|no such file or directory|cannot find the path/i.test(message)
}

async function normalizeOptionalWorkspacePath(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path.trim() || path.trim() === '.') {
    return ''
  }

  return normalizeWorkspaceRelativePath(path)
}

async function readDirectory(relativePath: string) {
  const { path, baseDir } = await getFilePathOptions(relativePath)
  return baseDir ? readDir(path, { baseDir }) : readDir(path)
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

  let dirEntries: Awaited<ReturnType<typeof readDirectory>>
  try {
    dirEntries = await readDirectory(folderPath)
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return entries
    }
    throw error
  }

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
    entries.push({ name: entry.name, path: relativePath, kind })

    if (recursive && entry.isDirectory) {
      await collectEntries(relativePath, recursive, maxEntries, entries, signal)
    }
  }

  return entries
}

function extractSymbols(filePath: string, content: string, maxSymbols = MAX_RESULTS): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    if (symbols.length >= maxSymbols) {
      break
    }

    const line = lines[index]
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = pattern.exec(line)
      if (!match?.[1]) {
        continue
      }

      const rawName = match[1].trim()
      const name = kind === 'markdown_heading'
        ? rawName.replace(/\s+/g, ' ').slice(0, 160)
        : rawName
      symbols.push({
        name,
        kind,
        filePath,
        line: index + 1,
        column: Math.max(1, line.indexOf(rawName) + 1),
        preview: line.trim().slice(0, 240),
      })
      break
    }
  }

  return symbols
}

function formatLocationList(title: string, locations: Array<{ filePath: string; line: number; column?: number; preview: string }>) {
  if (locations.length === 0) {
    return `${title}: no matches found.`
  }

  return [
    `${title}: ${locations.length} match(es).`,
    ...locations.slice(0, 20).map((item, index) => {
      const column = item.column ? `:${item.column}` : ''
      return `${index + 1}. ${item.filePath}:${item.line}${column} - ${item.preview}`
    }),
  ].join('\n')
}

async function getCandidateFiles(params: {
  folderPath: string
  includeExtensions: Set<string>
  maxFiles: number
  signal?: AbortSignal
}) {
  const entries = await collectEntries(params.folderPath, true, params.maxFiles, [], params.signal)
  return entries.filter(entry =>
    entry.kind === 'file' &&
    params.includeExtensions.has(getExtension(entry.path))
  )
}

export const codeNavigationTools: Tool[] = [
  {
    name: 'code_search_symbols',
    description: `Find code symbols (functions, classes, types, constants) by name across the workspace. Symbol-aware, so it beats plain text search for code.

When to use:
- Locating where a function/class/type lives when you only know its name.
- The entry point for any "how does X work in this code" question.

Do NOT use this tool to:
- Search prose or Markdown notes — use safe_grep.
- Find every call site of a symbol — use code_find_references.
- Read a specific region of code — use code_read_context.

Typical workflow: code_search_symbols → code_file_outline (see file structure) → code_read_context (read the region).`,
    category: 'filesystem',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Symbol name or heading text to search for.',
        required: true,
      },
      {
        name: 'folderPath',
        type: 'string',
        description: 'Workspace-relative folder to search. Leave empty for workspace root.',
        required: false,
      },
      {
        name: 'includeExtensions',
        type: 'array',
        description: 'Optional file extensions to scan, such as ["ts", "tsx", "py"].',
        required: false,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum symbols to return. Default 80, max 300.',
        required: false,
        default: DEFAULT_MAX_RESULTS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const query = typeof params.query === 'string' ? params.query.trim() : ''
        if (!query) {
          return { success: false, error: 'query is required' }
        }

        const folderPath = await normalizeOptionalWorkspacePath(params.folderPath)
        const includeExtensions = normalizeTextExtensions(params.includeExtensions)
        const maxResults = clampNumber(params.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS)
        const files = await getCandidateFiles({
          folderPath,
          includeExtensions,
          maxFiles: DEFAULT_MAX_FILES,
          signal: context?.abortSignal,
        })
        const queryLower = query.toLowerCase()
        const matches: CodeSymbol[] = []

        for (const file of files) {
          assertNotAborted(context?.abortSignal)
          if (matches.length >= maxResults) break

          let content = ''
          try {
            content = await readWorkspaceTextFile(file.path, context?.abortSignal)
          } catch {
            continue
          }

          const symbols = extractSymbols(file.path, content, maxResults)
          for (const symbol of symbols) {
            if (matches.length >= maxResults) break
            if (symbol.name.toLowerCase().includes(queryLower)) {
              matches.push(symbol)
            }
          }
        }

        return {
          success: true,
          data: {
            query,
            folderPath,
            scannedFileCount: files.length,
            matchedCount: matches.length,
            results: matches,
          },
          message: formatLocationList(`Workspace symbol search for "${query}"`, matches),
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to search code symbols: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'code_file_outline',
    description: `Return the symbol outline (functions, classes, types with their line numbers) of one code file.

When to use:
- Understanding a file's structure before reading it, especially a large file.
- Finding the line range of a symbol so you can read just that part.

Do NOT use this tool to:
- Read actual code bodies — this returns signatures and line numbers only. Use code_read_context.
- Outline a Markdown note — this is for code files.

MUST: prefer this over reading a whole large file. Outline first, then read only the region you need.`,
    category: 'filesystem',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Workspace-relative file path to outline.',
        required: true,
      },
      {
        name: 'maxSymbols',
        type: 'number',
        description: 'Maximum symbols to return. Default 120, max 300.',
        required: false,
        default: 120,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const filePath = await ensureSafeWorkspaceRelativePath(String(params.filePath || ''))
        const maxSymbols = clampNumber(params.maxSymbols, 120, 1, MAX_RESULTS)
        const content = await readWorkspaceTextFile(filePath, context?.abortSignal)
        const symbols = extractSymbols(filePath, content, maxSymbols)

        return {
          success: true,
          data: {
            filePath,
            symbolCount: symbols.length,
            symbols,
          },
          message: formatLocationList(`File outline for ${filePath}`, symbols),
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to outline code file: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'code_find_definition',
    description: `Find where a symbol is DEFINED (its declaration site).

When to use:
- You have a symbol name and need its implementation, not its usages.
- Tracing a call chain downward into the code that implements it.

Do NOT use this tool to:
- Find who CALLS the symbol — use code_find_references, which is the opposite direction.
- Search by partial or fuzzy name — use code_search_symbols.

Note: results are heuristic ("likely" definitions). Verify with code_read_context before relying on a match.`,
    category: 'filesystem',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'symbolName',
        type: 'string',
        description: 'Symbol name to locate.',
        required: true,
      },
      {
        name: 'folderPath',
        type: 'string',
        description: 'Workspace-relative folder to search. Leave empty for workspace root.',
        required: false,
      },
      {
        name: 'includeExtensions',
        type: 'array',
        description: 'Optional file extensions to scan, such as ["ts", "tsx", "py"].',
        required: false,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum definitions to return. Default 40, max 120.',
        required: false,
        default: 40,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const symbolName = typeof params.symbolName === 'string' ? params.symbolName.trim() : ''
        if (!symbolName) {
          return { success: false, error: 'symbolName is required' }
        }

        const folderPath = await normalizeOptionalWorkspacePath(params.folderPath)
        const includeExtensions = normalizeTextExtensions(params.includeExtensions)
        const maxResults = clampNumber(params.maxResults, 40, 1, 120)
        const files = await getCandidateFiles({
          folderPath,
          includeExtensions,
          maxFiles: DEFAULT_MAX_FILES,
          signal: context?.abortSignal,
        })
        const matches: CodeSymbol[] = []

        for (const file of files) {
          assertNotAborted(context?.abortSignal)
          if (matches.length >= maxResults) break

          let content = ''
          try {
            content = await readWorkspaceTextFile(file.path, context?.abortSignal)
          } catch {
            continue
          }

          for (const symbol of extractSymbols(file.path, content, maxResults)) {
            if (matches.length >= maxResults) break
            if (symbol.name === symbolName) {
              matches.push(symbol)
            }
          }
        }

        return {
          success: true,
          data: {
            symbolName,
            folderPath,
            scannedFileCount: files.length,
            matchedCount: matches.length,
            results: matches,
          },
          message: formatLocationList(`Definition search for "${symbolName}"`, matches),
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to find code definition: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'code_find_references',
    description: `Find every place a symbol is USED (its call sites and imports).

When to use:
- Assessing the blast radius of a change before you make it.
- Understanding how an API is consumed across the codebase.

Do NOT use this tool to:
- Find where the symbol is declared — use code_find_definition, which is the opposite direction.

MUST: run this before changing any shared function or type signature, so you know what else is affected.

Note: results are heuristic ("likely" references) and may include same-named symbols from unrelated scopes. Verify before acting.`,
    category: 'filesystem',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'symbolName',
        type: 'string',
        description: 'Symbol name to search references for.',
        required: true,
      },
      {
        name: 'folderPath',
        type: 'string',
        description: 'Workspace-relative folder to search. Leave empty for workspace root.',
        required: false,
      },
      {
        name: 'includeExtensions',
        type: 'array',
        description: 'Optional file extensions to scan, such as ["ts", "tsx", "py"].',
        required: false,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum references to return. Default 80, max 300.',
        required: false,
        default: DEFAULT_MAX_RESULTS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const symbolName = typeof params.symbolName === 'string' ? params.symbolName.trim() : ''
        if (!symbolName) {
          return { success: false, error: 'symbolName is required' }
        }

        const folderPath = await normalizeOptionalWorkspacePath(params.folderPath)
        const includeExtensions = normalizeTextExtensions(params.includeExtensions)
        const maxResults = clampNumber(params.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS)
        const pattern = symbolReferencePattern(symbolName)
        const files = await getCandidateFiles({
          folderPath,
          includeExtensions,
          maxFiles: DEFAULT_MAX_FILES,
          signal: context?.abortSignal,
        })
        const matches: Array<{ filePath: string; line: number; column: number; preview: string }> = []

        for (const file of files) {
          assertNotAborted(context?.abortSignal)
          if (matches.length >= maxResults) break

          let content = ''
          try {
            content = await readWorkspaceTextFile(file.path, context?.abortSignal)
          } catch {
            continue
          }

          const lines = content.split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            assertNotAborted(context?.abortSignal)
            if (matches.length >= maxResults) break

            const line = lines[index]
            if (pattern.test(line)) {
              matches.push({
                filePath: file.path,
                line: index + 1,
                column: Math.max(1, line.indexOf(symbolName) + 1),
                preview: line.trim().slice(0, 240),
              })
            }
          }
        }

        return {
          success: true,
          data: {
            symbolName,
            folderPath,
            scannedFileCount: files.length,
            matchedCount: matches.length,
            results: matches,
          },
          message: formatLocationList(`Reference search for "${symbolName}"`, matches),
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to find code references: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'code_read_context',
    description: `Read a line-numbered window of code around a given line or the first match of a query, in one file.

When to use:
- Reading the actual implementation after code_search_symbols / code_file_outline told you where to look.
- Confirming a heuristic match from code_find_definition or code_find_references is the real thing.

Do NOT use this tool to:
- Read an entire file — request the specific region instead; it exists to avoid dumping whole files.
- Search across multiple files — use code_search_symbols or safe_grep first to narrow to one file.

MUST: verify code with this tool before making claims about how it behaves. NEVER describe implementation you have not read.`,
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
        name: 'line',
        type: 'number',
        description: '1-based center line. Optional when query is provided.',
        required: false,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Optional text to locate before reading context.',
        required: false,
      },
      {
        name: 'before',
        type: 'number',
        description: 'Lines before the center line. Default 12, max 80.',
        required: false,
        default: 12,
      },
      {
        name: 'after',
        type: 'number',
        description: 'Lines after the center line. Default 20, max 80.',
        required: false,
        default: 20,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const filePath = await ensureSafeWorkspaceRelativePath(String(params.filePath || ''))
        const before = clampNumber(params.before, 12, 0, MAX_CONTEXT_LINES)
        const after = clampNumber(params.after, 20, 0, MAX_CONTEXT_LINES)
        const content = await readWorkspaceTextFile(filePath, context?.abortSignal)
        const lines = content.split(/\r?\n/)
        const query = typeof params.query === 'string' ? params.query.trim() : ''
        let centerLine = clampNumber(params.line, 0, 0, lines.length)

        if (centerLine <= 0 && query) {
          const foundIndex = lines.findIndex(line => line.includes(query))
          centerLine = foundIndex >= 0 ? foundIndex + 1 : 1
        }
        if (centerLine <= 0) {
          centerLine = 1
        }

        const startLine = Math.max(1, centerLine - before)
        const endLine = Math.min(lines.length, centerLine + after)
        const width = String(endLine).length
        const snippet = lines
          .slice(startLine - 1, endLine)
          .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
          .join('\n')

        return {
          success: true,
          data: {
            filePath,
            centerLine,
            startLine,
            endLine,
            totalLines: lines.length,
            snippet,
          },
          message: `Context for ${filePath}:${centerLine}\n${snippet}`,
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to read code context: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
]
