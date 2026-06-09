'use client'

import type { ReactNode } from 'react'
import { Bookmark, BookOpenCheck, ExternalLink, MessageSquareText, Save, Search, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { formatHotspotTime, getHotspotHost, getPrimaryHotspotTag } from './hotspot-utils'

interface HotspotItemProps {
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
        'group rounded-md border bg-background p-3 transition-colors hover:border-foreground/20',
        item.isRead && 'bg-muted/30',
      )}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            {getPrimaryHotspotTag(item).slice(0, 2)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                onClick={markReadIfNeeded}
                className={cn(
                  'min-w-0 flex-1 break-words text-sm font-medium leading-6 text-foreground underline-offset-4 hover:underline',
                  item.isRead && 'text-muted-foreground',
                )}
              >
                {item.title}
              </a>
              {item.isFavorite ? <Star className="mt-1 size-4 shrink-0 fill-current text-amber-500" /> : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span>{item.sourceName}</span>
              <span>{item.feedName}</span>
              <span>{formatHotspotTime(item.publishedAt || item.lastSeenAt)}</span>
              {host ? <span>{host}</span> : null}
              <span>热度 {item.score}</span>
            </div>

            {item.summary ? (
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {item.summary}
              </p>
            ) : null}

            {item.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.slice(0, 4).map(tag => (
                  <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-80 sm:transition-opacity sm:group-hover:opacity-100">
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
