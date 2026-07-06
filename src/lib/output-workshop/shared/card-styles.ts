/**
 * 导出渲染的共享 CSS 样式片段
 *
 * export.ts 与 smart-card-export.ts 在构建离屏渲染 HTML 时大量重复了相同的 CSS：
 * 基础 reset、动画禁用、尺寸限制、元素显隐控制。将共用的片段抽到本模块，
 * 由各自按需拼接，避免维护两份近乎相同的字符串。
 */

/** 离屏渲染的通用基础 reset（默认使用 flex 居中） */
export const BASE_RESET_CSS =
  "html, body { margin:0; padding:0; height:100vh; overflow:hidden; }" +
  "body { display:flex; align-items:center; justify-content:center; }"

/** 离屏渲染的基础 reset（grid 居中版本，用于 smart-card-export） */
export const BASE_RESET_GRID_CSS =
  "html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }" +
  "body { display:grid; place-items:center; }"

/**
 * 生成禁用动画、过渡、光标的 CSS，支持自定义根选择器前缀。
 * 默认使用 .card-root 前缀，smart-card-export 可传入 .lingmo-smart-card-export-root。
 */
export function buildAnimationDisableCss(rootSelector = ".card-root"): string {
  return `${rootSelector} *, ${rootSelector} *::before, ${rootSelector} *::after { ` +
    `animation: none !important; transition: none !important; caret-color: transparent !important; }`
}

/**
 * 生成子元素尺寸上限限制 CSS，支持自定义根选择器前缀。
 */
export function buildChildSizeLimitCss(rootSelector = ".card-root"): string {
  return `${rootSelector} > * { max-width: 100%; max-height: 100%; }`
}

/**
 * 生成通用元素显隐覆盖 CSS（content/scale/slide/inner），支持自定义根选择器前缀。
 */
export function buildVisibilityCss(rootSelector = ".card-root"): string {
  return [
    `${rootSelector} .card-inner, ${rootSelector} .cover-inner { width: 100% !important; height: 100% !important; }`,
    `${rootSelector} .card-content, ${rootSelector} .card-content-scale { opacity: 1 !important; visibility: visible !important; }`,
    `${rootSelector} .slide, ${rootSelector} .deck-slide, ${rootSelector} .gz-deck-slide { opacity: 1 !important; pointer-events: auto !important; position: relative !important; inset: auto !important; transform: none !important; margin: 0 !important; }`,
    `${rootSelector} .gz-deck-slide { width: 100% !important; height: 100% !important; }`,
  ].join("\n")
}

/**
 * 通用卡片根容器样式（grid 居中），支持自定义类名。
 */
export function buildCardRootContainerCss(rootClass = ".card-root"): string {
  return `${rootClass} { width: 100%; height: 100%; display: grid; place-items: center; overflow: hidden; }`
}

/** 通用 Slide 布局覆盖（确保 slide 占满视口且居中） */
export const SLIDE_LAYOUT_CSS =
  ".slide { transform: none !important; margin: 0 !important; width: 100vw !important; height: 100vh !important; display: flex !important; align-items: center !important; justify-content: center !important; }" +
  ".slide-content { opacity: 1 !important; transform: none !important; }"

/**
 * 组装一套适用于「以 rootClass 为根的离屏卡片渲染」的完整 CSS。
 * 各调用方可在此基础上追加自己的选择器前缀映射（export.ts → .slide 等）。
 */
export function buildCardRootStyles(rootClass = ".card-root", extraCss = ""): string {
  return [
    BASE_RESET_GRID_CSS,
    buildCardRootContainerCss(rootClass),
    buildAnimationDisableCss(rootClass),
    buildChildSizeLimitCss(rootClass),
    buildVisibilityCss(rootClass),
    extraCss,
  ].filter(Boolean).join("\n")
}

/**
 * 构建 export.ts 中单个 Slide 的独立 HTML 所需的 style 片段。
 * 仅包含 Slide 自身的布局覆盖，不包含完整的根容器 CSS。
 */
export function buildSlideStandaloneCss(): string {
  return [BASE_RESET_CSS, SLIDE_LAYOUT_CSS].join("\n")
}
