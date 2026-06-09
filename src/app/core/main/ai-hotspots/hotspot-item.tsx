'use client'

import type { ReactNode } from 'react'
import {
  Bookmark,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageSquareText,
  Save,
  Search,
  Star,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { formatHotspotTime, getHotspotHost, getPrimaryHotspotTag } from './hotspot-utils'

interface HotspotItemProps {
  featured?: boolean
  item: AiHotspotItem
  onToggleFavorite: (id: string) => void
  onMarkRead: (id: string, read: boolean) => void
  onSaveAsNote: (id: string) => void
  onSendToChat: (id: string) => void
  onDeepDive: (id: string) => void
}

function IconAction({
  label,
  active,
  disabled,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={label}
          title={label}
          className={cn(
            'size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
            active && 'text-foreground',
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function HotspotItem({
  featured,
  item,
  onToggleFavorite,
  onMarkRead,
  onSaveAsNote,
  onSendToChat,
  onDeepDive,
}: HotspotItemProps) {
  const host = getHotspotHost(item.url)
  const markReadIfNeeded = () => {
    if (!item.isRead) {
      onMarkRead(item.id, true)
    }
  }

  return (
    <TooltipProvider>
      <article className={cn(
        'group rounded-md border bg-background transition-colors hover:border-foreground/20',
        featured ? 'p-4' : 'p-3',
        item.isRead && 'bg-muted/25',
      )}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <div className={cn(
            'flex shrink-0 items-center justify-center rounded-md border bg-muted/45 text-xs font-semibold text-muted-foreground',
            featured ? 'size-10' : 'size-9',
          )}>
            {getPrimaryHotspotTag(item).slice(0, 3)}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {!item.isRead ? (
                <span className="rounded bg-foreground px-1.5 py-0.5 text-background">未读</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  <CheckCircle2 className="size-3" />
                  已读
                </span>
              )}
              {item.savedNotePath ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
                  <Bookmark className="size-3" />
                  已保存
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                <Clock className="size-3" />
                {formatHotspotTime(item.publishedAt || item.lastSeenAt)}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                <TrendingUp className="size-3" />
                热度 {item.score}
              </span>
              {item.isFavorite ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                  <Star className="size-3 fill-current" />
                  收藏
                </span>
              ) : null}
            </div>

            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={markReadIfNeeded}
              className={cn(
                'block break-words font-medium leading-6 text-foreground underline-offset-4 hover:underline',
                featured ? 'text-base' : 'text-sm',
                item.isRead && 'text-muted-foreground',
              )}
            >
              {item.title}
            </a>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">{item.sourceName}</span>
              <span>{item.feedName}</span>
              {host ? <span>{host}</span> : null}
            </div>

            {item.summary ? (
              <p className={cn(
                'line-clamp-2 text-xs leading-5 text-muted-foreground',
                featured && 'text-sm leading-6',
              )}>
                {item.summary}
              </p>
            ) : null}

            {item.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {item.tags.slice(0, 4).map(tag => (
                  <span key={tag} className="rounded bg-muted/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-0.5 opacity-100 sm:opacity-80 sm:transition-opacity sm:group-hover:opacity-100">
            <IconAction label="打开原文" onClick={() => {
              markReadIfNeeded()
              window.open(item.url, '_blank', 'noopener,noreferrer')
            }}>
              <ExternalLink className="size-4" />
            </IconAction>
            <IconAction label={item.isFavorite ? '取消收藏' : '收藏'} active={item.isFavorite} onClick={() => onToggleFavorite(item.id)}>
              <Star className={cn('size-4', item.isFavorite && 'fill-current')} />
            </IconAction>
            <IconAction label={item.isRead ? '标记未读' : '标记已读'} active={item.isRead} onClick={() => onMarkRead(item.id, !item.isRead)}>
              <BookOpenCheck className="size-4" />
            </IconAction>
            <IconAction label={item.savedNotePath ? '已保存' : '保存为笔记'} active={Boolean(item.savedNotePath)} onClick={() => onSaveAsNote(item.id)}>
              {item.savedNotePath ? <Bookmark className="size-4" /> : <Save className="size-4" />}
            </IconAction>
            <IconAction label="发送到聊天" onClick={() => onSendToChat(item.id)}>
              <MessageSquareText className="size-4" />
            </IconAction>
            <IconAction label="深挖" onClick={() => onDeepDive(item.id)}>
              <Search className="size-4" />
            </IconAction>
          </div>
        </div>
      </article>
    </TooltipProvider>
  )
}
