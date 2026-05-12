import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export interface ParsedWebPageContent {
  title: string
  metaDesc: string
  mainContent: string
  bodyText: string
  url: string
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

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function looksLikeHtml(value: string): boolean {
  return /<html|<body|<div|<p|<article|<section/i.test(value)
}

export function htmlToMarkdown(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html")
    const reader = new Readability(doc)
    const article = reader.parse()
    const contentHtml = article?.content || doc.body?.innerHTML || html

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })

    const markdown = turndown.turndown(contentHtml)
    return markdown.replace(/\n{3,}/g, "\n\n").trim()
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

  return looksLikeHtml(raw) ? htmlToMarkdown(raw) : raw.trim()
}

export function parseWebPageContent(
  html: string,
  url: string,
  maxMainChars = 10000,
  maxBodyChars = 10000
): ParsedWebPageContent {
  const parsedUrl = new URL(url)
  const doc = new DOMParser().parseFromString(html, "text/html")
  const title = normalizeText(doc.title || parsedUrl.hostname)
  const metaDesc = normalizeText(
    doc.querySelector("meta[name='description']")?.getAttribute("content")
      || doc.querySelector("meta[property='og:description']")?.getAttribute("content")
      || ""
  )

  const mainContent = normalizeText(htmlToMarkdown(html))
  const bodyText = normalizeText(doc.body?.textContent || "")

  return {
    title,
    metaDesc,
    mainContent: mainContent.slice(0, maxMainChars),
    bodyText: bodyText.slice(0, maxBodyChars),
    url,
  }
}
