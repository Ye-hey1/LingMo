'use client'

import { Editor } from '@tiptap/react'
import { Network, Keyboard, Feather, Link2, GitBranch, FileText, ArrowRight, Sparkles, Loader2, Check, CalendarClock, ShieldQuestion } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'
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
import { useNoteIndexStore } from '@/stores/note-index'
import { extractWikiLinks } from '@/lib/wikilink-extension'
import { findBacklinkSuggestions, applyBacklinks, type BacklinkSuggestion } from '@/lib/auto-backlink'
import { getCrossValidatedRelations } from '@/lib/relation-engine'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { toast } from '@/hooks/use-toast'
import { requestGhostTextCompletion } from '../ghost-text-extension'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({ editor }: FooterBarProps) {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const {
    aiCompletionEnabled,
    setAiCompletionEnabled,
    typewriterMode,
    setTypewriterMode,
    zenMode,
    setZenMode,
  } = useSettingStore()
  const isMobile = isMobileDevice()

  const handleLocateGraph = useCallback(() => {
    if (!activeFilePath) return
    emitter.emit('graph-locate-node' as any, { path: activeFilePath })
    useArticleStore.getState().setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
  }, [activeFilePath])

  const handleToggleAICompletion = useCallback(async (enabled: boolean) => {
    await setAiCompletionEnabled(enabled)

    if (!enabled) {
      return
    }

    window.setTimeout(() => {
      const requested = requestGhostTextCompletion(editor)
      if (!requested) {
        toast({
          title: 'AI 补全已开启',
          description: '当前光标上下文太短，继续输入后会自动触发灰字补全。',
        })
      }
    }, 0)
  }, [editor, setAiCompletionEnabled])

  if (isMobile) {
    return (
      <div className="h-7 flex items-center justify-between gap-3 px-3 border-t border-border bg-background text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <WordCount editor={editor} />
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="反向链接"
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Link2 className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[340px] overflow-y-auto p-0 rounded-lg">
              <BacklinksPanelContent />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="笔记智能"
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Sparkles className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[380px] overflow-y-auto p-0 rounded-lg">
              <NoteIntelligencePanelContent />
            </PopoverContent>
          </Popover>
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
          <VectorCalc aiCompletionEnabled={aiCompletionEnabled} onToggleAICompletion={handleToggleAICompletion} />
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
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="反向链接"
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Link2 className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[340px] overflow-y-auto p-0 rounded-lg">
            <BacklinksPanelContent />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="相关笔记"
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <GitBranch className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[340px] overflow-y-auto p-0 rounded-lg">
            <RelatedNotesPanelContent />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="笔记智能"
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Sparkles className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[380px] overflow-y-auto p-0 rounded-lg">
            <NoteIntelligencePanelContent />
          </PopoverContent>
        </Popover>

        <Separator />

        <button
          type="button"
          onClick={() => setTypewriterMode(!typewriterMode)}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded transition-colors',
            typewriterMode ? 'text-[#1677ff] bg-[#1677ff]/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
            zenMode ? 'text-[#1677ff] bg-[#1677ff]/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title={zenMode ? '关闭专注模式' : '开启专注模式'}
        >
          <Feather className="size-3" />
        </button>

        <Separator />

        <VectorCalc aiCompletionEnabled={aiCompletionEnabled} onToggleAICompletion={handleToggleAICompletion} />
        <SyncTools editor={editor} />
      </div>
    </div>
  )
}

function Separator() {
  return <span className="h-3 w-px bg-border/60 mx-0.5" />
}

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

function NoteIntelligencePanelContent() {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const [loading, setLoading] = useState<'counterpoint' | 'wake' | null>(null)
  const [wakeText, setWakeText] = useState('三个月后评估这篇笔记')

  const isMarkdown = Boolean(activeFilePath && /\.(md|markdown)$/i.test(activeFilePath))

  const handleCounterpoint = useCallback(async () => {
    if (!activeFilePath || !isMarkdown) return
    setLoading('counterpoint')
    try {
      const store = useArticleStore.getState()
      const content = store.currentArticle || ''
      const { appendCounterpointToContent, generateCounterpointForNote } = await import('@/lib/note-intelligence')
      const result = await generateCounterpointForNote(activeFilePath, content)
      const updated = appendCounterpointToContent(content, result)
      store.setCurrentArticle(updated)
      await store.saveCurrentArticle(updated)
      toast({
        title: '已生成反观点',
        description: '反观点已追加到当前笔记底部。',
      })
    } catch (error) {
      toast({
        title: '生成反观点失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }, [activeFilePath, isMarkdown])

  const handleWake = useCallback(async () => {
    if (!activeFilePath || !isMarkdown || !wakeText.trim()) return
    setLoading('wake')
    try {
      const store = useArticleStore.getState()
      const content = store.currentArticle || ''
      const directive = `\n\n<!-- lingmo:wake after="${wakeText.trim()}" reason="回看并评估这篇笔记" -->\n`
      const updated = `${content.replace(/\s+$/g, '')}${directive}`
      store.setCurrentArticle(updated)
      await store.saveCurrentArticle(updated)
      const { syncWakeDirectivesForNote } = await import('@/lib/note-intelligence')
      const created = await syncWakeDirectivesForNote(activeFilePath, updated)
      toast({
        title: created.length ? '已设置笔记唤醒' : '唤醒语法已写入',
        description: created.length ? `${created[0].title}` : '保存后会在可解析时间到期时进入回顾。',
      })
    } catch (error) {
      toast({
        title: '设置唤醒失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }, [activeFilePath, isMarkdown, wakeText])

  return (
    <div>
      <div className="flex items-center border-b px-3 py-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Sparkles className="size-3" />
          笔记智能
        </span>
      </div>

      <div className="space-y-3 p-3">
        {!isMarkdown ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            请先打开一篇 Markdown 笔记
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <ShieldQuestion className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">反观点生成器</span>
              </div>
              <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
                让 AI 以可信反方视角挑战当前笔记，帮助发现决策和论证盲区。
              </p>
              <button
                type="button"
                disabled={loading !== null}
                className="inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background hover:opacity-90 disabled:opacity-60"
                onClick={handleCounterpoint}
              >
                {loading === 'counterpoint' ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <ShieldQuestion className="mr-1.5 size-3" />}
                挑战这个观点
              </button>
            </div>

            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">笔记主动调度</span>
              </div>
              <input
                value={wakeText}
                onChange={(event) => setWakeText(event.target.value)}
                placeholder="例如：三个月后评估"
                className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                disabled={loading !== null || !wakeText.trim()}
                className="inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
                onClick={handleWake}
              >
                {loading === 'wake' ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <CalendarClock className="mr-1.5 size-3" />}
                设置唤醒
              </button>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                会写入隐藏唤醒标记，到期后出现在活动中心的笔记智能页。
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover: Backlinks
// ---------------------------------------------------------------------------

function BacklinksPanelContent() {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const getBacklinks = useNoteIndexStore((s) => s.getBacklinks)

  const backlinks = useMemo(() => activeFilePath ? getBacklinks(activeFilePath) : [], [activeFilePath, getBacklinks])
  const outgoingLinks = useMemo(() => {
    if (!activeFilePath) return []
    const content = useArticleStore.getState().currentArticle || ''
    return [...new Set(extractWikiLinks(content))]
  }, [activeFilePath])

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

  const totalLinks = backlinks.length + outgoingLinks.length

  const navigateTo = useCallback((path: string) => {
    setActiveFilePath(path)
  }, [setActiveFilePath])

  return (
    <div>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Link2 className="size-3" />
          反向链接 ({totalLinks})
        </span>
        <button
          type="button"
          onClick={handleFindAiLinks}
          disabled={aiState === 'loading'}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 transition-colors"
        >
          {aiState === 'loading' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          AI 双链
        </button>
      </div>

      <div className="p-1.5">
        {aiState === 'loading' && (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> 正在分析...
          </div>
        )}
        {aiError && aiState !== 'preview' && aiState !== 'done' && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{aiError}</div>
        )}
        {aiState === 'preview' && aiSuggestions.length > 0 && (
          <div className="border rounded-md mb-1.5 p-1.5">
            <div className="px-1 py-0.5 text-[11px] text-muted-foreground">发现 {aiSuggestions.length} 个双链：</div>
            {aiSuggestions.map((s, i) => (
              <div key={`ai-${s.target}-${i}`} className="flex items-start gap-1.5 px-1 py-1 text-xs hover:bg-accent/50 rounded">
                <Sparkles className="mt-0.5 size-3 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{s.text}</span> → <span className="text-amber-600 dark:text-amber-400">[[{s.target}]]</span>
                  <div className="text-muted-foreground text-[11px]">{s.reason}</div>
                </div>
              </div>
            ))}
            <div className="flex gap-1.5 px-1 pt-1 pb-0.5">
              <button className="flex-1 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background hover:opacity-90" onClick={handleApplyAiLinks}>创建全部</button>
              <button className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setAiState('idle'); setAiSuggestions([]) }}>取消</button>
            </div>
          </div>
        )}
        {aiState === 'done' && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-green-600 dark:text-green-400 mb-1">
            <Check className="size-3" /> 已创建 {aiSuggestions.length} 个双链
          </div>
        )}

        {backlinks.length > 0 && (
          <div className="mb-1">
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">入链 ({backlinks.length})</div>
            {backlinks.map((bl, i) => (
              <button key={`bl-${i}`} className="flex w-full items-start gap-2 px-2 py-1 text-left text-xs hover:bg-accent/50 rounded transition-colors" onClick={() => navigateTo(bl.sourcePath)}>
                <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{bl.sourceName}</div>
                  <div className="text-muted-foreground truncate">{bl.context.length > 50 ? bl.context.slice(0, 50) + '…' : bl.context}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {outgoingLinks.length > 0 && (
          <div>
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">出链 ({outgoingLinks.length})</div>
            {outgoingLinks.map((target, i) => (
              <button key={`ol-${i}`} className="flex w-full items-start gap-2 px-2 py-1 text-left text-xs hover:bg-accent/50 rounded transition-colors" onClick={() => {
                const { fileTree } = useArticleStore.getState()
                const findFile = (items: any[], prefix = ''): string | null => {
                  for (const item of items) {
                    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
                    if (item.isFile && item.name.replace(/\.md$/, '') === target) return itemPath
                    if (item.children) { const f = findFile(item.children, itemPath); if (f) return f }
                  }
                  return null
                }
                const found = findFile(fileTree)
                if (found) navigateTo(found)
              }}>
                <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 font-medium truncate">{target}</div>
              </button>
            ))}
          </div>
        )}

        {backlinks.length === 0 && outgoingLinks.length === 0 && aiState === 'idle' && (
          <div className="px-2 py-4 text-xs text-muted-foreground text-center">暂无链接关系</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover: Related Notes
// ---------------------------------------------------------------------------

interface SemanticNote {
  filename: string
  score: number
  preview: string
}

function RelatedNotesPanelContent() {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const [notes, setNotes] = useState<SemanticNote[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!activeFilePath) { setNotes([]); setIsLoading(false); return }
    let cancelled = false
    setIsLoading(true)
    setNotes([])

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
          result.push({ filename: rel.target_note, score: rel.final_score, preview: preview.slice(0, 80) })
        }
        if (!cancelled) setNotes(result)
      } catch {
        if (!cancelled) setNotes([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [activeFilePath])

  return (
    <div>
      <div className="flex items-center border-b px-3 py-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <GitBranch className="size-3" />
          相关笔记 ({notes.length})
        </span>
      </div>

      <div className="p-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> 加载中...
          </div>
        ) : notes.length === 0 ? (
          <div className="px-2 py-6 text-xs text-muted-foreground text-center">暂无相关笔记</div>
        ) : (
          notes.map((note, i) => (
            <button
              key={`rn-${i}`}
              className="flex w-full items-start gap-2 px-2 py-1 text-left text-xs hover:bg-accent/50 rounded transition-colors"
              onClick={() => setActiveFilePath(note.filename)}
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
    </div>
  )
}

export default FooterBar
