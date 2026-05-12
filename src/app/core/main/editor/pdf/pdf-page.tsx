'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

const PdfCanvasClient = dynamic(
  () => import('./pdf-canvas-client').then((mod) => mod.PdfCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载 PDF...
      </div>
    ),
  },
)

export const PdfCanvas = PdfCanvasClient
