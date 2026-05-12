'use client'

import { Network } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from 'next-intl'

export function GraphButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations()

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpen}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
          >
            <Network className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t('knowledgeGraph.title')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
