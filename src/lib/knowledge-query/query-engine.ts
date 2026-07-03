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
  return `Knowledge query "${result.query}" (${result.mode}): ${parts.join('; ')}.`
}

export async function queryKnowledge(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult> {
  const query = String(input.query || '').trim()
  const mode = normalizeMode(input.mode)
  const limit = normalizeLimit(input.limit)
  const filePath = typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : undefined
  const warnings: string[] = []
  const trace: KnowledgeQueryTrace[] = []
  const objects: KnowledgeQueryResult['objects'] = []
  let currentNoteContext: KnowledgeQueryResult['currentNoteContext']
  let evidence: KnowledgeQueryEvidence[] = []
  let graph: KnowledgeQueryResult['graph']

  if (!query) {
    return {
      query,
      mode,
      summary: 'Knowledge query skipped: missing query.',
      objects: [],
      evidence: [],
      warnings: ['Missing query.'],
      trace: [{ step: 'validate_query', status: 'failed', detail: 'Missing query' }],
    }
  }

  if (shouldRunSearch(mode)) {
    try {
      const search = await searchKnowledgeObjects(query, {
        includeTypes: input.sourceTypes,
        includeContentPreview: input.includeContentPreview === true,
        limit,
      })
      objects.push(...search.results)
      warnings.push(...search.warnings)
      trace.push({ step: 'search_knowledge_objects', status: 'success', count: search.results.length })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      warnings.push(`Knowledge object search failed: ${detail}`)
      trace.push({ step: 'search_knowledge_objects', status: 'failed', detail })
    }
  } else {
    trace.push({ step: 'search_knowledge_objects', status: 'skipped', detail: `mode=${mode}` })
  }

  if (shouldRunCurrentNote(mode, filePath)) {
    try {
      currentNoteContext = await getCurrentNoteKnowledgeContext(filePath, {
        maxRelated: Math.min(limit, 12),
        includeContentPreview: input.includeContentPreview === true,
      })
      warnings.push(...currentNoteContext.warnings)
      trace.push({
        step: 'get_current_note_context',
        status: currentNoteContext.filePath ? 'success' : 'skipped',
        detail: currentNoteContext.filePath || 'No current note/filePath available',
        count: currentNoteContext.relatedObjects.length,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      warnings.push(`Current note context failed: ${detail}`)
      trace.push({ step: 'get_current_note_context', status: 'failed', detail })
    }
  } else {
    trace.push({ step: 'get_current_note_context', status: 'skipped', detail: filePath ? `mode=${mode}` : 'No filePath provided' })
  }

  if (shouldRunEvidence(mode, input.requireEvidence)) {
    if (!filePath) {
      warnings.push('Evidence search skipped: no filePath provided.')
      trace.push({ step: 'find_evidence_blocks', status: 'skipped', detail: 'No filePath provided' })
    } else {
      try {
        const results = await findEvidenceBlocks({ filePath, query, limit: Math.min(limit, 12) })
        evidence = results.map(toEvidence)
        trace.push({ step: 'find_evidence_blocks', status: 'success', count: evidence.length })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        warnings.push(`Evidence search failed: ${detail}`)
        trace.push({ step: 'find_evidence_blocks', status: 'failed', detail })
      }
    }
  } else {
    trace.push({ step: 'find_evidence_blocks', status: 'skipped', detail: `mode=${mode}; requireEvidence=${input.requireEvidence === true}` })
  }

  if (shouldRunGraph(mode, input.includeGraph)) {
    if (!filePath) {
      warnings.push('Graph context skipped: no filePath provided.')
      trace.push({ step: 'get_structured_graph', status: 'skipped', detail: 'No filePath provided' })
    } else {
      try {
        graph = await getStructuredGraphForFile(filePath, { includeHeadings: true, minConfidence: 0.7 })
        trace.push({ step: 'get_structured_graph', status: 'success', count: graph.nodes.length + graph.edges.length })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        warnings.push(`Graph context failed: ${detail}`)
        trace.push({ step: 'get_structured_graph', status: 'failed', detail })
      }
    }
  } else {
    trace.push({ step: 'get_structured_graph', status: 'skipped', detail: `mode=${mode}; includeGraph=${input.includeGraph === true}` })
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
  }

  return {
    ...partial,
    summary: buildSummary(partial),
  }
}
