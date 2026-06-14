/**
 * Shared HTML normalization for Output Workshop previews and generated files.
 */

const STYLE_ID = "lingmo-output-workshop-layout-guard"
const STYLE_VERSION = "2026-06-layout-animate-typeset"

const LAYOUT_GUARD_CSS = `
  /* Output Workshop quality guard: layout, motion, and typography polish. */
  *, *::before, *::after {
    box-sizing: border-box;
    min-width: 0;
  }

  :root {
    --ow-space-1: 4px;
    --ow-space-2: 8px;
    --ow-space-3: 12px;
    --ow-space-4: 16px;
    --ow-space-6: 24px;
    --ow-space-8: 32px;
    --ow-space-12: 48px;
    --ow-text-xs: 0.75rem;
    --ow-text-sm: 0.875rem;
    --ow-text-base: 1rem;
    --ow-text-lg: 1.125rem;
    --ow-text-xl: 1.35rem;
    --ow-text-2xl: 1.65rem;
    --ow-text-3xl: 2rem;
    --ow-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --ow-ease-quick: cubic-bezier(0.25, 1, 0.5, 1);
  }

  html {
    width: 100%;
    min-height: 100%;
    overflow-x: hidden;
    text-size-adjust: 100%;
    -webkit-text-size-adjust: 100%;
    font-kerning: normal;
    font-optical-sizing: auto;
  }

  body {
    width: 100%;
    min-width: 0;
    overflow-x: hidden;
    overflow-wrap: anywhere;
    word-break: normal;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  img, svg, video, canvas, iframe {
    max-width: 100%;
  }

  img, video, canvas {
    height: auto;
  }

  table {
    max-width: 100%;
    border-collapse: collapse;
  }

  table:not(.gz-deck-grid):not(.slide-grid) {
    display: block;
    overflow-x: auto;
  }

  th, td {
    vertical-align: top;
  }

  pre {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
  }

  pre, code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6,
  [class*="title"],
  [class*="heading"],
  [class*="subtitle"],
  [class*="body"],
  [class*="caption"],
  [class*="summary"],
  [class*="label"] {
    overflow-wrap: anywhere;
    hyphens: auto;
  }

  h1, h2, h3 {
    text-wrap: balance;
    letter-spacing: 0 !important;
  }

  p, li, blockquote, figcaption {
    text-wrap: pretty;
  }

  p, blockquote, figcaption,
  [class*="body"],
  [class*="copy"],
  [class*="description"] {
    line-height: 1.6;
  }

  ul, ol {
    padding-inline-start: clamp(18px, 3vw, 28px);
  }

  [class*="grid"],
  [class*="row"],
  [class*="column"],
  [class*="card"],
  [class*="section"],
  [class*="slide"],
  [class*="panel"],
  [class*="content"],
  [class*="container"],
  [class*="wrapper"] {
    min-width: 0;
  }

  :is(a, button, summary, input, textarea, select, [role="button"], [tabindex]):focus-visible {
    outline: 2px solid color-mix(in srgb, currentColor 55%, transparent);
    outline-offset: 3px;
  }

  :is(a, button, summary, [role="button"]) {
    touch-action: manipulation;
  }

  :is(a, button, summary, [role="button"],
    [class*="card"],
    [class*="section"],
    [class*="panel"],
    [class*="block"],
    [class*="slide"],
    [class*="tag"],
    [class*="badge"]) {
    transition-property: transform, opacity, color, background-color, border-color, box-shadow, filter;
    transition-duration: 180ms;
    transition-timing-function: var(--ow-ease-out);
  }

  @media (hover: hover) and (pointer: fine) {
    :is(button, summary, [role="button"]):hover {
      transform: translateY(-1px);
    }
  }

  [style*="background-clip: text"],
  [style*="-webkit-background-clip: text"],
  [class*="gradient-text"] {
    background-image: none !important;
    -webkit-text-fill-color: currentColor !important;
    color: inherit;
  }

  .gz-deck-slide,
  .slide-frame,
  .deck-slide,
  .slide {
    contain: layout paint;
  }

  .gz-social-card,
  .cover-card,
  .detail-card,
  .xhs-card,
  .waterfall-card,
  .learning-card,
  .flashcard {
    max-width: 100%;
  }

  .gz-deck-slide,
  .slide-frame,
  .deck-slide,
  .slide,
  .gz-social-card,
  .cover-card,
  .detail-card,
  .xhs-card,
  .waterfall-card,
  .learning-card,
  .flashcard {
    overflow: hidden;
  }

  @media (max-width: 720px) {
    body {
      min-height: 100dvh;
    }

    h1 {
      font-size: clamp(1.75rem, 9vw, 3rem);
      line-height: 1.12;
    }

    h2 {
      font-size: clamp(1.3rem, 6vw, 2rem);
    }

    :is(.reader-container, .manual-wrapper, .tech-wrapper, .dashboard-wrapper, .business-layout, .bento-grid, .waterfall-grid, .cards-grid, main):not(.gz-deck-slide):not(.slide) {
      max-width: 100% !important;
    }

    :is(.columns, .grid, .bento-grid, .dashboard-grid, .stats-grid, .content-grid, .waterfall-grid):not(.gz-deck-grid):not(.slide-grid) {
      grid-template-columns: 1fr !important;
    }

    :is(.sidebar, .toc, .glass-sidebar, .business-sidebar) {
      max-width: 100% !important;
    }
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

function findHtmlStartIndex(value: string): number {
  const match = value.match(/<!doctype\s+html\b|<html\b|<head\b|<body\b/i)
  return match?.index ?? -1
}

function looksLikeCss(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^@(?:import|media|keyframes|font-face|supports|layer|container)\b/i.test(trimmed)) return true

  const cssRuleMatches = trimmed.match(/(?:^|[\s}])[-.#:[\]\w*][^{<>]{0,160}\{[^{}]*:[^{};]+;?[^{}]*\}/g)
  return (cssRuleMatches?.length ?? 0) >= 2
}

function extractMarkdownCodeBlock(value: string): string {
  const htmlBlock = value.match(/```(?:html|htm)\s*([\s\S]*?)(?:```|$)/i)
  if (htmlBlock?.[1]) return htmlBlock[1].trim()

  const genericBlock = value.match(/```\s*([\s\S]*?)(?:```|$)/)
  if (genericBlock?.[1]) return genericBlock[1].trim()

  return value.trim()
}

function wrapFragment(fragment: string): string {
  const trimmed = fragment.trim()
  if (!trimmed) return ""

  if (looksLikeCss(trimmed)) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${trimmed}</style>
</head>
<body></body>
</html>`
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>${trimmed}</body>
</html>`
}

function ensureDocumentShell(value: string): string {
  const trimmed = extractMarkdownCodeBlock(value)
  if (!trimmed) return ""

  const startIndex = findHtmlStartIndex(trimmed)
  const html = startIndex > 0 ? trimmed.slice(startIndex).trim() : trimmed

  if (/<!doctype\s+html\b/i.test(html) || /<html\b/i.test(html)) {
    return html
  }

  if (/<body\b/i.test(html)) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>${html}</html>`
  }

  if (/<head\b/i.test(html)) {
    return `<!DOCTYPE html><html lang="zh-CN">${html}<body></body></html>`
  }

  return wrapFragment(html)
}

function ensureMetaViewport(html: string): string {
  if (/<meta\s+name=["']viewport["']/i.test(html)) return html
  const meta = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${meta}</head>`)
  }
  return html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${meta}</head>`)
}

export function injectOutputWorkshopLayoutGuard(html: string): string {
  if (!html) return html

  const style = `<style id="${STYLE_ID}" data-version="${STYLE_VERSION}">${LAYOUT_GUARD_CSS}</style>`
  const existingStyleRegex = new RegExp(`<style\\b(?=[^>]*\\bid=["']${STYLE_ID}["'])[^>]*>[\\s\\S]*?<\\/style>`, "i")
  if (existingStyleRegex.test(html)) {
    return html.replace(existingStyleRegex, style)
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`)
  }
  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, `<body$1>${style}`)
  }
  return `${style}${html}`
}

export function normalizeOutputWorkshopHtml(value: string): string {
  const shelled = ensureMetaViewport(ensureDocumentShell(value))
  return injectOutputWorkshopLayoutGuard(shelled)
}
