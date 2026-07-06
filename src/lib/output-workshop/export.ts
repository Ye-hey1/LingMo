/**
 * LingMo 智能排版物理导出与格式转换工具
 * 借鉴并优化自 html-anything 的导出系统，适配 Tauri 桌面端与 Web 浏览器双模式运行环境
 */

import { domToBlob } from "modern-screenshot"
import juice from "juice"
import { escapeHtml } from "./shared/escape"
import {
  pick,
  extractAttr,
  stripTags,
  normalizeExternalUrl,
} from "./shared/html-parse"
import type { ExportResult } from "./shared/types"
import { isTauri } from "./shared/runtime"
import { downloadBlob, getExtension, getMimeFilter, saveBlobAs } from "./shared/file-save"
import {
  nextFrame,
  sleep,
  createOffscreenIframe,
  waitForDocumentResources,
} from "./shared/offscreen-render"
import { logWarn } from "./shared/log"
import { buildSlideStandaloneCss } from "./shared/card-styles"

// ---------------------------------------------------------------------------
// 1. 类型定义与结构体
// ---------------------------------------------------------------------------

export type DeckSlide = {
  /** 单个 Slide 的完整自包含 HTML 文档（已注入 Head 和局部的独立 body 样式） */
  html: string
  /** 演讲备注文本，用于 PPTX 备注写入 */
  notes: string
  /** 幻灯片 ID */
  id: string
  /** 幻灯片的背景色 */
  bg?: string
  /** 幻灯片的主标题，用于侧边大纲预览显示 */
  title: string
}

export type DeckParsed = {
  /** 是否为多页幻灯片或连排卡片 */
  isDeck: boolean
  /** 解析出的单页 Slide 列表 */
  slides: DeckSlide[]
  /** 原始文档的 <head> 片段，用以还原字体和 Tailwind 样式 */
  head: string
  /** 原始 <body> 标签上的 class 属性 */
  bodyClass: string
  /** 原始 <body> 标签上的 style 属性 */
  bodyStyle: string
  /** 整个文档的主标题，用作导出的默认文件名 */
  title: string
}

// ExportResult / SmartCardExportSkip 已统一下沉到 ./shared/types.ts，
// 这里 re-export 以保持对外导入路径 `@/lib/output-workshop/export` 不变。
export type { ExportResult, SmartCardExportSkip } from "./shared/types"

// ---------------------------------------------------------------------------
// 2. 幻灯片/多卡片解析器 (Deck Parser)
// ---------------------------------------------------------------------------

// 兼容 section 和 div 标签的 slide 正则
const SLIDE_RE = /<(section|div)\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi

/**
 * 判断 HTML 内容是否看起来是一个幻灯片（含有一个或多个 .slide 元素）
 */
export function isDeck(html: string): boolean {
  if (!html) return false
  SLIDE_RE.lastIndex = 0
  return SLIDE_RE.test(html)
}

// 注：pick / extractAttr / decodeEntities / stripTags / URL 过滤已统一收口到
// ./shared/html-parse.ts，本文件按需 import。

/**
 * 将整篇 HTML 文档解析为单页幻灯片 (DeckParsed)
 */
export function parseDeck(fullHtml: string): DeckParsed {
  const empty: DeckParsed = {
    isDeck: false,
    slides: [],
    head: "",
    bodyClass: "",
    bodyStyle: "",
    title: "lingmo-deck",
  }
  if (!isDeck(fullHtml)) return empty

  const head = pick(/<head\b[^>]*>([\s\S]*?)<\/head>/i, fullHtml)
  const bodyTag = pick(/<body\b([^>]*)>/i, fullHtml)
  const bodyClass = extractAttr(bodyTag, "class")
  const bodyStyle = extractAttr(bodyTag, "style")
  const title = stripTags(pick(/<title\b[^>]*>([\s\S]*?)<\/title>/i, head)) || "lingmo-deck"

  const slides: DeckSlide[] = []
  SLIDE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let idx = 0

  while ((m = SLIDE_RE.exec(fullHtml))) {
    idx += 1
    const wholeTag = m[0]
    const tagContent = m[2]
    const openTag = pick(/<[a-z0-9]+\b[^>]*>/i, wholeTag)
    const dataId = extractAttr(openTag, "data-slide-id")
    const inlineStyle = extractAttr(openTag, "style")
    const bg = pick(/background(?:-color)?\s*:\s*([^;"']+)/i, inlineStyle).trim() || undefined

    // 提取幻灯片里的 h2 标题或前几句文字作为缩略图标题
    let slideTitle = `第 ${idx} 页`
    const titleMatch = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(tagContent)
    if (titleMatch) {
      slideTitle = stripTags(titleMatch[1]).slice(0, 15) || slideTitle
    } else {
      const pMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(tagContent)
      if (pMatch) {
        slideTitle = stripTags(pMatch[1]).slice(0, 12) + "..."
      }
    }

    // 提取演讲者备注 (Aside notes) - 在单页渲染时剥除，仅作数据留存
    let notes = ""
    const slideForRender = wholeTag.replace(
      /<aside\b[^>]*\bclass\s*=\s*["'][^"']*\bnotes\b[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i,
      (_full, inner: string) => {
        notes = stripTags(inner)
        return ""
      }
    )

    // 构建该 Slide 的独立自包含 HTML，使其可被独立渲染/截图
    const standalone =
      `<!DOCTYPE html><html><head>${head}\n` +
      `<style>\n${buildSlideStandaloneCss()}\n</style></head>` +
      `<body class="${bodyClass}" style="${bodyStyle}">${slideForRender}</body></html>`

    slides.push({
      html: standalone,
      notes,
      id: dataId || String(idx),
      bg,
      title: slideTitle,
    })
  }

  return {
    isDeck: slides.length > 0,
    slides,
    head,
    bodyClass,
    bodyStyle,
    title,
  }
}

// ---------------------------------------------------------------------------
// 3. 微信公众号/知乎样式内联转换 (WeChat & Zhihu Inline-CSS)
// ---------------------------------------------------------------------------

// 剪贴板场景一律拒绝 data:（与原 normalizeClipboardUrl 行为一致）
const normalizeClipboardUrl = (value: string | null): string => normalizeExternalUrl(value, false)

function sanitizeInlineStyle(value: string | null): string {
  return (value || "")
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule) => !/expression\s*\(|behavior\s*:|javascript\s*:|vbscript\s*:|data:text\/html/i.test(rule))
    .join("; ")
}

function appendInlineStyle(element: HTMLElement, extraStyle: string): void {
  const current = sanitizeInlineStyle(element.getAttribute("style"))
  const extra = sanitizeInlineStyle(extraStyle)
  const merged = [current, extra].filter(Boolean).join("; ")
  if (merged) element.setAttribute("style", merged)
}

function sanitizeWechatClipboardRoot(root: HTMLElement): void {
  root.querySelectorAll("script, iframe, object, embed, form, input, textarea, select, button").forEach((node) => {
    node.remove()
  })

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value

      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attr.name)
        return
      }

      if (name === "style") {
        const safeStyle = sanitizeInlineStyle(value)
        if (safeStyle) {
          element.setAttribute("style", safeStyle)
        } else {
          element.removeAttribute("style")
        }
        return
      }

      if (name === "href" || name === "src" || name === "xlink:href") {
        const safeUrl = normalizeClipboardUrl(value)
        if (safeUrl) {
          element.setAttribute(attr.name, safeUrl)
        } else {
          element.removeAttribute(attr.name)
        }
      }
    })

    if (element.tagName.toLowerCase() === "a") {
      const href = normalizeClipboardUrl(element.getAttribute("href"))
      if (href) {
        element.setAttribute("href", href)
        element.setAttribute("target", "_blank")
        element.setAttribute("rel", "noreferrer")
      } else {
        element.removeAttribute("href")
      }
    }

    if (element.tagName.toLowerCase() === "img") {
      const src = normalizeClipboardUrl(element.getAttribute("src") || element.getAttribute("data-src"))
      if (!src) {
        element.remove()
        return
      }
      element.setAttribute("src", src)
      element.setAttribute("data-src", src)
      if (!element.hasAttribute("alt")) element.setAttribute("alt", "")
      appendInlineStyle(element, "max-width: 100% !important; height: auto !important; display: block;")
    }
  })
}

export function sanitizeWechatClipboardHtml(html: string): string {
  if (typeof document === "undefined") return html

  const root = document.createElement("div")
  root.innerHTML = html
  sanitizeWechatClipboardRoot(root)
  return root.innerHTML
}

/**
 * 将整篇 HTML 中的 CSS 样式通过 juice 内联注入到各标签上，用于直接粘贴至微信公众号或知乎
 */
export function toWechatHtml(fullHtml: string): string {
  if (typeof window === "undefined") return fullHtml

  const doc = new DOMParser().parseFromString(fullHtml, "text/html")
  const styles: string[] = []

  // 收集所有 <style> 标签样式
  doc.querySelectorAll("style").forEach((s) => {
    styles.push(s.textContent ?? "")
  })
  const css = styles.join("\n")
  const bodyHtml = doc.body?.innerHTML ?? fullHtml

  // 给所有顶级子元素打上 lingmo-output 标签，保证微信粘贴的信任与解析
  const wrap = document.createElement("div")
  wrap.innerHTML = bodyHtml
  Array.from(wrap.children).forEach((child) => {
    child.setAttribute("data-tool", "lingmo-output")
  })
  const taggedHtml = wrap.innerHTML

  let inlined = taggedHtml
  try {
    inlined = juice.inlineContent(taggedHtml, css, {
      inlinePseudoElements: true,
      preserveImportant: true,
    })
  } catch (e) {
    console.error("Juice CSS 内联失败:", e)
  }

  return sanitizeWechatClipboardHtml(
    `<section data-tool="lingmo-output" style="box-sizing:border-box;">${inlined}</section>`
  )
}

// ---------------------------------------------------------------------------
// 4. 双端兼容剪贴板操作 (Cross-platform Clipboard)
// ---------------------------------------------------------------------------

// isTauri 已统一收口到 ./shared/runtime.ts，本地按需 import；这里 re-export 保持对外导入路径不变。
export { isTauri }

/**
 * 跨平台文本复制（兼容普通 Web 与 Tauri）
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (isTauri()) {
    try {
      const { writeText } = await import("tauri-plugin-clipboard-api")
      await writeText(text)
      return
    } catch (e) {
      console.warn("Tauri 剪贴板复制文字失败，降级使用 Web API:", e)
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // 终极 fallback：Safari/旧浏览器复制
  const input = document.createElement("textarea")
  input.value = text
  input.style.position = "fixed"
  input.style.opacity = "0"
  document.body.appendChild(input)
  input.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(input)
  }
}

/**
 * 跨平台富文本 HTML 复制
 */
export async function copyHtmlToClipboard(html: string, plainFallback?: string): Promise<void> {
  const fallback = plainFallback ?? stripTags(html)

  if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([fallback], { type: "text/plain" }),
        }),
      ])
      return
    } catch (e) {
      console.warn("ClipboardItem 写入失败，降级普通文本复制:", e)
    }
  }

  await copyTextToClipboard(html)
}

/**
 * 跨平台图片复制（将 Blob 写入系统剪贴板）
 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  // Tauri 桌面端复制图片
  if (isTauri()) {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result
          if (typeof result !== "string") {
            reject(new Error("读取图片数据失败"))
            return
          }
          const encoded = result.split(",")[1]
          if (!encoded) {
            reject(new Error("图片 Base64 数据为空"))
            return
          }
          resolve(encoded)
        }
        reader.onerror = () => {
          reject(reader.error ?? new Error("读取图片数据失败"))
        }
        reader.readAsDataURL(blob)
      })
      const { writeImageBase64 } = await import("tauri-plugin-clipboard-api")
      await writeImageBase64(base64Data)
      return
    } catch (e) {
      console.warn("Tauri 插件写入图片失败，降级使用 Web API:", e)
    }
  }

  // Web 端标准写入
  if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ])
    return
  }

  throw new Error("当前环境不支持直接复制图片到剪贴板，请尝试直接下载")
}

// ---------------------------------------------------------------------------
// 5. 网页/IFrame 截图与资源载入逻辑
// ---------------------------------------------------------------------------

// nextFrame / sleep / waitForDocumentResources / createOffscreenIframe 已统一收口到
// ./shared/offscreen-render.ts，本文件按需 import。

// 防止 iframe 拉伸到过高高度导致 GPU 纹理分配失败或内存飙升
const MAX_IFRAME_STRETCH_HEIGHT = 15000

/**
 * 解析预览 iframe 中的背景颜色
 */
function resolveBackground(doc: Document, win: Window): string {
  try {
    const bodyBg = doc.body?.style.backgroundColor
    if (bodyBg && bodyBg !== "transparent") return bodyBg

    const computedBg = win.getComputedStyle(doc.body).backgroundColor
    if (computedBg && computedBg !== "transparent" && computedBg !== "rgba(0, 0, 0, 0)") {
      return computedBg
    }
  } catch (error) {
    // 跨域 iframe 的 getComputedStyle 可能抛错，属可容忍降级，留痕便于排查
    logWarn("resolve-background", error)
  }
  return "#ffffff"
}

/**
 * 将 iframe 内的内容渲染为 PNG 图片 Blob（核心避开滚动条算法）
 */
export async function iframeToBlob(
  iframe: HTMLIFrameElement,
  scale = 2
): Promise<Blob> {
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) throw new Error("预览视口尚未准备就绪")

  // 等待所有资源准备好（默认配置与原 waitForDocumentReady 一致）
  await waitForDocumentResources(doc, win)

  // 暂存原有的 iframe 尺寸和溢出样式
  const prevIframeHeight = iframe.style.height
  const prevDocOverflow = doc.documentElement.style.overflow
  const prevBodyOverflow = doc.body.style.overflow

  // 获取真实内容高度
  const fullHeight = Math.max(
    doc.body?.scrollHeight ?? 0,
    doc.body?.offsetHeight ?? 0,
    doc.documentElement?.scrollHeight ?? 0,
    doc.documentElement?.offsetHeight ?? 0
  )

  if (!fullHeight) throw new Error("页面内容尚未渲染，无法生成截图")

  // 核心拉伸逻辑：暂时让 iframe 放大到内容大小，并允许溢出可见
  // 限制最大拉伸高度，防止超长页面导致 GPU 纹理分配失败或内存飙升
  const clampedHeight = Math.min(fullHeight, MAX_IFRAME_STRETCH_HEIGHT)
  if (fullHeight > MAX_IFRAME_STRETCH_HEIGHT) {
    console.warn(`[iframeToBlob] 内容高度 ${fullHeight}px 超出限制 ${MAX_IFRAME_STRETCH_HEIGHT}px，截图将截断`)
  }

  iframe.style.height = `${clampedHeight}px`
  doc.documentElement.style.overflow = fullHeight > MAX_IFRAME_STRETCH_HEIGHT ? "hidden" : "visible"
  doc.body.style.overflow = fullHeight > MAX_IFRAME_STRETCH_HEIGHT ? "hidden" : "visible"

  // 等待重绘
  await nextFrame()
  await sleep(50)
  await nextFrame()

  try {
    const layoutWidth = doc.documentElement.clientWidth || iframe.clientWidth || 1080
    const backgroundColor = resolveBackground(doc, win)

    const blob = await domToBlob(doc.documentElement as unknown as HTMLElement, {
      scale,
      type: "image/png",
      backgroundColor,
      width: layoutWidth,
      height: clampedHeight,
      fetch: {
        requestInit: { cache: "force-cache" },
      },
    })

    if (!blob) throw new Error("高清截图转换失败")
    return blob
  } finally {
    // 截图完成，瞬间恢复原样，用户无视觉感知
    iframe.style.height = prevIframeHeight
    doc.documentElement.style.overflow = prevDocOverflow
    doc.body.style.overflow = prevBodyOverflow
  }
}

/**
 * 从页面离屏中渲染指定的 Slide 碎片为图片
 */
async function renderSlideToBlob(slide: DeckSlide, scale = 2): Promise<Blob> {
  const handle = createOffscreenIframe(1920, 1080, slide.bg ?? "#fff")
  // 修正 slide 在离屏中不缩放而 1:1 展示的样式
  handle.iframe.srcdoc = slide.html.replace(
    /\.slide\s*\{\s*transform-origin[^}]*\}/i,
    ".slide { transform: none !important; transform-origin: top left !important; }"
  ).replace(
    /body\s*\{\s*display:flex;\s*align-items:center;\s*justify-content:center;\s*min-height:100vh;\s*\}/,
    "body { margin:0; padding:0; }"
  )

  try {
    await handle.waitForLoad(3000)
    return await iframeToBlob(handle.iframe, scale)
  } finally {
    handle.dispose()
  }
}

// ---------------------------------------------------------------------------
// 6. 文件下载/大纲物理导出
// ---------------------------------------------------------------------------

// downloadBlob / getExtension / getMimeFilter / saveBlobAs 本地按需 import（见顶部），
// 这里 re-export 保持对外导入路径 `@/lib/output-workshop/export` 不变。
// blobToUint8Array 仅对外暴露，本地未直接使用，单独 from re-export。
export { downloadBlob, getExtension, getMimeFilter, saveBlobAs }
export { blobToUint8Array } from "./shared/file-save"

/**
 * File System Access API 的最小类型定义（lib.dom 默认未包含）。
 * 仅声明 saveTextAs 用到的 showSaveFilePicker / createWritable / write / close，
 * 替代此前的 `(window as any).showSaveFilePicker` 强转。
 */
interface FileSystemWritableFileStream {
  write: (data: string | BufferSource | Blob) => Promise<void>
  close: () => Promise<void>
}
interface FileSystemFileHandleMinimal {
  name: string
  createWritable: () => Promise<FileSystemWritableFileStream>
}
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}
interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleMinimal>
}

export async function saveTextAs(
  content: string,
  filename: string,
  type = "text/plain;charset=utf-8"
): Promise<ExportResult> {
  if (isTauri()) {
    const extension = getExtension(filename)
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeTextFile } = await import("@tauri-apps/plugin-fs")
    const filePath = await save({
      defaultPath: filename,
      filters: extension ? [{ name: getMimeFilter(extension), extensions: [extension] }] : undefined,
    })
    if (!filePath) return { fileName: filename, canceled: true }
    await writeTextFile(filePath, content)
    return { fileName: filePath.split(/[\\/]/).pop() || filename, filePath }
  }

  const pickerWindow = window as SaveFilePickerWindow
  if (typeof window !== "undefined" && pickerWindow.showSaveFilePicker) {
    try {
      const extension = getExtension(filename)
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: extension ? [{
          description: getMimeFilter(extension),
          accept: { [type.split(";")[0] || "text/plain"]: [`.${extension}`] },
        }] : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return { fileName: handle.name }
    } catch (err) {
      if ((err as Error).name === "AbortError") return { fileName: filename, canceled: true }
      logWarn("save-text-file-picker", err)
    }
  }

  return downloadBlob(new Blob([content], { type }), filename)
}

/**
 * 复制 iframe 的截图到剪贴板
 */
export async function copyIframeToClipboard(iframe: HTMLIFrameElement): Promise<void> {
  const blob = await iframeToBlob(iframe)
  await copyImageBlobToClipboard(blob)
}

/**
 * 高清下载 iframe 的网页图片
 */
export async function downloadIframeAsImage(
  iframe: HTMLIFrameElement,
  basename = "lingmo-image"
): Promise<ExportResult> {
  const blob = await iframeToBlob(iframe, 2)
  return saveBlobAs(blob, `${basename}.png`)
}

/**
 * 导出多页幻灯片为 ZIP 图片包
 */
export async function exportDeckPngZip(
  slides: DeckSlide[],
  basename = "lingmo-deck",
  onProgress?: (i: number, total: number) => void
): Promise<ExportResult> {
  if (slides.length === 0) throw new Error("没有可供导出的幻灯片")

  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  const pad = (n: number) => String(n).padStart(2, "0")

  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i + 1, slides.length)
    const blob = await renderSlideToBlob(slides[i], 2)
    zip.file(`${basename}-${pad(i + 1)}.png`, blob)
  }

  const out = await zip.generateAsync({ type: "blob" })
  return saveBlobAs(out, `${basename}.zip`)
}

/**
 * 将多页幻灯片导出为 PPTX 文件（每页为 100% 贴图并写入演讲备注）
 */
export async function exportDeckPptx(
  slides: DeckSlide[],
  basename = "lingmo-deck",
  onProgress?: (i: number, total: number) => void
): Promise<ExportResult> {
  if (slides.length === 0) throw new Error("没有可供导出的幻灯片")

  const { default: PptxGenJS } = await import("pptxgenjs")
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE" // 16:9 比例宽屏

  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i + 1, slides.length)
    const blob = await renderSlideToBlob(slides[i], 2)
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(r.error ?? new Error("读取幻灯片图片数据失败"))
      r.readAsDataURL(blob)
    })

    const s = pptx.addSlide()
    s.addImage({ data: dataUrl, x: 0, y: 0, w: "100%", h: "100%" })

    if (slides[i].notes) {
      s.addNotes(slides[i].notes)
    }
  }

  const fileName = `${basename}.pptx`
  await pptx.writeFile({ fileName })
  return { fileName }
}

/**
 * 物理打印并导出为矢量 PDF 文档（通过浏览器打印机制另存为 PDF）
 */
function buildDeckPrintDocument(slides: DeckSlide[], title: string): string {
  const sectionsHtml = slides
    .map((s) => {
      const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s.html)
      const inner = bodyMatch ? bodyMatch[1] : s.html
      return `<div class="page" style="background:${s.bg ?? "#fff"}">${inner}</div>`
    })
    .join("\n")

  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(slides[0].html)
  const head = headMatch ? headMatch[1] : ""

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${head}
<style>
  @page { size: 1920px 1080px; margin: 0; }
  html, body { margin: 0; padding: 0; background: #000; }
  .page {
    width: 1920px; height: 1080px;
    overflow: hidden; position: relative;
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page .slide { transform: none !important; margin: 0 !important; width: 1920px !important; height: 1080px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  .page .slide-content { opacity: 1 !important; transform: none !important; }
  @media screen {
    body { display: flex; flex-direction: column; gap: 24px; padding: 24px; align-items: center; }
    .page { transform: scale(0.5); transform-origin: top left; height: 540px; width: 960px; }
  }
</style>
</head>
<body>
${sectionsHtml}
</body>
</html>`
}

export function exportDeckPrint(slides: DeckSlide[], title = "lingmo-deck"): void {
  if (slides.length === 0) throw new Error("没有可供导出的幻灯片")

  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器打印导出")
  }

  const iframe = document.createElement("iframe")
  iframe.title = "LingMo PDF print"
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "1px"
  iframe.style.height = "1px"
  iframe.style.border = "0"
  iframe.style.opacity = "0"
  iframe.style.pointerEvents = "none"

  let cleanupTimer: number | null = null
  const cleanup = () => {
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer)
      cleanupTimer = null
    }
    iframe.remove()
  }

  document.body.appendChild(iframe)

  const printDocument = iframe.contentDocument
  const printWindow = iframe.contentWindow
  if (!printDocument || !printWindow) {
    cleanup()
    throw new Error("打印视图初始化失败")
  }

  printDocument.open()
  printDocument.write(buildDeckPrintDocument(slides, title))
  printDocument.close()

  let printed = false
  const triggerPrint = () => {
    if (printed) return
    printed = true
    printWindow.addEventListener("afterprint", cleanup, { once: true })
    cleanupTimer = window.setTimeout(cleanup, 60000)
    window.setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 250)
  }

  if (printDocument.readyState === "complete") {
    triggerPrint()
  } else {
    iframe.addEventListener("load", triggerPrint, { once: true })
    window.setTimeout(triggerPrint, 800)
  }
}

export function downloadTextFile(
  content: string,
  filename: string,
  type = "text/plain;charset=utf-8"
): Promise<ExportResult> {
  return saveTextAs(content, filename, type)
}

export async function exportIframeLongPng(
  iframe: HTMLIFrameElement,
  basename = "lingmo-long-image"
): Promise<ExportResult> {
  return downloadIframeAsImage(iframe, basename)
}

export async function exportIframeSlicesZip(
  iframe: HTMLIFrameElement,
  basename = "lingmo-slices",
  sliceHeight: number | { top: number; height: number }[] = 1440,
  onProgress?: (i: number, total: number) => void
): Promise<ExportResult> {
  const sourceBlob = await iframeToBlob(iframe, 2)
  const bitmap = await createImageBitmap(sourceBlob)
  
  const slices: { top: number; height: number }[] = []
  if (Array.isArray(sliceHeight)) {
    // 过滤掉无效或超出范围的切片
    sliceHeight.forEach((s) => {
      if (s.top < bitmap.height && s.height > 0) {
        const h = Math.min(s.height, bitmap.height - s.top)
        slices.push({ top: s.top, height: h })
      }
    })
  } else {
    const total = Math.max(1, Math.ceil(bitmap.height / sliceHeight))
    for (let i = 0; i < total; i++) {
      const top = i * sliceHeight
      const height = Math.min(sliceHeight, bitmap.height - top)
      slices.push({ top, height })
    }
  }

  const total = slices.length
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  const pad = (n: number) => String(n).padStart(2, "0")

  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total)
    const { top, height } = slices[i]
    if (height <= 0) continue
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("无法创建切割画布")
    ctx.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, bitmap.width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error("切割图片转换失败"))
      }, "image/png")
    })
    zip.file(`${basename}-${pad(i + 1)}.png`, blob)
  }

  bitmap.close()
  const out = await zip.generateAsync({ type: "blob" })
  return saveBlobAs(out, `${basename}.zip`)
}

// ---------------------------------------------------------------------------
// 7. 离线缓存与工作区文件保存
// ---------------------------------------------------------------------------

/**
 * 保存生成的 HTML 到离线缓存目录 (last_generated_output.html)
 * 封装了动态导入、工作区检测、目录创建和文件写入的完整流程
 */
export async function saveCachedOutput(html: string): Promise<void> {
  const { writeTextFile, exists, mkdir } = await import("@tauri-apps/plugin-fs")
  const { getFilePathOptions, getWorkspacePath } = await import("@/lib/workspace")
  const { VISUAL_REPORTS_ROOT } = await import("@/lib/visual-report-constants")

  const debugFilePath = `${VISUAL_REPORTS_ROOT}/last_generated_output.html`
  const dirOptions = await getFilePathOptions(VISUAL_REPORTS_ROOT)
  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    if (!(await exists(dirOptions.path))) {
      await mkdir(dirOptions.path, { recursive: true })
    }
    const fileOptions = await getFilePathOptions(debugFilePath)
    await writeTextFile(fileOptions.path, html)
  } else {
    if (!(await exists(dirOptions.path, { baseDir: dirOptions.baseDir }))) {
      await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir, recursive: true })
    }
    const fileOptions = await getFilePathOptions(debugFilePath)
    await writeTextFile(fileOptions.path, html, { baseDir: fileOptions.baseDir })
  }
}

/**
 * 将 HTML 保存到工作区的 visual-reports 目录，用于"保存至 LingMo 目录"功能
 */
export async function saveHtmlToWorkspace(html: string, fileName: string): Promise<ExportResult> {
  const { writeTextFile, mkdir, exists } = await import("@tauri-apps/plugin-fs")
  const { getWorkspacePath, getFilePathOptions } = await import("@/lib/workspace")
  const { VISUAL_REPORTS_ROOT } = await import("@/lib/visual-report-constants")

  const workspace = await getWorkspacePath()
  const filePath = `${VISUAL_REPORTS_ROOT}/${fileName}`

  const dirOptions = await getFilePathOptions(VISUAL_REPORTS_ROOT)
  if (workspace.isCustom) {
    if (!(await exists(dirOptions.path))) {
      await mkdir(dirOptions.path, { recursive: true })
    }
  } else {
    if (!(await exists(dirOptions.path, { baseDir: dirOptions.baseDir }))) {
      await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir, recursive: true })
    }
  }

  const fileOptions = await getFilePathOptions(filePath)
  if (workspace.isCustom) {
    await writeTextFile(fileOptions.path, html)
  } else {
    await writeTextFile(fileOptions.path, html, { baseDir: fileOptions.baseDir })
  }
  return { fileName, filePath: fileOptions.path }
}
