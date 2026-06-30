"use client"

import NextImage from "next/image"
import * as React from "react"
import {
  Layers,
  Download,
  CheckSquare,
  Square,
  Loader2,
  Sparkles,
  AlertTriangle,
  MousePointer2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  parseSmartCards,
  renderCardThumbnail,
  downloadSingleCard,
  type SmartCard,
  type SmartCardParsed,
  type SmartCardPagingMode,
  type SmartCardRenderOptions,
} from "@/lib/output-workshop/smart-card-export"
import {
  PREVIEW_SIZE_PRESETS,
  getPresetById,
} from "./workshop-controls"
import type { PreviewSizePreset } from "./types"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import type { ExportBlueprint } from "@/lib/output-workshop/smart-card-export"
import { toast } from "@/hooks/use-toast"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SmartCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  generatedHtml: string
  selectedTemplate: OutputTemplate | null
  sizePresetId: PreviewSizePreset["id"]
  activeCardIndex?: number
  exportBusy: boolean
  onExport: (cards: SmartCard[], preset: PreviewSizePreset, selectedIndices: number[], options?: SmartCardRenderOptions) => void
}

type SelectionMode = "all" | "current" | "custom"

// ---------------------------------------------------------------------------
// Detection method label
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, { label: string; color: string }> = {
  blueprint: { label: "模板定义", color: "text-blue-600 bg-blue-50 border-blue-200" },
  selector: { label: "自动检测", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  separator: { label: "手动分隔", color: "text-violet-600 bg-violet-50 border-violet-200" },
  "auto-split": { label: "自动拆分", color: "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200" },
  heading: { label: "标题分割", color: "text-amber-600 bg-amber-50 border-amber-200" },
  fallback: { label: "整页导出", color: "text-slate-600 bg-slate-50 border-slate-200" },
}

const PAGING_MODE_OPTIONS: Array<{ id: SmartCardPagingMode; label: string; description: string }> = [
  { id: "semantic", label: "语义识别", description: "按模板结构识别卡片" },
  { id: "separator", label: "手动分隔", description: "识别 --- / 分割线" },
  { id: "auto-fit", label: "自动适配", description: "固定尺寸内整体缩放" },
  { id: "auto-split", label: "自动拆分", description: "按内容体量拆页" },
  { id: "dynamic", label: "动态高度", description: "保留更长内容高度" },
]

function resolveInitialPagingMode(blueprint?: ExportBlueprint): SmartCardPagingMode {
  return blueprint?.pagingMode ?? "semantic"
}

function getExportablePresetId(id: PreviewSizePreset["id"] | string | undefined): PreviewSizePreset["id"] {
  const match = PREVIEW_SIZE_PRESETS.find((preset) => preset.id === id && preset.id !== "auto")
  return match?.id ?? "3:4"
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SmartCardDialog({
  open,
  onOpenChange,
  generatedHtml,
  selectedTemplate,
  sizePresetId,
  activeCardIndex = 0,
  exportBusy,
  onExport,
}: SmartCardDialogProps) {
  // Parse cards from HTML
  const [parsedResult, setParsedResult] = React.useState<SmartCardParsed | null>(null)
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = React.useState<SelectionMode>("all")
  const [currentPresetId, setCurrentPresetId] = React.useState<PreviewSizePreset["id"]>(() => getExportablePresetId(sizePresetId))
  const [pagingMode, setPagingMode] = React.useState<SmartCardPagingMode>(() => resolveInitialPagingMode(selectedTemplate?.exportBlueprint))
  const [thumbnails, setThumbnails] = React.useState<Map<number, string>>(new Map())
  const [thumbnailErrors, setThumbnailErrors] = React.useState<Set<number>>(new Set())
  const [loadingThumbs, setLoadingThumbs] = React.useState(false)

  const currentPreset = getPresetById(currentPresetId) || PREVIEW_SIZE_PRESETS[0]
  const cards = React.useMemo(() => parsedResult?.cards ?? [], [parsedResult])
  const currentCardIndex = React.useMemo(() => {
    if (cards.some((card) => card.index === activeCardIndex)) return activeCardIndex
    return cards[0]?.index ?? 0
  }, [activeCardIndex, cards])

  // Parse cards when dialog opens or HTML changes
  React.useEffect(() => {
    if (!open || !generatedHtml) {
      setParsedResult(null)
      setThumbnails(new Map())
      setThumbnailErrors(new Set())
      return
    }

    const baseBlueprint: ExportBlueprint | undefined = selectedTemplate?.exportBlueprint
    const blueprint: ExportBlueprint | undefined = {
      ...baseBlueprint,
      pagingMode,
    }
    const result = parseSmartCards(generatedHtml, blueprint)
    setParsedResult(result)

    // Auto-select all cards
    const allIndices = new Set(result.cards.map((c) => c.index))
    setSelectedIndices(allIndices)
    setSelectionMode("all")
    setThumbnails(new Map())
    setThumbnailErrors(new Set())

    // Auto-select preset from blueprint
    setCurrentPresetId(getExportablePresetId(baseBlueprint?.defaultRatio || sizePresetId))
  }, [open, generatedHtml, selectedTemplate, sizePresetId, pagingMode])

  React.useEffect(() => {
    if (!open) return
    setPagingMode(resolveInitialPagingMode(selectedTemplate?.exportBlueprint))
  }, [open, selectedTemplate])

  // Generate thumbnails
  React.useEffect(() => {
    if (!parsedResult || parsedResult.cards.length === 0) {
      setLoadingThumbs(false)
      return
    }

    let cancelled = false
    setLoadingThumbs(true)
    const newThumbs = new Map<number, string>()
    const failedThumbs = new Set<number>()

    const generateAll = async () => {
      const queue = parsedResult.cards.slice()
      let cursor = 0
      const thumbnailConcurrency = Math.min(3, queue.length)
      const nextCard = () => {
        const card = queue[cursor]
        cursor += 1
        return card
      }

      try {
        await Promise.all(Array.from({ length: thumbnailConcurrency }, async () => {
          while (!cancelled) {
            const card = nextCard()
            if (!card) break
            try {
              const dataUrl = await renderCardThumbnail(card, 270, 360, { pagingMode })
              if (cancelled) break
              newThumbs.set(card.index, dataUrl)
              setThumbnails(new Map(newThumbs))
            } catch {
              if (cancelled) break
              failedThumbs.add(card.index)
              setThumbnailErrors(new Set(failedThumbs))
            }
          }
        }))
      } finally {
        if (!cancelled) {
          setLoadingThumbs(false)
        }
      }
    }

    void generateAll()
    return () => { cancelled = true }
  }, [parsedResult, pagingMode])

  // Selection helpers
  const toggleSelect = (idx: number) => {
    setSelectionMode("custom")
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const selectAll = () => {
    if (!parsedResult) return
    setSelectionMode("all")
    setSelectedIndices(new Set(parsedResult.cards.map((c) => c.index)))
  }

  const deselectAll = () => {
    setSelectionMode("custom")
    setSelectedIndices(new Set())
  }

  const selectCurrent = () => {
    setSelectionMode("current")
    setSelectedIndices(new Set([currentCardIndex]))
  }

  const setCustomMode = () => {
    setSelectionMode("custom")
    setSelectedIndices((prev) => {
      if (prev.size > 0) return prev
      return new Set([currentCardIndex])
    })
  }

  const handleExport = () => {
    if (!parsedResult) return
    onExport(parsedResult.cards, currentPreset, Array.from(selectedIndices), {
      pagingMode,
      dynamicMaxHeight: selectedTemplate?.exportBlueprint?.dynamicMaxHeight,
    })
  }

  const handleDownloadSingle = async (card: SmartCard) => {
    try {
      const filename = `card-${card.index + 1}.png`
      await downloadSingleCard(card, currentPreset.width, currentPreset.height, filename, {
        pagingMode,
        dynamicMaxHeight: selectedTemplate?.exportBlueprint?.dynamicMaxHeight,
      })
      toast({ title: `已导出: ${filename}` })
    } catch (e) {
      toast({ title: "导出失败", description: String(e), variant: "destructive" })
    }
  }

  const method = parsedResult?.detectionMethod ?? "fallback"
  const methodInfo = METHOD_LABELS[method] ?? METHOD_LABELS.fallback
  const activePagingModeInfo = PAGING_MODE_OPTIONS.find((option) => option.id === pagingMode) ?? PAGING_MODE_OPTIONS[0]
  const isVerticalCardPreset = currentPresetId === "3:4"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(620px,calc(100vh-28px))] max-w-[680px] grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 overflow-hidden p-3.5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-4" />
            智能卡片导出
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            选择需要导出的卡片，按当前比例打包为 ZIP。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-2.5 overflow-hidden md:grid-cols-[minmax(0,1fr)_188px]">
          {/* 左侧 — 卡片预览网格 */}
          <div className="min-h-0 space-y-3">
            {/* 顶栏：检测信息 + 全选 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                  methodInfo.color
                )}>
                  {method === "blueprint" && <Sparkles className="size-3" />}
                  {method === "fallback" && <AlertTriangle className="size-3" />}
                  {methodInfo.label}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  检测到 <strong>{cards.length}</strong> 张卡片
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={deselectAll}>
                清空
              </Button>
            </div>

            {/* 卡片网格 */}
            {cards.length > 0 ? (
              <div
                className={cn(
                  "grid max-h-[360px] overflow-y-auto pr-1",
                  isVerticalCardPreset
                    ? "grid-cols-2 gap-2"
                    : "grid-cols-2 gap-2 sm:grid-cols-3"
                )}
              >
                {cards.map((card) => {
                  const isSelected = selectedIndices.has(card.index)
                  const thumb = thumbnails.get(card.index)
                  const thumbFailed = thumbnailErrors.has(card.index)
                  return (
                    <div
                      key={card.index}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-md border transition-colors duration-150",
                        isSelected
                          ? "border-primary/55 bg-primary/5"
                          : "border-border bg-background opacity-75 hover:border-primary/40 hover:opacity-100"
                      )}
                      onClick={() => toggleSelect(card.index)}
                    >
                      {/* 缩略图 */}
                      <div className="flex aspect-[3/4] max-h-[168px] items-center justify-center overflow-hidden bg-muted/30">
                        {thumb ? (
                          <NextImage
                            src={thumb}
                            alt={card.title}
                            width={currentPreset.width || 300}
                            height={currentPreset.height || 400}
                            className="w-full h-full object-contain"
                            unoptimized
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            {thumbFailed ? (
                              <AlertTriangle className="size-4 text-amber-500" />
                            ) : (
                              <Loader2 className={cn("size-4 animate-spin", !loadingThumbs && "hidden")} />
                            )}
                            <span className="text-[10px]">{thumbFailed ? "预览失败" : `#${card.index + 1}`}</span>
                          </div>
                        )}
                      </div>

                      {/* 选中标记 */}
                      <div className="absolute left-1.5 top-1.5">
                        {isSelected ? (
                          <CheckSquare className="size-4 text-primary fill-primary/20" />
                        ) : (
                          <Square className="size-4 text-muted-foreground/60" />
                        )}
                      </div>

                      {/* 序号和标题 */}
                      <div className="absolute inset-x-0 bottom-0 border-t bg-background/95 px-1.5 py-1">
                        <p className="truncate text-[10px] font-semibold text-foreground">
                          #{card.index + 1} {card.index === currentCardIndex ? "当前页 · " : ""}{card.title}
                        </p>
                      </div>

                      {/* 单独下载按钮 */}
                      <button
                        className={cn(
                          "absolute right-1.5 top-1.5 size-5 rounded-md bg-black/50 text-white",
                          "flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                          "hover:bg-black/70"
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownloadSingle(card)
                        }}
                        title="单独下载此卡片"
                      >
                        <Download className="size-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <AlertTriangle className="size-8 mb-2 text-amber-500" />
                <p className="text-sm">未检测到卡片结构</p>
                <p className="text-[11px] mt-1">将以整页形式导出单张图片</p>
              </div>
            )}

            {/* 底部统计 */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border bg-muted/20 px-2 py-1.5 text-center">
                <div className="text-[10px] text-muted-foreground">卡片总数</div>
                <div className="mt-0.5 text-xs font-bold tabular-nums">{cards.length}</div>
              </div>
              <div className="rounded-md border bg-muted/20 px-2 py-1.5 text-center">
                <div className="text-[10px] text-muted-foreground">已选中</div>
                <div className="mt-0.5 text-xs font-bold tabular-nums text-primary">{selectedIndices.size}</div>
              </div>
              <div className="rounded-md border bg-muted/20 px-2 py-1.5 text-center">
                <div className="text-[10px] text-muted-foreground">导出尺寸</div>
                <div className="mt-0.5 text-xs font-bold tabular-nums">{currentPreset.width}×{currentPreset.height}</div>
              </div>
            </div>
          </div>

          {/* 右侧 — 导出控制 */}
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            {/* 选择方式 */}
            <div className="space-y-2 rounded-md border bg-muted/10 p-2">
              <div className="text-xs font-semibold text-muted-foreground">选择方式</div>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className={cn(
                    "flex h-8 items-center justify-between rounded-md border px-2 text-left text-[11px] transition-all duration-150",
                    selectionMode === "all"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <Layers className="size-3.5" />
                    全部页
                  </span>
                  <span className="font-mono text-[10px] tabular-nums">{cards.length}</span>
                </button>
                <button
                  type="button"
                  onClick={selectCurrent}
                  disabled={cards.length === 0}
                  className={cn(
                    "flex h-8 items-center justify-between rounded-md border px-2 text-left text-[11px] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                    selectionMode === "current"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <MousePointer2 className="size-3.5" />
                    当前页
                  </span>
                  <span className="font-mono text-[10px] tabular-nums">#{currentCardIndex + 1}</span>
                </button>
                <button
                  type="button"
                  onClick={setCustomMode}
                  className={cn(
                    "flex h-8 items-center justify-between rounded-md border px-2 text-left text-[11px] transition-all duration-150",
                    selectionMode === "custom"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <CheckSquare className="size-3.5" />
                    自定义选择
                  </span>
                  <span className="font-mono text-[10px] tabular-nums">{selectedIndices.size}</span>
                </button>
              </div>
            </div>

            {/* 尺寸预设 */}
            <div className="space-y-2 rounded-md border bg-muted/10 p-2">
              <div className="text-xs font-semibold text-muted-foreground">导出尺寸</div>
              <div className="grid grid-cols-2 gap-2">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.id !== "auto").map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setCurrentPresetId(preset.id)}
                    className={cn(
                      "h-7 rounded-md text-[10px] font-semibold transition-all duration-150 border",
                      currentPresetId === preset.id
                        ? "bg-primary/10 text-primary border-primary/40"
                        : "bg-background text-muted-foreground hover:text-foreground border-input"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="truncate text-[10px] text-muted-foreground/60">
                {currentPreset.description} — {currentPreset.width}×{currentPreset.height}px
              </p>
            </div>

            {/* 分割策略 */}
            <div className="space-y-2 rounded-md border bg-muted/10 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-muted-foreground">分割策略</div>
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {activePagingModeInfo.label}
                </span>
              </div>
              <div className="grid gap-1.5">
                {PAGING_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPagingMode(option.id)}
                    className={cn(
                      "flex min-h-7 items-center justify-between gap-2 rounded-md border px-2 py-1 text-left transition-all duration-150",
                      pagingMode === option.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-input bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="text-[11px] font-medium">{option.label}</span>
                    <span className="truncate text-[10px] opacity-70">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 检测方式说明 */}
            <div className="space-y-1.5 rounded-md border bg-muted/10 p-2">
              <div className="text-xs font-semibold text-muted-foreground">检测方式</div>
              <div className="text-[11px] leading-relaxed text-muted-foreground/80 space-y-1">
                {method === "blueprint" && (
                  <p>当前模板预定义了卡片选择器，系统精确匹配 <code className="text-primary bg-primary/5 px-1 rounded text-[10px]">{parsedResult?.cards[0]?.matchedBy}</code> 元素。</p>
                )}
                {method === "selector" && (
                  <p>系统自动检测到页面中的 <code className="text-primary bg-primary/5 px-1 rounded text-[10px]">{parsedResult?.cards[0]?.matchedBy}</code> 结构，已自动拆分为独立卡片。</p>
                )}
                {method === "separator" && (
                  <p>系统按分隔线或 <code className="text-primary bg-primary/5 px-1 rounded text-[10px]">---</code> 分页标记拆分卡片。</p>
                )}
                {method === "auto-split" && (
                  <p>系统按标题和内容体量自动拆分为多张 3:4 卡片，适合长文转组图。</p>
                )}
                {method === "heading" && (
                  <p>未找到卡片级元素，系统按标题（h2/h3）自动分割为内容块。</p>
                )}
                {method === "fallback" && (
                  <p>无法检测到多卡片结构，将以整页形式导出。</p>
                )}
              </div>
            </div>

          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={exportBusy || selectedIndices.size === 0}
          >
            {exportBusy ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                导出中...
              </>
            ) : (
              <>
                <Download className="size-3.5 mr-1.5" />
                导出 {selectedIndices.size} 张卡片
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
