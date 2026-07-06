/**
 * 离屏 iframe 截图的共享底座
 *
 * export.ts（幻灯片/长图）与 smart-card-export.ts（智能卡片）原本各写一套
 * 近乎相同的资源等待逻辑（等 stylesheet → 等 fonts.ready → 等图片 → waitUntilLoad
 * → nextFrame/sleep/nextFrame），超时值还不一致，导致一边等字体、另一边不等字体
 * 这类隐性漂移。这里把真正同构的底座抽出来统一收口。
 *
 * 注意：两边的「捕获」逻辑差异很大（整页撑高 vs 目标元素 + scale + fitBlob），
 * 保留在各自文件中；本模块只提供计时、资源等待、离屏 iframe 宿主三个底座。
 */

import { waitUntilLoad } from "modern-screenshot"
import { logWarn } from "./log"

// ---------------------------------------------------------------------------
// 计时器
// ---------------------------------------------------------------------------

/** 轮询等待连续两帧渲染完成，确保 reflow/repaint 已生效 */
export const nextFrame = (): Promise<void> =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))

/**
 * 给一个 Promise 套上超时，超时则 reject 带 label 的错误，finally 清理 timer。
 * 用于让资源加载/截图不会无限挂起。
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label}超时，请检查远程图片、字体或复杂样式`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

// ---------------------------------------------------------------------------
// 资源等待
// ---------------------------------------------------------------------------

/** 各类资源加载的兜底超时（ms） */
export interface ResourceTimeoutConfig {
  /** iframe 文档 readyState 达到 complete 的兜底 */
  documentReadyMs?: number
  /** 单个 <link rel=stylesheet> 加载兜底 */
  stylesheetMs?: number
  /** doc.fonts.ready 兜底（0 表示不单独超时，直接 await） */
  fontsMs?: number
  /** 单张图片 load/decode 兜底 */
  imageMs?: number
  /** modern-screenshot waitUntilLoad 的兜底 */
  waitUntilLoadMs?: number
  /** 末尾 reflow 预留时间 */
  settleMs?: number
}

/** 带兜底的样式表加载：已就绪立即 resolve，否则监听 load，超时强制 resolve */
function waitStylesheet(link: HTMLLinkElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((res) => {
    if (link.sheet) return res()
    const done = () => res()
    link.addEventListener("load", done, { once: true })
    // 与原实现一致： stylesheet 加载失败也按超时兜底放过，不阻塞截图
    link.addEventListener("error", done, { once: true })
    setTimeout(done, timeoutMs)
  })
}

/** 带兜底的图片加载：已就绪立即 resolve，否则监听 load/error 并尝试 decode */
function waitImage(img: HTMLImageElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((res) => {
    if (img.complete && img.naturalWidth > 0) return res()
    const done = () => res()
    img.addEventListener("load", done, { once: true })
    img.addEventListener("error", done, { once: true })
    if ("decode" in img) img.decode().then(done, done)
    setTimeout(done, timeoutMs)
  })
}

/**
 * 等待文档的所有资源（样式表、字体、图片、Tailwind）稳定加载。
 *
 * 合并自 export.ts 的 `waitForDocumentReady` 与 smart-card-export.ts 的
 * `waitForIframeReadyInner`。两个调用方各自传入原始超时配置以保持行为等价。
 *
 * 资源超时一律按「兜底放过」处理（截图不应因单张图失败而整体崩溃），
 * 这与原两处实现一致；如需留痕可在 D1 阶段接入 logWarn。
 */
export async function waitForDocumentResources(
  doc: Document,
  win: Window | null | undefined,
  config: ResourceTimeoutConfig = {}
): Promise<void> {
  const {
    documentReadyMs = 6000,
    stylesheetMs = 4000,
    fontsMs = 0,
    imageMs = 5000,
    waitUntilLoadMs = 5000,
    settleMs = 100,
  } = config

  // readyState
  if (doc.readyState !== "complete") {
    await new Promise<void>((res) => {
      const done = () => res()
      doc.addEventListener("readystatechange", () => {
        if (doc.readyState === "complete") done()
      })
      win?.addEventListener?.("load", done, { once: true })
      setTimeout(done, documentReadyMs)
    })
  }

  // 样式表
  const sheets = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
  await Promise.all(sheets.map((link) => waitStylesheet(link, stylesheetMs)))

  // 字体
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) {
      if (fontsMs > 0) {
        await withTimeout(fonts.ready, fontsMs, "字体加载").catch(() => undefined)
      } else {
        await fonts.ready
      }
    }
  } catch (error) {
    // 字体加载失败不阻塞截图，留痕便于排查"字体没生效"类问题
    logWarn("fonts-ready", error)
  }

  // 图片
  const imgs = Array.from(doc.images)
  await Promise.all(imgs.map((img) => waitImage(img, imageMs)))

  // modern-screenshot 整体兜底
  try {
    await waitUntilLoad(doc.documentElement, { timeout: waitUntilLoadMs })
  } catch (error) {
    // waitUntilLoad 失败不阻塞截图，留痕便于排查资源加载问题
    logWarn("wait-until-load", error)
  }

  // reflow 预留
  await nextFrame()
  await sleep(settleMs)
  await nextFrame()
}

// ---------------------------------------------------------------------------
// 离屏 iframe 宿主
// ---------------------------------------------------------------------------

export interface OffscreenIframeHandle {
  /** 包裹层（已 appendChild 到 document.body） */
  wrap: HTMLDivElement
  /** iframe 元素（尚未设置 srcdoc，由调用方决定） */
  iframe: HTMLIFrameElement
  /** 等待 iframe 文档 readyState=complete，带兜底超时 */
  waitForLoad: (timeoutMs?: number) => Promise<void>
  /** 从 DOM 移除包裹层（应在 finally 中调用） */
  dispose: () => void
}

/**
 * 创建离屏的 iframe 宿主（定位到视口外），返回带 dispose 的句柄。
 * 合并自 renderSlideToBlob / renderCardToBlob 中重复的「创建 wrap+iframe → appendChild」样板。
 */
export function createOffscreenIframe(width: number, height: number, bg = "#fff"): OffscreenIframeHandle {
  const wrap = document.createElement("div")
  wrap.style.cssText = `
    position: fixed;
    top: 0; left: -100000px;
    width: ${width}px; height: ${height}px;
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  `

  const iframe = document.createElement("iframe")
  iframe.style.cssText = `
    width: ${width}px; height: ${height}px;
    border: 0; background: ${bg};
  `

  wrap.appendChild(iframe)
  document.body.appendChild(wrap)

  return {
    wrap,
    iframe,
    waitForLoad: (timeoutMs = 3500) =>
      new Promise<void>((res) => {
        const done = () => res()
        if (iframe.contentDocument?.readyState === "complete") return done()
        iframe.addEventListener("load", done, { once: true })
        setTimeout(done, timeoutMs)
      }),
    dispose: () => {
      wrap.remove()
    },
  }
}
