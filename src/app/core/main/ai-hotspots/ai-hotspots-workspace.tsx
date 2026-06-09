'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  BookOpenCheck,
  Bookmark,
  Clipboard,
  Clock,
  Heart,
  Layers3,
  Loader2,
  Newspaper,
  RefreshCcw,
  Rss,
  Settings,
  Sparkles,
  Tag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import type { AiHotspotItem, AiHotspotSourceStatus, AiHotspotView } from '@/lib/ai-hotspots'
import { createAiHotspotChatContext } from '@/lib/ai-hotspots/chat-context'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { useAiHotspotsStore } from '@/stores/ai-hotspots'
import { useSidebarStore } from '@/stores/sidebar'
import { HotspotDigestView, type HotspotDigestScope } from './hotspot-digest-view'
import { HotspotFilterBar } from './hotspot-filter-bar'
import { HotspotList } from './hotspot-list'
import { HotspotSettingsDialog } from './hotspot-settings-dialog'
import { HotspotSourceView } from './hotspot-source-view'
import { formatHotspotTime, getPrimaryHotspotTag, getSourceHealthText } from './hotspot-utils'

type TopicOption = {
  key: string
  label: string
  count: number
}

function normalizeTopic(value: string) {
  return value.trim().toLowerCase()
}

function getTopicKeyForItem(item: AiHotspotItem) {
  return normalizeTopic(getPrimaryHotspotTag(item))
}

function itemMatchesTopic(item: AiHotspotItem, activeTopic: string) {
  if (activeTopic === 'all') return true
  const tags = item.tags.length > 0 ? item.tags : [getPrimaryHotspotTag(item)]
  return tags.some(tag => normalizeTopic(tag) === activeTopic)
}

function buildTopicOptions(items: AiHotspotItem[]): TopicOption[] {
  const counts = new Map<string, TopicOption>()

  for (const item of items) {
    const tags = item.tags.length > 0 ? item.tags : [getPrimaryHotspotTag(item)]
    for (const tag of tags.slice(0, 6)) {
      const key = normalizeTopic(tag)
      if (!key) continue

      const existing = counts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(key, { key, label: tag.trim(), count: 1 })
      }
    }
  }

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10)
}

function formatRefreshTime(value: string | null) {
  if (!value) return '尚未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刷新时间未知'
  return `上次刷新 ${date.toLocaleString()}`
}

function ViewPill({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  count?: number
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
      {typeof count === 'number' ? (
        <span className={cn(
          'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
          active ? 'bg-background/15 text-background' : 'bg-muted text-muted-foreground',
        )}>
          {count}
        </span>
      ) : null}
    </button>
  )
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: number | string
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function TopicButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <Tag className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
        active ? 'bg-background/15 text-background' : 'bg-background text-muted-foreground',
      )}>
        {count}
      </span>
    </button>
  )
}

function SourceHealthRow({ source }: { source: AiHotspotSourceStatus }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs">
      <span className={cn('size-2 shrink-0 rounded-full', source.ok ? 'bg-emerald-500' : 'bg-destructive')} />
      <span className="min-w-0 flex-1 truncate text-foreground">{source.sourceName}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{source.itemCount}</span>
    </div>
  )
}

function HotspotInsightPanel({
  activeTopic,
  favoriteCount,
  items,
  lastRefreshAt,
  onTopicChange,
  savedCount,
  sources,
  topicOptions,
  unreadCount,
  visibleItems,
}: {
  activeTopic: string
  favoriteCount: number
  items: AiHotspotItem[]
  lastRefreshAt: string | null
  onTopicChange: (topic: string) => void
  savedCount: number
  sources: AiHotspotSourceStatus[]
  topicOptions: TopicOption[]
  unreadCount: number
  visibleItems: AiHotspotItem[]
}) {
  const okSourceCount = sources.filter(source => source.ok).length
  const topSources = sources
    .slice()
    .sort((left, right) => Number(right.ok) - Number(left.ok) || right.itemCount - left.itemCount)
    .slice(0, 6)
  const readingQueue = visibleItems
    .filter(item => !item.isRead)
    .slice(0, 4)
  const activeTopicLabel = activeTopic === 'all'
    ? '全部分类'
    : topicOptions.find(topic => topic.key === activeTopic)?.label || '当前分类'

  return (
    <aside className="hidden min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-l bg-muted/10 xl:flex">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Layers3 className="size-4 text-muted-foreground" />
                热点概览
              </div>
              <span className="text-[11px] text-muted-foreground" title={formatRefreshTime(lastRefreshAt)}>
                {formatRefreshTime(lastRefreshAt)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetricTile icon={<Newspaper className="size-3.5" />} label="当前" value={visibleItems.length} />
              <MetricTile icon={<BookOpenCheck className="size-3.5" />} label="未读" value={unreadCount} />
              <MetricTile icon={<Heart className="size-3.5" />} label="收藏" value={favoriteCount} />
              <MetricTile icon={<Bookmark className="size-3.5" />} label="已保存" value={savedCount} />
            </div>
          </section>

          <section className="rounded-md border bg-background p-2">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Tag className="size-4 text-muted-foreground" />
                分类聚合
              </div>
              <span className="text-[11px] text-muted-foreground">{activeTopicLabel}</span>
            </div>
            <div className="space-y-1">
              <TopicButton
                active={activeTopic === 'all'}
                count={items.length}
                label="全部分类"
                onClick={() => onTopicChange('all')}
              />
              {topicOptions.map(topic => (
                <TopicButton
                  key={topic.key}
                  active={activeTopic === topic.key}
                  count={topic.count}
                  label={topic.label}
                  onClick={() => onTopicChange(topic.key)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-md border bg-background p-2">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Rss className="size-4 text-muted-foreground" />
                来源健康
              </div>
              <span className="text-[11px] text-muted-foreground">{okSourceCount}/{sources.length}</span>
            </div>
            {topSources.length > 0 ? (
              <div className="space-y-0.5">
                {topSources.map(source => (
                  <SourceHealthRow key={source.sourceId} source={source} />
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-muted/30 px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
                刷新后会显示每个来源的可用状态。
              </div>
            )}
          </section>

          <section className="rounded-md border bg-background p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Clock className="size-4 text-muted-foreground" />
              待读建议
            </div>
            {readingQueue.length > 0 ? (
              <div className="space-y-3">
                {readingQueue.map(item => (
                  <div key={item.id} className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">{getTopicKeyForItem(item).slice(0, 12)}</span>
                      <span>{formatHotspotTime(item.publishedAt || item.lastSeenAt)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-foreground">
                      {item.title}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-muted/30 px-3 py-5 text-center text-xs leading-5 text-muted-foreground">
                当前列表没有未读热点。
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
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
    settings,
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
    saveDigestAsNote,
    saveSettings,
    addUserFeed,
    updateUserFeed,
    deleteUserFeed,
    importOpml,
  } = useAiHotspotsStore()
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const [digestMarkdown, setDigestMarkdown] = useState('')
  const [isGeneratingDigest, setIsGeneratingDigest] = useState(false)
  const [isSavingDigest, setIsSavingDigest] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTopic, setActiveTopic] = useState('all')

  useEffect(() => {
    void load()
  }, [load])

  const baseFavoriteItems = useMemo(
    () => filteredItems.filter(item => item.isFavorite),
    [filteredItems],
  )
  const baseListItems = view === 'favorites' ? baseFavoriteItems : filteredItems
  const topicOptions = useMemo(() => buildTopicOptions(baseListItems), [baseListItems])
  const visibleItems = useMemo(
    () => baseListItems.filter(item => itemMatchesTopic(item, activeTopic)),
    [activeTopic, baseListItems],
  )
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
  const hasTopicFilter = activeTopic !== 'all'
  const headerStatusText = isRefreshing
    ? '刷新中'
    : sources.length > 0
      ? getSourceHealthText(sources)
      : formatRefreshTime(lastRefreshAt)
  const favoriteEmptyTitle = favoriteCount > 0 && hasActiveFilters ? '没有匹配的收藏热点' : '还没有收藏热点'
  const favoriteEmptyDescription = favoriteCount > 0 && hasActiveFilters
    ? '调整搜索、来源或状态筛选后再看看。'
    : '在最新列表点亮星标后，会集中显示在这里。'
  const showInsightPanel = view === 'latest' || view === 'favorites'

  useEffect(() => {
    if (activeTopic === 'all') return
    if (!topicOptions.some(topic => topic.key === activeTopic)) {
      setActiveTopic('all')
    }
  }, [activeTopic, topicOptions])

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

  const openSavedNote = async (path: string) => {
    await loadFileTree({ skipRemoteSync: true })
    await setLeftSidebarTab('files')
    setActiveFilePath(path)
  }

  const handleSaveAsNote = async (id: string) => {
    try {
      const existing = items.find(candidate => candidate.id === id)
      if (existing?.savedNotePath) {
        await openSavedNote(existing.savedNotePath)
        return
      }

      const path = await saveItemAsNote(id)
      if (!path) return
      await openSavedNote(path)
      toast({ title: '已保存为笔记', description: path })
    } catch (err) {
      toast({
        title: '保存为笔记失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const sendItemToChat = (id: string, mode: 'discuss' | 'deep-dive') => {
    const item = items.find(candidate => candidate.id === id)
    if (!item) return

    const context = createAiHotspotChatContext(item, mode)
    emitter.emit('ai-hotspot-send-to-chat', context)
    void markRead(id, true)
    toast({ title: mode === 'deep-dive' ? '已发送深挖提示到聊天' : '已发送到聊天' })
  }

  const handleGenerateDigest = async (scope: HotspotDigestScope) => {
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

  const handleSaveDigest = async (scope: HotspotDigestScope) => {
    setIsSavingDigest(true)
    try {
      const result = await saveDigestAsNote(scope)
      setDigestMarkdown(result.markdown)
      await openSavedNote(result.path)
      toast({ title: '热点摘要已保存', description: result.path })
    } catch (err) {
      toast({
        title: '保存摘要失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setIsSavingDigest(false)
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          <Newspaper className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">AI 热点</div>
          <div className="hidden truncate text-[11px] text-muted-foreground sm:block">
            聚合、筛选并沉淀到笔记
          </div>
        </div>

        <div className="ml-3 hidden items-center gap-0.5 md:flex">
          <ViewPill active={view === 'latest'} count={filteredItems.length} icon={<Newspaper className="size-3" />} label="最新" onClick={() => handleViewChange('latest')} />
          <ViewPill active={view === 'favorites'} count={favoriteCount} icon={<Heart className="size-3" />} label="收藏" onClick={() => handleViewChange('favorites')} />
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
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 md:hidden">
        <ViewPill active={view === 'latest'} count={filteredItems.length} icon={<Newspaper className="size-3" />} label="最新" onClick={() => handleViewChange('latest')} />
        <ViewPill active={view === 'favorites'} count={favoriteCount} icon={<Heart className="size-3" />} label="收藏" onClick={() => handleViewChange('favorites')} />
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

      {showInsightPanel ? (
        <HotspotFilterBar
          filters={filters}
          items={items}
          sources={sources}
          activeTopic={activeTopic}
          onFiltersChange={setFilters}
          onTopicChange={setActiveTopic}
          topicTotalCount={baseListItems.length}
          topicOptions={topicOptions}
        />
      ) : null}

      <div className={cn(
        'grid min-h-0 flex-1 grid-cols-1 overflow-hidden',
        showInsightPanel && 'xl:grid-cols-[minmax(0,1fr)_320px]',
      )}>
        <ScrollArea className="min-h-0 flex-1 bg-muted/20">
          <main className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-5">
            {showInsightPanel ? (
              <HotspotList
                activeTopicLabel={activeTopic === 'all' ? '' : topicOptions.find(topic => topic.key === activeTopic)?.label || '当前分类'}
                items={visibleItems}
                isLoading={isLoading}
                isRefreshing={isRefreshing}
                hasCachedItems={items.length > 0}
                hasActiveFilters={hasActiveFilters || hasTopicFilter || view === 'favorites'}
                emptyTitle={view === 'favorites' ? favoriteEmptyTitle : undefined}
                emptyDescription={view === 'favorites' ? favoriteEmptyDescription : undefined}
                refreshMessage={refreshProgress?.message}
                totalCount={baseListItems.length}
                onClearTopic={() => setActiveTopic('all')}
                onRefresh={handleRefresh}
                onToggleFavorite={handleToggleFavorite}
                onMarkRead={handleMarkRead}
                onSaveAsNote={(id) => void handleSaveAsNote(id)}
                onSendToChat={(id) => sendItemToChat(id, 'discuss')}
                onDeepDive={(id) => sendItemToChat(id, 'deep-dive')}
              />
            ) : view === 'digest' ? (
              <HotspotDigestView
                currentCount={filteredItems.length}
                favoriteCount={favoriteCount}
                unreadCount={unreadCount}
                markdown={digestMarkdown}
                isGenerating={isGeneratingDigest}
                isSaving={isSavingDigest}
                onGenerate={(scope) => void handleGenerateDigest(scope)}
                onSave={(scope) => void handleSaveDigest(scope)}
                onCopy={() => void handleCopyDigest()}
              />
            ) : (
              <HotspotSourceView
                sources={sources}
                userFeeds={userFeeds}
                isRefreshing={isRefreshing}
                onRefresh={handleRefresh}
                onToggleUserFeed={async (id, enabled) => updateUserFeed(id, { enabled })}
                onDeleteUserFeed={deleteUserFeed}
              />
            )}
          </main>
        </ScrollArea>

        {showInsightPanel ? (
          <HotspotInsightPanel
            activeTopic={activeTopic}
            favoriteCount={favoriteCount}
            items={baseListItems}
            lastRefreshAt={lastRefreshAt}
            onTopicChange={setActiveTopic}
            savedCount={savedCount}
            sources={sources}
            topicOptions={topicOptions}
            unreadCount={unreadCount}
            visibleItems={visibleItems}
          />
        ) : null}
      </div>

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

      <HotspotSettingsDialog
        open={settingsOpen}
        settings={settings}
        onOpenChange={setSettingsOpen}
        onSaveSettings={saveSettings}
        onAddUserFeed={addUserFeed}
        onImportOpml={importOpml}
      />
    </div>
  )
}
