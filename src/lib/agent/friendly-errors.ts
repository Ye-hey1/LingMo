/**
 * 用户友好的错误消息模块
 *
 * 改进点：
 * 1. 错误分类映射
 * 2. 用户友好的错误提示
 * 3. 可恢复错误自动提供重试
 * 4. 常见问题链接
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'billing'
  | 'rate_limit'
  | 'server'
  | 'context_overflow'
  | 'model_output'
  | 'mcp_registry'
  | 'tool_not_found'
  | 'tool_execution'
  | 'policy_blocked'
  | 'user_cancelled'
  | 'runtime'
  | 'unknown'

export interface FriendlyError {
  category: ErrorCategory
  title: string
  message: string
  suggestion?: string
  retryable: boolean
  technicalDetails?: string
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: Array<{
  pattern: RegExp
  category: ErrorCategory
}> = [
  { pattern: /timeout|timed?\s*out/i, category: 'timeout' },
  { pattern: /network|fetch|econnrefused|econnreset|enotfound|dns|socket|connection|failed to fetch/i, category: 'network' },
  { pattern: /unauthorized|401|403|invalid.*key|authentication|api.?key|permission denied/i, category: 'auth' },
  { pattern: /status=402|HTTP\s+402|\b402\b|payment required|insufficient.*balance|balance.*insufficient|insufficient.*quota|quota.*insufficient|quota exceeded|billing|credits?.*(?:exhausted|insufficient)|(?:exhausted|insufficient).*credits?/i, category: 'billing' },
  { pattern: /rate.?limit|429|too many requests/i, category: 'rate_limit' },
  { pattern: /status=5\d\d|HTTP\s+5\d\d|\b5\d\d\b|upstream error|do_request_failed|server error|internal error|bad gateway|service unavailable|gateway timeout/i, category: 'server' },
  { pattern: /context.*overflow|context.*length|prompt.*too.*long|too.*large|maximum context|token.*limit/i, category: 'context_overflow' },
  { pattern: /内容不能为空|empty.*(?:final|answer|response)|final answer.*empty|model.*empty|没有返回可展示正文/i, category: 'model_output' },
  { pattern: /stale_mcp_tool_registry|mcp.*registry|tool registry changed|刷新.*工具|mcp.*not.*ready/i, category: 'mcp_registry' },
  { pattern: /tool.*not.*found|unknown.*tool/i, category: 'tool_not_found' },
  { pattern: /tool .*failed|tool.*error|工具.*失败|工具.*出错|tool execution/i, category: 'tool_execution' },
  { pattern: /blocked.*policy|policy.*blocked|not.*allowed/i, category: 'policy_blocked' },
  { pattern: /user.*cancel|cancelled|stopped/i, category: 'user_cancelled' },
  { pattern: /typeerror|referenceerror|syntaxerror|rangeerror|json|unexpected token|cannot read|undefined|null/i, category: 'runtime' },
]

export function classifyError(error: string): ErrorCategory {
  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return category
    }
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Friendly error messages
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<ErrorCategory, Omit<FriendlyError, 'technicalDetails'>> = {
  timeout: {
    category: 'timeout',
    title: '请求超时',
    message: 'AI 服务响应时间过长，可能是服务器繁忙或网络不稳定。',
    suggestion: '请稍后重试，或检查网络连接。如果问题持续，请尝试切换到其他模型。',
    retryable: true,
  },
  network: {
    category: 'network',
    title: '网络连接失败',
    message: '无法连接到 AI 服务，可能是网络问题或服务不可用。',
    suggestion: '请检查网络连接是否正常，或稍后重试。',
    retryable: true,
  },
  auth: {
    category: 'auth',
    title: '认证失败',
    message: 'API 密钥无效或已过期。',
    suggestion: '请在设置中检查并更新 API 密钥。',
    retryable: false,
  },
  billing: {
    category: 'billing',
    title: '余额不足',
    message: 'AI 服务账户余额或调用额度不足，本轮已停止继续请求。',
    suggestion: '请充值、切换到仍有额度的模型或服务商，或更换可用的 API Key 后重试。',
    retryable: false,
  },
  rate_limit: {
    category: 'rate_limit',
    title: '请求频率超限',
    message: '已达到 API 调用频率限制，本轮已停止继续请求，避免反复重试放大限流。',
    suggestion: '请稍后重试、切换到更高 TPM/RPM 配额的模型，或减少本轮上下文长度。',
    retryable: true,
  },
  server: {
    category: 'server',
    title: '上游服务异常',
    message: 'AI 服务商或其上游模型暂时不可用，本轮请求没有成功完成。',
    suggestion: '请稍后重试；如果连续出现，请切换模型或服务商。',
    retryable: true,
  },
  context_overflow: {
    category: 'context_overflow',
    title: '上下文过长',
    message: '对话历史超过了模型的上下文窗口限制。',
    suggestion: '请开启新的对话继续，或减少关联的文件数量。',
    retryable: false,
  },
  model_output: {
    category: 'model_output',
    title: '模型输出异常',
    message: '模型本轮没有返回可展示的最终正文，或输出格式不满足 Agent 收尾要求。',
    suggestion: '系统会尝试基于已有工具结果收尾；如果反复出现，请切换模型或减少本轮上下文长度。',
    retryable: true,
  },
  mcp_registry: {
    category: 'mcp_registry',
    title: 'MCP 工具状态已变化',
    message: 'MCP 工具列表在本轮运行中发生变化，当前工具调用需要刷新后重试。',
    suggestion: '请重新发送请求，系统会重新加载 MCP 工具列表。',
    retryable: true,
  },
  tool_not_found: {
    category: 'tool_not_found',
    title: '工具不存在',
    message: '尝试调用的工具不存在或未启用。',
    suggestion: '请检查工具名称是否正确，或在设置中启用相关功能。',
    retryable: false,
  },
  tool_execution: {
    category: 'tool_execution',
    title: '工具执行失败',
    message: '工具在执行过程中遇到错误。',
    suggestion: '请检查输入参数是否正确，或尝试使用其他方法。',
    retryable: true,
  },
  policy_blocked: {
    category: 'policy_blocked',
    title: '操作被阻止',
    message: '该操作被安全策略阻止。',
    suggestion: '这可能是为了保护您的数据安全。如需执行此操作，请在设置中调整权限。',
    retryable: false,
  },
  user_cancelled: {
    category: 'user_cancelled',
    title: '已取消',
    message: '操作已被用户取消。',
    retryable: false,
  },
  runtime: {
    category: 'runtime',
    title: '运行时异常',
    message: '应用运行过程中发生了代码或数据格式异常。',
    suggestion: '请重试；如果再次出现，请保留当前问题文本和最近一次工具调用信息。',
    retryable: true,
  },
  unknown: {
    category: 'unknown',
    title: '执行异常',
    message: '发生了未分类异常。',
    suggestion: '请重试；如果问题持续，请反馈错误详情。',
    retryable: true,
  },
}

function normalizeTechnicalError(error: string | Error): string {
  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean).join(': ')
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function summarizeTechnicalError(error: string, maxLength = 220) {
  const cleaned = error
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * 将原始错误转换为用户友好的错误信息
 */
export function formatFriendlyError(error: string | Error): FriendlyError {
  const errorStr = normalizeTechnicalError(error)
  const category = classifyError(errorStr)
  const template = ERROR_MESSAGES[category]
  const detail = summarizeTechnicalError(errorStr)

  if (category === 'unknown') {
    return {
      ...template,
      message: detail
        ? `发生了未分类异常：${detail}`
        : '发生了未分类异常，但底层没有返回错误详情。',
      technicalDetails: errorStr,
    }
  }

  return {
    ...template,
    technicalDetails: errorStr,
  }
}

/**
 * 格式化错误为用户显示的字符串
 */
export function formatErrorForUser(error: string | Error): string {
  const friendly = formatFriendlyError(error)

  let message = `**${friendly.title}**\n\n${friendly.message}`
  if (friendly.suggestion) {
    message += `\n\n💡 ${friendly.suggestion}`
  }

  return message
}

/**
 * 格式化错误为简短的一行消息
 */
export function formatErrorBrief(error: string | Error): string {
  const friendly = formatFriendlyError(error)
  return friendly.title
}

// ---------------------------------------------------------------------------
// Error recovery suggestions
// ---------------------------------------------------------------------------

/**
 * 获取错误恢复建议
 */
export function getErrorRecoverySuggestion(error: string | Error): {
  canRecover: boolean
  suggestion: string
  action?: 'retry' | 'new_conversation' | 'check_settings' | 'contact_support'
} {
  const friendly = formatFriendlyError(error)

  if (!friendly.retryable) {
    switch (friendly.category) {
      case 'auth':
        return {
          canRecover: true,
          suggestion: '请在设置中更新 API 密钥',
          action: 'check_settings',
        }
      case 'billing':
        return {
          canRecover: true,
          suggestion: '请检查账户余额、切换模型或更换 API Key',
          action: 'check_settings',
        }
      case 'context_overflow':
        return {
          canRecover: true,
          suggestion: '请开启新的对话',
          action: 'new_conversation',
        }
      case 'policy_blocked':
        return {
          canRecover: false,
          suggestion: '操作被安全策略阻止',
        }
      default:
        return {
          canRecover: false,
          suggestion: '请重试或反馈问题',
          action: 'contact_support',
        }
    }
  }

  return {
    canRecover: true,
    suggestion: '请重试',
    action: 'retry',
  }
}

// ---------------------------------------------------------------------------
// Error context for agent
// ---------------------------------------------------------------------------

/**
 * 生成错误上下文提示（用于 Agent 的下一轮思考）
 */
export function generateErrorContext(error: string | Error): string {
  const friendly = formatFriendlyError(error)

  switch (friendly.category) {
    case 'timeout':
      return '上一步操作超时。请尝试简化操作或分步骤执行。'
    case 'network':
      return '网络连接失败。请检查网络状态，或尝试使用不需要网络的工具。'
    case 'billing':
      return 'AI 服务账户余额或调用额度不足。请停止本轮继续请求，并提示用户检查余额、切换模型或更换 API Key。'
    case 'rate_limit':
      return '已达到 API 调用限制。请停止本轮继续请求，保留已有结果，等待一段时间后继续或切换模型。'
    case 'server':
      return 'AI 服务商或上游模型暂时不可用。请停止本轮继续请求，提示用户稍后重试或切换模型/服务商。'
    case 'context_overflow':
      return '上下文已满。请总结当前进展并给出最终答案，不要再调用工具。'
    case 'tool_not_found':
      return '工具不存在。请使用可用工具列表中的工具。'
    case 'tool_execution':
      return '工具执行失败。请检查参数是否正确，或尝试使用其他工具。'
    default:
      return '遇到了错误。请尝试其他方法或直接回答用户。'
  }
}
