"use client"

import * as React from "react"
import {
  DownloadCloud,
  Globe,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
  Share2,
  Clipboard,
  Download,
  FileArchive,
  FileCheck2,
  FileCode,
  Printer,
  Save,
  ChevronDown,
  FileText,
  ImageIcon,
  Layers,
  FileImage,
  PanelLeftOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  installSkillsFromGitHub,
  createLocalCustomTemplate,
} from "@/lib/output-workshop/market"
import { openPath } from "@tauri-apps/plugin-opener"
import { useIsMobile } from "@/hooks/use-mobile"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { parseDeck, type DeckParsed } from "@/lib/output-workshop/export"

// Hooks
import { useOutputHistory } from "@/hooks/use-output-history"
import { useOutputFiles } from "@/hooks/use-output-files"
import { useOutputTemplates } from "@/hooks/use-output-templates"
import { useOutputGeneration } from "@/hooks/use-output-generation"

// Sub-components
import { TemplatePicker } from "./template-picker"
import { SourcePanel } from "./source-panel"
import { PreviewPanel } from "./preview-panel"
import { DeployPanel } from "./deploy-panel"
import { MarketModal } from "./market-modal"
import { SmartCardDialog } from "./smart-card-dialog"
import { WorkshopProvider, type WorkshopContextValue } from "./workshop-context"

// Types & utils
import type {
  ViewMode,
  PreviewWorkspaceTab,
  SourceWorkspaceTab,
  ExtractedSection,
  OutputWorkshopModalProps,
} from "./types"
import { splitContentIntoSections } from "./utils"
import {
  DEFAULT_TEMPLATE_OVERRIDES,
  getTemplateDefaultSizePreset,
} from "./workshop-controls"

export function OutputWorkshopModal({
  open,
  onClose,
  linkedFilePath,
  linkedFileContent,
}: OutputWorkshopModalProps) {
  const isMobile = useIsMobile()

  // Core input state
  const [title, setTitle] = React.useState("")
  const [sourceContent, setSourceContent] = React.useState("")
  const [sourceLabel, setSourceLabel] = React.useState("")
  const [customInstructions, setCustomInstructions] = React.useState("")
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [previewTab, setPreviewTab] = React.useState<PreviewWorkspaceTab>("preview")
  const [sourceWorkspaceTab, setSourceWorkspaceTab] = React.useState<SourceWorkspaceTab>("edit")
  const [sourcePanelCollapsed, setSourcePanelCollapsed] = React.useState(false)
  const sourcePanelRef = React.useRef<ImperativePanelHandle | null>(null)
  const [viewMode, setViewMode] = React.useState<ViewMode>("desktop")
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const [activeSlideIdx, setActiveSlideIdx] = React.useState(0)
  const [activeOutlineIndex, setActiveOutlineIndex] = React.useState<number | null>(null)
  const [templateOverrides, setTemplateOverrides] = React.useState(DEFAULT_TEMPLATE_OVERRIDES)
  const [showSmartCardDialog, setShowSmartCardDialog] = React.useState(false)

  // Market state (kept here because it involves install/create logic)
  const [showMarketModal, setShowMarketModal] = React.useState(false)
  const [githubUrl, setGithubUrl] = React.useState("")
  const [customTemplateName, setCustomTemplateName] = React.useState("")
  const [installingMarket, setInstallingMarket] = React.useState(false)
  const [installProgress, setInstallProgress] = React.useState("")

  // Hooks
  const templates = useOutputTemplates()
  // Template helpers
  const selectedTemplate = templates.selectedTemplate
  const templateList = templates.templateList
  const selectedTemplateId = templates.selectedTemplateId

  React.useEffect(() => {
    setTemplateOverrides((current) => ({
      ...current,
      sizePresetId: getTemplateDefaultSizePreset(selectedTemplateId),
    }))
  }, [selectedTemplateId])

  // Computed: parsed deck data
  const [generatedHtml, setGeneratedHtmlState] = React.useState("")
  const setGeneratedHtml = React.useCallback((html: string) => {
    setGeneratedHtmlState(html)
  }, [])

  const parsedDeckData = React.useMemo<DeckParsed>(() => {
    if (!generatedHtml) {
      return { isDeck: false, slides: [], head: "", bodyClass: "", bodyStyle: "", title: "" }
    }
    return parseDeck(generatedHtml)
  }, [generatedHtml])

  const sourceOutlineSections = React.useMemo(() => {
    return splitContentIntoSections(sourceContent)
  }, [sourceContent])

  const isCsvDetected = React.useMemo(() => {
    const trimmed = sourceContent.trim()
    if (!trimmed) return false
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return false
    const firstLine = lines[0]
    const separators = [",", "\t", ";"]
    let bestSeparator = ""
    let maxCount = 0
    for (const sep of separators) {
      const count = firstLine.split(sep).length - 1
      if (count > maxCount) {
        maxCount = count
        bestSeparator = sep
      }
    }
    if (maxCount < 1) return false
    const secondLine = lines[1]
    const secondCount = secondLine.split(bestSeparator).length - 1
    return secondCount === maxCount && maxCount > 0
  }, [sourceContent])

  // Re-create history with proper setGeneratedHtml
  const history = useOutputHistory({
    setGeneratedHtml,
    setSourceContent,
    setTitle,
    setSelectedTemplateId: templates.setSelectedTemplateId,
    setCustomInstructions,
    setStatus: () => {},
    setErrorMessage: () => {},
    setPreviewTab,
    setSourceWorkspaceTab,
  })

  const generation = useOutputGeneration({
    selectedTemplateId,
    selectedTemplate,
    title,
    sourceContent,
    sourceLabel,
    customInstructions,
    generatedHtml,
    parsedDeckData,
    iframeRef,
    templateOverrides,
    setGeneratedHtml,
    saveSnapshot: history.saveSnapshot,
  })

  const resetLoadedSourceState = React.useCallback(() => {
    generation.resetGenerationState()
    setGeneratedHtml("")
    setActiveSlideIdx(0)
    setPreviewTab("preview")
    setSourceWorkspaceTab("edit")
  }, [generation.resetGenerationState, setGeneratedHtml])

  const files = useOutputFiles({
    linkedFilePath,
    linkedFileContent,
    setSourceContent,
    setSourceLabel,
    setTitle,
    setSourceWorkspaceTab,
    onSourceLoaded: resetLoadedSourceState,
  })

  // Mount effects
  React.useEffect(() => {
    if (open) {
      void templates.loadTemplates()
      if (typeof window !== "undefined") {
        const savedToken = localStorage.getItem("lingmo_vercel_token") || ""
        generation.setVercelToken(savedToken)
      }
    }
  }, [open])

  React.useEffect(() => {
    if (linkedFileContent) {
      resetLoadedSourceState()
      setSourceContent(linkedFileContent)
      setSourceLabel(linkedFilePath || "关联笔记")
      const fileName = linkedFilePath?.split("/")?.pop()?.replace(/\.[^.]+$/, "") || ""
      setTitle(fileName || "输出")
    }
  }, [linkedFileContent, linkedFilePath, resetLoadedSourceState])

  React.useEffect(() => {
    setActiveSlideIdx(0)
  }, [generatedHtml])

  // Template market handlers
  const handleInstallSkill = async () => {
    if (!githubUrl.trim()) {
      toast({ title: "请输入 GitHub 仓库名称或链接", variant: "destructive" })
      return
    }
    setInstallingMarket(true)
    setInstallProgress("正在连接 GitHub 并检索模板包...")
    try {
      const result = await installSkillsFromGitHub(githubUrl, (msg) => {
        setInstallProgress(msg)
      })
      toast({
        title: "下载安装成功",
        description: `已成功安装来自 ${result.packageName} 的 ${result.skillsCount} 个排版模板！`
      })
      setGithubUrl("")
      await templates.loadTemplates()
      setShowMarketModal(false)
      templates.setTemplateSearchQuery("")
      templates.setSelectedCategory("creative")
      templates.setShowTemplatePicker(true)
      if (result.installedTemplateIds.length === 1) {
        templates.setSelectedTemplateId(result.installedTemplateIds[0])
      }
    } catch (e) {
      toast({
        title: "安装失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setInstallingMarket(false)
      setInstallProgress("")
    }
  }

  const handleCreateCustomTemplate = async () => {
    if (!customTemplateName.trim()) {
      toast({ title: "请输入自定义模板名称", variant: "destructive" })
      return
    }
    setInstallingMarket(true)
    setInstallProgress("正在本地初始化自定义 SKILL.md 模版...")
    try {
      const skillMdPath = await createLocalCustomTemplate(customTemplateName)
      toast({
        title: "自建初始化成功",
        description: `已在本地创建自定义模板。请编辑 SKILL.md 写入您的设计要求。`
      })
      try {
        await openPath(skillMdPath)
      } catch (e) {
        console.warn("唤起编辑器失败:", e)
      }
      setCustomTemplateName("")
      await templates.loadTemplates()
      setShowMarketModal(false)
      templates.setTemplateSearchQuery("")
      templates.setSelectedCategory("creative")
      templates.setShowTemplatePicker(true)
    } catch (e) {
      toast({
        title: "创建失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setInstallingMarket(false)
      setInstallProgress("")
    }
  }

  const toggleSourcePanel = () => {
    const panel = sourcePanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      panel.expand(28)
      setSourcePanelCollapsed(false)
    } else {
      panel.collapse()
      setSourcePanelCollapsed(true)
    }
  }

  const scrollToSlide = (idx: number) => {
    if (idx < 0 || idx >= parsedDeckData.slides.length) return
    setActiveSlideIdx(idx)
    const iframe = iframeRef.current
    if (iframe && iframe.contentWindow) {
      const doc = iframe.contentDocument
      const slides = doc?.querySelectorAll(".slide")
      if (slides && slides[idx]) {
        slides[idx].scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        })
      }
    }
  }

  const scrollToPreviewSection = (section: ExtractedSection, idx: number) => {
    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return

    if (parsedDeckData.isDeck) {
      scrollToSlide(Math.min(idx, parsedDeckData.slides.length - 1))
      return
    }

    const doc = iframe.contentDocument
    const title = (section.title || "").trim()
    const headings = Array.from(
      doc.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    )
    let target: Element | null = null

    if (title) {
      target =
        headings.find(h => (h.textContent || "").trim() === title) ||
        headings.find(h => (h.textContent || "").includes(title)) ||
        headings.find(h => title.includes((h.textContent || "").trim())) ||
        null
    }
    if (!target && headings.length > 0) {
      target = headings[Math.min(idx, headings.length - 1)]
    }
    if (!target) {
      const fallback = doc.querySelectorAll(
        "section, article, .card, [class*='card']",
      )
      target = fallback[Math.min(idx, fallback.length - 1)] || null
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  const handleSelectOutlineSection = (section: ExtractedSection, index: number) => {
    setActiveOutlineIndex(index)
    window.setTimeout(() => {
      scrollToPreviewSection(section, index)
    }, 80)
  }

  const isBuilding = generation.status === "generating" || generation.status === "streaming"
  const hasGeneratedOutput = generatedHtml.trim().length > 0

  // 阶段4 组件解耦：将核心 state / hooks / handler 聚合到 Context，
  // 供 SourcePanel / PreviewPanel / TemplatePicker 通过 useWorkshopContext() 取用
  const onOpenMarket = React.useCallback(() => {
    setShowMarketModal(true)
  }, [])

  const workshopValue: WorkshopContextValue = {
    title,
    sourceContent,
    setSourceContent,
    sourceLabel,
    setSourceLabel,
    customInstructions,
    setCustomInstructions,
    showAdvanced,
    setShowAdvanced,
    previewTab,
    setPreviewTab,
    sourceWorkspaceTab,
    setSourceWorkspaceTab,
    sourcePanelCollapsed,
    viewMode,
    setViewMode,
    activeSlideIdx,
    setActiveSlideIdx,
    activeOutlineIndex,
    templateOverrides,
    setTemplateOverrides,
    generatedHtml,
    setGeneratedHtml,
    selectedTemplate,
    selectedTemplateId,
    templateList,
    isBuilding,
    hasGeneratedOutput,
    parsedDeckData,
    sourceOutlineSections,
    isCsvDetected,
    templates,
    history,
    generation,
    files,
    toggleSourcePanel,
    scrollToSlide,
    handleSelectOutlineSection,
    onOpenMarket,
    iframeRef: iframeRef as React.RefObject<HTMLIFrameElement>,
  }

  if (!open) return null

  return (
    <WorkshopProvider value={workshopValue}>
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-2 pb-2 pt-12 animate-in fade-in duration-200">
      <div className="relative flex h-[calc(100vh-3.5rem)] w-[99vw] max-w-none flex-col overflow-hidden rounded-lg border bg-background shadow-none select-none">
        <header className="relative z-40 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground">智能排版</h2>
              </div>
            </div>

            <TemplatePicker />
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 px-2.5 text-xs shadow-none"
                  disabled={!hasGeneratedOutput || generation.exportBusy}
                >
                  {generation.exportBusy ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
                  导出
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 p-2">
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">复制</DropdownMenuLabel>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleCopyWechatHtml}>
                  <Share2 className="size-3.5" /> 图文
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleCopyAsImage}>
                  <Clipboard className="size-3.5" /> 图片
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleCopyRawText}>
                  <FileText className="size-3.5" /> 文本
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleCopyRawHtml}>
                  <FileCode className="size-3.5" /> 源码
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">下载</DropdownMenuLabel>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleDownloadAsImage}>
                  <ImageIcon className="size-3.5" /> PNG
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleDownloadLongImage}>
                  <FileImage className="size-3.5" /> 长图
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={() => setShowSmartCardDialog(true)}>
                  <Layers className="size-3.5" /> 智能卡片导出
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleExportPDF}>
                  <Printer className="size-3.5" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleDownloadMarkdown}>
                  <FileText className="size-3.5" /> Markdown
                </DropdownMenuItem>
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleDownloadRawHtml}>
                  <Download className="size-3.5" /> HTML
                </DropdownMenuItem>
                {parsedDeckData.isDeck && (
                  <>
                    <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleExportPPTX}>
                      <FileCheck2 className="size-3.5" /> PPTX
                    </DropdownMenuItem>
                    <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleExportZip}>
                      <FileArchive className="size-3.5" /> ZIP
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-8 cursor-pointer text-xs" onClick={generation.handleSaveToNotes} title="保存文件至本地项目工作区的 visual-reports 目录">
                  <Save className="size-3.5" /> 保存到项目
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-8 cursor-pointer text-xs"
                  onClick={generation.handleDeployToVercel}
                  disabled={generation.isDeploying}
                >
                  {generation.isDeploying ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
                  部署
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void templates.loadTemplates()}
              className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
              disabled={templates.loadingTemplates}
            >
              <RefreshCw className={cn("size-3.5", templates.loadingTemplates && "animate-spin")} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                generation.handleStop()
                onClose()
              }}
              className="size-9 rounded-lg p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭智能排版"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {sourcePanelCollapsed && (
          <button
            type="button"
            onClick={toggleSourcePanel}
            className="absolute left-0 top-1/2 z-50 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="展开输入区"
          >
            <PanelLeftOpen className="size-3.5" />
          </button>
        )}

        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="min-h-0 flex-1">
          <ResizablePanel
            ref={sourcePanelRef}
            id="output-workshop-source"
            order={1}
            defaultSize={isMobile ? 46 : 22}
            minSize={isMobile ? 32 : 22}
            maxSize={isMobile ? 68 : 42}
            collapsible
            collapsedSize={0}
            onCollapse={() => setSourcePanelCollapsed(true)}
            onExpand={() => setSourcePanelCollapsed(false)}
            className="min-w-0"
          >
            <SourcePanel />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="output-workshop-preview" order={2} defaultSize={isMobile ? 54 : 72} minSize={isMobile ? 32 : 58} className="min-w-0">
            <PreviewPanel />
          </ResizablePanel>
        </ResizablePanelGroup>

        <DeployPanel
          showDeployModal={hasGeneratedOutput && generation.showDeployModal}
          isDeploying={generation.isDeploying}
          deployProgress={generation.deployProgress}
          deployedUrl={generation.deployedUrl}
          vercelToken={generation.vercelToken}
          onVercelTokenChange={generation.setVercelToken}
          onDeploy={generation.handleDeployToVercel}
          onClose={() => generation.setShowDeployModal(false)}
        />
      </div>

      <MarketModal
        show={showMarketModal}
        installing={installingMarket}
        installProgress={installProgress}
        githubUrl={githubUrl}
        customTemplateName={customTemplateName}
        onGithubUrlChange={setGithubUrl}
        onCustomTemplateNameChange={setCustomTemplateName}
        onInstall={handleInstallSkill}
        onCreateCustomTemplate={handleCreateCustomTemplate}
        onClose={() => {
          if (!installingMarket) setShowMarketModal(false)
        }}
        onRefreshTemplates={templates.loadTemplates}
      />

      <SmartCardDialog
        open={showSmartCardDialog}
        onOpenChange={setShowSmartCardDialog}
        generatedHtml={generatedHtml}
        selectedTemplate={selectedTemplate}
        sizePresetId={templateOverrides.sizePresetId}
        activeCardIndex={activeSlideIdx}
        exportBusy={generation.exportBusy}
        onExport={generation.handleExportSmartCards}
      />
    </div>
    </WorkshopProvider>
  )
}
