/**
 * 智能排版 HTML 构建器（facade）
 * 实际实现已按风格拆分到 ./styles/*，本文件仅 re-export 以保持对外 API 不变。
 * 调用方可改用 ./styles 的 buildStyle(templateId, options) 替代 switch 分发。
 */
export type { BuildHtmlOptions, ExtractedSection } from "./shared/builder-utils"
export * from "./styles/index"
