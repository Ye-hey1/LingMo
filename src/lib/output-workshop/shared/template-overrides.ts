/**
 * 模板自定义覆盖的纯逻辑（UI 配置 → 预设查询 + prompt 文本生成）
 *
 * 原属组件层 workshop-controls.ts，但 lib 的 prompt 生成需要调用 buildTemplateOverridePrompt。
 * 为消除 lib→components 的反向依赖，将其中无 React/DOM 依赖的纯逻辑下沉到此处；
 * 组件层 workshop-controls.ts 改为 re-export 保持对外路径不变。
 */

import type { PreviewSizePreset, TemplateOverrides } from "./types"

export const PREVIEW_SIZE_PRESETS: PreviewSizePreset[] = [
  { id: "3:4", label: "3:4", width: 1080, height: 1440, description: "小红书竖卡" },
  { id: "4:5", label: "4:5", width: 1080, height: 1350, description: "信息流封面" },
  { id: "1:1", label: "1:1", width: 1080, height: 1080, description: "方形卡片" },
  { id: "9:16", label: "9:16", width: 1080, height: 1920, description: "竖版长海报" },
  { id: "16:9", label: "16:9", width: 1920, height: 1080, description: "演示页" },
  { id: "auto", label: "自适应", width: 0, height: 0, description: "按页面内容" },
]

export function getPresetById(id: PreviewSizePreset["id"]): PreviewSizePreset {
  return PREVIEW_SIZE_PRESETS.find((preset) => preset.id === id) ?? PREVIEW_SIZE_PRESETS[0]
}

/**
 * 把模板自定义覆盖参数渲染成注入 prompt 的文本块。
 */
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
