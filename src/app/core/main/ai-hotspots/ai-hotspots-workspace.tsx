'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Bookmark,
  Clipboard,
  Heart,
  Inbox,
  Loader2,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Radar,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import {
  AI_HOT_FEATURED_FEED_NAME,
  AI_HOT_RSS_SOURCE_ID,
  getDefaultRssFeedRole,
  isDefaultRssFeed,
} from '@/lib/ai-hotspots'
import type { AiHotspotFilters, AiHotspotItem, AiHotspotUserFeed, AiHotspotView } from '@/lib/ai-hotspots'
import { createAiHotspotChatContext } from '@/lib/ai-hotspots/chat-context'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { useAiHotspotsStore } from '@/stores/ai-hotspots'
import { useSidebarStore } from '@/stores/sidebar'
import { HotspotDigestView, type HotspotDigestScope } from './hotspot-digest-view'
import { HotspotFilterBar, type HotspotViewMode } from './hotspot-filter-bar'
import { HotspotList } from './hotspot-list'
import { HotspotReader } from './hotspot-reader'
import { HotspotSettingsDialog } from './hotspot-settings-dialog'
import { HotspotSourceView } from './hotspot-source-view'
import { getDisplayHotspotTags } from './hotspot-utils'

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

type SubscriptionRow = {
  feed: AiHotspotUserFeed
  items: AiHotspotItem[]
  host: string
  initials: string
  latestTime: number
}

type SubscriptionTypeFilter = 'all' | 'rss' | 'wechat' | 'opml' | 'custom'

interface AiHotspotsWorkspaceProps {
  onClose?: () => void
}

const RADAR_VIEWS: RadarViewMeta[] = [
  { view: 'featured', label: '精选', hint: '高价值信号', icon: <Sparkles className="size-4" /> },
  { view: 'all', label: '全部信号', hint: '按时间浏览', icon: <Newspaper className="size-4" /> },
  { view: 'clusters', label: '订阅', hint: '按来源阅读', icon: <Inbox className="size-4" /> },
  { view: 'sources', label: '信源库', hint: '增删改来源', icon: <Rss className="size-4" /> },
  { view: 'favorites', label: '收藏', hint: '重点跟进', icon: <Heart className="size-4" /> },
  { view: 'saved', label: '已沉淀', hint: '快照笔记', icon: <Bookmark className="size-4" /> },
  { view: 'trash', label: '回收站', hint: '自动清理', icon: <Trash2 className="size-4" /> },
]

const SIGNAL_PAGE_SIZE = 50
const WECHAT_LOAD_MORE_PAGE_SIZE = 10

const SUBSCRIPTION_TYPE_LABELS: Record<SubscriptionTypeFilter, string> = {
  all: '全部',
  rss: 'RSS源',
  wechat: '公众号源',
  opml: 'OPML',
  custom: '自定义',
}

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

/** 优先使用 publishedAt（新闻发布时间），让最新新闻排在最前面 */
function getItemTime(item: AiHotspotItem) {
  const value = item.publishedAt ?? item.lastSeenAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

/** 按新闻发布时间倒序排列，最新新闻在最前面 */
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

function normalizeComparable(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function getHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function getFeedInitials(title: string) {
  const chars = Array.from(title.trim() || '源')
  return chars.slice(0, 2).join('').toUpperCase()
}

function getSubscriptionFeedType(feed: AiHotspotUserFeed): Exclude<SubscriptionTypeFilter, 'all'> {
  const group = (feed.groupName || '').trim().toLowerCase()
  const feedUrl = (feed.feedUrl || '').trim().toLowerCase()
  if (feedUrl.startsWith('wechat-mp://') || group === 'wechat-mp' || group === 'builtin:wechat-rss') return 'wechat'
  if (group === 'opml') return 'opml'
  if (group === 'custom' || !group) return 'custom'
  return 'rss'
}

function getSubscriptionFeedTypeLabel(feed: AiHotspotUserFeed) {
  return SUBSCRIPTION_TYPE_LABELS[getSubscriptionFeedType(feed)]
}

function isItemFromUserFeed(item: AiHotspotItem, feed: AiHotspotUserFeed) {
  if (isDefaultRssFeed(feed)) {
    if (item.sourceId !== AI_HOT_RSS_SOURCE_ID) return false

    const feedRole = getDefaultRssFeedRole(feed)
    const itemFeedUrl = normalizeComparable(item.meta?.feedUrl)
    const feedUrl = normalizeComparable(feed.feedUrl)
    if (itemFeedUrl && feedUrl && itemFeedUrl === feedUrl) return true

    const itemFeedRole = normalizeComparable(item.meta?.feedRole)
    if (feedRole === 'daily') {
      return itemFeedRole === 'daily' || itemFeedRole === 'daily-article'
    }
    return itemFeedRole === feedRole
  }

  const metaFeedId = normalizeComparable(item.meta?.userFeedId)
  if (metaFeedId && metaFeedId === normalizeComparable(feed.id)) return true

  const feedTitle = normalizeComparable(normalizeFeedNameForFilter(feed.title))
  const itemFeedName = normalizeComparable(normalizeFeedNameForFilter(item.feedName))
  const itemSourceName = normalizeComparable(normalizeFeedNameForFilter(item.sourceName))
  if (feedTitle && (feedTitle === itemFeedName || feedTitle === itemSourceName)) return true

  const feedHost = getHostname(feed.feedUrl)
  const itemHost = getHostname(item.url)
  return Boolean(feedHost && itemHost && (itemHost === feedHost || itemHost.endsWith(`.${feedHost}`)))
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

function getLocalDayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function itemMatchesTopic(item: AiHotspotItem, activeTopic: string) {
  if (activeTopic === 'all') return true
  const tags = getDisplayHotspotTags(item, 6)
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
  return matchesQuery(item, String(filters.query || ''))
}

function pickFeaturedItems(items: AiHotspotItem[]) {
  return sortFeedItems(items.filter(isFeaturedFeedSignal))
}

function buildTopicOptions(items: AiHotspotItem[]): TopicOption[] {
  const counts = new Map<string, TopicOption>()

  for (const item of items) {
    const tags = getDisplayHotspotTags(item, 6)
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

function buildSubscriptionRows(
  feeds: AiHotspotUserFeed[],
  items: AiHotspotItem[],
  query: string,
  typeFilter: SubscriptionTypeFilter,
): SubscriptionRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  return feeds
    .filter(feed => typeFilter === 'all' || getSubscriptionFeedType(feed) === typeFilter)
    .map((feed) => {
      const feedItems = sortFeedItems(items.filter(item => isItemFromUserFeed(item, feed)))
      const host = getHostname(feed.feedUrl)
      const latestTime = feedItems[0] ? getPublishedItemTime(feedItems[0]) : 0

      return {
        feed,
        host,
        initials: getFeedInitials(feed.title),
        items: feedItems,
        latestTime,
      }
    })
    .filter((row) => {
      if (words.length === 0) return true
      const haystack = [
        row.feed.title,
        row.feed.feedUrl,
        row.feed.groupName || '',
        row.host,
      ].join(' ').toLowerCase()
      return words.every(word => haystack.includes(word))
    })
    .sort((left, right) => {
      if (left.feed.enabled !== right.feed.enabled) return left.feed.enabled ? -1 : 1
      return right.latestTime - left.latestTime || left.feed.title.localeCompare(right.feed.title)
    })
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
  if (view === 'all') return signalItems
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
  collapsed,
  count,
  item,
  onClick,
}: {
  active: boolean
  collapsed?: boolean
  count: number
  item: RadarViewMeta
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={collapsed ? `${item.label} · ${item.hint}` : undefined}
      className={cn(
        'ai-hotspots-nav-button flex h-10 w-full items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
        active
          ? 'is-active'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className={cn('flex size-5 shrink-0 items-center justify-center', active ? 'text-background' : 'text-muted-foreground/70')}>
        {item.icon}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{item.label}</span>
            {active ? <span className="block truncate text-[10px] text-background/65">{item.hint}</span> : null}
          </span>
          <span className={cn(
            'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
            active ? 'bg-background/15 text-background/75' : 'text-muted-foreground/50',
          )}>
            {count}
          </span>
        </>
      ) : null}
    </button>
  )
}

function UtilityViewToolbar({
  extraControl,
  hint,
  icon,
  isRefreshing,
  minimal = false,
  onClose,
  onOpenSettings,
  onRefresh,
  onSearchChange,
  searchPlaceholder,
  searchValue = '',
  statusText,
  title,
}: {
  extraControl?: ReactNode
  hint: string
  icon: ReactNode
  isRefreshing: boolean
  minimal?: boolean
  onClose?: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  searchValue?: string
  statusText: string
  title: string
}) {
  const hasSearch = Boolean(onSearchChange)

  return (
    <div className="ai-hotspots-filter-bar shrink-0 border-b border-border/70">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 lg:px-4">
        {!minimal ? (
          <div className="flex min-w-[180px] shrink-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background shadow-sm">
              {icon}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-5 text-foreground">{title}</div>
              <div className="truncate text-[11px] leading-4 text-muted-foreground/70">{hint}</div>
            </div>
          </div>
        ) : null}

        {hasSearch ? (
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={searchValue}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-md border border-input/80 bg-background/75 pl-8 pr-7 text-sm text-foreground shadow-sm shadow-black/0 transition-all duration-200 placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-foreground/10"
              onChange={(event) => onSearchChange?.(event.target.value)}
            />
            {searchValue.trim() ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label="清除搜索"
                onClick={() => onSearchChange?.('')}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="min-w-[160px] flex-1" />
        )}

        {extraControl ? (
          <div className="shrink-0">
            {extraControl}
          </div>
        ) : null}

        <div className="h-5 w-px bg-border" />

        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground shadow-none transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRefreshing}
          title="刷新"
          onClick={onRefresh}
        >
          {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>

        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground shadow-none transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]"
          title="设置"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
        </button>

        {onClose ? (
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground shadow-none transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]"
            title="关闭"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </button>
        ) : null}
      </div>

      {!minimal && statusText ? (
        <div className="border-t border-border/60 px-3 py-1.5 lg:px-4">
          <div className="truncate text-[11px] text-muted-foreground">{statusText}</div>
        </div>
      ) : null}
    </div>
  )
}

function SubscriptionView({
  allFeedCount,
  compact,
  displayCount,
  isLoading,
  isLoadingMore,
  isRefreshing,
  onBatchDelete,
  onBatchFavorite,
  onBatchMarkRead,
  onBatchSaveSnapshot,
  onCheckedChange,
  onClearSelection,
  selectedItemId,
  selectedItemIds,
  selectedRow,
  rows,
  viewMode,
  onAddToDigest,
  onDelete,
  onDeepDive,
  onGenerateInsight,
  onIgnore,
  onLoadMore,
  onMarkRead,
  onOpenSources,
  onRefreshFeed,
  onRestore,
  onSaveSnapshot,
  onSelectFeed,
  onSelectItem,
  onSendToChat,
  onToggleFavorite,
}: {
  allFeedCount: number
  compact?: boolean
  displayCount: number
  isLoading: boolean
  isLoadingMore?: boolean
  isRefreshing: boolean
  onBatchDelete: (ids: string[]) => void
  onBatchFavorite: (ids: string[]) => void
  onBatchMarkRead: (ids: string[]) => void
  onBatchSaveSnapshot: (ids: string[]) => void
  onCheckedChange: (id: string, checked: boolean) => void
  onClearSelection: () => void
  selectedItemId: string | null
  selectedItemIds: string[]
  selectedRow: SubscriptionRow | null
  rows: SubscriptionRow[]
  viewMode: HotspotViewMode
  onAddToDigest: (id: string) => void
  onDelete: (id: string) => void
  onDeepDive: (id: string) => void
  onGenerateInsight: (id: string) => void
  onIgnore: (id: string, ignored: boolean) => void
  onLoadMore: () => void
  onMarkRead: (id: string, read: boolean) => void
  onOpenSources: () => void
  onRefreshFeed: () => void
  onRestore: (id: string) => void
  onSaveSnapshot: (id: string) => void
  onSelectFeed: (id: string) => void
  onSelectItem: (id: string) => void
  onSendToChat: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const selectedItems = selectedRow?.items || []
  const pagedItems = selectedItems.slice(0, displayCount)
  const selectedFeedIsWechat = selectedRow ? getSubscriptionFeedType(selectedRow.feed) === 'wechat' : false
  const canLoadMoreSelectedFeed = selectedFeedIsWechat
    ? Boolean(selectedRow?.feed.enabled)
    : displayCount < selectedItems.length

  if (allFeedCount === 0) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-md border border-dashed border-border/80 bg-background/70 px-4 text-center">
        <Inbox className="mb-3 size-10 text-muted-foreground/60" />
        <div className="text-sm font-medium text-foreground">还没有订阅源</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          在信源库添加 RSS 后，这里会按来源显示订阅列表和对应新闻。
        </div>
        <button
          type="button"
          className="mt-4 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 active:scale-[0.98]"
          onClick={onOpenSources}
        >
          打开信源库
        </button>
      </div>
    )
  }

  return (
    <div className={cn(
      'grid h-full min-h-[520px] gap-4',
      compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]',
    )}>
      {!compact ? (
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background/78">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
            <div className="flex items-center gap-2">
              <Inbox className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">订阅源</span>
            </div>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onOpenSources}
            >
              管理
            </button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {rows.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的订阅源</div>
              ) : rows.map(row => (
                <button
                  key={row.feed.id}
                  type="button"
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                    selectedRow?.feed.id === row.feed.id
                      ? 'bg-foreground text-background'
                      : 'text-foreground hover:bg-muted/80',
                  )}
                  onClick={() => onSelectFeed(row.feed.id)}
                >
                  <span className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold',
                    selectedRow?.feed.id === row.feed.id
                      ? 'border-background/20 bg-background/12 text-background'
                      : 'border-border/70 bg-muted/45 text-muted-foreground',
                  )}>
                    {row.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.feed.title}</span>
                    <span className={cn(
                      'block truncate text-[11px]',
                      selectedRow?.feed.id === row.feed.id ? 'text-background/65' : 'text-muted-foreground/70',
                    )}>
                      {getSubscriptionFeedTypeLabel(row.feed)}
                      {!row.feed.enabled ? ' · 已停用' : ''}
                    </span>
                  </span>
                  {row.items.length > 0 ? (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[11px]',
                      selectedRow?.feed.id === row.feed.id ? 'bg-background/14 text-background/75' : 'text-muted-foreground/60',
                    )}>
                      {row.items.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>
      ) : null}

      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background/76">
        {selectedRow ? (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/45 text-xs font-semibold text-muted-foreground">
                {selectedRow.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{selectedRow.feed.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {selectedRow.host || getSubscriptionFeedTypeLabel(selectedRow.feed)}
                </div>
              </div>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
                title={selectedRow.feed.enabled ? '刷新当前订阅源' : '订阅源已停用'}
                disabled={isRefreshing || !selectedRow.feed.enabled}
                onClick={onRefreshFeed}
              >
                {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </button>
            </header>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3 lg:p-4">
                <HotspotList
                  items={pagedItems}
                  isLoading={isLoading}
                  isRefreshing={isRefreshing}
                  hasCachedItems={selectedItems.length > 0}
                  hasActiveFilters={false}
                  emptyTitle="这个订阅源暂无新闻"
                  emptyDescription={selectedRow.feed.enabled ? '点击刷新后，只会同步当前订阅源。' : '该订阅源已停用，启用后可继续同步。'}
                  hasMore={canLoadMoreSelectedFeed}
                  isLoadingMore={selectedFeedIsWechat && isLoadingMore}
                  selectedItemId={selectedItemId}
                  selectedItemIds={selectedItemIds}
                  viewMode={viewMode}
                  onBatchDelete={onBatchDelete}
                  onBatchFavorite={onBatchFavorite}
                  onBatchMarkRead={onBatchMarkRead}
                  onBatchSaveSnapshot={onBatchSaveSnapshot}
                  onClearSelection={onClearSelection}
                  onCheckedChange={onCheckedChange}
                  onRefresh={onRefreshFeed}
                  onLoadMore={onLoadMore}
                  onSelectItem={onSelectItem}
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
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-4 text-center">
            <Inbox className="mb-3 size-10 text-muted-foreground/60" />
            <div className="text-sm font-medium text-foreground">选择一个订阅源</div>
            <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              左侧是各渠道订阅列表，选中后右侧只显示该来源的新闻。
            </div>
          </div>
        )}
      </section>
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
    lastDailyAutoRefreshDate,
    error,
    refreshProgress,
    load,
    refresh,
    refreshFeatured,
    refreshDaily,
    refreshUserFeed,
    loadMoreWechatUserFeed,
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
    syncItemsFromDb,
  } = useAiHotspotsStore()
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const [digestMarkdown, setDigestMarkdown] = useState('')
  const [isGeneratingDigest, setIsGeneratingDigest] = useState(false)
  const [isSavingDigest, setIsSavingDigest] = useState(false)
  const [isLoadingMoreWechat, setIsLoadingMoreWechat] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTopic, setActiveTopic] = useState('all')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<HotspotViewMode>('list')
  const [displayCount, setDisplayCount] = useState(SIGNAL_PAGE_SIZE)
  const [sourceSearchQuery, setSourceSearchQuery] = useState('')
  const [subscriptionSearchQuery, setSubscriptionSearchQuery] = useState('')
  const [subscriptionTypeFilter, setSubscriptionTypeFilter] = useState<SubscriptionTypeFilter>('all')
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null)
  const dailyAutoRefreshDayRef = useRef<string | null>(null)

  useEffect(() => {
    void load({ skipAutoRefresh: true })
  }, [load])

  useEffect(() => {
    if (view === 'digest') {
      setView('clusters')
    }
  }, [setView, view])

  const activeItems = useMemo(() => items.filter(isActiveSignal), [items])
  const subscriptionRows = useMemo(
    () => buildSubscriptionRows(userFeeds, activeItems, subscriptionSearchQuery, subscriptionTypeFilter),
    [activeItems, subscriptionSearchQuery, subscriptionTypeFilter, userFeeds],
  )
  const selectedSubscriptionRow = useMemo(
    () => subscriptionRows.find(row => row.feed.id === selectedSubscriptionId) || subscriptionRows[0] || null,
    [selectedSubscriptionId, subscriptionRows],
  )
  const baseViewItems = useMemo(
    () => getViewItems({ view, items, filteredItems, filters }),
    [filters, filteredItems, items, view],
  )
  const currentViewItems = useMemo(
    () => view === 'clusters' ? selectedSubscriptionRow?.items || [] : baseViewItems,
    [baseViewItems, selectedSubscriptionRow, view],
  )
  const filterBarItems = view === 'featured'
    ? pickFeaturedItems(items.filter(isActiveSignal))
    : items
  const topicOptions = useMemo(
    () => view === 'clusters' ? [] : buildTopicOptions(currentViewItems),
    [currentViewItems, view],
  )
  const visibleItems = useMemo(
    () => view === 'clusters' ? currentViewItems : currentViewItems.filter(item => itemMatchesTopic(item, activeTopic)),
    [activeTopic, currentViewItems, view],
  )
  const pagedVisibleItems = useMemo(
    () => visibleItems.slice(0, displayCount),
    [displayCount, visibleItems],
  )
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
  const savedCount = activeItems.filter(isSavedSignal).length
  const digestCount = activeItems.filter(item => item.digestStatus === 'added').length
  const dailyIssueCount = items.filter(isDailyIssueSignal).length
  const latestDailyIssueDate = getLatestDailyIssueDate(items)
  const trashCount = items.filter(item => item.deletedAt).length
  const filterQueryValue = String(filters.query || '')
  const hasActiveFilters = Boolean(
    filterQueryValue.trim() ||
    filters.timeRange !== '24h' ||
    filters.sourceId !== 'all' ||
    filters.feedName !== 'all' ||
    filters.status !== 'all',
  )
  const viewCounts: Record<AiHotspotView, number> = {
    featured: pickFeaturedItems(filteredItems).length,
    all: filteredItems.length,
    clusters: userFeeds.length,
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
    if (view !== 'clusters') return
    if (selectedSubscriptionId && subscriptionRows.some(row => row.feed.id === selectedSubscriptionId)) return
    setSelectedSubscriptionId(subscriptionRows[0]?.feed.id || null)
  }, [selectedSubscriptionId, subscriptionRows, view])

  useEffect(() => {
    if (activeTopic === 'all') return
    if (!topicOptions.some(topic => topic.key === activeTopic)) {
      setActiveTopic('all')
    }
  }, [activeTopic, topicOptions])

  useEffect(() => {
    setDisplayCount(SIGNAL_PAGE_SIZE)
  }, [activeTopic, filters.query, filters.sourceId, filters.status, filters.timeRange, selectedSubscriptionId, subscriptionSearchQuery, subscriptionTypeFilter, view])

  useEffect(() => {
    if (selectedItemId && !visibleItems.some(item => item.id === selectedItemId)) {
      setSelectedItemId(null)
    }
  }, [selectedItemId, visibleItems])

  useEffect(() => {
    const handleItemsUpdated = (payload: unknown) => {
      const ids = Array.isArray((payload as { ids?: unknown }).ids)
        ? (payload as { ids: unknown[] }).ids.filter((id): id is string => typeof id === 'string')
        : []
      if (ids.length > 0 && selectedItemId && !ids.includes(selectedItemId)) return
      void syncItemsFromDb()
    }

    emitter.on('ai-hotspots-items-updated', handleItemsUpdated)
    return () => {
      emitter.off('ai-hotspots-items-updated', handleItemsUpdated)
    }
  }, [selectedItemId, syncItemsFromDb])

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

  const handleSelectSubscriptionFeed = (id: string) => {
    setSelectedSubscriptionId(id)
    setSelectedItemId(null)
    setSelectedBatchIds([])
    setDisplayCount(SIGNAL_PAGE_SIZE)
  }

  const handleSubscriptionRefresh = async () => {
    const feed = selectedSubscriptionRow?.feed
    if (!feed) {
      toast({ title: '请选择订阅源' })
      return
    }
    if (!feed.enabled) {
      toast({ title: '订阅源已停用', description: '在信源库启用后可继续刷新。' })
      return
    }

    const previousFeedCount = items.filter(item => isItemFromUserFeed(item, feed)).length
    let result = null
    try {
      result = await refreshUserFeed(feed.id, { force: true })
    } catch (err) {
      console.error('[handleSubscriptionRefresh] error:', err)
    }

    const state = useAiHotspotsStore.getState()
    if (state.error) {
      toast({ title: '刷新订阅源失败', description: state.error, variant: 'destructive' })
      return
    }

    if (!result) return

    const nextFeed = state.userFeeds.find(candidate => candidate.id === feed.id) || feed
    const nextFeedCount = state.items.filter(item => isItemFromUserFeed(item, nextFeed)).length
    const addedItems = Math.max(0, nextFeedCount - previousFeedCount)
    const rawCount = result.snapshot.rawCount ?? 0

    toast({
      title: addedItems > 0 ? '订阅源已更新' : '当前订阅源已同步',
      description: addedItems > 0
        ? `${feed.title} 新增 ${addedItems} 条`
        : nextFeedCount > 0
          ? `${feed.title} 已重新校验 ${rawCount} 条，当前显示 ${nextFeedCount} 条`
          : rawCount > 0
            ? `${feed.title} 拉取到 ${rawCount} 条，但还没有进入当前列表`
          : `${feed.title} 暂无新增内容`,
    })
  }

  const handleSubscriptionLoadMore = async () => {
    const row = selectedSubscriptionRow
    const feed = row?.feed
    if (!feed) return

    if (getSubscriptionFeedType(feed) !== 'wechat') {
      setDisplayCount(current => current + SIGNAL_PAGE_SIZE)
      return
    }

    if (!feed.enabled) {
      toast({ title: '订阅源已停用', description: '在信源库启用后可继续加载。' })
      return
    }

    const begin = row.items.length
    setIsLoadingMoreWechat(true)
    setDisplayCount(current => Math.max(current, begin + WECHAT_LOAD_MORE_PAGE_SIZE))

    let result = null
    try {
      result = await loadMoreWechatUserFeed(feed.id, begin, WECHAT_LOAD_MORE_PAGE_SIZE)
    } catch (err) {
      console.error('[handleSubscriptionLoadMore] error:', err)
    } finally {
      setIsLoadingMoreWechat(false)
    }

    const state = useAiHotspotsStore.getState()
    if (state.error) {
      toast({ title: '加载公众号文章失败', description: state.error, variant: 'destructive' })
      return
    }

    if (!result) return

    const nextFeed = state.userFeeds.find(candidate => candidate.id === feed.id) || feed
    const nextFeedCount = state.items.filter(item => isItemFromUserFeed(item, nextFeed)).length
    const addedItems = Math.max(0, nextFeedCount - begin)
    const rawCount = result.snapshot.rawCount ?? 0

    toast({
      title: addedItems > 0 ? '已加载更多文章' : '没有拿到新的历史文章',
      description: addedItems > 0
        ? `${feed.title} 新增显示 ${addedItems} 条`
        : rawCount > 0
          ? '本页文章已存在或被源站返回重复内容'
          : '源站本次没有返回更多内容，可稍后再试',
    })
  }

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
          userFeeds={userFeeds}
          searchQuery={sourceSearchQuery}
          onAddUserFeed={addUserFeed}
          onUpdateUserFeed={updateUserFeed}
          onToggleUserFeed={async (id, enabled) => updateUserFeed(id, { enabled })}
          onDeleteUserFeed={deleteUserFeed}
        />
      )
    }

    if (view === 'clusters') {
      return (
        <SubscriptionView
          allFeedCount={userFeeds.length}
          compact={readerOpen}
          displayCount={displayCount}
          isLoading={isLoading}
          isLoadingMore={isLoadingMoreWechat}
          isRefreshing={isRefreshing}
          rows={subscriptionRows}
          selectedRow={selectedSubscriptionRow}
          selectedItemId={selectedItemId}
          selectedItemIds={selectedBatchIds}
          viewMode={viewMode}
          onBatchDelete={(ids) => void handleBatchDelete(ids)}
          onBatchFavorite={(ids) => void handleBatchFavorite(ids)}
          onBatchMarkRead={(ids) => void handleBatchMarkRead(ids)}
          onBatchSaveSnapshot={(ids) => void handleBatchSaveSnapshot(ids)}
          onCheckedChange={handleCheckedChange}
          onClearSelection={() => setSelectedBatchIds([])}
          onLoadMore={() => void handleSubscriptionLoadMore()}
          onOpenSources={() => setView('sources')}
          onRefreshFeed={() => void handleSubscriptionRefresh()}
          onSelectFeed={handleSelectSubscriptionFeed}
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
      <HotspotList
        items={pagedVisibleItems}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        hasCachedItems={items.length > 0}
        hasActiveFilters={hasActiveFilters || activeTopic !== 'all' || view !== 'all'}
        emptyTitle={emptyCopy.title}
        emptyDescription={emptyCopy.description}
        refreshMessage={refreshProgress?.message}
        hasMore={displayCount < visibleItems.length}
        selectedItemId={selectedItemId}
        selectedItemIds={selectedBatchIds}
        trashMode={view === 'trash'}
        viewMode={viewMode}
        query={filters.query}
        onBatchDelete={(ids) => void handleBatchDelete(ids)}
        onBatchFavorite={(ids) => void handleBatchFavorite(ids)}
        onBatchMarkRead={(ids) => void handleBatchMarkRead(ids)}
        onBatchSaveSnapshot={(ids) => void handleBatchSaveSnapshot(ids)}
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
    <div className="ai-hotspots-shell flex h-full min-w-0 flex-1 overflow-hidden text-foreground">
      {/* 左侧导航 */}
      <aside
        className={cn(
          'ai-hotspots-sidebar hidden shrink-0 flex-col transition-[width] duration-200 lg:flex',
          sidebarCollapsed ? 'w-[68px]' : 'w-[236px]',
        )}
      >
        {/* Logo + 标题 */}
        <div className={cn('shrink-0 border-b border-border/70 py-4', sidebarCollapsed ? 'px-2' : 'px-3')}>
          <div className={cn('flex items-center', sidebarCollapsed ? 'flex-col gap-2' : 'gap-3')}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background shadow-sm">
              <Radar className="size-4" />
            </div>
            {!sidebarCollapsed ? (
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-5 text-foreground">AI 信号雷达</div>
                <div className="text-[11px] leading-4 text-muted-foreground/70">发现 · 筛选 · 沉淀</div>
              </div>
            ) : null}
            <button
              type="button"
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                sidebarCollapsed && 'mx-auto',
              )}
              title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
              aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
              onClick={() => setSidebarCollapsed(current => !current)}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className={cn('min-h-0 flex-1 overflow-y-auto border-b border-border/70 py-3', sidebarCollapsed ? 'px-2' : 'px-3')}>
          {!sidebarCollapsed ? (
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/60">
              <span>视图选择</span>
              <span>{RADAR_VIEWS.length} 个入口</span>
            </div>
          ) : null}
          <div className="space-y-1">
            {RADAR_VIEWS.map(item => (
              <NavButton
                key={item.view}
                active={view === item.view}
                collapsed={sidebarCollapsed}
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
        </nav>
      </aside>

      {/* 主区域：响应式 master-detail */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部工具栏：小屏阅读时隐藏，让阅读器占满 */}
        {view === 'digest' ? (
          <UtilityViewToolbar
            title="AI 日报"
            hint="期刊目录与 Markdown 输出"
            icon={<Clipboard className="size-4" />}
            isRefreshing={isRefreshing}
            statusText={isRefreshing
              ? refreshProgress?.message || '正在刷新 AI 日报'
              : latestDailyIssueDate
                ? `当前最新日报 ${latestDailyIssueDate}`
                : '刷新后显示 AI HOT 日报目录'}
            onClose={onClose}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void handleDailyRefresh()}
          />
        ) : view === 'sources' ? (
          <UtilityViewToolbar
            title="信源库"
            hint="所有订阅源统一管理"
            icon={<Rss className="size-4" />}
            isRefreshing={isRefreshing}
            minimal
            searchValue={sourceSearchQuery}
            searchPlaceholder="搜索源名称或地址"
            statusText=""
            onClose={onClose}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void handleRefresh()}
            onSearchChange={setSourceSearchQuery}
          />
        ) : view === 'clusters' ? (
          <div className={cn(readerOpen && 'hidden')}>
            <UtilityViewToolbar
              title="订阅"
              hint="按来源阅读新闻"
              icon={<Inbox className="size-4" />}
              isRefreshing={isRefreshing}
              minimal
              extraControl={(
                <Select
                  value={subscriptionTypeFilter}
                  onValueChange={(value) => {
                    setSubscriptionTypeFilter(value as SubscriptionTypeFilter)
                    setSelectedSubscriptionId(null)
                    setSelectedItemId(null)
                    setSelectedBatchIds([])
                  }}
                >
                  <SelectTrigger className="h-9 w-[124px] rounded-md bg-background/75 text-xs shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="rss">RSS源</SelectItem>
                    <SelectItem value="wechat">公众号源</SelectItem>
                    <SelectItem value="opml">OPML</SelectItem>
                    <SelectItem value="custom">自定义</SelectItem>
                  </SelectContent>
                </Select>
              )}
              searchValue={subscriptionSearchQuery}
              searchPlaceholder="搜索订阅源或地址"
              statusText=""
              onClose={onClose}
              onOpenSettings={() => setSettingsOpen(true)}
              onRefresh={() => void handleSubscriptionRefresh()}
              onSearchChange={setSubscriptionSearchQuery}
            />
          </div>
        ) : (
          <div className={cn(readerOpen && 'hidden')}>
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

        {/* 内容区：列表 / 居中阅读器 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 列表面板：打开文章后退场，避免左右分屏阅读 */}
          <div className={cn(
            'flex min-h-0 flex-col',
            readerOpen ? 'hidden' : 'ai-hotspots-surface flex-1',
          )}>
            {view === 'digest' ? (
              <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-hidden">
                {renderMain()}
              </main>
            ) : view === 'sources' || view === 'clusters' ? (
              <main className={cn('min-h-0 flex-1 overflow-hidden', view === 'clusters' && 'p-4 lg:p-5')}>
                {renderMain()}
              </main>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <main className="mx-auto w-full max-w-[1480px] px-4 py-4 lg:px-5 lg:py-5">
                  {renderMain()}
                </main>
              </ScrollArea>
            )}
          </div>

          {/* 应用内阅读器：替换列表并居中显示 */}
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
