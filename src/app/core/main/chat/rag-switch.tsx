"use client"

import * as React from 'react'
import { useState } from 'react'
import { Database, DatabaseZap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { TooltipButton } from '@/components/tooltip-button'
import useVectorStore from '@/stores/vector'
import { checkEmbeddingModelAvailable } from '@/lib/rag'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface RagSwitchProps {
  variant?: 'icon' | 'menu-item'
  trigger?: React.ReactNode
}

export function RagSwitch({ variant = 'icon', trigger }: RagSwitchProps) {
  const { isRagEnabled, setRagEnabled } = useVectorStore()
  const t = useTranslations('record.chat.input')
  const [loading, setLoading] = useState(false)

  const handleToggle = async () => {
    if (isRagEnabled) {
      await setRagEnabled(false)
    } else {
      setLoading(true)
      const embeddingModelAvailable = await checkEmbeddingModelAvailable()
      setLoading(false)
      if (!embeddingModelAvailable) {
        toast({
          variant: "destructive",
          description: t('rag.notSupported')
        })
        return
      }
      await setRagEnabled(true)
    }
  }

  if (variant === 'menu-item') {
    return (
      <button
        type="button"
        className="w-full"
        onClick={handleToggle}
        disabled={loading}
      >
        <span className={cn("block", isRagEnabled && "text-primary")}>
          {trigger || (
            <span className="flex items-center gap-2 px-2.5 py-2 text-sm">
              {isRagEnabled ? <DatabaseZap className="size-4" /> : <Database className="size-4" />}
              <span>{isRagEnabled ? t('rag.enabled') : t('rag.disabled')}</span>
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div>
      <TooltipButton
        icon={isRagEnabled ? <DatabaseZap className="size-4" /> : <Database className="size-4" />}
        tooltipText={isRagEnabled ? t('rag.enabled') : t('rag.disabled')}
        size="icon"
        side="bottom"
        onClick={handleToggle}
        disabled={loading}
        variant="ghost"
      />
    </div>
  )
}
