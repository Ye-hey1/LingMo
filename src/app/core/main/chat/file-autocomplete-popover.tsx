'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FileAutocompleteItem {
  name: string
  path: string
  relativePath: string
}

export interface FileAutocompletePopoverProps {
  open: boolean
  query: string
  selectedIndex: number
  onSelectionChange: (index: number) => void
  onSelect: (item: FileAutocompleteItem) => void
  onItemsChange?: (count: number) => void
  files: FileAutocompleteItem[]
  /** 锚点元素，popover 将定位在其上方 */
  anchorRef: React.RefObject<HTMLElement | null>
}

interface PopoverRect {
  left: number
  top: number
  width: number
}

export function FileAutocompletePopover({
  open,
  query,
  selectedIndex,
  onSelectionChange,
  onSelect,
  onItemsChange,
  files,
  anchorRef,
}: FileAutocompletePopoverProps) {
  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) {
      return files.slice(0, 8)
    }
    return files
      .filter(
        (file) =>
          file.name.toLowerCase().includes(trimmed) ||
          file.relativePath.toLowerCase().includes(trimmed)
      )
      .slice(0, 8)
  }, [files, query])

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [rect, setRect] = useState<PopoverRect | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    onItemsChange?.(filteredItems.length)
  }, [filteredItems.length, onItemsChange])

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
      className="fixed z-[1000] w-[260px] overflow-hidden rounded-lg border border-border/50 bg-popover/98 shadow-lg shadow-black/8 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-white/10 dark:shadow-black/30"
      style={{
        left: rect.left,
        bottom: `calc(100vh - ${rect.top}px + 4px)`,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="px-2.5 py-1.5 border-b border-border/40 text-[10px] font-medium text-muted-foreground bg-muted/20">
        关联工作区文件
      </div>
      <div className="max-h-[220px] overflow-y-auto py-1 scrollbar-thin">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            无匹配文件
          </div>
        ) : (
          filteredItems.map((item, index) => {
            const isCode = /\.(js|ts|tsx|jsx|json|py|rs|go|sh|c|cpp|css)$/i.test(item.name)
            const isSelected = index === selectedIndex
            return (
              <button
                key={item.relativePath}
                type="button"
                title={item.relativePath}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-[6px] text-left transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
                )}
                onMouseEnter={() => onSelectionChange(index)}
                onClick={() => onSelect(item)}
              >
                {isCode ? (
                  <FileCode className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground/70')} />
                ) : (
                  <FileText className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground/70')} />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-[11px] font-medium leading-none mb-0.5">{item.name}</span>
                  <span className="truncate text-[9px] text-muted-foreground/80 leading-none">{item.relativePath}</span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
