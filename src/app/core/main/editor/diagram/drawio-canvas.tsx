'use client'

import { Loader2, RefreshCw, Save, Send, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { createEmptyDrawioContent } from '@/lib/diagram'
import { readDiagramFileContent, saveDiagramFileContent } from '@/lib/diagram-file-content'
import emitter from '@/lib/emitter'

interface DrawioCanvasProps {
  filePath: string
}

type DrawioStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'

interface DrawioMessage {
  event?: string
  action?: string
  xml?: string
  error?: string
  modified?: boolean
}

const DRAWIO_ORIGIN = 'https://embed.diagrams.net'
const DRAWIO_SRC = `${DRAWIO_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&ui=min&lang=zh&configure=1&noExitBtn=1&noSaveBtn=1&saveAndExit=0`
const DRAWIO_DEFAULT_LIBRARIES = 'general;basic;arrows2;flowchart'
const SAVE_DEBOUNCE_MS = 500

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
  const [initialXml, setInitialXml] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const latestXmlRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadXml() {
      setStatus('loading')
      setInitialXml(null)
      try {
        const content = await readDiagramFileContent(filePath)
        if (cancelled) return

        const xml = content.trim().startsWith('<mxfile') ? content : createEmptyDrawioContent()
        latestXmlRef.current = xml
        setInitialXml(xml)
      } catch {
        if (cancelled) return

        const xml = createEmptyDrawioContent()
        latestXmlRef.current = xml
        setInitialXml(xml)
      }
    }

    void loadXml()

    return () => {
      cancelled = true
    }
  }, [filePath])

  useEffect(() => {
    if (initialXml !== null) {
      latestXmlRef.current = initialXml
    }
  }, [initialXml])

  const postToDrawio = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), DRAWIO_ORIGIN)
  }, [])

  const saveXml = useCallback(
    async (xml: string) => {
      latestXmlRef.current = xml
      setStatus('saving')

      try {
        await saveDiagramFileContent(filePath, xml)
        setStatus('saved')
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

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== DRAWIO_ORIGIN || event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const message = parseDrawioMessage(event.data)
      if (!message) {
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
        postToDrawio({
          action: 'load',
          xml: latestXmlRef.current || createEmptyDrawioContent(),
          autosave: 1,
          modified: false,
          noExitBtn: 1,
          noSaveBtn: 1,
          saveAndExit: 0,
          title: '',
          libs: DRAWIO_DEFAULT_LIBRARIES,
        })
        setStatus('ready')
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
    const content = latestXmlRef.current || initialXml || createEmptyDrawioContent()
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
  }, [filePath, initialXml])

  const isLoading = status === 'loading'
  const isSaving = status === 'saving'
  const isBusy = isLoading || isSaving
  const saveButtonLabel = isLoading ? '加载中' : isSaving ? '保存中' : '保存'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute right-3 top-2 z-20">
          <div className="pointer-events-auto flex h-8 items-center gap-1">
            <Button
              aria-label="发送图表到 AI"
              title="发送图表到 AI"
              onClick={handleSendToAI}
              disabled={isLoading}
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 rounded-sm bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground"
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
              className="h-7 w-7 shrink-0 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            </Button>
            <Button
              aria-label="打开模板"
              title="打开模板"
              onClick={handleTemplate}
              disabled={isBusy}
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground"
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
              className="h-7 w-7 shrink-0 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在打开 draw.io 编辑器...
          </div>
        ) : null}
        {initialXml !== null ? (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            title="draw.io 图表编辑器"
            src={DRAWIO_SRC}
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        ) : null}
      </div>
    </div>
  )
}
