import { buildAllRelations, type BuildProgress } from '@/lib/relation-engine'

class RelationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private lastRunAt = 0
  private readonly intervalMs = 30 * 60 * 1000 // 30 分钟
  private readonly idleThresholdMs = 5 * 60 * 1000 // 5 分钟空闲判定

  start() {
    if (this.timer) return

    this.timer = setInterval(() => {
      void this.runIfIdle()
    }, this.intervalMs)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async runIfIdle() {
    if (this.isRunning) return

    // 检查是否空闲（距离上次运行至少 30 分钟）
    if (Date.now() - this.lastRunAt < this.intervalMs) return

    await this.runIncremental()
  }

  async runIncremental(onProgress?: (progress: BuildProgress) => void) {
    if (this.isRunning) return

    this.isRunning = true
    try {
      // 只执行关键词 + 余弦，不自动触发 LLM（节省 API 额度）
      const result = await buildAllRelations(onProgress, false, 0)

      this.lastRunAt = Date.now()

      console.info(
        `[RelationScheduler] 增量计算完成: ${result.totalNotes} 笔记, ` +
        `${result.keywordRelations} 关键词关系, ${result.cosineRelations} 余弦关系, ` +
        `${result.crossValidatedRelations} 交叉验证关系`,
      )
    } catch (error) {
      console.error('[RelationScheduler] Incremental computation failed:', error)
    } finally {
      this.isRunning = false
    }
  }

  getIsRunning() {
    return this.isRunning
  }

  getLastRunAt() {
    return this.lastRunAt
  }
}

export const relationScheduler = new RelationScheduler()
