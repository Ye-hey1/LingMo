'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { FileText, Sparkles, RefreshCw, Hash, Brain, Link2 } from 'lucide-react'
import useArticleStore from '@/stores/article'
import { getSimilarDocuments } from '@/db/vector'
import { fetchEmbedding } from '@/lib/ai/embedding'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { getCrossValidatedRelations, type CrossValidatedRelation } from '@/lib/relation-engine'
import { useTranslations } from 'next-intl'

interface RelatedNote {
  filename: string
  similarity: number
  preview: string
}

interface SemanticNote {
  filename: string
  score: number
  relationType: string
  evidence: string
  keywordScore: number
  cosineScore: number
  llmScore: number
  agreementCount: number
  preview: string
}

// 关系类型标签颜色
const RELATION_TYPE_COLORS: Record<string, string> = {
  extends: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  references: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  contradicts: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  supports: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  analogous: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  example_of: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  related: 'bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-400',
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

function RelationBadge({ type }: { type: string }) {
  const color = RELATION_TYPE_COLORS[type] || RELATION_TYPE_COLORS.related
  const label = RELATION_TYPE_LABELS[type] || type
  return (
    <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  )
}

function SourceIcon({ keywordScore, cosineScore, llmScore }: { keywordScore: number; cosineScore: number; llmScore: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keywordScore > 0 && <span className="inline-flex items-center"><Hash className="h-2.5 w-2.5 text-green-500" /></span>}
      {cosineScore > 0 && <span className="inline-flex items-center"><Sparkles className="h-2.5 w-2.5 text-blue-500" /></span>}
      {llmScore > 0 && <span className="inline-flex items-center"><Brain className="h-2.5 w-2.5 text-purple-500" /></span>}
    </span>
  )
}

export function RelatedNotesPanel() {
  const t = useTranslations('article.editor')
  const { activeFilePath, setActiveFilePath } = useArticleStore()
  const [semanticNotes, setSemanticNotes] = useState<SemanticNote[]>([])
  const [fallbackNotes, setFallbackNotes] = useState<RelatedNote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)

  const loadRelatedNotes = useCallback(async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      // 优先加载预计算的语义关系
      const relations = await getCrossValidatedRelations(activeFilePath, 0.3)

      if (relations.length > 0) {
        const notesWithPreview: SemanticNote[] = []
        for (const rel of relations.slice(0, 8)) {
          let preview = ''
          try {
            const fullContent = await readWorkspaceTextFile(rel.target_note)
            preview = fullContent.split('\n').filter(l => l.trim()).slice(0, 3).join('\n')
          } catch {
            preview = ''
          }

          notesWithPreview.push({
            filename: rel.target_note,
            score: rel.final_score,
            relationType: rel.relation_type,
            evidence: rel.evidence,
            keywordScore: rel.keyword_score,
            cosineScore: rel.cosine_score,
            llmScore: rel.llm_score,
            agreementCount: rel.agreement_count,
            preview,
          })
        }
        setSemanticNotes(notesWithPreview)
        setFallbackNotes([])
      } else {
        // 退回到实时余弦相似度
        setSemanticNotes([])
        const content = await readWorkspaceTextFile(activeFilePath)
        if (!content || content.trim().length === 0) {
          setFallbackNotes([])
          return
        }

        const embedding = await fetchEmbedding(content.slice(0, 2000))
        if (!embedding) {
          setFallbackNotes([])
          return
        }

        const similar = await getSimilarDocuments(embedding, 5, 0.5)
        const filtered = similar.filter(
          doc => doc.filename !== activeFilePath && doc.filename !== activeFilePath.replace(/^\/+/, '')
        )

        const notesWithPreview: RelatedNote[] = []
        for (const doc of filtered.slice(0, 5)) {
          try {
            const fullContent = await readWorkspaceTextFile(doc.filename)
            const preview = fullContent.split('\n').filter(l => l.trim()).slice(0, 3).join('\n')
            notesWithPreview.push({ filename: doc.filename, similarity: doc.similarity, preview })
          } catch {
            notesWithPreview.push({ filename: doc.filename, similarity: doc.similarity, preview: doc.content.slice(0, 100) })
          }
        }
        setFallbackNotes(notesWithPreview)
      }
    } catch {
      setSemanticNotes([])
      setFallbackNotes([])
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRelatedNotes()
    }, 1000)

    return () => clearTimeout(timer)
  }, [loadRelatedNotes])

  const formatTitle = useCallback((filename: string) => {
    return filename.split('/').pop()?.replace(/\.md$/, '') || filename
  }, [])

  const totalCount = semanticNotes.length + fallbackNotes.length

  if (totalCount === 0 && !isLoading) return null

  return (
    <div className="border-t bg-muted/30">
      <div className="flex items-center border-b">
        <button
          className="flex flex-1 items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <span style={{display:'inline-flex',alignItems:'center'}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg></span> : <span style={{display:'inline-flex',alignItems:'center'}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>}
          <Link2 className="h-3 w-3" />
          {t('relatedNotes')} ({totalCount})
        </button>
        <button
          className="px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => void loadRelatedNotes()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <div className="px-4 pb-2 space-y-1">
          {isLoading && totalCount === 0 && (
            <div className="py-2 text-xs text-muted-foreground text-center">
              {t('loadingRelatedNotes')}
            </div>
          )}

          {/* 语义关系笔记 */}
          {semanticNotes.map((note, i) => (
            <button
              key={`sem-${note.filename}-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => setActiveFilePath(note.filename)}
            >
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{formatTitle(note.filename)}</span>
                  <RelationBadge type={note.relationType} />
                  <SourceIcon keywordScore={note.keywordScore} cosineScore={note.cosineScore} llmScore={note.llmScore} />
                </div>
                {note.evidence && (
                  <div className="text-muted-foreground truncate mt-0.5">
                    {note.evidence.length > 60 ? note.evidence.slice(0, 60) + '...' : note.evidence}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {Math.round(note.score * 100)}%
              </span>
            </button>
          ))}

          {/* 退回到余弦相似度 */}
          {fallbackNotes.map((note, i) => (
            <button
              key={`cos-${note.filename}-${i}`}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => setActiveFilePath(note.filename)}
            >
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{formatTitle(note.filename)}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {Math.round(note.similarity * 100)}%
                  </span>
                </div>
                {note.preview && (
                  <div className="text-muted-foreground truncate mt-0.5">
                    {note.preview.length > 80 ? note.preview.slice(0, 80) + '...' : note.preview}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
