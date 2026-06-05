/**
 * Intelligent Context Trimming — turn-aware message history management.
 * Adapted for LingMo's OpenAI-format message arrays and the ReAct loop.
 */

import {
  estimateMessageTokens,
  estimateMessagesTokens,
  getModelContextWindow,
  getContextReserveTokens,
} from './token-budget'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  /** Ordered messages that form this logical turn. */
  messages: Record<string, any>[]
}

export interface TrimOptions {
  /** Model name (used to determine context window). */
  modelName: string
  /** System prompt text (token budget is subtracted). */
  systemPrompt?: string
  /** Maximum conversation turns to keep (default 30). */
  maxTurns?: number
  /** Explicit context window override from the selected model config. */
  contextWindow?: number
  /** Maximum characters to keep in non-primary system context messages. */
  maxSystemMessageChars?: number
}

// ---------------------------------------------------------------------------
// Turn identification
// ---------------------------------------------------------------------------

/**
 * Identify complete conversation turns in a message list.
 *
 * A "turn" begins with a real user text message and includes all
 * subsequent assistant / tool messages until the next user text message.
 */
export function identifyCompleteTurns(messages: Record<string, any>[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn = { messages: [] }

  for (const msg of messages) {
    const role = msg.role as string | undefined
    const content = msg.content

    if (role === 'user') {
      // Determine if this is a real user query (not a tool_result carrier)
      let isUserQuery = false
      if (typeof content === 'string') {
        isUserQuery = true
      } else if (Array.isArray(content)) {
        const hasText = content.some(
          (b: any) => b && typeof b === 'object' && b.type === 'text'
        )
        const hasToolResult = content.some(
          (b: any) => b && typeof b === 'object' && b.type === 'tool_result'
        )
        isUserQuery = hasText && !hasToolResult
      }

      if (isUserQuery) {
        if (currentTurn.messages.length > 0) {
          turns.push(currentTurn)
        }
        currentTurn = { messages: [msg] }
      } else {
        currentTurn.messages.push(msg)
      }
    } else {
      currentTurn.messages.push(msg)
    }
  }

  if (currentTurn.messages.length > 0) {
    turns.push(currentTurn)
  }

  return turns
}

// ---------------------------------------------------------------------------
// Historical tool result truncation
// ---------------------------------------------------------------------------

const MAX_HISTORY_RESULT_CHARS = 20_000

/**
 * Truncate tool_result content in historical messages to reduce context size.
 * Current-turn results are left intact.
 */
export function truncateHistoricalToolResults(messages: Record<string, any>[]): number {
  if (messages.length < 2) return 0

  // Find current turn start (last user text message)
  let currentTurnStart = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const content = msg.content
      if (typeof content === 'string' ||
        (Array.isArray(content) && content.some((b: any) => b?.type === 'text'))) {
        currentTurnStart = i
        break
      }
    }
  }

  let truncatedCount = 0
  for (let i = 0; i < currentTurnStart; i++) {
    const msg = messages[i]
    if (msg.role !== 'tool') continue
    const content = msg.content
    if (typeof content === 'string' && content.length > MAX_HISTORY_RESULT_CHARS) {
      msg.content =
        content.slice(0, MAX_HISTORY_RESULT_CHARS) +
        `\n\n[Historical output truncated: ${content.length} -> ${MAX_HISTORY_RESULT_CHARS} chars]`
      truncatedCount++
    }
  }

  return truncatedCount
}

// ---------------------------------------------------------------------------
// Compress turn to text-only (strip tool chains)
// ---------------------------------------------------------------------------

/**
 * Compress a full turn (with tool chains) into a lightweight text-only turn
 * that keeps only the first user text and the last assistant text.
 */
export function compressTurnToTextOnly(turn: ConversationTurn): ConversationTurn {
  let userText = ''
  let lastAssistantText = ''

  for (const msg of turn.messages) {
    const role = msg.role as string | undefined
    const content = msg.content

    if (role === 'user') {
      if (!userText) {
        if (typeof content === 'string') {
          userText = content.trim()
        } else if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'text' && b.text) { userText = b.text.trim(); break }
          }
        }
      }
    } else if (role === 'assistant') {
      const text = typeof content === 'string'
        ? content.trim()
        : ''
      if (text) lastAssistantText = text
    }
  }

  const compressed: Record<string, any>[] = []
  if (userText) compressed.push({ role: 'user', content: userText })
  if (lastAssistantText) compressed.push({ role: 'assistant', content: lastAssistantText })

  return { messages: compressed }
}

// ---------------------------------------------------------------------------
// Main trim function
// ---------------------------------------------------------------------------

const COMPRESS_THRESHOLD = 5 // turns
const DEFAULT_SYSTEM_CONTEXT_CHARS = 60_000
const AGGRESSIVE_SYSTEM_CONTEXT_CHARS = 30_000

/**
 * Intelligent context trimming.
 *
 * Strategy:
 * 1. Truncate large tool results in historical turns
 * 2. If turn count exceeds maxTurns, remove older half
 * 3. If token budget exceeded:
 *    - Few turns (<5): compress all turns to text-only
 *    - Many turns (>=5): discard older half
 */
export function trimMessages(
  messages: Record<string, any>[],
  options: TrimOptions,
): Record<string, any>[] {
  if (!messages.length) return messages

  const maxTurns = options.maxTurns ?? 30

  // Step 1: truncate historical tool results
  truncateHistoricalToolResults(messages)

  // Step 2: identify complete turns
  let turns = identifyCompleteTurns(messages)
  if (!turns.length) return messages

  // Step 3: turn count limit
  if (turns.length > maxTurns) {
    const keepCount = Math.ceil(turns.length / 2)
    turns = turns.slice(-keepCount)
  }

  // Step 4: token budget check
  const contextWindow = options.contextWindow && options.contextWindow > 0
    ? options.contextWindow
    : getModelContextWindow(options.modelName)
  const reserve = getContextReserveTokens(contextWindow)
  const maxTokens = contextWindow - reserve
  const systemTokens = options.systemPrompt
    ? estimateMessageTokens({ role: 'system', content: options.systemPrompt })
    : 0
  const currentTokens =
    systemTokens + turns.reduce((sum, t) => sum + estimateMessagesTokens(t.messages), 0)

  if (currentTokens <= maxTokens) {
    // Under budget — reconstruct and return
    const result: Record<string, any>[] = []
    for (const t of turns) result.push(...t.messages)
    return result
  }

  // Over budget
  if (turns.length < COMPRESS_THRESHOLD) {
    // Few turns: compress all to text-only, never discard
    const compressed = turns.map(compressTurnToTextOnly).filter(t => t.messages.length > 0)
    const result: Record<string, any>[] = []
    for (const t of compressed) result.push(...t.messages)
    return result
  }

  // Many turns: discard older half
  const keepCount = Math.ceil(turns.length / 2)
  turns = turns.slice(-keepCount)

  const result: Record<string, any>[] = []
  for (const t of turns) result.push(...t.messages)
  return result
}

function cloneMessage(message: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(message))
}

function truncateStringContent(value: string, maxChars: number, label: string): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars)}\n\n[${label}: ${value.length - maxChars} chars omitted]`
}

function truncateMessageContent(
  message: Record<string, any>,
  maxChars: number,
  label: string,
): Record<string, any> {
  const cloned = cloneMessage(message)
  const content = cloned.content

  if (typeof content === 'string') {
    cloned.content = truncateStringContent(content, maxChars, label)
    return cloned
  }

  if (Array.isArray(content)) {
    let remaining = maxChars
    cloned.content = content.map((part: any) => {
      if (!part || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') {
        return part
      }

      const next = { ...part }
      next.text = truncateStringContent(part.text, Math.max(0, remaining), label)
      remaining = Math.max(0, remaining - part.text.length)
      return next
    })
  }

  return cloned
}

function splitSystemMessages(messages: Record<string, any>[]) {
  const systemMessages: Record<string, any>[] = []
  const conversationMessages: Record<string, any>[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      systemMessages.push(message)
    } else {
      conversationMessages.push(message)
    }
  }

  return { systemMessages, conversationMessages }
}

function preserveSystemMessages(
  systemMessages: Record<string, any>[],
  maxSystemMessageChars: number,
): Record<string, any>[] {
  return systemMessages.map((message, index) => {
    if (index === 0) {
      return cloneMessage(message)
    }

    return truncateMessageContent(
      message,
      maxSystemMessageChars,
      'System context trimmed for ReAct budget',
    )
  })
}

/**
 * Trim conversation history without dropping system instructions/context.
 *
 * The ReAct loop carries tool state as complete thought/action/observation
 * steps. Preserving system messages separately keeps the current task rules
 * and injected workspace context available while older chat turns are trimmed.
 */
export function trimMessagesPreservingSystem(
  messages: Record<string, any>[],
  options: TrimOptions,
): Record<string, any>[] {
  if (!messages.length) return messages

  const { systemMessages, conversationMessages } = splitSystemMessages(messages)
  const preservedSystem = preserveSystemMessages(
    systemMessages,
    options.maxSystemMessageChars ?? DEFAULT_SYSTEM_CONTEXT_CHARS,
  )
  const trimmedConversation = trimMessages(conversationMessages.map(cloneMessage), options)

  return [...preservedSystem, ...trimmedConversation]
}

// ---------------------------------------------------------------------------
// Aggressive trim for overflow recovery
// ---------------------------------------------------------------------------

const AGGRESSIVE_RESULT_LIMIT = 10_000
const AGGRESSIVE_USER_MSG_LIMIT = 10_000
const AGGRESSIVE_KEEP_TURNS = 5

/**
 * Aggressively trim context after a context-overflow error from the API.
 *
 * 1. Truncate ALL tool results to 10K chars
 * 2. Truncate large tool_call arguments in assistant messages
 * 3. Truncate long user messages
 * 4. Keep only the last 5 turns
 *
 * Returns trimmed copy (original not mutated).
 */
export function aggressiveTrimForOverflow(messages: Record<string, any>[]): Record<string, any>[] {
  if (!messages.length) return messages

  // Deep clone so we don't mutate the source
  const cloned: Record<string, any>[] = JSON.parse(JSON.stringify(messages))

  // Step 1: truncate tool results & tool_call arguments
  for (const msg of cloned) {
    const role = msg.role
    const content = msg.content

    // Truncate role=tool content
    if (role === 'tool' && typeof content === 'string' && content.length > AGGRESSIVE_RESULT_LIMIT) {
      msg.content =
        content.slice(0, AGGRESSIVE_RESULT_LIMIT) +
        `\n\n[Truncated for context recovery: ${content.length} -> ${AGGRESSIVE_RESULT_LIMIT} chars]`
    }

    // Truncate tool_calls arguments in assistant messages
    if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const args = tc.function?.arguments
        if (typeof args === 'string' && args.length > AGGRESSIVE_RESULT_LIMIT) {
          tc.function.arguments =
            args.slice(0, AGGRESSIVE_RESULT_LIMIT) +
            `... [truncated ${args.length} chars]`
        }
      }
    }

    // Truncate long user messages
    if (role === 'user') {
      if (typeof content === 'string' && content.length > AGGRESSIVE_USER_MSG_LIMIT) {
        msg.content =
          content.slice(0, AGGRESSIVE_USER_MSG_LIMIT) +
          `\n\n[Message truncated for context recovery: ${content.length} -> ${AGGRESSIVE_USER_MSG_LIMIT} chars]`
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > AGGRESSIVE_USER_MSG_LIMIT) {
            block.text =
              block.text.slice(0, AGGRESSIVE_USER_MSG_LIMIT) +
              `\n\n[Message truncated for context recovery: ${block.text.length} -> ${AGGRESSIVE_USER_MSG_LIMIT} chars]`
          }
        }
      }
    }
  }

  // Step 2: keep only last N turns
  const turns = identifyCompleteTurns(cloned)
  if (turns.length > AGGRESSIVE_KEEP_TURNS) {
    const kept = turns.slice(-AGGRESSIVE_KEEP_TURNS)
    const result: Record<string, any>[] = []
    for (const t of kept) result.push(...t.messages)
    return result
  }

  return cloned
}

/**
 * Aggressive overflow recovery that still preserves system instructions.
 */
export function aggressiveTrimForOverflowPreservingSystem(
  messages: Record<string, any>[],
): Record<string, any>[] {
  if (!messages.length) return messages

  const { systemMessages, conversationMessages } = splitSystemMessages(messages)
  const preservedSystem = preserveSystemMessages(systemMessages, AGGRESSIVE_SYSTEM_CONTEXT_CHARS)
  const trimmedConversation = aggressiveTrimForOverflow(conversationMessages)

  return [...preservedSystem, ...trimmedConversation]
}
