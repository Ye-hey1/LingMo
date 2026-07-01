import type { OutputTemplate } from "./templates"
import { hasStyleBuilder } from "./styles/index"
import { isWechatStyleId } from "./wechat-styles"

export function isLocalWechatOutputTemplate(template: OutputTemplate | null | undefined, templateId?: string): boolean {
  const id = templateId || template?.id || ""
  if (template?.mode === "wechat") return true
  if (isWechatStyleId(id)) return true
  if (id.startsWith("wechat-")) return true
  if (template?.previewTone === "wechat-article") return true
  return Boolean(template?.features?.some((feature) => feature === "一键排版" || feature.includes("图文复制")))
}

export function isLocalStyleOutputTemplate(template: OutputTemplate | null | undefined, templateId?: string): boolean {
  const id = templateId || template?.id || ""
  if (!id || isLocalWechatOutputTemplate(template, id)) return false
  return hasStyleBuilder(id)
}
