'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Edit3,
  Loader2,
  Plus,
  Rss,
  Search,
  Trash2,
  X,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotUserFeed } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'
import {
  getWechatMpStatus,
  searchWechatMpAccounts,
  type WechatMpAccount,
} from '@/lib/wechat-mp-native'

interface HotspotSourceViewProps {
  userFeeds: AiHotspotUserFeed[]
  searchQuery: string
  onAddUserFeed: (input: { title: string; feedUrl: string; groupName?: string | null; enabled?: boolean }) => Promise<void>
  onUpdateUserFeed: (id: string, patch: Partial<Pick<AiHotspotUserFeed, 'title' | 'feedUrl' | 'groupName' | 'enabled'>>) => Promise<void>
  onToggleUserFeed: (id: string, enabled: boolean) => Promise<void>
  onDeleteUserFeed: (id: string) => Promise<void>
}

const SOURCE_CATEGORY_ORDER = ['RSS', '公众号', '聚合', 'OPML', '自定义'] as const

const BUILTIN_CATEGORY_LABELS: Record<string, string> = {
  rss: 'RSS',
  'wechat-rss': '公众号',
  newsnow: '聚合',
  buzzing: '聚合',
  zeli: '聚合',
  techurls: '聚合',
}

/** 获取源的分类标签 */
function getSourceCategory(feed: AiHotspotUserFeed): string {
  const group = (feed.groupName || '').trim()
  if (!group) return '自定义'
  const normalized = group.toLowerCase()
  if (!group.startsWith('builtin:')) {
    if (normalized === 'custom') return '自定义'
    if (normalized === 'wechat-mp') return '公众号'
    if (normalized === 'opml') return 'OPML'
    if (normalized === 'rss') return 'RSS'
    return group
  }

  const type = group.replace('builtin:', '')
  return BUILTIN_CATEGORY_LABELS[type] || type
}

function getGroupNameForCategory(category: string): string {
  if (category === '公众号') return 'wechat-mp'
  return category === '自定义' ? 'custom' : category
}

function getFeedDisplayUrl(feed: AiHotspotUserFeed) {
  return getSourceCategory(feed) === '公众号' ? '公众号源' : feed.feedUrl
}

function sortSourceCategories(left: string, right: string): number {
  const leftIndex = SOURCE_CATEGORY_ORDER.indexOf(left as typeof SOURCE_CATEGORY_ORDER[number])
  const rightIndex = SOURCE_CATEGORY_ORDER.indexOf(right as typeof SOURCE_CATEGORY_ORDER[number])
  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
  }
  return left.localeCompare(right, 'zh-CN')
}

export function HotspotSourceView({
  userFeeds,
  searchQuery,
  onAddUserFeed,
  onUpdateUserFeed,
  onToggleUserFeed,
  onDeleteUserFeed,
}: HotspotSourceViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [addingCategory, setAddingCategory] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(() => new Set())
  const [wechatConnected, setWechatConnected] = useState(false)
  const [wechatQuery, setWechatQuery] = useState('')
  const [wechatResults, setWechatResults] = useState<WechatMpAccount[]>([])
  const [isSearchingWechat, setIsSearchingWechat] = useState(false)
  const [subscribingWechatId, setSubscribingWechatId] = useState('')

  useEffect(() => {
    let cancelled = false
    void getWechatMpStatus()
      .then(status => {
        if (!cancelled) setWechatConnected(status.connected)
      })
      .catch(() => {
        if (!cancelled) setWechatConnected(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshWechatStatus = () => {
    void getWechatMpStatus()
      .then(status => setWechatConnected(status.connected))
      .catch(() => setWechatConnected(false))
  }

  // 按分类分组
  const grouped = new Map<string, AiHotspotUserFeed[]>()
  for (const feed of userFeeds) {
    const cat = getSourceCategory(feed)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(feed)
  }

  // 搜索过滤
  const categories = Array.from(new Set([
    ...SOURCE_CATEGORY_ORDER,
    ...Array.from(grouped.keys()),
  ])).sort(sortSourceCategories)

  const visibleGroups = new Map<string, AiHotspotUserFeed[]>()
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  for (const cat of categories) {
    const feeds = grouped.get(cat) || []
    const filtered = normalizedSearchQuery
      ? feeds.filter(f =>
          f.title.toLowerCase().includes(normalizedSearchQuery) ||
          f.feedUrl.toLowerCase().includes(normalizedSearchQuery)
        )
      : feeds
    if (filtered.length > 0 || !normalizedSearchQuery) visibleGroups.set(cat, filtered)
  }

  const openAddForm = (category: string) => {
    setAddingCategory(current => {
      const next = current === category ? null : category
      setNewTitle('')
      setNewUrl('')
      if (next === '公众号') {
        refreshWechatStatus()
      } else {
        setWechatQuery('')
        setWechatResults([])
      }
      return next
    })
  }

  const toggleFeedSelection = (feedId: string, checked: boolean | 'indeterminate') => {
    setSelectedFeedIds(current => {
      const next = new Set(current)
      if (checked === true) {
        next.add(feedId)
      } else {
        next.delete(feedId)
      }
      return next
    })
  }

  const toggleCategorySelection = (feeds: AiHotspotUserFeed[], checked: boolean | 'indeterminate') => {
    const selectableIds = feeds.map(feed => feed.id)
    setSelectedFeedIds(current => {
      const next = new Set(current)
      for (const id of selectableIds) {
        if (checked === true) {
          next.add(id)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  }

  const startEditing = (feed: AiHotspotUserFeed) => {
    setEditingId(feed.id)
    setEditTitle(feed.title)
    setEditUrl(feed.feedUrl)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditTitle('')
    setEditUrl('')
  }

  const handleSaveEdit = async (id: string) => {
    const title = editTitle.trim()
    const feedUrl = editUrl.trim()
    if (!title || !feedUrl) {
      toast({ title: '请填写名称和地址', variant: 'destructive' })
      return
    }
    try {
      await onUpdateUserFeed(id, { title, feedUrl })
      cancelEditing()
      toast({ title: '已更新' })
    } catch (err) {
      toast({ title: '更新失败', description: String(err), variant: 'destructive' })
    }
  }

  const handleAdd = async (category: string) => {
    const title = newTitle.trim()
    const feedUrl = newUrl.trim()
    if (!title || !feedUrl) {
      toast({ title: '请填写名称和地址', variant: 'destructive' })
      return
    }
    try {
      await onAddUserFeed({ title, feedUrl, groupName: getGroupNameForCategory(category), enabled: true })
      setNewTitle('')
      setNewUrl('')
      setAddingCategory(null)
      toast({ title: `已添加到 ${category}` })
    } catch (err) {
      toast({ title: '添加失败', description: String(err), variant: 'destructive' })
    }
  }

  const handleSearchWechat = async () => {
    const query = wechatQuery.trim()
    if (!wechatConnected) {
      toast({ title: '微信未连接', description: '请先在设置中扫码连接微信公众平台。', variant: 'destructive' })
      return
    }
    if (!query) {
      toast({ title: '请输入公众号名称或微信号', variant: 'destructive' })
      return
    }

    setIsSearchingWechat(true)
    try {
      const results = await searchWechatMpAccounts(query)
      setWechatResults(results)
      if (results.length === 0) toast({ title: '没有搜索到公众号' })
    } catch (err) {
      toast({ title: '搜索公众号失败', description: String(err), variant: 'destructive' })
    } finally {
      setIsSearchingWechat(false)
    }
  }

  const handleSubscribeWechat = async (account: WechatMpAccount) => {
    setSubscribingWechatId(account.fakeid)
    try {
      await onAddUserFeed({
        title: account.nickname || account.alias || '微信公众号',
        feedUrl: `wechat-mp://${encodeURIComponent(account.fakeid)}`,
        groupName: 'wechat-mp',
        enabled: true,
      })
      toast({ title: '公众号已添加到信源库', description: '刷新后会拉取该公众号最新文章。' })
    } catch (err) {
      toast({ title: '订阅公众号失败', description: String(err), variant: 'destructive' })
    } finally {
      setSubscribingWechatId('')
    }
  }

  const handleDelete = async (feed: AiHotspotUserFeed) => {
    try {
      await onDeleteUserFeed(feed.id)
      setSelectedFeedIds(current => {
        const next = new Set(current)
        next.delete(feed.id)
        return next
      })
      toast({ title: '已删除' })
    } catch (err) {
      toast({ title: '删除失败', description: String(err), variant: 'destructive' })
    }
  }

  const handleBatchDelete = async (category: string, feeds: AiHotspotUserFeed[]) => {
    const deletableFeeds = feeds.filter(feed => selectedFeedIds.has(feed.id))
    if (deletableFeeds.length === 0) {
      toast({ title: '请选择要删除的信源' })
      return
    }

    try {
      for (const feed of deletableFeeds) {
        await onDeleteUserFeed(feed.id)
      }
      setSelectedFeedIds(current => {
        const next = new Set(current)
        for (const feed of deletableFeeds) next.delete(feed.id)
        return next
      })
      toast({ title: `已从 ${category} 删除 ${deletableFeeds.length} 个源` })
    } catch (err) {
      toast({ title: '批量删除失败', description: String(err), variant: 'destructive' })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 源列表 */}
      <div className="ai-hotspots-surface flex-1 overflow-y-auto p-4">
        <div className="grid auto-rows-[480px] gap-4 xl:grid-cols-2 2xl:auto-rows-[520px]">
          {Array.from(visibleGroups.entries()).map(([category, feeds]) => {
            const selectedCount = feeds.filter(feed => selectedFeedIds.has(feed.id)).length
            const categoryChecked = feeds.length > 0 && selectedCount === feeds.length
              ? true
              : selectedCount > 0
                ? 'indeterminate'
                : false
            const isAddingInCategory = addingCategory === category

            return (
              <section
                key={category}
                className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background/75 shadow-sm"
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/55 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Checkbox
                      checked={categoryChecked}
                      disabled={feeds.length === 0}
                      aria-label={`选择 ${category} 中所有信源`}
                      className="border-muted-foreground/40"
                      onCheckedChange={checked => toggleCategorySelection(feeds, checked)}
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{category}</span>
                      </div>
                      <div className="h-4 text-[11px] text-muted-foreground">
                        {selectedCount > 0 ? `已选 ${selectedCount} 个` : feeds.length === 0 ? '空模块' : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant={isAddingInCategory ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 gap-1 rounded-md px-2 text-[11px] shadow-none active:scale-[0.98]"
                      onClick={() => openAddForm(category)}
                    >
                      {isAddingInCategory ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
                      {isAddingInCategory ? '取消' : '添加'}
                    </Button>
                    <Button
                      variant={selectedCount > 0 ? 'destructive' : 'outline'}
                      size="sm"
                      className="h-7 gap-1 rounded-md px-2 text-[11px] shadow-none active:scale-[0.98]"
                      disabled={selectedCount === 0}
                      onClick={() => handleBatchDelete(category, feeds)}
                    >
                      <Trash2 className="size-3.5" />
                      删除所选
                    </Button>
                  </div>
                </div>

                {isAddingInCategory && (
                  <div className="shrink-0 border-b border-border/70 bg-muted/25 px-3 py-3">
                    {category === '公众号' ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={wechatConnected ? 'inline-flex items-center gap-1 text-xs font-medium text-emerald-600' : 'text-xs text-muted-foreground'}>
                            {wechatConnected ? <CheckCircle2 className="size-3.5" /> : null}
                            {wechatConnected ? '微信已连接，可以搜索公众号' : '微信未连接，请先在设置中扫码登录'}
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            value={wechatQuery}
                            placeholder="搜索公众号名称或微信号"
                            className="h-8 text-xs"
                            disabled={!wechatConnected}
                            onChange={e => setWechatQuery(e.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void handleSearchWechat()
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-md text-xs active:scale-[0.98]"
                            disabled={!wechatConnected || isSearchingWechat}
                            onClick={() => void handleSearchWechat()}
                          >
                            {isSearchingWechat ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                            搜索
                          </Button>
                        </div>
                        {wechatResults.length > 0 ? (
                          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                            {wechatResults.map(account => (
                              <div key={account.fakeid} className="flex items-center gap-2 rounded-md border bg-background/80 px-2 py-2">
                                {account.roundHeadImg ? (
                                  <img src={account.roundHeadImg} alt="" className="size-8 rounded-md object-cover" />
                                ) : (
                                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">微</div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium">{account.nickname || account.alias || '未命名公众号'}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {account.alias ? `微信号：${account.alias}` : account.signature || '公众号'}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  className="h-7 rounded-md px-2 text-[11px]"
                                  disabled={subscribingWechatId === account.fakeid}
                                  onClick={() => void handleSubscribeWechat(account)}
                                >
                                  {subscribingWechatId === account.fakeid ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                                  订阅
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                        <Input
                          value={newTitle}
                          placeholder="源名称"
                          className="h-8 text-xs"
                          onChange={e => setNewTitle(e.target.value)}
                        />
                        <Input
                          value={newUrl}
                          placeholder="https://example.com/feed.xml"
                          className="h-8 text-xs"
                          onChange={e => setNewUrl(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="h-8 rounded-md text-xs active:scale-[0.98]"
                          onClick={() => handleAdd(category)}
                        >
                          <Plus className="size-3.5" />
                          添加
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
                  {feeds.length > 0 ? feeds.map(feed => {
                    const isEditing = editingId === feed.id

                    return (
                      <div
                        key={feed.id}
                        className={cn(
                          'ai-hotspots-source-row flex items-center gap-2 px-3 py-3 hover:bg-muted/45',
                          'min-h-[72px]',
                          !feed.enabled && 'opacity-55'
                        )}
                      >
                        <Checkbox
                          checked={selectedFeedIds.has(feed.id)}
                          aria-label={`选择 ${feed.title}`}
                          className="border-muted-foreground/40"
                          onCheckedChange={checked => toggleFeedSelection(feed.id, checked)}
                        />

                        <button
                          type="button"
                          className="shrink-0 rounded-md p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          onClick={() => onToggleUserFeed(feed.id, !feed.enabled)}
                          title={feed.enabled ? '点击关闭' : '点击开启'}
                          aria-label={feed.enabled ? '关闭信源' : '开启信源'}
                        >
                          {feed.enabled ? (
                            <ToggleRight className="size-5 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="size-5 text-muted-foreground" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                              <Input
                                value={editTitle}
                                className="h-7 text-xs"
                                onChange={e => setEditTitle(e.target.value)}
                              />
                              <Input
                                value={editUrl}
                                className="h-7 text-xs"
                                onChange={e => setEditUrl(e.target.value)}
                              />
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate text-sm font-medium">{feed.title}</span>
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{getFeedDisplayUrl(feed)}</div>
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md active:scale-[0.98]"
                                onClick={() => handleSaveEdit(feed.id)}
                                title="保存"
                              >
                                <Check className="size-3.5 text-emerald-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md active:scale-[0.98]"
                                onClick={cancelEditing}
                                title="取消"
                              >
                                <X className="size-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md active:scale-[0.98]"
                                onClick={() => startEditing(feed)}
                                title="编辑"
                              >
                                <Edit3 className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md text-destructive active:scale-[0.98]"
                                onClick={() => handleDelete(feed)}
                                title="删除"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="flex min-h-[132px] flex-col items-center justify-center px-4 py-8 text-center">
                      <div className="mb-2 flex size-10 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                        <Rss className="size-5" />
                      </div>
                      <div className="text-sm font-medium">暂无信源</div>
                      <div className="mt-1 text-xs text-muted-foreground">{category} 模块当前为空</div>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        {visibleGroups.size === 0 && (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-dashed border-border/80 bg-background/70 px-4 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
              <Rss className="size-6" />
            </div>
            <div className="text-sm font-medium">
              {searchQuery ? '没有匹配的源' : '暂无订阅源'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {normalizedSearchQuery ? '换个关键词再试。' : '暂无可管理的订阅源。'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
