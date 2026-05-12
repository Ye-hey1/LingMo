'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'
import { AI_DOC_COMMANDS, filterAiDocCommands, type AiDocCommandId } from '@/lib/ai-doc-commands'

export interface AiDocCommandPopoverProps {
  open: boolean
  query: string
  selectedIndex: number
  onSelectionChange: (index: number) => void
  onSelect: (commandId: AiDocCommandId) => void
  onCommandsChange?: (count: number) => void
  /** 锚点元素，popover 将定位在其上方 */
  anchorRef: React.RefObject<HTMLElement | null>
}

interface PopoverRect {
  left: number
  top: number
  width: number
}

export function AiDocCommandPopover({
  open,
  query,
  selectedIndex,
  onSelectionChange,
  onSelect,
  onCommandsChange,
  anchorRef,
}: AiDocCommandPopoverProps) {
  const commands = useMemo(() => filterAiDocCommands(query), [query])
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [rect, setRect] = useState<PopoverRect | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    onCommandsChange?.(commands.length)
  }, [commands.length, onCommandsChange])

  useEffect(() => {
    if (!open) return
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  useLayoutEffect(() => {
    if (!open) return
    const el = anchorRef.current
    if (!el) return

    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect({ left: r.left, top: r.top, width: r.width })
    }
    measure()

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, anchorRef])

  if (!open || !mounted || !rect) return null

  const node = (
    <div
      className="fixed z-[1000] w-[180px] overflow-hidden rounded-md border border-border/70 bg-popover/95 shadow-md backdrop-blur-sm"
      style={{
        left: rect.left,
        bottom: `calc(100vh - ${rect.top}px + 6px)`,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground/80">
        <Sparkles className="h-2.5 w-2.5" />
        <span>AI 命令</span>
        <span className="ml-auto opacity-70">↑↓ Enter Esc</span>
      </div>
      <div className="max-h-[220px] overflow-y-auto px-1 pb-1">
        {commands.length === 0 ? (
          <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
            未匹配到命令
          </div>
        ) : (
          commands.map((cmd, index) => {
            const Icon = cmd.icon
            const isSelected = index === selectedIndex
            return (
              <button
                key={cmd.id}
                type="button"
                title={cmd.description}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
                onMouseEnter={() => onSelectionChange(index)}
                onClick={() => onSelect(cmd.id)}
              >
                <Icon className={cn('h-3 w-3 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                <span className="truncate text-xs font-medium">{cmd.title}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

export { AI_DOC_COMMANDS }
