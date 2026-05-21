'use client'

import { Bot, Clock, Download, ExternalLink, FilePlus2, GitCommitHorizontal, History, Pencil, RotateCcw, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Editor } from '@tiptap/react'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getFileCommits as getGithubFileCommits, getFiles as getGithubFiles, decodeBase64ToString } from '@/lib/sync/github'
import { getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles, decodeBase64ToString as decodeGiteeBase64 } from '@/lib/sync/gitee'
import { getFileCommits as getGitlabFileCommits, getFileContent as getGitlabFileContent } from '@/lib/sync/gitlab'
import { getFileCommits as getGiteaFileCommits, getFileContentFromCommit as getGiteaFileContentFromCommit, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import { getFileRestoreTime, getFileSyncStatus, updateFileSyncTime, updateFileRestoreTime } from '@/lib/sync/conflict-resolution'
import { formatFileActivityTime, getFileSystemMetadata, listStoredFileActivities, type FileActivityType } from '@/lib/file-activity'
import { toast } from '@/hooks/use-toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { isMobileDevice } from '@/lib/check'

interface CommitInfo {
  sha: string
  fullSha?: string // 完整 SHA，用于恢复功能
  message: string
  author: string
  date: Date
  url: string
}

type TimelineKind = FileActivityType | 'commit'

interface TimelineItem {
  id: string
  kind: TimelineKind
  title: string
  description?: string
  date: Date
  commit?: CommitInfo
}

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface HistorySheetProps {
  editor: Editor
}

export function HistorySheet({ editor }: HistorySheetProps) {
  const { activeFilePath } = useArticleStore()
  const [isOpen, setIsOpen] = useState(false)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [restoringSha, setRestoringSha] = useState<string | null>(null)
  const [provider, setProvider] = useState<SyncProvider | null>(null)
  const [repoInfo, setRepoInfo] = useState<{ username?: string; projectId?: string; baseUrl?: string; repo?: string }>({})
  const isMobile = isMobileDevice()

  // Get the sync provider
  const getProvider = useCallback(async (): Promise<SyncProvider | null> => {
    try {
      const store = await Store.load('store.json')
      const provider = await store.get<string>('primaryBackupMethod') || 'github'
      return provider as SyncProvider
    } catch {
      return null
    }
  }, [])

  // Load history
  const loadHistory = useCallback(async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let commits: any[] = []

      switch (provider) {
        case 'github': {
          const result = await getGithubFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitee': {
          const result = await getGiteeFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitlab': {
          const result = await getGitlabFileCommits({ path: activeFilePath, repo })
          // GitLab 返回 { data } 对象，需要从中提取数组
          commits = (result && result.data) ? result.data : []
          break
        }
        case 'gitea': {
          const result = await getGiteaFileCommits({ path: activeFilePath, repo })
          // Gitea 返回 { data } 对象，需要从中提取数组
          commits = (result && result.data) ? result.data : []
          break
        }
      }

      const store = await Store.load('store.json')
      let githubUsername: string | undefined
      let giteeUsername: string | undefined
      let gitlabProjectId: string | undefined
      let giteaUsername: string | undefined
      let giteaBaseUrl: string | undefined

      switch (provider) {
        case 'github':
          githubUsername = await store.get('githubUsername')
          break
        case 'gitee':
          giteeUsername = await store.get('giteeUsername')
          break
        case 'gitlab':
          gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
          break
        case 'gitea':
          giteaUsername = await store.get('giteaUsername')
          giteaBaseUrl = await getGiteaApiBaseUrl()
          break
      }

      const getCommitUrl = (sha: string): string => {
        switch (provider) {
          case 'github':
            return `https://github.com/${githubUsername}/${repo}/commit/${sha}`
          case 'gitee':
            return `https://gitee.com/${giteeUsername}/${repo}/commit/${sha}`
          case 'gitlab':
            return `https://gitlab.com/${gitlabProjectId?.split('/').pop()}/-/commit/${sha}`
          case 'gitea':
            return `${giteaBaseUrl?.replace('/api/v1', '')}/${giteaUsername}/${repo}/commit/${sha}`
          default:
            return ''
        }
      }

      const historyData = commits.slice(0, 10).map((commit: any) => {
        const sha = commit.sha || commit.id || ''
        return {
          sha: sha.slice(0, 7),
          fullSha: sha, // 保存完整 SHA，用于恢复功能
          message: commit.commit?.message || commit.message || 'No message',
          author: commit.commit?.author?.name || commit.author?.name || commit.author_name || 'Unknown',
          date: new Date(commit.commit?.author?.date || commit.created_at || commit.committed_date || Date.now()),
          url: getCommitUrl(sha)
        }
      })

      const [metadata, syncStatus, restoreTime, storedActivities, writingEvents] = await Promise.all([
        getFileSystemMetadata(activeFilePath),
        getFileSyncStatus(activeFilePath).catch(() => null),
        getFileRestoreTime(activeFilePath).catch(() => undefined),
        listStoredFileActivities(activeFilePath),
        import('@/db/activity')
          .then(({ getAllActivityEvents }) => getAllActivityEvents())
          .then(events => events.filter(event => event.source === 'writing' && event.path === activeFilePath).slice(0, 12))
          .catch(() => []),
      ])

      const timelineItems: TimelineItem[] = []

      if (metadata?.createdAt) {
        timelineItems.push({
          id: `created-${activeFilePath}-${metadata.createdAt}`,
          kind: 'created',
          title: '文件创建',
          description: activeFilePath,
          date: new Date(metadata.createdAt),
        })
      }

      if (metadata?.modifiedAt) {
        timelineItems.push({
          id: `modified-${activeFilePath}-${metadata.modifiedAt}`,
          kind: 'modified',
          title: '本地修改',
          description: '文件系统最后修改时间',
          date: new Date(metadata.modifiedAt),
        })
      }

      for (const event of writingEvents) {
        timelineItems.push({
          id: `manual-edit-${event.id}`,
          kind: 'manual-edit',
          title: '手动保存',
          description: event.description || event.title,
          date: new Date(event.createdAt),
        })
      }

      if (syncStatus?.lastSyncTime) {
        timelineItems.push({
          id: `sync-${activeFilePath}-${syncStatus.lastSyncTime}`,
          kind: 'sync',
          title: '同步',
          description: '最近一次同步记录',
          date: new Date(syncStatus.lastSyncTime),
        })
      }

      if (restoreTime) {
        timelineItems.push({
          id: `restore-${activeFilePath}-${restoreTime}`,
          kind: 'restore',
          title: '恢复历史版本',
          description: '从提交历史恢复到本地',
          date: new Date(restoreTime),
        })
      }

      for (const event of storedActivities) {
        timelineItems.push({
          id: event.id,
          kind: event.type,
          title: event.title,
          description: event.description,
          date: new Date(event.timestamp),
        })
      }

      for (const commit of historyData) {
        timelineItems.push({
          id: `commit-${commit.fullSha || commit.sha}`,
          kind: 'commit',
          title: '远端提交',
          description: commit.message,
          date: commit.date,
          commit,
        })
      }

      const deduped = new Map<string, TimelineItem>()
      for (const item of timelineItems) {
        const key = `${item.kind}:${item.title}:${item.date.getTime()}`
        if (!deduped.has(key)) {
          deduped.set(key, item)
        }
      }
      setTimeline([...deduped.values()].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 40))
      setProvider(provider)
      setRepoInfo({
        username: provider === 'github' ? githubUsername : provider === 'gitee' ? giteeUsername : provider === 'gitea' ? giteaUsername : undefined,
        projectId: provider === 'gitlab' ? gitlabProjectId : undefined,
        baseUrl: provider === 'gitea' ? giteaBaseUrl : undefined,
        repo
      })
    } catch (error) {
      console.error('Failed to load history:', error)
      const [metadata, storedActivities] = await Promise.all([
        getFileSystemMetadata(activeFilePath),
        listStoredFileActivities(activeFilePath),
      ])
      const fallbackTimeline: TimelineItem[] = []
      if (metadata?.createdAt) {
        fallbackTimeline.push({ id: `created-${metadata.createdAt}`, kind: 'created', title: '文件创建', description: activeFilePath, date: new Date(metadata.createdAt) })
      }
      if (metadata?.modifiedAt) {
        fallbackTimeline.push({ id: `modified-${metadata.modifiedAt}`, kind: 'modified', title: '本地修改', description: '文件系统最后修改时间', date: new Date(metadata.modifiedAt) })
      }
      for (const event of storedActivities) {
        fallbackTimeline.push({ id: event.id, kind: event.type, title: event.title, description: event.description, date: new Date(event.timestamp) })
      }
      setTimeline(fallbackTimeline.sort((a, b) => b.date.getTime() - a.date.getTime()))
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, getProvider])

  function getTimelineIcon(kind: TimelineKind) {
    switch (kind) {
      case 'created': return FilePlus2
      case 'manual-edit':
      case 'modified': return Pencil
      case 'ai-edit': return Bot
      case 'sync': return UploadCloud
      case 'restore': return RotateCcw
      case 'export': return Download
      case 'commit': return GitCommitHorizontal
      default: return Clock
    }
  }

  function getTimelineLabel(kind: TimelineKind) {
    switch (kind) {
      case 'created': return '创建'
      case 'manual-edit': return '手动'
      case 'modified': return '修改'
      case 'ai-edit': return 'AI'
      case 'sync': return '同步'
      case 'restore': return '恢复'
      case 'export': return '导出'
      case 'commit': return '提交'
      default: return '活动'
    }
  }

  function getTimelineTone(kind: TimelineKind) {
    switch (kind) {
      case 'created': return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
      case 'manual-edit':
      case 'modified': return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200'
      case 'ai-edit': return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200'
      case 'sync': return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200'
      case 'restore': return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
      case 'export': return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-200'
      case 'commit': return 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
      default: return 'border-border bg-muted text-muted-foreground'
    }
  }

  function formatDayGroup(date: Date) {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const dayDiff = Math.floor((startOfToday - startOfDate) / (24 * 60 * 60 * 1000))
    if (dayDiff === 0) return '今天'
    if (dayDiff === 1) return '昨天'
    if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} 天前`
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const timelineStats = timeline.reduce<Record<string, number>>((acc, item) => {
    const label = getTimelineLabel(item.kind)
    acc[label] = (acc[label] || 0) + 1
    return acc
  }, {})

  const groupedTimeline = timeline.reduce<Array<{ day: string; items: TimelineItem[] }>>((groups, item) => {
    const day = formatDayGroup(item.date)
    const last = groups[groups.length - 1]
    if (last?.day === day) {
      last.items.push(item)
    } else {
      groups.push({ day, items: [item] })
    }
    return groups
  }, [])

  // Restore file from specific commit
  const restoreVersion = useCallback(async (commitSha: string) => {
    if (!activeFilePath || restoringSha) return

    setRestoringSha(commitSha)
    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let content = ''

      switch (provider) {
        case 'github': {
          const fileInfo = await getGithubFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            content = decodeBase64ToString(fileInfo.content)
          }
          break
        }
        case 'gitee': {
          const fileInfo = await getGiteeFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            // Gitee 也是 base64 编码
            content = decodeGiteeBase64(fileInfo.content)
          }
          break
        }
        case 'gitlab': {
          try {
            const fileInfo = await getGitlabFileContent({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo?.content) {
              // GitLab 返回的是 base64 编码内容，需要解码
              content = decodeBase64ToString(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] GitLab 获取内容失败:', e)
          }
          break
        }
        case 'gitea': {
          try {
            // 使用 getFileContentFromCommit 通过 Git tree API 获取特定 commit 的文件内容
            const fileInfo = await getGiteaFileContentFromCommit({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo && fileInfo.content) {
              // Gitea 返回的是 base64 编码内容，需要解码
              content = decodeGiteeBase64(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] Gitea 获取内容失败:', e)
          }
          break
        }
      }


      if (content) {
        // 保存到本地文件
        await saveLocalFile(activeFilePath, content)

        // 更新编辑器内容
        editor.commands.clearContent()
        editor.commands.setContent(content, { contentType: 'markdown' })

        // 更新同步时间和恢复时间
        await updateFileSyncTime(activeFilePath)
        await updateFileRestoreTime(activeFilePath)

        toast({
          title: '已恢复',
          description: '已从历史版本恢复文件'
        })

        setIsOpen(false)
      }
    } catch (error) {
      console.error('Failed to restore version:', error)
      toast({
        title: '恢复失败',
        description: '无法从历史版本恢复文件',
        variant: 'destructive'
      })
    } finally {
      setRestoringSha(null)
    }
  }, [activeFilePath, editor, getProvider, restoringSha])

  // Load history when sheet opens
  useEffect(() => {
    if (isOpen && activeFilePath) {
      loadHistory()
    }
  }, [isOpen, activeFilePath, loadHistory])

  if (!activeFilePath) return null

  const trigger = (
    <button
      className={cn(
        'p-0.5 rounded transition-colors hover:bg-[hsl(var(--muted))]',
        isOpen && 'bg-[hsl(var(--muted))]'
      )}
      title="历史记录"
    >
      <History size={14} />
    </button>
  )

  const content = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-semibold text-sm">文件活动时间线</div>
        </div>
        {activeFilePath && provider && repoInfo.repo && (
          <a
            href={(() => {
              switch (provider) {
                case 'github': return `https://github.com/${repoInfo.username}/${repoInfo.repo}/blob/main/${activeFilePath}`
                case 'gitee': return `https://gitee.com/${repoInfo.username}/${repoInfo.repo}/blob/master/${activeFilePath}`
                case 'gitlab': return `https://gitlab.com/${repoInfo.projectId?.split('/').pop()}/-/blob/main/${activeFilePath}`
                case 'gitea': return `${repoInfo.baseUrl?.replace('/api/v1', '')}/${repoInfo.username}/${repoInfo.repo}/src/branch/main/${activeFilePath}`
                default: return '#'
              }
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            title="在仓库中打开"
          >
            <ExternalLink size={10} />
            <span className="truncate max-w-30">{activeFilePath.split('/').pop()}</span>
          </a>
        )}
      </div>
      {timeline.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
            共 {timeline.length} 条
          </span>
          {Object.entries(timelineStats).slice(0, 5).map(([label, count]) => (
            <span key={label} className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
              {label} {count}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            加载中...
          </div>
        ) : timeline.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            暂无文件活动记录
          </div>
        ) : (
          <div className="space-y-3">
            {groupedTimeline.map((group) => (
              <section key={group.day}>
                <div className="sticky top-0 z-10 mb-1 bg-background/95 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                  {group.day}
                </div>
                <ol className="space-y-0">
                  {group.items.map((item, index) => {
                    const Icon = getTimelineIcon(item.kind)
                    const isLast = index === group.items.length - 1
                    return (
                      <li key={item.id + index} className="grid grid-cols-[1.65rem_minmax(0,1fr)] gap-2">
                        <div className="relative flex justify-center">
                          {!isLast ? <span className="absolute top-7 bottom-0 w-px bg-border" /> : null}
                          <span className={cn('relative z-10 mt-1 flex size-6 items-center justify-center rounded-full border', getTimelineTone(item.kind))}>
                            <Icon size={12} />
                          </span>
                        </div>
                        <div className="min-w-0 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/35">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{item.title}</span>
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{getTimelineLabel(item.kind)}</span>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatFileActivityTime(item.date.getTime()).slice(11)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.description}>
                            {item.description || item.title}
                          </p>
                          {item.commit ? (
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <a
                                href={item.commit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-w-0 items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary"
                              >
                                <span>{item.commit.sha}</span>
                                <ExternalLink size={10} />
                              </a>
                              <button
                                onClick={() => restoreVersion(item.commit?.fullSha || item.commit?.sha || '')}
                                disabled={restoringSha === item.commit.sha}
                                className={cn(
                                  'shrink-0 text-xs text-blue-500 hover:text-blue-600 inline-flex items-center gap-1',
                                  restoringSha === item.commit.sha && 'opacity-50'
                                )}
                                title="恢复此版本"
                              >
                                <RotateCcw size={12} />
                                {restoringSha === item.commit.sha ? '恢复中' : '恢复'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>文件活动时间线</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 overflow-hidden">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-90 max-h-100 overflow-hidden flex flex-col">
        {content}
      </PopoverContent>
    </Popover>
  )
}

export default HistorySheet
