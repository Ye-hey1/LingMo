'use client'

import NextImage from 'next/image'
import { useMemo, useState } from 'react'
import {
  ExternalLink,
  GitFork,
  Loader2,
  Search,
  Star,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGithubStarsStore } from '@/stores/github-stars'
import type { GithubStarForkRepository } from '@/types/github-stars'
import { formatCount, formatRelativeTime, getLanguageColor } from './github-stars-utils'

function ForkCard({ fork }: { fork: GithubStarForkRepository }) {
  const source = fork.source || fork.parent

  return (
    <article className="rounded-md border bg-background p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        {fork.ownerAvatarUrl ? (
          <NextImage
            src={fork.ownerAvatarUrl}
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-full border bg-muted"
            loading="lazy"
            unoptimized
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
            <GitFork className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <a href={fork.htmlUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold hover:text-primary">
              {fork.name}
            </a>
            {fork.language ? (
              <Badge variant="secondary" className="h-5 rounded px-1.5 font-normal">
                {fork.language}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{fork.fullName}</p>
          {source ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Forked from{' '}
              <a href={source.htmlUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {source.fullName}
              </a>
            </p>
          ) : null}
        </div>
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" title="打开 GitHub">
          <a href={fork.htmlUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      {fork.description ? (
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/80">{fork.description}</p>
      ) : (
        <p className="mt-3 text-sm italic leading-6 text-muted-foreground">暂无描述</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        {fork.language ? (
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: getLanguageColor(fork.language) }} />
            {fork.language}
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <Star className="size-3.5" />
          {formatCount(fork.stargazersCount)}
        </span>
        <span className="flex items-center gap-1">
          <GitFork className="size-3.5" />
          {formatCount(fork.forksCount)}
        </span>
        <span>本仓库 {formatRelativeTime(fork.updatedAt || fork.pushedAt)}</span>
        {fork.source?.updatedAt ? <span>上游 {formatRelativeTime(fork.source.updatedAt)}</span> : null}
      </div>
    </article>
  )
}

export function ForksView() {
  const { forks, isRefreshingForks } = useGithubStarsStore()
  const [query, setQuery] = useState('')

  const filteredForks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return forks

    return forks.filter(fork => [
      fork.name,
      fork.fullName,
      fork.description || '',
      fork.language || '',
      fork.source?.fullName || '',
      fork.parent?.fullName || '',
    ].join(' ').toLowerCase().includes(normalizedQuery))
  }, [forks, query])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
      <div className="shrink-0 border-b bg-background p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <GitFork className="size-4 text-muted-foreground" />
              复刻
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              管理当前 GitHub 账号下的 Fork 仓库，快速查看上游信息和更新时间
            </p>
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="搜索 Fork 名称、上游仓库、语言或描述"
            className="h-9 bg-muted/50 pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-5xl space-y-3 p-4">
          {isRefreshingForks && forks.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center rounded-md border bg-background text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在刷新 Fork 仓库
            </div>
          ) : filteredForks.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center rounded-md border bg-background text-center">
              <GitFork className="mb-3 size-10 text-muted-foreground" />
              <div className="text-sm font-medium">{forks.length > 0 ? '没有匹配的 Fork' : '没有 Fork 数据'}</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {forks.length > 0
                  ? '请调整搜索关键词，或清空搜索后查看全部 Fork。'
                  : '点击“刷新复刻”后，LingMo 会读取当前 GitHub 账号下的 Fork 仓库。'}
              </p>
            </div>
          ) : (
            filteredForks.map(fork => <ForkCard key={fork.id} fork={fork} />)
          )}
        </main>
      </ScrollArea>

      <div className="flex h-8 shrink-0 items-center border-t bg-background px-3 text-xs text-muted-foreground">
        显示 {filteredForks.length} / {forks.length} 个 Fork
      </div>
    </div>
  )
}
