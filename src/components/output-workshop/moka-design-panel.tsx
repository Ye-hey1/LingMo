"use client"

import * as React from "react"
import { ImageIcon, Palette, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import {
  MOKA_AI_SINGLE_TEMPLATE_ID,
  MOKA_AI_SPLIT_TEMPLATE_ID,
  MOKA_PALETTES,
  MOKA_SINGLE_STYLES,
  MOKA_SPLIT_STYLES,
  getMokaPalette,
} from "@/lib/output-workshop/moka"

export type MokaPanelMode = "single" | "split"
export type MokaPanelPlatform = "xhs" | "wechat"

interface MokaDesignPanelProps {
  mode: MokaPanelMode
  setMode: (mode: MokaPanelMode) => void
  platform: MokaPanelPlatform
  setPlatform: (platform: MokaPanelPlatform) => void
  styleId: string
  setStyleId: (styleId: string) => void
  paletteId: string
  setPaletteId: (paletteId: string) => void
  referenceImageDataUrl: string
  referenceImageName: string
  onReferenceImageChange: (dataUrl: string, name: string) => void
  onClearReferenceImage: () => void
  onSelectTemplate: (templateId: string) => void
  onThemeColorChange: (color: string) => void
  className?: string
}

function getMokaAiTemplateId(mode: MokaPanelMode): string {
  return mode === "single" ? MOKA_AI_SINGLE_TEMPLATE_ID : MOKA_AI_SPLIT_TEMPLATE_ID
}

function getDefaultStyleId(_mode: MokaPanelMode): string {
  return "ai"
}

function resolveStyleId(mode: MokaPanelMode, styleId: string): string {
  const styles = mode === "single" ? MOKA_SINGLE_STYLES : MOKA_SPLIT_STYLES
  return styles.some((style) => style.id === styleId) ? styleId : getDefaultStyleId(mode)
}

function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex
}

export function MokaDesignPanel({
  mode,
  setMode,
  platform,
  setPlatform,
  styleId,
  setStyleId,
  paletteId,
  setPaletteId,
  referenceImageDataUrl,
  referenceImageName,
  onReferenceImageChange,
  onClearReferenceImage,
  onSelectTemplate,
  onThemeColorChange,
  className,
}: MokaDesignPanelProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const styles = mode === "single" ? MOKA_SINGLE_STYLES : MOKA_SPLIT_STYLES
  const activePalette = getMokaPalette(paletteId)
  const activeTone = withAlpha(activePalette.a, "14")
  const activeBorder = withAlpha(activePalette.a, "73")

  const selectMode = React.useCallback((nextMode: MokaPanelMode) => {
    const nextStyleId = resolveStyleId(nextMode, styleId)
    setMode(nextMode)
    setStyleId(nextStyleId)
    onSelectTemplate(getMokaAiTemplateId(nextMode))
  }, [onSelectTemplate, setMode, setStyleId, styleId])

  const handleFile = React.useCallback((file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: "请选择图片文件", variant: "destructive" })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "参考图不能超过 5MB", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      if (!result) {
        toast({ title: "读取参考图失败", variant: "destructive" })
        return
      }
      onReferenceImageChange(result, file.name)
      toast({ title: "已添加参考图" })
    }
    reader.onerror = () => toast({ title: "读取参考图失败", variant: "destructive" })
    reader.readAsDataURL(file)
  }, [onReferenceImageChange])

  return (
    <section
      className={cn("bg-background", className)}
      data-testid="moka-ai-design-panel"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b bg-muted/20 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md border bg-background"
            style={{ color: activePalette.a, borderColor: activeBorder, backgroundColor: activeTone }}
          >
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-foreground">Moka AI 设计</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {mode === "single" ? "单页" : "分页"} / {platform === "xhs" ? "小红书" : "公众号"} / {activePalette.label}
            </div>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: activePalette.a }} />
          {activePalette.label}
        </span>
      </div>

      <div className="grid gap-3 p-2.5">
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold text-muted-foreground">类型</div>
              <div className="text-[10px] font-semibold text-muted-foreground">平台</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/55 p-1">
              {([
                ["split", "分页"],
                ["single", "单页"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectMode(id)}
                  className={cn(
                    "h-7 rounded border text-[11px] font-medium transition-colors",
                    mode === id ? "bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                  style={mode === id ? { borderColor: activeBorder } : undefined}
                >
                  {label}
                </button>
              ))}
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/55 p-1">
              {([
                ["xhs", "小红书"],
                ["wechat", "公众号"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPlatform(id)}
                  className={cn(
                    "h-7 rounded border text-[11px] font-medium transition-colors",
                    platform === id ? "bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                  style={platform === id ? { borderColor: activeBorder } : undefined}
                >
                  {label}
                </button>
              ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 border-t pt-2.5">
            <div className="text-[10px] font-semibold text-muted-foreground">参考图</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.currentTarget.value = ""
              }}
            />
            {referenceImageDataUrl ? (
              <div className="grid grid-cols-[42px_1fr_28px] items-center gap-2 rounded-md border bg-background p-1.5">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="overflow-hidden rounded border bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview, not a remote optimized image */}
                  <img src={referenceImageDataUrl} alt="参考图" className="size-10 object-cover" />
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="min-w-0 text-left">
                  <span className="block truncate text-[11px] font-medium text-foreground">{referenceImageName || "参考图"}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">点击替换参考图</span>
                </button>
                <button
                  type="button"
                  onClick={onClearReferenceImage}
                  className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="清除参考图"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/25 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                style={{ borderColor: withAlpha(activePalette.a, "40") }}
              >
                <ImageIcon className="size-3.5" />
                参考图
              </button>
            )}
          </div>
        </div>

        <div className="grid min-w-0 gap-3 border-t pt-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                <Palette className="size-3" />
                配色
              </div>
              <div className="text-[10px] text-muted-foreground">{activePalette.label}</div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {MOKA_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  type="button"
                  onClick={() => {
                    setPaletteId(palette.id)
                    onThemeColorChange(palette.a)
                  }}
                  className={cn(
                    "h-7 rounded-md border bg-background p-0.5 transition-colors hover:bg-muted/50",
                    paletteId === palette.id ? "ring-1 ring-offset-1 ring-offset-background" : "border-border"
                  )}
                  style={paletteId === palette.id ? { borderColor: palette.a, "--tw-ring-color": palette.a } as React.CSSProperties : undefined}
                  title={palette.label}
                >
                  <span className="block h-full rounded-[3px]" style={{ background: `linear-gradient(135deg, ${palette.a} 0%, ${palette.a} 42%, ${palette.bg} 43%, ${palette.bg} 100%)` }} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 border-t pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold text-muted-foreground">风格</div>
              <div className="text-[10px] text-muted-foreground">{styles.length}</div>
            </div>
            <div className="grid max-h-60 grid-cols-2 gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {styles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setStyleId(style.id)}
                  className={cn(
                    "h-8 min-w-0 rounded-md border px-1.5 text-left transition-colors",
                    styleId === style.id ? "bg-muted/60 text-foreground" : "border-border bg-background hover:bg-muted/50"
                  )}
                  style={styleId === style.id ? { borderColor: activeBorder, backgroundColor: activeTone } : undefined}
                  title={style.desc}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium">
                    <span className="shrink-0">{style.icon}</span>
                    <span className="truncate">{style.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
