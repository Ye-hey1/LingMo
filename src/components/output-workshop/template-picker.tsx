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

// 类别色彩使用设计系统 token，响应主题切换
const MODE_META: Record<OutputMode, { label: string; tone: string }> = {
  creative: { label: "AI自由", tone: "border-foreground/15 bg-foreground/5 text-foreground" },
  social: { label: "传播", tone: "border-primary/20 bg-primary/10 text-primary" },
  infographic: { label: "可视化", tone: "border-secondary bg-secondary text-secondary-foreground" },
  deck: { label: "演示", tone: "border-accent bg-accent text-accent-foreground" },
  article: { label: "阅读", tone: "border-muted bg-muted text-muted-foreground" },
}

function getTemplateTags(template: OutputTemplate): string[] {
  const tags = [MODE_META[template.mode]?.label, ...(template.features || []), ...(template.sizePresets || [])]
  if (template.outputTargets?.length) tags.push(...template.outputTargets)
  if (template.exportBlueprint?.defaultRatio) tags.push(template.exportBlueprint.defaultRatio)
  if (template.mode === "creative" || template.skillPrompt) tags.push("AI直绘")
  if (template.id.includes("deck") || template.mode === "deck") tags.push("PPTX")
  if (template.id.includes("social") || template.id.includes("poster")) tags.push("长图")
  if (/mobile|小红书|社交|卡片|竖版/i.test(`${template.name} ${template.description} ${template.bestFor}`)) tags.push("移动端")
  return Array.from(new Set(tags.filter(Boolean))).slice(0, 2)
}

interface TemplatePickerProps {
  selectedTemplate: OutputTemplate
  selectedTemplateId: string
  showTemplatePicker: boolean
  setShowTemplatePicker: (show: boolean) => void
  selectedCategory: string
  setSelectedCategory: (category: string) => void
  templateSearchQuery: string
  setTemplateSearchQuery: (query: string) => void
  filteredTemplates: OutputTemplate[]
  templateCategories: Array<{ id: OutputMode; name: string; icon: string; description: string }>
  loadingTemplates: boolean
  hoveredTemplateId: string | null
  setHoveredTemplateId: (id: string | null) => void
  templatePreviewPosition: { top: number; left: number } | null
  setTemplatePreviewPosition: (pos: { top: number; left: number } | null) => void
  templatePreviewHtml: string
  hoveredTemplate: OutputTemplate | null
  onSelectTemplate: (id: string) => void
  onTemplateHover: (e: React.MouseEvent<HTMLButtonElement>, id: string) => void
  onOpenMarket: () => void
  pickerRef: React.RefObject<HTMLDivElement>
}

export function TemplatePicker({
  selectedTemplate,
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
  onSelectTemplate,
  onTemplateHover,
  onOpenMarket,
  pickerRef,
}: TemplatePickerProps) {
  return (
    <div className="relative min-w-0 shrink-0" ref={pickerRef}>
      {/* Phase 1: 触发按钮 — text-xs + 统一间距 */}
      <button
        type="button"
        onClick={() => setShowTemplatePicker(!showTemplatePicker)}
        className="flex h-7 max-w-[160px] items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="切换输出模板"
      >
        <span className="text-sm leading-none">{selectedTemplate.icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{selectedTemplate.name}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>

      {showTemplatePicker && (
        <>
          {/* Phase 2: 面板圆角 rounded-2xl → rounded-lg */}
          <div
            className="absolute left-0 top-full z-50 mt-2 flex h-[min(520px,calc(100vh-156px))] w-[420px] max-w-[calc(100vw-56px)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl"
            onMouseLeave={() => {
              setHoveredTemplateId(null)
            }}
          >
            <div className="flex h-full min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b bg-background px-2.5 pb-2 pt-2">
                {/* Phase 3: 头部排版修复 — text-[9px] → text-[10px] */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      模板库
                    </div>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {filteredTemplates.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px] text-primary"
                    onClick={onOpenMarket}
                  >
                    <Plus className="size-2.5" />
                    安装/自建
                  </Button>
                </div>

                {/* Phase 4: 搜索栏优化 — h-7 + rounded-md + text-xs */}
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={templateSearchQuery}
                    onChange={(e) => setTemplateSearchQuery(e.target.value)}
                    placeholder="搜索模板、场景、用途..."
                    className="h-7 rounded-md px-2.5 pl-7 text-xs shadow-none"
                    autoFocus
                  />
                </div>

                {/* Phase 5: 类别筛选器 — text-[10px] + rounded-md + font-medium */}
                <div className="mt-2 -mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]">
                  <div className="flex w-max gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCategory("all")}
                      className={cn(
                        "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
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
                          "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
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
                  /* Phase 10: 空状态排版修复 */
                  <div className="flex h-60 flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Search className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-foreground">没有匹配的模板</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">试试更短关键词，或安装/自建一个模板包。</div>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTemplateSearchQuery("")}>清除搜索</Button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    {filteredTemplates.map((template) => (
                      /* Phase 6: 卡片排版 — rounded-lg + text-sm + 统一间距 */
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelectTemplate(template.id)}
                        onMouseEnter={(e) => onTemplateHover(e, template.id)}
                        className={cn(
                          "group relative flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all",
                          selectedTemplate.id === template.id
                            ? "border-primary/35 bg-primary/10 text-primary shadow-sm"
                            : hoveredTemplateId === template.id
                              ? "border-primary/20 bg-muted/70"
                              : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/60"
                        )}
                      >
                        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted/40 text-base leading-none">{template.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={cn(
                                "block truncate text-sm font-semibold",
                                selectedTemplate.id === template.id
                                  ? "text-foreground"
                                  : "text-foreground/85 group-hover:text-foreground"
                              )}
                            >
                              {template.name}
                            </span>
                            {template.recommended && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                            {template.description}
                          </p>
                          {/* Phase 7: 标签精简至2个 + text-[10px] + rounded-md */}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {getTemplateTags(template).map((tag) => (
                              <span
                                key={tag}
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
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

          {/* Phase 9: hover 预览面板圆角统一 */}
          {hoveredTemplate && templatePreviewPosition && (
            <div
              className="pointer-events-none fixed z-[60] w-64 overflow-hidden rounded-lg border bg-background/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur"
              style={{ top: templatePreviewPosition.top, left: templatePreviewPosition.left }}
            >
              <div className="h-[144px] overflow-hidden rounded-md bg-background">
                <iframe
                  key={hoveredTemplate.id}
                  title="模板 hover 首屏预览"
                  srcDoc={templatePreviewHtml}
                  className="h-[576px] w-[1024px] origin-top-left scale-[0.25] border-0 bg-background"
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
