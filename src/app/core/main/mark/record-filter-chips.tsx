"use client"

import { X } from "lucide-react"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { getEffectiveRecordFilters } from "./mark-filters"

interface RecordFilterChipsProps {
  count: number
  trashState?: boolean
}

function formatTimePreset(timePreset: string) {
  if (timePreset === 'today') return '今天'
  if (timePreset === 'last7Days') return '7天内'
  if (timePreset === 'last30Days') return '30天内'
  return ''
}

export function RecordFilterChips({ count, trashState = false }: RecordFilterChipsProps) {
  const {
    recordFilters,
    clearRecordFilter,
    clearRecordTypes,
    resetRecordFilters,
  } = useMarkStore()
  const { tags } = useTagStore()
  const effectiveFilters = getEffectiveRecordFilters(recordFilters, { trashState })
  const activeChips: Array<{ key: string; label: string; onClear: () => void }> = []

  const search = effectiveFilters.search.trim()
  if (search) {
    activeChips.push({ key: 'search', label: `"${search.slice(0, 12)}${search.length > 12 ? '…' : ''}"`, onClear: () => clearRecordFilter('search') })
  }

  if (effectiveFilters.selectedTypes.length > 0) {
    activeChips.push({ key: 'selectedTypes', label: `${effectiveFilters.selectedTypes.length}种类型`, onClear: clearRecordTypes })
  }

  if (effectiveFilters.timePreset !== 'all') {
    activeChips.push({ key: 'timePreset', label: formatTimePreset(effectiveFilters.timePreset), onClear: () => clearRecordFilter('timePreset') })
  }

  if (!trashState && effectiveFilters.processState !== 'all') {
    activeChips.push({ key: 'processState', label: effectiveFilters.processState === 'processed' ? '已整理' : '待整理', onClear: () => clearRecordFilter('processState') })
  }

  if (!trashState && effectiveFilters.tagId !== 'all') {
    const tagName = tags.find((tag) => tag.id === effectiveFilters.tagId)?.name || ''
    if (tagName) activeChips.push({ key: 'tagId', label: tagName, onClear: () => clearRecordFilter('tagId') })
  }

  if (activeChips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
      <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      {activeChips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-0.5 rounded bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">
          {chip.label}
          <button
            type="button"
            className="ml-0.5 rounded-full hover:text-foreground"
            onClick={chip.onClear}
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="text-[10px] text-muted-foreground/60 hover:text-foreground"
        onClick={resetRecordFilters}
      >
        清除
      </button>
    </div>
  )
}
