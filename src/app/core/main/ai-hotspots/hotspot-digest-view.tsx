'use client'

import { Copy, FileText, Loader2, Save, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type HotspotDigestScope = 'current' | '24h' | '7d' | 'favorites' | 'unread'

interface HotspotDigestViewProps {
  currentCount: number
  favoriteCount: number
  unreadCount: number
  markdown: string
  isGenerating: boolean
  isSaving: boolean
  onGenerate: (scope: HotspotDigestScope) => void
  onSave: (scope: HotspotDigestScope) => void
  onCopy: () => void
}

export function HotspotDigestView({
  currentCount,
  favoriteCount,
  unreadCount,
  markdown,
  isGenerating,
  isSaving,
  onGenerate,
  onSave,
  onCopy,
}: HotspotDigestViewProps) {
  const scopes: Array<{ value: HotspotDigestScope; label: string; count: number | string }> = [
    { value: 'current', label: '当前列表', count: currentCount },
    { value: '24h', label: '24 小时', count: '日报' },
    { value: '7d', label: '7 天', count: '周报' },
    { value: 'favorites', label: '收藏', count: favoriteCount },
    { value: 'unread', label: '未读', count: unreadCount },
  ]

  return (
    <div className="grid min-h-[520px] gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section className="rounded-md border bg-background">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <Sparkles className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">摘要范围</span>
        </div>
        <div className="grid gap-1 p-2">
          {scopes.map(scope => (
            <div key={scope.value} className="rounded-md border bg-muted/10 p-2">
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                disabled={isGenerating || isSaving}
                onClick={() => onGenerate(scope.value)}
              >
                <div className="text-xs font-medium text-foreground">{scope.label}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">{scope.count}</span>
                  <span className="ml-1">条可整理</span>
                </div>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 w-full px-2 text-xs"
                disabled={isGenerating || isSaving}
                onClick={() => onSave(scope.value)}
              >
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                保存为笔记
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-background">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Markdown 预览</span>
          {isGenerating ? (
            <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              生成中
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            disabled={!markdown}
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
            复制
          </Button>
        </div>
        <Textarea
          readOnly
          value={markdown}
          placeholder="点击上方范围生成摘要预览，或直接保存为工作区 Markdown。"
          className={cn(
            'min-h-0 flex-1 resize-none rounded-none border-0 bg-muted/20 font-mono text-xs leading-5 shadow-none focus-visible:ring-0',
            !markdown && 'text-muted-foreground',
          )}
        />
      </section>
    </div>
  )
}
