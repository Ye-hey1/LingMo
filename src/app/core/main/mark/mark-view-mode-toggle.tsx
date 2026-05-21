'use client'

import { LayoutGrid, Rows3, StretchHorizontal } from "lucide-react"
import { useTranslations } from "next-intl"
import type { RecordViewMode } from "@/stores/mark"
import { BottomBarIconButton } from "@/components/bottom-bar-icon-button"

type MarkViewModeToggleProps = {
  value: RecordViewMode
  onChange: (mode: RecordViewMode) => void
}

const VIEW_MODE_ITEMS: Array<{
  mode: RecordViewMode
  icon: typeof Rows3
}> = [
  { mode: 'list', icon: Rows3 },
  { mode: 'compact', icon: StretchHorizontal },
  { mode: 'cards', icon: LayoutGrid },
]

export function MarkViewModeToggle({ value, onChange }: MarkViewModeToggleProps) {
  const t = useTranslations('record.mark.toolbar.view')
  const currentIndex = VIEW_MODE_ITEMS.findIndex((item) => item.mode === value)
  const currentItem = VIEW_MODE_ITEMS[currentIndex >= 0 ? currentIndex : 0]
  const CurrentIcon = currentItem.icon
  const nextMode = VIEW_MODE_ITEMS[((currentIndex >= 0 ? currentIndex : 0) + 1) % VIEW_MODE_ITEMS.length].mode

  return (
    <BottomBarIconButton
      icon={<CurrentIcon className="size-3" />}
      label={`${t(value)}，点击切换到${t(nextMode)}`}
      onClick={() => onChange(nextMode)}
      active
      className="text-foreground"
    />
  )
}
