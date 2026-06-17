import { type ExtractedSection } from "./types"

export function splitContentIntoSections(content: string): ExtractedSection[] {
  const normalized = content.trim()
  if (!normalized) return []

  const baseOffset = content.indexOf(normalized)
  const lineAt = (offset: number) => content.slice(0, Math.max(0, offset)).split(/\r?\n/).length
  const withPosition = (section: Omit<ExtractedSection, "startLine" | "endLine">): ExtractedSection => ({
    ...section,
    startLine: section.startOffset === undefined ? undefined : lineAt(section.startOffset),
    endLine: section.endOffset === undefined ? undefined : lineAt(section.endOffset),
  })

  const headingRegex = /^#{1,6}\s+.+$/gm
  const headings = Array.from(normalized.matchAll(headingRegex))
  if (headings.length > 0) {
    return headings
      .map((heading, index) => {
        const start = heading.index ?? 0
        const end = index + 1 < headings.length ? headings[index + 1].index ?? normalized.length : normalized.length
        const block = normalized.slice(start, end)
        const lines = block.trim().split(/\r?\n/)
        const rawTitle = lines.shift() || ""
        const level = rawTitle.match(/^#{1,6}/)?.[0].length ?? 1
        const title = rawTitle.replace(/^#{1,6}\s+/, "").trim()
        const bodyLines = lines.filter(Boolean)
        const bullets = bodyLines
          .filter((line) => /^\s*[-*+]\s+/.test(line))
          .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
        const body = bodyLines
          .filter((line) => !/^\s*[-*+]\s+/.test(line))
          .join("\n")
          .trim()

        return withPosition({
          title: title || "未命名章节",
          level,
          body,
          bullets: bullets.length > 0 ? bullets : undefined,
          importance: inferImportance(`${title}\n${body}`),
          startOffset: baseOffset + start,
          endOffset: baseOffset + end,
        })
      })
      .filter((section) => section.title)
  }

  const paragraphMatches = Array.from(normalized.matchAll(/[^\n](?:[\s\S]*?)(?=\n{2,}|\s*$)/g))
  return paragraphMatches
    .map((match, index) => {
      const paragraph = match[0].trim()
      const start = match.index ?? 0
      const end = start + match[0].length
      return withPosition({
        title: index === 0 ? "核心概览" : `要点 ${index + 1}`,
        level: 1,
        body: paragraph,
        bullets: extractBullets(paragraph),
        importance: inferImportance(paragraph),
        startOffset: baseOffset + start,
        endOffset: baseOffset + end,
      })
    })
    .filter((section) => section.body || section.bullets?.length)
}

function extractBullets(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .slice(0, 8)
}

function inferImportance(content: string): "low" | "medium" | "high" {
  if (/关键|核心|重要|风险|阻塞|失败|必须|high|critical|risk|block/i.test(content)) {
    return "high"
  }
  if (/建议|注意|计划|下一步|优化|medium|todo|next/i.test(content)) {
    return "medium"
  }
  return "low"
}
