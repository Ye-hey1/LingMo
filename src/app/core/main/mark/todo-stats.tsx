'use client'

import { useMemo } from 'react'
import { Mark } from '@/db/marks'
import { parseTodoMarkContent } from './mark-list-item-content'
import { CheckSquare, Square, AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import { GoalSettingsButton } from './goal-settings-button'

interface TodoStatsProps {
  marks: Mark[]
}

export function TodoStats({ marks }: TodoStatsProps) {
  const t = useTranslations()

  const stats = useMemo(() => {
    const todos = marks
      .filter(m => m.type === 'todo')
      .map(m => parseTodoMarkContent(m))

    if (todos.length === 0) return null

    const total = todos.length
    const completed = todos.filter(t => t.completed).length
    const overdue = todos.filter(t => {
      if (!t.dueDate || t.completed) return false
      return new Date(t.dueDate + 'T23:59:59').getTime() < Date.now()
    }).length
    const dueToday = todos.filter(t => {
      if (!t.dueDate || t.completed) return false
      return t.dueDate === dayjs().format('YYYY-MM-DD')
    }).length
    const progress = Math.round((completed / total) * 100)

    return { total, completed, overdue, dueToday, progress }
  }, [marks])

  if (!stats) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-1 text-[11px]">
        <span className="text-muted-foreground">暂无待办</span>
        <GoalSettingsButton />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <CheckSquare className="size-3.5 text-primary" />
        <span className="font-medium tabular-nums">
          {stats.completed}/{stats.total}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-1 min-w-[60px] max-w-[120px]">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              stats.progress === 100 ? "bg-green-500" : "bg-primary"
            )}
            style={{ width: `${stats.progress}%` }}
          />
        </div>
        <span className="tabular-nums text-muted-foreground">{stats.progress}%</span>
      </div>
      {stats.overdue > 0 && (
        <div className="flex items-center gap-1 text-red-500">
          <AlertTriangle className="size-3" />
          <span className="tabular-nums">{stats.overdue} {t('record.mark.todo.overdue')}</span>
        </div>
      )}
      {stats.dueToday > 0 && (
        <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Clock className="size-3" />
          <span className="tabular-nums">{stats.dueToday} {t('record.mark.todo.dueToday')}</span>
        </div>
      )}
      <div className="flex items-center gap-1 text-muted-foreground">
        <Square className="size-3" />
        <span className="tabular-nums">{stats.total - stats.completed} {t('record.mark.todo.uncompleted')}</span>
      </div>
      <GoalSettingsButton className="ml-auto" />
    </div>
  )
}
