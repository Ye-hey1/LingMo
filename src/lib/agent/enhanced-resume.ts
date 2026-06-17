/**
 * 增强 Agent 恢复机制
 *
 * 改进点：
 * 1. 保存完整的执行快照
 * 2. 支持从指定步骤恢复
 * 3. 保留工具调用历史
 * 4. 支持多会话恢复
 */

import type { ReActStep, ToolCall, AgentEvent } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionSnapshot {
  id: string
  runId: string
  createdAt: number
  updatedAt: number

  // Original request
  originalUserInput: string
  originalContext?: string

  // Execution state
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  currentIteration: number

  // Interrupt info
  interruptReason: 'user_stop' | 'error' | 'timeout' | 'periodic'
  interruptedAt: number
  errorMessage?: string

  // Resume metadata
  resumeCount: number
  lastResumeAt?: number
  resumeFromStep?: number
}

export interface ResumeOptions {
  snapshotId?: string
  fromStep?: number
  skipFailedSteps?: boolean
  modifyInput?: string
}

// ---------------------------------------------------------------------------
// Snapshot Manager
// ---------------------------------------------------------------------------

export class SnapshotManager {
  private snapshots = new Map<string, ExecutionSnapshot>()
  private maxSnapshots: number
  private snapshotTTL: number

  constructor(options: {
    maxSnapshots?: number
    snapshotTTL?: number
  } = {}) {
    this.maxSnapshots = options.maxSnapshots || 10
    this.snapshotTTL = options.snapshotTTL || 24 * 60 * 60 * 1000 // 24 hours
  }

  // ---------------------------------------------------------------------------
  // Snapshot creation
  // ---------------------------------------------------------------------------

  /**
   * 创建执行快照
   */
  createSnapshot(
    runId: string,
    userInput: string,
    steps: ReActStep[],
    toolCalls: ToolCall[],
    events: AgentEvent[],
    currentIteration: number,
    interruptReason: ExecutionSnapshot['interruptReason'],
    options: {
      context?: string
      errorMessage?: string
    } = {}
  ): ExecutionSnapshot {
    const id = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot: ExecutionSnapshot = {
      id,
      runId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalUserInput: userInput,
      originalContext: options.context,
      steps: [...steps],
      toolCalls: [...toolCalls],
      events: [...events],
      currentIteration,
      interruptReason,
      interruptedAt: Date.now(),
      errorMessage: options.errorMessage,
      resumeCount: 0,
    }

    this.snapshots.set(id, snapshot)
    this.cleanup()

    return snapshot
  }

  // ---------------------------------------------------------------------------
  // Snapshot retrieval
  // ---------------------------------------------------------------------------

  /**
   * 获取快照
   */
  getSnapshot(id: string): ExecutionSnapshot | null {
    return this.snapshots.get(id) || null
  }

  /**
   * 获取最新的快照
   */
  getLatestSnapshot(): ExecutionSnapshot | null {
    let latest: ExecutionSnapshot | null = null
    for (const snapshot of this.snapshots.values()) {
      if (!latest || snapshot.updatedAt > latest.updatedAt) {
        latest = snapshot
      }
    }
    return latest
  }

  /**
   * 获取所有可恢复的快照
   */
  getResumableSnapshots(): ExecutionSnapshot[] {
    const now = Date.now()
    return Array.from(this.snapshots.values())
      .filter(s => now - s.updatedAt < this.snapshotTTL)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ---------------------------------------------------------------------------
  // Snapshot update
  // ---------------------------------------------------------------------------

  /**
   * 更新快照（恢复后）
   */
  updateSnapshot(id: string, updates: Partial<ExecutionSnapshot>): boolean {
    const snapshot = this.snapshots.get(id)
    if (!snapshot) return false

    Object.assign(snapshot, updates, { updatedAt: Date.now() })
    snapshot.resumeCount++
    snapshot.lastResumeAt = Date.now()

    return true
  }

  /**
   * 删除快照
   */
  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * 清理过期和多余的快照
   */
  private cleanup(): void {
    const now = Date.now()

    // Remove expired snapshots
    for (const [id, snapshot] of this.snapshots.entries()) {
      if (now - snapshot.updatedAt > this.snapshotTTL) {
        this.snapshots.delete(id)
      }
    }

    // Remove oldest if over limit
    if (this.snapshots.size > this.maxSnapshots) {
      const sorted = Array.from(this.snapshots.entries())
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)

      const toRemove = sorted.slice(0, this.snapshots.size - this.maxSnapshots)
      for (const [id] of toRemove) {
        this.snapshots.delete(id)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Resume prompt building
// ---------------------------------------------------------------------------

/**
 * 构建恢复提示
 */
export function buildResumePrompt(snapshot: ExecutionSnapshot, options: ResumeOptions = {}): string {
  const stepsToResume = options.fromStep !== undefined
    ? snapshot.steps.slice(options.fromStep)
    : snapshot.steps

  // Filter out failed steps if requested
  const filteredSteps = options.skipFailedSteps
    ? stepsToResume.filter(s => !s.observation?.includes('失败') && !s.observation?.includes('错误'))
    : stepsToResume

  // Build step summary
  const stepSummary = filteredSteps.map((step, i) => {
    const status = step.observation?.includes('失败') ? '✗' : '✓'
    return `${status} Step ${i + 1}: ${step.action?.tool || 'thought'} - ${step.observation?.slice(0, 100) || 'N/A'}`
  }).join('\n')

  // Build resume prompt
  let prompt = `## 恢复执行

你正在从之前的中断点恢复执行。

### 原始请求
${snapshot.originalUserInput}

### 中断原因
${snapshot.interruptReason === 'user_stop' ? '用户手动停止' :
  snapshot.interruptReason === 'error' ? `错误: ${snapshot.errorMessage}` :
  snapshot.interruptReason === 'periodic' ? '执行中断（自动恢复点）' :
  '执行超时'}

### 已完成的步骤 (${filteredSteps.length}/${snapshot.steps.length})
${stepSummary || '无'}

### 恢复指导
1. 从上次中断的地方继续执行
2. 不要重复已完成的步骤
3. 如果之前有失败的步骤，尝试不同的方法
4. 基于已有的结果继续推进任务
`

  // Add custom input if provided
  if (options.modifyInput) {
    prompt += `\n### 用户补充说明\n${options.modifyInput}\n`
  }

  return prompt
}

/**
 * 构建步骤级恢复提示
 */
export function buildStepResumePrompt(
  snapshot: ExecutionSnapshot,
  fromStep: number
): string {
  const stepsBefore = snapshot.steps.slice(0, fromStep)
  const stepsAfter = snapshot.steps.slice(fromStep)

  const beforeSummary = stepsBefore.map((step, i) =>
    `✓ Step ${i + 1}: ${step.action?.tool || 'thought'} - ${step.observation?.slice(0, 50) || 'N/A'}`
  ).join('\n')

  const afterSummary = stepsAfter.map((step, i) =>
    `○ Step ${fromStep + i + 1}: ${step.action?.tool || 'thought'} - ${step.observation?.slice(0, 50) || 'N/A'}`
  ).join('\n')

  return `## 从步骤 ${fromStep + 1} 恢复

### 原始请求
${snapshot.originalUserInput}

### 已完成的步骤
${beforeSummary || '无'}

### 待恢复的步骤
${afterSummary || '无'}

### 恢复指导
请从步骤 ${fromStep + 1} 开始继续执行。不要重复已完成的步骤。
`
}

// ---------------------------------------------------------------------------
// Snapshot persistence (Tauri)
// ---------------------------------------------------------------------------

const STORE_FILE = 'agent-snapshots.json'
const SNAPSHOTS_KEY = 'snapshots'

/**
 * 保存快照到持久存储
 */
export async function persistSnapshot(snapshot: ExecutionSnapshot): Promise<void> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load(STORE_FILE)

    const existing = await store.get<ExecutionSnapshot[]>(SNAPSHOTS_KEY) || []
    const updated = [...existing.filter(s => s.id !== snapshot.id), snapshot]

    await store.set(SNAPSHOTS_KEY, updated)
    await (store as any).save?.()
  } catch (error) {
    console.warn('[SnapshotManager] Failed to persist snapshot:', error)
  }
}

/**
 * 从持久存储加载快照
 */
export async function loadPersistedSnapshots(): Promise<ExecutionSnapshot[]> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load(STORE_FILE)

    return await store.get<ExecutionSnapshot[]>(SNAPSHOTS_KEY) || []
  } catch {
    return []
  }
}

/**
 * 删除持久存储中的快照
 */
export async function deletePersistedSnapshot(id: string): Promise<void> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load(STORE_FILE)

    const existing = await store.get<ExecutionSnapshot[]>(SNAPSHOTS_KEY) || []
    const updated = existing.filter(s => s.id !== id)

    await store.set(SNAPSHOTS_KEY, updated)
    await (store as any).save?.()
  } catch (error) {
    console.warn('[SnapshotManager] Failed to delete snapshot:', error)
  }
}

// ---------------------------------------------------------------------------
// Resume capability check
// ---------------------------------------------------------------------------

/**
 * 检查快照是否可恢复
 */
export function canResumeSnapshot(snapshot: ExecutionSnapshot): {
  canResume: boolean
  reason?: string
} {
  const now = Date.now()
  const age = now - snapshot.updatedAt

  // Check if too old (24 hours)
  if (age > 24 * 60 * 60 * 1000) {
    return { canResume: false, reason: '快照已过期（超过24小时）' }
  }

  // Check if too many resumes
  if (snapshot.resumeCount >= 3) {
    return { canResume: false, reason: '已达到最大恢复次数（3次）' }
  }

  // Check if there are steps to resume
  if (snapshot.steps.length === 0) {
    return { canResume: false, reason: '没有可恢复的步骤' }
  }

  return { canResume: true }
}

/**
 * 获取恢复摘要
 */
export function getResumeSummary(snapshot: ExecutionSnapshot): {
  id: string
  title: string
  description: string
  stepCount: number
  interruptedAt: string
  canResume: boolean
  reason?: string
} {
  const { canResume, reason } = canResumeSnapshot(snapshot)
  const interruptedAt = new Date(snapshot.interruptedAt).toLocaleString()

  const title = snapshot.originalUserInput.length > 50
    ? snapshot.originalUserInput.slice(0, 50) + '...'
    : snapshot.originalUserInput

  return {
    id: snapshot.id,
    title,
    description: `中断原因: ${snapshot.interruptReason === 'user_stop' ? '用户停止' :
      snapshot.interruptReason === 'error' ? '错误' : '超时'}`,
    stepCount: snapshot.steps.length,
    interruptedAt,
    canResume,
    reason,
  }
}
