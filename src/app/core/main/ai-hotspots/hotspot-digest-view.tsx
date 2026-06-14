'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Bookmark,
  CalendarDays,
  Copy,
  ExternalLink,
  FileText,
  Layers3,
  Loader2,
  Newspaper,
  RefreshCcw,
  Save,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'
import { getHotspotHost, getPrimaryHotspotTag } from './hotspot-utils'

export type HotspotDigestScope = 'current' | '24h' | '7d' | 'favorites' | 'unread'

interface HotspotDigestViewProps {
  items: AiHotspotItem[]
  currentCount: number
  favoriteCount: number
  unreadCount: number
  markdown: string
  isGenerating: boolean
  isRefreshing?: boolean
  isSaving: boolean
  refreshMessage?: string
  onGenerate: (scope: HotspotDigestScope) => void
  onSave: (scope: HotspotDigestScope) => void
  onCopy: () => void
  onRefreshDaily?: () => void
  onToggleFavorite: (id: string) => void
  onSaveSnapshot: (id: string) => void
}

interface DailyIssue {
  id: string
  date: string
  title: string
  summary: string
  url: string
  publishedAt: string | null
  detailCount: number
  detailError: string
  detailFetchedAt: string
  detailStatus: string
}

function getItemTime(item: AiHotspotItem) {
  const value = item.lastSeenAt ?? item.publishedAt ?? item.firstSeenAt
  const time = value ? Date.parse(value) : 0
  return Number.isFinite(time) ? time : 0
}

function getItemDate(item: AiHotspotItem) {
  const time = getItemTime(item)
  return time ? new Date(time).toISOString().slice(0, 10) : ''
}

function isDailyIssue(item: AiHotspotItem) {
  return item.sourceId === 'ai-hot-rss' && item.feedName === 'AI HOT 日报'
}

function getDailyArticleMeta(item: AiHotspotItem) {
  const meta = item.meta || {}
  const feedRole = typeof meta.feedRole === 'string' ? meta.feedRole : ''
  const issueDate = typeof meta.dailyIssueDate === 'string' ? meta.dailyIssueDate : ''
  const sectionTitle = typeof meta.dailySectionTitle === 'string' ? meta.dailySectionTitle : ''
  const sectionSubtitle = typeof meta.dailySectionSubtitle === 'string' ? meta.dailySectionSubtitle : ''
  const articleRole = typeof meta.dailyArticleRole === 'string' ? meta.dailyArticleRole : ''
  const articleIndex = typeof meta.dailyArticleIndex === 'number' ? meta.dailyArticleIndex : 0

  return { articleIndex, articleRole, feedRole, issueDate, sectionSubtitle, sectionTitle }
}

function isAihotStory(item: AiHotspotItem) {
  return getDailyArticleMeta(item).feedRole === 'daily-article' && !item.deletedAt && !item.isIgnored
}

function cleanDailyTitle(title: string) {
  return title
    .replace(/^AI HOT\s*日报\s*·\s*/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s*[—-]\s*/, '')
    .trim()
}

function getIssueDate(item: AiHotspotItem) {
  const fromTitle = item.title.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  return fromTitle || getItemDate(item)
}

function toDailyIssue(item: AiHotspotItem): DailyIssue {
  const date = getIssueDate(item)
  const meta = item.meta || {}
  return {
    id: item.id,
    date,
    title: cleanDailyTitle(item.title),
    summary: (item.summary || item.signalSummary || '').replace(/\s*—\s*点击查看完整日报\s*$/, ''),
    url: item.url,
    publishedAt: item.publishedAt,
    detailCount: typeof meta.dailyDetailCount === 'number' ? meta.dailyDetailCount : 0,
    detailError: typeof meta.dailyDetailError === 'string' ? meta.dailyDetailError : '',
    detailFetchedAt: typeof meta.dailyDetailFetchedAt === 'string' ? meta.dailyDetailFetchedAt : '',
    detailStatus: typeof meta.dailyDetailStatus === 'string' ? meta.dailyDetailStatus : '',
  }
}

function formatDetailFetchedAt(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function formatChineseDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText || '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

function groupIssuesByMonth(issues: DailyIssue[]) {
  const groups = new Map<string, DailyIssue[]>()
  for (const issue of issues) {
    const month = issue.date.slice(0, 7) || '未知月份'
    groups.set(month, [...(groups.get(month) || []), issue])
  }
  return Array.from(groups.entries())
}

function groupStoriesByTag(items: AiHotspotItem[]) {
  const groups = new Map<string, AiHotspotItem[]>()
  for (const item of items) {
    const tag = getDailyArticleMeta(item).sectionTitle || getPrimaryHotspotTag(item)
    groups.set(tag, [...(groups.get(tag) || []), item])
  }
  return Array.from(groups.entries())
    .map(([tag, stories]) => ({ tag, stories: stories.sort((left, right) => getDailyArticleMeta(left).articleIndex - getDailyArticleMeta(right).articleIndex) }))
    .sort((left, right) => {
      const leftIndex = Math.min(...left.stories.map(story => getDailyArticleMeta(story).articleIndex || Number.MAX_SAFE_INTEGER))
      const rightIndex = Math.min(...right.stories.map(story => getDailyArticleMeta(story).articleIndex || Number.MAX_SAFE_INTEGER))
      return leftIndex - rightIndex || left.tag.localeCompare(right.tag)
    })
}

function DailyStat({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div className="rounded-md border bg-background/80 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function StoryRow({
  item,
  index,
  onSaveSnapshot,
  onToggleFavorite,
}: {
  item: AiHotspotItem
  index: number
  onSaveSnapshot: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const host = getHotspotHost(item.url)
  const summary = item.signalSummary || item.summary
  const dailyMeta = getDailyArticleMeta(item)

  return (
    <article className="group border-t px-4 py-4 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-xs font-semibold tabular-nums text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground">
              {dailyMeta.articleRole || item.feedName.replace(/^AI HOT\s*/, '')}
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {dailyMeta.sectionTitle || getPrimaryHotspotTag(item)}
            </span>
            {host ? <span className="truncate text-[11px] text-muted-foreground">{host}</span> : null}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block break-words text-base font-semibold leading-7 text-foreground underline-offset-4 hover:underline"
          >
            {item.title}
          </a>
          {summary ? (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
              {summary}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
              onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="size-3.5" />
              原文
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground',
                item.isFavorite && 'bg-muted text-foreground',
              )}
              onClick={() => onToggleFavorite(item.id)}
            >
              <Sparkles className={cn('size-3.5', item.isFavorite && 'fill-current')} />
              {item.isFavorite ? '已收藏' : '收藏'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
              onClick={() => onSaveSnapshot(item.id)}
            >
              {item.savedNotePath ? <Bookmark className="size-3.5" /> : <FileText className="size-3.5" />}
              {item.savedNotePath ? '快照' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}

export function HotspotDigestView({
  items,
  currentCount,
  favoriteCount,
  unreadCount,
  markdown,
  isGenerating,
  isRefreshing = false,
  isSaving,
  refreshMessage,
  onGenerate,
  onSave,
  onCopy,
  onRefreshDaily,
  onToggleFavorite,
  onSaveSnapshot,
}: HotspotDigestViewProps) {
  const issues = useMemo(
    () => items
      .filter(isDailyIssue)
      .map(toDailyIssue)
      .sort((left, right) => right.date.localeCompare(left.date)),
    [items],
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const activeIssue = issues.find(issue => issue.date === selectedDate) || issues[0] || null
  const issueStories = useMemo(() => {
    if (!activeIssue) return []
    return items
      .filter(isAihotStory)
      .filter(item => getDailyArticleMeta(item).issueDate === activeIssue.date)
      .sort((left, right) => getDailyArticleMeta(left).articleIndex - getDailyArticleMeta(right).articleIndex)
      .slice(0, 30)
  }, [activeIssue, items])
  const storyGroups = useMemo(() => groupStoriesByTag(issueStories), [issueStories])
  const latestIssue = issues[0]
  const monthGroups = groupIssuesByMonth(issues)
  const activeIssueLoaded = issueStories.length > 0
  const detailFetchedAtText = formatDetailFetchedAt(activeIssue?.detailFetchedAt || '')

  if (!activeIssue) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center rounded-md border bg-background px-4 text-center">
        <Newspaper className="mb-3 size-10 text-muted-foreground" />
        <div className="text-sm font-medium">还没有 AI HOT 日报缓存</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          点击刷新后会拉取默认的 AI HOT 日报 RSS，并在这里形成轻量期刊目录。
        </div>
        {onRefreshDaily ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 px-3 text-xs shadow-none"
            disabled={isRefreshing}
            onClick={onRefreshDaily}
          >
            {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            刷新日报
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid min-h-[620px] gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col rounded-md border bg-background">
        <div className="shrink-0 border-b p-3">
          <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 p-3">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">最新一期</div>
            <div className="mt-2 text-sm font-medium text-foreground">{latestIssue?.date || '暂无日期'}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {latestIssue?.title || '等待日报源刷新'}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>期刊索引</span>
            <span>{issues.length} 期</span>
          </div>
          <div className="space-y-3">
            {monthGroups.map(([month, monthIssues]) => (
              <section key={month}>
                <div className="mb-1 flex items-center justify-between px-1 text-xs font-medium text-foreground">
                  <span>{month.replace('-', ' 年 ')} 月</span>
                  <span className="text-[11px] font-normal text-muted-foreground">{monthIssues.length}</span>
                </div>
                <div className="space-y-1">
                  {monthIssues.map(issue => (
                    <button
                      key={issue.id}
                      type="button"
                      className={cn(
                        'flex w-full gap-2 rounded-md px-2 py-2 text-left transition-colors',
                        issue.date === activeIssue.date
                          ? 'bg-emerald-500/12 text-foreground ring-1 ring-emerald-500/25'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                      onClick={() => setSelectedDate(issue.date)}
                    >
                      <span className="shrink-0 text-xs font-semibold tabular-nums">
                        {issue.date.slice(8, 10)} 日
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs leading-5">{issue.title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-h-0 min-w-0 overflow-y-auto rounded-md border bg-background">
        <div className="border-b bg-muted/15 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px w-10 bg-emerald-500" />
            <span>Vol.{activeIssue.date}</span>
            <span>·</span>
            <span>{issueStories.length} 条</span>
            <span>·</span>
            <span>AI HOT 日报</span>
            {isRefreshing ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                  <Loader2 className="size-3 animate-spin" />
                  {refreshMessage || '刷新中'}
                </span>
              </>
            ) : detailFetchedAtText ? (
              <>
                <span>·</span>
                <span>详情更新 {detailFetchedAtText}</span>
              </>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-2">
            <h2 className="text-4xl font-semibold leading-none tracking-normal text-foreground sm:text-6xl">
              AI<span className="text-emerald-600">HOT</span> 日报
            </h2>
            <div className="pb-1 text-sm text-muted-foreground">
              每日 08:00 北京时间发布
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CalendarDays className="size-4 text-muted-foreground" />
              {formatChineseDate(activeIssue.date)}
            </div>
            <span className="hidden h-px min-w-20 flex-1 bg-border md:block" />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs shadow-none"
              disabled={isRefreshing}
              onClick={onRefreshDaily}
            >
              {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
              刷新日报
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-background hover:text-foreground"
              onClick={() => window.open(activeIssue.url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="size-3.5" />
              打开日报
            </Button>
          </div>
          <p className="mt-5 max-w-3xl text-lg font-medium leading-8 text-foreground">
            {activeIssue.title}
          </p>
          {activeIssue.summary && activeIssue.summary !== activeIssue.title ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {activeIssue.summary}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 border-b bg-background px-5 py-3 sm:grid-cols-4">
          <DailyStat label="当期条目" value={issueStories.length} />
          <DailyStat label="当前列表" value={currentCount} />
          <DailyStat label="收藏" value={favoriteCount} />
          <DailyStat label="未读" value={unreadCount} />
        </div>

        {!isRefreshing && !activeIssueLoaded ? (
          <div className="flex items-start gap-2 border-b bg-amber-50 px-5 py-3 text-sm leading-6 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertCircle className="mt-1 size-4 shrink-0" />
            <div>
              <div className="font-medium">只拿到了日报索引，还没有拿到这期正文详情。</div>
              <div className="text-xs opacity-80">
                {activeIssue.detailError
                  ? `源站详情抓取失败：${activeIssue.detailError}`
                  : '点击刷新会继续按日报链接抓取源站详情；若源站结构或网络暂时不可用，这里会先保留索引。'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 border-b px-5 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            disabled={isGenerating}
            onClick={() => onGenerate('24h')}
          >
            {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            生成今日 Markdown
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            disabled={isSaving}
            onClick={() => onSave('24h')}
          >
            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存为笔记
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            disabled={!markdown}
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
            复制预览
          </Button>
          {markdown ? (
            <span className="ml-auto text-[11px] text-muted-foreground">Markdown 已生成，可保存为快照笔记</span>
          ) : null}
        </div>

        {issueStories.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center">
            <Layers3 className="mb-3 size-9 text-muted-foreground" />
            <div className="text-sm font-medium">当期文章还未缓存</div>
            <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              日报目录已加载。刷新后会按该期日报链接抓取源站正文详情。
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {storyGroups.map((group, groupIndex) => (
              <section key={group.tag}>
                <div className="flex items-baseline gap-3 px-5 py-5">
                  <div className="text-4xl font-semibold tabular-nums text-emerald-600">
                    {String(groupIndex + 1).padStart(2, '0')}
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">{group.tag}</h3>
                  <span className="text-xs text-muted-foreground">
                    {group.stories.length} 篇
                  </span>
                </div>
                <div className="rounded-none border-t">
                  {group.stories.map((item, index) => (
                    <StoryRow
                      key={item.id}
                      item={item}
                      index={index}
                      onSaveSnapshot={onSaveSnapshot}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
