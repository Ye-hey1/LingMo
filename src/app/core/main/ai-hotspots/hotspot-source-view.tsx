'use client'

import { useState } from 'react'
import {
  Check,
  Edit3,
  Loader2,
  Plus,
  RefreshCcw,
  Rss,
  Search,
  Trash2,
  X,
  Shield,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotSourceStatus, AiHotspotUserFeed } from '@/lib/ai-hotspots'
import { cn } from '@/lib/utils'

interface HotspotSourceViewProps {
  sources: AiHotspotSourceStatus[]
  userFeeds: AiHotspotUserFeed[]
  isRefreshing: boolean
  onRefresh: () => void
  onAddUserFeed: (input: { title: string; feedUrl: string; groupName?: string | null; enabled?: boolean }) => Promise<void>
  onUpdateUserFeed: (id: string, patch: Partial<Pick<AiHotspotUserFeed, 'title' | 'feedUrl' | 'groupName' | 'enabled'>>) => Promise<void>
  onToggleUserFeed: (id: string, enabled: boolean) => Promise<void>
  onDeleteUserFeed: (id: string) => Promise<void>
}

/** 判断是否为内置源（不可删除） */
function isBuiltinFeed(feed: AiHotspotUserFeed): boolean {
  return (feed.groupName || '').startsWith('builtin:')
}

/** 获取源的分类标签 */
function getSourceCategory(feed: AiHotspotUserFeed): string {
  const group = feed.groupName || ''
  if (!group.startsWith('builtin:')) return '自定义'
  const type = group.replace('builtin:', '')
  const typeMap: Record<string, string> = {
    'rss': 'RSS',
    'wechat-rss': '公众号',
    'newsnow': '聚合',
    'buzzing': '聚合',
    'zeli': '聚合',
    'techurls': '聚合',
  }
  return typeMap[type] || type
}

export function HotspotSourceView({
  sources: _sources,
  userFeeds,
  isRefreshing,
  onRefresh,
  onAddUserFeed,
  onUpdateUserFeed,
  onToggleUserFeed,
  onDeleteUserFeed,
}: HotspotSourceViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')

  // 按分类分组
  const grouped = new Map<string, AiHotspotUserFeed[]>()
  for (const feed of userFeeds) {
    const cat = getSourceCategory(feed)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(feed)
  }

  // 搜索过滤
  const filteredGroups = new Map<string, AiHotspotUserFeed[]>()
  for (const [cat, feeds] of grouped) {
    const filtered = searchQuery
      ? feeds.filter(f =>
          f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.feedUrl.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : feeds
    if (filtered.length > 0) filteredGroups.set(cat, filtered)
  }

  const enabledCount = userFeeds.filter(f => f.enabled).length
  const totalCount = userFeeds.length

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

  const handleAdd = async () => {
    const title = newTitle.trim()
    const feedUrl = newUrl.trim()
    if (!title || !feedUrl) {
      toast({ title: '请填写名称和地址', variant: 'destructive' })
      return
    }
    try {
      await onAddUserFeed({ title, feedUrl, groupName: 'custom', enabled: true })
      setNewTitle('')
      setNewUrl('')
      setIsAdding(false)
      toast({ title: '已添加' })
    } catch (err) {
      toast({ title: '添加失败', description: String(err), variant: 'destructive' })
    }
  }

  const handleDelete = async (feed: AiHotspotUserFeed) => {
    if (isBuiltinFeed(feed)) {
      toast({ title: '内置源不可删除', description: '可以关闭开关来禁用' })
      return
    }
    try {
      await onDeleteUserFeed(feed.id)
      toast({ title: '已删除' })
    } catch (err) {
      toast({ title: '删除失败', description: String(err), variant: 'destructive' })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            placeholder="搜索源名称或地址..."
            className="h-9 pl-9 text-sm"
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{enabledCount}/{totalCount} 已启用</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          刷新全部
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          onClick={() => setIsAdding(!isAdding)}
        >
          {isAdding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {isAdding ? '取消' : '添加源'}
        </Button>
      </div>

      {/* 添加新源表单 */}
      {isAdding && (
        <div className="border-b bg-muted/30 px-4 py-3">
          <div className="text-sm font-medium mb-2">添加自定义 RSS 源</div>
          <div className="flex gap-2">
            <Input
              value={newTitle}
              placeholder="源名称"
              className="h-8 text-xs flex-1"
              onChange={e => setNewTitle(e.target.value)}
            />
            <Input
              value={newUrl}
              placeholder="https://example.com/feed.xml"
              className="h-8 text-xs flex-[2]"
              onChange={e => setNewUrl(e.target.value)}
            />
            <Button size="sm" className="h-8 text-xs" onClick={handleAdd}>
              添加
            </Button>
          </div>
        </div>
      )}

      {/* 源列表 */}
      <div className="flex-1 overflow-y-auto">
        {Array.from(filteredGroups.entries()).map(([category, feeds]) => (
          <div key={category}>
            <div className="sticky top-0 z-10 border-b bg-muted/50 px-4 py-2">
              <span className="text-xs font-medium text-foreground">{category}</span>
              <span className="ml-2 text-xs text-muted-foreground">{feeds.length}</span>
            </div>
            {feeds.map(feed => {
              const builtin = isBuiltinFeed(feed)
              const isEditing = editingId === feed.id

              return (
                <div
                  key={feed.id}
                  className={cn(
                    'flex items-center gap-3 border-b px-4 py-2.5 hover:bg-muted/30 transition-colors',
                    !feed.enabled && 'opacity-50'
                  )}
                >
                  {/* 开关 */}
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={() => onToggleUserFeed(feed.id, !feed.enabled)}
                    title={feed.enabled ? '点击关闭' : '点击开启'}
                  >
                    {feed.enabled ? (
                      <ToggleRight className="size-5 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="size-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* 内容 */}
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Input
                          value={editTitle}
                          className="h-7 text-xs flex-1"
                          onChange={e => setEditTitle(e.target.value)}
                        />
                        <Input
                          value={editUrl}
                          className="h-7 text-xs flex-[2]"
                          onChange={e => setEditUrl(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{feed.title}</span>
                          {builtin && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                              <Shield className="size-2.5" />
                              内置
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{feed.feedUrl}</div>
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1">
                    {isEditing ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleSaveEdit(feed.id)}
                          title="保存"
                        >
                          <Check className="size-3.5 text-emerald-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
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
                          className="size-7"
                          onClick={() => startEditing(feed)}
                          title="编辑"
                        >
                          <Edit3 className="size-3.5" />
                        </Button>
                        {!builtin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            onClick={() => handleDelete(feed)}
                            title="删除"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {filteredGroups.size === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Rss className="mb-3 size-8 text-muted-foreground" />
            <div className="text-sm font-medium">
              {searchQuery ? '没有匹配的源' : '暂无订阅源'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {searchQuery ? '换个关键词试试' : '点击"添加源"来添加自定义 RSS'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
