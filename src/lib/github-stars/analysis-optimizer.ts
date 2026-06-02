/**
 * AIAnalysisOptimizer — 自适应并发分析优化器
 *
 * 基于 GSM 的 aiAnalysisOptimizer.ts 移植并适配 LingMo 架构：
 * - 使用 LingMo 的 analysis.ts 已有的分析函数
 * - 自适应调整并发度（根据响应时间动态增减 worker 数量）
 * - 支持 pause / resume / abort 控制
 * - 支持 README 预取流水线
 */

import {
  analyzeGithubStarRepositoryDetailed,
  analyzeGithubStarRepositoryFast,
  createGithubStarAnalysisContext,
} from '@/lib/github-stars/analysis'
import type { GithubStarRepository } from '@/types/github-stars'

/** 复用 analysis.ts 中 createGithubStarAnalysisContext 的返回类型 */
type AnalysisContext = Awaited<ReturnType<typeof createGithubStarAnalysisContext>>

// ─── 类型 ───

export interface AnalysisTask {
  repo: GithubStarRepository
  retries: number
  startTime?: number
}

export interface AnalysisResult {
  repo: GithubStarRepository
  success: boolean
  summary?: string
  tags?: string[]
  platforms?: string[]
  error?: Error
  duration: number
}

export interface OptimizerConfig {
  initialConcurrency: number
  maxConcurrency: number
  minConcurrency: number
  targetResponseTime: number
  batchDelayMs: number
  maxRetries: number
  retryDelayBaseMs: number
  enableAdaptiveConcurrency: boolean
}

const DEFAULT_CONFIG: OptimizerConfig = {
  initialConcurrency: 3,
  maxConcurrency: 10,
  minConcurrency: 1,
  targetResponseTime: 5000,
  batchDelayMs: 100,
  maxRetries: 3,
  retryDelayBaseMs: 1000,
  enableAdaptiveConcurrency: true,
}

// ─── 优化器主体 ───

export class AIAnalysisOptimizer {
  private config: OptimizerConfig
  private currentConcurrency: number
  private responseTimes: number[] = []
  private aborted = false
  private paused = false
  private activeWorkers = 0
  private shouldExitWorkers = false
  private context: AnalysisContext | null = null

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.currentConcurrency = this.config.initialConcurrency
  }

  // ─── 生命周期控制 ───

  abort(): void {
    this.aborted = true
    this.shouldExitWorkers = true
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  isAborted(): boolean {
    return this.aborted
  }

  isPaused(): boolean {
    return this.paused
  }

  getCurrentConcurrency(): number {
    return this.currentConcurrency
  }

  // ─── 内部工具 ───

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.aborted) {
      await this.delay(500)
    }
  }

  private calculateRetryDelay(retryCount: number): number {
    const jitter = Math.random() * 500
    return this.config.retryDelayBaseMs * Math.pow(2, retryCount) + jitter
  }

  private recordResponseTime(duration: number): void {
    this.responseTimes.push(duration)
    if (this.responseTimes.length > 20) {
      this.responseTimes.shift()
    }

    if (this.config.enableAdaptiveConcurrency && this.responseTimes.length >= 5) {
      this.adjustConcurrency()
    }
  }

  private adjustConcurrency(): void {
    const recentTimes = this.responseTimes.slice(-5)
    const recentAvg = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length

    const oldConcurrency = this.currentConcurrency

    if (recentAvg > this.config.targetResponseTime * 1.5) {
      this.currentConcurrency = Math.max(
        this.config.minConcurrency,
        Math.floor(this.currentConcurrency * 0.8),
      )
    } else if (recentAvg < this.config.targetResponseTime * 0.7 && this.currentConcurrency < this.config.maxConcurrency) {
      this.currentConcurrency = Math.min(
        this.config.maxConcurrency,
        this.currentConcurrency + 1,
      )
    }

    if (this.currentConcurrency < oldConcurrency) {
      this.shouldExitWorkers = true
    }
  }

  // ─── 分析（带重试） ───

  private async analyzeWithRetry(task: AnalysisTask): Promise<AnalysisResult> {
    const startTime = Date.now()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.aborted) {
        return { repo: task.repo, success: false, error: new Error('Analysis aborted'), duration: Date.now() - startTime }
      }

      await this.waitWhilePaused()
      if (this.aborted) {
        return { repo: task.repo, success: false, error: new Error('Analysis aborted'), duration: Date.now() - startTime }
      }

      try {
        const analysisStart = Date.now()
        const analysis = await analyzeGithubStarRepositoryDetailed(task.repo, this.context || undefined)
        const analysisDuration = Date.now() - analysisStart

        this.recordResponseTime(analysisDuration)

        return {
          repo: task.repo,
          success: true,
          summary: analysis.summary,
          tags: analysis.tags,
          platforms: analysis.platforms,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        lastError = error as Error

        // 尝试快速分析作为降级
        if (attempt === this.config.maxRetries - 1) {
          try {
            const fallback = await analyzeGithubStarRepositoryFast(task.repo, this.context || undefined)
            return {
              repo: task.repo,
              success: true,
              summary: fallback.summary,
              tags: fallback.tags,
              platforms: fallback.platforms,
              duration: Date.now() - startTime,
            }
          } catch {
            // 最终降级也失败
          }
        }

        if (attempt < this.config.maxRetries) {
          await this.delay(this.calculateRetryDelay(attempt))
        }
      }
    }

    return { repo: task.repo, success: false, error: lastError, duration: Date.now() - startTime }
  }

  // ─── 批量分析（流水线） ───

  async analyzeRepositories(
    repos: GithubStarRepository[],
    onProgress?: (completed: number, total: number, currentConcurrency: number) => void,
    onResult?: (result: AnalysisResult) => void,
  ): Promise<AnalysisResult[]> {
    // 初始化 AI 上下文
    this.context = await createGithubStarAnalysisContext()

    const results: AnalysisResult[] = []
    const pendingRepos = [...repos]
    const completedCount = { value: 0 }
    const total = repos.length
    const workerPromises: Promise<void>[] = []
    let totalWorkersStarted = 0

    const worker = async (workerId: number): Promise<void> => {
      this.activeWorkers++
      try {
        while (pendingRepos.length > 0) {
          if (this.aborted) break
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break

          await this.waitWhilePaused()
          if (this.aborted) break
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break

          const repo = pendingRepos.shift()
          if (!repo) break

          try {
            const task: AnalysisTask = { repo, retries: 0 }
            const result = await this.analyzeWithRetry(task)
            completedCount.value++
            results.push(result)

            if (onResult) onResult(result)
            if (onProgress) onProgress(completedCount.value, total, this.activeWorkers)
          } catch {
            completedCount.value++
          }
        }
      } finally {
        this.activeWorkers--
      }
    }

    const initialWorkers = Math.min(this.currentConcurrency, repos.length)
    for (let i = 0; i < initialWorkers; i++) {
      workerPromises.push(worker(totalWorkersStarted++))
    }

    // 并发监控：动态增减 worker
    const concurrencyMonitor = async (): Promise<void> => {
      while (pendingRepos.length > 0 && !this.aborted) {
        await this.delay(1000)

        if (this.shouldExitWorkers) {
          this.shouldExitWorkers = false
          continue
        }

        if (this.activeWorkers < this.currentConcurrency && pendingRepos.length > 0) {
          workerPromises.push(worker(totalWorkersStarted++))
        }
      }
    }

    workerPromises.push(concurrencyMonitor())
    await Promise.all(workerPromises)

    return results
  }

  // ─── 统计 ───

  getStats(): {
    averageResponseTime: number
    currentConcurrency: number
    totalRequests: number
  } {
    const avgTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0

    return {
      averageResponseTime: Math.round(avgTime),
      currentConcurrency: this.currentConcurrency,
      totalRequests: this.responseTimes.length,
    }
  }
}

export function createOptimizedAIAnalyzer(config?: Partial<OptimizerConfig>): AIAnalysisOptimizer {
  return new AIAnalysisOptimizer(config)
}
