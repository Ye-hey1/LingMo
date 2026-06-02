'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from 'codemirror'
import { AlignLeft, Code, Columns, Eye, FileChartColumn, RefreshCw } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { HtmlCodeEditor } from '../html/html-code-editor'
import useArticleStore from '@/stores/article'
import { getMermaidRenderer } from '@/lib/mermaid'

type MermaidEditorMode = 'preview' | 'split' | 'code'
const modeMapRef: Record<string, MermaidEditorMode> = {}

interface MermaidEditorProps {
  filePath: string
  tabContentsRef: React.RefObject<Record<string, string>>
}

function formatMermaidCode(code: string) {
  return code
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MermaidPreview({
  code,
  refreshTrigger,
  onSyncStatusChange,
}: {
  code: string
  refreshTrigger: number
  onSyncStatusChange?: (status: 'synced' | 'syncing' | 'pending') => void
}) {
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const latestRenderRef = useRef(0)

  useEffect(() => {
    const renderId = latestRenderRef.current + 1
    latestRenderRef.current = renderId

    if (!code.trim()) {
      setSvg('')
      setError(null)
      onSyncStatusChange?.('synced')
      return
    }

    onSyncStatusChange?.('syncing')
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await getMermaidRenderer(resolvedTheme === 'dark' ? 'dark' : 'light')
          await mermaid.parse(code)
          const id = `mermaid-file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
          const result = await mermaid.render(id, code)
          if (latestRenderRef.current !== renderId) return
          setSvg(result.svg)
          setError(null)
          onSyncStatusChange?.('synced')
        } catch (renderError) {
          if (latestRenderRef.current !== renderId) return
          setSvg('')
          setError(renderError instanceof Error ? renderError.message : String(renderError))
          onSyncStatusChange?.('synced')
        }
      })()
    }, 250)

    return () => window.clearTimeout(timer)
  }, [code, onSyncStatusChange, refreshTrigger, resolvedTheme])

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      {error ? (
        <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-6 text-destructive">
          <div className="font-medium">Mermaid 渲染失败</div>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px]">{error}</pre>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
        {svg ? (
          <div
            className="mermaid-file-render max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="mt-10 text-sm text-muted-foreground">左侧输入 Mermaid 代码后将在这里预览</div>
        )}
      </div>
    </div>
  )
}

export function MermaidEditor({ filePath, tabContentsRef }: MermaidEditorProps) {
  const { currentArticle, saveCurrentArticle, isPulling } = useArticleStore()
  const [mode, setMode] = useState<MermaidEditorMode>(() => modeMapRef[filePath] || 'split')
  const [content, setContent] = useState('')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'pending'>('synced')
  const fileName = filePath.split('/').pop() || filePath

  useEffect(() => {
    setMode(modeMapRef[filePath] || 'split')
  }, [filePath])

  useEffect(() => {
    const cached = tabContentsRef.current?.[filePath]
    if (cached !== undefined) {
      setContent(cached)
    } else if (currentArticle !== undefined) {
      setContent(currentArticle)
    }
  }, [currentArticle, filePath, tabContentsRef])

  useEffect(() => {
    if (isPulling) return
    if (currentArticle !== undefined && currentArticle !== content) {
      setContent(currentArticle)
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentArticle, isPulling])

  const handleModeChange = useCallback((nextMode: MermaidEditorMode) => {
    setMode(nextMode)
    modeMapRef[filePath] = nextMode
  }, [filePath])

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    if (tabContentsRef.current) {
      tabContentsRef.current[filePath] = newContent
    }
    saveCurrentArticle(newContent)
  }, [filePath, saveCurrentArticle, tabContentsRef])

  const handleFormat = useCallback(() => {
    if (!editorView) return
    const current = editorView.state.doc.toString()
    const formatted = formatMermaidCode(current)
    editorView.dispatch({
      changes: { from: 0, to: current.length, insert: formatted },
    })
  }, [editorView])

  const editorPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/20 px-3 py-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-md px-2 text-[11px]"
          onClick={handleFormat}
        >
          <AlignLeft className="size-3" />
          格式化
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-md px-2 text-[11px]"
          onClick={() => setRefreshTrigger((current) => current + 1)}
        >
          <RefreshCw className="size-3" />
          刷新预览
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <HtmlCodeEditor
          content={content}
          onChange={handleContentChange}
          onEditorMount={setEditorView}
        />
      </div>
    </div>
  )

  const previewPanel = (
    <MermaidPreview
      code={content}
      refreshTrigger={refreshTrigger}
      onSyncStatusChange={setSyncStatus}
    />
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between border-b bg-background/95 px-4 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileChartColumn className="size-4 shrink-0 text-emerald-600" />
          <span className="truncate font-mono text-xs font-semibold text-foreground/80">{fileName}</span>
        </div>
        <Select value={mode} onValueChange={(value) => handleModeChange(value as MermaidEditorMode)}>
          <SelectTrigger className="h-8 w-[95px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="preview" className="text-xs">
              <div className="flex items-center gap-1.5">
                <Eye className="size-3.5" />
                <span>预览</span>
              </div>
            </SelectItem>
            <SelectItem value="split" className="text-xs">
              <div className="flex items-center gap-1.5">
                <Columns className="size-3.5" />
                <span>分屏</span>
              </div>
            </SelectItem>
            <SelectItem value="code" className="text-xs">
              <div className="flex items-center gap-1.5">
                <Code className="size-3.5" />
                <span>代码</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={`size-2 rounded-full ${syncStatus === 'syncing' ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
          <span>{syncStatus === 'syncing' ? '渲染中' : '已同步'}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'code' ? editorPanel : null}
        {mode === 'preview' ? previewPanel : null}
        {mode === 'split' ? (
          <PanelGroup direction="horizontal" className="h-full w-full">
            <Panel defaultSize={48} minSize={25}>
              {editorPanel}
            </Panel>
            <PanelResizeHandle className="flex w-1.5 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary/70">
              <div className="h-6 w-1 rounded-full bg-muted-foreground/30" />
            </PanelResizeHandle>
            <Panel defaultSize={52} minSize={25}>
              {previewPanel}
            </Panel>
          </PanelGroup>
        ) : null}
      </div>
    </div>
  )
}
