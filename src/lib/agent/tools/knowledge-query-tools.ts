import type { Tool, ToolResult } from '../types'
import type { KnowledgeQueryMode } from '@/lib/knowledge-query/types'
import type { UnifiedKnowledgeObjectType } from '@/lib/knowledge/objects'

const VALID_MODES = new Set<KnowledgeQueryMode>(['auto', 'search', 'current_note', 'evidence', 'graph', 'hybrid'])
const VALID_TYPES = new Set<UnifiedKnowledgeObjectType>([
  'note',
  'folder',
  'mark',
  'ai_hotspot',
  'chat',
  'pdf_annotation',
  'web_clip',
  'agent_run',
  'diagram',
  'memory',
])

function normalizeMode(value: unknown): KnowledgeQueryMode {
  const mode = String(value || 'auto').trim()
  return VALID_MODES.has(mode as KnowledgeQueryMode) ? mode as KnowledgeQueryMode : 'auto'
}

function normalizeTypes(value: unknown): UnifiedKnowledgeObjectType[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(',')
      : []
  const types = raw
    .map(item => String(item).trim())
    .filter((item): item is UnifiedKnowledgeObjectType => VALID_TYPES.has(item as UnifiedKnowledgeObjectType))
  return types.length ? Array.from(new Set(types)) : undefined
}

function compact(value?: string, maxLength = 160) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function formatObjectLine(object: { type: string; title: string; path?: string; sourceUrl?: string; summary?: string; score?: number; scoreReasons?: string[] }) {
  const location = object.path || object.sourceUrl || ''
  const score = typeof object.score === 'number' ? ` score=${object.score.toFixed(1)}` : ''
  const reasons = object.scoreReasons?.length ? ` via ${object.scoreReasons.join(', ')}` : ''
  const summary = object.summary ? ` - ${compact(object.summary, 120)}` : ''
  return `- [${object.type}] ${object.title}${location ? ` (${location})` : ''}${score}${reasons}${summary}`
}

export const queryKnowledgeTool: Tool = {
  name: 'query_knowledge',
  description:
    'Unified LingMo knowledge query entrypoint. Searches knowledge objects and can include current-note context, evidence blocks, and structured graph context. ' +
    'Use this first for knowledge base, note relationship, evidence, GraphRAG, previous work, memory, and related-material questions.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', required: true, description: 'Knowledge query, topic, question, or evidence need.' },
    { name: 'mode', type: 'string', required: false, description: 'auto, search, current_note, evidence, graph, or hybrid. Default auto.' },
    { name: 'filePath', type: 'string', required: false, description: 'Optional workspace-relative note path for current-note, evidence, or graph context.' },
    { name: 'sourceTypes', type: 'array', required: false, description: 'Optional object types: note, folder, mark, ai_hotspot, memory, agent_run, diagram.' },
    { name: 'limit', type: 'number', required: false, description: 'Max results per branch, default 10, max 40.' },
    { name: 'requireEvidence', type: 'boolean', required: false, description: 'When true, prioritize evidence blocks for the filePath.' },
    { name: 'includeGraph', type: 'boolean', required: false, description: 'When true, include structured graph nodes and edges for the filePath.' },
    { name: 'includeContentPreview', type: 'boolean', required: false, description: 'When true, allow bounded content previews in search/current-note branches.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const query = String(params.query || '').trim()
      if (!query) return { success: false, error: 'Missing query' }

      const { queryKnowledge } = await import('@/lib/knowledge-query/query-engine')
      const result = await queryKnowledge({
        query,
        mode: normalizeMode(params.mode),
        filePath: typeof params.filePath === 'string' ? params.filePath : undefined,
        sourceTypes: normalizeTypes(params.sourceTypes),
        limit: Number(params.limit) || undefined,
        requireEvidence: params.requireEvidence === true,
        includeGraph: params.includeGraph === true,
        includeContentPreview: params.includeContentPreview === true,
      })

      const objectLines = result.objects.slice(0, 10).map(formatObjectLine)
      const evidenceLines = result.evidence.slice(0, 8).map(item => {
        const heading = item.headingPath.length ? ` / ${item.headingPath.join(' / ')}` : ''
        return `- [${item.filePath}${heading} / ${item.id}] score=${item.score.toFixed(1)} ${compact(item.excerpt, 180)}`
      })
      const current = result.currentNoteContext?.filePath
        ? [
            `Current note: ${result.currentNoteContext.filePath}`,
            `- backlinks=${result.currentNoteContext.backlinks.length}; unlinkedMentions=${result.currentNoteContext.unlinkedMentions.length}; semanticRelations=${result.currentNoteContext.semanticRelations.length}; related=${result.currentNoteContext.relatedObjects.length}`,
          ].join('\n')
        : ''
      const graph = result.graph
        ? `Graph context: nodes=${result.graph.nodes.length}; edges=${result.graph.edges.length}`
        : ''
      const trace = result.trace.map(item => `- ${item.step}: ${item.status}${typeof item.count === 'number' ? ` (${item.count})` : ''}${item.detail ? ` - ${item.detail}` : ''}`)

      return {
        success: true,
        message: [
          result.summary,
          objectLines.length ? `Knowledge objects:\n${objectLines.join('\n')}` : 'Knowledge objects: none',
          evidenceLines.length ? `Evidence blocks:\n${evidenceLines.join('\n')}` : 'Evidence blocks: none',
          current,
          graph,
          result.warnings.length ? `Warnings:\n${result.warnings.slice(0, 5).map(item => `- ${item}`).join('\n')}` : '',
          `Trace:\n${trace.join('\n')}`,
        ].filter(Boolean).join('\n\n'),
        data: result,
      }
    } catch (error) {
      return { success: false, error: `query_knowledge failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const knowledgeQueryTools: Tool[] = [queryKnowledgeTool]
