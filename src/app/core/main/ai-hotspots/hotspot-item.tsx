'use client'

import { memo, type ReactNode } from 'react'
import {
  ArchiveRestore,
  BookOpenCheck,
  Clock,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FileText,
  MessageSquareText,
  Radar,
  Save,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { prefetchArticle } from '@/lib/web/fetch-article'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { formatHotspotTime, getPrimaryHotspotTag } from './hotspot-utils'
import type { HotspotViewMode } from './hotspot-filter-bar'

interface HotspotItemProps {
  featured?: boolean
  item: AiHotspotItem
  query?: string
  selected?: boolean
  selectable?: boolean
  checked?: boolean
  trashMode?: boolean
  viewMode?: HotspotViewMode
  onCheckedChange?: (id: string, checked: boolean) => void
  onSelect?: (id: string) => void
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveSnapshot: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
  onAddToDigest: (id: string) => void
  onIgnore: (id: string, ignored: boolean) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onGenerateInsight: (id: string) => void
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightText({ text, query }: { text: string; query?: string }) {
  const words = query?.trim().split(/\s+/).filter(Boolean).slice(0, 6) || []
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'ig')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, index) => (
        words.some(word => part.toLowerCase() === word.toLowerCase()) ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber-400/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      ))}
    </>
  )
}

function IconBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? 'text-amber-500' : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground',
      )}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {children}
    </button>
  )
}

function SourceBadge({ item }: { item: AiHotspotItem }) {
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Radar className="size-2.5 shrink-0 text-muted-foreground/60" />
      <span className="truncate">{item.sourceName}</span>
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 24) {
    return <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-600 dark:text-amber-400">{score}</span>
  }
  return <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{score}</span>
}

function MetaLine({ item }: { item: AiHotspotItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
      <span className="inline-flex items-center gap-0.5">
        <Clock className="size-3" />
        {formatHotspotTime(item.lastSeenAt || item.publishedAt)}
      </span>
      <span className="rounded bg-muted px-1 py-0.5">{getPrimaryHotspotTag(item)}</span>
      {item.tags.slice(1, 3).map(tag => (
        <span key={tag} className="rounded bg-muted/60 px-1 py-0.5">{tag}</span>
      ))}
    </div>
  )
}

export const HotspotItem = memo(function HotspotItem({
  featured: _featured,
  item,
  query,
  selected,
  selectable,
  checked,
  trashMode,
  viewMode: _viewMode = 'list',
  onCheckedChange,
  onSelect,
  onToggleFavorite,
  onMarkRead,
  onSaveSnapshot,
  onSendToChat,
  onDeepDive,
  onAddToDigest,
  onIgnore: _onIgnore,
  onDelete,
  onRestore,
  onGenerateInsight: _onGenerateInsight,
}: HotspotItemProps) {
  const markRead = () => { if (!item.isRead) onMarkRead(item.id, true) }
  const openOriginal = (e: React.MouseEvent) => {
    e.stopPropagation()
    markRead()
    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
  }
  const handlePrefetch = () => prefetchArticle(item.url)

  return (
    <article
      onMouseEnter={handlePrefetch}
      className={cn(
        'group relative cursor-pointer rounded-lg border bg-card transition-colors duration-150',
        selected || checked
          ? 'border-primary/40 bg-primary/[0.03]'
          : 'border-border hover:border-foreground/15 hover:bg-muted/40',
      )}
      onClick={() => {
        markRead()
        onSelect?.(item.id)
      }}
    >
      {/* 选择框 */}
      {selectable && (
        <div className={cn(
          'absolute left-2.5 top-2.5 z-10 transition-opacity',
          checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}>
          <Checkbox
            checked={checked}
            className="border-muted-foreground/40 bg-background"
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(v) => onCheckedChange?.(item.id, v === true)}
          />
        </div>
      )}

      <div className="flex items-start gap-3 p-3.5">
        {/* 左侧：来源图标 */}
        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
          {(item.sourceName || 'AI').slice(0, 2).toUpperCase()}
          {!item.isRead && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" />}
        </div>

        {/* 中间：内容区 */}
        <div className="min-w-0 flex-1">
          {/* 来源行 */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <SourceBadge item={item} />
            {item.feedName !== item.sourceName && (
              <span className="max-w-[120px] truncate text-[11px] text-muted-foreground/50">{item.feedName}</span>
            )}
          </div>

          {/* 标题：点击在应用内阅读 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); markRead(); onSelect?.(item.id) }}
            className="block w-full text-left text-[14px] font-semibold leading-5 text-foreground transition-colors hover:text-primary"
          >
            {!item.isRead && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />}
            <HighlightText text={item.title} query={query} />
          </button>

          {/* 摘要 */}
          {(item.signalSummary || item.summary) && (
            <p className="mt-1.5 line-clamp-1 text-[13px] leading-5 text-muted-foreground/90">
              {item.signalSummary || item.summary}
            </p>
          )}

          {/* 元信息 */}
          <div className="mt-2">
            <MetaLine item={item} />
          </div>
        </div>

        {/* 右侧：评分 + 操作按钮 */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ScoreBadge score={item.score} />
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconBtn label="收藏" active={item.isFavorite} onClick={() => onToggleFavorite(item.id)}>
              <Star className={cn('size-3.5', item.isFavorite && 'fill-current')} />
            </IconBtn>
            <IconBtn label="沉淀" onClick={() => onSaveSnapshot(item.id)}>
              <Save className="size-3.5" />
            </IconBtn>
            {/* 显式可选：在浏览器打开原文 */}
            <button
              type="button"
              title="在浏览器中打开原文"
              aria-label="在浏览器中打开原文"
              onClick={openOriginal}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <EllipsisVertical className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { markRead(); onSelect?.(item.id) }}>
                  <BookOpenCheck className="size-4" /> 应用内阅读
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openOriginal}>
                  <ExternalLink className="size-4" /> 在浏览器打开
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMarkRead(item.id, !item.isRead)}>
                  <BookOpenCheck className="size-4" /> {item.isRead ? '标记未读' : '标记已读'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAddToDigest(item.id)}>
                  <FileText className="size-4" /> 加入日报
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSendToChat(item.id)}>
                  <MessageSquareText className="size-4" /> 发送到聊天
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDeepDive(item.id)}>
                  <Search className="size-4" /> 深挖
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigator.clipboard?.writeText(item.url)}>
                  <Copy className="size-4" /> 复制链接
                </DropdownMenuItem>
                {trashMode ? (
                  <DropdownMenuItem onClick={() => onRestore(item.id)}>
                    <ArchiveRestore className="size-4" /> 恢复
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(item.id)}>
                    <Trash2 className="size-4" /> 删除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </article>
  )
})
