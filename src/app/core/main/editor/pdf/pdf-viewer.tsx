'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { readWorkspaceBinaryFile } from '@/lib/file-binary'
import { PdfToolbar } from './pdf-toolbar'
import { PdfCanvas } from './pdf-page'
import { PdfSidebar } from './pdf-sidebar'
import { AnnotationPopover } from './annotation-popover'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePDFAnnotationStore } from '@/stores/pdf-annotation'
import { getPdfWorkerSrc } from '@/lib/pdf-worker'
import emitter from '@/lib/emitter'
import type { PdfSearchResult } from './pdf-search-types'
import type { Annotation } from '@/stores/pdf-annotation'
import { toast } from '@/hooks/use-toast'

interface PdfViewerProps {
  filePath: string
  isActive?: boolean
}

async function getPdfPageCount(data: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc()

  const copy = new Uint8Array(data.byteLength)
  copy.set(data)

  const task = pdfjs.getDocument({ data: copy })
  const pdf = await task.promise
  const pages = pdf.numPages
  await pdf.destroy()

  return pages
}

function copyPdfData(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength)
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  return copy
}

function getSelectedPdfText(root: HTMLElement | null): string {
  if (!root || typeof window === 'undefined') return ''

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return ''

  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
    return ''
  }

  return selection
    .toString()
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function getPdfPageText(data: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc()

  const task = pdfjs.getDocument({ data: copyPdfData(data) })
  const pdf = await task.promise

  try {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lines: string[] = []
    let currentLine = ''

    for (const item of textContent.items) {
      if (!('str' in item) || typeof item.str !== 'string') {
        continue
      }

      currentLine += item.str
      if ('hasEOL' in item && item.hasEOL) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim())
        }
        currentLine = ''
      } else {
        currentLine += ' '
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim())
    }

    return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim()
  } finally {
    await pdf.destroy()
  }
}

export function PdfViewer({ filePath, isActive = true }: PdfViewerProps) {
  const t = useTranslations('article.pdf')
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([])
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [explainingPage, setExplainingPage] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const viewerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadAnnotations = usePDFAnnotationStore(s => s.loadAnnotations)

  // Load PDF binary data.
  useEffect(() => {
    let cancelled = false

    async function loadPdf() {
      setLoading(true)
      setError(null)
      try {
        const data = await readWorkspaceBinaryFile(filePath)

        const pages = await getPdfPageCount(data).catch(() => 1)

        if (cancelled) return
        setPdfData(data)
        setNumPages(pages)
        setCurrentPage(1)
        loadAnnotations(filePath)
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load PDF:', err)
          setError(t('loadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [filePath, t, loadAnnotations])

  // Track container width for fit-to-width.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(numPages || 1, page)))
  }, [numPages])

  const handleSearchOpenChange = useCallback((open: boolean) => {
    setSearchOpen(open)

    if (!open) {
      setSearchQuery('')
      setSearchResults([])
      setActiveSearchIndex(0)
    }
  }, [])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query)
    setActiveSearchIndex(0)
  }, [])

  const handleSearchResultsChange = useCallback((results: PdfSearchResult[]) => {
    setSearchResults(results)
    setActiveSearchIndex(current => {
      if (results.length === 0) return 0
      return Math.min(current, results.length - 1)
    })
  }, [])

  const jumpToSearchIndex = useCallback((index: number) => {
    setActiveSearchIndex(() => {
      if (searchResults.length === 0) return 0

      const nextIndex = (index + searchResults.length) % searchResults.length
      const result = searchResults[nextIndex]
      if (result) {
        setCurrentPage(result.pageNumber)
      }
      return nextIndex
    })
  }, [searchResults])

  const handleSearchNext = useCallback(() => {
    jumpToSearchIndex(activeSearchIndex + 1)
  }, [activeSearchIndex, jumpToSearchIndex])

  const handleSearchPrev = useCallback(() => {
    jumpToSearchIndex(activeSearchIndex - 1)
  }, [activeSearchIndex, jumpToSearchIndex])

  const handleJumpToAnnotation = useCallback((annotation: Annotation) => {
    setCurrentPage(annotation.pageIndex + 1)
    setActiveAnnotationId(annotation.id)
  }, [])

  const handleExplainCurrentPage = useCallback(async () => {
    if (explainingPage) return

    const pdfName = filePath.split('/').pop() || filePath
    const selectedText = getSelectedPdfText(viewerRef.current)
    if (selectedText) {
      emitter.emit('insert-quote', {
        quote: selectedText,
        fullContent: selectedText,
        fileName: `${pdfName} 第 ${currentPage} 页选中文本`,
        startLine: currentPage,
        endLine: currentPage,
        from: 0,
        to: selectedText.length,
        articlePath: filePath,
      })
      emitter.emit(
        'quick-prompt-insert',
        '请解释这段 PDF 选中文本，说明它的含义、上下文作用和可引用页码。',
      )
      return
    }

    if (!pdfData) return

    setExplainingPage(true)
    try {
      const pageText = await getPdfPageText(pdfData, currentPage)

      if (!pageText) {
        toast({ title: '当前页没有可提取的文本' })
        return
      }

      emitter.emit('insert-quote', {
        quote: pageText,
        fullContent: pageText,
        fileName: `${pdfName} 第 ${currentPage} 页`,
        startLine: currentPage,
        endLine: currentPage,
        from: 0,
        to: pageText.length,
        articlePath: filePath,
      })
      emitter.emit(
        'quick-prompt-insert',
        `请解释这页 PDF 的核心内容，并提炼关键结论、方法、数据和可引用页码。`,
      )
    } catch (error) {
      console.error('Failed to extract current PDF page:', error)
      toast({ title: '当前页文本提取失败', variant: 'destructive' })
    } finally {
      setExplainingPage(false)
    }
  }, [currentPage, explainingPage, filePath, pdfData])

  const handleFitWidth = useCallback(() => {
    if (containerWidth > 0 && pageSize.width > 0) {
      const thumbnailWidth = thumbnailsOpen ? 160 : 0
      const fitScale = (containerWidth - thumbnailWidth - 48) / pageSize.width
      setScale(Math.max(0.35, Math.min(3, Math.round(fitScale * 100) / 100)))
    }
  }, [containerWidth, pageSize.width, thumbnailsOpen])

  const handlePageSizeChange = useCallback((size: { width: number; height: number }) => {
    setPageSize((current) => {
      if (Math.abs(current.width - size.width) < 1 && Math.abs(current.height - size.height) < 1) {
        return current
      }

      return size
    })
  }, [])

  // Fit width after the PDF metadata is available.
  useEffect(() => {
    if (numPages > 0 && containerWidth > 0 && scale === 1) {
      handleFitWidth()
    }
  }, [numPages, containerWidth, handleFitWidth, scale])

  useEffect(() => {
    if (!isActive) return

    const handleSearchTrigger = () => {
      setSearchOpen(true)
    }

    emitter.on('pdf-search-trigger' as any, handleSearchTrigger)
    return () => {
      emitter.off('pdf-search-trigger' as any, handleSearchTrigger)
    }
  }, [isActive])

  useEffect(() => {
    const handleJumpToPage = (event: unknown) => {
      const payload = event as { filePath?: string; pageNumber?: number }
      if (payload.filePath !== filePath || typeof payload.pageNumber !== 'number') return
      handlePageChange(payload.pageNumber)
    }

    emitter.on('pdf-jump-to-page' as any, handleJumpToPage)
    return () => {
      emitter.off('pdf-jump-to-page' as any, handleJumpToPage)
    }
  }, [filePath, handlePageChange])

  useEffect(() => {
    if (!searchOpen || searchResults.length === 0) return

    const result = searchResults[activeSearchIndex] || searchResults[0]
    if (result) {
      setCurrentPage(result.pageNumber)
    }
  }, [activeSearchIndex, searchOpen, searchResults])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin mr-2" />
          <span className="text-sm text-muted-foreground">{t('readingFile')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={viewerRef}
      className="flex min-h-0 flex-1 overflow-hidden"
      data-pdf-viewer-active={isActive ? 'true' : undefined}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PdfToolbar
          onToggleThumbnails={() => setThumbnailsOpen(!thumbnailsOpen)}
          thumbnailsOpen={thumbnailsOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          sidebarOpen={sidebarOpen}
          currentPage={currentPage}
          numPages={numPages}
          scale={scale}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchResultCount={searchResults.length}
          activeSearchIndex={activeSearchIndex}
          explainingPage={explainingPage}
          onSearchOpenChange={handleSearchOpenChange}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchNext={handleSearchNext}
          onSearchPrev={handleSearchPrev}
          onExplainCurrentPage={handleExplainCurrentPage}
          onPageChange={handlePageChange}
          onScaleChange={setScale}
          onFitWidth={handleFitWidth}
        />

        {/* PDF render area. */}
        <div ref={containerRef} className="relative flex-1 min-h-0">
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <PdfCanvas
              pdfData={pdfData}
              filePath={filePath}
              currentPage={currentPage}
              numPages={numPages}
              scale={scale}
              thumbnailsOpen={thumbnailsOpen}
              searchQuery={searchOpen ? searchQuery : ''}
              activeSearchResultId={searchResults[activeSearchIndex]?.id || null}
              activeAnnotationId={activeAnnotationId}
              onSearchResultsChange={handleSearchResultsChange}
              onPageChange={handlePageChange}
              onScaleChange={setScale}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        </div>
      </div>

      {/* Annotation sidebar. */}
      {sidebarOpen && (
        <PdfSidebar
          pdfPath={filePath}
          onClose={() => setSidebarOpen(false)}
          onJumpToAnnotation={handleJumpToAnnotation}
        />
      )}

      {/* Annotation popover. */}
      <AnnotationPopover pdfPath={filePath} />
    </div>
  )
}
