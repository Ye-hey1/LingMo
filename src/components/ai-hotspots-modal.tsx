'use client'

import dynamic from 'next/dynamic'

const AiHotspotsWorkspace = dynamic(
  () => import('@/app/core/main/ai-hotspots/ai-hotspots-workspace').then(m => m.AiHotspotsWorkspace),
  { ssr: false },
)

interface AiHotspotsModalProps {
  open: boolean
  onClose: () => void
}

export function AiHotspotsModal({ open, onClose }: AiHotspotsModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-2 pb-2 pt-12 animate-in fade-in duration-200">
      <div className="relative flex h-[calc(100vh-3.5rem)] w-[99vw] max-w-none flex-col overflow-hidden rounded-lg border bg-background shadow-none">
        <AiHotspotsWorkspace onClose={onClose} />
      </div>
    </div>
  )
}
