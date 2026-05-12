'use client'

import { useState } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ActivityDaySummary, ActivityHeatmapWeek, ActivityViewSource } from '@/lib/activity/types'

export interface ActivityHeatmapSelectionRange {
  start: string
  end: string
}

interface ActivityHeatmapProps {
  weeks: ActivityHeatmapWeek[]
  selectedDay?: string
  selectedRange?: ActivityHeatmapSelectionRange
  onSelectDay: (day: ActivityDaySummary) => void
  onSelectRange?: (range: ActivityHeatmapSelectionRange) => void
  onClearSelection?: () => void
  compact?: boolean
  comfortable?: boolean
  adaptive?: boolean
  showMonthLabels?: boolean
  source?: ActivityViewSource | 'all'
  labels: {
    dayCount: string
    emptyDay: string
    records?: string
    writing?: string
    chats?: string
    ai?: string
    memory?: string
  }
}

function getIntensityLevel(totalCount: number) {
  if (totalCount <= 0) return 0
  if (totalCount <= 5) return 1
  if (totalCount <= 10) return 2
  if (totalCount <= 20) return 3
  return 4
}

const LEVEL_CLASSES = [
  'bg-muted hover:bg-muted/80',
  'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900',
  'bg-emerald-300 hover:bg-emerald-400 dark:bg-emerald-800/80 dark:hover:bg-emerald-700',
  'bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600/90 dark:hover:bg-emerald-500',
  'bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-400/90 dark:hover:bg-emerald-300',
] as const

function getDayCount(day: ActivityDaySummary, source: ActivityViewSource | 'all') {
  if (source !== 'all') {
    return day.counts[source]
  }

  return day.totalCount
}

function getMonthLabel(day: string) {
  const date = new Date(`${day}T00:00:00`)
  return date.toLocaleString(undefined, { month: 'short' })
}

function normalizeRange(start: string, end: string): ActivityHeatmapSelectionRange {
  return start <= end ? { start, end } : { start: end, end: start }
}

function isInRange(day: string, range?: ActivityHeatmapSelectionRange) {
  return Boolean(range && day >= range.start && day <= range.end)
}

export function ActivityHeatmap({
  weeks,
  selectedDay,
  selectedRange,
  onSelectDay,
  onSelectRange,
  onClearSelection,
  compact = false,
  comfortable = false,
  adaptive = false,
  showMonthLabels = true,
  source = 'all',
  labels,
}: ActivityHeatmapProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [dragStartDay, setDragStartDay] = useState<string | undefined>()
  const [dragEndDay, setDragEndDay] = useState<string | undefined>()
  const previewRange = dragStartDay && dragEndDay ? normalizeRange(dragStartDay, dragEndDay) : undefined
  const activeRange = previewRange || selectedRange

  function handlePointerDown(day: ActivityDaySummary) {
    if (!onSelectRange) return

    setDragStartDay(day.day)
    setDragEndDay(day.day)
  }

  function handlePointerEnter(day: ActivityDaySummary) {
    if (!dragStartDay) return
    setDragEndDay(day.day)
  }

  function handlePointerUp(day: ActivityDaySummary) {
    if (!dragStartDay) {
      if (selectedDay === day.day && !selectedRange) {
        onClearSelection?.()
        return
      }

      onSelectDay(day)
      return
    }

    const nextRange = normalizeRange(dragStartDay, dragEndDay || day.day)
    setDragStartDay(undefined)
    setDragEndDay(undefined)

    if (nextRange.start === nextRange.end) {
      if (selectedDay === nextRange.start && !selectedRange) {
        onClearSelection?.()
        return
      }

      onSelectDay(day)
      return
    }

    onSelectRange?.(nextRange)
  }

  function handleKeyboardSelect(day: ActivityDaySummary) {
    if (selectedDay === day.day && !selectedRange) {
      onClearSelection?.()
      return
    }

    onSelectDay(day)
  }

  return (
    <TooltipProvider>
      <div
        className="w-full overflow-visible px-1 py-1"
        onPointerLeave={() => {
          setDragStartDay(undefined)
          setDragEndDay(undefined)
        }}
      >
        {!adaptive && showMonthLabels ? (
          <div className={cn('mb-1 flex gap-1.5 text-[10px] text-muted-foreground', compact && 'gap-1')}>
            {weeks.map((week, weekIndex) => {
              const firstDay = week.days[0]?.day
              const shouldShowLabel = firstDay && (weekIndex === 0 || firstDay.slice(8, 10) <= '07')

              return (
                <span
                  key={`${firstDay}-${weekIndex}`}
                  className={cn(compact ? 'w-3' : comfortable ? 'w-[18px]' : 'w-4', 'truncate')}
                >
                  {shouldShowLabel ? getMonthLabel(firstDay) : ''}
                </span>
              )
            })}
          </div>
        ) : null}
        <div className={cn(adaptive ? 'grid w-full grid-flow-col auto-cols-fr gap-1' : 'inline-flex gap-1.5', compact && !adaptive && 'gap-1', comfortable && !adaptive && 'gap-[5px]')}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className={cn(adaptive ? 'grid grid-rows-7 gap-1' : 'flex flex-col gap-1.5', compact && !adaptive && 'gap-1', comfortable && !adaptive && 'gap-[5px]')}>
              {week.days.map((day) => {
                const visibleCount = getDayCount(day, source)
                const level = getIntensityLevel(visibleCount)
                const isExactSelected = selectedDay === day.day
                const isRangeSelected = !isExactSelected && isInRange(day.day, activeRange)
                const isSelected = isExactSelected || isRangeSelected
                const isToday = today === day.day
                const tooltipText = visibleCount > 0
                  ? `${day.day} · ${visibleCount} ${labels.dayCount}`
                  : `${day.day} · ${labels.emptyDay}`

                return (
                  <Tooltip key={day.day}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onPointerDown={() => handlePointerDown(day)}
                        onPointerEnter={() => handlePointerEnter(day)}
                        onPointerUp={() => handlePointerUp(day)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return

                          event.preventDefault()
                          handleKeyboardSelect(day)
                        }}
                        className={cn(
                          adaptive
                            ? 'aspect-square w-full rounded-[4px] border border-black/5 transition-colors'
                            : comfortable
                              ? 'h-[18px] w-[18px] rounded-[4px] border border-black/5 transition-colors'
                              : compact
                              ? 'h-3 w-3 rounded-[3px] border border-black/5 transition-colors'
                              : 'h-4 w-4 rounded-[4px] border border-black/5 transition-colors',
                          LEVEL_CLASSES[level],
                          dragStartDay && 'cursor-crosshair',
                          isToday && !isSelected && 'ring-1 ring-primary/40 ring-offset-1 ring-offset-background',
                          isRangeSelected && 'border-emerald-500/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.72),0_0_0_1px_rgba(16,185,129,0.18)] dark:border-emerald-300/45 dark:shadow-[inset_0_0_0_1px_rgba(6,78,59,0.84),0_0_0_1px_rgba(110,231,183,0.18)]',
                          isExactSelected && 'border-emerald-600/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.94),0_0_0_0_2px_rgba(5,150,105,0.24)] dark:border-emerald-200/60 dark:shadow-[inset_0_0_0_1px_rgba(6,95,70,0.92),0_0_0_0_2px_rgba(110,231,183,0.2)]'
                        )}
                        aria-label={tooltipText}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{tooltipText}</p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
