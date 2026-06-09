'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Clipboard,
  Copy,
  FileText,
  Heart,
  Loader2,
  Newspaper,
  RefreshCcw,
  Rss,
  Settings,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotSourceStatus, AiHotspotView } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'
import { useAiHotspotsStore } from '@/stores/ai-hotspots'
import { HotspotFilterBar } from './hotspot-filter-bar'
import { HotspotList } from './hotspot-list'
import { getSourceHealthText } from './hotspot-utils'

type DigestScope = 'current' | '24h' | '7d' | 'favorites' | 'unread'

function formatRefreshTime(value: string | null) {
  if (!value) return '尚未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刷新时间未知'
  return `上次刷新 ${date.toLocaleString()}`
}

function formatStatusTime(value: string | null) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString()
}

function ViewPill({
  active,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-150',
        active
          ? 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      title={label}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function Metric({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function SourceStatusView({
  sources,
  userFeedCount,
  onRefresh,
}: {
  sources: AiHotspotSourceStatus[]
  userFeedCount: number
  onRefresh: () => void
}) {
  const okCount = sources.filter(source => source.ok).length
  const failedCount = sources.length - okCount

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="来源" value={sources.length} />
        <Metric label="可用" value={okCount} />
        <Metric label="失败" value={failedCount} />
        <Metric label="用户 RSS" value={userFeedCount} />
      </div>

      {sources.length === 0 ? (
        <div className="flex h-[320px] flex-col items-center justify-center rounded-md border bg-background text-center">
          <Rss className="mb-3 size-10 text-muted-foreground" />
          <div className="text-sm font-medium">暂无来源状态</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRefresh}>
            立即刷新
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          {sources.map(source => (
            <div key={source.sourceId} className="border-b px-3 py-2 last:border-b-0">
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className={cn(
                    'mt-1 size-2 shrink-0 rounded-full',
                    source.ok ? 'bg-emerald-500' : 'bg-destructive',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{source.sourceName}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {source.kind}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {source.itemCount} 条
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{source.ok ? '正常' : '失败'}</span>
                    <span>{Math.round(source.durationMs)}ms</span>
                    <span>最近成功 {formatStatusTime(source.lastOkAt)}</span>
                    <span>更新 {formatStatusTime(source.updatedAt)}</span>
                  </div>
                  {!source.ok && source.lastError ? (
                    <div className="mt-1 line-clamp-2 text-xs text-destructive">
                      {source.lastError}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DigestView({
  currentCount,
  favoriteCount,
  unreadCount,
  markdown,
  isGenerating,
  onGenerate,
  onCopy,
}: {
  currentCount: number
  favoriteCount: number
  unreadCount: number
  markdown: string
  isGenerating: boolean
  onGenerate: (scope: DigestScope) => void
  onCopy: () => void
}) {
  const scopes: Array<{ value: DigestScope; label: string; count: number | string }> = [
    { value: 'current', label: '当前列表', count: currentCount },
    { value: '24h', label: '24 小时', count: '日报' },
    { value: '7d', label: '7 天', count: '周报' },
    { value: 'favorites', label: '收藏', count: favoriteCount },
    { value: 'unread', label: '未读', count: unreadCount },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {scopes.map(scope => (
          <button
            key={scope.value}
            type="button"
            className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30"
            disabled={isGenerating}
            onClick={() => onGenerate(scope.value)}
          >
            <div className="text-[11px] text-muted-foreground">{scope.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{scope.count}</div>
          </button>
        ))}
      </div>

      <div className="rounded-md border bg-background">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Markdown 预览</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            disabled={!markdown}
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
            复制
          </Button>
        </div>
        <Textarea
          readOnly
          value={markdown}
          placeholder="点击上方范围生成摘要预览"
          className="min-h-[360px] resize-none rounded-none border-0 bg-muted/20 font-mono text-xs leading-5 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  )
}

export function AiHotspotsWorkspace() {
  const {
    view,
    items,
    filteredItems,
    sources,
    userFeeds,
    filters,
    isLoading,
    isRefreshing,
    lastRefreshAt,
    error,
    refreshProgress,
    load,
    refresh,
    setView,
    setFilters,
    toggleFavorite,
    markRead,
    saveItemAsNote,
    generateDigest,
  } = useAiHotspotsStore()
  const [digestMarkdown, setDigestMarkdown] = useState('')
  const [isGeneratingDigest, setIsGeneratingDigest] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const favoriteItems = useMemo(
    () => filteredItems.filter(item => item.isFavorite),
    [filteredItems],
  )
  const visibleItems = view === 'favorites' ? favoriteItems : filteredItems
  const favoriteCount = items.filter(item => item.isFavorite).length
  const unreadCount = items.filter(item => !item.isRead).length
  const savedCount = items.filter(item => Boolean(item.savedNotePath)).length
  const failedSourceCount = sources.filter(source => !source.ok).length
  const allSourcesFailed = sources.length > 0 && failedSourceCount === sources.length
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.status !== 'all',
  )
  const headerStatusText = isRefreshing
    ? '刷新中'
    : sources.length > 0
      ? getSourceHealthText(sources)
      : formatRefreshTime(lastRefreshAt)
  const favoriteEmptyTitle = favoriteCount > 0 && hasActiveFilters ? '没有匹配的收藏热点' : '还没有收藏热点'
  const favoriteEmptyDescription = favoriteCount > 0 && hasActiveFilters
    ? '调整搜索、来源或状态筛选后再看看。'
    : '在最新列表点亮星标后，会集中显示在这里。'

  const handleViewChange = (nextView: AiHotspotView) => {
    setView(nextView)
  }

  const handleRefresh = () => {
    void refresh({ force: true })
  }

  const handleToggleFavorite = (id: string) => {
    void toggleFavorite(id)
  }

  const handleMarkRead = (id: string, read: boolean) => {
    void markRead(id, read)
  }

  const handleSaveAsNote = (id: string) => {
    void saveItemAsNote(id)
    toast({ title: '保存为笔记将在知识沉淀步骤启用' })
  }

  const handleSendToChat = () => {
    toast({ title: '发送到聊天将在知识沉淀步骤启用' })
  }

  const handleDeepDive = () => {
    toast({ title: '深挖将在聊天接入步骤启用' })
  }

  const handleGenerateDigest = async (scope: DigestScope) => {
    setIsGeneratingDigest(true)
    try {
      const markdown = await generateDigest(scope)
      setDigestMarkdown(markdown)
      toast({ title: '已生成热点摘要预览' })
    } catch (err) {
      toast({
        title: '生成摘要失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingDigest(false)
    }
  }

  const handleCopyDigest = async () => {
    if (!digestMarkdown) return
    try {
      await navigator.clipboard.writeText(digestMarkdown)
      toast({ title: '已复制摘要 Markdown' })
    } catch {
      toast({ title: '复制失败', variant: 'destructive' })
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <Newspaper className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">AI 热点</span>

        <div className="ml-3 hidden items-center gap-0.5 md:flex">
          <ViewPill active={view === 'latest'} icon={<Newspaper className="size-3" />} label="最新" onClick={() => handleViewChange('latest')} />
          <ViewPill active={view === 'favorites'} icon={<Heart className="size-3" />} label="收藏" onClick={() => handleViewChange('favorites')} />
          <ViewPill active={view === 'digest'} icon={<Clipboard className="size-3" />} label="日报" onClick={() => handleViewChange('digest')} />
          <ViewPill active={view === 'sources'} icon={<Rss className="size-3" />} label="来源" onClick={() => handleViewChange('sources')} />
        </div>

        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline" title={formatRefreshTime(lastRefreshAt)}>
          {headerStatusText}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={isRefreshing}
          title="刷新 AI 热点"
          onClick={() => {
            void refresh({ force: true })
          }}
        >
          {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="AI 热点设置"
          onClick={() => toast({ title: '设置面板将在来源配置步骤启用' })}
        >
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 md:hidden">
        <ViewPill active={view === 'latest'} icon={<Newspaper className="size-3" />} label="最新" onClick={() => handleViewChange('latest')} />
        <ViewPill active={view === 'favorites'} icon={<Heart className="size-3" />} label="收藏" onClick={() => handleViewChange('favorites')} />
        <ViewPill active={view === 'digest'} icon={<Clipboard className="size-3" />} label="日报" onClick={() => handleViewChange('digest')} />
        <ViewPill active={view === 'sources'} icon={<Rss className="size-3" />} label="来源" onClick={() => handleViewChange('sources')} />
      </div>

      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {allSourcesFailed && items.length > 0 && !isRefreshing ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>本次所有来源均刷新失败，正在显示本地缓存。</span>
        </div>
      ) : null}

      {view === 'latest' || view === 'favorites' ? (
        <HotspotFilterBar
          filters={filters}
          items={items}
          sources={sources}
          onFiltersChange={setFilters}
        />
      ) : null}

      <ScrollArea className="min-h-0 flex-1 bg-muted/20">
        <main className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-5">
          {view === 'latest' || view === 'favorites' ? (
            <HotspotList
              items={visibleItems}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              hasCachedItems={items.length > 0}
              hasActiveFilters={hasActiveFilters || view === 'favorites'}
              emptyTitle={view === 'favorites' ? favoriteEmptyTitle : undefined}
              emptyDescription={view === 'favorites' ? favoriteEmptyDescription : undefined}
              refreshMessage={refreshProgress?.message}
              onRefresh={handleRefresh}
              onToggleFavorite={handleToggleFavorite}
              onMarkRead={handleMarkRead}
              onSaveAsNote={handleSaveAsNote}
              onSendToChat={handleSendToChat}
              onDeepDive={handleDeepDive}
            />
          ) : view === 'digest' ? (
            <DigestView
              currentCount={filteredItems.length}
              favoriteCount={favoriteCount}
              unreadCount={unreadCount}
              markdown={digestMarkdown}
              isGenerating={isGeneratingDigest}
              onGenerate={(scope) => void handleGenerateDigest(scope)}
              onCopy={() => void handleCopyDigest()}
            />
          ) : (
            <SourceStatusView
              sources={sources}
              userFeedCount={userFeeds.length}
              onRefresh={handleRefresh}
            />
          )}
        </main>
      </ScrollArea>

      <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-t bg-muted/30 px-2 text-[11px] text-muted-foreground">
        <Sparkles className="size-3 shrink-0" />
        <span className="whitespace-nowrap">{visibleItems.length}/{items.length} 条</span>
        <span className="h-3 w-px bg-border/70" />
        <span className="whitespace-nowrap">{favoriteCount} 收藏</span>
        <span className="whitespace-nowrap">{unreadCount} 未读</span>
        {savedCount > 0 ? <span className="whitespace-nowrap">{savedCount} 已保存</span> : null}
        <span className="ml-auto hidden whitespace-nowrap sm:inline">{formatRefreshTime(lastRefreshAt)}</span>
        {failedSourceCount > 0 ? (
          <span className="whitespace-nowrap text-destructive/80">{failedSourceCount} 来源失败</span>
        ) : null}
      </div>
    </div>
  )
}
