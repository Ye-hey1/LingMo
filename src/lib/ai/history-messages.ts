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
  }
): MessageLike[] {
  const messages: MessageLike[] = []
  const includeAssistantMessages = options?.includeAssistantMessages ?? true
  const includeLatestUserMessage = options?.includeLatestUserMessage ?? true
  const maxUserMessages = options?.maxUserMessages

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

  for (const turn of turns) {
    const userContent = getChatContentForPrompt(turn.user)
    if (userContent) {
      messages.push({ role: 'user', content: userContent })
    }

    if (!includeAssistantMessages) {
      continue
    }

    for (const assistant of turn.assistants) {
      const content = getChatContentForPrompt(assistant)
      if (content) {
        messages.push({ role: 'assistant', content })
      }
    }
  }

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
