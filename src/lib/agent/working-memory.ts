import { Store } from '@tauri-apps/plugin-store'

/**
 * Agent 工作记忆
 * 跨会话持久化 Agent 的工作状态，提升连续交互的智能化水平
 */

export interface FailedAttempt {
  tool: string
  params: Record<string, any>
  error: string
  timestamp: number
}

export interface AgentWorkingMemory {
  recentFiles: string[]           // 最近操作过的文件（最多 20 个）
  recentFolders: string[]         // 最近访问的文件夹（最多 10 个）
  failedAttempts: FailedAttempt[] // 失败的尝试（最多 20 条）
  toolUsageStats: Record<string, number>  // 工具使用频率统计
  lastActiveAt: number            // 最后活跃时间
}

const STORE_FILE = 'agent-working-memory.json'
const MEMORY_KEY = 'workingMemory'
const MAX_RECENT_FILES = 20
const MAX_RECENT_FOLDERS = 10
const MAX_FAILED_ATTEMPTS = 20
const FAILED_ATTEMPT_TTL = 24 * 60 * 60 * 1000 // 24 小时后过期

let memoryCache: AgentWorkingMemory | null = null

function createEmptyMemory(): AgentWorkingMemory {
  return {
    recentFiles: [],
    recentFolders: [],
    failedAttempts: [],
    toolUsageStats: {},
    lastActiveAt: Date.now(),
  }
}

/**
 * 加载工作记忆
 */
export async function loadWorkingMemory(): Promise<AgentWorkingMemory> {
  if (memoryCache) return memoryCache

  try {
    const store = await Store.load(STORE_FILE)
    const data = await store.get<AgentWorkingMemory>(MEMORY_KEY)

    if (data) {
      // 清理过期的失败记录
      const now = Date.now()
      data.failedAttempts = (data.failedAttempts || []).filter(
        a => now - a.timestamp < FAILED_ATTEMPT_TTL
      )
      memoryCache = data
      return data
    }
  } catch {
    // 首次使用或读取失败
  }

  memoryCache = createEmptyMemory()
  return memoryCache
}

/**
 * 保存工作记忆
 */
async function saveWorkingMemory(memory: AgentWorkingMemory): Promise<void> {
  memoryCache = memory
  try {
    const store = await Store.load(STORE_FILE)
    await store.set(MEMORY_KEY, memory)
    await (store as Store & { save?: () => Promise<void> }).save?.()
  } catch (error) {
    console.warn('[AgentWorkingMemory] Failed to save:', error)
  }
}

/**
 * 记录文件访问
 */
export async function recordFileAccess(filePath: string): Promise<void> {
  const memory = await loadWorkingMemory()
  const normalized = filePath.replace(/\\/g, '/')

  // 移到最前面（LRU）
  memory.recentFiles = [
    normalized,
    ...memory.recentFiles.filter(f => f !== normalized),
  ].slice(0, MAX_RECENT_FILES)

  // 提取文件夹
  const folder = normalized.split('/').slice(0, -1).join('/')
  if (folder) {
    memory.recentFolders = [
      folder,
      ...memory.recentFolders.filter(f => f !== folder),
    ].slice(0, MAX_RECENT_FOLDERS)
  }

  memory.lastActiveAt = Date.now()
  await saveWorkingMemory(memory)
}

/**
 * 记录工具使用
 */
export async function recordToolUsage(toolName: string): Promise<void> {
  const memory = await loadWorkingMemory()
  memory.toolUsageStats[toolName] = (memory.toolUsageStats[toolName] || 0) + 1
  memory.lastActiveAt = Date.now()
  await saveWorkingMemory(memory)
}

/**
 * 记录失败尝试
 */
export async function recordFailedAttempt(
  tool: string,
  params: Record<string, any>,
  error: string
): Promise<void> {
  const memory = await loadWorkingMemory()

  memory.failedAttempts = [
    { tool, params, error, timestamp: Date.now() },
    ...memory.failedAttempts,
  ].slice(0, MAX_FAILED_ATTEMPTS)

  memory.lastActiveAt = Date.now()
  await saveWorkingMemory(memory)
}

/**
 * 检查是否有相似的失败记录（避免重复犯错）
 */
export async function hasRecentFailure(tool: string, params: Record<string, any>): Promise<FailedAttempt | null> {
  const memory = await loadWorkingMemory()
  const now = Date.now()
  const paramsKey = JSON.stringify(params)

  return memory.failedAttempts.find(
    a => a.tool === tool &&
      JSON.stringify(a.params) === paramsKey &&
      now - a.timestamp < FAILED_ATTEMPT_TTL
  ) || null
}

/**
 * 格式化工作记忆为 prompt 上下文
 */
export function formatWorkingMemoryForPrompt(memory: AgentWorkingMemory): string {
  const parts: string[] = []

  if (memory.recentFiles.length > 0) {
    const files = memory.recentFiles.slice(0, 8).map(f => `  - ${f}`).join('\n')
    parts.push(`Recently accessed files:\n${files}`)
  }

  if (memory.recentFolders.length > 0) {
    const folders = memory.recentFolders.slice(0, 5).map(f => `  - ${f}`).join('\n')
    parts.push(`Known folders:\n${folders}`)
  }

  if (memory.failedAttempts.length > 0) {
    const failures = memory.failedAttempts.slice(0, 3).map(
      a => `  - ${a.tool}: ${a.error.slice(0, 100)}`
    ).join('\n')
    parts.push(`Recent failures (avoid repeating):\n${failures}`)
  }

  // 常用工具 top 5
  const topTools = Object.entries(memory.toolUsageStats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
  if (topTools.length > 0) {
    const tools = topTools.map(([name, count]) => `  - ${name} (${count}x)`).join('\n')
    parts.push(`Frequently used tools:\n${tools}`)
  }

  return parts.length > 0
    ? `## Agent Working Memory\n${parts.join('\n\n')}`
    : ''
}

/**
 * 清除工作记忆缓存
 */
export function clearWorkingMemoryCache(): void {
  memoryCache = null
}
