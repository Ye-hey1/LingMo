'use client'

import { useEffect, useMemo } from 'react'
import { ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import emitter from '@/lib/emitter'
import useCreativeCanvasStore from '@/stores/creative-canvas'

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function CreativeCanvasSidebarPanel() {
  const {
    loading,
    error,
    projects,
    project,
    assets,
    jobs,
    ensureReady,
  } = useCreativeCanvasStore()

  useEffect(() => {
    void ensureReady()
  }, [ensureReady])

  const imageAssets = useMemo(() => assets.filter(asset => asset.kind === 'image'), [assets])
  const recentJobs = useMemo(() => jobs.slice(0, 4), [jobs])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="space-y-3 border-b border-border p-3">
        <Button className="h-9 w-full justify-start gap-2" onClick={() => emitter.emit('open-creative-canvas', undefined)}>
          <Sparkles className="size-4" />
          打开创意画布
        </Button>
        {error ? <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div> : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">当前画布</div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="truncate text-sm font-medium">{project?.title || '创意画布'}</div>
              <div className="mt-1 text-xs text-muted-foreground">{projects.length} 个项目 · {imageAssets.length} 个图片素材</div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">最近任务</div>
            {recentJobs.length ? (
              <div className="space-y-1.5">
                {recentJobs.map(job => (
                  <div key={job.id} className="rounded-md border border-border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate">{job.prompt || job.id}</span>
                      <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0 text-[10px]">
                        {job.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{formatRelativeTime(job.updatedAt || job.createdAt)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                生成结果会显示在弹窗里
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

export default CreativeCanvasSidebarPanel
