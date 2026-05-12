"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Trash2, XCircle, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import { OrganizeNotes } from "./organize-notes"
import { useEffect, useRef } from "react"
import { MarkFilterPopover } from "./mark-filter-popover"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState, initRecordFilters } = useMarkStore()
  const organizeRef = useRef<{ openOrganize: () => void }>(null)

  useEffect(() => {
    initRecordFilters()
  }, [initRecordFilters])

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  const handleOrganize = () => {
    organizeRef.current?.openOrganize()
  }

  return (
    <div className="flex items-center gap-0.5">
      {!trashState && (
        <TooltipButton 
          buttonId="onboarding-target-organize-notes"
          icon={<Sparkles className="h-4 w-4" />} 
          tooltipText={t('toolbar.organizeNotes')} 
          onClick={handleOrganize}
          variant="ghost"
          side="bottom"
          buttonClassName="size-7 rounded-md text-muted-foreground hover:text-foreground"
        />
      )}
      <MarkFilterPopover />
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
