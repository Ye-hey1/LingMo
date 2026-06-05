'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import emitter from '@/lib/emitter'

import { EnhancedClipboard } from './enhanced-clipboard'

export function ControlRecognition() {
  const t = useTranslations('record.mark')
  const [open, setOpen] = useState(false)

  const openRecognition = useCallback(() => {
    setOpen(true)
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-recognition', openRecognition)
    return () => {
      emitter.off('toolbar-shortcut-recognition', openRecognition)
    }
  }, [openRecognition])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('toolbar.recognition')}
              >
                <ClipboardList />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('toolbar.recognition')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        side="bottom"
        className="max-h-[calc(100vh-56px)] w-[min(520px,calc(100vw-24px))] overflow-y-auto p-3"
      >
        <EnhancedClipboard />
      </PopoverContent>
    </Popover>
  )
}
