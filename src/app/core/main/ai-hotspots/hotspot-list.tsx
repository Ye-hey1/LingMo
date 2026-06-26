'use client'

import { Archive, Bookmark, CheckCheck, ChevronDown, LayoutGrid, Loader2, Newspaper, Rows3, SearchX, Star, Tag, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { HotspotItem } from './hotspot-item'
import type { HotspotViewMode } from './hotspot-filter-bar'
import { formatHotspotTime } from './hotspot-utils'
import { cn } from '@/lib/utils'

interface HotspotListProps {
  activeTopicLabel?: string
  items: AiHotspotItem[]
  isLoading: boolean
  isRefreshing: boolean
  hasCachedItems: boolean
  hasActiveFilters: boolean
  emptyTitle?: string
  emptyDescription?: string
  refreshMessage?: string
  query?: string
  totalCount?: number
  selectedItemId?: string | null
  selectedItemIds?: string[]
  trashMode?: boolean
  hasMore?: boolean
  showFeaturedTrends?: boolean
  viewMode?: HotspotViewMode
  onBatchDelete?: (ids: string[]) => void
  onBatchFavorite?: (ids: string[]) => void
  onBatchMarkRead?: (ids: string[]) => void
  onBatchSaveSnapshot?: (ids: string[]) => void
  onClearTopic?: () => void
  onClearSelection?: () => void
  onCheckedChange?: (id: string, checked: boolean) => void
  onRefresh: () => void
  onLoadMore?: () => void
  onSelectItem?: (id: string) => void
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveSnapshot: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
  onAddToDigest: (id: string) => void
  onIgnore: (id: string, ignored: boolean) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onGenerateInsight: (id: string) => void
}

function getItemTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function formatTrendTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  if (!value) return '时间未知'
  return formatHotspotTime(value)
}

function FeaturedTrendPanel({ items, onSelectItem }: { items: AiHotspotItem[]; onSelectItem?: (id: string) => void }) {
  const trends = items
    .slice()
    .sort((left, right) => getItemTime(right) - getItemTime(left))
    .slice(0, 5)

  if (trends.length === 0) return null

  const handleOpen = (item: AiHotspotItem) => {
    if (onSelectItem) {
      onSelectItem(item.id)
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="text-base" aria-hidden="true">🔥</span>
          当前热点
        </div>
        <div className="text-xs text-muted-foreground">来自 AI HOT 精选，点击在应用内阅读</div>
      </div>
      <div className="space-y-0.5">
        {trends.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleOpen(item)}
            className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className={cn(
              'text-xs font-semibold tabular-nums',
              index === 0 ? 'text-rose-500' : index === 1 ? 'text-amber-600' : index === 2 ? 'text-sky-600' : 'text-muted-foreground/60',
            )}>
              {index + 1}
            </span>
            <span className="truncate font-medium text-foreground">{item.title}</span>
            <span className="hidden text-xs text-muted-foreground/80 sm:inline">
              {item.sourceName} · {formatTrendTime(item)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function HotspotList({
  activeTopicLabel,
  items,
  isLoading,
  isRefreshing,
  hasCachedItems,
  hasActiveFilters,
  emptyTitle,
  emptyDescription,
  refreshMessage,
  query,
  totalCount,
  selectedItemId,
  selectedItemIds = [],
  trashMode,
  hasMore,
  showFeaturedTrends,
  viewMode = 'list',
  onBatchDelete,
  onBatchFavorite,
  onBatchMarkRead,
  onBatchSaveSnapshot,
  onClearTopic,
  onClearSelection,
  onCheckedChange,
  onRefresh,
  onLoadMore,
  onSelectItem,
  onToggleFavorite,
  onMarkRead,
  onSaveSnapshot,
  onSendToChat,
  onDeepDive,
  onAddToDigest,
  onIgnore,
  onDelete,
  onRestore,
  onGenerateInsight,
}: HotspotListProps) {
  const selectedSet = new Set(selectedItemIds)
  const selectedCount = selectedItemIds.length

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-4 w-full max-w-xl rounded bg-muted" />
                <div className="h-3 w-4/5 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取本地 AI 热点缓存
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    const resolvedTitle = emptyTitle || (hasCachedItems && hasActiveFilters ? '没有匹配的热点' : '暂无 AI 热点缓存')
    const resolvedDescription = emptyDescription || (hasCachedItems && hasActiveFilters
      ? '调整搜索、来源或状态筛选后再看看。'
      : isRefreshing
        ? refreshMessage || '正在聚合默认来源和用户 RSS。'
        : '点击刷新后会从默认来源和用户 RSS 中聚合最新动态。')

    return (
      <div className="flex h-[360px] flex-col items-center justify-center rounded-lg border border-border bg-card px-4 text-center">
        {hasCachedItems && hasActiveFilters ? (
          <SearchX className="mb-3 size-10 text-muted-foreground/60" />
        ) : (
          <Newspaper className="mb-3 size-10 text-muted-foreground/60" />
        )}
        <div className="text-sm font-medium text-foreground">{resolvedTitle}</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{resolvedDescription}</div>
        {!hasCachedItems && !isRefreshing ? (
          <Button variant="outline" size="sm" className="mt-3 h-8 rounded-md text-xs shadow-none" onClick={onRefresh}>
            立即刷新
          </Button>
        ) : null}
      </div>
    )
  }

  const selectable = Boolean(onCheckedChange)

  return (
    <div className="relative space-y-3 pb-16">
      {showFeaturedTrends ? (
        <FeaturedTrendPanel items={items} onSelectItem={onSelectItem} />
      ) : null}

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {viewMode === 'grid' ? <LayoutGrid className="size-3.5" /> : <Rows3 className="size-3.5" />}
          <span className="rounded bg-muted px-2 py-1 text-foreground/80">
            {viewMode === 'grid' ? '卡片视图' : '列表视图'}
          </span>
          <span className="whitespace-nowrap">
            显示 {items.length} 条
            {typeof totalCount === 'number' && totalCount !== items.length ? ` / ${totalCount} 条` : ''}
          </span>
          {activeTopicLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded bg-primary/10 px-2 py-1 text-primary">
              <Tag className="size-3.5 shrink-0" />
              <span className="truncate">{activeTopicLabel}</span>
              <button
                type="button"
                className="ml-0.5 rounded-sm text-primary hover:bg-primary/20"
                aria-label="清除分类"
                onClick={onClearTopic}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Newspaper className="size-3.5" />
          <span>按日期与热度排序</span>
        </div>
      </div>

      {isRefreshing ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>{refreshMessage || '正在后台刷新，当前缓存可继续阅读。'}</span>
        </div>
      ) : null}

      <div className={cn(viewMode === 'grid' ? 'grid gap-4 xl:grid-cols-2 2xl:grid-cols-3' : 'space-y-3')}>
        {items.map((item, index) => (
          <HotspotItem
            key={item.id}
            featured={index === 0}
            item={item}
            query={query}
            selected={selectedItemId === item.id}
            selectable={selectable}
            checked={selectedSet.has(item.id)}
            trashMode={trashMode}
            viewMode={viewMode}
            onCheckedChange={onCheckedChange}
            onSelect={onSelectItem}
            onToggleFavorite={onToggleFavorite}
            onMarkRead={onMarkRead}
            onSaveSnapshot={onSaveSnapshot}
            onSendToChat={onSendToChat}
            onDeepDive={onDeepDive}
            onAddToDigest={onAddToDigest}
            onIgnore={onIgnore}
            onDelete={onDelete}
            onRestore={onRestore}
            onGenerateInsight={onGenerateInsight}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            onClick={onLoadMore}
          >
            <span>加载更多</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="sticky bottom-3 z-20 flex min-h-12 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg shadow-black/5">
          <Archive className="size-4 text-primary" />
          <span className="text-foreground">已选择 {selectedCount} 条信号</span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-md px-2 text-xs shadow-none hover:bg-muted" onClick={() => onBatchMarkRead?.(selectedItemIds)}>
              <CheckCheck className="size-3.5" />
              批量标记已读
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-md px-2 text-xs shadow-none hover:bg-muted" onClick={() => onBatchFavorite?.(selectedItemIds)}>
              <Star className="size-3.5" />
              批量收藏
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-md px-2 text-xs shadow-none hover:bg-muted" onClick={() => onBatchSaveSnapshot?.(selectedItemIds)}>
              <Bookmark className="size-3.5" />
              批量沉淀
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-md px-2 text-xs text-destructive shadow-none hover:bg-destructive/10" onClick={() => onBatchDelete?.(selectedItemIds)}>
              <Trash2 className="size-3.5" />
              批量删除
            </Button>
            <Button variant="ghost" size="icon" className="size-8 rounded-md text-muted-foreground shadow-none hover:bg-muted" title="清除选择" onClick={onClearSelection}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
