'use client'

import { useState, useEffect, useCallback, RefObject } from 'react'
import useArticleStore from '@/stores/article'
import { HtmlCodeEditor } from './html-code-editor'
import { HtmlPreview } from './html-preview'

interface HtmlEditorProps {
  filePath: string
  tabContentsRef: RefObject<Record<string, string>>
}

type EditorMode = 'code' | 'preview'

// 模块级 ref 用于在 Tab 切换时持久化每个文件的编辑模式
const modeMapRef: Record<string, EditorMode> = {}

export function HtmlEditor({ filePath, tabContentsRef }: HtmlEditorProps) {
  const {
    currentArticle,
    saveCurrentArticle,
    isPulling,
  } = useArticleStore()

  const [mode, setMode] = useState<EditorMode>(() => modeMapRef[filePath] || 'code')
  const [content, setContent] = useState<string>('')

  // Restore mode from modeMapRef when filePath changes (tab switch)
  useEffect(() => {
    setMode(modeMapRef[filePath] || 'code')
  }, [filePath])

  // Persist mode to modeMapRef whenever it changes
  const handleModeChange = useCallback((newMode: EditorMode) => {
    setMode(newMode)
    modeMapRef[filePath] = newMode
  }, [filePath])

  // Initialize content from currentArticle or tabContentsRef cache
  useEffect(() => {
    // Prefer cached content from tabContentsRef for tab restore
    const cached = tabContentsRef.current?.[filePath]
    if (cached !== undefined) {
      setContent(cached)
    } else if (currentArticle !== undefined) {
      setContent(currentArticle)
    }
  }, [currentArticle, filePath, tabContentsRef])

  // Sync content when currentArticle changes externally (e.g., remote pull)
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

  // Handle content change from CodeMirror editor
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    // Update tab cache
    if (tabContentsRef.current) {
      tabContentsRef.current[filePath] = newContent
    }
    // Trigger debounced save
    saveCurrentArticle(newContent)
  }, [filePath, tabContentsRef, saveCurrentArticle])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Mode Toggle Toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <button
          type="button"
          onClick={() => handleModeChange('code')}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            mode === 'code'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          Code
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('preview')}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            mode === 'preview'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          Preview
        </button>
      </div>

      {/* Editor / Preview Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'code' ? (
          <HtmlCodeEditor content={content} onChange={handleContentChange} />
        ) : (
          <HtmlPreview content={content} />
        )}
      </div>
    </div>
  )
}
