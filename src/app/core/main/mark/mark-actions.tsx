"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Trash2, XCircle, Sparkles, RotateCcw } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import { OrganizeNotes } from "./organize-notes"
import { useRef } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { clearTrash, restoreMarks } from "@/db/marks"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const {
    trashState,
    setTrashState,
    marks,
    refreshVisibleMarks,
  } = useMarkStore()
  const organizeRef = useRef<{ openOrganize: () => void }>(null)

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  const handleClearTrash = async () => {
    const res = await confirm(t('trash.confirm') || '确定要清空垃圾箱吗？', {
      title: t('trash.title') || '提示',
      kind: 'warning',
    })
    if (res) {
      await clearTrash()
      await refreshVisibleMarks()
    }
  }

  const handleRestoreAllTrash = async () => {
    const ids = marks.map(mark => mark.id)
    if (ids.length === 0) return

    const res = await confirm(`确定要还原这 ${ids.length} 条记录吗？`, {
      title: t('trash.title') || '提示',
      kind: 'info',
    })

    if (res) {
      await restoreMarks(ids)
      await refreshVisibleMarks()
    }
  }


  const handleOrganize = () => {
    organizeRef.current?.openOrganize()
  }

  return (
    <div className="flex items-center gap-0.5">
      {trashState && marks.length > 0 && (
        <>
          <TooltipButton
            icon={<RotateCcw className="h-4 w-4" />}
            tooltipText="全部还原"
            onClick={handleRestoreAllTrash}
            variant="ghost"
            side="bottom"
            buttonClassName="size-7 rounded-md text-muted-foreground hover:text-foreground"
          />
          <TooltipButton
            icon={<Trash2 className="h-4 w-4 text-red-500 hover:text-red-700" />}
            tooltipText="清空回收站"
            onClick={handleClearTrash}
            variant="ghost"
            side="bottom"
            buttonClassName="size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-red-50 dark:hover:bg-red-950/30"
          />
        </>
      )}
      {!trashState && (
        <TooltipButton
          buttonId="onboarding-target-organize-notes"
          icon={<Sparkles className="h-4 w-4" />}
          tooltipText="AI 整理成笔记"
          onClick={handleOrganize}
          variant="ghost"
          side="bottom"
          buttonClassName="size-7 rounded-md text-muted-foreground hover:text-foreground"
        />
      )}
      <TooltipButton
        icon={trashState ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        tooltipText={trashState ? t('toolbar.closeTrash') : t('toolbar.trash')}
        onClick={handleToggleTrash}
        variant="ghost"
        side="bottom"
        buttonClassName={`size-7 rounded-md hover:text-foreground ${trashState ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
      />
      <OrganizeNotes ref={organizeRef} />
    </div>
  )
}
