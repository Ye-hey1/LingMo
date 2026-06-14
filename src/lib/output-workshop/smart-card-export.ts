/**
 * 智能卡片导出系统
 * 基于模板感知的语义卡片检测、独立渲染与 ZIP 打包导出
 * 替代原有的像素级切割导出方案
 */

import { domToBlob, waitUntilLoad } from "modern-screenshot"

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

/** 模板导出蓝图 — 模板可声明自己的卡片结构和导出偏好 */
export interface ExportBlueprint {
  /** 卡片级元素的 CSS 选择器列表（优先级从高到低） */
  cardSelectors?: string[]
  /** 默认导出比例 ID，如 '3:4', '16:9' */
  defaultRatio?: string
  /** 卡片间距（px），用于计算分割点 */
  cardGap?: number
  /** 是否包含封面卡 */
  includeCover?: boolean
}

/** 从 HTML 中提取的一张独立卡片 */
export type SmartCard = {
  /** 卡片的完整自包含 HTML 文档 */
  html: string
  /** 简短标题（取自 h2/h3/首段文字） */
  title: string
  /** 0-based 索引 */
  index: number
  /** 背景色 */
  bg?: string
  /** 检测来源 */
  matchedBy: string
}

/** 卡片检测结果 */
export type SmartCardParsed = {
  /** 是否检测到多卡片结构 */
  hasCards: boolean
  /** 检测到的卡片列表 */
  cards: SmartCard[]
  /** 原始文档 head */
  head: string
  /** 原始 body class */
  bodyClass: string
  /** 原始 body style */
  bodyStyle: string
  /** 检测方法: 'blueprint' | 'selector' | 'heading' | 'fallback' */
  detectionMethod: string
}

export interface ExportResult {
  fileName: string
  filePath?: string
  canceled?: boolean
  exportedCount?: number
  totalCount?: number
  skipped?: SmartCardExportSkip[]
}

export interface SmartCardExportSkip {
  index: number
  title: string
  reason: string
}

// ---------------------------------------------------------------------------
// 2. HTML 解析辅助
// ---------------------------------------------------------------------------

function pick(re: RegExp, src: string): string {
  const m = re.exec(src)
  return m ? m[1] : ""
}

function extractAttr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i")
  return pick(re, tag)
}

function getNormalizedText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim()
}

function isSemanticCardCandidate(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase()
  if (["html", "head", "body", "script", "style", "template", "link", "meta"].includes(tagName)) {
    return false
  }

  const text = getNormalizedText(el)
  if (text.length >= 8) return true
  if (el.querySelector("img, svg, canvas, video, table")) return true
  return el.outerHTML.length > 240
}

function dropNestedDuplicateMatches(elements: HTMLElement[]): HTMLElement[] {
  const unique = Array.from(new Set(elements))
  return unique.filter((el) => {
    return !unique.some((other) => other !== el && other.contains(el))
  })
}

/** 默认的卡片选择器级联（与原 getCardSliceLines 保持一致） */
const DEFAULT_CARD_SELECTORS = [
  ".slide",
  ".deck-slide",
  ".card",
  ".xhs-card",
  ".learning-card",
  ".outline-section",
  "section",
  ".section-container",
  ".hero-section",
  ".report-section",
  ".kpi-card",
  "article",
]

// ---------------------------------------------------------------------------
// 3. 卡片检测核心
// ---------------------------------------------------------------------------

/**
 * 将生成的 HTML 解析为独立的语义卡片
 * 4 级检测降级：模板蓝图 → CSS 选择器 → 标题边界 → 整页兜底
 */
export function parseSmartCards(
  fullHtml: string,
  blueprint?: ExportBlueprint
): SmartCardParsed {
  if (!fullHtml) {
    return { hasCards: false, cards: [], head: "", bodyClass: "", bodyStyle: "", detectionMethod: "fallback" }
  }

  const head = pick(/<head\b[^>]*>([\s\S]*?)<\/head>/i, fullHtml)
  const bodyTag = pick(/<body\b([^>]*)>/i, fullHtml)
  const bodyClass = extractAttr(bodyTag, "class")
  const bodyStyle = extractAttr(bodyTag, "style")

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml, "text/html")

  // Tier 1: 模板蓝图选择器
  if (blueprint?.cardSelectors?.length) {
    const cards = trySelectors(doc, blueprint.cardSelectors, head, bodyClass, bodyStyle)
    if (cards.length > 1) {
      return { hasCards: true, cards, head, bodyClass, bodyStyle, detectionMethod: "blueprint" }
    }
  }

  // Tier 2: 默认 CSS 选择器级联
  const selectorCards = trySelectors(doc, DEFAULT_CARD_SELECTORS, head, bodyClass, bodyStyle)
  if (selectorCards.length > 1) {
    return { hasCards: true, cards: selectorCards, head, bodyClass, bodyStyle, detectionMethod: "selector" }
  }

  // Tier 3: 标题边界分割
  const headingCards = splitByHeadingBoundaries(doc, head, bodyClass, bodyStyle)
  if (headingCards.length > 1) {
    return { hasCards: true, cards: headingCards, head, bodyClass, bodyStyle, detectionMethod: "heading" }
  }

  // Tier 4: 整页兜底
  const fallbackCard = wrapAsSingleCard(fullHtml)
  return { hasCards: false, cards: [fallbackCard], head, bodyClass, bodyStyle, detectionMethod: "fallback" }
}

/** 尝试一组选择器，返回第一个匹配到 >1 个有效元素的结果 */
function trySelectors(
  doc: Document,
  selectors: string[],
  head: string,
  bodyClass: string,
  bodyStyle: string
): SmartCard[] {
  for (const selector of selectors) {
    try {
      const found = Array.from(doc.querySelectorAll(selector)).filter(
        (el): el is HTMLElement => el instanceof HTMLElement
      )
      const valid = dropNestedDuplicateMatches(found).filter(isSemanticCardCandidate)
      if (valid.length > 1) {
        return valid.map((el, i) => buildStandaloneCardHtml(el, head, bodyClass, bodyStyle, i, selector))
      }
    } catch {
      // 选择器无效，跳过
    }
  }
  return []
}

/** 将一个 DOM 元素包装为自包含的 HTML 文档 */
function buildStandaloneCardHtml(
  el: HTMLElement,
  head: string,
  bodyClass: string,
  bodyStyle: string,
  index: number,
  matchedBy: string
): SmartCard {
  // 提取标题
  let title = `卡片 ${index + 1}`
  const hMatch = el.querySelector("h1, h2, h3, h4")
  if (hMatch?.textContent?.trim()) {
    title = hMatch.textContent.trim().slice(0, 20)
  } else {
    const pMatch = el.querySelector("p")
    if (pMatch?.textContent?.trim()) {
      title = pMatch.textContent.trim().slice(0, 15) + "..."
    }
  }

  // 提取背景色
  const bg = resolveElementBackground(el)

  // 构建独立 HTML
  const cardHtml = el.outerHTML
  const standalone =
    `<!DOCTYPE html><html><head>${head}\n` +
    `<style>
      html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
      body { display:grid; place-items:center; ${bodyStyle} }
      .lingmo-smart-card-export-root {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .lingmo-smart-card-export-root *,
      .lingmo-smart-card-export-root *::before,
      .lingmo-smart-card-export-root *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      .lingmo-smart-card-export-root > * {
        max-width: 100%;
        max-height: 100%;
      }
      .lingmo-smart-card-export-root > .moka-card {
        width: 100% !important;
        height: 100% !important;
        aspect-ratio: 3 / 4 !important;
        max-width: none !important;
        max-height: none !important;
      }
      .lingmo-smart-card-export-root .lingmo-moka-editor,
      .lingmo-smart-card-export-root .moka-reorder-handle,
      .lingmo-smart-card-export-root [data-moka-editor-ui] {
        display: none !important;
      }
      .lingmo-smart-card-export-root .slide,
      .lingmo-smart-card-export-root .deck-slide,
      .lingmo-smart-card-export-root .gz-deck-slide {
        opacity: 1 !important;
        pointer-events: auto !important;
        position: relative !important;
        inset: auto !important;
        transform: none !important;
        margin: 0 !important;
      }
      .lingmo-smart-card-export-root .gz-deck-slide {
        width: 100% !important;
        height: 100% !important;
      }
    </style></head>` +
    `<body class="${bodyClass}"><div class="lingmo-smart-card-export-root">${cardHtml}</div></body></html>`

  return { html: standalone, title, index, bg, matchedBy }
}

/** 解析元素自身的背景色 */
function resolveElementBackground(el: HTMLElement): string | undefined {
  let current: HTMLElement | null = el
  while (current) {
    const bg = current.style.backgroundColor
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg
    current = current.parentElement
  }
  return undefined
}

/** 按标题边界分割文档为虚拟卡片 */
function splitByHeadingBoundaries(
  doc: Document,
  head: string,
  bodyClass: string,
  bodyStyle: string
): SmartCard[] {
  const body = doc.body
  if (!body) return []

  // 先尝试 h2，不够再试 h3
  let headings = Array.from(body.querySelectorAll("h2"))
  if (headings.length < 2) {
    headings = Array.from(body.querySelectorAll("h3"))
  }
  if (headings.length < 2) return []

  const cards: SmartCard[] = []
  let currentNodes: Node[] = []
  let currentTitle = ""

  const flushChunk = () => {
    if (currentNodes.length === 0) return
    const wrapper = doc.createElement("div")
    wrapper.style.cssText = "padding:32px 24px;min-height:200px;"
    for (const node of currentNodes) {
      wrapper.appendChild(node.cloneNode(true))
    }
    const card = buildStandaloneCardHtml(wrapper as HTMLElement, head, bodyClass, bodyStyle, cards.length, "heading")
    if (currentTitle) card.title = currentTitle
    cards.push(card)
    currentNodes = []
  }

  // 收集 body 直接子节点，按标题分段
  const children = Array.from(body.childNodes)
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement
      if (el.matches?.("h2, h3")) {
        flushChunk()
        currentTitle = el.textContent?.trim()?.slice(0, 20) || ""
        currentNodes.push(child)
      } else {
        currentNodes.push(child)
      }
    } else if (child.textContent?.trim()) {
      currentNodes.push(child)
    }
  }
  flushChunk()

  return cards
}

/** 整页作为单张卡片 */
function wrapAsSingleCard(fullHtml: string): SmartCard {
  return {
    html: fullHtml,
    title: "整页导出",
    index: 0,
    matchedBy: "fallback",
  }
}

// ---------------------------------------------------------------------------
// 4. 卡片渲染管线
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
const CARD_LOAD_TIMEOUT_MS = 3500
const CARD_RESOURCE_TIMEOUT_MS = 6500
const CARD_SCREENSHOT_TIMEOUT_MS = 9000
const CARD_THUMBNAIL_SCREENSHOT_TIMEOUT_MS = 6000
const CARD_FILE_READER_TIMEOUT_MS = 3000
const CARD_BASE_WIDTH = 420
const CARD_BASE_HEIGHT = 560

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label}超时，请检查卡片中的远程图片、字体或复杂样式`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function isMokaCard(card: SmartCard): boolean {
  return /\b(?:moka-card|moka-slide)\b|data-moka-card|data-moka-ai-design/.test(card.html)
}

function getRenderViewport(card: SmartCard, targetWidth: number, targetHeight: number): { width: number; height: number } {
  if (isMokaCard(card)) {
    return {
      width: CARD_BASE_WIDTH,
      height: CARD_BASE_HEIGHT,
    }
  }

  return {
    width: Math.max(targetWidth, CARD_BASE_WIDTH),
    height: Math.max(targetHeight, CARD_BASE_HEIGHT),
  }
}

function findScreenshotTarget(doc: Document): HTMLElement {
  const selectors = [
    ".lingmo-smart-card-export-root > [data-moka-card]",
    ".lingmo-smart-card-export-root > .moka-card",
    ".lingmo-smart-card-export-root > .gz-social-card",
    ".lingmo-smart-card-export-root > .xhs-card",
    ".lingmo-smart-card-export-root > .learning-card",
    ".lingmo-smart-card-export-root > .slide",
    ".lingmo-smart-card-export-root > .deck-slide",
    ".lingmo-smart-card-export-root > .gz-deck-slide",
    ".lingmo-smart-card-export-root > section",
    ".lingmo-smart-card-export-root > article",
    ".lingmo-smart-card-export-root > div",
  ]

  for (const selector of selectors) {
    const target = doc.querySelector(selector)
    if (target instanceof HTMLElement) return target
  }

  return doc.body
}

async function loadBlobImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    return window.createImageBitmap(blob)
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("导出图片解码失败"))
    }
    img.src = url
  })
}

async function fitBlobToTargetSize(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
  backgroundColor: string
): Promise<Blob> {
  const image = await loadBlobImage(blob)
  const imageWidth = image.width
  const imageHeight = image.height

  if (imageWidth === targetWidth && imageHeight === targetHeight) {
    if ("close" in image) image.close()
    return blob
  }

  const canvas = document.createElement("canvas")
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建导出画布")

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, targetWidth, targetHeight)

  const sourceRatio = imageWidth / imageHeight
  const targetRatio = targetWidth / targetHeight
  const ratioMatches = Math.abs(sourceRatio - targetRatio) < 0.02
  const scale = ratioMatches
    ? Math.max(targetWidth / imageWidth, targetHeight / imageHeight)
    : Math.min(targetWidth / imageWidth, targetHeight / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  const x = (targetWidth - drawWidth) / 2
  const y = (targetHeight - drawHeight) / 2
  ctx.drawImage(image, x, y, drawWidth, drawHeight)
  if ("close" in image) image.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob)
      else reject(new Error("导出图片尺寸转换失败"))
    }, "image/png")
  })
}

function resolveTargetBackground(target: HTMLElement, fallback: string): string {
  const win = target.ownerDocument.defaultView
  let current: HTMLElement | null = target
  while (current) {
    const bg = win?.getComputedStyle(current).backgroundColor
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg
    current = current.parentElement
  }
  return fallback
}

/** 等待 iframe 文档就绪 */
async function waitForIframeReady(iframe: HTMLIFrameElement): Promise<void> {
  await withTimeout(waitForIframeReadyInner(iframe), CARD_RESOURCE_TIMEOUT_MS, "卡片资源加载")
}

async function waitForIframeReadyInner(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument
  if (!doc) return

  // 样式表
  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
  await Promise.all(
    links.map(
      (l) =>
        new Promise<void>((res) => {
          if ((l as HTMLLinkElement).sheet) return res()
          l.addEventListener("load", () => res(), { once: true })
          setTimeout(res, CARD_LOAD_TIMEOUT_MS)
        })
    )
  )

  // 字体
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) {
      await withTimeout(fonts.ready, 2500, "卡片字体加载").catch(() => undefined)
    }
  } catch { /* noop */ }

  // 图片
  const imgs = Array.from(doc.images)
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((res) => {
          if (img.complete && img.naturalWidth > 0) return res()
          const done = () => res()
          img.addEventListener("load", done, { once: true })
          img.addEventListener("error", done, { once: true })
          if ("decode" in img) img.decode().then(done, done)
          setTimeout(done, 4000)
        })
    )
  )

  try {
    await waitUntilLoad(doc.documentElement, { timeout: 5000 })
  } catch { /* noop */ }

  await nextFrame()
  await sleep(100)
  await nextFrame()
}

/**
 * 将单张卡片渲染为 PNG Blob
 * 复用 renderSlideToBlob 的离屏 iframe 模式
 */
export async function renderCardToBlob(
  card: SmartCard,
  targetWidth: number,
  targetHeight: number,
  scale = 2
): Promise<Blob> {
  const viewport = getRenderViewport(card, targetWidth, targetHeight)
  const wrap = document.createElement("div")
  wrap.style.cssText = `
    position: fixed;
    top: 0; left: -100000px;
    width: ${viewport.width}px; height: ${viewport.height}px;
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  `

  const iframe = document.createElement("iframe")
  iframe.style.cssText = `
    width: ${viewport.width}px; height: ${viewport.height}px;
    border: 0; background: ${card.bg ?? "#fff"};
  `
  iframe.srcdoc = card.html

  wrap.appendChild(iframe)
  document.body.appendChild(wrap)

  try {
    // 等待加载
    await new Promise<void>((res) => {
      const done = () => res()
      if (iframe.contentDocument?.readyState === "complete") return done()
      iframe.addEventListener("load", done, { once: true })
      setTimeout(done, CARD_LOAD_TIMEOUT_MS)
    })

    await waitForIframeReady(iframe)

    // 截图
    const doc = iframe.contentDocument!
    const prevHtmlStyle = doc.documentElement.getAttribute("style")
    const prevBodyStyle = doc.body.getAttribute("style")

    doc.documentElement.style.width = `${viewport.width}px`
    doc.documentElement.style.height = `${viewport.height}px`
    doc.documentElement.style.overflow = "hidden"
    doc.body.style.width = `${viewport.width}px`
    doc.body.style.height = `${viewport.height}px`
    doc.body.style.overflow = "hidden"

    await nextFrame()
    await sleep(50)
    await nextFrame()

    try {
      const timeoutMs = scale <= 1 ? CARD_THUMBNAIL_SCREENSHOT_TIMEOUT_MS : CARD_SCREENSHOT_TIMEOUT_MS
      const target = findScreenshotTarget(doc)
      const rect = target.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        throw new Error("卡片内容尚未渲染，无法截图")
      }
      const backgroundColor = resolveTargetBackground(target, card.bg ?? "#ffffff")
      const presetScale = Math.min(targetWidth / rect.width, targetHeight / rect.height)
      const captureScale = Math.max(0.25, Math.min(5, presetScale * Math.max(scale, 1)))
      const blob = await withTimeout(
        domToBlob(target, {
          scale: captureScale,
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
          backgroundColor,
        }),
        timeoutMs,
        `卡片 #${card.index + 1} 截图`
      )
      if (!blob) throw new Error("卡片截图转换失败")
      return fitBlobToTargetSize(blob, targetWidth, targetHeight, backgroundColor)
    } finally {
      if (prevHtmlStyle === null) doc.documentElement.removeAttribute("style")
      else doc.documentElement.setAttribute("style", prevHtmlStyle)
      if (prevBodyStyle === null) doc.body.removeAttribute("style")
      else doc.body.setAttribute("style", prevBodyStyle)
    }
  } finally {
    wrap.remove()
  }
}

// ---------------------------------------------------------------------------
// 5. 导出打包
// ---------------------------------------------------------------------------

/**
 * 将多张卡片渲染并打包为 ZIP
 */
export async function exportSmartCardsZip(
  cards: SmartCard[],
  targetWidth: number,
  targetHeight: number,
  basename = "lingmo-cards",
  selectedIndices: number[],
  onProgress?: (i: number, total: number) => void
): Promise<ExportResult> {
  const filtered = selectedIndices.length > 0
    ? cards.filter((c) => selectedIndices.includes(c.index))
    : cards

  const total = filtered.length
  if (total === 0) throw new Error("没有选中任何卡片")

  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  const pad = (n: number) => String(n).padStart(2, "0")

  const skipped: SmartCardExportSkip[] = []
  let exportedCount = 0

  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total)
    const card = filtered[i]
    try {
      const blob = await renderCardToBlob(card, targetWidth, targetHeight)
      zip.file(`${basename}-${pad(card.index + 1)}.png`, blob)
      exportedCount += 1
    } catch (error) {
      skipped.push({
        index: card.index,
        title: card.title,
        reason: errorMessage(error),
      })
      console.warn(`【智能卡片导出】卡片 #${card.index + 1} 渲染失败，已跳过:`, error)
    }
  }

  if (exportedCount === 0) {
    const firstReason = skipped[0]?.reason ? `：${skipped[0].reason}` : ""
    throw new Error(`全部 ${total} 张卡片都未能渲染${firstReason}`)
  }

  const out = await zip.generateAsync({ type: "blob" })
  const result = await saveBlobAs(out, `${basename}.zip`)
  return {
    ...result,
    exportedCount,
    totalCount: total,
    skipped,
  }
}

/**
 * 下载单张卡片
 */
export async function downloadSingleCard(
  card: SmartCard,
  targetWidth: number,
  targetHeight: number,
  filename: string
): Promise<ExportResult> {
  const blob = await renderCardToBlob(card, targetWidth, targetHeight)
  return saveBlobAs(blob, filename)
}

// ---------------------------------------------------------------------------
// 6. 文件保存辅助
// ---------------------------------------------------------------------------

async function saveBlobAs(blob: Blob, defaultName: string): Promise<ExportResult> {
  // 优先尝试 Tauri 原生保存对话框
  try {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeFile } = await import("@tauri-apps/plugin-fs")
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: defaultName.endsWith(".zip") ? "ZIP" : "PNG", extensions: [defaultName.split(".").pop() || "zip"] }],
    })
    if (!path) return { fileName: defaultName, canceled: true }
    const buf = await blob.arrayBuffer()
    await writeFile(path, new Uint8Array(buf))
    return { fileName: defaultName, filePath: path }
  } catch {
    // 降级为浏览器下载
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = defaultName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { fileName: defaultName }
  }
}

// ---------------------------------------------------------------------------
// 7. 生成缩略图（用于 UI 预览）
// ---------------------------------------------------------------------------

/**
 * 为卡片生成低分辨率的缩略图 DataURL
 */
export async function renderCardThumbnail(
  card: SmartCard,
  thumbWidth = 270,
  thumbHeight = 360
): Promise<string> {
  const blob = await renderCardToBlob(card, thumbWidth, thumbHeight, 1)
  return withTimeout(new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("生成卡片缩略图失败"))
    reader.readAsDataURL(blob)
  }), CARD_FILE_READER_TIMEOUT_MS, `卡片 #${card.index + 1} 缩略图读取`)
}
