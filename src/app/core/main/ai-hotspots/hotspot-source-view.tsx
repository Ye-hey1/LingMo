'use client'

import { AlertCircle, Loader2, RefreshCcw, Rss, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotSourceStatus, AiHotspotUserFeed } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'

function formatStatusTime(value: string | null) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString()
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

interface HotspotSourceViewProps {
  sources: AiHotspotSourceStatus[]
  userFeeds: AiHotspotUserFeed[]
  isRefreshing: boolean
  onRefresh: () => void
  onToggleUserFeed: (id: string, enabled: boolean) => Promise<void>
  onDeleteUserFeed: (id: string) => Promise<void>
}

export function HotspotSourceView({
  sources,
  userFeeds,
  isRefreshing,
  onRefresh,
  onToggleUserFeed,
  onDeleteUserFeed,
}: HotspotSourceViewProps) {
  const okCount = sources.filter(source => source.ok).length
  const failedCount = sources.length - okCount

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="来源" value={sources.length} />
        <Metric label="可用" value={okCount} />
        <Metric label="失败" value={failedCount} />
        <Metric label="用户 RSS" value={userFeeds.length} />
      </div>

      <section className="rounded-md border bg-background">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <Rss className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">来源状态</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            刷新
          </Button>
        </div>

        {sources.length === 0 ? (
          <div className="flex h-[220px] flex-col items-center justify-center text-center">
            <Rss className="mb-3 size-9 text-muted-foreground" />
            <div className="text-sm font-medium">暂无来源状态</div>
            <div className="mt-1 text-sm text-muted-foreground">刷新后会显示每个来源的成功状态和错误信息。</div>
          </div>
        ) : (
          sources.map(source => (
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
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                      <AlertCircle className="mt-0.5 size-3 shrink-0" />
                      <span className="line-clamp-2">{source.lastError}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="rounded-md border bg-background">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <Rss className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">用户 RSS</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{userFeeds.length} 个</span>
        </div>

        {userFeeds.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            还没有添加用户 RSS。可以在右上角设置中添加 RSS 或导入 OPML。
          </div>
        ) : (
          userFeeds.map(feed => (
            <div key={feed.id} className="flex min-w-0 items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <Switch
                checked={feed.enabled}
                onCheckedChange={(enabled) => {
                  void onToggleUserFeed(feed.id, enabled).then(() => {
                    toast({ title: enabled ? 'RSS 已启用' : 'RSS 已停用' })
                  })
                }}
                aria-label={feed.enabled ? '停用 RSS' : '启用 RSS'}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{feed.title}</div>
                <div className="mt-0.5 flex min-w-0 gap-2 text-[11px] text-muted-foreground">
                  {feed.groupName ? <span className="shrink-0">{feed.groupName}</span> : null}
                  <span className="truncate">{feed.feedUrl}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                title="删除 RSS"
                onClick={() => {
                  void onDeleteUserFeed(feed.id).then(() => {
                    toast({ title: 'RSS 已删除' })
                  })
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
