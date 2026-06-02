"use client"

import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { getEffectiveRecordFilters } from "./mark-filters"

interface RecordFilterChipsProps {
  count: number
  trashState?: boolean
}

function formatTimePreset(timePreset: string) {
  if (timePreset === 'today') return '今天'
  if (timePreset === 'last7Days') return '最近7天'
  if (timePreset === 'last30Days') return '最近30天'
  return ''
}

function formatProcessState(processState: string) {
  if (processState === 'processed') return '已整理'
  if (processState === 'unprocessed') return '待整理'
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
    activeChips.push({
      key: 'search',
      label: `搜索: ${search}`,
      onClear: () => clearRecordFilter('search'),
    })
  }

  if (effectiveFilters.selectedTypes.length > 0) {
    activeChips.push({
      key: 'selectedTypes',
      label: `类型: ${effectiveFilters.selectedTypes.length} 种`,
      onClear: clearRecordTypes,
    })
  }

  if (effectiveFilters.timePreset !== 'all') {
    activeChips.push({
      key: 'timePreset',
      label: `${trashState ? '删除时间' : '时间'}: ${formatTimePreset(effectiveFilters.timePreset)}`,
      onClear: () => clearRecordFilter('timePreset'),
    })
  }

  if (!trashState && effectiveFilters.processState !== 'all') {
    activeChips.push({
      key: 'processState',
      label: `状态: ${formatProcessState(effectiveFilters.processState)}`,
      onClear: () => clearRecordFilter('processState'),
    })
  }

  if (!trashState && effectiveFilters.tagId !== 'all') {
    const tagName = tags.find((tag) => tag.id === effectiveFilters.tagId)?.name || '标签'
    activeChips.push({
      key: 'tagId',
      label: `标签: ${tagName}`,
      onClear: () => clearRecordFilter('tagId'),
    })
  }

  if (activeChips.length === 0) {
    return null
  }

  return (
    <div className="border-b bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
          已筛选 {count} 条
        </Badge>
        {activeChips.map((chip) => (
          <Badge key={chip.key} variant="outline" className="gap-1 rounded-full px-2 py-0 text-[11px] font-normal">
            <span>{chip.label}</span>
            <button
              type="button"
              className="ml-0.5 rounded-full text-muted-foreground transition-colors hover:text-foreground"
              onClick={chip.onClear}
              aria-label={`清除${chip.label}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 rounded-full px-2 text-[11px] text-muted-foreground"
          onClick={resetRecordFilters}
        >
          清除全部
        </Button>
      </div>
    </div>
  )
}
