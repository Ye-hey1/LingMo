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

function cleanText(text?: string): string {
  return text?.replace(/\s+/g, " ").trim() || ""
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

function normalizeOrganizedOutput(
  source: LinkOrganizerInput,
  parsed?: Record<string, any> | null
): LinkOrganizerResult {
  const fallbackTitle = cleanText(source.title) || cleanText(source.url)
  const fallbackSummary = cleanText(source.metaDesc)
  const fallbackBody = cleanText(source.content)

  const title = cleanText(parsed?.title) || fallbackTitle
  const summary = cleanText(parsed?.summary) || fallbackSummary
  const keyPoints = Array.isArray(parsed?.keyPoints)
    ? parsed!.keyPoints.map((item: unknown) => cleanText(String(item))).filter(Boolean).slice(0, 8)
    : []
  const cleanedBody = cleanText(parsed?.cleanedBody) || fallbackBody

  const desc = summary
    ? `${title}\n${truncate(summary, 220)}`
    : truncate(title, 220)

  const sections: string[] = []
  if (summary) {
    sections.push("## 摘要", summary, "")
  }
  if (keyPoints.length > 0) {
    sections.push("## 关键点", ...keyPoints.map((point) => `- ${point}`), "")
  }
  sections.push("## 整理正文", cleanedBody || "未提取到可用正文。", "", `来源：${source.url}`)

  return {
    desc,
    content: sections.join("\n"),
  }
}

export async function organizeLinkRecord(input: LinkOrganizerInput): Promise<LinkOrganizerResult | null> {
  try {
    const aiConfig = await getAISettings("markDescModel")
    if (!aiConfig?.model) {
      return null
    }

    const content = truncate(input.content || "", 8000)
    const prompt = [
      "你是链接内容整理助手。请对网页内容进行结构化整理，并返回严格 JSON：",
      `{"title":"", "summary":"", "keyPoints":[""], "cleanedBody":""}`,
      "要求：",
      "1) summary 不超过 120 字；",
      "2) keyPoints 输出 3-8 条；",
      "3) cleanedBody 删除导航、广告、版权、重复段落，保留有信息密度的正文；",
      "4) 不要输出 JSON 以外的任何文字。",
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
    })

    const message = completion.choices[0]?.message?.content || ""
    const parsed = extractJsonObject(message)
    return normalizeOrganizedOutput(input, parsed)
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}
