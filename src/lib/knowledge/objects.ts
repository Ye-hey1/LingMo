import type { KnowledgeObjectStatus, KnowledgeObjectType } from '@/db/knowledge-objects'
import { objectRegistry, resolveKnowledgeObject } from './object-registry'
import { isUserKnowledgeFilePath } from '@/lib/files'

export type UnifiedKnowledgeObjectType = KnowledgeObjectType | 'memory'

export interface UnifiedKnowledgeObject {
  id: string
  type: UnifiedKnowledgeObjectType
  sourceId: string
  title: string
  path?: string
  sourceUrl?: string
  summary?: string
  contentPreview?: string
  tags: string[]
  aliases: string[]
  status?: KnowledgeObjectStatus
  createdAt?: number
  updatedAt?: number
  score?: number
  scoreReasons?: string[]
  metadata: Record<string, unknown>
}

export interface KnowledgeObjectIndexOptions {
  includeTypes?: UnifiedKnowledgeObjectType[]
  includeContentPreview?: boolean
  maxNoteContentReads?: number
  limit?: number
}

export interface KnowledgeObjectIndexResult {
  objects: UnifiedKnowledgeObject[]
  warnings: string[]
}

export interface KnowledgeObjectSearchOptions extends KnowledgeObjectIndexOptions {
  status?: KnowledgeObjectStatus | KnowledgeObjectStatus[]
  pathPrefix?: string
  excludeIds?: string[]
  limit?: number
}

export interface KnowledgeObjectSearchResult extends KnowledgeObjectIndexResult {
  query: string
  results: UnifiedKnowledgeObject[]
}

export interface KnowledgeObjectOverview {
  total: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  recent: UnifiedKnowledgeObject[]
  topTags: Array<{ tag: string; count: number }>
  warnings: string[]
}

export interface CurrentNoteKnowledgeContext {
  filePath: string
  title: string
  contentPreview: string
  headings: string[]
  outgoingLinks: string[]
  backlinks: Array<{ sourcePath: string; sourceName?: string; context?: string; line?: number }>
  unlinkedMentions: Array<{ sourcePath: string; sourceName?: string; context?: string; line?: number }>
  semanticRelations: Array<{ targetPath: string; relationType?: string; score?: number; evidence?: string }>
  relatedObjects: UnifiedKnowledgeObject[]
  contextText: string
  warnings: string[]
}

const DEFAULT_INDEX_LIMIT = 500
const DEFAULT_SEARCH_LIMIT = 12
const DEFAULT_CURRENT_RELATED_LIMIT = 8

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function compactText(value: unknown, maxLength = 240): string {
  const text = normalizeText(value)
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function toMillis(value: unknown): number | undefined {
  if (!value) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function typeIncluded(type: UnifiedKnowledgeObjectType, includeTypes?: UnifiedKnowledgeObjectType[]) {
  return !includeTypes || includeTypes.length === 0 || includeTypes.includes(type)
}

function normalizePath(value: unknown): string {
  return normalizeText(value).replace(/\\/g, '/').replace(/^\/+/, '')
}

function titleFromPath(path: string): string {
  const name = path.split('/').pop() || path
  return name.replace(/\.(md|markdown|mdx|drawio|excalidraw|mermaid)$/i, '') || name
}

function objectKey(type: UnifiedKnowledgeObjectType, sourceId: string) {
  return `${type}:${sourceId}`
}

function safeJsonArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function safeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function getRowField<T = unknown>(row: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (row[camel] ?? row[snake]) as T | undefined
}

function mergeObject(existing: UnifiedKnowledgeObject | undefined, next: UnifiedKnowledgeObject): UnifiedKnowledgeObject {
  if (!existing) return next
  return {
    ...existing,
    ...next,
    title: next.title || existing.title,
    path: next.path || existing.path,
    sourceUrl: next.sourceUrl || existing.sourceUrl,
    summary: next.summary || existing.summary,
    contentPreview: next.contentPreview || existing.contentPreview,
    tags: Array.from(new Set([...(existing.tags || []), ...(next.tags || [])])),
    aliases: Array.from(new Set([...(existing.aliases || []), ...(next.aliases || [])])),
    metadata: {
      ...existing.metadata,
      ...next.metadata,
    },
    createdAt: existing.createdAt && next.createdAt ? Math.min(existing.createdAt, next.createdAt) : existing.createdAt || next.createdAt,
    updatedAt: existing.updatedAt && next.updatedAt ? Math.max(existing.updatedAt, next.updatedAt) : existing.updatedAt || next.updatedAt,
  }
}

function addObject(map: Map<string, UnifiedKnowledgeObject>, object: UnifiedKnowledgeObject) {
  map.set(objectKey(object.type, object.sourceId), mergeObject(map.get(objectKey(object.type, object.sourceId)), object))
}

function stripMarkdownNoise(content: string): string {
  return content
    .replace(/^---\s*[\s\S]*?\n---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/[#>*_`~|-]/g, ' ')
}

function extractContentPreview(content: string, maxLength = 500): string {
  return compactText(stripMarkdownNoise(content), maxLength)
}

function extractHeadings(content: string, limit = 8): string[] {
  const headings: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#{1,4}\s+(.{1,120})\s*$/)
    if (!match?.[1]) continue
    headings.push(match[1].trim())
    if (headings.length >= limit) break
  }
  return Array.from(new Set(headings))
}

function tokenizeQuery(query: string): string[] {
  const compact = normalizeText(query).toLowerCase()
  if (!compact) return []
  const tokens = compact
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
  return Array.from(new Set([compact, ...tokens]))
}

function scoreObject(object: UnifiedKnowledgeObject, query: string): { score: number; reasons: string[] } {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return { score: 0, reasons: [] }

  const title = object.title.toLowerCase()
  const path = (object.path || '').toLowerCase()
  const tags = object.tags.join(' ').toLowerCase()
  const aliases = object.aliases.join(' ').toLowerCase()
  const summary = (object.summary || '').toLowerCase()
  const preview = (object.contentPreview || '').toLowerCase()
  const type = object.type.toLowerCase()
  const sourceUrl = (object.sourceUrl || '').toLowerCase()
  let score = 0
  const reasons = new Set<string>()

  for (const token of tokens) {
    if (!token) continue
    if (title === token) {
      score += 100
      reasons.add('title exact')
    } else if (title.includes(token)) {
      score += 60
      reasons.add('title')
    }
    if (aliases.includes(token)) {
      score += 45
      reasons.add('alias')
    }
    if (tags.includes(token)) {
      score += 35
      reasons.add('tag')
    }
    if (path.includes(token)) {
      score += 24
      reasons.add('path')
    }
    if (summary.includes(token)) {
      score += 18
      reasons.add('summary')
    }
    if (preview.includes(token)) {
      score += 12
      reasons.add('content')
    }
    if (type.includes(token)) {
      score += 10
      reasons.add('type')
    }
    if (sourceUrl.includes(token)) {
      score += 8
      reasons.add('url')
    }
  }

  if (object.updatedAt) {
    const ageDays = Math.max(0, (Date.now() - object.updatedAt) / 86400000)
    score += Math.max(0, 8 - Math.min(8, ageDays / 14))
  }

  return { score, reasons: Array.from(reasons) }
}

async function maybeReadNotePreview(path: string, warnings: string[]) {
  try {
    const [{ readTextFile }, { getFilePathOptions }] = await Promise.all([
      import('@tauri-apps/plugin-fs'),
      import('@/lib/workspace'),
    ])
    const pathOptions = await getFilePathOptions(path)
    const content = pathOptions.baseDir
      ? await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await readTextFile(pathOptions.path)
    return extractContentPreview(content)
  } catch (error) {
    warnings.push(`Failed to read note preview for ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

async function collectRegistryObjects(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  try {
    const rows = await objectRegistry.query({
      status: ['active', 'inbox', 'archived'],
      limit: options.limit || DEFAULT_INDEX_LIMIT,
      orderBy: 'updatedAt',
      orderDir: 'desc',
    })

    for (const raw of rows as unknown as Array<Record<string, unknown>>) {
      const sourceType = getRowField<string>(raw, 'sourceType', 'source_type') as UnifiedKnowledgeObjectType
      if (!sourceType || !typeIncluded(sourceType, options.includeTypes)) continue

      const sourceId = String(getRowField(raw, 'sourceId', 'source_id') || '')
      if (!sourceId) continue
      const path = normalizePath(getRowField(raw, 'path', 'path')) || undefined
      if (sourceType === 'note' && !isUserKnowledgeFilePath(path || sourceId)) continue
      const resolved = resolveKnowledgeObject(raw as never)
      addObject(map, {
        id: String(getRowField(raw, 'id', 'id') || objectKey(sourceType, sourceId)),
        type: sourceType,
        sourceId,
        title: normalizeText(getRowField(raw, 'title', 'title')) || titleFromPath(path || sourceId),
        path,
        sourceUrl: normalizeText(getRowField(raw, 'sourceUrl', 'source_url')) || undefined,
        tags: resolved.tagsList || safeJsonArray(getRowField(raw, 'tags', 'tags')),
        aliases: resolved.aliasesList || safeJsonArray(getRowField(raw, 'aliases', 'aliases')),
        status: getRowField(raw, 'status', 'status') as KnowledgeObjectStatus | undefined,
        createdAt: toMillis(getRowField(raw, 'createdAt', 'created_at')),
        updatedAt: toMillis(getRowField(raw, 'updatedAt', 'updated_at')),
        metadata: {
          ...(resolved.metadataMap || safeJsonRecord(getRowField(raw, 'metadata', 'metadata'))),
          registryId: getRowField(raw, 'id', 'id'),
          origin: getRowField(raw, 'origin', 'origin'),
          contentHash: getRowField(raw, 'contentHash', 'content_hash'),
          vectorIndexedAt: getRowField(raw, 'vectorIndexedAt', 'vector_indexed_at'),
        },
      })
    }
  } catch (error) {
    warnings.push(`KnowledgeObject registry unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectNotes(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  if (!typeIncluded('note', options.includeTypes) && !typeIncluded('folder', options.includeTypes)) return
  try {
    const { getAllMarkdownFiles } = await import('@/lib/files')
    const files = await getAllMarkdownFiles(true)
    const folders = new Map<string, { count: number; updatedAt?: number }>()
    let contentReads = 0

    for (const file of files) {
      const path = normalizePath(file.relativePath || file.path || file.name)
      const updatedAt = toMillis(file.metadata?.modifiedAt || file.modifiedAt)
      const folderParts = path.split('/').slice(0, -1)
      for (let index = 1; index <= folderParts.length; index += 1) {
        const folderPath = folderParts.slice(0, index).join('/')
        const current = folders.get(folderPath) || { count: 0 }
        current.count += index === folderParts.length ? 1 : 0
        current.updatedAt = Math.max(current.updatedAt || 0, updatedAt || 0) || current.updatedAt
        folders.set(folderPath, current)
      }

      if (typeIncluded('note', options.includeTypes)) {
        let contentPreview = ''
        if (options.includeContentPreview && contentReads < (options.maxNoteContentReads || 80)) {
          contentReads += 1
          contentPreview = await maybeReadNotePreview(path, warnings)
        }
        addObject(map, {
          id: `note:${path}`,
          type: 'note',
          sourceId: path,
          title: titleFromPath(path),
          path,
          contentPreview,
          tags: [],
          aliases: [titleFromPath(path)],
          status: 'active',
          createdAt: toMillis(file.metadata?.createdAt),
          updatedAt,
          metadata: {
            source: 'markdown-files',
            size: file.metadata?.size,
            isReadOnly: file.metadata?.isReadOnly,
          },
        })
      }
    }

    if (typeIncluded('folder', options.includeTypes)) {
      for (const [folderPath, folder] of folders) {
        addObject(map, {
          id: `folder:${folderPath}`,
          type: 'folder',
          sourceId: folderPath,
          title: folderPath.split('/').pop() || folderPath,
          path: folderPath,
          summary: `${folder.count} markdown file(s)`,
          tags: [],
          aliases: [folderPath],
          status: 'active',
          updatedAt: folder.updatedAt,
          metadata: {
            source: 'markdown-folders',
            fileCount: folder.count,
          },
        })
      }
    }
  } catch (error) {
    warnings.push(`Markdown file scan unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectMarks(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  if (!typeIncluded('mark', options.includeTypes)) return
  try {
    const { getAllMarks } = await import('@/db/marks')
    const marks = await getAllMarks()
    for (const mark of marks) {
      if (mark.deleted === 1) continue
      const title = compactText(mark.desc || mark.content || mark.url || `${mark.type} mark`, 120)
      addObject(map, {
        id: `mark:${mark.id}`,
        type: 'mark',
        sourceId: String(mark.id),
        title,
        sourceUrl: /^https?:\/\//i.test(mark.url || '') ? mark.url : undefined,
        summary: compactText(mark.desc || mark.content || mark.url, 260),
        contentPreview: compactText(mark.content || mark.desc, 500),
        tags: [mark.type, mark.pinned ? 'pinned' : '', mark.processed ? 'processed' : ''].filter(Boolean),
        aliases: [],
        status: 'active',
        createdAt: toMillis(mark.createdAt),
        updatedAt: toMillis(mark.processedAt || mark.createdAt),
        metadata: {
          source: 'marks',
          tagId: mark.tagId,
          type: mark.type,
          pinned: Boolean(mark.pinned),
          processed: Boolean(mark.processed),
        },
      })
    }
  } catch (error) {
    warnings.push(`Marks unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectAiHotspots(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  if (!typeIncluded('ai_hotspot', options.includeTypes)) return
  try {
    const { getAiHotspotItems } = await import('@/db/ai-hotspots')
    const items = await getAiHotspotItems()
    for (const item of items) {
      if (item.deletedAt || item.isIgnored) continue
      addObject(map, {
        id: `ai_hotspot:${item.id}`,
        type: 'ai_hotspot',
        sourceId: item.id,
        title: item.title,
        sourceUrl: item.url,
        summary: compactText(item.signalSummary || item.summary || item.signalEssence, 360),
        contentPreview: compactText([item.summary, item.signalSummary, item.signalEssence].filter(Boolean).join(' '), 700),
        tags: item.tags || [],
        aliases: [item.titleOriginal, item.titleEn, item.titleZh].filter((value): value is string => Boolean(value)),
        status: item.isRead ? 'archived' : 'active',
        createdAt: toMillis(item.firstSeenAt),
        updatedAt: toMillis(item.publishedAt || item.lastSeenAt || item.firstSeenAt),
        metadata: {
          source: 'ai-hotspots',
          sourceName: item.sourceName,
          feedName: item.feedName,
          score: item.score,
          isFavorite: item.isFavorite,
          isRead: item.isRead,
          savedNotePath: item.savedNotePath,
          publishedAt: item.publishedAt,
          suggestedAction: item.suggestedAction,
        },
      })
    }
  } catch (error) {
    warnings.push(`AI hotspots unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectMemories(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  if (!typeIncluded('memory', options.includeTypes)) return
  try {
    const { getAllMemories } = await import('@/db/memories')
    const memories = await getAllMemories()
    for (const memory of memories) {
      addObject(map, {
        id: `memory:${memory.id}`,
        type: 'memory',
        sourceId: memory.id,
        title: compactText(memory.content, 100),
        summary: compactText(memory.content, 300),
        contentPreview: compactText(memory.content, 700),
        tags: [memory.category],
        aliases: [],
        status: 'active',
        createdAt: toMillis(memory.createdAt),
        updatedAt: toMillis(memory.updatedAt || memory.lastAccessedAt),
        metadata: {
          source: 'memories',
          category: memory.category,
          accessCount: memory.accessCount,
          lastAccessedAt: memory.lastAccessedAt,
        },
      })
    }
  } catch (error) {
    warnings.push(`Memories unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectAgentRuns(map: Map<string, UnifiedKnowledgeObject>, warnings: string[], options: KnowledgeObjectIndexOptions) {
  if (!typeIncluded('agent_run', options.includeTypes)) return
  try {
    const { listAgentRunSummaries } = await import('@/lib/agent/resume')
    const summaries = await listAgentRunSummaries(Math.min(80, Math.max(10, options.limit || 30)))
    for (const summary of summaries) {
      addObject(map, {
        id: `agent_run:${summary.id}`,
        type: 'agent_run',
        sourceId: summary.id,
        title: compactText(summary.userGoal, 160),
        summary: compactText(summary.result || (summary.stopped ? 'stopped' : 'completed'), 420),
        contentPreview: compactText([
          summary.userGoal,
          summary.result,
          summary.filesTouched.join(' '),
          summary.toolsUsed.map(tool => tool.toolName).join(' '),
          summary.failures.map(failure => `${failure.toolName} ${failure.error}`).join(' '),
        ].join(' '), 900),
        tags: [
          summary.stopped ? 'stopped' : 'completed',
          ...summary.failures.length ? ['has-failures'] : [],
        ],
        aliases: summary.filesTouched.slice(0, 8),
        status: summary.failures.length > 0 || summary.stopped ? 'inbox' : 'active',
        createdAt: toMillis(summary.startedAt || summary.completedAt),
        updatedAt: toMillis(summary.completedAt),
        metadata: {
          source: 'agent-run-summaries',
          iterations: summary.iterations,
          toolsUsed: summary.toolsUsed,
          filesTouched: summary.filesTouched,
          failures: summary.failures,
        },
      })
    }
  } catch (error) {
    warnings.push(`Agent run summaries unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function buildKnowledgeObjectIndex(options: KnowledgeObjectIndexOptions = {}): Promise<KnowledgeObjectIndexResult> {
  const map = new Map<string, UnifiedKnowledgeObject>()
  const warnings: string[] = []

  await collectRegistryObjects(map, warnings, options)
  await collectNotes(map, warnings, options)
  await collectMarks(map, warnings, options)
  await collectAiHotspots(map, warnings, options)
  await collectMemories(map, warnings, options)
  await collectAgentRuns(map, warnings, options)

  const objects = Array.from(map.values())
    .filter(object => typeIncluded(object.type, options.includeTypes))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, options.limit || DEFAULT_INDEX_LIMIT)

  return { objects, warnings }
}

export async function searchKnowledgeObjects(query: string, options: KnowledgeObjectSearchOptions = {}): Promise<KnowledgeObjectSearchResult> {
  const limit = Math.max(1, Math.min(80, Number(options.limit) || DEFAULT_SEARCH_LIMIT))
  const index = await buildKnowledgeObjectIndex({
    ...options,
    limit: Math.max(options.limit || DEFAULT_INDEX_LIMIT, limit),
  })
  const statuses = options.status
    ? Array.isArray(options.status) ? options.status : [options.status]
    : undefined
  const excludeIds = new Set(options.excludeIds || [])
  const pathPrefix = options.pathPrefix ? normalizePath(options.pathPrefix) : ''
  const normalizedQuery = normalizeText(query)

  const scored = index.objects
    .filter(object => !statuses || (object.status && statuses.includes(object.status)))
    .filter(object => !pathPrefix || object.path?.startsWith(pathPrefix))
    .filter(object => !excludeIds.has(object.id) && !excludeIds.has(objectKey(object.type, object.sourceId)))
    .map(object => {
      const scoredObject = scoreObject(object, normalizedQuery)
      return {
        ...object,
        score: scoredObject.score,
        scoreReasons: scoredObject.reasons,
      }
    })
    .filter(object => !normalizedQuery || (object.score || 0) > 0)
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0)
      if (scoreDiff !== 0) return scoreDiff
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    })
    .slice(0, limit)

  return {
    ...index,
    query: normalizedQuery,
    results: scored,
  }
}

export async function getKnowledgeObjectOverview(options: KnowledgeObjectIndexOptions = {}): Promise<KnowledgeObjectOverview> {
  const index = await buildKnowledgeObjectIndex(options)
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const tagCounts = new Map<string, number>()

  for (const object of index.objects) {
    byType[object.type] = (byType[object.type] || 0) + 1
    if (object.status) byStatus[object.status] = (byStatus[object.status] || 0) + 1
    for (const tag of object.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }

  return {
    total: index.objects.length,
    byType,
    byStatus,
    recent: index.objects.slice(0, 12),
    topTags: Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count })),
    warnings: index.warnings,
  }
}

async function readCurrentOrWorkspaceNote(filePath?: string): Promise<{ filePath: string; content: string; warnings: string[] }> {
  const warnings: string[] = []
  let normalizedPath = normalizePath(filePath)
  let activePath = ''
  let activeContent = ''

  try {
    const articleStore = (await import('@/stores/article')).default.getState()
    activePath = normalizePath(articleStore.activeFilePath)
    activeContent = articleStore.currentArticle || ''
    if (!normalizedPath) normalizedPath = activePath
  } catch {
    // Store is optional for non-UI callers.
  }

  if (!normalizedPath) {
    return { filePath: '', content: '', warnings: ['No current note is open and no filePath was provided.'] }
  }

  if (activePath === normalizedPath && activeContent) {
    return { filePath: normalizedPath, content: activeContent, warnings }
  }

  try {
    const [{ readTextFile }, { ensureSafeWorkspaceRelativePath, getFilePathOptions }] = await Promise.all([
      import('@tauri-apps/plugin-fs'),
      import('@/lib/workspace'),
    ])
    normalizedPath = await ensureSafeWorkspaceRelativePath(normalizedPath)
    const pathOptions = await getFilePathOptions(normalizedPath)
    const content = pathOptions.baseDir
      ? await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await readTextFile(pathOptions.path)
    return { filePath: normalizedPath, content, warnings }
  } catch (error) {
    warnings.push(`Failed to read note ${normalizedPath}: ${error instanceof Error ? error.message : String(error)}`)
    return { filePath: normalizedPath, content: '', warnings }
  }
}

async function collectGraphContext(filePath: string, content: string, warnings: string[]) {
  const backlinks: CurrentNoteKnowledgeContext['backlinks'] = []
  const unlinkedMentions: CurrentNoteKnowledgeContext['unlinkedMentions'] = []
  const semanticRelations: CurrentNoteKnowledgeContext['semanticRelations'] = []
  let outgoingLinks: string[] = []

  try {
    const { extractWikiLinks } = await import('@/lib/wikilink-extension')
    outgoingLinks = Array.from(new Set(extractWikiLinks(content).map(link => normalizeText(link)).filter(Boolean)))
  } catch {
    // Wikilink extension is optional here.
  }

  try {
    const [{ default: useArticleStore }, { useNoteIndexStore }] = await Promise.all([
      import('@/stores/article'),
      import('@/stores/note-index'),
    ])
    const articleStore = useArticleStore.getState()
    const noteIndexStore = useNoteIndexStore.getState()
    if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
      await noteIndexStore.buildIndex(articleStore.fileTree)
    }
    backlinks.push(...(noteIndexStore.getBacklinks(filePath) || []))
    unlinkedMentions.push(...(noteIndexStore.getUnlinkedMentions(filePath) || []))
  } catch (error) {
    warnings.push(`Note graph index unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const { getCrossValidatedRelations } = await import('@/lib/relation-engine')
    const relations = await getCrossValidatedRelations(filePath, 0.35)
    semanticRelations.push(...relations.slice(0, 12).map(relation => ({
      targetPath: relation.target_note,
      relationType: relation.relation_type,
      score: relation.final_score,
      evidence: relation.evidence,
    })))
  } catch {
    // Semantic relations may not be initialized yet.
  }

  return { outgoingLinks, backlinks, unlinkedMentions, semanticRelations }
}

function formatCurrentNoteContext(input: Omit<CurrentNoteKnowledgeContext, 'contextText'>): string {
  const lines: string[] = [
    '## Current Note Knowledge Context',
    `File: ${input.filePath}`,
    `Title: ${input.title}`,
  ]

  if (input.headings.length > 0) {
    lines.push('', 'Headings:')
    input.headings.slice(0, 8).forEach(item => lines.push(`- ${item}`))
  }

  if (input.outgoingLinks.length > 0) {
    lines.push('', 'Outgoing wiki links:')
    input.outgoingLinks.slice(0, 12).forEach(item => lines.push(`- ${item}`))
  }

  if (input.backlinks.length > 0) {
    lines.push('', 'Backlinks:')
    input.backlinks.slice(0, 8).forEach(item => {
      lines.push(`- ${item.sourcePath}${item.line ? `:${item.line}` : ''}${item.context ? ` - ${compactText(item.context, 120)}` : ''}`)
    })
  }

  if (input.unlinkedMentions.length > 0) {
    lines.push('', 'Unlinked mentions:')
    input.unlinkedMentions.slice(0, 6).forEach(item => {
      lines.push(`- ${item.sourcePath}${item.line ? `:${item.line}` : ''}${item.context ? ` - ${compactText(item.context, 120)}` : ''}`)
    })
  }

  if (input.semanticRelations.length > 0) {
    lines.push('', 'Semantic relations:')
    input.semanticRelations.slice(0, 8).forEach(item => {
      const score = typeof item.score === 'number' ? ` ${(item.score * 100).toFixed(0)}%` : ''
      lines.push(`- ${item.targetPath}${item.relationType ? ` (${item.relationType}${score})` : ''}${item.evidence ? ` - ${compactText(item.evidence, 120)}` : ''}`)
    })
  }

  if (input.relatedObjects.length > 0) {
    lines.push('', 'Related knowledge objects:')
    input.relatedObjects.slice(0, 8).forEach(item => {
      lines.push(`- [${item.type}] ${item.title}${item.path ? ` (${item.path})` : ''}${item.summary ? ` - ${compactText(item.summary, 140)}` : ''}`)
    })
  }

  if (input.contentPreview) {
    lines.push('', 'Content preview:', input.contentPreview)
  }

  return lines.join('\n')
}

export async function getCurrentNoteKnowledgeContext(
  filePath?: string,
  options: { maxRelated?: number; includeContentPreview?: boolean } = {},
): Promise<CurrentNoteKnowledgeContext> {
  const note = await readCurrentOrWorkspaceNote(filePath)
  const warnings = [...note.warnings]
  const title = titleFromPath(note.filePath)
  const headings = extractHeadings(note.content)
  const graph = note.filePath && note.content
    ? await collectGraphContext(note.filePath, note.content, warnings)
    : { outgoingLinks: [], backlinks: [], unlinkedMentions: [], semanticRelations: [] }

  const relatedQuery = [
    title,
    ...headings.slice(0, 6),
    ...graph.outgoingLinks.slice(0, 6),
  ].filter(Boolean).join(' ')

  const related = relatedQuery
    ? await searchKnowledgeObjects(relatedQuery, {
        includeContentPreview: options.includeContentPreview,
        limit: Math.max(DEFAULT_CURRENT_RELATED_LIMIT, options.maxRelated || DEFAULT_CURRENT_RELATED_LIMIT) + 4,
        excludeIds: note.filePath ? [`note:${note.filePath}`, objectKey('note', note.filePath)] : [],
      })
    : { results: [], warnings: [] }
  warnings.push(...related.warnings)

  const contextWithoutText = {
    filePath: note.filePath,
    title,
    contentPreview: extractContentPreview(note.content, 900),
    headings,
    outgoingLinks: graph.outgoingLinks,
    backlinks: graph.backlinks,
    unlinkedMentions: graph.unlinkedMentions,
    semanticRelations: graph.semanticRelations,
    relatedObjects: related.results.slice(0, options.maxRelated || DEFAULT_CURRENT_RELATED_LIMIT),
    warnings,
  }

  return {
    ...contextWithoutText,
    contextText: formatCurrentNoteContext(contextWithoutText),
  }
}
