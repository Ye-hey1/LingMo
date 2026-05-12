import { READ_ONLY_TOOLS } from './tool-policy'
import type { ToolResult } from './types'

const MAX_CACHE_SIZE = 50

interface CachedToolResult {
  result: string
  timestamp: number
}

export class ToolResultCache {
  private cache = new Map<string, CachedToolResult>()

  buildKey(toolName: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key]
        return acc
      }, {} as Record<string, any>)
    return `${toolName}::${JSON.stringify(sortedParams)}`
  }

  isCacheable(toolName: string): boolean {
    return READ_ONLY_TOOLS.has(toolName)
  }

  get(toolName: string, params: Record<string, any>): string | null {
    if (!this.isCacheable(toolName)) return null
    const key = this.buildKey(toolName, params)
    const entry = this.cache.get(key)
    return entry?.result ?? null
  }

  set(toolName: string, params: Record<string, any>, result: string): void {
    if (!this.isCacheable(toolName)) return
    const key = this.buildKey(toolName, params)
    // Evict oldest entry when cache is full
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, { result, timestamp: Date.now() })
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }
}
