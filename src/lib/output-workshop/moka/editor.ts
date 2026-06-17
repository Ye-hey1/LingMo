/**
 * Moka 卡片可视化编辑：对 MokaParsedResult 做不可变的文本/样式/顺序编辑。
 * 从 use-output-generation hook 提取，使编辑逻辑可独立测试与复用。
 */
import type { MokaParsedResult } from "./types"
import { getPathValue, setPathValue } from "../utils/immutable-path"

function cloneMokaResult(result: MokaParsedResult): MokaParsedResult {
  return JSON.parse(JSON.stringify(result)) as MokaParsedResult
}

function sanitizeMokaInlineStyle(style: Record<string, string>): Record<string, string> {
  const allowed = new Set(["left", "top", "marginLeft", "marginTop"])
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => allowed.has(key) && /^-?\d+(?:\.\d+)?px$/.test(value))
  )
}

export function applyMokaTextEdit(result: MokaParsedResult, path: string, value: string): MokaParsedResult | null {
  if (result.kind !== "ai-single" && result.kind !== "ai-split") return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-single" && next.kind !== "ai-split") return null
  const root = next.design as unknown as Record<string, unknown>
  const normalizedValue = path.includes(".tags.") ? value.replace(/^#/, "").trim() : value.trim()
  return setPathValue(root, path, normalizedValue) ? next : null
}

export function applyMokaStyleEdit(result: MokaParsedResult, path: string, style: Record<string, string>): MokaParsedResult | null {
  if (result.kind !== "ai-single" && result.kind !== "ai-split") return null
  const cleanStyle = sanitizeMokaInlineStyle(style)
  if (Object.keys(cleanStyle).length === 0) return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-single" && next.kind !== "ai-split") return null
  const root = next.design as unknown as Record<string, unknown>
  const existing = getPathValue(root, path)
  const merged = {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {}),
    ...cleanStyle,
  }
  if ("left" in cleanStyle || "top" in cleanStyle) {
    delete merged.marginLeft
    delete merged.marginTop
  }
  return setPathValue(root, path, merged) ? next : null
}

export function applyMokaReorder(result: MokaParsedResult, from: number, to: number): MokaParsedResult | null {
  if (result.kind !== "ai-split") return null
  const slides = result.design.slides
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to < 0 || from >= slides.length || to >= slides.length || from === to) return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-split") return null
  const [moved] = next.design.slides.splice(from, 1)
  next.design.slides.splice(to > from ? to - 1 : to, 0, moved)
  return next
}
