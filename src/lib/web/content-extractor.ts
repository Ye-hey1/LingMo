import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export interface ParsedWebPageContent {
  title: string
  metaDesc: string
  mainContent: string
  bodyText: string
  url: string
}

export interface ReadableWebMarkdownInput {
  title: string
  url: string
  metaDesc?: string
  content: string
}

const NOISY_SELECTOR = [
  "script",
  "style",
  "noscript",
  "link",
  "meta",
  "svg",
  "canvas",
  "iframe",
  "embed",
  "object",
  "picture",
  "video",
  "audio",
  "source",
  "track",
  "form",
  "button",
  "input",
  "select",
  "option",
  "textarea",
  "datalist",
  "fieldset",
  "legend",
  "label",
  "progress",
  "meter",
  "header",
  "nav",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[role='search']",
  "[aria-hidden='true']",
  "[hidden]",
  "[data-testid*='cookie' i]",
  "[class*='cookie' i]",
  "[id*='cookie' i]",
  "[class*='banner' i]",
  "[id*='banner' i]",
  "[class*='breadcrumb' i]",
  "[id*='breadcrumb' i]",
  "[class*='sidebar' i]",
  "[id*='sidebar' i]",
  "[class*='toolbar' i]",
  "[id*='toolbar' i]",
  "[class*='share' i]",
  "[id*='share' i]",
  "[class*='social' i]",
  "[id*='social' i]",
  "[class*='related' i]",
  "[id*='related' i]",
  "[class*='recommend' i]",
  "[id*='recommend' i]",
  "[class*='advert' i]",
  "[id*='advert' i]",
  "[class*='ads' i]",
  "[id*='ads' i]",
  "[class*='modal' i]",
  "[id*='modal' i]",
  "[class*='dialog' i]",
  "[id*='dialog' i]",
  "[class*='popup' i]",
  "[id*='popup' i]",
  "[class*='login' i]",
  "[id*='login' i]",
  "[class*='signup' i]",
  "[id*='signup' i]",
  "[class*='newsletter' i]",
  "[id*='newsletter' i]",
  "[class*='pagination' i]",
  "[id*='pagination' i]",
  "[class*='pager' i]",
  "[id*='pager' i]",
  ".topic-timeline",
  ".timeline-container",
  ".topic-map",
  ".topic-status-info",
  ".post-menu-area",
  ".post-controls",
  ".post-links-container",
  ".post-notice",
  ".topic-footer-main-buttons",
  ".suggested-topics",
  ".more-topics",
  ".topic-navigation",
  ".topic-progress",
  ".topic-admin-menu",
  ".small-action",
  ".gap",
  ".loading-container",
  ".select-kit",
  ".user-card",
].join(",")

const FORUM_NOISE_NODE_SELECTOR = [
  ".post-info",
  ".topic-meta-data",
  ".topic-avatar",
  ".avatar-flair",
  ".names",
  ".post-infos",
  ".post-date",
  ".relative-date",
  ".read-state",
  ".topic-post-badges",
  ".crawler-post-meta",
  ".poster-avatar",
  ".topic-post.clearfix > .topic-avatar",
  ".topic-post.clearfix > .topic-meta-data",
].join(",")

const CONTENT_CANDIDATE_SELECTOR = [
  "article",
  "[role='article']",
  "main",
  "[role='main']",
  ".post-stream .topic-post:first-of-type .cooked",
  ".topic-post:first-of-type .cooked",
  ".topic-body:first-of-type .cooked",
  ".topic-body:first-of-type",
  ".post:first-of-type .post-content",
  ".post:first-of-type",
  ".article",
  ".article-content",
  ".article-body",
  ".entry-content",
  ".post-content",
  ".content",
  "#content",
  ".main-content",
  "#main",
].join(",")

const FOCUSED_CONTENT_SELECTOR = [
  ".post-stream .topic-post:first-of-type .cooked",
  ".topic-post:first-of-type .cooked",
  ".topic-body:first-of-type .cooked",
  ".article-content",
  ".article-body",
  ".entry-content",
  ".post-content",
].join(",")

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
})

function normalizeText(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, "\"")
}

function removeComments(doc: Document) {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  while (walker.nextNode()) {
    comments.push(walker.currentNode as Comment)
  }
  comments.forEach(comment => comment.remove())
}

function clearAttributes(doc: Document) {
  doc.querySelectorAll("*").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.removeAttribute("style")
      node.removeAttribute("class")
      node.removeAttribute("id")
      node.removeAttribute("onclick")
      node.removeAttribute("onmouseover")
      node.removeAttribute("onmouseout")
    }
  })
}

function stripTinyMetadataNodes(doc: Document) {
  doc.querySelectorAll(FORUM_NOISE_NODE_SELECTOR).forEach(node => node.remove())
}

function cleanImages(doc: Document) {
  doc.querySelectorAll("img").forEach((img) => {
    const alt = normalizeText(img.getAttribute("alt") || "")
    const title = normalizeText(img.getAttribute("title") || "")
    const src = img.getAttribute("src") || ""
    const replacementText = alt || title
    if (!replacementText || /^data:/i.test(src)) {
      img.remove()
      return
    }
    img.replaceWith(doc.createTextNode(`[图片：${replacementText.slice(0, 120)}]`))
  })
}

function removeNoisyNodes(doc: Document, options: { clearAttrs?: boolean } = {}) {
  removeComments(doc)
  doc.querySelectorAll(NOISY_SELECTOR).forEach(node => node.remove())
  stripTinyMetadataNodes(doc)
  cleanImages(doc)
  if (options.clearAttrs) {
    clearAttributes(doc)
  }
}

function getNodeText(node: Element): string {
  return normalizeText(node.textContent || "")
}

function getNoisePenalty(node: Element): number {
  const value = `${node.tagName} ${node.id || ""} ${node.className || ""} ${node.getAttribute("role") || ""}`.toLowerCase()
  let penalty = 0
  if (/(comment|reply|responses|discussion|forum|timeline|pagination|pager|sidebar|nav|footer|share|social|related|recommend|advert|toolbar|menu)/.test(value)) {
    penalty += 240
  }
  if (/(post-stream|posts|topic-post|post-list)/.test(value)) {
    penalty += 120
  }
  return penalty
}

function scoreContentCandidate(node: Element): number {
  const text = getNodeText(node)
  const textLength = text.replace(/\s/g, "").length
  if (textLength < 80) {
    return 0
  }

  const paragraphCount = node.querySelectorAll("p, li, blockquote, pre").length
  const headingCount = node.querySelectorAll("h1, h2, h3").length
  const linkTextLength = Array.from(node.querySelectorAll("a"))
    .reduce((sum, link) => sum + getNodeText(link).length, 0)
  const linkDensity = linkTextLength / Math.max(text.length, 1)
  const firstPostBonus = node.matches(".post-stream .topic-post:first-of-type .cooked, .topic-post:first-of-type .cooked, .topic-body:first-of-type .cooked")
    ? 650
    : 0
  const semanticBonus = node.matches("article, [role='article'], main, [role='main']")
    ? 180
    : 0

  return textLength
    + paragraphCount * 45
    + headingCount * 80
    + firstPostBonus
    + semanticBonus
    - linkDensity * 500
    - getNoisePenalty(node)
}

function cloneDocument(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

function selectReadableHtml(doc: Document, originalHtml: string): string {
  const readabilityDoc = cloneDocument(originalHtml)
  removeNoisyNodes(readabilityDoc)
  const article = new Readability(readabilityDoc).parse()

  const candidates = Array.from(doc.querySelectorAll(CONTENT_CANDIDATE_SELECTOR))
    .map(node => ({
      node,
      score: scoreContentCandidate(node),
    }))
    .sort((a, b) => b.score - a.score)

  const bestCandidate = candidates[0]
  const focusedCandidate = candidates.find(candidate => candidate.node.matches(FOCUSED_CONTENT_SELECTOR))
  const bestHtml = bestCandidate && bestCandidate.score > 0
    ? bestCandidate.node.innerHTML
    : ""
  const focusedHtml = focusedCandidate && focusedCandidate.score > 0
    ? focusedCandidate.node.innerHTML
    : ""
  const articleHtml = article?.content || ""
  const articleTextLength = normalizeText(article?.textContent || "").replace(/\s/g, "").length
  const bestTextLength = bestCandidate
    ? getNodeText(bestCandidate.node).replace(/\s/g, "").length
    : 0

  if (focusedHtml && (focusedCandidate?.score || 0) >= 650) {
    return focusedHtml
  }

  if (articleHtml && articleTextLength >= Math.max(160, bestTextLength * 0.65)) {
    return articleHtml
  }

  return bestHtml || doc.body?.innerHTML || originalHtml
}

function isMetadataLine(line: string): boolean {
  const trimmed = line.trim()
  const plain = trimmed
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\[[^\]]+]\([^)]+\)$/, match => match.slice(1, match.indexOf("]")))
    .trim()

  if (!plain) {
    return false
  }

  const compact = plain.replace(/\s+/g, " ")
  const lower = compact.toLowerCase()

  if (/^(skip to content|sign in|sign up|log in|login|subscribe|menu|search|close|open|share|copy link|back to top)$/i.test(compact)) {
    return true
  }
  if (/^(select all|cancel selecting|you have selected \d+ posts?\.?)$/i.test(compact)) {
    return true
  }
  if (/^\d+\s*\/\s*\d+$/.test(compact)) {
    return true
  }
  if (/^(?:read\s*)?\d+\s*min(?:ute)?s?(?:\s*read)?$/i.test(compact)) {
    return true
  }
  if (/^\d+(?:\.\d+)?k?\s+views?\s+\d+(?:\.\d+)?k?\s+likes?(?:\s+\d+\s+links?)?(?:\s+\d+\s+users?)?$/i.test(compact)) {
    return true
  }
  if (/^post by .+?(?:\d+\s*(?:seconds?|minutes?|hours?|days?|secs?|mins?|hrs?|s|m|h|d)\s+ago|\d+[smhd]|just now)$/i.test(compact)) {
    return true
  }
  if (/^(?:posted|created|updated)\s+by\s+.+$/i.test(compact)) {
    return true
  }
  if (/^(?:\d+[smhd]|just now|\d+\s*(?:seconds?|minutes?|hours?|days?|secs?|mins?|hrs?)\s+ago)$/i.test(compact)) {
    return true
  }
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:,\s*\d{4})?$/i.test(compact)) {
    return true
  }
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(compact)) {
    return true
  }
  if (/^\d+\s*(?:replies|views|likes|users|links|bookmarks|minutes?)$/i.test(compact)) {
    return true
  }
  if (/^(?:reply|replies|like|likes|views|users|links|bookmarks|solved|hidden|show replies)$/i.test(compact)) {
    return true
  }
  if (/^@[a-z0-9_.-]+$/i.test(compact)) {
    return true
  }

  const isReactionOnly = compact.length <= 18 && /^(?:强强|太棒了|收藏了|干货帖|nice+!+|赞|谢谢|学习了|mark|插眼|顶|牛)$/i.test(compact)
  if (isReactionOnly) {
    return true
  }

  return lower.includes("you have selected") && lower.includes("posts")
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/\[([^\]]+)]\((?:javascript:void\(0\)|#|\/login[^)]*|\/signup[^)]*)\)/gi, "$1")
    .replace(/\[\s*]\([^)]*\)/g, "")
    .replace(/[ \t]+$/g, "")
}

export function formatExtractedWebMarkdown(markdown: string): string {
  const withoutImages = markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/\[(?:image|图片|logo|icon|avatar|screenshot)[^\]]*]\([^)]*\)/gi, "")

  const lines = normalizeText(withoutImages)
    .split("\n")
    .map(cleanMarkdownLine)

  const result: string[] = []
  const seenPlainLines = new Map<string, number>()
  let blankPending = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      blankPending = result.length > 0
      continue
    }
    if (isMetadataLine(line)) {
      continue
    }

    const plainKey = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()

    const previousCount = seenPlainLines.get(plainKey) || 0
    if (previousCount > 0 && (plainKey.length < 48 || previousCount >= 2)) {
      continue
    }
    seenPlainLines.set(plainKey, previousCount + 1)

    if (blankPending && result[result.length - 1] !== "") {
      result.push("")
    }
    result.push(line)
    blankPending = false
  }

  return result.join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:^|\n)(#{1,6})([^\s#])/g, "\n$1 $2")
    .replace(/^\n+/, "")
    .trim()
}

function normalizeMarkdown(markdown: string): string {
  return formatExtractedWebMarkdown(markdown)
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function looksLikeHtml(value: string): boolean {
  return /<html|<body|<div|<p|<article|<section|<main/i.test(value)
}

export function htmlToMarkdown(html: string): string {
  try {
    const doc = cloneDocument(html)
    removeNoisyNodes(doc)
    const contentHtml = selectReadableHtml(doc, html)
    const contentDoc = cloneDocument(contentHtml)
    removeNoisyNodes(contentDoc, { clearAttrs: true })
    const markdown = turndown.turndown(contentDoc.body?.innerHTML || contentHtml)
    return normalizeMarkdown(markdown)
  } catch {
    return normalizeMarkdown(
      collapseWhitespace(
        decodeHtmlEntities(
          html
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
            .replace(/<nav[\s\S]*?>[\s\S]*?<\/nav>/gi, " ")
            .replace(/<footer[\s\S]*?>[\s\S]*?<\/footer>/gi, " ")
            .replace(/<aside[\s\S]*?>[\s\S]*?<\/aside>/gi, " ")
            .replace(/<[^>]+>/g, " ")
        )
      )
    )
  }
}

export function normalizeWebContent(raw: string): string {
  if (!raw.trim()) {
    return ""
  }

  return looksLikeHtml(raw) ? htmlToMarkdown(raw) : normalizeMarkdown(raw)
}

export function buildReadableWebMarkdown(input: ReadableWebMarkdownInput): string {
  const title = normalizeText(input.title || "")
  const url = normalizeText(input.url || "")
  const metaDesc = normalizeText(input.metaDesc || "")
  let content = normalizeWebContent(input.content || "")
  if (title && content) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    content = content
      .replace(new RegExp(`^#\\s+${escapedTitle}\\s*(?:\\n+|$)`, "i"), "")
      .trim()
  }
  const sections: string[] = []

  if (title) {
    sections.push(`# ${title}`, "")
  }
  if (url || metaDesc) {
    if (url) {
      sections.push(`> 来源：${url}`)
    }
    if (metaDesc) {
      sections.push(`> 摘要：${metaDesc}`)
    }
    sections.push("")
  }

  sections.push("## 正文", "", content || "未提取到可用正文。")

  return normalizeText(sections.join("\n"))
}

export function parseWebPageContent(
  html: string,
  url: string,
  maxMainChars = 10000,
  maxBodyChars = 10000
): ParsedWebPageContent {
  const parsedUrl = new URL(url)
  const doc = cloneDocument(html)
  const title = normalizeText(doc.title || parsedUrl.hostname)
  const metaDesc = normalizeText(
    doc.querySelector("meta[name='description']")?.getAttribute("content")
      || doc.querySelector("meta[property='og:description']")?.getAttribute("content")
      || ""
  )
  removeNoisyNodes(doc)

  const mainContent = htmlToMarkdown(doc.documentElement?.outerHTML || html)
  const bodyText = formatExtractedWebMarkdown(normalizeText(doc.body?.textContent || ""))

  return {
    title,
    metaDesc,
    mainContent: mainContent.slice(0, maxMainChars),
    bodyText: bodyText.slice(0, maxBodyChars),
    url,
  }
}
