"use client"

import { useTranslations } from "next-intl"
import { Filter, RotateCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import useMarkStore, { type RecordProcessState, type RecordTimePreset } from "@/stores/mark"
import { cn } from "@/lib/utils"
import { getMarkTypeChipClasses, MARK_TYPE_OPTIONS } from "./mark-type-meta"
import { useState } from "react"

const TIME_OPTIONS: RecordTimePreset[] = ['all', 'today', 'last7Days', 'last30Days']
const PROCESS_OPTIONS: Array<{ value: RecordProcessState; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unprocessed', label: '待处理' },
  { value: 'processed', label: '已处理' },
]

export function MarkFilterPopover() {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslations('record.mark')
  const {
    trashState,
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    setRecordProcessState,
    resetRecordFilters,
    hasActiveRecordFilters,
  } = useMarkStore()

  const isActive = hasActiveRecordFilters()

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Search + Filter toggle + Reset */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={recordFilters.search}
            onChange={(e) => setRecordSearch(e.target.value)}
            placeholder="搜索记录..."
            className="h-7 rounded-md border-border/60 bg-muted/20 pl-8 pr-2 text-xs shadow-none focus-visible:ring-1"
          />
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md transition-colors",
                  isActive || expanded ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Filter className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">筛选</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isActive && (
          <button
            type="button"
            onClick={resetRecordFilters}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="清除筛选"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>

      {/* Row 2: Inline filter toggles (flat, not floating) */}
      {expanded && (
        <div className="flex flex-wrap items-center gap-1">
          {/* Process state */}
          {!trashState && PROCESS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRecordProcessState(option.value)}
              className={cn(
                "h-5 rounded-full border px-2 text-[10px] font-medium transition-colors",
                recordFilters.processState === option.value
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}

          {/* Time */}
          {TIME_OPTIONS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setRecordTimePreset(preset)}
              className={cn(
                "h-5 rounded-full border px-2 text-[10px] font-medium transition-colors",
                recordFilters.timePreset === preset
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`toolbar.filter.timeOptions.${preset}`)}
            </button>
          ))}

          {/* Type pills */}
          {MARK_TYPE_OPTIONS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleRecordType(type)}
              className={cn(
                "h-5 rounded-full border px-2 text-[10px] font-medium transition-colors",
                recordFilters.selectedTypes.includes(type)
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`type.${type}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
