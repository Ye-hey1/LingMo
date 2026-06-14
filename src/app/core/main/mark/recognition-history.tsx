'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { saveTextAs } from '@/lib/output-workshop/export'
import { cn } from '@/lib/utils'

type SourceOrigin = 'empty' | 'clipboard-text' | 'clipboard-image' | 'drop-text' | 'drop-image' | 'manual'
type HistoryTypeFilter = 'all' | 'image' | 'text' | 'favorite'
type HistorySourceFilter = 'all' | SourceOrigin

interface RecognitionHistoryItem {
  id: string
  timestamp: number
  type: 'image' | 'text'
  sourceOrigin?: SourceOrigin
  sourceLabel?: string
  desc: string
  content: string
  thumbnail?: string
  favorite?: boolean
  tags?: string[]
}

interface RecognitionHistoryProps {
  version?: number
  onSelect: (item: RecognitionHistoryItem) => void
  onDelete: (id: string) => void
  onClear: () => void
  className?: string
}

const HISTORY_KEY = 'recognition-history'
const SOURCE_OPTIONS: SourceOrigin[] = ['clipboard-text', 'clipboard-image', 'drop-text', 'drop-image', 'manual']

function normalizeHistoryItem(item: RecognitionHistoryItem): RecognitionHistoryItem {
  return {
    ...item,
    favorite: item.favorite === true,
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
  }
}

function getExportDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function RecognitionHistory({
  version,
  onSelect,
  onDelete,
  onClear,
  className
}: RecognitionHistoryProps) {
  const t = useTranslations()
  const [history, setHistory] = useState<RecognitionHistoryItem[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<HistoryTypeFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const loadHistory = useCallback(() => {
    if (typeof window === 'undefined') return

    const saved = window.localStorage.getItem(HISTORY_KEY)
    if (!saved) {
      setHistory([])
      return
    }

    try {
      const items = JSON.parse(saved) as RecognitionHistoryItem[]
      setHistory(items.map(normalizeHistoryItem))
    } catch (error) {
      console.error('Failed to load history:', error)
      setHistory([])
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory, version])

  const saveHistory = useCallback((items: RecognitionHistoryItem[]) => {
    const normalizedItems = items.map(normalizeHistoryItem)
    setHistory(normalizedItems)
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(normalizedItems))
  }, [])

  const sourceLabel = useCallback((origin?: SourceOrigin, fallback?: string) => {
    if (fallback) return fallback
    if (origin === 'clipboard-text') return t('record.mark.enhancedClipboard.source.clipboardText')
    if (origin === 'clipboard-image') return t('record.mark.enhancedClipboard.source.clipboardImage')
    if (origin === 'drop-text') return t('record.mark.enhancedClipboard.source.dropText')
    if (origin === 'drop-image') return t('record.mark.enhancedClipboard.source.dropImage')
    if (origin === 'manual') return t('record.mark.enhancedClipboard.source.manual')
    return t('record.mark.enhancedClipboard.source.empty')
  }, [t])

  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return t('record.mark.recognitionHistory.justNow')
    if (diff < 3600000) return t('record.mark.recognitionHistory.minutesAgo', { count: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('record.mark.recognitionHistory.hoursAgo', { count: Math.floor(diff / 3600000) })
    return date.toLocaleDateString()
  }, [t])

  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return history.filter((item) => {
      if (typeFilter === 'favorite' && !item.favorite) return false
      if (typeFilter === 'image' && item.type !== 'image') return false
      if (typeFilter === 'text' && item.type !== 'text') return false
      if (sourceFilter !== 'all' && item.sourceOrigin !== sourceFilter) return false
      if (!normalizedQuery) return true

      const haystack = [
        item.desc,
        item.content,
        item.sourceLabel,
        ...(item.tags || []),
      ].join('\n').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [history, query, sourceFilter, typeFilter])

  const selectedItems = useMemo(() => (
    history.filter((item) => selectedIds.has(item.id))
  ), [history, selectedIds])

  const allFilteredSelected = filteredHistory.length > 0 && filteredHistory.every((item) => selectedIds.has(item.id))

  const toggleSelectFiltered = useCallback(() => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected) {
        filteredHistory.forEach((item) => next.delete(item.id))
      } else {
        filteredHistory.forEach((item) => next.add(item.id))
      }
      return next
    })
  }, [allFilteredSelected, filteredHistory])

  const handleFavorite = useCallback((id: string) => {
    saveHistory(history.map((item) => (
      item.id === id ? { ...item, favorite: !item.favorite } : item
    )))
  }, [history, saveHistory])

  const handleDelete = useCallback((id: string) => {
    const updated = history.filter(item => item.id !== id)
    saveHistory(updated)
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    onDelete(id)
  }, [history, onDelete, saveHistory])

  const handleClear = useCallback(() => {
    saveHistory([])
    setSelectedIds(new Set())
    setClearDialogOpen(false)
    onClear()
  }, [onClear, saveHistory])

  const formatExportMarkdown = useCallback((items: RecognitionHistoryItem[]) => {
    return items.map((item, index) => {
      const tags = item.tags?.length
        ? `${t('record.mark.recognitionHistory.export.tags')}${item.tags.map((tag) => `#${tag}`).join(' ')}\n`
        : ''
      return [
        `## ${index + 1}. ${item.desc || t('record.mark.recognitionHistory.noDescription')}`,
        '',
        `- ${t('record.mark.recognitionHistory.export.type')}${t(`record.mark.recognitionHistory.type.${item.type}`)}`,
        `- ${t('record.mark.recognitionHistory.export.source')}${sourceLabel(item.sourceOrigin, item.sourceLabel)}`,
        `- ${t('record.mark.recognitionHistory.export.time')}${new Date(item.timestamp).toLocaleString()}`,
        tags ? `- ${tags.trim()}` : '',
        '',
        item.content || '',
      ].filter(Boolean).join('\n')
    }).join('\n\n---\n\n')
  }, [sourceLabel, t])

  const handleExport = useCallback(async (items: RecognitionHistoryItem[]) => {
    if (items.length === 0) {
      toast({ title: t('record.mark.recognitionHistory.export.empty') })
      return
    }

    try {
      const filename = `lingmo-knowledge-relay-${getExportDate()}.md`
      const result = await saveTextAs(formatExportMarkdown(items), filename, 'text/markdown;charset=utf-8')
      if (!result.canceled) {
        toast({ title: t('record.mark.recognitionHistory.export.success', { count: items.length }) })
      }
    } catch (error) {
      console.error('Failed to export recognition history:', error)
      toast({ title: t('record.mark.recognitionHistory.export.fail') })
    }
  }, [formatExportMarkdown, t])

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {t('record.mark.recognitionHistory.title')}
          </span>
          <span className="rounded-md bg-muted/50 px-1.5 py-0 text-[10px] text-muted-foreground">
            {history.length}
          </span>
        </div>
      </div>

      {history.length === 0 ? (
              <div className="p-8 text-center">
                <History className="mx-auto mb-2 size-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {t('record.mark.recognitionHistory.empty')}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3 border-b border-border/50 p-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_160px]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('record.mark.recognitionHistory.searchPlaceholder')}
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as HistoryTypeFilter)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('record.mark.recognitionHistory.filters.all')}</SelectItem>
                        <SelectItem value="image">{t('record.mark.recognitionHistory.filters.image')}</SelectItem>
                        <SelectItem value="text">{t('record.mark.recognitionHistory.filters.text')}</SelectItem>
                        <SelectItem value="favorite">{t('record.mark.recognitionHistory.filters.favorite')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as HistorySourceFilter)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('record.mark.recognitionHistory.filters.allSources')}</SelectItem>
                        {SOURCE_OPTIONS.map((origin) => (
                          <SelectItem key={origin} value={origin}>
                            {sourceLabel(origin)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectFiltered} />
                      {t('record.mark.recognitionHistory.selection.filtered', { count: filteredHistory.length })}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedIds.size > 0 && (
                        <button
                          type="button"
                          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => setSelectedIds(new Set())}
                        >
                          <X className="size-3" />
                          {t('record.mark.recognitionHistory.selection.clear')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => handleExport(selectedIds.size > 0 ? selectedItems : filteredHistory)}
                      >
                        <Download className="size-3" />
                        {selectedIds.size > 0
                          ? t('record.mark.recognitionHistory.export.selected', { count: selectedIds.size })
                          : t('record.mark.recognitionHistory.export.filtered')}
                      </button>
                    </div>
                  </div>
                </div>

                <ScrollArea className="max-h-[350px]">
                  <div className="space-y-px p-1.5">
                    {filteredHistory.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        {t('record.mark.recognitionHistory.noResults')}
                      </div>
                    ) : filteredHistory.map((item) => (
                      <div
                        key={item.id}
                        className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-muted/50"
                        onClick={() => onSelect(item)}
                      >
                        <div className={cn(
                          'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded',
                          item.type === 'image'
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-green-500/10 text-green-500'
                        )}>
                          {item.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : item.type === 'image' ? (
                            <ImageIcon className="size-3.5" />
                          ) : (
                            <FileText className="size-3.5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {item.desc || t('record.mark.recognitionHistory.noDescription')}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground/70">
                            <span>{formatTime(item.timestamp)}</span>
                            {item.favorite && <Star className="size-2.5 fill-amber-400 text-amber-400" />}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title={item.favorite ? '取消收藏' : '收藏'}
                            onClick={(event) => { event.stopPropagation(); handleFavorite(item.id) }}
                            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Star className={cn('size-3', item.favorite && 'fill-amber-400 text-amber-400')} />
                          </button>
                          <button
                            type="button"
                            title={t('record.mark.recognitionHistory.actions.delete')}
                            onClick={(event) => { event.stopPropagation(); handleDelete(item.id) }}
                            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="border-t border-border/50 p-2">
                  <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
                    <button
                      type="button"
                      onClick={() => setClearDialogOpen(true)}
                      className="w-full rounded py-1.5 text-[11px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                    >
                      {t('record.mark.recognitionHistory.clearAll')}
                    </button>
                    <AlertDialogContent className="rounded-lg shadow-none">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-base">
                          {t('record.mark.recognitionHistory.confirmClearTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('record.mark.recognitionHistory.confirmClearDesc', { count: history.length })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleClear}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('record.mark.recognitionHistory.confirmClearAction')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
    </div>
  )
}
