import { exists, mkdir, writeTextFile, readTextFile, readDir } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

export interface DeepResearchSessionState {
  id: string
  query: string
  strategy: string
  startedAt: string
  visitedUrls: string[]
  sources: any[]
  evidences: any[]
  learnings: string[]
  pendingQueries: Array<{ query: string; researchGoal: string; depth: number; breadth: number }>
  currentDepth: number
  totalDepth: number
  currentBreadth: number
  totalBreadth: number
}

export interface DeepResearchSessionSummary {
  id: string
  query: string
  strategy: string
  startedAt: string
  pendingQueriesCount: number
  sourcesCount: number
  evidencesCount: number
  learningsCount: number
}

// 缓存文件相对路径
function getSessionRelativePath(sessionId: string): string {
  return `.tmp/deep_research/sessions/${sessionId}.json`
}

const SESSION_DIR = '.tmp/deep_research/sessions'

/**
 * 保存深研会话的持久化状态
 */
export async function saveSessionState(state: DeepResearchSessionState): Promise<void> {
  try {
    const relativePath = getSessionRelativePath(state.id)
    const options = await getFilePathOptions(relativePath)
    const workspace = await getWorkspacePath()
    
    // 确保 .tmp/deep_research/sessions 目录存在
    const dirOptions = await getFilePathOptions(SESSION_DIR)
    
    if (workspace.isCustom) {
      const dirExists = await exists(dirOptions.path)
      if (!dirExists) {
        await mkdir(dirOptions.path, { recursive: true })
      }
    } else {
      const dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
      if (!dirExists) {
        await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir, recursive: true })
      }
    }

    const data = JSON.stringify(state, null, 2)
    if (workspace.isCustom) {
      await writeTextFile(options.path, data)
    } else {
      await writeTextFile(options.path, data, { baseDir: options.baseDir })
    }
  } catch (error) {
    console.error(`[DeepResearch] 无法保存 Session ${state.id}:`, error)
  }
}

/**
 * 列出未完成的深研会话，用于 UI 提供断点续研入口。
 */
export async function listUnfinishedResearchSessions(limit = 5): Promise<DeepResearchSessionSummary[]> {
  try {
    const dirOptions = await getFilePathOptions(SESSION_DIR)
    const workspace = await getWorkspacePath()
    const dirExists = workspace.isCustom
      ? await exists(dirOptions.path)
      : await exists(dirOptions.path, { baseDir: dirOptions.baseDir })

    if (!dirExists) {
      return []
    }

    const entries = workspace.isCustom
      ? await readDir(dirOptions.path)
      : await readDir(dirOptions.path, { baseDir: dirOptions.baseDir })

    const states = await Promise.all(
      entries
        .filter(entry => entry.isFile && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const sessionId = entry.name.replace(/\.json$/, '')
          return loadSessionState(sessionId)
        })
    )

    return states
      .filter((state): state is DeepResearchSessionState => {
        return !!state && Array.isArray(state.pendingQueries) && state.pendingQueries.length > 0
      })
      .map(state => ({
        id: state.id,
        query: state.query,
        strategy: state.strategy,
        startedAt: state.startedAt,
        pendingQueriesCount: state.pendingQueries.length,
        sourcesCount: state.sources?.length || 0,
        evidencesCount: state.evidences?.length || 0,
        learningsCount: state.learnings?.length || 0,
      }))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit)
  } catch (error) {
    console.error('[DeepResearch] 无法列出未完成 Session:', error)
    return []
  }
}

/**
 * 加载深研会话的持久化状态
 */
export async function loadSessionState(sessionId: string): Promise<DeepResearchSessionState | null> {
  try {
    const relativePath = getSessionRelativePath(sessionId)
    const options = await getFilePathOptions(relativePath)
    const workspace = await getWorkspacePath()
    
    let fileExists = false
    if (workspace.isCustom) {
      fileExists = await exists(options.path)
    } else {
      fileExists = await exists(options.path, { baseDir: options.baseDir })
    }

    if (!fileExists) {
      return null
    }

    let content = ''
    if (workspace.isCustom) {
      content = await readTextFile(options.path)
    } else {
      content = await readTextFile(options.path, { baseDir: options.baseDir })
    }

    return JSON.parse(content) as DeepResearchSessionState
  } catch (error) {
    console.error(`[DeepResearch] 无法加载 Session ${sessionId}:`, error)
    return null
  }
}
