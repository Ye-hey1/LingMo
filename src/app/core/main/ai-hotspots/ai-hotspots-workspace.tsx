'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Bookmark,
  Clipboard,
  Heart,
  Layers3,
  Newspaper,
  Radar,
  Rss,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { AI_HOT_FEATURED_FEED_NAME } from '@/lib/ai-hotspots'
import type { AiHotspotFilters, AiHotspotItem, AiHotspotSourceStatus, AiHotspotView } from '@/lib/ai-hotspots'
import { createAiHotspotChatContext } from '@/lib/ai-hotspots/chat-context'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { useAiHotspotsStore } from '@/stores/ai-hotspots'
import { useSidebarStore } from '@/stores/sidebar'
import { HotspotDigestView, type HotspotDigestScope } from './hotspot-digest-view'
import { HotspotFilterBar, type HotspotViewMode } from './hotspot-filter-bar'
import { HotspotItem } from './hotspot-item'
import { HotspotList } from './hotspot-list'
import { HotspotReader } from './hotspot-reader'
import { HotspotSettingsDialog } from './hotspot-settings-dialog'
import { HotspotSourceView } from './hotspot-source-view'
import { getPrimaryHotspotTag } from './hotspot-utils'

type TopicOption = {
  key: string
  label: string
  count: number
}

type RadarViewMeta = {
  view: AiHotspotView
  label: string
  hint: string
  icon: ReactNode
}

interface AiHotspotsWorkspaceProps {
  onClose?: () => void
}

const RADAR_VIEWS: RadarViewMeta[] = [
  { view: 'featured', label: '精选', hint: '高价值信号', icon: <Sparkles className="size-4" /> },
  { view: 'all', label: '全部信号', hint: '按时间浏览', icon: <Newspaper className="size-4" /> },
  { view: 'clusters', label: '主题簇', hint: '按分类聚合', icon: <Layers3 className="size-4" /> },
  { view: 'digest', label: 'AI 日报', hint: '生成 Markdown', icon: <Clipboard className="size-4" /> },
  { view: 'sources', label: '信源库', hint: '增删改来源', icon: <Rss className="size-4" /> },
  { view: 'favorites', label: '收藏', hint: '重点跟进', icon: <Heart className="size-4" /> },
  { view: 'saved', label: '已沉淀', hint: '快照笔记', icon: <Bookmark className="size-4" /> },
  { view: 'trash', label: '回收站', hint: '自动清理', icon: <Trash2 className="size-4" /> },
]

const SIGNAL_PAGE_SIZE = 50

/** 将 feedName 显示名称映射表（与 store 中一致） */
const FEED_NAME_MAP_WS: Record<string, string> = {
  'www.axios.com': 'Axios', 'axios.com': 'Axios',
  'www.bbc.com': 'BBC', 'bbc.com': 'BBC',
  'www.newyorker.com': 'The New Yorker', 'newyorker.com': 'The New Yorker',
  'www.producthunt.com': 'Product Hunt', 'producthunt.com': 'Product Hunt',
  'www.theatlantic.com': 'The Atlantic', 'theatlantic.com': 'The Atlantic',
  'econ.st': 'The Economist', 'dlvr.it': 'DLVR.it',
  // github removed - not AI news focused
  'zhihu': '知乎', 'weibo': '微博', 'bilibili': 'B站',
  'juejin': '掘金', 'v2ex': 'V2EX', 'sspai': '少数派',
  '36kr': '36氪', 'huxiu': '虎嗅', 'ithome': 'IT之家',
  'solidot': 'Solidot', 'guokr': '果壳', 'oschina': '开源中国',
  'hackernews': 'Hacker News', 'producthunt': 'Product Hunt',
}

function normalizeFeedNameForFilter(raw: string): string {
  const trimmed = raw.trim()
  if (FEED_NAME_MAP_WS[trimmed]) return FEED_NAME_MAP_WS[trimmed]
  const noWww = trimmed.replace(/^www\./, '')
  if (FEED_NAME_MAP_WS[noWww]) return FEED_NAME_MAP_WS[noWww]
  if (/^[a-z0-9-]+\.(com|org|net|io|co|app|dev|cc|st)$/.test(noWww)) {
    const name = noWww.split('.')[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return trimmed
}

function normalizeTopic(value: string) {
  return value.trim().toLowerCase()
}

/** 优先使用 lastSeenAt（抓取时间），让最新抓取的条目排在最前面 */
function getItemTime(item: AiHotspotItem) {
  const value = item.lastSeenAt ?? item.publishedAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

/** 按抓取时间倒序排列，最新抓取的在最前面 */
function sortHotspotItems(items: AiHotspotItem[]) {
  return [...items].sort((left, right) => getItemTime(right) - getItemTime(left))
}

function getPublishedItemTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function sortFeedItems(items: AiHotspotItem[]) {
  return [...items].sort((left, right) => getPublishedItemTime(right) - getPublishedItemTime(left))
}

function isActiveSignal(item: AiHotspotItem) {
  return !item.deletedAt && !item.isIgnored
}

function isSavedSignal(item: AiHotspotItem) {
  return Boolean(item.savedNotePath) || item.digestStatus === 'saved'
}

function isDailyIssueSignal(item: AiHotspotItem) {
  return item.sourceId === 'ai-hot-rss' && item.feedName === 'AI HOT 日报'
}

function isFeaturedFeedSignal(item: AiHotspotItem) {
  return item.sourceId === 'ai-hot-rss' && item.feedName === AI_HOT_FEATURED_FEED_NAME
}

function isDailyArticleSignal(item: AiHotspotItem) {
  return item.meta?.feedRole === 'daily-article'
}

function isDailyDigestSignal(item: AiHotspotItem) {
  return isDailyIssueSignal(item) || isDailyArticleSignal(item)
}

function getDailyArticleCount(items: AiHotspotItem[]) {
  return items.filter(isDailyArticleSignal).length
}

function getLatestDailyIssueDate(items: AiHotspotItem[]) {
  return items
    .filter(isDailyIssueSignal)
    .map(item => {
      const fromTitle = item.title.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
      const time = item.publishedAt || item.lastSeenAt || item.firstSeenAt
      return fromTitle || (time ? new Date(time).toISOString().slice(0, 10) : '')
    })
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] || ''
}

function formatRefreshTime(value: string | null) {
  if (!value) return '尚未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刷新时间未知'
  return `上次刷新 ${date.toLocaleString()}`
}

function getLocalDayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function itemMatchesTopic(item: AiHotspotItem, activeTopic: string) {
  if (activeTopic === 'all') return true
  const tags = item.tags.length > 0 ? item.tags : [getPrimaryHotspotTag(item)]
  return tags.some(tag => normalizeTopic(tag) === activeTopic)
}

function matchesQuery(item: AiHotspotItem, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = [
    item.title,
    item.titleOriginal || '',
    item.titleEn || '',
    item.titleZh || '',
    item.summary || '',
    item.signalSummary || '',
    item.signalEssence || '',
    item.sourceName,
    item.feedName,
    item.url,
    ...item.tags,
    ...item.impactAudience,
  ].join(' ').toLowerCase()

  return words.every(word => haystack.includes(word))
}

function matchesLooseFilters(item: AiHotspotItem, filters: AiHotspotFilters) {
  if (filters.sourceId !== 'all' && item.sourceId !== filters.sourceId) return false
  if (
    filters.feedName !== 'all' &&
    normalizeFeedNameForFilter(item.feedName) !== filters.feedName &&
    normalizeFeedNameForFilter(item.sourceName) !== filters.feedName
  ) return false
  if (filters.status === 'unread' && item.isRead) return false
  if (filters.status === 'favorite' && !item.isFavorite) return false
  if (filters.status === 'saved' && !isSavedSignal(item)) return false
  if (filters.status === 'ignored' && !item.isIgnored) return false
  if (filters.status === 'deleted' && !item.deletedAt) return false
  return matchesQuery(item, filters.query)
}

function pickFeaturedItems(items: AiHotspotItem[]) {
  return sortFeedItems(items.filter(isFeaturedFeedSignal))
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
    .slice(0, 12)
}

function buildClusterGroups(items: AiHotspotItem[]) {
  const groups = new Map<string, AiHotspotItem[]>()
  for (const item of items) {
    const tag = getPrimaryHotspotTag(item)
    groups.set(tag, [...(groups.get(tag) || []), item])
  }
  return Array.from(groups.entries())
    .map(([tag, groupItems]) => ({ tag, items: sortHotspotItems(groupItems) }))
    .sort((left, right) => right.items.length - left.items.length || left.tag.localeCompare(right.tag))
}

function getViewItems(params: {
  view: AiHotspotView
  items: AiHotspotItem[]
  filteredItems: AiHotspotItem[]
  filters: AiHotspotFilters
}) {
  const { view, items, filteredItems, filters } = params
  const activeItems = items.filter(isActiveSignal)
  const signalItems = filteredItems.filter(item => !isDailyDigestSignal(item))

  if (view === 'featured') return pickFeaturedItems(signalItems)
  if (view === 'all' || view === 'clusters') return signalItems
  if (view === 'favorites') {
    return sortHotspotItems(activeItems.filter(item => !isDailyDigestSignal(item) && item.isFavorite && matchesLooseFilters(item, filters)))
  }
  if (view === 'saved') {
    return sortHotspotItems(activeItems.filter(item => !isDailyDigestSignal(item) && isSavedSignal(item) && matchesLooseFilters(item, filters)))
  }
  if (view === 'trash') {
    return sortHotspotItems(items.filter(item => Boolean(item.deletedAt) && matchesLooseFilters(item, filters)))
  }
  return filteredItems
}

function getEmptyCopy(view: AiHotspotView, hasCachedItems: boolean, hasActiveFilters: boolean) {
  if (view === 'featured') {
    return {
      title: hasCachedItems ? '当前没有匹配的精选信号' : '暂无精选信号',
      description: hasCachedItems ? '调整筛选或刷新后，雷达会重新挑出高价值热点。' : '刷新后会从信源中提炼高价值 AI 信号。',
    }
  }
  if (view === 'favorites') {
    return {
      title: hasActiveFilters ? '没有匹配的收藏' : '还没有收藏信号',
      description: '点亮信号笺上的星标后，会集中放在这里。',
    }
  }
  if (view === 'saved') {
    return {
      title: '还没有沉淀快照',
      description: '在信号笺上点击保存快照，会生成 Markdown 笔记。',
    }
  }
  if (view === 'trash') {
    return {
      title: '回收站是空的',
      description: '删除的信号会短暂停留在这里，并按时间自动清理。',
    }
  }
  return {
    title: hasCachedItems && hasActiveFilters ? '没有匹配的信号' : '暂无 AI 热点缓存',
    description: hasCachedItems && hasActiveFilters ? '调整搜索、来源或状态筛选后再看看。' : '点击刷新后会聚合默认来源和用户 RSS。',
  }
}

function NavButton({
  active,
  count,
  item,
  onClick,
}: {
  active: boolean
  count: number
  item: RadarViewMeta
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className={cn('flex size-5 shrink-0 items-center justify-center', active ? 'text-primary-foreground' : 'text-muted-foreground/60')}>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.label}</span>
      </span>
      <span className={cn(
        'text-[11px] tabular-nums',
        active ? 'text-primary-foreground/70' : 'text-muted-foreground/40',
      )}>
        {count}
      </span>
    </button>
  )
}

function SourceMiniList({ sources }: { sources: AiHotspotSourceStatus[] }) {
  const topSources = sources
    .slice()
    .sort((left, right) => Number(right.ok) - Number(left.ok) || right.itemCount - left.itemCount)
    .slice(0, 5)

  return (
    <div className="space-y-0.5">
      {topSources.map(source => (
        <div key={source.sourceId} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-muted">
          <span className={cn('size-1.5 shrink-0 rounded-full', source.ok ? 'bg-emerald-500' : 'bg-destructive')} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{source.sourceName}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground/60">{source.itemCount}</span>
        </div>
      ))}
      {topSources.length === 0 ? (
        <div className="rounded-md bg-background px-2 py-3 text-center text-[12px] leading-5 text-muted-foreground/70">
          刷新后显示信源状态。
        </div>
      ) : null}
    </div>
  )
}

function ClusterView({
  groups,
  selectedItemId,
  onAddToDigest,
  onDelete,
  onDeepDive,
  onGenerateInsight,
  onIgnore,
  onMarkRead,
  onRestore,
  onSaveSnapshot,
  onSelectItem,
  onSendToChat,
  onToggleFavorite,
}: {
  groups: Array<{ tag: string; items: AiHotspotItem[] }>
  selectedItemId: string | null
  onAddToDigest: (id: string) => void
  onDelete: (id: string) => void
  onDeepDive: (id: string) => void
  onGenerateInsight: (id: string) => void
  onIgnore: (id: string, ignored: boolean) => void
  onMarkRead: (id: string, read: boolean) => void
  onRestore: (id: string) => void
  onSaveSnapshot: (id: string) => void
  onSelectItem: (id: string) => void
  onSendToChat: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  if (groups.length === 0) {
    return (
      <div className="flex h-[360px] flex-col items-center justify-center rounded-lg border border-border bg-card px-4 text-center">
        <Layers3 className="mb-3 size-10 text-muted-foreground/60" />
        <div className="text-sm font-medium text-foreground">暂无主题簇</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          刷新或放宽筛选后，会按模型、工具、研究、算力等主题自动聚合。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <section key={group.tag} className="space-y-2">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Layers3 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{group.tag}</h3>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{group.items.length} 条</span>
          </div>
          <div className="space-y-2">
            {group.items.slice(0, 5).map(item => (
              <HotspotItem
                key={item.id}
                item={item}
                selected={selectedItemId === item.id}
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
        </section>
      ))}
    </div>
  )
}

export function AiHotspotsWorkspace({ onClose }: AiHotspotsWorkspaceProps) {
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
    lastDailyAutoRefreshDate,
    error,
    refreshProgress,
    load,
    refresh,
    refreshFeatured,
    refreshDaily,
    setView,
    setFilters,
    toggleFavorite,
    markRead,
    ignoreItem,
    deleteItem,
    restoreItem,
    addItemToDigest,
    generateItemInsight,
    saveSnapshotAsNote,
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<HotspotViewMode>('list')
  const [displayCount, setDisplayCount] = useState(SIGNAL_PAGE_SIZE)
  const dailyAutoRefreshDayRef = useRef<string | null>(null)

  useEffect(() => {
    void load({ skipAutoRefresh: true })
  }, [load])

  const activeItems = useMemo(() => items.filter(isActiveSignal), [items])
  const currentViewItems = useMemo(
    () => getViewItems({ view, items, filteredItems, filters }),
    [filters, filteredItems, items, view],
  )
  const filterBarItems = view === 'featured'
    ? pickFeaturedItems(items.filter(isActiveSignal))
    : items
  const topicOptions = useMemo(() => buildTopicOptions(currentViewItems), [currentViewItems])
  const visibleItems = useMemo(
    () => currentViewItems.filter(item => itemMatchesTopic(item, activeTopic)),
    [activeTopic, currentViewItems],
  )
  const pagedVisibleItems = useMemo(
    () => visibleItems.slice(0, displayCount),
    [displayCount, visibleItems],
  )
  const clusterGroups = useMemo(() => buildClusterGroups(visibleItems), [visibleItems])
  const selectedItem = useMemo(
    () => selectedItemId ? items.find(item => item.id === selectedItemId) || null : null,
    [items, selectedItemId],
  )
  const relatedItems = useMemo(() => {
    if (!selectedItem) return []
    const relatedIds = new Set(selectedItem.relatedSignalIds)
    return items.filter(item => relatedIds.has(item.id)).slice(0, 3)
  }, [items, selectedItem])

  const favoriteCount = activeItems.filter(item => item.isFavorite).length
  const unreadCount = activeItems.filter(item => !item.isRead).length
  const savedCount = activeItems.filter(isSavedSignal).length
  const digestCount = activeItems.filter(item => item.digestStatus === 'added').length
  const dailyIssueCount = items.filter(isDailyIssueSignal).length
  const trashCount = items.filter(item => item.deletedAt).length
  const failedSourceCount = sources.filter(source => !source.ok).length
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.feedName !== 'all' ||
    filters.status !== 'all',
  )
  const viewCounts: Record<AiHotspotView, number> = {
    featured: pickFeaturedItems(filteredItems).length,
    all: filteredItems.length,
    clusters: topicOptions.length,
    digest: dailyIssueCount || digestCount,
    sources: sources.length + userFeeds.length,
    favorites: favoriteCount,
    saved: savedCount,
    trash: trashCount,
  }
  const showSignalList = view !== 'digest' && view !== 'sources'
  const showDetailPanel = showSignalList && view !== 'trash'
  const readerOpen = showDetailPanel && Boolean(selectedItem)
  const emptyCopy = getEmptyCopy(view, items.length > 0, hasActiveFilters || activeTopic !== 'all')

  useEffect(() => {
    if (activeTopic === 'all') return
    if (!topicOptions.some(topic => topic.key === activeTopic)) {
      setActiveTopic('all')
    }
  }, [activeTopic, topicOptions])

  useEffect(() => {
    setDisplayCount(SIGNAL_PAGE_SIZE)
  }, [activeTopic, filters.query, filters.sourceId, filters.status, filters.timeRange, view])

  useEffect(() => {
    if (selectedItemId && !visibleItems.some(item => item.id === selectedItemId)) {
      setSelectedItemId(null)
    }
  }, [selectedItemId, visibleItems])

  useEffect(() => {
    setSelectedBatchIds(current => current.filter(id => visibleItems.some(item => item.id === id)))
  }, [visibleItems])

  const handleRefresh = async () => {
    const previousItemCount = items.length
    const previousDailyArticleCount = getDailyArticleCount(items)
    const previousLatestDailyIssueDate = getLatestDailyIssueDate(items)
    let result = null
    try {
      result = await refresh({ force: true })
    } catch (err) {
      console.error('[handleRefresh] error:', err)
    }

    const state = useAiHotspotsStore.getState()
    if (state.error) {
      toast({ title: '刷新失败', description: state.error, variant: 'destructive' })
      return
    }

    const addedItems = Math.max(0, state.items.length - previousItemCount)
    const nextDailyArticleCount = getDailyArticleCount(state.items)
    const addedDailyArticles = Math.max(0, nextDailyArticleCount - previousDailyArticleCount)
    const nextLatestDailyIssueDate = getLatestDailyIssueDate(state.items)
    const latestDailyChanged = Boolean(nextLatestDailyIssueDate && nextLatestDailyIssueDate !== previousLatestDailyIssueDate)
    const rawCount = result?.snapshot.rawCount ?? 0

    if (addedItems > 0 || addedDailyArticles > 0 || latestDailyChanged) {
      toast({
        title: 'AI 热点已刷新',
        description: [
          addedItems > 0 ? `新增 ${addedItems} 条信号` : '',
          addedDailyArticles > 0 ? `新增 ${addedDailyArticles} 条日报详情` : '',
          latestDailyChanged ? `最新日报 ${nextLatestDailyIssueDate}` : '',
        ].filter(Boolean).join('，'),
      })
      return
    }

    toast({
      title: rawCount > 0 ? '刷新完成，已同步最新来源' : '刷新完成，源站暂无新增内容',
      description: nextLatestDailyIssueDate ? `当前最新日报 ${nextLatestDailyIssueDate}` : undefined,
    })
  }

  const handleFeaturedRefresh = async () => {
    const previousFeaturedCount = pickFeaturedItems(items).length
    let result = null
    try {
      result = await refreshFeatured({ force: true })
    } catch (err) {
      console.error('[handleFeaturedRefresh] error:', err)
    }

    const state = useAiHotspotsStore.getState()
    if (state.error) {
      toast({ title: '刷新精选失败', description: state.error, variant: 'destructive' })
      return
    }

    const nextFeaturedCount = pickFeaturedItems(state.items).length
    const addedFeatured = Math.max(0, nextFeaturedCount - previousFeaturedCount)
    const rawCount = result?.snapshot.rawCount ?? 0

    toast({
      title: addedFeatured > 0 ? 'AI HOT 精选已更新' : '精选已同步到最新',
      description: addedFeatured > 0
        ? `新增 ${addedFeatured} 条精选`
        : rawCount > 0
          ? `已按 ${AI_HOT_FEATURED_FEED_NAME} 重新校验 ${rawCount} 条`
          : '源站暂无新增精选',
    })
  }

  const handleDailyRefresh = useCallback(async (options: { autoRefreshDate?: string; silent?: boolean } = {}) => {
    const previousDailyArticleCount = getDailyArticleCount(items)
    const previousLatestDailyIssueDate = getLatestDailyIssueDate(items)
    let result = null
    try {
      result = await refreshDaily({ force: true, autoRefreshDate: options.autoRefreshDate })
    } catch (err) {
      console.error('[handleDailyRefresh] error:', err)
    }

    const state = useAiHotspotsStore.getState()
    if (state.error) {
      if (!options.silent) {
        toast({ title: '刷新日报失败', description: state.error, variant: 'destructive' })
      }
      return
    }

    if (!result) return

    const nextDailyArticleCount = getDailyArticleCount(state.items)
    const addedDailyArticles = Math.max(0, nextDailyArticleCount - previousDailyArticleCount)
    const nextLatestDailyIssueDate = getLatestDailyIssueDate(state.items)
    const latestDailyChanged = Boolean(nextLatestDailyIssueDate && nextLatestDailyIssueDate !== previousLatestDailyIssueDate)
    const latestDate = nextLatestDailyIssueDate || previousLatestDailyIssueDate

    if (options.silent && !latestDailyChanged && addedDailyArticles === 0) {
      return
    }

    toast({
      title: latestDailyChanged ? 'AI 日报已更新' : '日报已同步到最新',
      description: [
        latestDate ? `当前最新日报 ${latestDate}` : '',
        addedDailyArticles > 0 ? `新增 ${addedDailyArticles} 条日报详情` : '',
        result.snapshot.rawCount > 0 && addedDailyArticles === 0 ? '已重新校验最新日报源' : '',
      ].filter(Boolean).join('，'),
    })
  }, [items, refreshDaily])

  useEffect(() => {
    if (view !== 'digest' || isRefreshing) return

    const today = getLocalDayKey()
    if (lastDailyAutoRefreshDate === today || dailyAutoRefreshDayRef.current === today) return

    dailyAutoRefreshDayRef.current = today
    void handleDailyRefresh({ autoRefreshDate: today, silent: true })
  }, [handleDailyRefresh, isRefreshing, lastDailyAutoRefreshDate, view])

  const openSavedNote = async (path: string) => {
    await loadFileTree({ skipRemoteSync: true })
    await setLeftSidebarTab('files')
    setActiveFilePath(path)
  }

  const handleSaveSnapshot = async (id: string) => {
    try {
      const existing = items.find(candidate => candidate.id === id)
      if (existing?.savedNotePath) {
        await openSavedNote(existing.savedNotePath)
        return
      }

      const path = await saveSnapshotAsNote(id)
      if (!path) return
      await openSavedNote(path)
      toast({ title: '已保存热点快照', description: path })
    } catch (err) {
      toast({
        title: '保存快照失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const handleGenerateInsight = async (id: string) => {
    try {
      await generateItemInsight(id)
      toast({ title: '信号概要已生成' })
    } catch (err) {
      toast({
        title: '生成概要失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async (id: string) => {
    await deleteItem(id)
    toast({ title: '已移入回收站' })
  }

  const handleRestore = async (id: string) => {
    await restoreItem(id)
    toast({ title: '信号已恢复' })
  }

  const handleAddToDigest = async (id: string) => {
    await addItemToDigest(id)
    toast({ title: '已加入 AI 日报' })
  }

  const handleSelectItem = (id: string) => {
    setSelectedItemId(id)
  }

  const handleSelectRelated = (id: string) => {
    setSelectedItemId(id)
  }

  const handleCheckedChange = (id: string, checked: boolean) => {
    setSelectedBatchIds(current => {
      if (checked) {
        return current.includes(id) ? current : [...current, id]
      }
      return current.filter(candidate => candidate !== id)
    })
  }

  const handleBatchMarkRead = async (ids: string[]) => {
    for (const id of ids) {
      await markRead(id, true)
    }
    setSelectedBatchIds([])
    toast({ title: `已标记 ${ids.length} 条信号为已读` })
  }

  const handleBatchFavorite = async (ids: string[]) => {
    for (const id of ids) {
      const item = items.find(candidate => candidate.id === id)
      if (item && !item.isFavorite) {
        await toggleFavorite(id)
      }
    }
    setSelectedBatchIds([])
    toast({ title: `已收藏 ${ids.length} 条信号` })
  }

  const handleBatchSaveSnapshot = async (ids: string[]) => {
    try {
      for (const id of ids) {
        await saveSnapshotAsNote(id)
      }
      setSelectedBatchIds([])
      toast({ title: `已沉淀 ${ids.length} 条快照` })
    } catch (err) {
      toast({
        title: '批量沉淀失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const handleBatchDelete = async (ids: string[]) => {
    for (const id of ids) {
      await deleteItem(id)
    }
    setSelectedBatchIds([])
    if (selectedItemId && ids.includes(selectedItemId)) {
      setSelectedItemId(null)
    }
    toast({ title: `已移入回收站 ${ids.length} 条信号` })
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
      toast({ title: '已生成日报预览' })
    } catch (err) {
      toast({
        title: '生成日报失败',
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
      toast({ title: 'AI 日报已保存为 Markdown', description: result.path })
    } catch (err) {
      toast({
        title: '保存日报失败',
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
      toast({ title: '已复制 Markdown' })
    } catch {
      toast({ title: '复制失败', variant: 'destructive' })
    }
  }

  const renderMain = () => {
    if (view === 'digest') {
      return (
        <HotspotDigestView
          items={items}
          currentCount={filteredItems.length}
          favoriteCount={favoriteCount}
          unreadCount={unreadCount}
          markdown={digestMarkdown}
          isGenerating={isGeneratingDigest}
          isRefreshing={isRefreshing}
          isSaving={isSavingDigest}
          refreshMessage={refreshProgress?.message}
          onGenerate={(scope) => void handleGenerateDigest(scope)}
          onSave={(scope) => void handleSaveDigest(scope)}
          onCopy={() => void handleCopyDigest()}
          onRefreshDaily={() => void handleDailyRefresh()}
          onToggleFavorite={(id) => void toggleFavorite(id)}
          onSaveSnapshot={(id) => void handleSaveSnapshot(id)}
        />
      )
    }

    if (view === 'sources') {
      return (
        <HotspotSourceView
          sources={sources}
          userFeeds={userFeeds}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
          onAddUserFeed={addUserFeed}
          onUpdateUserFeed={updateUserFeed}
          onToggleUserFeed={async (id, enabled) => updateUserFeed(id, { enabled })}
          onDeleteUserFeed={deleteUserFeed}
        />
      )
    }

    if (view === 'clusters') {
      return (
        <ClusterView
          groups={clusterGroups}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          onToggleFavorite={(id) => void toggleFavorite(id)}
          onMarkRead={(id, read) => void markRead(id, read)}
          onSaveSnapshot={(id) => void handleSaveSnapshot(id)}
          onSendToChat={(id) => sendItemToChat(id, 'discuss')}
          onDeepDive={(id) => sendItemToChat(id, 'deep-dive')}
          onAddToDigest={(id) => void handleAddToDigest(id)}
          onIgnore={(id, ignored) => void ignoreItem(id, ignored)}
          onDelete={(id) => void handleDelete(id)}
          onRestore={(id) => void handleRestore(id)}
          onGenerateInsight={(id) => void handleGenerateInsight(id)}
        />
      )
    }

    return (
      <HotspotList
        activeTopicLabel={activeTopic === 'all' ? '' : topicOptions.find(topic => topic.key === activeTopic)?.label || '当前分类'}
        items={pagedVisibleItems}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        hasCachedItems={items.length > 0}
        hasActiveFilters={hasActiveFilters || activeTopic !== 'all' || view !== 'all'}
        emptyTitle={emptyCopy.title}
        emptyDescription={emptyCopy.description}
        refreshMessage={refreshProgress?.message}
        totalCount={visibleItems.length}
        hasMore={displayCount < visibleItems.length}
        showFeaturedTrends={view === 'featured' && activeTopic === 'all'}
        selectedItemId={selectedItemId}
        selectedItemIds={selectedBatchIds}
        trashMode={view === 'trash'}
        viewMode={viewMode}
        query={filters.query}
        onBatchDelete={(ids) => void handleBatchDelete(ids)}
        onBatchFavorite={(ids) => void handleBatchFavorite(ids)}
        onBatchMarkRead={(ids) => void handleBatchMarkRead(ids)}
        onBatchSaveSnapshot={(ids) => void handleBatchSaveSnapshot(ids)}
        onClearTopic={() => setActiveTopic('all')}
        onClearSelection={() => setSelectedBatchIds([])}
        onCheckedChange={handleCheckedChange}
        onRefresh={view === 'featured' ? handleFeaturedRefresh : handleRefresh}
        onLoadMore={() => setDisplayCount(current => current + SIGNAL_PAGE_SIZE)}
        onSelectItem={handleSelectItem}
        onToggleFavorite={(id) => void toggleFavorite(id)}
        onMarkRead={(id, read) => void markRead(id, read)}
        onSaveSnapshot={(id) => void handleSaveSnapshot(id)}
        onSendToChat={(id) => sendItemToChat(id, 'discuss')}
        onDeepDive={(id) => sendItemToChat(id, 'deep-dive')}
        onAddToDigest={(id) => void handleAddToDigest(id)}
        onIgnore={(id, ignored) => void ignoreItem(id, ignored)}
        onDelete={(id) => void handleDelete(id)}
        onRestore={(id) => void handleRestore(id)}
        onGenerateInsight={(id) => void handleGenerateInsight(id)}
      />
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* 左侧导航 */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-muted/30 lg:flex">
        {/* Logo + 标题 */}
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radar className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">AI 信号雷达</div>
              <div className="text-[11px] text-muted-foreground/60">知识聚合 · 信号追踪</div>
            </div>
          </div>
        </div>

        {/* 导航菜单 */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-0.5">
            {RADAR_VIEWS.map(item => (
              <NavButton
                key={item.view}
                active={view === item.view}
                count={viewCounts[item.view]}
                item={item}
                onClick={() => {
                  setView(item.view)
                  setActiveTopic('all')
                  setSelectedItemId(null)
                  setSelectedBatchIds([])
                }}
              />
            ))}
          </div>
        </div>

        {/* 信源状态 */}
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground/60">
            <span>信源</span>
            <span>{sources.filter(s => s.ok).length}/{sources.length}</span>
          </div>
          <SourceMiniList sources={sources} />
        </div>
      </aside>

      {/* 主区域：响应式 master-detail */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 筛选栏：小屏阅读时隐藏，让阅读器占满 */}
        {view !== 'digest' && view !== 'sources' && (
          <div className={cn(readerOpen && 'hidden xl:block')}>
            <HotspotFilterBar
              filters={filters}
              items={filterBarItems}
              sources={sources}
              activeTopic={activeTopic}
              isRefreshing={isRefreshing}
              viewMode={viewMode}
              topicTotalCount={currentViewItems.length}
              topicOptions={topicOptions}
              onFiltersChange={setFilters}
              onClose={onClose}
              onOpenSettings={() => setSettingsOpen(true)}
              onRefresh={view === 'featured' ? handleFeaturedRefresh : handleRefresh}
              onTopicChange={setActiveTopic}
              onViewModeChange={setViewMode}
            />
          </div>
        )}

        {/* 错误提示 */}
        {error ? (
          <div className="flex shrink-0 items-start gap-2 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* 内容区：列表 + 应用内阅读器 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 列表面板：阅读器打开时，大屏收窄为侧栏，小屏隐藏 */}
          <div className={cn(
            'flex min-h-0 flex-col',
            readerOpen ? 'hidden w-[400px] shrink-0 border-r border-border bg-muted/20 xl:flex' : 'flex-1 bg-muted/20',
          )}>
            {view === 'digest' ? (
              <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-hidden">
                {renderMain()}
              </main>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <main className="w-full px-4 py-4">
                  {renderMain()}
                </main>
              </ScrollArea>
            )}
          </div>

          {/* 应用内阅读器：大屏右侧主阅读区，小屏占满 */}
          {readerOpen && selectedItem ? (
            <HotspotReader
              item={selectedItem}
              relatedItems={relatedItems}
              canBack
              onBack={() => setSelectedItemId(null)}
              onClose={() => setSelectedItemId(null)}
              onToggleFavorite={(id) => void toggleFavorite(id)}
              onMarkRead={(id, read) => void markRead(id, read)}
              onSaveSnapshot={(id) => void handleSaveSnapshot(id)}
              onAddToDigest={(id) => void handleAddToDigest(id)}
              onSendToChat={(id) => sendItemToChat(id, 'discuss')}
              onDeepDive={(id) => sendItemToChat(id, 'deep-dive')}
              onGenerateInsight={(id) => void handleGenerateInsight(id)}
              onSelectRelated={handleSelectRelated}
            />
          ) : null}
        </div>

        {/* 底部状态栏 */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-background px-3 text-[11px] text-muted-foreground">
          <span className="whitespace-nowrap">{Math.min(displayCount, visibleItems.length)}/{activeItems.length} 条</span>
          <span className="h-3 w-px bg-border" />
          <span className="whitespace-nowrap">{favoriteCount} 收藏</span>
          <span className="whitespace-nowrap">{savedCount} 快照</span>
          <span className="ml-auto whitespace-nowrap">{formatRefreshTime(lastRefreshAt)}</span>
          {failedSourceCount > 0 && (
            <span className="whitespace-nowrap text-destructive">{failedSourceCount} 源失败</span>
          )}
        </div>
      </section>

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
