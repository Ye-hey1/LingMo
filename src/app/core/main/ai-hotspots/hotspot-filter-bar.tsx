'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FilterX,
  Grid3X3,
  LayoutList,
  Loader2,
  Menu,
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

export type HotspotViewMode = 'list' | 'grid' | 'headline'

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
    const name = String(item.sourceName || item.feedName || '').trim()
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
  const queryValue = String(filters.query || '')
  const hasSearch = queryValue.trim().length > 0
  const hasActiveFilters = Boolean(
    queryValue.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.feedName !== 'all' ||
    filters.status !== 'all' ||
    activeTopic !== 'all',
  )

  return (
    <div className="ai-hotspots-filter-bar shrink-0 border-b border-border/70">
      {/* 第一行：搜索框 + 工具按钮 */}
      <div className="flex items-center gap-2 px-3 py-2.5 lg:px-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={queryValue}
            placeholder="搜索标题、摘要、来源或标签"
            className="h-9 w-full rounded-md border border-input/80 bg-background/75 pl-8 pr-7 text-sm text-foreground shadow-sm shadow-black/0 transition-all duration-200 placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-foreground/10"
            onChange={(e) => onFiltersChange({ query: e.target.value })}
          />
          {hasSearch && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="清除搜索"
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
            className="h-9 gap-1 rounded-md px-2 text-xs text-muted-foreground shadow-none hover:bg-muted/80 active:scale-[0.98]"
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
        <div className="flex h-9 items-center rounded-md border border-input/80 bg-background/70 p-0.5">
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-95',
              viewMode === 'list' ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onViewModeChange?.('list')}
            title="列表视图"
          >
            <LayoutList className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-95',
              viewMode === 'grid' ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onViewModeChange?.('grid')}
            title="卡片视图"
          >
            <Grid3X3 className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-95',
              viewMode === 'headline' ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onViewModeChange?.('headline')}
            title="标题视图"
          >
            <Menu className="size-3.5" />
          </button>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* 刷新按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-md text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground active:scale-[0.98]"
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
          className="size-9 rounded-md text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground active:scale-[0.98]"
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
            className="size-9 rounded-md text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground active:scale-[0.98]"
            title="关闭"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </Button>
        )}
      </div>

      {/* 第二行：分类标签 */}
      {onTopicChange && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-3 pb-2 lg:px-4">
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]',
              activeTopic === 'all'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
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
                'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]',
                activeTopic === topic.key
                  ? 'bg-foreground text-background'
                  : 'bg-background/60 text-muted-foreground ring-1 ring-border/60 hover:bg-muted/80 hover:text-foreground',
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
      <div className="border-t border-border/60 px-3 py-1.5 lg:px-4">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-0.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
                  'rounded-md border px-2 py-1 text-[11px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]',
                  filters.feedName === source.name
                    ? 'border-foreground/24 bg-foreground text-background'
                    : 'border-border/70 bg-background/55 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
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
