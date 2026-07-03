import MarkdownIt from "markdown-it"
import type MarkdownItInstance from "markdown-it/lib/index.mjs"
import type { RenderRule } from "markdown-it/lib/renderer.mjs"
import type Token from "markdown-it/lib/token.mjs"
import hljs from "highlight.js"
import katexPlugin from "@traptitech/markdown-it-katex"

import type { WechatElementStyle } from "./wechat-styles"
import { escapeAttr, escapeHtml } from "./shared/escape"
import { normalizeExternalUrl } from "./shared/html-parse"

type MarkdownToken = Token

export interface RenderWechatMarkdownOptions {
  markdown: string
  styles: Record<WechatElementStyle, string>
}

export function normalizeWechatStyle(value: string | undefined): string {
  return (value || "").trim().replace(/;\s*$/, "")
}

export function styleAttr(styles: Record<WechatElementStyle, string>, key: WechatElementStyle, extra = ""): string {
  const base = normalizeWechatStyle(styles[key])
  const suffix = normalizeWechatStyle(extra)
  return [base, suffix].filter(Boolean).join("; ")
}

function mergeTokenStyle(token: MarkdownToken, styles: Record<WechatElementStyle, string>, key: WechatElementStyle, extra = "") {
  const current = normalizeWechatStyle(token.attrGet("style") || "")
  const next = styleAttr(styles, key, extra)
  const merged = [current, next].filter(Boolean).join("; ")
  if (merged) token.attrSet("style", merged)
}

function renderStyledToken(styles: Record<WechatElementStyle, string>, key: WechatElementStyle, extra = ""): RenderRule {
  return (tokens, idx, options, _env, self) => {
    mergeTokenStyle(tokens[idx], styles, key, extra)
    return self.renderToken(tokens, idx, options)
  }
}

// URL 安全过滤已统一收口到 ./shared/html-parse.ts 的 normalizeExternalUrl。
// 这里保留薄封装以匹配本地调用习惯（按参数放行图片 base64）。
const sanitizeUrl = (value: string | null, allowImageData = false): string =>
  normalizeExternalUrl(value, allowImageData)

function getFenceLanguage(info: string): string {
  return (info || "").trim().split(/\s+/)[0] || ""
}

// ---------------------------------------------------------------------------
// 代码语法高亮（highlight.js → 内联着色，兼容公众号编辑器）
// ---------------------------------------------------------------------------

/**
 * highlight.js token 类名 → 内联颜色（atom-one-dark 风格）。
 * 公众号会过滤 <style> 和 class 关联的样式，所以必须把颜色内联到每个 span。
 */
const HLJS_TOKEN_COLORS: Record<string, string> = {
  "hljs-keyword": "#c678dd",
  "hljs-built_in": "#e6c07b",
  "hljs-type": "#e6c07b",
  "hljs-literal": "#56b6c2",
  "hljs-number": "#d19a66",
  "hljs-string": "#98c379",
  "hljs-comment": "#7f848e",
  "hljs-function": "#61afef",
  "hljs-title": "#61afef",
  "hljs-title.function_": "#61afef",
  "hljs-title.class_": "#e6c07b",
  "hljs-params": "#abb2bf",
  "hljs-attr": "#d19a66",
  "hljs-attribute": "#98c379",
  "hljs-property": "#abb2bf",
  "hljs-variable": "#e06c75",
  "hljs-variable.language_": "#e06c75",
  "hljs-symbol": "#56b6c2",
  "hljs-regexp": "#98c379",
  "hljs-meta": "#abb2bf",
  "hljs-meta.prompt_": "#abb2bf",
  "hljs-tag": "#e06c75",
  "hljs-name": "#e06c75",
  "hljs-selector-attr": "#d19a66",
  "hljs-selector-class": "#d19a66",
  "hljs-selector-id": "#d19a66",
  "hljs-selector-tag": "#e06c75",
  "hljs-deletion": "#e06c75",
  "hljs-addition": "#98c379",
  "hljs-template-variable": "#e06c75",
  "hljs-template-tag": "#c678dd",
  "hljs-link": "#61afef",
  "hljs-emphasis": "italic",
  "hljs-strong": "bold",
  "hljs-bullet": "#d19a66",
  "hljs-quote": "#7f848e",
  "hljs-doctag": "#c678dd",
  "hljs-formula": "#56b6c2",
  "hljs-punctuation": "#abb2bf",
  "hljs-subst": "#abb2bf",
  "hljs-operator": "#56b6c2",
}

/** hljs 语言别名归一化（补全常见简写） */
function normalizeHljsLanguage(lang: string): string {
  const lower = lang.toLowerCase()
  const aliasMap: Record<string, string> = {
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    ts: "typescript",
    js: "javascript",
    py: "python",
    yml: "yaml",
    "c++": "cpp",
    "golang": "go",
    "objective-c": "objectivec",
  }
  return aliasMap[lower] || lang
}

/**
 * 用 highlight.js 高亮代码，并把 hljs-xxx class 转成内联 color style，
 * 使其在公众号编辑器（过滤 <style>/class 样式）中仍能正确着色。
 */
function highlightCodeToInline(code: string, lang: string): string {
  const normalizedLang = normalizeHljsLanguage(lang)
  let highlighted: string
  try {
    if (normalizedLang && hljs.getLanguage(normalizedLang)) {
      highlighted = hljs.highlight(code, { language: normalizedLang, ignoreIllegals: true }).value
    } else {
      highlighted = hljs.highlightAuto(code).value
    }
  } catch {
    return escapeHtml(code)
  }

  // 把 <span class="hljs-keyword"> 替换成 <span style="color:#xxx">
  // 同时支持复合 class（如 "hljs-title function_"，hljs 内部用空格分隔多 token）
  return highlighted.replace(
    /<span class="([^"]*)">/g,
    (_full, classNames: string) => {
      const tokens = classNames.split(/\s+/).filter(Boolean)
      const styles: string[] = []
      for (const token of tokens) {
        const key = token.startsWith("hljs-") ? token : `hljs-${token}`
        const color = HLJS_TOKEN_COLORS[key]
        if (!color) continue
        if (color === "italic" || color === "bold") {
          styles.push(`font-style:italic;font-weight:600`)
        } else {
          styles.push(`color:${color}`)
        }
      }
      return styles.length > 0 ? `<span style="${styles.join(";")}">` : "<span>"
    }
  )
}

function renderCodeBlock(
  token: MarkdownToken,
  styles: Record<WechatElementStyle, string>
): string {
  const lang = getFenceLanguage(token.info)
  const langLabel = lang
    ? `<div style="color: rgba(255,255,255,0.58); font-size: 12px; margin-bottom: 8px;">${escapeHtml(lang)}</div>`
    : ""
  const codeStyle = styleAttr(
    styles,
    "code",
    "background: transparent !important; color: #abb2bf !important; padding: 0; border: none; white-space: pre-wrap; display: block;"
  )
  // 代码高亮：识别语言后用 hljs 着色并内联颜色；无语言时 highlightAuto 兜底
  const highlighted = highlightCodeToInline(token.content, lang)

  return `<pre style="${escapeAttr(styleAttr(styles, "pre"))}">${langLabel}<code style="${escapeAttr(codeStyle)}">${highlighted}</code></pre>\n`
}

function createWechatMarkdownParser(
  styles: Record<WechatElementStyle, string>,
  mermaidCollector: string[]
): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  })
  // 数学公式：接入 KaTeX。renderToString 产出的 HTML 已高度内联样式，
  // 但需补充 KaTeX 字体族（公众号无法加载外部字体，用系统数学字体兜底）。
  md.use(katexPlugin, { throwOnError: false })
  const rules = md.renderer.rules

  rules.paragraph_open = renderStyledToken(styles, "p")
  rules.heading_open = (tokens, idx, options, _env, self) => {
    const tag = tokens[idx].tag
    const key = /^h[1-6]$/.test(tag) ? (tag as WechatElementStyle) : "h2"
    mergeTokenStyle(tokens[idx], styles, key)
    return self.renderToken(tokens, idx, options)
  }
  rules.blockquote_open = renderStyledToken(styles, "blockquote")
  rules.bullet_list_open = renderStyledToken(styles, "ul")
  rules.ordered_list_open = renderStyledToken(styles, "ol")
  rules.list_item_open = renderStyledToken(styles, "li")
  rules.table_open = renderStyledToken(styles, "table")
  rules.tr_open = renderStyledToken(styles, "tr")
  rules.th_open = renderStyledToken(styles, "th")
  rules.td_open = renderStyledToken(styles, "td")
  rules.strong_open = renderStyledToken(styles, "strong")
  rules.em_open = renderStyledToken(styles, "em")
  rules.hr = (tokens, idx, options, _env, self) => {
    mergeTokenStyle(tokens[idx], styles, "hr")
    return self.renderToken(tokens, idx, options)
  }

  rules.code_inline = (tokens, idx) =>
    `<code style="${escapeAttr(styleAttr(styles, "code"))}">${escapeHtml(tokens[idx].content)}</code>`
  rules.code_block = (tokens, idx) => renderCodeBlock(tokens[idx], styles)
  // mermaid 代码块用占位标记，由 buildWechatArticle 异步阶段替换为内联 SVG；
  // 其余语言走 highlight.js 高亮。mermaid 源码通过 collector 回调收集。
  rules.fence = (tokens, idx) => {
    const lang = getFenceLanguage(tokens[idx].info)
    if (lang === "mermaid") {
      const slotIndex = mermaidCollector.length
      mermaidCollector.push(tokens[idx].content)
      return `<div data-lingmo-mermaid-slot="${slotIndex}" style="text-align:center; margin:16px 0;"></div>\n`
    }
    return renderCodeBlock(tokens[idx], styles)
  }

  rules.link_open = (tokens, idx, options, _env, self) => {
    const href = sanitizeUrl(tokens[idx].attrGet("href"))
    if (href) {
      tokens[idx].attrSet("href", href)
    } else {
      tokens[idx].attrSet("href", "#")
    }
    tokens[idx].attrSet("target", "_blank")
    tokens[idx].attrSet("rel", "noreferrer")
    mergeTokenStyle(tokens[idx], styles, "a")
    return self.renderToken(tokens, idx, options)
  }

  rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = sanitizeUrl(token.attrGet("src"), true)
    if (!src) return ""

    const alt = token.children ? self.renderInlineAsText(token.children, options, env) : token.attrGet("alt") || ""
    const title = token.attrGet("title")
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ""
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr} style="${escapeAttr(styleAttr(styles, "img"))}">`
  }

  rules.hardbreak = () => "<br>\n"
  rules.softbreak = () => "<br>\n"
  rules.html_block = (tokens, idx) => escapeHtml(tokens[idx].content)
  rules.html_inline = (tokens, idx) => escapeHtml(tokens[idx].content)

  return md
}

export function renderWechatMarkdown({ markdown, styles }: RenderWechatMarkdownOptions): string {
  return renderWechatMarkdownWithMermaid({ markdown, styles }).html
}

/**
 * 渲染微信图文 HTML，同时返回收集到的 mermaid 代码块源码。
 * mermaid 代码块在同步阶段只输出占位标记（data-lingmo-mermaid-slot="N"），
 * 由 buildWechatArticle 的异步阶段调用 mermaid.render 替换为内联 SVG。
 */
export function renderWechatMarkdownWithMermaid(
  { markdown, styles }: RenderWechatMarkdownOptions
): { html: string; mermaidSources: string[] } {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return { html: "", mermaidSources: [] }

  const mermaidSources: string[] = []
  const html = createWechatMarkdownParser(styles, mermaidSources).render(normalized).trim()

  // KaTeX 后处理：公众号无法加载 katex.css 的字体定义，给 .katex / .katex-display
  // 容器补充内联 font-family（用系统衬线 + Cambria Math 兜底数学符号）。
  // KaTeX 的 renderToString 已内联了字符 metrics，字体兜底后基本可正常显示。
  const finalized = html.includes("katex")
    ? html
        .replace(/<span class="katex-display">/g, '<span class="katex-display" style="display:block; margin:16px 0; text-align:center;">')
        .replace(/<span class="katex">/g, '<span class="katex" style="font-family: Cambria Math, \'Latin Modern Math\', \'Apple Math\', STIXTwoMath, serif; font-size:1.1em;">')
    : html

  return { html: finalized, mermaidSources }
}
