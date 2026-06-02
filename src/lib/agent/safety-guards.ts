import type { ReActStep } from './types'

/**
 * Agent 安全防护模块
 * 包含：Observation 截断、循环检测、格式降级策略
 */

// ============ Observation 硬截断 ============

const MAX_OBSERVATION_CHARS = 8000
const HEAD_RATIO = 0.7
const TAIL_RATIO = 0.2

export function truncateObservation(observation: string): string {
  if (observation.length <= MAX_OBSERVATION_CHARS) return observation

  const headLen = Math.floor(MAX_OBSERVATION_CHARS * HEAD_RATIO)
  const tailLen = Math.floor(MAX_OBSERVATION_CHARS * TAIL_RATIO)
  const truncatedCount = observation.length - headLen - tailLen

  const head = observation.slice(0, headLen)
  const tail = observation.slice(-tailLen)

  return `【系统提示：由于工具输出内容过长，为防止超出大模型上下文窗口，已由安全模块自动截断】
--- 截断元数据 ---
- 原始字符数：${observation.length} 字符
- 当前展示：头部 ${headLen} 字符 + 尾部 ${tailLen} 字符
- 隐藏字符数：${truncatedCount} 字符

--- 分页与精细读取指南 ---
- 如果你需要阅读隐藏的部分，请不要一次性尝试读取大文件。
- 请在下一轮中使用具有精细参数的工具（例如在 safe_read_file 中指定 startLine 与 endLine 范围进行分片读取，或使用 safe_grep 对文件进行关键词过滤后读取）。
----------------------------------------
${head}
... [已截断 ${truncatedCount} 字符] ...
${tail}`
}

// ============ 语义循环检测 ============

interface LoopDetectionResult {
  isLoop: boolean
  reason?: string
}

/**
 * 检测 Agent 是否陷入语义循环
 * 只在非常明确的无意义循环时才终止，避免误杀正常执行
 */
export function detectSemanticLoop(steps: ReActStep[]): LoopDetectionResult {
  if (steps.length < 5) return { isLoop: false }

  // 只检测一种情况：连续 5 次都没有成功执行任何工具（全是格式错误或空步骤）
  const recent5 = steps.slice(-5)
  const allFailed = recent5.every(s => !s.action || !s.observation || s.observation.includes('无法解析') || s.observation.includes('你只输出') || s.observation.includes('你提到了'))

  if (allFailed) {
    return {
      isLoop: true,
      reason: 'Agent failed to produce valid actions for 5 consecutive iterations',
    }
  }

  return { isLoop: false }
}

// ============ LLM 响应格式降级策略 ============

export type FormatDegradationLevel = 'strict' | 'lenient' | 'fallback'

/**
 * 根据连续解析失败次数决定降级策略
 */
export function getFormatDegradationLevel(consecutiveParseFailures: number): FormatDegradationLevel {
  if (consecutiveParseFailures <= 1) return 'strict'
  if (consecutiveParseFailures === 2) return 'lenient'
  return 'fallback'
}

/**
 * 根据降级级别生成不同的格式提示
 */
export function getFormatRecoveryPrompt(level: FormatDegradationLevel): string {
  switch (level) {
    case 'strict':
      return 'Your previous response could not be parsed. Please respond with a valid JSON object containing "action" and "action_input" fields, or a "final_answer" field.'
    case 'lenient':
      return 'I still cannot parse your response. Please use this EXACT format:\n{"action": "tool_name", "action_input": {"param": "value"}}\nOR for final answer:\n{"final_answer": "your answer here"}'
    case 'fallback':
      return 'Multiple parse failures detected. Please just provide your final answer as plain text. I will treat your entire response as the answer to the user.'
  }
}

/**
 * 在 fallback 级别，将 LLM 的原始输出作为 Final Answer
 */
export function extractFallbackAnswer(rawOutput: string): string {
  // 移除可能的 JSON 包装尝试
  const cleaned = rawOutput
    .replace(/^```(?:json)?\s*/g, '')
    .replace(/\s*```$/g, '')
    .replace(/^\{[\s\S]*?"(?:thought|action)"[\s\S]*$/g, '')
    .trim()

  return cleaned || rawOutput.trim()
}

// ============ 自适应迭代上限 ============

interface IterationConfig {
  maxIterations: number
  warningThreshold: number  // 接近上限时发出警告的阈值
}

/**
 * 根据任务复杂度动态计算迭代上限
 */
export function computeAdaptiveIterationLimit(
  taskPlan?: { isComplex: boolean; steps: Array<{ tools: string[] }> },
  _userInput?: string
): IterationConfig {
  // 简单任务
  if (!taskPlan || !taskPlan.isComplex) {
    return { maxIterations: 10, warningThreshold: 8 }
  }

  // 复杂任务：每步预留 2-3 次迭代
  const stepCount = taskPlan.steps.length
  const toolCount = taskPlan.steps.reduce((sum, s) => sum + s.tools.length, 0)

  // 基础迭代 = 步骤数 * 3（每步可能需要读取、执行、验证）
  const baseIterations = Math.max(stepCount * 3, toolCount * 2)

  // 上限 25，下限 10
  const maxIterations = Math.min(Math.max(baseIterations, 10), 25)

  return {
    maxIterations,
    warningThreshold: Math.floor(maxIterations * 0.8),
  }
}
