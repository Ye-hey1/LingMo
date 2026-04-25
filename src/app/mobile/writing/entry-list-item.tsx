'use client'

import { ReactNode, useRef, useState } from 'react'
import { Cloud, FileText, Folder } from 'lucide-react'
import { BrowserEntry } from './types'
import { Button } from '@/components/ui/button'

type EntryAction = {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void | Promise<void>
  disabled?: boolean
  variant?: 'default' | 'outline' | 'destructive'
}

interface EntryListItemProps {
  entry: BrowserEntry
  isActive: boolean
  onOpen: (entry: BrowserEntry) => void
  actions: EntryAction[]
  remoteLabel: string
  subtitle?: string
}

export function EntryListItem({
  entry,
  isActive,
  onOpen,
  actions,
  remoteLabel,
  subtitle,
}: EntryListItemProps) {
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const isSwipingRef = useRef(false)
  const [translateX, setTranslateX] = useState(0)
  const [opened, setOpened] = useState(false)

  const actionWidth = actions.length * 60

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (actions.length === 0) return
    const touch = e.touches[0]
    touchStartXRef.current = touch.clientX
    touchStartYRef.current = touch.clientY
    isSwipingRef.current = false
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (actions.length === 0) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStartXRef.current
    const deltaY = touch.clientY - touchStartYRef.current

    if (!isSwipingRef.current) {
      if (Math.abs(deltaX) < 8) return
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return
      isSwipingRef.current = true
    }

    e.preventDefault()
    const maxLeft = -actionWidth
    const base = opened ? maxLeft : 0
    const next = Math.max(maxLeft, Math.min(0, base + deltaX))
    setTranslateX(next)
  }

  function handleTouchEnd() {
    if (actions.length === 0) return
    const maxLeft = -actionWidth
    const shouldOpen = translateX < maxLeft / 2
    setOpened(shouldOpen)
    setTranslateX(shouldOpen ? maxLeft : 0)
    isSwipingRef.current = false
  }

  return (
    <div className="relative overflow-hidden rounded-md bg-background">
      {actions.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-2 px-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant={action.variant || 'outline'}
              disabled={action.disabled}
              size="icon"
              className="size-11 rounded-xl shadow-sm"
              onClick={async () => {
                setOpened(false)
                setTranslateX(0)
                await action.onClick()
              }}
              aria-label={action.label}
              title={action.label}
            >
              {action.icon}
              <span className="sr-only">{action.label}</span>
            </Button>
          ))}
        </div>
      )}
      <div
        className={`w-full text-left rounded-md border px-3 py-2 active:bg-accent transition-transform duration-200 ease-out ${
          isActive ? 'border-primary bg-background shadow-sm' : 'bg-background'
        }`}
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          onClick={() => {
            if (opened) {
              setOpened(false)
              setTranslateX(0)
              return
            }
            onOpen(entry)
          }}
          className="w-full min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            {entry.type === 'folder' ? (
              <Folder className="size-4 text-muted-foreground shrink-0" />
            ) : (
              <FileText className="size-4 text-muted-foreground shrink-0" />
            )}
            <p className="text-sm font-medium truncate flex-1 min-w-0">{entry.name}</p>
            {!entry.isLocale && (
              <span
                className="inline-flex items-center shrink-0 text-sky-600 dark:text-sky-400"
                title={remoteLabel}
                aria-label={remoteLabel}
              >
                <Cloud className="size-4 stroke-[2.25]" />
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate mt-1">{subtitle}</p>
          )}
        </button>
      </div>
    </div>
  )
}
