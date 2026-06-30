"use client"

import * as React from "react"
import {
  ChevronDown,
  Loader2,
  Plus,
  Search,
  Star,
} from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { OutputTemplate, OutputMode } from "@/lib/output-workshop/templates"
import { useWorkshopContext } from "./workshop-context"

const TEMPLATE_PICKER_WIDTH = 460
const TEMPLATE_PICKER_HEIGHT = 420
const TEMPLATE_PICKER_GAP = 8
const TEMPLATE_PICKER_VIEWPORT_PADDING = 12

type TemplatePickerPosition = {
  top: number
  left: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function resolveTemplatePickerPosition(triggerRect: DOMRect): TemplatePickerPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const availableWidth = Math.max(0, viewportWidth - TEMPLATE_PICKER_VIEWPORT_PADDING * 2)
  const availableHeight = Math.max(0, viewportHeight - TEMPLATE_PICKER_VIEWPORT_PADDING * 2)
  const width = Math.min(
    TEMPLATE_PICKER_WIDTH,
    availableWidth
  )
  const height = Math.min(
    TEMPLATE_PICKER_HEIGHT,
    availableHeight
  )
  const left = clamp(
    triggerRect.left,
    TEMPLATE_PICKER_VIEWPORT_PADDING,
    viewportWidth - width - TEMPLATE_PICKER_VIEWPORT_PADDING
  )
  const belowTop = triggerRect.bottom + TEMPLATE_PICKER_GAP
  const aboveTop = triggerRect.top - height - TEMPLATE_PICKER_GAP
  const fitsBelow = belowTop + height <= viewportHeight - TEMPLATE_PICKER_VIEWPORT_PADDING
  const top = fitsBelow
    ? belowTop
    : clamp(aboveTop, TEMPLATE_PICKER_VIEWPORT_PADDING, viewportHeight - height - TEMPLATE_PICKER_VIEWPORT_PADDING)

  return { top, left, width, height }
}

// 类别色彩使用设计系统 token，响应主题切换
const MODE_META: Record<OutputMode, { label: string; tone: string }> = {
  article: { label: "阅读", tone: "border-muted bg-muted text-muted-foreground" },
  social: { label: "社媒", tone: "border-primary/20 bg-primary/10 text-primary" },
  deck: { label: "演示", tone: "border-accent bg-accent text-accent-foreground" },
  infographic: { label: "图解", tone: "border-secondary bg-secondary text-secondary-foreground" },
  wechat: { label: "一键排版", tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700" },
  creative: { label: "AI", tone: "border-foreground/15 bg-foreground/5 text-foreground" },
}

const WECHAT_TEMPLATE_ICON_TONES: Record<string, string> = {
  "wechat-default": "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "latepost-depth": "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  "wechat-anthropic": "border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "wechat-tech": "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "wechat-elegant": "border-stone-500/20 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  "wechat-deepread": "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  "wechat-ft": "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  "wechat-nyt": "border-neutral-500/20 bg-neutral-500/10 text-neutral-800 dark:text-neutral-200",
  "wechat-jonyive": "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  "wechat-medium": "border-lime-500/20 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  "wechat-apple": "border-gray-500/20 bg-gray-500/10 text-gray-800 dark:text-gray-200",
  guardian: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  nikkei: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "warm-docs": "border-yellow-500/20 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
  lemonde: "border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
}

const SOCIAL_TEMPLATE_ICON_TONES: Record<string, string> = {
  "social-redbook-sketch": "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  "social-redbook-playful": "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  "social-redbook-brutal": "border-yellow-500/40 bg-yellow-500/15 text-yellow-800 dark:text-yellow-300",
  "social-redbook-botanical": "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "social-redbook-professional": "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "social-redbook-retro": "border-orange-500/20 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  "social-redbook-terminal": "border-lime-500/20 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  "social-redbook-clean": "border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "social-editorial": "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  "social-geek-report": "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "social-consulting-report": "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "social-clean-review": "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  "social-terminal": "border-stone-500/20 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  "social-story-field": "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "social-dot-matrix": "border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300",
}

function getTemplateIconTone(template: OutputTemplate) {
  if (template.mode === "wechat") {
    return WECHAT_TEMPLATE_ICON_TONES[template.id] ?? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
  }
  if (template.mode === "social") {
    return SOCIAL_TEMPLATE_ICON_TONES[template.id] ?? "border-primary/20 bg-primary/10 text-primary"
  }
  return "border-transparent bg-muted/40 text-muted-foreground"
}

function getTemplateTags(template: OutputTemplate): string[] {
  const tags = template.features?.length ? [...template.features] : [MODE_META[template.mode]?.label]
  if (template.exportBlueprint?.defaultRatio) tags.push(template.exportBlueprint.defaultRatio)
  else if (template.mode !== "wechat" && template.sizePresets?.length) tags.push(template.sizePresets[0])
  else if (template.id.includes("deck") || template.mode === "deck") tags.push("PPT")
  else if (template.id.includes("social") || template.id.includes("poster")) tags.push("长图")
  else if (template.outputTargets?.length) tags.push(template.outputTargets[0])
  return Array.from(new Set(tags.filter(Boolean))).slice(0, template.mode === "wechat" ? 1 : 2)
}

// TemplatePicker 现通过 useWorkshopContext() 获取所有依赖，不再接受 props

export function TemplatePicker() {
  const ctx = useWorkshopContext()
  const { selectedTemplate, onOpenMarket } = ctx
  const {
    showTemplatePicker,
    setShowTemplatePicker,
    selectedCategory,
    setSelectedCategory,
    templateSearchQuery,
    setTemplateSearchQuery,
    filteredTemplates,
    groupedFilteredTemplates,
    templateCategories,
    templateCategoryTotal,
    loadingTemplates,
    hoveredTemplateId,
    setHoveredTemplateId,
    templatePreviewPosition,
    templatePreviewHtml,
    hoveredTemplate,
    handleSelectTemplate: onSelectTemplate,
    handleTemplateHover: onTemplateHover,
    templatePickerRef: pickerRef,
    templatePickerPopupRef: pickerPopupRef,
  } = ctx.templates
  const [pickerPosition, setPickerPosition] = React.useState<TemplatePickerPosition | null>(null)

  const updatePickerPosition = React.useCallback(() => {
    if (typeof window === "undefined" || !pickerRef.current) return
    setPickerPosition(resolveTemplatePickerPosition(pickerRef.current.getBoundingClientRect()))
  }, [pickerRef])

  React.useEffect(() => {
    if (!showTemplatePicker) {
      setPickerPosition(null)
      return
    }

    updatePickerPosition()
    window.addEventListener("resize", updatePickerPosition)

    return () => {
      window.removeEventListener("resize", updatePickerPosition)
    }
  }, [showTemplatePicker, updatePickerPosition])

  const templatePickerPanel = showTemplatePicker && pickerPosition && typeof document !== "undefined"
    ? createPortal(
      <>
        <div
          ref={pickerPopupRef}
          className="fixed z-[10030] flex h-[420px] max-h-[calc(100vh-24px)] w-[460px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-none"
          style={{
            top: pickerPosition.top,
            left: pickerPosition.left,
            width: pickerPosition.width,
            height: pickerPosition.height,
          }}
          onMouseLeave={() => {
            setHoveredTemplateId(null)
          }}
        >
          <div className="flex h-full min-w-0 flex-1 flex-col">
            <div className="h-[92px] shrink-0 border-b bg-background px-2.5 pb-2 pt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-foreground">
                    模板库
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {filteredTemplates.length}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={onOpenMarket}
                >
                  <Plus className="size-2.5" />
                  新建
                </Button>
              </div>

              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={templateSearchQuery}
                  onChange={(e) => setTemplateSearchQuery(e.target.value)}
                  placeholder="搜索模板..."
                  className="h-7 rounded-md px-3 pl-8 text-xs shadow-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="w-[124px] shrink-0 overflow-y-auto border-r bg-muted/20 p-1.5 [scrollbar-width:thin]">
                <div className="grid gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("all")}
                    className={cn(
                      "flex h-8 w-full items-center justify-between gap-1.5 rounded-md px-2 text-left text-xs transition-colors duration-150",
                      selectedCategory === "all"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                    )}
                  >
                    <span className="min-w-0 truncate">全部模板</span>
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                      selectedCategory === "all" ? "bg-primary-foreground/20" : "bg-background text-muted-foreground"
                    )}>
                      {templateCategoryTotal}
                    </span>
                  </button>
                  {templateCategories.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSelectedCategory(mode.id)}
                      className={cn(
                        "flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors duration-150",
                        selectedCategory === mode.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-background hover:text-foreground"
                      )}
                      title={mode.description}
                    >
                      <span className="shrink-0 text-sm leading-none">{mode.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{mode.name}</span>
                      <span className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        selectedCategory === mode.id ? "bg-primary-foreground/20" : "bg-background text-muted-foreground"
                      )}>
                        {mode.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
                {loadingTemplates ? (
                  <div className="flex h-52 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-5 animate-spin text-primary" />
                    加载模板中...
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 p-6 text-center">
                    <Search className="size-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs font-medium text-foreground">没有匹配的模板</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">换个关键词再试</div>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTemplateSearchQuery("")}>清除搜索</Button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    {groupedFilteredTemplates.map((group) => (
                      <section key={group.id} className="grid gap-1.5">
                        {selectedCategory === "all" && (
                          <div className="flex items-center justify-between px-1 pb-0.5 pt-1">
                            <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                              <span className="shrink-0">{group.icon}</span>
                              <span className="truncate">{group.name}</span>
                            </div>
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                              {group.templates.length}
                            </span>
                          </div>
                        )}
                        {group.templates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => onSelectTemplate(template.id)}
                            onMouseEnter={(e) => onTemplateHover(e, template.id)}
                            className={cn(
                              "group relative flex h-16 w-full items-start gap-2 overflow-hidden rounded-md border px-2.5 py-2 text-left text-xs transition-colors duration-150",
                              selectedTemplate.id === template.id
                                ? "border-primary/35 bg-primary/10 text-primary"
                                : hoveredTemplateId === template.id
                                  ? "border-primary/20 bg-muted/70"
                                  : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/60"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border text-[10px] font-semibold leading-none",
                                getTemplateIconTone(template)
                              )}
                            >
                              {template.icon}
                            </span>
                            <span className="min-w-0 flex-1 overflow-hidden">
                              <span className="flex min-w-0 items-center gap-1">
                                <span
                                  className={cn(
                                    "block truncate text-xs font-medium",
                                    selectedTemplate.id === template.id
                                      ? "text-foreground"
                                      : "text-foreground/85 group-hover:text-foreground"
                                  )}
                                >
                                  {template.name}
                                </span>
                                {template.recommended && <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-400" />}
                              </span>
                              <span className="mt-0.5 block max-w-full truncate text-[11px] leading-4 text-muted-foreground">
                                {template.bestFor || template.description}
                              </span>
                              <span className="mt-1 flex h-4 min-w-0 items-center gap-1 overflow-hidden">
                                {getTemplateTags(template).map((tag) => (
                                  <span
                                    key={tag}
                                    className={cn(
                                      "inline-flex h-4 max-w-full shrink items-center truncate rounded bg-muted/40 px-1.5 text-[10px] leading-none text-muted-foreground",
                                      tag === MODE_META[template.mode]?.label ? MODE_META[template.mode].tone : "bg-muted/40 text-muted-foreground"
                                    )}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {hoveredTemplate && templatePreviewPosition && (
          <div
            className="pointer-events-none fixed z-[10031] w-56 overflow-hidden rounded-lg border bg-background p-2 shadow-none"
            style={{ top: templatePreviewPosition.top, left: templatePreviewPosition.left }}
          >
            <div className="h-[126px] overflow-hidden rounded-md bg-background">
              <iframe
                key={hoveredTemplate.id}
                title="模板 hover 首屏预览"
                srcDoc={templatePreviewHtml}
                className="h-[504px] w-[896px] origin-top-left scale-[0.25] border-0 bg-background"
                sandbox="allow-same-origin"
                loading="lazy"
              />
            </div>
          </div>
        )}
      </>,
      document.body
    )
    : null

  return (
    <div className="relative min-w-0 shrink-0" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setShowTemplatePicker(!showTemplatePicker)}
        className="flex h-8 max-w-[160px] items-center gap-2 rounded-md px-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="切换输出模板"
      >
        <span className="text-sm leading-none">{selectedTemplate.icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{selectedTemplate.name}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>

      {templatePickerPanel}
    </div>
  )
}
