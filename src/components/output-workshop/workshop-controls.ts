"use client"

import type {
  BuildStage,
  ExportTarget,
  MermaidRenderMode,
  PreviewSizePreset,
  TemplateOverrides,
} from "./types"

export const PREVIEW_SIZE_PRESETS: PreviewSizePreset[] = [
  { id: "3:4", label: "3:4", width: 1080, height: 1440, description: "小红书竖卡" },
  { id: "4:5", label: "4:5", width: 1080, height: 1350, description: "信息流封面" },
  { id: "1:1", label: "1:1", width: 1080, height: 1080, description: "方形卡片" },
  { id: "9:16", label: "9:16", width: 1080, height: 1920, description: "竖版长海报" },
  { id: "16:9", label: "16:9", width: 1920, height: 1080, description: "演示页" },
  { id: "auto", label: "自适应", width: 0, height: 0, description: "按页面内容" },
]

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
  { id: "parse", label: "解析内容" },
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

export function getPresetById(id: PreviewSizePreset["id"]): PreviewSizePreset {
  return PREVIEW_SIZE_PRESETS.find((preset) => preset.id === id) ?? PREVIEW_SIZE_PRESETS[0]
}

export function getTemplateDefaultSizePreset(templateId: string): PreviewSizePreset["id"] {
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

export function buildTemplateOverridePrompt(overrides: TemplateOverrides): string {
  const size = getPresetById(overrides.sizePresetId)
  return [
    "模板自定义覆盖参数：",
    `- 导出比例：${size.label}${size.id === "auto" ? "" : ` (${size.width}x${size.height})`}`,
    `- 字体：${overrides.fontFamily}`,
    `- 基准字号：${overrides.fontSize}px`,
    `- 行高：${overrides.lineHeight}`,
    `- 主题色：${overrides.themeColor}`,
    `- 卡片间距：${overrides.cardGap}px`,
    `- 背景风格：${overrides.backgroundStyle}`,
    `- 贴纸元素：${overrides.stickersEnabled ? "开启" : "关闭"}`,
    `- 安全区：${overrides.safeAreaEnabled ? "开启，避免文字贴边或被平台 UI 遮挡" : "关闭"}`,
    `- Mermaid 图表模式：${overrides.mermaidRenderMode === "card" ? "图表转卡片" : "图表作为图片嵌入"}`,
  ].join("\n")
}

export function getMermaidRenderModeLabel(mode: MermaidRenderMode): string {
  return mode === "card" ? "图表转卡片" : "图片嵌入"
}
