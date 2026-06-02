/**
 * Token Budget Management — CJK-aware token estimation & context window budgeting
 *
 * Ported from CowAgent's agent.protocol.agent._estimate_text_tokens / _get_model_context_window
 * with TypeScript adaptations for the OpenAI message format used by LingMo.
 */

// ---------------------------------------------------------------------------
// Text-level estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a text string.
 *
 * CJK characters typically use ~1.5 tokens each,
 * while ASCII uses ~0.25 tokens per char (4 chars/token).
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  let nonAscii = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++
  }
  const asciiCount = text.length - nonAscii
  return Math.ceil(nonAscii * 1.5 + asciiCount * 0.25) + 1
}

// ---------------------------------------------------------------------------
// Message-level estimation (OpenAI format)
// ---------------------------------------------------------------------------

type OpenAIMessage = Record<string, any>

/**
 * Estimate token count for a single OpenAI-format chat message.
 *
 * Handles: plain text content, content arrays (text + image_url),
 * assistant messages with `tool_calls`, and `role=tool` messages.
 */
export function estimateMessageTokens(message: OpenAIMessage): number {
  const role = message.role as string | undefined
  const content = message.content

  // --- assistant with tool_calls ---
  if (role === 'assistant' && message.tool_calls) {
    let tokens = 50 // overhead for the message envelope
    // text content
    if (typeof content === 'string') {
      tokens += estimateTextTokens(content)
    }
    for (const tc of message.tool_calls as any[]) {
      tokens += 40 // overhead per tool_call block
      tokens += estimateTextTokens(tc.function?.name || '')
      tokens += estimateTextTokens(tc.function?.arguments || '')
    }
    return Math.max(1, tokens)
  }

  // --- tool result ---
  if (role === 'tool') {
    let tokens = 30 // overhead
    const toolContent = message.content
    if (typeof toolContent === 'string') {
      tokens += estimateTextTokens(toolContent)
    } else if (Array.isArray(toolContent)) {
      for (const part of toolContent) {
        if (typeof part === 'string') tokens += estimateTextTokens(part)
        else if (part?.text) tokens += estimateTextTokens(part.text)
      }
    }
    return Math.max(1, tokens)
  }

  // --- string content ---
  if (typeof content === 'string') {
    return Math.max(1, estimateTextTokens(content))
  }

  // --- content array ---
  if (Array.isArray(content)) {
    let tokens = 0
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      if (part.type === 'text') {
        tokens += estimateTextTokens(part.text || '')
      } else if (part.type === 'image_url') {
        tokens += 1200
      } else if (part.type === 'text' && typeof part.text === 'string') {
        tokens += estimateTextTokens(part.text)
      } else {
        tokens += 10
      }
    }
    return Math.max(1, tokens)
  }

  return 1
}

/**
 * Sum token estimates for an array of messages.
 */
export function estimateMessagesTokens(messages: OpenAIMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

// ---------------------------------------------------------------------------
// Model context window detection
// ---------------------------------------------------------------------------

/** Known context window sizes (tokens) keyed by model name substring. */
const MODEL_WINDOWS: Array<[RegExp, number]> = [
  [/deepseek-v4-flash/i, 1_048_576],
  [/claude-?3/i, 200_000],
  [/claude-?sonnet/i, 200_000],
  [/gpt-4.*turbo/i, 128_000],
  [/gpt-4.*128k/i, 128_000],
  [/gpt-4.*32k/i, 32_000],
  [/gpt-4/i, 8_000],
  [/gpt-3\.5.*16k/i, 16_000],
  [/gpt-3\.5/i, 4_000],
  [/deepseek/i, 64_000],
  [/gemini-?2/i, 2_000_000],
  [/gemini/i, 1_000_000],
  [/o[1-4]\b/i, 200_000],
  [/qwen/i, 32_000],
  [/glm/i, 128_000],
  [/moonshot/i, 128_000],
  [/doubao/i, 128_000],
]

/**
 * Infer the context window size for a given model name.
 * Falls back to 128K if unknown.
 */
export function getModelContextWindow(modelName: string): number {
  if (!modelName) return 128_000
  const lower = modelName.toLowerCase()
  for (const [re, window] of MODEL_WINDOWS) {
    if (re.test(lower)) return window
  }
  return 128_000
}

// ---------------------------------------------------------------------------
// Reserve tokens & budget helpers
// ---------------------------------------------------------------------------

/**
 * Calculate how many tokens to reserve for new requests / response generation.
 * ~10% of context window, clamped to [10K, 200K].
 */
export function getContextReserveTokens(contextWindow: number): number {
  const reserve = Math.floor(contextWindow * 0.1)
  return Math.max(10_000, Math.min(200_000, reserve))
}

export interface TrimCheckResult {
  needsTrim: boolean
  currentTokens: number
  maxTokens: number
  contextWindow: number
}

/**
 * Check whether a message list needs trimming given a model and system prompt.
 */
export function shouldTrimMessages(
  messages: OpenAIMessage[],
  modelName: string,
  systemPrompt?: string,
  contextWindowOverride?: number,
): TrimCheckResult {
  const contextWindow = contextWindowOverride && contextWindowOverride > 0
    ? contextWindowOverride
    : getModelContextWindow(modelName)
  const reserve = getContextReserveTokens(contextWindow)
  const maxTokens = contextWindow - reserve

  const systemTokens = systemPrompt ? estimateTextTokens(systemPrompt) : 0
  const msgTokens = estimateMessagesTokens(messages)
  const currentTokens = systemTokens + msgTokens

  return {
    needsTrim: currentTokens > maxTokens,
    currentTokens,
    maxTokens,
    contextWindow,
  }
}
