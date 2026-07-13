import type { UnifiedKnowledgeObject, UnifiedKnowledgeObjectType, CurrentNoteKnowledgeContext } from '@/lib/knowledge/objects'
import type { EvidenceBlockResult, StructuredGraphEdge, StructuredGraphNode } from '@/lib/structured-knowledge/types'

export type KnowledgeQueryMode = 'auto' | 'search' | 'current_note' | 'evidence' | 'graph' | 'hybrid'

export interface KnowledgeQueryInput {
  query: string
  mode?: KnowledgeQueryMode
  filePath?: string
  sourceTypes?: UnifiedKnowledgeObjectType[]
  limit?: number
  requireEvidence?: boolean
  includeGraph?: boolean
  includeContentPreview?: boolean
  timeoutMs?: number
}

export interface KnowledgeQueryTrace {
  step: string
  status: 'success' | 'skipped' | 'failed' | 'timed_out'
  detail?: string
  count?: number
  durationMs?: number
}

export interface KnowledgeQueryStats {
  startedAt: number
  completedAt: number
  totalDurationMs: number
  branchDurations: Record<string, number>
  timeoutMs?: number
  timedOutBranches: string[]
}

export interface KnowledgeQueryEvidence {
  id: string
  filePath: string
  title: string
  headingPath: string[]
  text: string
  excerpt: string
  score: number
  blockOrder: number
  lineStart?: number
  lineEnd?: number
}

export interface KnowledgeQueryGraph {
  nodes: StructuredGraphNode[]
  edges: StructuredGraphEdge[]
}

export interface KnowledgeQueryResult {
  query: string
  mode: KnowledgeQueryMode
  summary: string
  objects: UnifiedKnowledgeObject[]
  currentNoteContext?: CurrentNoteKnowledgeContext
  evidence: KnowledgeQueryEvidence[]
  graph?: KnowledgeQueryGraph
  warnings: string[]
  trace: KnowledgeQueryTrace[]
  stats: KnowledgeQueryStats
}

export type KnowledgeQueryEvidenceSource = EvidenceBlockResult
