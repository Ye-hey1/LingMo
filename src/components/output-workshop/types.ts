/**
 * 智能排版模块共享类型定义
 */

// ExtractedSection 已统一下沉到 lib 层 shared/types.ts，这里 re-export 保持
// 组件层旧导入路径 `@/components/output-workshop/types` 不变，同时消除 lib→components 反向依赖。
export type { ExtractedSection } from "@/lib/output-workshop/shared/types"

export type GenerationStatus = "idle" | "generating" | "streaming" | "done" | "error"
export type GenerationTelemetryPhase =
  | "idle"
  | "preparing"
  | "local-build"
  | "requesting-ai"
  | "receiving"
  | "quality-check"
  | "repairing"
  | "finalizing"
  | "done"
  | "error"
export type ViewMode = "desktop" | "mobile" | "locked"
export type PreviewWorkspaceTab = "preview" | "code" | "log" | "outline"
export type SourceWorkspaceTab = "edit" | "history" | "outline"
export type ExportTarget = "png" | "pdf" | "long-png" | "split-png" | "smart-card" | "markdown" | "html" | "pptx"
// MermaidRenderMode / PreviewSizePreset / TemplateOverrides 已统一下沉到 lib 层
// shared/types.ts（被 lib 的 prompt 生成复用），这里 re-export 保持组件层旧导入路径不变。
export type { MermaidRenderMode, PreviewSizePreset, TemplateOverrides } from "@/lib/output-workshop/shared/types"

export type BuildStageId = "parse" | "template" | "mermaid" | "preview"

export interface BuildStage {
  id: BuildStageId
  label: string
}

export interface GenerationTelemetry {
  phase: GenerationTelemetryPhase
  phaseLabel: string
  startedAt: number | null
  requestStartedAt: number | null
  firstByteAt: number | null
  lastChunkAt: number | null
  completedAt: number | null
  outputChars: number
  promptChars: number
  qualityChecked: boolean
  qualityFindingCount: number
  severeFindingCount: number
  repairTriggered: boolean
  qualitySummary: string
}

export interface ExportRecord {
  target: ExportTarget
  label: string
  fileName?: string
  filePath?: string
  finishedAt: number
}

export interface HtmlOutlineItem {
  level: string
  text: string
}

export interface HistorySnapshot {
  id: string
  timestamp: number
  title: string
  templateId: string
  customInstructions: string
  sourceContent: string
  generatedHtml: string
}

export interface OutputWorkshopModalProps {
  open: boolean
  onClose: () => void
  linkedFilePath?: string | null
  linkedFileContent?: string | null
}
