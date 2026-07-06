import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig } from '../../app/core/setting/config'
import { invokeAiJson } from '../ai/tauri-client.ts'
import { matchesConfiguredModelSelection } from '../ai/model-selection.ts'
import {
  clearStructuredLlmSemantics,
  countStructuredEntities,
  countStructuredRelations,
  getStructuredDocumentBundleByPath,
  markStructuredSemanticExtractionCompleted,
  markStructuredSemanticExtractionFailed,
  markStructuredSemanticExtractionRunning,
  upsertStructuredEntities,
  upsertStructuredRelations,
} from '../../db/structured-knowledge.ts'
import { createStableId } from './markdown-parser.ts'
import type {
  ExtractedEntity,
  ExtractedRelation,
  StructuredBlock,
  StructuredEntityType,
  StructuredMarkdownDocument,
  StructuredRelationType,
} from './types.ts'

export interface RawSemanticEntity {
  name?: unknown
  type?: unknown
  aliases?: unknown
  evidenceBlockIds?: unknown
  confidence?: unknown
}

export interface RawSemanticRelation {
  source?: unknown
  target?: unknown
  relationType?: unknown
  evidenceBlockIds?: unknown
  confidence?: unknown
}

export interface ParsedSemanticExtraction {
  entities: RawSemanticEntity[]
  relations: RawSemanticRelation[]
}

export interface SemanticExtractionResult {
  documentId: string
  filePath: string
  contentHash: string
  semanticExtractedAt: number
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  discardedRelations: number
  warnings: string[]
}

const ENTITY_TYPES = new Set<StructuredEntityType>([
  'concept',
  'person',
  'organization',
  'method',
  'tool',
  'claim',
  'metric',
  'project',
  'other',
])

const RELATION_TYPES = new Set<StructuredRelationType>([
  'supports',
  'contradicts',
  'extends',
  'references',
  'defines',
  'uses',
  'part_of',
  'causes',
  'improves',
  'related',
])

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).map(item => item.trim()).filter(Boolean)
}

function confidence(value: unknown, fallback = 0.7): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function parseSemanticExtractionResponse(text: string): ParsedSemanticExtraction {
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) candidates.unshift(fenced[1])
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch?.[0]) candidates.push(objectMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')) as Partial<ParsedSemanticExtraction>
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      }
    } catch {
      continue
    }
  }

  return { entities: [], relations: [] }
}

export function validateSemanticExtraction(
  raw: ParsedSemanticExtraction,
  document: StructuredMarkdownDocument,
  blocks: StructuredBlock[],
  now = Date.now(),
): { entities: ExtractedEntity[]; relations: ExtractedRelation[]; discardedRelations: number; warnings: string[] } {
  const warnings: string[] = []
  const validBlockIds = new Set(blocks.map(block => block.id))
  const entitiesByName = new Map<string, ExtractedEntity>()

  for (const rawEntity of raw.entities) {
    const name = typeof rawEntity.name === 'string' ? rawEntity.name.trim() : ''
    if (!name) continue
    const evidenceBlockIds = asStringArray(rawEntity.evidenceBlockIds).filter(id => validBlockIds.has(id))
    const entityType = ENTITY_TYPES.has(rawEntity.type as StructuredEntityType) ? rawEntity.type as StructuredEntityType : 'other'
    const normalizedName = normalizeName(name)
    const entity: ExtractedEntity = {
      id: createStableId('ske', [document.id, normalizedName, entityType, 'llm']),
      documentId: document.id,
      name,
      normalizedName,
      type: entityType,
      aliases: asStringArray(rawEntity.aliases),
      evidenceBlockIds,
      confidence: confidence(rawEntity.confidence),
      extractionMethod: 'llm',
      createdAt: now,
      updatedAt: now,
    }
    entitiesByName.set(normalizedName, entity)
  }

  let discardedRelations = 0
  const relations: ExtractedRelation[] = []
  for (const rawRelation of raw.relations) {
    const sourceName = typeof rawRelation.source === 'string' ? normalizeName(rawRelation.source) : ''
    const targetName = typeof rawRelation.target === 'string' ? normalizeName(rawRelation.target) : ''
    const source = entitiesByName.get(sourceName)
    const target = entitiesByName.get(targetName)
    const evidenceBlockIds = asStringArray(rawRelation.evidenceBlockIds).filter(id => validBlockIds.has(id))
    if (!source || !target || evidenceBlockIds.length === 0) {
      discardedRelations++
      continue
    }
    const relationType = RELATION_TYPES.has(rawRelation.relationType as StructuredRelationType)
      ? rawRelation.relationType as StructuredRelationType
      : 'related'
    relations.push({
      id: createStableId('skr', [document.id, source.id, target.id, relationType, evidenceBlockIds.join('|')]),
      documentId: document.id,
      sourceEntityId: source.id,
      targetEntityId: target.id,
      relationType,
      evidenceBlockIds,
      confidence: confidence(rawRelation.confidence),
      extractionMethod: 'llm',
      createdAt: now,
      updatedAt: now,
    })
  }

  if (discardedRelations > 0) warnings.push(`${discardedRelations} relation(s) discarded because source/target/evidence was invalid.`)
  return { entities: Array.from(entitiesByName.values()), relations, discardedRelations, warnings }
}

async function getAIConfig() {
  const store = await Store.load('store.json')
  const selectedModel = await store.get<string>('structuredExtractionModel')
    || await store.get<string>('primaryModel')
    || await store.get<string>('aiModel')
  const aiModelList = await store.get<AiConfig[]>('aiModelList')
  if (!selectedModel || !aiModelList) return null
  for (const config of aiModelList) {
    const target = config.models?.find(model => matchesConfiguredModelSelection({
      configKey: config.key,
      modelId: model.id,
      selectionId: selectedModel,
    }) && (model.modelType === 'chat' || !model.modelType))
    if (target) return { ...config, model: target.model, modelType: target.modelType }
    if (!config.models?.length && config.key === selectedModel && (config.modelType === 'chat' || !config.modelType)) return config
  }
  return null
}

function buildPrompt(document: StructuredMarkdownDocument, blocks: StructuredBlock[], mode: 'entities' | 'relations' | 'both') {
  const blockText = blocks.map(block => `[${block.id}] ${block.headingPath.join(' / ')}\n${block.text}`).join('\n\n')
  return `你是 LingMo 的结构化知识抽取器。请只基于给定 Markdown 块抽取语义信息。\n\n文件：${document.filePath}\n模式：${mode}\n\n要求：\n- 只返回严格 JSON，不要 Markdown 解释。\n- entities[].evidenceBlockIds 必须使用给定块 ID。\n- relations[].evidenceBlockIds 必须非空。\n- 如果证据不足，不要生成 relation。\n\nJSON 结构：\n{\n  "entities": [{"name":"...","type":"concept|person|organization|method|tool|claim|metric|project|other","aliases":[],"evidenceBlockIds":["..."],"confidence":0.0}],\n  "relations": [{"source":"实体名","target":"实体名","relationType":"supports|contradicts|extends|references|defines|uses|part_of|causes|improves|related","evidenceBlockIds":["..."],"confidence":0.0}]\n}\n\nMarkdown 块：\n${blockText}`
}

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata) return {}
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata as Record<string, unknown>
  if (typeof metadata !== 'string') return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function updateStructuredKnowledgeObjectMetadata(document: StructuredMarkdownDocument, semanticExtractedAt: number) {
  const { objectRegistry } = await import('../knowledge/object-registry.ts')
  const { buildStructuredKnowledgeMetadata } = await import('./sync.ts')
  const sourceId = document.filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const ko = await objectRegistry.getBySource('note', sourceId)
  const [entityCount, relationCount] = await Promise.all([
    countStructuredEntities(document.id),
    countStructuredRelations(document.id),
  ])
  await objectRegistry.touch('note', sourceId, {
    contentHash: document.contentHash,
    metadata: {
      ...parseMetadata(ko?.metadata),
      ...buildStructuredKnowledgeMetadata({
        documentId: document.id,
        blockCount: document.blocks.length,
        headingCount: document.headings.length,
        entityCount,
        relationCount,
        lastStructuredAt: document.structuredAt,
        lastSemanticExtractedAt: semanticExtractedAt,
      }),
    },
  })
}

export async function extractNoteSemantics(input: { filePath: string; mode?: 'entities' | 'relations' | 'both'; maxBlocks?: number; overwrite?: boolean }): Promise<SemanticExtractionResult> {
  const bundle = await getStructuredDocumentBundleByPath(input.filePath)
  if (!bundle) throw new Error(`Structured document not found for ${input.filePath}`)
  await markStructuredSemanticExtractionRunning(bundle.document.id)
  try {
    const config = await getAIConfig()
    if (!config) throw new Error('No chat AI model configured')
    const blocks = bundle.blocks.slice(0, Math.max(1, input.maxBlocks || 40))
    const prompt = buildPrompt(bundle.document, blocks, input.mode || 'both')
    const response = await invokeAiJson<any>({
      config: {
        baseUrl: config.baseURL || '',
        apiKey: config.apiKey || undefined,
        customHeaders: config.customHeaders,
      },
      path: '/chat/completions',
      method: 'POST',
      body: {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1800,
      },
    })
    const content = response?.choices?.[0]?.message?.content || ''
    const parsed = parseSemanticExtractionResponse(content)
    const validated = validateSemanticExtraction(parsed, bundle.document, bundle.blocks)
    if (input.overwrite) await clearStructuredLlmSemantics(bundle.document.id)
    await upsertStructuredEntities(bundle.document.id, validated.entities)
    await upsertStructuredRelations(bundle.document.id, validated.relations)
    const semanticExtractedAt = Date.now()
    await markStructuredSemanticExtractionCompleted(bundle.document.id, bundle.document.contentHash, semanticExtractedAt)
    await updateStructuredKnowledgeObjectMetadata(bundle.document, semanticExtractedAt)
    return {
      documentId: bundle.document.id,
      filePath: bundle.document.filePath,
      contentHash: bundle.document.contentHash,
      semanticExtractedAt,
      entities: validated.entities,
      relations: validated.relations,
      discardedRelations: validated.discardedRelations,
      warnings: validated.warnings,
    }
  } catch (error) {
    await markStructuredSemanticExtractionFailed(bundle.document.id, error instanceof Error ? error.message : String(error))
    throw error
  }
}
