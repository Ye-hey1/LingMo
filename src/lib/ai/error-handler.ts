/**
 * 统一错误处理机制
 * 提供一致的错误处理、格式化和用户提示
 */

// ============================================================
// Types
// ============================================================

export type ErrorKind =
  | 'aborted'
  | 'connect'
  | 'timeout'
  | 'unauthorized'
  | 'billing'
  | 'rate_limit'
  | 'server'
  | 'validation'
  | 'not_found'
  | 'permission'
  | 'unknown'

export interface AppError {
  kind: ErrorKind
  title: string
  message: string
  details?: string
  retryable: boolean
  action?: string
  timestamp: number
  originalError?: unknown
}

export interface ErrorHandlerOptions {
  showToast?: boolean
  logToConsole?: boolean
  throwError?: boolean
}

// ============================================================
// Error Classification
// ============================================================

export function classifyError(error: unknown): ErrorKind {
  const message = error instanceof Error ? error.message : String(error)

  if (/Request was aborted|USER_STOPPED|cancelled/i.test(message)) return 'aborted'
  if (/AI_TRANSPORT_ERROR|error sending request|Failed to fetch|NetworkError|connect/i.test(message)) return 'connect'
  if (/timeout|timed out|TIMEOUT/i.test(message)) return 'timeout'
  if (/status=401|401|Unauthorized|invalid.*api.*key/i.test(message)) return 'unauthorized'
  if (/status=402|402|payment required|insufficient.*balance|balance.*insufficient|insufficient.*quota|quota.*insufficient|quota exceeded|billing|credits?.*(?:exhausted|insufficient)|(?:exhausted|insufficient).*credits?/i.test(message)) return 'billing'
  if (/status=429|429|rate limit|too many requests/i.test(message)) return 'rate_limit'
  if (/status=5\d\d| 5\d\d|server error|internal error/i.test(message)) return 'server'
  if (/validation|invalid.*parameter|bad request|400/i.test(message)) return 'validation'
  if (/not found|404|does not exist/i.test(message)) return 'not_found'
  if (/permission|forbidden|403|access denied/i.test(message)) return 'permission'

  return 'unknown'
}

// ============================================================
// Error Messages
// ============================================================

const ERROR_MESSAGES: Record<ErrorKind, { title: string; message: string; retryable: boolean; action?: string }> = {
  aborted: {
    title: '已停止',
    message: '请求已被用户取消',
    retryable: false,
  },
  connect: {
    title: '连接失败',
    message: '无法连接到 AI 服务，请检查网络连接和 API 配置',
    retryable: true,
    action: '检查网络连接',
  },
  timeout: {
    title: '请求超时',
    message: 'AI 服务响应超时，请稍后重试',
    retryable: true,
    action: '稍后重试',
  },
  unauthorized: {
    title: '认证失败',
    message: 'API Key 无效或已过期，请在设置中更新',
    retryable: false,
    action: '更新 API Key',
  },
  billing: {
    title: '余额不足',
    message: 'AI 服务账户余额或调用额度不足，请充值、切换模型或更换 API Key 后重试',
    retryable: false,
    action: '检查账户余额',
  },
  rate_limit: {
    title: '请求过于频繁',
    message: '已达到 API 速率限制，本轮已停止继续请求以避免反复触发限流',
    retryable: true,
    action: '稍后重试或切换模型',
  },
  server: {
    title: '服务器错误',
    message: 'AI 服务暂时不可用，请稍后重试',
    retryable: true,
    action: '稍后重试',
  },
  validation: {
    title: '参数错误',
    message: '请求参数无效，请检查输入内容',
    retryable: false,
    action: '检查输入',
  },
  not_found: {
    title: '资源不存在',
    message: '请求的资源不存在或已被删除',
    retryable: false,
  },
  permission: {
    title: '权限不足',
    message: '没有权限执行此操作',
    retryable: false,
  },
  unknown: {
    title: '未知错误',
    message: '发生了未知错误，请稍后重试',
    retryable: true,
    action: '稍后重试',
  },
}

// ============================================================
// Error Formatting
// ============================================================

export function formatError(error: unknown): AppError {
  const kind = classifyError(error)
  const template = ERROR_MESSAGES[kind]
  const originalMessage = error instanceof Error ? error.message : String(error)

  // 对于某些错误类型，使用原始消息作为详情
  const details = kind === 'unknown' ? originalMessage : undefined

  return {
    kind,
    title: template.title,
    message: template.message,
    details,
    retryable: template.retryable,
    action: template.action,
    timestamp: Date.now(),
    originalError: error,
  }
}

export function formatErrorMessage(error: unknown): string {
  const appError = formatError(error)
  return `${appError.title}: ${appError.message}`
}

// ============================================================
// Error Handler (模块级变量)
// ============================================================

// ponytail: 模块级变量替代单例类
let errorLog: AppError[] = []
const maxLogSize = 100

export function handleAIError(error: unknown, options: ErrorHandlerOptions = {}): AppError {
  const {
    showToast: _showToast = true,
    logToConsole = true,
    throwError = false,
  } = options

  const appError = formatError(error)

  // 记录到日志
  errorLog.push(appError)
  if (errorLog.length > maxLogSize) {
    errorLog.shift()
  }

  // 控制台输出
  if (logToConsole) {
    const logMethod = appError.kind === 'unknown' ? 'error' : 'warn'
    console[logMethod](`[${appError.kind}] ${appError.title}:`, appError.message, appError.details || '')
  }

  // 抛出错误
  if (throwError) {
    throw appError
  }

  return appError
}

export function getErrorLog(): AppError[] {
  return [...errorLog]
}

export function clearErrorLog(): void {
  errorLog = []
}

export function getRecentErrors(count: number = 10): AppError[] {
  return errorLog.slice(-count)
}

// ============================================================
// Convenience Functions
// ============================================================

export function isRetryableError(error: unknown): boolean {
  const kind = classifyError(error)
  return ERROR_MESSAGES[kind].retryable
}

export function getErrorAction(error: unknown): string | undefined {
  const kind = classifyError(error)
  return ERROR_MESSAGES[kind].action
}

// ============================================================
// Error Recovery Suggestions
// ============================================================

export function getRecoverySuggestion(error: unknown): string {
  const kind = classifyError(error)

  switch (kind) {
    case 'aborted':
      return '请求已取消，无需恢复'
    case 'connect':
      return '请检查：\n1. 网络连接是否正常\n2. API 地址是否正确\n3. 防火墙是否阻止连接'
    case 'timeout':
      return '请尝试：\n1. 减少输入内容长度\n2. 稍后重试\n3. 检查网络稳定性'
    case 'unauthorized':
      return '请在设置中：\n1. 检查 API Key 是否正确\n2. 确认 API Key 是否已过期\n3. 验证账户余额是否充足'
    case 'billing':
      return '请在设置中：\n1. 检查当前 API 服务账户余额\n2. 切换到仍有额度的模型或服务商\n3. 更换可用的 API Key'
    case 'rate_limit':
      return '请等待一段时间后重试，或切换到更高 TPM/RPM 配额的模型；如果本轮已有内容，系统会优先保留已有内容。'
    case 'server':
      return 'AI 服务暂时不可用，请稍后重试。如持续出现，请联系服务提供商'
    case 'validation':
      return '请检查输入内容是否符合要求'
    case 'not_found':
      return '请求的资源不存在，请检查配置'
    case 'permission':
      return '请联系管理员获取相应权限'
    default:
      return '如问题持续出现，请查看控制台日志获取详细信息'
  }
}
