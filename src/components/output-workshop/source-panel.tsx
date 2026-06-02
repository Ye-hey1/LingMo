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
  Palette,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import type { MarkdownFile } from "@/lib/files"
import type {
  SourceWorkspaceTab,
  ExtractedSection,
  HistorySnapshot,
  GenerationStatus,
  TemplateOverrides,
} from "./types"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import { getMermaidRenderModeLabel, PREVIEW_SIZE_PRESETS } from "./workshop-controls"

const QUICK_INSTRUCTION_CHIPS = [
  "更像小红书长图，标题更抓人，分段更短",
  "转成演示简报，每页只保留一个核心观点",
  "突出行动清单、风险和下一步",
  "适合移动端阅读，字号更大，留白更足",
]

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
  isCsvDetected,
  selectedTemplateId,
  templateOverrides,
  setTemplateOverrides,
  onSelectTemplate,
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
      <div className="shrink-0 border-b bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleSourcePanel}
              className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={sourcePanelCollapsed ? "展开输入区" : "折叠输入区"}
            >
              {sourcePanelCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <Popover open={showFilePicker} onOpenChange={setShowFilePicker}>
              <PopoverAnchor asChild>
                <div className="relative w-full">
                  <Input
                    value={sourceLabel}
                    onChange={(e) => setSourceLabel(e.target.value)}
                    placeholder="来源笔记"
                    className="h-8 pr-8 text-xs shadow-none"
                    onFocus={() => setShowFilePicker(true)}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowFilePicker(!showFilePicker)}
                    title="选择来源笔记"
                  >
                    <BookOpen className="size-3.5" />
                  </button>
                </div>
              </PopoverAnchor>

              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={4}
                className="w-[240px] p-0 border shadow-2xl rounded-xl bg-popover overflow-hidden z-[10020]"
              >
                <div className="border-b bg-muted/20 p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={fileSearchQuery}
                      onChange={(e) => setFileSearchQuery(e.target.value)}
                      placeholder="搜索笔记"
                      className="w-full rounded border bg-background py-1.5 pl-8 pr-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  </div>
                </div>
                <ScrollArea className="h-44">
                  {loadingFiles ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground">无匹配笔记</div>
                  ) : (
                    <div className="p-1">
                      {filteredFiles.map((file) => (
                        <button
                          key={file.relativePath}
                          className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
                          onClick={() => {
                            void onSelectFile(file)
                            setShowFilePicker(false)
                          }}
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-medium">{file.name}</div>
                            <div className="truncate text-[8px] text-muted-foreground">{file.relativePath}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <div className="border-t bg-muted/10 p-1">
                  <button
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
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
          </div>

          <Button
            size="sm"
            variant="outline"
            className="size-8 shrink-0 p-0"
            onClick={onBrowseLocalFile}
            title="浏览 Markdown 文件"
          >
            <FolderOpen className="size-3.5" />
          </Button>

          <div className="shrink-0">
            {isBuilding ? (
              <Button size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-[10px] font-semibold" onClick={onStop}>
                <Loader2 className="size-3.5 animate-spin" />
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-[10px] font-semibold"
                onClick={onGenerate}
                disabled={!sourceContent.trim() || exportBusy}
              >
                <Send className="size-3.5" />
                构建
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
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
                    ? "bg-background text-foreground shadow-sm"
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
            <div className="relative flex min-h-0 flex-1 flex-col">
              {!sourceContent.trim() && (
                <div className="mb-2 grid grid-cols-3 gap-1.5 rounded-xl border bg-muted/20 p-2 text-center text-[10px]">
                  {[
                    ["1", "粘贴材料"],
                    ["2", "补充要求"],
                    ["3", "点击构建"],
                  ].map(([step, label]) => (
                    <div key={step} className="rounded-lg bg-background px-2 py-1.5 text-muted-foreground shadow-sm">
                      <span className="mr-1 font-bold text-primary">{step}</span>{label}
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                ref={sourceTextareaRef}
                value={sourceContent}
                onChange={(e) => setSourceContent(e.target.value)}
                placeholder="粘贴内容..."
                className="min-h-0 flex-1 resize-none border-border/70 bg-background text-xs leading-relaxed shadow-sm placeholder:text-muted-foreground/50"
              />
              {isCsvDetected && selectedTemplateId !== "data-dashboard" && (
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-background/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
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

            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span className="flex items-center gap-1.5">
                  {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  生成选项
                </span>
              </button>
              {showAdvanced && (
                <div className="space-y-2 rounded-lg border bg-muted/15 p-2.5">
                  <Textarea
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="补充生成要求..."
                    className="min-h-[78px] resize-none bg-background text-[11px]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_INSTRUCTION_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => {
                          const next = customInstructions.trim()
                            ? `${customInstructions.trim()}\n- ${chip}`
                            : chip
                          setCustomInstructions(next)
                        }}
                        className="rounded-full border bg-background px-2 py-1 text-[9px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                    <Palette className="size-3" />
                    模板参数
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {PREVIEW_SIZE_PRESETS.slice(0, 5).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setTemplateOverrides({ ...templateOverrides, sizePresetId: preset.id })}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-left text-[9px] transition-colors",
                          templateOverrides.sizePresetId === preset.id
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "bg-background text-muted-foreground hover:bg-muted"
                        )}
                        title={preset.description}
                      >
                        <span className="block font-semibold">{preset.label}</span>
                        <span className="block truncate opacity-75">{preset.description}</span>
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[10px] text-muted-foreground">
                      字号 {templateOverrides.fontSize}px
                      <input
                        type="range"
                        min={18}
                        max={36}
                        value={templateOverrides.fontSize}
                        onChange={(e) => setTemplateOverrides({ ...templateOverrides, fontSize: Number(e.target.value) })}
                        className="w-full accent-primary"
                      />
                    </label>
                    <label className="space-y-1 text-[10px] text-muted-foreground">
                      行高 {templateOverrides.lineHeight.toFixed(2)}
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
                  <div className="grid grid-cols-[1fr_44px] gap-2">
                    <Input
                      value={templateOverrides.fontFamily}
                      onChange={(e) => setTemplateOverrides({ ...templateOverrides, fontFamily: e.target.value })}
                      className="h-7 bg-background text-[10px]"
                      placeholder="字体"
                    />
                    <input
                      type="color"
                      value={templateOverrides.themeColor}
                      onChange={(e) => setTemplateOverrides({ ...templateOverrides, themeColor: e.target.value })}
                      className="h-7 w-full rounded-md border bg-background p-1"
                      title="主题色"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {([
                      ["stickersEnabled", "贴纸元素"],
                      ["safeAreaEnabled", "安全区提示"],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTemplateOverrides({ ...templateOverrides, [key]: !templateOverrides[key] })}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-[10px] transition-colors",
                          templateOverrides[key]
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "bg-background text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTemplateOverrides({
                      ...templateOverrides,
                      mermaidRenderMode: templateOverrides.mermaidRenderMode === "card" ? "image" : "card",
                    })}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:bg-muted"
                  >
                    Mermaid：{getMermaidRenderModeLabel(templateOverrides.mermaidRenderMode)}
                  </button>
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
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">暂无快照</div>
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
                              className="h-6 min-w-0 text-[11px]"
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
            <div className="space-y-1.5 p-3">
              {sourceOutlineSections.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">暂无结构</div>
              ) : (
                sourceOutlineSections.map((section, index) => (
                  <button
                    key={`${section.title}-${index}`}
                    type="button"
                    onClick={() => onSelectOutlineSection(section, index)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                      activeOutlineIndex === index
                        ? "border-primary/30 bg-primary/10"
                        : "border-transparent bg-muted/25 hover:border-border hover:bg-muted/45"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 shrink-0 font-mono text-[9px] font-semibold text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
                        {section.title}
                      </span>
                      {section.startLine && (
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                          L{section.startLine}
                        </span>
                      )}
                    </div>
                    {section.body && (
                      <p className="mt-1.5 line-clamp-2 pl-9 text-[10px] leading-relaxed text-muted-foreground">
                        {section.body}
                      </p>
                    )}
                    {!!section.bullets?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1 pl-9">
                        {section.bullets.slice(0, 3).map((bullet) => (
                          <span key={bullet} className="max-w-full truncate rounded bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            {bullet}
                          </span>
                        ))}
                        {section.bullets.length > 3 && (
                          <span className="rounded bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            +{section.bullets.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        )}
      </div>
      {hasGeneratedOutput && (
        <div className="shrink-0 border-t bg-background px-3 py-2">
          <div className="flex items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border bg-background p-1 shadow-sm">
              <div className="pl-2 text-primary">
                <Sparkles className="size-3" />
              </div>
              <input
                value={refineQuery}
                onChange={(e) => setRefineQuery(e.target.value)}
                placeholder="输入指令微调样式..."
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
                <Button size="sm" variant="destructive" className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-[10px] font-semibold" onClick={onStop}>
                  <Loader2 className="size-3 animate-spin" />
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 shrink-0 rounded-full px-3 text-[10px] font-semibold"
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
      <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium">模板：{selectedTemplateName}</span>
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
