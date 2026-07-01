/**
 * 智能排版风格构建器注册表
 * 按 templateId 分发到对应 build* 函数，替代 use-output-generation 里的 19-case switch。
 */
import type { BuildHtmlOptions } from "../shared/builder-utils"
import { buildEditorialArticle } from "./article-editorial"
import { buildKamiParchment } from "./article-kami"
import { buildBrutalistStyle } from "./article-brutalist"
import { buildGuizangDeck } from "./deck-minimal"
import { buildTechSharing } from "./deck-tech"
import { buildMagazinePoster } from "./poster-magazine"
import { buildHeroPoster } from "./poster-hero"
import { buildDataDashboard } from "./data-dashboard"
import { buildInfographic } from "./data-infographic"
import { buildGuizangSocialCard } from "./social-card"
import { buildXiaohongshuStyle } from "./social-xiaohongshu"
import { buildLearningCards } from "./learning-flashcard"
import { buildMindmapStyle } from "./learning-mindmap"
import { buildWaterfallStyle } from "./social-waterfall"
import { buildBentoStyle } from "./visual-bento"
import { buildBusinessReportStyle } from "./report-business"
import { buildLiquidGlassStyle } from "./read-glass"
import { buildAccordionManualStyle } from "./read-accordion"
import { buildDarkTechStyle } from "./read-dark-tech"

export type StyleBuilder = (options: BuildHtmlOptions) => string

/** templateId -> 风格构建器 */
export const STYLE_BUILDERS: Record<string, StyleBuilder> = {
  "article-editorial": buildEditorialArticle,
  "article-kami": buildKamiParchment,
  "article-brutalist": buildBrutalistStyle,
  "deck-minimal": buildGuizangDeck,
  "deck-tech": buildTechSharing,
  "poster-magazine": buildMagazinePoster,
  "poster-hero": buildHeroPoster,
  "data-dashboard": buildDataDashboard,
  "data-infographic": buildInfographic,
  "social-card": buildGuizangSocialCard,
  "social-xiaohongshu": buildXiaohongshuStyle,
  "learning-flashcard": buildLearningCards,
  "learning-mindmap": buildMindmapStyle,
  "social-waterfall": buildWaterfallStyle,
  "visual-bento": buildBentoStyle,
  "report-business": buildBusinessReportStyle,
  "read-glass": buildLiquidGlassStyle,
  "read-accordion": buildAccordionManualStyle,
  "read-dark-tech": buildDarkTechStyle,
}

export function hasStyleBuilder(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STYLE_BUILDERS, templateId)
}

/** 按 templateId 分发风格构建（未知 id 回退到第一个风格） */
export function buildStyle(templateId: string, options: BuildHtmlOptions): string {
  return (STYLE_BUILDERS[templateId] ?? buildEditorialArticle)(options)
}

export { buildEditorialArticle } from "./article-editorial"
export { buildKamiParchment } from "./article-kami"
export { buildBrutalistStyle } from "./article-brutalist"
export { buildGuizangDeck } from "./deck-minimal"
export { buildTechSharing } from "./deck-tech"
export { buildMagazinePoster } from "./poster-magazine"
export { buildHeroPoster } from "./poster-hero"
export { buildDataDashboard } from "./data-dashboard"
export { buildInfographic } from "./data-infographic"
export { buildGuizangSocialCard } from "./social-card"
export { buildXiaohongshuStyle } from "./social-xiaohongshu"
export { buildLearningCards } from "./learning-flashcard"
export { buildMindmapStyle } from "./learning-mindmap"
export { buildWaterfallStyle } from "./social-waterfall"
export { buildBentoStyle } from "./visual-bento"
export { buildBusinessReportStyle } from "./report-business"
export { buildLiquidGlassStyle } from "./read-glass"
export { buildAccordionManualStyle } from "./read-accordion"
export { buildDarkTechStyle } from "./read-dark-tech"
