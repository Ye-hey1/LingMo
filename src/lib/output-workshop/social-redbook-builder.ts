import {
  escapeHtml,
  formatDate,
  getContentBrand,
  getContentCategory,
  renderMarkdown,
  type BuildHtmlOptions,
  type ExtractedSection,
} from "./shared/builder-utils"

export interface AutoRedbookSourceBuildOptions {
  templateId: string
  title: string
  sourceContent: string
  sourceLabel?: string
  generatedAt?: string
  fallbackHtml?: string
}

interface RedbookTheme {
  id: string
  label: string
  accent: string
  accent2: string
  accent3: string
  deckBg: string
  outerBg: string
  paper: string
  ink: string
  muted: string
  border: string
  shadow: string
  radius: string
  titleFont: string
  bodyFont: string
  monoFont: string
  marker: string
}

interface RedbookCardModel {
  title: string
  body?: string
  bullets?: string[]
  kicker?: string
}

const AUTO_REDBOOK_TEMPLATE_RE = /^social-redbook-/
const MAX_DETAIL_CARDS = 8
const MAX_BODY_CHARS = 360
const MIN_BODY_CARDS = 3

const REDBOOK_THEMES: Record<string, RedbookTheme> = {
  "social-redbook-sketch": {
    id: "sketch",
    label: "Sketch Note",
    accent: "#e74c3c",
    accent2: "#3498db",
    accent3: "#f1c40f",
    deckBg: "#ded8ca",
    outerBg: "#f1eee4",
    paper: "#fffef9",
    ink: "#333333",
    muted: "#777777",
    border: "#333333",
    shadow: "8px 8px 0 rgba(51,51,51,0.12)",
    radius: "22px",
    titleFont: "\"LXGW WenKai\", \"Comic Sans MS\", \"PingFang SC\", sans-serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"Courier New\", monospace",
    marker: "SKETCH",
  },
  "social-redbook-playful": {
    id: "playful",
    label: "Playful Geometric",
    accent: "#8b5cf6",
    accent2: "#f472b6",
    accent3: "#fbbf24",
    deckBg: "#e7def8",
    outerBg: "#fff7db",
    paper: "#fffdf5",
    ink: "#1e293b",
    muted: "#64748b",
    border: "#1e293b",
    shadow: "10px 10px 0 #1e293b",
    radius: "30px 10px 30px 10px",
    titleFont: "\"Arial Black\", \"PingFang SC\", sans-serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"SFMono-Regular\", Menlo, monospace",
    marker: "POP",
  },
  "social-redbook-brutal": {
    id: "brutal",
    label: "Neo Brutalism",
    accent: "#ff4757",
    accent2: "#00d2d3",
    accent3: "#feca57",
    deckBg: "#d8d8d8",
    outerBg: "#ffea61",
    paper: "#fffdf5",
    ink: "#000000",
    muted: "#343434",
    border: "#000000",
    shadow: "14px 14px 0 #000000",
    radius: "0px",
    titleFont: "\"Arial Black\", \"PingFang SC\", sans-serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"SFMono-Regular\", Menlo, monospace",
    marker: "LOUD",
  },
  "social-redbook-botanical": {
    id: "botanical",
    label: "Botanical",
    accent: "#4a7c59",
    accent2: "#8b7355",
    accent3: "#8fbc8f",
    deckBg: "#dbe5d6",
    outerBg: "#eef4e9",
    paper: "#f9faf6",
    ink: "#2d3b36",
    muted: "#6f8177",
    border: "#8fbc8f",
    shadow: "0 26px 60px rgba(74,124,89,0.18)",
    radius: "34px",
    titleFont: "\"Noto Serif SC\", \"Songti SC\", serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"SFMono-Regular\", Menlo, monospace",
    marker: "BOTANY",
  },
  "social-redbook-professional": {
    id: "professional",
    label: "Professional Brief",
    accent: "#2563eb",
    accent2: "#0f172a",
    accent3: "#dbeafe",
    deckBg: "#d8e2f2",
    outerBg: "#eaf1fb",
    paper: "#ffffff",
    ink: "#1a202c",
    muted: "#64748b",
    border: "#bfdbfe",
    shadow: "0 24px 54px rgba(37,99,235,0.14)",
    radius: "18px",
    titleFont: "\"Inter\", \"PingFang SC\", sans-serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"SFMono-Regular\", Menlo, monospace",
    marker: "BRIEF",
  },
  "social-redbook-retro": {
    id: "retro",
    label: "Retro Print",
    accent: "#d35400",
    accent2: "#8b4513",
    accent3: "#f39c12",
    deckBg: "#dfd0b6",
    outerBg: "#efe0bd",
    paper: "#fdf6e3",
    ink: "#5c4033",
    muted: "#8b7355",
    border: "#8b4513",
    shadow: "9px 9px 0 rgba(92,64,51,0.16)",
    radius: "8px",
    titleFont: "\"Georgia\", \"Songti SC\", serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"Courier New\", monospace",
    marker: "RETRO",
  },
  "social-redbook-terminal": {
    id: "terminal",
    label: "Terminal",
    accent: "#39d353",
    accent2: "#58a6ff",
    accent3: "#a371f7",
    deckBg: "#05080d",
    outerBg: "#0d1117",
    paper: "#0d1117",
    ink: "#c9d1d9",
    muted: "#8b949e",
    border: "#30363d",
    shadow: "0 0 0 1px #30363d, 0 28px 70px rgba(0,0,0,0.45)",
    radius: "18px",
    titleFont: "\"JetBrains Mono\", \"SFMono-Regular\", Menlo, monospace",
    bodyFont: "\"JetBrains Mono\", \"SFMono-Regular\", Menlo, monospace",
    monoFont: "\"JetBrains Mono\", \"SFMono-Regular\", Menlo, monospace",
    marker: "$ xhs",
  },
  "social-redbook-clean": {
    id: "clean",
    label: "Clean Native",
    accent: "#6366f1",
    accent2: "#8b5cf6",
    accent3: "#eef2ff",
    deckBg: "#e6e8f4",
    outerBg: "#f1f5ff",
    paper: "#ffffff",
    ink: "#1e293b",
    muted: "#64748b",
    border: "#e2e8f0",
    shadow: "0 24px 60px rgba(99,102,241,0.14)",
    radius: "28px",
    titleFont: "\"Inter\", \"PingFang SC\", sans-serif",
    bodyFont: "\"PingFang SC\", \"Noto Sans SC\", sans-serif",
    monoFont: "\"SFMono-Regular\", Menlo, monospace",
    marker: "CARD",
  },
}

export function isAutoRedbookTemplateId(templateId?: string): boolean {
  return Boolean(templateId && AUTO_REDBOOK_TEMPLATE_RE.test(templateId))
}

function resolveTheme(templateId: string): RedbookTheme {
  return REDBOOK_THEMES[templateId] ?? REDBOOK_THEMES["social-redbook-clean"]
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanMarkdownTitle(value: string): string {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function extractBullets(lines: string[]): string[] {
  return lines
    .filter((line) => /^\s*(?:[-*+]|\d+[.)、])\s+/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/, "").trim())
    .filter(Boolean)
}

function splitSourceIntoSections(sourceContent: string, fallbackTitle: string, fallbackHtml?: string): ExtractedSection[] {
  const raw = sourceContent.trim() || stripHtml(fallbackHtml || "")
  const normalized = raw.trim()
  if (!normalized) {
    return [{ title: fallbackTitle || "核心概览", body: fallbackTitle || "请补充素材内容" }]
  }

  const headingRegex = /^#{1,6}\s+.+$/gm
  const headings = Array.from(normalized.matchAll(headingRegex))
  if (headings.length > 0) {
    return headings
      .map((heading, index) => {
        const start = heading.index ?? 0
        const end = index + 1 < headings.length ? headings[index + 1].index ?? normalized.length : normalized.length
        const block = normalized.slice(start, end).trim()
        const lines = block.split(/\r?\n/)
        const rawTitle = lines.shift() || ""
        const bodyLines = lines.map((line) => line.trim()).filter(Boolean)
        const bullets = extractBullets(bodyLines)
        const body = bodyLines
          .filter((line) => !/^\s*(?:[-*+]|\d+[.)、])\s+/.test(line))
          .join("\n")
          .trim()
        return {
          title: cleanMarkdownTitle(rawTitle.replace(/^#{1,6}\s+/, "")) || fallbackTitle || `要点 ${index + 1}`,
          body,
          bullets: bullets.length ? bullets : undefined,
        }
      })
      .filter((section) => section.title || section.body || section.bullets?.length)
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return [{ title: fallbackTitle || "核心概览", body: normalized }]
  }

  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const bullets = extractBullets(lines)
    const body = lines.filter((line) => !/^\s*(?:[-*+]|\d+[.)、])\s+/.test(line)).join("\n").trim()
    return {
      title: index === 0 ? fallbackTitle || "核心概览" : `要点 ${index + 1}`,
      body: body || paragraph,
      bullets: bullets.length ? bullets : undefined,
    }
  })
}

function splitTextIntoChunks(text: string, maxChars = MAX_BODY_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const sentences = normalized
    .split(/(?<=[。！？.!?；;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (sentences.length <= 1) {
    const chunks: string[] = []
    for (let i = 0; i < normalized.length; i += maxChars) {
      chunks.push(normalized.slice(i, i + maxChars).trim())
    }
    return chunks
  }

  const chunks: string[] = []
  let current = ""
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim())
      current = ""
    }
    current = `${current}${current ? " " : ""}${sentence}`
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function compactBody(value?: string, limit = MAX_BODY_CHARS): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit).replace(/[，。；、\s]+$/g, "")}...`
}

function buildCardModels(sections: ExtractedSection[], title: string): RedbookCardModel[] {
  const visible = sections.filter((section) => section.title || section.body || section.bullets?.length)
  const models: RedbookCardModel[] = []
  const fallbackText = visible
    .flatMap((section) => [section.body || "", ...(section.bullets || [])])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

  for (const section of visible) {
    const bodyChunks = splitTextIntoChunks(section.body || "", MAX_BODY_CHARS)
    const chunks = bodyChunks.length ? bodyChunks : [""]
    chunks.forEach((chunk, chunkIndex) => {
      models.push({
        title: chunkIndex === 0 ? section.title : `${section.title}（续）`,
        body: chunk,
        bullets: chunkIndex === 0 ? section.bullets?.slice(0, 5) : undefined,
        kicker: section.importance === "high" ? "KEY POINT" : undefined,
      })
    })
  }

  if (models.length < MIN_BODY_CARDS) {
    const chunks = splitTextIntoChunks(fallbackText, 240)
    for (const chunk of chunks) {
      if (models.length >= MIN_BODY_CARDS) break
      const exists = models.some((model) => model.body === chunk)
      if (!exists && chunk) {
        models.push({
          title: models.length === 0 ? title || "核心概览" : `补充要点 ${models.length + 1}`,
          body: chunk,
        })
      }
    }
  }

  if (models.length === 0) {
    models.push({ title: title || "核心概览", body: "素材内容较短，已整理为社交组图核心卡片。" })
  }

  const shortSource = fallbackText || models[0]?.body || title || "请补充素材内容"
  while (models.length < MIN_BODY_CARDS) {
    const pageIndex = models.length + 1
    const preset: RedbookCardModel[] = [
      {
        title: "核心概览",
        body: compactBody(shortSource, 180),
        kicker: "SUMMARY",
      },
      {
        title: "传播重点",
        bullets: visible.flatMap((section) => section.bullets || []).slice(0, 4),
        body: compactBody(shortSource, 160),
        kicker: "FOCUS",
      },
      {
        title: "发布提示",
        bullets: ["封面先给结论", "正文一页一个观点", "结尾保留行动提醒"],
        body: "已按社交传播组图整理为封面与多张正文卡，便于逐张导出和发布。",
        kicker: "READY",
      },
    ]
    const fallback = preset[models.length] ?? {
      title: `补充要点 ${pageIndex}`,
      body: compactBody(shortSource, 160),
      kicker: "NOTE",
    }
    models.push(fallback)
  }

  return models.slice(0, MAX_DETAIL_CARDS)
}

function renderCss(theme: RedbookTheme): string {
  return `
    :root {
      --rb-deck-bg: ${theme.deckBg};
      --rb-outer-bg: ${theme.outerBg};
      --rb-paper: ${theme.paper};
      --rb-ink: ${theme.ink};
      --rb-muted: ${theme.muted};
      --rb-accent: ${theme.accent};
      --rb-accent-2: ${theme.accent2};
      --rb-accent-3: ${theme.accent3};
      --rb-border: ${theme.border};
      --rb-shadow: ${theme.shadow};
      --rb-radius: ${theme.radius};
      --rb-title-font: ${theme.titleFont};
      --rb-body-font: ${theme.bodyFont};
      --rb-mono-font: ${theme.monoFont};
    }
    * { box-sizing: border-box; }
    html { width: 100%; min-height: 100%; background: var(--rb-deck-bg); }
    body.redbook-output {
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 10% 8%, color-mix(in srgb, var(--rb-accent) 12%, transparent), transparent 28%),
        radial-gradient(circle at 90% 18%, color-mix(in srgb, var(--rb-accent-2) 10%, transparent), transparent 24%),
        var(--rb-deck-bg);
      color: var(--rb-ink);
      font-family: var(--rb-body-font);
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    .redbook-deck {
      display: grid;
      gap: 32px;
      justify-items: center;
      padding: 32px;
      scroll-snap-type: y proximity;
    }
    .cover-container,
    .card-container {
      width: 1080px;
      height: 1440px;
      position: relative;
      overflow: hidden;
      padding: 54px;
      background: var(--rb-outer-bg);
      scroll-snap-align: start;
      isolation: isolate;
    }
    .cover-inner,
    .card-inner {
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      display: block;
      padding: 78px;
      background: var(--rb-paper);
      border: 4px solid var(--rb-border);
      border-radius: var(--rb-radius);
      box-shadow: var(--rb-shadow);
    }
    .card-content {
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
    }
    .card-content-scale {
      position: relative;
      min-height: 100%;
      transform-origin: top left;
    }
    .rb-card-shell {
      min-height: 100%;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 32px;
    }
    .rb-meta-row,
    .rb-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      color: var(--rb-muted);
      font-family: var(--rb-mono-font);
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .rb-chip {
      display: inline-flex;
      align-items: center;
      min-height: 48px;
      padding: 8px 18px;
      border: 3px solid var(--rb-border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--rb-accent) 14%, var(--rb-paper));
      color: var(--rb-ink);
      box-shadow: 4px 4px 0 color-mix(in srgb, var(--rb-border) 28%, transparent);
      font-size: 24px;
    }
    .rb-display {
      margin: 0;
      color: var(--rb-ink);
      font-family: var(--rb-title-font);
      font-size: 112px;
      line-height: 1.08;
      font-weight: 900;
      letter-spacing: 0;
      text-wrap: balance;
    }
    .rb-subtitle {
      margin: 0;
      max-width: 780px;
      color: var(--rb-muted);
      font-size: 44px;
      line-height: 1.45;
      font-weight: 600;
      text-wrap: pretty;
    }
    .rb-directory {
      display: grid;
      gap: 18px;
      align-content: start;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rb-directory li {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      padding: 18px 0 0;
      border-top: 3px solid color-mix(in srgb, var(--rb-border) 18%, transparent);
      color: var(--rb-ink);
      font-size: 34px;
      line-height: 1.24;
      font-weight: 750;
    }
    .rb-directory span {
      color: var(--rb-accent);
      font-family: var(--rb-mono-font);
      font-size: 28px;
      font-weight: 900;
    }
    .rb-card-heading {
      margin: 0;
      max-width: 840px;
      color: var(--rb-ink);
      font-family: var(--rb-title-font);
      font-size: 72px;
      line-height: 1.16;
      font-weight: 900;
      letter-spacing: 0;
      text-wrap: balance;
    }
    .rb-body {
      display: grid;
      align-content: start;
      gap: 28px;
      min-height: 0;
      color: var(--rb-ink);
      font-size: 42px;
      line-height: 1.58;
      font-weight: 500;
    }
    .rb-body p {
      margin: 0;
      text-wrap: pretty;
    }
    .rb-body strong {
      color: var(--rb-ink);
      background: color-mix(in srgb, var(--rb-accent-3) 58%, transparent);
      padding: 0 0.2em;
      border-radius: 6px;
    }
    .rb-list {
      display: grid;
      gap: 18px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rb-list li {
      position: relative;
      padding: 20px 24px 20px 68px;
      border: 3px solid color-mix(in srgb, var(--rb-border) 20%, transparent);
      border-radius: 18px;
      background: color-mix(in srgb, var(--rb-paper) 82%, white);
      color: var(--rb-ink);
      font-size: 34px;
      line-height: 1.42;
      font-weight: 650;
    }
    .rb-list li::before {
      content: "";
      position: absolute;
      left: 24px;
      top: 31px;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: var(--rb-accent);
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--rb-accent) 16%, transparent);
    }
    .rb-page-number {
      color: var(--rb-accent);
      font-family: var(--rb-mono-font);
      font-size: 34px;
      font-weight: 900;
    }
    .rb-watermark {
      position: absolute;
      right: 56px;
      bottom: 74px;
      z-index: -1;
      color: color-mix(in srgb, var(--rb-accent) 10%, transparent);
      font-family: var(--rb-title-font);
      font-size: 240px;
      line-height: 1;
      font-weight: 900;
      pointer-events: none;
    }
    .redbook-theme-sketch .cover-inner,
    .redbook-theme-sketch .card-inner {
      background-image:
        linear-gradient(color-mix(in srgb, var(--rb-muted) 22%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--rb-muted) 22%, transparent) 1px, transparent 1px);
      background-size: 32px 32px;
    }
    .redbook-theme-sketch .rb-card-heading {
      text-decoration: underline;
      text-decoration-style: wavy;
      text-decoration-color: var(--rb-accent);
      text-underline-offset: 14px;
    }
    .redbook-theme-sketch .rb-chip {
      border-style: dashed;
      transform: rotate(-1deg);
    }
    .redbook-theme-playful .cover-container::before,
    .redbook-theme-playful .card-container::before {
      content: "";
      position: absolute;
      inset: 54px;
      pointer-events: none;
      background:
        radial-gradient(circle at 88% 14%, var(--rb-accent-2) 0 34px, transparent 35px),
        linear-gradient(45deg, transparent 0 48%, var(--rb-accent-3) 49% 58%, transparent 59%),
        radial-gradient(circle at 10% 88%, var(--rb-accent) 0 26px, transparent 27px);
      opacity: 0.6;
      z-index: 2;
    }
    .redbook-theme-brutal .cover-inner,
    .redbook-theme-brutal .card-inner {
      border-width: 7px;
    }
    .redbook-theme-brutal .rb-card-heading,
    .redbook-theme-brutal .rb-display {
      text-transform: uppercase;
    }
    .redbook-theme-brutal .rb-chip,
    .redbook-theme-brutal .rb-list li {
      border-width: 5px;
      box-shadow: 6px 6px 0 var(--rb-border);
    }
    .redbook-theme-botanical .cover-inner::after,
    .redbook-theme-botanical .card-inner::after {
      content: "";
      position: absolute;
      right: 44px;
      top: 116px;
      width: 170px;
      height: 420px;
      border-right: 5px solid color-mix(in srgb, var(--rb-accent) 45%, transparent);
      border-radius: 50%;
      transform: rotate(14deg);
      pointer-events: none;
    }
    .redbook-theme-professional .rb-chip,
    .redbook-theme-professional .rb-list li {
      box-shadow: none;
      border-width: 2px;
      border-radius: 10px;
    }
    .redbook-theme-professional .rb-card-heading {
      padding-bottom: 24px;
      border-bottom: 6px solid var(--rb-accent);
    }
    .redbook-theme-retro .cover-inner,
    .redbook-theme-retro .card-inner {
      outline: 5px double color-mix(in srgb, var(--rb-border) 70%, transparent);
      outline-offset: -24px;
      background-image: repeating-linear-gradient(0deg, transparent 0, transparent 16px, rgba(92,64,51,0.035) 17px);
    }
    .redbook-theme-terminal .rb-chip,
    .redbook-theme-terminal .rb-list li {
      border-radius: 8px;
      box-shadow: none;
      background: #161b22;
    }
    .redbook-theme-terminal .rb-card-heading::before {
      content: "# ";
      color: var(--rb-accent);
    }
    .redbook-theme-terminal .rb-list li::before {
      content: ">";
      top: 18px;
      width: auto;
      height: auto;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: var(--rb-accent);
      font-family: var(--rb-mono-font);
      font-size: 34px;
      font-weight: 900;
    }
    .redbook-theme-clean .cover-inner,
    .redbook-theme-clean .card-inner {
      border-width: 2px;
      box-shadow: var(--rb-shadow);
    }
    @media (max-width: 1180px) {
      .redbook-deck { padding: 16px; gap: 20px; }
      .cover-container,
      .card-container {
        width: min(1080px, calc(100vw - 32px));
        height: auto;
        aspect-ratio: 3 / 4;
        padding: clamp(22px, 5vw, 54px);
      }
      .cover-inner,
      .card-inner {
        padding: clamp(30px, 6.8vw, 78px);
      }
      .rb-display { font-size: clamp(44px, 10vw, 112px); }
      .rb-subtitle { font-size: clamp(22px, 4vw, 44px); }
      .rb-card-heading { font-size: clamp(30px, 6.8vw, 72px); }
      .rb-body { font-size: clamp(18px, 3.7vw, 42px); gap: clamp(12px, 2.6vw, 28px); }
      .rb-list li { font-size: clamp(16px, 3vw, 34px); padding-left: clamp(38px, 7vw, 68px); }
      .rb-meta-row,
      .rb-footer,
      .rb-directory span { font-size: clamp(12px, 2.4vw, 28px); }
      .rb-directory li { font-size: clamp(16px, 3vw, 34px); grid-template-columns: clamp(36px, 8vw, 76px) minmax(0, 1fr); }
      .rb-watermark { font-size: clamp(88px, 20vw, 240px); }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  `
}

function renderCoverCard(options: BuildHtmlOptions, theme: RedbookTheme, cards: RedbookCardModel[], totalPages: number): string {
  const brand = getContentBrand(options, "LingMo")
  const category = getContentCategory(options, "知识组图")
  const lead = compactBody(options.subtitle || options.sections[0]?.body || cards[0]?.body || options.title, 116)
  const directory = cards.slice(0, 5).map((card, index) => `
        <li><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(card.title)}</strong></li>`).join("")

  return `
    <section class="cover-container redbook-theme-${theme.id}" data-redbook-card="cover" data-export-card="cover">
      <div class="cover-inner card-inner">
        <div class="card-content">
          <div class="card-content-scale">
            <div class="rb-card-shell">
              <div class="rb-meta-row">
                <span class="rb-chip">${escapeHtml(theme.label)}</span>
                <span>${escapeHtml(category)}</span>
              </div>
              <div>
                <h1 class="rb-display">${escapeHtml(options.title || "社交传播组图")}</h1>
                <p class="rb-subtitle">${escapeHtml(lead)}</p>
              </div>
              <ol class="rb-directory">${directory}</ol>
              <footer class="rb-footer">
                <span>${escapeHtml(brand)}</span>
                <span class="rb-page-number">01 / ${String(totalPages).padStart(2, "0")}</span>
              </footer>
              <div class="rb-watermark">${escapeHtml(theme.marker)}</div>
            </div>
          </div>
        </div>
      </div>
    </section>`
}

function renderBodyCard(card: RedbookCardModel, options: BuildHtmlOptions, theme: RedbookTheme, index: number, totalPages: number): string {
  const brand = getContentBrand(options, "LingMo")
  const body = card.body ? `<p>${renderMarkdown(compactBody(card.body, MAX_BODY_CHARS))}</p>` : ""
  const bullets = card.bullets?.length
    ? `<ul class="rb-list">${card.bullets.slice(0, 5).map((bullet) => `<li>${renderMarkdown(compactBody(bullet, 96))}</li>`).join("")}</ul>`
    : ""
  const page = index + 2

  return `
    <section class="card-container redbook-theme-${theme.id}" data-redbook-card="${index + 1}" data-export-card="${index + 1}">
      <div class="card-inner">
        <div class="card-content">
          <div class="card-content-scale">
            <div class="rb-card-shell">
              <div class="rb-meta-row">
                <span class="rb-chip">${escapeHtml(card.kicker || theme.marker)}</span>
                <span>${escapeHtml(brand)}</span>
              </div>
              <h2 class="rb-card-heading">${escapeHtml(card.title || `要点 ${index + 1}`)}</h2>
              <div class="rb-body">
                ${body}
                ${bullets}
              </div>
              <footer class="rb-footer">
                <span>${escapeHtml(options.sourceLabel || theme.label)}</span>
                <span class="rb-page-number">${String(page).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}</span>
              </footer>
              <div class="rb-watermark">${String(index + 1).padStart(2, "0")}</div>
            </div>
          </div>
        </div>
      </div>
    </section>`
}

function renderAutoFitScript(): string {
  return `
    <script>
      (function () {
        function fitCardContent() {
          document.querySelectorAll('.card-content').forEach(function (viewport) {
            var scaleEl = viewport.querySelector('.card-content-scale');
            if (!scaleEl) return;
            scaleEl.style.transform = 'none';
            scaleEl.style.width = '';
            var availableWidth = viewport.clientWidth;
            var availableHeight = viewport.clientHeight;
            var contentWidth = Math.max(scaleEl.scrollWidth, scaleEl.getBoundingClientRect().width);
            var contentHeight = Math.max(scaleEl.scrollHeight, scaleEl.getBoundingClientRect().height);
            if (!availableWidth || !availableHeight || !contentWidth || !contentHeight) return;
            var fitScale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
            scaleEl.style.width = (availableWidth / fitScale) + 'px';
            scaleEl.style.transformOrigin = 'top left';
            scaleEl.style.transform = 'scale(' + fitScale + ')';
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', fitCardContent, { once: true });
        } else {
          fitCardContent();
        }
        window.addEventListener('resize', fitCardContent);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCardContent).catch(function () {});
      })();
    </script>`
}

export function buildAutoRedbookSocialCards(templateId: string, options: BuildHtmlOptions): string {
  const theme = resolveTheme(templateId)
  const date = options.generatedAt || formatDate(new Date())
  const sections = options.sections.length
    ? options.sections
    : [{ title: options.title || "核心概览", body: options.subtitle || options.title }]
  const cards = buildCardModels(sections, options.title)
  const totalPages = cards.length + 1
  const bodyCards = cards.map((card, index) => renderBodyCard(card, options, theme, index, totalPages)).join("\n")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title || "社交传播组图")}</title>
  <style>${renderCss(theme)}</style>
</head>
<body class="redbook-output redbook-theme-${theme.id}">
  <main class="redbook-deck" data-redbook-theme="${theme.id}" data-generated-at="${escapeHtml(date)}">
${renderCoverCard(options, theme, cards, totalPages)}
${bodyCards}
  </main>
${renderAutoFitScript()}
</body>
</html>`
}

export function buildAutoRedbookHtmlFromSource(options: AutoRedbookSourceBuildOptions): string {
  const title = options.title.trim() || "社交传播组图"
  const sections = splitSourceIntoSections(options.sourceContent, title, options.fallbackHtml)
  return buildAutoRedbookSocialCards(options.templateId, {
    title,
    sourceLabel: options.sourceLabel,
    generatedAt: options.generatedAt,
    sections,
  })
}
