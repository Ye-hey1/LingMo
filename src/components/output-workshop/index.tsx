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

  const scrollToPreviewSection = (idx: number) => {
    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return

    if (parsedDeckData.isDeck) {
      scrollToSlide(Math.min(idx, parsedDeckData.slides.length - 1))
      return
    }

    const doc = iframe.contentDocument
    const candidates = doc.querySelectorAll(
      ".slide, section, article, main > div, .card, [class*='card'], h1, h2, h3"
    )
    const target = candidates[Math.min(idx, Math.max(0, candidates.length - 1))]
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
    }
  }

  const handleSelectOutlineSection = (section: ExtractedSection, index: number) => {
    setActiveOutlineIndex(index)
    setSourceWorkspaceTab("edit")
    window.setTimeout(() => {
      scrollToPreviewSection(index)
    }, 80)
  }


  if (!open) return null

  const isBuilding = generation.status === "generating" || generation.status === "streaming"
  const hasGeneratedOutput = generatedHtml.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-14 px-2 pb-2 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex h-[calc(100vh-4rem)] w-[99vw] max-w-none flex-col overflow-hidden rounded-2xl border bg-background shadow-3xl select-none">
        <header className="relative z-40 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-5 py-2.5 backdrop-blur">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground">输出工坊</h2>
              </div>
            </div>

            <TemplatePicker
              selectedTemplate={selectedTemplate}
              selectedTemplateId={selectedTemplateId}
              showTemplatePicker={templates.showTemplatePicker}
              setShowTemplatePicker={templates.setShowTemplatePicker}
              selectedCategory={templates.selectedCategory}
              setSelectedCategory={templates.setSelectedCategory}
              templateSearchQuery={templates.templateSearchQuery}
              setTemplateSearchQuery={templates.setTemplateSearchQuery}
              filteredTemplates={templates.filteredTemplates}
              templateCategories={templates.templateCategories}
              loadingTemplates={templates.loadingTemplates}
              hoveredTemplateId={templates.hoveredTemplateId}
              setHoveredTemplateId={templates.setHoveredTemplateId}
              templatePreviewPosition={templates.templatePreviewPosition}
              setTemplatePreviewPosition={templates.setTemplatePreviewPosition}
              templatePreviewHtml={templates.templatePreviewHtml}
              hoveredTemplate={templates.hoveredTemplate}
              onSelectTemplate={templates.handleSelectTemplate}
              onTemplateHover={templates.handleTemplateHover}
              onOpenMarket={() => setShowMarketModal(true)}
              pickerRef={templates.templatePickerRef as React.RefObject<HTMLDivElement>}
            />
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
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
              <DropdownMenuContent align="end" className="w-44 p-1.5">
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
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {sourcePanelCollapsed && (
          <button
            type="button"
            onClick={toggleSourcePanel}
            className="absolute left-0 top-1/2 z-50 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:w-8 hover:bg-muted hover:text-foreground"
            title="展开输入区"
          >
            {/* PanelLeftOpen icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v-8"/><path d="M12 12V4"/></svg>
          </button>
        )}

        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="min-h-0 flex-1">
          <ResizablePanel
            ref={sourcePanelRef}
            id="output-workshop-source"
            order={1}
            defaultSize={isMobile ? 46 : 20}
            minSize={isMobile ? 32 : 15}
            maxSize={isMobile ? 68 : 35}
            collapsible
            collapsedSize={0}
            onCollapse={() => setSourcePanelCollapsed(true)}
            onExpand={() => setSourcePanelCollapsed(false)}
            className="min-w-0"
          >
            <SourcePanel
              sourceContent={sourceContent}
              setSourceContent={setSourceContent}
              sourceLabel={sourceLabel}
              setSourceLabel={setSourceLabel}
              title={title}
              customInstructions={customInstructions}
              setCustomInstructions={setCustomInstructions}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
              sourceWorkspaceTab={sourceWorkspaceTab}
              setSourceWorkspaceTab={setSourceWorkspaceTab}
              sourcePanelCollapsed={sourcePanelCollapsed}
              toggleSourcePanel={toggleSourcePanel}
              isBuilding={isBuilding}
              exportBusy={generation.exportBusy}
              status={generation.status}
              isCsvDetected={isCsvDetected}
              selectedTemplateId={selectedTemplateId}
              templateOverrides={templateOverrides}
              setTemplateOverrides={setTemplateOverrides}
              onSelectTemplate={templates.handleSelectTemplate}
              onGenerate={generation.handleGenerate}
              onStop={generation.handleStop}
              showFilePicker={files.showFilePicker}
              setShowFilePicker={files.setShowFilePicker}
              fileSearchQuery={files.fileSearchQuery}
              setFileSearchQuery={files.setFileSearchQuery}
              loadingFiles={files.loadingFiles}
              filteredFiles={files.filteredFiles}
              onSelectFile={async (f) => { await files.handleSelectFile(f) }}
              onBrowseLocalFile={files.browseLocalMarkdownFile}
              canLoadLinkedFile={files.canLoadLinkedFile}
              onLoadLinkedFile={files.loadLinkedFile}
              historyList={history.historyList}
              templateList={templateList}
              renamingSnapshotId={history.renamingSnapshotId}
              renamingSnapshotTitle={history.renamingSnapshotTitle}
              setRenamingSnapshotTitle={history.setRenamingSnapshotTitle}
              onRestoreSnapshot={history.restoreSnapshot}
              onStartRenameSnapshot={history.startRenameSnapshot}
              onCancelRenameSnapshot={history.cancelRenameSnapshot}
              onCommitRenameSnapshot={history.commitRenameSnapshot}
              onDeleteSnapshot={history.deleteSnapshot}
              formatSnapshotTime={history.formatSnapshotTime}
              onClearAllSnapshots={history.clearAllSnapshots}
              onExportSnapshotPack={history.exportSnapshotPack}
              sourceOutlineSections={sourceOutlineSections}
              activeOutlineIndex={activeOutlineIndex}
              onSelectOutlineSection={handleSelectOutlineSection}
              hasGeneratedOutput={hasGeneratedOutput}
              refineQuery={generation.refineQuery}
              setRefineQuery={generation.setRefineQuery}
              handleRefine={generation.handleRefine}
              refining={generation.refining}
              selectedTemplateName={selectedTemplate.name}
              generatedHtmlLength={generatedHtml.length}
              exportProgressText={generation.exportProgressText}
              isDeploying={generation.isDeploying}
              deployProgress={generation.deployProgress}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="output-workshop-preview" order={2} defaultSize={isMobile ? 54 : 80} minSize={isMobile ? 32 : 65} className="min-w-0">
            <PreviewPanel
              previewTab={previewTab}
              setPreviewTab={setPreviewTab}
              viewMode={viewMode}
              setViewMode={setViewMode}
              status={generation.status}
              errorMessage={generation.errorMessage}
              progressText={generation.progressText}
              elapsed={generation.elapsed}
              generatedHtml={generatedHtml}
              setGeneratedHtml={setGeneratedHtml}
              hasGeneratedOutput={hasGeneratedOutput}
              selectedTemplatePreviewHtml={templates.selectedTemplatePreviewHtml}
              title={title}
              templateOverrides={templateOverrides}
              setTemplateOverrides={setTemplateOverrides}
              buildStageId={generation.buildStageId}
              lastExportRecord={generation.lastExportRecord}
              parsedDeckData={parsedDeckData}
              activeSlideIdx={activeSlideIdx}
              setActiveSlideIdx={setActiveSlideIdx}
              scrollToSlide={scrollToSlide}
              streamingHtml={generation.streamingHtml}
              iframeRef={iframeRef as React.RefObject<HTMLIFrameElement>}
              exportBusy={generation.exportBusy}
              exportProgressText={generation.exportProgressText}
              showDeployModal={generation.showDeployModal}
              deployProgress={generation.deployProgress}
              deployedUrl={generation.deployedUrl}
              sourceLabel={sourceLabel}
              sourceContent={sourceContent}
              sourceWorkspaceTab={sourceWorkspaceTab}
              sourcePanelCollapsed={sourcePanelCollapsed}
              toggleSourcePanel={toggleSourcePanel}
              refining={generation.refining}
              handleStop={generation.handleStop}
              handleGenerate={generation.handleGenerate}
            />
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
        exportBusy={generation.exportBusy}
        onExport={generation.handleExportSmartCards}
      />
    </div>
  )
}
