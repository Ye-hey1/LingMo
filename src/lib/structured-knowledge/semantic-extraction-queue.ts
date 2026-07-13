'use client'

import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  DEFAULT_SEMANTIC_EXTRACTION_LEASE_MS,
  getStructuredDocumentByPath,
  getStructuredDocumentsNeedingSemanticExtraction,
  markStructuredSemanticExtractionRequested,
} from '@/db/structured-knowledge'
import { syncStructuredMarkdownContent } from './sync'
import { extractNoteSemantics } from './semantic-extractor'
import {
  getStructuredSemanticExtractionSettings,
  shouldAutomaticallyProcessSemanticExtractions,
} from './semantic-extraction-settings'

interface SemanticExtractionTask {
  filePath: string
  content?: string
  reason?: string
  queuedAt: number
}

export interface SemanticExtractionQueueSnapshot {
  size: number
  isProcessing: boolean
  queuedPaths: string[]
  lastRecoveryAt?: number
  lastRecoveredCount?: number
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isMarkdownPath(path: string) {
  return /\.(md|markdown|mdx)$/i.test(path)
}

class SemanticExtractionQueue {
  private tasks = new Map<string, SemanticExtractionTask>()
  private isProcessing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private lastActivityAt = Date.now()
  private dailyKey = ''
  private dailyCount = 0
  private lastRecoveryAt: number | undefined
  private lastRecoveredCount = 0

  noteActivity() {
    this.lastActivityAt = Date.now()
  }

  enqueue(task: { filePath: string; content?: string; reason?: string }) {
    const filePath = normalizePath(task.filePath)
    if (!filePath || !isMarkdownPath(filePath)) return
    this.noteActivity()
    const queuedAt = Date.now()
    this.tasks.set(filePath, { filePath, content: task.content, reason: task.reason, queuedAt })
    void this.markRequested(filePath)
    this.schedule()
  }

  snapshot(): SemanticExtractionQueueSnapshot {
    return {
      size: this.tasks.size,
      isProcessing: this.isProcessing,
      queuedPaths: Array.from(this.tasks.keys()),
      lastRecoveryAt: this.lastRecoveryAt,
      lastRecoveredCount: this.lastRecoveredCount,
    }
  }

  clear() {
    this.tasks.clear()
    if (this.timer) clearTimeout(this.timer)
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.timer = null
    this.recoveryTimer = null
    // ponytail: 重置日限额与活动时间，避免跨日 reset 后复用陈旧预算
    this.dailyKey = ''
    this.dailyCount = 0
    this.lastActivityAt = Date.now()
  }

  async flush() {
    if (this.isProcessing) return
    this.isProcessing = true
    let autoProcessingEnabled = false
    try {
      const settings = await getStructuredSemanticExtractionSettings()
      autoProcessingEnabled = shouldAutomaticallyProcessSemanticExtractions(settings)
      if (!autoProcessingEnabled) return

      const idleMs = settings.mode === 'onSave' ? 0 : settings.idleSeconds * 1000
      const waitMs = idleMs - (Date.now() - this.lastActivityAt)
      if (waitMs > 0) {
        this.schedule(waitMs)
        return
      }

      let processed = 0
      for (const task of this.takeNewestTasks(settings.maxNotesPerRun)) {
        if (processed >= settings.maxNotesPerRun) break
        if (!this.consumeDailyBudget(settings.dailyLimit)) break
        await this.processTask(task, settings.maxBlocks, settings.cooldownMinutes)
        processed++
      }
    } finally {
      this.isProcessing = false
      if (this.tasks.size > 0 && autoProcessingEnabled) {
        if (!this.timer) this.schedule()
      }
    }
  }

  async recoverPending(limit = 25) {
    const settings = await getStructuredSemanticExtractionSettings()
    const autoProcessingEnabled = shouldAutomaticallyProcessSemanticExtractions(settings)
    this.lastRecoveryAt = Date.now()
    this.lastRecoveredCount = 0
    if (!autoProcessingEnabled) return 0

    const now = Date.now()
    const cooldownMs = DEFAULT_SEMANTIC_EXTRACTION_LEASE_MS
    const documents = await getStructuredDocumentsNeedingSemanticExtraction({
      limit: Math.max(limit, 50),
      cooldownMs,
      now,
      includeActiveRunning: true,
    })
    let recovered = 0
    let nextRecoveryDelay: number | undefined

    for (const document of documents) {
      if (document.semanticExtractionStatus === 'running' && document.semanticExtractionStartedAt) {
        const recoveryDelay = document.semanticExtractionStartedAt + cooldownMs - now
        if (recoveryDelay > 0) {
          nextRecoveryDelay = nextRecoveryDelay === undefined
            ? recoveryDelay
            : Math.min(nextRecoveryDelay, recoveryDelay)
          continue
        }
      }
      if (recovered >= limit) continue
      const filePath = normalizePath(document.filePath)
      if (!filePath || !isMarkdownPath(filePath) || this.tasks.has(filePath)) continue
      this.tasks.set(filePath, {
        filePath,
        reason: 'startup-recovery',
        queuedAt: Date.now(),
      })
      recovered++
    }

    this.lastRecoveredCount = recovered
    if (recovered > 0) this.schedule()
    if (nextRecoveryDelay !== undefined) this.scheduleRecovery(nextRecoveryDelay, limit)
    return recovered
  }

  private schedule(delayMs?: number) {
    if (this.timer) clearTimeout(this.timer)
    const runAfter = delayMs ?? 1000
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, runAfter)
  }

  private scheduleRecovery(delayMs: number, limit: number) {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.recoverPending(limit)
    }, Math.max(1000, delayMs))
  }

  private takeNewestTasks(limit: number) {
    const tasks = Array.from(this.tasks.values()).sort((a, b) => b.queuedAt - a.queuedAt).slice(0, limit)
    for (const task of tasks) this.tasks.delete(task.filePath)
    return tasks
  }

  private consumeDailyBudget(limit: number) {
    if (limit <= 0) return false
    const key = new Date().toISOString().slice(0, 10)
    if (this.dailyKey !== key) {
      this.dailyKey = key
      this.dailyCount = 0
    }
    if (this.dailyCount >= limit) return false
    this.dailyCount++
    return true
  }

  private async markRequested(filePath: string) {
    try {
      const document = await getStructuredDocumentByPath(filePath)
      if (document) await markStructuredSemanticExtractionRequested(document.id, document.contentHash)
    } catch (error) {
      console.warn('[SemanticExtractionQueue] Failed to mark request:', error)
    }
  }

  private async readContent(filePath: string): Promise<string | undefined> {
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(filePath)
    const fileExists = workspace.isCustom
      ? await exists(pathOptions.path)
      : await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    if (!fileExists) return undefined
    return workspace.isCustom
      ? await readTextFile(pathOptions.path)
      : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
  }

  private async processTask(task: SemanticExtractionTask, maxBlocks: number, cooldownMinutes: number) {
    const settings = await getStructuredSemanticExtractionSettings()
    if (settings.mode === 'off' || settings.mode === 'manual') return
    if (!settings.costWarningAccepted || !settings.privacyWarningAccepted) return

    const content = task.content ?? await this.readContent(task.filePath)
    if (content === undefined) return
    const syncResult = await syncStructuredMarkdownContent({ filePath: task.filePath, content, updateKnowledgeObject: true })
    const document = await getStructuredDocumentByPath(task.filePath)
    if (!document) return

    const cooldownMs = Math.max(0, cooldownMinutes) * 60 * 1000
    const alreadyCurrent = document.semanticExtractionContentHash === document.contentHash && document.semanticExtractedAt
    const coolingDown = document.semanticExtractedAt && Date.now() - document.semanticExtractedAt < cooldownMs
    if (alreadyCurrent || (syncResult.skipped && coolingDown)) return

    try {
      await extractNoteSemantics({ filePath: task.filePath, mode: 'both', maxBlocks, overwrite: true })
    } catch (error) {
      console.warn(`[SemanticExtractionQueue] Failed to extract ${task.filePath}:`, error)
    }
  }
}

let queue: SemanticExtractionQueue | null = null

export function getSemanticExtractionQueue() {
  if (!queue) queue = new SemanticExtractionQueue()
  return queue
}

export function enqueueSemanticExtraction(task: { filePath: string; content?: string; reason?: string }) {
  getSemanticExtractionQueue().enqueue(task)
}

export async function flushSemanticExtractionQueue() {
  await getSemanticExtractionQueue().flush()
}

export async function recoverPendingSemanticExtractions(options: { limit?: number } = {}) {
  return await getSemanticExtractionQueue().recoverPending(options.limit)
}
