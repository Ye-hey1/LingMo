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
  exportBusy: boolean
  onExport: (cards: SmartCard[], preset: PreviewSizePreset, selectedIndices: number[]) => void
}

// ---------------------------------------------------------------------------
// Detection method label
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, { label: string; color: string }> = {
  blueprint: { label: "模板定义", color: "text-blue-600 bg-blue-50 border-blue-200" },
  selector: { label: "自动检测", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  heading: { label: "标题分割", color: "text-amber-600 bg-amber-50 border-amber-200" },
  fallback: { label: "整页导出", color: "text-slate-600 bg-slate-50 border-slate-200" },
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
  exportBusy,
  onExport,
}: SmartCardDialogProps) {
  // Parse cards from HTML
  const [parsedResult, setParsedResult] = React.useState<SmartCardParsed | null>(null)
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(new Set())
  const [currentPresetId, setCurrentPresetId] = React.useState<PreviewSizePreset["id"]>(sizePresetId)
  const [thumbnails, setThumbnails] = React.useState<Map<number, string>>(new Map())
  const [loadingThumbs, setLoadingThumbs] = React.useState(false)

  const currentPreset = getPresetById(currentPresetId) || PREVIEW_SIZE_PRESETS[0]

  // Parse cards when dialog opens or HTML changes
  React.useEffect(() => {
    if (!open || !generatedHtml) {
      setParsedResult(null)
      return
    }

    const blueprint: ExportBlueprint | undefined = selectedTemplate?.exportBlueprint
    const result = parseSmartCards(generatedHtml, blueprint)
    setParsedResult(result)

    // Auto-select all cards
    const allIndices = new Set(result.cards.map((c) => c.index))
    setSelectedIndices(allIndices)

    // Auto-select preset from blueprint
    if (blueprint?.defaultRatio) {
      const match = PREVIEW_SIZE_PRESETS.find((p) => p.id === blueprint.defaultRatio)
      if (match) setCurrentPresetId(match.id)
    }
  }, [open, generatedHtml, selectedTemplate])

  // Generate thumbnails
  React.useEffect(() => {
    if (!parsedResult || parsedResult.cards.length === 0) return

    let cancelled = false
    setLoadingThumbs(true)
    const newThumbs = new Map<number, string>()

    const generateAll = async () => {
      for (const card of parsedResult.cards) {
        if (cancelled) break
        try {
          const dataUrl = await renderCardThumbnail(card, 270, 360)
          if (cancelled) break
          newThumbs.set(card.index, dataUrl)
          setThumbnails(new Map(newThumbs))
        } catch {
          // Skip failed thumbnail
        }
      }
      setLoadingThumbs(false)
    }

    generateAll()
    return () => { cancelled = true }
  }, [parsedResult])

  // Selection helpers
  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const selectAll = () => {
    if (!parsedResult) return
    setSelectedIndices(new Set(parsedResult.cards.map((c) => c.index)))
  }

  const deselectAll = () => {
    setSelectedIndices(new Set())
  }

  const handleExport = () => {
    if (!parsedResult) return
    onExport(parsedResult.cards, currentPreset, Array.from(selectedIndices))
  }

  const handleDownloadSingle = async (card: SmartCard) => {
    try {
      const filename = `card-${card.index + 1}.png`
      await downloadSingleCard(card, currentPreset.width, currentPreset.height, filename)
      toast({ title: `已导出: ${filename}` })
    } catch (e) {
      toast({ title: "导出失败", description: String(e), variant: "destructive" })
    }
  }

  const cards = parsedResult?.cards ?? []
  const method = parsedResult?.detectionMethod ?? "fallback"
  const methodInfo = METHOD_LABELS[method] ?? METHOD_LABELS.fallback

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[10040] max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4.5" />
            智能卡片导出
          </DialogTitle>
          <DialogDescription>
            自动识别页面中的卡片结构，每张卡片独立渲染为高清 PNG，打包为 ZIP 下载。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          {/* 左侧 — 卡片预览网格 */}
          <div className="space-y-3">
            {/* 顶栏：检测信息 + 全选 */}
            <div className="flex items-center justify-between">
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
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={selectAll}>
                  全选
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={deselectAll}>
                  取消全选
                </Button>
              </div>
            </div>

            {/* 卡片网格 */}
            {cards.length > 0 ? (
              <div className="grid grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                {cards.map((card) => {
                  const isSelected = selectedIndices.has(card.index)
                  const thumb = thumbnails.get(card.index)
                  return (
                    <div
                      key={card.index}
                      className={cn(
                        "relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all group",
                        isSelected
                          ? "border-primary shadow-md ring-1 ring-primary/20"
                          : "border-border hover:border-primary/40 opacity-70 hover:opacity-100"
                      )}
                      onClick={() => toggleSelect(card.index)}
                    >
                      {/* 缩略图 */}
                      <div className="aspect-[3/4] bg-muted/30 flex items-center justify-center overflow-hidden">
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
                            <Loader2 className={cn("size-4 animate-spin", !loadingThumbs && "hidden")} />
                            <span className="text-[9px]">#{card.index + 1}</span>
                          </div>
                        )}
                      </div>

                      {/* 选中标记 */}
                      <div className="absolute top-1.5 left-1.5">
                        {isSelected ? (
                          <CheckSquare className="size-4 text-primary fill-primary/20" />
                        ) : (
                          <Square className="size-4 text-muted-foreground/60" />
                        )}
                      </div>

                      {/* 序号和标题 */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                        <p className="text-[9px] text-white font-semibold truncate">
                          #{card.index + 1} {card.title}
                        </p>
                      </div>

                      {/* 单独下载按钮 */}
                      <button
                        className={cn(
                          "absolute top-1.5 right-1.5 size-5 rounded-md bg-black/50 text-white",
                          "flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity",
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
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border bg-muted/20 px-3 py-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">卡片总数</div>
                <div className="mt-0.5 text-xs font-bold">{cards.length}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">已选中</div>
                <div className="mt-0.5 text-xs font-bold text-primary">{selectedIndices.size}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">导出尺寸</div>
                <div className="mt-0.5 text-xs font-bold">{currentPreset.width}×{currentPreset.height}</div>
              </div>
            </div>
          </div>

          {/* 右侧 — 导出控制 */}
          <div className="space-y-3.5">
            {/* 尺寸预设 */}
            <div className="rounded-xl border bg-muted/10 p-3.5 space-y-2.5">
              <div className="text-xs font-semibold text-muted-foreground">导出尺寸</div>
              <div className="grid grid-cols-2 gap-1.5">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.id !== "auto").map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setCurrentPresetId(preset.id)}
                    className={cn(
                      "h-7 rounded-md text-[10px] font-semibold transition-all border",
                      currentPresetId === preset.id
                        ? "bg-primary/10 text-primary border-primary/40"
                        : "bg-background text-muted-foreground hover:text-foreground border-input"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60">
                {currentPreset.description} — {currentPreset.width}×{currentPreset.height}px
              </p>
            </div>

            {/* 检测方式说明 */}
            <div className="rounded-xl border bg-muted/10 p-3.5 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">检测方式</div>
              <div className="text-[11px] leading-relaxed text-muted-foreground/80 space-y-1">
                {method === "blueprint" && (
                  <p>当前模板预定义了卡片选择器，系统精确匹配 <code className="text-primary bg-primary/5 px-1 rounded text-[10px]">{parsedResult?.cards[0]?.matchedBy}</code> 元素。</p>
                )}
                {method === "selector" && (
                  <p>系统自动检测到页面中的 <code className="text-primary bg-primary/5 px-1 rounded text-[10px]">{parsedResult?.cards[0]?.matchedBy}</code> 结构，已自动拆分为独立卡片。</p>
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
