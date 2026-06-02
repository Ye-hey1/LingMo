"use client"
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Clipboard, ClipboardX } from 'lucide-react'
import { TooltipButton } from '@/components/tooltip-button'
import { useState, useEffect } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { cn } from '@/lib/utils'

interface ClipboardMonitorProps {
  variant?: 'icon' | 'menu-item'
  trigger?: React.ReactNode
}

export function ClipboardMonitor({ variant = 'icon', trigger }: ClipboardMonitorProps) {
  const t = useTranslations('record.chat.input.clipboardMonitor')
  const [isEnabled, setIsEnabled] = useState(true)

  // Sync with store.json on mount
  useEffect(() => {
    const syncWithStore = async () => {
      try {
        const store = await Store.load('store.json')
        const storedValue = await store.get<boolean>('clipboardMonitor')

        // Only update if the stored value exists and is different from the current state
        if (storedValue !== undefined && storedValue !== isEnabled) {
          setIsEnabled(storedValue)
        }
      } catch (error) {
        console.error('Failed to load clipboard monitor state from store:', error)
      }
    }

    syncWithStore()
  }, [])

  const toggleClipboardMonitor = async () => {
    const newState = !isEnabled
    setIsEnabled(newState)
    const store = await Store.load('store.json')
    await store.set('clipboardMonitor', newState)
  }

  if (variant === 'menu-item') {
    return (
      <button
        type="button"
        className="w-full"
        onClick={toggleClipboardMonitor}
      >
        <span className={cn("block", isEnabled && "text-primary")}>
          {trigger || (
            <span className="flex items-center gap-2 px-2.5 py-2 text-sm">
              {isEnabled ? <Clipboard className="size-4" /> : <ClipboardX className="size-4" />}
              <span>{isEnabled ? t('enable') : t('disable')}</span>
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div>
      <TooltipButton
        variant={"ghost"}
        size="icon"
        icon={isEnabled ? <Clipboard className="size-4" /> : <ClipboardX className="size-4" />}
        tooltipText={isEnabled ? t('enable') : t('disable')}
        side="bottom"
        onClick={toggleClipboardMonitor}
      />
    </div>
  )
}
