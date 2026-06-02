'use client'

import { useState, useEffect, useCallback, RefObject } from 'react'
import useArticleStore from '@/stores/article'
import { HtmlCodeEditor } from './html-code-editor'
import { HtmlPreview } from './html-preview'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { EditorView } from 'codemirror'
import {
  ArrowDownCircle,
  FileCode,
  Eye,
  Code,
  Copy,
  Download,
  RefreshCw,
  Sparkles,
  AlignLeft,
  Box,
  ImageIcon,
  LayoutTemplate,
  Link2,
  Loader2,
  Network,
  Type,
} from 'lucide-react'
import { FileCreatedAt } from '../markdown/footer-bar/file-created-at'
import { HistorySheet } from '../markdown/sync/history-sheet'
import { SyncButton } from '../markdown/sync/sync-button'
import { getRemoteFileInfo, pullRemoteFile, saveLocalFile, setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import { recordFileActivity } from '@/lib/file-activity'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { KNOWLEDGE_GRAPH_TAB_PATH } from '@/app/core/main/knowledge/knowledge-graph-constants'
import './html-editor.css'

interface HtmlEditorProps {
  filePath: string
  tabContentsRef: RefObject<Record<string, string>>
}

// 缓存持久化状态，记录用户在各个文件中的偏好模式（默认为 preview）
type EditorMode = 'preview' | 'code'
const modeMapRef: Record<string, EditorMode | 'split'> = {}

const editorModeOptions = [
  { value: 'preview' as const, label: '预览', icon: Eye },
  { value: 'code' as const, label: '代码', icon: Code },
]

function normalizeMode(mode: EditorMode | 'split' | undefined): EditorMode {
  return mode === 'code' ? 'code' : 'preview'
}

// 简易高效的 HTML 5 规范化格式化排版函数
function formatHtml(html: string): string {
  let formatted = ''
  let indent = ''
  const tab = '  ' // 两个空格缩进

  const cleanHtml = html
    .replace(/>\s*</g, '><')
    .replace(/(<(?!\/)\w[^>]*>)/g, '$1\r\n')
    .replace(/(<\/[^>]+>)/g, '\r\n$1\r\n')
    .replace(/\r\n\r\n/g, '\r\n')

  let indentLevel = 0
  const lines = cleanHtml.split('\r\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    if (line.startsWith('</')) {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    indent = tab.repeat(indentLevel)
    formatted += indent + line + '\n'

    if (
      line.startsWith('<') &&
      !line.startsWith('</') &&
      !line.endsWith('/>') &&
      !line.match(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(?:\s|>)/i)
    ) {
      const hasCloseTag = line.includes('</') || (line.match(/<\/[a-zA-Z0-9]+>/g) !== null)
      if (!hasCloseTag) {
        indentLevel++
      }
    }
  }
  return formatted.trim()
}

function HtmlPullButton({
  filePath,
  onPulledContent,
}: {
  filePath: string
  onPulledContent: (content: string) => void
}) {
  const [isConfigured, setIsConfigured] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    isSyncConfigured().then((configured) => {
      if (!cancelled) setIsConfigured(configured)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handlePull = useCallback(async () => {
    if (!filePath || isLoading) return

    setIsLoading(true)
    try {
      const remoteContent = await pullRemoteFile(filePath)
      await saveLocalFile(filePath, remoteContent)
      onPulledContent(remoteContent)
      await updateFileSyncTime(filePath)
      const remoteInfo = await getRemoteFileInfo(filePath)
      if (remoteInfo.sha) {
        await setLocalRecordedSha(filePath, remoteInfo.sha)
      }
      toast({
        title: '拉取成功',
        description: '远程 HTML 内容已同步到本地',
      })
    } catch (error) {
      console.error('HTML pull failed:', error)
      toast({
        title: '拉取失败',
        description: error instanceof Error ? error.message : '请检查同步配置或网络连接',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [filePath, isLoading, onPulledContent])

  if (!isConfigured || !filePath) return null

  return (
    <button
      type="button"
      onClick={handlePull}
      disabled={isLoading}
      className="html-editor-footer-icon-button"
      title={isLoading ? '拉取中...' : '手动拉取远程文件'}
    >
      {isLoading ? <Loader2 className="size-3 animate-spin" /> : <ArrowDownCircle className="size-3.5" />}
    </button>
  )
}

export function HtmlEditor({ filePath, tabContentsRef }: HtmlEditorProps) {
  const {
    currentArticle,
    saveCurrentArticle,
    isPulling,
  } = useArticleStore()

  // 1. 各项交互状态管理
  const [mode, setMode] = useState<EditorMode>(() => normalizeMode(modeMapRef[filePath]))
  const [content, setContent] = useState<string>('')

  // 同步刷新管理
  const [autoSync, setAutoSync] = useState<boolean>(true)
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'pending'>('synced')

  // 编辑器句柄实例
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const handleEditorMount = useCallback((view: EditorView | null) => {
    setEditorView(view)
  }, [])

  // 文件名提取，供左侧栏展示
  const fileName = filePath.split('/').pop() || filePath
  const quickButtonClass = "html-editor-toolbar-button"
  const quickAccentButtonClass = "html-editor-toolbar-button html-editor-toolbar-button-accent"
  const characterCount = content.length

  // 选项卡切换时还原对应文件的模式配置（若未记录，则首开默认 preview）
  useEffect(() => {
    setMode(normalizeMode(modeMapRef[filePath]))
  }, [filePath])

  const handleModeChange = useCallback((newMode: EditorMode) => {
    setMode(newMode)
    modeMapRef[filePath] = newMode
  }, [filePath])

  // 内容数据源同步绑定
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

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    if (tabContentsRef.current) {
      tabContentsRef.current[filePath] = newContent
    }
    saveCurrentArticle(newContent)
  }, [filePath, tabContentsRef, saveCurrentArticle])

  const handleRestoreContent = useCallback((restoredContent: string) => {
    handleContentChange(restoredContent)
    setRefreshTrigger(t => t + 1)
  }, [handleContentChange])

  // 2. 实现代码块快捷插入操作
  const insertCode = useCallback((code: string) => {
    if (!editorView) return

    const state = editorView.state
    const range = state.selection.main

    editorView.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: code,
      },
      selection: { anchor: range.from + code.length },
      scrollIntoView: true,
    })

    editorView.focus()
  }, [editorView])

  // 注入 Tailwind Play CDN
  const handleInsertTailwind = useCallback(() => {
    insertCode('<script src="https://cdn.tailwindcss.com"></script>\n')
  }, [insertCode])

  // 插入常用结构化标签
  const handleInsertTag = useCallback((tagType: 'div' | 'a' | 'img') => {
    switch (tagType) {
      case 'div':
        insertCode('<div className="p-4 bg-slate-100 rounded-lg">\n  \n</div>')
        break
      case 'a':
        insertCode('<a href="https://example.com" className="text-indigo-600 hover:underline">链接文字</a>')
        break
      case 'img':
        insertCode('<img src="https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600" alt="示例图" className="w-full max-w-sm rounded-lg" />')
        break
    }
  }, [insertCode])

  // 插入完整 HTML 骨架模块
  const handleInsertSkeleton = useCallback(() => {
    const skeleton = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>演示原型页面</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body className="bg-slate-50 text-slate-800 p-8 flex items-center justify-center min-h-screen">
  <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 border border-slate-100">
    <h1 className="text-2xl font-bold mb-2 text-slate-900">欢迎使用灵墨 HTML 编辑器</h1>
    <p className="text-slate-600 mb-4 text-sm">这是一个高度可视化的交互运行原型，已集成 Tailwind 库，左侧编写，右侧实时反馈。</p>
    <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all shadow-md">立即操作</button>
  </div>
</body>
</html>`

    // 若文档为空，则覆盖全屏，否则在光标处插入
    if (editorView && editorView.state.doc.toString().trim() === '') {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: skeleton },
        selection: { anchor: skeleton.length }
      })
    } else {
      insertCode(skeleton)
    }
  }, [editorView, insertCode])

  // 代码智能一键格式化
  const handleFormat = useCallback(() => {
    if (!editorView) return
    const currentVal = editorView.state.doc.toString()
    const formatted = formatHtml(currentVal)

    editorView.dispatch({
      changes: {
        from: 0,
        to: currentVal.length,
        insert: formatted,
      },
    })
  }, [editorView])

  const syncLabel = {
    synced: '已同步',
    syncing: '同步中',
    pending: '待刷新',
  }[syncStatus]

  const syncTitle = {
    synced: '预览已与最新代码同步',
    syncing: '正在渲染更新中',
    pending: '手动模式，内容待刷新',
  }[syncStatus]

  const handleCopyHtml = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast({
        title: '复制成功',
        description: '已复制 HTML 内容',
      })
    } catch {
      toast({
        title: '复制失败',
        description: '无法复制到剪贴板',
        variant: 'destructive',
      })
    }
  }, [content])

  const handleExportHtml = useCallback(() => {
    const outputName = fileName.replace(/\.html?$/i, '') + '.html'
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = outputName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    void recordFileActivity({
      path: filePath,
      type: 'export',
      title: '导出 HTML',
      description: outputName,
    })
  }, [content, fileName, filePath])

  const handleLocateGraph = useCallback(() => {
    emitter.emit('graph-locate-node' as any, { path: filePath })
    useArticleStore.getState().setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
  }, [filePath])

  const renderCodeActions = () => (
    <div className="html-editor-footer-actions" aria-label="HTML 代码快捷操作">
      <div className="html-editor-footer-action-group">
        <button
          type="button"
          onClick={handleFormat}
          className={quickButtonClass}
          title="格式化 HTML"
        >
          <AlignLeft className="h-3.5 w-3.5" />
          <span>格式化</span>
        </button>

        <button
          type="button"
          onClick={handleInsertSkeleton}
          className={quickAccentButtonClass}
          title="插入完整 HTML 骨架"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          <span>骨架模板</span>
        </button>
      </div>

      <div className="html-editor-footer-action-group html-editor-footer-action-group-secondary">
        <button
          type="button"
          onClick={handleInsertTailwind}
          className={quickButtonClass}
          title="插入 Tailwind CDN"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Tailwind</span>
        </button>
        <button
          type="button"
          onClick={() => handleInsertTag('div')}
          className={quickButtonClass}
          title="插入容器"
        >
          <Box className="h-3.5 w-3.5" />
          <span>Container</span>
        </button>
        <button
          type="button"
          onClick={() => handleInsertTag('img')}
          className={quickButtonClass}
          title="插入图片"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span>Image</span>
        </button>
        <button
          type="button"
          onClick={() => handleInsertTag('a')}
          className={quickButtonClass}
          title="插入链接"
        >
          <Link2 className="h-3.5 w-3.5" />
          <span>Link</span>
        </button>
      </div>
    </div>
  )

  return (
    <div className="html-editor-shell">
      <div className="html-editor-main-toolbar">
        <div className="html-editor-file-block">
          <span className="html-editor-file-icon" aria-hidden="true">
            <FileCode className="h-4 w-4" />
          </span>
          <div className="html-editor-file-copy">
            <span className="html-editor-file-name" title={fileName}>{fileName}</span>
            <span className="html-editor-file-meta">HTML 文档</span>
          </div>
        </div>

        <div className="html-editor-mode-switch" role="tablist" aria-label="HTML 编辑器视图模式">
          {editorModeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => handleModeChange(value)}
              className={`html-editor-mode-button ${mode === value ? 'is-active' : ''}`}
              title={value === 'code' ? '从右侧打开代码面板' : '只显示预览'}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="html-editor-workspace">
        {mode === 'preview' && (
          <div className="html-editor-preview-frame">
            <HtmlPreview
              content={content}
              autoSync={autoSync}
              refreshTrigger={refreshTrigger}
              onSyncStatusChange={setSyncStatus}
            />
          </div>
        )}

        {mode === 'code' && (
          <PanelGroup direction="horizontal" className="html-editor-split-group html-editor-code-split">
            <Panel defaultSize={58} minSize={30} className="html-editor-preview-pane">
              <div className="html-editor-preview-frame html-editor-preview-frame-split">
                <HtmlPreview
                  content={content}
                  autoSync={autoSync}
                  refreshTrigger={refreshTrigger}
                  onSyncStatusChange={setSyncStatus}
                />
              </div>
            </Panel>

            <PanelResizeHandle className="html-editor-resize-handle">
              <span className="html-editor-resize-grip" />
            </PanelResizeHandle>

            <Panel defaultSize={42} minSize={28} className="html-editor-code-pane html-editor-code-pane-slide">
              <div className="html-editor-editor-body">
                <HtmlCodeEditor
                  content={content}
                  onChange={handleContentChange}
                  onEditorMount={handleEditorMount}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>

      <div className="html-editor-footer-toolbar">
        <div className="html-editor-footer-left">
          <span
            className="html-editor-footer-info"
            title={`字符数：${characterCount}`}
          >
            <Type className="size-3" />
            <span>{characterCount}</span>
          </span>

          <FileCreatedAt />

          <button
            type="button"
            onClick={handleCopyHtml}
            className="html-editor-footer-icon-button"
            title="复制 HTML"
          >
            <Copy className="size-3" />
          </button>

          <button
            type="button"
            onClick={handleExportHtml}
            className="html-editor-footer-icon-button"
            title="下载 HTML"
          >
            <Download className="size-3" />
          </button>

          <button
            type="button"
            onClick={handleLocateGraph}
            className="html-editor-footer-icon-button"
            title="在图谱中定位"
          >
            <Network className="size-3" />
          </button>

          {mode === 'code' ? renderCodeActions() : null}

          <div className={`html-editor-sync-state is-${syncStatus}`} title={syncTitle}>
            <span className="html-editor-sync-dot" />
            <span>{syncLabel}</span>
          </div>

          <label className="html-editor-auto-refresh">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="sr-only peer"
            />
            <span className="html-editor-switch peer-checked:after:translate-x-full peer-checked:bg-primary" aria-hidden="true" />
            <span>自动刷新</span>
          </label>

          <button
            type="button"
            onClick={() => setRefreshTrigger(t => t + 1)}
            className="html-editor-footer-icon-button"
            title="手动刷新预览"
          >
            <RefreshCw className="size-3" />
          </button>
        </div>

        <div className="html-editor-footer-right">
          <HistorySheet onRestoreContent={handleRestoreContent} restoreContentType="html" />
          <SyncButton />
          <HtmlPullButton filePath={filePath} onPulledContent={handleRestoreContent} />
        </div>
      </div>
    </div>
  )
}
