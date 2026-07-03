import type { OutputTemplate } from "./templates"
import { hasStyleBuilder } from "./styles/index"
import { isWechatStyleId } from "./wechat-styles"
import { isThemedSocialTemplate } from "./social-redbook-builder"

export { isThemedSocialTemplate }

/**
 * 微信一键排版模板的启发式判定（mode / styleId / id 前缀 / previewTone / features）。
 * 当模板显式声明 `pipeline: "wechat"` 时直接命中，否则回退到以下规则。
 */
export function isLocalWechatOutputTemplate(template: OutputTemplate | null | undefined, templateId?: string): boolean {
  if (template?.pipeline === "wechat") return true
  const id = templateId || template?.id || ""
  if (template?.mode === "wechat") return true
  if (isWechatStyleId(id)) return true
  if (id.startsWith("wechat-")) return true
  if (template?.previewTone === "wechat-article") return true
  return Boolean(template?.features?.some((feature) => feature === "一键排版" || feature.includes("图文复制")))
}

/**
 * 本地样式模板（AI 结构解析 + 本地 buildStyle 渲染）的判定。
 * 当模板显式声明 `pipeline: "local-style"` 时直接命中；
 * 显式声明 `pipeline: "creative"` 时直接排除；否则回退到启发式规则。
 */
export function isLocalStyleOutputTemplate(template: OutputTemplate | null | undefined, templateId?: string): boolean {
  if (template?.pipeline === "local-style") return true
  if (template?.pipeline === "creative") return false
  const id = templateId || template?.id || ""
  if (!id || isLocalWechatOutputTemplate(template, id)) return false
  if (template?.mode === "creative") return false
  // 7 个主题化社交卡片模板（social-editorial 等）有 previewTheme 但无 STYLE_BUILDERS 渲染器，
  // 走 buildThemedSocialCards 组图管线，故纳入 local-style。
  if (isThemedSocialTemplate(id)) return true
  return hasStyleBuilder(id)
}
