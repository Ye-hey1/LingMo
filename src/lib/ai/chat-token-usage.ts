import type { Chat } from '@/db/chats'
import { estimateTokens } from './token-counter'
import { parseStoredAgentHistory } from './citations'

export interface ChatTokenUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
  estimatedTokens: number
  totalTokens: number
  hasMeasuredUsage: boolean
}

export function emptyChatTokenUsage(): ChatTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    estimatedTokens: 0,
    totalTokens: 0,
    hasMeasuredUsage: false,
  }
}

function addUsage(target: ChatTokenUsage, usage: Partial<ChatTokenUsage>) {
  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  target.reasoningTokens += usage.reasoningTokens || 0
  target.cachedReadTokens += usage.cachedReadTokens || 0
  target.cachedWriteTokens += usage.cachedWriteTokens || 0
  target.estimatedTokens += usage.estimatedTokens || 0
  target.totalTokens += usage.totalTokens || 0
  target.hasMeasuredUsage = target.hasMeasuredUsage || usage.hasMeasuredUsage === true
}

function safeText(value?: string) {
  return value?.trim() || ''
}

function extractMeasuredUsage(chat: Chat): ChatTokenUsage | null {
  if (chat.role !== 'system') return null

  const history = parseStoredAgentHistory(chat.agentHistory)
  const telemetry = history?.partSnapshot?.telemetry || history?.telemetry
  const inputTokens = telemetry?.inputTokens || 0
  const outputTokens = telemetry?.outputTokens || 0

  if (inputTokens <= 0 && outputTokens <= 0) return null

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    estimatedTokens: 0,
    totalTokens: inputTokens + outputTokens,
    hasMeasuredUsage: true,
  }
}

export function estimateChatMessageTokens(chat: Chat): ChatTokenUsage {
  const measured = extractMeasuredUsage(chat)
  if (measured) return measured

  const textParts = [
    safeText(chat.content),
    safeText(chat.thinking),
    safeText(chat.condensedContent),
  ]

  if (chat.role === 'system') {
    const history = parseStoredAgentHistory(chat.agentHistory)
    if (history) {
      textParts.push(
        safeText(history.partSnapshot?.finalAnswerContent),
        ...(history.partSnapshot?.parts || [])
          .filter(part => part.visibility !== 'hidden')
          .map(part => {
            if (part.type === 'text' || part.type === 'reasoning') return safeText(part.text)
            if (part.type === 'tool') {
              return [
                part.toolName,
                JSON.stringify(part.params || {}),
                typeof part.result?.message === 'string' ? part.result.message : '',
                typeof part.result?.error === 'string' ? part.result.error : '',
              ].filter(Boolean).join('\n')
            }
            if (part.type === 'status') return [part.label, part.detail].filter(Boolean).join(' ')
            if (part.type === 'error') return part.message
            return ''
          }),
      )
    }
  }

  const combined = Array.from(new Set(textParts.filter(Boolean))).join('\n')
  const estimatedTokens = estimateTokens(combined)

  return {
    inputTokens: chat.role === 'user' ? estimatedTokens : 0,
    outputTokens: chat.role === 'system' ? estimatedTokens : 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    estimatedTokens,
    totalTokens: estimatedTokens,
    hasMeasuredUsage: false,
  }
}

export function estimateChatsTokenUsage(chats: Chat[]): ChatTokenUsage {
  const usage = emptyChatTokenUsage()
  for (const chat of chats) {
    addUsage(usage, estimateChatMessageTokens(chat))
  }
  return usage
}

export function buildContextTokenUsage(input: {
  inputText: string
  chats: Chat[]
  maxHistoryMessages?: number
}): ChatTokenUsage {
  const usage = estimateChatsTokenUsage(
    typeof input.maxHistoryMessages === 'number'
      ? input.chats.slice(-input.maxHistoryMessages)
      : input.chats,
  )
  const inputTokens = estimateTokens(input.inputText)
  usage.inputTokens += inputTokens
  usage.estimatedTokens += inputTokens
  usage.totalTokens += inputTokens
  return usage
}

export function buildLatestContextTokenUsage(input: {
  inputText: string
  chats: Chat[]
  maxFallbackHistoryMessages?: number
}): ChatTokenUsage {
  const latestMeasured = [...input.chats]
    .reverse()
    .map(extractMeasuredUsage)
    .find((usage): usage is ChatTokenUsage => Boolean(usage))

  if (!latestMeasured) {
    return buildContextTokenUsage({
      inputText: input.inputText,
      chats: input.chats,
      maxHistoryMessages: input.maxFallbackHistoryMessages,
    })
  }

  const usage = { ...latestMeasured }
  const inputTokens = estimateTokens(input.inputText)
  usage.inputTokens += inputTokens
  usage.estimatedTokens += inputTokens
  usage.totalTokens += inputTokens
  return usage
}
