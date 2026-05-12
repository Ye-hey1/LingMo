'use client'

import { Loader2 } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getPdfWorkerSrc } from '@/lib/pdf-worker'
import { usePDFAnnotationStore, type Annotation } from '@/stores/pdf-annotation'
import type { PdfSearchHighlight, PdfSearchResult } from './pdf-search-types'

interface PdfPageProps {
  pdfData: Uint8Array | null
  filePath: string
  currentPage: number
  numPages: number
  scale: number
  thumbnailsOpen: boolean
  searchQuery?: string
  activeSearchResultId?: string | null
  activeAnnotationId?: string | null
  onSearchResultsChange?: (results: PdfSearchResult[]) => void
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
  onPageSizeChange?: (size: { width: number; height: number }) => void
  className?: string
}

function copyPdfData(pdfData: Uint8Array): Uint8Array {
  const copy = new Uint8Array(pdfData.byteLength)
  copy.set(new Uint8Array(pdfData.buffer, pdfData.byteOffset, pdfData.byteLength))
  return copy
}

async function loadPdfDocument(pdfData: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc()

  return pdfjs.getDocument({ data: copyPdfData(pdfData) }).promise
}

function isRenderCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

function makeSearchPreview(text: string, start: number, length: number): string {
  const previewStart = Math.max(0, start - 24)
  const previewEnd = Math.min(text.length, start + length + 24)
  const prefix = previewStart > 0 ? '...' : ''
  const suffix = previewEnd < text.length ? '...' : ''
  return `${prefix}${text.slice(previewStart, previewEnd)}${suffix}`
}

function getTextItemRect(
  pdfjs: any,
  viewport: any,
  item: any,
  start: number,
  length: number,
): Pick<PdfSearchHighlight, 'left' | 'top' | 'width' | 'height'> | null {
  if (!item?.transform || !Array.isArray(item.transform) || !item.str) {
    return null
  }

  const transform = pdfjs.Util.transform(viewport.transform, item.transform)
  const textLength = Math.max(item.str.length, 1)
  const itemWidth = Math.max(Math.abs((item.width || 0) * viewport.scale), 1)
  const itemHeight = Math.max(Math.hypot(transform[2], transform[3]), Math.abs((item.height || 0) * viewport.scale), 8)
  const charWidth = itemWidth / textLength
  const left = transform[4] + charWidth * start
  const top = transform[5] - itemHeight
  const width = Math.max(charWidth * length, 4)
  const height = itemHeight + 2

  if (![left, top, width, height].every(Number.isFinite)) {
    return null
  }

  return {
    left,
    top: Math.max(0, top - 1),
    width,
    height,
  }
}

function getAnnotationColorClass(annotation: Annotation): string {
  const highlightColorMap: Record<Annotation['color'], string> = {
    yellow: 'bg-yellow-300/35 ring-yellow-500/45',
    green: 'bg-green-300/35 ring-green-500/45',
    blue: 'bg-blue-300/35 ring-blue-500/45',
    red: 'bg-red-300/35 ring-red-500/45',
  }
  const underlineColorMap: Record<Annotation['color'], string> = {
    yellow: 'border-b-2 border-yellow-500/80 ring-yellow-500/25',
    green: 'border-b-2 border-green-500/80 ring-green-500/25',
    blue: 'border-b-2 border-blue-500/80 ring-blue-500/25',
    red: 'border-b-2 border-red-500/80 ring-red-500/25',
  }

  if (annotation.type === 'underline') {
    return underlineColorMap[annotation.color]
  }

  return highlightColorMap[annotation.color]
}

function getAnnotationRectStyle(
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
) {
  return {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

async function collectSearchHighlights(
  pdf: PDFDocumentProxy,
  query: string,
  scale: number,
  numPages: number,
): Promise<PdfSearchHighlight[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  const pdfjs = await import('pdfjs-dist')
  const highlights: PdfSearchHighlight[] = []
  let matchIndex = 0

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const textContent = await page.getTextContent()

    for (const item of textContent.items) {
      if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) {
        continue
      }

      const text = item.str
      const normalizedText = text.toLocaleLowerCase()
      let start = normalizedText.indexOf(normalizedQuery)

      while (start >= 0) {
        const rect = getTextItemRect(pdfjs, viewport, item, start, normalizedQuery.length)

        if (rect) {
          highlights.push({
            id: `${pageNumber}-${matchIndex}`,
            pageNumber,
            matchIndex,
            text: makeSearchPreview(text, start, normalizedQuery.length),
            ...rect,
          })
          matchIndex += 1
        }

        start = normalizedText.indexOf(normalizedQuery, start + normalizedQuery.length)
      }
    }
  }

  return highlights
}

async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<RenderTask> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const outputScale = window.devicePixelRatio || 1
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas context is unavailable')
  }

  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
  context.clearRect(0, 0, viewport.width, viewport.height)

  return page.render({ canvasContext: context, viewport })
}

async function renderPdfTextLayer(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLDivElement,
  scale: number,
) {
  const pdfjs = await import('pdfjs-dist')
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const textContent = await page.getTextContent()

  container.replaceChildren()
  container.style.width = `${viewport.width}px`
  container.style.height = `${viewport.height}px`

  const textLayer = new pdfjs.TextLayer({
    textContentSource: textContent,
    container,
    viewport,
  })

  await textLayer.render()
}

export function PdfCanvas({
  pdfData,
  filePath,
  currentPage,
  numPages,
  scale,
  thumbnailsOpen,
  searchQuery = '',
  activeSearchResultId = null,
  activeAnnotationId = null,
  onSearchResultsChange,
  onPageChange,
  onScaleChange,
  onPageSizeChange,
  className,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const pageCanvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const pageTextLayerRefs = useRef(new Map<number, HTMLDivElement>())
  const thumbnailCanvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const searchHighlightRefs = useRef(new Map<string, HTMLDivElement>())
  const annotationHighlightRefs = useRef(new Map<string, HTMLDivElement>())
  const renderTasksRef = useRef<RenderTask[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const observedPageRef = useRef(1)
  const scaleRef = useRef(scale)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchHighlights, setSearchHighlights] = useState<PdfSearchHighlight[]>([])
  const annotations = usePDFAnnotationStore(s => s.getAnnotations(filePath))

  const setPageRef = useCallback((pageNumber: number, node: HTMLElement | null) => {
    if (node) {
      pageRefs.current.set(pageNumber, node)
    } else {
      pageRefs.current.delete(pageNumber)
    }
  }, [])

  const setPageCanvasRef = useCallback((pageNumber: number, node: HTMLCanvasElement | null) => {
    if (node) {
      pageCanvasRefs.current.set(pageNumber, node)
    } else {
      pageCanvasRefs.current.delete(pageNumber)
    }
  }, [])

  const setPageTextLayerRef = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) {
      pageTextLayerRefs.current.set(pageNumber, node)
    } else {
      pageTextLayerRefs.current.delete(pageNumber)
    }
  }, [])

  const setThumbnailCanvasRef = useCallback((pageNumber: number, node: HTMLCanvasElement | null) => {
    if (node) {
      thumbnailCanvasRefs.current.set(pageNumber, node)
    } else {
      thumbnailCanvasRefs.current.delete(pageNumber)
    }
  }, [])

  const setSearchHighlightRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      searchHighlightRefs.current.set(id, node)
    } else {
      searchHighlightRefs.current.delete(id)
    }
  }, [])

  const setAnnotationHighlightRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      annotationHighlightRefs.current.set(id, node)
    } else {
      annotationHighlightRefs.current.delete(id)
    }
  }, [])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    let cancelled = false

    async function openPdf() {
      if (!pdfData) {
        setPdf(null)
        return
      }

      setError(null)
      try {
        const document = await loadPdfDocument(pdfData)
        if (cancelled) {
          await document.destroy()
          return
        }
        setPdf(document)
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to open PDF document:', err)
          setPdf(null)
          setError('PDF 加载失败')
        }
      }
    }

    void openPdf()

    return () => {
      cancelled = true
      renderTasksRef.current.forEach((task) => task.cancel())
      renderTasksRef.current = []
      setPdf((currentPdf) => {
        void currentPdf?.destroy()
        return null
      })
    }
  }, [pdfData])

  useEffect(() => {
    let cancelled = false

    async function renderPages() {
      if (!pdf) return

      setRendering(true)
      setError(null)
      renderTasksRef.current.forEach((task) => task.cancel())
      renderTasksRef.current = []

      try {
        const firstPage = await pdf.getPage(1)
        const baseViewport = firstPage.getViewport({ scale: 1 })
        onPageSizeChange?.({ width: baseViewport.width, height: baseViewport.height })

        for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
          if (cancelled) return

          const canvas = pageCanvasRefs.current.get(pageNumber)
          if (!canvas) continue

          const renderTask = await renderPdfPage(pdf, pageNumber, canvas, scale)
          renderTasksRef.current.push(renderTask)
          await renderTask.promise

          const textLayer = pageTextLayerRefs.current.get(pageNumber)
          if (textLayer) {
            await renderPdfTextLayer(pdf, pageNumber, textLayer, scale)
          }
        }
      } catch (err) {
        if (!cancelled && !isRenderCancel(err)) {
          console.error('Failed to render PDF pages:', err)
          setError('PDF 页面渲染失败')
        }
      } finally {
        if (!cancelled) {
          renderTasksRef.current = []
          setRendering(false)
        }
      }
    }

    void renderPages()

    return () => {
      cancelled = true
      renderTasksRef.current.forEach((task) => task.cancel())
      renderTasksRef.current = []
    }
  }, [numPages, onPageSizeChange, pdf, scale])

  useEffect(() => {
    let cancelled = false

    async function updateSearchHighlights() {
      const query = searchQuery.trim()
      if (!pdf || !query) {
        setSearchHighlights([])
        onSearchResultsChange?.([])
        return
      }

      try {
        const highlights = await collectSearchHighlights(pdf, query, scale, numPages)
        if (cancelled) return

        setSearchHighlights(highlights)
        onSearchResultsChange?.(highlights.map(({ left: _left, top: _top, width: _width, height: _height, ...result }) => result))
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to search PDF text:', err)
          setSearchHighlights([])
          onSearchResultsChange?.([])
        }
      }
    }

    void updateSearchHighlights()

    return () => {
      cancelled = true
    }
  }, [numPages, onSearchResultsChange, pdf, scale, searchQuery])

  useEffect(() => {
    if (!activeSearchResultId) return

    const target = searchHighlightRefs.current.get(activeSearchResultId)
    const highlight = searchHighlights.find(item => item.id === activeSearchResultId)
    if (!target || !highlight) return

    observedPageRef.current = highlight.pageNumber
    target.scrollIntoView({ block: 'center', inline: 'center' })
  }, [activeSearchResultId, searchHighlights])

  useEffect(() => {
    if (!activeAnnotationId) return

    const target = annotationHighlightRefs.current.get(activeAnnotationId)
    const annotation = annotations.find(item => item.id === activeAnnotationId)

    if (annotation) {
      observedPageRef.current = annotation.pageIndex + 1
    }

    if (target) {
      target.scrollIntoView({ block: 'center', inline: 'center' })
      return
    }

    if (annotation) {
      pageRefs.current.get(annotation.pageIndex + 1)?.scrollIntoView({ block: 'start' })
    }
  }, [activeAnnotationId, annotations])

  useEffect(() => {
    let cancelled = false

    async function renderThumbnails() {
      if (!pdf || !thumbnailsOpen) return

      try {
        for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
          if (cancelled) return

          const canvas = thumbnailCanvasRefs.current.get(pageNumber)
          if (!canvas) continue

          const page = await pdf.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })
          const thumbnailScale = Math.min(128 / viewport.width, 176 / viewport.height)
          const renderTask = await renderPdfPage(pdf, pageNumber, canvas, thumbnailScale)
          await renderTask.promise
        }
      } catch (err) {
        if (!cancelled && !isRenderCancel(err)) {
          console.error('Failed to render PDF thumbnails:', err)
        }
      }
    }

    void renderThumbnails()

    return () => {
      cancelled = true
    }
  }, [numPages, pdf, thumbnailsOpen])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !onScaleChange) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY > 0 ? -0.1 : 0.1
      const currentScale = scaleRef.current
      onScaleChange(Math.max(0.35, Math.min(3, Math.round((currentScale + delta) * 100) / 100)))
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [onScaleChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !onPageChange) return

    const handleScroll = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect()
        let nearestPage = observedPageRef.current
        let nearestDistance = Number.POSITIVE_INFINITY

        for (const [pageNumber, pageNode] of pageRefs.current.entries()) {
          const rect = pageNode.getBoundingClientRect()
          const distance = Math.abs(rect.top - containerRect.top - 24)

          if (distance < nearestDistance) {
            nearestDistance = distance
            nearestPage = pageNumber
          }
        }

        if (nearestPage !== observedPageRef.current) {
          observedPageRef.current = nearestPage
          onPageChange(nearestPage)
        }
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [onPageChange])

  useEffect(() => {
    if (currentPage === observedPageRef.current) return

    const target = pageRefs.current.get(currentPage)
    if (!target) return

    observedPageRef.current = currentPage
    target.scrollIntoView({ block: 'start' })
  }, [currentPage])

  if (!pdfData || !pdf) {
    return (
      <div className={`flex flex-1 items-center justify-center ${className || ''}`}>
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载 PDF...
      </div>
    )
  }

  const pageNumbers = Array.from({ length: numPages }, (_, index) => index + 1)
  const highlightsByPage = new Map<number, PdfSearchHighlight[]>()
  searchHighlights.forEach((highlight) => {
    const pageHighlights = highlightsByPage.get(highlight.pageNumber) || []
    pageHighlights.push(highlight)
    highlightsByPage.set(highlight.pageNumber, pageHighlights)
  })
  const annotationsByPage = new Map<number, Annotation[]>()
  annotations.forEach((annotation) => {
    const pageNumber = annotation.pageIndex + 1
    const pageAnnotations = annotationsByPage.get(pageNumber) || []
    pageAnnotations.push(annotation)
    annotationsByPage.set(pageNumber, pageAnnotations)
  })

  return (
    <div className={`flex h-full min-h-0 bg-[#f1f1f1] ${className || ''}`} aria-label={filePath}>
      {thumbnailsOpen ? (
        <aside className="w-40 shrink-0 overflow-auto border-r bg-background/95 px-3 py-3">
          <div className="space-y-3">
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={`group flex w-full flex-col items-center gap-1 rounded-md border p-1.5 transition-colors ${
                  pageNumber === currentPage
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent hover:border-border hover:bg-muted/70'
                }`}
                onClick={() => {
                  observedPageRef.current = 0
                  onPageChange?.(pageNumber)
                }}
              >
                <canvas
                  ref={(node) => setThumbnailCanvasRef(pageNumber, node)}
                  className="max-h-44 max-w-full bg-white shadow-sm"
                />
                <span className="text-[11px] text-muted-foreground">{pageNumber}</span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <div ref={containerRef} className="min-w-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col items-center gap-5 px-6 py-5">
          {pageNumbers.map((pageNumber) => (
            <section
              key={pageNumber}
              ref={(node) => setPageRef(pageNumber, node)}
              className="relative h-fit w-fit shadow-sm"
              aria-label={`PDF page ${pageNumber}`}
            >
              {pageNumber === currentPage && rendering ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在渲染...
                </div>
              ) : null}
              <canvas ref={(node) => setPageCanvasRef(pageNumber, node)} className="block bg-white" />
              <div ref={(node) => setPageTextLayerRef(pageNumber, node)} className="pdf-text-layer" />
              {annotationsByPage.has(pageNumber) ? (
                <div className="pointer-events-none absolute inset-0">
                  {annotationsByPage.get(pageNumber)?.flatMap((annotation) =>
                    annotation.position.rects.map((rect, rectIndex) => {
                      const active = annotation.id === activeAnnotationId

                      return (
                        <div
                          key={`${annotation.id}-${rectIndex}`}
                          ref={rectIndex === 0 ? (node) => setAnnotationHighlightRef(annotation.id, node) : undefined}
                          className={`absolute rounded-[2px] ring-1 ${
                            active
                              ? 'bg-sky-300/45 ring-2 ring-sky-500/80'
                              : getAnnotationColorClass(annotation)
                          }`}
                          style={getAnnotationRectStyle(rect, scale)}
                        />
                      )
                    }),
                  )}
                </div>
              ) : null}
              {highlightsByPage.has(pageNumber) ? (
                <div className="pointer-events-none absolute inset-0">
                  {highlightsByPage.get(pageNumber)?.map((highlight) => {
                    const active = highlight.id === activeSearchResultId

                    return (
                      <div
                        key={highlight.id}
                        ref={(node) => setSearchHighlightRef(highlight.id, node)}
                        className={`absolute rounded-[2px] ${
                          active
                            ? 'bg-amber-300/60 ring-2 ring-amber-500/80'
                            : 'bg-yellow-200/45 ring-1 ring-yellow-400/40'
                        }`}
                        style={{
                          left: highlight.left,
                          top: highlight.top,
                          width: highlight.width,
                          height: highlight.height,
                        }}
                      />
                    )
                  })}
                </div>
              ) : null}
            </section>
          ))}
          {error ? (
            <div className="rounded-md border bg-background px-4 py-3 text-sm text-destructive">{error}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
