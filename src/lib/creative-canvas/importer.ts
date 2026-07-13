import type {
  CreativeCanvasEdge,
  CreativeCanvasGenerationMode,
  CreativeCanvasNode,
  CreativeCanvasNodeMetadata,
  CreativeCanvasNodeType,
  CreativeCanvasProject,
  CreativeCanvasSnapshot,
  CreativeCanvasViewport,
} from '@/types/creative-canvas'
import { CREATIVE_CANVAS_SCHEMA_VERSION } from '@/types/creative-canvas'
import { clampCanvasZoom } from './geometry'

type AnyRecord = Record<string, unknown>

const NODE_TYPES: CreativeCanvasNodeType[] = ['text', 'image', 'config', 'video', 'audio']
const GENERATION_MODES: CreativeCanvasGenerationMode[] = ['text', 'image', 'video', 'audio']

export interface InfiniteCanvasImportReport {
  snapshot: CreativeCanvasSnapshot
  warnings: string[]
  skippedNodes: number
  skippedEdges: number
}

interface ImportOptions {
  title?: string
  projectId?: string
  now?: number
  createId?: (prefix: string) => string
}

function defaultCreateId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value)
    if (record) return record
  }
  return {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function findContainer(raw: AnyRecord) {
  return firstRecord(raw.canvas, raw.state, raw.document, raw.project, raw.data, raw)
}

function extractNodes(raw: AnyRecord) {
  const container = findContainer(raw)
  return asArray(container.nodes ?? container.elements ?? container.items ?? raw.nodes)
}

function extractEdges(raw: AnyRecord) {
  const container = findContainer(raw)
  return asArray(container.edges ?? container.connections ?? container.links ?? raw.edges)
}

function normalizeNodeType(value: unknown): CreativeCanvasNodeType {
  const candidate = text(value).toLowerCase()
  return NODE_TYPES.includes(candidate as CreativeCanvasNodeType)
    ? candidate as CreativeCanvasNodeType
    : 'text'
}

function normalizeGenerationMode(value: unknown): CreativeCanvasGenerationMode | undefined {
  const candidate = text(value).toLowerCase()
  return GENERATION_MODES.includes(candidate as CreativeCanvasGenerationMode)
    ? candidate as CreativeCanvasGenerationMode
    : undefined
}

function getPosition(record: AnyRecord) {
  const data = asRecord(record.data) || {}
  const position = firstRecord(record.position, data.position)
  return {
    x: number(record.x ?? position.x ?? data.x, 120),
    y: number(record.y ?? position.y ?? data.y, 120),
  }
}

function getSize(record: AnyRecord, type: CreativeCanvasNodeType) {
  const data = asRecord(record.data) || {}
  const style = firstRecord(record.style, data.style)
  return {
    width: Math.max(120, number(record.width ?? style.width ?? data.width, type === 'config' ? 320 : 280)),
    height: Math.max(90, number(record.height ?? style.height ?? data.height, type === 'text' ? 180 : 220)),
  }
}

function getTitle(record: AnyRecord, type: CreativeCanvasNodeType) {
  const data = asRecord(record.data) || {}
  return text(record.title)
    || text(record.name)
    || text(record.label)
    || text(data.title)
    || text(data.label)
    || (type === 'config' ? 'Imported config' : type === 'image' ? 'Imported image' : 'Imported text')
}

function getNodeText(record: AnyRecord) {
  const data = asRecord(record.data) || {}
  const metadata = asRecord(record.metadata) || {}
  return text(record.text)
    || text(record.content)
    || text(record.prompt)
    || text(data.text)
    || text(data.content)
    || text(data.prompt)
    || text(metadata.content)
    || text(metadata.prompt)
}

function getImageUrl(record: AnyRecord) {
  const data = asRecord(record.data) || {}
  const image = asRecord(record.image) || asRecord(data.image) || {}
  const metadata = asRecord(record.metadata) || {}
  return text(record.url)
    || text(record.src)
    || text(record.imageUrl)
    || text(record.filePath)
    || text(data.url)
    || text(data.src)
    || text(data.imageUrl)
    || text(image.url)
    || text(image.src)
    || text(metadata.url)
    || text(metadata.src)
}

function buildMetadata(record: AnyRecord, type: CreativeCanvasNodeType, ts: number): CreativeCanvasNodeMetadata {
  const data = asRecord(record.data) || {}
  const sourceMetadata = asRecord(record.metadata) || {}
  const prompt = getNodeText(record)
  const imageUrl = getImageUrl(record)
  const generationMode = normalizeGenerationMode(record.mode ?? data.mode ?? sourceMetadata.generationMode)
  const metadata: CreativeCanvasNodeMetadata = {
    ...sourceMetadata,
    provenance: {
      source: 'import',
      createdAt: ts,
    },
    imported: {
      rawType: record.type,
      sourceId: record.id,
      data,
    },
  }

  if (prompt) {
    metadata.content = type === 'text' ? prompt : metadata.content
    metadata.prompt = prompt
  }

  if (type === 'image' && imageUrl) {
    metadata.remoteUrl = imageUrl
  }

  if (type === 'config') {
    metadata.status = 'idle'
    metadata.generationMode = generationMode || 'image'
    metadata.generationType = 'generation'
    metadata.model = text(record.model ?? data.model ?? sourceMetadata.model) || undefined
    metadata.size = text(record.size ?? data.size ?? sourceMetadata.size) || undefined
    metadata.quality = text(record.quality ?? data.quality ?? sourceMetadata.quality) || undefined
  }

  return metadata
}

function extractEndpoint(value: unknown) {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return text(record?.id) || text(record?.nodeId) || text(record?.node)
}

function getViewport(raw: AnyRecord): CreativeCanvasViewport {
  const container = findContainer(raw)
  const viewport = firstRecord(container.viewport, raw.viewport)
  return {
    x: number(viewport.x, 0),
    y: number(viewport.y, 0),
    k: clampCanvasZoom(number(viewport.k ?? viewport.zoom, 1)),
  }
}

export function parseInfiniteCanvasJson(input: string | unknown): AnyRecord {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input
  const record = asRecord(parsed)
  if (!record) {
    throw new Error('INFINITE_CANVAS_IMPORT_REQUIRES_OBJECT_JSON')
  }
  return record
}

export function convertInfiniteCanvasJson(input: string | unknown, options: ImportOptions = {}): InfiniteCanvasImportReport {
  const raw = parseInfiniteCanvasJson(input)
  const createId = options.createId || defaultCreateId
  const ts = options.now || Date.now()
  const warnings: string[] = []
  const projectId = options.projectId || createId('canvas')
  const idMap = new Map<string, string>()
  const usedNodeIds = new Set<string>()
  let skippedNodes = 0

  const project: CreativeCanvasProject = {
    id: projectId,
    title: options.title || text(raw.title) || text(asRecord(raw.project)?.title) || 'Imported infinite canvas',
    schemaVersion: CREATIVE_CANVAS_SCHEMA_VERSION,
    viewport: getViewport(raw),
    settings: {},
    createdAt: ts,
    updatedAt: ts,
  }

  const nodes: CreativeCanvasNode[] = extractNodes(raw)
    .map((item, index) => {
      const record = asRecord(item)
      if (!record) {
        skippedNodes += 1
        return null
      }
      const sourceId = text(record.id) || `imported-${index}`
      const id = createId('node')
      idMap.set(sourceId, id)
      usedNodeIds.add(id)
      const type = normalizeNodeType(record.type)
      const position = getPosition(record)
      const size = getSize(record, type)
      return {
        id,
        projectId,
        type,
        title: getTitle(record, type),
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        metadata: buildMetadata(record, type, ts),
        createdAt: ts,
        updatedAt: ts,
      } satisfies CreativeCanvasNode
    })
    .filter((node): node is CreativeCanvasNode => Boolean(node))

  let skippedEdges = 0
  const edgeKeys = new Set<string>()
  const edges: CreativeCanvasEdge[] = []
  for (const item of extractEdges(raw)) {
    const record = asRecord(item)
    if (!record) {
      skippedEdges += 1
      continue
    }
    const fromSource = extractEndpoint(record.fromNodeId ?? record.sourceNodeId ?? record.source ?? record.from)
    const toSource = extractEndpoint(record.toNodeId ?? record.targetNodeId ?? record.target ?? record.to)
    const fromNodeId = idMap.get(fromSource) || fromSource
    const toNodeId = idMap.get(toSource) || toSource
    if (!fromNodeId || !toNodeId || !usedNodeIds.has(fromNodeId) || !usedNodeIds.has(toNodeId) || fromNodeId === toNodeId) {
      skippedEdges += 1
      continue
    }
    const key = `${fromNodeId}->${toNodeId}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    edges.push({
      id: createId('edge'),
      projectId,
      fromNodeId,
      toNodeId,
      createdAt: ts,
    })
  }

  if (!nodes.length) {
    warnings.push('No compatible nodes were found in the imported JSON.')
  }
  if (skippedNodes) warnings.push(`Skipped ${skippedNodes} unsupported node records.`)
  if (skippedEdges) warnings.push(`Skipped ${skippedEdges} invalid edge records.`)

  return {
    snapshot: {
      project,
      nodes,
      edges,
      assets: [],
      jobs: [],
    },
    warnings,
    skippedNodes,
    skippedEdges,
  }
}
