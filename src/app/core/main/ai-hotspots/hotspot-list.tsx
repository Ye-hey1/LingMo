'use client'

import { Loader2, Newspaper, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { HotspotItem } from './hotspot-item'

interface HotspotListProps {
  items: AiHotspotItem[]
  isLoading: boolean
  isRefreshing: boolean
  hasCachedItems: boolean
  hasActiveFilters: boolean
  emptyTitle?: string
  emptyDescription?: string
  refreshMessage?: string
  onRefresh: () => void
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveAsNote: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
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
  onRefresh,
  onToggleFavorite,
  onMarkRead,
  onSaveAsNote,
  onSendToChat,
  onDeepDive,
}: HotspotListProps) {
  if (isLoading) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-md border bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在读取本地 AI 热点缓存
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
      {isRefreshing ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>{refreshMessage || '正在后台刷新，当前缓存可继续阅读。'}</span>
        </div>
      ) : null}

      {items.map(item => (
        <HotspotItem
          key={item.id}
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
