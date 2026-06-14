import {
  getMokaPalette,
  getMokaStyleId,
  MOKA_AI_SINGLE_TEMPLATE_ID,
  MOKA_AI_SPLIT_TEMPLATE_ID,
  MOKA_FONT_FAMILY,
} from "./constants"
import type {
  MokaAiSingleDesign,
  MokaAiSplitDesign,
  MokaBuildOptions,
  MokaPalette,
  MokaSingleContent,
  MokaSlide,
  MokaStyleConfig,
} from "./types"
import { escapeHtml } from "../shared/escape"

function displayCategory(value: unknown, fallback = "精华"): string {
  const text = String(value ?? "").trim()
  if (!text || /^moka(?:\s|$|-)/i.test(text) || /^moka-ai-/i.test(text)) return fallback
  if (/^(?:title|titel|subtitle|heading|text|content|styleConfig|slides?|sections?|tags?|cta|sub|extra)$/i.test(text)) return fallback
  return text
}

function safeCss(value: unknown): string {
  return String(value ?? "")
    .replace(/<\//g, "<\\/")
    .replace(/[<>{}]/g, "")
    .replace(/"/g, "&quot;")
    .trim()
}

function styleAttr(style?: Record<string, unknown>): string {
  if (!style) return ""
  const css = Object.entries(style)
    .filter(([key, value]) => key !== "before" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${safeCss(value)}`)
    .join(";")
  return css ? ` style="${css}"` : ""
}

function mergeInlineStyle(base: Record<string, unknown>, override?: Record<string, unknown>): Record<string, unknown> {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base
  return { ...base, ...override }
}

function editAttr(path: string, stylePath?: string): string {
  return [
    `data-moka-edit-path="${escapeHtml(path)}"`,
    `data-moka-drag-path="${escapeHtml(stylePath || `${path}Style`)}"`,
    `contenteditable="true"`,
    `spellcheck="false"`,
    `tabindex="0"`,
  ].join(" ")
}

function reorderHandle(index: number): string {
  return `<button class="moka-reorder-handle" type="button" draggable="true" data-moka-reorder-handle="${index}" title="拖动调整页序" aria-label="拖动调整页序">⋮⋮</button>`
}

function editableText(value: unknown, path: string, stylePath: string, style?: Record<string, unknown>): string {
  return `<span ${editAttr(path, stylePath)}${styleAttr(style)}>${escapeHtml(value)}</span>`
}

function replaceFirstText(html: string, rawValue: unknown, replacement: string): string {
  const value = String(rawValue ?? "")
  if (!value) return html
  const escaped = escapeHtml(value)
  const direct = `>${escaped}<`
  const directIndex = html.indexOf(direct)
  if (directIndex >= 0) {
    return `${html.slice(0, directIndex + 1)}${replacement}${html.slice(directIndex + direct.length - 1)}`
  }
  const index = html.indexOf(escaped)
  if (index < 0) return html
  return `${html.slice(0, index)}${replacement}${html.slice(index + escaped.length)}`
}

function replaceFirstTagText(html: string, rawValue: unknown, replacement: string): string {
  const value = String(rawValue ?? "").replace(/^#/, "")
  if (!value) return html
  const escaped = escapeHtml(value)
  const target = `#${escaped}`
  const index = html.indexOf(target)
  if (index >= 0) {
    return `${html.slice(0, index)}#${replacement}${html.slice(index + target.length)}`
  }
  return replaceFirstText(html, value, replacement)
}

function addEditableSlideShell(html: string, index: number): string {
  return html.replace(/<article\b([^>]*)>/i, (opening, attrs: string) => {
    const nextAttrs = attrs.includes("data-moka-slide-index")
      ? attrs
      : `${attrs} data-moka-slide-index="${index}"`
    return `<article${nextAttrs}>${reorderHandle(index)}`
  })
}

function enhanceEditableSingleCard(html: string, content: MokaSingleContent): string {
  let next = html
  next = replaceFirstText(next, content.title, editableText(content.title, "content.title", "content.titleStyle", content.titleStyle as Record<string, unknown> | undefined))
  if (content.lead) {
    next = replaceFirstText(next, content.lead, editableText(content.lead, "content.lead", "content.leadStyle", content.leadStyle as Record<string, unknown> | undefined))
  }
  ;(content.sections || []).forEach((section, index) => {
    next = replaceFirstText(next, section.heading, editableText(section.heading, `content.sections.${index}.heading`, `content.sections.${index}.headingStyle`, section.headingStyle as Record<string, unknown> | undefined))
    next = replaceFirstText(next, section.text, editableText(section.text, `content.sections.${index}.text`, `content.sections.${index}.textStyle`, section.textStyle as Record<string, unknown> | undefined))
  })
  if (content.tip) {
    next = replaceFirstText(next, content.tip, editableText(content.tip, "content.tip", "content.tipStyle", content.tipStyle as Record<string, unknown> | undefined))
  }
  ;(content.tags || []).forEach((tag, index) => {
    next = replaceFirstTagText(next, tag, editableText(tag.replace(/^#/, ""), `content.tags.${index}`, `content.tagStyles.${index}`, content.tagStyles?.[index] as Record<string, unknown> | undefined))
  })
  return next
}

function enhanceEditableSlideCard(html: string, slide: MokaSlide, index: number): string {
  let next = addEditableSlideShell(html, index)
  if (slide.title) {
    next = replaceFirstText(next, slide.title, editableText(slide.title, `slides.${index}.title`, `slides.${index}.titleStyle`, slide.titleStyle as Record<string, unknown> | undefined))
  }
  if (slide.subtitle) {
    next = replaceFirstText(next, slide.subtitle, editableText(slide.subtitle, `slides.${index}.subtitle`, `slides.${index}.subtitleStyle`, slide.subtitleStyle as Record<string, unknown> | undefined))
  }
  if (slide.heading) {
    next = replaceFirstText(next, slide.heading, editableText(slide.heading, `slides.${index}.heading`, `slides.${index}.headingStyle`, slide.headingStyle as Record<string, unknown> | undefined))
  }
  if (slide.text) {
    next = replaceFirstText(next, slide.text, editableText(slide.text, `slides.${index}.text`, `slides.${index}.textStyle`, slide.textStyle as Record<string, unknown> | undefined))
  }
  if (slide.extra) {
    next = replaceFirstText(next, slide.extra, editableText(slide.extra, `slides.${index}.extra`, `slides.${index}.extraStyle`, slide.extraStyle as Record<string, unknown> | undefined))
  }
  if (slide.cta) {
    next = replaceFirstText(next, slide.cta, editableText(slide.cta, `slides.${index}.cta`, `slides.${index}.ctaStyle`, slide.ctaStyle as Record<string, unknown> | undefined))
  }
  if (slide.sub) {
    next = replaceFirstText(next, slide.sub, editableText(slide.sub, `slides.${index}.sub`, `slides.${index}.subStyle`, slide.subStyle as Record<string, unknown> | undefined))
  }
  ;(slide.tags || []).forEach((tag, tagIndex) => {
    next = replaceFirstTagText(next, tag, editableText(tag.replace(/^#/, ""), `slides.${index}.tags.${tagIndex}`, `slides.${index}.tagStyles.${tagIndex}`, slide.tagStyles?.[tagIndex] as Record<string, unknown> | undefined))
  })
  return next
}

function renderEditableSplitCards(slides: MokaSlide[], styleId: string, palette: MokaPalette): string {
  return slides
    .map((slide, index) => enhanceEditableSlideCard(renderSlide(slide, index, slides.length, styleId, palette), slide, index))
    .join("")
}

function getNestedStyle(config: MokaStyleConfig | undefined, path: string[], fallback: Record<string, unknown> = {}) {
  let current: unknown = config
  for (const key of path) {
    if (!current || typeof current !== "object") return fallback
    current = (current as Record<string, unknown>)[key]
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : fallback
}

function getStyleProfile(styleId: string, palette: MokaPalette) {
  const base = {
    accent: palette.a,
    bg: palette.bg,
    title: palette.tc,
    body: palette.bc,
    surface: "#ffffff",
    radius: "18px",
    font: MOKA_FONT_FAMILY,
    cardShadow: "0 18px 48px rgba(16, 24, 40, 0.13)",
    border: "1px solid rgba(0,0,0,0.08)",
  }

  switch (styleId) {
    case "dark":
    case "tech":
      return {
        ...base,
        bg: "#10131c",
        surface: "#171b27",
        title: "#f8fafc",
        body: "#cbd5e1",
        accent: palette.a,
        cardShadow: "0 24px 70px rgba(0,0,0,0.36)",
        border: "1px solid rgba(255,255,255,0.12)",
      }
    case "business":
    case "finance":
    case "law":
      return {
        ...base,
        bg: "#f7f8fb",
        surface: "#ffffff",
        title: "#111827",
        body: "#374151",
        accent: palette.a,
        radius: "8px",
        font: styleId === "law" ? "'Georgia','Times New Roman','SimSun',serif" : MOKA_FONT_FAMILY,
      }
    case "creamy":
    case "mom":
    case "korean":
      return {
        ...base,
        bg: "#fff7ed",
        surface: "#ffffff",
        title: "#3b2417",
        body: "#654332",
        accent: palette.a,
        radius: "24px",
        cardShadow: "0 18px 50px rgba(232,155,114,0.18)",
      }
    case "forest":
    case "medical":
      return {
        ...base,
        bg: "#f0faf5",
        title: "#0f2f22",
        body: "#315444",
        accent: palette.a,
      }
    case "pop":
    case "vivid":
    case "bold":
      return {
        ...base,
        bg: "#fffdf3",
        title: "#101010",
        body: "#262626",
        accent: palette.a,
        radius: "6px",
        cardShadow: "12px 12px 0 rgba(16,16,16,0.88)",
        border: "2px solid #111111",
      }
    case "pure":
    case "ins":
    case "clean":
    case "minimal":
      return {
        ...base,
        bg: "#fafafa",
        surface: "#ffffff",
        title: "#111111",
        body: "#4b5563",
        accent: palette.a,
        radius: "10px",
        cardShadow: "0 1px 0 rgba(0,0,0,0.08)",
      }
    case "paper":
    case "stamp":
    case "notecard":
      return {
        ...base,
        bg: "#fffaf0",
        surface: "#fffdf7",
        title: "#3a2a1f",
        body: "#5d493b",
        accent: palette.a,
        border: "1px dashed rgba(164,101,45,0.48)",
      }
    case "gradient":
      return {
        ...base,
        bg: "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
        surface: "rgba(255,255,255,0.94)",
        title: "#172033",
        body: "#334155",
        accent: "#667eea",
      }
    default:
      return base
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(224,90,75,${alpha})`
  const value = Number.parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function getDocumentBackground(profile: ReturnType<typeof getStyleProfile>): string {
  const bg = String(profile.bg || "#f8f8f8")
  if (bg.includes("gradient(")) return safeCss(bg)
  return [
    `radial-gradient(circle at top left, ${hexToRgba(profile.accent, 0.12)}, transparent 34%)`,
    `linear-gradient(180deg, color-mix(in srgb, ${safeCss(bg)} 88%, #ffffff), ${safeCss(bg)})`,
  ].join(",")
}

function renderDecorations(styleId: string, accent: string): string {
  if (["pure", "ins", "clean", "business", "law"].includes(styleId)) {
    return `<div class="moka-line-deco"></div>`
  }
  if (["paper", "stamp", "notecard"].includes(styleId)) {
    return `<div class="moka-paper-grid"></div><div class="moka-stamp">NOTE</div>`
  }
  if (["pop", "vivid", "bold"].includes(styleId)) {
    return `<div class="moka-pop-block one"></div><div class="moka-pop-block two"></div>`
  }
  return `<div class="moka-orb" style="background:${safeCss(accent)}22"></div>`
}

function renderTagList(tags: string[], className = "moka-tags"): string {
  const visibleTags = tags
    .map((tag) => displayCategory(tag.replace(/^#/, ""), ""))
    .filter(Boolean)
  return `<div class="${className}">${visibleTags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>`
}

function isStyle(styleId: string, ids: string[]): boolean {
  return ids.includes(styleId)
}

function renderTemplateTags(tags: string[], accent: string, dark = false, square = false): string {
  const visibleTags = (tags || [])
    .map((tag) => displayCategory(tag.replace(/^#/, ""), ""))
    .filter(Boolean)
  return `<div class="moka-tags">${visibleTags.map((tag) => `<span style="${[
    `background:${dark ? "rgba(255,255,255,0.12)" : hexToRgba(accent, 0.12)}`,
    `color:${dark ? "#ffffff" : safeCss(accent)}`,
    square ? "border-radius:4px" : "border-radius:999px",
  ].join(";")}">#${escapeHtml(tag)}</span>`).join("")}</div>`
}

function renderSlideDots(total: number, activeIndex: number, accent: string, variant: "block" | "pill" | "line" = "pill"): string {
  return `<div class="moka-page-dots moka-page-dots-${variant}">${Array.from({ length: total }).map((_, i) => {
    const active = i === activeIndex
    if (variant === "line") {
      return `<span style="width:${active ? "32px" : "8px"};height:3px;border-radius:0;background:${active ? safeCss(accent) : "#d8d8d8"}"></span>`
    }
    if (variant === "block") {
      return `<span style="width:${active ? "28px" : "8px"};height:8px;border-radius:0;transform:rotate(-1deg);background:${active ? safeCss(accent) : "#111111"}"></span>`
    }
    return `<span style="width:${active ? "28px" : "6px"};height:5px;border-radius:999px;background:${active ? safeCss(accent) : "#e5e5e5"}"></span>`
  }).join("")}</div>`
}

type MokaVisualFamily =
  | "swiss"
  | "poster"
  | "magazine"
  | "ledger"
  | "signal"
  | "dossier"
  | "fieldnote"
  | "archive"
  | "blueprint"
  | "breaking"
  | "paper"
  | "frosted"
  | "dark"
  | "brief"
  | "soft"
  | "organic"
  | "lifestyle"

function getVisualFamily(styleId: string, palette: MokaPalette): MokaVisualFamily {
  if (["vivid", "bold", "pop"].includes(styleId)) return "poster"
  if (["clean", "minimal", "pure"].includes(styleId)) return "swiss"
  if (["editorial", "luxury"].includes(styleId)) return "magazine"
  if (["paper", "stamp", "notecard", "newspaper"].includes(styleId)) return "ledger"
  if (["gradient", "tech"].includes(styleId)) return "signal"
  if (["dark"].includes(styleId)) return "dark"
  if (["business", "finance", "edu", "medical", "law"].includes(styleId)) return "dossier"
  if (["creamy", "mom", "korean", "japanese"].includes(styleId)) return "soft"
  if (["forest", "food", "travel"].includes(styleId)) return "fieldnote"
  if (["retro", "film", "artistic", "fashion", "label"].includes(styleId)) return "archive"
  if (styleId === "ai") {
    if (["rose", "sunset", "coral", "terracotta", "peach"].includes(palette.id)) return "poster"
    if (["ocean", "slate", "lavender", "mint", "ink"].includes(palette.id)) return "signal"
    if (["amber", "coffee", "gold", "rust", "plum", "wine"].includes(palette.id)) return "magazine"
    if (["pine", "forest", "sage"].includes(palette.id)) return "fieldnote"
    if (["midnight", "charcoal"].includes(palette.id)) return "archive"
  }
  return "swiss"
}

function getFamilyClass(family: MokaVisualFamily): string {
  return `moka-layout-xhs-${family}`
}

function titleSize(value: unknown, max: number, min: number): number {
  const length = Array.from(String(value ?? "")).length
  if (length > 42) return min
  if (length > 32) return Math.max(min, max - 8)
  if (length > 22) return Math.max(min, max - 4)
  return max
}

function renderFamilyTags(tags: string[], accent: string, dark = false): string {
  const visibleTags = (tags || [])
    .map((tag) => displayCategory(tag.replace(/^#/, ""), ""))
    .filter(Boolean)
    .slice(0, 4)
  if (!visibleTags.length) return ""
  return `<div class="moka-tags">${visibleTags.map((tag) => `<span style="background:${dark ? "rgba(255,255,255,0.12)" : hexToRgba(accent, 0.11)};color:${dark ? "#fff" : safeCss(accent)};border-radius:999px">#${escapeHtml(tag)}</span>`).join("")}</div>`
}

function renderThemeSingleCard(content: MokaSingleContent, styleId: string, palette: MokaPalette, profile: ReturnType<typeof getStyleProfile>): string {
  const family = getVisualFamily(styleId, palette)
  const sections = (content.sections || []).slice(0, 4)
  const category = displayCategory(content.category, family === "brief" ? "INSIGHT" : "精华")
  const baseClass = `moka-card moka-single moka-template-layout moka-style-${escapeHtml(styleId)} ${getFamilyClass(family)} moka-layout-${family === "breaking" ? "vivid" : family === "blueprint" ? "clean" : family === "soft" ? "pastel" : family === "organic" ? "organic" : family}`
  const h1 = titleSize(content.title, family === "breaking" ? 38 : family === "frosted" ? 36 : 34, 25)
  const sectionHtml = sections.map((section, index) => {
    if (family === "breaking") {
      return `<section style="display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start;border:2px solid #111;background:#fff;padding:10px 12px;transform:rotate(${index % 2 === 0 ? "-0.4deg" : "0.4deg"})"><b style="height:30px;background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:13px">${index + 1}</b><div><h3 style="font-size:14px;color:#111;line-height:1.25;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#333;line-height:1.68">${escapeHtml(section.text)}</p></div></section>`
    }
    if (family === "paper") {
      return `<section style="padding:8px 0;border-bottom:1px solid ${hexToRgba(profile.accent, 0.18)}"><h3 style="display:inline;font-size:13px;line-height:1.35;color:${safeCss(profile.accent)};background:linear-gradient(transparent 58%,${hexToRgba(profile.accent, 0.18)} 0)">${escapeHtml(section.heading)}</h3><p style="margin-top:5px;font-size:12px;color:${safeCss(profile.body)};line-height:1.78">${escapeHtml(section.text)}</p></section>`
    }
    if (family === "frosted") {
      return `<section style="display:grid;grid-template-columns:8px 1fr;gap:12px;padding:10px 0"><i style="border-radius:999px;background:${safeCss(profile.accent)}"></i><div><h3 style="font-size:13px;color:#0f172a;line-height:1.3;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#334155;line-height:1.72">${escapeHtml(section.text)}</p></div></section>`
    }
    if (family === "dark") {
      return `<section style="background:rgba(255,255,255,0.07);border:1px solid ${hexToRgba(profile.accent, 0.28)};padding:11px 12px"><h3 style="font-size:13px;color:#fff;margin-bottom:5px">${String(index + 1).padStart(2, "0")} ${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#cbd5e1;line-height:1.72">${escapeHtml(section.text)}</p></section>`
    }
    if (family === "brief") {
      return `<section style="display:grid;grid-template-columns:52px 1fr;gap:12px;padding:10px 0;border-top:1px solid #e5e7eb"><strong style="font-size:22px;color:${safeCss(profile.accent)};line-height:1">${String(index + 1).padStart(2, "0")}</strong><div><h3 style="font-size:14px;color:#111827;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#4b5563;line-height:1.7">${escapeHtml(section.text)}</p></div></section>`
    }
    if (family === "soft" || family === "organic") {
      return `<section style="padding:11px 13px;background:${family === "organic" ? "#ffffff" : "rgba(255,255,255,0.78)"};border-radius:${family === "organic" ? "16px 16px 16px 4px" : "18px"};border:1px solid ${hexToRgba(profile.accent, 0.16)}"><h3 style="font-size:13px;color:${safeCss(profile.title)};margin-bottom:4px">${family === "soft" ? "♡ " : ""}${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:${safeCss(profile.body)};line-height:1.72">${escapeHtml(section.text)}</p></section>`
    }
    if (family === "lifestyle") {
      return `<section style="border-top:1px solid rgba(255,255,255,0.18);padding-top:10px"><h3 style="font-size:13px;color:#fff;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:rgba(255,255,255,0.72);line-height:1.72">${escapeHtml(section.text)}</p></section>`
    }
    return `<section style="display:grid;grid-template-columns:30px 1fr;gap:12px;align-items:start"><b style="height:30px;border-radius:999px;background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:12px">${index + 1}</b><div><h3 style="font-size:14px;color:#111;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#4b5563;line-height:1.74">${escapeHtml(section.text)}</p></div></section>`
  }).join("")

  if (family === "swiss") {
    const swissTitle = titleSize(content.title, 42, 27)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:48px 1fr;gap:14px;min-height:82px;padding:12px 0;border-top:1px solid #d4d4d2">
      <b style="font-size:26px;font-weight:300;line-height:1;color:${safeCss(profile.accent)}">${String(index + 1).padStart(2, "0")}</b>
      <div><h3 style="font-size:14px;line-height:1.28;color:#0a0a0a;font-weight:650;margin-bottom:5px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#3f3f3d;line-height:1.72">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fafaf8;padding:30px 28px;border:1px solid #d4d4d2;border-radius:4px;box-shadow:none">
      <header style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;border-bottom:1px solid #0a0a0a;padding-bottom:16px;margin-bottom:24px">
        <span style="font-size:11px;letter-spacing:.18em;color:#0a0a0a;font-weight:650">${escapeHtml(category)}</span>
        <span style="font-size:11px;color:#737373">${sections.length || 1} POINTS</span>
      </header>
      <main style="display:grid;grid-template-rows:auto auto 1fr auto;gap:18px;min-height:0;flex:1">
        <h1 style="font-size:${swissTitle}px;line-height:1.02;color:#0a0a0a;font-weight:300">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="max-width:300px;font-size:14px;line-height:1.62;color:#2f2f2d">${escapeHtml(content.lead)}</p>` : ""}
        <div style="display:grid;align-content:start">${rows}</div>
        ${content.tip ? `<aside style="margin-top:auto;display:grid;grid-template-columns:60px 1fr;gap:14px;align-items:start;border-top:1px solid #0a0a0a;padding-top:14px"><strong style="font-size:28px;font-weight:300;color:${safeCss(profile.accent)}">→</strong><p style="font-size:12px;line-height:1.62;color:#0a0a0a">${escapeHtml(content.tip)}</p></aside>` : renderFamilyTags(content.tags || [], profile.accent)}
      </main>
    </article>`
  }

  if (family === "poster") {
    const posterTitle = titleSize(content.title, 44, 28)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:42px 1fr;gap:12px;align-items:start;background:#fff;padding:11px 12px;border:2px solid #111;transform:rotate(${index % 2 === 0 ? "-.35deg" : ".35deg"})">
      <b style="height:34px;background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:15px;font-weight:950">${index + 1}</b>
      <div><h3 style="font-size:14px;line-height:1.2;color:#111;font-weight:950;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#1f1f1f;line-height:1.64">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fff4df;padding:0;border:2px solid #111;border-radius:8px;box-shadow:8px 8px 0 #111">
      <header style="background:${safeCss(profile.accent)};color:#fff;padding:24px 24px 22px;border-bottom:2px solid #111">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:28px"><span style="background:#111;color:#fff;padding:5px 9px;font-size:11px;font-weight:900">${escapeHtml(category)}</span><span style="font-size:42px;font-weight:950;color:rgba(255,255,255,.82)">${String(sections.length || 1).padStart(2, "0")}</span></div>
        <h1 style="font-size:${posterTitle}px;line-height:.98;color:#fff;font-weight:950;letter-spacing:0">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="margin-top:12px;font-size:14px;line-height:1.52;color:rgba(255,255,255,.9);font-weight:750">${escapeHtml(content.lead)}</p>` : ""}
      </header>
      <main style="padding:18px 20px 22px;display:grid;gap:10px;flex:1">${rows}</main>
      ${content.tip ? `<aside style="margin:0 20px 20px;background:#111;color:#fff;padding:12px 14px;font-size:12px;line-height:1.6;font-weight:750">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  if (family === "magazine") {
    const magazineTitle = titleSize(content.title, 39, 26)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:38px 1fr;gap:14px;padding:12px 0;border-bottom:1px solid rgba(31,26,20,.18)">
      <span style="font-size:18px;color:${safeCss(profile.accent)};font-family:Georgia,'Times New Roman',serif">${String(index + 1).padStart(2, "0")}</span>
      <div><h3 style="font-size:15px;color:#1f1a14;line-height:1.35;font-weight:600;margin-bottom:5px;font-family:'Noto Serif SC','Songti SC',serif">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#4f463a;line-height:1.82;font-family:'Noto Serif SC','Songti SC',serif">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#f3f0e8;color:#1f1a14;padding:30px 27px;border-radius:6px;border:1px solid rgba(31,26,20,.16);box-shadow:none;font-family:'Noto Serif SC','Songti SC',serif">
      <div style="position:absolute;inset:0;background:radial-gradient(76% 46% at 12% 8%,${hexToRgba(profile.accent, 0.14)},transparent 66%),radial-gradient(54% 42% at 92% 82%,rgba(31,26,20,.08),transparent 70%);opacity:.88"></div>
      <header style="position:relative;z-index:1;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;border-bottom:1px solid rgba(31,26,20,.32);padding-bottom:13px;margin-bottom:18px">
        <span style="font:500 11px/1.2 ${MOKA_FONT_FAMILY};letter-spacing:.2em;color:#5f574c">${escapeHtml(category)}</span>
        <span style="font:500 11px/1.2 ${MOKA_FONT_FAMILY};letter-spacing:.16em;color:${safeCss(profile.accent)}">FEATURE</span>
      </header>
      <main style="position:relative;z-index:1;display:grid;gap:16px;flex:1">
        <h1 style="font-size:${magazineTitle}px;line-height:1.1;color:#1f1a14;font-weight:500;letter-spacing:.03em">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:16px;line-height:1.65;color:#3e372d;font-style:italic;border-block:1px solid rgba(31,26,20,.22);padding:11px 0">${escapeHtml(content.lead)}</p>` : ""}
        <div style="display:grid">${rows}</div>
        ${content.tip ? `<aside style="margin-top:auto;font-size:13px;line-height:1.7;color:#2d271f;background:rgba(255,255,255,.32);padding:13px 14px;border-top:1px solid rgba(31,26,20,.24)">${escapeHtml(content.tip)}</aside>` : renderFamilyTags(content.tags || [], profile.accent)}
      </main>
    </article>`
  }

  if (family === "ledger") {
    const ledgerTitle = titleSize(content.title, 34, 24)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:44px 1fr;gap:14px;min-height:76px;padding:12px 0;border-top:1px solid ${hexToRgba(profile.accent, 0.22)}">
      <b style="font-size:24px;line-height:1;color:${safeCss(profile.accent)};font-weight:800">${String(index + 1).padStart(2, "0")}</b>
      <div><h3 style="font-size:15px;line-height:1.26;color:#3a2a1f;font-weight:850;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#5d493b;line-height:1.78">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fffaf3;color:#3a2a1f;padding:28px 26px;border-radius:8px;border:1px solid ${hexToRgba(profile.accent, 0.22)};box-shadow:none">
      <div class="moka-paper-grid"></div>
      <header style="position:relative;z-index:1;display:grid;grid-template-columns:1fr 74px;gap:18px;align-items:start;margin-bottom:20px">
        <div><div style="font-size:11px;color:${safeCss(profile.accent)};font-weight:850;letter-spacing:.16em;margin-bottom:10px">${escapeHtml(category)}</div><h1 style="font-size:${ledgerTitle}px;line-height:1.12;color:#3a2a1f;font-weight:900">${escapeHtml(content.title)}</h1></div>
        <div style="height:74px;border:1px dashed ${hexToRgba(profile.accent, 0.62)};display:grid;place-items:center;color:${safeCss(profile.accent)};font-size:12px;font-weight:850;transform:rotate(4deg)">NOTE</div>
      </header>
      ${content.lead ? `<p style="position:relative;z-index:1;font-size:13px;line-height:1.72;color:#5d493b;margin-bottom:14px">${escapeHtml(content.lead)}</p>` : ""}
      <main style="position:relative;z-index:1;display:grid;flex:1">${rows}</main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:12px;border-top:1px dashed ${hexToRgba(profile.accent, 0.42)};padding-top:10px;font-size:12px;color:${safeCss(profile.accent)};line-height:1.65">${escapeHtml(content.tip)}</aside>` : renderFamilyTags(content.tags || [], profile.accent)}
    </article>`
  }

  if (family === "signal") {
    const signalTitle = titleSize(content.title, 40, 26)
    const matrix = sections.map((section, index) => `<section style="min-height:96px;background:#f0f0ee;padding:13px 14px;display:grid;align-content:start;gap:7px">
      <span style="font-size:11px;color:${safeCss(profile.accent)};font-weight:800">${String(index + 1).padStart(2, "0")}</span>
      <h3 style="font-size:15px;line-height:1.22;color:#0a0a0a;font-weight:750">${escapeHtml(section.heading)}</h3>
      <p style="font-size:12px;color:#424240;line-height:1.58">${escapeHtml(section.text)}</p>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fafaf8;padding:0;border-radius:4px;border:1px solid #d4d4d2;box-shadow:none">
      <header style="padding:26px 26px 20px;background:#0a0a0a;color:#fff">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:34px"><span style="font-size:11px;letter-spacing:.18em;color:rgba(255,255,255,.72);font-weight:700">${escapeHtml(category)}</span><span style="color:${safeCss(profile.accent)};font-size:46px;font-weight:250;line-height:.86">${String(sections.length || 1).padStart(2, "0")}</span></div>
        <h1 style="font-size:${signalTitle}px;line-height:1.02;color:#fff;font-weight:300">${escapeHtml(content.title)}</h1>
      </header>
      <main style="padding:22px 24px;display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1">${matrix}</main>
      ${content.lead ? `<p style="padding:0 24px 18px;font-size:13px;color:#2f2f2d;line-height:1.65">${escapeHtml(content.lead)}</p>` : ""}
      ${content.tip ? `<aside style="margin:0 24px 22px;background:${safeCss(profile.accent)};color:#fff;padding:12px 14px;font-size:12px;line-height:1.6;font-weight:700">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  if (family === "dossier") {
    const dossierTitle = titleSize(content.title, 34, 24)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:58px 1fr;gap:14px;padding:12px 0;border-top:1px solid #e5e7eb">
      <strong style="font-size:24px;line-height:1;color:${safeCss(profile.accent)};font-weight:750">${String(index + 1).padStart(2, "0")}</strong>
      <div><h3 style="font-size:15px;line-height:1.26;color:#111827;font-weight:750;margin-bottom:5px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#374151;line-height:1.72">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fff;padding:28px 28px;border-radius:6px;border:1px solid rgba(17,24,39,.14);box-shadow:none">
      <header style="display:grid;grid-template-columns:1fr 80px;gap:18px;align-items:end;border-bottom:2px solid #111827;padding-bottom:18px;margin-bottom:18px">
        <div><div style="font-size:11px;color:${safeCss(profile.accent)};font-weight:850;letter-spacing:.16em;margin-bottom:12px">${escapeHtml(category)}</div><h1 style="font-size:${dossierTitle}px;line-height:1.1;color:#111827;font-weight:850">${escapeHtml(content.title)}</h1></div>
        <div style="height:80px;background:#111827;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:800">${String(sections.length || 1).padStart(2, "0")}</div>
      </header>
      ${content.lead ? `<p style="font-size:13px;line-height:1.68;color:#374151;margin-bottom:12px">${escapeHtml(content.lead)}</p>` : ""}
      <main style="display:grid;flex:1">${rows}</main>
      ${content.tip ? `<aside style="margin-top:auto;border:1px solid #e5e7eb;background:#f8fafc;padding:12px 14px;font-size:12px;color:#374151;line-height:1.62">${escapeHtml(content.tip)}</aside>` : renderFamilyTags(content.tags || [], profile.accent)}
    </article>`
  }

  if (family === "fieldnote") {
    const fieldTitle = titleSize(content.title, 36, 25)
    const rows = sections.map((section, index) => `<section style="display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start;padding:11px 0;border-top:1px solid ${hexToRgba(profile.accent, 0.2)}">
      <span style="width:28px;height:28px;border-radius:2px;background:${hexToRgba(profile.accent, 0.12)};color:${safeCss(profile.accent)};display:grid;place-items:center;font-size:12px;font-weight:850">${index + 1}</span>
      <div><h3 style="font-size:15px;color:#16251b;line-height:1.28;font-weight:800;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:12px;color:#445040;line-height:1.74">${escapeHtml(section.text)}</p></div>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#f5f1e8;padding:28px 26px;border-radius:6px;border:1px solid ${hexToRgba(profile.accent, 0.18)};box-shadow:none">
      <div style="height:132px;background:linear-gradient(90deg,transparent 19px,${hexToRgba(profile.accent, 0.18)} 20px,transparent 21px),linear-gradient(180deg,transparent 21px,${hexToRgba(profile.accent, 0.18)} 22px,transparent 23px);background-size:42px 42px;border:1px solid ${hexToRgba(profile.accent, 0.2)};margin-bottom:18px;position:relative"><i style="position:absolute;left:26px;top:54px;width:60%;height:2px;background:${safeCss(profile.accent)};transform:rotate(-8deg)"></i><i style="position:absolute;right:40px;top:36px;width:8px;height:8px;background:${safeCss(profile.accent)};border-radius:50%"></i></div>
      <header style="margin-bottom:15px"><div style="font-size:11px;color:${safeCss(profile.accent)};letter-spacing:.14em;font-weight:850;margin-bottom:9px">${escapeHtml(category)}</div><h1 style="font-size:${fieldTitle}px;line-height:1.1;color:#16251b;font-weight:850">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:10px;font-size:13px;color:#4f594d;line-height:1.64">${escapeHtml(content.lead)}</p>` : ""}</header>
      <main style="display:grid;flex:1">${rows}</main>
      ${content.tip ? `<aside style="margin-top:12px;font-size:12px;color:#16251b;line-height:1.62;border-top:1px solid ${hexToRgba(profile.accent, 0.22)};padding-top:10px">${escapeHtml(content.tip)}</aside>` : renderFamilyTags(content.tags || [], profile.accent)}
    </article>`
  }

  if (family === "archive") {
    const archiveTitle = titleSize(content.title, 38, 25)
    const tiles = sections.map((section, index) => `<section style="min-height:94px;border:1px solid rgba(255,255,255,.18);padding:12px;background:rgba(255,255,255,.06)">
      <span style="font-size:11px;color:${safeCss(profile.accent)};font-weight:850">${String(index + 1).padStart(2, "0")}</span>
      <h3 style="font-size:14px;line-height:1.24;color:#fff;font-weight:850;margin:6px 0 4px">${escapeHtml(section.heading)}</h3>
      <p style="font-size:12px;line-height:1.62;color:rgba(255,255,255,.74)">${escapeHtml(section.text)}</p>
    </section>`).join("")
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#111;color:#f8f1e7;padding:0;border-radius:4px;border:1px solid rgba(255,255,255,.14);box-shadow:none">
      <header style="padding:20px 24px 18px;border-bottom:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:space-between"><span style="font-size:11px;letter-spacing:.18em;color:${safeCss(profile.accent)};font-weight:850">${escapeHtml(category)}</span><span style="font-size:11px;color:rgba(255,255,255,.52)">ARCHIVE</span></header>
      <main style="padding:24px 22px;display:grid;gap:16px;flex:1">
        <h1 style="font-size:${archiveTitle}px;line-height:.98;color:#fff;font-weight:900">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:13px;color:rgba(255,255,255,.76);line-height:1.7;border-top:1px solid rgba(255,255,255,.2);border-bottom:1px solid rgba(255,255,255,.2);padding:11px 0">${escapeHtml(content.lead)}</p>` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${tiles}</div>
      </main>
      ${content.tip ? `<aside style="margin:0 22px 22px;background:${hexToRgba(profile.accent, 0.16)};padding:12px 14px;color:#f8f1e7;font-size:12px;line-height:1.62">${escapeHtml(content.tip)}</aside>` : `<div style="padding:0 22px 22px">${renderFamilyTags(content.tags || [], profile.accent, true)}</div>`}
    </article>`
  }

  if (family === "breaking") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fff4df;padding:34px 30px;border:2px solid #111;border-radius:20px;box-shadow:10px 10px 0 #222;justify-content:center">
      <span style="position:absolute;top:48px;left:50%;transform:translateX(-50%) rotate(-2deg);background:#ff5a5f;color:#fff;border:2px solid #111;padding:5px 12px;font-size:11px;font-weight:900">BREAKING</span>
      <span style="position:absolute;top:34px;left:30px;color:${safeCss(profile.accent)};font-size:20px">⚡</span><span style="position:absolute;bottom:78px;right:32px;color:${safeCss(profile.accent)};font-size:20px">🔥</span>
      <header style="position:relative;z-index:1;text-align:center;margin-bottom:18px"><h1 style="font-size:${h1}px;line-height:1.05;color:#111;font-weight:950">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:13px;font-size:13px;line-height:1.65;color:#333;font-weight:700">${escapeHtml(content.lead)}</p>` : ""}<i style="display:block;width:48px;height:3px;background:#111;margin:16px auto 0"></i></header>
      <main style="position:relative;z-index:1;display:grid;gap:10px">${sectionHtml}</main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:12px;text-align:center;font-size:12px;line-height:1.6;color:#111;font-weight:700">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  if (family === "frosted") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:linear-gradient(135deg,#d6dde8,#f3f6f9);padding:34px 28px;border-radius:18px;border:1px solid rgba(15,23,42,0.14)">
      <div style="position:absolute;right:-26px;top:30px;width:158px;height:128px;background:linear-gradient(135deg,${hexToRgba(profile.accent, 0.26)},rgba(255,255,255,0.12));border-radius:34px;filter:blur(.2px);transform:rotate(8deg)"></div>
      <span style="position:absolute;left:26px;top:26px;background:#111;color:#fff;border-radius:5px;padding:5px 9px;font-size:12px;font-weight:800">${escapeHtml(category)}</span>
      <header style="position:relative;z-index:1;margin-top:104px;margin-bottom:24px"><h1 style="font-size:${h1}px;line-height:1.12;color:#111;font-weight:950">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="display:inline-block;margin-top:18px;background:#5bd779;color:#083516;padding:8px 14px;border-radius:4px;font-size:12px;font-weight:800">${escapeHtml(content.lead.slice(0, 28))}</p>` : ""}</header>
      <main style="position:relative;z-index:1;display:grid;gap:4px">${sectionHtml}</main>
      <div style="position:absolute;right:38px;bottom:34px;width:0;height:0;border-left:34px solid #111;border-top:20px solid transparent;border-bottom:20px solid transparent;transform:rotate(-18deg)"></div>
    </article>`
  }

  if (family === "paper") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fffaf3;padding:34px 28px;border-radius:16px;border:1px solid ${hexToRgba(profile.accent, 0.16)};color:${safeCss(profile.body)}">
      <i style="position:absolute;left:28px;right:28px;top:26px;height:2px;background:${hexToRgba(profile.accent, 0.18)}"></i>
      <header style="position:relative;z-index:1;margin-top:24px;margin-bottom:20px"><div style="font-size:11px;color:${safeCss(profile.accent)};font-weight:800;margin-bottom:10px">${escapeHtml(category)}</div><h1 style="font-size:${h1}px;line-height:1.16;color:${safeCss(profile.accent)};font-weight:950;background:linear-gradient(transparent 66%,${hexToRgba(profile.accent, 0.13)} 0)">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:15px;padding-left:10px;border-left:1px solid ${hexToRgba(profile.accent, 0.46)};font-size:12px;line-height:1.7;color:${safeCss(profile.body)}">${escapeHtml(content.lead)}</p>` : ""}</header>
      <main style="position:relative;z-index:1;display:grid;gap:4px">${sectionHtml}</main>
      ${content.tip ? `<aside style="margin-top:auto;font-size:12px;line-height:1.65;color:${safeCss(profile.accent)};font-weight:700">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  if (family === "dark" || family === "lifestyle") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:${family === "dark" ? "#07111f" : "#111"};color:#fff;padding:30px 26px;border:1px solid rgba(255,255,255,0.14);border-radius:${family === "lifestyle" ? "12px" : "18px"}">
      <div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 8%,${hexToRgba(profile.accent, 0.34)},transparent 34%),linear-gradient(135deg,transparent 0 48%,rgba(255,255,255,0.06) 48% 52%,transparent 52%)"></div>
      <header style="position:relative;z-index:1;margin-bottom:20px"><div style="font-size:12px;color:${safeCss(profile.accent)};font-weight:900;margin-bottom:18px">${escapeHtml(category)} / ${escapeHtml(content.emoji || "✨")}</div><h1 style="font-size:${h1}px;line-height:1.08;color:#fff;font-weight:950">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:13px;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.76)">${escapeHtml(content.lead)}</p>` : ""}</header>
      <main style="position:relative;z-index:1;display:grid;gap:10px">${sectionHtml}</main>
      ${renderFamilyTags(content.tags || [], profile.accent, true)}
    </article>`
  }

  if (family === "brief") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fff;padding:34px 30px;border-radius:8px;border:1px solid rgba(17,24,39,0.14)">
      <header style="display:grid;grid-template-columns:1fr 82px;gap:20px;align-items:start;margin-bottom:24px"><div><div style="font-size:11px;color:${safeCss(profile.accent)};font-weight:900;margin-bottom:14px">BRIEF · ${escapeHtml(category)}</div><h1 style="font-size:${h1}px;line-height:1.12;color:#111827;font-weight:950">${escapeHtml(content.title)}</h1></div><div style="height:82px;background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:34px;font-weight:900">${escapeHtml(content.emoji || "01")}</div></header>
      ${content.lead ? `<p style="font-size:13px;line-height:1.72;color:#374151;margin-bottom:16px">${escapeHtml(content.lead)}</p>` : ""}
      <main style="display:grid;gap:0">${sectionHtml}</main>
      ${content.tip ? `<aside style="margin-top:auto;padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;font-size:12px;color:#374151;line-height:1.65">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  if (family === "soft" || family === "organic") {
    return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:${family === "organic" ? "#f3fbf6" : "linear-gradient(180deg,#fff7ed,#fff 52%,#fff5f8)"};padding:30px 26px;border-radius:24px;border:1px solid ${hexToRgba(profile.accent, 0.14)}">
      <div style="position:absolute;right:-38px;top:-38px;width:150px;height:150px;border-radius:999px;background:${hexToRgba(profile.accent, 0.15)}"></div>
      <header style="position:relative;z-index:1;margin-bottom:16px"><div style="width:62px;height:62px;border-radius:${family === "organic" ? "20px 20px 20px 6px" : "999px"};background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:30px;margin-bottom:14px">${escapeHtml(content.emoji || "✨")}</div><div style="font-size:11px;color:${safeCss(profile.accent)};font-weight:800;margin-bottom:8px">${escapeHtml(category)}</div><h1 style="font-size:${h1}px;line-height:1.16;color:${safeCss(profile.title)};font-weight:950">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:11px;font-size:13px;color:${safeCss(profile.body)};line-height:1.72">${escapeHtml(content.lead)}</p>` : ""}</header>
      <main style="position:relative;z-index:1;display:grid;gap:9px">${sectionHtml}</main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:12px;font-size:12px;color:${safeCss(profile.body)};line-height:1.65">${escapeHtml(content.tip)}</aside>` : ""}
    </article>`
  }

  return `<article class="${baseClass}" data-moka-card data-moka-kind="single" style="background:#fff;padding:42px 36px;border-radius:12px;border:1px solid rgba(15,23,42,0.10)">
    <div style="position:absolute;right:0;top:0;width:34%;height:100%;background:${hexToRgba(profile.accent, 0.07)}"></div>
    <header style="position:relative;z-index:1;margin-top:92px;margin-bottom:22px"><div style="display:inline-flex;align-items:center;gap:8px;color:${safeCss(profile.accent)};font-size:12px;font-weight:800;margin-bottom:16px"><span style="width:48px;height:48px;border-radius:14px;background:${safeCss(profile.accent)};color:#fff;display:grid;place-items:center;font-size:24px">${escapeHtml(content.emoji || "✨")}</span>${escapeHtml(category)}</div><h1 style="font-size:${h1}px;line-height:1.08;color:#050505;font-weight:950">${escapeHtml(content.title)}</h1>${content.lead ? `<p style="margin-top:14px;font-size:13px;color:#4b5563;line-height:1.72">${escapeHtml(content.lead)}</p>` : ""}</header>
    <main style="position:relative;z-index:1;display:grid;gap:12px">${sectionHtml}</main>
    ${renderFamilyTags(content.tags || [], profile.accent)}
  </article>`
}

function slideAttrs(index: number, aiDesign = false): string {
  return `data-moka-card ${aiDesign ? `data-moka-ai-design="split" data-moka-slide-index="${index}" ` : ""}data-slide-index="${index}"`
}

function renderThemeSlide(slide: MokaSlide, index: number, total: number, styleId: string, palette: MokaPalette, profile: ReturnType<typeof getStyleProfile>, aiDesign = false): string {
  const family = getVisualFamily(styleId, palette)
  const accent = profile.accent
  const attrs = slideAttrs(index, aiDesign)
  const baseClass = `moka-card moka-slide moka-template-slide moka-style-${escapeHtml(styleId)} ${getFamilyClass(family)}`
  const activeDots = family === "breaking" ? "block" : family === "paper" || family === "brief" ? "line" : "pill"
  const dark = family === "dark" || family === "lifestyle" || family === "breaking"
  const title = slide.title || "内容精华笔记"
  const heading = slide.heading || `第 ${index} 页`
  const coverSize = titleSize(title, family === "frosted" ? 42 : family === "breaking" ? 38 : family === "paper" ? 36 : 34, 27)
  const headingSize = titleSize(heading, family === "brief" ? 28 : 26, 21)
  const dots = renderSlideDots(total, index, dark ? "#ffffff" : accent, activeDots)

  if (family === "swiss") {
    const swissDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-swiss" ${attrs} style="background:#fafaf8;padding:30px 28px;border:1px solid #d4d4d2;border-radius:4px;box-shadow:none">
        <header style="display:grid;grid-template-columns:1fr auto;gap:16px;border-bottom:1px solid #0a0a0a;padding-bottom:16px;margin-bottom:54px"><span style="font-size:11px;letter-spacing:.18em;color:#0a0a0a;font-weight:650">${escapeHtml(displayCategory(slide.category, "精华"))}</span><span style="font-size:11px;color:#737373">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></header>
        <main style="display:grid;grid-template-rows:auto 1fr auto;gap:22px;flex:1"><h1 style="font-size:${titleSize(title, 46, 30)}px;line-height:.98;color:#0a0a0a;font-weight:300">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="max-width:300px;font-size:15px;line-height:1.62;color:#2f2f2d">${escapeHtml(slide.subtitle)}</p>` : ""}<div style="align-self:end;width:120px;height:120px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:42px;font-weight:250">${String(total).padStart(2, "0")}</div></main>
        ${swissDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-swiss" ${attrs} style="background:#0a0a0a;color:#fff;padding:34px 30px;border-radius:4px;box-shadow:none">
        <header style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.22);padding-bottom:14px;margin-bottom:40px;color:rgba(255,255,255,.68);font-size:11px;letter-spacing:.14em"><span>SUMMARY</span><span>${String(total).padStart(2, "0")}</span></header>
        <main style="display:grid;align-content:center;gap:18px;flex:1"><h2 style="font-size:38px;line-height:1.02;color:#fff;font-weight:300">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:15px;color:rgba(255,255,255,.74);line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}</main>
        ${renderSlideDots(total, index, "#ffffff", "line")}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-swiss" ${attrs} style="background:#fafaf8;padding:30px 28px;border:1px solid #d4d4d2;border-radius:4px;box-shadow:none">
      <header style="display:grid;grid-template-columns:52px 1fr auto;gap:14px;align-items:start;border-bottom:1px solid #0a0a0a;padding-bottom:16px;margin-bottom:18px"><b style="font-size:32px;color:${safeCss(accent)};font-weight:300;line-height:.9">${String(index).padStart(2, "0")}</b><h2 style="font-size:${titleSize(heading, 31, 22)}px;line-height:1.08;color:#0a0a0a;font-weight:450">${escapeHtml(heading)}</h2><span style="font-size:11px;color:#737373">${index + 1}/${total}</span></header>
      <main style="display:grid;grid-template-rows:1fr auto;gap:20px;flex:1"><p style="font-size:15px;line-height:1.82;color:#2f2f2d">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="display:grid;grid-template-columns:42px 1fr;gap:14px;background:#f0f0ee;padding:14px 15px"><strong style="font-size:28px;color:${safeCss(accent)};font-weight:300">→</strong><p style="font-size:13px;line-height:1.62;color:#0a0a0a">${escapeHtml(slide.extra)}</p></aside>` : ""}</main>
      ${swissDots}
    </article>`
  }

  if (family === "poster") {
    const posterDots = renderSlideDots(total, index, "#111111", "block")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-poster" ${attrs} style="background:${safeCss(accent)};padding:0;border:2px solid #111;border-radius:8px;box-shadow:8px 8px 0 #111">
        <header style="display:flex;justify-content:space-between;align-items:start;padding:22px 24px;color:#fff"><span style="background:#111;padding:6px 10px;font-size:11px;font-weight:950">${escapeHtml(displayCategory(slide.category, "精华"))}</span><span style="font-size:54px;font-weight:950;color:rgba(255,255,255,.82);line-height:.85">${String(total).padStart(2, "0")}</span></header>
        <main style="padding:38px 26px 28px;display:grid;align-content:end;flex:1"><h1 style="font-size:${titleSize(title, 46, 30)}px;line-height:.94;color:#fff;font-weight:950">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="margin-top:16px;background:#fff;color:#111;border:2px solid #111;padding:10px 12px;font-size:14px;line-height:1.52;font-weight:800">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${posterDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-poster" ${attrs} style="background:#111;color:#fff;padding:30px 26px;border:2px solid #111;border-radius:8px;box-shadow:8px 8px 0 ${safeCss(accent)}">
        <div style="height:96px;background:${safeCss(accent)};border:2px solid #fff;margin-bottom:32px;display:grid;place-items:center;color:#fff;font-size:34px;font-weight:950">${String(index + 1).padStart(2, "0")}</div>
        <h2 style="font-size:36px;line-height:.98;color:#fff;font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="margin-top:14px;font-size:14px;color:rgba(255,255,255,.78);line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}${posterDots}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-poster" ${attrs} style="background:#fff;padding:26px 24px;border:2px solid #111;border-radius:8px;box-shadow:8px 8px 0 #111">
      <header style="display:grid;grid-template-columns:70px 1fr;gap:14px;align-items:stretch;margin-bottom:20px"><b style="background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:28px;font-weight:950">${String(index).padStart(2, "0")}</b><h2 style="border:2px solid #111;padding:12px 14px;font-size:${titleSize(heading, 28, 22)}px;line-height:1.08;color:#111;font-weight:950">${escapeHtml(heading)}</h2></header>
      <main style="display:grid;gap:16px;flex:1"><p style="font-size:15px;color:#111;line-height:1.78">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="margin-top:auto;background:${hexToRgba(accent, 0.12)};border:2px solid #111;padding:13px 15px;font-size:13px;line-height:1.65;color:#111;font-weight:750">${escapeHtml(slide.extra)}</aside>` : ""}</main>${posterDots}
    </article>`
  }

  if (family === "magazine") {
    const magazineDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-magazine" ${attrs} style="background:#f3f0e8;color:#1f1a14;padding:30px 28px;border-radius:6px;border:1px solid rgba(31,26,20,.16);box-shadow:none;font-family:'Noto Serif SC','Songti SC',serif">
        <div style="position:absolute;inset:0;background:radial-gradient(70% 44% at 18% 8%,${hexToRgba(accent, 0.14)},transparent 68%),radial-gradient(60% 44% at 84% 82%,rgba(31,26,20,.08),transparent 70%)"></div>
        <header style="position:relative;z-index:1;display:grid;grid-template-columns:1fr auto;border-bottom:1px solid rgba(31,26,20,.32);padding-bottom:14px;margin-bottom:44px"><span style="font:500 11px/1.2 ${MOKA_FONT_FAMILY};letter-spacing:.18em;color:#5f574c">${escapeHtml(displayCategory(slide.category, "精华"))}</span><span style="font:500 11px/1.2 ${MOKA_FONT_FAMILY};letter-spacing:.16em;color:${safeCss(accent)}">FEATURE</span></header>
        <main style="position:relative;z-index:1;display:grid;gap:18px;flex:1"><h1 style="font-size:${titleSize(title, 42, 28)}px;line-height:1.08;color:#1f1a14;font-weight:500;letter-spacing:.03em">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:17px;line-height:1.62;color:#3e372d;font-style:italic;border-block:1px solid rgba(31,26,20,.22);padding:12px 0">${escapeHtml(slide.subtitle)}</p>` : ""}<div style="margin-top:auto;height:128px;background:rgba(255,255,255,.32);border-top:1px solid rgba(31,26,20,.24);border-bottom:1px solid rgba(31,26,20,.14)"></div></main>${magazineDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-magazine" ${attrs} style="background:#1f1a14;color:#f3f0e8;padding:34px 30px;border-radius:6px;box-shadow:none;font-family:'Noto Serif SC','Songti SC',serif">
        <header style="font:500 11px/1.2 ${MOKA_FONT_FAMILY};letter-spacing:.18em;color:${safeCss(accent)};border-bottom:1px solid rgba(243,240,232,.24);padding-bottom:14px;margin-bottom:36px">CLOSING NOTE</header>
        <main style="display:grid;align-content:center;gap:18px;flex:1"><h2 style="font-size:34px;line-height:1.08;color:#f3f0e8;font-weight:500">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:15px;line-height:1.72;color:rgba(243,240,232,.74);font-style:italic">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}</main>${renderSlideDots(total, index, "#f3f0e8", "line")}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-magazine" ${attrs} style="background:#f3f0e8;color:#1f1a14;padding:30px 28px;border-radius:6px;border:1px solid rgba(31,26,20,.16);box-shadow:none;font-family:'Noto Serif SC','Songti SC',serif">
      <header style="display:grid;grid-template-columns:46px 1fr;gap:16px;align-items:start;border-bottom:1px solid rgba(31,26,20,.28);padding-bottom:16px;margin-bottom:18px"><span style="font-size:22px;color:${safeCss(accent)}">${String(index).padStart(2, "0")}</span><h2 style="font-size:${titleSize(heading, 31, 22)}px;line-height:1.18;color:#1f1a14;font-weight:500">${escapeHtml(heading)}</h2></header>
      <main style="display:grid;grid-template-columns:1fr 78px;gap:18px;flex:1"><p style="font-size:14px;line-height:1.9;color:#3e372d">${escapeHtml(slide.text || "")}</p><aside style="border-left:1px solid rgba(31,26,20,.22);padding-left:12px;font:500 11px/1.55 ${MOKA_FONT_FAMILY};letter-spacing:.12em;color:${safeCss(accent)}">${escapeHtml((slide.extra || "NOTE").slice(0, 44))}</aside></main>${magazineDots}
    </article>`
  }

  if (family === "ledger") {
    const ledgerDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-ledger" ${attrs} style="background:#fffaf3;padding:30px 28px;border:1px solid ${hexToRgba(accent, 0.22)};border-radius:8px;box-shadow:none">
        <div class="moka-paper-grid"></div><header style="position:relative;z-index:1;display:grid;grid-template-columns:1fr 74px;gap:16px;align-items:start;margin-bottom:40px"><span style="font-size:11px;color:${safeCss(accent)};font-weight:850;letter-spacing:.16em">${escapeHtml(displayCategory(slide.category, "精华"))}</span><span style="height:74px;border:1px dashed ${hexToRgba(accent, 0.62)};display:grid;place-items:center;color:${safeCss(accent)};font-size:12px;font-weight:850;transform:rotate(4deg)">NOTE</span></header>
        <main style="position:relative;z-index:1;display:grid;gap:16px;flex:1"><h1 style="font-size:${titleSize(title, 38, 27)}px;line-height:1.08;color:#3a2a1f;font-weight:900">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:14px;line-height:1.72;color:#5d493b;border-top:1px solid ${hexToRgba(accent, 0.22)};padding-top:13px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${ledgerDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-ledger" ${attrs} style="background:#fffaf3;padding:34px 30px;border:1px solid ${hexToRgba(accent, 0.22)};border-radius:8px;box-shadow:none"><div class="moka-paper-grid"></div>
        <main style="position:relative;z-index:1;display:grid;align-content:center;gap:16px;flex:1"><h2 style="font-size:32px;line-height:1.12;color:#3a2a1f;font-weight:900">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;line-height:1.7;color:#5d493b">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent)}</main>${ledgerDots}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-ledger" ${attrs} style="background:#fffaf3;padding:30px 28px;border:1px solid ${hexToRgba(accent, 0.22)};border-radius:8px;box-shadow:none"><div class="moka-paper-grid"></div>
      <header style="position:relative;z-index:1;display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start;margin-bottom:18px"><b style="font-size:26px;color:${safeCss(accent)};font-weight:850;line-height:1">${String(index).padStart(2, "0")}</b><h2 style="font-size:${titleSize(heading, 29, 22)}px;line-height:1.14;color:#3a2a1f;font-weight:900">${escapeHtml(heading)}</h2></header>
      <main style="position:relative;z-index:1;display:grid;grid-template-rows:1fr auto;gap:16px;flex:1;border-top:1px solid ${hexToRgba(accent, 0.22)};padding-top:14px"><p style="font-size:15px;line-height:1.9;color:#5d493b">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="border-top:1px dashed ${hexToRgba(accent, 0.42)};padding-top:11px;font-size:13px;color:${safeCss(accent)};line-height:1.66">${escapeHtml(slide.extra)}</aside>` : ""}</main>${ledgerDots}
    </article>`
  }

  if (family === "signal") {
    const signalDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-signal" ${attrs} style="background:#0a0a0a;color:#fff;padding:30px 28px;border-radius:4px;box-shadow:none">
        <header style="display:flex;justify-content:space-between;margin-bottom:46px;color:rgba(255,255,255,.66);font-size:11px;letter-spacing:.16em"><span>${escapeHtml(displayCategory(slide.category, "AI指南"))}</span><span>${String(total).padStart(2, "0")}</span></header>
        <main style="display:grid;align-content:end;gap:18px;flex:1"><h1 style="font-size:${titleSize(title, 44, 29)}px;line-height:1;color:#fff;font-weight:300">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,.76)">${escapeHtml(slide.subtitle)}</p>` : ""}<div style="height:86px;background:${safeCss(accent)}"></div></main>${renderSlideDots(total, index, "#ffffff", "line")}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-signal" ${attrs} style="background:${safeCss(accent)};color:#fff;padding:34px 30px;border-radius:4px;box-shadow:none">
        <main style="display:grid;align-content:center;gap:18px;flex:1"><span style="font-size:12px;letter-spacing:.16em;font-weight:800">NEXT</span><h2 style="font-size:38px;line-height:1;color:#fff;font-weight:300">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:15px;line-height:1.68;color:rgba(255,255,255,.84)">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], "#ffffff", true)}</main>${renderSlideDots(total, index, "#ffffff", "line")}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-signal" ${attrs} style="background:#fafaf8;padding:0;border:1px solid #d4d4d2;border-radius:4px;box-shadow:none">
      <header style="padding:24px 26px;background:#0a0a0a;color:#fff"><span style="font-size:11px;color:${safeCss(accent)};font-weight:850">${String(index).padStart(2, "0")}</span><h2 style="margin-top:12px;font-size:${titleSize(heading, 31, 22)}px;line-height:1.08;color:#fff;font-weight:350">${escapeHtml(heading)}</h2></header>
      <main style="padding:22px 24px;display:grid;grid-template-rows:1fr auto;gap:18px;flex:1"><p style="font-size:15px;line-height:1.82;color:#2f2f2d">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="background:#f0f0ee;padding:14px 15px;font-size:13px;line-height:1.65;color:#0a0a0a">${escapeHtml(slide.extra)}</aside>` : ""}</main>${signalDots}
    </article>`
  }

  if (family === "dossier") {
    const dossierDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-dossier" ${attrs} style="background:#fff;padding:32px 30px;border-radius:6px;border:1px solid rgba(17,24,39,.14);box-shadow:none">
        <div style="font-size:11px;color:${safeCss(accent)};font-weight:850;letter-spacing:.16em;margin-bottom:34px">BRIEF · ${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</div>
        <main style="display:grid;grid-template-columns:1fr 92px;gap:20px;align-items:end;flex:1"><h1 style="font-size:${titleSize(title, 38, 27)}px;line-height:1.08;color:#111827;font-weight:850">${escapeHtml(title)}</h1><div style="height:92px;background:#111827;color:#fff;display:grid;place-items:center;font-size:32px;font-weight:800">${String(total).padStart(2, "0")}</div></main>${slide.subtitle ? `<p style="font-size:14px;color:#374151;line-height:1.68;margin-top:18px">${escapeHtml(slide.subtitle)}</p>` : ""}${dossierDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-dossier" ${attrs} style="background:#111827;color:#fff;padding:36px 30px;border-radius:6px;box-shadow:none">
        <div style="font-size:11px;color:${safeCss(accent)};font-weight:850;letter-spacing:.16em;margin-bottom:32px;text-align:center">SUMMARY</div><main style="display:grid;align-content:center;gap:16px;flex:1;text-align:center"><h2 style="font-size:34px;color:#fff;line-height:1.1;font-weight:800">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,.72);line-height:1.68">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}</main>${renderSlideDots(total, index, "#ffffff", "line")}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-dossier" ${attrs} style="background:#fff;padding:30px 28px;border-radius:6px;border:1px solid rgba(17,24,39,.14);box-shadow:none">
      <header style="display:grid;grid-template-columns:58px 1fr;gap:16px;align-items:start;border-bottom:2px solid #111827;padding-bottom:16px;margin-bottom:18px"><b style="font-size:28px;color:${safeCss(accent)};line-height:1;font-weight:800">${String(index).padStart(2, "0")}</b><h2 style="font-size:${titleSize(heading, 29, 22)}px;line-height:1.14;color:#111827;font-weight:800">${escapeHtml(heading)}</h2></header><main style="display:grid;grid-template-rows:1fr auto;gap:16px;flex:1"><p style="font-size:15px;color:#374151;line-height:1.86">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="border:1px solid #e5e7eb;background:#f8fafc;padding:13px 14px;font-size:13px;color:#374151;line-height:1.66">${escapeHtml(slide.extra)}</aside>` : ""}</main>${dossierDots}
    </article>`
  }

  if (family === "fieldnote") {
    const fieldDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-fieldnote" ${attrs} style="background:#f5f1e8;padding:28px 26px;border-radius:6px;border:1px solid ${hexToRgba(accent, 0.18)};box-shadow:none">
        <div style="height:168px;background:linear-gradient(90deg,transparent 19px,${hexToRgba(accent, 0.18)} 20px,transparent 21px),linear-gradient(180deg,transparent 21px,${hexToRgba(accent, 0.18)} 22px,transparent 23px);background-size:42px 42px;border:1px solid ${hexToRgba(accent, 0.2)};margin-bottom:28px;position:relative"><i style="position:absolute;left:26px;top:76px;width:64%;height:2px;background:${safeCss(accent)};transform:rotate(-8deg)"></i><i style="position:absolute;right:40px;top:48px;width:8px;height:8px;background:${safeCss(accent)};border-radius:50%"></i></div>
        <main style="display:grid;gap:14px;flex:1"><span style="font-size:11px;color:${safeCss(accent)};letter-spacing:.14em;font-weight:850">${escapeHtml(displayCategory(slide.category, "精华"))}</span><h1 style="font-size:${titleSize(title, 39, 28)}px;line-height:1.06;color:#16251b;font-weight:850">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:14px;color:#4f594d;line-height:1.66">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${fieldDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-fieldnote" ${attrs} style="background:#16251b;color:#fff;padding:34px 30px;border-radius:6px;box-shadow:none"><main style="display:grid;align-content:center;gap:16px;flex:1"><span style="font-size:11px;color:${safeCss(accent)};letter-spacing:.14em;font-weight:850">FIELD END</span><h2 style="font-size:34px;line-height:1.08;color:#fff;font-weight:800">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,.76);line-height:1.68">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}</main>${renderSlideDots(total, index, "#ffffff", "line")}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-fieldnote" ${attrs} style="background:#f5f1e8;padding:30px 28px;border-radius:6px;border:1px solid ${hexToRgba(accent, 0.18)};box-shadow:none">
      <header style="display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:start;margin-bottom:16px"><span style="width:30px;height:30px;background:${hexToRgba(accent, 0.12)};color:${safeCss(accent)};display:grid;place-items:center;font-size:12px;font-weight:850">${index}</span><h2 style="font-size:${titleSize(heading, 30, 22)}px;line-height:1.14;color:#16251b;font-weight:850">${escapeHtml(heading)}</h2></header>
      <main style="display:grid;grid-template-rows:1fr auto;gap:16px;flex:1;border-top:1px solid ${hexToRgba(accent, 0.22)};padding-top:14px"><p style="font-size:15px;line-height:1.86;color:#445040">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="font-size:13px;color:#16251b;line-height:1.66;border-top:1px solid ${hexToRgba(accent, 0.22)};padding-top:11px">${escapeHtml(slide.extra)}</aside>` : ""}</main>${fieldDots}
    </article>`
  }

  if (family === "archive") {
    const archiveDots = renderSlideDots(total, index, accent, "line")
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-archive" ${attrs} style="background:#111;color:#fff;padding:0;border-radius:4px;border:1px solid rgba(255,255,255,.14);box-shadow:none">
        <header style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.18);display:flex;justify-content:space-between"><span style="font-size:11px;letter-spacing:.18em;color:${safeCss(accent)};font-weight:850">${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</span><span style="font-size:11px;color:rgba(255,255,255,.52)">ARCHIVE</span></header>
        <main style="padding:36px 24px 26px;display:grid;align-content:end;gap:18px;flex:1"><h1 style="font-size:${titleSize(title, 44, 29)}px;line-height:.96;color:#fff;font-weight:900">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:15px;color:rgba(255,255,255,.76);line-height:1.68;border-top:1px solid rgba(255,255,255,.2);padding-top:12px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${archiveDots}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-archive" ${attrs} style="background:#111;color:#fff;padding:34px 30px;border-radius:4px;border:1px solid rgba(255,255,255,.14);box-shadow:none"><main style="display:grid;align-content:center;gap:16px;flex:1"><span style="font-size:11px;color:${safeCss(accent)};letter-spacing:.18em;font-weight:850">ARCHIVE END</span><h2 style="font-size:34px;line-height:1;color:#fff;font-weight:900">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,.72);line-height:1.68">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}</main>${archiveDots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-archive" ${attrs} style="background:#111;color:#fff;padding:28px 24px;border-radius:4px;border:1px solid rgba(255,255,255,.14);box-shadow:none">
      <header style="display:flex;justify-content:space-between;color:${safeCss(accent)};font-size:11px;font-weight:850;margin-bottom:22px"><span>NO.${String(index).padStart(2, "0")}</span><span>${index + 1}/${total}</span></header>
      <main style="display:grid;grid-template-rows:auto 1fr auto;gap:16px;flex:1"><h2 style="font-size:${titleSize(heading, 30, 22)}px;line-height:1.1;color:#fff;font-weight:900">${escapeHtml(heading)}</h2><p style="font-size:14px;line-height:1.86;color:rgba(255,255,255,.74)">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<aside style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);padding:13px 14px;font-size:13px;line-height:1.66;color:rgba(255,255,255,.78)">${escapeHtml(slide.extra)}</aside>` : ""}</main>${archiveDots}
    </article>`
  }

  if (family === "breaking") {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-vivid" ${attrs} style="background:#fff4df;padding:34px 30px;border:2px solid #111;border-radius:20px;box-shadow:10px 10px 0 #222;text-align:center">
        <span style="position:absolute;top:48px;left:50%;transform:translateX(-50%) rotate(-2deg);background:#ff5a5f;color:#fff;border:2px solid #111;padding:5px 12px;font-size:11px;font-weight:950">BREAKING</span>
        <span style="position:absolute;top:34px;left:30px;color:${safeCss(accent)};font-size:20px">⚡</span><span style="position:absolute;bottom:86px;right:34px;color:${safeCss(accent)};font-size:22px">🔥</span>
        <main style="position:relative;z-index:1;display:grid;align-content:center;justify-items:center;min-height:100%"><h1 style="font-size:${coverSize}px;line-height:1.05;color:#111;font-weight:950;max-width:320px">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="margin-top:14px;font-size:14px;line-height:1.55;color:#333;font-weight:800;max-width:300px">${escapeHtml(slide.subtitle)}</p>` : ""}<i style="display:block;width:48px;height:3px;background:#111;margin-top:18px"></i></main>${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-vivid" ${attrs} style="background:#111;color:#fff;padding:36px 30px;border:2px solid #111;border-radius:20px;box-shadow:10px 10px 0 ${safeCss(accent)};justify-content:center;text-align:center"><div style="font-size:44px;margin-bottom:16px">${escapeHtml(slide.emoji || "✨")}</div><h2 style="font-size:30px;line-height:1.08;color:#fff;font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="margin-top:12px;color:rgba(255,255,255,.76);font-size:14px;line-height:1.65">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-vivid" ${attrs} style="background:#fff;padding:32px 28px;border:2px solid #111;border-radius:12px;box-shadow:10px 10px 0 #222"><header style="display:grid;grid-template-columns:70px 1fr auto;gap:16px;align-items:center;margin-bottom:26px"><b style="height:64px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:26px;font-weight:950">${String(index).padStart(2, "0")}</b><i style="height:3px;background:#111"></i><span style="width:14px;height:14px;background:#111;transform:rotate(45deg)"></span></header><main style="display:grid;gap:18px;flex:1"><h2 style="font-size:${headingSize}px;line-height:1.16;color:#111;font-weight:950">${escapeHtml(heading)}</h2><p style="font-size:15px;line-height:1.88;color:#111">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:auto;background:${hexToRgba(accent, 0.09)};border-left:4px solid ${safeCss(accent)};padding:14px 16px;font-size:13px;line-height:1.72;color:#111">${escapeHtml(slide.extra)}</blockquote>` : ""}</main>${dots}</article>`
  }

  if (family === "frosted") {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-gradient" ${attrs} style="background:linear-gradient(135deg,#d6dde8,#f5f7fa);padding:34px 28px;border-radius:18px;border:1px solid rgba(15,23,42,0.12)"><div style="position:absolute;right:-24px;top:30px;width:160px;height:128px;border-radius:34px;background:linear-gradient(135deg,${hexToRgba(accent, 0.28)},rgba(255,255,255,0.16));transform:rotate(8deg)"></div><span style="position:absolute;top:28px;left:28px;background:#111;color:#fff;border-radius:5px;padding:5px 9px;font-size:12px;font-weight:850">${escapeHtml(displayCategory(slide.category, "AI指南"))}</span><main style="position:relative;z-index:1;margin-top:108px"><h1 style="font-size:${coverSize}px;line-height:1.12;color:#111;font-weight:950">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="margin-top:18px;display:inline-block;background:#5bd779;color:#083516;padding:8px 14px;border-radius:4px;font-size:13px;font-weight:850">${escapeHtml(slide.subtitle)}</p>` : ""}</main><div style="position:absolute;right:38px;bottom:34px;width:0;height:0;border-left:34px solid #111;border-top:20px solid transparent;border-bottom:20px solid transparent;transform:rotate(-18deg)"></div>${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-gradient" ${attrs} style="background:linear-gradient(135deg,#e8edf4,#ffffff);padding:38px 30px;justify-content:center;text-align:left;border-radius:18px"><h2 style="font-size:32px;line-height:1.12;color:#111;font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="margin-top:14px;font-size:14px;color:#334155;line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-gradient" ${attrs} style="background:linear-gradient(135deg,#f8fbff,#ffffff);padding:36px 34px;border-radius:18px;border:1px solid ${hexToRgba(accent, 0.14)}"><header style="display:flex;align-items:center;gap:18px;margin-bottom:26px"><span style="width:62px;height:62px;border-radius:999px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:24px">${index}</span><i style="flex:1;height:2px;background:#e5e7eb"></i></header><h2 style="font-size:${headingSize}px;line-height:1.18;color:#111;font-weight:950;margin-bottom:18px">${escapeHtml(heading)}</h2><p style="font-size:15px;color:#334155;line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:20px;padding:16px 18px;background:#eef6fa;border-left:4px solid ${safeCss(accent)};border-radius:10px;font-size:13px;color:#1f2937;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
  }

  if (family === "paper") {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-paper" ${attrs} style="background:#fffaf3;padding:34px 30px;border:1px solid ${hexToRgba(accent, 0.16)};border-radius:16px"><i style="position:absolute;left:28px;right:28px;top:28px;height:2px;background:${hexToRgba(accent, 0.18)}"></i><main style="display:grid;align-content:center;min-height:100%;position:relative;z-index:1"><h1 style="font-size:${coverSize}px;line-height:1.16;color:${safeCss(accent)};font-weight:950;background:linear-gradient(transparent 66%,${hexToRgba(accent, 0.13)} 0)">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="margin-top:18px;border-left:1px solid ${hexToRgba(accent, 0.44)};padding-left:12px;font-size:14px;line-height:1.7;color:${safeCss(profile.body)}">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-paper" ${attrs} style="background:#fffaf3;padding:36px 30px;border-radius:16px;justify-content:center"><h2 style="font-size:30px;line-height:1.16;color:${safeCss(accent)};font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="margin-top:14px;font-size:14px;color:${safeCss(profile.body)};line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-paper" ${attrs} style="background:#fffaf3;padding:34px 30px;border:1px solid ${hexToRgba(accent, 0.16)};border-radius:16px"><header style="display:flex;align-items:center;gap:16px;margin-bottom:24px"><b style="font-size:34px;color:${safeCss(accent)};line-height:1">${String(index).padStart(2, "0")}</b><i style="height:2px;flex:1;background:${hexToRgba(accent, 0.18)}"></i></header><h2 style="font-size:${headingSize}px;line-height:1.18;color:${safeCss(accent)};font-weight:950;margin-bottom:16px;background:linear-gradient(transparent 64%,${hexToRgba(accent, 0.12)} 0)">${escapeHtml(heading)}</h2><p style="font-size:15px;color:${safeCss(profile.body)};line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:13px 15px;border-left:2px solid ${safeCss(accent)};background:#fff;font-size:13px;color:${safeCss(profile.body)};line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
  }

  if (family === "dark" || family === "lifestyle") {
    const bg = family === "dark" ? "#07111f" : "#111"
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-dark" ${attrs} style="background:${bg};color:#fff;padding:32px 28px;border:1px solid rgba(255,255,255,0.14)"><div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 8%,${hexToRgba(accent, 0.34)},transparent 34%)"></div><main style="position:relative;z-index:1;display:grid;align-content:end;min-height:100%;padding-bottom:56px"><div style="font-size:12px;color:${safeCss(accent)};font-weight:900;margin-bottom:18px">${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</div><h1 style="font-size:${coverSize}px;line-height:1.08;color:#fff;font-weight:950">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="margin-top:14px;border-left:3px solid ${safeCss(accent)};padding-left:12px;color:rgba(255,255,255,.76);font-size:14px;line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-dark" ${attrs} style="background:${bg};color:#fff;padding:38px 30px;justify-content:center;text-align:center"><h2 style="font-size:31px;color:#fff;line-height:1.12;font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="margin-top:14px;color:rgba(255,255,255,.72);font-size:14px;line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-dark" ${attrs} style="background:${bg};color:#cbd5e1;padding:30px 28px;border:1px solid rgba(255,255,255,0.14)"><header style="display:flex;align-items:center;justify-content:space-between;color:${safeCss(accent)};font-size:12px;font-weight:900;margin-bottom:28px"><span>NO.${String(index).padStart(2, "0")}</span><span>${index + 1}/${total}</span></header><h2 style="font-size:${headingSize}px;line-height:1.18;color:#fff;font-weight:950;margin-bottom:16px">${escapeHtml(heading)}</h2><p style="font-size:15px;line-height:1.88;color:rgba(255,255,255,.74);flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);padding:14px 16px;color:rgba(255,255,255,.78);font-size:13px;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
  }

  if (family === "brief") {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-professional" ${attrs} style="background:#fff;padding:36px 32px;border-radius:8px;border:1px solid rgba(17,24,39,0.12)"><div style="font-size:11px;color:${safeCss(accent)};font-weight:900;letter-spacing:2px;margin-bottom:28px">BRIEF · ${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</div><main style="display:grid;grid-template-columns:1fr 82px;gap:20px;align-items:end;flex:1"><h1 style="font-size:${coverSize}px;font-weight:950;color:#111827;line-height:1.12">${escapeHtml(title)}</h1><div style="height:82px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:34px;font-weight:950">${String(index + 1).padStart(2, "0")}</div></main>${slide.subtitle ? `<p style="font-size:14px;color:#4b5563;line-height:1.7;margin-top:18px">${escapeHtml(slide.subtitle)}</p>` : ""}${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-professional" ${attrs} style="background:#111827;color:#fff;padding:40px 32px;justify-content:center;border-radius:8px"><div style="font-size:11px;color:${safeCss(accent)};font-weight:900;margin-bottom:22px;text-align:center">SUMMARY</div><h2 style="font-size:30px;font-weight:950;color:#fff;text-align:center;line-height:1.18">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.72);text-align:center;margin-top:14px;line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent, true)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-professional" ${attrs} style="background:#fff;padding:34px 30px;border-radius:8px;border:1px solid rgba(17,24,39,0.12)"><header style="display:grid;grid-template-columns:58px 1fr;gap:16px;align-items:start;border-bottom:2px solid ${safeCss(accent)};padding-bottom:16px;margin-bottom:22px"><b style="font-size:30px;font-weight:950;color:${safeCss(accent)};line-height:1">${String(index).padStart(2, "0")}</b><h2 style="font-size:${headingSize}px;line-height:1.18;color:#111827;font-weight:950">${escapeHtml(heading)}</h2></header><p style="font-size:15px;color:#374151;line-height:1.88;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:#f8fafc;border-left:4px solid ${safeCss(accent)};font-size:13px;color:#4b5563;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
  }

  if (family === "soft" || family === "organic") {
    const bg = family === "organic" ? "#f3fbf6" : "linear-gradient(180deg,#fff7ed,#fff5f8)"
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-pastel" ${attrs} style="background:${bg};padding:36px 30px;border-radius:24px"><div style="position:absolute;right:-44px;bottom:-44px;width:180px;height:180px;border-radius:999px;background:${hexToRgba(accent, 0.15)}"></div><main style="position:relative;z-index:1;display:grid;align-content:center;flex:1"><div style="width:72px;height:72px;border-radius:${family === "organic" ? "22px 22px 22px 6px" : "999px"};background:${safeCss(accent)};display:grid;place-items:center;color:#fff;font-size:34px;margin-bottom:22px">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:${coverSize}px;font-weight:950;color:${safeCss(profile.title)};line-height:1.15">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:14px;color:${safeCss(profile.body)};line-height:1.7;margin-top:14px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${dots}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-pastel" ${attrs} style="background:${bg};padding:38px 30px;justify-content:center;text-align:center;border-radius:24px"><div style="font-size:34px;margin-bottom:18px">${escapeHtml(slide.emoji || "✨")}</div><h2 style="font-size:29px;font-weight:950;color:${safeCss(profile.title)};line-height:1.16">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:${safeCss(profile.body)};margin-top:14px;line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent)}${dots}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-pastel" ${attrs} style="background:${family === "organic" ? "#f6fbf7" : "#fffaf7"};padding:30px 26px;border-radius:24px;border:1px solid ${hexToRgba(accent, 0.16)}"><header style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><span style="width:44px;height:44px;border-radius:${family === "organic" ? "14px 14px 14px 5px" : "16px"};background:${hexToRgba(accent, 0.14)};color:${safeCss(accent)};display:grid;place-items:center;font-weight:950">${index}</span><h2 style="font-size:${headingSize}px;line-height:1.2;color:${safeCss(profile.title)};font-weight:950">${escapeHtml(heading)}</h2></header><p style="font-size:14px;color:${safeCss(profile.body)};line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:#fff;border:1px dashed ${hexToRgba(accent, 0.35)};border-radius:16px;font-size:13px;color:${safeCss(profile.body)};line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
  }

  if (slide.type === "cover") {
    return `<article class="${baseClass} moka-slide-cover moka-layout-clean" ${attrs} style="background:#fff;padding:48px 40px"><div style="position:absolute;right:0;top:0;width:34%;height:100%;background:${hexToRgba(accent, 0.07)}"></div><main style="position:relative;z-index:1;display:grid;align-content:center;flex:1"><div style="display:flex;align-items:center;gap:12px;margin-bottom:110px"><span style="width:56px;height:56px;border-radius:14px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:26px">${escapeHtml(slide.emoji || "✨")}</span><b style="font-size:12px;color:${safeCss(accent)}">${escapeHtml(displayCategory(slide.category, "精华"))}</b></div><h1 style="font-size:${coverSize}px;font-weight:950;color:#050505;line-height:1.08">${escapeHtml(title)}</h1>${slide.subtitle ? `<p style="font-size:14px;color:#4b5563;line-height:1.7;margin-top:18px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${dots}</article>`
  }
  if (slide.type === "end") {
    return `<article class="${baseClass} moka-slide-end moka-layout-clean" ${attrs} style="background:#fff;padding:48px 40px;justify-content:center;text-align:center"><div style="width:76px;height:76px;border-radius:999px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;margin:0 auto 24px;font-size:32px">${escapeHtml(slide.emoji || "✨")}</div><h2 style="font-size:30px;line-height:1.16;color:#050505;font-weight:950">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:#4b5563;margin-top:14px;line-height:1.7">${escapeHtml(slide.sub)}</p>` : ""}${renderFamilyTags(slide.tags || [], accent)}${dots}</article>`
  }
  return `<article class="${baseClass} moka-slide-content moka-layout-clean" ${attrs} style="background:#fff;padding:38px 34px"><header style="display:flex;align-items:center;gap:18px;margin-bottom:28px"><span style="width:58px;height:58px;border-radius:999px;background:${safeCss(accent)};color:#fff;display:grid;place-items:center;font-size:24px">${index}</span><i style="flex:1;height:1px;background:#e5e7eb"></i></header><h2 style="font-size:${headingSize}px;line-height:1.18;color:#050505;font-weight:950;margin-bottom:18px">${escapeHtml(heading)}</h2><p style="font-size:15px;color:#374151;line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:20px;padding:16px 18px;background:#f4fafc;border-left:4px solid ${safeCss(accent)};border-radius:10px;font-size:13px;color:#334155;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${dots}</article>`
}

function renderSingleCard(content: MokaSingleContent, styleId: string, palette: MokaPalette): string {
  const profile = getStyleProfile(styleId, palette)
  const sections = content.sections || []
  const baseClass = `moka-card moka-single moka-template-layout moka-style-${escapeHtml(styleId)}`
  const themeCard = renderThemeSingleCard(content, styleId, palette, profile)
  if (themeCard) return themeCard

  if (isStyle(styleId, ["editorial", "newspaper"])) {
    return `<article class="${baseClass} moka-layout-editorial" data-moka-card data-moka-kind="single" style="background:#faf8f4;padding:34px 28px;border-radius:${safeCss(profile.radius)}">
      <div style="height:4px;background:linear-gradient(90deg,${safeCss(profile.accent)} 55%,transparent);margin-bottom:24px"></div>
      <div style="font-size:10px;font-weight:800;color:${safeCss(profile.accent)};letter-spacing:3px;margin-bottom:7px">${escapeHtml(displayCategory(content.category))}</div>
      <h1 style="font-size:25px;font-weight:900;color:#1a1510;line-height:1.25;margin-bottom:13px">${escapeHtml(content.title)}</h1>
      <div style="display:grid;grid-template-columns:1fr 36px 1fr;gap:8px;align-items:center;margin-bottom:13px"><i style="height:2px;background:${safeCss(profile.accent)}"></i><span style="text-align:center;color:${safeCss(profile.accent)}">✦</span><i style="height:2px;background:${safeCss(profile.accent)}"></i></div>
      ${content.lead ? `<p style="font-size:13px;color:#555;line-height:1.8;margin:13px 0 17px;padding-left:11px;border-left:3px solid ${safeCss(profile.accent)};font-style:italic">${escapeHtml(content.lead)}</p>` : ""}
      <main style="display:grid;gap:13px">
        ${sections.map((section) => `<section style="display:grid;grid-template-columns:3px 1fr;gap:10px;align-items:start">
          <i style="width:3px;border-radius:2px;background:${safeCss(profile.accent)};align-self:stretch"></i>
          <div><h3 style="font-size:13px;font-weight:800;color:#1a1510;margin-bottom:2px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:#444;line-height:1.85">${escapeHtml(section.text)}</p></div>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="margin-top:17px;background:${hexToRgba(profile.accent, 0.10)};padding:10px 13px;border-radius:2px;font-size:12px;line-height:1.7;color:#444"><b style="color:${safeCss(profile.accent)}">TIPS · </b>${escapeHtml(content.tip)}</aside>` : ""}
      ${renderTemplateTags(content.tags || [], profile.accent)}
      <div style="height:2px;background:${safeCss(profile.accent)};margin-top:20px;width:36px"></div>
    </article>`
  }

  if (isStyle(styleId, ["notecard", "stamp", "paper"])) {
    return `<article class="${baseClass} moka-layout-paper" data-moka-card data-moka-kind="single" style="background:${safeCss(palette.bg)};padding:26px 22px;border:2px dashed ${hexToRgba(profile.accent, 0.62)};border-radius:18px">
      <div class="moka-paper-grid"></div>
      <div style="position:relative;z-index:1">
        <div style="font-size:36px;text-align:center;margin-bottom:10px">${escapeHtml(content.emoji || "✨")}</div>
        <h1 style="font-size:21px;font-weight:900;color:${safeCss(palette.tc)};text-align:center;line-height:1.3;margin-bottom:5px">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:12px;color:${safeCss(profile.accent)};text-align:center;margin-bottom:13px;font-weight:600;line-height:1.7">${escapeHtml(content.lead)}</p>` : ""}
        <div style="text-align:center;color:${safeCss(profile.accent)};margin-bottom:14px">◆</div>
        <main style="display:grid;gap:10px">
          ${sections.map((section) => `<section style="display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:start">
            <span style="color:${safeCss(profile.accent)};font-size:14px">✦</span>
            <p style="font-size:13px;color:${safeCss(palette.bc)};line-height:1.75"><b style="color:${safeCss(palette.tc)}">${escapeHtml(section.heading)} </b>${escapeHtml(section.text)}</p>
          </section>`).join("")}
        </main>
        ${content.tip ? `<aside style="margin-top:14px;text-align:center"><div style="height:1px;background:linear-gradient(90deg,transparent,${safeCss(profile.accent)},transparent);margin-bottom:8px"></div><p style="font-size:12px;color:${safeCss(palette.bc)};line-height:1.7"><b style="color:${safeCss(profile.accent)}">贴士 </b>${escapeHtml(content.tip)}</p></aside>` : ""}
        ${renderTemplateTags(content.tags || [], profile.accent)}
      </div>
    </article>`
  }

  if (isStyle(styleId, ["minimal", "clean", "pure", "ins"])) {
    return `<article class="${baseClass} moka-layout-minimal" data-moka-card data-moka-kind="single" style="background:#ffffff;padding:36px 28px;border-radius:${safeCss(profile.radius)}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px">
        <div style="width:3px;height:28px;background:${safeCss(profile.accent)}"></div>
        <div style="flex:1;height:1px;background:linear-gradient(90deg,${hexToRgba(profile.accent, 0.32)},transparent)"></div>
        <div style="width:7px;height:7px;border-radius:50%;border:2px solid ${safeCss(profile.accent)}"></div>
      </div>
      <header style="position:relative;padding-bottom:6px;margin-bottom:17px">
        <div style="font-size:10px;color:#888;letter-spacing:2px;margin-bottom:7px">${escapeHtml(displayCategory(content.category))}</div>
        <h1 style="font-size:23px;font-weight:900;color:#111;line-height:1.3">${escapeHtml(content.title)}</h1>
        <div style="position:absolute;bottom:0;left:0;width:50px;height:3px;background:${safeCss(profile.accent)}"></div>
      </header>
      ${content.lead ? `<p style="font-size:13px;color:#666;line-height:1.8;margin-bottom:18px;padding-bottom:13px;border-bottom:1px solid #eee">${escapeHtml(content.lead)}</p>` : ""}
      <main style="display:grid;gap:14px">
        ${sections.map((section, index) => `<section style="display:grid;grid-template-columns:22px 1fr;gap:12px;align-items:start">
          <div style="width:22px;height:22px;border-radius:50%;background:${safeCss(profile.accent)};color:#fff;font-size:11px;font-weight:900;display:grid;place-items:center;margin-top:1px">${index + 1}</div>
          <div><h3 style="font-size:13px;font-weight:800;color:#111;margin-bottom:2px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:#555;line-height:1.85">${escapeHtml(section.text)}</p></div>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:18px;padding:10px 12px;background:#f6f6f6;font-size:12px;color:#555;line-height:1.75"><span>💡</span><span>${escapeHtml(content.tip)}</span></aside>` : ""}
      <div style="margin-top:16px;padding-top:11px;border-top:1px solid #f0f0f0">${renderTemplateTags(content.tags || [], "#888")}</div>
    </article>`
  }

  if (isStyle(styleId, ["bold", "vivid", "pop"])) {
    return `<article class="${baseClass} moka-layout-bold" data-moka-card data-moka-kind="single" style="background:#fff;padding:0;border-radius:${safeCss(profile.radius)};border:2px solid #111;box-shadow:12px 12px 0 rgba(16,16,16,0.88)">
      <header style="background:${safeCss(profile.accent)};padding:28px 24px 24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:-40px;top:-40px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,0.1)"></div>
        <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.7);letter-spacing:3px;margin-bottom:8px">${escapeHtml(displayCategory(content.category))}</div>
        <h1 style="font-size:23px;font-weight:900;color:#fff;line-height:1.25">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:13px;color:rgba(255,255,255,0.86);margin-top:9px;line-height:1.7">${escapeHtml(content.lead)}</p>` : ""}
        <div style="position:absolute;right:20px;top:50%;transform:translateY(-50%);font-size:46px;opacity:0.22">${escapeHtml(content.emoji || "✨")}</div>
      </header>
      <main style="padding:20px 24px;display:grid;gap:13px">
        ${sections.map((section, index) => `<section style="display:grid;grid-template-columns:23px 1fr;gap:10px;align-items:start">
          <div style="width:23px;height:23px;border-radius:5px;background:${hexToRgba(profile.accent, 0.14)};display:grid;place-items:center;font-size:11px;font-weight:900;color:${safeCss(profile.accent)}">${index + 1}</div>
          <div><h3 style="font-size:13px;font-weight:800;color:#111;margin-bottom:2px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:#555;line-height:1.85">${escapeHtml(section.text)}</p></div>
        </section>`).join("")}
        ${content.tip ? `<aside style="display:grid;grid-template-columns:auto 1fr;gap:7px;margin-top:3px;padding:10px;background:${hexToRgba(profile.accent, 0.08)};border-radius:8px;font-size:12px;color:#444;line-height:1.75"><span>✦</span><span>${escapeHtml(content.tip)}</span></aside>` : ""}
        <div style="padding-top:12px;border-top:1px solid #f0f0f0">${renderTemplateTags(content.tags || [], profile.accent, false, true)}</div>
      </main>
    </article>`
  }

  if (isStyle(styleId, ["dark", "tech"])) {
    return `<article class="${baseClass} moka-layout-dark" data-moka-card data-moka-kind="single" style="background:#10131c;color:#cbd5e1;padding:30px 26px;border:1px solid rgba(255,255,255,0.12);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,0.36)">
      <div style="position:absolute;inset:0;background-image:linear-gradient(${hexToRgba(profile.accent, 0.12)} 1px,transparent 1px),linear-gradient(90deg,${hexToRgba(profile.accent, 0.12)} 1px,transparent 1px);background-size:22px 22px;opacity:.45"></div>
      <header style="position:relative;z-index:1">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:11px;color:${safeCss(profile.accent)};letter-spacing:3px;font-weight:800">${escapeHtml(displayCategory(content.category))}</span><span style="font-size:24px">${escapeHtml(content.emoji || "✨")}</span></div>
        <h1 style="font-size:27px;line-height:1.18;color:#f8fafc;font-weight:900;margin-bottom:12px">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:13px;color:#cbd5e1;line-height:1.75;margin-bottom:18px">${escapeHtml(content.lead)}</p>` : ""}
      </header>
      <main style="position:relative;z-index:1;display:grid;gap:12px">
        ${sections.map((section, index) => `<section style="padding:13px 14px;background:rgba(255,255,255,0.06);border:1px solid ${hexToRgba(profile.accent, 0.24)};border-left:4px solid ${safeCss(profile.accent)}">
          <div style="font-size:10px;color:${safeCss(profile.accent)};font-weight:900;margin-bottom:6px">NODE ${String(index + 1).padStart(2, "0")}</div>
          <h3 style="font-size:14px;color:#f8fafc;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:#cbd5e1;line-height:1.75">${escapeHtml(section.text)}</p>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:auto;padding:12px 14px;background:${hexToRgba(profile.accent, 0.13)};border-left:4px solid ${safeCss(profile.accent)};font-size:12px;line-height:1.6;color:#e2e8f0"><b style="color:${safeCss(profile.accent)}">SIGNAL </b>${escapeHtml(content.tip)}</aside>` : ""}
      <div style="position:relative;z-index:1">${renderTemplateTags(content.tags || [], profile.accent, true)}</div>
    </article>`
  }

  if (isStyle(styleId, ["business", "finance", "law", "edu", "medical"])) {
    return `<article class="${baseClass} moka-layout-professional" data-moka-card data-moka-kind="single" style="background:#ffffff;padding:30px 28px;border-radius:8px;border:1px solid rgba(17,24,39,0.12);box-shadow:0 10px 32px rgba(15,23,42,0.08)">
      <header style="display:grid;grid-template-columns:1fr auto;gap:18px;border-bottom:2px solid ${safeCss(profile.accent)};padding-bottom:16px;margin-bottom:18px">
        <div><div style="font-size:10px;color:${safeCss(profile.accent)};font-weight:900;letter-spacing:2px;margin-bottom:8px">${escapeHtml(displayCategory(content.category, "INSIGHT"))}</div><h1 style="font-size:25px;line-height:1.22;color:#111827;font-weight:900">${escapeHtml(content.title)}</h1></div>
        <div style="font-size:34px">${escapeHtml(content.emoji || "✨")}</div>
      </header>
      ${content.lead ? `<p style="font-size:13px;color:#374151;line-height:1.75;margin-bottom:16px">${escapeHtml(content.lead)}</p>` : ""}
      <main style="display:grid;gap:10px">
        ${sections.map((section, index) => `<section style="display:grid;grid-template-columns:42px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #eef2f7">
          <div style="font-size:20px;font-weight:900;color:${safeCss(profile.accent)}">${String(index + 1).padStart(2, "0")}</div>
          <div><h3 style="font-size:14px;color:#111827;margin-bottom:4px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:#4b5563;line-height:1.7">${escapeHtml(section.text)}</p></div>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-left:4px solid ${safeCss(profile.accent)};font-size:12px;color:#374151;line-height:1.65"><b style="color:${safeCss(profile.accent)}">NOTE </b>${escapeHtml(content.tip)}</aside>` : ""}
      ${renderTemplateTags(content.tags || [], profile.accent)}
    </article>`
  }

  if (isStyle(styleId, ["creamy", "mom", "korean", "japanese"])) {
    return `<article class="${baseClass} moka-layout-pastel" data-moka-card data-moka-kind="single" style="background:linear-gradient(180deg,#fff7ed 0%,#fff 56%,#fff5f8 100%);padding:30px 26px;border-radius:24px;box-shadow:0 18px 50px rgba(232,155,114,0.18)">
      <div style="position:absolute;right:-32px;top:-34px;width:132px;height:132px;border-radius:50%;background:${hexToRgba(profile.accent, 0.16)}"></div>
      <div style="position:absolute;left:22px;bottom:22px;width:76px;height:76px;border-radius:999px;border:1px dashed ${hexToRgba(profile.accent, 0.34)}"></div>
      <header style="position:relative;z-index:1;text-align:center;margin-bottom:16px">
        <div style="font-size:38px;margin-bottom:8px">${escapeHtml(content.emoji || "✨")}</div>
        <div style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:${hexToRgba(profile.accent, 0.12)};padding:5px 11px;color:${safeCss(profile.accent)};font-size:10px;font-weight:800;margin-bottom:10px">${escapeHtml(displayCategory(content.category))}</div>
        <h1 style="font-size:24px;line-height:1.26;color:${safeCss(profile.title)};font-weight:900">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:13px;color:${safeCss(profile.body)};line-height:1.75;margin-top:10px">${escapeHtml(content.lead)}</p>` : ""}
      </header>
      <main style="position:relative;z-index:1;display:grid;gap:10px">
        ${sections.map((section) => `<section style="padding:12px 14px;background:rgba(255,255,255,0.78);border-radius:18px;border:1px solid ${hexToRgba(profile.accent, 0.16)}">
          <h3 style="font-size:14px;color:${safeCss(profile.title)};margin-bottom:4px">♡ ${escapeHtml(section.heading)}</h3>
          <p style="font-size:13px;color:${safeCss(profile.body)};line-height:1.75">${escapeHtml(section.text)}</p>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:14px;padding:11px 13px;background:#fff;border-radius:16px;border:1px dashed ${hexToRgba(profile.accent, 0.36)};font-size:12px;line-height:1.65;color:${safeCss(profile.body)}">${escapeHtml(content.tip)}</aside>` : ""}
      <div style="position:relative;z-index:1">${renderTemplateTags(content.tags || [], profile.accent)}</div>
    </article>`
  }

  if (isStyle(styleId, ["forest", "food", "travel"])) {
    return `<article class="${baseClass} moka-layout-organic" data-moka-card data-moka-kind="single" style="background:#f6fbf7;padding:28px 24px;border-radius:20px;border:1px solid ${hexToRgba(profile.accent, 0.18)};box-shadow:0 16px 44px rgba(27,67,50,0.12)">
      <div style="position:absolute;right:-42px;bottom:-42px;width:170px;height:170px;border-radius:50%;background:${hexToRgba(profile.accent, 0.12)}"></div>
      <header style="position:relative;z-index:1;display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;margin-bottom:17px">
        <div style="width:62px;height:62px;border-radius:18px;background:${safeCss(profile.accent)};display:grid;place-items:center;color:#fff;font-size:30px;box-shadow:0 10px 24px ${hexToRgba(profile.accent, 0.22)}">${escapeHtml(content.emoji || "✨")}</div>
        <div><div style="font-size:10px;color:${safeCss(profile.accent)};font-weight:900;letter-spacing:2px;margin-bottom:6px">${escapeHtml(displayCategory(content.category))}</div><h1 style="font-size:23px;line-height:1.24;color:${safeCss(profile.title)};font-weight:900">${escapeHtml(content.title)}</h1></div>
      </header>
      ${content.lead ? `<p style="position:relative;z-index:1;font-size:13px;color:${safeCss(profile.body)};line-height:1.75;margin-bottom:14px;padding:10px 0;border-block:1px solid ${hexToRgba(profile.accent, 0.18)}">${escapeHtml(content.lead)}</p>` : ""}
      <main style="position:relative;z-index:1;display:grid;gap:9px">
        ${sections.map((section, index) => `<section style="display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start">
          <span style="width:26px;height:26px;border-radius:10px;background:${hexToRgba(profile.accent, 0.12)};color:${safeCss(profile.accent)};font-size:11px;font-weight:900;display:grid;place-items:center">${index + 1}</span>
          <div><h3 style="font-size:14px;color:${safeCss(profile.title)};margin-bottom:3px">${escapeHtml(section.heading)}</h3><p style="font-size:13px;color:${safeCss(profile.body)};line-height:1.75">${escapeHtml(section.text)}</p></div>
        </section>`).join("")}
      </main>
      ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:14px;border-left:4px solid ${safeCss(profile.accent)};padding:10px 12px;background:#fff;font-size:12px;line-height:1.65;color:${safeCss(profile.body)}">${escapeHtml(content.tip)}</aside>` : ""}
      <div style="position:relative;z-index:1">${renderTemplateTags(content.tags || [], profile.accent)}</div>
    </article>`
  }

  if (isStyle(styleId, ["retro", "film", "artistic", "luxury", "fashion", "label"])) {
    return `<article class="${baseClass} moka-layout-lifestyle" data-moka-card data-moka-kind="single" style="background:#111;color:#f8f1e7;padding:0;border-radius:${styleId === "film" ? "0" : "12px"};box-shadow:0 22px 58px rgba(0,0,0,0.22)">
      <header style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:10px;color:${safeCss(profile.accent)};font-weight:900;letter-spacing:3px">${escapeHtml(displayCategory(content.category).toUpperCase())}</span>
        <span style="font-size:24px">${escapeHtml(content.emoji || "✨")}</span>
      </header>
      <main style="padding:26px 24px 20px;display:grid;gap:14px;flex:1">
        <h1 style="font-size:28px;line-height:1.12;color:#fff;font-weight:900;font-family:${styleId === "artistic" || styleId === "luxury" ? "'Georgia','Times New Roman','SimSun',serif" : "inherit"}">${escapeHtml(content.title)}</h1>
        ${content.lead ? `<p style="font-size:13px;color:rgba(255,255,255,0.74);line-height:1.75;border-left:3px solid ${safeCss(profile.accent)};padding-left:12px">${escapeHtml(content.lead)}</p>` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${sections.map((section, index) => `<section style="min-height:86px;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12)">
            <div style="font-size:10px;color:${safeCss(profile.accent)};font-weight:900;margin-bottom:6px">${String(index + 1).padStart(2, "0")}</div>
            <h3 style="font-size:13px;color:#fff;margin-bottom:4px">${escapeHtml(section.heading)}</h3>
            <p style="font-size:12px;color:rgba(255,255,255,0.72);line-height:1.65">${escapeHtml(section.text)}</p>
          </section>`).join("")}
        </div>
      </main>
      ${content.tip ? `<aside style="margin:0 24px 18px;padding:11px 13px;background:${hexToRgba(profile.accent, 0.16)};color:#f8f1e7;font-size:12px;line-height:1.6">${escapeHtml(content.tip)}</aside>` : ""}
      <div style="padding:0 24px 22px">${renderTemplateTags(content.tags || [], profile.accent, true, true)}</div>
    </article>`
  }

  return `<article class="${baseClass} moka-layout-soft" data-moka-card data-moka-kind="single" style="background:${safeCss(profile.bg)};padding:30px 26px;border-radius:24px;box-shadow:${safeCss(profile.cardShadow)}">
    <div style="position:absolute;right:-46px;top:-46px;width:148px;height:148px;border-radius:50%;background:${hexToRgba(profile.accent, 0.16)}"></div>
    <header style="position:relative;z-index:1;text-align:center;margin-bottom:18px">
      <div style="font-size:42px;margin-bottom:10px">${escapeHtml(content.emoji || "✨")}</div>
      <div style="font-size:10px;color:${safeCss(profile.accent)};font-weight:800;letter-spacing:2px;margin-bottom:8px">${escapeHtml(displayCategory(content.category))}</div>
      <h1 style="font-size:25px;line-height:1.2;color:${safeCss(profile.title)};font-weight:900">${escapeHtml(content.title)}</h1>
      ${content.lead ? `<p style="font-size:13px;color:${safeCss(profile.body)};line-height:1.75;margin-top:10px">${escapeHtml(content.lead)}</p>` : ""}
    </header>
    <main style="position:relative;z-index:1;display:grid;gap:10px">
      ${sections.map((section, index) => `<section style="padding:12px 14px;background:rgba(255,255,255,0.72);border-radius:16px;border:1px solid ${hexToRgba(profile.accent, 0.14)}">
        <h3 style="font-size:14px;color:${safeCss(profile.title)};margin-bottom:4px"><span style="color:${safeCss(profile.accent)}">${index + 1}. </span>${escapeHtml(section.heading)}</h3>
        <p style="font-size:13px;color:${safeCss(profile.body)};line-height:1.75">${escapeHtml(section.text)}</p>
      </section>`).join("")}
    </main>
    ${content.tip ? `<aside style="position:relative;z-index:1;margin-top:auto;padding:12px 14px;background:${hexToRgba(profile.accent, 0.10)};border-radius:16px;font-size:12px;line-height:1.65;color:${safeCss(profile.body)}"><b style="color:${safeCss(profile.accent)}">Tips </b>${escapeHtml(content.tip)}</aside>` : ""}
    <div style="position:relative;z-index:1">${renderTemplateTags(content.tags || [], profile.accent)}</div>
  </article>`
}

function renderSlide(slide: MokaSlide, index: number, total: number, styleId: string, palette: MokaPalette): string {
  const profile = getStyleProfile(styleId, palette)
  const accent = profile.accent
  const baseClass = `moka-card moka-slide moka-template-slide moka-style-${escapeHtml(styleId)}`
  const themeSlide = renderThemeSlide(slide, index, total, styleId, palette, profile)
  if (themeSlide) return themeSlide

  if (isStyle(styleId, ["vivid", "bold", "pop"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-vivid" data-moka-card data-slide-index="${index}" style="background:#fff;padding:36px 32px;border:2px solid #111;box-shadow:12px 12px 0 rgba(16,16,16,0.88)">
        <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:${safeCss(accent)}"></div>
        <div style="position:absolute;top:24px;right:24px;width:80px;height:80px;border-radius:50%;background:${hexToRgba(accent, 0.14)}"></div>
        <header style="display:flex;align-items:center;gap:12px;margin-bottom:24px;position:relative;z-index:1"><div style="width:50px;height:50px;background:${safeCss(accent)};border-radius:8px;display:grid;place-items:center;font-size:24px">${escapeHtml(slide.emoji || "✨")}</div><span style="font-size:11px;color:${safeCss(accent)};letter-spacing:3px;font-weight:700">${escapeHtml(displayCategory(slide.category).toUpperCase())}</span></header>
        <main style="flex:1;display:grid;align-content:center;position:relative;z-index:1"><h1 style="font-size:36px;font-weight:900;color:#000;line-height:1.1;margin-bottom:16px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:#333;line-height:1.6">${escapeHtml(slide.subtitle)}</p>` : ""}</main>
        ${renderSlideDots(total, index, accent, "block")}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-vivid" data-moka-card data-slide-index="${index}" style="background:#fff;padding:40px 32px;border:2px solid #111;box-shadow:12px 12px 0 rgba(16,16,16,0.88);justify-content:center;text-align:center">
        <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:${safeCss(accent)}"></div><div style="position:absolute;bottom:0;left:0;width:100%;height:8px;background:#000"></div>
        <div style="width:80px;height:80px;background:${safeCss(accent)};border-radius:50%;display:grid;place-items:center;margin:0 auto 24px;font-size:40px">${escapeHtml(slide.emoji || "✨")}</div>
        <h2 style="font-size:28px;font-weight:900;color:#000;margin-bottom:12px;line-height:1.2;text-transform:uppercase">${escapeHtml(slide.cta || "记住核心收获")}</h2>
        ${slide.sub ? `<p style="font-size:14px;color:#333;margin-bottom:28px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}
        ${renderTemplateTags(slide.tags || [], accent, false, true)}
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-vivid" data-moka-card data-slide-index="${index}" style="background:#fff;padding:32px 28px;border:2px solid #111;box-shadow:12px 12px 0 rgba(16,16,16,0.88)">
      <header style="display:flex;align-items:center;gap:16px;margin-bottom:24px"><div style="width:56px;height:56px;background:${safeCss(accent)};display:grid;place-items:center"><span style="font-size:24px;color:#fff;font-weight:900">${String(index).padStart(2, "0")}</span></div><div style="flex:1;height:3px;background:#000"></div><div style="width:12px;height:12px;background:${index % 2 === 0 ? safeCss(accent) : "#000"};transform:rotate(45deg)"></div></header>
      <h2 style="font-size:24px;font-weight:900;color:#000;line-height:1.2;margin-bottom:16px;text-transform:uppercase">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2>
      <p style="font-size:15px;color:#222;line-height:1.8;flex:1">${escapeHtml(slide.text || "")}</p>
      ${slide.extra ? `<blockquote style="margin:20px 0 0;padding:16px 20px;background:${hexToRgba(accent, 0.08)};border-left:4px solid ${safeCss(accent)};font-size:14px;line-height:1.7;color:#333">${escapeHtml(slide.extra)}</blockquote>` : ""}
      ${renderSlideDots(total, index, accent, "block")}
    </article>`
  }

  if (isStyle(styleId, ["clean", "minimal", "pure", "ins"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-clean" data-moka-card data-slide-index="${index}" style="background:#fff;padding:48px 40px">
        <div style="position:absolute;top:0;right:0;width:35%;height:100%;background:${hexToRgba(accent, 0.05)}"></div>
        <header style="display:flex;align-items:center;gap:12px;margin-bottom:32px;position:relative;z-index:1"><div style="width:44px;height:44px;background:${safeCss(accent)};border-radius:22px;display:grid;place-items:center;font-size:20px">${escapeHtml(slide.emoji || "✨")}</div><span style="font-size:10px;color:${safeCss(accent)};letter-spacing:3px;font-weight:600">${escapeHtml(displayCategory(slide.category).toUpperCase())}</span></header>
        <main style="flex:1;display:grid;align-content:center;position:relative;z-index:1"><h1 style="font-size:36px;font-weight:800;color:#1a1a1a;line-height:1.2;margin-bottom:16px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:#666;line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main>
        ${renderSlideDots(total, index, accent)}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-clean" data-moka-card data-slide-index="${index}" style="background:#fff;padding:48px 40px;justify-content:center;text-align:center">
        <div style="position:absolute;top:0;left:0;width:40%;height:100%;background:${hexToRgba(accent, 0.05)}"></div>
        <div style="position:relative;z-index:1"><div style="width:80px;height:80px;background:${safeCss(accent)};border-radius:50%;display:grid;place-items:center;margin:0 auto 28px;font-size:36px">${escapeHtml(slide.emoji || "✨")}</div><h2 style="font-size:28px;font-weight:800;color:#1a1a1a;margin-bottom:12px;line-height:1.3">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:#666;margin-bottom:32px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent)}<div style="font-size:10px;color:#ccc;letter-spacing:3px;margin-top:16px">— END —</div></div>
      </article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-clean" data-moka-card data-slide-index="${index}" style="background:#fff;padding:36px 32px">
      <header style="display:flex;align-items:center;gap:16px;margin-bottom:28px"><div style="width:52px;height:52px;background:${safeCss(accent)};border-radius:50%;display:grid;place-items:center;color:#fff;font-size:22px;font-weight:300">${index}</div><div style="flex:1;height:1px;background:#f0f0f0"></div></header>
      <h2 style="font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.3;margin-bottom:16px">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2>
      <p style="font-size:15px;color:#555;line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>
      ${slide.extra ? `<blockquote style="margin:24px 0 0;padding:18px 22px;background:${hexToRgba(accent, 0.05)};border-radius:8px;border-left:4px solid ${safeCss(accent)};font-size:14px;color:#444;line-height:1.75">${escapeHtml(slide.extra)}</blockquote>` : ""}
      ${renderSlideDots(total, index, accent)}
    </article>`
  }

  if (isStyle(styleId, ["editorial", "newspaper"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-editorial" data-moka-card data-slide-index="${index}" style="background:#fff;padding:0;font-family:'Helvetica Neue',Arial,sans-serif">
        <header style="background:#000;padding:16px 28px;display:flex;justify-content:space-between;align-items:center"><div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:8px">NOTE</div><div style="font-size:10px;color:rgba(255,255,255,0.6);letter-spacing:2px">CARD</div></header>
        <div style="padding:12px 28px;border-bottom:1px solid #eee;display:flex;gap:20px;overflow:hidden"><span style="font-size:10px;color:${safeCss(accent)};letter-spacing:2px;font-weight:700">${escapeHtml(displayCategory(slide.category, "FEATURE")).toUpperCase()}</span><span style="font-size:10px;color:#999;letter-spacing:2px">NOTE</span><span style="font-size:10px;color:#999;letter-spacing:2px">STORY</span></div>
        <main style="flex:1;display:grid;align-content:center;padding:36px 28px"><div style="font-size:10px;color:${safeCss(accent)};letter-spacing:3px;margin-bottom:12px;font-weight:700">COVER STORY</div><h1 style="font-size:44px;font-weight:800;color:#000;line-height:1;text-transform:uppercase;margin-bottom:18px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:16px;color:#333;line-height:1.6;border-left:4px solid ${safeCss(accent)};padding-left:18px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>
        ${renderSlideDots(total, index, "#000", "line")}
      </article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-editorial" data-moka-card data-slide-index="${index}" style="background:#000;color:#fff;padding:40px 32px;justify-content:center;text-align:center;font-family:'Helvetica Neue',Arial,sans-serif"><div style="font-size:32px;font-weight:900;letter-spacing:12px;margin-bottom:40px">NOTE</div><div style="display:flex;justify-content:center;gap:16px;margin-bottom:32px"><i style="width:60px;height:1px;background:#fff"></i><span>✦</span><i style="width:60px;height:1px;background:#fff"></i></div><h2 style="font-size:28px;font-weight:800;color:#fff;margin-bottom:16px;line-height:1.2;text-transform:uppercase">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:32px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], "#ffffff", true, true)}<div style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:4px;margin-top:22px">— THE END —</div></article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-editorial" data-moka-card data-slide-index="${index}" style="background:#fff;padding:0;font-family:'Helvetica Neue',Arial,sans-serif"><header style="padding:16px 24px;border-bottom:1px solid #000;display:flex;justify-content:space-between;align-items:center"><div style="font-size:14px;font-weight:900;color:#000;letter-spacing:4px">NOTE</div><div style="font-size:10px;color:#999">PAGE ${String(index).padStart(2, "0")}</div></header><main style="flex:1;display:flex;flex-direction:column;padding:28px 24px"><div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:24px"><div style="font-size:72px;font-weight:900;color:#f0f0f0;line-height:.8;font-family:Georgia,serif">${String(index).padStart(2, "0")}</div><div style="flex:1;padding-top:8px"><div style="font-size:10px;color:${safeCss(accent)};letter-spacing:2px;margin-bottom:8px;font-weight:700">CONTINUED</div><h2 style="font-size:24px;font-weight:800;color:#000;line-height:1.2;text-transform:uppercase">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2></div></div><p style="font-size:13px;color:#333;line-height:1.9;columns:2;column-gap:24px;column-rule:1px solid #eee;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin:24px 0 0;padding:20px 24px;background:#fafafa;border-top:3px solid ${safeCss(accent)};font-size:13px;color:#555;line-height:1.7;font-style:italic">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, "#000", "line")}</main></article>`
  }

  if (isStyle(styleId, ["paper", "stamp", "notecard"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-paper" data-moka-card data-slide-index="${index}" style="background:#fefcf8;padding:32px 28px;border:2px dashed ${hexToRgba(accent, 0.42)};border-radius:18px"><div class="moka-paper-grid"></div><div style="position:relative;z-index:1;display:grid;height:100%;align-content:center"><div style="font-size:42px;margin-bottom:18px;text-align:center">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:30px;font-weight:800;color:#3d3d3d;line-height:1.25;margin-bottom:16px;text-align:center;transform:rotate(-0.5deg)">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:14px;color:#666;line-height:1.7;text-align:center">${escapeHtml(slide.subtitle)}</p>` : ""}</div>${renderSlideDots(total, index, accent)}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-paper" data-moka-card data-slide-index="${index}" style="background:#fefcf8;padding:36px 28px;border:2px dashed ${hexToRgba(accent, 0.42)};border-radius:18px;justify-content:center;text-align:center"><div class="moka-paper-grid"></div><div style="position:relative;z-index:1"><div style="font-size:34px;margin-bottom:18px">✨ 💖 ✨</div><h2 style="font-size:24px;font-weight:800;color:#3d3d3d;margin-bottom:12px;line-height:1.3">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:#666;margin-bottom:28px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent)}</div></article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-paper" data-moka-card data-slide-index="${index}" style="background:#fefcf8;padding:28px 24px;border:2px dashed ${hexToRgba(accent, 0.42)};border-radius:18px"><div class="moka-paper-grid"></div><main style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%"><header style="display:flex;gap:16px;margin-bottom:20px"><div style="min-width:70px;height:70px;background:#fff;border:2px solid ${hexToRgba(accent, 0.32)};display:grid;place-items:center;box-shadow:3px 3px 0 rgba(0,0,0,0.08);transform:rotate(-2deg)"><span style="font-size:28px">✨</span><small style="font-size:8px;color:#999">Day ${index}</small></div><div style="padding-top:8px"><h2 style="font-size:20px;font-weight:800;color:#3d3d3d;line-height:1.3;margin-bottom:8px">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2><div style="display:flex;gap:6px;align-items:center"><i style="width:20px;height:2px;background:${safeCss(accent)}"></i><span style="font-size:10px;color:#999">Page ${index}</span></div></div></header><p style="font-size:14px;color:#555;line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:16px;padding:14px 18px;background:#fff;border:1px dashed ${hexToRgba(accent, 0.45)};box-shadow:2px 2px 0 rgba(0,0,0,0.05);font-size:13px;color:#666;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent)}</main></article>`
  }

  if (isStyle(styleId, ["dark", "tech"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-dark" data-moka-card data-slide-index="${index}" style="background:#10131c;color:#fff;padding:36px 32px;border:1px solid rgba(255,255,255,0.12)"><div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 10%,${hexToRgba(accent, 0.28)},transparent 35%)"></div><main style="position:relative;z-index:1;display:grid;align-content:center;height:100%"><div style="font-size:48px;margin-bottom:16px">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:34px;font-weight:900;color:#fff;line-height:1.12;margin-bottom:16px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:rgba(255,255,255,0.78);line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${renderSlideDots(total, index, accent, "line")}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-dark" data-moka-card data-slide-index="${index}" style="background:#020617;color:#fff;padding:40px 32px;justify-content:center;text-align:center;border:1px solid rgba(255,255,255,0.12)"><h2 style="font-size:28px;font-weight:900;color:#fff;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.72);margin-bottom:28px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent, true)}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-dark" data-moka-card data-slide-index="${index}" style="background:#111827;color:#cbd5e1;padding:34px 30px;border:1px solid rgba(255,255,255,0.12)"><header style="display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;margin-bottom:30px;color:${safeCss(accent)};font-size:11px;font-weight:800"><span>${String(index).padStart(2, "0")}</span><i style="height:2px;background:currentColor;opacity:.35"></i><em style="font-style:normal">${index + 1}/${total}</em></header><h2 style="font-size:25px;line-height:1.2;color:#fff;font-weight:900;margin-bottom:18px">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2><p style="font-size:15px;line-height:1.85;color:#cbd5e1;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin:20px 0 0;padding:14px 16px;border-left:4px solid ${safeCss(accent)};background:${hexToRgba(accent, 0.13)};font-size:13px;line-height:1.65">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent, "line")}</article>`
  }

  if (isStyle(styleId, ["gradient"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-gradient" data-moka-card data-slide-index="${index}" style="background:linear-gradient(135deg,${safeCss(accent)},${safeCss(palette.tc)});padding:42px 34px;color:#fff;justify-content:center;text-align:center"><div style="font-size:54px;margin-bottom:18px">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:34px;font-weight:900;color:#fff;line-height:1.12;margin-bottom:14px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:rgba(255,255,255,.86);line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}${renderSlideDots(total, index, "#ffffff", "line")}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-gradient" data-moka-card data-slide-index="${index}" style="background:#fff;padding:38px 32px;justify-content:center;text-align:center"><div style="position:absolute;inset:0;background:linear-gradient(135deg,${hexToRgba(accent, 0.18)},transparent 54%,${hexToRgba(palette.tc, 0.10)})"></div><div style="position:relative;z-index:1"><h2 style="font-size:28px;font-weight:900;color:#172033;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:#475569;margin-bottom:28px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent)}${renderSlideDots(total, index, accent, "line")}</div></article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-gradient" data-moka-card data-slide-index="${index}" style="background:#fff;padding:34px 30px;border:1px solid ${hexToRgba(accent, 0.16)}"><div style="position:absolute;left:0;top:0;width:100%;height:9px;background:linear-gradient(90deg,${safeCss(accent)},${safeCss(palette.tc)})"></div><header style="display:flex;align-items:center;gap:12px;margin-bottom:24px"><span style="font-size:13px;font-weight:900;color:${safeCss(accent)}">${String(index).padStart(2, "0")}</span><i style="flex:1;height:1px;background:${hexToRgba(accent, 0.22)}"></i><em style="font-style:normal;font-size:11px;color:#94a3b8">${index + 1}/${total}</em></header><h2 style="font-size:25px;line-height:1.22;color:#172033;font-weight:900;margin-bottom:14px">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2><p style="font-size:15px;color:#475569;line-height:1.85;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:20px;padding:16px 18px;background:linear-gradient(135deg,${hexToRgba(accent, 0.09)},${hexToRgba(palette.tc, 0.06)});border-radius:14px;font-size:13px;color:#334155;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent, "line")}</article>`
  }

  if (isStyle(styleId, ["business", "finance", "law", "edu", "medical"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-professional" data-moka-card data-slide-index="${index}" style="background:#fff;padding:36px 32px;border-radius:8px;border:1px solid rgba(17,24,39,0.12)"><div style="font-size:10px;color:${safeCss(accent)};font-weight:900;letter-spacing:3px;margin-bottom:24px">BRIEF · ${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</div><main style="display:grid;align-content:center;flex:1"><h1 style="font-size:32px;font-weight:900;color:#111827;line-height:1.15;margin-bottom:16px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:#4b5563;line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main><div style="height:4px;background:${safeCss(accent)};width:72px"></div>${renderSlideDots(total, index, accent, "line")}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-professional" data-moka-card data-slide-index="${index}" style="background:#111827;color:#fff;padding:40px 32px;justify-content:center;border-radius:8px"><div style="font-size:10px;color:${safeCss(accent)};font-weight:900;letter-spacing:3px;margin-bottom:22px;text-align:center">SUMMARY</div><h2 style="font-size:28px;font-weight:900;color:#fff;text-align:center;line-height:1.25;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.72);text-align:center;margin-bottom:26px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent, true)}${renderSlideDots(total, index, accent, "line")}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-professional" data-moka-card data-slide-index="${index}" style="background:#fff;padding:32px 30px;border-radius:8px;border:1px solid rgba(17,24,39,0.12)"><header style="display:grid;grid-template-columns:58px 1fr;gap:16px;align-items:start;border-bottom:2px solid ${safeCss(accent)};padding-bottom:16px;margin-bottom:20px"><div style="font-size:28px;font-weight:900;color:${safeCss(accent)};line-height:1">${String(index).padStart(2, "0")}</div><h2 style="font-size:23px;line-height:1.22;color:#111827;font-weight:900">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2></header><p style="font-size:15px;color:#374151;line-height:1.85;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:#f8fafc;border-left:4px solid ${safeCss(accent)};font-size:13px;color:#4b5563;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent, "line")}</article>`
  }

  if (isStyle(styleId, ["creamy", "mom", "korean", "japanese"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-pastel" data-moka-card data-slide-index="${index}" style="background:linear-gradient(180deg,#fff7ed,#fff5f8);padding:38px 30px;text-align:center"><div style="position:absolute;right:-30px;top:-30px;width:132px;height:132px;border-radius:50%;background:${hexToRgba(accent, 0.16)}"></div><main style="position:relative;z-index:1;display:grid;align-content:center;flex:1"><div style="font-size:50px;margin-bottom:18px">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:32px;font-weight:900;color:#3b2417;line-height:1.2;margin-bottom:14px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:14px;color:#654332;line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${renderSlideDots(total, index, accent)}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-pastel" data-moka-card data-slide-index="${index}" style="background:linear-gradient(180deg,#fff5f8,#fff);padding:38px 30px;justify-content:center;text-align:center"><div style="font-size:34px;margin-bottom:18px">${escapeHtml(slide.emoji || "✨")}</div><h2 style="font-size:26px;font-weight:900;color:#3b2417;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:#654332;margin-bottom:26px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent)}${renderSlideDots(total, index, accent)}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-pastel" data-moka-card data-slide-index="${index}" style="background:#fffaf7;padding:30px 26px;border-radius:24px;border:1px solid ${hexToRgba(accent, 0.16)}"><header style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><span style="width:42px;height:42px;border-radius:16px;background:${hexToRgba(accent, 0.14)};color:${safeCss(accent)};display:grid;place-items:center;font-weight:900">${index}</span><h2 style="font-size:22px;line-height:1.25;color:#3b2417;font-weight:900">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2></header><p style="font-size:14px;color:#654332;line-height:1.9;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:#fff;border:1px dashed ${hexToRgba(accent, 0.35)};border-radius:16px;font-size:13px;color:#654332;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent)}</article>`
  }

  if (isStyle(styleId, ["forest", "food", "travel"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-organic" data-moka-card data-slide-index="${index}" style="background:#f0faf5;padding:36px 30px"><div style="position:absolute;right:-54px;bottom:-54px;width:190px;height:190px;border-radius:50%;background:${hexToRgba(accent, 0.15)}"></div><main style="position:relative;z-index:1;display:grid;align-content:center;flex:1"><div style="width:70px;height:70px;border-radius:22px;background:${safeCss(accent)};display:grid;place-items:center;color:#fff;font-size:36px;margin-bottom:22px">${escapeHtml(slide.emoji || "✨")}</div><h1 style="font-size:33px;font-weight:900;color:#0f2f22;line-height:1.16;margin-bottom:14px">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:#315444;line-height:1.7">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${renderSlideDots(total, index, accent)}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-organic" data-moka-card data-slide-index="${index}" style="background:#0f2f22;color:#fff;padding:40px 32px;justify-content:center;text-align:center"><h2 style="font-size:27px;font-weight:900;color:#fff;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.76);margin-bottom:26px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], "#ffffff", true)}${renderSlideDots(total, index, "#ffffff")}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-organic" data-moka-card data-slide-index="${index}" style="background:#f6fbf7;padding:30px 26px;border:1px solid ${hexToRgba(accent, 0.18)}"><header style="display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start;margin-bottom:18px"><span style="width:34px;height:34px;border-radius:12px;background:${safeCss(accent)};color:#fff;font-size:13px;font-weight:900;display:grid;place-items:center">${index}</span><h2 style="font-size:23px;font-weight:900;line-height:1.22;color:#0f2f22">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2></header><p style="font-size:15px;color:#315444;line-height:1.85;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:#fff;border-left:4px solid ${safeCss(accent)};font-size:13px;color:#315444;line-height:1.7">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent)}</article>`
  }

  if (isStyle(styleId, ["retro", "artistic", "luxury", "fashion"])) {
    if (slide.type === "cover") {
      return `<article class="${baseClass} moka-slide-cover moka-layout-lifestyle" data-moka-card data-slide-index="${index}" style="background:#111;color:#fff;padding:0"><header style="padding:18px 26px;border-bottom:1px solid rgba(255,255,255,0.18);display:flex;justify-content:space-between"><span style="font-size:10px;color:${safeCss(accent)};letter-spacing:3px;font-weight:900">${escapeHtml(displayCategory(slide.category, "INSIGHT"))}</span><span>${escapeHtml(slide.emoji || "✨")}</span></header><main style="flex:1;display:grid;align-content:center;padding:36px 28px"><h1 style="font-size:38px;font-weight:900;line-height:1.08;color:#fff;margin-bottom:16px;font-family:${styleId === "artistic" || styleId === "luxury" ? "'Georgia','Times New Roman','SimSun',serif" : "inherit"}">${escapeHtml(slide.title || "内容精华笔记")}</h1>${slide.subtitle ? `<p style="font-size:15px;color:rgba(255,255,255,0.74);line-height:1.7;border-left:3px solid ${safeCss(accent)};padding-left:14px">${escapeHtml(slide.subtitle)}</p>` : ""}</main>${renderSlideDots(total, index, accent, "line")}</article>`
    }
    if (slide.type === "end") {
      return `<article class="${baseClass} moka-slide-end moka-layout-lifestyle" data-moka-card data-slide-index="${index}" style="background:#111;color:#fff;padding:40px 32px;justify-content:center;text-align:center"><h2 style="font-size:28px;font-weight:900;color:#fff;margin-bottom:12px">${escapeHtml(slide.cta || "记住核心收获")}</h2>${slide.sub ? `<p style="font-size:14px;color:rgba(255,255,255,0.72);margin-bottom:28px;line-height:1.6">${escapeHtml(slide.sub)}</p>` : ""}${renderTemplateTags(slide.tags || [], accent, true, true)}${renderSlideDots(total, index, accent, "line")}</article>`
    }
    return `<article class="${baseClass} moka-slide-content moka-layout-lifestyle" data-moka-card data-slide-index="${index}" style="background:#111;color:#fff;padding:28px 24px"><header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;color:${safeCss(accent)};font-size:11px;font-weight:900"><span>NO.${String(index).padStart(2, "0")}</span><span>${index + 1}/${total}</span></header><h2 style="font-size:24px;font-weight:900;color:#fff;line-height:1.2;margin-bottom:16px">${escapeHtml(slide.heading || `第 ${index} 页`)}</h2><p style="font-size:14px;color:rgba(255,255,255,0.74);line-height:1.85;flex:1">${escapeHtml(slide.text || "")}</p>${slide.extra ? `<blockquote style="margin-top:18px;padding:14px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);font-size:13px;line-height:1.7;color:rgba(255,255,255,0.78)">${escapeHtml(slide.extra)}</blockquote>` : ""}${renderSlideDots(total, index, accent, "line")}</article>`
  }

  if (slide.type === "cover") {
    return `<article class="moka-card moka-slide moka-slide-cover moka-style-${escapeHtml(styleId)}" data-moka-card data-slide-index="${index}">
      ${renderDecorations(styleId, profile.accent)}
      <div class="moka-cover-mark">${escapeHtml(displayCategory(slide.category))}</div>
      <div class="moka-cover-center">
        <div class="moka-emoji">${escapeHtml(slide.emoji || "✨")}</div>
        <h1>${escapeHtml(slide.title || "内容精华笔记")}</h1>
        ${slide.subtitle ? `<p>${escapeHtml(slide.subtitle)}</p>` : ""}
      </div>
      ${renderSlideDots(total, index, profile.accent)}
    </article>`
  }

  if (slide.type === "end") {
    return `<article class="moka-card moka-slide moka-slide-end moka-style-${escapeHtml(styleId)}" data-moka-card data-slide-index="${index}">
      ${renderDecorations(styleId, profile.accent)}
      <div class="moka-end-center">
        <div class="moka-emoji">${escapeHtml(slide.emoji || "✨")}</div>
        <h2>${escapeHtml(slide.cta || "记住核心收获")}</h2>
        ${slide.sub ? `<p>${escapeHtml(slide.sub)}</p>` : ""}
        ${renderTagList(slide.tags || [], "moka-tags moka-end-tags")}
      </div>
      ${renderSlideDots(total, index, profile.accent)}
    </article>`
  }

  return `<article class="moka-card moka-slide moka-slide-content moka-style-${escapeHtml(styleId)}" data-moka-card data-slide-index="${index}">
    ${renderDecorations(styleId, profile.accent)}
    <header class="moka-slide-top">
      <span>${String(index).padStart(2, "0")}</span>
      <i></i>
      <em>${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</em>
    </header>
    <main class="moka-slide-body">
      <h2>${escapeHtml(slide.heading || `第 ${index} 页`)}</h2>
      <p>${escapeHtml(slide.text || "")}</p>
      ${slide.extra ? `<blockquote>${escapeHtml(slide.extra)}</blockquote>` : ""}
    </main>
    ${renderSlideDots(total, index, profile.accent)}
  </article>`
}

function renderSplitCards(slides: MokaSlide[], styleId: string, palette: MokaPalette): string {
  return slides.map((slide, index) => renderSlide(slide, index, slides.length, styleId, palette)).join("")
}

function renderAiDecorations(decorations: unknown, currentSlideType?: string): string {
  if (!Array.isArray(decorations)) return ""
  return decorations.map((decoration, index) => {
    if (!decoration || typeof decoration !== "object") return ""
    const item = decoration as Record<string, unknown>
    const slide = String(item.slide || "all")
    if (currentSlideType && slide !== "all" && slide !== currentSlideType) return ""
    const style = item.style && typeof item.style === "object" ? item.style as Record<string, unknown> : {}
    const position = String(item.position || "top-right")
    const positionStyle: Record<string, string> = {
      "top-left": "top:0;left:0",
      "top-right": "top:0;right:0",
      "bottom-left": "bottom:0;left:0",
      "bottom-right": "bottom:0;right:0",
      "center": "top:50%;left:50%;transform:translate(-50%,-50%)",
    }
    const type = String(item.type || "shape")
    const radius = type === "circle" ? "border-radius:50%;" : type === "blob" ? "border-radius:60% 40% 30% 70% / 60% 30% 70% 40%;" : ""
    return `<div class="moka-ai-decoration" data-decoration="${escapeHtml(type)}-${index}" style="${positionStyle[position] || positionStyle["top-right"]};${radius}${styleAttr(style).replace(/^ style="|"$|&quot;/g, "")}"></div>`
  }).join("")
}

function renderAiSingle(design: MokaAiSingleDesign, _styleId = "ai", _palette = getMokaPalette()): string {
  const { styleConfig, content } = design
  const containerStyle = {
    background: getNestedStyle(styleConfig, ["container"]).background || "linear-gradient(135deg,#fff8f6,#ffffff)",
    padding: getNestedStyle(styleConfig, ["container"]).padding || "30px",
    borderRadius: getNestedStyle(styleConfig, ["container"]).borderRadius || "18px",
    boxShadow: getNestedStyle(styleConfig, ["container"]).boxShadow || "0 18px 48px rgba(16,24,40,0.13)",
    border: getNestedStyle(styleConfig, ["container"]).border,
  }
  const titleStyle = getNestedStyle(styleConfig, ["header", "title"], { fontSize: "28px", fontWeight: 800, color: "#1a1a1a" })
  const leadStyle = getNestedStyle(styleConfig, ["lead"], { fontSize: "14px", color: "#555", lineHeight: "1.7" })
  const sectionStyle = Array.isArray(styleConfig.sections) && styleConfig.sections[0] && typeof styleConfig.sections[0] === "object"
    ? styleConfig.sections[0] as Record<string, unknown>
    : {}
  const sectionHeadingStyle = getNestedStyle(sectionStyle, ["heading"], { fontSize: "16px", fontWeight: 700, color: "#333" })
  const sectionTextStyle = getNestedStyle(sectionStyle, ["text"], { fontSize: "14px", color: "#555", lineHeight: "1.7" })
  const tipStyle = getNestedStyle(styleConfig, ["tip"], { background: "#fff3cd", color: "#856404", borderRadius: "10px" })
  const tagsStyle = getNestedStyle(styleConfig, ["tags"], { background: "#e9ecef", color: "#495057", borderRadius: "16px" })
  const titleInlineStyle = mergeInlineStyle(titleStyle, content.titleStyle as Record<string, unknown> | undefined)
  const leadInlineStyle = mergeInlineStyle(leadStyle, content.leadStyle as Record<string, unknown> | undefined)
  const tipTextInlineStyle = mergeInlineStyle({}, content.tipStyle as Record<string, unknown> | undefined)

  return `<article class="moka-card moka-ai-card moka-ai-single" data-moka-card data-moka-ai-design="single"${styleAttr(containerStyle)}>
    ${renderAiDecorations(styleConfig.decorations)}
    <header class="moka-ai-header">
      <div class="moka-emoji">${escapeHtml(content.emoji || "✨")}</div>
      <div class="moka-category">${escapeHtml(displayCategory(content.category))}</div>
      <h1 ${editAttr("content.title", "content.titleStyle")}${styleAttr(titleInlineStyle)}>${escapeHtml(content.title)}</h1>
      ${content.lead ? `<p ${editAttr("content.lead", "content.leadStyle")}${styleAttr(leadInlineStyle)}>${escapeHtml(content.lead)}</p>` : ""}
    </header>
    <main class="moka-ai-sections">
      ${content.sections.map((section, index) => {
        const headingStyle = mergeInlineStyle(sectionHeadingStyle, section.headingStyle as Record<string, unknown> | undefined)
        const textStyle = mergeInlineStyle(sectionTextStyle, section.textStyle as Record<string, unknown> | undefined)
        return `<section class="moka-ai-section" style="background:${safeCss(sectionStyle.background || "#ffffff")};border-left:${safeCss(sectionStyle.borderLeft || "4px solid #667eea")};margin-bottom:${safeCss(sectionStyle.marginBottom || "14px")}">
        <h3 ${editAttr(`content.sections.${index}.heading`, `content.sections.${index}.headingStyle`)}${styleAttr(headingStyle)}>${escapeHtml(headingStyle.before || "")}${escapeHtml(section.heading)}</h3>
        <p ${editAttr(`content.sections.${index}.text`, `content.sections.${index}.textStyle`)}${styleAttr(textStyle)}>${escapeHtml(section.text)}</p>
      </section>`
      }).join("")}
    </main>
    ${content.tip ? `<aside class="moka-tip"${styleAttr(tipStyle)}><b>Tips</b><span ${editAttr("content.tip", "content.tipStyle")}${styleAttr(tipTextInlineStyle)}>${escapeHtml(content.tip)}</span></aside>` : ""}
    <div class="moka-tags">${(content.tags || []).map((tag, index) => {
      const visibleTag = displayCategory(tag.replace(/^#/, ""), "")
      if (!visibleTag) return ""
      const tagStyle = mergeInlineStyle(tagsStyle, content.tagStyles?.[index] as Record<string, unknown> | undefined)
      return `<span ${editAttr(`content.tags.${index}`, `content.tagStyles.${index}`)}${styleAttr(tagStyle)}>#${escapeHtml(visibleTag)}</span>`
    }).join("")}</div>
  </article>`
}

function renderAiSplit(design: MokaAiSplitDesign, _styleId = "ai", _palette = getMokaPalette()): string {
  const { styleConfig, slides } = design
  return slides.map((slide, index) => {
    const typeConfig = getNestedStyle(styleConfig, [slide.type])
    const baseStyle = {
      background: typeConfig.background || (slide.type === "cover" ? "linear-gradient(135deg,#667eea,#764ba2)" : slide.type === "end" ? "#f8f9fa" : "#ffffff"),
    }
    const dots = `<div class="moka-page-dots">${slides.map((_, i) => `<span class="${i === index ? "active" : ""}"></span>`).join("")}</div>`
    if (slide.type === "cover") {
      const titleStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["title"], { color: "#ffffff", fontSize: "30px", fontWeight: 800 }), slide.titleStyle as Record<string, unknown> | undefined)
      const subtitleStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["subtitle"], { color: "rgba(255,255,255,0.88)" }), slide.subtitleStyle as Record<string, unknown> | undefined)
      return `<article class="moka-card moka-slide moka-ai-slide moka-ai-cover" data-moka-card data-moka-ai-design="split" data-moka-slide-index="${index}" data-slide-index="${index}"${styleAttr(baseStyle)}>
        ${reorderHandle(index)}
        ${renderAiDecorations(styleConfig.decorations, "cover")}
        <div class="moka-cover-center">
          <div class="moka-emoji"${styleAttr(getNestedStyle(typeConfig, ["emoji"]))}>${escapeHtml(slide.emoji || "✨")}</div>
          <h1 ${editAttr(`slides.${index}.title`, `slides.${index}.titleStyle`)}${styleAttr(titleStyle)}>${escapeHtml(slide.title || "内容精华笔记")}</h1>
          ${slide.subtitle ? `<p ${editAttr(`slides.${index}.subtitle`, `slides.${index}.subtitleStyle`)}${styleAttr(subtitleStyle)}>${escapeHtml(slide.subtitle)}</p>` : ""}
        </div>
        ${dots}
      </article>`
    }
    if (slide.type === "end") {
      const tagsStyle = getNestedStyle(typeConfig, ["tags"])
      const ctaStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["cta"], { fontSize: "24px", fontWeight: 800 }), slide.ctaStyle as Record<string, unknown> | undefined)
      const subStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["sub"]), slide.subStyle as Record<string, unknown> | undefined)
      return `<article class="moka-card moka-slide moka-ai-slide moka-ai-end" data-moka-card data-moka-ai-design="split" data-moka-slide-index="${index}" data-slide-index="${index}"${styleAttr(baseStyle)}>
        ${reorderHandle(index)}
        ${renderAiDecorations(styleConfig.decorations, "end")}
        <div class="moka-end-center">
          <h2 ${editAttr(`slides.${index}.cta`, `slides.${index}.ctaStyle`)}${styleAttr(ctaStyle)}>${escapeHtml(slide.cta || "记住核心收获")}</h2>
          ${slide.sub ? `<p ${editAttr(`slides.${index}.sub`, `slides.${index}.subStyle`)}${styleAttr(subStyle)}>${escapeHtml(slide.sub)}</p>` : ""}
          <div class="moka-tags">${(slide.tags || []).map((tag, tagIndex) => {
            const visibleTag = displayCategory(tag.replace(/^#/, ""), "")
            if (!visibleTag) return ""
            const tagStyle = mergeInlineStyle(tagsStyle, slide.tagStyles?.[tagIndex] as Record<string, unknown> | undefined)
            return `<span ${editAttr(`slides.${index}.tags.${tagIndex}`, `slides.${index}.tagStyles.${tagIndex}`)}${styleAttr(tagStyle)}>#${escapeHtml(visibleTag)}</span>`
          }).join("")}</div>
        </div>
        ${dots}
      </article>`
    }
    const headingStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["heading"], { fontSize: "22px", fontWeight: 800 }), slide.headingStyle as Record<string, unknown> | undefined)
    const textStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["text"], { fontSize: "15px", lineHeight: "1.8" }), slide.textStyle as Record<string, unknown> | undefined)
    const extraStyle = mergeInlineStyle(getNestedStyle(typeConfig, ["extra"]), slide.extraStyle as Record<string, unknown> | undefined)
    return `<article class="moka-card moka-slide moka-ai-slide moka-ai-content" data-moka-card data-moka-ai-design="split" data-moka-slide-index="${index}" data-slide-index="${index}"${styleAttr(baseStyle)}>
      ${reorderHandle(index)}
      ${renderAiDecorations(styleConfig.decorations, "content")}
      <header class="moka-slide-top"><span>${String(index).padStart(2, "0")}</span><i></i><em>${index + 1} / ${slides.length}</em></header>
      <main class="moka-slide-body">
        <h2 ${editAttr(`slides.${index}.heading`, `slides.${index}.headingStyle`)}${styleAttr(headingStyle)}>${escapeHtml(slide.heading || `第 ${index} 页`)}</h2>
        <p ${editAttr(`slides.${index}.text`, `slides.${index}.textStyle`)}${styleAttr(textStyle)}>${escapeHtml(slide.text || "")}</p>
        ${slide.extra ? `<blockquote ${editAttr(`slides.${index}.extra`, `slides.${index}.extraStyle`)}${styleAttr(extraStyle)}>${escapeHtml(slide.extra)}</blockquote>` : ""}
      </main>
      ${dots}
    </article>`
  }).join("")
}

function buildMokaEditorScript(): string {
  return `<script>
    (function () {
      var SOURCE = "lingmo-moka-editor";
      var DRAG_THRESHOLD = 3;
      function post(payload) {
        if (!window.parent || window.parent === window) return;
        try {
          window.parent.postMessage(Object.assign({ source: SOURCE }, payload), "*");
        } catch (error) {}
      }
      function normalizeText(element) {
        return (element.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
      }
      function focusAtEnd(element) {
        element.focus();
        try {
          var range = document.createRange();
          range.selectNodeContents(element);
          range.collapse(false);
          var selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } catch (error) {}
      }
      function parsePx(value) {
        var parsed = Number.parseFloat(value || "0");
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function getOffsetPx(element, property) {
        var inlineValue = element.style[property];
        if (inlineValue && inlineValue !== "auto") return parsePx(inlineValue);
        var computedValue = window.getComputedStyle(element)[property];
        return computedValue === "auto" ? 0 : parsePx(computedValue);
      }

      document.querySelectorAll("[data-moka-edit-path]").forEach(function (element) {
        element.addEventListener("focus", function () {
          element.classList.add("moka-editing");
        });
        element.addEventListener("blur", function () {
          element.classList.remove("moka-editing");
          post({ type: "text", path: element.getAttribute("data-moka-edit-path"), value: normalizeText(element) });
        });
        element.addEventListener("keydown", function (event) {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            element.blur();
          }
        });
      });

      var activeDrag = null;
      document.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        if (event.target.closest("[data-moka-reorder-handle]")) return;
        var element = event.target.closest("[data-moka-drag-path]");
        if (!element || document.activeElement === element) return;
        activeDrag = {
          element: element,
          path: element.getAttribute("data-moka-drag-path"),
          startX: event.clientX,
          startY: event.clientY,
          left: getOffsetPx(element, "left"),
          top: getOffsetPx(element, "top"),
          moved: false
        };
        event.preventDefault();
      });
      document.addEventListener("pointermove", function (event) {
        if (!activeDrag) return;
        var dx = event.clientX - activeDrag.startX;
        var dy = event.clientY - activeDrag.startY;
        if (!activeDrag.moved && Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) return;
        activeDrag.moved = true;
        activeDrag.element.classList.add("moka-dragging");
        activeDrag.element.style.left = String(Math.round(activeDrag.left + dx)) + "px";
        activeDrag.element.style.top = String(Math.round(activeDrag.top + dy)) + "px";
        event.preventDefault();
      });
      document.addEventListener("pointerup", function () {
        if (!activeDrag) return;
        var drag = activeDrag;
        activeDrag = null;
        drag.element.classList.remove("moka-dragging");
        if (!drag.moved) {
          focusAtEnd(drag.element);
          return;
        }
        post({
          type: "style",
          path: drag.path,
          style: {
            left: drag.element.style.left,
            top: drag.element.style.top
          }
        });
      });

      var dragFrom = null;
      function clearReorderState() {
        document.querySelectorAll(".moka-slide-dragging,.moka-slide-drop-target").forEach(function (element) {
          element.classList.remove("moka-slide-dragging", "moka-slide-drop-target");
        });
        dragFrom = null;
      }
      document.addEventListener("dragstart", function (event) {
        var handle = event.target.closest("[data-moka-reorder-handle]");
        if (!handle) return;
        dragFrom = Number(handle.getAttribute("data-moka-reorder-handle"));
        var card = handle.closest("[data-moka-slide-index]");
        if (card) card.classList.add("moka-slide-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(dragFrom));
        }
      });
      document.addEventListener("dragover", function (event) {
        if (dragFrom === null) return;
        var card = event.target.closest("[data-moka-slide-index]");
        if (!card) return;
        event.preventDefault();
        card.classList.add("moka-slide-drop-target");
      });
      document.addEventListener("dragleave", function (event) {
        var card = event.target.closest("[data-moka-slide-index]");
        if (card) card.classList.remove("moka-slide-drop-target");
      });
      document.addEventListener("drop", function (event) {
        if (dragFrom === null) return;
        var card = event.target.closest("[data-moka-slide-index]");
        if (!card) return;
        event.preventDefault();
        var to = Number(card.getAttribute("data-moka-slide-index"));
        if (Number.isFinite(dragFrom) && Number.isFinite(to) && dragFrom !== to) {
          post({ type: "reorder", from: dragFrom, to: to });
        }
        clearReorderState();
      });
      document.addEventListener("dragend", clearReorderState);
    })();
  </script>`
}

function buildDocument(params: {
  title: string
  styleId: string
  palette: MokaPalette
  sourceLabel?: string
  generatedAt?: string
  referenceImageName?: string
  cardsHtml: string
}) {
  const profile = getStyleProfile(params.styleId, params.palette)
  const referenceComment = params.referenceImageName ? `reference-image: ${params.referenceImageName}` : "reference-image: none"
  const sourceMeta = [params.sourceLabel || "手动输入", params.generatedAt || ""]
    .filter(Boolean)
    .join(" · ")
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(params.title)}</title>
  <!-- ${escapeHtml(referenceComment)} -->
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      min-height: 100vh;
      background: ${getDocumentBackground(profile)};
      color: ${safeCss(profile.body)};
      font-family: ${profile.font};
      padding: 28px;
    }
    .moka-workshop {
      width: min(100%, 1180px);
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }
    .moka-meta {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      color: ${safeCss(profile.body)};
      font-size: 12px;
      opacity: 0.68;
      min-height: 20px;
    }
    .moka-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 312px), 420px));
      justify-content: center;
      gap: 30px;
      align-items: start;
    }
    .moka-card {
      width: min(100%, 420px);
      aspect-ratio: 3 / 4;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: ${safeCss(profile.surface)};
      color: ${safeCss(profile.body)};
      border: ${safeCss(profile.border)};
      border-radius: ${safeCss(profile.radius)};
      box-shadow: ${safeCss(profile.cardShadow)};
      padding: 32px 28px;
      isolation: isolate;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .moka-card:hover { transform: translateY(-2px); }
    .moka-card h1, .moka-card h2, .moka-card h3, .moka-card p { margin: 0; }
    .moka-card h1, .moka-card h2, .moka-card h3 {
      color: ${safeCss(profile.title)};
      text-wrap: balance;
      letter-spacing: 0;
    }
    .moka-emoji { font-size: 40px; line-height: 1; margin-bottom: 12px; }
    .moka-category, .moka-cover-mark {
      color: ${safeCss(profile.accent)};
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .moka-single-header { position: relative; z-index: 1; display: grid; gap: 10px; }
    .moka-single-header h1, .moka-cover-center h1 { font-size: 30px; line-height: 1.12; font-weight: 900; }
    .moka-lead, .moka-cover-center p { font-size: 14px; line-height: 1.7; color: ${safeCss(profile.body)}; }
    .moka-sections, .moka-ai-sections { position: relative; z-index: 1; display: grid; gap: 12px; margin-top: 18px; }
    .moka-section {
      display: grid;
      grid-template-columns: 38px 1fr;
      gap: 12px;
      align-items: start;
      padding: 13px 0;
      border-top: 1px solid color-mix(in srgb, ${safeCss(profile.accent)} 28%, transparent);
    }
    .moka-section-index {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      background: ${safeCss(profile.accent)};
      color: #ffffff;
      font-size: 12px;
      font-weight: 900;
      border-radius: 999px;
    }
    .moka-section h3 { font-size: 15px; line-height: 1.25; margin-bottom: 5px; }
    .moka-section p, .moka-slide-body p, .moka-ai-section p { font-size: 14px; line-height: 1.75; white-space: pre-wrap; }
    .moka-tip {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 4px;
      margin-top: auto;
      padding: 12px 14px;
      background: color-mix(in srgb, ${safeCss(profile.accent)} 12%, transparent);
      border-left: 4px solid ${safeCss(profile.accent)};
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.5;
    }
    .moka-tip b { color: ${safeCss(profile.accent)}; }
    .moka-tags { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
    .moka-tags span {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border-radius: 999px;
      padding: 5px 10px;
      background: color-mix(in srgb, ${safeCss(profile.accent)} 12%, #ffffff);
      color: ${safeCss(profile.accent)};
      font-size: 11px;
      font-weight: 700;
    }
    .moka-slide-cover, .moka-slide-end { justify-content: center; }
    .moka-cover-mark { position: absolute; top: 26px; left: 28px; z-index: 1; }
    .moka-cover-center, .moka-end-center {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 14px;
      text-align: center;
      place-items: center;
    }
    .moka-slide-top {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 30px;
      font-size: 11px;
      color: ${safeCss(profile.accent)};
      font-weight: 800;
    }
    .moka-slide-top i { height: 2px; background: currentColor; opacity: 0.3; }
    .moka-slide-top em { font-style: normal; opacity: 0.7; }
    .moka-slide-body {
      position: relative;
      z-index: 1;
      flex: 1;
      display: grid;
      align-content: start;
      gap: 18px;
    }
    .moka-slide-body h2, .moka-end-center h2 { font-size: 25px; line-height: 1.2; font-weight: 900; }
    .moka-slide-body blockquote {
      margin: 4px 0 0;
      padding: 14px 16px;
      border-left: 4px solid ${safeCss(profile.accent)};
      background: color-mix(in srgb, ${safeCss(profile.accent)} 10%, transparent);
      font-size: 13px;
      line-height: 1.65;
    }
    .moka-page-dots {
      position: relative;
      z-index: 1;
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: center;
      margin-top: auto;
    }
    .moka-page-dots span {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: color-mix(in srgb, ${safeCss(profile.accent)} 30%, transparent);
    }
    .moka-page-dots span.active { width: 24px; background: ${safeCss(profile.accent)}; }
    .moka-orb {
      position: absolute;
      width: 150px;
      height: 150px;
      right: -55px;
      top: -55px;
      border-radius: 999px;
      z-index: 0;
    }
    .moka-line-deco { position: absolute; inset: 20px; border: 1px solid color-mix(in srgb, ${safeCss(profile.accent)} 18%, transparent); pointer-events: none; }
    .moka-paper-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(196,124,43,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(196,124,43,0.08) 1px, transparent 1px); background-size: 22px 22px; }
    .moka-stamp { position: absolute; right: 24px; top: 24px; transform: rotate(8deg); border: 1px dashed ${safeCss(profile.accent)}; color: ${safeCss(profile.accent)}; padding: 6px 10px; font-size: 10px; text-transform: uppercase; }
    .moka-pop-block { position: absolute; z-index: 0; background: ${safeCss(profile.accent)}; }
    .moka-pop-block.one { width: 92px; height: 92px; right: -18px; top: 28px; transform: rotate(8deg); }
    .moka-pop-block.two { width: 48px; height: 48px; left: 20px; bottom: 26px; background: #111; transform: rotate(45deg); }
    .moka-ai-decoration {
      position: absolute;
      pointer-events: none;
      z-index: 0;
    }
    .moka-ai-card, .moka-ai-slide { border: 0; color: inherit; }
    .moka-ai-header, .moka-ai-sections, .moka-ai-section { position: relative; z-index: 1; }
    .moka-ai-section { padding: 15px 16px; border-radius: 12px; }
    [data-moka-edit-path] {
      position: relative;
      min-width: 1ch;
      border-radius: 4px;
      outline: 0;
      cursor: grab;
      transition: box-shadow .16s ease, background-color .16s ease, opacity .16s ease;
      white-space: pre-wrap;
    }
    [data-moka-edit-path]:hover,
    [data-moka-edit-path].moka-editing {
      background: rgba(255,255,255,0.16);
      box-shadow: 0 0 0 1px color-mix(in srgb, ${safeCss(profile.accent)} 54%, transparent);
    }
    [data-moka-edit-path].moka-editing {
      cursor: text;
      user-select: text;
    }
    [data-moka-edit-path].moka-dragging {
      cursor: move;
      opacity: .9;
      transition: none;
      user-select: none;
    }
    .moka-reorder-handle {
      position: absolute;
      right: 10px;
      top: 10px;
      z-index: 8;
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border: 1px solid rgba(255,255,255,.28);
      border-radius: 8px;
      background: rgba(15,23,42,.56);
      color: #ffffff;
      cursor: grab;
      font: 800 13px/1 ${profile.font};
      opacity: 0;
      backdrop-filter: blur(10px);
      transition: opacity .16s ease, transform .16s ease, background-color .16s ease;
    }
    .moka-card:hover .moka-reorder-handle {
      opacity: .88;
    }
    .moka-reorder-handle:hover {
      opacity: 1;
      transform: translateY(-1px);
      background: rgba(15,23,42,.72);
    }
    .moka-reorder-handle:active {
      cursor: grabbing;
    }
    .moka-slide-dragging {
      opacity: .72;
    }
    .moka-slide-drop-target {
      outline: 2px solid ${safeCss(profile.accent)};
      outline-offset: 4px;
    }
    .lingmo-smart-card-export-root .moka-card {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }
    .lingmo-smart-card-export-root .moka-reorder-handle {
      display: none !important;
    }
    .lingmo-smart-card-export-root [data-moka-edit-path] {
      cursor: inherit !important;
      box-shadow: none !important;
      background: transparent !important;
    }
    @media (max-width: 760px) {
      body { padding: 16px; }
      .moka-board { grid-template-columns: 1fr; gap: 20px; }
      .moka-meta { justify-content: flex-start; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <main class="moka-workshop">
    ${sourceMeta ? `<div class="moka-meta"><span>${escapeHtml(sourceMeta)}</span></div>` : ""}
    <section class="moka-board" aria-label="moka cards">
      ${params.cardsHtml}
    </section>
  </main>
  ${buildMokaEditorScript()}
</body>
</html>`
}

export function buildMokaHtml(options: MokaBuildOptions): string {
  const styleId = options.styleId || getMokaStyleId(options.templateId)
  const basePalette = getMokaPalette(options.paletteId || options.themeColor)
  const palette = options.themeColor && /^#[0-9a-f]{6}$/i.test(options.themeColor)
    ? { ...basePalette, a: options.themeColor }
    : basePalette
  let cardsHtml = ""
  if (options.result.kind === "single") {
    cardsHtml = renderSingleCard(options.result.content, styleId, palette)
  } else if (options.result.kind === "split") {
    cardsHtml = renderSplitCards(options.result.slides, styleId, palette)
  } else if (options.result.kind === "ai-single") {
    cardsHtml = styleId === "ai"
      ? renderAiSingle(options.result.design, styleId, palette)
      : enhanceEditableSingleCard(renderSingleCard(options.result.design.content, styleId, palette), options.result.design.content)
  } else {
    cardsHtml = styleId === "ai"
      ? renderAiSplit(options.result.design, styleId, palette)
      : renderEditableSplitCards(options.result.design.slides, styleId, palette)
  }

  return buildDocument({
    title: options.title,
    styleId,
    palette,
    sourceLabel: options.sourceLabel,
    generatedAt: options.generatedAt,
    referenceImageName: options.referenceImageName,
    cardsHtml,
  })
}

export function buildMokaTemplatePreviewHtml(templateId: string): string {
  const sampleSingle: MokaSingleContent = {
    emoji: "✨",
    category: "输出工坊",
    title: "把灵感变成可发布卡片",
    lead: "先提炼原文主线，再选择适合内容气质的视觉结构。",
    sections: [
      { heading: "观点优先", text: "标题、导语和要点都围绕原文事实展开，不替文章换主题。" },
      { heading: "结构变化", text: "不同主题会切换海报、杂志、手账、简报等版式骨架。" },
      { heading: "发布友好", text: "生成后可以继续微调文字、顺序和视觉重点。" },
    ],
    tip: "适合把长文、笔记和报告整理成小红书组图。",
    tags: ["卡片", "视觉设计", "组图", "内容提炼", "输出工坊"],
  }
  const sampleSplit: MokaSlide[] = [
    { type: "cover", emoji: "✨", title: "从文章到组图", subtitle: "把核心观点拆成封面、论据页和收束页" },
    { type: "content", heading: "一页只讲一个判断", text: "每张卡片围绕一个清晰观点排版，避免把目录和字段名直接搬进画面。", extra: "适合小红书组图、微信图文卡片和课程摘要。" },
    { type: "end", cta: "继续完善这组卡片", sub: "保留原文原意，再调整节奏、重点和视觉层次。", tags: ["LingMo", "输出工坊", "内容提炼"] },
  ]

  const result =
    templateId === MOKA_AI_SINGLE_TEMPLATE_ID
      ? { kind: "ai-single" as const, design: { styleConfig: {}, content: sampleSingle }, usedFallback: false }
      : templateId === MOKA_AI_SPLIT_TEMPLATE_ID
        ? { kind: "ai-split" as const, design: { styleConfig: {}, slides: sampleSplit }, usedFallback: false }
        : templateId.startsWith("moka-split-")
          ? { kind: "split" as const, slides: sampleSplit, usedFallback: false }
          : { kind: "single" as const, content: sampleSingle, usedFallback: false }

  return buildMokaHtml({
    templateId,
    title: "模板预览",
    sourceLabel: "模板预览",
    generatedAt: "Preview",
    result,
  })
}
