'use client'

import { useEffect, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import useArticleStore from '@/stores/article'
import { formatFileActivityTime, getFileSystemMetadata } from '@/lib/file-activity'

function formatCompactCreatedAt(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/)
  if (!match) return value
  return `${match[2]}-${match[3]} ${match[4]}`
}

export function FileCreatedAt() {
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const [createdAt, setCreatedAt] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!activeFilePath || activeFilePath.includes('://')) {
        setCreatedAt('')
        return
      }

      const metadata = await getFileSystemMetadata(activeFilePath)
      if (!cancelled) {
        setCreatedAt(formatFileActivityTime(metadata?.createdAt))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeFilePath])

  if (!createdAt) return null

  return (
    <span
      className="hidden h-5 items-center gap-1 rounded px-1.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
      title={`创建时间：${createdAt}`}
    >
      <CalendarPlus className="size-3" />
      <span>{formatCompactCreatedAt(createdAt)}</span>
    </span>
  )
}

export default FileCreatedAt
