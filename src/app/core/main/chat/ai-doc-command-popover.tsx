'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
    void filterSlashCommands(query).then((result) => {
      if (!cancelled) setCommands(result)
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

  // 展平渲染列表：内置命令平铺，Skills 前加分隔标题
  const renderItems = useMemo(() => {
    const builtins = commands.filter((c) => c.source === 'builtin')
    const skills = commands.filter((c) => c.source === 'skill')

    const items: Array<
      { type: 'header'; label: string; key: string }
      | { type: 'command'; cmd: SlashCommandItem; flatIndex: number; key: string }
    > = []

    let flatIndex = 0
    for (const cmd of builtins) {
      items.push({ type: 'command', cmd, flatIndex, key: cmd.id })
      flatIndex++
    }

    if (skills.length > 0) {
      items.push({ type: 'header', label: '⚡ Skills', key: 'h-skill' })
      for (const cmd of skills) {
        items.push({ type: 'command', cmd, flatIndex, key: cmd.id })
        flatIndex++
      }
    }

    return items
  }, [commands])

  if (!open || !mounted || !rect) return null

  return createPortal(
    <div
      className="fixed z-[1000] overflow-hidden rounded-lg border border-border/50 bg-popover/98 shadow-lg shadow-black/8 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-white/10 dark:shadow-black/30"
      style={{
        left: rect.left,
        bottom: `calc(100vh - ${rect.top}px + 4px)`,
        width: query ? '260px' : '210px',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="max-h-[360px] overflow-y-auto py-1 scrollbar-thin">
        {commands.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            无匹配命令
          </div>
        ) : (
          renderItems.map((item) => {
            if (item.type === 'header') {
              return (
                <div key={item.key} className="px-2.5 pt-2 pb-0.5 text-[10px] font-medium text-muted-foreground/50">
                  {item.label}
                </div>
              )
            }

            const { cmd, flatIndex } = item
            const Icon = cmd.icon
            const isSelected = flatIndex === selectedIndex

            return (
              <button
                key={item.key}
                type="button"
                title={cmd.description}
                ref={(el) => { itemRefs.current[flatIndex] = el }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-[5px] text-left transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
                )}
                onMouseEnter={() => onSelectionChange(flatIndex)}
                onClick={() => onSelect(cmd.id)}
              >
                <Icon className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  isSelected ? 'text-primary' : 'text-muted-foreground/60',
                  cmd.source === 'skill' && 'text-violet-500/70',
                )} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] leading-tight">{cmd.title}</span>
                    {cmd.source === 'skill' && (
                      <span className="shrink-0 rounded-[3px] bg-violet-500/10 px-1 py-px text-[9px] leading-none text-violet-500/80">
                        skill
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <span className="truncate text-[10px] text-muted-foreground/50 block leading-tight mt-0.5">
                      {cmd.description}
                    </span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>,
    document.body,
  )
}
