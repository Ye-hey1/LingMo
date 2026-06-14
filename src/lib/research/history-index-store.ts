import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { ResearchSession } from './deep-research'
import {
  RESEARCH_HISTORY_INDEX_VERSION,
  buildResearchHistoryIndex,
  createResearchHistoryDocument,
  searchResearchHistory,
  upsertResearchHistoryDocument,
  type ResearchHistoryIndex,
  type ResearchHistorySearchResult,
} from './history-index'

export const RESEARCH_HISTORY_INDEX_PATH = '.tmp/deep_research/history-index.json'
const RESEARCH_HISTORY_DIR = '.tmp/deep_research'

async function pathExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  return workspace.isCustom
    ? exists(options.path)
    : exists(options.path, { baseDir: options.baseDir })
}

async function readWorkspaceText(relativePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  return workspace.isCustom
    ? readTextFile(options.path)
    : readTextFile(options.path, { baseDir: options.baseDir })
}

async function writeWorkspaceText(relativePath: string, content: string) {
  const workspace = await getWorkspacePath()
  const dirOptions = await getFilePathOptions(RESEARCH_HISTORY_DIR)
  const dirExists = workspace.isCustom
    ? await exists(dirOptions.path)
    : await exists(dirOptions.path, { baseDir: dirOptions.baseDir })

  if (!dirExists) {
    if (workspace.isCustom) {
      await mkdir(dirOptions.path, { recursive: true })
    } else {
      await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir, recursive: true })
    }
  }

  const options = await getFilePathOptions(relativePath)
  if (workspace.isCustom) {
    await writeTextFile(options.path, content)
  } else {
    await writeTextFile(options.path, content, { baseDir: options.baseDir })
  }
}

function isResearchHistoryIndex(value: unknown): value is ResearchHistoryIndex {
  return !!value
    && typeof value === 'object'
    && (value as ResearchHistoryIndex).version === RESEARCH_HISTORY_INDEX_VERSION
    && Array.isArray((value as ResearchHistoryIndex).documents)
}

export async function loadResearchHistoryIndex(): Promise<ResearchHistoryIndex | null> {
  try {
    if (!(await pathExists(RESEARCH_HISTORY_INDEX_PATH))) {
      return null
    }

    const parsed = JSON.parse(await readWorkspaceText(RESEARCH_HISTORY_INDEX_PATH))
    return isResearchHistoryIndex(parsed) ? parsed : null
  } catch (error) {
    console.warn('[ResearchHistory] Failed to load history index:', error)
    return null
  }
}

export async function saveResearchHistoryIndex(index: ResearchHistoryIndex): Promise<void> {
  await writeWorkspaceText(RESEARCH_HISTORY_INDEX_PATH, JSON.stringify(index, null, 2))
}

export async function upsertResearchHistorySession(input: {
  session: ResearchSession
  reportContent?: string
  reportPath?: string
  sessionPath?: string
}): Promise<ResearchHistoryIndex> {
  const currentIndex = await loadResearchHistoryIndex()
  const document = createResearchHistoryDocument(input)
  const nextIndex = upsertResearchHistoryDocument(currentIndex, document)
  await saveResearchHistoryIndex(nextIndex)
  return nextIndex
}

export async function searchSavedResearchHistory(
  query: string,
  options: { limit?: number; minScore?: number } = {},
): Promise<ResearchHistorySearchResult[]> {
  const index = await loadResearchHistoryIndex()
  return index ? searchResearchHistory(index, query, options) : []
}

export async function rebuildResearchHistoryIndexFromReports(researchDir = 'research'): Promise<ResearchHistoryIndex> {
  const workspace = await getWorkspacePath()
  const dirOptions = await getFilePathOptions(researchDir)
  const dirExists = workspace.isCustom
    ? await exists(dirOptions.path)
    : await exists(dirOptions.path, { baseDir: dirOptions.baseDir })

  if (!dirExists) {
    const emptyIndex = buildResearchHistoryIndex([])
    await saveResearchHistoryIndex(emptyIndex)
    return emptyIndex
  }

  const entries = workspace.isCustom
    ? await readDir(dirOptions.path)
    : await readDir(dirOptions.path, { baseDir: dirOptions.baseDir })
  const sessions: ResearchSession[] = []

  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.research.json')) {
      continue
    }

    try {
      const relativePath = `${researchDir}/${entry.name}`
      sessions.push(JSON.parse(await readWorkspaceText(relativePath)) as ResearchSession)
    } catch (error) {
      console.warn(`[ResearchHistory] Failed to read ${entry.name}:`, error)
    }
  }

  const index = buildResearchHistoryIndex(sessions)
  await saveResearchHistoryIndex(index)
  return index
}
