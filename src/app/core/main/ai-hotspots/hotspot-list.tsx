'use client'

import { Archive, Bookmark, CheckCheck, ChevronDown, Loader2, Newspaper, SearchX, Star, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { HotspotItem } from './hotspot-item'
import type { HotspotViewMode } from './hotspot-filter-bar'
import { cn } from '@/lib/utils'

interface HotspotListProps {
  items: AiHotspotItem[]
  isLoading: boolean
  isRefreshing: boolean
  hasCachedItems: boolean
  hasActiveFilters: boolean
  emptyTitle?: string
  emptyDescription?: string
  refreshMessage?: string
  query?: string
  selectedItemId?: string | null
  selectedItemIds?: string[]
  trashMode?: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  viewMode?: HotspotViewMode
  onBatchDelete?: (ids: string[]) => void
  onBatchFavorite?: (ids: string[]) => void
  onBatchMarkRead?: (ids: string[]) => void
  onBatchSaveSnapshot?: (ids: string[]) => void
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

export function HotspotList({
  items,
  isLoading,
  isRefreshing,
  hasCachedItems,
  hasActiveFilters,
  emptyTitle,
  emptyDescription,
  refreshMessage,
  query,
  selectedItemId,
  selectedItemIds = [],
  trashMode,
  hasMore,
  isLoadingMore = false,
  viewMode = 'list',
  onBatchDelete,
  onBatchFavorite,
  onBatchMarkRead,
  onBatchSaveSnapshot,
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
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-md border border-border/70 bg-card/80 p-4">
            <div className="flex items-start gap-3">
              <div className="ai-hotspots-skeleton size-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="ai-hotspots-skeleton h-3 w-32 rounded" />
                <div className="ai-hotspots-skeleton h-4 w-full max-w-xl rounded" />
                <div className="ai-hotspots-skeleton h-3 w-4/5 rounded" />
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
      <div className="flex min-h-[390px] flex-col items-center justify-center overflow-hidden rounded-md border border-dashed border-border/80 bg-background/70 px-4 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
          {hasCachedItems && hasActiveFilters ? (
            <SearchX className="size-7" />
          ) : (
            <Newspaper className="size-7" />
          )}
        </div>
        <div className="text-base font-semibold text-foreground">{resolvedTitle}</div>
        <div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{resolvedDescription}</div>
        {!hasCachedItems && !isRefreshing ? (
          <Button variant="outline" size="sm" className="mt-4 h-8 rounded-md text-xs shadow-none active:scale-[0.98]" onClick={onRefresh}>
            立即刷新
          </Button>
        ) : null}
      </div>
    )
  }

  const selectable = Boolean(onCheckedChange)

  return (
    <div className="relative space-y-4 pb-16">
      {isRefreshing ? (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--hotspot-accent)/0.28)] bg-[hsl(var(--hotspot-accent)/0.08)] px-3 py-2 text-sm text-[hsl(var(--hotspot-accent-foreground))] dark:text-[hsl(var(--hotspot-accent))]">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>{refreshMessage || '正在后台刷新，当前缓存可继续阅读。'}</span>
        </div>
      ) : null}

      <div className={cn(
        viewMode === 'grid'
          ? 'grid gap-4 xl:grid-cols-2 2xl:grid-cols-3'
          : viewMode === 'headline'
            ? 'space-y-0.5'
            : 'space-y-1.5',
      )}>
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
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
            <span>{isLoadingMore ? '加载中' : '加载更多'}</span>
          </Button>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="sticky bottom-3 z-20 flex min-h-12 items-center gap-2 rounded-md border border-border/80 bg-card/95 px-3 py-2 text-sm shadow-xl shadow-black/10 backdrop-blur">
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
