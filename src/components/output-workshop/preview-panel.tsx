"use client"

import * as React from "react"
import {
  Code2,
  Eye,
  Laptop,
  Loader2,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Terminal,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { openPath } from "@tauri-apps/plugin-opener"
import { normalizeOutputWorkshopHtml } from "@/lib/output-workshop/html-normalizer"
import { parseSmartCards, type SmartCard } from "@/lib/output-workshop/smart-card-export"
import type { TemplateOverrides } from "./types"
import { getStatusText } from "./utils"
import {
  BUILD_STAGES,
  DEFAULT_TEMPLATE_OVERRIDES,
  getMermaidRenderModeLabel,
  getPresetById,
  PREVIEW_SIZE_PRESETS,
} from "./workshop-controls"
import { useWorkshopContext } from "./workshop-context"

// 流式脉冲边框关键帧（CSS-in-JS 注入一次）
const STREAMING_STYLE_ID = "ow-streaming-keyframes"
function ensureStreamingStyle() {
  if (typeof document === "undefined") return
  if (document.getElementById(STREAMING_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STREAMING_STYLE_ID
  style.textContent = `
    @keyframes ow-pulse-border {
      0%, 100% { border-color: hsl(var(--primary) / 0.25); }
      50% { border-color: hsl(var(--primary) / 0.65); }
    }
    @keyframes ow-shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(200%); }
    }
  `
  document.head.appendChild(style)
}

function injectScrollbarStyles(html: string): string {
  if (!html) return html
  const scrollbarCss = `
    <style id="lingmo-scrollbar-inject">
      ::-webkit-scrollbar {
        width: 4px !important;
        height: 4px !important;
      }
      ::-webkit-scrollbar-track {
        background: transparent !important;
      }
      ::-webkit-scrollbar-thumb {
        background: transparent !important;
        border-radius: 2px !important;
        transition: background-color 0.2s ease !important;
      }
      :hover::-webkit-scrollbar-thumb,
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(100, 116, 139, 0.35) !important;
      }
      * {
        scrollbar-width: none !important;
      }
      *:hover {
        scrollbar-width: thin !important;
      }
    </style>
  `
  if (html.includes("</head>")) {
    return html.replace("</head>", scrollbarCss + "</head>")
  }
  return html + scrollbarCss
}

const PREVIEW_OVERRIDE_STYLE_ID = "lingmo-output-preview-overrides"
const REDBOOK_PREVIEW_GRID_STYLE_ID = "lingmo-redbook-two-column-preview"

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function sanitizeHexColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_TEMPLATE_OVERRIDES.themeColor
}

function sanitizeFontFamily(value: string): string {
  const trimmed = value.trim().slice(0, 240)
  if (!trimmed || /[;{}<>]/.test(trimmed)) {
    return `"Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  }
  return trimmed
}

function buildTemplateOverrideCss(overrides: TemplateOverrides): string {
  const fontFamily = sanitizeFontFamily(overrides.fontFamily)
  const fontSize = clampNumber(overrides.fontSize, 18, 36, DEFAULT_TEMPLATE_OVERRIDES.fontSize)
  const lineHeight = clampNumber(overrides.lineHeight, 1.2, 1.9, DEFAULT_TEMPLATE_OVERRIDES.lineHeight)
  const themeColor = sanitizeHexColor(overrides.themeColor)
  const hasTypographyOverride =
    fontFamily !== sanitizeFontFamily(DEFAULT_TEMPLATE_OVERRIDES.fontFamily) ||
    fontSize !== DEFAULT_TEMPLATE_OVERRIDES.fontSize ||
    Math.abs(lineHeight - DEFAULT_TEMPLATE_OVERRIDES.lineHeight) > 0.001
  const hasThemeOverride = themeColor.toLowerCase() !== DEFAULT_TEMPLATE_OVERRIDES.themeColor.toLowerCase()

  const tokens = `
    :root, body {
      --ow-preview-font-family: ${fontFamily};
      --ow-preview-font-size: ${fontSize}px;
      --ow-preview-body-size: clamp(12px, calc(var(--ow-preview-font-size) * 0.58), 22px);
      --ow-preview-caption-size: clamp(10px, calc(var(--ow-preview-font-size) * 0.45), 15px);
      --ow-preview-h3-size: clamp(13px, calc(var(--ow-preview-font-size) * 0.67), 28px);
      --ow-preview-h2-size: clamp(18px, calc(var(--ow-preview-font-size) * 1.02), 42px);
      --ow-preview-h1-size: clamp(20px, calc(var(--ow-preview-font-size) * 1.25), 52px);
      --ow-preview-line-height: ${lineHeight};
      --ow-preview-theme-color: ${themeColor};
    }
  `

  const typographyCss = hasTypographyOverride
    ? `
      body,
      :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, span, a, strong, em, small, button, td, th, label, summary, [class*="title"], [class*="heading"], [class*="lead"], [class*="caption"], [class*="label"], [class*="body"], [class*="text"], [class*="copy"], [class*="description"]):not(pre):not(code):not(kbd):not(samp) {
        font-family: var(--ow-preview-font-family) !important;
      }

      body {
        font-size: var(--ow-preview-body-size) !important;
        line-height: var(--ow-preview-line-height) !important;
      }

      :is(p, li, blockquote, figcaption, td, th, [class*="body"], [class*="text"], [class*="copy"], [class*="description"]) {
        font-size: var(--ow-preview-body-size) !important;
        line-height: var(--ow-preview-line-height) !important;
      }

      :is(h1, [class*="hero-title"], [class*="main-title"], [class*="cover-title"], [class*="card-title"]) {
        font-size: var(--ow-preview-h1-size) !important;
        line-height: 1.18 !important;
      }

      :is(h2, [class*="section-title"], [class*="slide-title"], [class*="heading"]) {
        font-size: var(--ow-preview-h2-size) !important;
        line-height: 1.22 !important;
      }

      :is(h3, h4) {
        font-size: var(--ow-preview-h3-size) !important;
        line-height: 1.3 !important;
      }

      :is(small, figcaption, [class*="caption"], [class*="label"], [class*="tag"], [class*="badge"]) {
        font-size: var(--ow-preview-caption-size) !important;
      }

      pre, code, kbd, samp {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
      }
    `
    : ""

  const themeCss = hasThemeOverride
    ? `
      :root, body {
        --accent: var(--ow-preview-theme-color) !important;
        --primary: var(--ow-preview-theme-color) !important;
        --theme-color: var(--ow-preview-theme-color) !important;
        --brand: var(--ow-preview-theme-color) !important;
      }

      :is(a, mark, [class*="accent"], [class*="highlight"], [class*="kicker"]) {
        color: var(--ow-preview-theme-color) !important;
      }

      :is([class*="accent-bg"], [class*="number-badge"]) {
        background-color: var(--ow-preview-theme-color) !important;
      }

      :is(blockquote, [class*="accent"], [class*="highlight"], [class*="badge"], [class*="tag"]) {
        border-color: var(--ow-preview-theme-color) !important;
      }

      :is([class*="tag"], [class*="badge"], [class*="chip"]) {
        background-color: color-mix(in srgb, var(--ow-preview-theme-color) 12%, transparent) !important;
      }
    `
    : ""

  return [tokens, typographyCss, themeCss].filter(Boolean).join("\n")
}

function injectTemplateOverrideStyles(html: string, overrides: TemplateOverrides): string {
  if (!html) return html

  const style = `<style id="${PREVIEW_OVERRIDE_STYLE_ID}">${buildTemplateOverrideCss(overrides)}</style>`
  const existingStyleRegex = new RegExp(
    `<style\\b(?=[^>]*\\bid=["']${PREVIEW_OVERRIDE_STYLE_ID}["'])[^>]*>[\\s\\S]*?<\\/style>`,
    "i"
  )
  if (existingStyleRegex.test(html)) {
    return html.replace(existingStyleRegex, style)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`)
  }
  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, `<body$1>${style}`)
  }
  return `${style}${html}`
}

function isRedbookPreviewHtml(html: string, templateId?: string): boolean {
  return Boolean(
    templateId?.startsWith("social-redbook-") ||
    /\bclass=["'][^"']*\bredbook-deck\b/i.test(html) ||
    /\bdata-redbook-card\b/i.test(html)
  )
}

function injectRedbookPreviewGridStyles(html: string, templateId?: string): string {
  if (!html || !isRedbookPreviewHtml(html, templateId)) return html

  const css = `
    @media (min-width: 900px) {
      :root {
        --lingmo-redbook-preview-zoom: 0.42;
      }

      body.redbook-output {
        overflow-x: hidden !important;
      }

      .redbook-deck {
        width: 100% !important;
        max-width: none !important;
        display: grid !important;
        grid-template-columns: repeat(2, max-content) !important;
        justify-content: center !important;
        justify-items: center !important;
        align-items: start !important;
        gap: 18px !important;
        padding: 18px !important;
        scroll-snap-type: none !important;
      }

      .redbook-deck > :is(.cover-container, .card-container, [data-redbook-card], [data-export-card]) {
        width: 1080px !important;
        height: 1440px !important;
        max-width: none !important;
        zoom: var(--lingmo-redbook-preview-zoom);
        scroll-snap-align: none !important;
      }
    }

    @media (min-width: 1180px) {
      :root {
        --lingmo-redbook-preview-zoom: 0.46;
      }

      .redbook-deck {
        gap: 22px !important;
        padding: 22px !important;
      }
    }

    @media (min-width: 1500px) {
      :root {
        --lingmo-redbook-preview-zoom: 0.5;
      }
    }
  `
  const style = `<style id="${REDBOOK_PREVIEW_GRID_STYLE_ID}">${css}</style>`
  const existingStyleRegex = new RegExp(
    `<style\\b(?=[^>]*\\bid=["']${REDBOOK_PREVIEW_GRID_STYLE_ID}["'])[^>]*>[\\s\\S]*?<\\/style>`,
    "i"
  )
  if (existingStyleRegex.test(html)) {
    return html.replace(existingStyleRegex, style)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`)
  }
  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, `<body$1>${style}`)
  }
  return `${style}${html}`
}

function buildPreviewSrcDoc(html: string, overrides: TemplateOverrides, templateId?: string): string {
  if (!html) return ""
  const normalized = normalizeOutputWorkshopHtml(html)
  const withScrollbar = injectScrollbarStyles(normalized)
  const withOverrides = injectTemplateOverrideStyles(withScrollbar, overrides)
  return injectRedbookPreviewGridStyles(withOverrides, templateId)
}

function LogRow({
  label,
  value,
  tone = "default",
  compact = false,
}: {
  label: string
  value: string
  tone?: "default" | "primary" | "success" | "destructive"
  compact?: boolean
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/20 bg-primary/5 text-primary"
      : tone === "success"
      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
      : tone === "destructive"
      ? "border-destructive/20 bg-destructive/5 text-destructive"
      : "border-border bg-background text-muted-foreground"

  return (
    <div className={cn("flex items-start gap-3 rounded-md border px-3", compact ? "py-1.5" : "py-2", toneClass)}>
      <span className="w-20 shrink-0 text-[10px] font-semibold">{label}</span>
      <span className="min-w-0 flex-1 break-all text-[11px] leading-relaxed text-foreground">{value}</span>
    </div>
  )
}

function formatTelemetryDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "等待中"
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function getFirstResponseText(telemetry: ReturnType<typeof useWorkshopContext>["generation"]["generationTelemetry"]): string {
  if (!telemetry.requestStartedAt) {
    return telemetry.phase === "local-build" ? "本地模板，无需 AI 响应" : "尚未请求"
  }
  if (!telemetry.firstByteAt) {
    return `等待首个响应 · ${formatTelemetryDuration(Date.now() - telemetry.requestStartedAt)}`
  }
  return `${formatTelemetryDuration(telemetry.firstByteAt - telemetry.requestStartedAt)} · ${telemetry.outputChars.toLocaleString()} chars`
}

function getGenerationWaitText(telemetry: ReturnType<typeof useWorkshopContext>["generation"]["generationTelemetry"] | undefined): string {
  if (!telemetry) return "正在准备"
  if (telemetry.phase === "local-build" || telemetry.phase === "finalizing") {
    return telemetry.phaseLabel
  }
  if (!telemetry.requestStartedAt) {
    return telemetry.phaseLabel || "正在准备"
  }
  if (!telemetry.firstByteAt) {
    return `请求已发出，正在等待首个响应 · ${formatTelemetryDuration(Date.now() - telemetry.requestStartedAt)}`
  }
  return `已收到响应 · ${telemetry.outputChars.toLocaleString()} chars`
}

function RedbookCardWall({
  cards,
  templateOverrides,
  selectedTemplateId,
}: {
  cards: SmartCard[]
  templateOverrides: TemplateOverrides
  selectedTemplateId: string
}) {
  return (
    <div className="flex min-h-full w-full justify-center overflow-y-auto bg-muted/20 px-4 py-5 [scrollbar-width:thin]">
      <div className="grid w-full max-w-[640px] grid-cols-1 justify-center gap-3 sm:grid-cols-[repeat(2,minmax(0,300px))]">
        {cards.map((card) => (
          <article
            key={card.index}
            className="group overflow-hidden rounded-md border bg-background shadow-sm transition-colors hover:border-primary/40"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted/20">
              <iframe
                title={`卡片预览 ${card.index + 1}: ${card.title}`}
                srcDoc={buildPreviewSrcDoc(card.html, templateOverrides, selectedTemplateId)}
                className="h-full w-full border-0 bg-background"
                sandbox="allow-same-origin"
                tabIndex={-1}
              />
              <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm">
                #{card.index + 1}
              </div>
            </div>
            <div className="flex h-8 items-center justify-between gap-2 border-t px-2">
              <p className="truncate text-[11px] font-medium text-foreground">{card.title}</p>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">3:4</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

// PreviewPanel 现通过 useWorkshopContext() 获取所有依赖，不再接受 props

export function PreviewPanel() {
  const ctx = useWorkshopContext()
  const {
    previewTab,
    setPreviewTab,
    viewMode,
    setViewMode,
    generatedHtml,
    setGeneratedHtml,
    hasGeneratedOutput,
    templateOverrides,
    setTemplateOverrides,
    activeSlideIdx,
    scrollToSlide,
    sourceLabel,
    sourceContent,
    sourceWorkspaceTab,
    sourcePanelCollapsed,
    toggleSourcePanel,
    iframeRef,
    selectedTemplateId,
    selectedTemplate,
  } = ctx
  const {
    status,
    errorMessage,
    progressText,
    elapsed,
    buildStageId,
    generationTelemetry,
    lastExportRecord,
    streamingHtml,
    exportBusy,
    exportProgressText,
    showDeployModal,
    deployProgress,
    deployedUrl,
    refining,
    handleGenerate,
  } = ctx.generation
  const selectedTemplatePreviewHtml = ctx.templates.selectedTemplatePreviewHtml
  const parsedDeckData = ctx.parsedDeckData
  const activeSizePreset = getPresetById(templateOverrides.sizePresetId)
  const isRedbookPreview = React.useMemo(() => {
    return isRedbookPreviewHtml(streamingHtml || generatedHtml || selectedTemplatePreviewHtml, selectedTemplateId)
  }, [generatedHtml, selectedTemplateId, selectedTemplatePreviewHtml, streamingHtml])
  const redbookPreviewCards = React.useMemo(() => {
    const html = streamingHtml || generatedHtml
    if (!html || !isRedbookPreviewHtml(html, selectedTemplateId)) return []
    try {
      return parseSmartCards(html, selectedTemplate.exportBlueprint).cards
    } catch {
      return []
    }
  }, [generatedHtml, selectedTemplate.exportBlueprint, selectedTemplateId, streamingHtml])
  const [mermaidStatus, setMermaidStatus] = React.useState<{ ok: boolean; text: string }>({
    ok: true,
    text: "未检测到 Mermaid 图表",
  })

  const previewHtml = React.useMemo(() => {
    const html = streamingHtml || generatedHtml
    return buildPreviewSrcDoc(html, templateOverrides, selectedTemplateId)
  }, [generatedHtml, selectedTemplateId, streamingHtml, templateOverrides])

  const templateExamplePreviewHtml = React.useMemo(() => {
    return buildPreviewSrcDoc(selectedTemplatePreviewHtml, templateOverrides, selectedTemplateId)
  }, [selectedTemplateId, selectedTemplatePreviewHtml, templateOverrides])

  // 2. 对 Mermaid 图表校验执行防抖优化，流式高频期间延缓 500ms 校验以释压主线程
  React.useEffect(() => {
    let disposed = false
    const source = streamingHtml || generatedHtml
    const delay = (status === "generating" || status === "streaming") ? 500 : 0

    const checkMermaid = () => {
      const blocks = Array.from(source.matchAll(/```mermaid\s*([\s\S]*?)```/gi)).map((match) => match[1].trim())
      if (blocks.length === 0) {
        setMermaidStatus({ ok: true, text: "未检测到 Mermaid 图表" })
        return
      }

      void import("mermaid").then(async (mod) => {
        const mermaid = mod.default
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose" })
        for (let i = 0; i < blocks.length; i++) {
          try {
            await mermaid.parse(blocks[i])
          } catch (error) {
            if (disposed) return
            const message = error instanceof Error ? error.message : String(error)
            const lineMatch = /line\s+(\d+)/i.exec(message)
            setMermaidStatus({
              ok: false,
              text: `第 ${i + 1} 个图表语法错误${lineMatch ? `，行 ${lineMatch[1]}` : ""}: ${message.slice(0, 120)}`,
            })
            return
          }
        }
        if (!disposed) {
          setMermaidStatus({
            ok: true,
            text: `${blocks.length} 个图表校验通过 · ${getMermaidRenderModeLabel(templateOverrides.mermaidRenderMode)}`,
          })
        }
      }).catch((error) => {
        if (!disposed) {
          setMermaidStatus({
            ok: false,
            text: `Mermaid 校验器加载失败: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      })
    }

    if (delay > 0) {
      const timer = setTimeout(checkMermaid, delay)
      return () => {
        disposed = true
        clearTimeout(timer)
      }
    } else {
      checkMermaid()
      return () => {
        disposed = true
      }
    }
  }, [generatedHtml, streamingHtml, templateOverrides.mermaidRenderMode, status])

  const openExportLocation = React.useCallback(() => {
    if (!lastExportRecord?.filePath) return
    void openPath(lastExportRecord.filePath)
  }, [lastExportRecord])
  const handleSizePresetChange = React.useCallback((presetId: TemplateOverrides["sizePresetId"]) => {
    setTemplateOverrides({ ...templateOverrides, sizePresetId: presetId })
    setViewMode(presetId === "auto" ? "desktop" : "locked")
  }, [setTemplateOverrides, setViewMode, templateOverrides])
  const previewTabs = [
    { id: "preview", label: "预览", icon: Eye },
    { id: "code", label: "代码", icon: Code2 },
    { id: "log", label: "日志", icon: Terminal },
  ] as const

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-2.5 py-1.5">
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1">
          {previewTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPreviewTab(tab.id)}
                className={cn(
                  "flex h-7 min-w-16 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                  previewTab === tab.id
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

        <div className="hidden min-w-0 flex-1 md:block" />

        <div className="flex items-center gap-1">
          {previewTab === "preview" && (
            <>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px] shadow-none">
                    {activeSizePreset.label}
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36 p-1">
                {PREVIEW_SIZE_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => handleSizePresetChange(preset.id)}
                    className={cn(
                      "h-8 cursor-pointer justify-between text-xs",
                      templateOverrides.sizePresetId === preset.id && "bg-muted font-semibold"
                    )}
                    title={`${preset.description}${preset.id === "auto" ? "" : ` · ${preset.width}x${preset.height}`}`}
                  >
                    <span>{preset.label}</span>
                    <span className="text-[10px] font-normal text-muted-foreground">{preset.description}</span>
                  </DropdownMenuItem>
                ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => setViewMode("desktop")}
                className={cn(
                  "grid size-6 place-items-center rounded-md transition-colors",
                  viewMode === "desktop" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
                title="桌面宽屏模式"
                aria-label="桌面宽屏模式"
              >
                <Laptop className="size-3" />
              </button>
              <button
                onClick={() => setViewMode("mobile")}
                className={cn(
                  "grid size-6 place-items-center rounded-md transition-colors",
                  viewMode === "mobile" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
                title="移动端外壳模式"
                aria-label="移动端外壳模式"
              >
                <Smartphone className="size-3" />
              </button>
              <button
                onClick={toggleSourcePanel}
                className={cn(
                  "grid size-6 place-items-center rounded-md transition-colors",
                  sourcePanelCollapsed ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
                title={sourcePanelCollapsed ? "退出全屏预览" : "全屏预览"}
                aria-label={sourcePanelCollapsed ? "退出全屏预览" : "全屏预览"}
              >
                {sourcePanelCollapsed ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {previewTab === "preview" && (() => {
          const isStreamingActive = !!(streamingHtml && (status === "generating" || status === "streaming") && !refining)
          const showOutputIframe = (hasGeneratedOutput || streamingHtml) && (status !== "generating" && status !== "streaming" || refining || !!streamingHtml)
          const showSpinner = (status === "generating" || status === "streaming") && !refining && !streamingHtml
          const freezePreviewInteraction = sourceWorkspaceTab !== "edit"

          // 注入流式动画关键帧
          if (isStreamingActive) ensureStreamingStyle()

          return (
            <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto overflow-x-hidden bg-muted/20 p-4 select-text [scrollbar-width:thin]">
              {/* 阶段一：等待 AI 首字节时的 spinner */}
              {showSpinner && (
                <div className="absolute inset-0 z-20 grid place-items-center p-4">
                  <div className="flex w-[320px] max-w-[calc(100vw-48px)] flex-col items-center justify-center rounded-lg border bg-background p-6 text-center animate-in fade-in duration-150">
                    <Loader2 className="mb-3 size-6 animate-spin text-primary" />
                    <p className="text-sm font-semibold text-foreground">{progressText || "AI 正在分析..."}</p>
                    <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-muted-foreground">
                      {getGenerationWaitText(generationTelemetry)}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                      {(elapsed / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              )}

              {/* 错误状态 */}
              {status === "error" && (
                <div className="z-20 flex max-w-sm flex-col items-center justify-center rounded-lg border border-destructive/25 bg-background p-6 text-center animate-in fade-in duration-150">
                  <div className="mb-4 flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                    <AlertTriangle className="size-5" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">网页生成失败</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground/80">{errorMessage}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <Button className="h-8 px-4 text-xs shadow-none" size="sm" onClick={handleGenerate}>
                      重新生成
                    </Button>
                    <Button
                      className="h-8 px-4 text-xs shadow-none"
                      size="sm"
                      variant="outline"
                      onClick={() => void navigator.clipboard?.writeText(errorMessage || "智能排版生成失败")}
                    >
                      复制错误
                    </Button>
                  </div>
                </div>
              )}

              {/* 空闲时的模板示例预览 */}
              {status === "idle" && !hasGeneratedOutput && (
                <div className="z-10 flex h-full w-full max-w-[1280px] select-none flex-col">
                  <div className="min-h-[420px] flex-1 overflow-hidden rounded-md border border-border/70 bg-background">
                    <iframe
                      title="当前模板示例预览"
                      srcDoc={templateExamplePreviewHtml}
                      className="h-full w-full border-0 bg-background"
                      sandbox="allow-scripts allow-same-origin"
                    />
                  </div>
                </div>
              )}

              {/* 已有输出 / 流式输出 */}
              {showOutputIframe && (
                <div
                  className={cn(
                    "relative flex flex-col items-center justify-center transition-all duration-300",
                    // 流式脉冲边框
                    isStreamingActive && "animate-[ow-pulse-border_2s_ease-in-out_infinite]",
                    // 基础视口样式
                  viewMode === "mobile"
                      ? "h-[600px] w-[340px] overflow-hidden rounded-lg border bg-background"
                      : isRedbookPreview
                      ? "min-h-full w-full max-w-[1180px] overflow-hidden rounded-md border bg-background"
                      : viewMode === "locked" && activeSizePreset.id !== "auto"
                      ? "overflow-hidden rounded-md border bg-background"
                      : "min-h-full w-full max-w-none overflow-hidden bg-background"
                  )}
                  style={viewMode === "locked" && activeSizePreset.id !== "auto" && !isRedbookPreview ? {
                    width: `min(${activeSizePreset.width / 2}px, calc(100vw - 96px))`,
                    maxHeight: "calc(100vh - 160px)",
                    aspectRatio: `${activeSizePreset.width} / ${activeSizePreset.height}`,
                  } : undefined}
                >
                  {/* 流式顶部 shimmer 进度条 */}
                  {isStreamingActive && (
                    <div className="absolute inset-x-0 top-0 z-50 h-[2px] overflow-hidden bg-primary/10">
                      <div
                        className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary/70 to-transparent animate-[ow-shimmer_1.5s_ease-in-out_infinite]"
                      />
                    </div>
                  )}

                  {/* 流式右下角状态气泡 */}
                  {isStreamingActive && (
                    <div className="absolute bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-md border border-primary/20 bg-background px-2.5 py-1 animate-in fade-in duration-150">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span className="max-w-[220px] truncate text-[10px] font-medium text-primary">{generationTelemetry.phaseLabel || progressText}</span>
                      <span className="text-[9px] text-muted-foreground">{(elapsed / 1000).toFixed(0)}s</span>
                    </div>
                  )}

                  {viewMode === "mobile" && (
                    <div className="absolute left-1/2 top-2 z-20 h-1 w-16 -translate-x-1/2 rounded-full bg-muted-foreground/35 select-none" />
                  )}

                  {isRedbookPreview && viewMode !== "mobile" && redbookPreviewCards.length > 1 ? (
                    <>
                      <RedbookCardWall
                        cards={redbookPreviewCards}
                        templateOverrides={templateOverrides}
                        selectedTemplateId={selectedTemplateId}
                      />
                      <iframe
                        ref={iframeRef}
                        key={`export-source-${streamingHtml.length || generatedHtml.length}`}
                        srcDoc={previewHtml}
                        className="pointer-events-none absolute -left-[10000px] top-0 h-[720px] w-[540px] border-0 opacity-0"
                        title="智能排版导出源视口"
                        sandbox={
                          status === "generating" || status === "streaming" || freezePreviewInteraction
                            ? "allow-same-origin"
                            : "allow-scripts allow-same-origin allow-downloads allow-forms"
                        }
                        tabIndex={-1}
                      />
                    </>
                  ) : (
                    <iframe
                      ref={iframeRef}
                      key={
                        status === "generating" || status === "streaming"
                          ? `streaming-iframe-${streamingHtml.length}`
                          : freezePreviewInteraction
                            ? "static-iframe"
                            : "interactive-iframe"
                      }
                      srcDoc={previewHtml}
                      className="w-full flex-1 border-0 bg-background"
                      title="智能排版预览视口"
                      sandbox={
                        status === "generating" || status === "streaming" || freezePreviewInteraction
                          ? "allow-same-origin"
                          : "allow-scripts allow-same-origin allow-downloads allow-forms"
                      }
                    />
                  )}

                  {viewMode === "mobile" && (
                    <div className="absolute bottom-1.5 left-1/2 z-20 h-1 w-20 -translate-x-1/2 rounded-full bg-muted-foreground/20 select-none" />
                  )}
                </div>
            )}
              {parsedDeckData.isDeck && (
                <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-md border bg-background p-1">
                  {parsedDeckData.slides.map((slide, idx) => (
                    <button
                      key={slide.id || idx}
                      type="button"
                      onClick={() => scrollToSlide(idx)}
                      className={cn(
                        "h-7 min-w-7 rounded-full px-2 text-[10px] font-semibold transition-colors",
                        activeSlideIdx === idx ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      title={slide.title}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              )}
          </div>
          )
        })()}

        {previewTab === "code" && (
          <div className="flex h-full flex-col bg-[#15140f] text-[#e8e4dc]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-4 text-[10px] text-[#9ca28a]">
              <span>HTML 源码</span>
              <span>{generatedHtml.length.toLocaleString()} chars</span>
            </div>
            <textarea
              value={generatedHtml}
              onChange={(e) => setGeneratedHtml(e.target.value)}
              spellCheck={false}
              placeholder="生成后的 HTML 源码会显示在这里，也可以直接修正后回到 Preview 查看。"
              className="min-h-0 flex-1 resize-none bg-[#15140f] p-4 font-mono text-[11.5px] leading-relaxed text-[#e8e4dc] outline-none placeholder:text-[#8b8676]"
            />
          </div>
        )}

        {previewTab === "log" && (
          <ScrollArea className="h-full bg-background">
            <div className="space-y-2 p-3 font-mono text-[11px]">
              <div className="grid gap-2 lg:grid-cols-3">
                <LogRow label="状态" value={getStatusText(status)} tone={status === "error" ? "destructive" : "default"} compact />
                <LogRow label="耗时" value={`${(elapsed / 1000).toFixed(1)}s`} tone={status === "generating" || status === "streaming" ? "primary" : "default"} compact />
                <LogRow label="输出" value={`${generatedHtml.length.toLocaleString()} chars`} compact />
              </div>
              <div className="grid gap-2 lg:grid-cols-3">
                <LogRow label="当前阶段" value={generationTelemetry.phaseLabel || "等待生成"} tone={status === "generating" || status === "streaming" ? "primary" : "default"} compact />
                <LogRow label="首响应" value={getFirstResponseText(generationTelemetry)} tone={generationTelemetry.firstByteAt ? "success" : status === "streaming" ? "primary" : "default"} compact />
                <LogRow label="本轮输出" value={`${generationTelemetry.outputChars.toLocaleString()} chars`} compact />
              </div>
              <div className="rounded-md border bg-muted/15 p-2">
                <div className="mb-2 text-[10px] font-semibold text-muted-foreground">渲染步骤</div>
                <div className="grid gap-1 sm:grid-cols-4">
                  {BUILD_STAGES.map((stage) => {
                    const activeIndex = BUILD_STAGES.findIndex((item) => item.id === buildStageId)
                    const currentIndex = BUILD_STAGES.findIndex((item) => item.id === stage.id)
                    const reached = activeIndex >= currentIndex && activeIndex !== -1
                    const current = stage.id === buildStageId
                    return (
                      <div
                        key={stage.id}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-[10px]",
                          current
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : reached
                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
                            : "border-border bg-background text-muted-foreground"
                        )}
                      >
                        {stage.label}
                      </div>
                    )
                  })}
                </div>
              </div>
              {status === "error" && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <div className="mb-1 text-[10px] font-semibold text-destructive">错误信息</div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">{errorMessage}</pre>
                </div>
              )}
              <LogRow label="阶段" value={buildStageId ? BUILD_STAGES.find((stage) => stage.id === buildStageId)?.label || buildStageId : "等待构建"} tone={status === "generating" || status === "streaming" ? "primary" : "default"} compact />
              <LogRow
                label="质量检查"
                value={generationTelemetry.qualityChecked ? generationTelemetry.qualitySummary : "等待最终 HTML"}
                tone={generationTelemetry.severeFindingCount > 0 ? "destructive" : generationTelemetry.qualityChecked ? "success" : "default"}
                compact
              />
              <LogRow
                label="修复状态"
                value={generationTelemetry.repairTriggered ? "已触发一次 AI 修复" : "未触发修复"}
                tone={generationTelemetry.repairTriggered ? "primary" : "default"}
                compact
              />
              <LogRow label="画幅" value={`${activeSizePreset.label} ${activeSizePreset.id === "auto" ? "自适应" : `${activeSizePreset.width}x${activeSizePreset.height}`} · 安全区 ${templateOverrides.safeAreaEnabled ? "开启" : "关闭"}`} compact />
              <LogRow label="模板参数" value={`字体 ${templateOverrides.fontFamily} · ${templateOverrides.fontSize}px / ${templateOverrides.lineHeight} · 间距 ${templateOverrides.cardGap}px · 贴纸 ${templateOverrides.stickersEnabled ? "开" : "关"}`} compact />
              <div className={cn(
                "flex items-start gap-3 rounded-md border px-3 py-1.5",
                mermaidStatus.ok ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700" : "border-destructive/20 bg-destructive/5 text-destructive"
              )}>
                <span className="w-20 shrink-0 text-[10px] font-semibold">Mermaid</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5 break-all text-[11px] leading-relaxed text-foreground">
                  {mermaidStatus.ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <AlertTriangle className="size-3.5 text-destructive" />}
                  {mermaidStatus.text}
                </span>
              </div>
              <LogRow label="来源" value={sourceLabel || "手动输入"} compact />
              <LogRow label="素材" value={`${sourceContent.trim().length.toLocaleString()} chars`} compact />
              {(status === "generating" || status === "streaming") && (
                <LogRow label="进度" value={`${progressText} · ${(elapsed / 1000).toFixed(1)}s`} tone="primary" compact />
              )}
              {exportBusy && <LogRow label="导出" value={exportProgressText} tone="primary" compact />}
              {lastExportRecord && (
                <div className="flex items-start gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-700">
                  <span className="w-20 shrink-0 text-[10px] font-semibold">文件</span>
                  <span className="min-w-0 flex-1 break-all text-xs text-foreground">
                    {lastExportRecord.label}: {lastExportRecord.filePath || lastExportRecord.fileName || "已交给浏览器下载"}
                  </span>
                  {lastExportRecord.filePath && (
                    <button
                      type="button"
                      onClick={openExportLocation}
                      className="shrink-0 rounded-md border bg-background px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
                    >
                      打开位置
                    </button>
                  )}
                </div>
              )}
              {showDeployModal && <LogRow label="部署" value={deployProgress || "等待部署配置"} tone="primary" />}
              {deployedUrl && <LogRow label="URL" value={deployedUrl} tone="success" />}
            </div>
          </ScrollArea>
        )}

      </div>
    </div>
  )
}
