'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Activity, BarChart3, Brain, CalendarDays, CloudSync, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'

import { MEMORY_TAB_PATH } from '@/app/core/main/memory/memory-constants'
import { requestOpenMemorySession } from '@/app/core/main/memory/memory-navigation'
import { ActivityDayDetail } from '@/components/activity/activity-day-detail'
import { ActivityHeatmap, type ActivityHeatmapSelectionRange } from '@/components/activity/activity-heatmap'
import { SyncHealthPanel } from '@/components/sync/sync-health-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'
import { cn } from '@/lib/utils'
import type { ActivityAiInteractionDayStat, ActivityAiInteractionPlatformStat, ActivityCalendarData, ActivityDaySummary, ActivityEntry, ActivityPlatformStat, ActivityProjectStat, ActivitySource, ActivityViewSource } from '@/lib/activity/types'

interface ActivityPanelProps {
  data: ActivityCalendarData | null
  selectedDay?: ActivityDaySummary
  loading?: boolean
  onSelectDay: (day?: ActivityDaySummary) => void
  onRefresh?: () => void
  onEntryPathOpen?: () => void
  mode?: 'page' | 'drawer'
}

type ActivityTab = 'overview' | 'timeline' | 'ai' | 'memory' | 'sync'
type TimelineRangePreset = '7d' | '30d' | 'all' | 'custom'
type ActivityFocusRange = ActivityHeatmapSelectionRange

const FILTERS: Array<{ value: ActivityViewSource | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'record', label: '记录' },
  { value: 'writing', label: '写作' },
  { value: 'chat', label: '对话' },
  { value: 'ai', label: 'AI' },
  { value: 'memory', label: '记忆' },
]

const TIMELINE_RANGE_PRESETS: Array<{ value: TimelineRangePreset; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
]

const OVERVIEW_HEATMAP_WEEKS = 26

const EMPTY_COUNTS: Record<ActivitySource, number> = {
  record: 0,
  chat: 0,
  writing: 0,
  ai: 0,
  memory: 0,
}

const SOURCE_CHART_COLORS: Record<ActivitySource, string> = {
  record: '#e85d75',
  writing: '#37b88f',
  chat: '#4aa3df',
  ai: '#7c5cff',
  memory: '#efa52f',
}

function getRecentWeeks(data: ActivityCalendarData, count = OVERVIEW_HEATMAP_WEEKS) {
  return data.weeks.slice(-count)
}

function getAllCalendarDays(data: ActivityCalendarData) {
  return data.weeks.flatMap(week => week.days)
}

function formatShortPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function getTimelineRange(data: ActivityCalendarData, preset: TimelineRangePreset, startDay: string, endDay: string) {
  if (preset === '7d') {
    return {
      start: shiftDay(data.insights.today.day, -6),
      end: data.insights.today.day,
    }
  }

  if (preset === '30d') {
    return {
      start: shiftDay(data.insights.today.day, -29),
      end: data.insights.today.day,
    }
  }

  if (preset === 'custom') {
    return {
      start: startDay || data.startDate,
      end: endDay || data.endDate,
    }
  }

  return {
    start: data.startDate,
    end: data.endDate,
  }
}

function filterDayBySource(day: ActivityDaySummary, source: ActivityViewSource | 'all'): ActivityDaySummary | null {
  if (source === 'all') {
    return day.totalCount > 0 ? day : null
  }

  const entries = day.entries.filter(entry => entry.source === source)
  if (!entries.length) return null

  return {
    ...day,
    totalCount: entries.length,
    counts: {
      ...EMPTY_COUNTS,
      [source]: entries.length,
    },
    entries,
  }
}

function getScopedTimelineDays(
  data: ActivityCalendarData,
  preset: TimelineRangePreset,
  startDay: string,
  endDay: string,
  source: ActivityViewSource | 'all',
) {
  const { start, end } = getTimelineRange(data, preset, startDay, endDay)
  const normalizedStart = start <= end ? start : end
  const normalizedEnd = start <= end ? end : start

  return data.days
    .filter(day => day.day >= normalizedStart && day.day <= normalizedEnd)
    .map(day => filterDayBySource(day, source))
    .filter((day): day is ActivityDaySummary => Boolean(day))
    .sort((a, b) => b.day.localeCompare(a.day))
}

function MetricTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  onClick,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'green' | 'blue' | 'rose'
  icon?: ReactNode
  onClick?: () => void
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )
  const className = cn(
      'min-h-[92px] rounded-lg border border-border/70 bg-background px-4 py-3 shadow-sm',
      tone === 'green' && 'border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-900/70 dark:bg-emerald-950/25',
      tone === 'blue' && 'border-sky-200/80 bg-sky-50/80 dark:border-sky-900/70 dark:bg-sky-950/25',
      tone === 'rose' && 'border-rose-200/80 bg-rose-50/80 dark:border-rose-900/70 dark:bg-rose-950/25',
      onClick && 'cursor-pointer text-left transition-colors hover:border-primary/45 hover:bg-muted/30'
    )

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    )
  }

  return (
    <div className={className}>
      {content}
    </div>
  )
}

function SectionShell({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border/70 bg-background p-4 shadow-sm', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function formatLastActive(timestamp?: number) {
  if (!timestamp) return '暂无记录'

  const diffMs = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`

  return new Date(timestamp).toISOString().slice(0, 10)
}

function PlatformSummaryGrid({ platforms }: { platforms: ActivityPlatformStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {platforms.map(platform => (
        <div key={platform.platform} className="rounded-lg border border-border/70 bg-background px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{platform.label}</p>
            <Badge variant={platform.todayCount > 0 ? 'default' : 'outline'} className="shrink-0">
              今日 {platform.todayCount}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-muted/35 px-2 py-2">
              <p className="text-[11px] text-muted-foreground">总会话</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{platform.sessionCount}</p>
            </div>
            <div className="rounded-md bg-muted/35 px-2 py-2">
              <p className="text-[11px] text-muted-foreground">最近活跃</p>
              <p className="mt-1 truncate text-sm font-medium">{formatLastActive(platform.lastActiveAt)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectList({ projects }: { projects: ActivityProjectStat[] }) {
  if (!projects.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">今日暂无项目交互</p>
  }

  return (
    <div className="space-y-2">
      {projects.map((project, index) => (
        <div key={project.cwd} className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{formatShortPath(project.cwd)}</span>
          <Badge variant="outline" className="shrink-0">{project.count}</Badge>
        </div>
      ))}
    </div>
  )
}

function getInteractionPlatforms(data: ActivityCalendarData) {
  return data.insights.platforms
}

function getAiInteractionEntries(data: ActivityCalendarData) {
  return data.days
    .flatMap(day => day.entries)
    .filter(entry => entry.source === 'ai')
    .sort((a, b) => b.timestamp - a.timestamp)
}

function getTodayAiInteractionCount(data: ActivityCalendarData) {
  const today = data.days.find(day => day.day === data.insights.today.day)
  return today?.counts.ai || 0
}

function getRecentAiPlatform(platforms: ActivityPlatformStat[]) {
  return platforms
    .filter(platform => platform.lastActiveAt)
    .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))[0]
}

function getEntryPlatformLabel(entry: ActivityEntry, platforms: ActivityPlatformStat[]) {
  const platform = typeof entry.meta?.platform === 'string' ? entry.meta.platform : ''
  return platforms.find(item => item.platform === platform)?.label || 'AI'
}

function getSevenDayAiTrend(data: ActivityCalendarData) {
  const endDay = data.insights.today.day
  const startDay = shiftDay(endDay, -6)
  const dayMap = new Map(data.days.map(day => [day.day, day]))
  const trend: Array<{ day: string; count: number }> = []

  for (let cursor = startDay; cursor <= endDay; cursor = shiftDay(cursor, 1)) {
    trend.push({
      day: cursor,
      count: dayMap.get(cursor)?.counts.ai || 0,
    })
  }

  return trend
}

function getTodayAiProjects(data: ActivityCalendarData): ActivityProjectStat[] {
  const today = data.days.find(day => day.day === data.insights.today.day)
  if (!today) return []

  const stats = new Map<string, ActivityProjectStat>()

  for (const entry of today.entries) {
    if (entry.source !== 'ai' || !entry.path) continue

    const item = stats.get(entry.path) || { cwd: entry.path, count: 0 }
    item.count += 1
    if (!item.lastActiveAt || entry.timestamp > item.lastActiveAt) {
      item.lastActiveAt = entry.timestamp
    }
    stats.set(entry.path, item)
  }

  return Array.from(stats.values())
    .sort((a, b) => b.count - a.count || (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
    .slice(0, 6)
}

function AiTrendBars({ trend }: { trend: Array<{ day: string; count: number }> }) {
  const maxCount = Math.max(...trend.map(day => day.count), 1)

  return (
    <div className="grid h-44 grid-cols-7 items-end gap-2">
      {trend.map(day => (
        <div key={day.day} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
          <div className="flex h-32 w-full items-end rounded-md bg-muted/35 px-1.5 py-1.5">
            <div
              className="w-full rounded bg-sky-500"
              style={{ height: day.count ? `${Math.max(10, (day.count / maxCount) * 100)}%` : '2px' }}
              title={`${day.day} · ${day.count}`}
            />
          </div>
          <div className="text-center">
            <p className="text-xs font-medium tabular-nums">{day.count}</p>
            <p className="text-[11px] text-muted-foreground">{day.day.slice(5)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function RecentAiSessionList({
  entries,
  platforms,
  onOpenEntryPath,
}: {
  entries: ActivityEntry[]
  platforms: ActivityPlatformStat[]
  onOpenEntryPath: (entry: ActivityEntry) => void
}) {
  if (!entries.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无 AI 会话记录</p>
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 rounded-md bg-muted/35 px-3 py-2">
          <Badge variant="outline" className="mt-0.5 shrink-0">
            {getEntryPlatformLabel(entry, platforms)}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm leading-5">{getEntryText(entry)}</p>
            {entry.path ? (
              <button
                type="button"
                className="mt-1 max-w-full truncate text-xs font-medium text-primary hover:underline"
                title={entry.path}
                onClick={() => onOpenEntryPath(entry)}
              >
                {formatShortPath(entry.path)}
              </button>
            ) : null}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatEntryDayTime(entry.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}

function AiInteractionTab({
  data,
  onOpenEntryPath,
}: {
  data: ActivityCalendarData
  onOpenEntryPath: (entry: ActivityEntry) => void
}) {
  const platforms = getInteractionPlatforms(data)
  const entries = getAiInteractionEntries(data)
  const todayProjects = getTodayAiProjects(data)
  const recentPlatform = getRecentAiPlatform(platforms)
  const trend = getSevenDayAiTrend(data)
  const totalSessions = platforms.reduce((sum, platform) => sum + platform.sessionCount, 0)
  const activePlatforms = platforms.filter(platform => platform.sessionCount > 0).length
  const todayCount = getTodayAiInteractionCount(data)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricTile label="今日交互" value={todayCount} icon={<MessageSquare className="h-4 w-4" />} />
        <MetricTile label="会话总数" value={totalSessions} tone="blue" />
        <MetricTile label="活跃平台" value={activePlatforms} tone="green" />
        <MetricTile
          label="最近活跃"
          value={recentPlatform?.label || '暂无'}
          hint={recentPlatform ? formatLastActive(recentPlatform.lastActiveAt) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <SectionShell title="平台分布">
          <PlatformSummaryGrid platforms={platforms} />
        </SectionShell>
        <SectionShell title="近 7 天交互">
          <AiTrendBars trend={trend} />
        </SectionShell>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <SectionShell title="最近 AI 会话">
          <RecentAiSessionList entries={entries.slice(0, 6)} platforms={platforms} onOpenEntryPath={onOpenEntryPath} />
        </SectionShell>
        <SectionShell title="今日项目分布">
          <ProjectList projects={todayProjects} />
        </SectionShell>
      </div>
    </div>
  )
}

function MemorySnapshot({ data }: { data: ActivityCalendarData }) {
  const memory = data.insights.memory

  return (
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="记忆总数" value={memory.total} icon={<Brain className="h-4 w-4" />} />
        <MetricTile label="今日新增" value={memory.todayCreated} tone="green" />
        <MetricTile label="今日命中" value={memory.todayAccessed} tone="blue" />
        <MetricTile label="待整理" value={memory.staleCount} tone="rose" />
      </div>
      <SectionShell title="高频记忆">
        <div className="space-y-2">
          {memory.topAccessed.length ? memory.topAccessed.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-md bg-muted/35 px-3 py-2">
              <Badge variant="outline" className="mt-0.5 shrink-0">
                {item.category === 'preference' ? '偏好' : '记忆'}
              </Badge>
              <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-5">{item.content}</p>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.accessCount}</span>
            </div>
          )) : (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无访问记录</p>
          )}
        </div>
      </SectionShell>
    </div>
  )
}

const OVERVIEW_SOURCE_STYLES: Record<ActivitySource, { label: string; barClassName: string; badgeClassName: string }> = {
  record: {
    label: '记录',
    barClassName: 'bg-rose-500',
    badgeClassName: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  },
  writing: {
    label: '写作',
    barClassName: 'bg-emerald-500',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
  chat: {
    label: '对话',
    barClassName: 'bg-sky-500',
    badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  },
  ai: {
    label: 'AI',
    barClassName: 'bg-violet-500',
    badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  },
  memory: {
    label: '记忆',
    barClassName: 'bg-amber-500',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  },
}

const OVERVIEW_SOURCES: ActivitySource[] = ['record', 'writing', 'chat', 'ai', 'memory']

function getRecentDaySummaries(data: ActivityCalendarData, count: number) {
  const endDay = data.insights.today.day
  const startDay = shiftDay(endDay, -(count - 1))
  return getAllCalendarDays(data).filter(day => day.day >= startDay && day.day <= endDay)
}

function getDaysInRange(data: ActivityCalendarData, range: ActivityFocusRange) {
  const start = range.start <= range.end ? range.start : range.end
  const end = range.start <= range.end ? range.end : range.start
  return getAllCalendarDays(data).filter(day => day.day >= start && day.day <= end)
}

function getOverviewScopeDays(
  data: ActivityCalendarData,
  selectedDay?: ActivityDaySummary,
  selectedRange?: ActivityFocusRange
) {
  if (selectedRange) return getDaysInRange(data, selectedRange)
  if (selectedDay) return [selectedDay]
  return getRecentDaySummaries(data, 7)
}

function getOverviewScopeLabel(selectedDay?: ActivityDaySummary, selectedRange?: ActivityFocusRange) {
  if (selectedRange) {
    return selectedRange.start === selectedRange.end
      ? selectedRange.start
      : `${selectedRange.start} 至 ${selectedRange.end}`
  }

  if (selectedDay) return selectedDay.day
  return '近 7 天'
}

function getOverviewScopeTitle(selectedDay?: ActivityDaySummary, selectedRange?: ActivityFocusRange) {
  if (selectedRange) return '选中范围'
  if (selectedDay) return '选中日期'
  return '最近活动'
}

function getOverviewSourceBreakdown(days: ActivityDaySummary[]) {

  return OVERVIEW_SOURCES.map(source => ({
    source,
    label: OVERVIEW_SOURCE_STYLES[source].label,
    count: days.reduce((sum, day) => sum + day.counts[source], 0),
    color: SOURCE_CHART_COLORS[source],
  }))
}

function getOverviewScopeStats(days: ActivityDaySummary[]) {
  const activeDays = days.filter(day => day.totalCount > 0).length
  const totalCount = days.reduce((sum, day) => sum + day.totalCount, 0)
  const aiCount = days.reduce((sum, day) => sum + day.counts.ai, 0)
  const memoryCount = days.reduce((sum, day) => sum + day.counts.memory, 0)

  return {
    activeDays,
    totalCount,
    aiCount,
    memoryCount,
    averageCount: days.length ? Number((totalCount / days.length).toFixed(1)) : 0,
  }
}

function getOverviewActivityTrend(days: ActivityDaySummary[]) {
  if (days.length <= 14) {
    return days.map(day => ({
      key: day.day,
      label: day.day.slice(5),
      title: day.day,
      count: day.totalCount,
    }))
  }

  const bucketSize = Math.ceil(days.length / 14)
  const trend: Array<{ key: string; label: string; title: string; count: number }> = []

  for (let index = 0; index < days.length; index += bucketSize) {
    const bucket = days.slice(index, index + bucketSize)
    const firstDay = bucket[0]?.day || ''
    const lastDay = bucket[bucket.length - 1]?.day || firstDay
    trend.push({
      key: `${firstDay}-${lastDay}`,
      label: firstDay === lastDay ? firstDay.slice(5) : `${firstDay.slice(5)}~${lastDay.slice(5)}`,
      title: firstDay === lastDay ? firstDay : `${firstDay} 至 ${lastDay}`,
      count: bucket.reduce((sum, day) => sum + day.totalCount, 0),
    })
  }

  return trend
}

function getOverviewAiInteractionStat(data: ActivityCalendarData, days: ActivityDaySummary[]): ActivityAiInteractionDayStat {
  const dayKeys = new Set(days.map(day => day.day))
  const platformMap = new Map<string, ActivityAiInteractionPlatformStat>()
  let totalCount = 0

  for (const dayStat of data.insights.aiInteractions.days) {
    if (!dayKeys.has(dayStat.day)) continue

    totalCount += dayStat.totalCount
    for (const platform of dayStat.platforms) {
      const current = platformMap.get(platform.platform) || {
        platform: platform.platform,
        label: platform.label,
        count: 0,
        lastActiveAt: platform.lastActiveAt,
      }

      current.count += platform.count
      if (platform.lastActiveAt && (!current.lastActiveAt || platform.lastActiveAt > current.lastActiveAt)) {
        current.lastActiveAt = platform.lastActiveAt
      }
      platformMap.set(platform.platform, current)
    }
  }

  return {
    day: days.length === 1 ? days[0].day : '',
    totalCount,
    platforms: Array.from(platformMap.values()).sort((a, b) => b.count - a.count),
  }
}

function OverviewDonutChart({
  items,
}: {
  items: ReturnType<typeof getOverviewSourceBreakdown>
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0)
  let cursor = 0
  const segments = total > 0
    ? items.map((item) => {
      const start = cursor
      const end = cursor + (item.count / total) * 100
      cursor = end
      return `${item.color} ${start}% ${end}%`
    }).join(', ')
    : '#e5e7eb 0% 100%'
  return (
    <div className="flex h-full w-full items-center justify-center gap-6">
      <div className="relative h-[126px] w-[126px] shrink-0 rounded-full shadow-inner" style={{ background: `conic-gradient(${segments})` }}>
        <div className="absolute inset-[18px] flex items-center justify-center rounded-full bg-background shadow-sm">
          <span className="text-2xl font-semibold leading-none tabular-nums">{total}</span>
        </div>
      </div>
      <div className="w-52 min-w-0 space-y-2">
        {items.map((item) => {
          const percent = total > 0 ? Math.round((item.count / total) * 100) : 0

          return (
            <div key={item.source} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.label}</span>
                <span className="w-8 text-right font-medium tabular-nums">{item.count}</span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/45">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percent}%`, backgroundColor: item.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OverviewTrendBars({ trend }: { trend: Array<{ key: string; label: string; title: string; count: number }> }) {
  const maxCount = Math.max(...trend.map(day => day.count), 1)

  return (
    <div
      className="grid h-full w-full items-end gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.max(trend.length, 1)}, minmax(0, 1fr))` }}
    >
      {trend.map(day => (
        <div key={day.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
          <p className="text-xs font-medium tabular-nums">{day.count}</p>
          <div className="flex h-20 w-full items-end rounded-md bg-muted/30 px-1.5 py-1.5">
            <div
              className="w-full rounded bg-slate-700/85 dark:bg-slate-200/80"
              style={{ height: day.count ? `${Math.max(8, (day.count / maxCount) * 100)}%` : '2px' }}
              title={`${day.title} · ${day.count}`}
            />
          </div>
          <div className="text-center">
            <p className="truncate text-[10px] text-muted-foreground">{day.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function OverviewPlatformBars({ platforms }: { platforms: ActivityAiInteractionPlatformStat[] }) {
  const visiblePlatforms = platforms.filter(platform => platform.count > 0).slice(0, 4)
  const maxCount = Math.max(...visiblePlatforms.map(platform => platform.count), 1)

  if (!visiblePlatforms.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无平台交互</p>
  }

  return (
    <div className="w-full space-y-3">
      {visiblePlatforms.map(platform => (
        <div key={platform.platform} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">{platform.label}</span>
            <span className="tabular-nums text-muted-foreground">{platform.count}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted/45">
            <div
              className="h-full rounded-full bg-sky-500/85"
              style={{ width: `${Math.max(8, (platform.count / maxCount) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function getRecentEntries(data: ActivityCalendarData, scopeDays?: ActivityDaySummary[]) {
  const entries = scopeDays?.length
    ? scopeDays.flatMap(day => day.entries)
    : data.days.flatMap(day => day.entries)

  return [...entries]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5)
}

function formatEntryDayTime(timestamp: number) {
  const date = new Date(timestamp)
  const day = date.toISOString().slice(5, 10)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${hours}:${minutes}`
}

function getEntryText(entry: ActivityEntry) {
  return entry.description || entry.title || entry.path || ''
}

function OverviewActivityList({
  data,
  scopeDays,
  scopeLabel,
  onOpenEntryPath,
  onOpenTimeline,
  showTimelineAction = true,
}: {
  data: ActivityCalendarData
  scopeDays?: ActivityDaySummary[]
  scopeLabel: string
  onOpenEntryPath: (entry: ActivityEntry) => void
  onOpenTimeline: () => void
  showTimelineAction?: boolean
}) {
  const entries = getRecentEntries(data, scopeDays)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {scopeLabel}
        </p>
        {showTimelineAction ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onOpenTimeline}>
          查看时间线
        </Button>
        ) : null}
      </div>
      {entries.length ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 rounded-md bg-muted/35 px-3 py-2">
              <Badge variant="outline" className={cn('mt-0.5 shrink-0', OVERVIEW_SOURCE_STYLES[entry.source].badgeClassName)}>
                {OVERVIEW_SOURCE_STYLES[entry.source].label}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm">{getEntryText(entry)}</p>
                {entry.path ? (
                  <button
                    type="button"
                    className="mt-1 max-w-full truncate text-xs font-medium text-primary hover:underline"
                    title={entry.path}
                    onClick={() => onOpenEntryPath(entry)}
                  >
                    {formatShortPath(entry.path)}
                  </button>
                ) : null}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatEntryDayTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">暂无活动</p>
      )}
    </div>
  )
}

function TimelineFilterBar({
  data,
  rangePreset,
  startDay,
  endDay,
  source,
  onRangePresetChange,
  onStartDayChange,
  onEndDayChange,
  onSourceChange,
}: {
  data: ActivityCalendarData
  rangePreset: TimelineRangePreset
  startDay: string
  endDay: string
  source: ActivityViewSource | 'all'
  onRangePresetChange: (preset: TimelineRangePreset) => void
  onStartDayChange: (value: string) => void
  onEndDayChange: (value: string) => void
  onSourceChange: (source: ActivityViewSource | 'all') => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">范围</span>
        {TIMELINE_RANGE_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            variant={rangePreset === preset.value ? 'default' : 'outline'}
            size="sm"
            className="h-8 rounded-full px-3"
            onClick={() => onRangePresetChange(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        {rangePreset === 'custom' ? (
          <div className="ml-1 grid gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,160px)]">
            <Input
              type="date"
              value={startDay}
              min={data.startDate}
              max={data.endDate}
              className="h-8"
              onChange={(event) => onStartDayChange(event.target.value)}
            />
            <Input
              type="date"
              value={endDay}
              min={data.startDate}
              max={data.endDate}
              className="h-8"
              onChange={(event) => onEndDayChange(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
        <span className="mr-1 text-xs font-medium text-muted-foreground">类型</span>
        {FILTERS.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            variant={source === filter.value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 rounded-full px-3"
            onClick={() => onSourceChange(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function OverviewTab({
  data,
  selectedDay,
  selectedRange,
  onSelectDay,
  onSelectRange,
  onClearSelection,
  onOpenEntryPath,
  onOpenTimeline,
  onTabChange,
}: {
  data: ActivityCalendarData
  selectedDay?: ActivityDaySummary
  selectedRange?: ActivityFocusRange
  onSelectDay: (day?: ActivityDaySummary) => void
  onSelectRange: (range: ActivityFocusRange) => void
  onClearSelection: () => void
  onOpenEntryPath: (entry: ActivityEntry) => void
  onOpenTimeline: (day?: ActivityDaySummary, range?: ActivityFocusRange) => void
  onTabChange: (tab: ActivityTab) => void
}) {
  const scopeDays = getOverviewScopeDays(data, selectedDay, selectedRange)
  const scopeLabel = getOverviewScopeLabel(selectedDay, selectedRange)
  const scopeTitle = getOverviewScopeTitle(selectedDay, selectedRange)
  const scopeStats = getOverviewScopeStats(scopeDays)
  const selectedAiInteraction = getOverviewAiInteractionStat(data, scopeDays)
  const topPlatform = selectedAiInteraction.platforms[0]
  const overviewHeatmapWeeks = getRecentWeeks(data, 26)
  const sourceBreakdown = getOverviewSourceBreakdown(scopeDays)
  const overviewTrend = getOverviewActivityTrend(scopeDays)
  const hasSelection = Boolean(selectedDay || selectedRange)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <MetricTile label="范围活跃" value={scopeStats.totalCount} hint={scopeLabel} icon={<Activity className="h-4 w-4" />} onClick={() => onOpenTimeline(selectedDay, selectedRange)} />
        <MetricTile label="活跃天数" value={`${scopeStats.activeDays} 天`} hint={`共 ${scopeDays.length} 天`} tone="green" />
        <MetricTile label="日均次数" value={scopeStats.averageCount} hint={hasSelection ? '当前选择' : '近 7 天'} tone="blue" onClick={() => onOpenTimeline(selectedDay, selectedRange)} />
        <MetricTile label="AI 交互" value={selectedAiInteraction.totalCount} hint={topPlatform ? topPlatform.label : scopeLabel} icon={<MessageSquare className="h-4 w-4" />} onClick={() => onTabChange('ai')} />
        <MetricTile label="记忆沉淀" value={scopeStats.memoryCount} hint={scopeLabel} tone="rose" icon={<Sparkles className="h-4 w-4" />} onClick={() => onTabChange('memory')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title="热力图"
          action={hasSelection ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearSelection}>
              清空
            </Button>
          ) : null}
          className="flex h-[220px] flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div className="w-full max-w-[600px]">
              <ActivityHeatmap
                weeks={overviewHeatmapWeeks}
                selectedDay={selectedDay?.day}
                selectedRange={selectedRange}
                onSelectDay={onSelectDay}
                onSelectRange={onSelectRange}
                onClearSelection={onClearSelection}
                adaptive
                showMonthLabels={false}
                labels={{
                  dayCount: '次',
                  emptyDay: '无活动',
                  records: '记录',
                  writing: '写作',
                  chats: '对话',
                  ai: 'AI',
                  memory: '记忆',
                }}
              />
            </div>
          </div>
        </SectionShell>
        <SectionShell
          title="活动组成"
          action={<span className="text-xs text-muted-foreground">{scopeLabel}</span>}
          className="flex h-[220px] flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 items-center">
            <OverviewDonutChart items={sourceBreakdown} />
          </div>
        </SectionShell>
        <SectionShell title="范围趋势" className="flex h-[220px] flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 items-end">
            <OverviewTrendBars trend={overviewTrend} />
          </div>
        </SectionShell>
        <SectionShell title="AI 平台分布" className="flex h-[220px] flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 items-center">
            <OverviewPlatformBars platforms={selectedAiInteraction.platforms} />
          </div>
        </SectionShell>
      </div>

      <SectionShell title={scopeTitle} className="flex max-h-[360px] flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <OverviewActivityList
            data={data}
            scopeDays={scopeDays}
            scopeLabel={scopeLabel}
            onOpenEntryPath={onOpenEntryPath}
            onOpenTimeline={() => onOpenTimeline(selectedDay, selectedRange)}
          />
        </div>
      </SectionShell>
    </div>
  )
}

function TimelineTab({
  data,
  source,
  onSourceChange,
  onOpenEntryPath,
  focusDay,
  focusRange,
}: {
  data: ActivityCalendarData
  source: ActivityViewSource | 'all'
  onSourceChange: (source: ActivityViewSource | 'all') => void
  onOpenEntryPath: (entry: ActivityEntry) => void
  focusDay?: string
  focusRange?: ActivityFocusRange
}) {
  const [rangePreset, setRangePreset] = useState<TimelineRangePreset>('30d')
  const [startDay, setStartDay] = useState(data.startDate)
  const [endDay, setEndDay] = useState(data.insights.today.day)

  useEffect(() => {
    if (focusRange) {
      setRangePreset('custom')
      setStartDay(focusRange.start)
      setEndDay(focusRange.end)
      return
    }

    if (!focusDay) return

    setRangePreset('custom')
    setStartDay(focusDay)
    setEndDay(focusDay)
  }, [focusDay, focusRange])

  const timelineDays = useMemo(() => {
    return getScopedTimelineDays(data, rangePreset, startDay, endDay, source)
  }, [data, endDay, rangePreset, source, startDay])

  const totalCount = timelineDays.reduce((sum, day) => sum + day.totalCount, 0)

  return (
    <div className="space-y-4">
      <SectionShell
        title="时间线"
        action={<Badge variant="outline">{timelineDays.length} 天 · {totalCount} 次</Badge>}
      >
        <TimelineFilterBar
          data={data}
          rangePreset={rangePreset}
          startDay={startDay}
          endDay={endDay}
          source={source}
          onRangePresetChange={setRangePreset}
          onStartDayChange={setStartDay}
          onEndDayChange={setEndDay}
          onSourceChange={onSourceChange}
        />
      </SectionShell>

      {timelineDays.length ? (
        <div className="space-y-6">
          {timelineDays.map((day) => (
            <div key={`${day.day}-${source}`}>
              <ActivityDayDetail
                day={day}
                onOpenEntryPath={onOpenEntryPath}
                summarySource={source}
                labels={{
                  empty: '该日期暂无活动',
                  records: '记录',
                  writing: '写作',
                  chats: '对话',
                  ai: 'AI',
                  memory: '记忆',
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
          当前筛选范围内暂无活动
        </div>
      )}
    </div>
  )
}

export function ActivityPanel({
  data,
  selectedDay,
  loading = false,
  onSelectDay,
  onRefresh,
  onEntryPathOpen,
  mode = 'page',
}: ActivityPanelProps) {
  const t = useTranslations('activity')
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { centerPanelVisible, setLeftSidebarTab, toggleCenterPanel } = useSidebarStore()
  const [tab, setTab] = useState<ActivityTab>('overview')
  const [source, setSource] = useState<ActivityViewSource | 'all'>('all')
  const [timelineFocusDay, setTimelineFocusDay] = useState<string | undefined>()
  const [timelineFocusRange, setTimelineFocusRange] = useState<ActivityFocusRange | undefined>()
  const [overviewRange, setOverviewRange] = useState<ActivityFocusRange | undefined>()

  function clearOverviewSelection() {
    setOverviewRange(undefined)
    onSelectDay(undefined)
  }

  function selectOverviewDay(day?: ActivityDaySummary) {
    if (!day) {
      clearOverviewSelection()
      return
    }

    if (!overviewRange && selectedDay?.day === day.day) {
      clearOverviewSelection()
      return
    }

    setOverviewRange(undefined)
    onSelectDay(day)
  }

  function selectOverviewRange(range: ActivityFocusRange) {
    if (range.start === range.end) {
      const day = data?.days.find(item => item.day === range.start)
      selectOverviewDay(day)
      return
    }

    onSelectDay(undefined)
    setOverviewRange(range)
  }

  function openTimeline(day?: ActivityDaySummary, range?: ActivityFocusRange) {
    if (day) {
      setTimelineFocusDay(day.day)
      setTimelineFocusRange(undefined)
    } else if (range) {
      setTimelineFocusDay(undefined)
      setTimelineFocusRange(range)
    } else {
      setTimelineFocusDay(undefined)
      setTimelineFocusRange(undefined)
    }
    setTab('timeline')
  }

  async function handleOpenEntryPath(entry: ActivityEntry) {
    if (entry.source === 'ai') {
      const platform = typeof entry.meta?.platform === 'string' ? entry.meta.platform : ''
      const sessionKey = typeof entry.meta?.sessionKey === 'string' ? entry.meta.sessionKey : ''

      if (platform && sessionKey) {
        if (!centerPanelVisible) {
          await toggleCenterPanel()
        }
        await setActiveFilePath(MEMORY_TAB_PATH)
        requestOpenMemorySession({
          platform: platform as 'claude' | 'codex' | 'opencode' | 'lingmo',
          sessionKey,
        })
        onEntryPathOpen?.()
        return
      }
    }

    if (!entry.path) return

    if (entry.source === 'writing' || /\.(md|markdown|txt)$/i.test(entry.path)) {
      await setLeftSidebarTab('files')
      await setActiveFilePath(entry.path)
      onEntryPathOpen?.()
      return
    }

    try {
      const { openPath } = await import('@tauri-apps/plugin-opener')
      await openPath(entry.path)
      onEntryPathOpen?.()
    } catch (error) {
      console.error('Failed to open activity path:', error)
    }
  }

  async function handleOpenGeneratedFile(filePath: string) {
    await loadFileTree({ skipRemoteSync: true })
    await setLeftSidebarTab('files')
    await setActiveFilePath(filePath)
    onEntryPathOpen?.()
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', mode === 'page' ? 'gap-5' : 'gap-4')}>
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CalendarDays className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">活跃度中心</h2>
              <p className="text-xs text-muted-foreground">活动、AI 交互、记忆沉淀与同步状态</p>
            </div>
          </div>
        </div>
        {onRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden h-8 w-8 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新活跃度数据"
            title="刷新"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as ActivityTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <TabsList className="h-10 min-w-0 flex-1 justify-start overflow-x-auto rounded-lg bg-muted/70 p-1">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />总览</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5"><Activity className="h-3.5 w-3.5" />时间线</TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />AI交互</TabsTrigger>
          <TabsTrigger value="memory" className="gap-1.5"><Brain className="h-3.5 w-3.5" />记忆</TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5"><CloudSync className="h-3.5 w-3.5" />同步</TabsTrigger>
          </TabsList>
          {onRefresh ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onRefresh}
              disabled={loading}
              aria-label="刷新活跃度数据"
              title="刷新"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <TabsContent value="overview" className="mt-4">
            <OverviewTab
              data={data}
              selectedDay={selectedDay}
              selectedRange={overviewRange}
              onSelectDay={selectOverviewDay}
              onSelectRange={selectOverviewRange}
              onClearSelection={clearOverviewSelection}
              onOpenEntryPath={handleOpenEntryPath}
              onOpenTimeline={openTimeline}
              onTabChange={setTab}
            />
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <TimelineTab
              data={data}
              source={source}
              onSourceChange={setSource}
              onOpenEntryPath={handleOpenEntryPath}
              focusDay={timelineFocusDay}
              focusRange={timelineFocusRange}
            />
          </TabsContent>

          <TabsContent value="ai" className="mt-4">
            <AiInteractionTab data={data} onOpenEntryPath={handleOpenEntryPath} />
          </TabsContent>

          <TabsContent value="memory" className="mt-4">
            <MemorySnapshot data={data} />
          </TabsContent>

          <TabsContent value="sync" className="mt-4">
            <SyncHealthPanel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
