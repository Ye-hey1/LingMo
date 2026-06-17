"use client"

import * as React from "react"
import {
  ChevronDown,
  Loader2,
  Plus,
  Search,
  Star,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { OutputTemplate, OutputMode } from "@/lib/output-workshop/templates"
import { useWorkshopContext } from "./workshop-context"

// 类别色彩使用设计系统 token，响应主题切换
const MODE_META: Record<OutputMode, { label: string; tone: string }> = {
  creative: { label: "AI自由", tone: "border-foreground/15 bg-foreground/5 text-foreground" },
  moka: { label: "Moka", tone: "border-rose-500/20 bg-rose-500/10 text-rose-700" },
  wechat: { label: "公众号", tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700" },
  social: { label: "传播", tone: "border-primary/20 bg-primary/10 text-primary" },
  infographic: { label: "可视化", tone: "border-secondary bg-secondary text-secondary-foreground" },
  deck: { label: "演示", tone: "border-accent bg-accent text-accent-foreground" },
  article: { label: "阅读", tone: "border-muted bg-muted text-muted-foreground" },
}

function getTemplateTags(template: OutputTemplate): string[] {
  const tags = [MODE_META[template.mode]?.label]
  if (template.exportBlueprint?.defaultRatio) tags.push(template.exportBlueprint.defaultRatio)
  else if (template.sizePresets?.length) tags.push(template.sizePresets[0])
  else if (template.id.includes("deck") || template.mode === "deck") tags.push("PPT")
  else if (template.id.includes("social") || template.id.includes("poster")) tags.push("长图")
  else if (template.outputTargets?.length) tags.push(template.outputTargets[0])
  return Array.from(new Set(tags.filter(Boolean))).slice(0, 2)
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
    templateCategories,
    loadingTemplates,
    hoveredTemplateId,
    setHoveredTemplateId,
    templatePreviewPosition,
    templatePreviewHtml,
    hoveredTemplate,
    handleSelectTemplate: onSelectTemplate,
    handleTemplateHover: onTemplateHover,
    templatePickerRef: pickerRef,
  } = ctx.templates
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

      {showTemplatePicker && (
        <>
          <div
            className="absolute left-0 top-full z-50 mt-2 flex h-[min(440px,calc(100vh-156px))] w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-none"
            onMouseLeave={() => {
              setHoveredTemplateId(null)
            }}
          >
            <div className="flex h-full min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b bg-background px-3 pb-2 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] font-semibold text-muted-foreground">
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
                    className="h-8 rounded-md px-3 pl-8 text-xs shadow-none"
                    autoFocus
                  />
                </div>

                <div
                  className="-mx-0.5 mt-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:thin]"
                  onWheel={(event) => {
                    const target = event.currentTarget
                    if (target.scrollWidth <= target.clientWidth) return
                    target.scrollLeft += event.deltaY + event.deltaX
                    event.preventDefault()
                  }}
                >
                  <div className="flex w-max gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedCategory("all")}
                      className={cn(
                        "h-7 shrink-0 rounded-md border px-2.5 text-[10px] font-medium transition-colors duration-150",
                        selectedCategory === "all"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      )}
                    >
                      全部
                    </button>
                    {templateCategories.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setSelectedCategory(mode.id)}
                        className={cn(
                          "h-7 shrink-0 rounded-md border px-2.5 text-[10px] font-medium transition-colors duration-150",
                          selectedCategory === mode.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {mode.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 模板列表 */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]">
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
                    {filteredTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelectTemplate(template.id)}
                        onMouseEnter={(e) => onTemplateHover(e, template.id)}
                        className={cn(
                          "group relative flex min-h-12 w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors duration-150",
                          selectedTemplate.id === template.id
                            ? "border-primary/35 bg-primary/10 text-primary"
                            : hoveredTemplateId === template.id
                              ? "border-primary/20 bg-muted/70"
                              : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/60"
                        )}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/40 text-sm leading-none">{template.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1">
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
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {getTemplateTags(template).map((tag) => (
                              <span
                                key={tag}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] leading-none",
                                  tag === MODE_META[template.mode]?.label ? MODE_META[template.mode].tone : "bg-muted/40 text-muted-foreground"
                                )}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>

          {hoveredTemplate && templatePreviewPosition && (
            <div
              className="pointer-events-none fixed z-50 w-56 overflow-hidden rounded-lg border bg-background p-2 shadow-none"
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
        </>
      )}
    </div>
  )
}
