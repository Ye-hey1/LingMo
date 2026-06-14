import { getMokaTemplateKind } from "./constants"
import type {
  MokaAiSingleDesign,
  MokaAiSplitDesign,
  MokaParsedResult,
  MokaSection,
  MokaSingleContent,
  MokaSlide,
  MokaTemplateKind,
} from "./types"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

const LEAKED_FIELD_LABEL_RE = /^["'`“”‘’]?\s*(?:title|titel|subtitle|subtitel|heading|text|lead|content|body|category|emoji|tip|tags?|styleConfig|slides?|sections?|cta|sub|extra|decorations?|container|header|字段|标题|副标题|正文|正文内容|小标题|导语|分类|标签|提示|内容)\s*["'`“”‘’]?\s*[:：=]\s*/i

const INTERNAL_PLACEHOLDER_RE = /^(?:title|titel|subtitle|subtitel|heading|text|lead|content|body|category|emoji|tip|tags?|styleConfig|slides?|sections?|cta|sub|extra|decorations?|container|header|moka(?:\s*mode)?|moka-ai-(?:single|split)|moka\s*卡片|内容精华笔记|封面标题|副标题|正文内容|小标题\d*|金句|互动语|标签\d*|主题词\d*|从材料提炼.*|一句话(?:概括|说明)文章主线|用原文事实解释观点|说明变化原因和影响|总结原文核心收获)$/i

function stripLeakedFieldLabel(value: string): string {
  let text = value.trim()
  for (let i = 0; i < 2; i += 1) {
    const next = text.replace(LEAKED_FIELD_LABEL_RE, "").trim()
    if (next === text) break
    text = next
  }
  return text
}

function isInternalPlaceholder(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^#+/, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[{}\[\],]/g, "")
    .trim()
  return !normalized || INTERNAL_PLACEHOLDER_RE.test(normalized)
}

function toStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  const list = value
    .map((item) => cleanInlineText(toText(item)))
    .filter(Boolean)
  return list.length ? list : fallback
}

function cleanCardText(value: string): string {
  const cleaned = stripLeakedFieldLabel(value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*\d+(?:\.\d+)*[、.．:：]\s*/gm, "")
    .replace(/^\s*[一二三四五六七八九十]+[、.．]\s*/gm, "")
    .replace(/^\s*第[一二三四五六七八九十\d]+[章节部分篇]\s*/gm, "")
    .replace(/\s+#+\s*/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim())
  return isInternalPlaceholder(cleaned) ? "" : cleaned
}

function cleanInlineText(value: string): string {
  return cleanCardText(value)
    .replace(/\s*\n+\s*/g, "；")
    .replace(/；{2,}/g, "；")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function cleanCardValue(value: unknown, fallback = ""): string {
  return cleanCardText(toText(value)) || cleanCardText(fallback)
}

function cleanInlineValue(value: unknown, fallback = ""): string {
  return cleanInlineText(toText(value)) || cleanInlineText(fallback)
}

function isOutlineHeading(line: string): boolean {
  const trimmed = line.trim()
  return /^#{1,6}\s+/.test(trimmed) ||
    /^[一二三四五六七八九十]+[、.．]\s*\S+/.test(trimmed) ||
    /^\d+(?:\.\d+)*[、.．:：]\s*\S+/.test(trimmed) ||
    /^第[一二三四五六七八九十\d]+[章节部分篇]\s*\S*/.test(trimmed)
}

function getHeadingText(line: string): string {
  return cleanCardText(line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/, "")
    .replace(/^\d+(?:\.\d+)*[、.．:：]\s*/, "")
    .replace(/^第[一二三四五六七八九十\d]+[章节部分篇]\s*/, ""))
}

function getFallbackTags(title: string, blocks: Array<{ title: string; body: string }>): string[] {
  const candidates = [
    ...cleanCardText(title).split(/[^\u4e00-\u9fa5A-Za-z0-9]+/),
    ...blocks.flatMap((block) => cleanCardText(block.title).split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)),
  ]
  const tags = candidates
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 10)
    .filter((item) => !/^\d+$/.test(item))
  return Array.from(new Set(tags)).slice(0, 5)
}

function getBlockDigest(body: string, maxLength: number): string {
  const lines = cleanCardText(body)
    .split(/\r?\n/)
    .map((line) => cleanInlineText(line))
    .filter((line) => line && !isOutlineHeading(line))
  const prioritized = lines
    .filter((line) => /[：:，,。；;]|20\d{2}|19\d{2}|AI|产品|商业|能力|阶段|转型|趋势/.test(line))
    .slice(0, 3)
  const text = (prioritized.length ? prioritized : lines).join("；")
  return cleanInlineText(text || body).slice(0, maxLength)
}

function getBlockExtra(body: string): string {
  const lines = cleanCardText(body)
    .split(/\r?\n/)
    .map((line) => cleanInlineText(line))
    .filter((line) => line && !isOutlineHeading(line))
  const extra = lines.find((line) => /为什么|关键|核心|转折|意味着|从.+到|商业|能力|趋势|阶段/.test(line)) ||
    lines.find((line) => line.length >= 12)
  return extra ? cleanInlineText(extra).slice(0, 42) : ""
}

function cleanMarkdownJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u201C\u201D]/g, '"')
}

function findJsonCandidate(text: string): string | null {
  const cleaned = cleanMarkdownJson(text)
  const firstObject = cleaned.indexOf("{")
  const firstArray = cleaned.indexOf("[")
  const starts = [firstObject, firstArray].filter((idx) => idx >= 0)
  if (!starts.length) return null

  const start = Math.min(...starts)
  const startChar = cleaned[start]
  const endChar = startChar === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escaped = false
  let lastBalanced = -1

  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === startChar) depth += 1
    if (char === endChar) {
      depth -= 1
      if (depth === 0) lastBalanced = i
    }
  }

  const raw = cleaned.slice(start, lastBalanced >= start ? lastBalanced + 1 : cleaned.length)
  return repairJson(raw)
}

function repairJson(json: string): string {
  let repaired = json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*'([^']*)'/g, ':"$1"')

  let braces = 0
  let brackets = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < repaired.length; i += 1) {
    const char = repaired[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === "{") braces += 1
    if (char === "}") braces -= 1
    if (char === "[") brackets += 1
    if (char === "]") brackets -= 1
  }

  if (inString) repaired += '"'
  while (brackets > 0) {
    repaired += "]"
    brackets -= 1
  }
  while (braces > 0) {
    repaired += "}"
    braces -= 1
  }
  return repaired
}

function parseJsonObject(raw: string): UnknownRecord | null {
  const candidate = findJsonCandidate(raw)
  if (!candidate) return null
  try {
    const parsed: unknown = JSON.parse(candidate)
    return isRecord(parsed) ? parsed : null
  } catch {
    try {
      const aggressive = candidate.replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      const parsed: unknown = JSON.parse(aggressive)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

function splitSourceIntoBlocks(source: string): Array<{ title: string; body: string }> {
  const trimmed = source.trim()
  if (!trimmed) return []
  const lines = trimmed.split(/\r?\n/)
  const blocks: Array<{ title: string; body: string }> = []
  let title = "核心内容"
  let body: string[] = []

  const flush = () => {
    const content = cleanCardText(body.join("\n"))
    if (content || !blocks.length) blocks.push({ title, body: content || trimmed.slice(0, 360) })
  }

  for (const line of lines) {
    if (isOutlineHeading(line)) {
      if (body.length || blocks.length) flush()
      title = getHeadingText(line) || "核心内容"
      body = []
    } else {
      body.push(line)
    }
  }
  flush()
  return blocks.slice(0, 8)
}

function normalizeSections(value: unknown, fallbackSource: string): MokaSection[] {
  if (Array.isArray(value)) {
    const sections = value.flatMap((item): MokaSection[] => {
      if (typeof item === "string") {
        const text = cleanCardText(item)
        return text ? [{ heading: "要点", text }] : []
      }
      if (!isRecord(item)) return []
      const heading = cleanCardValue(item.heading, toText(item.title, "要点")) || "要点"
      const text = cleanCardValue(item.text, toText(item.body, toText(item.content)))
      return text ? [{ heading, text }] : []
    })
    if (sections.length) return sections.slice(0, 6)
  }
  return splitSourceIntoBlocks(fallbackSource).map((block) => ({
    heading: block.title.slice(0, 16),
    text: getBlockDigest(block.body, 140),
  })).slice(0, 5)
}

function normalizeSingle(parsed: UnknownRecord | null, fallbackSource: string, fallbackTitle: string): MokaSingleContent {
  const sections = normalizeSections(parsed?.sections, fallbackSource)
  const blocks = splitSourceIntoBlocks(fallbackSource)
  const fallbackLead = getBlockDigest(blocks[0]?.body || fallbackSource, 80)
  const fallbackTags = getFallbackTags(fallbackTitle, blocks)
  return {
    emoji: toText(parsed?.emoji, "✨").slice(0, 4),
    category: cleanCardValue(parsed?.category, "精华").slice(0, 8) || "精华",
    title: cleanCardValue(parsed?.title, fallbackTitle || blocks[0]?.title || "内容精华").slice(0, 46) || "内容精华",
    lead: cleanInlineValue(parsed?.lead, fallbackLead).slice(0, 90),
    sections,
    tip: cleanInlineValue(parsed?.tip, sections[0]?.text || "").slice(0, 80),
    tags: toStringList(parsed?.tags, fallbackTags).slice(0, 5),
  }
}

function normalizeSlide(item: unknown, index: number, total: number): MokaSlide | null {
  if (!isRecord(item)) return null
  const rawType = toText(item.type)
  const type = rawType === "cover" || rawType === "end" || rawType === "content"
    ? rawType
    : index === 0
      ? "cover"
      : index === total - 1
        ? "end"
        : "content"

  if (type === "cover") {
    return {
      type,
      emoji: toText(item.emoji, "✨"),
      category: cleanCardValue(item.category, "精华"),
      title: cleanCardValue(item.title),
      subtitle: cleanInlineValue(item.subtitle, toText(item.sub)),
    }
  }
  if (type === "end") {
    return {
      type,
      emoji: toText(item.emoji, "✨"),
      cta: cleanCardValue(item.cta, toText(item.title, "记住核心主线")) || "记住核心主线",
      sub: cleanInlineValue(item.sub, toText(item.subtitle)),
      tags: toStringList(item.tags).slice(0, 5),
    }
  }
  return {
    type,
    heading: cleanCardValue(item.heading, toText(item.title, `第 ${index} 页`)) || `第 ${index} 页`,
    text: cleanInlineValue(item.text, toText(item.body, toText(item.content))),
    extra: cleanInlineValue(item.extra, toText(item.quote)),
  }
}

function normalizeSlides(parsed: UnknownRecord | null, fallbackSource: string, fallbackTitle: string): MokaSlide[] {
  const nestedContent = isRecord(parsed?.content) ? parsed.content : null
  const rawSlides = Array.isArray(parsed?.slides)
    ? parsed.slides
    : Array.isArray(nestedContent?.slides)
      ? nestedContent.slides
      : null

  if (rawSlides) {
    const slides = rawSlides
      .map((slide, index, list) => normalizeSlide(slide, index, list.length))
      .filter((slide): slide is MokaSlide => Boolean(slide))
    if (slides.length > 1) return slides.slice(0, 10)
  }

  const blocks = splitSourceIntoBlocks(fallbackSource)
  const contentSlides = blocks.slice(0, 5).map((block): MokaSlide => ({
    type: "content",
    heading: block.title.slice(0, 18),
    text: getBlockDigest(block.body, 130),
    extra: getBlockExtra(block.body),
  }))
  const tags = getFallbackTags(fallbackTitle, blocks)
  const firstBody = getBlockDigest(blocks[0]?.body || fallbackSource, 70)
  const lastTitle = blocks[blocks.length - 1]?.title || blocks[0]?.title || cleanCardText(fallbackTitle)

  return [
    { type: "cover", emoji: "✨", title: cleanCardText(fallbackTitle || blocks[0]?.title || "内容精华笔记"), subtitle: firstBody },
    ...contentSlides,
    { type: "end", cta: "回看核心主线", sub: lastTitle ? `重点落在：${cleanCardText(lastTitle).slice(0, 28)}` : firstBody, tags },
  ]
}

function collectMokaText(result: MokaParsedResult): string {
  if (result.kind === "single") {
    return [
      result.content.title,
      result.content.lead,
      ...result.content.sections.flatMap((section) => [section.heading, section.text]),
      result.content.tip,
      ...(result.content.tags || []),
    ].filter(Boolean).join("\n")
  }
  if (result.kind === "ai-single") {
    return collectMokaText({ kind: "single", content: result.design.content, usedFallback: result.usedFallback })
  }
  const slides = result.kind === "split" ? result.slides : result.design.slides
  return slides.flatMap((slide) => [
    slide.title,
    slide.subtitle,
    slide.heading,
    slide.text,
    slide.extra,
    slide.cta,
    slide.sub,
    ...(slide.tags || []),
  ]).filter(Boolean).join("\n")
}

export function hasMokaContentQualityIssue(result: MokaParsedResult): boolean {
  if (result.usedFallback) return true
  const text = collectMokaText(result)
  if (!text.trim()) return true
  if (/来自原始材料的结构化摘要|收藏这组卡片|用输出工坊|继续输出|内容精华笔记|从材料提炼|一句话(?:概括|说明)文章主线|用原文事实解释观点|说明变化原因和影响|总结原文核心收获|封面标题|副标题|正文内容|小标题\d?|金句|互动语|标签\d|主题词\d?/i.test(text)) {
    return true
  }
  if (result.kind === "ai-split" || result.kind === "split") {
    const slides = result.kind === "split" ? result.slides : result.design.slides
    const coverSlide = slides.find((slide) => slide.type === "cover")
    const contentSlides = slides.filter((slide) => slide.type === "content")
    if (!coverSlide?.title?.trim()) return true
    if (contentSlides.length < 2) return true
    if (contentSlides.some((slide) => !slide.text || slide.text.length < 18)) return true
  }
  return false
}

function defaultSingleStyleConfig() {
  return {
    container: {
      background: "linear-gradient(135deg,#fff8f6 0%,#ffffff 100%)",
      padding: "30px",
      borderRadius: "18px",
      boxShadow: "0 18px 48px rgba(224,90,75,0.16)",
    },
    header: { title: { fontSize: "28px", fontWeight: "800", color: "#2a1210", marginBottom: "12px" } },
    lead: { fontSize: "14px", color: "#4a3330", marginBottom: "18px" },
    sections: [{ heading: { color: "#2a1210", before: "✦" }, text: { color: "#4a3330", lineHeight: "1.75" }, background: "#ffffff", borderLeft: "4px solid #e05a4b" }],
    tip: { background: "rgba(224,90,75,0.1)", color: "#4a3330", borderRadius: "12px" },
    tags: { background: "#ffffff", color: "#e05a4b", borderRadius: "16px" },
    decorations: [{ type: "circle", position: "top-right", style: { width: "110px", height: "110px", background: "rgba(224,90,75,0.12)" } }],
  }
}

function defaultSplitStyleConfig() {
  return {
    cover: {
      background: "linear-gradient(135deg,#e05a4b 0%,#8b3a62 100%)",
      title: { fontSize: "32px", fontWeight: "850", color: "#ffffff" },
      subtitle: { fontSize: "15px", color: "rgba(255,255,255,0.88)" },
    },
    content: {
      background: "#fff8f6",
      heading: { fontSize: "23px", fontWeight: "800", color: "#2a1210" },
      text: { fontSize: "15px", color: "#4a3330", lineHeight: "1.75" },
      extra: { fontSize: "13px", color: "#8b3a62", fontStyle: "italic" },
    },
    end: {
      background: "#2a1210",
      cta: { fontSize: "25px", fontWeight: "850", color: "#ffffff" },
      sub: { fontSize: "14px", color: "rgba(255,255,255,0.76)" },
      tags: { background: "rgba(255,255,255,0.12)", color: "#ffffff", borderRadius: "16px" },
    },
    decorations: [{ type: "circle", slide: "all", position: "top-right", style: { width: "100px", height: "100px", background: "rgba(255,255,255,0.14)" } }],
  }
}

export function parseMokaGenerationResult(
  templateId: string,
  raw: string,
  fallbackSource: string,
  fallbackTitle: string,
  kindOverride?: MokaTemplateKind,
): MokaParsedResult {
  const kind = kindOverride || getMokaTemplateKind(templateId) || "single"
  const parsed = parseJsonObject(raw)
  const usedFallback = !parsed
  const warning = usedFallback ? "未找到可解析的 moka JSON，已使用原文降级生成" : undefined

  if (kind === "split") {
    return { kind, slides: normalizeSlides(parsed, fallbackSource, fallbackTitle), usedFallback, warning }
  }

  if (kind === "ai-single") {
    const contentSource = isRecord(parsed?.content) ? parsed.content : parsed
    const design: MokaAiSingleDesign = {
      styleConfig: isRecord(parsed?.styleConfig) ? parsed.styleConfig : defaultSingleStyleConfig(),
      content: normalizeSingle(isRecord(contentSource) ? contentSource : null, fallbackSource, fallbackTitle),
    }
    return { kind, design, usedFallback, warning }
  }

  if (kind === "ai-split") {
    const design: MokaAiSplitDesign = {
      styleConfig: isRecord(parsed?.styleConfig) ? parsed.styleConfig : defaultSplitStyleConfig(),
      slides: normalizeSlides(parsed, fallbackSource, fallbackTitle),
    }
    return { kind, design, usedFallback, warning }
  }

  return { kind: kind as Extract<MokaTemplateKind, "single">, content: normalizeSingle(parsed, fallbackSource, fallbackTitle), usedFallback, warning }
}
