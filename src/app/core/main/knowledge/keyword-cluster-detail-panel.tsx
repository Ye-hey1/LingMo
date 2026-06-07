'use client'

import { FileText, Hash, Network, X } from 'lucide-react'
import {
  getClusterDetail,
  getKeywordDetail,
  getNotesForCluster,
  getNotesForKeyword,
  type KeywordClusterGraph,
  type KeywordClusterNoteRef,
  type KeywordClusterSelection,
} from './keyword-cluster-data'

interface KeywordClusterDetailPanelProps {
  graph: KeywordClusterGraph
  selection: KeywordClusterSelection | null
  onClose: () => void
  onOpenNote: (path: string) => void
  onLocateInRelationGraph: (path: string) => void
}

export function KeywordClusterDetailPanel({
  graph,
  selection,
  onClose,
  onOpenNote,
  onLocateInRelationGraph,
}: KeywordClusterDetailPanelProps) {
  if (!selection) return null

  const cluster = selection.type === 'cluster' ? getClusterDetail(graph, selection.id) : null
  const keyword = selection.type === 'keyword' ? getKeywordDetail(graph, selection.id) : null
  const clusterNotes = cluster ? getNotesForCluster(graph, cluster.id) : []
  const keywordNotes = keyword ? getNotesForKeyword(graph, keyword.id) : []

  return (
    <div className="absolute right-0 top-0 z-[3] h-full w-80 border-l border-border/70 bg-background/95 shadow-sm backdrop-blur-sm transition-transform duration-200 ease-out animate-in slide-in-from-right dark:border-border/50 dark:bg-background/95">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5 dark:border-border/50">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted dark:bg-muted">
            {selection.type === 'cluster' ? (
              <Network className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" />
            ) : (
              <Hash className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" />
            )}
          </div>
          <span className="truncate text-[13px] font-semibold text-foreground">关键词聚类</span>
        </div>
        <button
          type="button"
          className="rounded-full p-1.5 text-muted-foreground/60 transition hover:bg-muted hover:text-foreground dark:hover:bg-muted"
          onClick={onClose}
          title="关闭详情"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-[calc(100%-44px)] overflow-y-auto">
        {cluster ? (
          <ClusterDetail
            graph={graph}
            clusterId={cluster.id}
            notes={clusterNotes}
            onOpenNote={onOpenNote}
            onLocateInRelationGraph={onLocateInRelationGraph}
          />
        ) : null}
        {keyword ? (
          <KeywordDetail
            graph={graph}
            keywordId={keyword.id}
            notes={keywordNotes}
            onOpenNote={onOpenNote}
            onLocateInRelationGraph={onLocateInRelationGraph}
          />
        ) : null}
        {!cluster && !keyword ? (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            当前选择已不在关键词图谱中。
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ClusterDetail({
  graph,
  clusterId,
  notes,
  onOpenNote,
  onLocateInRelationGraph,
}: {
  graph: KeywordClusterGraph
  clusterId: string
  notes: KeywordClusterNoteRef[]
  onOpenNote: (path: string) => void
  onLocateInRelationGraph: (path: string) => void
}) {
  const cluster = getClusterDetail(graph, clusterId)
  if (!cluster) return null
  const keywords = graph.keywordNodes
    .filter(keyword => keyword.clusterId === cluster.id)
    .sort((a, b) => b.noteCount - a.noteCount || b.totalWeight - a.totalWeight || a.keyword.localeCompare(b.keyword))

  return (
    <>
      <div className="border-b border-border/50 px-4 py-3 dark:border-border/30">
        <div className="flex items-start gap-2">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cluster.color }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-tight text-foreground">{cluster.label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Metric label={`${cluster.noteCount} 篇文章`} />
              <Metric label={`${cluster.keywords.length} 个关键词`} />
              <Metric label={`权重 ${cluster.totalWeight.toFixed(1)}`} />
            </div>
          </div>
        </div>
      </div>

      <Section icon={Hash} title="关键词排名">
        <div className="flex flex-wrap gap-1.5">
          {keywords.slice(0, 18).map(keyword => (
            <span
              key={keyword.id}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[10px] text-foreground/80 dark:border-border/60 dark:bg-muted"
              title={`${keyword.noteCount} 篇，权重 ${keyword.totalWeight.toFixed(3)}`}
            >
              <span className="max-w-[8rem] truncate">{keyword.keyword}</span>
              <span className="text-muted-foreground">{keyword.noteCount}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section icon={FileText} title={`相关文章 (${notes.length})`}>
        <NoteList
          notes={notes}
          onOpenNote={onOpenNote}
          onLocateInRelationGraph={onLocateInRelationGraph}
        />
      </Section>
    </>
  )
}

function KeywordDetail({
  graph,
  keywordId,
  notes,
  onOpenNote,
  onLocateInRelationGraph,
}: {
  graph: KeywordClusterGraph
  keywordId: string
  notes: KeywordClusterNoteRef[]
  onOpenNote: (path: string) => void
  onLocateInRelationGraph: (path: string) => void
}) {
  const keyword = getKeywordDetail(graph, keywordId)
  if (!keyword) return null
  const cooccurring = graph.edges
    .filter(edge => edge.type === 'keyword-cooccurrence' && (edge.source === keyword.id || edge.target === keyword.id))
    .map(edge => {
      const otherId = edge.source === keyword.id ? edge.target : edge.source
      const other = graph.keywordNodes.find(node => node.id === otherId)
      return other ? { keyword: other, weight: edge.weight } : null
    })
    .filter((item): item is { keyword: NonNullable<typeof item>['keyword']; weight: number } => Boolean(item))
    .sort((a, b) => b.weight - a.weight || a.keyword.keyword.localeCompare(b.keyword.keyword))

  return (
    <>
      <div className="border-b border-border/50 px-4 py-3 dark:border-border/30">
        <div className="mb-1.5 text-[14px] font-semibold leading-tight text-foreground">{keyword.keyword}</div>
        <div className="flex flex-wrap gap-1.5">
          <Metric label={`${keyword.noteCount} 篇文章`} />
          <Metric label={`总权重 ${keyword.totalWeight.toFixed(2)}`} />
          <Metric label={`均值 ${keyword.avgWeight.toFixed(2)}`} />
        </div>
      </div>

      {cooccurring.length > 0 ? (
        <Section icon={Network} title="共现关键词">
          <div className="flex flex-wrap gap-1.5">
            {cooccurring.slice(0, 16).map(item => (
              <span
                key={item.keyword.id}
                className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] text-foreground/80 dark:bg-muted"
                title={`共现权重 ${item.weight.toFixed(3)}`}
              >
                <span className="max-w-[8rem] truncate">{item.keyword.keyword}</span>
                <span className="text-muted-foreground">{item.weight.toFixed(1)}</span>
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <Section icon={FileText} title={`包含文章 (${notes.length})`}>
        <NoteList
          notes={notes}
          onOpenNote={onOpenNote}
          onLocateInRelationGraph={onLocateInRelationGraph}
        />
      </Section>
    </>
  )
}

function Section({ icon: Icon, title, children }: {
  icon: typeof Hash
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-border/50 px-4 py-3 dark:border-border/30">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground dark:text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  )
}

function NoteList({
  notes,
  onOpenNote,
  onLocateInRelationGraph,
}: {
  notes: KeywordClusterNoteRef[]
  onOpenNote: (path: string) => void
  onLocateInRelationGraph: (path: string) => void
}) {
  if (notes.length === 0) {
    return (
      <div className="rounded-lg bg-muted/30 p-3 text-center text-[11px] text-muted-foreground/70 dark:bg-muted/50">
        暂无可追溯文章
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {notes.slice(0, 24).map(note => (
        <div
          key={note.path}
          className="rounded-lg border border-border/50 bg-background/60 p-2 dark:border-border/40 dark:bg-muted/20"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => onOpenNote(note.path)}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/85">{note.label}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{note.score.toFixed(1)}</span>
          </button>
          {note.keywords.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {note.keywords.slice(0, 5).map(item => (
                <span
                  key={`${note.path}-${item.keyword}`}
                  className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground dark:bg-muted"
                >
                  {item.keyword}
                </span>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground transition hover:text-foreground"
            onClick={() => onLocateInRelationGraph(note.path)}
          >
            <Network className="h-3 w-3" />
            定位到关系图谱
          </button>
        </div>
      ))}
    </div>
  )
}

function Metric({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-muted-foreground">
      {label}
    </span>
  )
}
