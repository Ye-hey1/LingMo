'use client'

import useArticleStore, {
  clearCachedLargeMarkdownContent,
  getCachedLargeMarkdownContent,
} from '@/stores/article'
import { useEffect, useState, useCallback, useMemo, useRef, RefObject } from 'react'
import { TipTapEditor } from './tiptap-editor'
import { Outline } from './outline'
import { Loader2, Download, Menu } from 'lucide-react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import useSettingStore from '@/stores/setting'
import { isLargeMarkdownContentFast } from '@/lib/editor-document-profile'
import { EMPTY_PARAGRAPH_MARKDOWN } from './markdown-paragraph'

interface MdEditorProps {
  tabContentsRef: RefObject<Record<string, string>>
  filePath: string
}

export function MdEditor({ tabContentsRef, filePath }: MdEditorProps) {
  const saveCurrentArticle = useArticleStore((state) => state.saveCurrentArticle)
  const isPulling = useArticleStore((state) => state.isPulling)
  const setCurrentArticle = useArticleStore((state) => state.setCurrentArticle)
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const currentArticle = useArticleStore((state) => state.currentArticle)
  const justPulledFile = useArticleStore((state) => state.justPulledFile)

  const t = useTranslations('article.file.sync')
  const tEditor = useTranslations('editor')
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path - Bug fix: make this cleanup possible
  const loadedPathsRef = useRef<Set<string>>(new Set())
  // Bug fix: Track which file's content is currently in currentArticle
  const currentArticlePathRef = useRef<string | null>(null)
  // Bug fix: Track if editor content has been initialized to prevent saving empty content
  const contentInitializedRef = useRef(false)
  // Bug fix: Use ref to track loading state since state might be stale in callbacks
  const isLoadingRef = useRef(true)
  // Bug fix: Track expected content to detect if editor is behind
  const expectedContentRef = useRef<string | null>(null)
  // Outline panel state
  const [outlineHoverOpen, setOutlineHoverOpen] = useState(false)
  const {
    enableOutline: outlineOpen,
    setEnableOutline: setOutlineOpen,
    outlinePosition,
  } = useSettingStore()
  // State for editor instance (to trigger re-render when ready)
  const [editorInstance, setEditorInstance] = useState<any>(null)
  const editorInstanceRef = useRef<any>(null)
  // Track if editor has called onEditorReady (meaning it's fully initialized)
  const [editorReady, setEditorReady] = useState(false)
  // AI streaming state
  const [aiStreaming, setAiStreaming] = useState(false)
  const terminateRef = useRef<(() => void) | undefined>()
  const outlineHoverCloseTimerRef = useRef<number | null>(null)

  // Bug fix: Listen for file close events to clean up loaded state
  useEffect(() => {
    const handleFileClose = (event: { path: string }) => {
      if (event.path === filePath) {
        loadedPathsRef.current.delete(filePath)
        clearCachedLargeMarkdownContent(filePath)
      }
    }
    emitter.on('editor-file-close', handleFileClose as any)
    return () => {
      emitter.off('editor-file-close', handleFileClose as any)
      // Also clean up on component unmount
      loadedPathsRef.current.delete(filePath)
    }
  }, [filePath])

  // Bug fix: Listen for article opened events to track which file currentArticle belongs to
  useEffect(() => {
    const handleArticleOpened = (event: { path: string; content: string }) => {
      if (event.path === filePath) {
        currentArticlePathRef.current = filePath
      } else {
        // Bug fix: If a different file was opened, clear the reference
        currentArticlePathRef.current = null
      }
    }
    emitter.on('article-opened', handleArticleOpened as any)
    return () => {
      emitter.off('article-opened', handleArticleOpened as any)
    }
  }, [filePath])

  useEffect(() => {
    const handleSyncContentUpdated = (event: { path: string; content: string }) => {
      if (!event || event.path !== filePath) {
        return
      }

      expectedContentRef.current = event.content
      setInitialContent(event.content)
      setCurrentArticle(event.content)
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = event.content
      }
      setIsLoading(false)
      isLoadingRef.current = false
      contentInitializedRef.current = true
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated as any)
    return () => {
      emitter.off('sync-content-updated', handleSyncContentUpdated as any)
    }
  }, [filePath, tabContentsRef, setCurrentArticle])

  // Listen for AI streaming state
  useEffect(() => {
    const handleAiStreaming = (event: { isStreaming: boolean; targetFilePath?: string; terminate?: () => void }) => {
      // Check if this event is for the current file
      if (event.targetFilePath && event.targetFilePath !== filePath) {
        // Event is for a different file, ignore
        return
      }
      setAiStreaming(event.isStreaming)
      if (event.terminate) {
        terminateRef.current = event.terminate
      }
    }
    emitter.on('editor-ai-streaming', handleAiStreaming as any)
    return () => {
      emitter.off('editor-ai-streaming', handleAiStreaming as any)
    }
  }, [filePath])

  // Check store for AI generating state on mount and when filePath changes
  useEffect(() => {
    // Check if this file is currently being generated by AI
    const { aiGeneratingFilePath, aiTerminateFn } = useArticleStore.getState()
    if (aiGeneratingFilePath === filePath) {
      setAiStreaming(true)
      if (aiTerminateFn) {
        terminateRef.current = aiTerminateFn
      }
    }
  }, [filePath])

  useEffect(() => {
    return () => {
      if (outlineHoverCloseTimerRef.current) {
        window.clearTimeout(outlineHoverCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setInitialContent(null)
    setIsLoading(true)
    isLoadingRef.current = true
    currentArticlePathRef.current = null
    contentInitializedRef.current = false
    expectedContentRef.current = null
  }, [filePath])

  const openHoverOutline = useCallback(() => {
    if (outlineHoverCloseTimerRef.current) {
      window.clearTimeout(outlineHoverCloseTimerRef.current)
      outlineHoverCloseTimerRef.current = null
    }
    setOutlineHoverOpen(true)
  }, [])

  const closeHoverOutline = useCallback(() => {
    if (outlineHoverCloseTimerRef.current) {
      window.clearTimeout(outlineHoverCloseTimerRef.current)
    }
    outlineHoverCloseTimerRef.current = window.setTimeout(() => {
      setOutlineHoverOpen(false)
      outlineHoverCloseTimerRef.current = null
    }, 120)
  }, [])

  // Load content from cache or disk - only on first mount per file
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return

    const loadContent = async () => {
      if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
        setInitialContent(tabContentsRef.current[filePath])
        setIsLoading(false)
        isLoadingRef.current = false
        contentInitializedRef.current = true
        return
      }

      const cachedLargeContent = getCachedLargeMarkdownContent(filePath)
      if (cachedLargeContent !== null) {
        setInitialContent(cachedLargeContent)
        if (tabContentsRef.current) {
          tabContentsRef.current[filePath] = cachedLargeContent
        }
        setIsLoading(false)
        isLoadingRef.current = false
        contentInitializedRef.current = true
        return
      }

      if (currentArticle && currentArticle.length > 0) {
        const { activeFilePath: storeActivePath } = useArticleStore.getState()
        if (storeActivePath === filePath) {
          setInitialContent(currentArticle)
          setIsLoading(false)
          isLoadingRef.current = false
          contentInitializedRef.current = true
          return
        }
      }

      setIsLoading(true)
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')

        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(filePath)

        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

        setInitialContent(content)
        if (tabContentsRef.current) {
          tabContentsRef.current[filePath] = content
        }
        setIsLoading(false)
        isLoadingRef.current = false
        contentInitializedRef.current = true
      } catch {
        setInitialContent('')
        setIsLoading(false)
        isLoadingRef.current = false
      }
    }

    loadContent()
    loadedPathsRef.current.add(filePath)
  }, [filePath, tabContentsRef, currentArticle])

  // Subscribe to currentArticle changes (for remote file pull results)
  // Bug fix: Only update if currentArticle belongs to this file
  useEffect(() => {
    // Bug fix: Only process if currentArticle belongs to this file
    // Also check against store's activeFilePath as fallback
    const { activeFilePath: storeActivePath } = useArticleStore.getState()
    const isThisFile = currentArticlePathRef.current === filePath || storeActivePath === filePath

    if (currentArticle && currentArticle.length > 0 && currentArticle !== initialContent && isThisFile) {
      // Bug fix: Set expected content BEFORE updating initialContent
      // This ensures handleContentChange knows what to expect
      expectedContentRef.current = currentArticle
      setInitialContent(currentArticle)
      // Update cache
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
      // Bug fix: Don't set isLoadingRef.current = false here!
      // The editor needs to initialize first, and handleContentChange will
      // only save if content matches expectedContentRef
      // We'll set isLoading(false) but isLoadingRef remains true until editor confirms
      setIsLoading(false)
      // Mark as initialized so that subsequent saves are allowed
      contentInitializedRef.current = true

      // Fix cursor jump: Only trigger remote content update if this is a remote pull
      // This prevents unnecessary setContent during local saves
      if (justPulledFile) {
        emitter.emit('editor-content-from-remote', { content: currentArticle })
      }
    } else if (currentArticle === '' && isThisFile && initialContent === '') {
      // Genuinely empty file - hide loading and mark as initialized
      // Bug fix: Set expected content for empty file
      expectedContentRef.current = ''
      setIsLoading(false)
      isLoadingRef.current = false
      // Mark as initialized for empty files so user can start typing
      contentInitializedRef.current = true
    }
  }, [currentArticle, filePath, tabContentsRef, initialContent, justPulledFile])

  // Handle content changes - only save if this is the active file
  const handleContentChange = useCallback((content: string) => {
    // Bug fix: Don't save if content is empty
    if (content.length === 0 && !contentInitializedRef.current) {
      return
    }
    const previousContent = filePath && tabContentsRef.current
      ? tabContentsRef.current[filePath]
      : initialContent
    const previousContentIsSubstantial =
      typeof previousContent === 'string' &&
      previousContent.trim().length > EMPTY_PARAGRAPH_MARKDOWN.length &&
      previousContent.trim() !== EMPTY_PARAGRAPH_MARKDOWN
    const isPlaceholderOnlyContent = content.trim() === EMPTY_PARAGRAPH_MARKDOWN
    const editorHasFocus = Boolean(editorInstanceRef.current?.view?.hasFocus?.())
    if (isPlaceholderOnlyContent && previousContentIsSubstantial && !editorHasFocus) {
      return
    }
    // Bug fix: If expected content is set and incoming content doesn't match, skip save
    // This prevents saving stale content during editor initialization race
    // But clear expectedContentRef so subsequent edits can be saved
    if (expectedContentRef.current !== null && content !== expectedContentRef.current) {
      expectedContentRef.current = null
    }
    // Bug fix: Skip if content matches what we just loaded (first onUpdate after init)
    // The editor's onUpdate fires after setContent, so we skip that initial call
    if (expectedContentRef.current !== null && content === expectedContentRef.current) {
      // Clear expectedContentRef after first matching update
      expectedContentRef.current = null
      return
    }
    // Mark as initialized when we receive valid content
    if (!contentInitializedRef.current) {
      contentInitializedRef.current = true
    }
    // Update cache
    if (filePath && tabContentsRef.current) {
      tabContentsRef.current[filePath] = content
    }

    // Save to disk - only if this is the active file
    if (filePath && filePath === activeFilePath) {
      saveCurrentArticle(content)
    } else if (!filePath && !isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      createUntitledFile(content)
      isCreatingFileRef.current = false
    }
  }, [saveCurrentArticle, filePath, tabContentsRef, activeFilePath])

  // Handle quote to chat - get selected text and emit event
  const handleQuoteToChat = useCallback(() => {
    // Get the selected text from the active editor
    emitter.emit('get-quote-from-editor')
  }, [])

  // Handle editor ready - store editor instance
  const handleEditorReady = useCallback((editor: any) => {
    editorInstanceRef.current = editor
    setEditorInstance(editor)
    setEditorReady(true)
  }, [])

  // Reset editor instance and ready state when file changes
  useEffect(() => {
    editorInstanceRef.current = null
    setEditorInstance(null)
    setEditorReady(false)
  }, [filePath])

  // Auto-create untitled.md file
  async function createUntitledFile(content: string) {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let path = fileName

      while (true) {
        const pathOptions = await getFilePathOptions(fileName)
        let fileExists = false
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        if (!fileExists) break
        fileName = `untitled-${counter}.md`
        path = fileName
        counter++
      }

      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      setCurrentArticle(content)
      useArticleStore.getState().setActiveFilePath(path)
      useArticleStore.getState().loadFileTree()
    } catch {
      // Keep editing in memory if the untitled file cannot be created.
    }
  }

  const cachedContent = filePath && tabContentsRef.current?.[filePath] !== undefined
    ? tabContentsRef.current[filePath]
    : null
  const hasEditorContent = cachedContent !== null || initialContent !== null
  const editorContent = cachedContent ?? initialContent ?? ''
  const performanceMode = useMemo(
    () => isLargeMarkdownContentFast(editorContent),
    [editorContent],
  )
  const loadingOverlayClass = 'absolute inset-0 z-50 flex min-h-full items-center justify-center bg-background'

  // Loading state - wait for content to be loaded
  // 如果正在从远程拉取，优先显示拉取遮罩
  if (isPulling) {
    return (
      <div className="relative h-full min-h-0 w-full flex-1">
        <div className={loadingOverlayClass}>
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="relative">
              <Loader2 className="size-8 animate-spin" />
              <Download className="size-4 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t('syncingRemote')}</p>
              <p className="text-xs mt-1">{t('pullingRemote')}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading && !hasEditorContent) {
    return (
      <div className="relative h-full min-h-0 w-full flex-1">
        <div className={loadingOverlayClass}>
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const outlinePanelOpen = outlineOpen || outlineHoverOpen

  return (
    <div id="onboarding-target-editor-content" className="flex-1 relative w-full h-full">
      {/* Pull loading overlay */}
      {isPulling && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="relative">
              <Loader2 className="size-8 animate-spin" />
              <Download className="size-4 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t('syncingRemote')}</p>
              <p className="text-xs mt-1">{t('pullingRemote')}</p>
            </div>
          </div>
        </div>
      )}

      <div className="h-full">
        <TipTapEditor
          initialContent={editorContent}
          onChange={handleContentChange}
          placeholder={tEditor('placeholder')}
          activeFilePath={filePath}
          onQuoteToChat={handleQuoteToChat}
          onEditorReady={handleEditorReady}
          outlineOpen={outlineOpen}
          outlinePosition={outlinePosition}
          onToggleOutline={() => {
            void setOutlineOpen(!outlineOpen)
          }}
          editable={!isPulling && !aiStreaming}
          autoScroll={aiStreaming}
          showOverlay={aiStreaming}
          performanceMode={performanceMode}
          onTerminate={() => {
            if (terminateRef.current) {
              terminateRef.current()
            } else {
              // If terminateRef is not set, emit abort event
              emitter.emit('abort-ai-streaming')
            }}
          }
        />
      </div>

      {!isPulling && editorReady && editorInstance && (
        <div
          className={`absolute z-30 ${
            outlinePosition === 'right'
              ? outlinePanelOpen
                ? 'right-1 top-5 bottom-8 w-72'
                : 'right-1 top-14 h-8 w-8'
              : outlinePanelOpen
                ? 'left-1 top-5 bottom-8 w-72'
                : 'left-1 top-14 h-8 w-8'
          }`}
          onMouseEnter={openHoverOutline}
          onMouseLeave={closeHoverOutline}
        >
          {!outlinePanelOpen && (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-background/40 text-muted-foreground/75 backdrop-blur-sm transition-colors hover:bg-muted/70 hover:text-foreground"
              title={tEditor('outline.open')}
              onFocus={openHoverOutline}
            >
              <Menu className="h-5 w-5 stroke-[1.8]" />
            </button>
          )}

          {outlinePanelOpen && (
            <Outline
              editor={editorInstance}
              isOpen={outlinePanelOpen}
              position={outlinePosition}
              floating
            />
          )}
        </div>
      )}
    </div>
  )
}

export default MdEditor
