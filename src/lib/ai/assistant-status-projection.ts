export type AssistantStatusPhase =
  | 'pending'
  | 'thinking'
  | 'answering'
  | 'done'
  | 'sources'
  | 'blocked'

export type AssistantStatusTone = 'running' | 'done' | 'error' | 'muted'

export const ASSISTANT_STATUS_PHASE_MIN_DWELL_MS = 420
export const ASSISTANT_STATUS_DONE_DWELL_MS = 220

export function resolveChatAssistantStatusPhase({
  isStreaming,
  hasThinkingContent,
  hasAnswerContent,
  hasCitations,
}: {
  isStreaming: boolean
  hasThinkingContent: boolean
  hasAnswerContent: boolean
  hasCitations: boolean
}): AssistantStatusPhase {
  if (isStreaming) {
    if (hasAnswerContent) return 'answering'
    if (hasThinkingContent) return 'thinking'
    return 'pending'
  }

  if (hasThinkingContent) return 'done'
  return hasCitations ? 'sources' : 'done'
}

export function getAssistantStatusLabel(
  phase: AssistantStatusPhase,
  tone: AssistantStatusTone = phase === 'done' || phase === 'sources' ? 'done' : 'running',
) {
  if (tone === 'error' || phase === 'blocked') {
    return '思考受阻'
  }

  switch (phase) {
    case 'pending':
      return tone === 'running' ? '正在思考' : '已思考'
    case 'thinking':
      return tone === 'running' ? '思考中' : '已思考'
    case 'answering':
      return tone === 'running' ? '正在回复' : '输出完成'
    case 'sources':
      return '引用来源'
    case 'done':
    default:
      return '已思考'
  }
}

export function getAssistantLiveHeadlineLabel(input: {
  phase?: AssistantStatusPhase
  label?: string
  tone?: AssistantStatusTone
  fallback?: string
}) {
  const tone = input.tone || 'running'
  const label = input.label?.trim()

  if (tone === 'error') {
    return label || getAssistantStatusLabel('blocked', 'error')
  }

  if (tone !== 'running') {
    return label || input.fallback || getAssistantStatusLabel(input.phase || 'done', tone)
  }

  if (
    input.phase === 'pending' ||
    input.phase === 'thinking' ||
    label === '正在请求模型' ||
    label === '思考中'
  ) {
    return getAssistantStatusLabel('pending', 'running')
  }

  if (
    input.phase === 'answering' ||
    label === '正在输出' ||
    label === '正在写答案' ||
    label === '正在流式输出回答'
  ) {
    return getAssistantStatusLabel('answering', 'running')
  }

  return label || input.fallback || '正在处理'
}

export function isAssistantThinkingLabel(label?: string) {
  return Boolean(label && [
    getAssistantStatusLabel('pending', 'running'),
    getAssistantStatusLabel('thinking', 'running'),
    getAssistantStatusLabel('thinking', 'done'),
    '正在请求模型',
    '已请求模型',
  ].includes(label.trim()))
}

export function isAssistantAnsweringLabel(label?: string) {
  return Boolean(label && [
    getAssistantStatusLabel('answering', 'running'),
    getAssistantStatusLabel('answering', 'done'),
    '正在写答案',
    '正在输出',
    '正在流式输出回答',
  ].includes(label.trim()))
}

export function isAssistantStatusActive(phase: AssistantStatusPhase) {
  return phase === 'pending' || phase === 'thinking'
}

export function isAssistantStatusStreaming(phase: AssistantStatusPhase) {
  return phase === 'pending' || phase === 'thinking' || phase === 'answering'
}
