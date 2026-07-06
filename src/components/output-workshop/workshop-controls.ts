"use client"

import type {
  BuildStage,
  ExportTarget,
  MermaidRenderMode,
  PreviewSizePreset,
  TemplateOverrides,
} from "./types"

// PREVIEW_SIZE_PRESETS / getPresetById / buildTemplateOverridePrompt 已下沉到
// lib 层 shared/template-overrides.ts（被 lib 的 prompt 生成复用），这里 re-export
// 保持组件层旧导入路径 `@/components/output-workshop/workshop-controls` 不变。
export {
  PREVIEW_SIZE_PRESETS,
  getPresetById,
  buildTemplateOverridePrompt,
} from "@/lib/output-workshop/shared/template-overrides"

export const DEFAULT_TEMPLATE_OVERRIDES: TemplateOverrides = {
  fontFamily: "Noto Sans SC",
  fontSize: 24,
  lineHeight: 1.55,
  themeColor: "#2563eb",
  cardGap: 32,
  backgroundStyle: "soft",
  stickersEnabled: true,
  safeAreaEnabled: true,
  sizePresetId: "3:4",
  mermaidRenderMode: "card",
}

export const BUILD_STAGES: BuildStage[] = [
  { id: "parse", label: "提炼内容" },
  { id: "template", label: "套用模板" },
  { id: "mermaid", label: "渲染图表" },
  { id: "preview", label: "生成预览" },
]

export const EXPORT_TARGETS: Array<{ id: ExportTarget; label: string; description: string }> = [
  { id: "png", label: "PNG", description: "当前预览高清图" },
  { id: "pdf", label: "PDF", description: "打印或另存 PDF" },
  { id: "long-png", label: "长图", description: "完整页面长图" },
  { id: "split-png", label: "切割导出", description: "多卡片/多页 PNG 包" },
  { id: "markdown", label: "Markdown", description: "原始内容" },
  { id: "html", label: "HTML", description: "自包含网页" },
]

export function getTemplateDefaultSizePreset(templateId: string): PreviewSizePreset["id"] {
  if (templateId.startsWith("social-redbook-")) return "3:4"

  switch (templateId) {
    case "social-xiaohongshu":
      return "3:4"
    case "social-card":
      return "3:4"
    case "poster-magazine":
    case "poster-hero":
      return "9:16"
    case "deck-minimal":
    case "deck-tech":
      return "16:9"
    default:
      return "auto"
  }
}

export function getMermaidRenderModeLabel(mode: MermaidRenderMode): string {
  return mode === "card" ? "图表转卡片" : "图片嵌入"
}
