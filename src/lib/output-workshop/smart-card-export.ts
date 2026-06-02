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
  const docHeight = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 1

  for (const selector of selectors) {
    try {
      const found = Array.from(doc.querySelectorAll(selector)) as HTMLElement[]
      const valid = found.filter((el) => {
        const h = el.offsetHeight || el.getBoundingClientRect?.().height || 0
        return h > 120 && h < docHeight * 0.95
      })
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
      html, body { margin:0; padding:0; height:auto; min-height:100vh; }
      body { display:flex; align-items:center; justify-content:center; ${bodyStyle} }
      ${bodyClass ? `body { @apply ${bodyClass}; }` : ""}
    </style></head>` +
    `<body class="${bodyClass}">${cardHtml}</body></html>`

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

/** 等待 iframe 文档就绪 */
async function waitForIframeReady(iframe: HTMLIFrameElement): Promise<void> {
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
          setTimeout(res, 4000)
        })
    )
  )

  // 字体
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) await fonts.ready
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
          setTimeout(done, 5000)
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
  const wrap = document.createElement("div")
  wrap.style.cssText = `
    position: fixed;
    top: 0; left: -100000px;
    width: ${targetWidth}px; height: ${targetHeight}px;
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  `

  const iframe = document.createElement("iframe")
  iframe.style.cssText = `
    width: ${targetWidth}px; height: ${targetHeight}px;
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
      setTimeout(done, 4000)
    })

    await waitForIframeReady(iframe)

    // 截图
    const doc = iframe.contentDocument!
    // 临时展开以截取全部内容
    const prevH = iframe.style.height
    const prevDocOverflow = doc.documentElement.style.overflow
    const prevBodyOverflow = doc.body.style.overflow

    const fullHeight = Math.max(
      doc.documentElement.scrollHeight,
      doc.body.scrollHeight,
      targetHeight
    )
    iframe.style.height = fullHeight + "px"
    doc.documentElement.style.overflow = "visible"
    doc.body.style.overflow = "visible"

    try {
      const blob = await domToBlob(doc.documentElement, {
        scale,
        backgroundColor: card.bg ?? "#ffffff",
      })
      if (!blob) throw new Error("卡片截图转换失败")
      return blob
    } finally {
      iframe.style.height = prevH
      doc.documentElement.style.overflow = prevDocOverflow
      doc.body.style.overflow = prevBodyOverflow
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

  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total)
    const card = filtered[i]
    const blob = await renderCardToBlob(card, targetWidth, targetHeight)
    zip.file(`${basename}-${pad(i + 1)}.png`, blob)
  }

  const out = await zip.generateAsync({ type: "blob" })
  return saveBlobAs(out, `${basename}.zip`)
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("生成卡片缩略图失败"))
    reader.readAsDataURL(blob)
  })
}
