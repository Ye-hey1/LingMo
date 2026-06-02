'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  RefreshCcw,
  Search,
  CalendarDays,
  LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGithubStarsStore } from '@/stores/github-stars'
import { ReleaseCard } from './release-card'
import { AssetFilterManager } from './AssetFilterManager'
import { PRESET_FILTERS } from './preset-filters'
import type { AssetFilter } from '@/types/github-stars'

const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function ReleasesView() {
  const {
    repositories,
    releases,
    includePrerelease,
    isRefreshingReleases,
    releaseProgress,
    refreshReleases,
    markReleaseRead,
    setIncludePrerelease,
    // 资产过滤与双模视图相关的全局状态
    assetFilters,
    releaseViewMode,
    releaseSelectedFilters,
    releaseSearchQuery,
    releaseExpandedRepositories,
    setReleaseViewMode,
    toggleReleaseSelectedFilter,
    clearReleaseSelectedFilters,
    setReleaseSearchQuery,
    toggleReleaseExpandedRepository,
  } = useGithubStarsStore()

  const [repoFilter, setRepoFilter] = useState('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const query = releaseSearchQuery
  const setQuery = setReleaseSearchQuery

  const subscribedRepositories = useMemo(
    () => repositories.filter(repo => repo.subscribedToReleases),
    [repositories],
  )

  const matchesActiveFilters = useCallback((linkName: string, selectedFilters: string[], assetFilters: AssetFilter[]): boolean => {
    if (selectedFilters.length === 0) return true
    
    const lowerLinkName = linkName.toLowerCase()
    const activeCustomFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id))
    const activePresetFilters = PRESET_FILTERS.filter(filter => selectedFilters.includes(filter.id))
    
    const matchesCustom = activeCustomFilters.some(filter => 
      filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
    )
    
    const matchesPreset = activePresetFilters.some(filter => 
      filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
    )
    
    return matchesCustom || matchesPreset
  }, [])

  // 综合过滤 Releases
  const filteredReleases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return releases.filter((release) => {
      if (repoFilter !== 'all' && release.repository.fullName !== repoFilter) return false
      if (!includePrerelease && release.prerelease) return false

      // 1. 资产过滤器筛选：若选中了任何过滤器，但所有文件名都不匹配，则排除该 Release
      if (releaseSelectedFilters.length > 0) {
        const links: string[] = []
        release.assets.forEach(asset => links.push(asset.name))
        if (release.zipballUrl) links.push(`Source code (${release.tagName}.zip)`)
        if (release.tarballUrl) links.push(`Source code (${release.tagName}.tar.gz)`)

        const hasMatchingLink = links.some(name => matchesActiveFilters(name, releaseSelectedFilters, assetFilters))
        if (!hasMatchingLink) return false
      }

      // 2. 搜索框文字筛选
      if (!normalizedQuery) return true

      return [
        release.repository.fullName,
        release.tagName,
        release.name || '',
        release.body || '',
      ].join(' ').toLowerCase().includes(normalizedQuery)
    })
  }, [includePrerelease, query, releases, repoFilter, releaseSelectedFilters, assetFilters, matchesActiveFilters])

  // 时间线模式下的分页计算
  const totalPages = Math.max(1, Math.ceil(filteredReleases.length / pageSize))
  const clampedPage = Math.min(page, totalPages)
  const startIndex = (clampedPage - 1) * pageSize
  const pageReleases = filteredReleases.slice(startIndex, startIndex + pageSize)

  const resetToFirstPage = () => setPage(1)

  // 仓库分组折叠模式下的分组计算
  const repositoriesWithReleases = useMemo(() => {
    const groups: Record<number, { repo: typeof repositories[0], releases: typeof filteredReleases }> = {}
    
    filteredReleases.forEach(release => {
      const repoId = release.repository.id
      if (!groups[repoId]) {
        const repo = repositories.find(r => r.id === repoId)
        if (repo) {
          groups[repoId] = { repo, releases: [] }
        }
      }
      if (groups[repoId]) {
        groups[repoId].releases.push(release)
      }
    })

    // 排序：根据每个仓库下最新 Release 的发布时间进行降序排列
    return Object.values(groups).sort((a, b) => {
      const aLatest = a.releases[0]?.publishedAt || ''
      const bLatest = b.releases[0]?.publishedAt || ''
      return bLatest.localeCompare(aLatest)
    })
  }, [filteredReleases, repositories])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
      {/* 头部控制栏 */}
      <div className="shrink-0 border-b bg-background p-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Package className="size-4 text-muted-foreground" />
              发布管理
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              跟踪已订阅仓库的 GitHub Release、下载包资产和更新日志
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 模式切换 */}
            <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5 border border-border">
              <Button
                variant={releaseViewMode === 'timeline' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2.5 text-xs gap-1 shadow-none"
                onClick={() => {
                  setReleaseViewMode('timeline')
                  resetToFirstPage()
                }}
              >
                <CalendarDays className="size-3.5" />
                时间线
              </Button>
              <Button
                variant={releaseViewMode === 'repository' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2.5 text-xs gap-1 shadow-none"
                onClick={() => setReleaseViewMode('repository')}
              >
                <LayoutGrid className="size-3.5" />
                仓库分组
              </Button>
            </div>

            <label className="flex h-8 items-center gap-2 rounded-md border bg-muted/30 px-2 text-xs text-muted-foreground">
              <Switch
                checked={includePrerelease}
                onCheckedChange={(value) => {
                  setIncludePrerelease(value)
                  resetToFirstPage()
                }}
              />
              包含预发布
            </label>
            <Button
              className="h-8 gap-1.5"
              size="sm"
              onClick={() => void refreshReleases()}
              disabled={isRefreshingReleases || subscribedRepositories.length === 0}
            >
              {isRefreshingReleases ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              刷新发布
            </Button>
          </div>
        </div>

        {/* 搜索和基本过滤 */}
        <div className="grid gap-2 lg:grid-cols-[1fr_240px_120px]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="搜索仓库、版本号、标题或更新日志..."
              className="h-9 bg-muted/50 pl-9"
              onChange={(event) => {
                setQuery(event.target.value)
                resetToFirstPage()
              }}
            />
          </div>
          <Select
            value={repoFilter}
            onValueChange={(value) => {
              setRepoFilter(value)
              resetToFirstPage()
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="全部订阅仓库" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部订阅仓库</SelectItem>
              {subscribedRepositories.map(repo => (
                <SelectItem key={repo.id} value={repo.fullName}>
                  {repo.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value))
              resetToFirstPage()
            }}
            disabled={releaseViewMode === 'repository'}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="每页" />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map(size => (
                <SelectItem key={size} value={String(size)}>
                  每页 {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 资产过滤器面板 */}
        <AssetFilterManager
          selectedFilters={releaseSelectedFilters}
          onFilterToggle={(filterId) => {
            toggleReleaseSelectedFilter(filterId)
            resetToFirstPage()
          }}
          onClearFilters={() => {
            clearReleaseSelectedFilters()
            resetToFirstPage()
          }}
        />

        {isRefreshingReleases && releaseProgress ? (
          <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
            <Loader2 className="size-4 animate-spin" />
            已刷新 {releaseProgress.completed}/{releaseProgress.total} 个仓库
            {releaseProgress.failed > 0 ? `，${releaseProgress.failed} 个失败` : ''}
          </div>
        ) : null}
      </div>

      {/* 主视图渲染区域 */}
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-5xl space-y-3 p-4">
          {subscribedRepositories.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center rounded-md border bg-background text-center">
              <Bell className="mb-3 size-10 text-muted-foreground" />
              <div className="text-sm font-medium">还没有订阅 Release</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                回到仓库视图，在仓库卡片中打开“订阅 Release”，再刷新这里。
              </p>
            </div>
          ) : filteredReleases.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center rounded-md border bg-background text-center">
              <Package className="mb-3 size-10 text-muted-foreground" />
              <div className="text-sm font-medium">没有匹配的发布记录</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                可以尝试清除资产过滤器，或点击“刷新发布”拉取订阅仓库的最新 Release。
              </p>
            </div>
          ) : releaseViewMode === 'timeline' ? (
            /* 时间线分页模式 */
            <div className="space-y-3">
              {pageReleases.map(release => (
                <ReleaseCard
                  key={release.id}
                  release={release}
                  onMarkRead={(id) => void markReleaseRead(id)}
                  selectedFilters={releaseSelectedFilters}
                  assetFilters={assetFilters}
                />
              ))}
            </div>
          ) : (
            /* 仓库折叠分组模式 */
            <div className="space-y-3">
              {repositoriesWithReleases.map(({ repo, releases: repoReleases }) => {
                const isExpanded = releaseExpandedRepositories.has(repo.id)
                const unreadCount = repoReleases.filter(r => !r.isRead).length
                
                return (
                  <div key={repo.id} className="rounded-lg border border-border bg-background overflow-hidden transition-all duration-200">
                    <div
                      onClick={() => toggleReleaseExpandedRepository(repo.id)}
                      className="flex items-center justify-between p-3.5 bg-muted/30 hover:bg-muted/60 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {unreadCount > 0 && (
                          <span className="size-2 rounded-full bg-primary shrink-0 animate-pulse" />
                        )}
                        <span className="font-semibold text-sm truncate text-foreground">{repo.fullName}</span>
                        <span className="text-xs text-muted-foreground">({repoReleases.length} 个发布)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="p-3.5 space-y-3 bg-muted/10 border-t border-border">
                        {repoReleases.map(release => (
                          <ReleaseCard
                            key={release.id}
                            release={release}
                            onMarkRead={(id) => void markReleaseRead(id)}
                            selectedFilters={releaseSelectedFilters}
                            assetFilters={assetFilters}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </ScrollArea>

      {/* 分页栏：仅在时间线模式下渲染 */}
      {releaseViewMode === 'timeline' && (
        <div className="flex h-9 shrink-0 items-center border-t bg-background px-3 text-xs text-muted-foreground">
          <span>
            显示 {filteredReleases.length === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + pageSize, filteredReleases.length)} / {filteredReleases.length}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7" disabled={clampedPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span>{clampedPage}/{totalPages}</span>
            <Button variant="ghost" size="icon" className="size-7" disabled={clampedPage >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
