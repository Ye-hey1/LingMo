'use client'

import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Layers3,
  Loader2,
  MessageSquareText,
  Radar,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { useArticleReader } from './use-article-reader'
import { formatHotspotTime, getHotspotHost, getPrimaryHotspotTag } from './hotspot-utils'

interface HotspotReaderProps {
  item: AiHotspotItem
  relatedItems: AiHotspotItem[]
  canBack?: boolean
  onBack?: () => void
  onClose: () => void
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveSnapshot: (id: string) => void
  onAddToDigest: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
  onGenerateInsight: (id: string) => void
  onSelectRelated: (id: string) => void
}

/* --------------------------- 应用内 Markdown 渲染 --------------------------- */

const READER_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-lg font-semibold tracking-tight text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-2.5 text-base font-semibold tracking-tight text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-[15px] font-semibold text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="mb-4 text-[15px] leading-[1.85] text-foreground/90">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-5 text-[15px] leading-[1.8] text-foreground/90 marker:text-muted-foreground/60">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[15px] leading-[1.8] text-foreground/90 marker:text-muted-foreground/60">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-[14px] italic leading-relaxed text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className || '')
    if (isBlock) {
      return (
        <code className={cn('block overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-[13px] leading-6', className)}>
          {children}
        </code>
      )
    }
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{children}</code>
  },
  pre: ({ children }) => <pre className="my-4">{children}</pre>,
  img: ({ src, alt }) =>
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} loading="lazy" className="my-4 max-h-[420px] w-full rounded-lg border border-border object-contain" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-muted/50 px-2.5 py-1.5 text-left font-medium text-foreground">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2.5 py-1.5 text-foreground/90">{children}</td>,
}

const ReaderMarkdown = memo(function ReaderMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={READER_COMPONENTS}>
      {content}
    </ReactMarkdown>
  )
})

/* ------------------------------- UI 基元 ------------------------------- */

function ReaderAction({
  icon,
  label,
  active,
  destructive,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={label}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : destructive
            ? 'border-border bg-transparent text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive'
            : 'border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

function SourcePill({ item }: { item: AiHotspotItem }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Radar className="size-3 shrink-0 text-muted-foreground/70" />
      <span className="truncate">{item.sourceName}</span>
    </span>
  )
}

function ScoreChip({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        score >= 24 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
      )}
    >
      热度 {score}
    </span>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[720px] animate-pulse px-5 py-6">
      <div className="mb-5 h-4 w-1/3 rounded bg-muted" />
      <div className="mb-3 h-3 w-full rounded bg-muted" />
      <div className="mb-3 h-3 w-[95%] rounded bg-muted" />
      <div className="mb-3 h-3 w-[88%] rounded bg-muted" />
      <div className="mb-6 h-3 w-3/5 rounded bg-muted" />
      <div className="mb-3 h-3 w-full rounded bg-muted" />
      <div className="mb-3 h-3 w-[92%] rounded bg-muted" />
      <div className="mb-3 h-3 w-[78%] rounded bg-muted" />
    </div>
  )
}

function ErrorCard({
  error,
  onRetry,
  onOpenOriginal,
}: {
  error: { message: string }
  onRetry: () => void
  onOpenOriginal: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">无法在应用内加载正文</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-6 text-muted-foreground">{error.message}</p>
      <div className="mt-5 flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md text-xs shadow-none" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
        <Button variant="default" size="sm" className="h-8 gap-1.5 rounded-md text-xs" onClick={onOpenOriginal}>
          <ExternalLink className="size-3.5" />
          打开原文
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------- 阅读器主体 ------------------------------- */

export const HotspotReader = memo(function HotspotReader({
  item,
  relatedItems,
  canBack,
  onBack,
  onClose,
  onToggleFavorite,
  onMarkRead,
  onSaveSnapshot,
  onAddToDigest,
  onSendToChat,
  onDeepDive,
  onGenerateInsight,
  onSelectRelated,
}: HotspotReaderProps) {
  const { state, retry } = useArticleReader(item)

  // 打开即标记已读（与原"点击标题"行为一致）
  useEffect(() => {
    if (!item.isRead) onMarkRead(item.id, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // Esc 关闭阅读器
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const openOriginal = useCallback(() => {
    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
  }, [item.url])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(item.url)
    } catch {
      // 静默
    }
  }, [item.url])

  const host = getHotspotHost(item.url)
  const time = formatHotspotTime(item.lastSeenAt || item.publishedAt)
  const summary = item.signalSummary || item.summary || ''
  const essence = item.signalEssence || ''
  const { status, result } = state
  const showSkeleton = status === 'loading'
  const isError = status === 'error'
  const isReady = status === 'success' && result
  const needsInsight = !item.signalSummary || !item.signalEssence

  const metaLine = useMemo(
    () => [host, time, getPrimaryHotspotTag(item)].filter(Boolean),
    [host, item, time],
  )

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* 顶部固定栏 */}
      <header className="z-10 shrink-0 border-b border-border bg-background">
        <div className="flex h-11 items-center gap-2 px-3">
          {canBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden"
              title="返回列表"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-muted-foreground">
            <SourcePill item={item} />
            {host ? <span className="truncate text-muted-foreground/70">{host}</span> : null}
            <span className="inline-flex items-center gap-0.5 text-muted-foreground/70">
              <Clock className="size-3" />
              {time}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭阅读器"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 标题 + 摘要 + 操作 */}
        <div className="px-4 pb-3">
          <h1 className="text-balance text-[19px] font-semibold leading-7 tracking-tight text-foreground">
            {item.title}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ScoreChip score={item.score} />
            {!item.isRead ? (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">未读</span>
            ) : null}
            {item.isFavorite ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <Star className="size-3 fill-current" />
                已收藏
              </span>
            ) : null}
            {item.tags.slice(0, 3).map(tag => (
              <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{tag}</span>
            ))}
          </div>

          {/* AI 摘要（若有）—— 即时价值，无需等待抓取 */}
          {summary ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                内容摘要
              </div>
              <p className="text-[13px] leading-6 text-foreground/80">{summary}</p>
              {essence ? (
                <p className="mt-2 border-t border-border pt-2 text-[13px] leading-6 text-muted-foreground">{essence}</p>
              ) : null}
            </div>
          ) : null}

          {/* 操作工具栏 */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <ReaderAction
              icon={<Star className={cn('size-3.5', item.isFavorite && 'fill-current')} />}
              label={item.isFavorite ? '已收藏' : '收藏'}
              active={item.isFavorite}
              onClick={() => onToggleFavorite(item.id)}
            />
            <ReaderAction
              icon={<Save className="size-3.5" />}
              label={item.savedNotePath ? '快照' : '沉淀'}
              onClick={() => onSaveSnapshot(item.id)}
            />
            {needsInsight ? (
              <ReaderAction
                icon={<WandSparkles className="size-3.5" />}
                label="AI 摘要"
                onClick={() => onGenerateInsight(item.id)}
              />
            ) : null}
            <ReaderAction
              icon={<FileText className="size-3.5" />}
              label="日报"
              onClick={() => onAddToDigest(item.id)}
            />
            <ReaderAction
              icon={<MessageSquareText className="size-3.5" />}
              label="聊天"
              onClick={() => onSendToChat(item.id)}
            />
            <ReaderAction
              icon={<Search className="size-3.5" />}
              label="深挖"
              onClick={() => onDeepDive(item.id)}
            />
            <ReaderAction
              icon={<Copy className="size-3.5" />}
              label="复制链接"
              onClick={copyLink}
            />
            {/* 显式可选跳转：原文链接 */}
            <button
              type="button"
              onClick={openOriginal}
              title={`在浏览器中打开：${host}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <ExternalLink className="size-3.5" />
              原文链接
            </button>
          </div>
        </div>
      </header>

      {/* 正文区 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[720px] px-5 py-6">
          {showSkeleton ? <LoadingSkeleton /> : null}

          {isError ? (
            <ErrorCard error={state.error ?? { message: '未知错误' }} onRetry={retry} onOpenOriginal={openOriginal} />
          ) : null}

          {isReady && result ? (
            <>
              {result.thin ? (
                <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    该页面正文较短，可能受付费墙或动态渲染限制。可
                    <button type="button" onClick={openOriginal} className="mx-0.5 underline underline-offset-2 hover:opacity-80">
                      打开原文
                    </button>
                    查看完整内容。
                  </span>
                </div>
              ) : null}
              <article className="reader-prose">
                <ReaderMarkdown content={result.markdown} />
              </article>
            </>
          ) : null}

          {/* 正文末尾的元信息 + 相关信号 */}
          {!showSkeleton ? (
            <footer className="mt-8 border-t border-border pt-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                {metaLine.map((text, index) => (
                  <span key={index} className="inline-flex items-center gap-1">
                    {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
                    {text}
                  </span>
                ))}
              </div>

              {relatedItems.length > 0 ? (
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                    <Layers3 className="size-3.5 text-muted-foreground" />
                    相关信号
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {relatedItems.map(related => (
                      <button
                        key={related.id}
                        type="button"
                        onClick={() => onSelectRelated(related.id)}
                        className="group rounded-lg border border-border bg-background p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
                      >
                        <div className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground group-hover:text-primary">{related.title}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {related.sourceName} · {formatHotspotTime(related.lastSeenAt || related.publishedAt)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </footer>
          ) : null}
        </div>
      </ScrollArea>

      {/* 抓取状态指示（轻量） */}
      {showSkeleton ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          <Loader2 className="size-3 animate-spin" />
          正在抓取正文
        </div>
      ) : null}
    </section>
  )
})
