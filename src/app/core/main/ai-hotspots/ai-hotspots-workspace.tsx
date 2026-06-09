'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Clipboard,
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
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import type { AiHotspotView } from '@/lib/ai-hotspots'
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
import { getSourceHealthText } from './hotspot-utils'

function formatRefreshTime(value: string | null) {
  if (!value) return '尚未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刷新时间未知'
  return `上次刷新 ${date.toLocaleString()}`
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
          onClick={() => setSettingsOpen(true)}
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
