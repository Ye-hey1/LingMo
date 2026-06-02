'use client'

import NextImage from 'next/image'
import { useEffect, useState } from 'react'
import {
  Bell,
  BellOff,
  BookOpen,
  Bot,
  Calendar,
  CheckSquare,
  Edit3,
  ExternalLink,
  Github,
  GitFork,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Square,
  Star,
  StarOff,
  Tag,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { GithubStarRepository } from '@/types/github-stars'
import { formatCount, formatRelativeTime, getLanguageColor } from './github-stars-utils'

const MAX_VISIBLE_TAGS = 5

export function RepoCard({
  repo,
  selected,
  analyzing,
  showAiContent,
  categories,
  onSelect,
  onAnalyze,
  onEdit,
  onUnstar,
  onSendToChat,
  onCategoryChange,
  onToggleReleaseSubscription,
  sendingToChat,
  sendToChatDisabled,
  onTitleClick,
}: {
  repo: GithubStarRepository
  selected: boolean
  analyzing: boolean
  showAiContent: boolean
  categories: Array<{ value: string; label: string; count: number }>
  onSelect: (repoId: number) => void
  onAnalyze: (repoId: number) => void
  onEdit: (repo: GithubStarRepository) => void
  onUnstar: (repo: GithubStarRepository) => void
  onSendToChat: (repo: GithubStarRepository) => void
  onCategoryChange: (repoId: number, category: string | null) => void
  onToggleReleaseSubscription: (repoId: number, subscribed: boolean) => void
  sendingToChat?: boolean
  sendToChatDisabled?: boolean
  onTitleClick?: (repo: GithubStarRepository) => void
}) {
  const [category, setCategory] = useState(repo.customCategory || '')
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false)

  useEffect(() => {
    setCategory(repo.customCategory || '')
  }, [repo.customCategory])

  const description = showAiContent
    ? repo.customDescription || repo.aiSummary || repo.description || '暂无描述'
    : repo.customDescription || repo.description || repo.aiSummary || '暂无描述'
  const tags = repo.customTags.length > 0 ? repo.customTags : repo.aiTags.length > 0 ? repo.aiTags : repo.topics.slice(0, 6)
  const ownerProfileUrl = `https://github.com/${repo.ownerLogin}`
  const knowledgeUrl = `https://zread.ai/${repo.fullName}`
  const hasNoDescription = !repo.customDescription && !repo.aiSummary && !repo.description
  const overflowTagCount = tags.length > MAX_VISIBLE_TAGS ? tags.length - MAX_VISIBLE_TAGS : 0

  return (
    <article
      className={cn(
        'group flex min-h-[220px] flex-col rounded-md border bg-card p-3.5 transition-colors hover:border-primary/35',
        selected && 'border-primary/50 bg-primary/[0.04] ring-1 ring-primary/20',
      )}
    >
      <div className="flex items-start gap-3">
        {repo.ownerAvatarUrl ? (
          <NextImage
            src={repo.ownerAvatarUrl}
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-full border bg-muted"
            loading="lazy"
            unoptimized
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
            <Github className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-semibold text-foreground hover:text-primary cursor-pointer"
            title={repo.fullName}
            onClick={(event) => {
              if (onTitleClick) {
                event.preventDefault()
                onTitleClick(repo)
              }
            }}
          >
            {repo.name}
          </a>
          <div className="flex items-center gap-1.5">
            <a
              href={ownerProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-muted-foreground hover:text-foreground"
              title={repo.ownerLogin}
            >
              {repo.ownerLogin}
            </a>
            {repo.isFork && (
              <Badge variant="outline" className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground">
                <GitFork className="mr-0.5 size-2.5" />fork
              </Badge>
            )}
          </div>
        </div>
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-foreground" title="打开 GitHub">
          <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      {/* Action bar: primary + dropdown */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 bg-muted/70"
            onClick={() => onAnalyze(repo.id)}
            disabled={analyzing}
            title={repo.aiSummary ? '重新 AI 分析' : 'AI 分析此仓库'}
          >
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 bg-muted/70"
            onClick={() => onSendToChat(repo)}
            disabled={sendToChatDisabled}
            title="发送到聊天"
          >
            {sendingToChat ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-7 bg-muted/70" title="编辑分类" onClick={() => setCategoryEditorOpen((value) => !value)}>
            <Tag className="size-4" />
          </Button>
          <Button
            variant={repo.subscribedToReleases ? 'secondary' : 'ghost'}
            size="icon"
            className="size-7 bg-muted/70"
            title={repo.subscribedToReleases ? '取消订阅 Release' : '订阅 Release'}
            onClick={() => onToggleReleaseSubscription(repo.id, !repo.subscribedToReleases)}
          >
            {repo.subscribedToReleases ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 bg-muted/70" title="更多操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => onEdit(repo)}>
                <Edit3 className="mr-2 size-4" />
                编辑信息
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={knowledgeUrl} target="_blank" rel="noreferrer">
                  <BookOpen className="mr-2 size-4" />
                  知识页
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onUnstar(repo)}
              >
                <StarOff className="mr-2 size-4" />
                取消 Star
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {repo.analysisFailed ? (
          <Badge variant="destructive" className="font-normal">分析失败</Badge>
        ) : null}
      </div>

      {/* Description - flexible height */}
      <p className={cn(
        'mt-2.5 text-sm leading-6 text-foreground/85',
        hasNoDescription ? 'italic text-muted-foreground' : 'line-clamp-4',
      )}>
        {hasNoDescription ? '暂无描述' : description}
      </p>

      {/* Tags with overflow */}
      {tags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.slice(0, MAX_VISIBLE_TAGS).map(tag => (
            <Badge key={tag} variant="secondary" className="h-6 rounded-md font-normal">{tag}</Badge>
          ))}
          {overflowTagCount > 0 ? (
            <Badge variant="outline" className="h-6 rounded-md font-normal text-muted-foreground">
              +{overflowTagCount}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {/* Stats */}
      <div className="mt-auto space-y-2.5 pt-3">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {repo.language ? (
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
                {repo.language}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Star className="size-3.5" />
              {formatCount(repo.stargazersCount)}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="size-3.5" />
              {formatCount(repo.forksCount)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              {formatRelativeTime(repo.pushedAt || repo.updatedAt)}
            </span>
          </div>
          <Button
            variant={selected ? 'secondary' : 'ghost'}
            size="icon"
            className="size-7 shrink-0"
            onClick={() => onSelect(repo.id)}
            title={selected ? '取消选择' : '选择仓库'}
          >
            {selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
          </Button>
        </div>

        {categoryEditorOpen ? (
          <div className="flex items-center gap-2 border-t pt-2.5">
            <Tag className="size-4 shrink-0 text-muted-foreground" />
            <Select
              value={category || '__auto__'}
              onValueChange={(value) => {
                const nextCategory = value === '__auto__' ? '' : value
                setCategory(nextCategory)
                onCategoryChange(repo.id, nextCategory || null)
                setCategoryEditorOpen(false)
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">自动分类</SelectItem>
                {categories.filter(item => item.value !== 'all').map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </article>
  )
}
