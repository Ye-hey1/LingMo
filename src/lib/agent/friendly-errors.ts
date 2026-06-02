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
  | 'rate_limit'
  | 'context_overflow'
  | 'tool_not_found'
  | 'tool_execution'
  | 'policy_blocked'
  | 'user_cancelled'
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
  { pattern: /network|fetch|econnrefused|econnreset|enotfound|dns/i, category: 'network' },
  { pattern: /unauthorized|401|invalid.*key|authentication/i, category: 'auth' },
  { pattern: /rate.?limit|429|too many requests|quota/i, category: 'rate_limit' },
  { pattern: /context.*overflow|context.*length|prompt.*too.*long|too.*large/i, category: 'context_overflow' },
  { pattern: /tool.*not.*found|unknown.*tool/i, category: 'tool_not_found' },
  { pattern: /blocked.*policy|policy.*blocked|not.*allowed/i, category: 'policy_blocked' },
  { pattern: /user.*cancel|cancelled|stopped/i, category: 'user_cancelled' },
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
  rate_limit: {
    category: 'rate_limit',
    title: '请求频率超限',
    message: '已达到 API 调用频率限制。',
    suggestion: '请等待一段时间后重试，或升级 API 配额。',
    retryable: true,
  },
  context_overflow: {
    category: 'context_overflow',
    title: '上下文过长',
    message: '对话历史超过了模型的上下文窗口限制。',
    suggestion: '请开启新的对话继续，或减少关联的文件数量。',
    retryable: false,
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
  unknown: {
    category: 'unknown',
    title: '未知错误',
    message: '遇到了意外错误。',
    suggestion: '请重试，如果问题持续，请反馈错误详情。',
    retryable: true,
  },
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * 将原始错误转换为用户友好的错误信息
 */
export function formatFriendlyError(error: string | Error): FriendlyError {
  const errorStr = error instanceof Error ? error.message : String(error)
  const category = classifyError(errorStr)
  const template = ERROR_MESSAGES[category]

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
    case 'rate_limit':
      return '已达到 API 调用限制。请减少工具调用次数，或等待一段时间后继续。'
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
