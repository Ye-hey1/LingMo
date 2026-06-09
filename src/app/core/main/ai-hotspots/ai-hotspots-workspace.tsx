'use client'

import { useEffect } from 'react'
import { Loader2, Newspaper, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAiHotspotsStore } from '@/stores/ai-hotspots'

function formatRefreshTime(value: string | null) {
  if (!value) return '尚未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刷新时间未知'
  return `上次刷新 ${date.toLocaleString()}`
}

export function AiHotspotsWorkspace() {
  const {
    filteredItems,
    isLoading,
    isRefreshing,
    lastRefreshAt,
    error,
    refreshProgress,
    load,
    refresh,
  } = useAiHotspotsStore()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <Newspaper className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">AI 热点</span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
          {formatRefreshTime(lastRefreshAt)}
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
      </header>

      {error ? (
        <div className="shrink-0 border-b border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 bg-muted/20">
        <main className="mx-auto flex min-h-[360px] w-full max-w-5xl flex-col px-4 py-4">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在加载本地缓存
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-md border bg-background text-center">
              <Newspaper className="mb-3 size-10 text-muted-foreground" />
              <div className="text-sm font-medium">暂无 AI 热点缓存</div>
              <div className="mt-1 max-w-md text-sm text-muted-foreground">
                {isRefreshing ? refreshProgress?.message || '正在刷新来源' : '点击刷新后会从默认来源和 RSS 中聚合最新动态。'}
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
              已加载 {filteredItems.length} 条缓存，完整信息流界面将在下一步接入。
            </div>
          )}
        </main>
      </ScrollArea>
    </div>
  )
}
