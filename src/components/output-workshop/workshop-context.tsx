"use client"

import * as React from "react"
import type {
  ViewMode,
  PreviewWorkspaceTab,
  SourceWorkspaceTab,
  ExtractedSection,
  TemplateOverrides,
} from "./types"
import type { DeckParsed } from "@/lib/output-workshop/export"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import type { MokaPanelMode, MokaPanelPlatform } from "./moka-design-panel"
import type { useOutputGeneration } from "@/hooks/use-output-generation"
import type { useOutputHistory } from "@/hooks/use-output-history"
import type { useOutputFiles } from "@/hooks/use-output-files"
import type { useOutputTemplates } from "@/hooks/use-output-templates"

/**
 * 智能排版工作区共享上下文。
 *
 * 阶段4 组件解耦：将 index.tsx 的核心 state、派生值、4 个 hook 返回对象与
 * 本地 handler 聚合到此 Context，使 SourcePanel / PreviewPanel / TemplatePicker
 * 不再依赖层层 props 透传，改用 useWorkshopContext() 直接取值。
 *
 * 设计要点：templates / history / generation / files 保持 hook 返回的对象形式，
 * 子组件用 ctx.templates.xxx 等访问，避免把上百个字段平铺到顶层。
 */
export interface WorkshopContextValue {
  // ---- 输入态 ----
  title: string
  sourceContent: string
  setSourceContent: (v: string) => void
  sourceLabel: string
  setSourceLabel: (v: string) => void
  customInstructions: string
  setCustomInstructions: (v: string) => void
  showAdvanced: boolean
  setShowAdvanced: (v: boolean) => void

  // ---- UI 态 ----
  previewTab: PreviewWorkspaceTab
  setPreviewTab: (tab: PreviewWorkspaceTab) => void
  sourceWorkspaceTab: SourceWorkspaceTab
  setSourceWorkspaceTab: (v: SourceWorkspaceTab) => void
  sourcePanelCollapsed: boolean
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  activeSlideIdx: number
  setActiveSlideIdx: (idx: number) => void
  activeOutlineIndex: number | null

  // ---- 模板覆写态 ----
  templateOverrides: TemplateOverrides
  setTemplateOverrides: (next: TemplateOverrides) => void

  // ---- Moka 态 ----
  mokaMode: MokaPanelMode
  setMokaMode: (mode: MokaPanelMode) => void
  mokaPlatform: MokaPanelPlatform
  setMokaPlatform: (platform: MokaPanelPlatform) => void
  mokaStyleId: string
  setMokaStyleId: (styleId: string) => void
  mokaPaletteId: string
  setMokaPaletteId: (paletteId: string) => void
  mokaReferenceImageDataUrl: string
  mokaReferenceImageName: string
  onMokaReferenceImageChange: (dataUrl: string, name: string) => void
  onClearMokaReferenceImage: () => void

  // ---- 生成产物 ----
  generatedHtml: string
  setGeneratedHtml: (html: string) => void

  // ---- 派生值 ----
  selectedTemplate: OutputTemplate
  selectedTemplateId: string
  templateList: OutputTemplate[]
  isBuilding: boolean
  hasGeneratedOutput: boolean
  parsedDeckData: DeckParsed
  sourceOutlineSections: ExtractedSection[]
  isCsvDetected: boolean

  // ---- Hook 聚合对象 ----
  templates: ReturnType<typeof useOutputTemplates>
  history: ReturnType<typeof useOutputHistory>
  generation: ReturnType<typeof useOutputGeneration>
  files: ReturnType<typeof useOutputFiles>

  // ---- 本地 handler ----
  toggleSourcePanel: () => void
  scrollToSlide: (idx: number) => void
  handleSelectOutlineSection: (section: ExtractedSection, index: number) => void
  onOpenMarket: () => void

  // ---- Refs ----
  iframeRef: React.RefObject<HTMLIFrameElement>
}

const WorkshopContext = React.createContext<WorkshopContextValue | null>(null)

export function WorkshopProvider({
  value,
  children,
}: {
  value: WorkshopContextValue
  children: React.ReactNode
}) {
  return (
    <WorkshopContext.Provider value={value}>
      {children}
    </WorkshopContext.Provider>
  )
}

/**
 * 读取工作区上下文。必须在 <WorkshopProvider> 内部使用，
 * 否则抛出错误以便在开发期快速定位缺失 Provider 的问题。
 */
export function useWorkshopContext(): WorkshopContextValue {
  const ctx = React.useContext(WorkshopContext)
  if (!ctx) {
    throw new Error("useWorkshopContext 必须在 <WorkshopProvider> 内部使用")
  }
  return ctx
}
