'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

import { isDrawioPath } from '@/lib/diagram'

const DiagramCanvas = dynamic(
  () => import('./diagram-canvas').then((mod) => mod.DiagramCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载图表编辑器...
      </div>
    ),
  },
)

const DrawioCanvas = dynamic(
  () => import('./drawio-canvas').then((mod) => mod.DrawioCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载 draw.io 编辑器...
      </div>
    ),
  },
)

interface DiagramEditorProps {
  filePath: string
  isActive?: boolean
}

export function DiagramEditor({ filePath, isActive = true }: DiagramEditorProps) {
  if (isDrawioPath(filePath)) {
    return <DrawioCanvas filePath={filePath} />
  }

  return <DiagramCanvas filePath={filePath} isActive={isActive} />
}
