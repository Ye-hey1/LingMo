/**
 * 风格化文档生成器
 *
 * 复用 LingMo 现有的 AI 调用层（createOpenAIClient / getAISettings / prepareMessages），
 * 与 src/lib/ai/link-organizer.ts 保持一致的调用风格。
 */

import { createOpenAIClient, getAISettings, handleAIError, prepareMessages } from "@/lib/ai/utils"
import {
  buildStylePrompt,
  getStyleDoc,
  type StyleDocId,
  type StylePromptInput,
} from "./styles"

export interface GenerateStyleDocOptions {
  /** 使用的模型类型 key（与 getAISettings 一致），默认 markDescModel，速度快 */
  modelType?: string
  /** 超时毫秒，默认 60s——风格改写产物较长，比 organize 更宽松 */
  timeoutMs?: number
}

export interface StyleDocResult {
  /** 风格 id */
  styleId: StyleDocId
  /** 风格中文名 */
  styleName: string
  /** 改写后的 Markdown 正文 */
  content: string
  /** 提取自产物的标题（第一行 H1 或前 40 字） */
  title: string
}

const DEFAULT_TIMEOUT_MS = 60_000

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  return {
    signal: controller.signal,
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId)
    },
  }
}

function extractTitleFromContent(text: string): string {
  const trimmed = (text || "").trim()
  if (!trimmed) return "未命名文档"
  const firstLine = trimmed.split(/\r?\n/)[0] || ""
  const h1 = firstLine.match(/^#\s+(.+)$/)
  if (h1) return h1[1].trim().slice(0, 60)
  return firstLine.slice(0, 40).trim() || "未命名文档"
}

/**
 * 调用 AI 把原始内容改写为指定风格的 Markdown 文档。
 * 失败时抛出 Error，由调用方决定降级策略（toast / 回退原始内容等）。
 */
export async function generateStyleDoc(
  styleId: StyleDocId,
  input: StylePromptInput,
  options: GenerateStyleDocOptions = {},
): Promise<StyleDocResult> {
  const meta = getStyleDoc(styleId)
  const prompt = buildStylePrompt(styleId, input)

  const timeout = createTimeoutController(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const aiConfig = await getAISettings(options.modelType || "markDescModel")
    if (!aiConfig?.model) {
      throw new Error("未配置可用的 AI 模型，请在设置中配置模型后再试。")
    }

    // 与 link-organizer 一致：把系统指令与用户输入合并成单条 prompt，
    // 让 prepareMessages 自动注入 Xiaomo 默认 system + 记忆上下文。
    const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`
    const { messages } = await prepareMessages(combinedPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create(
      {
        model: aiConfig.model,
        messages,
        temperature: prompt.temperature,
        top_p: aiConfig.topP || 1,
      },
      { signal: timeout.signal },
    )

    const raw = completion.choices[0]?.message?.content || ""
    const content = raw.trim()

    if (!content) {
      throw new Error("AI 未返回任何内容，请稍后重试。")
    }

    return {
      styleId,
      styleName: meta.name,
      content,
      title: extractTitleFromContent(content),
    }
  } catch (error) {
    if (timeout.signal.aborted) {
      throw new Error(`风格化改写超时（>${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s），请缩短原文或重试。`)
    }
    // 复用现有错误处理（弹 toast / 打日志），再向上抛
    handleAIError(error, false)
    if (error instanceof Error) throw error
    throw new Error("风格化改写失败，请重试。")
  } finally {
    timeout.clear()
  }
}
