'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Bot,
  BookOpen,
  Github,
  GitFork,
  Loader2,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  StarOff,
  TrendingUp,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { useGithubStarsStore } from '@/stores/github-stars'
import type { GithubStarRepository, GithubStarRepositoryUpdate } from '@/types/github-stars'
import { GITHUB_STAR_DEFAULT_CATEGORIES, GITHUB_STAR_UNCATEGORIZED, resolveGithubStarCategory } from '@/lib/github-stars/categories'
import { createGithubStarChatContext } from '@/lib/github-stars/chat-context'
import { cn } from '@/lib/utils'

import { CategoryCreateDialog } from './category-create-dialog'
import { CategorySidebar } from './category-sidebar'
import { ForksView } from './forks-view'
import { RepoCard } from './repo-card'
import { ReadmeModal } from './ReadmeModal'
import { RepositoryEditDialog } from './repository-edit-dialog'
import { ReleasesView } from './releases-view'
import { TrendingView } from './trending-view'
import { formatRelativeTime } from './github-stars-utils'

function ViewPill({
  active,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-150',
        active
          ? 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
    >
      {icon}
      {label}
    </button>
  )
}

export function GithubStarsWorkspace() {
  const {
    view,
    repositories,
    filteredRepositories,
    customCategories,
    stats,
    filters,
    isLoading,
    isSyncing,
    isAnalyzing,
    isAiSearching,
    isRefreshingReleases,
    isRefreshingForks,
    analyzingRepoId,
    analyzingRepoIds,
    analysisProgress,
    syncProgress,
    aiSearchInfo,
    discoveryChannel,
    discoveryIsLoading,
    discoveryIsLoadingMore,
    error,
    setView,
    load,
    syncStarred,
    refreshReleases,
    refreshForks,
    refreshDiscoveryChannel,
    forceResetSyncState,
    aiSearch,
    analyzeRepositories,
    setFilters,
    toggleReleaseSubscription,
    addCategory,
    deleteCategory,
    updateCategory,
    updateRepositoryDetails,
    unstarRepository,
  } = useGithubStarsStore()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [showAiContent, setShowAiContent] = useState(true)
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set())
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editingRepository, setEditingRepository] = useState<GithubStarRepository | null>(null)
  const [unstarTarget, setUnstarTarget] = useState<GithubStarRepository | null>(null)
  const [isUnstarring, setIsUnstarring] = useState(false)
  const [sendingToChatRepoId, setSendingToChatRepoId] = useState<number | null>(null)

  const [activeReadmeRepo, setActiveReadmeRepo] = useState<GithubStarRepository | null>(null)
  const [isReadmeOpen, setIsReadmeOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const visibleIds = new Set(filteredRepositories.map(repo => repo.id))
    setSelectedRepoIds((previous) => {
      let changed = false
      const next = new Set<number>()
      previous.forEach((repoId) => {
        if (visibleIds.has(repoId)) {
          next.add(repoId)
        } else {
          changed = true
        }
      })
      return changed ? next : previous
    })
  }, [filteredRepositories])

  // Language count map for filter display
  const languageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    repositories.forEach((repo) => {
      if (repo.language) {
        counts.set(repo.language, (counts.get(repo.language) || 0) + 1)
      }
    })
    return counts
  }, [repositories])

  const categoryItems = useMemo(() => {
    const customCategoryRules = customCategories.map(category => ({
      id: `custom:${category.name}`,
      name: category.name,
      keywords: category.keywords,
      icon: category.icon,
      custom: true,
    }))
    const categoryRules = [...customCategoryRules, ...GITHUB_STAR_DEFAULT_CATEGORIES]
    const categoryCounts = new Map<string, number>()
    repositories.forEach((repo) => {
      const category = resolveGithubStarCategory(repo, categoryRules)
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
    })

    const defaultCategoryNames = new Set(GITHUB_STAR_DEFAULT_CATEGORIES.map(category => category.name))
    const customCategoryNames = customCategories.map(category => category.name)
    const orderedDefaultCategories = GITHUB_STAR_DEFAULT_CATEGORIES
      .map(category => category.name)
      .filter(category => (categoryCounts.get(category) || 0) > 0)
    const orderedCustomCategories = customCategoryNames
      .filter(name => !defaultCategoryNames.has(name) && (categoryCounts.get(name) || 0) > 0)
    const extraCategories = stats.categories
      .filter(category => !defaultCategoryNames.has(category) && !customCategoryNames.includes(category) && category !== GITHUB_STAR_UNCATEGORIZED && (categoryCounts.get(category) || 0) > 0)
      .sort((a, b) => a.localeCompare(b))
    const uncategorizedCount = categoryCounts.get(GITHUB_STAR_UNCATEGORIZED) || 0

    return [
      { value: 'all', label: '全部分类', count: repositories.length, type: 'all' as const },
      ...(uncategorizedCount > 0
        ? [{ value: GITHUB_STAR_UNCATEGORIZED, label: GITHUB_STAR_UNCATEGORIZED, count: uncategorizedCount, type: 'uncategorized' as const }]
        : []),
      ...orderedCustomCategories.map(category => ({
        value: category,
        label: category,
        count: categoryCounts.get(category) || 0,
        type: 'custom' as const,
      })),
      ...orderedDefaultCategories.map(category => ({
        value: category,
        label: category,
        count: categoryCounts.get(category) || 0,
        type: 'default' as const,
      })),
      ...extraCategories.map(category => ({
        value: category,
        label: category,
        count: categoryCounts.get(category) || 0,
        type: 'extra' as const,
      })),
    ]
  }, [customCategories, repositories, stats.categories])

  const selectedRepositories = useMemo(
    () => filteredRepositories.filter(repo => selectedRepoIds.has(repo.id)),
    [filteredRepositories, selectedRepoIds],
  )
  const pendingVisibleCount = useMemo(
    () => filteredRepositories.filter(repo => !repo.aiSummary && !repo.analysisFailed).length,
    [filteredRepositories],
  )
  const analyzedVisibleCount = useMemo(
    () => filteredRepositories.filter(repo => Boolean(repo.aiSummary)).length,
    [filteredRepositories],
  )
  const failedVisibleCount = useMemo(
    () => filteredRepositories.filter(repo => repo.analysisFailed).length,
    [filteredRepositories],
  )

  const activeFilterCount = [
    filters.query.trim() ? 1 : 0,
    filters.language !== 'all' ? 1 : 0,
    filters.category !== 'all' ? 1 : 0,
    filters.analysis !== 'all' ? 1 : 0,
    filters.sortBy !== 'starred' ? 1 : 0,
  ].reduce((sum, item) => sum + item, 0)
  const filterPanelActiveCount = [
    filters.language !== 'all' ? 1 : 0,
    filters.analysis !== 'all' ? 1 : 0,
  ].reduce((sum, item) => sum + item, 0)
  const syncedCount = syncProgress?.fetched || 0

  const toggleSelection = (repoId: number) => {
    setSelectedRepoIds((previous) => {
      const next = new Set(previous)
      if (next.has(repoId)) {
        next.delete(repoId)
      } else {
        next.add(repoId)
      }
      return next
    })
  }

  const handleAiSearch = () => {
    void aiSearch(filters.query)
  }

  const handleClearFilters = () => {
    setFilters({
      query: '',
      language: 'all',
      category: 'all',
      analysis: 'all',
      sortBy: 'starred',
    })
  }

  const handleSaveRepositoryDetails = async (repoId: number, update: GithubStarRepositoryUpdate) => {
    await updateRepositoryDetails(repoId, update)
    toast({ title: '仓库信息已更新' })
  }

  const handleCategoryChange = async (repoId: number, category: string | null) => {
    await updateCategory(repoId, category)
    const categoryLabel = category || '自动分类'
    toast({ title: `分类已更新为「${categoryLabel}」`, duration: 2000 })
  }

  const handleToggleReleaseSubscription = async (repoId: number, subscribed: boolean) => {
    await toggleReleaseSubscription(repoId, subscribed)
    const repository = repositories.find(repo => repo.id === repoId)
    toast({
      title: subscribed
        ? `已订阅 Release: ${repository?.fullName || repoId}`
        : `已取消 Release 订阅: ${repository?.fullName || repoId}`,
      duration: 2400,
    })
  }

  const handleSendToChat = async (repository: GithubStarRepository) => {
    if (sendingToChatRepoId) return

    setSendingToChatRepoId(repository.id)
    try {
      const context = await createGithubStarChatContext(repository)
      emitter.emit('github-stars-send-to-chat', {
        prompt: context.prompt,
        quoteData: context.quoteData,
      })
      toast({
        title: `已发送到聊天: ${repository.fullName}`,
        description: context.hasReadme
          ? `已附加 README 和 ${context.documentCount} 条文档结构线索。`
          : `未读取到 README，已附加 ${context.documentCount} 条文档结构线索。`,
        duration: 3000,
      })
    } catch (err) {
      console.warn('[GitHubStars] send to chat failed:', err)
      toast({ title: '发送到聊天失败', variant: 'destructive' })
    } finally {
      setSendingToChatRepoId(null)
    }
  }

  const handleDeleteCategory = async (name: string) => {
    await deleteCategory(name)
    // If the deleted category was selected, reset to 'all'
    if (filters.category === name) {
      setFilters({ category: 'all' })
    }
    toast({ title: `分类「${name}」已删除`, duration: 2000 })
  }

  const handleConfirmUnstar = async () => {
    if (!unstarTarget) return

    setIsUnstarring(true)
    try {
      await unstarRepository(unstarTarget.id)
      setSelectedRepoIds((previous) => {
        const next = new Set(previous)
        next.delete(unstarTarget.id)
        return next
      })
      toast({ title: `已取消 Star: ${unstarTarget.fullName}`, duration: 3000 })
      setUnstarTarget(null)
    } catch (err) {
      console.warn('[GitHubStars] unstar failed:', err)
      toast({ title: '取消 Star 失败', variant: 'destructive' })
    } finally {
      setIsUnstarring(false)
    }
  }

  const headerRefreshTitle = view === 'repositories'
    ? '同步星标'
    : view === 'releases'
      ? '刷新当前发布页'
      : view === 'forks'
        ? '刷新当前复刻页'
        : '刷新当前趋势页'
  const lastSyncRelativeTime = formatRelativeTime(stats.lastSyncAt)
  const compactLastSyncTime = lastSyncRelativeTime.replace(/(\d+)\s+(分钟|小时|天)前/u, '$1$2前')
  const headerStatusText = view === 'repositories'
    ? compactLastSyncTime
    : view === 'releases'
      ? '发布'
      : view === 'forks'
        ? '复刻'
        : '趋势'
  const headerStatusTitle = view === 'repositories'
    ? `上次同步 ${lastSyncRelativeTime}`
    : headerRefreshTitle
  const headerRefreshButtonTitle = view === 'repositories'
    ? `${headerRefreshTitle}，${headerStatusTitle}`
    : headerRefreshTitle
  const isHeaderRefreshing = view === 'repositories'
    ? isSyncing
    : view === 'releases'
      ? isRefreshingReleases
      : view === 'forks'
        ? isRefreshingForks
        : Boolean(discoveryIsLoading[discoveryChannel] || discoveryIsLoadingMore[discoveryChannel])
  const isHeaderRefreshDisabled = isHeaderRefreshing || (view === 'repositories' && isAnalyzing)

  const handleHeaderRefresh = () => {
    if (view === 'repositories') {
      void syncStarred()
    } else if (view === 'releases') {
      void refreshReleases()
    } else if (view === 'forks') {
      void refreshForks()
    } else {
      void refreshDiscoveryChannel(discoveryChannel, 1, false)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Header */}
        <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
          {/* Left: Logo + Title */}
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Github className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">GitHub 管理</span>

          {/* Center: Nav pills */}
          <div className="ml-3 hidden items-center gap-0.5 md:flex">
            <ViewPill active={view === 'repositories'} icon={<Search className="size-3" />} label="仓库" onClick={() => setView('repositories')} />
            <ViewPill active={view === 'releases'} icon={<BookOpen className="size-3" />} label="发布" onClick={() => setView('releases')} />
            <ViewPill active={view === 'forks'} icon={<GitFork className="size-3" />} label="复刻" onClick={() => setView('forks')} />
            <ViewPill active={view === 'trending'} icon={<TrendingUp className="size-3" />} label="趋势" onClick={() => setView('trending')} />
          </div>

          {/* Right: Status + Refresh */}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="hidden sm:inline" title={headerStatusTitle}>{headerStatusText}</span>
            <Button variant="ghost" size="icon" className="size-7" onClick={handleHeaderRefresh} disabled={isHeaderRefreshDisabled} title={headerRefreshButtonTitle}>
              {isHeaderRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            </Button>
          </div>
        </header>

        {/* Mobile nav */}
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 md:hidden">
          <ViewPill active={view === 'repositories'} icon={<Search className="size-3" />} label="仓库" onClick={() => setView('repositories')} />
          <ViewPill active={view === 'releases'} icon={<BookOpen className="size-3" />} label="发布" onClick={() => setView('releases')} />
          <ViewPill active={view === 'forks'} icon={<GitFork className="size-3" />} label="复刻" onClick={() => setView('forks')} />
          <ViewPill active={view === 'trending'} icon={<TrendingUp className="size-3" />} label="趋势" onClick={() => setView('trending')} />
        </div>

        {view !== 'repositories' && error ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {view === 'repositories' ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <CategorySidebar
            categories={categoryItems}
            selected={filters.category}
            collapsed={sidebarCollapsed}
            sidebarWidth={sidebarWidth}
            onSelect={(category) => setFilters({ category })}
            onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
            onSidebarWidthChange={setSidebarWidth}
            onAddCategory={() => setCategoryDialogOpen(true)}
            onDeleteCategory={(name) => void handleDeleteCategory(name)}
          />

          <ScrollArea className="min-h-0 flex-1 bg-muted/20">
            <main className="mx-auto w-full max-w-7xl space-y-3 px-4 py-4 lg:px-5">
              {/* Search bar */}
              <section className="rounded-md border bg-background p-3">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                  <div className="flex min-w-0 flex-1 gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={filters.query}
                        placeholder="搜索名称、描述、语言、Topic、AI 标签"
                        className="h-9 border-0 bg-muted/60 pl-9 pr-3 text-sm shadow-none focus-visible:ring-1"
                        onChange={(event) => setFilters({ query: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleAiSearch()
                          }
                        }}
                      />
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          className="h-9 shrink-0"
                          disabled={isAiSearching || !filters.query.trim()}
                          onClick={handleAiSearch}
                        >
                          {isAiSearching ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                          AI搜索
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[360px]">
                        <p>
                          AI 语义搜索会使用当前模型配置理解查询意图，并结合仓库名称、描述、Topic、AI 标签和摘要进行重排序。
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {filters.query.trim() ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    {aiSearchInfo?.query === filters.query ? (
                      <>
                        <Bot className="size-3.5 text-primary" />
                        <span className="text-primary">
                          {aiSearchInfo.mode === 'ai' ? 'AI语义搜索' : '本地智能排序'}，命中 {aiSearchInfo.count} 个仓库
                        </span>
                      </>
                    ) : (
                      <>
                        <Search className="size-3.5" />
                        <span>当前为快速文本匹配，点击 AI搜索 可进行语义理解和重排序。</span>
                      </>
                    )}
                  </div>
                ) : null}

                {/* Expanded filters - removed duplicate category filter */}
                {filtersExpanded ? (
                  <div className="mt-3 grid gap-2 border-t pt-3 md:grid-cols-2">
                    <Select value={filters.language} onValueChange={(value) => setFilters({ language: value })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="语言" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部语言</SelectItem>
                        {stats.languages.map(language => (
                          <SelectItem key={language} value={language}>
                            {language} ({languageCounts.get(language) || 0})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filters.analysis} onValueChange={(value) => setFilters({ analysis: value as typeof filters.analysis })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="分析状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="analyzed">已分析</SelectItem>
                        <SelectItem value="pending">待分析</SelectItem>
                        <SelectItem value="failed">分析失败</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </section>

              {/* Error banner */}
              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {/* Sync progress */}
              {isSyncing ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                  <div className="flex items-start gap-2">
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                    <span>
                      正在同步第 {syncProgress?.page || 1}{syncProgress?.totalPages ? `/${syncProgress.totalPages}` : ''} 页，
                      已获取 {syncedCount} 个仓库
                      {syncProgress?.running ? `，并发请求 ${syncProgress.running} 个页面` : ''}，数据会分批显示。
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs text-primary hover:bg-primary/20"
                    onClick={() => {
                      forceResetSyncState()
                    }}
                  >
                    取消
                  </Button>
                </div>
              ) : null}

              {/* Content states */}
              {isLoading ? (
                <div className="flex h-[360px] items-center justify-center rounded-md border bg-background text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在加载星标仓库
                </div>
              ) : isSyncing && filteredRepositories.length === 0 ? (
                <div className="flex h-[360px] flex-col items-center justify-center rounded-md border bg-background text-center">
                  <div className="relative mb-3">
                    <Github className="size-10 text-muted-foreground" />
                    <Loader2 className="absolute -right-2 -top-2 size-4 animate-spin text-primary" />
                  </div>
                  <div className="text-sm font-medium">正在同步星标</div>
                  <div className="mt-1 max-w-md text-sm text-muted-foreground">
                    {syncedCount > 0
                      ? `已获取 ${syncedCount} 个仓库，正在写入本地数据库。`
                      : '正在连接 GitHub API，完成第一批同步后会显示仓库列表。'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 text-xs"
                    onClick={() => forceResetSyncState()}
                  >
                    取消同步
                  </Button>
                </div>
              ) : filteredRepositories.length === 0 ? (
                <div className="flex h-[360px] flex-col items-center justify-center rounded-md border bg-background text-center">
                  <Github className="mb-3 size-10 text-muted-foreground" />
                  <div className="text-sm font-medium">还没有星标数据</div>
                  <div className="mt-1 max-w-md text-sm text-muted-foreground">
                    点击右上角同步按钮后，LingMo 会使用同步设置里的 GitHub Token 拉取你的 Star 仓库。
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {filteredRepositories.map(repo => (
                    <RepoCard
                      key={repo.id}
                      repo={repo}
                      selected={selectedRepoIds.has(repo.id)}
                      analyzing={analyzingRepoIds.includes(repo.id) || analyzingRepoId === repo.id}
                      showAiContent={showAiContent}
                      categories={categoryItems}
                      onSelect={toggleSelection}
                      onAnalyze={(repoId) => void analyzeRepositories([repoId])}
                      onEdit={setEditingRepository}
                      onUnstar={setUnstarTarget}
                      onSendToChat={(repository) => void handleSendToChat(repository)}
                      onCategoryChange={handleCategoryChange}
                      onToggleReleaseSubscription={(repoId, subscribed) => void handleToggleReleaseSubscription(repoId, subscribed)}
                      sendingToChat={sendingToChatRepoId === repo.id}
                      sendToChatDisabled={Boolean(sendingToChatRepoId)}
                      onTitleClick={(r) => {
                        setActiveReadmeRepo(r)
                        setIsReadmeOpen(true)
                      }}
                    />
                  ))}
                </div>
              )}
            </main>
          </ScrollArea>
        </div>
        ) : view === 'releases' ? (
          <ReleasesView />
        ) : view === 'forks' ? (
          <ForksView />
        ) : (
          <TrendingView />
        )}

        {/* Status bar */}
        {view === 'repositories' ? (
        <div className="flex h-7 shrink-0 items-center gap-1 border-t bg-muted/30 px-2 text-[11px] text-muted-foreground">
          {/* Left group: view controls */}
          <div className="flex shrink-0 items-center rounded bg-background/80 p-px">
            <button
              type="button"
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] transition-colors',
                showAiContent ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setShowAiContent(true)}
              title="显示 AI 分析内容"
            >
              <Sparkles className="size-3" />
              AI
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] transition-colors',
                !showAiContent ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setShowAiContent(false)}
              title="显示 GitHub 原始描述"
            >
              <BookOpen className="size-3" />
              原始
            </button>
          </div>

          <span className="h-3 w-px bg-border/70" />

          <button
            type="button"
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-colors',
              filtersExpanded || filterPanelActiveCount > 0
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
            onClick={() => setFiltersExpanded((value) => !value)}
            title="展开语言和分析状态筛选"
          >
            <SlidersHorizontal className="size-3" />
            筛选
            {filterPanelActiveCount > 0 ? (
              <span className="rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">{filterPanelActiveCount}</span>
            ) : null}
          </button>

          {activeFilterCount > 0 ? (
            <button
              type="button"
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              onClick={handleClearFilters}
              title="清除搜索、筛选和排序"
            >
              <X className="size-3" />
              清除
            </button>
          ) : null}

          <span className="h-3 w-px bg-border/70" />

          <Select value={filters.sortBy} onValueChange={(value) => setFilters({ sortBy: value as typeof filters.sortBy })}>
            <SelectTrigger className="h-5 w-[90px] rounded border-none bg-transparent px-1 text-[11px] shadow-none hover:bg-background/60">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="starred">加星时间</SelectItem>
              <SelectItem value="stars">星标数</SelectItem>
              <SelectItem value="updated">更新时间</SelectItem>
              <SelectItem value="name">名称</SelectItem>
            </SelectContent>
          </Select>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right group: stats */}
          <div className="flex shrink-0 items-center gap-2 overflow-hidden">
            {isSyncing ? (
              <span className="whitespace-nowrap text-primary">
                <Loader2 className="mr-0.5 inline size-3 animate-spin" />同步 {syncedCount}
              </span>
            ) : null}
            {isAnalyzing && analysisProgress ? (
              <span className="whitespace-nowrap text-primary">
                <Loader2 className="mr-0.5 inline size-3 animate-spin" />
                {analysisProgress.completed}/{analysisProgress.total}
                {analysisProgress.failed > 0 ? ` · ${analysisProgress.failed}失败` : ''}
              </span>
            ) : null}
            <span className="whitespace-nowrap">
              {analyzedVisibleCount + pendingVisibleCount > 0 ? (
                <>
                  <span className="text-foreground/70">{analyzedVisibleCount}</span>分析
                  <span className="mx-1 text-border">·</span>
                  <span className="text-foreground/70">{pendingVisibleCount}</span>待分析
                </>
              ) : null}
            </span>
            {failedVisibleCount > 0 ? (
              <span className="whitespace-nowrap text-destructive/80">
                {failedVisibleCount}失败
              </span>
            ) : null}
            <span className="hidden whitespace-nowrap text-muted-foreground/50 lg:inline">
              {selectedRepositories.length > 0
                ? `${selectedRepositories.length}/${filteredRepositories.length}已选`
                : `${filteredRepositories.length}/${stats.total}`}
            </span>
          </div>
        </div>
        ) : null}

        {/* Dialogs */}
        <CategoryCreateDialog
          open={categoryDialogOpen}
          onOpenChange={setCategoryDialogOpen}
          onSubmit={addCategory}
        />

        <RepositoryEditDialog
          repository={editingRepository}
          open={Boolean(editingRepository)}
          categories={categoryItems}
          onOpenChange={(open) => {
            if (!open) setEditingRepository(null)
          }}
          onSave={handleSaveRepositoryDetails}
        />

        <AlertDialog open={Boolean(unstarTarget)} onOpenChange={(open) => {
          if (!open) setUnstarTarget(null)
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>取消 Star？</AlertDialogTitle>
              <AlertDialogDescription>
                将从你的 GitHub Star 列表中移除 {unstarTarget?.fullName}。此操作会调用 GitHub API，并从当前列表隐藏该仓库。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUnstarring}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void handleConfirmUnstar()
                }}
                disabled={isUnstarring}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isUnstarring ? <Loader2 className="size-4 animate-spin" /> : <StarOff className="size-4" />}
                确认取消 Star
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ReadmeModal
          isOpen={isReadmeOpen}
          onClose={() => setIsReadmeOpen(false)}
          repoName={activeReadmeRepo?.fullName || null}
          ownerAvatarUrl={activeReadmeRepo?.ownerAvatarUrl || null}
        />
      </div>
    </TooltipProvider>
  )
}
