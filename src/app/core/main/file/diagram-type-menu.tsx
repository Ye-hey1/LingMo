"use client"

import { Brain, PenLine, Workflow } from "lucide-react"
import type { ReactNode } from "react"

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/enhanced-context-menu"
import type { DiagramKind } from "@/lib/diagram"

export const DIAGRAM_TYPE_OPTIONS: Array<{
  kind: DiagramKind
  title: string
  meta: string
  description: string
  icon: ReactNode
}> = [
  {
    kind: "drawio",
    title: "专业图表",
    meta: "Draw.io",
    description: "空白画布",
    icon: <Workflow className="h-4 w-4" />,
  },
  {
    kind: "mindmap",
    title: "思维导图",
    meta: "Draw.io",
    description: "脑图模板",
    icon: <Brain className="h-4 w-4" />,
  },
  {
    kind: "excalidraw",
    title: "手绘白板",
    meta: "Excalidraw",
    description: "手绘风格",
    icon: <PenLine className="h-4 w-4" />,
  },
]

interface DiagramTypeMenuProps {
  onSelect: (kind: DiagramKind) => void
  context?: "dropdown" | "context"
}

function DiagramTypeItemLabel({ option }: { option: (typeof DIAGRAM_TYPE_OPTIONS)[number] }) {
  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        {option.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{option.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{option.description}</span>
      </span>
    </>
  )
}

export function DiagramTypeDropdownContent({ onSelect }: DiagramTypeMenuProps) {
  return (
    <DropdownMenuContent align="start" className="w-[196px] p-1">
      {DIAGRAM_TYPE_OPTIONS.map((option) => (
        <DropdownMenuItem
          key={option.kind}
          className="gap-2 rounded-md px-2 py-2"
          onSelect={() => onSelect(option.kind)}
        >
          <DiagramTypeItemLabel option={option} />
          <DropdownMenuShortcut className="ml-2 text-[10px] tracking-normal text-muted-foreground">
            {option.meta}
          </DropdownMenuShortcut>
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
          className="gap-2 rounded-md px-2 py-2"
          onClick={() => onSelect(option.kind)}
        >
          <DiagramTypeItemLabel option={option} />
          <ContextMenuShortcut menuType="file" className="ml-2 text-[10px] tracking-normal text-muted-foreground">
            {option.meta}
          </ContextMenuShortcut>
        </ContextMenuItem>
      ))}
    </>
  )
}
