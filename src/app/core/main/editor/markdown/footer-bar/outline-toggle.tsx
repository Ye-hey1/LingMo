'use client'

import { Editor } from '@tiptap/react'
import { List, ListCollapse } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface OutlineToggleProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function OutlineToggle({
  editor,
  outlineOpen,
  onToggleOutline,
}: OutlineToggleProps) {
  const t = useTranslations('editor')

  if (!editor) return null

  return (
    <button
      type="button"
      onClick={onToggleOutline}
      className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={outlineOpen ? t('outline.close') : t('outline.open')}
      aria-label={outlineOpen ? t('outline.close') : t('outline.open')}
    >
      {outlineOpen ? (
        <ListCollapse className="size-3" />
      ) : (
        <List className="size-3" />
      )}
    </button>
  )
}

export default OutlineToggle
