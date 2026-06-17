import { normalizeOutputWorkshopHtml } from "@/lib/output-workshop/html-normalizer"

export function cleanStreamingHtml(text: string): string {
  let cleaned = text.trim()

  cleaned = cleaned
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")

  // 1. 优先尝试匹配 fenced code block 内部的网页代码或样式片段
  const markdownCodeBlockRegex = /```(?:html|htm|css)?\s*([\s\S]*?)(?:```|$)/i
  const match = cleaned.match(markdownCodeBlockRegex)
  if (match && match[1]) {
    return match[1].trim()
  }

  // 2. 如果未被代码块包裹，但找到了完整文档或常见 HTML 片段起点
  const htmlStartRegex = /(<!DOCTYPE html>|<html[\s\S]*?>|<head[\s\S]*?>|<body[\s\S]*?>|<style[\s\S]*?>|<main[\s\S]*?>|<section[\s\S]*?>|<article[\s\S]*?>|<div[\s\S]*?>)/i
  const startMatch = cleaned.match(htmlStartRegex)
  if (startMatch) {
    const startIndex = cleaned.indexOf(startMatch[1])
    if (startIndex !== -1) {
      let htmlContent = cleaned.slice(startIndex)
      const endIndex = htmlContent.toLowerCase().lastIndexOf("</html>")
      if (endIndex !== -1) {
        htmlContent = htmlContent.slice(0, endIndex + 7)
      }
      return htmlContent.trim()
    }
  }

  // 3. 后备选择
  cleaned = cleaned.replace(/^```html\s*/i, "")
  cleaned = cleaned.replace(/^```\s*/, "")
  cleaned = cleaned.replace(/```\s*$/, "")
  return cleaned.trim()
}

/**
 * 自动修复大模型流式输出被截断时的 HTML 代码
 */
export function repairTruncatedHtml(html: string): string {
  if (!html) return ""

  if (html.toLowerCase().includes("</html>") && html.toLowerCase().includes("</body>")) {
    return html
  }

  const lastGreaterThan = html.lastIndexOf(">")
  let cutHtml = html
  if (lastGreaterThan !== -1) {
    cutHtml = html.substring(0, lastGreaterThan + 1)
  }

  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"
  ])

  const stack: string[] = []
  const tagRegex = /<(?:\/([a-zA-Z0-9]+)|([a-zA-Z0-9]+)(?:\s+[^>]*)?(\/)?|!--[\s\S]*?--|!DOCTYPE[^>]*?)>/g

  let match
  while ((match = tagRegex.exec(cutHtml)) !== null) {
    const closeTagName = match[1]
    const openTagName = match[2]
    const isSelfClosing = !!match[3]

    if (closeTagName) {
      const lowerClose = closeTagName.toLowerCase()
      const idx = stack.lastIndexOf(lowerClose)
      if (idx !== -1) {
        stack.splice(idx)
      }
    } else if (openTagName) {
      const lowerOpen = openTagName.toLowerCase()
      if (!voidElements.has(lowerOpen) && !isSelfClosing) {
        stack.push(lowerOpen)
      }
    }
  }

  const scriptIdx = stack.lastIndexOf("script")
  if (scriptIdx !== -1) {
    const lastScriptStart = cutHtml.toLowerCase().lastIndexOf("<script")
    if (lastScriptStart !== -1) {
      cutHtml = cutHtml.substring(0, lastScriptStart)
    }
    stack.splice(scriptIdx)
  }

  let repaired = cutHtml
  while (stack.length > 0) {
    const tag = stack.pop()
    if (tag) {
      repaired += `</${tag}>`
    }
  }

  const lowerRep = repaired.toLowerCase()
  if (!lowerRep.includes("</body>")) {
    repaired += "</body>"
  }
  if (!lowerRep.includes("</html>")) {
    repaired += "</html>"
  }

  return repaired
}

export function prepareOutputHtml(text: string): string {
  const cleaned = cleanStreamingHtml(text)
  if (!cleaned) return ""
  return repairTruncatedHtml(normalizeOutputWorkshopHtml(cleaned))
}

// ---------------------------------------------------------------------------
// 模板预览
// ---------------------------------------------------------------------------
