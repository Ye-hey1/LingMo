"use client"

import { PenLine, Workflow } from "lucide-react"
import type { ReactNode } from "react"

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { ContextMenuItem } from "@/components/ui/enhanced-context-menu"
import type { DiagramKind } from "@/lib/diagram"

export const DIAGRAM_TYPE_OPTIONS: Array<{
  kind: DiagramKind
  title: string
  icon: ReactNode
}> = [
  {
    kind: "drawio",
    title: "专业图表",
    icon: <Workflow className="h-4 w-4" />,
  },
  {
    kind: "excalidraw",
    title: "手绘白板",
    icon: <PenLine className="h-4 w-4" />,
  },
]

interface DiagramTypeMenuProps {
  onSelect: (kind: DiagramKind) => void
  context?: "dropdown" | "context"
}

export function DiagramTypeItemLabel({ option }: { option: (typeof DIAGRAM_TYPE_OPTIONS)[number] }) {
  return (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        {option.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{option.title}</span>
      </span>
    </>
  )
}

export function DiagramTypeDropdownContent({ onSelect }: DiagramTypeMenuProps) {
  return (
    <DropdownMenuContent align="start" className="w-[168px] p-1">
      {DIAGRAM_TYPE_OPTIONS.map((option) => (
        <DropdownMenuItem
          key={option.kind}
          className="gap-2 rounded-md px-2 py-1.5"
          onSelect={() => onSelect(option.kind)}
        >
          <DiagramTypeItemLabel option={option} />
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  )
}

export function DiagramTypeContextContent({ onSelect }: DiagramTypeMenuProps) {
  return (
    <>
      {DIAGRAM_TYPE_OPTIONS.map((option) => (
        <ContextMenuItem
          key={option.kind}
          menuType="file"
          className="gap-2 rounded-md px-2 py-1.5"
          onClick={() => onSelect(option.kind)}
        >
          <DiagramTypeItemLabel option={option} />
        </ContextMenuItem>
      ))}
    </>
  )
}
