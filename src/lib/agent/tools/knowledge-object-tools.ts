import type { Tool, ToolResult } from '../types'
import type { KnowledgeObjectStatus } from '@/db/knowledge-objects'
import type { UnifiedKnowledgeObjectType } from '@/lib/knowledge/objects'

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

const VALID_STATUSES = new Set<KnowledgeObjectStatus>(['inbox', 'active', 'archived', 'deleted'])

function compactText(value?: string, maxLength = 180) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
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
  return types.length > 0 ? Array.from(new Set(types)) : undefined
}

function normalizeStatus(value: unknown): KnowledgeObjectStatus | KnowledgeObjectStatus[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(',')
      : []
  const statuses = raw
    .map(item => String(item).trim())
    .filter((item): item is KnowledgeObjectStatus => VALID_STATUSES.has(item as KnowledgeObjectStatus))
  if (statuses.length === 0) return undefined
  return statuses.length === 1 ? statuses[0] : Array.from(new Set(statuses))
}

function formatObjectLine(object: {
  type: string
  title: string
  path?: string
  sourceUrl?: string
  summary?: string
  score?: number
  scoreReasons?: string[]
}) {
  const location = object.path || object.sourceUrl || ''
  const score = typeof object.score === 'number' ? ` score=${object.score.toFixed(1)}` : ''
  const reasons = object.scoreReasons?.length ? ` via ${object.scoreReasons.join(', ')}` : ''
  const summary = object.summary ? ` - ${compactText(object.summary, 140)}` : ''
  return `- [${object.type}] ${object.title}${location ? ` (${location})` : ''}${score}${reasons}${summary}`
}

export const searchKnowledgeObjectsTool: Tool = {
  name: 'search_knowledge_objects',
  description:
    'Search LingMo unified knowledge objects across notes, folders, marks, AI hotspots, memories, diagrams, and Agent run history. ' +
    'Use this before broad file/RAG searches when the user asks about the knowledge base, current notes, previous work, saved hotspots, memories, or file organization.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', required: true, description: 'Search query or topic.' },
    { name: 'types', type: 'array', required: false, description: 'Optional object types: note, folder, mark, ai_hotspot, memory, agent_run, diagram.' },
    { name: 'status', type: 'string', required: false, description: 'Optional status filter: inbox, active, archived, deleted. Comma-separated values are allowed.' },
    { name: 'pathPrefix', type: 'string', required: false, description: 'Optional folder/path prefix for note/folder/diagram objects.' },
    { name: 'limit', type: 'number', required: false, description: 'Max results, default 12, max 80.' },
    { name: 'includeContentPreview', type: 'boolean', required: false, description: 'When true, read a bounded preview for note content. Use only when the title/path metadata is insufficient.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const query = typeof params.query === 'string' ? params.query.trim() : ''
      if (!query) {
        return { success: false, error: 'Missing query' }
      }

      const { searchKnowledgeObjects } = await import('@/lib/knowledge/objects')
      const result = await searchKnowledgeObjects(query, {
        includeTypes: normalizeTypes(params.types),
        status: normalizeStatus(params.status),
        pathPrefix: typeof params.pathPrefix === 'string' ? params.pathPrefix : undefined,
        includeContentPreview: params.includeContentPreview === true,
        limit: Number(params.limit) || 12,
      })

      const message = result.results.length > 0
        ? [
            `Found ${result.results.length} knowledge object(s) for "${query}":`,
            ...result.results.map(formatObjectLine),
            result.warnings.length > 0 ? `Warnings: ${result.warnings.slice(0, 3).join('; ')}` : '',
          ].filter(Boolean).join('\n')
        : [
            `No knowledge objects matched "${query}".`,
            result.warnings.length > 0 ? `Warnings: ${result.warnings.slice(0, 3).join('; ')}` : '',
          ].filter(Boolean).join('\n')

      return {
        success: true,
        message,
        data: {
          query,
          results: result.results,
          warnings: result.warnings,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `Search knowledge objects failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const getKnowledgeObjectOverviewTool: Tool = {
  name: 'get_knowledge_object_overview',
  description:
    'Get an overview of LingMo unified knowledge objects: counts by type/status, recent objects, and top tags. ' +
    'Use this to understand the knowledge system before planning organization or cleanup.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'types', type: 'array', required: false, description: 'Optional object types to include.' },
    { name: 'limit', type: 'number', required: false, description: 'Max objects to inspect, default 500.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { getKnowledgeObjectOverview } = await import('@/lib/knowledge/objects')
      const overview = await getKnowledgeObjectOverview({
        includeTypes: normalizeTypes(params.types),
        limit: Number(params.limit) || 500,
      })

      const typeLines = Object.entries(overview.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `- ${type}: ${count}`)
      const statusLines = Object.entries(overview.byStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => `- ${status}: ${count}`)
      const recentLines = overview.recent.slice(0, 8).map(formatObjectLine)
      const tagLines = overview.topTags.slice(0, 10).map(item => `- ${item.tag}: ${item.count}`)

      return {
        success: true,
        message: [
          `Knowledge object overview: ${overview.total} object(s)`,
          'By type:',
          typeLines.join('\n') || '- none',
          'By status:',
          statusLines.join('\n') || '- none',
          'Top tags:',
          tagLines.join('\n') || '- none',
          'Recent:',
          recentLines.join('\n') || '- none',
          overview.warnings.length > 0 ? `Warnings: ${overview.warnings.slice(0, 3).join('; ')}` : '',
        ].filter(Boolean).join('\n'),
        data: overview,
      }
    } catch (error) {
      return {
        success: false,
        error: `Get knowledge object overview failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const getCurrentNoteContextTool: Tool = {
  name: 'get_current_note_context',
  description:
    'Get the current note knowledge context: active note preview, headings, wiki links, backlinks, unlinked mentions, semantic relations, and related knowledge objects. ' +
    'Use this first for questions about the current note, related notes, link suggestions, or knowledge graph context.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: false, description: 'Optional workspace-relative note path. Defaults to the active editor note.' },
    { name: 'maxRelated', type: 'number', required: false, description: 'Max related objects, default 8.' },
    { name: 'includeContentPreview', type: 'boolean', required: false, description: 'When true, allow bounded note preview reads for related search.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { getCurrentNoteKnowledgeContext } = await import('@/lib/knowledge/objects')
      const context = await getCurrentNoteKnowledgeContext(
        typeof params.filePath === 'string' ? params.filePath : undefined,
        {
          maxRelated: Number(params.maxRelated) || undefined,
          includeContentPreview: params.includeContentPreview === true,
        },
      )

      if (!context.filePath) {
        return {
          success: false,
          error: 'No current note is open and no filePath was provided.',
          data: context,
        }
      }

      return {
        success: true,
        message: context.contextText,
        data: context,
      }
    } catch (error) {
      return {
        success: false,
        error: `Get current note context failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const knowledgeObjectTools: Tool[] = [
  searchKnowledgeObjectsTool,
  getKnowledgeObjectOverviewTool,
  getCurrentNoteContextTool,
]
