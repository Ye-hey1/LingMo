'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Filter,
  GitFork,
  Globe,
  Loader2,
  Monitor,
  Search,
  Star,
  StarOff,
  TrendingUp,
  Rocket,
  Crown,
  Tag,
  Apple,
  Terminal,
  Smartphone,
  BookOpen,
  Bot,
  MessageSquare,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { createGithubStarChatContext } from '@/lib/github-stars/chat-context'
import { cn } from '@/lib/utils'
import { useGithubStarsStore } from '@/stores/github-stars'
import { ReadmeModal } from './ReadmeModal'
import {
  DEFAULT_DISCOVERY_CHANNELS,
  type GithubStarDiscoveryChannelIcon,
  type GithubStarDiscoveryChannelId,
  type GithubStarDiscoveryPlatform,
  type GithubStarDiscoveryRepository,
  type GithubStarProgrammingLanguage,
  type GithubStarSortBy,
  type GithubStarSortOrder,
  type GithubStarTopicCategory,
  type GithubStarTrendingRange,
} from '@/types/github-stars'
import { formatCount, formatRelativeTime, getLanguageColor } from './github-stars-utils'

// ─── 常量 ───

const RANGE_LABELS: Record<GithubStarTrendingRange, string> = {
  daily: '今日',
  weekly: '本周',
  monthly: '本月',
}

const CHANNEL_ICON_MAP: Record<GithubStarDiscoveryChannelIcon, React.ReactNode> = {
  trending: <TrendingUp className="size-4" />,
  rocket: <Rocket className="size-4" />,
  star: <Crown className="size-4" />,
  tag: <Tag className="size-4" />,
  search: <Search className="size-4" />,
}

const PLATFORM_OPTIONS: { id: GithubStarDiscoveryPlatform; label: string; icon: React.ReactNode }[] = [
  { id: 'All', label: '全部', icon: <Globe className="size-3.5" /> },
  { id: 'Android', label: 'Android', icon: <Smartphone className="size-3.5" /> },
  { id: 'Macos', label: 'macOS', icon: <Apple className="size-3.5" /> },
  { id: 'Windows', label: 'Windows', icon: <Monitor className="size-3.5" /> },
  { id: 'Linux', label: 'Linux', icon: <Terminal className="size-3.5" /> },
]

const LANGUAGE_OPTIONS: { id: GithubStarProgrammingLanguage; label: string }[] = [
  { id: 'All', label: '所有语言' },
  { id: 'JavaScript', label: 'JavaScript' },
  { id: 'TypeScript', label: 'TypeScript' },
  { id: 'Python', label: 'Python' },
  { id: 'Java', label: 'Java' },
  { id: 'Kotlin', label: 'Kotlin' },
  { id: 'Go', label: 'Go' },
  { id: 'Rust', label: 'Rust' },
  { id: 'CSharp', label: 'C#' },
  { id: 'CPlusPlus', label: 'C++' },
  { id: 'Swift', label: 'Swift' },
  { id: 'Dart', label: 'Dart' },
  { id: 'Ruby', label: 'Ruby' },
  { id: 'PHP', label: 'PHP' },
]

const SORT_OPTIONS: { id: GithubStarSortBy; label: string }[] = [
  { id: 'BestMatch', label: '最佳匹配' },
  { id: 'MostStars', label: '最多 Star' },
  { id: 'MostForks', label: '最多 Fork' },
]

const SORT_ORDER_OPTIONS: { id: GithubStarSortOrder; label: string }[] = [
  { id: 'Descending', label: '降序' },
  { id: 'Ascending', label: '升序' },
]

const TOPIC_OPTIONS: { id: GithubStarTopicCategory; label: string }[] = [
  { id: 'ai', label: '人工智能' },
  { id: 'ml', label: '机器学习' },
  { id: 'database', label: '数据库' },
  { id: 'web', label: 'Web 开发' },
  { id: 'mobile', label: '移动开发' },
  { id: 'devtools', label: '开发工具' },
  { id: 'security', label: '安全' },
  { id: 'game', label: '游戏' },
]

// ─── DiscoveryCard ───

function DiscoveryCard({
  repo,
  onTitleClick,
}: {
  repo: GithubStarDiscoveryRepository
  onTitleClick?: (repo: GithubStarDiscoveryRepository) => void
}) {
  const [copied, setCopied] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [sendingToChat, setSendingToChat] = useState(false)
  const { toast } = useToast()
  const {
    repositories,
    analyzeDiscoveryRepo,
    toggleDiscoveryStar,
  } = useGithubStarsStore()

  const isStarred = repo.isStarred || repositories.some(r => r.id === repo.id)
  const knowledgeUrl = `https://zread.ai/${repo.fullName}`

  const handleCopy = useCallback(async () => {
    const text = [
      `**${repo.fullName}**`,
      repo.description || '',
      `⭐ ${repo.stargazersCount.toLocaleString()} | 🍴 ${repo.forksCount.toLocaleString()}`,
      repo.language ? `语言: ${repo.language}` : '',
      repo.htmlUrl,
    ].filter(Boolean).join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API 不可用时静默失败
    }
  }, [repo])

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true)
    try {
      await analyzeDiscoveryRepo(repo.id)
      toast({ title: `${repo.fullName} AI 分析完成`, duration: 2000 })
    } catch {
      toast({ title: 'AI 分析失败', variant: 'destructive' })
    } finally {
      setAnalyzing(false)
    }
  }, [repo.id, repo.fullName, analyzeDiscoveryRepo, toast])

  const handleSendToChat = useCallback(async () => {
    if (sendingToChat) return
    setSendingToChat(true)
    try {
      const context = await createGithubStarChatContext(repo)
      emitter.emit('github-stars-send-to-chat', {
        prompt: context.prompt,
        quoteData: context.quoteData,
      })
      toast({
        title: `已发送到聊天: ${repo.fullName}`,
        description: context.hasReadme
          ? `已附加 README 和 ${context.documentCount} 条文档结构线索。`
          : `未读取到 README，已附加 ${context.documentCount} 条文档结构线索。`,
        duration: 3000,
      })
    } catch (err) {
      console.warn('[DiscoveryCard] send to chat failed:', err)
      toast({ title: '发送到聊天失败', variant: 'destructive' })
    } finally {
      setSendingToChat(false)
    }
  }, [repo, sendingToChat, toast])

  const handleToggleStar = useCallback(() => {
    void toggleDiscoveryStar(repo)
  }, [repo, toggleDiscoveryStar])

  return (
    <article className="group rounded-md border bg-background p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-sm font-semibold text-muted-foreground">
          #{repo.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-w-0 appearance-none truncate border-0 bg-transparent p-0 text-left text-sm font-semibold hover:text-primary cursor-pointer"
              title={repo.fullName}
              onClick={() => onTitleClick?.(repo)}
            >
              {repo.fullName}
            </button>
            {repo.trendingRange && (
              <Badge variant="secondary" className="h-5 rounded px-1.5 font-normal">
                {RANGE_LABELS[repo.trendingRange]}
              </Badge>
            )}
            {repo.isFork && (
              <Badge variant="outline" className="h-5 rounded px-1.5 font-normal text-muted-foreground">
                <GitFork className="mr-0.5 size-3" />fork
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{repo.ownerLogin}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground" title="打开 GitHub">
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mt-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-muted/70"
          onClick={() => void handleAnalyze()}
          disabled={analyzing}
          title={repo.aiSummary ? '重新 AI 分析' : 'AI 分析此仓库'}
        >
          {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-muted/70"
          onClick={() => void handleSendToChat()}
          disabled={sendingToChat}
          title="发送到聊天"
        >
          {sendingToChat ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
        </Button>
        <Button asChild variant="ghost" size="icon" className="size-7 bg-muted/70" title="在 Zread 中打开知识页">
          <a href={knowledgeUrl} target="_blank" rel="noreferrer">
            <BookOpen className="size-4" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-muted/70"
          onClick={handleCopy}
          title="复制仓库信息"
        >
          {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
        </Button>
        <Button
          variant={isStarred ? 'secondary' : 'ghost'}
          size="icon"
          className={cn('size-7 bg-muted/70', isStarred && 'text-yellow-500')}
          onClick={handleToggleStar}
          title={isStarred ? '取消星标' : '添加星标'}
        >
          {isStarred ? <StarOff className="size-4" /> : <Star className="size-4" />}
        </Button>
        {repo.analysisFailed && (
          <Badge variant="destructive" className="ml-auto font-normal">分析失败</Badge>
        )}
      </div>

      {repo.description ? (
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/80">{repo.description}</p>
      ) : (
        <p className="mt-3 text-sm italic leading-6 text-muted-foreground">暂无描述</p>
      )}

      {repo.aiSummary && (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-primary/80">{repo.aiSummary}</p>
      )}

      {repo.topics.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {repo.topics.slice(0, 6).map(topic => (
            <Badge key={topic} variant="outline" className="h-6 rounded-md font-normal text-muted-foreground">
              {topic}
            </Badge>
          ))}
        </div>
      ) : null}

      {repo.aiTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {repo.aiTags.slice(0, 6).map(tag => (
            <Badge key={tag} variant="secondary" className="h-5 rounded px-1.5 text-[11px] font-normal text-primary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
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
        <span>更新 {formatRelativeTime(repo.pushedAt || repo.updatedAt)}</span>
      </div>
    </article>
  )
}

// ─── 主视图 ───

export function TrendingView() {
  const {
    discoveryChannel,
    discoveryPlatform,
    discoveryLanguage,
    discoverySortBy,
    discoverySortOrder,
    discoverySearchQuery,
    discoverySelectedTopic,
    discoveryRepos,
    discoveryIsLoading,
    discoveryIsLoadingMore,
    discoveryHasMore,
    discoveryNextPage,
    discoveryTotalCount,
    discoveryLoadMoreError,
    trendingRange,
    setTrendingRange,
    setDiscoveryChannel,
    setDiscoveryPlatform,
    setDiscoveryLanguage,
    setDiscoverySortBy,
    setDiscoverySortOrder,
    setDiscoverySearchQuery,
    setDiscoverySelectedTopic,
    refreshDiscoveryChannel,
  } = useGithubStarsStore()

  const [query, setQuery] = useState(discoverySearchQuery)
  const [platformOpen, setPlatformOpen] = useState(false)
  const platformRef = useRef<HTMLDivElement>(null)
  const autoFetchRef = useRef<GithubStarDiscoveryChannelId | null>(null)

  const [activeReadmeRepo, setActiveReadmeRepo] = useState<GithubStarDiscoveryRepository | null>(null)
  const [isReadmeOpen, setIsReadmeOpen] = useState(false)

  const currentRepos = discoveryRepos[discoveryChannel] || []

  const isLoading = discoveryIsLoading[discoveryChannel] || false
  const isLoadingMore = discoveryIsLoadingMore[discoveryChannel] || false
  const hasMore = discoveryHasMore[discoveryChannel] || false
  const nextPage = discoveryNextPage[discoveryChannel] || 1
  const totalCount = discoveryTotalCount[discoveryChannel] || 0
  const loadMoreError = discoveryLoadMoreError[discoveryChannel] || null

  const enabledChannels = useMemo(
    () => DEFAULT_DISCOVERY_CHANNELS.filter(ch => ch.enabled),
    [],
  )

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery || discoveryChannel === 'search') return currentRepos
    return currentRepos.filter(repo => [
      repo.fullName,
      repo.description || '',
      repo.language || '',
      repo.ownerLogin,
      ...repo.topics,
    ].join(' ').toLowerCase().includes(normalizedQuery))
  }, [query, currentRepos, discoveryChannel])

  // 切换频道时自动加载
  useEffect(() => {
    const hasRepos = useGithubStarsStore.getState().discoveryRepos[discoveryChannel]?.length > 0
    const isCurrentlyLoading = useGithubStarsStore.getState().discoveryIsLoading[discoveryChannel]
    if (!hasRepos && !isCurrentlyLoading && autoFetchRef.current !== discoveryChannel) {
      autoFetchRef.current = discoveryChannel
      void refreshDiscoveryChannel(discoveryChannel)
    }
  }, [discoveryChannel, refreshDiscoveryChannel])

  // 点击外部关闭平台下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (platformRef.current && !platformRef.current.contains(e.target as Node)) {
        setPlatformOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = useCallback(() => {
    if (discoveryChannel === 'search') {
      setDiscoverySearchQuery(query)
      void refreshDiscoveryChannel('search')
    }
  }, [discoveryChannel, query, setDiscoverySearchQuery, refreshDiscoveryChannel])

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading && !isLoadingMore) {
      void refreshDiscoveryChannel(discoveryChannel, nextPage, true)
    }
  }, [hasMore, isLoading, isLoadingMore, discoveryChannel, nextPage, refreshDiscoveryChannel])

  const handleChannelChange = useCallback((channel: GithubStarDiscoveryChannelId) => {
    if (channel !== discoveryChannel) {
      setDiscoveryChannel(channel)
    }
  }, [discoveryChannel, setDiscoveryChannel])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
      {/* ─── 顶部工具栏 ─── */}
      <div className="shrink-0 border-b bg-background p-3">
        {/* 频道 Tab */}
        <div className="flex flex-col gap-1.5 sm:gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
            {enabledChannels.map(ch => (
              <button
                key={ch.id}
                onClick={() => handleChannelChange(ch.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:py-1.5 sm:text-sm ${
                  discoveryChannel === ch.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {CHANNEL_ICON_MAP[ch.icon]}
                {ch.name}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-1.5 lg:justify-end">
            <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/25 p-1">
              {discoveryChannel === 'trending' && (
                <Select
                  value={trendingRange}
                  onValueChange={(value) => {
                    const range = value as GithubStarTrendingRange
                    setTrendingRange(range)
                    void refreshDiscoveryChannel('trending')
                  }}
                >
                  <SelectTrigger className="h-7 w-[84px] border-none bg-background px-2 text-xs shadow-none sm:h-8 sm:w-[100px] sm:px-2.5 sm:text-sm">
                    <Calendar className="mr-1 size-3 sm:size-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">今日</SelectItem>
                    <SelectItem value="weekly">本周</SelectItem>
                    <SelectItem value="monthly">本月</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <div className="relative" ref={platformRef}>
                <button
                  onClick={() => setPlatformOpen(!platformOpen)}
                  className="flex h-7 items-center gap-1 rounded-md bg-background px-2 text-xs text-foreground/90 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-sm"
                >
                  <Filter className="size-3 sm:size-3.5" />
                  {PLATFORM_OPTIONS.find(p => p.id === discoveryPlatform)?.label}
                </button>
                {platformOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-md border bg-background p-1 shadow-md sm:w-36 lg:left-auto">
                    {PLATFORM_OPTIONS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setDiscoveryPlatform(p.id)
                          setPlatformOpen(false)
                          void refreshDiscoveryChannel()
                        }}
                        className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                          discoveryPlatform === p.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                        }`}
                      >
                        {p.icon} {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {currentRepos.length > 0 && (
              <span className="shrink-0 rounded-md border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground sm:border-transparent sm:bg-transparent sm:px-0 sm:py-0 sm:text-xs">
                {currentRepos.length} 项
                <span className="hidden sm:inline">
                  {totalCount > currentRepos.length ? ` / 共 ${totalCount}` : ''}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 第二行：筛选条件 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* 主题筛选 */}
          {discoveryChannel === 'topic' && (
            <Select
              value={discoverySelectedTopic || ''}
              onValueChange={(value) => {
                setDiscoverySelectedTopic(value as GithubStarTopicCategory || null)
                if (value) void refreshDiscoveryChannel('topic')
              }}
            >
              <SelectTrigger className="h-8 w-[120px]">
                <SelectValue placeholder="选择主题" />
              </SelectTrigger>
              <SelectContent>
                {TOPIC_OPTIONS.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* 搜索频道：语言/排序/排序方向 */}
          {discoveryChannel === 'search' && (
            <>
              <Select
                value={discoveryLanguage}
                onValueChange={(value) => setDiscoveryLanguage(value as GithubStarProgrammingLanguage)}
              >
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={discoverySortBy}
                onValueChange={(value) => setDiscoverySortBy(value as GithubStarSortBy)}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={discoverySortOrder}
                onValueChange={(value) => setDiscoverySortOrder(value as GithubStarSortOrder)}
              >
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_ORDER_OPTIONS.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {/* 搜索框（搜索频道或本地搜索） */}
        {discoveryChannel === 'search' ? (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="搜索 GitHub 仓库..."
              className="h-9 bg-muted/50 pl-9 pr-20"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button
              size="sm"
              className="absolute right-1 top-1/2 h-7 -translate-y-1/2"
              onClick={handleSearch}
              disabled={!query.trim() || isLoading}
            >
              搜索
            </Button>
          </div>
        ) : (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="在当前频道中筛选..."
              className="h-9 bg-muted/50 pl-9"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* ─── 内容区域 ─── */}
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-5xl space-y-3 p-4">
          {isLoading && currentRepos.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center rounded-md border bg-background text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在加载...
            </div>
          ) : filteredRepositories.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center rounded-md border bg-background text-center">
              <TrendingUp className="mb-3 size-10 text-muted-foreground" />
              <div className="text-sm font-medium">暂无数据</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                切换频道或搜索后会自动获取最新数据。
              </p>
            </div>
          ) : (
            filteredRepositories.map(repo => (
              <DiscoveryCard
                key={`${discoveryChannel}-${repo.id || repo.fullName}-${repo.rank}`}
                repo={repo}
                onTitleClick={(r) => {
                  setActiveReadmeRepo(r)
                  setIsReadmeOpen(true)
                }}
              />
            ))
          )}

          {/* 加载更多 */}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载更多...
            </div>
          )}

          {loadMoreError && (
            <div className="flex items-center justify-center gap-3 py-4 text-sm text-destructive">
              <X className="size-4" />
              {loadMoreError}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refreshDiscoveryChannel(discoveryChannel, nextPage, true)}
              >
                重试
              </Button>
            </div>
          )}

          {hasMore && !isLoading && !isLoadingMore && currentRepos.length > 0 && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
              >
                加载更多
              </Button>
            </div>
          )}

          {!hasMore && currentRepos.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <span>已加载全部 {currentRepos.length} 项</span>
            </div>
          )}
        </main>
      </ScrollArea>

      {/* ─── 底部状态栏 ─── */}
      <div className="flex h-8 shrink-0 items-center border-t bg-background px-3 text-xs text-muted-foreground">
        {discoveryChannel === 'search'
          ? `搜索 "${query}" - ${filteredRepositories.length} 个结果`
          : `显示 ${filteredRepositories.length}${query ? ' / ' + currentRepos.length : ''} 项`
        }
        {totalCount > 0 && !query && ` / 共 ${totalCount}`}
      </div>

      <ReadmeModal
        isOpen={isReadmeOpen}
        onClose={() => setIsReadmeOpen(false)}
        repoName={activeReadmeRepo?.fullName || null}
        ownerAvatarUrl={activeReadmeRepo?.ownerAvatarUrl || null}
      />
    </div>
  )
}
