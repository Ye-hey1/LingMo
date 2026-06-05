/**
 * 动态工具过滤模块
 *
 * 改进点：
 * 1. 每轮迭代根据上下文动态调整工具集
 * 2. 基于上一步 Observation 调整工具优先级
 * 3. 缓存已过滤结果，避免重复计算
 * 4. 支持工具亲和性 - 相关工具一起出现
 */

import type { Tool, ReActStep } from './types'

// ---------------------------------------------------------------------------
// Tool affinity groups - related tools that should appear together
// ---------------------------------------------------------------------------

const TOOL_AFFINITY_GROUPS: Record<string, string[]> = {
  // File operations
  'read_markdown_file': ['replace_editor_content', 'get_editor_content', 'insert_at_cursor'],
  'get_editor_content': ['replace_editor_content', 'insert_at_cursor', 'read_markdown_file'],
  'create_file': ['update_markdown_file', 'read_markdown_file'],
  
  // Search operations
  'safe_grep': ['safe_read_file', 'read_markdown_file'],
  'search_markdown_files': ['read_markdown_file', 'read_markdown_files_batch'],
  
  // Tag/mark operations
  'create_tag': ['read_tags', 'create_mark', 'read_marks'],
  'create_mark': ['read_marks', 'create_tag', 'read_tags'],
  
  // Diagram operations
  'create_diagram_from_outline': ['read_diagram_file', 'update_diagram_file'],
  'create_diagram_file': ['read_diagram_file', 'update_diagram_file'],
  
  // Web operations
  'web_search': ['web_fetch', 'web_extract'],
  'web_fetch': ['web_extract', 'web_search'],
}

// ---------------------------------------------------------------------------
// Context-based tool scoring
// ---------------------------------------------------------------------------

interface ToolScore {
  tool: Tool
  score: number
  reason: string
}

/**
 * 计算工具在当前上下文中的相关性得分
 */
function computeContextualScore(
  tool: Tool,
  steps: ReActStep[],
  lastObservation: string | undefined,
  iteration: number
): number {
  let score = 0

  // 基础分：所有工具都有
  score += 10

  // 1. 上一步使用的工具的亲和性加分
  if (steps.length > 0) {
    const lastTool = steps[steps.length - 1].action?.tool
    if (lastTool) {
      const affinityTools = TOOL_AFFINITY_GROUPS[lastTool]
      if (affinityTools?.includes(tool.name)) {
        score += 15 // 亲和性加分
      }
    }
  }

  // 2. 根据上一步 Observation 调整
  if (lastObservation) {
    // 如果上一步读取了文件，增加编辑工具的分数
    if (lastObservation.includes('成功读取') || lastObservation.includes('内容')) {
      if (tool.name.includes('replace') || tool.name.includes('insert') || tool.name.includes('update')) {
        score += 10
      }
    }

    // 如果上一步搜索到了结果，增加读取工具的分数
    if (lastObservation.includes('找到') || lastObservation.includes('匹配')) {
      if (tool.name.includes('read') || tool.name.includes('get')) {
        score += 10
      }
    }

    // 如果上一步失败了，降低相同工具的分数
    if (lastObservation.includes('失败') || lastObservation.includes('错误')) {
      const lastTool = steps[steps.length - 1].action?.tool
      if (lastTool === tool.name) {
        score -= 20
      }
    }
  }

  // 3. 迭代次数调整
  // 后续迭代降低规划类工具的分数
  if (iteration > 2) {
    if (tool.name === 'select_skill' || tool.name === 'load_skill_content') {
      score -= 5
    }
  }

  // 4. 工具类别调整
  // 读取工具始终保持较高分数
  if (tool.risk === 'low' || /^(read_|list_|get_|search_|safe_)/.test(tool.name)) {
    score += 5
  }

  return score
}

// ---------------------------------------------------------------------------
// Dynamic tool filter
// ---------------------------------------------------------------------------

export interface DynamicFilterOptions {
  maxTools?: number
  minScore?: number
  alwaysInclude?: string[]
  forceInclude?: string[]
}

const DEFAULT_OPTIONS: DynamicFilterOptions = {
  maxTools: 35,
  minScore: 0,
  alwaysInclude: [
    'get_editor_content',
    'replace_editor_content',
    'read_markdown_file',
    'safe_grep',
    'create_file',
    'get_current_time',
    'create_reminder',
    'list_reminders',
    'web_search',
    'web_extract',
  ],
  forceInclude: [],
}

/**
 * 动态过滤工具列表
 */
export function filterToolsDynamically(
  allTools: Tool[],
  steps: ReActStep[],
  options: DynamicFilterOptions = {}
): Tool[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const lastStep = steps[steps.length - 1]
  const lastObservation = lastStep?.observation
  const iteration = steps.length + 1

  // 计算每个工具的得分
  const scoredTools: ToolScore[] = allTools.map(tool => ({
    tool,
    score: computeContextualScore(tool, steps, lastObservation, iteration),
    reason: '',
  }))

  // 按得分排序
  scoredTools.sort((a, b) => b.score - a.score)

  // 选择工具
  const selectedTools: Tool[] = []
  const selectedNames = new Set<string>()

  // 1. 强制包含的工具
  for (const name of opts.forceInclude || []) {
    const tool = allTools.find(t => t.name === name)
    if (tool && !selectedNames.has(name)) {
      selectedTools.push(tool)
      selectedNames.add(name)
    }
  }

  // 2. 始终包含的工具
  for (const name of opts.alwaysInclude || []) {
    if (!selectedNames.has(name)) {
      const tool = allTools.find(t => t.name === name)
      if (tool) {
        selectedTools.push(tool)
        selectedNames.add(name)
      }
    }
  }

  // 3. 按得分选择剩余工具
  for (const { tool, score } of scoredTools) {
    if (selectedTools.length >= (opts.maxTools || 30)) break
    if (score < (opts.minScore || 0)) break
    if (selectedNames.has(tool.name)) continue

    selectedTools.push(tool)
    selectedNames.add(tool.name)

    // 添加亲和性工具
    const affinityTools = TOOL_AFFINITY_GROUPS[tool.name]
    if (affinityTools) {
      for (const affinityName of affinityTools) {
        if (selectedTools.length >= (opts.maxTools || 30)) break
        if (!selectedNames.has(affinityName)) {
          const affinityTool = allTools.find(t => t.name === affinityName)
          if (affinityTool) {
            selectedTools.push(affinityTool)
            selectedNames.add(affinityName)
          }
        }
      }
    }
  }

  return selectedTools
}

// ---------------------------------------------------------------------------
// Cached filter for performance
// ---------------------------------------------------------------------------

interface CachedFilter {
  stepsHash: string
  result: Tool[]
  timestamp: number
}

const filterCache = new Map<string, CachedFilter>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function hashSteps(steps: ReActStep[]): string {
  const last3 = steps.slice(-3)
  return last3.map(s => `${s.action?.tool || ''}:${s.observation?.slice(0, 50) || ''}`).join('|')
}

function hashTools(tools: Tool[]): string {
  return tools.map(tool => tool.name).sort().join(',')
}

/**
 * 带缓存的动态工具过滤
 */
export function filterToolsWithCache(
  allTools: Tool[],
  steps: ReActStep[],
  options: DynamicFilterOptions = {}
): Tool[] {
  const stepsHash = hashSteps(steps)
  const toolsHash = hashTools(allTools)
  const cacheKey = `${toolsHash}:${stepsHash}:${JSON.stringify(options)}`

  // 检查缓存
  const cached = filterCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result
  }

  // 计算新结果
  const result = filterToolsDynamically(allTools, steps, options)

  // 更新缓存
  filterCache.set(cacheKey, {
    stepsHash,
    result,
    timestamp: Date.now(),
  })

  // 清理过期缓存
  for (const [key, entry] of filterCache.entries()) {
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      filterCache.delete(key)
    }
  }

  return result
}

/**
 * 清除过滤缓存
 */
export function clearFilterCache(): void {
  filterCache.clear()
}
