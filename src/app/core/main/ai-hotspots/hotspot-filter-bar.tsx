'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FilterX,
  Grid3X3,
  LayoutList,
  Loader2,
  PanelRightClose,
  RefreshCcw,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AiHotspotFilters, AiHotspotItem, AiHotspotSourceStatus } from '@/lib/ai-hotspots'

type TopicOption = {
  key: string
  label: string
  count: number
}

export type HotspotViewMode = 'list' | 'grid'

interface HotspotFilterBarProps {
  filters: AiHotspotFilters
  items: AiHotspotItem[]
  sources: AiHotspotSourceStatus[]
  activeTopic?: string
  isRefreshing?: boolean
  viewMode?: HotspotViewMode
  topicTotalCount?: number
  topicOptions?: TopicOption[]
  onFiltersChange: (patch: Partial<AiHotspotFilters>) => void
  onClose?: () => void
  onOpenSettings?: () => void
  onRefresh?: () => void
  onTopicChange?: (topic: string) => void
  onViewModeChange?: (mode: HotspotViewMode) => void
}

function buildSourceOptions(items: AiHotspotItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.deletedAt || item.isIgnored) continue
    const name = (item.sourceName || item.feedName).trim()
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
}

export function HotspotFilterBar({
  activeTopic = 'all',
  filters,
  items,
  isRefreshing,
  viewMode = 'list',
  topicTotalCount,
  topicOptions = [],
  onFiltersChange,
  onClose,
  onOpenSettings,
  onRefresh,
  onTopicChange,
  onViewModeChange,
}: HotspotFilterBarProps) {
  const allTopicCount = topicTotalCount ?? items.length
  const sourceOptions = buildSourceOptions(items)
  const [showSources, setShowSources] = useState(false)
  const hasSearch = filters.query.trim().length > 0
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.feedName !== 'all' ||
    filters.status !== 'all' ||
    activeTopic !== 'all',
  )

  return (
    <div className="shrink-0 border-b border-border bg-background">
      {/* 第一行：搜索框 + 工具按钮 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={filters.query}
            placeholder="搜索资讯标题、来源..."
            className="h-8 w-full rounded-md border border-input bg-muted/50 pl-8 pr-7 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
            onChange={(e) => onFiltersChange({ query: e.target.value })}
          />
          {hasSearch && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => onFiltersChange({ query: '' })}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* 清除筛选 */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 rounded-md px-2 text-xs text-muted-foreground shadow-none hover:bg-muted"
            onClick={() => {
              onFiltersChange({ query: '', timeRange: '24h', sourceId: 'all', feedName: 'all', status: 'all' })
              onTopicChange?.('all')
            }}
          >
            <FilterX className="size-3.5" />
            清除
          </Button>
        )}

        {/* 视图切换 */}
        <div className="flex items-center rounded-md border border-input p-0.5">
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-colors',
              viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={() => onViewModeChange?.('list')}
            title="列表视图"
          >
            <LayoutList className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-colors',
              viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={() => onViewModeChange?.('grid')}
            title="卡片视图"
          >
            <Grid3X3 className="size-3.5" />
          </button>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* 刷新按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
          disabled={isRefreshing}
          title="刷新"
          onClick={onRefresh}
        >
          {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
        </Button>

        {/* 设置按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
          title="设置"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
        </Button>

        {/* 关闭按钮 */}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-md text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            title="关闭"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </Button>
        )}
      </div>

      {/* 第二行：分类标签 */}
      {onTopicChange && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-3 pb-2">
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              activeTopic === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={() => onTopicChange('all')}
          >
            全部
            <span className="ml-1 opacity-70">{allTopicCount}</span>
          </button>
          {topicOptions.map(topic => (
            <button
              key={topic.key}
              type="button"
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                activeTopic === topic.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => onTopicChange(topic.key)}
            >
              {topic.label}
              <span className="ml-1 opacity-70">{topic.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 第三行：订阅源筛选 */}
      <div className="border-t border-border px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowSources(!showSources)}
        >
          订阅源筛选
          {showSources ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          <span className="text-muted-foreground/50">({sourceOptions.length})</span>
        </button>

        {showSources && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {sourceOptions.map(source => (
              <button
                key={source.name}
                type="button"
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  filters.feedName === source.name
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => onFiltersChange({
                  feedName: filters.feedName === source.name ? 'all' : source.name,
                })}
              >
                {source.name}
                <span className="ml-0.5 text-muted-foreground/50">{source.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
