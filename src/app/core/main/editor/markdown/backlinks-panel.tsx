'use client'

import { useNoteIndexStore, type UnlinkedMention } from '@/stores/note-index'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, FileText, Link, ArrowRight, Sparkles, Loader2, Check } from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { extractWikiLinks } from '@/lib/wikilink-extension'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { findBacklinkSuggestions, applyBacklinks, type BacklinkSuggestion } from '@/lib/auto-backlink'

interface HoverPreview {
  target: string
  content: string
  x: number
  y: number
}

export function BacklinksPanel() {
  const t = useTranslations('article.editor')
  const { activeFilePath, setActiveFilePath } = useArticleStore()
  const getBacklinks = useNoteIndexStore(s => s.getBacklinks)
  const getUnlinkedMentions = useNoteIndexStore(s => s.getUnlinkedMentions)
  const [isExpanded, setIsExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState<'backlinks' | 'outgoing' | 'unlinked' | 'ai-links'>('backlinks')
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null)
  const [aiLinkState, setAiLinkState] = useState<'idle' | 'loading' | 'preview' | 'done'>('idle')
  const [aiLinkSuggestions, setAiLinkSuggestions] = useState<BacklinkSuggestion[]>([])
  const [aiLinkError, setAiLinkError] = useState<string | null>(null)

  const handleFindAiLinks = useCallback(async () => {
    if (!activeFilePath) return
    setAiLinkState('loading')
    setAiLinkError(null)
    try {
      const content = useArticleStore.getState().currentArticle || ''
      const suggestions = await findBacklinkSuggestions(activeFilePath, content)
      setAiLinkSuggestions(suggestions)
      setAiLinkState(suggestions.length > 0 ? 'preview' : 'idle')
      if (suggestions.length === 0) {
        setAiLinkError('未发现可创建的双链，当前笔记已良好链接。')
      }
    } catch (e) {
      setAiLinkError('分析失败，请重试。')
      setAiLinkState('idle')
    }
    setActiveTab('ai-links')
  }, [activeFilePath])

  const handleApplyAiLinks = useCallback(() => {
    if (!activeFilePath || aiLinkSuggestions.length === 0) return
    const store = useArticleStore.getState()
    const content = store.currentArticle || ''
    const updated = applyBacklinks(content, aiLinkSuggestions)
    store.setCurrentArticle(updated)
    void store.saveCurrentArticle(updated)
    // Refresh note index
    const noteIndexStore = useNoteIndexStore.getState()
    noteIndexStore.updateFileIndex(activeFilePath, updated)
    setAiLinkState('done')
  }, [activeFilePath, aiLinkSuggestions])

  const handleDismissAiLinks = useCallback(() => {
    setAiLinkState('idle')
    setAiLinkSuggestions([])
    setActiveTab('backlinks')
  }, [])

  const backlinks = useMemo(() => {
    if (!activeFilePath) return []
    return getBacklinks(activeFilePath)
  }, [activeFilePath, getBacklinks])

  const unlinkedMentions = useMemo(() => {
    if (!activeFilePath) return []
    return getUnlinkedMentions(activeFilePath)
  }, [activeFilePath, getUnlinkedMentions])

  // 获取出站链接（当前文件链接到的其他文件）
  const outgoingLinks = useMemo(() => {
    if (!activeFilePath) return []
    const content = useArticleStore.getState().currentArticle || ''
    const links = extractWikiLinks(content)
    // 去重
    return [...new Set(links)]
  }, [activeFilePath])

  const handleHoverPreview = useCallback(async (target: string, event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect()
    try {
      const { fileTree } = useArticleStore.getState()
      let targetPath = ''
      const findFile = (items: any[], prefix = ''): string | null => {
        for (const item of items) {
          const itemPath = prefix ? `${prefix}/${item.name}` : item.name
          const baseName = item.name.replace(/\.md$/, '')
          if (item.isFile && baseName === target) return itemPath
          if (item.children) {
            const found = findFile(item.children, itemPath)
            if (found) return found
          }
        }
        return null
      }
      targetPath = findFile(fileTree) || `${target}.md`

      const content = await readWorkspaceTextFile(targetPath)
      const preview = content.split('\n').slice(0, 5).join('\n')
      setHoverPreview({
        target,
        content: preview || '(empty)',
        x: rect.left,
        y: rect.bottom + 4,
      })
    } catch {
      setHoverPreview({
        target,
        content: '(无法预览)',
        x: rect.left,
        y: rect.bottom + 4,
      })
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoverPreview(null)
  }, [])

  const totalLinks = backlinks.length + outgoingLinks.length + unlinkedMentions.length
  if (!activeFilePath) return null

  return (
    <div className="border-t bg-muted/30">
      {/* Tab header */}
      <div className="flex items-center border-b">
        <button
          className="flex flex-1 items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => { setIsExpanded(!isExpanded) }}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Link className="h-3 w-3" />
          {t('backlinks')} ({totalLinks})
        </button>
        {isExpanded && (
          <div className="flex items-center">
            <button
              className={`px-2 py-1 text-[11px] rounded-sm transition-colors ${
                activeTab === 'backlinks'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('backlinks')}
            >
              {t('backlinks')} ({backlinks.length})
            </button>
            <button
              className={`px-2 py-1 text-[11px] rounded-sm transition-colors ${
                activeTab === 'outgoing'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('outgoing')}
            >
              {t('outgoingLinks')} ({outgoingLinks.length})
            </button>
            {(unlinkedMentions.length > 0 || aiLinkState !== 'idle') && (
              <button
                className={`px-2 py-1 text-[11px] rounded-sm transition-colors ${
                  activeTab === 'unlinked'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('unlinked')}
              >
                {t('unlinkedMentions', { defaultMessage: '未链接提及' })} ({unlinkedMentions.length})
              </button>
            )}
            <button
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-sm transition-colors ${
                activeTab === 'ai-links'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-amber-600 hover:text-amber-700 dark:text-amber-400'
              }`}
              onClick={handleFindAiLinks}
              disabled={aiLinkState === 'loading'}
            >
              {aiLinkState === 'loading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : aiLinkState === 'done' ? (
                <Check className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              <span>AI 双链</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-2 space-y-1">
          {activeTab === 'backlinks' && backlinks.map((bl, i) => (
            <button
              key={`bl-${bl.sourcePath}-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => setActiveFilePath(bl.sourcePath)}
              onMouseEnter={(e) => handleHoverPreview(bl.sourceName, e)}
              onMouseLeave={handleMouseLeave}
            >
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{bl.sourceName}</div>
                <div className="text-muted-foreground truncate">
                  {bl.context.length > 80 ? bl.context.slice(0, 80) + '...' : bl.context}
                </div>
              </div>
            </button>
          ))}
          {activeTab === 'outgoing' && outgoingLinks.map((target, i) => (
            <button
              key={`ol-${target}-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => {
                const { fileTree, setActiveFilePath } = useArticleStore.getState()
                const findFile = (items: any[], prefix = ''): string | null => {
                  for (const item of items) {
                    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
                    const baseName = item.name.replace(/\.md$/, '')
                    if (item.isFile && baseName === target) return itemPath
                    if (item.children) {
                      const found = findFile(item.children, itemPath)
                      if (found) return found
                    }
                  }
                  return null
                }
                const found = findFile(fileTree)
                if (found) setActiveFilePath(found)
              }}
              onMouseEnter={(e) => handleHoverPreview(target, e)}
              onMouseLeave={handleMouseLeave}
            >
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{target}</div>
              </div>
            </button>
          ))}
          {activeTab === 'unlinked' && unlinkedMentions.map((mention, i) => (
            <button
              key={`um-${mention.sourcePath}-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => setActiveFilePath(mention.sourcePath)}
              onMouseEnter={(e) => handleHoverPreview(mention.sourceName, e)}
              onMouseLeave={handleMouseLeave}
            >
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{mention.sourceName}</div>
                <div className="text-muted-foreground truncate">
                  {mention.context.length > 80 ? mention.context.slice(0, 80) + '...' : mention.context}
                </div>
              </div>
            </button>
          ))}
          {activeTab === 'ai-links' && (
            <>
              {aiLinkState === 'loading' && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在分析笔记内容...</span>
                </div>
              )}
              {aiLinkError && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {aiLinkError}
                </div>
              )}
              {aiLinkState === 'preview' && aiLinkSuggestions.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    发现 {aiLinkSuggestions.length} 个可创建的双链：
                  </div>
                  {aiLinkSuggestions.map((s, i) => (
                    <div
                      key={`ai-${s.target}-${i}`}
                      className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                    >
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {s.text} → <span className="text-amber-600 dark:text-amber-400">[[{s.target}]]</span>
                        </div>
                        <div className="text-muted-foreground">{s.reason}</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      className="flex-1 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition hover:opacity-90"
                      onClick={handleApplyAiLinks}
                    >
                      创建全部双链
                    </button>
                    <button
                      className="rounded-md border px-3 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
                      onClick={handleDismissAiLinks}
                    >
                      取消
                    </button>
                  </div>
                </>
              )}
              {aiLinkState === 'done' && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-green-600 dark:text-green-400">
                  <Check className="h-3.5 w-3.5" />
                  <span>已成功创建 {aiLinkSuggestions.length} 个双链！</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Hover preview tooltip */}
      {hoverPreview && (
        <div
          className="fixed z-50 max-w-sm rounded-lg border bg-popover p-3 text-xs shadow-lg"
          style={{ left: hoverPreview.x, top: hoverPreview.y }}
        >
          <div className="mb-1 font-medium text-foreground">{hoverPreview.target}</div>
          <div className="text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {hoverPreview.content}
          </div>
        </div>
      )}
    </div>
  )
}
