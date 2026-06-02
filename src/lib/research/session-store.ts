import { exists, mkdir, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
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

// 缓存文件相对路径
function getSessionRelativePath(sessionId: string): string {
  return `.tmp/deep_research/sessions/${sessionId}.json`
}

/**
 * 保存深研会话的持久化状态
 */
export async function saveSessionState(state: DeepResearchSessionState): Promise<void> {
  try {
    const relativePath = getSessionRelativePath(state.id)
    const options = await getFilePathOptions(relativePath)
    const workspace = await getWorkspacePath()
    
    // 确保 .tmp/deep_research/sessions 目录存在
    const dirPath = '.tmp/deep_research/sessions'
    const dirOptions = await getFilePathOptions(dirPath)
    
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
