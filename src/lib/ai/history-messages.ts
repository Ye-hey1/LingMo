import { estimateTokens } from './token-counter'

type ChatLike = {
  role: string
  type: string
  content?: string | null
  condensedContent?: string | null
}

type MessageLike = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ChatTurn = {
  user: ChatLike
  assistants: ChatLike[]
}

function isPromptVisibleChat(chat: ChatLike) {
  return (chat.type === 'chat' || chat.type === 'note') && Boolean((chat.content || chat.condensedContent || '').trim())
}

function getChatContentForPrompt(chat: ChatLike) {
  return chat.role === 'user'
    ? chat.content || ''
    : chat.condensedContent || chat.content || ''
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function trimContentToTokenBudget(content: string, maxTokens: number) {
  const tokenCount = estimateTokens(content)
  if (!isFinitePositiveNumber(maxTokens) || tokenCount <= maxTokens) {
    return content
  }

  const ratio = Math.max(0.05, Math.min(1, maxTokens / Math.max(tokenCount, 1)))
  const approxChars = Math.max(80, Math.floor(content.length * ratio))
  return `${content.slice(0, approxChars).trimEnd()}\n\n[历史内容已按预算截断]`
}

function estimateMessagesTokens(messages: MessageLike[]) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
}

function buildTurnMessages(
  turn: ChatTurn,
  includeAssistantMessages: boolean,
  maxSingleMessageTokens?: number
) {
  const messages: MessageLike[] = []
  const normalizeContent = (content: string) => (
    isFinitePositiveNumber(maxSingleMessageTokens)
      ? trimContentToTokenBudget(content, maxSingleMessageTokens)
      : content
  )

  const userContent = normalizeContent(getChatContentForPrompt(turn.user))
  if (userContent) {
    messages.push({ role: 'user', content: userContent })
  }

  if (!includeAssistantMessages) {
    return messages
  }

  for (const assistant of turn.assistants) {
    const content = normalizeContent(getChatContentForPrompt(assistant))
    if (content) {
      messages.push({ role: 'assistant', content })
    }
  }

  return messages
}

function trimTurnMessagesToBudget(messages: MessageLike[], maxTokens: number) {
  const result: MessageLike[] = []
  let remaining = Math.max(0, Math.floor(maxTokens))

  for (const message of messages) {
    if (remaining <= 0) break
    const tokenCount = estimateTokens(message.content)
    if (tokenCount <= remaining) {
      result.push(message)
      remaining -= tokenCount
      continue
    }

    const content = trimContentToTokenBudget(message.content, remaining)
    if (content.trim()) {
      result.push({ ...message, content })
    }
    break
  }

  return result
}

function buildChatTurns(chats: ChatLike[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let currentTurn: ChatTurn | null = null

  for (const chat of chats) {
    if (!isPromptVisibleChat(chat)) {
      continue
    }

    if (chat.role === 'user') {
      if (currentTurn) {
        turns.push(currentTurn)
      }
      currentTurn = { user: chat, assistants: [] }
      continue
    }

    // Drop assistant/system replies that do not have a user turn. Keeping an
    // orphan answer without its question makes follow-up prompts ambiguous.
    if (currentTurn) {
      currentTurn.assistants.push(chat)
    }
  }

  if (currentTurn) {
    turns.push(currentTurn)
  }

  return turns
}

/**
 * 获取最后一次清除后的消息
 */
export function getChatsAfterLastClear<T extends ChatLike>(chats: T[]): T[] {
  const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
  return lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)
}

/**
 * 构建用于 AI 的消息历史
 */
export function buildChatHistoryForAI(chats: ChatLike[], systemPrompt?: string): MessageLike[] {
  const chatsAfterClear = getChatsAfterLastClear(chats)
  const messages: MessageLike[] = []

  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  for (const chat of chatsAfterClear) {
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    const role: 'user' | 'assistant' = chat.role === 'user' ? 'user' : 'assistant'
    const content = chat.role === 'user'
      ? chat.content || ''
      : chat.condensedContent || chat.content || ''

    if (content) {
      messages.push({ role, content })
    }
  }

  return messages
}

/**
 * 构建包含对话历史的完整 messages 数组
 */
export function buildMessagesWithHistory(
  chats: ChatLike[],
  systemPrompt?: string,
  additionalContext?: string,
  currentUserInput?: string,
  options?: {
    includeAssistantMessages?: boolean
    includeLatestUserMessage?: boolean
    maxUserMessages?: number
    maxHistoryTokens?: number
    maxSingleMessageTokens?: number
  }
): MessageLike[] {
  const messages: MessageLike[] = []
  const includeAssistantMessages = options?.includeAssistantMessages ?? true
  const includeLatestUserMessage = options?.includeLatestUserMessage ?? true
  const maxUserMessages = options?.maxUserMessages
  const maxHistoryTokens = options?.maxHistoryTokens
  const maxSingleMessageTokens = options?.maxSingleMessageTokens

  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  let turns = buildChatTurns(getChatsAfterLastClear(chats))

  if (!includeLatestUserMessage && turns.length > 0) {
    turns = turns.slice(0, -1)
  }

  if (typeof maxUserMessages === 'number' && Number.isFinite(maxUserMessages)) {
    const limit = Math.max(0, Math.floor(maxUserMessages))
    turns = limit === 0 ? [] : turns.slice(-limit)
  }

  let historyMessages: MessageLike[] = []

  if (isFinitePositiveNumber(maxHistoryTokens)) {
    const selectedTurns: MessageLike[][] = []
    let remaining = Math.floor(maxHistoryTokens)

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turnMessages = buildTurnMessages(turns[index], includeAssistantMessages, maxSingleMessageTokens)
      if (turnMessages.length === 0) continue

      const turnTokens = estimateMessagesTokens(turnMessages)
      if (turnTokens <= remaining) {
        selectedTurns.unshift(turnMessages)
        remaining -= turnTokens
        continue
      }

      if (selectedTurns.length === 0 && remaining > 0) {
        const trimmedTurn = trimTurnMessagesToBudget(turnMessages, remaining)
        if (trimmedTurn.length > 0) {
          selectedTurns.unshift(trimmedTurn)
        }
      }
      break
    }

    historyMessages = selectedTurns.flat()
  } else {
    historyMessages = turns.flatMap(turn => buildTurnMessages(turn, includeAssistantMessages, maxSingleMessageTokens))
  }

  messages.push(...historyMessages)

  if (additionalContext) {
    messages.push({
      role: 'system',
      content: additionalContext
    })
  }

  if (currentUserInput) {
    messages.push({
      role: 'user',
      content: currentUserInput
    })
  }

  return messages
}
