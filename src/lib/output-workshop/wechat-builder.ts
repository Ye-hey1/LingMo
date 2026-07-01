/**
 * Deterministic WeChat article renderer for intelligent layout.
 *
 * It intentionally avoids browser-only APIs so previews/tests can render in
 * Node, Next, and Tauri without embedding huasheng_editor's standalone app.
 */

import { getWechatStyle, isWechatStyleId, type WechatElementStyle, type WechatStyleId } from "./wechat-styles"
import { escapeHtml, escapeAttr } from "./shared/escape"

export interface BuildWechatArticleOptions {
  styleId: string
  title: string
  subtitle?: string
  markdown: string
  sourceLabel?: string
  generatedAt?: string
}

function normalizeStyle(value: string | undefined): string {
  return (value || "").trim().replace(/;\s*$/, "")
}

function styleAttr(styles: Record<WechatElementStyle, string>, key: WechatElementStyle, extra = ""): string {
  const base = normalizeStyle(styles[key])
  const suffix = normalizeStyle(extra)
  return [base, suffix].filter(Boolean).join("; ")
}

function renderInline(value: string, styles: Record<WechatElementStyle, string>): string {
  const tokens: string[] = []
  let escaped = escapeHtml(value)

  const stash = (html: string) => {
    const key = `@@OW_INLINE_${tokens.length}@@`
    tokens.push(html)
    return key
  }

  escaped = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_full, alt: string, src: string) =>
    stash(`<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="${styleAttr(styles, "img")}">`)
  )

  escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_full, text: string, href: string) =>
    stash(`<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer" style="${styleAttr(styles, "a")}">${text}</a>`)
  )

  escaped = escaped.replace(/`([^`]+)`/g, (_full, code: string) =>
    stash(`<code style="${styleAttr(styles, "code")}">${code}</code>`)
  )

  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, `<strong style="${styleAttr(styles, "strong")}">$1</strong>`)
  escaped = escaped.replace(/__([^_]+)__/g, `<strong style="${styleAttr(styles, "strong")}">$1</strong>`)
  escaped = escaped.replace(/(^|[^\*])\*([^*\n]+)\*/g, `$1<em style="${styleAttr(styles, "em")}">$2</em>`)
  escaped = escaped.replace(/(^|[^_])_([^_\n]+)_/g, `$1<em style="${styleAttr(styles, "em")}">$2</em>`)
  escaped = escaped.replace(/\n/g, "<br>")

  tokens.forEach((html, index) => {
    escaped = escaped.replace(`@@OW_INLINE_${index}@@`, html)
  })

  return escaped
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function isDividerRow(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function looksLikeTable(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.trim().startsWith("|") &&
      lines[index]?.trim().endsWith("|") &&
      lines[index + 1] &&
      isDividerRow(lines[index + 1])
  )
}

function renderTable(lines: string[], start: number, styles: Record<WechatElementStyle, string>): { html: string; next: number } {
  const header = splitTableRow(lines[start])
  let index = start + 2
  const bodyRows: string[][] = []

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line.startsWith("|") || !line.endsWith("|")) break
    bodyRows.push(splitTableRow(line))
    index += 1
  }

  const thHtml = header
    .map((cell) => `<th style="${styleAttr(styles, "th")}">${renderInline(cell, styles)}</th>`)
    .join("")
  const rowsHtml = bodyRows
    .map((row) => {
      const cols = header.map((_, colIndex) => row[colIndex] || "")
      return `<tr style="${styleAttr(styles, "tr")}">${cols
        .map((cell) => `<td style="${styleAttr(styles, "td")}">${renderInline(cell, styles)}</td>`)
        .join("")}</tr>`
    })
    .join("")

  return {
    html: `<table style="${styleAttr(styles, "table")}"><thead><tr style="${styleAttr(styles, "tr")}">${thHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`,
    next: index,
  }
}

function renderList(lines: string[], start: number, ordered: boolean, styles: Record<WechatElementStyle, string>): { html: string; next: number } {
  const items: string[] = []
  let index = start
  const re = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/

  while (index < lines.length) {
    const match = re.exec(lines[index])
    if (!match) break
    items.push(`<li style="${styleAttr(styles, "li")}">${renderInline(match[1], styles)}</li>`)
    index += 1
  }

  const tag = ordered ? "ol" : "ul"
  return {
    html: `<${tag} style="${styleAttr(styles, tag)}">${items.join("")}</${tag}>`,
    next: index,
  }
}

function renderMarkdown(markdown: string, styles: Record<WechatElementStyle, string>): string {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return ""

  const lines = normalized.split("\n")
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (/^```/.test(trimmed)) {
      const lang = trimmed.replace(/^```/, "").trim()
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const langLabel = lang ? `<div style="color: rgba(255,255,255,0.58); font-size: 12px; margin-bottom: 8px;">${escapeHtml(lang)}</div>` : ""
      blocks.push(`<pre style="${styleAttr(styles, "pre")}">${langLabel}<code style="${styleAttr(styles, "code", "background: transparent !important; color: inherit !important; padding: 0; border: none; white-space: pre-wrap; display: block;")}">${escapeHtml(codeLines.join("\n"))}</code></pre>`)
      continue
    }

    if (looksLikeTable(lines, index)) {
      const rendered = renderTable(lines, index, styles)
      blocks.push(rendered.html)
      index = rendered.next
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading) {
      const level = Math.min(heading[1].length, 6)
      const key = `h${level}` as WechatElementStyle
      blocks.push(`<h${level} style="${styleAttr(styles, key)}">${renderInline(heading[2], styles)}</h${level}>`)
      index += 1
      continue
    }

    if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
      blocks.push(`<hr style="${styleAttr(styles, "hr")}">`)
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const rendered = renderList(lines, index, false, styles)
      blocks.push(rendered.html)
      index = rendered.next
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const rendered = renderList(lines, index, true, styles)
      blocks.push(rendered.html)
      index = rendered.next
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""))
        index += 1
      }
      blocks.push(`<blockquote style="${styleAttr(styles, "blockquote")}">${renderInline(quoteLines.join("\n"), styles)}</blockquote>`)
      continue
    }

    const imageOnly = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(trimmed)
    if (imageOnly) {
      blocks.push(`<img src="${escapeAttr(imageOnly[2])}" alt="${escapeAttr(imageOnly[1])}" style="${styleAttr(styles, "img")}">`)
      index += 1
      continue
    }

    const paragraph: string[] = [trimmed]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !/^```/.test(lines[index].trim()) &&
      !looksLikeTable(lines, index) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index].trim()) &&
      !/^(?:---|\*\*\*|___)$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(`<p style="${styleAttr(styles, "p")}">${renderInline(paragraph.join("\n"), styles)}</p>`)
  }

  return blocks.join("\n")
}

function hasTopLevelHeading(markdown: string): boolean {
  return /^#\s+\S+/m.test(markdown)
}

function buildMarkdownSource(options: BuildWechatArticleOptions): string {
  const source = options.markdown.trim()
  const title = options.title.trim()
  const subtitle = options.subtitle?.trim()
  const parts: string[] = []

  if (title && !hasTopLevelHeading(source)) {
    parts.push(`# ${title}`)
    if (subtitle) parts.push(`> ${subtitle}`)
  }

  parts.push(source)
  return parts.filter(Boolean).join("\n\n")
}

export function buildWechatArticle(options: BuildWechatArticleOptions): string {
  const styleId: WechatStyleId = isWechatStyleId(options.styleId) ? options.styleId : "wechat-default"
  const config = getWechatStyle(styleId)
  const styles = config.styles
  const bodyHtml = renderMarkdown(buildMarkdownSource(options), styles)
  const sourceMeta = [options.sourceLabel, options.generatedAt].filter(Boolean).join(" / ")
  const metaHtml = sourceMeta
    ? `<p style="${styleAttr(styles, "p", "font-size: 13px; color: rgba(0,0,0,0.45) !important; margin-top: 28px !important;")}">${escapeHtml(sourceMeta)}</p>`
    : ""

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title || config.name)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f4f5f7; }
    body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    @media (max-width: 720px) {
      body { background: #fff; }
      .wechat-article-shell { padding: 0 !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <main class="wechat-article-shell" data-tool="lingmo-output-workshop" data-template="${escapeAttr(styleId)}" style="min-height: 100vh; padding: 28px 14px;">
    <article class="wechat-article" style="${styleAttr(styles, "container")}">
      ${bodyHtml}
      ${metaHtml}
    </article>
  </main>
</body>
</html>`
}

export function buildWechatPreviewMarkdown(styleName: string): string {
  return `# ${styleName}

> 把 LingMo 笔记转换成可直接粘贴到微信公众号后台的图文排版。

## 适用场景

- 保留 Markdown 的章节结构
- 适合公众号正文、技术笔记和深度文章
- 生成后使用“导出 / 图文”复制到编辑器

## 小表格示例

| 模块 | 作用 |
| --- | --- |
| 模板选择 | 切换公众号主题 |
| 本地渲染 | 不等待 AI 重绘 |
| 图文复制 | 输出内联样式 HTML |

\`\`\`ts
const publish = "copy as rich text"
\`\`\`
`
}
