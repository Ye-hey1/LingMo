/**
 * 工具结果预算管理器
 *
 * 借鉴 claude-code-source 的 applyToolResultBudget 设计：
 * 当工具返回大量数据时，智能裁剪以保持在模型的上下文窗口内，
 * 同时保留关键信息（错误消息、摘要、结构化数据）。
 */

const DEFAULT_MAX_RESULT_CHARS = 8000
const DEFAULT_MAX_ARRAY_ITEMS = 20
const DEFAULT_MAX_STRING_LENGTH = 500

interface BudgetConfig {
  /** 单个工具结果的最大字符数 */
  maxResultChars: number
  /** 数组类型字段的最大条目数 */
  maxArrayItems: number
  /** 字符串字段的最大长度 */
  maxStringLength: number
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxResultChars: DEFAULT_MAX_RESULT_CHARS,
  maxArrayItems: DEFAULT_MAX_ARRAY_ITEMS,
  maxStringLength: DEFAULT_MAX_STRING_LENGTH,
}

/**
 * 对工具结果应用预算限制
 */
export function applyToolResultBudget(
  result: string,
  budget: Partial<BudgetConfig> = {},
): string {
  const config = { ...DEFAULT_BUDGET, ...budget }

  if (result.length <= config.maxResultChars) {
    return result
  }

  // 1. 如果结果包含结构化数据（JSON），尝试精简
  const trimmed = tryTrimStructuredResult(result, config)
  if (trimmed.length <= config.maxResultChars) {
    return trimmed
  }

  // 2. 保留开头和结尾，中间省略
  const headSize = Math.floor(config.maxResultChars * 0.6)
  const tailSize = Math.floor(config.maxResultChars * 0.3)
  const omittedSize = result.length - headSize - tailSize

  return [
    result.slice(0, headSize),
    '',
    `... (省略 ${omittedSize} 字符) ...`,
    '',
    result.slice(-tailSize),
  ].join('\n')
}

/**
 * 对结构化结果（JSON）进行精简
 */
function tryTrimStructuredResult(result: string, config: BudgetConfig): string {
  // 尝试检测 JSON 数组或对象
  const trimmedInput = result.trim()
  if (!trimmedInput.startsWith('{') && !trimmedInput.startsWith('[')) {
    return result
  }

  try {
    const parsed = JSON.parse(trimmedInput)
    const trimmed = trimJsonValue(parsed, config)
    return JSON.stringify(trimmed, null, 2)
  } catch {
    return result
  }
}

function trimJsonValue(value: any, config: BudgetConfig, depth = 0): any {
  if (depth > 10) return '...'

  if (typeof value === 'string') {
    if (value.length > config.maxStringLength) {
      return value.slice(0, config.maxStringLength) + '...'
    }
    return value
  }

  if (Array.isArray(value)) {
    if (value.length > config.maxArrayItems) {
      const kept = value.slice(0, config.maxArrayItems).map(item => trimJsonValue(item, config, depth + 1))
      return [...kept, `... (${value.length - config.maxArrayItems} more items)`]
    }
    return value.map(item => trimJsonValue(item, config, depth + 1))
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = trimJsonValue(val, config, depth + 1)
    }
    return result
  }

  return value
}

/**
 * 估算工具结果的 token 数量
 * 简化估算：CJK 字符 ≈ 1.5 token，其他 ≈ 0.25 token
 */
export function estimateTokenCount(text: string): number {
  let tokens = 0
  for (const char of text) {
    // CJK Unified Ideographs and common CJK punctuation
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      tokens += 1.5
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

/**
 * 根据模型的上下文窗口计算可用的工具结果预算
 */
export function calculateAvailableBudget(
  contextWindow: number,
  usedTokens: number,
  systemPromptTokens: number,
  pendingToolResults: number,
): number {
  // 预留 30% 给模型输出和系统开销
  const reserved = contextWindow * 0.3
  const available = contextWindow - reserved - usedTokens - systemPromptTokens
  // 给每个待处理的工具结果分配平均预算
  if (pendingToolResults <= 0) return DEFAULT_MAX_RESULT_CHARS
  return Math.max(2000, Math.floor(available / pendingToolResults))
}
