'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
      className="fixed z-[1000] w-[156px] overflow-hidden rounded-lg border border-border/50 bg-popover/98 shadow-lg shadow-black/8 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-white/10 dark:shadow-black/30"
      style={{
        left: rect.left,
        bottom: `calc(100vh - ${rect.top}px + 4px)`,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="max-h-[280px] overflow-y-auto py-1 scrollbar-thin">
        {commands.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            无匹配命令
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
                  'flex w-full items-center gap-2 px-2.5 py-[6px] text-left transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
                )}
                onMouseEnter={() => onSelectionChange(index)}
                onClick={() => onSelect(cmd.id)}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground/70')} />
                <span className="truncate text-[12px]">{cmd.title}</span>
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
