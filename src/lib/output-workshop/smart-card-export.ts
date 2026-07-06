/**
 * 智能卡片导出系统
 * 基于模板感知的语义卡片检测、独立渲染与 ZIP 打包导出
 * 替代原有的像素级切割导出方案
 */

import { domToBlob } from "modern-screenshot"
import { pick, extractAttr } from "./shared/html-parse"
import type { ExportResult, SmartCardExportSkip } from "./shared/types"
import { saveBlobAs } from "./shared/file-save"
import {
  nextFrame,
  sleep,
  withTimeout,
  createOffscreenIframe,
  waitForDocumentResources,
} from "./shared/offscreen-render"
import { logWarn } from "./shared/log"
import { buildCardRootStyles } from "./shared/card-styles"

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

/** 模板导出蓝图 — 模板可声明自己的卡片结构和导出偏好 */
export type SmartCardPagingMode = "semantic" | "separator" | "auto-fit" | "auto-split" | "dynamic"

export interface ExportBlueprint {
  /** 卡片级元素的 CSS 选择器列表（优先级从高到低） */
  cardSelectors?: string[]
  /** 默认导出比例 ID，如 '3:4', '16:9' */
  defaultRatio?: string
  /** 卡片间距（px），用于计算分割点 */
  cardGap?: number
  /** 是否包含封面卡 */
  includeCover?: boolean
  /** 卡片分割/适配策略，吸收 Auto-Redbook 的 separator/auto-fit/auto-split/dynamic 思路 */
  pagingMode?: SmartCardPagingMode
  /** auto-split 语义切分的目标字符权重 */
  autoSplitMaxChars?: number
  /** dynamic 模式最大导出高度 */
  dynamicMaxHeight?: number
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
  /** 当前卡片推荐导出策略 */
  exportMode?: SmartCardPagingMode
  /** dynamic 模式最大导出高度 */
  dynamicMaxHeight?: number
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
  /** 检测方法: 'blueprint' | 'selector' | 'separator' | 'auto-split' | 'heading' | 'fallback' */
  detectionMethod: string
  /** 当前使用的分割/适配策略 */
  pagingMode: SmartCardPagingMode
}

// 注：ExportResult / SmartCardExportSkip 已统一下沉到 ./shared/types.ts，本文件按需 import。
export type { ExportResult, SmartCardExportSkip } from "./shared/types"

export interface SmartCardRenderOptions {
  pagingMode?: SmartCardPagingMode
  dynamicMaxHeight?: number
}

// ---------------------------------------------------------------------------
// 2. HTML 解析辅助
// ---------------------------------------------------------------------------

// 注：pick / extractAttr 已统一收口到 ./shared/html-parse.ts，本文件按需 import。

function normalizePagingMode(mode: string | undefined): SmartCardPagingMode {
  if (mode === "separator" || mode === "auto-fit" || mode === "auto-split" || mode === "dynamic") return mode
  return "semantic"
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

function shouldTryCombinedCardSelectors(selectors: string[]): boolean {
  return selectors.some((selector) =>
    selector.includes("cover-container") ||
    selector.includes("card-container") ||
    selector.includes("data-redbook-card") ||
    selector.includes("data-export-card")
  )
}

/** 默认的卡片选择器级联（与原 getCardSliceLines 保持一致） */
const DEFAULT_CARD_SELECTORS = [
  ".cover-container",
  ".card-container",
  "[data-redbook-card]",
  "[data-export-card]",
  ".slide",
  ".deck-slide",
  ".card",
  ".xhs-card",
  ".learning-card",
  ".outline-section",
  ".card-section",
  ".content-section",
  "[data-section]",
  ".section-card",
  ".section-container",
  ".hero-section",
  ".report-section",
  ".kpi-card",
  // 通用选择器放末尾，仅当更具体的选择器均不匹配时才尝试
  "article",
]

// ---------------------------------------------------------------------------
// 3. 卡片检测核心
// ---------------------------------------------------------------------------

/**
 * 将生成的 HTML 解析为独立的语义卡片。
 *
 * 检测采用「策略数组 + 首个命中即返回」的降级链，便于追踪与扩展：
 *   separator → blueprint → selector → auto-split → heading → fallback
 * 每个策略返回 >1 张卡片即视为命中；全部未命中则整页兜底为单张。
 */
export function parseSmartCards(
  fullHtml: string,
  blueprint?: ExportBlueprint
): SmartCardParsed {
  const pagingMode = normalizePagingMode(blueprint?.pagingMode)
  if (!fullHtml) {
    return { hasCards: false, cards: [], head: "", bodyClass: "", bodyStyle: "", detectionMethod: "fallback", pagingMode }
  }

  const head = pick(/<head\b[^>]*>([\s\S]*?)<\/head>/i, fullHtml)
  const bodyTag = pick(/<body\b([^>]*)>/i, fullHtml)
  const bodyClass = extractAttr(bodyTag, "class")
  const bodyStyle = extractAttr(bodyTag, "style")

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml, "text/html")

  // 检测上下文，供各策略闭包共享
  const ctx = { doc, head, bodyClass, bodyStyle, blueprint, pagingMode }

  /** 单个检测策略：返回 >1 张卡片即命中，否则返回 null 让下一个策略继续 */
  type DetectionStrategy = {
    name: SmartCardParsed["detectionMethod"]
    detect: (c: typeof ctx) => SmartCard[] | null
  }

  // 命中条件：产出多于 1 张卡片。封装为 helper 避免每个策略重复 length 判断。
  const hit = (cards: SmartCard[]): SmartCard[] | null => (cards.length > 1 ? cards : null)

  const strategies: DetectionStrategy[] = [
    // Tier 0: Auto-Redbook 手动分隔模式（--- 分隔段）
    {
      name: "separator",
      detect: (c) =>
        c.pagingMode === "separator"
          ? hit(splitBySeparatorBoundaries(c.doc, c.head, c.bodyClass, c.bodyStyle, c.blueprint))
          : null,
    },
    // Tier 1: 模板蓝图选择器（先尝试组合选择器，再尝试逐个选择器）
    {
      name: "blueprint",
      detect: (c) => {
        if (!c.blueprint?.cardSelectors?.length) return null
        const selectors = c.blueprint.cardSelectors
        if (shouldTryCombinedCardSelectors(selectors)) {
          const combined = tryCombinedSelectors(c.doc, selectors, c.head, c.bodyClass, c.bodyStyle, c.blueprint)
          if (combined.length > 1) return combined
        }
        return hit(trySelectors(c.doc, selectors, c.head, c.bodyClass, c.bodyStyle, c.blueprint))
      },
    },
    // Tier 2: 默认 CSS 选择器级联
    {
      name: "selector",
      detect: (c) => hit(trySelectors(c.doc, DEFAULT_CARD_SELECTORS, c.head, c.bodyClass, c.bodyStyle, c.blueprint)),
    },
    // Tier 3: Auto-Redbook auto-split 语义拆分（按标题与内容体量组合为固定比例卡）
    {
      name: "auto-split",
      detect: (c) =>
        c.pagingMode === "auto-split"
          ? hit(splitByContentWeight(c.doc, c.head, c.bodyClass, c.bodyStyle, c.blueprint))
          : null,
    },
    // Tier 4: 标题边界分割
    {
      name: "heading",
      detect: (c) => hit(splitByHeadingBoundaries(c.doc, c.head, c.bodyClass, c.bodyStyle, c.blueprint)),
    },
  ]

  for (const strategy of strategies) {
    const cards = strategy.detect(ctx)
    if (cards) {
      return { hasCards: true, cards, head, bodyClass, bodyStyle, detectionMethod: strategy.name, pagingMode }
    }
  }

  // Tier 5: 整页兜底
  const fallbackCard = wrapAsSingleCard(fullHtml, blueprint)
  return { hasCards: false, cards: [fallbackCard], head, bodyClass, bodyStyle, detectionMethod: "fallback", pagingMode }
}

/** 尝试一组选择器，返回第一个匹配到 >1 个有效元素的结果 */
function trySelectors(
  doc: Document,
  selectors: string[],
  head: string,
  bodyClass: string,
  bodyStyle: string,
  blueprint?: ExportBlueprint
): SmartCard[] {
  for (const selector of selectors) {
    try {
      const found = Array.from(doc.querySelectorAll(selector)).filter(
        (el): el is HTMLElement => el instanceof HTMLElement
      )
      const valid = dropNestedDuplicateMatches(found).filter(isSemanticCardCandidate)
      if (valid.length > 1) {
        return valid.map((el, i) => buildStandaloneCardHtml(el, head, bodyClass, bodyStyle, i, selector, blueprint))
      }
    } catch (error) {
      // 选择器无效，跳过；留痕便于排查蓝图配置
      logWarn(`card-selector:${selector}`, error)
    }
  }
  return []
}

function tryCombinedSelectors(
  doc: Document,
  selectors: string[],
  head: string,
  bodyClass: string,
  bodyStyle: string,
  blueprint?: ExportBlueprint
): SmartCard[] {
  const combinedSelector = selectors.join(",")
  try {
    const found = Array.from(doc.querySelectorAll(combinedSelector)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    )
    const valid = dropNestedDuplicateMatches(found).filter(isSemanticCardCandidate)
    if (valid.length > 1) {
      return valid.map((el, i) => buildStandaloneCardHtml(el, head, bodyClass, bodyStyle, i, combinedSelector, blueprint))
    }
  } catch (error) {
    // 组合选择器无效时回退到逐个选择器；留痕便于排查
    logWarn("combined-card-selector", error)
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
  matchedBy: string,
  blueprint?: ExportBlueprint
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
  const isRedbookCard = Boolean(
    el.hasAttribute("data-redbook-card") ||
    el.closest(".redbook-deck") ||
    /\bredbook-output\b/.test(bodyClass)
  )

  // 构建独立 HTML
  const cardHtml = el.outerHTML
  const redbookAutoFitScript = isRedbookCard
    ? `<script>
      (function () {
        function fitCardContent() {
          document.querySelectorAll('.card-content').forEach(function (viewport) {
            var scaleEl = viewport.querySelector('.card-content-scale');
            if (!scaleEl) return;
            scaleEl.style.transform = 'none';
            scaleEl.style.width = '';
            scaleEl.style.height = '';
            var availableWidth = viewport.clientWidth;
            var availableHeight = viewport.clientHeight;
            var rect = scaleEl.getBoundingClientRect();
            var contentWidth = Math.max(scaleEl.scrollWidth, rect.width);
            var contentHeight = Math.max(scaleEl.scrollHeight, rect.height);
            if (!availableWidth || !availableHeight || !contentWidth || !contentHeight) return;
            var fitScale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
            scaleEl.style.width = (availableWidth / fitScale) + 'px';
            scaleEl.style.transformOrigin = 'top left';
            scaleEl.style.transform = 'scale(' + fitScale + ')';
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', fitCardContent, { once: true });
        } else {
          fitCardContent();
        }
        window.addEventListener('resize', fitCardContent);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCardContent).catch(function () {});
      })();
    </script>`
    : ""
  const rootSelector = ".lingmo-smart-card-export-root"
  const sharedCss = buildCardRootStyles(rootSelector)
  const bodyStyleOverride = bodyStyle ? `body { ${bodyStyle} }` : ""
  const redbookCss = `
      body.redbook-output ${rootSelector} > .card-container,
      body.redbook-output ${rootSelector} > .cover-container,
      ${rootSelector} > [data-redbook-card] {
        width: 1080px !important;
        height: 1440px !important;
        min-height: 1440px !important;
        max-width: none !important;
        max-height: none !important;
        overflow: hidden !important;
      }
    `
  const standalone =
    `<!DOCTYPE html><html><head>${head}\n` +
    `<style>\n${sharedCss}\n${bodyStyleOverride}\n${redbookCss}\n</style></head>` +
    `<body class="${bodyClass}"><div class="${rootSelector}">${cardHtml}</div>${redbookAutoFitScript}</body></html>`

  return {
    html: standalone,
    title,
    index,
    bg,
    matchedBy,
    exportMode: isRedbookCard ? "auto-fit" : normalizePagingMode(blueprint?.pagingMode),
    dynamicMaxHeight: blueprint?.dynamicMaxHeight,
  }
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

function isSeparatorElement(el: HTMLElement): boolean {
  if (el.matches("hr, [data-page-break], [data-card-break]")) return true
  const text = getNormalizedText(el)
  return /^[-*_]{3,}$/.test(text)
}

function createAutoRedbookWrapper(doc: Document, nodes: Node[], index: number): HTMLElement {
  const container = doc.createElement("section")
  container.className = "card-container"
  container.setAttribute("data-redbook-card", String(index + 1))

  const inner = doc.createElement("div")
  inner.className = "card-inner"

  const content = doc.createElement("div")
  content.className = "card-content"

  const scale = doc.createElement("div")
  scale.className = "card-content-scale"

  for (const node of nodes) {
    scale.appendChild(node.cloneNode(true))
  }

  content.appendChild(scale)
  inner.appendChild(content)
  container.appendChild(inner)
  return container
}

function buildCardsFromNodeChunks(
  doc: Document,
  chunks: Node[][],
  head: string,
  bodyClass: string,
  bodyStyle: string,
  matchedBy: string,
  blueprint?: ExportBlueprint,
  titleHints: string[] = []
): SmartCard[] {
  return chunks
    .filter((chunk) => chunk.some((node) => node.textContent?.trim() || node.nodeType === Node.ELEMENT_NODE))
    .map((chunk, index) => {
      const wrapper = createAutoRedbookWrapper(doc, chunk, index)
      const card = buildStandaloneCardHtml(wrapper, head, bodyClass, bodyStyle, index, matchedBy, blueprint)
      if (titleHints[index]) card.title = titleHints[index]
      return card
    })
}

function splitBySeparatorBoundaries(
  doc: Document,
  head: string,
  bodyClass: string,
  bodyStyle: string,
  blueprint?: ExportBlueprint
): SmartCard[] {
  const body = doc.body
  if (!body) return []

  const chunks: Node[][] = []
  let currentNodes: Node[] = []
  const children = Array.from(body.childNodes)

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE && isSeparatorElement(child as HTMLElement)) {
      if (currentNodes.length) {
        chunks.push(currentNodes)
        currentNodes = []
      }
      continue
    }
    if (child.nodeType === Node.TEXT_NODE && /^\s*---+\s*$/.test(child.textContent || "")) {
      if (currentNodes.length) {
        chunks.push(currentNodes)
        currentNodes = []
      }
      continue
    }
    if (child.textContent?.trim() || child.nodeType === Node.ELEMENT_NODE) {
      currentNodes.push(child)
    }
  }
  if (currentNodes.length) chunks.push(currentNodes)

  if (chunks.length < 2) return []
  return buildCardsFromNodeChunks(doc, chunks, head, bodyClass, bodyStyle, "separator", blueprint)
}

function nodeWeight(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").trim().length
  if (node.nodeType !== Node.ELEMENT_NODE) return 0

  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const textLength = getNormalizedText(el).length
  const mediaWeight = el.querySelector("img, svg, canvas, video, table") ? 240 : 0
  const headingWeight = /^h[1-6]$/.test(tag) ? 160 : 0
  return textLength + mediaWeight + headingWeight
}

function splitByContentWeight(
  doc: Document,
  head: string,
  bodyClass: string,
  bodyStyle: string,
  blueprint?: ExportBlueprint
): SmartCard[] {
  const body = doc.body
  if (!body) return []

  const maxWeight = Math.max(520, blueprint?.autoSplitMaxChars ?? 760)
  const chunks: Node[][] = []
  const titleHints: string[] = []
  let currentNodes: Node[] = []
  let currentWeight = 0
  let currentTitle = ""

  const flush = () => {
    if (!currentNodes.length) return
    chunks.push(currentNodes)
    titleHints.push(currentTitle)
    currentNodes = []
    currentWeight = 0
    currentTitle = ""
  }

  for (const child of Array.from(body.childNodes)) {
    if (!(child.textContent?.trim() || child.nodeType === Node.ELEMENT_NODE)) continue
    const isHeading = child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).matches("h1, h2, h3")
    const weight = Math.max(1, nodeWeight(child))

    if (isHeading && currentNodes.length && currentWeight >= maxWeight * 0.35) {
      flush()
    } else if (currentNodes.length && currentWeight + weight > maxWeight) {
      flush()
    }

    if (!currentTitle && isHeading) {
      currentTitle = (child.textContent || "").trim().slice(0, 20)
    }
    currentNodes.push(child)
    currentWeight += weight
  }
  flush()

  if (chunks.length < 2) return []
  return buildCardsFromNodeChunks(doc, chunks, head, bodyClass, bodyStyle, "auto-split", blueprint, titleHints)
}

/** 按标题边界分割文档为虚拟卡片 */
function splitByHeadingBoundaries(
  doc: Document,
  head: string,
  bodyClass: string,
  bodyStyle: string,
  blueprint?: ExportBlueprint
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
    const card = buildStandaloneCardHtml(wrapper as HTMLElement, head, bodyClass, bodyStyle, cards.length, "heading", blueprint)
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
function wrapAsSingleCard(fullHtml: string, blueprint?: ExportBlueprint): SmartCard {
  return {
    html: fullHtml,
    title: "整页导出",
    index: 0,
    matchedBy: "fallback",
    exportMode: normalizePagingMode(blueprint?.pagingMode),
    dynamicMaxHeight: blueprint?.dynamicMaxHeight,
  }
}

// ---------------------------------------------------------------------------
// 4. 卡片渲染管线
// ---------------------------------------------------------------------------

// nextFrame / sleep / withTimeout / createOffscreenIframe / waitForDocumentResources
// 已统一收口到 ./shared/offscreen-render.ts，本文件按需 import。

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

/** 卡片资源加载超时配置，与原 waitForIframeReadyInner 一致 */
const CARD_RESOURCE_CONFIG = {
  stylesheetMs: CARD_LOAD_TIMEOUT_MS,
  fontsMs: 2500,
  imageMs: 4000,
  waitUntilLoadMs: 5000,
  settleMs: 100,
} as const

function getRenderViewport(card: SmartCard, targetWidth: number, targetHeight: number): { width: number; height: number } {
  const maxDynamicHeight = Math.min(Math.max(card.dynamicMaxHeight ?? targetHeight, targetHeight), 4096)
  const dynamicHeight = card.exportMode === "dynamic"
    ? maxDynamicHeight
    : targetHeight
  return {
    width: Math.max(targetWidth, CARD_BASE_WIDTH),
    height: Math.max(dynamicHeight, CARD_BASE_HEIGHT),
  }
}

function findScreenshotTarget(doc: Document): HTMLElement {
  const selectors = [
    ".lingmo-smart-card-export-root > .card-container",
    ".lingmo-smart-card-export-root > .cover-container",
    ".lingmo-smart-card-export-root > [data-redbook-card]",
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

function applyAutoFitScale(doc: Document): void {
  const viewportContent = doc.querySelector(".card-content")
  const scaleEl = doc.querySelector(".card-content-scale")
  if (!(viewportContent instanceof HTMLElement) || !(scaleEl instanceof HTMLElement)) return

  scaleEl.style.transform = "none"
  scaleEl.style.width = ""
  scaleEl.style.height = ""

  const availableWidth = viewportContent.clientWidth
  const availableHeight = viewportContent.clientHeight
  const rect = scaleEl.getBoundingClientRect()
  const contentWidth = Math.max(scaleEl.scrollWidth, rect.width)
  const contentHeight = Math.max(scaleEl.scrollHeight, rect.height)

  if (!availableWidth || !availableHeight || !contentWidth || !contentHeight) return

  const fitScale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight)
  scaleEl.style.width = `${availableWidth / fitScale}px`
  scaleEl.style.transformOrigin = "top left"
  scaleEl.style.transform = `scale(${fitScale})`
}

/** 等待 iframe 文档资源就绪（统一走共享底座，外层套 CARD_RESOURCE_TIMEOUT_MS 超时） */
function waitForIframeReady(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc) return Promise.resolve()
  return withTimeout(
    waitForDocumentResources(doc, win, CARD_RESOURCE_CONFIG),
    CARD_RESOURCE_TIMEOUT_MS,
    "卡片资源加载"
  )
}

/**
 * 将单张卡片渲染为 PNG Blob
 * 复用 renderSlideToBlob 的离屏 iframe 模式
 */
export async function renderCardToBlob(
  card: SmartCard,
  targetWidth: number,
  targetHeight: number,
  scale = 2,
  options?: SmartCardRenderOptions
): Promise<Blob> {
  const renderMode = options?.pagingMode ?? card.exportMode ?? "semantic"
  const renderCard: SmartCard = {
    ...card,
    exportMode: renderMode,
    dynamicMaxHeight: options?.dynamicMaxHeight ?? card.dynamicMaxHeight,
  }
  const viewport = getRenderViewport(renderCard, targetWidth, targetHeight)
  const handle = createOffscreenIframe(viewport.width, viewport.height, card.bg ?? "#fff")
  handle.iframe.srcdoc = card.html

  try {
    // 等待加载
    await handle.waitForLoad(CARD_LOAD_TIMEOUT_MS)

    await waitForIframeReady(handle.iframe)

    const iframe = handle.iframe
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

    if (renderMode === "auto-fit") {
      applyAutoFitScale(doc)
    }

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
      const presetScale = renderMode === "dynamic"
        ? targetWidth / rect.width
        : Math.min(targetWidth / rect.width, targetHeight / rect.height)
      const captureScale = Math.max(0.25, Math.min(5, presetScale * Math.max(scale, 1)))
      const captureHeight = renderMode === "dynamic"
        ? Math.min(Math.ceil(Math.max(target.scrollHeight, rect.height, targetHeight)), renderCard.dynamicMaxHeight ?? viewport.height)
        : Math.ceil(rect.height)
      const blob = await withTimeout(
        domToBlob(target, {
          scale: captureScale,
          width: Math.ceil(rect.width),
          height: captureHeight,
          backgroundColor,
        }),
        timeoutMs,
        `卡片 #${card.index + 1} 截图`
      )
      if (!blob) throw new Error("卡片截图转换失败")
      if (renderMode === "dynamic") return blob
      return fitBlobToTargetSize(blob, targetWidth, targetHeight, backgroundColor)
    } finally {
      if (prevHtmlStyle === null) doc.documentElement.removeAttribute("style")
      else doc.documentElement.setAttribute("style", prevHtmlStyle)
      if (prevBodyStyle === null) doc.body.removeAttribute("style")
      else doc.body.setAttribute("style", prevBodyStyle)
    }
  } finally {
    handle.dispose()
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
  onProgress?: (i: number, total: number) => void,
  options?: SmartCardRenderOptions
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
      const blob = await renderCardToBlob(card, targetWidth, targetHeight, 2, options)
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
  filename: string,
  options?: SmartCardRenderOptions
): Promise<ExportResult> {
  const blob = await renderCardToBlob(card, targetWidth, targetHeight, 2, options)
  return saveBlobAs(blob, filename)
}

// ---------------------------------------------------------------------------
// 6. 文件保存辅助
// ---------------------------------------------------------------------------

// saveBlobAs 已统一收口到 ./shared/file-save.ts（更严谨的 isTauri 判定 + 友好 filter），
// 本文件按需 import。

// ---------------------------------------------------------------------------
// 7. 生成缩略图（用于 UI 预览）
// ---------------------------------------------------------------------------

/**
 * 为卡片生成低分辨率的缩略图 DataURL
 */
export async function renderCardThumbnail(
  card: SmartCard,
  thumbWidth = 270,
  thumbHeight = 360,
  options?: SmartCardRenderOptions
): Promise<string> {
  const blob = await renderCardToBlob(card, thumbWidth, thumbHeight, 1, options)
  return withTimeout(new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("生成卡片缩略图失败"))
    reader.readAsDataURL(blob)
  }), CARD_FILE_READER_TIMEOUT_MS, `卡片 #${card.index + 1} 缩略图读取`)
}
