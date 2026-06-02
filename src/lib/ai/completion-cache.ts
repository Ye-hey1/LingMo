/**
 * AI 补全结果缓存
 * 基于 LRU + TTL 的内存缓存，用于灰字补全场景下的预测结果复用
 * 参照 src/lib/agent/tool-cache.ts 的设计模式
 */

interface CachedCompletion {
  prediction: string
  timestamp: number
  contextPrefix: string
}

const MAX_CACHE_SIZE = 50
const DEFAULT_TTL = 30 * 1000 // 30 秒过期

/**
 * 简单字符串哈希（无 crypto 依赖，适用于短 key）
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // 转为 32 位整数
  }
  return String(hash)
}

export class CompletionCache {
  private cache = new Map<string, CachedCompletion>()
  private ttl: number
  private maxSize: number

  constructor(options: { ttl?: number; maxSize?: number } = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL
    this.maxSize = options.maxSize ?? MAX_CACHE_SIZE
  }

  /**
   * 构建缓存 key：取上下文末 100 字符进行哈希
   */
  private buildKey(contextPrefix: string): string {
    const normalized = contextPrefix.trim().slice(-100)
    return simpleHash(normalized)
  }

  /**
   * 查询缓存：返回匹配的预测文本，不存在或已过期则返回 null
   */
  get(contextPrefix: string): string | null {
    const key = this.buildKey(contextPrefix)
    const entry = this.cache.get(key)

    if (!entry) return null

    // TTL 检查
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    // 前缀一致性校验（防止哈希碰撞导致错误命中）
    const normalizedPrefix = contextPrefix.trim().slice(-100)
    if (entry.contextPrefix === normalizedPrefix) {
      return entry.prediction
    }

    return null
  }

  /**
   * 存储补全结果
   */
  set(contextPrefix: string, prediction: string): void {
    const normalizedPrefix = contextPrefix.trim().slice(-100)
    const key = this.buildKey(contextPrefix)

    // LRU 淘汰
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    this.cache.set(key, {
      prediction,
      timestamp: Date.now(),
      contextPrefix: normalizedPrefix,
    })
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 获取缓存统计信息（用于调试）
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
    }
  }

  /**
   * LRU 淘汰：移除最久未使用的条目
   */
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    this.cache.forEach((entry, key) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    })

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }
}

// 模块级单例：跨编辑器实例共享缓存
let globalCache: CompletionCache | null = null

export function getCompletionCache(): CompletionCache {
  if (!globalCache) {
    globalCache = new CompletionCache()
  }
  return globalCache
}
