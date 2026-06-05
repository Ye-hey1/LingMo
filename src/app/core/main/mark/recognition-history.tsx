'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArchiveRestore,
  ChevronDown,
  Clock,
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

import { Button } from '@/components/ui/button'
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
  const [isExpanded, setIsExpanded] = useState(true)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<HistoryTypeFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

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

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

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
    <div className={cn('overflow-hidden rounded-xl border border-border/50 bg-card', className)}>
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-3"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t('record.mark.recognitionHistory.title')}
          </span>
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
            {history.length}
          </span>
        </div>
        <ChevronDown className={cn(
          'size-4 text-muted-foreground transition-transform duration-200',
          isExpanded && 'rotate-180'
        )} />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setSelectedIds(new Set())}
                        >
                          <X className="size-3.5" />
                          {t('record.mark.recognitionHistory.selection.clear')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleExport(selectedIds.size > 0 ? selectedItems : filteredHistory)}
                      >
                        <Download className="size-3.5" />
                        {selectedIds.size > 0
                          ? t('record.mark.recognitionHistory.export.selected', { count: selectedIds.size })
                          : t('record.mark.recognitionHistory.export.filtered')}
                      </Button>
                    </div>
                  </div>
                </div>

                <ScrollArea className="max-h-[430px]">
                  <div className="space-y-1 p-2">
                    {filteredHistory.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {t('record.mark.recognitionHistory.noResults')}
                      </div>
                    ) : filteredHistory.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index * 0.02, 0.12) }}
                        className="group flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
                        onClick={() => onSelect(item)}
                      >
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />

                        <div className={cn(
                          'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg',
                          item.type === 'image'
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-green-500/10 text-green-500'
                        )}>
                          {item.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : item.type === 'image' ? (
                            <ImageIcon className="size-4" />
                          ) : (
                            <FileText className="size-4" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {item.desc || t('record.mark.recognitionHistory.noDescription')}
                            </p>
                            {item.favorite && (
                              <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {item.content || t('record.mark.recognitionHistory.noDescription')}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3" />
                              {formatTime(item.timestamp)}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5">
                              {sourceLabel(item.sourceOrigin, item.sourceLabel)}
                            </span>
                            {(item.tags || []).slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded bg-primary/5 px-1.5 py-0.5 text-primary">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t('record.mark.recognitionHistory.actions.favorite')}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleFavorite(item.id)
                            }}
                            className="size-8"
                          >
                            <Star className={cn('size-3.5', item.favorite && 'fill-amber-400 text-amber-400')} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t('record.mark.recognitionHistory.actions.restore')}
                            onClick={(event) => {
                              event.stopPropagation()
                              onSelect(item)
                            }}
                            className="size-8"
                          >
                            <ArchiveRestore className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t('record.mark.recognitionHistory.actions.delete')}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDelete(item.id)
                            }}
                            className="size-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="border-t border-border/50 p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="w-full text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    {t('record.mark.recognitionHistory.clearAll')}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
