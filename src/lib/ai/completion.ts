import { getAISettings, validateAIService, createOpenAIClient, handleAIError } from './utils';
import {
  buildPromptFromContext,
  buildWritingContinuationPrompt,
  type CompletionContext,
} from './completion-context';

export class AICompletionUnavailableError extends Error {
  constructor(message = 'AI service not configured') {
    super(message)
    this.name = 'AICompletionUnavailableError'
  }
}

interface CompletionRequestOptions {
  showErrorToast?: boolean
  maxTokens?: number
}

function isAbortError(error: unknown) {
  return error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'Request was aborted.')
}

async function hasConfiguredCompletionService(
  baseURL: string | undefined,
  showErrorToast: boolean
) {
  if (showErrorToast) {
    return await validateAIService(baseURL) !== null
  }

  return Boolean(baseURL)
}

/**
 * 清理补全结果
 */
function cleanupCompletion(text: string): string {
  return text
    .trim()
    .replace(/^```[\s\S]*?```$/g, '')
    .replace(/^```\w*\s*/g, '')
    .replace(/\s*```$/g, '')
    .replace(/^[\s\n]+|[\s\n]+$/g, '')
    .replace(/^["'""жат]|["'""жат]$/g, '')
    .replace(/^续写[：:]\s*/i, '')
    .replace(/^补全[：:]\s*/i, '')
    .replace(/^Continuation[:\s]*/i, '')
    .trim()
}

function cleanupCompletionPrefix(text: string): string {
  return text
    .replace(/^```[\s\S]*?```$/g, '')
    .replace(/^```\w*\s*/g, '')
    .replace(/^["'""жат]/g, '')
    .replace(/^续写[：:]\s*/i, '')
    .replace(/^补全[：:]\s*/i, '')
    .replace(/^Continuation[:\s]*/i, '')
}

/**
 * 补全专用 System Prompt
 * 定义角色、规则和 few-shot 示例，确保输出稳定且高质量
 */
const COMPLETION_SYSTEM_PROMPT = `You are an intelligent text completion assistant integrated into a writing editor. Your role is to predict and complete the user's next words or sentences.

Rules:
- Return ONLY the continuation text, nothing else
- Match the writing style, tone, and formality of the surrounding text
- Complete naturally -- the result should read as if the user typed it themselves
- Keep completions concise (1 sentence for inline, 1-2 sentences for paragraph continuation)
- Never use code blocks, markdown formatting, or special syntax
- Never add explanations, labels, or meta-commentary
- Match the language of the context exactly

Few-shot examples:

Context: "在机器学习中，反向传播算法的核心思想"
Completion: "是通过计算损失函数对每个参数的梯度，然后沿着梯度下降的方向更新参数。"

Context: "The most important feature of React hooks is that they"
Completion: "allow you to use state and other React features without writing a class component."

Context: "今天天气真好，"
Completion: "适合出去散步。"`

const WRITING_CONTINUATION_SYSTEM_PROMPT = `You are an AI writing continuation assistant integrated into a Markdown editor.

Your job is to continue the user's document at the cursor position.

Rules:
- Return ONLY the text that should be inserted at the cursor.
- Continue from the provided context, matching the original language, style, tone, and structure.
- Produce complete sentences and stop at a natural boundary.
- Do not stop mid-sentence, mid-word, or with an unfinished list item.
- Do not repeat the context before the cursor.
- Do not repeat existing text after the cursor.
- Do not add explanations, labels, wrappers, or code fences.`

/**
 * 传统的简单补全 prompt（向后兼容，不传 richContext 时使用）
 */
function buildLegacyPrompt(context: string): string {
  return `Continue the following text naturally. Requirements:
- Return ONLY the continuation text (1 sentence)
- Use the same language as the context
- Do NOT use code blocks, markdown formatting, or special syntax
- Return plain text only

Context:
${context}

Continuation:`
}

function buildCompletionMessages(context: string, richContext?: CompletionContext) {
  return richContext
    ? [
        { role: 'system' as const, content: COMPLETION_SYSTEM_PROMPT },
        { role: 'user' as const, content: buildPromptFromContext(richContext, context) },
      ]
    : [
        { role: 'user' as const, content: buildLegacyPrompt(context) },
      ]
}

/**
 * 快速生成代码/文本补全
 * 专门用于内联补全，使用更少的上下文和更快的响应
 */
export async function fetchCompletion(
  context: string,
  abortSignal?: AbortSignal,
  richContext?: CompletionContext,
  options: CompletionRequestOptions = {}
): Promise<string> {
  try {
    // 获取AI设置（使用快速补全模型），若未配置则自动降级到主力模型
    const aiConfig = await getAISettings('completionModel') || await getAISettings('primaryModel')
    const showErrorToast = options.showErrorToast ?? true

    // 验证AI服务
    if (!await hasConfiguredCompletionService(aiConfig?.baseURL, showErrorToast)) return ''

    const openai = await createOpenAIClient(aiConfig)

    const messages = buildCompletionMessages(context, richContext)

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: richContext ? 0.65 : 0.7,
      max_tokens: options.maxTokens ?? (richContext ? 140 : 80),
      top_p: 0.95,
    }, {
      signal: abortSignal
    })

    const result = completion.choices[0]?.message?.content || ''
    return cleanupCompletion(result)
  } catch (error) {
    if (!isAbortError(error)) {
      handleAIError(error, options.showErrorToast ?? true)
    }
    return ''
  }
}

/**
 * 流式获取补全结果
 * 实时将生成的文本插入到编辑器中
 *
 * @param context 上下文文本
 * @param onChunk 流式回调
 * @param abortSignal 取消信号
 * @param richContext 多级上下文（可选，传入时使用 System Prompt + 差异化 prompt）
 */
export async function fetchCompletionStream(
  context: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  richContext?: CompletionContext,
  options: CompletionRequestOptions = {}
): Promise<void> {
  try {
    // 获取AI设置（使用快速补全模型），若未配置则自动降级到主力模型
    const aiConfig = await getAISettings('completionModel') || await getAISettings('primaryModel')
    const showErrorToast = options.showErrorToast ?? true

    // 验证AI服务
    if (!await hasConfiguredCompletionService(aiConfig?.baseURL, showErrorToast)) {
      throw new AICompletionUnavailableError()
    }

    const openai = await createOpenAIClient(aiConfig)

    // 根据是否传入 richContext 选择 prompt 构建策略
    const messages = buildCompletionMessages(context, richContext)

    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: 0.7,
      max_tokens: options.maxTokens ?? (richContext ? 120 : 80),
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        const next = isFirst ? cleanupCompletionPrefix(content) : content
        if (next) {
          onChunk(next, isFirst)
          isFirst = false
        }
      }
    }
  } catch (error) {
    throw error
  }
}

/**
 * 用户显式触发的写作续写。
 * 这不是灰字预测：它应生成更完整的自然段，并使用更高 token 上限避免半句截断。
 */
export async function fetchWritingContinuationStream(
  context: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  richContext?: CompletionContext
): Promise<void> {
  try {
    const aiConfig = await getAISettings('completionModel') || await getAISettings('primaryModel')

    if (await validateAIService(aiConfig?.baseURL) === null) {
      throw new AICompletionUnavailableError()
    }

    const openai = await createOpenAIClient(aiConfig)
    const prompt = richContext
      ? buildWritingContinuationPrompt(richContext, context)
      : buildLegacyPrompt(context)

    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: [
        { role: 'system' as const, content: WRITING_CONTINUATION_SYSTEM_PROMPT },
        { role: 'user' as const, content: prompt },
      ],
      temperature: 0.72,
      max_tokens: 600,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        const next = isFirst ? cleanupCompletionPrefix(content) : content
        if (next) {
          onChunk(next, isFirst)
          isFirst = false
        }
      }
    }
  } catch (error) {
    throw error
  }
}
