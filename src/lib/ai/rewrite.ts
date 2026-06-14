import { getAISettings, prepareMessages, createOpenAIClient, handleAIError, validateAIService } from './utils';
import { createAiStreamContentProcessor, sanitizeAiRewriteOutput } from './sanitize';
import { buildWebSearchContext } from './context-builder';

const REWRITE_OUTPUT_RULE = 'Never output any thinking, reasoning, analysis, or <think> tags. Output only the final rewritten text.'
const EXPLAIN_OUTPUT_RULE = 'Never output any thinking, reasoning, analysis, or <think> tags. Output only the final explanation content.'

export interface AiExplainContext {
  before: string
  after: string
}

function trimForPrompt(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }

  return trimmed.slice(trimmed.length - maxChars)
}

function trimStartForPrompt(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }

  return trimmed.slice(0, maxChars)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Request was aborted.')
}

/**
 * 润色文本
 * @param text 要润色的文本
 * @returns 润色后的文本
 */
export async function fetchAiPolish(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 精简文本
 * @param text 要精简的文本
 * @returns 精简后的文本
 */
export async function fetchAiConcise(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 拓展文本
 * @param text 要拓展的文本
 * @returns 拓展后的文本
 */
export async function fetchAiExpand(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式润色文本
 * @param text 要润色的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiPolishStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 流式精简文本
 * @param text 要精简的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiConciseStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 流式拓展文本
 * @param text 要拓展的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiExpandStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 流式解释选中文本
 * @param text 要解释的词语或句子
 * @param context 选区前后的文章上下文
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiExplainStream(
  text: string,
  context: AiExplainContext,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    let webContext = ''
    try {
      const searchQuery = [
        text.trim(),
        trimForPrompt(`${context.before}\n${context.after}`, 600),
      ].filter(Boolean).join('\n')
      const webSearch = await buildWebSearchContext(searchQuery.slice(0, 1200), abortSignal)
      webContext = webSearch.context
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
    }

    const explainPrompt = `You are a warm, knowledgeable teacher sitting next to the reader.
Explain the selected word, phrase, or sentence in the article's context so the reader can quickly understand it.
Use the article context first. Use web search only to correct or supplement key facts; do not dump search results, framework lists, timelines, or background unless they are necessary for understanding this selection.
Respond in the same language as the surrounding article when clear; use Simplified Chinese by default for Chinese content.
Be brief and easy: normally 2-4 short sentences, about 120-220 Chinese characters or 60-100 English words.
Use everyday language, one simple analogy only if it genuinely helps, and avoid academic report tone.
Do not use Markdown headings, bold text, numbered sections, bullet lists, labels like "解释：" or "快速掌握：", or long enumerations.
Do not replace the selected text; output only the short explanation that can be inserted after it.
${EXPLAIN_OUTPUT_RULE}

Selected text:
${text}

Article context before selection:
${trimForPrompt(context.before, 1600) || '(none)'}

Article context after selection:
${trimStartForPrompt(context.after, 1600) || '(none)'}

Web search context:
${webContext || '(not available)'}

Short teacher-style explanation:`

    const { messages } = await prepareMessages(explainPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: aiConfig.temperature ?? 0.4,
      top_p: aiConfig.topP ?? 0.95,
      max_tokens: 420,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    throw error
  }
}
