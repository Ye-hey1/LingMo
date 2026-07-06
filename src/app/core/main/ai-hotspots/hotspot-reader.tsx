'use client'

import { Children, isValidElement, memo, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { openUrl } from '@tauri-apps/plugin-opener'
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
  MoreHorizontal,
  Radar,
  RefreshCw,
  Save,
  Search,
  Star,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import type { ArticleFetchResult } from '@/lib/web/fetch-article'
import { captureWechatArticleToMark } from '@/lib/wechat-article-capture'
import { isWechatArticleUrl } from '@/lib/wechat-article'
import { useArticleReader } from './use-article-reader'
import { formatHotspotDateTime, getDisplayHotspotTags, getHotspotDisplayTimeValue, getHotspotHost } from './hotspot-utils'

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

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="my-5 max-w-full overflow-x-auto rounded-md border border-border bg-muted/50 p-4 font-mono text-[13px] leading-6 text-foreground">
      {children}
    </pre>
  )
}

function isCodeElement(child: ReactNode): child is ReactElement<{ children?: ReactNode }> {
  return isValidElement(child) && child.type === 'code'
}

function getProxiedWechatImageSrc(value?: string) {
  if (!value) return undefined
  const src = value.replace(/&amp;/g, '&')
  try {
    const url = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (url.protocol === 'https:' && ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'].includes(url.hostname)) {
      return url.toString()
    }
  } catch {
    return value
  }
  return value
}

const READER_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-8 text-[22px] font-semibold leading-8 tracking-tight text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-8 text-[19px] font-semibold leading-7 tracking-tight text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2.5 mt-7 text-[17px] font-semibold leading-6 text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-6 text-[15px] font-semibold leading-6 text-foreground">{children}</h4>,
  p: ({ children }) => {
    const childList = Children.toArray(children)
    if (childList.length === 1 && isCodeElement(childList[0])) {
      return (
        <CodeBlock>
          <code>{childList[0].props.children}</code>
        </CodeBlock>
      )
    }
    return <p className="mb-5 text-[16px] leading-[1.9] text-foreground/90">{children}</p>
  },
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
  ul: ({ children }) => <ul className="mb-5 list-disc space-y-2 pl-5 text-[16px] leading-[1.85] text-foreground/90 marker:text-muted-foreground/60">{children}</ul>,
  ol: ({ children }) => <ol className="mb-5 list-decimal space-y-2 pl-5 text-[16px] leading-[1.85] text-foreground/90 marker:text-muted-foreground/60">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-7 border-y border-border/70 py-4 text-[16px] italic leading-[1.85] text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-border/80" />,
  code: ({ className, children }) => {
    const isLanguageCode = /language-/.test(className || '')
    return (
      <code className={cn(
        isLanguageCode
          ? 'font-mono text-[13px]'
          : 'rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground',
        className,
      )}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  img: ({ src, alt }) =>
    // eslint-disable-next-line @next/next/no-img-element
    <img src={getProxiedWechatImageSrc(typeof src === 'string' ? src : undefined)} alt={alt || ''} loading="lazy" className="my-7 max-h-[520px] w-full rounded-md object-contain" />,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-md border border-border">
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
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={label}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]',
        active
          ? 'bg-primary/10 text-primary'
          : destructive
            ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="sr-only">{label}</span>
    </button>
  )
}

function SourcePill({ item }: { item: AiHotspotItem }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Radar className="size-3 shrink-0 text-muted-foreground/70" />
      <span className="truncate">{item.sourceName}</span>
    </span>
  )
}

function proxyWechatImages(html: string) {
  return html
    .replace(/\sdata-src=(["'])(.*?)\1/gi, (_match, quote, src) => ` src=${quote}${src}${quote}`)
    .replace(/(src|data-backsrc)=(["'])(https:\/\/mmbiz\.(?:qpic|qlogo)\.cn\/[^"']+)\2/gi, (_match, attr, quote, src) => {
      return `${attr}=${quote}${getProxiedWechatImageSrc(src) || src}${quote}`
    })
    .replace(/(src|data-backsrc)=(["'])\/\/(mmbiz\.(?:qpic|qlogo)\.cn\/[^"']+)\2/gi, (_match, attr, quote, src) => {
      return `${attr}=${quote}${getProxiedWechatImageSrc(`https://${src}`) || `https://${src}`}${quote}`
    })
}

function buildReaderHtml(content: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; background: transparent; color: #1f2328; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 16px;
      line-height: 1.85;
      overflow-wrap: anywhere;
    }
    img { display: block; max-width: 100% !important; width: auto !important; height: auto !important; margin: 18px auto; border-radius: 6px; }
    img[src=""], img:not([src]) { display: none !important; }
    section, p, div { max-width: 100% !important; min-height: 0 !important; box-sizing: border-box; }
    section:empty, p:empty, div:empty, span:empty { display: none !important; }
    table { max-width: 100%; border-collapse: collapse; overflow-x: auto; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
    * { max-width: 100%; }
  </style>
</head>
<body>${proxyWechatImages(content)}
<script>
  (function () {
    function cleanup() {
      document.querySelectorAll('img').forEach(function (img) {
        if (!img.getAttribute('src')) img.style.display = 'none';
        img.onerror = function () { img.style.display = 'none'; reportHeight(); };
        img.onload = reportHeight;
      });
      document.querySelectorAll('p, section, div, span').forEach(function (node) {
        if (!node.textContent.trim() && !node.querySelector('img, table, video, svg')) {
          node.style.display = 'none';
        }
      });
      reportHeight();
    }
    function reportHeight() {
      requestAnimationFrame(function () {
        window.parent.postMessage({
          type: 'lingmo-wechat-reader-height',
          height: Math.max(
            document.documentElement.scrollHeight || 0,
            document.body.scrollHeight || 0
          )
        }, '*');
      });
    }
    window.addEventListener('load', cleanup);
    cleanup();
    setTimeout(reportHeight, 300);
    setTimeout(reportHeight, 1200);
  })();
</script>
</body>
</html>`
}

function getWechatInlineResult(item: AiHotspotItem): ArticleFetchResult | null {
  if (!isWechatArticleUrl(item.url)) return null
  const html = typeof item.meta?.wechatContentHtml === 'string'
    ? item.meta.wechatContentHtml.trim()
    : typeof item.meta?.contentHtml === 'string'
      ? item.meta.contentHtml.trim()
      : ''
  const markdown = typeof item.meta?.wechatContentMarkdown === 'string'
    ? item.meta.wechatContentMarkdown.trim()
    : typeof item.meta?.contentMarkdown === 'string'
      ? item.meta.contentMarkdown.trim()
      : ''
  const summary = (item.summary || item.signalSummary || item.signalEssence || '').trim()
  const body = markdown || [
    summary || '这篇微信公众号文章暂时只有 RSS 摘要，后台会继续补采正文。',
    '',
    `[打开原文](${item.url})`,
  ].join('\n')

  return {
    url: item.url,
    host: getHotspotHost(item.url),
    title: item.title,
    description: summary || '微信公众号文章正文将在后台尝试补采。',
    html,
    markdown: body,
    excerpt: summary || body.slice(0, 500),
    thin: !markdown,
  }
}

function ReaderHtmlFrame({ html }: { html: string }) {
  const documentHtml = useMemo(() => buildReaderHtml(html), [html])
  const [height, setHeight] = useState(700)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'lingmo-wechat-reader-height') return
      const nextHeight = Number(event.data.height)
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return
      setHeight(Math.max(360, Math.min(20000, nextHeight + 24)))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return (
    <iframe
      title="公众号正文"
      sandbox="allow-same-origin allow-popups"
      srcDoc={documentHtml}
      className="block w-full border-0 bg-transparent"
      style={{ height }}
      onLoad={(event) => {
        const doc = event.currentTarget.contentDocument
        const nextHeight = Math.max(
          520,
          Math.min(20000, doc?.documentElement.scrollHeight || doc?.body.scrollHeight || 700),
        )
        setHeight(nextHeight + 24)
      }}
    />
  )
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] animate-pulse px-6 py-10">
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
  isCapturingWechat,
  onCaptureWechat,
  onRetry,
  onOpenOriginal,
}: {
  error: { message: string }
  isCapturingWechat?: boolean
  onCaptureWechat?: () => void
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
        {onCaptureWechat ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-md text-xs shadow-none"
            disabled={isCapturingWechat}
            onClick={onCaptureWechat}
          >
            {isCapturingWechat ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存到公众号文章
          </Button>
        ) : null}
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
  onSelectRelated,
}: HotspotReaderProps) {
  const { state, retry } = useArticleReader(item)
  const [isCapturingWechat, setIsCapturingWechat] = useState(false)

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
    if (!item.url) return
    void openUrl(item.url).catch(() => {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    })
  }, [item.url])

  const handleCaptureWechat = useCallback(async () => {
    if (!item.url || isCapturingWechat) return
    setIsCapturingWechat(true)
    try {
      await captureWechatArticleToMark(item.url)
      toast({
        title: '公众号文章已保存',
        description: '已复用链接工具保存到记录库，正在重新打开本地正文。',
      })
      retry()
    } catch (error) {
      toast({
        title: '保存公众号文章失败',
        description: error instanceof Error ? error.message : '微信仍返回访问限制，可在链接工具中粘贴 HTML 兜底保存。',
        variant: 'destructive',
      })
    } finally {
      setIsCapturingWechat(false)
    }
  }, [isCapturingWechat, item.url, retry])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(item.url)
    } catch {
      // 静默
    }
  }, [item.url])

  const host = getHotspotHost(item.url)
  const time = formatHotspotDateTime(getHotspotDisplayTimeValue(item))
  const { status, result } = state
  const readerItem = state.item || item
  const wechatInlineResult = useMemo(() => getWechatInlineResult(readerItem), [readerItem])
  const displayResult = result || wechatInlineResult
  const showSkeleton = status === 'loading' && !displayResult
  const isError = status === 'error' && !displayResult
  const isReady = Boolean(displayResult)
  const displayTags = useMemo(() => getDisplayHotspotTags(item, 5), [item])
  const isWechatItem = isWechatArticleUrl(item.url)
  const thinReason = state.error?.message?.trim()

  const metaLine = useMemo(
    () => [host, time].filter(Boolean),
    [host, time],
  )

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="z-10 shrink-0 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-[980px] items-center gap-2 px-5 lg:px-8">
          {canBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              title="返回列表"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground">
            <SourcePill item={item} />
            {host ? <span className="truncate text-muted-foreground/70">{host}</span> : null}
            <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground/70">
              <Clock className="size-3" />
              {time}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            title="关闭阅读器"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mx-auto w-full max-w-[980px] px-5 pb-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="max-w-[780px] text-balance text-[26px] font-semibold leading-[1.22] tracking-tight text-foreground">
                {item.title}
              </h1>

              {displayTags.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {displayTags.map(tag => (
                    <span key={tag} className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">#{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex w-fit max-w-full items-center gap-1 rounded-lg border border-border/80 bg-muted/25 p-1">
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
              <ReaderAction
                icon={<Copy className="size-3.5" />}
                label="复制链接"
                onClick={copyLink}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="更多操作"
                    title="更多操作"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => onAddToDigest(item.id)}>
                    <FileText className="size-4" />
                    加入日报
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSendToChat(item.id)}>
                    <MessageSquareText className="size-4" />
                    发送到聊天
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDeepDive(item.id)}>
                    <Search className="size-4" />
                    深挖主题
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={openOriginal}
                aria-label="打开原文"
                title={`在浏览器中打开：${host || '原文'}`}
                className="inline-flex size-8 items-center justify-center rounded-md bg-foreground text-background transition-colors hover:bg-foreground/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]"
              >
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[780px] px-6 py-10">
          {showSkeleton ? <LoadingSkeleton /> : null}

          {isError ? (
            <ErrorCard
              error={state.error ?? { message: '未知错误' }}
              isCapturingWechat={isCapturingWechat}
              onCaptureWechat={isWechatItem ? handleCaptureWechat : undefined}
              onRetry={retry}
              onOpenOriginal={openOriginal}
            />
          ) : null}

          {isReady && displayResult ? (
            <>
              {displayResult.thin ? (
                <div className="mb-7 flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {thinReason || '该页面正文较短，可能受登录、付费墙或动态渲染限制。'}
                    可
                    <button type="button" onClick={openOriginal} className="mx-0.5 underline underline-offset-2 hover:opacity-80">
                      打开原文
                    </button>
                    查看完整内容。
                  </span>
                </div>
              ) : null}
              {displayResult.html ? (
                <ReaderHtmlFrame html={displayResult.html} />
              ) : (
                <article className="reader-prose">
                  <ReaderMarkdown content={displayResult.markdown} />
                </article>
              )}
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
                {displayTags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 text-muted-foreground/70">#{tag}</span>
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
                          {related.sourceName} · {formatHotspotDateTime(getHotspotDisplayTimeValue(related))}
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
          {isWechatItem ? '正在抓取公众号正文' : '正在获取文章正文'}
        </div>
      ) : null}
    </section>
  )
})
