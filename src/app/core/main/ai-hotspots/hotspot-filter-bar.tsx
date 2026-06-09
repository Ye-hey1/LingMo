'use client'

import { Search, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AiHotspotFilters, AiHotspotItem, AiHotspotSourceStatus } from '@/lib/ai-hotspots'
import { buildSourceOptions } from './hotspot-utils'
import { cn } from '@/lib/utils'

type TopicOption = {
  key: string
  label: string
  count: number
}

interface HotspotFilterBarProps {
  filters: AiHotspotFilters
  items: AiHotspotItem[]
  sources: AiHotspotSourceStatus[]
  activeTopic?: string
  onFiltersChange: (patch: Partial<AiHotspotFilters>) => void
  onTopicChange?: (topic: string) => void
  topicTotalCount?: number
  topicOptions?: TopicOption[]
}

export function HotspotFilterBar({
  activeTopic = 'all',
  filters,
  items,
  onFiltersChange,
  onTopicChange,
  sources,
  topicTotalCount,
  topicOptions = [],
}: HotspotFilterBarProps) {
  const sourceOptions = buildSourceOptions(items, sources)
  const allTopicCount = topicTotalCount ?? items.length
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.status !== 'all' ||
    activeTopic !== 'all',
  )

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b bg-background px-3 py-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            placeholder="搜索标题、来源、标签"
            className="h-8 border-0 bg-muted/60 pl-9 pr-3 text-sm shadow-none focus-visible:ring-1"
            onChange={(event) => onFiltersChange({ query: event.target.value })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.timeRange} onValueChange={(value) => onFiltersChange({ timeRange: value as AiHotspotFilters['timeRange'] })}>
            <SelectTrigger className="h-8 w-[92px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24 小时</SelectItem>
              <SelectItem value="7d">7 天</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.sourceId} onValueChange={(value) => onFiltersChange({ sourceId: value })}>
            <SelectTrigger className="h-8 w-[128px] text-xs">
              <SelectValue placeholder="来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {sourceOptions.map(source => (
                <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(value) => onFiltersChange({ status: value as AiHotspotFilters['status'] })}>
            <SelectTrigger className="h-8 w-[112px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="unread">未读</SelectItem>
              <SelectItem value="favorite">收藏</SelectItem>
              <SelectItem value="saved">已保存</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!hasActiveFilters}
            title="清除筛选"
            onClick={() => {
              onFiltersChange({ query: '', timeRange: '24h', sourceId: 'all', status: 'all' })
              onTopicChange?.('all')
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {topicOptions.length > 0 && onTopicChange ? (
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
          <div className="mr-1 hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <Tag className="size-3.5" />
            分类
          </div>
          <button
            type="button"
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
              activeTopic === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onTopicChange('all')}
          >
            全部
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
              activeTopic === 'all' ? 'bg-background/15 text-background' : 'bg-background text-muted-foreground',
            )}>
              {allTopicCount}
            </span>
          </button>
          {topicOptions.map(topic => (
            <button
              key={topic.key}
              type="button"
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
                activeTopic === topic.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => onTopicChange(topic.key)}
            >
              {topic.label}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                activeTopic === topic.key ? 'bg-background/15 text-background' : 'bg-background text-muted-foreground',
              )}>
                {topic.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
