'use client'

import { Editor } from '@tiptap/react'
import { Network, Keyboard, Feather, Link2, GitBranch } from 'lucide-react'
import { useState, useCallback } from 'react'
import { WordCount } from './word-count'
import { FileCreatedAt } from './file-created-at'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { HeadingCollapseMenu } from './heading-collapse-menu'
import { VectorCalc } from './vector-calc'
import { SyncTools } from '../sync/sync-tools'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { isMobileDevice } from '@/lib/check'
import { KNOWLEDGE_GRAPH_TAB_PATH } from '@/app/core/main/knowledge/knowledge-graph-constants'
import emitter from '@/lib/emitter'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({
  editor,
}: FooterBarProps) {
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const {
    aiCompletionEnabled,
    setAiCompletionEnabled,
    typewriterMode,
    setTypewriterMode,
    zenMode,
    setZenMode,
  } = useSettingStore()
  const isMobile = isMobileDevice()

  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const [relatedOpen, setRelatedOpen] = useState(false)

  const handleLocateGraph = useCallback(() => {
    if (!activeFilePath) return
    emitter.emit('graph-locate-node' as any, { path: activeFilePath })
    useArticleStore.getState().setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
  }, [activeFilePath])

  if (isMobile) {
    return (
      <div className="h-7 flex items-center justify-between gap-3 px-3 border-t border-border bg-background text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <WordCount editor={editor} />
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            className={cn(
              'h-5 w-5 flex items-center justify-center rounded transition-colors',
              typewriterMode ? 'text-[#1677ff] bg-[#1677ff]/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => setTypewriterMode(!typewriterMode)}
            title="打字机模式"
          >
            <Keyboard className="size-3" />
          </button>
          <VectorCalc aiCompletionEnabled={aiCompletionEnabled} onToggleAICompletion={setAiCompletionEnabled} />
          <SyncTools editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-6 flex items-center justify-between px-2 border-t border-border bg-background text-[11px] text-muted-foreground select-none gap-0.5">
      {/* Left group */}
      <div className="flex min-w-0 items-center gap-0.5">
        <WordCount editor={editor} />
        <FileCreatedAt />
        <Separator />
        <HeadingCollapseMenu editor={editor} />
        <CopyButton editor={editor} />
        <ExportButton editor={editor} />
        {activeFilePath?.endsWith('.md') && (
          <IconButton title="在图谱中定位" onClick={handleLocateGraph}>
            <Network className="size-3" />
          </IconButton>
        )}
      </div>

      {/* Right group */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Backlinks popover */}
        <Popover open={backlinksOpen} onOpenChange={setBacklinksOpen}>
          <PopoverTrigger asChild>
            <IconButton title="反向链接">
              <Link2 className="size-3" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={6}
            className="w-[360px] max-h-[400px] overflow-y-auto p-0 rounded-lg border shadow-xl"
          >
            <BacklinksPopoverContent onClose={() => setBacklinksOpen(false)} />
          </PopoverContent>
        </Popover>

        {/* Related notes popover */}
        <Popover open={relatedOpen} onOpenChange={setRelatedOpen}>
          <PopoverTrigger asChild>
            <IconButton title="相关笔记">
              <GitBranch className="size-3" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={6}
            className="w-[360px] max-h-[400px] overflow-y-auto p-0 rounded-lg border shadow-xl"
          >
            <RelatedNotesPopoverContent onClose={() => setRelatedOpen(false)} />
          </PopoverContent>
        </Popover>

        <Separator />

        {/* Mode toggles - icon only */}
        <button
          type="button"
          onClick={() => setTypewriterMode(!typewriterMode)}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded transition-colors',
            typewriterMode
              ? 'text-[#1677ff] bg-[#1677ff]/10'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title={typewriterMode ? '关闭打字机模式' : '开启打字机模式'}
        >
          <Keyboard className="size-3" />
        </button>

        <button
          type="button"
          onClick={() => setZenMode(!zenMode)}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded transition-colors',
            zenMode
              ? 'text-[#1677ff] bg-[#1677ff]/10'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title={zenMode ? '关闭专注模式' : '开启专注模式'}
        >
          <Feather className="size-3" />
        </button>

        <Separator />

        <VectorCalc
          aiCompletionEnabled={aiCompletionEnabled}
          onToggleAICompletion={setAiCompletionEnabled}
        />

        <SyncTools editor={editor} />
      </div>
    </div>
  )
}

/** Tiny separator dot */
function Separator() {
  return <span className="h-3 w-px bg-border/60 mx-0.5" />
}

/** Small icon-only button */
function IconButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** ---- Popover content: lazy loaded backlinks ---- */
import { useNoteIndexStore } from '@/stores/note-index'
import { extractWikiLinks } from '@/lib/wikilink-extension'
import { findBacklinkSuggestions, applyBacklinks, type BacklinkSuggestion } from '@/lib/auto-backlink'
import { FileText, ArrowRight, Sparkles, Loader2, Check } from 'lucide-react'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { useMemo } from 'react'

function BacklinksPopoverContent({ onClose }: { onClose: () => void }) {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const getBacklinks = useNoteIndexStore((s) => s.getBacklinks)
  const getUnlinkedMentions = useNoteIndexStore((s) => s.getUnlinkedMentions)

  const backlinks = useMemo(() => activeFilePath ? getBacklinks(activeFilePath) : [], [activeFilePath, getBacklinks])
  const outgoingLinks = useMemo(() => {
    if (!activeFilePath) return []
    const content = useArticleStore.getState().currentArticle || ''
    return [...new Set(extractWikiLinks(content))]
  }, [activeFilePath])
  const unlinkedMentions = useMemo(() => activeFilePath ? getUnlinkedMentions(activeFilePath) : [], [activeFilePath, getUnlinkedMentions])

  const [aiState, setAiState] = useState<'idle' | 'loading' | 'preview' | 'done'>('idle')
  const [aiSuggestions, setAiSuggestions] = useState<BacklinkSuggestion[]>([])
  const [aiError, setAiError] = useState<string | null>(null)

  const handleFindAiLinks = useCallback(async () => {
    if (!activeFilePath) return
    setAiState('loading')
    setAiError(null)
    try {
      const content = useArticleStore.getState().currentArticle || ''
      const suggestions = await findBacklinkSuggestions(activeFilePath, content)
      setAiSuggestions(suggestions)
      setAiState(suggestions.length > 0 ? 'preview' : 'idle')
      if (suggestions.length === 0) setAiError('未发现可创建的双链。')
    } catch {
      setAiError('分析失败，请重试。')
      setAiState('idle')
    }
  }, [activeFilePath])

  const handleApplyAiLinks = useCallback(() => {
    if (!activeFilePath || aiSuggestions.length === 0) return
    const store = useArticleStore.getState()
    const content = store.currentArticle || ''
    const updated = applyBacklinks(content, aiSuggestions)
    store.setCurrentArticle(updated)
    void store.saveCurrentArticle(updated)
    useNoteIndexStore.getState().updateFileIndex(activeFilePath, updated)
    setAiState('done')
  }, [activeFilePath, aiSuggestions])

  const totalLinks = backlinks.length + outgoingLinks.length + unlinkedMentions.length

  return (
    <div>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">
          <Link2 className="inline size-3 mr-1 -mt-px" />
          反向链接 ({totalLinks})
        </span>
        <button
          type="button"
          onClick={handleFindAiLinks}
          disabled={aiState === 'loading'}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 transition-colors"
          title="AI 自动发现双链"
        >
          {aiState === 'loading' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          AI 双链
        </button>
      </div>

      {/* AI results */}
      {aiState === 'loading' && (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> 正在分析笔记内容...
        </div>
      )}
      {aiError && aiState !== 'preview' && aiState !== 'done' && (
        <div className="px-3 py-2 text-xs text-muted-foreground">{aiError}</div>
      )}
      {aiState === 'preview' && aiSuggestions.length > 0 && (
        <div className="border-b">
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground">发现 {aiSuggestions.length} 个可创建的双链：</div>
          {aiSuggestions.map((s, i) => (
            <div key={`ai-${s.target}-${i}`} className="flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent/50">
              <Sparkles className="mt-0.5 size-3 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{s.text}</span> → <span className="text-amber-600 dark:text-amber-400">[[{s.target}]]</span>
                <div className="text-muted-foreground">{s.reason}</div>
              </div>
            </div>
          ))}
          <div className="flex gap-2 px-3 py-2">
            <button className="flex-1 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background hover:opacity-90" onClick={handleApplyAiLinks}>创建全部双链</button>
            <button className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setAiState('idle'); setAiSuggestions([]) }}>取消</button>
          </div>
        </div>
      )}
      {aiState === 'done' && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-green-600 dark:text-green-400 border-b">
          <Check className="size-3" /> 已成功创建 {aiSuggestions.length} 个双链！
        </div>
      )}

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className="border-b">
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">入链 ({backlinks.length})</div>
          {backlinks.map((bl, i) => (
            <button key={`bl-${i}`} className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50 transition-colors" onClick={() => { setActiveFilePath(bl.sourcePath); onClose() }}>
              <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{bl.sourceName}</div>
                <div className="text-muted-foreground truncate">{bl.context.length > 60 ? bl.context.slice(0, 60) + '…' : bl.context}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Outgoing */}
      {outgoingLinks.length > 0 && (
        <div className="border-b">
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">出链 ({outgoingLinks.length})</div>
          {outgoingLinks.map((target, i) => (
            <button key={`ol-${i}`} className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50 transition-colors" onClick={() => {
              const { fileTree, setActiveFilePath } = useArticleStore.getState()
              const findFile = (items: any[], prefix = ''): string | null => {
                for (const item of items) {
                  const itemPath = prefix ? `${prefix}/${item.name}` : item.name
                  if (item.isFile && item.name.replace(/\.md$/, '') === target) return itemPath
                  if (item.children) { const f = findFile(item.children, itemPath); if (f) return f }
                }
                return null
              }
              const found = findFile(fileTree)
              if (found) { setActiveFilePath(found); onClose() }
            }}>
              <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 font-medium truncate">{target}</div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {backlinks.length === 0 && outgoingLinks.length === 0 && aiState === 'idle' && (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">暂无链接关系</div>
      )}
    </div>
  )
}

/** ---- Popover content: related notes ---- */
import { getCrossValidatedRelations } from '@/lib/relation-engine'

interface SemanticNote {
  filename: string
  score: number
  preview: string
}

function RelatedNotesPopoverContent({ onClose }: { onClose: () => void }) {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const [notes, setNotes] = useState<SemanticNote[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useMemo(() => {
    if (!activeFilePath) { setNotes([]); setIsLoading(false); return }
    let cancelled = false
    setIsLoading(true)
    void (async () => {
      try {
        const relations = await getCrossValidatedRelations(activeFilePath, 0.3)
        if (cancelled) return
        const result: SemanticNote[] = []
        for (const rel of relations.slice(0, 8)) {
          let preview = ''
          try {
            const content = await readWorkspaceTextFile(rel.target_note)
            preview = content.split('\n').filter(l => l.trim()).slice(0, 2).join(' ')
          } catch { /* ignore */ }
          result.push({ filename: rel.target_note, score: rel.final_score, preview: preview.slice(0, 100) })
        }
        setNotes(result)
      } catch {
        setNotes([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeFilePath])

  return (
    <div>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">
          <GitBranch className="inline size-3 mr-1 -mt-px" />
          相关笔记 ({notes.length})
        </span>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> 加载中...
        </div>
      ) : notes.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">暂无相关笔记</div>
      ) : (
        notes.map((note, i) => (
          <button
            key={`rn-${i}`}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50 transition-colors"
            onClick={() => { setActiveFilePath(note.filename); onClose() }}
          >
            <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{note.filename.replace(/\.md$/, '')}</div>
              {note.preview && <div className="text-muted-foreground truncate">{note.preview}</div>}
              <div className="text-[10px] text-muted-foreground/60 tabular-nums">相似度 {Math.round(note.score * 100)}%</div>
            </div>
          </button>
        ))
      )}
    </div>
  )
}

export default FooterBar
