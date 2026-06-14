"use client"

import * as React from "react"
import { Check, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ResearchDepthPreset = "auto" | "quick" | "deep"

export interface ResearchDepthConfig {
  preset: ResearchDepthPreset
  label: string
  breadth?: number
  depth?: number
}

export const RESEARCH_DEPTH_CONFIGS: Record<ResearchDepthPreset, ResearchDepthConfig> = {
  auto: {
    preset: "auto",
    label: "标准",
  },
  quick: {
    preset: "quick",
    label: "快速",
    breadth: 2,
    depth: 1,
  },
  deep: {
    preset: "deep",
    label: "深入",
    breadth: 6,
    depth: 4,
  },
}

const DEPTH_OPTIONS: ResearchDepthConfig[] = [
  RESEARCH_DEPTH_CONFIGS.quick,
  RESEARCH_DEPTH_CONFIGS.auto,
  RESEARCH_DEPTH_CONFIGS.deep,
]

function isResearchDepthPreset(value: unknown): value is ResearchDepthPreset {
  return value === "auto" || value === "quick" || value === "deep"
}

export function normalizeResearchDepthPreset(value: unknown): ResearchDepthPreset {
  return isResearchDepthPreset(value) ? value : "auto"
}

export function getResearchDepthConfig(value: unknown): ResearchDepthConfig {
  return RESEARCH_DEPTH_CONFIGS[normalizeResearchDepthPreset(value)]
}

interface ResearchDepthControlProps {
  value: ResearchDepthPreset
  onChange: (value: ResearchDepthPreset) => void
  disabled?: boolean
}

export function ResearchDepthControl({
  value,
  onChange,
  disabled = false,
}: ResearchDepthControlProps) {
  const [open, setOpen] = React.useState(false)
  const current = getResearchDepthConfig(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-7 w-7 shrink-0 rounded-md text-emerald-700 hover:bg-background/70 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
          aria-label={`研究深度：${current.label}`}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-32 p-1">
        <div className="grid gap-1">
          {DEPTH_OPTIONS.map((option) => {
            const active = option.preset === current.preset
            return (
              <button
                key={option.preset}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  active ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "hover:bg-muted"
                )}
                onClick={() => {
                  onChange(option.preset)
                  setOpen(false)
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{option.label}</div>
                </div>
                <Check className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-0")} />
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
