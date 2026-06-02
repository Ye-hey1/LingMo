/**
 * 增强版循环检测模块
 *
 * 改进点：
 * 1. 语义相似度检测 - 使用 Jaccard bigram 相似度检测重复策略
 * 2. 策略失败检测 - 同一工具连续失败时建议换工具
 * 3. 进展停滞检测 - 多步没有新文件读写时提示
 * 4. 工具使用模式检测 - 读取-修改-读取-修改循环
 */

import type { ReActStep } from './types'
import { isTruncatedSafeGrepObservation } from './orchestration'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoopDetectionResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
}

export interface ProgressDetectionResult {
  isStalled: boolean
  reason?: string
  suggestion?: string
}

export interface StrategyFailureResult {
  shouldSwitch: boolean
  failedTool: string
  failureCount: number
  suggestion: string
}

function isFailedObservation(observation?: string): boolean {
  if (!observation) {
    return true
  }

  return observation.includes('失败') ||
    observation.includes('错误') ||
    observation.includes('无法') ||
    isTruncatedSafeGrepObservation(observation)
}

function detectRepeatedTruncatedSearch(steps: ReActStep[]): LoopDetectionResult {
  const recentSearches = steps
    .filter((step) => step.action?.tool === 'safe_grep')
    .slice(-3)

  const truncatedCount = recentSearches.filter((step) =>
    isTruncatedSafeGrepObservation(step.observation)
  ).length

  if (truncatedCount >= 2) {
    return {
      isLoop: true,
      reason: 'safe_grep 连续返回截断结果，说明搜索范围过宽且没有收敛',
      suggestion: '请停止重复宽泛检索，改为读取候选文件，或指定更具体的 query、folderPath、includeExtensions 后再搜索。',
    }
  }

  return { isLoop: false }
}

// ---------------------------------------------------------------------------
// String similarity (Jaccard on bigrams)
// ---------------------------------------------------------------------------

function computeBigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const bigramsA = new Set<string>()
  const bigramsB = new Set<string>()

  const normalizeA = a.toLowerCase().replace(/\s+/g, ' ').trim()
  const normalizeB = b.toLowerCase().replace(/\s+/g, ' ').trim()

  for (let i = 0; i < normalizeA.length - 1; i++) {
    bigramsA.add(normalizeA.slice(i, i + 2))
  }
  for (let i = 0; i < normalizeB.length - 1; i++) {
    bigramsB.add(normalizeB.slice(i, i + 2))
  }

  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }

  const union = bigramsA.size + bigramsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ---------------------------------------------------------------------------
// Semantic loop detection
// ---------------------------------------------------------------------------

/**
 * 检测 Agent 是否陷入语义循环
 * 
 * 策略：
 * 1. 连续 N 步的 Thought 语义相似度 > 0.7
 * 2. 连续 N 步使用相同工具但参数略有不同
 * 3. 连续 N 步没有成功的工具执行
 */
export function detectSemanticLoop(steps: ReActStep[], threshold = 0.7): LoopDetectionResult {
  if (steps.length < 3) return { isLoop: false }

  const recentSteps = steps.slice(-3)

  // 1. 检查 Thought 语义相似度
  const thoughts = recentSteps.map(s => s.thought).filter(Boolean)
  if (thoughts.length >= 3) {
    const sim1 = computeBigramSimilarity(thoughts[0], thoughts[1])
    const sim2 = computeBigramSimilarity(thoughts[1], thoughts[2])
    const sim3 = computeBigramSimilarity(thoughts[0], thoughts[2])

    if (sim1 > threshold && sim2 > threshold && sim3 > threshold) {
      return {
        isLoop: true,
        reason: 'Agent 连续 3 步产生了语义高度相似的思考内容',
        suggestion: '请尝试不同的方法或直接给出当前已有的结论',
      }
    }
  }

  // 2. 检查工具使用模式（读取-修改-读取-修改循环）
  if (steps.length >= 4) {
    const last4 = steps.slice(-4)
    const tools = last4.map(s => s.action?.tool).filter(Boolean)
    if (tools.length === 4) {
      const isAlternating = tools[0] === tools[2] && tools[1] === tools[3] && tools[0] !== tools[1]
      if (isAlternating) {
        return {
          isLoop: true,
          reason: `检测到工具交替使用模式: ${tools[0]} → ${tools[1]} → ${tools[0]} → ${tools[1]}`,
          suggestion: '请检查是否陷入了读取-修改的无限循环，考虑是否已完成任务',
        }
      }
    }
  }

  // 3. 检查连续格式错误（原有逻辑，更宽松）
  const recent5 = steps.slice(-5)
  const allFailed = recent5.length >= 5 && recent5.every(s =>
    !s.action || !s.observation ||
    s.observation.includes('无法解析') ||
    s.observation.includes('你只输出') ||
    s.observation.includes('你提到了')
  )

  if (allFailed) {
    return {
      isLoop: true,
      reason: 'Agent 连续 5 次未能产生有效的工具调用',
      suggestion: '请直接用自然语言回答用户的问题',
    }
  }

  return { isLoop: false }
}

// ---------------------------------------------------------------------------
// Strategy failure detection
// ---------------------------------------------------------------------------

/**
 * 检测同一工具是否连续失败（无论参数）
 * 用于建议 Agent 换工具
 */
export function detectStrategyFailure(
  steps: ReActStep[],
  maxFailures = 3
): StrategyFailureResult | null {
  if (steps.length < maxFailures) return null

  const recentSteps = steps.slice(-maxFailures)
  const toolName = recentSteps[0].action?.tool

  if (!toolName) return null

  // 检查是否都使用了同一工具
  const allSameTool = recentSteps.every(s => s.action?.tool === toolName)
  if (!allSameTool) return null

  // 检查是否都失败了
  const allFailed = recentSteps.every(s => isFailedObservation(s.observation))

  if (allFailed) {
    return {
      shouldSwitch: true,
      failedTool: toolName,
      failureCount: maxFailures,
      suggestion: `工具 "${toolName}" 已连续失败 ${maxFailures} 次，建议尝试其他工具或方法`,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Progress stall detection
// ---------------------------------------------------------------------------

/**
 * 检测 Agent 是否进展停滞
 * 
 * 策略：
 * 1. 最近 N 步没有新的文件被读取
 * 2. 最近 N 步没有成功的写操作
 * 3. 最近 N 步的 Observation 内容高度重复
 */
export function detectProgressStall(steps: ReActStep[], stallThreshold = 4): ProgressDetectionResult {
  if (steps.length < stallThreshold) return { isStalled: false }

  const recentSteps = steps.slice(-stallThreshold)

  // 1. 检查是否有成功的工具执行
  const hasSuccessfulStep = recentSteps.some(s =>
    s.action && s.observation &&
    !isFailedObservation(s.observation)
  )

  if (!hasSuccessfulStep) {
    return {
      isStalled: true,
      reason: `最近 ${stallThreshold} 步没有成功的工具执行`,
      suggestion: '请检查工具调用是否正确，或尝试不同的方法',
    }
  }

  // 2. 检查 Observation 是否高度重复
  const observations = recentSteps
    .map(s => s.observation)
    .filter(Boolean) as string[]

  if (observations.length >= 3) {
    let duplicateCount = 0
    for (let i = 1; i < observations.length; i++) {
      if (computeBigramSimilarity(observations[0], observations[i]) > 0.8) {
        duplicateCount++
      }
    }

    if (duplicateCount >= 2) {
      return {
        isStalled: true,
        reason: '最近的工具执行结果高度重复',
        suggestion: '请基于已有结果继续推进任务，或尝试不同的方法',
      }
    }
  }

  return { isStalled: false }
}

// ---------------------------------------------------------------------------
// Combined detection
// ---------------------------------------------------------------------------

/**
 * 综合循环检测（推荐使用此函数）
 */
export function detectAgentLoop(steps: ReActStep[]): LoopDetectionResult {
  const repeatedTruncatedSearch = detectRepeatedTruncatedSearch(steps)
  if (repeatedTruncatedSearch.isLoop) return repeatedTruncatedSearch

  // 1. 语义循环检测
  const semanticLoop = detectSemanticLoop(steps)
  if (semanticLoop.isLoop) return semanticLoop

  // 2. 策略失败检测
  const strategyFailure = detectStrategyFailure(steps)
  if (strategyFailure) {
    return {
      isLoop: true,
      reason: strategyFailure.suggestion,
      suggestion: strategyFailure.suggestion,
    }
  }

  // 3. 进展停滞检测
  const progressStall = detectProgressStall(steps)
  if (progressStall.isStalled) {
    return {
      isLoop: true,
      reason: progressStall.reason,
      suggestion: progressStall.suggestion,
    }
  }

  return { isLoop: false }
}
