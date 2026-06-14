import { READ_ONLY_TOOLS } from './tool-policy'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 100
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes
const WEB_SEARCH_TTL = 60 * 1000 // 1 minute for fast-moving external facts

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedToolResult {
  result: string
  timestamp: number
  resources: Set<string>
  accessCount: number
  lastAccessedAt: number
}

export interface CacheStats {
  size: number
  hitCount: number
  missCount: number
  hitRate: number
  evictionCount: number
}

// ---------------------------------------------------------------------------
// Parameter normalization
// ---------------------------------------------------------------------------

/**
 * 规范化工具参数，确保相同语义的参数生成相同的 key
 *
 * 改进点：
 * 1. 处理嵌套对象的 key 排序
 * 2. 处理数组元素的排序（对于无序数组）
 * 3. 处理 undefined/null 值
 * 4. 处理路径标准化（反斜杠 -> 正斜杠）
 */
function normalizeParams(params: Record<string, any>): Record<string, any> {
  if (!params || typeof params !== 'object') {
    return {}
  }

  const normalized: Record<string, any> = {}

  for (const key of Object.keys(params).sort()) {
    const value = params[key]

    // 跳过 undefined 值
    if (value === undefined) continue

    // 处理 null 值
    if (value === null) {
      normalized[key] = null
      continue
    }

    // 处理字符串 - 标准化路径
    if (typeof value === 'string') {
      // 标准化文件路径
      if (key === 'filePath' || key === 'folderPath' || key === 'path' || key === 'targetFile') {
        normalized[key] = value.replace(/\\/g, '/').replace(/\/+/g, '/')
      } else {
        normalized[key] = value
      }
      continue
    }

    // 处理数组 - 对于 filePaths 等无序数组进行排序
    if (Array.isArray(value)) {
      if (key === 'filePaths' || key === 'paths' || key === 'files') {
        // 文件路径数组排序
        normalized[key] = [...value].sort()
      } else {
        // 其他数组保持顺序
        normalized[key] = value
      }
      continue
    }

    // 处理嵌套对象 - 递归规范化
    if (typeof value === 'object') {
      normalized[key] = normalizeParams(value)
      continue
    }

    // 其他类型直接保留
    normalized[key] = value
  }

  return normalized
}

/**
 * 生成缓存 key
 */
function buildCacheKey(toolName: string, params: Record<string, any>): string {
  const normalized = normalizeParams(params)
  return `${toolName}::${JSON.stringify(normalized)}`
}

// ---------------------------------------------------------------------------
// Resource extraction
// ---------------------------------------------------------------------------

/**
 * 提取工具对应的物理资源标签（用于细粒度缓存失效）
 */
export function extractResources(toolName: string, params: Record<string, any>): string[] {
  const resources: string[] = []

  if (!params) return resources

  // 文件读取工具
  if (
    toolName === 'read_markdown_file' ||
    toolName === 'get_connected_notes' ||
    toolName === 'suggest_links_for_note' ||
    toolName === 'analyze_note_topics' ||
    toolName === 'read_diagram_file' ||
    toolName === 'read_visual_report_file'
  ) {
    if (typeof params.filePath === 'string') {
      resources.push(`file:${params.filePath.replace(/\\/g, '/')}`)
    }
  }

  // 批量文件读取
  if (toolName === 'read_markdown_files_batch') {
    if (Array.isArray(params.filePaths)) {
      params.filePaths.forEach((path: any) => {
        if (typeof path === 'string') {
          resources.push(`file:${path.replace(/\\/g, '/')}`)
        }
      })
    }
  }

  // 编辑器工具
  if (
    toolName === 'get_editor_content' ||
    toolName === 'insert_at_cursor' ||
    toolName === 'replace_editor_content'
  ) {
    if (typeof params.filePath === 'string') {
      resources.push(`file:${params.filePath.replace(/\\/g, '/')}`)
    } else {
      resources.push('active_editor')
    }
  }

  // 文件写入工具
  if (
    toolName === 'create_file' ||
    toolName === 'write_to_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'delete_file' ||
    toolName === 'update_markdown_file'
  ) {
    if (typeof params.filePath === 'string') {
      resources.push(`file:${params.filePath.replace(/\\/g, '/')}`)
    } else if (typeof params.targetFile === 'string') {
      resources.push(`file:${params.targetFile.replace(/\\/g, '/')}`)
    }
  }

  // 文件夹工具
  if (
    toolName === 'list_markdown_files' ||
    toolName === 'list_folders' ||
    toolName === 'check_folder_exists'
  ) {
    if (typeof params.folderPath === 'string') {
      resources.push(`folder:${params.folderPath.replace(/\\/g, '/')}`)
    }
  }

  // 搜索工具
  if (toolName === 'safe_grep' || toolName === 'search_markdown_files') {
    resources.push('search:global')
  }

  // Web 工具
  if (toolName === 'web_search' || toolName === 'web_fetch' || toolName === 'web_extract') {
    resources.push('web:search')
  }

  // 标签/标记工具
  if (toolName.startsWith('read_tag') || toolName.startsWith('read_mark')) {
    resources.push('db:tags')
  }

  return resources
}

// ---------------------------------------------------------------------------
// Tool Result Cache
// ---------------------------------------------------------------------------

export class ToolResultCache {
  private cache = new Map<string, CachedToolResult>()
  private hitCount = 0
  private missCount = 0
  private evictionCount = 0
  private ttl: number

  constructor(options: { ttl?: number } = {}) {
    this.ttl = options.ttl || DEFAULT_TTL
  }

  // ---------------------------------------------------------------------------
  // Key building
  // ---------------------------------------------------------------------------

  buildKey(toolName: string, params: Record<string, any>): string {
    return buildCacheKey(toolName, params)
  }

  // ---------------------------------------------------------------------------
  // Cacheability check
  // ---------------------------------------------------------------------------

  isCacheable(toolName: string): boolean {
    return READ_ONLY_TOOLS.has(toolName)
  }

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  private getTtl(toolName: string): number {
    return toolName === 'web_search' ? WEB_SEARCH_TTL : this.ttl
  }

  get(toolName: string, params: Record<string, any>): string | null {
    if (!this.isCacheable(toolName)) {
      this.missCount++
      return null
    }

    const key = this.buildKey(toolName, params)
    const entry = this.cache.get(key)

    if (!entry) {
      this.missCount++
      return null
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.getTtl(toolName)) {
      this.cache.delete(key)
      this.missCount++
      return null
    }

    // 更新访问信息
    entry.accessCount++
    entry.lastAccessedAt = Date.now()
    this.hitCount++

    return entry.result
  }

  // ---------------------------------------------------------------------------
  // Set
  // ---------------------------------------------------------------------------

  set(toolName: string, params: Record<string, any>, result: string): void {
    if (!this.isCacheable(toolName)) return

    const key = this.buildKey(toolName, params)

    // LRU 淘汰：当缓存满时，移除最久未访问的条目
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictLRU()
    }

    const resourceList = extractResources(toolName, params)
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      resources: new Set(resourceList),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    })
  }

  // ---------------------------------------------------------------------------
  // Invalidation
  // ---------------------------------------------------------------------------

  invalidateAll(): void {
    this.cache.clear()
  }

  /**
   * 按资源失效缓存
   * 当文件被写入/删除时，失效所有相关缓存
   */
  invalidateByResources(dirtyResources: string[]): void {
    if (dirtyResources.length === 0) return
    const dirtySet = new Set(dirtyResources)

    for (const [key, entry] of this.cache.entries()) {
      let hasOverlap = false
      for (const res of entry.resources) {
        // 精确匹配或前缀匹配
        if (
          dirtySet.has(res) ||
          (dirtySet.has('active_editor') && res === 'active_editor') ||
          this.isResourceOverlap(res, dirtySet)
        ) {
          hasOverlap = true
          break
        }
      }
      if (hasOverlap) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * 按文件路径失效缓存
   */
  invalidateByFile(filePath: string): void {
    const normalizedPath = filePath.replace(/\\/g, '/')
    this.invalidateByResources([`file:${normalizedPath}`])
  }

  /**
   * 按文件夹路径失效缓存
   */
  invalidateByFolder(folderPath: string): void {
    const normalizedPath = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
    this.invalidateByResources([`folder:${normalizedPath}`])
  }

  /**
   * 失效所有编辑器相关缓存
   */
  invalidateEditorCache(): void {
    this.invalidateByResources(['active_editor'])
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * 清理过期条目
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  size(): number {
    return this.cache.size
  }

  getStats(): CacheStats {
    const total = this.hitCount + this.missCount
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
      evictionCount: this.evictionCount,
    }
  }

  resetStats(): void {
    this.hitCount = 0
    this.missCount = 0
    this.evictionCount = 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.evictionCount++
    }
  }

  private isResourceOverlap(resource: string, dirtySet: Set<string>): boolean {
    // 检查文件夹级别的失效
    for (const dirty of dirtySet) {
      if (dirty.startsWith('folder:') && resource.startsWith('file:')) {
        const folder = dirty.slice(7)
        const file = resource.slice(5)
        if (file.startsWith(folder + '/') || file === folder) {
          return true
        }
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Global cache instance
// ---------------------------------------------------------------------------

let globalCache: ToolResultCache | null = null

export function getGlobalToolCache(): ToolResultCache {
  if (!globalCache) {
    globalCache = new ToolResultCache()
  }
  return globalCache
}

export function resetGlobalToolCache(): void {
  if (globalCache) {
    globalCache.invalidateAll()
    globalCache.resetStats()
  }
}
