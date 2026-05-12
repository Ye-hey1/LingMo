'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TooltipButton } from '@/components/tooltip-button'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  MessageSquare,
  PanelLeft,
  Search,
  Loader2,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

interface PdfToolbarProps {
  onToggleThumbnails: () => void
  thumbnailsOpen: boolean
  onToggleSidebar: () => void
  sidebarOpen: boolean
  currentPage: number
  numPages: number
  scale: number
  searchOpen: boolean
  searchQuery: string
  searchResultCount: number
  activeSearchIndex: number
  explainingPage: boolean
  onSearchOpenChange: (open: boolean) => void
  onSearchQueryChange: (query: string) => void
  onSearchNext: () => void
  onSearchPrev: () => void
  onExplainCurrentPage: () => void
  onPageChange: (page: number) => void
  onScaleChange: (scale: number) => void
  onFitWidth: () => void
}

function clampScale(scale: number): number {
  return Math.max(0.35, Math.min(3, Math.round(scale * 100) / 100))
}

export function PdfToolbar({
  onToggleThumbnails,
  thumbnailsOpen,
  onToggleSidebar,
  sidebarOpen,
  currentPage,
  numPages,
  scale,
  searchOpen,
  searchQuery,
  searchResultCount,
  activeSearchIndex,
  explainingPage,
  onSearchOpenChange,
  onSearchQueryChange,
  onSearchNext,
  onSearchPrev,
  onExplainCurrentPage,
  onPageChange,
  onScaleChange,
  onFitWidth,
}: PdfToolbarProps) {
  const t = useTranslations('article.pdf')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [pageInput, setPageInput] = useState(String(currentPage))

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    if (!searchOpen) return

    window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)
  }, [searchOpen])

  const commitPageInput = () => {
    const page = Number.parseInt(pageInput, 10)
    if (Number.isFinite(page)) {
      onPageChange(page)
    } else {
      setPageInput(String(currentPage))
    }
  }

  const zoomPercent = Math.round(scale * 100)
  const canGoPrev = currentPage > 1
  const canGoNext = currentPage < numPages
  const hasSearchResults = searchResultCount > 0

  return (
    <div className="relative flex h-11 shrink-0 items-center justify-between gap-3 border-b bg-background px-3">
      <div className="flex min-w-0 items-center gap-1">
        <TooltipButton
          icon={<PanelLeft className="size-4" />}
          tooltipText="缩略图"
          variant={thumbnailsOpen ? 'secondary' : 'ghost'}
          size="icon"
          buttonClassName="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggleThumbnails}
        />
        <TooltipButton
          icon={<MessageSquare className="size-4" />}
          tooltipText={t('toggleSidebar')}
          variant={sidebarOpen ? 'secondary' : 'ghost'}
          size="icon"
          buttonClassName="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggleSidebar}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <TooltipButton
          icon={<ChevronLeft className="size-4" />}
          tooltipText={t('prevPage')}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={!canGoPrev}
          onClick={() => onPageChange(currentPage - 1)}
        />
        <div className="flex h-8 items-center gap-2 rounded-md border bg-muted/25 px-2">
          <Input
            aria-label={t('pageLabel')}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            className="h-6 w-10 border-0 bg-transparent px-0 text-center text-sm shadow-none focus-visible:ring-0"
          />
          <span className="text-xs text-muted-foreground">/ {Math.max(numPages, 1)}</span>
        </div>
        <TooltipButton
          icon={<ChevronRight className="size-4" />}
          tooltipText={t('nextPage')}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={!canGoNext}
          onClick={() => onPageChange(currentPage + 1)}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <TooltipButton
          icon={explainingPage ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          tooltipText={explainingPage ? '正在提取当前页...' : '解释选中/当前页'}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 text-muted-foreground hover:text-foreground"
          disabled={explainingPage || numPages === 0}
          onClick={onExplainCurrentPage}
        />

        {!searchOpen && (
          <TooltipButton
            icon={<Search className="size-4" />}
            tooltipText="搜索 PDF"
            variant="ghost"
            size="icon"
            buttonClassName="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => onSearchOpenChange(true)}
          />
        )}

        <div className="mx-1 h-5 w-px bg-border" />
        <TooltipButton
          icon={<ZoomOut className="size-4" />}
          tooltipText={t('zoomOut')}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => onScaleChange(clampScale(scale - 0.1))}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-14 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onFitWidth}
          title={t('fitPage')}
        >
          {zoomPercent}%
        </Button>
        <TooltipButton
          icon={<ZoomIn className="size-4" />}
          tooltipText={t('zoomIn')}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => onScaleChange(clampScale(scale + 0.1))}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <TooltipButton
          icon={<Maximize2 className="size-4" />}
          tooltipText={t('fitPage')}
          variant="ghost"
          size="icon"
          buttonClassName="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onFitWidth}
        />
      </div>

      {searchOpen && (
        <div className="absolute inset-y-0 right-3 z-10 flex items-center">
          <div className="flex h-8 items-center gap-1 rounded-md border bg-background px-1.5 shadow-sm">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              aria-label="搜索 PDF 文本"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (event.shiftKey) {
                    onSearchPrev()
                  } else {
                    onSearchNext()
                  }
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  onSearchOpenChange(false)
                }
              }}
              placeholder="搜索 PDF"
              className="h-6 w-32 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
            />
            <span className="min-w-12 text-center text-xs text-muted-foreground">
              {searchQuery.trim()
                ? hasSearchResults
                  ? `${activeSearchIndex + 1}/${searchResultCount}`
                  : '0/0'
                : '-'}
            </span>
            <TooltipButton
              icon={<ChevronUp className="size-4" />}
              tooltipText="上一个结果"
              variant="ghost"
              size="icon"
              buttonClassName="h-7 w-7 text-muted-foreground hover:text-foreground"
              disabled={!hasSearchResults}
              onClick={onSearchPrev}
            />
            <TooltipButton
              icon={<ChevronDown className="size-4" />}
              tooltipText="下一个结果"
              variant="ghost"
              size="icon"
              buttonClassName="h-7 w-7 text-muted-foreground hover:text-foreground"
              disabled={!hasSearchResults}
              onClick={onSearchNext}
            />
            <TooltipButton
              icon={<X className="size-4" />}
              tooltipText="关闭搜索"
              variant="ghost"
              size="icon"
              buttonClassName="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onSearchOpenChange(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
