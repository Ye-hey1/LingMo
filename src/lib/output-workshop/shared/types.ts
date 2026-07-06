/**
 * output-workshop 共享类型定义
 *
 * lib 层与组件层共用的类型集中在此，避免 lib 反向依赖 components，
 * 也避免 export.ts / smart-card-export.ts 等实现文件互相 import 类型。
 */

/**
 * 从输入材料中解析出的一段结构化内容（一个展示单元）。
 * 合并自原 components/types.ts 与 shared/builder-utils.ts 两份定义，
 * 字段为两者并集；level/offset/line 由组件层大纲视图使用，lib 层可忽略。
 */
export interface ExtractedSection {
  title: string
  /** 标题层级（1~6），由组件层大纲使用 */
  level?: number
  body?: string
  bullets?: string[]
  importance?: "low" | "medium" | "high"
  /** 源文本中的字符偏移区间，由组件层定位使用 */
  startOffset?: number
  endOffset?: number
  /** 源文本中的行号区间，由组件层定位使用 */
  startLine?: number
  endLine?: number
}

/** 单张智能卡片导出被跳过的原因记录 */
export interface SmartCardExportSkip {
  index: number
  title: string
  reason: string
}

// ---------------------------------------------------------------------------
// 模板自定义覆盖（UI 配置 → prompt 注入）
// 以下类型原属组件层，但 lib 的 prompt 生成需要读取它们；为消除 lib→components
// 反向依赖，统一下沉到此处，组件层改为 re-export。
// ---------------------------------------------------------------------------

export type MermaidRenderMode = "card" | "image"

export interface PreviewSizePreset {
  /** 预设比例 id，与 PREVIEW_SIZE_PRESETS 的取值一一对应 */
  id: "3:4" | "4:5" | "1:1" | "9:16" | "16:9" | "auto"
  label: string
  width: number
  height: number
  /** 预设用途说明，仅用于 UI 展示 */
  description?: string
}

/** 模板自定义覆盖参数（来自预览面板的控件），用于约束生成结果的尺寸/字体/主题色等 */
export interface TemplateOverrides {
  fontFamily: string
  fontSize: number
  lineHeight: number
  themeColor: string
  cardGap: number
  backgroundStyle: string
  stickersEnabled: boolean
  safeAreaEnabled: boolean
  sizePresetId: PreviewSizePreset["id"]
  mermaidRenderMode: MermaidRenderMode
}

/**
 * 通用导出结果。
 * `exportedCount/totalCount/skipped` 由智能卡片批量导出使用，单文件导出可忽略。
 */
export interface ExportResult {
  fileName: string
  filePath?: string
  canceled?: boolean
  /** 批量导出时实际成功导出的数量 */
  exportedCount?: number
  /** 批量导出时的目标总数量 */
  totalCount?: number
  /** 批量导出时被跳过的卡片及原因 */
  skipped?: SmartCardExportSkip[]
}
