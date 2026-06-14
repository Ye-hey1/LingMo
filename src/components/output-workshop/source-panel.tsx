"use client"

import * as React from "react"
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Check,
  Download,
  FileText,
  FolderOpen,
  History,
  Loader2,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { ModelSelect } from "@/app/core/setting/components/model-select"
import type { MarkdownFile } from "@/lib/files"
import type {
  SourceWorkspaceTab,
  ExtractedSection,
  HistorySnapshot,
  GenerationStatus,
  TemplateOverrides,
} from "./types"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import { isMokaTemplateId } from "@/lib/output-workshop/moka"
import { getMermaidRenderModeLabel } from "./workshop-controls"
import { MokaDesignPanel, type MokaPanelMode, type MokaPanelPlatform } from "./moka-design-panel"

const FONT_PRESETS = [
  {
    label: "Noto Sans SC",
    value: "Noto Sans SC",
  },
  {
    label: "系统默认",
    value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    label: "思源黑体",
    value: "Source Han Sans SC, Noto Sans SC, sans-serif",
  },
  {
    label: "苹方 / 微软雅黑",
    value: "PingFang SC, Microsoft YaHei, sans-serif",
  },
  {
    label: "HarmonyOS Sans",
    value: "HarmonyOS Sans SC, HarmonyOS Sans, Noto Sans SC, sans-serif",
  },
  {
    label: "MiSans",
    value: "MiSans, Noto Sans SC, sans-serif",
  },
  {
    label: "阿里巴巴普惠体",
    value: "Alibaba PuHuiTi, Alibaba PuHuiTi 2.0, Noto Sans SC, sans-serif",
  },
  {
    label: "OPPO Sans",
    value: "OPPO Sans, Noto Sans SC, sans-serif",
  },
  {
    label: "霞鹜文楷",
    value: "LXGW WenKai, KaiTi, STKaiti, serif",
  },
  {
    label: "筑紫明朝",
    value: "Tsukushi A Round Gothic, Tsukushi Mincho, Noto Serif SC, serif",
  },
  {
    label: "宋体衬线",
    value: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
  },
] as const

function getFontPreset(value: string) {
  return FONT_PRESETS.find((preset) => preset.value === value)
}

function getFontPresetLabel(value: string) {
  return getFontPreset(value)?.label || "自定义字体"
}

function getOutlineLevel(section: ExtractedSection): number {
  if (!section.level || !Number.isFinite(section.level)) return 1
  return Math.min(6, Math.max(1, section.level))
}

function getOutlineTitleIndent(level: number): number {
  return Math.min(3, Math.max(0, level - 1)) * 14
}

interface SourcePanelProps {
  sourceContent: string
  setSourceContent: (v: string) => void
  sourceLabel: string
  setSourceLabel: (v: string) => void
  title: string
  customInstructions: string
  setCustomInstructions: (v: string) => void
  showAdvanced: boolean
  setShowAdvanced: (v: boolean) => void
  sourceWorkspaceTab: SourceWorkspaceTab
  setSourceWorkspaceTab: (v: SourceWorkspaceTab) => void
  sourcePanelCollapsed: boolean
  toggleSourcePanel: () => void
  isBuilding: boolean
  exportBusy: boolean
  status: GenerationStatus
  isCsvDetected: boolean
  selectedTemplateId: string
  templateOverrides: TemplateOverrides
  setTemplateOverrides: (next: TemplateOverrides) => void
  onSelectTemplate: (templateId: string) => void
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
  onGenerate: () => void
  onStop: () => void
  // File picker
  showFilePicker: boolean
  setShowFilePicker: (v: boolean) => void
  fileSearchQuery: string
  setFileSearchQuery: (v: string) => void
  loadingFiles: boolean
  filteredFiles: MarkdownFile[]
  onSelectFile: (file: MarkdownFile) => void
  onBrowseLocalFile: () => void
  canLoadLinkedFile: boolean
  onLoadLinkedFile: () => void
  // History
  historyList: HistorySnapshot[]
  templateList: OutputTemplate[]
  renamingSnapshotId: string | null
  renamingSnapshotTitle: string
  setRenamingSnapshotTitle: (v: string) => void
  onRestoreSnapshot: (snapshot: HistorySnapshot) => void
  onStartRenameSnapshot: (snapshot: HistorySnapshot) => void
  onCancelRenameSnapshot: () => void
  onCommitRenameSnapshot: () => void
  onDeleteSnapshot: (id: string) => void
  formatSnapshotTime: (ts: number) => string
  // Batch operations
  onClearAllSnapshots: () => void
  onExportSnapshotPack: () => void
  // Outline
  sourceOutlineSections: ExtractedSection[]
  activeOutlineIndex: number | null
  onSelectOutlineSection: (section: ExtractedSection, index: number) => void
  // 微调相关
  hasGeneratedOutput: boolean
  refineQuery: string
  setRefineQuery: (v: string) => void
  handleRefine: () => void
  refining: boolean
  // footer 相关
  selectedTemplateName: string
  generatedHtmlLength: number
  exportProgressText: string
  isDeploying: boolean
  deployProgress: string
}

export function SourcePanel({
  sourceContent,
  setSourceContent,
  sourceLabel,
  setSourceLabel,
  title: _title,
  customInstructions,
  setCustomInstructions,
  showAdvanced,
  setShowAdvanced,
  sourceWorkspaceTab,
  setSourceWorkspaceTab,
  sourcePanelCollapsed,
  toggleSourcePanel,
  isBuilding,
  exportBusy,
  status,
  isCsvDetected,
  selectedTemplateId,
  templateOverrides,
  setTemplateOverrides,
  onSelectTemplate,
  mokaMode,
  setMokaMode,
  mokaPlatform,
  setMokaPlatform,
  mokaStyleId,
  setMokaStyleId,
  mokaPaletteId,
  setMokaPaletteId,
  mokaReferenceImageDataUrl,
  mokaReferenceImageName,
  onMokaReferenceImageChange,
  onClearMokaReferenceImage,
  onGenerate,
  onStop,
  showFilePicker,
  setShowFilePicker,
  fileSearchQuery,
  setFileSearchQuery,
  loadingFiles,
  filteredFiles,
  onSelectFile,
  onBrowseLocalFile,
  canLoadLinkedFile,
  onLoadLinkedFile,
  historyList,
  templateList: _templateList,
  renamingSnapshotId,
  renamingSnapshotTitle,
  setRenamingSnapshotTitle,
  onRestoreSnapshot,
  onStartRenameSnapshot,
  onCancelRenameSnapshot,
  onCommitRenameSnapshot,
  onDeleteSnapshot,
  formatSnapshotTime,
  onClearAllSnapshots,
  onExportSnapshotPack,
  sourceOutlineSections,
  activeOutlineIndex,
  onSelectOutlineSection,
  // 微调相关
  hasGeneratedOutput,
  refineQuery,
  setRefineQuery,
  handleRefine,
  refining,
  // footer 相关
  selectedTemplateName,
  generatedHtmlLength,
  exportProgressText,
  isDeploying,
  deployProgress,
}: SourcePanelProps) {
  const sourceTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const isMokaMode = isMokaTemplateId(selectedTemplateId)

  React.useEffect(() => {
    if (activeOutlineIndex === null) return
    const section = sourceOutlineSections[activeOutlineIndex]
    const textarea = sourceTextareaRef.current
    if (!section || !textarea || section.startOffset === undefined || section.endOffset === undefined) return

    textarea.focus()
    textarea.setSelectionRange(section.startOffset, section.endOffset)

    const line = Math.max(0, (section.startLine ?? 1) - 1)
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "20") || 20
    textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight * 0.25)
  }, [activeOutlineIndex, sourceOutlineSections])

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="shrink-0 border-b bg-background px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleSourcePanel}
              className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={sourcePanelCollapsed ? "展开输入区" : "折叠输入区"}
            >
              {sourcePanelCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </button>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-foreground">输入素材</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {sourceContent.trim()
                  ? `${sourceContent.trim().length.toLocaleString()} chars`
                  : "等待材料"}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="size-8 p-0 shadow-none"
              onClick={onBrowseLocalFile}
              title="浏览 Markdown 文件"
            >
              <FolderOpen className="size-3.5" />
            </Button>
            {isBuilding ? (
              <Button size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-none" onClick={onStop}>
                <Loader2 className="size-3.5 animate-spin" />
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-none"
                onClick={onGenerate}
                disabled={!sourceContent.trim() || exportBusy}
              >
                <Send className="size-3.5" />
                {isMokaMode ? "开始设计" : "开始构建"}
              </Button>
            )}
          </div>
        </div>

        <Popover open={showFilePicker} onOpenChange={setShowFilePicker}>
          <PopoverAnchor asChild>
            <div className="relative mt-2 w-full">
              <BookOpen className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sourceLabel}
                onChange={(e) => setSourceLabel(e.target.value)}
                placeholder="来源笔记"
                className="h-8 pl-8 pr-8 text-xs shadow-none"
                onFocus={() => setShowFilePicker(true)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setShowFilePicker(!showFilePicker)}
                title="选择来源笔记"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </PopoverAnchor>

          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="z-[10020] w-[280px] overflow-hidden rounded-lg border bg-popover p-0 shadow-none"
          >
            <div className="border-b bg-muted/20 p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={fileSearchQuery}
                  onChange={(e) => setFileSearchQuery(e.target.value)}
                  placeholder="搜索笔记"
                  className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>
            </div>
            <ScrollArea className="h-48">
              {loadingFiles ? (
                <div className="flex items-center justify-center py-5">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="py-5 text-center text-xs text-muted-foreground">无匹配笔记</div>
              ) : (
                <div className="p-1.5">
                  {filteredFiles.map((file) => (
                    <button
                      key={file.relativePath}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
                      onClick={() => {
                        void onSelectFile(file)
                        setShowFilePicker(false)
                      }}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium">{file.name}</div>
                        <div className="truncate text-[9px] text-muted-foreground">{file.relativePath}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="border-t bg-muted/10 p-1.5">
              <button
                className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setShowFilePicker(false)
                  onLoadLinkedFile()
                }}
                disabled={!canLoadLinkedFile}
              >
                <FolderOpen className="size-3.5" />
                载入当前文件
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="mt-2 grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1">
          {([
            { id: "edit", label: "内容", icon: FileText },
            { id: "history", label: "快照", icon: History },
            { id: "outline", label: "结构", icon: ListTree },
          ] as const).map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSourceWorkspaceTab(tab.id)}
                className={cn(
                  "flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors",
                  sourceWorkspaceTab === tab.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {sourceWorkspaceTab === "edit" && (
          <div className="flex h-full min-h-0 flex-col gap-3 p-3">
            <div className={cn("relative min-h-0 flex-1 flex-col gap-2", showAdvanced ? "hidden" : "flex")}>
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div className="min-w-0 text-[11px] font-medium text-foreground">素材正文</div>
                <div className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {sourceContent.trim().length.toLocaleString()} chars
                </div>
              </div>
              <Textarea
                ref={sourceTextareaRef}
                value={sourceContent}
                onChange={(e) => setSourceContent(e.target.value)}
                placeholder={isMokaMode ? "粘贴要设计成卡片的内容，支持 Markdown、提纲或摘录。" : "粘贴正文、提纲、链接摘录或 Markdown 内容。"}
                className="min-h-0 flex-1 resize-none border-border/70 bg-background text-xs leading-relaxed shadow-none placeholder:text-muted-foreground/70"
              />
              {isCsvDetected && selectedTemplateId !== "data-dashboard" && (
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded-md border border-primary/20 bg-background px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-primary">
                    <Sparkles className="size-3 shrink-0 text-primary" />
                    <span className="truncate">建议切换到数据仪表盘</span>
                  </div>
                  <button
                    onClick={() => {
                      onSelectTemplate("data-dashboard")
                      toast({ title: "已切换到「数据仪表盘」模板" })
                    }}
                    className="shrink-0 rounded bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-foreground hover:bg-primary/90"
                  >
                    切换
                  </button>
                </div>
              )}
            </div>

            <div className={cn("space-y-2", showAdvanced ? "flex min-h-0 flex-1 flex-col" : "shrink-0")}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setShowAdvanced(!showAdvanced)}
                aria-expanded={showAdvanced}
              >
                <span className="flex items-center gap-1.5">
                  {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  <Settings2 className="size-3.5" />
                  生成选项
                </span>
                <span className="shrink-0 text-[10px] font-normal">
                  {isMokaMode ? selectedTemplateName : `${getFontPresetLabel(templateOverrides.fontFamily)} · ${templateOverrides.fontSize}px`}
                </span>
              </button>
              {showAdvanced && (
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border bg-muted/15 p-2.5 pr-2 [scrollbar-width:thin]"
                  onWheel={(event) => event.stopPropagation()}
                  onPointerDownCapture={(event) => event.stopPropagation()}
                >
                  <div className="space-y-3">
                    <section className="space-y-2 rounded-md border bg-background p-2.5">
                      <div className="text-[10px] font-semibold text-foreground">生成模型</div>
                      <ModelSelect
                        modelKey="outputWorkshop"
                        className="w-full"
                        triggerClassName="h-8 w-full min-w-0 text-xs shadow-none"
                        popoverClassName="z-[10030] w-[min(360px,calc(100vw-2rem))]"
                      />
                    </section>

                    {isMokaMode && (
                      <MokaDesignPanel
                        mode={mokaMode}
                        setMode={setMokaMode}
                        platform={mokaPlatform}
                        setPlatform={setMokaPlatform}
                        styleId={mokaStyleId}
                        setStyleId={setMokaStyleId}
                        paletteId={mokaPaletteId}
                        setPaletteId={setMokaPaletteId}
                        referenceImageDataUrl={mokaReferenceImageDataUrl}
                        referenceImageName={mokaReferenceImageName}
                        onReferenceImageChange={onMokaReferenceImageChange}
                        onClearReferenceImage={onClearMokaReferenceImage}
                        onSelectTemplate={onSelectTemplate}
                        onThemeColorChange={(color) => setTemplateOverrides({ ...templateOverrides, themeColor: color })}
                        className="rounded-md border bg-background"
                      />
                    )}

                    <section className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold text-foreground">补充要求</div>
                        <div className="text-[9px] text-muted-foreground">{customInstructions.trim().length.toLocaleString()} chars</div>
                      </div>
                      <Textarea
                        value={customInstructions}
                        onChange={(e) => setCustomInstructions(e.target.value)}
                        placeholder="补充生成要求，例如压缩结构、强调结论或调整语气。"
                        className="min-h-[72px] resize-none bg-background text-[11px] leading-relaxed shadow-none placeholder:text-muted-foreground/70"
                      />
                    </section>

                    <section className="space-y-2 border-t pt-3">
                      <div className="text-[10px] font-semibold text-foreground">排版</div>
                      <div className="space-y-2.5">
                        <label className="block space-y-1.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center justify-between gap-2">
                            <span>字号</span>
                            <span className="font-mono text-foreground">{templateOverrides.fontSize}px</span>
                          </span>
                          <input
                            type="range"
                            min={18}
                            max={36}
                            value={templateOverrides.fontSize}
                            onChange={(e) => setTemplateOverrides({ ...templateOverrides, fontSize: Number(e.target.value) })}
                            className="w-full accent-primary"
                          />
                        </label>
                        <label className="block space-y-1.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center justify-between gap-2">
                            <span>行高</span>
                            <span className="font-mono text-foreground">{templateOverrides.lineHeight.toFixed(2)}</span>
                          </span>
                          <input
                            type="range"
                            min={1.2}
                            max={1.9}
                            step={0.05}
                            value={templateOverrides.lineHeight}
                            onChange={(e) => setTemplateOverrides({ ...templateOverrides, lineHeight: Number(e.target.value) })}
                            className="w-full accent-primary"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_36px] items-end gap-2">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-medium text-muted-foreground">
                            字体预设
                          </label>
                          <Select
                            value={templateOverrides.fontFamily}
                            onValueChange={(value) => setTemplateOverrides({ ...templateOverrides, fontFamily: value })}
                          >
                            <SelectTrigger className="h-8 bg-background text-xs shadow-none">
                              <SelectValue placeholder="选择字体" />
                            </SelectTrigger>
                            <SelectContent>
                              {FONT_PRESETS.map((preset) => (
                                <SelectItem key={preset.value} value={preset.value} className="text-xs">
                                  {preset.label}
                                </SelectItem>
                              ))}
                              {!getFontPreset(templateOverrides.fontFamily) && (
                                <SelectItem value={templateOverrides.fontFamily} className="text-xs">
                                  自定义字体
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid h-8 place-items-center rounded-md border bg-background p-1">
                          <input
                            id="output-theme-color"
                            type="color"
                            value={templateOverrides.themeColor}
                            onChange={(e) => setTemplateOverrides({ ...templateOverrides, themeColor: e.target.value })}
                            className="h-full w-full cursor-pointer rounded border-0 bg-transparent p-0"
                            title="主题色"
                            aria-label="主题色"
                          />
                        </div>
                      </div>
                    </section>

                    <section className="space-y-1.5 border-t pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold text-foreground">Mermaid</div>
                        <div className="text-[9px] text-muted-foreground">
                          {getMermaidRenderModeLabel(templateOverrides.mermaidRenderMode)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1 rounded-md border bg-background p-1">
                        {([
                          ["card", "图表转卡片"],
                          ["image", "图片嵌入"],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setTemplateOverrides({ ...templateOverrides, mermaidRenderMode: mode })}
                            className={cn(
                              "h-7 rounded text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                              templateOverrides.mermaidRenderMode === mode
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                            aria-pressed={templateOverrides.mermaidRenderMode === mode}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {sourceWorkspaceTab === "history" && (
          <div className="flex h-full min-h-0 flex-col">
            {historyList.length > 0 && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {historyList.length} 个快照
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[9px] text-muted-foreground hover:text-foreground"
                    onClick={onExportSnapshotPack}
                    title="导出全部快照为 JSON 文件"
                  >
                    <Download className="size-3" />
                    导出
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[9px] text-muted-foreground hover:text-destructive"
                    onClick={onClearAllSnapshots}
                    title="清空全部快照"
                  >
                    <Trash2 className="size-3" />
                    清空
                  </Button>
                </div>
              </div>
            )}
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
              onWheel={(event) => event.stopPropagation()}
              onPointerDownCapture={(event) => event.stopPropagation()}
            >
              <div className="space-y-1 p-2">
              {historyList.length === 0 ? (
                <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed bg-muted/10 px-4 text-center">
                  <History className="mb-2 size-4 text-muted-foreground" />
                  <div className="text-xs font-medium text-foreground">暂无快照</div>
                  <div className="mt-1 max-w-[18rem] text-[11px] leading-relaxed text-muted-foreground">
                    生成结果会自动保存在这里，之后可以恢复、重命名或导出快照包。
                  </div>
                </div>
              ) : (
                historyList.map((snapshot) => {
                  const isRenaming = renamingSnapshotId === snapshot.id
                  return (
                    <div
                      key={snapshot.id}
                      className="snapshot-card rounded-lg border bg-background transition-colors hover:border-primary/30 hover:bg-muted/20"
                    >
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <Input
                              value={renamingSnapshotTitle}
                              onChange={(e) => setRenamingSnapshotTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  onCommitRenameSnapshot()
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  onCancelRenameSnapshot()
                                }
                              }}
                              className="h-6 min-w-0 text-[11px] shadow-none"
                              autoFocus
                            />
                          ) : (
                            <span className="block truncate text-[11px] font-medium text-foreground/85">
                              {snapshot.title}
                            </span>
                          )}
                          <span className="mt-0.5 block text-[9px] text-muted-foreground">
                            {formatSnapshotTime(snapshot.timestamp)}
                          </span>
                        </div>
                        {isRenaming ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:text-primary"
                              onClick={onCommitRenameSnapshot}
                              title="保存名称"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:text-foreground"
                              onClick={onCancelRenameSnapshot}
                              title="取消重命名"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              className="snapshot-btn inline-flex size-7 items-center justify-center rounded-md transition-colors hover:text-emerald-600"
                              onClick={() => onRestoreSnapshot(snapshot)}
                              title="恢复此快照"
                            >
                              <RotateCcw className="snapshot-btn-icon size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="snapshot-btn inline-flex size-7 items-center justify-center rounded-md transition-colors hover:text-primary"
                              onClick={() => onStartRenameSnapshot(snapshot)}
                              title="重命名"
                            >
                              <Pencil className="snapshot-btn-icon size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="snapshot-btn inline-flex size-7 items-center justify-center rounded-md transition-colors hover:text-destructive"
                              onClick={() => onDeleteSnapshot(snapshot.id)}
                              title="删除此快照"
                            >
                              <Trash2 className="snapshot-btn-icon size-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              </div>
            </div>
          </div>
        )}

        {sourceWorkspaceTab === "outline" && (
          <ScrollArea className="h-full">
            <div className="p-2.5">
              {sourceOutlineSections.length === 0 ? (
                <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed bg-muted/10 px-4 text-center">
                  <ListTree className="mb-2 size-4 text-muted-foreground" />
                  <div className="text-xs font-medium text-foreground">暂无结构</div>
                  <div className="mt-1 max-w-[18rem] text-[11px] leading-relaxed text-muted-foreground">
                    输入带标题的 Markdown 后，可以在这里跳转到对应段落和预览位置。
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {sourceOutlineSections.map((section, index) => {
                    const level = getOutlineLevel(section)
                    const active = activeOutlineIndex === index
                    return (
                      <button
                        key={`${section.title}-${index}`}
                        type="button"
                        onClick={() => onSelectOutlineSection(section, index)}
                        className={cn(
                          "group grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)_3.75rem] items-center gap-2 rounded-md border border-transparent px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          active
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                        title={section.title}
                        aria-current={active ? "true" : undefined}
                      >
                        <span
                          className={cn(
                            "justify-self-start font-mono text-[9px] tabular-nums",
                            active ? "font-semibold text-foreground" : "text-muted-foreground/70 group-hover:text-muted-foreground"
                          )}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={cn(
                            "flex min-w-0 items-center text-[11px] leading-none",
                            level <= 2 ? "font-semibold" : "font-medium",
                            active ? "text-foreground" : "text-foreground/80"
                          )}
                          style={{ paddingLeft: `${getOutlineTitleIndent(level)}px` }}
                        >
                          <span className="min-w-0 truncate">{section.title}</span>
                        </span>
                        <span className="justify-self-end whitespace-nowrap text-right font-mono text-[9px] tabular-nums text-muted-foreground/70">
                          H{level}{section.startLine ? ` · L${section.startLine}` : ""}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
      {hasGeneratedOutput && (
        <div className="shrink-0 border-t bg-background px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Sparkles className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border bg-background p-1">
              <input
                value={refineQuery}
                onChange={(e) => setRefineQuery(e.target.value)}
                placeholder="输入微调指令"
                className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
                disabled={status === "generating" || status === "streaming" || exportBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void handleRefine()
                  }
                }}
              />
              {status === "streaming" && refining ? (
                <Button size="sm" variant="destructive" className="h-7 shrink-0 gap-1 px-2.5 text-[10px] font-semibold shadow-none" onClick={onStop}>
                  <Loader2 className="size-3 animate-spin" />
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 shrink-0 px-3 text-[10px] font-semibold shadow-none"
                  onClick={handleRefine}
                  disabled={!refineQuery.trim() || status === "generating" || status === "streaming" || exportBusy}
                >
                  发送
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-col gap-0.5 border-t bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium">{isMokaMode ? "模式" : "模板"}：{selectedTemplateName}</span>
          <span className="truncate">
            {hasGeneratedOutput ? `输出：${generatedHtmlLength.toLocaleString()} chars` : "输出：尚未生成"}
          </span>
        </div>
        {(exportBusy || isDeploying) && (
          <div className="mt-0.5 truncate font-medium text-primary">
            {exportBusy ? exportProgressText : deployProgress}
          </div>
        )}
      </div>
    </div>
  )
}
