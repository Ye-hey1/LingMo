'use client'

import { Editor } from '@tiptap/react'
import { Network, Keyboard, Feather, Link2, FileText, ArrowRight, Sparkles, Loader2, Check, ChartNetwork, Hash } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { WordCount } from './word-count'
import { FileCreatedAt } from './file-created-at'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { HeadingCollapseMenu } from './heading-collapse-menu'
import { OutlineToggle } from './outline-toggle'
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
import { EMPTY_PARAGRAPH_MARKDOWN, normalizeMarkdownPlaceholders } from '../markdown-paragraph'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({ editor, outlineOpen, onToggleOutline }: FooterBarProps) {
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
          <OutlineToggle editor={editor} outlineOpen={outlineOpen} onToggleOutline={onToggleOutline} />
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
              <BacklinksPanelContent editor={editor} />
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
        <OutlineToggle editor={editor} outlineOpen={outlineOpen} onToggleOutline={onToggleOutline} />
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
            <BacklinksPanelContent editor={editor} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="相关笔记"
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChartNetwork className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={6} className="w-80 max-h-[340px] overflow-y-auto p-0 rounded-lg">
            <RelatedNotesPanelContent />
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

// ---------------------------------------------------------------------------
// Popover: Backlinks
// ---------------------------------------------------------------------------

function BacklinksPanelContent({ editor }: { editor: Editor }) {
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
      const editorContent = normalizeMarkdownPlaceholders(editor.getMarkdown()).trim()
      const content = editorContent && editorContent !== EMPTY_PARAGRAPH_MARKDOWN
        ? editorContent
        : (useArticleStore.getState().currentArticle || await readWorkspaceTextFile(activeFilePath))

      if (!content.trim()) {
        setAiSuggestions([])
        setAiError('当前笔记没有可分析内容。')
        setAiState('idle')
        toast({
          title: '当前笔记没有内容',
          description: '写入正文后，AI 双链会扫描文中提到的已有笔记标题。',
        })
        return
      }

      const suggestions = await findBacklinkSuggestions(activeFilePath, content)
      setAiSuggestions(suggestions)
      setAiState(suggestions.length > 0 ? 'preview' : 'idle')
      if (suggestions.length === 0) {
        setAiError('未发现可创建的双链。')
        toast({
          title: '未发现可创建的双链',
          description: '只有当正文出现已有笔记标题，且还没有写成 [[双链]] 时，才会生成建议。',
        })
      } else {
        toast({
          title: `发现 ${suggestions.length} 个可创建双链`,
          description: '请在反向链接面板中确认后创建。',
        })
      }
    } catch (error) {
      setAiError('分析失败，请重试。')
      setAiState('idle')
      toast({
        title: 'AI 双链分析失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    }
  }, [activeFilePath, editor])

  const handleApplyAiLinks = useCallback(() => {
    if (!activeFilePath || aiSuggestions.length === 0) return
    const store = useArticleStore.getState()
    const editorContent = normalizeMarkdownPlaceholders(editor.getMarkdown()).trim()
    const content = editorContent && editorContent !== EMPTY_PARAGRAPH_MARKDOWN
      ? editorContent
      : (store.currentArticle || '')
    const updated = applyBacklinks(content, aiSuggestions)
    editor.commands.setContent(updated, { contentType: 'markdown' })
    store.setCurrentArticle(updated)
    void store.saveCurrentArticle(updated)
    useNoteIndexStore.getState().updateFileIndex(activeFilePath, updated)
    setAiState('done')
    toast({
      title: `已创建 ${aiSuggestions.length} 个双链`,
      description: '正文中的纯文本提及已转换为 [[双链]]。',
    })
  }, [activeFilePath, aiSuggestions, editor])

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
          <div className="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
            <div>{aiError}</div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
              AI 双链会把正文中出现的已有笔记标题转换为 [[双链]]，已存在的双链和代码块会自动跳过。
            </div>
          </div>
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
  relationType: string
  evidence: string
  keywordScore: number
  cosineScore: number
  llmScore: number
  agreementCount: number
  source: 'relations' | 'vector'
}

const RELATION_TYPE_LABELS: Record<string, string> = {
  extends: '延伸',
  references: '引用',
  contradicts: '反驳',
  supports: '支撑',
  analogous: '类比',
  example_of: '示例',
  related: '相关',
}

function getRelationBadgeClass(type: string) {
  switch (type) {
    case 'extends':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
    case 'references':
      return 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
    case 'contradicts':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
    case 'supports':
      return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
    case 'analogous':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    case 'example_of':
      return 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function RelationBadge({ type }: { type: string }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', getRelationBadgeClass(type))}>
      {RELATION_TYPE_LABELS[type] || type}
    </span>
  )
}

function SourceSignals({ note }: { note: SemanticNote }) {
  if (note.source === 'vector') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <Sparkles className="size-2.5 text-blue-500" />
        向量相似
      </span>
    )
  }

  const signals = [
    note.keywordScore > 0 ? { key: 'keyword', label: '关键词', icon: Hash, color: 'text-green-500' } : null,
    note.cosineScore > 0 ? { key: 'cosine', label: '语义', icon: Sparkles, color: 'text-blue-500' } : null,
    note.llmScore > 0 ? { key: 'llm', label: 'AI', icon: ChartNetwork, color: 'text-purple-500' } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; icon: typeof Hash; color: string }>

  if (signals.length === 0) {
    return <span className="text-[10px] text-muted-foreground/70">关系引擎</span>
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/70">
      {signals.map(signal => {
        const Icon = signal.icon
        return (
          <span key={signal.key} className="inline-flex items-center gap-0.5">
            <Icon className={cn('size-2.5', signal.color)} />
            {signal.label}
          </span>
        )
      })}
    </span>
  )
}

function RelatedNotesPanelContent() {
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const [notes, setNotes] = useState<SemanticNote[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeFilePath) { setNotes([]); setIsLoading(false); setErrorMessage(null); return }
    let cancelled = false
    setIsLoading(true)
    setNotes([])
    setErrorMessage(null)

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
          result.push({
            filename: rel.target_note,
            score: rel.final_score,
            preview: preview.slice(0, 120),
            relationType: rel.relation_type,
            evidence: rel.evidence,
            keywordScore: rel.keyword_score,
            cosineScore: rel.cosine_score,
            llmScore: rel.llm_score,
            agreementCount: rel.agreement_count,
            source: 'relations',
          })
        }

        if (result.length === 0) {
          try {
            const [{ fetchEmbedding }, { getSimilarDocuments }] = await Promise.all([
              import('@/lib/ai/embedding'),
              import('@/db/vector'),
            ])
            const content = await readWorkspaceTextFile(activeFilePath)
            const embedding = content.trim() ? await fetchEmbedding(content.slice(0, 2000)) : null
            if (embedding) {
              const similar = await getSimilarDocuments(embedding, 6, 0.5)
              for (const doc of similar) {
                if (doc.filename === activeFilePath || doc.filename === activeFilePath.replace(/^\/+/, '')) continue
                let preview = doc.content?.slice(0, 120) || ''
                try {
                  const fullContent = await readWorkspaceTextFile(doc.filename)
                  preview = fullContent.split('\n').filter(l => l.trim()).slice(0, 2).join(' ').slice(0, 120)
                } catch { /* fallback to vector snippet */ }
                result.push({
                  filename: doc.filename,
                  score: doc.similarity,
                  preview,
                  relationType: 'related',
                  evidence: '未发现交叉验证关系，按向量相似度临时推荐。',
                  keywordScore: 0,
                  cosineScore: doc.similarity,
                  llmScore: 0,
                  agreementCount: 1,
                  source: 'vector',
                })
                if (result.length >= 5) break
              }
            }
          } catch {
            // Vector fallback is best-effort; the empty state below remains valid.
          }
        }

        if (!cancelled) setNotes(result)
      } catch {
        if (!cancelled) {
          setNotes([])
          setErrorMessage('相关笔记加载失败，请稍后重试。')
        }
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
          <ChartNetwork className="size-3" />
          相关笔记 ({notes.length})
        </span>
      </div>

      <div className="p-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> 加载中...
          </div>
        ) : errorMessage ? (
          <div className="px-2 py-6 text-xs text-muted-foreground text-center">{errorMessage}</div>
        ) : notes.length === 0 ? (
          <div className="px-2 py-6 text-xs text-muted-foreground text-center">暂无相关笔记</div>
        ) : (
          notes.map((note, i) => (
            <button
              key={`rn-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/50"
              onClick={() => setActiveFilePath(note.filename)}
            >
              <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0 flex-1 truncate font-medium">{note.filename.replace(/\.(md|markdown)$/i, '')}</div>
                  <RelationBadge type={note.relationType} />
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(note.score * 100)}%
                  </span>
                </div>
                {note.evidence && (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {note.evidence.length > 86 ? `${note.evidence.slice(0, 86)}...` : note.evidence}
                  </div>
                )}
                {note.preview && (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{note.preview}</div>
                )}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <SourceSignals note={note} />
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {note.source === 'relations' ? `${note.agreementCount} 个信号` : '临时推荐'}
                  </span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export default FooterBar
