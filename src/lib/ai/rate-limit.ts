export function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isAiRateLimitError(error: unknown): boolean {
  const message = getErrorText(error)
  return /status=429|HTTP 429|\b429\b|rate limit|rate limiting|too many requests|TPM limit|tokens?\s+per\s+minute|requests?\s+per\s+minute/i.test(message)
}

export function isAiTpmLimitError(error: unknown): boolean {
  const message = getErrorText(error)
  return /TPM limit|tokens?\s+per\s+minute|token[s\s_-]*per[s\s_-]*minute/i.test(message)
}

export function getAiRateLimitUserMessage(error: unknown): string {
  const message = getErrorText(error)
  if (isAiTpmLimitError(message)) {
    return '当前模型已达到每分钟 Token 配额限制（TPM）。我已停止本轮继续请求，避免反复重试放大限流；请稍后重试，或切换到更高配额/更小上下文的模型。'
  }
  return '当前模型触发了 API 速率限制。我已停止本轮继续请求，避免重复调用；请稍后重试，或切换模型/降低上下文长度。'
}
