'use client'

import { Loader2, RefreshCw, Save, Send, Sparkles, CheckCircle2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { createEmptyDrawioContent } from '@/lib/diagram'
import { readDiagramFileContent, saveDiagramFileContent } from '@/lib/diagram-file-content'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'

interface DrawioCanvasProps {
  filePath: string
}

type DrawioStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'

interface DrawioMessage {
  event?: string
  action?: string
  xml?: string
  data?: string
  format?: string
  svg?: string
  error?: string
  modified?: boolean
  message?: {
    lingmoRequestId?: string
  }
}

const DRAWIO_SRC = '/drawio/index.html?embed=1&proto=json&spin=1&libraries=1&ui=min&lang=zh&configure=1&noExitBtn=1&noSaveBtn=1&saveAndExit=0'
const DRAWIO_DEFAULT_LIBRARIES = 'general;basic;arrows2;flowchart'
const SAVE_DEBOUNCE_MS = 500
const TOOLBAR_BTN = 'h-7 shrink-0 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

// 全局变量，记录应用生命周期内，Draw.io 是否已至少加载过一次
let globalHasInitialized = false

function parseDrawioMessage(data: unknown): DrawioMessage | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as DrawioMessage
    } catch {
      return null
    }
  }

  if (data && typeof data === 'object') {
    return data as DrawioMessage
  }

  return null
}

export function DrawioCanvas({ filePath }: DrawioCanvasProps) {
  const [status, setStatus] = useState<DrawioStatus>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const latestXmlRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)
  const hasInitializedRef = useRef(false)
  const exportRequestsRef = useRef(new Map<string, {
    resolve: (result: { success: boolean; filePath?: string; format?: string; data?: string; xml?: string; svg?: string; error?: string }) => void
    timer: number
  }>())

  const postToDrawio = useCallback((message: Record<string, unknown>) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '*'
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), origin)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadXml() {
      setStatus('loading')
      try {
        const content = await readDiagramFileContent(filePath)
        if (cancelled) return

        const xml = content.trim().startsWith('<mxfile') ? content : createEmptyDrawioContent()
        latestXmlRef.current = xml
        
        if (hasInitializedRef.current) {
          postToDrawio({
            action: 'load',
            xml: xml,
            autosave: 1,
            modified: false,
            noExitBtn: 1,
            noSaveBtn: 1,
            saveAndExit: 0,
            title: '',
            libs: DRAWIO_DEFAULT_LIBRARIES,
            exportProtocol: true,
          })
          setStatus('ready')
        }
      } catch {
        if (cancelled) return

        const xml = createEmptyDrawioContent()
        latestXmlRef.current = xml
        if (hasInitializedRef.current) {
          postToDrawio({
            action: 'load',
            xml: xml,
            autosave: 1,
            modified: false,
            noExitBtn: 1,
            noSaveBtn: 1,
            saveAndExit: 0,
            title: '',
            libs: DRAWIO_DEFAULT_LIBRARIES,
            exportProtocol: true,
          })
          setStatus('ready')
        }
      }
    }

    void loadXml()

    return () => {
      cancelled = true
    }
  }, [filePath, postToDrawio])



  const saveXml = useCallback(
    async (xml: string) => {
      latestXmlRef.current = xml
      setStatus('saving')

      try {
        await saveDiagramFileContent(filePath, xml)
        setStatus('saved')
        setTimeout(() => setStatus((prev) => prev === 'saved' ? 'ready' : prev), 1500)
      } catch (error) {
        setStatus('error')
        toast({
          title: 'draw.io 图表保存失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    },
    [filePath],
  )

  const scheduleSave = useCallback(
    (xml: string) => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = window.setTimeout(() => {
        void saveXml(xml)
      }, SAVE_DEBOUNCE_MS)
    },
    [saveXml],
  )

  const loadXmlIntoCanvas = useCallback(
    (xml: string, modified = false) => {
      latestXmlRef.current = xml
      postToDrawio({
        action: 'load',
        xml,
        autosave: 1,
        modified,
        noExitBtn: 1,
        noSaveBtn: 1,
        saveAndExit: 0,
        title: '',
        libs: DRAWIO_DEFAULT_LIBRARIES,
        exportProtocol: true,
      })
      setStatus('ready')
    },
    [postToDrawio],
  )

  useEffect(() => {
    const handleGetCurrentXml = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const request = payload as {
        filePath?: string
        resolve?: (data: { success: boolean; filePath?: string; xml?: string; status?: string; error?: string }) => void
      }

      if (request.filePath && request.filePath !== filePath) {
        return
      }

      request.resolve?.({
        success: true,
        filePath,
        xml: latestXmlRef.current || createEmptyDrawioContent(),
        status,
      })
    }

    const handleLoadXml = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const request = payload as {
        filePath?: string
        xml?: unknown
        modified?: boolean
        resolve?: (result: { success: boolean; error?: string }) => void
      }

      if (request.filePath && request.filePath !== filePath) {
        return
      }

      if (typeof request.xml !== 'string') {
        request.resolve?.({ success: false, error: 'Missing draw.io XML.' })
        return
      }

      if (hasInitializedRef.current) {
        loadXmlIntoCanvas(request.xml, request.modified !== false)
      } else {
        latestXmlRef.current = request.xml
      }
      request.resolve?.({ success: true })
    }

    const handleExternalContentUpdate = (content: unknown) => {
      if (typeof content !== 'string') return
      if (useArticleStore.getState().activeFilePath !== filePath) return
      if (!content.trim().startsWith('<mxfile')) return
      if (content === latestXmlRef.current) return

      if (hasInitializedRef.current) {
        loadXmlIntoCanvas(content, false)
      } else {
        latestXmlRef.current = content
      }
    }

    emitter.on('drawio-get-current-xml', handleGetCurrentXml)
    emitter.on('drawio-load-xml', handleLoadXml)
    emitter.on('external-content-update', handleExternalContentUpdate)
    return () => {
      emitter.off('drawio-get-current-xml', handleGetCurrentXml)
      emitter.off('drawio-load-xml', handleLoadXml)
      emitter.off('external-content-update', handleExternalContentUpdate)
    }
  }, [filePath, loadXmlIntoCanvas, status])

  useEffect(() => {
    const exportRequests = exportRequestsRef.current
    const handleExport = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const request = payload as {
        filePath?: string
        format?: 'png' | 'svg' | 'xmlpng' | 'xmlsvg'
        xml?: string
        scale?: number
        border?: number
        background?: string
        transparent?: boolean
        embedImages?: boolean
        shadow?: boolean
        currentPage?: boolean
        resolve?: (result: { success: boolean; filePath?: string; format?: string; data?: string; xml?: string; svg?: string; error?: string }) => void
      }

      if (request.filePath && request.filePath !== filePath) {
        return
      }

      if (!request.resolve) {
        return
      }

      if (!hasInitializedRef.current) {
        request.resolve({ success: false, filePath, error: 'Draw.io editor is not ready.' })
        return
      }

      const requestId = `lingmo-export-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timer = window.setTimeout(() => {
        const pending = exportRequestsRef.current.get(requestId)
        if (!pending) return

        exportRequestsRef.current.delete(requestId)
        pending.resolve({
          success: false,
          filePath,
          format: request.format || 'svg',
          error: 'Draw.io export timed out.',
        })
      }, 20000)

      exportRequests.set(requestId, {
        resolve: request.resolve,
        timer,
      })

      postToDrawio({
        action: 'export',
        format: request.format || 'svg',
        xml: request.xml || latestXmlRef.current || createEmptyDrawioContent(),
        scale: request.scale || 1,
        border: request.border ?? 8,
        background: request.background,
        transparent: request.transparent,
        embedImages: request.embedImages,
        shadow: request.shadow,
        currentPage: request.currentPage,
        spin: '正在导出图表...',
        lingmoRequestId: requestId,
      })
    }

    emitter.on('drawio-export', handleExport)
    return () => {
      emitter.off('drawio-export', handleExport)
      for (const pending of exportRequests.values()) {
        window.clearTimeout(pending.timer)
      }
      exportRequests.clear()
    }
  }, [filePath, postToDrawio])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      if (event.origin !== origin || event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const message = parseDrawioMessage(event.data)
      if (!message) {
        return
      }

      if (message.event === 'export') {
        const requestId = message.message?.lingmoRequestId
        const fallbackRequestId = requestId
          ? undefined
          : exportRequestsRef.current.size === 1
            ? Array.from(exportRequestsRef.current.keys())[0]
            : undefined
        const matchedRequestId = requestId || fallbackRequestId
        const pending = matchedRequestId ? exportRequestsRef.current.get(matchedRequestId) : undefined
        if (pending) {
          const exportData = message.data || message.svg
          window.clearTimeout(pending.timer)
          exportRequestsRef.current.delete(matchedRequestId as string)
          pending.resolve({
            success: Boolean(exportData),
            filePath,
            format: message.format,
            data: exportData,
            xml: message.xml,
            svg: message.svg,
            error: exportData ? undefined : 'Draw.io export returned no data.',
          })
        }
        return
      }

      if (message.event === 'configure') {
        postToDrawio({
          action: 'configure',
          config: {
            enableAi: false,
            defaultLibraries: DRAWIO_DEFAULT_LIBRARIES,
            expandLibraries: true,
            sidebarTitles: false,
            sidebarWidth: 220,
            zoomFactor: 1.15,
            zoomWheel: true,
          },
        })
        return
      }

      if (message.event === 'init') {
        hasInitializedRef.current = true
        globalHasInitialized = true
        if (latestXmlRef.current !== '') {
        postToDrawio({
          action: 'load',
          xml: latestXmlRef.current,
          autosave: 1,
          modified: false,
          noExitBtn: 1,
          noSaveBtn: 1,
          saveAndExit: 0,
          title: '',
          libs: DRAWIO_DEFAULT_LIBRARIES,
          exportProtocol: true,
        })
        setStatus('ready')
      }
        return
      }

      if ((message.event === 'save' || message.event === 'autosave') && message.xml) {
        scheduleSave(message.xml)
        return
      }

      if (message.event === 'template' && message.xml) {
        postToDrawio({
          action: 'load',
          xml: message.xml,
          autosave: 1,
          modified: true,
          exportProtocol: true,
        })
        void saveXml(message.xml)
        return
      }

      if (message.event === 'exit') {
        return
      }

      if (message.event === 'error') {
        setStatus('error')
        toast({
          title: 'draw.io 图表加载失败',
          description: message.error || '请检查网络连接后重试。',
          variant: 'destructive',
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [filePath, postToDrawio, saveXml, scheduleSave])

  const handleManualSave = useCallback(() => {
    postToDrawio({ action: 'save' })
  }, [postToDrawio])

  const handleTemplate = useCallback(() => {
    postToDrawio({ action: 'template', callback: true })
  }, [postToDrawio])

  const handleReload = useCallback(() => {
    setStatus('loading')
    setReloadKey((key) => key + 1)
  }, [])

  const handleSendToAI = useCallback(() => {
    const content = latestXmlRef.current || createEmptyDrawioContent()
    emitter.emit('insert-quote', {
      quote: [`文件：${filePath}`, `类型：draw.io 图表`, `内容长度：${content.length} 字符`].join('\n'),
      fullContent: content,
      fileName: filePath.split('/').pop() || filePath,
      startLine: 1,
      endLine: 1,
      from: 0,
      to: 0,
      articlePath: filePath,
    })
    emitter.emit('diagramSelected', {
      name: filePath.split('/').pop() || filePath,
      path: filePath,
      relativePath: filePath,
    })
  }, [filePath])

  const isLoading = status === 'loading'
  const isSaving = status === 'saving'
  const isSaved = status === 'saved'
  const isBusy = isLoading || isSaving
  const saveButtonLabel = isLoading ? '加载中' : isSaving ? '保存中' : isSaved ? '已保存' : '保存'
  const isFirstLoading = isLoading && !hasInitializedRef.current && !globalHasInitialized
  const isHotLoading = isLoading && !hasInitializedRef.current && globalHasInitialized
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute right-3 top-2 z-20">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border/50 bg-background/90 px-1 py-0.5">
            <Button
              aria-label="发送图表到 AI"
              title="发送图表到 AI"
              onClick={handleSendToAI}
              disabled={isLoading}
              variant="ghost"
              size="sm"
              className={`${TOOLBAR_BTN} gap-1 px-2 text-xs`}
            >
              <Send className="size-3.5" />
              <span>AI</span>
            </Button>
            <Button
              aria-label={saveButtonLabel}
              title={saveButtonLabel}
              onClick={handleManualSave}
              disabled={isLoading}
              variant="ghost"
              size="icon"
              className={`${TOOLBAR_BTN} w-7`}
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : isSaved ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Save className="size-3.5" />}
            </Button>
            <Button
              aria-label="打开模板"
              title="打开模板"
              onClick={handleTemplate}
              disabled={isBusy}
              variant="ghost"
              size="icon"
              className={`${TOOLBAR_BTN} w-7`}
            >
              <Sparkles className="size-3.5" />
            </Button>
            <Button
              aria-label="重新载入 draw.io"
              title="重新载入 draw.io"
              onClick={handleReload}
              disabled={isSaving}
              variant="ghost"
              size="icon"
              className={`${TOOLBAR_BTN} w-7`}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
        {isFirstLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/95 select-none">
            {/* 模拟 Draw.io 的网格与画布预览 */}
            <div 
              className="absolute inset-0 z-0 opacity-5 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, currentColor 1px, transparent 1px),
                  linear-gradient(to bottom, currentColor 1px, transparent 1px)
                `,
                backgroundSize: '24px 24px',
              }}
            />
            {/* 模拟顶部菜单占位 */}
            <div className="absolute top-0 left-0 right-0 h-10 border-b bg-muted/20 flex items-center px-4 gap-4 animate-pulse">
              <div className="h-4 w-12 bg-muted rounded-sm" />
              <div className="h-4 w-8 bg-muted rounded-sm" />
              <div className="h-4 w-8 bg-muted rounded-sm" />
              <div className="h-4 w-8 bg-muted rounded-sm" />
            </div>
            {/* 模拟左侧图库占位 */}
            <div className="absolute top-10 left-0 bottom-0 w-[220px] border-r bg-muted/10 p-4 flex flex-col gap-4 animate-pulse hidden md:flex">
              <div className="h-6 w-full bg-muted rounded-sm" />
              <div className="h-24 w-full bg-muted rounded-sm" />
              <div className="h-24 w-full bg-muted rounded-sm" />
            </div>
            
            {/* 中间核心加载指示器 */}
            <div className="relative z-10 flex flex-col items-center gap-3 px-6 py-4 rounded-lg border bg-card">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground/75">正在打开 Draw.io 编辑器...</span>
              <span className="text-[10px] text-muted-foreground/60">首次打开可能需要载入外部静态库，请稍候</span>
            </div>
          </div>
        ) : null}
        {isHotLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/40 select-none">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title="draw.io 图表编辑器"
          src={DRAWIO_SRC}
          className={`h-full w-full border-0 transition-opacity duration-300 ${
            isLoading && !hasInitializedRef.current ? 'opacity-0' : 'opacity-100'
          }`}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
