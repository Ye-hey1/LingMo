/**
 * Deterministic WeChat article renderer for intelligent layout.
 *
 * It intentionally avoids browser-only APIs so previews/tests can render in
 * Node, Next, and Tauri without embedding huasheng_editor's standalone app.
 */

import { getWechatStyleOrCustom, isWechatStyleIdOrCustom } from "./wechat-styles"
import { escapeHtml, escapeAttr } from "./shared/escape"
import { renderWechatMarkdownWithMermaid, styleAttr } from "./wechat-markdown-renderer"
import { getMermaidRenderer } from "../mermaid"

export interface BuildWechatArticleOptions {
  styleId: string
  title: string
  subtitle?: string
  markdown: string
  sourceLabel?: string
  generatedAt?: string
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

/**
 * 把 bodyHtml 中的 mermaid 占位标记替换为内联 SVG。
 * mermaid.render 是异步的，故整个 buildWechatArticle 需为 async。
 * 渲染失败时回退为代码块原文（保证内容不丢失）。
 */
async function inlineMermaidSvg(bodyHtml: string, sources: string[]): Promise<string> {
  if (sources.length === 0) return bodyHtml
  const mermaid = await getMermaidRenderer("light")
  let result = bodyHtml
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]
    const placeholder = `<div data-lingmo-mermaid-slot="${i}"`
    if (!result.includes(placeholder)) continue
    try {
      const id = `lingmo-mermaid-${Date.now()}-${i}`
      const renderResult = await mermaid.render(id, source)
      const svg = renderResult.svg
      result = result.replace(
        new RegExp(`<div data-lingmo-mermaid-slot="${i}"[^>]*></div>`, "g"),
        `<div style="text-align:center; margin:16px 0;">${svg}</div>`
      )
    } catch (error) {
      // mermaid 渲染失败：回退为代码块原文，避免占位残留
      console.warn(`[wechat-builder] mermaid 渲染失败 (slot ${i}):`, error)
      result = result.replace(
        new RegExp(`<div data-lingmo-mermaid-slot="${i}"[^>]*></div>`, "g"),
        `<pre style="background:#2d2d2d;color:#abb2bf;padding:16px;border-radius:8px;overflow-x:auto;"><code>${escapeHtml(source)}</code></pre>`
      )
    }
  }
  return result
}

/** 组装微信图文 HTML 外壳（bodyHtml 已完成 markdown + mermaid + 公式渲染）。 */
function assembleWechatArticleShell(
  options: BuildWechatArticleOptions,
  bodyHtml: string
): string {
  const styleId = isWechatStyleIdOrCustom(options.styleId) ? options.styleId : "wechat-default"
  const config = getWechatStyleOrCustom(styleId)
  const styles = config.styles
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

/**
 * 异步构建微信图文（支持 mermaid 代码块渲染为内联 SVG）。
 * 正式生成管线使用此版本。
 */
export async function buildWechatArticle(options: BuildWechatArticleOptions): Promise<string> {
  const styles = getWechatStyleOrCustom(isWechatStyleIdOrCustom(options.styleId) ? options.styleId : "wechat-default").styles
  const { html: rawBodyHtml, mermaidSources } = renderWechatMarkdownWithMermaid({
    markdown: buildMarkdownSource(options),
    styles,
  })
  const bodyHtml = await inlineMermaidSvg(rawBodyHtml, mermaidSources)
  return assembleWechatArticleShell(options, bodyHtml)
}

/**
 * 同步构建微信图文（不渲染 mermaid，mermaid 代码块以占位/原文保留）。
 * 仅供模板预览等无法 await 的同步场景使用；正式生成请用 buildWechatArticle。
 */
export function buildWechatArticleSync(options: BuildWechatArticleOptions): string {
  const styles = getWechatStyleOrCustom(isWechatStyleIdOrCustom(options.styleId) ? options.styleId : "wechat-default").styles
  const { html: bodyHtml } = renderWechatMarkdownWithMermaid({
    markdown: buildMarkdownSource(options),
    styles,
  })
  return assembleWechatArticleShell(options, bodyHtml)
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
