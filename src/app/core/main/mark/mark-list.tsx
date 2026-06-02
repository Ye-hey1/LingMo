'use client'

import React from "react"
import { useTranslations } from "next-intl";
import type { Mark } from "@/db/marks";
import useMarkStore from "@/stores/mark";
import MarkEmpty from "./mark-empty";
import { filterMarks, getEffectiveRecordFilters } from "./mark-filters";
import { MarkListDefaultView } from "./mark-list-default-view";
import { MarkListCompactView } from "./mark-list-compact-view";
import { MarkListCardView } from "./mark-list-card-view";
import { TodoStats } from "./todo-stats";
import { RecordFilterChips } from "./record-filter-chips";

export const MarkList = React.memo(function MarkList() {
  const t = useTranslations('record.mark.list')
  const {
    marks,
    trashState,
    recordFilters,
    recordViewMode,
    setVisibleMarkIds,
  } = useMarkStore()

  const effectiveFilters = React.useMemo(() => (
    getEffectiveRecordFilters(recordFilters, { trashState })
  ), [trashState, recordFilters])

  const filtersActive = React.useMemo(() => {
    return Boolean(
      effectiveFilters.search.trim() ||
      effectiveFilters.selectedTypes.length > 0 ||
      effectiveFilters.timePreset !== 'all' ||
      effectiveFilters.tagId !== 'all' ||
      effectiveFilters.processState !== 'all'
    )
  }, [effectiveFilters])

  const filteredMarks = React.useMemo(() => (
    filterMarks(marks, { ...effectiveFilters, trashState })
  ), [marks, effectiveFilters, trashState])

  const hasTodoVisible = React.useMemo(() => {
    const types = effectiveFilters.selectedTypes
    return types.length === 0 || types.includes('todo')
  }, [effectiveFilters.selectedTypes])

  React.useEffect(() => {
    setVisibleMarkIds(filteredMarks.map((mark: Mark) => mark.id))
    return () => setVisibleMarkIds([])
  }, [filteredMarks, setVisibleMarkIds])

  const view = (() => {
    switch (recordViewMode) {
    case 'compact':
      return <MarkListCompactView marks={filteredMarks} />
    case 'cards':
      return <MarkListCardView marks={filteredMarks} />
    case 'list':
    default:
      return <MarkListDefaultView marks={filteredMarks} />
    }
  })()

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-0">
        <div>
          <RecordFilterChips count={filteredMarks.length} trashState={trashState} />
          {!trashState && hasTodoVisible && <TodoStats marks={filteredMarks} />}
          {/* 队列进度已迁移至全局底部状态栏（GlobalProgress）显示 */}
          {
            filteredMarks.length ? (
              view
            ) : filtersActive ? (
              <div className="flex flex-col justify-center items-center flex-1 w-full pt-32 text-center">
                <p className="text-sm text-zinc-500">{t('emptyFiltered')}</p>
                <p className="mt-1 text-xs text-zinc-400">{t('emptyFilteredHint')}</p>
              </div>
            ) : <MarkEmpty />
          }
        </div>
      </div>
    </div>
  )
})
