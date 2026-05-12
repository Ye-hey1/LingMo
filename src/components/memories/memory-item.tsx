'use client'

import { useTranslations } from 'next-intl'
import type { Memory } from '@/db/memories'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Pencil, Trash2 } from 'lucide-react'

interface MemoryItemProps {
  memory: Memory
  onEdit: () => void
  onDelete: () => void
}

export function MemoryItem({ memory, onEdit, onDelete }: MemoryItemProps) {
  const t = useTranslations('settings.memories')

  const categoryLabel = memory.category === 'preference' ? t('preference') : t('memory')

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50">
      <Badge className="shrink-0 mt-0.5">
        {categoryLabel}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm leading-relaxed">{memory.content}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('accessCount', { count: memory.accessCount || 0 })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('editMemory')}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          aria-label={t('deleteMemory')}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
