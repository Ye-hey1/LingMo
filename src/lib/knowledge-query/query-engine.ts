import { searchKnowledgeObjects, getCurrentNoteKnowledgeContext } from '@/lib/knowledge/objects'
import { findEvidenceBlocks } from '@/lib/structured-knowledge/evidence'
import { getStructuredGraphForFile } from '@/lib/structured-knowledge/graph-adapter'
import type {
  KnowledgeQueryEvidence,
  KnowledgeQueryInput,
  KnowledgeQueryMode,
  KnowledgeQueryResult,
  KnowledgeQueryTrace,
} from './types'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 40
const DEFAULT_TIMEOUT_MS = 8000
const MIN_TIMEOUT_MS = 500
const MAX_TIMEOUT_MS = 60000

function normalizeMode(value: unknown): KnowledgeQueryMode {
  return ['auto', 'search', 'current_note', 'evidence', 'graph', 'hybrid'].includes(String(value))
    ? String(value) as KnowledgeQueryMode
    : 'auto'
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)))
}

function normalizeTimeoutMs(value: unknown) {
  if (value === 0 || value === '0') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS
  if (parsed <= 0) return undefined
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(parsed)))
}

function compact(value: string, maxLength = 180) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function shouldRunSearch(mode: KnowledgeQueryMode) {
  return mode === 'auto' || mode === 'search' || mode === 'hybrid'
}

function shouldRunCurrentNote(mode: KnowledgeQueryMode, filePath?: string) {
  return mode === 'current_note' || mode === 'hybrid' || (mode === 'auto' && Boolean(filePath))
}

function shouldRunEvidence(mode: KnowledgeQueryMode, requireEvidence?: boolean) {
  return mode === 'evidence' || mode === 'hybrid' || (mode === 'auto' && requireEvidence === true)
}

function shouldRunGraph(mode: KnowledgeQueryMode, includeGraph?: boolean) {
  return mode === 'graph' || mode === 'hybrid' || includeGraph === true
}

function traceDuration(startedAt: number) {
  return Math.max(0, Date.now() - startedAt)
}

interface KnowledgeQueryBranchResult {
  trace: KnowledgeQueryTrace
  warnings?: string[]
  objects?: KnowledgeQueryResult['objects']
  currentNoteContext?: KnowledgeQueryResult['currentNoteContext']
  evidence?: KnowledgeQueryEvidence[]
  graph?: KnowledgeQueryResult['graph']
}

function skippedBranch(step: string, detail: string): KnowledgeQueryBranchResult {
  return {
    trace: {
      step,
      status: 'skipped',
      detail,
      durationMs: 0,
    },
  }
}

function timedOutBranch(step: string, timeoutMs: number): KnowledgeQueryBranchResult {
  return {
    warnings: [`${step} timed out after ${timeoutMs}ms; returned partial knowledge query results.`],
    trace: {
      step,
      status: 'timed_out',
      detail: `Timed out after ${timeoutMs}ms`,
      durationMs: timeoutMs,
    },
  }
}

async function withBranchTimeout(
  step: string,
  promise: Promise<KnowledgeQueryBranchResult>,
  timeoutMs?: number,
): Promise<KnowledgeQueryBranchResult> {
  if (!timeoutMs) return await promise

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<KnowledgeQueryBranchResult>(resolve => {
    timer = setTimeout(() => resolve(timedOutBranch(step, timeoutMs)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toEvidence(result: import('./types').KnowledgeQueryEvidenceSource): KnowledgeQueryEvidence {
  return {
    id: result.block.id,
    filePath: result.document.filePath,
    title: result.document.title,
    headingPath: result.block.headingPath,
    text: result.block.text || result.block.markdown,
    excerpt: result.excerpt,
    score: result.score,
    blockOrder: result.block.order,
    lineStart: result.block.lineStart,
    lineEnd: result.block.lineEnd,
  }
}

function buildSummary(result: Omit<KnowledgeQueryResult, 'summary'>) {
  const parts = [
    `${result.objects.length} object(s)`,
    `${result.evidence.length} evidence block(s)`,
  ]
  if (result.currentNoteContext?.filePath) {
    parts.push(`current note: ${result.currentNoteContext.filePath}`)
  }
  if (result.graph) {
    parts.push(`graph: ${result.graph.nodes.length} node(s), ${result.graph.edges.length} edge(s)`)
  }
  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning(s)`)
  }
  if (result.stats.timedOutBranches.length > 0) {
    parts.push(`${result.stats.timedOutBranches.length} timed out`)
  }
  parts.push(`${result.stats.totalDurationMs}ms`)
  return `Knowledge query "${result.query}" (${result.mode}): ${parts.join('; ')}.`
}

async function runSearchBranch(
  input: KnowledgeQueryInput,
  query: string,
  limit: number,
): Promise<KnowledgeQueryBranchResult> {
  const stepStartedAt = Date.now()
  try {
    const search = await searchKnowledgeObjects(query, {
      includeTypes: input.sourceTypes,
      includeContentPreview: input.includeContentPreview === true,
      limit,
    })
    return {
      objects: search.results,
      warnings: search.warnings,
      trace: {
        step: 'search_knowledge_objects',
        status: 'success',
        count: search.results.length,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      warnings: [`Knowledge object search failed: ${detail}`],
      trace: {
        step: 'search_knowledge_objects',
        status: 'failed',
        detail,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  }
}

async function runCurrentNoteBranch(
  input: KnowledgeQueryInput,
  filePath: string | undefined,
  limit: number,
): Promise<KnowledgeQueryBranchResult> {
  const stepStartedAt = Date.now()
  try {
    const currentNoteContext = await getCurrentNoteKnowledgeContext(filePath, {
      maxRelated: Math.min(limit, 12),
      includeContentPreview: input.includeContentPreview === true,
    })
    return {
      currentNoteContext,
      warnings: currentNoteContext.warnings,
      trace: {
        step: 'get_current_note_context',
        status: currentNoteContext.filePath ? 'success' : 'skipped',
        detail: currentNoteContext.filePath || 'No current note/filePath available',
        count: currentNoteContext.relatedObjects.length,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      warnings: [`Current note context failed: ${detail}`],
      trace: {
        step: 'get_current_note_context',
        status: 'failed',
        detail,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  }
}

async function runEvidenceBranch(
  query: string,
  filePath: string,
  limit: number,
): Promise<KnowledgeQueryBranchResult> {
  const stepStartedAt = Date.now()
  try {
    const results = await findEvidenceBlocks({ filePath, query, limit: Math.min(limit, 12) })
    const evidence = results.map(toEvidence)
    return {
      evidence,
      trace: {
        step: 'find_evidence_blocks',
        status: 'success',
        count: evidence.length,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      warnings: [`Evidence search failed: ${detail}`],
      trace: {
        step: 'find_evidence_blocks',
        status: 'failed',
        detail,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  }
}

async function runGraphBranch(filePath: string): Promise<KnowledgeQueryBranchResult> {
  const stepStartedAt = Date.now()
  try {
    const graph = await getStructuredGraphForFile(filePath, { includeHeadings: true, minConfidence: 0.7 })
    return {
      graph,
      trace: {
        step: 'get_structured_graph',
        status: 'success',
        count: graph.nodes.length + graph.edges.length,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      warnings: [`Graph context failed: ${detail}`],
      trace: {
        step: 'get_structured_graph',
        status: 'failed',
        detail,
        durationMs: traceDuration(stepStartedAt),
      },
    }
  }
}

export async function queryKnowledge(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult> {
  const startedAt = Date.now()
  const query = String(input.query || '').trim()
  const mode = normalizeMode(input.mode)
  const limit = normalizeLimit(input.limit)
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs)
  const filePath = typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : undefined
  const warnings: string[] = []
  const trace: KnowledgeQueryTrace[] = []
  const objects: KnowledgeQueryResult['objects'] = []
  let currentNoteContext: KnowledgeQueryResult['currentNoteContext']
  let evidence: KnowledgeQueryEvidence[] = []
  let graph: KnowledgeQueryResult['graph']
  const branchPromises: Array<Promise<KnowledgeQueryBranchResult>> = []

  if (!query) {
    return {
      query,
      mode,
      summary: 'Knowledge query skipped: missing query.',
      objects: [],
      evidence: [],
      warnings: ['Missing query.'],
      trace: [{ step: 'validate_query', status: 'failed', detail: 'Missing query', durationMs: 0 }],
      stats: {
        startedAt,
        completedAt: Date.now(),
        totalDurationMs: traceDuration(startedAt),
        branchDurations: { validate_query: 0 },
        timeoutMs,
        timedOutBranches: [],
      },
    }
  }

  if (shouldRunSearch(mode)) {
    branchPromises.push(withBranchTimeout('search_knowledge_objects', runSearchBranch(input, query, limit), timeoutMs))
  } else {
    branchPromises.push(Promise.resolve(skippedBranch('search_knowledge_objects', `mode=${mode}`)))
  }

  if (shouldRunCurrentNote(mode, filePath)) {
    branchPromises.push(withBranchTimeout('get_current_note_context', runCurrentNoteBranch(input, filePath, limit), timeoutMs))
  } else {
    branchPromises.push(Promise.resolve(skippedBranch('get_current_note_context', filePath ? `mode=${mode}` : 'No filePath provided')))
  }

  if (shouldRunEvidence(mode, input.requireEvidence)) {
    if (!filePath) {
      branchPromises.push(Promise.resolve({
        ...skippedBranch('find_evidence_blocks', 'No filePath provided'),
        warnings: ['Evidence search skipped: no filePath provided.'],
      }))
    } else {
      branchPromises.push(withBranchTimeout('find_evidence_blocks', runEvidenceBranch(query, filePath, limit), timeoutMs))
    }
  } else {
    branchPromises.push(Promise.resolve(skippedBranch('find_evidence_blocks', `mode=${mode}; requireEvidence=${input.requireEvidence === true}`)))
  }

  if (shouldRunGraph(mode, input.includeGraph)) {
    if (!filePath) {
      branchPromises.push(Promise.resolve({
        ...skippedBranch('get_structured_graph', 'No filePath provided'),
        warnings: ['Graph context skipped: no filePath provided.'],
      }))
    } else {
      branchPromises.push(withBranchTimeout('get_structured_graph', runGraphBranch(filePath), timeoutMs))
    }
  } else {
    branchPromises.push(Promise.resolve(skippedBranch('get_structured_graph', `mode=${mode}; includeGraph=${input.includeGraph === true}`)))
  }

  const branchResults = await Promise.all(branchPromises)
  for (const result of branchResults) {
    trace.push(result.trace)
    if (result.warnings) warnings.push(...result.warnings)
    if (result.objects) objects.push(...result.objects)
    if (result.currentNoteContext) currentNoteContext = result.currentNoteContext
    if (result.evidence) evidence = result.evidence
    if (result.graph) graph = result.graph
  }

  const completedAt = Date.now()
  const stats = {
    startedAt,
    completedAt,
    totalDurationMs: completedAt - startedAt,
    branchDurations: trace.reduce<Record<string, number>>((acc, item) => {
      acc[item.step] = item.durationMs ?? 0
      return acc
    }, {}),
    timeoutMs,
    timedOutBranches: trace
      .filter(item => item.status === 'timed_out')
      .map(item => item.step),
  }

  const partial = {
    query,
    mode,
    objects,
    currentNoteContext,
    evidence,
    graph,
    warnings: Array.from(new Set(warnings.map(item => compact(item, 260)))),
    trace,
    stats,
  }

  return {
    ...partial,
    summary: buildSummary(partial),
  }
}
