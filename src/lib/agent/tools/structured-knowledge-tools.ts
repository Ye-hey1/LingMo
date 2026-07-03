import type { Tool, ToolResult } from '../types'

function compact(value: string, maxLength = 240) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

export const getStructuredNoteTool: Tool = {
  name: 'get_structured_note',
  description: 'Get structured Markdown note context: outline, blocks, wikilinks, tags, entities, and relations. Use for precise evidence-aware note understanding.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'includeBlocks', type: 'boolean', required: false, description: 'Include bounded structured blocks.' },
    { name: 'includeEntities', type: 'boolean', required: false, description: 'Include extracted entities.' },
    { name: 'includeRelations', type: 'boolean', required: false, description: 'Include extracted semantic relations.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { getStructuredDocumentBundleByPath } = await import('@/db/structured-knowledge')
      const bundle = await getStructuredDocumentBundleByPath(filePath)
      if (!bundle) return { success: false, error: `No structured note found for ${filePath}. Run rebuild_structured_knowledge first.` }
      const outline = bundle.document.headings.map(h => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`).join('\n')
      const blockLines = params.includeBlocks === true
        ? bundle.blocks.slice(0, 20).map(block => `- ${block.id} [${block.headingPath.join(' / ') || 'root'}] ${compact(block.text, 180)}`)
        : []
      const entityLines = params.includeEntities === true
        ? bundle.entities.slice(0, 30).map(entity => `- ${entity.name} (${entity.type}, confidence=${entity.confidence.toFixed(2)})`)
        : []
      const relationLines = params.includeRelations === true
        ? bundle.relations.slice(0, 30).map(relation => `- ${relation.sourceEntityId} ${relation.relationType} ${relation.targetEntityId} confidence=${relation.confidence.toFixed(2)}`)
        : []
      return {
        success: true,
        message: [
          `Structured note: ${bundle.document.title} (${bundle.document.filePath})`,
          `Blocks: ${bundle.blocks.length}; Headings: ${bundle.document.headings.length}; Entities: ${bundle.entities.length}; Relations: ${bundle.relations.length}`,
          outline ? `Outline:\n${outline}` : 'Outline: none',
          blockLines.length ? `Blocks:\n${blockLines.join('\n')}` : '',
          entityLines.length ? `Entities:\n${entityLines.join('\n')}` : '',
          relationLines.length ? `Relations:\n${relationLines.join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        data: bundle,
      }
    } catch (error) {
      return { success: false, error: `get_structured_note failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const rebuildStructuredKnowledgeTool: Tool = {
  name: 'rebuild_structured_knowledge',
  description: 'Rebuild local structured Markdown index for a file. This is deterministic and does not call an LLM.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'content', type: 'string', required: true, description: 'Markdown content to structure. Agent should read the file first.' },
    { name: 'force', type: 'boolean', required: false, description: 'Force rebuild even when content hash is unchanged.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      const content = String(params.content || '')
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { syncStructuredMarkdownContent } = await import('@/lib/structured-knowledge/sync')
      const result = await syncStructuredMarkdownContent({ filePath, content, force: params.force === true })
      return { success: true, message: `Structured ${filePath}: blocks=${result.blockCount}, headings=${result.headingCount}, entities=${result.entityCount}, skipped=${result.skipped}`, data: result }
    } catch (error) {
      return { success: false, error: `rebuild_structured_knowledge failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const findEvidenceBlocksTool: Tool = {
  name: 'find_evidence_blocks',
  description: 'Find structured Markdown evidence blocks by query inside a structured note.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'query', type: 'string', required: true, description: 'Evidence query.' },
    { name: 'limit', type: 'number', required: false, description: 'Maximum evidence blocks, default 8.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { findEvidenceBlocks, formatEvidenceBlock } = await import('@/lib/structured-knowledge/evidence')
      const results = await findEvidenceBlocks({ filePath: String(params.filePath || ''), query: String(params.query || ''), limit: Number(params.limit) || 8 })
      return {
        success: true,
        message: results.length ? results.map(formatEvidenceBlock).join('\n') : 'No evidence blocks found.',
        data: results,
      }
    } catch (error) {
      return { success: false, error: `find_evidence_blocks failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const extractNoteSemanticsTool: Tool = {
  name: 'extract_note_semantics',
  description: 'Manually trigger LLM extraction of entities and evidence-bound relations for a structured Markdown note.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path already present in structured index.' },
    { name: 'mode', type: 'string', required: false, description: 'entities, relations, or both. Default both.' },
    { name: 'maxBlocks', type: 'number', required: false, description: 'Maximum blocks to send to LLM, default 40.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { extractNoteSemantics } = await import('@/lib/structured-knowledge/semantic-extractor')
      const mode = ['entities', 'relations', 'both'].includes(String(params.mode)) ? String(params.mode) as 'entities' | 'relations' | 'both' : 'both'
      const result = await extractNoteSemantics({ filePath: String(params.filePath || ''), mode, maxBlocks: Number(params.maxBlocks) || 40 })
      return {
        success: true,
        message: `Extracted semantics for ${result.filePath}: entities=${result.entities.length}, relations=${result.relations.length}, discardedRelations=${result.discardedRelations}${result.warnings.length ? `\nWarnings: ${result.warnings.join('; ')}` : ''}`,
        data: result,
      }
    } catch (error) {
      return { success: false, error: `extract_note_semantics failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const queueNoteSemanticExtractionTool: Tool = {
  name: 'queue_note_semantic_extraction',
  description: 'Queue a structured Markdown note for background LLM semantic extraction. Respects user auto-extraction settings and warnings.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'content', type: 'string', required: false, description: 'Optional latest Markdown content. If omitted, the queue reads from disk.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { enqueueSemanticExtraction, getSemanticExtractionQueue } = await import('@/lib/structured-knowledge/semantic-extraction-queue')
      enqueueSemanticExtraction({ filePath, content: typeof params.content === 'string' ? params.content : undefined, reason: 'agent-tool' })
      return { success: true, message: `Queued semantic extraction for ${filePath}.`, data: getSemanticExtractionQueue().snapshot() }
    } catch (error) {
      return { success: false, error: `queue_note_semantic_extraction failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const getSemanticExtractionStatusTool: Tool = {
  name: 'get_semantic_extraction_status',
  description: 'Get semantic extraction status for a structured Markdown note and the current background queue snapshot.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { getStructuredDocumentByPath } = await import('@/db/structured-knowledge')
      const { getSemanticExtractionQueue } = await import('@/lib/structured-knowledge/semantic-extraction-queue')
      const document = await getStructuredDocumentByPath(filePath)
      if (!document) return { success: false, error: `No structured note found for ${filePath}. Run rebuild_structured_knowledge first.` }
      const status = {
        filePath: document.filePath,
        documentId: document.id,
        contentHash: document.contentHash,
        semanticExtractedAt: document.semanticExtractedAt,
        semanticExtractionStatus: document.semanticExtractionStatus || 'idle',
        semanticExtractionRequestedAt: document.semanticExtractionRequestedAt,
        semanticExtractionStartedAt: document.semanticExtractionStartedAt,
        semanticExtractionError: document.semanticExtractionError,
        semanticExtractionAttempts: document.semanticExtractionAttempts || 0,
        semanticExtractionContentHash: document.semanticExtractionContentHash,
        queue: getSemanticExtractionQueue().snapshot(),
      }
      return { success: true, message: `Semantic extraction status for ${document.filePath}: ${status.semanticExtractionStatus}`, data: status }
    } catch (error) {
      return { success: false, error: `get_semantic_extraction_status failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const linkNoteToGraphTool: Tool = {
  name: 'link_note_to_graph',
  description: 'Build graph nodes and edges from a structured Markdown note. Use this to inspect what will enter the knowledge graph.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'includeHeadings', type: 'boolean', required: false, description: 'Include heading nodes.' },
    { name: 'includeEvidenceBlocks', type: 'boolean', required: false, description: 'Include evidence block nodes for local inspection.' },
    { name: 'minConfidence', type: 'number', required: false, description: 'Minimum entity/relation confidence, default 0.7.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { getStructuredGraphForFile } = await import('@/lib/structured-knowledge/graph-adapter')
      const graph = await getStructuredGraphForFile(String(params.filePath || ''), {
        includeHeadings: params.includeHeadings === true,
        includeEvidenceBlocks: params.includeEvidenceBlocks === true,
        minConfidence: Number(params.minConfidence) || 0.7,
      })
      return { success: true, message: `Structured graph: nodes=${graph.nodes.length}, edges=${graph.edges.length}`, data: graph }
    } catch (error) {
      return { success: false, error: `link_note_to_graph failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const structuredKnowledgeTools: Tool[] = [
  getStructuredNoteTool,
  rebuildStructuredKnowledgeTool,
  findEvidenceBlocksTool,
  extractNoteSemanticsTool,
  queueNoteSemanticExtractionTool,
  getSemanticExtractionStatusTool,
  linkNoteToGraphTool,
]
