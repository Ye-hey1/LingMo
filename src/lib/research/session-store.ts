import { exists, mkdir, writeTextFile, readTextFile, readDir } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { ResearchProviderHealth, ResearchSearchCacheStats } from './deep-research'

// ---------------------------------------------------------------------------
// 恢复研究卡片 — 消息内容中的结构化元数据（嵌入 chat content）
// ---------------------------------------------------------------------------

export type ResearchResumeMeta = {
  sessionId: string
  query: string
  startedAt: string
  updatedAt?: string
  currentStage?: DeepResearchSessionStage
  currentQuery?: string
  pendingQueriesCount: number
  sourcesCount: number
  evidencesCount: number
}

const RESEARCH_RESUME_PREFIX = '<!-- deep-research-resume '
const RESEARCH_RESUME_SUFFIX = ' -->'

export function encodeResearchResumeData(meta: ResearchResumeMeta): string {
  return `${RESEARCH_RESUME_PREFIX}${encodeURIComponent(JSON.stringify(meta))}${RESEARCH_RESUME_SUFFIX}`
}

export function parseResearchResumeData(content?: string | null): ResearchResumeMeta | null {
  if (!content?.startsWith(RESEARCH_RESUME_PREFIX)) return null
  const endIndex = content.indexOf(RESEARCH_RESUME_SUFFIX)
  if (endIndex < 0) return null
  try {
    return JSON.parse(decodeURIComponent(content.slice(RESEARCH_RESUME_PREFIX.length, endIndex)))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Session 持久化
// ---------------------------------------------------------------------------

export interface DeepResearchSessionState {
  id: string
  query: string
  strategy: string
  status?: DeepResearchSessionStatus
  stage?: DeepResearchSessionStage
  startedAt: string
  updatedAt?: string
  completedAt?: string
  lastError?: string
  visitedUrls: string[]
  sources: any[]
  evidences: any[]
  learnings: string[]
  pendingQueries: Array<{ query: string; researchGoal: string; depth: number; breadth: number }>
  activeQueries?: Array<{ query: string; researchGoal: string; depth: number; breadth: number }>
  completedQueries?: number
  totalQueries?: number
  currentQuery?: string
  currentDepth: number
  totalDepth: number
  currentBreadth: number
  totalBreadth: number
  cacheStats?: ResearchSearchCacheStats
  providerHealth?: ResearchProviderHealth[]
}

export interface DeepResearchSessionSummary {
  id: string
  query: string
  strategy: string
  status?: DeepResearchSessionStatus
  stage?: DeepResearchSessionStage
  startedAt: string
  updatedAt?: string
  currentQuery?: string
  pendingQueriesCount: number
  sourcesCount: number
  evidencesCount: number
  learningsCount: number
}

export type DeepResearchSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type DeepResearchSessionStage = 'initializing' | 'planning' | 'searching' | 'analyzing' | 'verifying' | 'writing' | 'done'

const VALID_STATUSES: readonly DeepResearchSessionStatus[] = ['running', 'completed', 'failed', 'cancelled']
const VALID_STAGES: readonly DeepResearchSessionStage[] = ['initializing', 'planning', 'searching', 'analyzing', 'verifying', 'writing', 'done']

/** 对加载的 Session 状态做基本 schema 校验，防止损坏文件导致静默失败 */
function validateSessionState(data: unknown): data is DeepResearchSessionState {
  if (!data || typeof data !== 'object') return false
  const s = data as Record<string, unknown>
  if (typeof s.id !== 'string' || !s.id) return false
  if (typeof s.query !== 'string' || !s.query) return false
  if (typeof s.startedAt !== 'string' || !s.startedAt) return false
  // 验证 ISO 时间格式
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s.startedAt)) return false
  if (s.status && !VALID_STATUSES.includes(s.status as DeepResearchSessionStatus)) return false
  if (s.stage && !VALID_STAGES.includes(s.stage as DeepResearchSessionStage)) return false
  if (typeof s.currentDepth !== 'number') return false
  if (typeof s.totalDepth !== 'number') return false
  if (typeof s.currentBreadth !== 'number') return false
  if (typeof s.totalBreadth !== 'number') return false
  return true
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

    const data = JSON.stringify({
      ...state,
      updatedAt: state.updatedAt || new Date().toISOString(),
    }, null, 2)
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
        return isUnfinishedResearchSession(state)
      })
      .map(state => ({
        id: state.id,
        query: state.query,
        strategy: state.strategy,
        status: state.status,
        stage: state.stage,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        currentQuery: state.currentQuery,
        pendingQueriesCount: getRecoverableQueryCount(state),
        sourcesCount: state.sources?.length || 0,
        evidencesCount: state.evidences?.length || 0,
        learningsCount: state.learnings?.length || 0,
      }))
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.startedAt).getTime()
        const bTime = new Date(b.updatedAt || b.startedAt).getTime()
        return bTime - aTime
      })
      .slice(0, limit)
  } catch (error) {
    console.error('[DeepResearch] 无法列出未完成 Session:', error)
    return []
  }
}

function getRecoverableQueryCount(state: DeepResearchSessionState): number {
  const pendingCount = Array.isArray(state.pendingQueries) ? state.pendingQueries.length : 0
  const activeCount = Array.isArray(state.activeQueries) ? state.activeQueries.length : 0
  return pendingCount + activeCount
}

export function isUnfinishedResearchSession(state: DeepResearchSessionState | null | undefined): state is DeepResearchSessionState {
  if (!state) return false
  if (state.status === 'completed' || state.stage === 'done' || state.completedAt) return false
  if (getRecoverableQueryCount(state) > 0) return true
  return (state.status === 'running' || state.status === 'failed' || state.status === 'cancelled')
    && (
      state.stage === 'initializing'
      || state.stage === 'planning'
      || state.stage === 'verifying'
      || state.stage === 'writing'
    )
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

    const parsed = JSON.parse(content)
    if (!validateSessionState(parsed)) {
      console.warn(`[DeepResearch] Session ${sessionId} 数据校验失败，可能已损坏，跳过加载`)
      return null
    }
    return parsed
  } catch (error) {
    console.error(`[DeepResearch] 无法加载 Session ${sessionId}:`, error)
    return null
  }
}
