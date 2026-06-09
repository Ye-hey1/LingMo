'use client'

import { Search, X } from 'lucide-react'
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

interface HotspotFilterBarProps {
  filters: AiHotspotFilters
  items: AiHotspotItem[]
  sources: AiHotspotSourceStatus[]
  onFiltersChange: (patch: Partial<AiHotspotFilters>) => void
}

export function HotspotFilterBar({
  filters,
  items,
  sources,
  onFiltersChange,
}: HotspotFilterBarProps) {
  const sourceOptions = buildSourceOptions(items, sources)
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.status !== 'all',
  )

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b bg-background px-3 py-2 lg:flex-row lg:items-center">
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
          onClick={() => onFiltersChange({ query: '', timeRange: '24h', sourceId: 'all', status: 'all' })}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
