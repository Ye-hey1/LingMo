'use client'

import { Loader2, Newspaper, SearchX, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { HotspotItem } from './hotspot-item'

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
  totalCount?: number
  onClearTopic?: () => void
  onRefresh: () => void
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveAsNote: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
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
  totalCount,
  onClearTopic,
  onRefresh,
  onToggleFavorite,
  onMarkRead,
  onSaveAsNote,
  onSendToChat,
  onDeepDive,
}: HotspotListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-md border bg-background p-3">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-md bg-muted" />
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
      <div className="flex h-[360px] flex-col items-center justify-center rounded-md border bg-background px-4 text-center">
        {hasCachedItems && hasActiveFilters ? (
          <SearchX className="mb-3 size-10 text-muted-foreground" />
        ) : (
          <Newspaper className="mb-3 size-10 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">{resolvedTitle}</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{resolvedDescription}</div>
        {!hasCachedItems && !isRefreshing ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRefresh}>
            立即刷新
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Newspaper className="size-3.5" />
          <span className="whitespace-nowrap">
            显示 {items.length} 条
            {typeof totalCount === 'number' && totalCount !== items.length ? ` / ${totalCount} 条` : ''}
          </span>
          {activeTopicLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
              <Tag className="size-3.5 shrink-0" />
              <span className="truncate">{activeTopicLabel}</span>
              <button
                type="button"
                className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="清除分类"
                onClick={onClearTopic}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          按日期与热度排序
        </div>
      </div>

      {isRefreshing ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>{refreshMessage || '正在后台刷新，当前缓存可继续阅读。'}</span>
        </div>
      ) : null}

      {items.map((item, index) => (
        <HotspotItem
          key={item.id}
          featured={index === 0}
          item={item}
          onToggleFavorite={onToggleFavorite}
          onMarkRead={onMarkRead}
          onSaveAsNote={onSaveAsNote}
          onSendToChat={onSendToChat}
          onDeepDive={onDeepDive}
        />
      ))}
    </div>
  )
}
