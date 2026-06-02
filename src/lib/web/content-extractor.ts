import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export interface ParsedWebPageContent {
  title: string
  metaDesc: string
  mainContent: string
  bodyText: string
  url: string
}

const NOISY_SELECTOR = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "picture",
  "video",
  "audio",
  "form",
  "nav",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[aria-hidden='true']",
].join(",")

function removeNoisyNodes(doc: Document) {
  doc.querySelectorAll(NOISY_SELECTOR).forEach(node => node.remove())
  doc.querySelectorAll("img").forEach((img) => {
    const alt = normalizeText(img.getAttribute("alt") || "")
    const title = normalizeText(img.getAttribute("title") || "")
    const replacementText = alt || title
    if (!replacementText) {
      img.remove()
      return
    }
    img.replaceWith(doc.createTextNode(`[图片：${replacementText.slice(0, 120)}]`))
  })
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function normalizeMarkdown(markdown: string): string {
  return normalizeText(markdown)
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/\[(?:image|图片|logo|icon|avatar|screenshot)[^\]]*]\([^)]*\)/gi, "")
    .replace(/^\s*(?:Skip to content|Sign in|Sign up|Log in|Subscribe)\s*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function looksLikeHtml(value: string): boolean {
  return /<html|<body|<div|<p|<article|<section/i.test(value)
}

export function htmlToMarkdown(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html")
    removeNoisyNodes(doc)
    const reader = new Readability(doc)
    const article = reader.parse()
    const contentHtml = article?.content || doc.body?.innerHTML || html

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })

    const markdown = turndown.turndown(contentHtml)
    return normalizeMarkdown(markdown)
  } catch {
    return collapseWhitespace(
      html
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/gi, "\"")
    )
  }
}

export function normalizeWebContent(raw: string): string {
  if (!raw.trim()) {
    return ""
  }

  return looksLikeHtml(raw) ? htmlToMarkdown(raw) : normalizeMarkdown(raw)
}

export function parseWebPageContent(
  html: string,
  url: string,
  maxMainChars = 10000,
  maxBodyChars = 10000
): ParsedWebPageContent {
  const parsedUrl = new URL(url)
  const doc = new DOMParser().parseFromString(html, "text/html")
  removeNoisyNodes(doc)
  const title = normalizeText(doc.title || parsedUrl.hostname)
  const metaDesc = normalizeText(
    doc.querySelector("meta[name='description']")?.getAttribute("content")
      || doc.querySelector("meta[property='og:description']")?.getAttribute("content")
      || ""
  )

  const mainContent = normalizeWebContent(doc.body?.innerHTML || html)
  const bodyText = normalizeText(doc.body?.textContent || "")

  return {
    title,
    metaDesc,
    mainContent: mainContent.slice(0, maxMainChars),
    bodyText: bodyText.slice(0, maxBodyChars),
    url,
  }
}
