/**
 * Shared HTML normalization for Output Workshop previews and generated files.
 */

const STYLE_ID = "lingmo-output-workshop-layout-guard"

const LAYOUT_GUARD_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
    min-width: 0;
  }

  html {
    width: 100%;
    min-height: 100%;
    overflow-x: hidden;
    text-size-adjust: 100%;
    -webkit-text-size-adjust: 100%;
  }

  body {
    width: 100%;
    min-width: 0;
    overflow-x: hidden;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  img, svg, video, canvas, iframe {
    max-width: 100%;
  }

  img, video, canvas {
    height: auto;
  }

  table {
    max-width: 100%;
  }

  pre, code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6 {
    overflow-wrap: anywhere;
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
  if (!html || html.includes(`id="${STYLE_ID}"`) || html.includes(`id='${STYLE_ID}'`)) return html

  const style = `<style id="${STYLE_ID}">${LAYOUT_GUARD_CSS}</style>`
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
