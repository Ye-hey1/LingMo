'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Clock,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  Layers3,
  Loader2,
  Newspaper,
  RefreshCcw,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'
import { getHotspotHost, getPrimaryHotspotTag } from './hotspot-utils'
import { useArticleReader } from './use-article-reader'

export type HotspotDigestScope = 'current' | '24h' | '7d' | 'favorites' | 'unread'

function openExternalUrl(url: string) {
  if (!url) return
  void openUrl(url).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
  })
}

interface HotspotDigestViewProps {
  items: AiHotspotItem[]
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

const OUTPUT_PREVIEW_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-4 text-xl font-semibold leading-7 text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-4 text-base font-semibold leading-6 text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold leading-5 text-foreground">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-sm leading-6 text-foreground/90">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/90 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-foreground/90 marker:text-muted-foreground">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">{children}</blockquote>,
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className || '')
    if (isBlock) {
      return <code className={cn('block overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[12px] leading-5', className)}>{children}</code>
    }
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
  },
  pre: ({ children }) => <pre className="my-3">{children}</pre>,
  hr: () => <hr className="my-5 border-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/50 px-2 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 text-muted-foreground">{children}</td>,
  img: ({ src, alt }) =>
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} loading="lazy" className="my-4 max-h-[420px] w-full rounded-md border object-contain" />,
}

function StoryRow({
  active,
  item,
  index,
  onSelect,
  onSaveSnapshot,
  onToggleFavorite,
}: {
  active?: boolean
  item: AiHotspotItem
  index: number
  onSelect: (id: string) => void
  onSaveSnapshot: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const host = getHotspotHost(item.url)
  const summary = item.signalSummary || item.summary
  const dailyMeta = getDailyArticleMeta(item)

  return (
    <article className={cn('group border-t px-4 py-4 first:border-t-0', active && 'bg-emerald-500/5')}>
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
          <button
            type="button"
            aria-label={`在当前界面查看：${item.title}`}
            className="mt-2 block w-full break-words text-left text-base font-semibold leading-7 text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => onSelect(item.id)}
          >
            {item.title}
          </button>
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
              onClick={() => onSelect(item.id)}
            >
              <Eye className="size-3.5" />
              查看
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

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-10/12 animate-pulse rounded bg-muted" />
      <div className="h-4 w-8/12 animate-pulse rounded bg-muted" />
      <div className="mt-5 h-32 w-full animate-pulse rounded-md bg-muted" />
    </div>
  )
}

function DailyStoryDetail({
  item,
  onBack,
  onSaveSnapshot,
  onToggleFavorite,
}: {
  item: AiHotspotItem
  onBack: () => void
  onSaveSnapshot: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const { state, retry } = useArticleReader(item)
  const host = getHotspotHost(item.url)
  const summary = item.signalSummary || item.summary
  const dailyMeta = getDailyArticleMeta(item)
  const timeText = item.publishedAt ? new Date(item.publishedAt).toLocaleString() : ''
  const isLoading = state.status === 'loading'
  const isError = state.status === 'error'
  const result = state.status === 'success' ? state.result : null

  return (
    <div className="min-h-0">
      <div className="border-b bg-background px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            返回日报
          </Button>
          <span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground">
            {dailyMeta.articleRole || item.feedName.replace(/^AI HOT\s*/, '')}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {dailyMeta.sectionTitle || getPrimaryHotspotTag(item)}
          </span>
          {host ? <span className="text-[11px] text-muted-foreground">{host}</span> : null}
          {timeText ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" />
              {timeText}
            </span>
          ) : null}
        </div>

        <h2 className="text-xl font-semibold leading-8 text-foreground">{item.title}</h2>
        {summary ? (
          <p className="mt-2 rounded-md border bg-muted/25 px-3 py-2 text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            variant={item.isFavorite ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs shadow-none"
            onClick={() => onToggleFavorite(item.id)}
          >
            <Sparkles className={cn('size-3.5', item.isFavorite && 'fill-current')} />
            {item.isFavorite ? '已收藏' : '收藏'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            onClick={() => onSaveSnapshot(item.id)}
          >
            {item.savedNotePath ? <Bookmark className="size-3.5" /> : <FileText className="size-3.5" />}
            {item.savedNotePath ? '快照' : '保存'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            onClick={() => openExternalUrl(item.url)}
          >
            <ExternalLink className="size-3.5" />
            外部浏览器
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[760px] px-5 py-6">
        {isLoading ? <DetailSkeleton /> : null}

        {isError ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-1 size-4 shrink-0" />
              <div>
                <div className="font-medium">正文暂时没有抓取成功</div>
                <div className="mt-1 text-xs opacity-80">{state.error?.message || '该页面可能限制抓取或需要动态渲染。'}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs shadow-none" onClick={retry}>
                    <RefreshCcw className="size-3.5" />
                    重试
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs shadow-none" onClick={() => openExternalUrl(item.url)}>
                    <ExternalLink className="size-3.5" />
                    外部浏览器
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {result ? (
          <>
            {result.thin ? (
              <div className="mb-5 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>正文较短，可能受源站动态渲染或访问限制影响。</span>
              </div>
            ) : null}
            <article className="ai-hotspots-output-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={OUTPUT_PREVIEW_COMPONENTS}>
                {result.markdown}
              </ReactMarkdown>
            </article>
          </>
        ) : null}
      </div>
    </div>
  )
}

function HotspotOutputWorkspace({
  className,
  isGenerating,
  isSaving,
  markdown,
  onCopy,
  onGenerate,
  onSave,
}: {
  className?: string
  isGenerating: boolean
  isSaving: boolean
  markdown: string
  onCopy: () => void
  onGenerate: (scope: HotspotDigestScope) => void
  onSave: (scope: HotspotDigestScope) => void
}) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const trimmedMarkdown = markdown.trim()
  const lineCount = trimmedMarkdown ? trimmedMarkdown.split(/\r?\n/).length : 0
  const charCount = trimmedMarkdown.length
  const scopeOptions: Array<{ scope: HotspotDigestScope; label: string }> = [
    { scope: '24h', label: '今日' },
    { scope: 'current', label: '当前' },
    { scope: 'favorites', label: '收藏' },
    { scope: 'unread', label: '未读' },
    { scope: '7d', label: '7 天' },
  ]

  return (
    <aside className={cn('flex min-h-[360px] min-w-0 flex-col rounded-md border bg-background', className)}>
      <div className="shrink-0 border-b px-4 py-3 pr-12">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <FileText className="size-4 text-muted-foreground" />
              Markdown 草稿
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {trimmedMarkdown ? `${lineCount} 行 · ${charCount} 字符` : '生成后可预览、复制或保存'}
            </div>
          </div>
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
            <button
              type="button"
              className={cn(
                'flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                mode === 'preview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode('preview')}
            >
              <Eye className="size-3.5" />
              预览
            </button>
            <button
              type="button"
              className={cn(
                'flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                mode === 'source' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode('source')}
            >
              <Code2 className="size-3.5" />
              源码
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1">
          {scopeOptions.map(option => (
            <button
              key={option.scope}
              type="button"
              className="h-7 rounded-md border border-border/70 bg-background/70 text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted hover:text-foreground active:scale-[0.98]"
              disabled={isGenerating}
              onClick={() => onGenerate(option.scope)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {trimmedMarkdown ? (
          mode === 'preview' ? (
            <div className="ai-hotspots-output-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={OUTPUT_PREVIEW_COMPONENTS}>
                {trimmedMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-[12px] leading-5 text-foreground/90">
              {trimmedMarkdown}
            </pre>
          )
        ) : (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed bg-muted/20 px-4 text-center">
            <FileText className="mb-3 size-9 text-muted-foreground/65" />
            <div className="text-sm font-medium text-foreground">还没有 Markdown 草稿</div>
            <div className="mt-1 max-w-[260px] text-xs leading-5 text-muted-foreground">
              选择范围生成后，会在这里预览整理好的日报草稿，并可保存为笔记。
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
          disabled={isGenerating}
          onClick={() => onGenerate('24h')}
        >
          {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          生成
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
          disabled={!trimmedMarkdown}
          onClick={onCopy}
        >
          <Copy className="size-3.5" />
          复制
        </Button>
        <Button
          variant="default"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2 text-xs shadow-none"
          disabled={isSaving || !trimmedMarkdown}
          onClick={() => onSave('24h')}
        >
          {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          保存
        </Button>
      </div>
    </aside>
  )
}

export function HotspotDigestView({
  items,
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
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)
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
  const selectedStory = selectedStoryId
    ? issueStories.find(story => story.id === selectedStoryId) || null
    : null
  const latestIssue = issues[0]
  const monthGroups = groupIssuesByMonth(issues)
  const activeIssueLoaded = issueStories.length > 0
  const detailFetchedAtText = formatDetailFetchedAt(activeIssue?.detailFetchedAt || '')
  const [draftOpen, setDraftOpen] = useState(false)
  const openDraftAfterGenerate = (scope: HotspotDigestScope) => {
    onGenerate(scope)
    setDraftOpen(true)
  }
  const selectIssue = (date: string) => {
    setSelectedDate(date)
    setSelectedStoryId(null)
    contentRef.current?.scrollTo({ top: 0 })
  }

  useEffect(() => {
    if (selectedStoryId && !issueStories.some(story => story.id === selectedStoryId)) {
      setSelectedStoryId(null)
    }
  }, [issueStories, selectedStoryId])

  useEffect(() => {
    if (selectedStoryId) {
      contentRef.current?.scrollTo({ top: 0 })
    }
  }, [selectedStoryId])

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
                      onClick={() => selectIssue(issue.date)}
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

      <section ref={contentRef} className="min-h-0 min-w-0 overflow-y-auto rounded-md border bg-background">
        <div className="border-b bg-muted/15 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold leading-6 text-foreground">
                  AI<span className="text-emerald-600"> HOT </span>日报
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md border bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                  {formatChineseDate(activeIssue.date)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 max-w-3xl text-sm font-medium leading-6 text-foreground">
                {activeIssue.title}
              </p>
              {activeIssue.summary && activeIssue.summary !== activeIssue.title ? (
                <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">
                  {activeIssue.summary}
                </p>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-background hover:text-foreground"
              onClick={() => openExternalUrl(activeIssue.url)}
            >
              <ExternalLink className="size-3.5" />
              外部打开日报
            </Button>
          </div>
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
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs shadow-none"
            onClick={() => setDraftOpen(true)}
          >
            <FileText className="size-3.5" />
            Markdown 草稿
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            disabled={isGenerating}
            onClick={() => openDraftAfterGenerate('24h')}
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

        {selectedStory ? (
          <DailyStoryDetail
            item={selectedStory}
            onBack={() => setSelectedStoryId(null)}
            onSaveSnapshot={onSaveSnapshot}
            onToggleFavorite={onToggleFavorite}
          />
        ) : issueStories.length === 0 ? (
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
                      active={selectedStoryId === item.id}
                      item={item}
                      index={index}
                      onSelect={setSelectedStoryId}
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

      <Sheet open={draftOpen} onOpenChange={setDraftOpen}>
        <SheetContent side="right" className="w-[min(520px,calc(100vw-24px))] p-0 sm:max-w-[520px]" hideCloseButton>
          <SheetTitle className="sr-only">Markdown 草稿</SheetTitle>
          <SheetClose asChild>
            <button
              type="button"
              className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="关闭 Markdown 草稿"
            >
              <X className="size-4" />
            </button>
          </SheetClose>
          <HotspotOutputWorkspace
            className="h-full min-h-0 rounded-none border-0"
            markdown={markdown}
            isGenerating={isGenerating}
            isSaving={isSaving}
            onGenerate={onGenerate}
            onSave={onSave}
            onCopy={onCopy}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}
