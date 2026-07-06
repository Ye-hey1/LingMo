export type StructuredBlockType =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'heading'
  | 'html'
  | 'math'

export type StructuredEntityType =
  | 'concept'
  | 'person'
  | 'organization'
  | 'method'
  | 'tool'
  | 'claim'
  | 'metric'
  | 'project'
  | 'other'

export type StructuredExtractionMethod = 'local' | 'llm' | 'manual'

export type StructuredSemanticExtractionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'

export type StructuredRelationType =
  | 'supports'
  | 'contradicts'
  | 'extends'
  | 'references'
  | 'defines'
  | 'uses'
  | 'part_of'
  | 'causes'
  | 'improves'
  | 'related'

export interface StructuredHeading {
  id: string
  documentId: string
  level: number
  text: string
  slug: string
  order: number
  parentId?: string
  path: string[]
  lineStart?: number
  lineEnd?: number
}

export interface StructuredBlock {
  id: string
  documentId: string
  headingId?: string
  type: StructuredBlockType
  text: string
  markdown: string
  order: number
  lineStart?: number
  lineEnd?: number
  headingPath: string[]
  wikilinks: string[]
  tags: string[]
  contentHash: string
}

export interface StructuredMarkdownDocument {
  id: string
  sourceObjectId: string
  filePath: string
  title: string
  contentHash: string
  frontmatter: Record<string, unknown>
  tags: string[]
  wikilinks: string[]
  headings: StructuredHeading[]
  blocks: StructuredBlock[]
  summary?: string
  createdAt: number
  updatedAt: number
  structuredAt: number
  semanticExtractedAt?: number
  semanticExtractionStatus?: StructuredSemanticExtractionStatus
  semanticExtractionRequestedAt?: number
  semanticExtractionStartedAt?: number
  semanticExtractionError?: string
  semanticExtractionAttempts?: number
  semanticExtractionContentHash?: string
}

export interface ExtractedEntity {
  id: string
  documentId: string
  name: string
  normalizedName: string
  type: StructuredEntityType
  aliases: string[]
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: StructuredExtractionMethod
  createdAt: number
  updatedAt: number
}

export interface ExtractedRelation {
  id: string
  documentId: string
  sourceEntityId: string
  targetEntityId: string
  relationType: StructuredRelationType
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: Exclude<StructuredExtractionMethod, 'local'> | 'inferred'
  createdAt: number
  updatedAt: number
}

export interface ParsedMarkdownStructure {
  document: StructuredMarkdownDocument
  headings: StructuredHeading[]
  blocks: StructuredBlock[]
  localEntities: ExtractedEntity[]
  warnings: string[]
}

export interface StructuredKnowledgeSyncResult {
  documentId: string
  filePath: string
  skipped: boolean
  warningCount: number
  warnings: string[]
  blockCount: number
  headingCount: number
  entityCount: number
  relationCount: number
}

export interface EvidenceBlockResult {
  block: StructuredBlock
  document: Pick<StructuredMarkdownDocument, 'id' | 'filePath' | 'title'>
  score: number
  excerpt: string
}

export interface StructuredGraphNode {
  id: string
  label: string
  type: 'note' | 'heading' | 'entity' | 'claim' | 'block'
  sourceDocumentId?: string
  sourceObjectId?: string
  filePath?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface StructuredGraphEdge {
  id: string
  source: string
  target: string
  type: 'contains' | 'mentions' | 'links_to' | StructuredRelationType | 'evidenced_by'
  label?: string
  confidence?: number
  evidenceBlockIds?: string[]
  metadata?: Record<string, unknown>
}
