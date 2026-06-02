import { createOpenAIClient, getAISettings, handleAIError, prepareMessages } from "./utils"

export interface LinkOrganizerInput {
  url: string
  title: string
  metaDesc?: string
  content: string
}

export interface LinkOrganizerResult {
  desc: string
  content: string
}

export interface LinkOrganizerOptions {
  timeoutMs?: number
}

const DEFAULT_LINK_ORGANIZE_TIMEOUT_MS = 35_000
const LINK_ORGANIZE_CONTENT_LIMIT = 8_000

function cleanText(text?: string): string {
  return text?.replace(/\s+/g, " ").trim() || ""
}

function cleanMarkdown(text?: string): string {
  return (text || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength)}...`
}

function extractJsonObject(text: string): Record<string, any> | null {
  const content = text.trim()
  if (!content) {
    return null
  }

  try {
    return JSON.parse(content)
  } catch {
    // ignore
  }

  const match = content.match(/\{[\s\S]*\}/)
  if (!match) {
    return null
  }

  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  return {
    signal: controller.signal,
    clear: () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    },
  }
}

function normalizeOrganizedOutput(
  source: LinkOrganizerInput,
  parsed?: Record<string, any> | null
): LinkOrganizerResult {
  const fallbackTitle = cleanText(source.title) || cleanText(source.url)
  const fallbackSummary = cleanText(source.metaDesc)
  const fallbackBody = cleanMarkdown(source.content)

  const title = cleanText(parsed?.title) || fallbackTitle
  const summary = cleanText(parsed?.summary) || fallbackSummary
  const keyPoints = Array.isArray(parsed?.keyPoints)
    ? parsed!.keyPoints.map((item: unknown) => cleanText(String(item))).filter(Boolean).slice(0, 8)
    : []
  const cleanedBody = cleanMarkdown(String(parsed?.cleanedBody || "")) || fallbackBody

  const desc = summary
    ? `${title}\n${truncate(summary, 220)}`
    : truncate(title, 220)

  const sections: string[] = [
    `# ${title}`,
    "",
    `> 来源：${source.url}`,
    "",
  ]
  if (summary) {
    sections.push("## 摘要", summary, "")
  }
  if (keyPoints.length > 0) {
    sections.push("## 关键点", ...keyPoints.map((point) => `- ${point}`), "")
  }
  sections.push("## 整理正文", cleanedBody || "未提取到可用正文。", "", "## 原始来源", `- ${source.url}`)

  return {
    desc,
    content: sections.join("\n"),
  }
}

export async function organizeLinkRecord(
  input: LinkOrganizerInput,
  options: LinkOrganizerOptions = {},
): Promise<LinkOrganizerResult | null> {
  const timeout = createTimeoutController(options.timeoutMs ?? DEFAULT_LINK_ORGANIZE_TIMEOUT_MS)

  try {
    const aiConfig = await getAISettings("markDescModel")
    if (!aiConfig?.model) {
      return null
    }

    const content = truncate(cleanMarkdown(input.content || ""), LINK_ORGANIZE_CONTENT_LIMIT)
    const prompt = [
      "你是链接内容标准化整理助手。请把网页内容整理为清晰、可保存、可继续整理的中文资料卡，并返回严格 JSON：",
      `{"title":"", "summary":"", "keyPoints":[""], "cleanedBody":""}`,
      "要求：",
      "1) title、summary、keyPoints、cleanedBody 全部使用中文；如果原文是英文，请准确翻译并整理，不要保留大段英文原文；",
      "2) summary 不超过 160 字；",
      "3) keyPoints 输出 3-8 条，使用中文短句；",
      "4) cleanedBody 使用 Markdown，包含清晰小标题、条目、必要代码块和表格；",
      "5) 删除导航、广告、版权、重复段落、图片占位、base64、SVG、无意义按钮文案；",
      "6) 保留事实、链接、项目名、命令、参数和重要术语；不要编造原文没有的信息；",
      "7) 不要输出 JSON 以外的任何文字。",
      "",
      `URL: ${input.url}`,
      `Title: ${input.title || ""}`,
      `Meta Description: ${input.metaDesc || ""}`,
      `Raw Content: ${content}`,
    ].join("\n")

    const { messages } = await prepareMessages(prompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages,
      temperature: 0.2,
      top_p: aiConfig.topP || 1,
    }, {
      signal: timeout.signal,
    })

    const message = completion.choices[0]?.message?.content || ""
    const parsed = extractJsonObject(message)
    return normalizeOrganizedOutput(input, parsed)
  } catch (error) {
    if (timeout.signal.aborted) {
      console.warn(`[LinkOrganizer] AI organize timed out after ${options.timeoutMs ?? DEFAULT_LINK_ORGANIZE_TIMEOUT_MS}ms`)
      return null
    }

    handleAIError(error, false)
    return null
  } finally {
    timeout.clear()
  }
}
