'use client'

import { Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, ListCollapse } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { setHeadingLevelCollapsed } from '../heading-collapse-extension'

interface HeadingCollapseMenuProps {
  editor: Editor
}

const HEADING_LEVELS = [1, 2, 3] as const

function HeadingLevelRow({
  editor,
  level,
}: {
  editor: Editor
  level: (typeof HEADING_LEVELS)[number]
}) {
  return (
    <div className="grid grid-cols-[30px_1fr] items-center gap-1 rounded-md bg-muted/35 px-1.5 py-1">
      <span className="inline-flex h-5 items-center justify-center rounded bg-background px-1 text-[10px] font-semibold text-foreground shadow-sm">
        H{level}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 rounded-sm"
          title={`H${level} 全部折叠`}
          aria-label={`H${level} 全部折叠`}
          onClick={() => setHeadingLevelCollapsed(editor, level, true)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 rounded-sm"
          title={`H${level} 全部展开`}
          aria-label={`H${level} 全部展开`}
          onClick={() => setHeadingLevelCollapsed(editor, level, false)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function HeadingCollapseMenu({ editor }: HeadingCollapseMenuProps) {
  if (!editor) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="标题折叠"
          className="rounded-md p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-0"
        >
          <ListCollapse className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={6} className="w-[118px] rounded-xl border-border/70 p-1.5 shadow-lg">
        <div className="space-y-1">
          {HEADING_LEVELS.map((level) => (
            <HeadingLevelRow key={level} editor={editor} level={level} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default HeadingCollapseMenu
