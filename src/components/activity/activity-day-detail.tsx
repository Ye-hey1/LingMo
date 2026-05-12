'use client'

import { ExternalLink } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { ActivityDaySummary, ActivityEntry, ActivityViewSource } from '@/lib/activity/types'

interface ActivityDayDetailProps {
  day?: ActivityDaySummary
  compact?: boolean
  onOpenEntryPath?: (entry: ActivityEntry) => void
  summarySource?: ActivityViewSource | 'all'
  labels: {
    empty: string
    records: string
    writing: string
    chats: string
    ai: string
    memory: string
  }
}

function getPathLabel(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || path
}

const badgeClassMap = {
  record: 'border-rose-200/70 bg-rose-50/75 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-200',
  writing: 'border-emerald-200/70 bg-emerald-50/75 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200',
  chat: 'border-sky-200/70 bg-sky-50/75 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-200',
  ai: 'border-violet-200/70 bg-violet-50/75 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-200',
  memory: 'border-amber-200/80 bg-amber-50/75 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200',
  platform: 'border-slate-200/70 bg-slate-50/75 text-slate-600 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-300',
} as const

function getAiPlatformLabel(entry: ActivityEntry) {
  const platform = typeof entry.meta?.platform === 'string' ? entry.meta.platform : ''
  if (platform === 'codex') return 'Codex'
  if (platform === 'claude') return 'Claude'
  if (platform === 'opencode') return 'OpenCode'
  if (platform === 'lingmo') return 'LingMo'
  return ''
}

function canOpenEntryAction(entry: ActivityEntry) {
  if (entry.source === 'ai') {
    return typeof entry.meta?.platform === 'string' && typeof entry.meta?.sessionKey === 'string'
  }

  return Boolean(entry.path)
}

function getEntryActionLabel(entry: ActivityEntry) {
  if (entry.source === 'ai') {
    const platformLabel = getAiPlatformLabel(entry)
    return platformLabel ? `在记忆管理中打开 ${platformLabel} 会话` : '在记忆管理中打开会话'
  }

  return entry.path ? `打开 ${getPathLabel(entry.path)}` : '打开'
}

function getSourceLabel(source: ActivityEntry['source'], labels: ActivityDayDetailProps['labels']) {
  return {
    record: labels.records,
    chat: labels.chats,
    writing: labels.writing,
    ai: labels.ai,
    memory: labels.memory,
  }[source]
}

function renderSourceBadge(entry: ActivityEntry, labels: ActivityDayDetailProps['labels']) {
  const label = getSourceLabel(entry.source, labels)

  return (
    <Badge
      variant="outline"
      className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 font-medium shadow-none ${badgeClassMap[entry.source]}`}
    >
      {label}
    </Badge>
  )
}

function renderSummaryBadges(
  day: ActivityDaySummary,
  labels: ActivityDayDetailProps['labels'],
  summarySource: ActivityViewSource | 'all',
) {
  const summaryItems = [
    { key: 'record', label: labels.records, value: day.counts.record },
    { key: 'writing', label: labels.writing, value: day.counts.writing },
    { key: 'chat', label: labels.chats, value: day.counts.chat },
    { key: 'ai', label: labels.ai, value: day.counts.ai },
    { key: 'memory', label: labels.memory, value: day.counts.memory },
  ] as const

  const visibleItems =
    summarySource === 'all' ? summaryItems : summaryItems.filter((item) => item.key === summarySource)

  return visibleItems.map((item) => (
    <Badge
      key={item.key}
      variant="outline"
      className={`rounded-md border px-2.5 font-medium shadow-none ${badgeClassMap[item.key]}`}
    >
      {item.label}: {item.value}
    </Badge>
  ))
}

function formatEntryBucket(timestamp: number) {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = date.getMinutes() >= 30 ? '30' : '00'
  return `${hours}:${minutes}`
}

function formatEntryTime(timestamp: number) {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function normalizeText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function getEntryBodyText(entry: ActivityEntry) {
  if (entry.source === 'writing') {
    return normalizeText(entry.title || entry.path || entry.description)
  }

  if (entry.source === 'ai' || entry.source === 'memory') {
    return normalizeText(entry.description || entry.title)
  }

  return normalizeText(entry.description || entry.title)
}

function getWritingMergeKey(entry: ActivityEntry) {
  return normalizeText(entry.path || entry.title || entry.description)
}

function dedupeGroupEntries(entries: ActivityEntry[]) {
  const dedupedEntries: ActivityEntry[] = []
  const writingKeys = new Set<string>()

  for (const entry of entries) {
    if (entry.source !== 'writing') {
      dedupedEntries.push(entry)
      continue
    }

    const mergeKey = getWritingMergeKey(entry)
    if (writingKeys.has(mergeKey)) {
      continue
    }

    writingKeys.add(mergeKey)
    dedupedEntries.push(entry)
  }

  return dedupedEntries
}

function groupEntriesByBucket(entries: ActivityEntry[]) {
  const groups = new Map<string, ActivityEntry[]>()

  for (const entry of entries) {
    const bucket = formatEntryBucket(entry.timestamp)
    const nextEntries = groups.get(bucket) || []
    nextEntries.push(entry)
    groups.set(bucket, nextEntries)
  }

  return Array.from(groups.entries()).map(([bucket, groupEntries]) => ({
    bucket,
    entries: dedupeGroupEntries(groupEntries),
  }))
}

export function ActivityDayDetail({
  day,
  compact = false,
  onOpenEntryPath,
  summarySource = 'all',
  labels,
}: ActivityDayDetailProps) {
  const hourGroups = day ? groupEntriesByBucket(day.entries) : []
  const hasEntries = hourGroups.some(group => group.entries.length > 0)

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{day?.day || new Date().toISOString().slice(0, 10)}</h3>
        {day ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {renderSummaryBadges(day, labels, summarySource)}
          </div>
        ) : null}
      </div>
      <div className="space-y-1">
        {!day || !hasEntries ? (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        ) : null}
      </div>
      {day && hasEntries ? (
        <div className="space-y-3">
          <div className="space-y-3">
            {hourGroups.map((group) => (
              <div key={group.bucket} className="grid grid-cols-[max-content_0.875rem_minmax(0,1fr)] gap-2">
                <div className="pt-1 pr-0.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                  <span className="block whitespace-nowrap">{group.bucket}</span>
                </div>
                <div className="relative flex justify-center">
                  <div className="absolute inset-y-0 w-px bg-border/70" />
                  <div className="absolute top-2 size-2.5 rounded-full border border-background bg-primary shadow-sm" />
                </div>
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={compact ? 'rounded-xl bg-muted/35 px-3 py-2.5' : 'rounded-xl border border-border/60 p-3'}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          {renderSourceBadge(entry, labels)}
                          {entry.source === 'ai' && getAiPlatformLabel(entry) ? (
                            <Badge
                              variant="outline"
                              className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 font-medium shadow-none ${badgeClassMap.platform}`}
                            >
                              {getAiPlatformLabel(entry)}
                            </Badge>
                          ) : null}
                          <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                            {formatEntryTime(entry.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-6">
                            {getEntryBodyText(entry)}
                          </p>
                          {canOpenEntryAction(entry) && onOpenEntryPath ? (
                            <button
                              type="button"
                              className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-primary shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                              title={getEntryActionLabel(entry)}
                              aria-label={getEntryActionLabel(entry)}
                              onClick={() => onOpenEntryPath(entry)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
