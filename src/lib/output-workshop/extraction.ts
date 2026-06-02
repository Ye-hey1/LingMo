import type { ExtractedSection } from "@/components/output-workshop/types"

export interface OutputExtractionResult {
  title: string
  subtitle: string
  sections: ExtractedSection[]
  usedFallback: boolean
  warning?: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function toStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

export function splitPlainTextIntoSections(source: string): ExtractedSection[] {
  const trimmed = source.trim()
  if (!trimmed) return []

  const lines = trimmed.split(/\r?\n/)
  const sections: ExtractedSection[] = []
  let currentTitle = "核心内容"
  let currentLines: string[] = []

  const pushCurrent = () => {
    const body = currentLines.join("\n").trim()
    if (!body && sections.length > 0) return
    sections.push({
      title: currentTitle,
      body: body || trimmed.slice(0, 800),
    })
  }

  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (headingMatch) {
      if (currentLines.length > 0 || sections.length > 0) {
        pushCurrent()
      }
      currentTitle = headingMatch[1].trim() || "未命名章节"
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  pushCurrent()
  return sections
}

function extractJsonCandidate(input: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(input)
  const candidate = fenced?.[1]?.trim() || input.trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

function normalizeSections(value: unknown): ExtractedSection[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): ExtractedSection[] => {
    if (typeof item === "string") {
      const body = item.trim()
      return body ? [{ title: `第 ${index + 1} 节`, body }] : []
    }
    if (!isRecord(item)) return []

    const title = toText(item.title) || toText(item.heading) || toText(item.name) || `第 ${index + 1} 节`
    const body = toText(item.body) || toText(item.content) || toText(item.summary) || undefined
    const bullets = toStringList(item.bullets) || toStringList(item.points) || toStringList(item.items)

    if (!body && !bullets?.length) return []
    return [{ title, body, bullets }]
  })
}

export function parseOutputExtractionResult(
  raw: string,
  fallbackSource: string,
  fallbackTitle = "可视化输出",
): OutputExtractionResult {
  const fallbackSections = () => splitPlainTextIntoSections(fallbackSource)

  try {
    const candidate = extractJsonCandidate(raw)
    if (!candidate) {
      return {
        title: fallbackTitle,
        subtitle: "",
        sections: fallbackSections(),
        usedFallback: true,
        warning: "未找到可解析的 JSON 内容",
      }
    }

    const parsed: unknown = JSON.parse(candidate)
    if (!isRecord(parsed)) {
      return {
        title: fallbackTitle,
        subtitle: "",
        sections: fallbackSections(),
        usedFallback: true,
        warning: "JSON 顶层结构不是对象",
      }
    }

    const sections = normalizeSections(parsed.sections)
    if (sections.length === 0) {
      return {
        title: toText(parsed.title) || fallbackTitle,
        subtitle: toText(parsed.subtitle) || "",
        sections: fallbackSections(),
        usedFallback: true,
        warning: "JSON 中没有可用的 sections",
      }
    }

    return {
      title: toText(parsed.title) || fallbackTitle,
      subtitle: toText(parsed.subtitle) || "",
      sections,
      usedFallback: false,
    }
  } catch (error) {
    return {
      title: fallbackTitle,
      subtitle: "",
      sections: fallbackSections(),
      usedFallback: true,
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}
