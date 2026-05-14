'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, Hash, Link2, Pencil, Sparkles, X, Brain, ExternalLink } from 'lucide-react'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { getTopicsForNote } from '@/db/note-topics'
import { getCrossValidatedRelations, type CrossValidatedRelation } from '@/lib/relation-engine'

interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  connections: number
  kind: string
  radius: number
  createdAt?: string
  modifiedAt?: string
}

interface GraphEdge {
  source: string
  target: string
  type: string
  weight: number
  relationType?: string
  evidence?: string
}

interface RelatedNodeInfo {
  node: GraphNode
  edge: GraphEdge
  isOutgoing: boolean
}

interface DetailPanelProps {
  node: GraphNode
  selectedNode: string
  relatedNodes: (RelatedNodeInfo | null)[]
  graphRef: React.MutableRefObject<any>
  settings: any
  zoom: number
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  palette: any
  onClose: () => void
  onSelectNode: (nodeId: string) => void
  onPan: (pan: { x: number; y: number }) => void
  onOpenNote: (path: string) => void
}

// 关系类型标签
const RELATION_COLORS: Record<string, string> = {
  extends: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  references: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  contradicts: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  supports: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  analogous: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  example_of: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  related: 'bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-400',
}

const RELATION_LABELS: Record<string, string> = {
  extends: '延伸',
  references: '引用',
  contradicts: '反驳',
  supports: '支撑',
  analogous: '类比',
  example_of: '示例',
  related: '相关',
}

export function DetailPanel({
  node,
  selectedNode,
  relatedNodes,
  graphRef,
  settings,
  zoom,
  canvasRef,
  palette,
  onClose,
  onSelectNode,
  onPan,
  onOpenNote,
}: DetailPanelProps) {
  const [preview, setPreview] = useState<string>('')
  const [keywords, setKeywords] = useState<Array<{ keyword: string; weight: number }>>([])
  const [semanticRelations, setSemanticRelations] = useState<CrossValidatedRelation[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  // 加载笔记预览和关键词
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingPreview(true)
      try {
        // 加载笔记内容预览
        const content = await readWorkspaceTextFile(selectedNode)
        if (cancelled) return
        if (content) {
          // 提取前几行作为摘要（跳过标题行）
          const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
          setPreview(lines.slice(0, 4).join('\n').slice(0, 300))
        } else {
          setPreview('')
        }

        // 加载关键词
        const topics = await getTopicsForNote(selectedNode)
        if (cancelled) return
        setKeywords(topics.slice(0, 12).map(t => ({ keyword: t.keyword, weight: t.weight })))

        // 加载语义关系
        const relations = await getCrossValidatedRelations(selectedNode, 0.3)
        if (cancelled) return
        setSemanticRelations(relations.slice(0, 6))
      } catch {
        if (!cancelled) {
          setPreview('')
          setKeywords([])
          setSemanticRelations([])
        }
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedNode])

  const handleRelatedNodeClick = useCallback((nodeId: string) => {
    onSelectNode(nodeId)
    const rnode = graphRef.current.nodeIndex.get(nodeId)
    if (rnode && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      onPan({
        x: rect.width / 2 - rnode.x * zoom,
        y: rect.height / 2 - rnode.y * zoom,
      })
    }
  }, [graphRef, canvasRef, zoom, onSelectNode, onPan])

  return (
    <div
      className="absolute right-0 top-0 z-[3] h-full w-80 border-l border-stone-200/70 bg-white/95 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-transform duration-200 ease-out animate-in slide-in-from-right dark:border-white/10 dark:bg-zinc-900/95 dark:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.4)]"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-stone-200/70 px-4 py-2.5 dark:border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-stone-100 dark:bg-zinc-800">
            <FileText className="h-3.5 w-3.5 text-stone-600 dark:text-zinc-300" />
          </div>
          <span className="text-[13px] font-semibold text-stone-900 dark:text-zinc-50">详情</span>
        </div>
        <button
          type="button"
          className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-[calc(100%-44px)] overflow-y-auto">
        {/* 笔记标题和元信息 */}
        <div className="border-b border-stone-100 px-4 py-3 dark:border-white/5">
          <div className="mb-1.5 text-[14px] font-semibold leading-tight text-stone-900 dark:text-zinc-50">{node.label}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-stone-100/80 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-zinc-800 dark:text-zinc-400">
              <Link2 className="h-2.5 w-2.5" />{node.connections}
            </span>
            {node.modifiedAt && (
              <span className="rounded-md bg-stone-100/80 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-zinc-800 dark:text-zinc-400">
                {new Date(node.modifiedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* 笔记摘要预览 */}
        <div className="border-b border-stone-100 px-4 py-3 dark:border-white/5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-zinc-300">
            <FileText className="h-3 w-3" />摘要
          </div>
          {loadingPreview ? (
            <div className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-zinc-800" />
          ) : preview ? (
            <div className="rounded-lg bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-600 dark:bg-zinc-800/50 dark:text-zinc-300">
              {preview}
            </div>
          ) : (
            <div className="text-[11px] text-stone-400 dark:text-zinc-500">无内容预览</div>
          )}
        </div>

        {/* 关键词标签云 */}
        {keywords.length > 0 && (
          <div className="border-b border-stone-100 px-4 py-3 dark:border-white/5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-zinc-300">
              <Hash className="h-3 w-3" />关键词
            </div>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((kw) => {
                // 根据权重调整大小和颜色深度
                const intensity = Math.min(1, kw.weight * 2)
                const fontSize = 10 + intensity * 2
                return (
                  <span
                    key={kw.keyword}
                    className="inline-block rounded-md border border-stone-200/70 bg-white px-1.5 py-0.5 transition hover:border-stone-400 hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-500"
                    style={{ fontSize: `${fontSize}px`, opacity: 0.6 + intensity * 0.4 }}
                    title={`权重: ${kw.weight.toFixed(3)}`}
                  >
                    {kw.keyword}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* 语义关联笔记 */}
        {semanticRelations.length > 0 && (
          <div className="border-b border-stone-100 px-4 py-3 dark:border-white/5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-zinc-300">
              <Brain className="h-3 w-3" />语义关联
            </div>
            <div className="space-y-1.5">
              {semanticRelations.map((rel, i) => {
                const relColor = RELATION_COLORS[rel.relation_type] || RELATION_COLORS.related
                const relLabel = RELATION_LABELS[rel.relation_type] || rel.relation_type
                const targetName = rel.target_note.split('/').pop()?.replace(/\.md$/, '') || rel.target_note
                return (
                  <button
                    key={`sem-${i}`}
                    type="button"
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-stone-50 dark:hover:bg-zinc-800/50"
                    onClick={() => handleRelatedNodeClick(rel.target_note)}
                  >
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-stone-700 dark:text-zinc-200">{targetName}</span>
                        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${relColor}`}>{relLabel}</span>
                      </div>
                      {rel.evidence && (
                        <div className="mt-0.5 truncate text-[10px] text-stone-400 dark:text-zinc-500">{rel.evidence}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums text-stone-400 dark:text-zinc-500">
                      {Math.round(rel.final_score * 100)}%
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Wikilink 关联节点 */}
        <div className="border-b border-stone-100 px-4 py-3 dark:border-white/5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-zinc-300">
            <Link2 className="h-3 w-3" />链接关系 ({relatedNodes.filter(Boolean).length})
          </div>
          {relatedNodes.length > 0 ? (
            <div className="space-y-1">
              {relatedNodes.slice(0, 10).map((rel) => {
                if (!rel) return null
                const { node: rnode, edge, isOutgoing } = rel
                const isBidirectional = graphRef.current.edges.some((e: GraphEdge) =>
                  (e.source === edge.target && e.target === edge.source) ||
                  (e.source === edge.source && e.target === edge.target && e !== edge)
                )
                const typeLabel = isBidirectional ? '双向' : isOutgoing ? '出链' : '入链'
                const typeColor = edge.type === 'semantic' ? 'text-blue-500' : edge.type === 'keyword' ? 'text-green-500' : 'text-stone-400'
                return (
                  <button
                    key={rnode.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition hover:bg-stone-50 dark:hover:bg-zinc-800/50"
                    onClick={() => handleRelatedNodeClick(rnode.id)}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: settings.colors[rnode.kind === 'current' ? 'current' : rnode.kind === 'hub' ? 'hub' : 'linked'] }}
                    />
                    <span className="flex-1 truncate text-stone-700 dark:text-zinc-200">{rnode.label}</span>
                    <span className={`shrink-0 text-[9px] ${typeColor}`}>{edge.type}</span>
                    <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] text-stone-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {typeLabel}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-stone-50 p-3 text-center text-[11px] text-stone-400 dark:bg-zinc-800/50 dark:text-zinc-500">
              无链接关系
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-stone-900 py-2 text-[11px] font-medium text-white transition hover:bg-stone-700 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            onClick={() => onOpenNote(selectedNode)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            打开并编辑
          </button>
        </div>
      </div>
    </div>
  )
}
