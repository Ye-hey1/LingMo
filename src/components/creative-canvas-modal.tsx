'use client'

import { useTranslations } from 'next-intl'
import { CreativeCanvasWorkspace } from '@/app/core/main/creative-canvas/creative-canvas-workspace'
import { Dialog, DialogContent } from '@/components/ui/dialog'

interface CreativeCanvasModalProps {
  open: boolean
  onClose: () => void
  initialPrompt?: string | null
  initialSourcePath?: string | null
  requestId?: number
}

export function CreativeCanvasModal({
  open,
  onClose,
  initialPrompt,
  initialSourcePath,
  requestId,
}: CreativeCanvasModalProps) {
  const t = useTranslations('creativeCanvas')

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        aria-label={t('title')}
        className="h-[calc(100vh-20px)] w-[calc(100vw-20px)] max-w-none gap-0 overflow-hidden rounded-md border-border/80 p-0 shadow-2xl"
      >
        <CreativeCanvasWorkspace
          initialPrompt={initialPrompt}
          initialSourcePath={initialSourcePath}
          requestId={requestId}
        />
      </DialogContent>
    </Dialog>
  )
}

export default CreativeCanvasModal
