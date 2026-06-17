'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  filterSlashCommands,
  type SlashCommandItem,
} from '@/lib/ai-doc-commands/slash-bridge'

export interface AiDocCommandPopoverProps {
  open: boolean
  query: string
  selectedIndex: number
  onSelectionChange: (index: number) => void
  onSelect: (itemId: string) => void
  onCommandsChange?: (count: number) => void
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
  const [commands, setCommands] = useState<SlashCommandItem[]>([])
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [rect, setRect] = useState<PopoverRect | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // 异步加载命令列表（包含 Skills）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void filterSlashCommands(query)
      .then((result) => {
        if (!cancelled) setCommands(result)
      })
      .catch((error) => {
        console.warn('[SlashPopover] Failed to load slash commands:', error)
        if (!cancelled) setCommands([])
      })
    return () => { cancelled = true }
  }, [open, query])

  useEffect(() => { onCommandsChange?.(commands.length) }, [commands.length, onCommandsChange])

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

  return createPortal(
    <div
      className="fixed z-[1000] overflow-hidden rounded-lg border border-border/55 bg-popover/98 shadow-xl shadow-black/10 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-white/10 dark:shadow-black/35"
      style={{
        left: rect.left,
        bottom: `calc(100vh - ${rect.top}px + 4px)`,
        width: query ? '236px' : '220px',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="max-h-[360px] overflow-y-auto p-1.5 scrollbar-thin">
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
                title={cmd.runtimeProfile ? `route: ${cmd.runtimeProfile}` : undefined}
                ref={(el) => { itemRefs.current[index] = el }}
                className={cn(
                  'group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-foreground/90 outline-none transition-colors',
                  isSelected ? 'bg-muted text-foreground ring-1 ring-inset ring-border/70' : 'hover:bg-muted/45',
                )}
                onMouseEnter={() => onSelectionChange(index)}
                onClick={() => onSelect(cmd.id)}
              >
                <span className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground transition-colors',
                  isSelected && 'bg-background/80 text-primary shadow-sm',
                  cmd.source === 'skill' && 'bg-violet-500/10 text-violet-500',
                )}>
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-none">
                  {cmd.title}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>,
    document.body,
  )
}
