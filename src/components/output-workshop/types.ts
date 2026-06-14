/**
 * 输出工坊模块共享类型定义
 */

export type GenerationStatus = "idle" | "generating" | "streaming" | "done" | "error"
export type ViewMode = "desktop" | "mobile" | "locked"
export type PreviewWorkspaceTab = "preview" | "code" | "log" | "outline"
export type SourceWorkspaceTab = "edit" | "history" | "outline"
export type ExportTarget = "png" | "pdf" | "long-png" | "split-png" | "smart-card" | "markdown" | "html" | "pptx"
export type MermaidRenderMode = "card" | "image"

export interface PreviewSizePreset {
  id: "3:4" | "4:5" | "1:1" | "9:16" | "16:9" | "auto"
  label: string
  width: number
  height: number
  description: string
}

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

export interface BuildStage {
  id: "parse" | "template" | "mermaid" | "preview"
  label: string
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

export interface ExtractedSection {
  title: string
  level?: number
  body?: string
  bullets?: string[]
  importance?: "low" | "medium" | "high"
  startOffset?: number
  endOffset?: number
  startLine?: number
  endLine?: number
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
