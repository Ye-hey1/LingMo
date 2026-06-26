import type OpenAI from 'openai';
import useSettingStore from '@/stores/setting';
import type { AiConfig, ModelConfig } from '@/app/core/setting/config';
import { createOpenAIClient } from './utils';

export interface QuickPrompt {
  id: string
  text: string
}

interface ResolvedInspirationModel {
  config: AiConfig
  model: ModelConfig
}

/**
 * 获取灵感模型配置
 * @returns 灵感模型配置，如果未配置则返回 null
 */
function createModelScopedConfig(config: AiConfig, model: ModelConfig): AiConfig {
  return {
    ...config,
    model: model.model,
    modelType: model.modelType,
    temperature: model.temperature,
    topP: model.topP,
    contextWindow: model.contextWindow,
    voice: model.voice,
    enableStream: model.enableStream,
  }
}

async function getInspirationModelConfig(): Promise<ResolvedInspirationModel | null> {
  const settingStore = useSettingStore.getState()
  const inspirationModelId = settingStore.inspirationModel
  const primaryModelId = settingStore.primaryModel
  const bundledDefaultIds = new Set(['note-gen-chat', 'note-gen-free-note-gen-chat'])
  const preferPrimaryModel =
    !!primaryModelId &&
    (!inspirationModelId || (bundledDefaultIds.has(inspirationModelId) && primaryModelId !== inspirationModelId))
  const candidateModelIds = Array.from(new Set(
    (preferPrimaryModel ? [primaryModelId, inspirationModelId] : [inspirationModelId])
      .filter((modelId): modelId is string => !!modelId)
  ))

  if (candidateModelIds.length === 0) {
    return null
  }

  // 从 AI 模型列表中查找配置的灵感模型
  const aiModelList = settingStore.aiModelList
  for (const modelId of candidateModelIds) {
    for (const config of aiModelList) {
      if (config.models?.length) {
        const model = config.models.find(m => m.id === modelId || `${config.key}-${m.id}` === modelId)
        if (model?.modelType === 'chat' && model.model) {
          return {
            config: createModelScopedConfig(config, model),
            model,
          }
        }
      } else if (config.key === modelId && config.model && (!config.modelType || config.modelType === 'chat')) {
        return {
          config,
          model: {
            id: config.key,
            model: config.model,
            modelType: 'chat',
            temperature: config.temperature,
            topP: config.topP,
            contextWindow: config.contextWindow,
            voice: config.voice,
            enableStream: config.enableStream,
          },
        }
      }
    }
  }

  return null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAiServiceConfigError(message: string) {
  return /AI_HTTP_ERROR status=(401|402|403)|unauthorized|invalid api key|insufficient.*balance|balance.*insufficient|quota|billing|bad_response_status_code/i.test(message)
}

/**
 * 生成输入框占位符建议
 * @param text 上下文内容
 * @returns 占位符文本，失败返回false
 */
export async function fetchAiPlaceholder(text: string): Promise<string | false> {
  try {
    const resolved = await getInspirationModelConfig()

    if (!resolved) {
      console.warn('[Placeholder] No inspiration model configured; placeholder generation skipped.')
      return false
    }

    // 构建 placeholder 提示词
    const placeholderPrompt = `
      You are a note-taking software with an intelligent assistant. You can refer to the recorded content to take notes.
      IMPORTANT: Do not exceed 10 characters. Keep it extremely short.
      There is only one line left. Line breaks are strictly prohibited.
      Do not generate any special characters or punctuation.
      Leave it as plain text and no format is required.
      CRITICAL: Each response must be different and varied. Generate diverse suggestions each time, do not repeat previous patterns.
      Generate a very short question based on the following content:
      ${text}`

    // 准备消息 - 不加载记忆，直接使用简单消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: placeholderPrompt }
    ]

    const openai = await createOpenAIClient(resolved.config)

    const completion = await openai.chat.completions.create({
      model: resolved.model.model,
      messages: messages,
      temperature: resolved.model.temperature ?? 1,
      top_p: resolved.model.topP ?? 1,
    })

    const result = completion.choices[0]?.message?.content || ''

    // 去掉所有换行符和各种特殊符号，不包括空格
    return result.trim()
  } catch (error) {
    const errorMsg = getErrorMessage(error)
    if (isAiServiceConfigError(errorMsg)) {
      console.warn(`[Placeholder] AI service unavailable for placeholder generation: ${errorMsg}`)
      return false
    }
    console.error('Error in fetchAiPlaceholder:', error)
    return false
  }
}

/**
 * 生成4条灵感提示词
 * @param text 上下文内容
 * @returns 灵感提示词数组，失败返回空数组
 */

// 速率限制：防止 429 错误
let lastQuickPromptCall = 0
let rateLimitBackoff = 0  // 退避时间（毫秒），遇到 429 后递增
let transportBackoff = 0  // 退避时间（毫秒），遇到网络传输失败后递增
let serviceConfigBackoff = 0  // 退避时间（毫秒），遇到账号/鉴权/额度错误后递增
const MIN_CALL_INTERVAL = 30000  // 最少 30 秒间隔
const TRANSPORT_BACKOFF_STEP = 5 * 60 * 1000  // 网络失败后至少冷却 5 分钟
const MAX_TRANSPORT_BACKOFF = 30 * 60 * 1000  // 最多冷却 30 分钟
const SERVICE_CONFIG_BACKOFF = 30 * 60 * 1000  // 账号/鉴权/额度错误后冷却 30 分钟

function isAiTransportError(message: string) {
  return /AI_TRANSPORT_ERROR|AI_JSON_PARSE_ERROR|unexpected end of hex escape|error decoding response body|error sending request|Failed to fetch|NetworkError|Load failed|plugin-http fallback failed|connect/i.test(message)
}

export async function fetchAiQuickPrompts(text: string): Promise<QuickPrompt[]> {
  // 速率限制检查
  const now = Date.now()
  const effectiveInterval = MIN_CALL_INTERVAL + rateLimitBackoff + transportBackoff + serviceConfigBackoff
  if (lastQuickPromptCall > 0 && now - lastQuickPromptCall < effectiveInterval) {
    return []
  }

  try {
    const resolved = await getInspirationModelConfig()

    if (!resolved) {
      console.warn('[Placeholder] No valid inspiration model configured; quick prompts skipped.')
      return []
    }
    lastQuickPromptCall = now

    // 构建生成4条提示词的 prompt
    const prompt = `
You are a note-taking software assistant. Generate 4 different quick prompt suggestions.

Requirements:
1. Each prompt: short, actionable, under 15 characters
2. All 4 prompts must be different
3. Use Chinese unless content is clearly English
4. NO special characters or punctuation
5. Respond with ONLY a valid JSON array

Your response must be exactly this format (nothing else):
["prompt1", "prompt2", "prompt3", "prompt4"]

Content: ${text || 'General note-taking'}`

    // 准备消息 - 不加载记忆，直接使用简单消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt }
    ]

    const openai = await createOpenAIClient(resolved.config)

    const completion = await openai.chat.completions.create({
      model: resolved.model.model,
      messages: messages,
      temperature: 0.8, // 使用较高的温度以获得更多样化的结果
      top_p: resolved.model.topP ?? 1,
    })

    const result = completion.choices[0]?.message?.content || ''
    transportBackoff = 0
    serviceConfigBackoff = 0

    // 尝试解析 JSON 结果
    try {
      // 清理可能的 markdown 代码块标记
      let cleanResult = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      // 尝试提取 JSON 数组（处理返回文本中包含额外内容的情况）
      const arrayMatch = cleanResult.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        cleanResult = arrayMatch[0]
      }

      // 尝试修复常见的 JSON 问题（如缺少引号）
      try {
        const prompts = JSON.parse(cleanResult)

        if (Array.isArray(prompts) && prompts.length >= 4) {
          return prompts.slice(0, 4).map((text, index) => ({
            id: `ai-prompt-${index}`,
            text: String(text).trim()
          }))
        }

        // 如果解析的数组不足4条，返回能解析的部分
        if (Array.isArray(prompts)) {
          return prompts.map((text, index) => ({
            id: `ai-prompt-${index}`,
            text: String(text).trim()
          }))
        }
      } catch {
        // JSON parse failed, continue to fallback
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError)
    }

    // 如果 JSON 解析失败，尝试按行分割
    const lines = result.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith(']'))

    if (lines.length >= 4) {
      return lines.slice(0, 4).map((text, index) => ({
        id: `ai-prompt-${index}`,
        text: text.replace(/^["']|["']$/g, '').trim()
      }))
    }

    return []
  } catch (error) {
    // 429 限流错误：增加退避时间
    const errorMsg = getErrorMessage(error)
    if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('TPM')) {
      rateLimitBackoff = Math.min(rateLimitBackoff + 60000, 300000) // 每次加 60s，最多 5 分钟
      console.warn(`[Placeholder] Rate limited, backing off ${rateLimitBackoff / 1000}s`)
    } else if (isAiServiceConfigError(errorMsg)) {
      serviceConfigBackoff = SERVICE_CONFIG_BACKOFF
      console.warn(`[Placeholder] AI service rejected quick prompts, backing off ${serviceConfigBackoff / 1000}s: ${errorMsg}`)
      return []
    } else if (isAiTransportError(errorMsg)) {
      transportBackoff = Math.min(
        transportBackoff ? transportBackoff * 2 : TRANSPORT_BACKOFF_STEP,
        MAX_TRANSPORT_BACKOFF
      )
      // Quick prompts are optional background hints. Keep transport failures quiet so typing/chat is not interrupted.
      console.warn(`[Placeholder] Quick prompts unavailable, backing off ${transportBackoff / 1000}s: ${errorMsg}`)
      return []
    } else {
      // 非限流错误，重置退避
      rateLimitBackoff = Math.max(0, rateLimitBackoff - 30000)
      transportBackoff = Math.max(0, transportBackoff - TRANSPORT_BACKOFF_STEP)
      serviceConfigBackoff = 0
    }
    console.error('Error in fetchAiQuickPrompts:', error)
    return []
  }
}

/**
 * 生成单个灵感提示词（用于 placeholder）
 * @param text 上下文内容
 * @returns 提示词文本，失败返回空字符串
 */
export async function fetchAiSinglePrompt(text: string): Promise<string> {
  try {
    const resolved = await getInspirationModelConfig()

    if (!resolved) {
      console.warn('[Placeholder] No valid inspiration model configured; single prompt skipped.')
      return ''
    }

    const prompt = `
Generate ONE very short and actionable prompt suggestion (under 15 characters) based on the following content.
Return ONLY the prompt text, nothing else.
Do not include any special characters or punctuation.

Content: ${text || 'No content provided'}`

    // 准备消息 - 不加载记忆，直接使用简单消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt }
    ]

    const openai = await createOpenAIClient(resolved.config)

    const completion = await openai.chat.completions.create({
      model: resolved.model.model,
      messages: messages,
      temperature: 0.8,
      top_p: resolved.model.topP ?? 1,
    })

    const result = completion.choices[0]?.message?.content || ''
    return result.trim()
  } catch (error) {
    const errorMsg = getErrorMessage(error)
    if (isAiServiceConfigError(errorMsg)) {
      console.warn(`[Placeholder] AI service unavailable for single prompt: ${errorMsg}`)
      return ''
    }
    console.error('Error in fetchAiSinglePrompt:', error)
    return ''
  }
}
