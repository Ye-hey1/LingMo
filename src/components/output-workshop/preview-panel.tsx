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
import type {
  GenerationStatus,
  ViewMode,
  PreviewWorkspaceTab,
  SourceWorkspaceTab,
  BuildStage,
  ExportRecord,
  TemplateOverrides,
} from "./types"
import type { DeckParsed } from "@/lib/output-workshop/export"
import { getStatusText } from "./utils"
import { BUILD_STAGES, getMermaidRenderModeLabel, getPresetById, PREVIEW_SIZE_PRESETS } from "./workshop-controls"

// 流式脉冲边框关键帧（CSS-in-JS 注入一次）
const STREAMING_STYLE_ID = "ow-streaming-keyframes"
function ensureStreamingStyle() {
  if (typeof document === "undefined") return
  if (document.getElementById(STREAMING_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STREAMING_STYLE_ID
  style.textContent = `
    @keyframes ow-pulse-border {
      0%, 100% { border-color: hsl(var(--primary) / 0.25); box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
      50% { border-color: hsl(var(--primary) / 0.6); box-shadow: 0 0 12px 2px hsl(var(--primary) / 0.12); }
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
    <div className={cn("flex items-start gap-3 rounded-lg border px-3", compact ? "py-1.5" : "py-2", toneClass)}>
      <span className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider">{label}</span>
      <span className="min-w-0 flex-1 break-all text-[11px] leading-relaxed text-foreground">{value}</span>
    </div>
  )
}

interface PreviewPanelProps {
  // Preview workspace state
  previewTab: PreviewWorkspaceTab
  setPreviewTab: (tab: PreviewWorkspaceTab) => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // Generation state
  status: GenerationStatus
  errorMessage: string
  progressText: string
  elapsed: number
  generatedHtml: string
  setGeneratedHtml: (html: string) => void
  hasGeneratedOutput: boolean

  // Template info
  selectedTemplatePreviewHtml: string
  title: string

  // Viewport
  templateOverrides: TemplateOverrides
  setTemplateOverrides: (next: TemplateOverrides) => void
  buildStageId: BuildStage["id"] | null
  lastExportRecord: ExportRecord | null

  // Deck data
  parsedDeckData: DeckParsed
  activeSlideIdx: number
  setActiveSlideIdx: (idx: number) => void
  scrollToSlide: (idx: number) => void

  // Streaming
  streamingHtml: string

  // Refs
  iframeRef: React.RefObject<HTMLIFrameElement>

  // Export state
  exportBusy: boolean
  exportProgressText: string

  // Deploy state
  showDeployModal: boolean
  deployProgress: string
  deployedUrl: string

  // Source info for log tab
  sourceLabel: string
  sourceContent: string
  sourceWorkspaceTab: SourceWorkspaceTab

  // Refine
  refining: boolean
  handleStop: () => void
  handleGenerate: () => void

  // Fold
  sourcePanelCollapsed: boolean
  toggleSourcePanel: () => void
}

export function PreviewPanel({
  previewTab,
  setPreviewTab,
  viewMode,
  setViewMode,
  status,
  errorMessage,
  progressText,
  elapsed,
  generatedHtml,
  setGeneratedHtml,
  hasGeneratedOutput,
  selectedTemplatePreviewHtml,
  title: _title,
  templateOverrides,
  setTemplateOverrides,
  buildStageId,
  lastExportRecord,
  parsedDeckData,
  activeSlideIdx,
  scrollToSlide,
  streamingHtml,
  iframeRef,
  exportBusy,
  exportProgressText,
  showDeployModal,
  deployProgress,
  deployedUrl,
  sourceLabel,
  sourceContent,
  sourceWorkspaceTab,
  refining,
  sourcePanelCollapsed,
  toggleSourcePanel,
  handleStop: _handleStop,
  handleGenerate,
}: PreviewPanelProps) {
  const activeSizePreset = getPresetById(templateOverrides.sizePresetId)
  const [mermaidStatus, setMermaidStatus] = React.useState<{ ok: boolean; text: string }>({
    ok: true,
    text: "未检测到 Mermaid 图表",
  })

  const previewHtml = React.useMemo(() => {
    const html = streamingHtml || generatedHtml
    return html ? injectScrollbarStyles(normalizeOutputWorkshopHtml(html)) : ""
  }, [generatedHtml, streamingHtml])

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
  const activePreviewTab = previewTabs.find((tab) => tab.id === previewTab) ?? previewTabs[0]
  const ActivePreviewIcon = activePreviewTab.icon

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-2.5 py-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px] shadow-none">
              <ActivePreviewIcon className="size-3.5" />
              {activePreviewTab.label}
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-28 p-1">
            {previewTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <DropdownMenuItem
                  key={tab.id}
                  className={cn("h-8 cursor-pointer text-xs", previewTab === tab.id && "bg-muted font-semibold")}
                  onClick={() => setPreviewTab(tab.id)}
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden min-w-0 flex-1 md:block" />

        <div className="flex items-center gap-1">
          {previewTab === "preview" && (
            <>
              <DropdownMenu>
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
            <div
              className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto p-4 select-text"
              style={{
                backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
            >
              {/* 阶段一：等待 AI 首字节时的 spinner */}
              {showSpinner && (
                <div className="z-20 flex w-[320px] max-w-[calc(100vw-48px)] flex-col items-center justify-center rounded-2xl border bg-background p-8 text-center shadow-xl animate-in zoom-in-95 duration-200">
                  <Loader2 className="mb-3 size-7 animate-spin text-primary" />
                  <p className="text-sm font-semibold text-foreground">{progressText || "AI 正在分析..."}</p>
                  <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                    {(elapsed / 1000).toFixed(1)}s
                  </p>
                </div>
              )}

              {/* 错误状态 */}
              {status === "error" && (
                <div className="z-20 flex max-w-sm flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-background p-8 text-center shadow-xl animate-in zoom-in-95 duration-200">
                  <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <AlertTriangle className="size-6" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">网页生成失败</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground/80">{errorMessage}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <Button className="h-8 px-4 text-xs" size="sm" onClick={handleGenerate}>
                      重新生成
                    </Button>
                    <Button
                      className="h-8 px-4 text-xs"
                      size="sm"
                      variant="outline"
                      onClick={() => void navigator.clipboard?.writeText(errorMessage || "输出工坊生成失败")}
                    >
                      复制错误
                    </Button>
                  </div>
                </div>
              )}

              {/* 空闲时的模板示例预览 */}
              {status === "idle" && !hasGeneratedOutput && (
                <div className="z-10 flex h-full w-full max-w-[1280px] select-none flex-col">
                  <div className="min-h-[420px] flex-1 overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm">
                    <iframe
                      title="当前模板示例预览"
                      srcDoc={selectedTemplatePreviewHtml}
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
                      ? "h-[600px] w-[340px] overflow-hidden rounded-[36px] border-[6px] border-slate-900 bg-background shadow-lg"
                      : viewMode === "locked" && activeSizePreset.id !== "auto"
                      ? "overflow-hidden rounded-xl border bg-background shadow-lg"
                      : "h-full w-full max-w-none overflow-hidden bg-background"
                  )}
                  style={viewMode === "locked" && activeSizePreset.id !== "auto" ? {
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
                    <div className="absolute bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full bg-background/90 border border-primary/20 px-2.5 py-1 shadow-sm backdrop-blur-sm animate-in fade-in duration-300">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span className="text-[10px] font-medium text-primary">{progressText}</span>
                      <span className="text-[9px] text-muted-foreground">{(elapsed / 1000).toFixed(0)}s</span>
                    </div>
                  )}

                  {viewMode === "mobile" && (
                    <div className="absolute left-1/2 top-2 z-20 h-4 w-24 -translate-x-1/2 rounded-full bg-slate-900 select-none" />
                  )}

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
                    className={cn(
                      "w-full flex-1 border-0 bg-background",
                      freezePreviewInteraction && "pointer-events-none"
                    )}
                    title="输出工坊预览视口"
                    sandbox={
                      status === "generating" || status === "streaming" || freezePreviewInteraction
                        ? "allow-same-origin"
                        : "allow-scripts allow-same-origin allow-downloads allow-forms"
                    }
                  />

                  {viewMode === "mobile" && (
                    <div className="absolute bottom-1.5 left-1/2 z-20 h-1 w-28 -translate-x-1/2 rounded-full bg-slate-900/30 select-none" />
                  )}
                </div>
            )}
              {parsedDeckData.isDeck && (
                <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border bg-background/90 p-1 shadow-sm backdrop-blur">
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
                <LogRow label="STATUS" value={getStatusText(status)} tone={status === "error" ? "destructive" : "default"} compact />
                <LogRow label="ELAPSED" value={`${(elapsed / 1000).toFixed(1)}s`} tone={status === "generating" || status === "streaming" ? "primary" : "default"} compact />
                <LogRow label="OUTPUT" value={`${generatedHtml.length.toLocaleString()} chars`} compact />
              </div>
              <div className="rounded-lg border bg-muted/15 p-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">RENDER STEPS</div>
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
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-destructive">ERROR</div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">{errorMessage}</pre>
                </div>
              )}
              <LogRow label="STAGE" value={buildStageId ? BUILD_STAGES.find((stage) => stage.id === buildStageId)?.label || buildStageId : "等待构建"} tone={status === "generating" || status === "streaming" ? "primary" : "default"} compact />
              <LogRow label="SIZE" value={`${activeSizePreset.label} ${activeSizePreset.id === "auto" ? "自适应" : `${activeSizePreset.width}x${activeSizePreset.height}`} · 安全区 ${templateOverrides.safeAreaEnabled ? "开启" : "关闭"}`} compact />
              <LogRow label="TEMPLATE" value={`字体 ${templateOverrides.fontFamily} · ${templateOverrides.fontSize}px / ${templateOverrides.lineHeight} · 间距 ${templateOverrides.cardGap}px · 贴纸 ${templateOverrides.stickersEnabled ? "开" : "关"}`} compact />
              <div className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-1.5",
                mermaidStatus.ok ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700" : "border-destructive/20 bg-destructive/5 text-destructive"
              )}>
                <span className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider">MERMAID</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5 break-all text-[11px] leading-relaxed text-foreground">
                  {mermaidStatus.ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <AlertTriangle className="size-3.5 text-destructive" />}
                  {mermaidStatus.text}
                </span>
              </div>
              <LogRow label="SOURCE" value={sourceLabel || "手动输入"} compact />
              <LogRow label="CONTENT" value={`${sourceContent.trim().length.toLocaleString()} chars`} compact />
              {(status === "generating" || status === "streaming") && (
                <LogRow label="PROGRESS" value={`${progressText} · ${(elapsed / 1000).toFixed(1)}s`} tone="primary" compact />
              )}
              {exportBusy && <LogRow label="EXPORT" value={exportProgressText} tone="primary" compact />}
              {lastExportRecord && (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-700">
                  <span className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider">FILE</span>
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
              {showDeployModal && <LogRow label="DEPLOY" value={deployProgress || "等待部署配置"} tone="primary" />}
              {deployedUrl && <LogRow label="URL" value={deployedUrl} tone="success" />}
              {status === "error" && <LogRow label="ERROR" value={errorMessage} tone="destructive" />}
            </div>
          </ScrollArea>
        )}

      </div>
    </div>
  )
}
