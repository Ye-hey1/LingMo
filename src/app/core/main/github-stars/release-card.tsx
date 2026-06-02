'use client'

import { useState, useMemo } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  ExternalLink,
  FileArchive,
  GitBranch,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, convertBytesToSize } from '@/lib/utils'
import type { GithubStarRelease, AssetFilter } from '@/types/github-stars'
import { PRESET_FILTERS } from './preset-filters'
import { formatRelativeTime } from './github-stars-utils'

function getDownloadLinks(release: GithubStarRelease) {
  const links = release.assets.map(asset => ({
    name: asset.name,
    url: asset.browserDownloadUrl,
    size: asset.size,
    downloadCount: asset.downloadCount,
    sourceCode: false,
  }))

  if (release.zipballUrl) {
    links.push({
      name: `Source code (${release.tagName}.zip)`,
      url: release.zipballUrl,
      size: 0,
      downloadCount: 0,
      sourceCode: true,
    })
  }

  if (release.tarballUrl) {
    links.push({
      name: `Source code (${release.tagName}.tar.gz)`,
      url: release.tarballUrl,
      size: 0,
      downloadCount: 0,
      sourceCode: true,
    })
  }

  return links
}

export function ReleaseCard({
  release,
  onMarkRead,
  selectedFilters = [],
  assetFilters = [],
}: {
  release: GithubStarRelease
  onMarkRead: (releaseId: number) => void
  selectedFilters?: string[]
  assetFilters?: AssetFilter[]
}) {
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const notes = (release.body || '').trim()

  const downloadLinks = useMemo(() => {
    const allLinks = getDownloadLinks(release)
    if (selectedFilters.length === 0) return allLinks

    return allLinks.filter(link => {
      const lowerLinkName = link.name.toLowerCase()
      const activeCustomFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id))
      const activePresetFilters = PRESET_FILTERS.filter(filter => selectedFilters.includes(filter.id))
      
      const matchesCustom = activeCustomFilters.some(filter => 
        filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
      )
      
      const matchesPreset = activePresetFilters.some(filter => 
        filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
      )
      
      return matchesCustom || matchesPreset
    })
  }, [release, selectedFilters, assetFilters])

  const isExpanded = assetsOpen || notesOpen

  const handleOpenChange = (kind: 'assets' | 'notes') => {
    onMarkRead(release.id)
    if (kind === 'assets') {
      setAssetsOpen(value => !value)
    } else {
      setNotesOpen(value => !value)
    }
  }

  return (
    <article
      className={cn(
        'rounded-md border bg-background transition-colors hover:border-primary/30',
        isExpanded && 'border-primary/30 ring-1 ring-primary/15',
      )}
      onClick={() => onMarkRead(release.id)}
    >
      <div className="flex items-start gap-3 p-3">
        {!release.isRead ? (
          <span className="mt-3 size-2 shrink-0 rounded-full bg-primary" />
        ) : (
          <span className="mt-3 size-2 shrink-0 rounded-full bg-muted" />
        )}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
          <GitBranch className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{release.repository.name}</span>
            <Badge variant={release.prerelease ? 'outline' : 'secondary'} className="h-5 rounded px-1.5 font-normal">
              {release.tagName}
            </Badge>
            {release.prerelease ? (
              <Badge variant="outline" className="h-5 rounded px-1.5 font-normal text-muted-foreground">预发布</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{release.repository.fullName}</p>
          {release.name && release.name !== release.tagName ? (
            <p className="mt-2 line-clamp-1 text-sm text-foreground/80">{release.name}</p>
          ) : null}
        </div>
        <div className="hidden min-w-[88px] text-right text-xs text-muted-foreground sm:block">
          {formatRelativeTime(release.publishedAt)}
        </div>
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" title="打开 Release">
          <a href={release.htmlUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
        <Button
          variant={assetsOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={downloadLinks.length === 0}
          onClick={(event) => {
            event.stopPropagation()
            handleOpenChange('assets')
          }}
        >
          {assetsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          资产 {downloadLinks.length}
        </Button>
        <Button
          variant={notesOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={!notes}
          onClick={(event) => {
            event.stopPropagation()
            handleOpenChange('notes')
          }}
        >
          <BookOpen className="size-3.5" />
          日志
        </Button>
      </div>

      {assetsOpen && downloadLinks.length > 0 ? (
        <div className="border-t bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileArchive className="size-3.5" />
            下载文件
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
            {downloadLinks.map(link => (
              <a
                key={`${release.id}-${link.name}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60"
                onClick={event => event.stopPropagation()}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {link.sourceCode ? <Code2 className="size-3.5 shrink-0 text-muted-foreground" /> : <Download className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{link.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {link.size > 0 ? convertBytesToSize(link.size) : ''}
                  {link.downloadCount > 0 ? ` · ${link.downloadCount.toLocaleString()} 次` : ''}
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {notesOpen && notes ? (
        <div className="border-t bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <BookOpen className="size-3.5" />
            Release 说明
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-sm leading-6 text-foreground/85">
            {notes}
          </pre>
        </div>
      ) : null}
    </article>
  )
}

