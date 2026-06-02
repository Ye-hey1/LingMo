/**
 * 智能上下文压缩模块
 *
 * 改进点：
 * 1. 保留关键步骤（写操作、失败步骤）
 * 2. 只压缩读操作的完整内容
 * 3. 提高压缩阈值到 8 步
 * 4. 保留更丰富的摘要信息
 * 5. 支持"压缩后悔"机制
 */

import type { AgentContextSnapshot, AgentEvent, ReActStep, ToolCall } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartCompressionInput {
  userGoal: string
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  maxToolResults?: number
}

export interface CompressionResult {
  text: string
  snapshot?: AgentContextSnapshot
  compressedStepCount: number
  preservedStepCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READ_FILE_TOOLS = new Set([
  'read_markdown_file',
  'read_markdown_files_batch',
  'get_editor_content',
  'read_diagram_file',
  'safe_read_file',
  'search_markdown_files',
])

const WRITE_TOOLS = new Set([
  'create_file',
  'update_markdown_file',
  'replace_editor_content',
  'insert_at_cursor',
  'delete_markdown_file',
  'rename_file',
  'move_file',
  'create_diagram_file',
  'update_diagram_file',
])

const IMPORTANT_TOOLS = new Set([
  'select_skill',
  'web_search',
  'web_fetch',
  'create_tag',
  'create_mark',
])

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function summarizeObservation(observation: string, maxLength = 300): string {
  const compacted = observation.replace(/\s+/g, ' ').trim()
  return truncate(compacted, maxLength)
}

function isSuccessObservation(observation?: string): boolean {
  if (!observation) return false
  return !observation.includes('失败') && !observation.includes('错误') && !observation.includes('阻止')
}

function isFailedStep(step: ReActStep): boolean {
  return Boolean(step.observation && (
    step.observation.includes('失败') ||
    step.observation.includes('错误') ||
    step.observation.includes('无法')
  ))
}

// ---------------------------------------------------------------------------
// Step classification
// ---------------------------------------------------------------------------

type StepImportance = 'critical' | 'important' | 'normal' | 'low'

function classifyStep(step: ReActStep): StepImportance {
  const toolName = step.action?.tool

  // 写操作 = 关键
  if (toolName && WRITE_TOOLS.has(toolName)) {
    return 'critical'
  }

  // 失败步骤 = 关键（避免重复犯错）
  if (isFailedStep(step)) {
    return 'critical'
  }

  // 重要工具 = 重要
  if (toolName && IMPORTANT_TOOLS.has(toolName)) {
    return 'important'
  }

  // 成功的读操作 = 普通
  if (toolName && READ_FILE_TOOLS.has(toolName) && isSuccessObservation(step.observation)) {
    return 'normal'
  }

  // 其他 = 低
  return 'low'
}

// ---------------------------------------------------------------------------
// Smart compression
// ---------------------------------------------------------------------------

/**
 * 智能压缩步骤列表
 * 
 * 策略：
 * - critical 步骤：完全保留
 * - important 步骤：保留摘要
 * - normal 步骤：只保留工具名和结果摘要
 * - low 步骤：可丢弃
 */
function compressSteps(steps: ReActStep[], maxPreserved = 6): {
  preserved: ReActStep[]
  compressed: Array<{ step: ReActStep; importance: StepImportance; summary: string }>
} {
  const classified = steps.map(step => ({
    step,
    importance: classifyStep(step),
  }))

  // 分离关键步骤和可压缩步骤
  const criticalSteps = classified.filter(c => c.importance === 'critical')
  const importantSteps = classified.filter(c => c.importance === 'important')
  const normalSteps = classified.filter(c => c.importance === 'normal')
  const lowSteps = classified.filter(c => c.importance === 'low')

  // 保留最近的步骤 + 关键步骤
  const recentSteps = steps.slice(-2) // 最近 2 步总是保留
  const recentIds = new Set(recentSteps.map(s => s.thought))

  const preserved: ReActStep[] = []
  const compressed: Array<{ step: ReActStep; importance: StepImportance; summary: string }> = []

  // 1. 添加关键步骤（去重）
  for (const { step } of criticalSteps) {
    if (!recentIds.has(step.thought)) {
      preserved.push(step)
    }
  }

  // 2. 添加最近步骤
  for (const step of recentSteps) {
    if (!preserved.includes(step)) {
      preserved.push(step)
    }
  }

  // 3. 添加重要步骤（如果还有空间）
  for (const { step } of importantSteps) {
    if (preserved.length >= maxPreserved) break
    if (!preserved.includes(step)) {
      preserved.push(step)
    }
  }

  // 4. 压缩剩余步骤
  const preservedSet = new Set(preserved)
  for (const { step, importance } of [...normalSteps, ...lowSteps]) {
    if (!preservedSet.has(step)) {
      compressed.push({
        step,
        importance,
        summary: summarizeObservation(step.observation || '', 100),
      })
    }
  }

  return { preserved, compressed }
}

// ---------------------------------------------------------------------------
// Context snapshot building
// ---------------------------------------------------------------------------

function extractPathCandidates(params: Record<string, any>): string[] {
  const paths = [
    params.filePath,
    params.folderPath,
    params.path,
    params.targetFolderPath,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (Array.isArray(params.filePaths)) {
    for (const filePath of params.filePaths) {
      if (typeof filePath === 'string' && filePath.trim()) {
        paths.push(filePath.trim())
      }
    }
  }

  return Array.from(new Set(paths.map(path => path.replace(/\\/g, '/'))))
}

function extractTodos(steps: ReActStep[]): AgentContextSnapshot['todos'] {
  const todos: AgentContextSnapshot['todos'] = []

  for (const step of steps) {
    const chunks = [step.thought, step.observation].filter(Boolean) as string[]
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

      for (const line of lines) {
        if (!/(todo|next step|remaining|must|need to|failed|error|blocked)/i.test(line)) {
          continue
        }

        const status = /blocked|failed|error|cannot|unable/i.test(line) ? 'blocked'
          : /done|completed|success|created|updated|saved/i.test(line) ? 'done'
          : 'pending'

        todos.push({
          title: truncate(line.replace(/^[-*]\s*/, ''), 160),
          status,
        })

        if (todos.length >= 8) return todos
      }
    }
  }

  return todos
}

function buildSmartSnapshot(input: SmartCompressionInput): AgentContextSnapshot {
  const readFilesByPath = new Map<string, AgentContextSnapshot['readFiles'][number]>()
  const toolResults: AgentContextSnapshot['toolResults'] = []
  const maxToolResults = input.maxToolResults || 15

  // 从步骤中提取信息
  for (const step of input.steps) {
    const toolName = step.action?.tool
    const params = step.action?.params || {}

    // 记录读取的文件
    if (toolName && READ_FILE_TOOLS.has(toolName)) {
      for (const path of extractPathCandidates(params)) {
        readFilesByPath.set(path, {
          path,
          source: toolName,
          lastReadAt: Date.now(),
        })
      }
    }

    // 记录工具结果（只保留重要的）
    if (toolName && step.observation) {
      const importance = classifyStep(step)
      if (importance === 'critical' || importance === 'important') {
        toolResults.push({
          toolName,
          status: isFailedStep(step) ? 'error' : 'observed',
          summary: summarizeObservation(step.observation),
        })
      }
    }
  }

  // 从工具调用中提取信息
  for (const toolCall of input.toolCalls) {
    if (READ_FILE_TOOLS.has(toolCall.toolName)) {
      for (const path of extractPathCandidates(toolCall.params)) {
        readFilesByPath.set(path, {
          path,
          source: toolCall.toolName,
          lastReadAt: toolCall.timestamp,
        })
      }
    }
  }

  return {
    userGoal: truncate(input.userGoal, 500),
    readFiles: Array.from(readFilesByPath.values()).slice(-20),
    toolResults: toolResults.slice(-maxToolResults),
    todos: extractTodos(input.steps),
    compactedAt: Date.now(),
    sourceEventCount: input.events.length,
    sourceStepCount: input.steps.length,
  }
}

// ---------------------------------------------------------------------------
// Compression thresholds
// ---------------------------------------------------------------------------

/**
 * 智能判断是否需要压缩
 * 阈值提高到 8 步或 8000 字符
 */
export function shouldCompressSmartly(steps: ReActStep[], events: AgentEvent[]): boolean {
  // 步骤数阈值：8 步
  if (steps.length >= 8) return true

  // 事件数阈值：80 个
  if (events.length >= 80) return true

  // 字符数阈值：8000
  const charCount = steps.reduce((sum, step) => (
    sum + step.thought.length + (step.observation?.length || 0)
  ), 0)

  return charCount > 8000
}

// ---------------------------------------------------------------------------
// Format snapshot
// ---------------------------------------------------------------------------

function formatSmartSnapshot(snapshot: AgentContextSnapshot): string {
  const readFiles = snapshot.readFiles.length > 0
    ? snapshot.readFiles.map(file => `- ${file.path}`).join('\n')
    : '- none'

  const toolResults = snapshot.toolResults.length > 0
    ? snapshot.toolResults.map(result => {
        const statusIcon = result.status === 'error' ? '✗' : '✓'
        return `- ${statusIcon} ${result.toolName}: ${result.summary}`
      }).join('\n')
    : '- none'

  const todos = snapshot.todos.length > 0
    ? snapshot.todos.map(todo => {
        const statusIcon = todo.status === 'done' ? '✓' : todo.status === 'blocked' ? '✗' : '○'
        return `- ${statusIcon} ${todo.title}`
      }).join('\n')
    : '- none'

  return `## Agent Context Summary

**Goal**: ${snapshot.userGoal || 'unknown'}

**Files accessed**:
${readFiles}

**Key tool results**:
${toolResults}

**Task progress**:
${todos}`
}

// ---------------------------------------------------------------------------
// Main compression function
// ---------------------------------------------------------------------------

/**
 * 智能压缩 Agent 历史上下文
 */
export function buildSmartAgentHistoryContext(input: SmartCompressionInput): CompressionResult {
  const { preserved, compressed } = compressSteps(input.steps)

  // 如果不需要压缩，返回完整历史
  if (compressed.length === 0) {
    const fullHistory = input.steps.map((step, i) =>
      `Iteration ${i + 1}:
Thought: ${step.thought}
Action: ${step.action?.tool}
Action Input: ${JSON.stringify(step.action?.params)}
Observation: ${step.observation}
`
    ).join('\n')

    return {
      text: fullHistory,
      compressedStepCount: 0,
      preservedStepCount: input.steps.length,
    }
  }

  // 构建压缩快照
  const snapshot = buildSmartSnapshot(input)

  // 格式化保留的步骤
  const preservedHistory = preserved.map((step) => {
    const importance = classifyStep(step)
    const marker = importance === 'critical' ? ' [KEY]' : ''
    return `Step${marker}:
Thought: ${truncate(step.thought, 600)}
Action: ${step.action?.tool}
Observation: ${truncate(step.observation || '', 800)}
`
  }).join('\n')

  // 格式化压缩的步骤摘要
  const compressedSummary = compressed.length > 0
    ? `\n## Compressed Steps (${compressed.length} steps)\n` +
      compressed.map(c => `- ${c.step.action?.tool || 'thought'}: ${c.summary}`).join('\n')
    : ''

  return {
    text: `${formatSmartSnapshot(snapshot)}

## Preserved Steps
${preservedHistory}${compressedSummary}`,
    snapshot,
    compressedStepCount: compressed.length,
    preservedStepCount: preserved.length,
  }
}
