export const KNOWLEDGE_GRAPH_TAG_GROUPS_STORAGE_KEY = 'knowledge-graph-tag-groups'
export const KNOWLEDGE_GRAPH_TAG_DRAG_TYPE = 'application/x-lingmo-graph-tag-resource'

export interface GraphTagGroup {
  id: string
  name: string
  query: string
}

export interface GraphTagDropResource {
  path: string
  name?: string
  isDirectory?: boolean
}

export function createGraphTagGroup(name: string, query: string): GraphTagGroup | null {
  const normalizedName = name.trim()
  const normalizedQuery = query.trim()
  if (!normalizedName && !normalizedQuery) return null

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizedName || getGraphTagNameFromPath(normalizedQuery),
    query: normalizedQuery || normalizedName,
  }
}

export function getGraphTagNameFromPath(path: string) {
  const tail = path.split(/[\\/]/).filter(Boolean).pop() || path
  return tail.replace(/\.[^.]+$/, '') || tail
}

export function getGraphTagTokens(group: GraphTagGroup) {
  return (group.query || group.name)
    .split(/[\s,，;；/|]+/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean)
}

export function appendUniqueGraphTagQuery(current: string, next: string) {
  const normalizedNext = next.trim()
  if (!normalizedNext) return current

  const parts = current
    .split(/[,，]+/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.includes(normalizedNext)) return current

  return [...parts, normalizedNext].join(', ')
}

export function parseGraphTagDrop(dataTransfer: DataTransfer): GraphTagDropResource | null {
  const structured = dataTransfer.getData(KNOWLEDGE_GRAPH_TAG_DRAG_TYPE)
  if (structured) {
    try {
      const parsed = JSON.parse(structured) as GraphTagDropResource
      if (parsed?.path) return parsed
    } catch {
      // Fall back to plain text below.
    }
  }

  const plain = dataTransfer.getData('text/plain') || dataTransfer.getData('text')
  if (!plain.trim()) return null

  return {
    path: plain.trim(),
    name: getGraphTagNameFromPath(plain.trim()),
  }
}
