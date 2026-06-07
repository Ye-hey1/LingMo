import type { NoteTopic } from '@/db/note-topics'
import type { DirTree } from '@/stores/article'

export interface KeywordClusterOptions {
  topKeywordsPerNote: number
  minKeywordNoteCount: number
  minCooccurrenceNoteCount: number
  maxClusters: number
  maxKeywordsPerCluster: number
}

export interface KeywordClusterGraph {
  clusters: KeywordCluster[]
  keywordNodes: KeywordClusterKeyword[]
  edges: KeywordClusterEdge[]
  keywordIndex: Map<string, KeywordClusterKeyword>
  noteIndex: Map<string, KeywordClusterNoteRef>
}

export interface KeywordCluster {
  id: string
  label: string
  color: string
  keywords: string[]
  notePaths: string[]
  totalWeight: number
  noteCount: number
  x: number
  y: number
  radius: number
}

export interface KeywordClusterKeyword {
  id: string
  keyword: string
  clusterId: string | null
  notePaths: string[]
  totalWeight: number
  avgWeight: number
  noteCount: number
  x: number
  y: number
  radius: number
}

export interface KeywordClusterNoteRef {
  path: string
  label: string
  keywords: Array<{ keyword: string; weight: number }>
  score: number
}

export interface KeywordClusterEdge {
  source: string
  target: string
  type: 'cluster-keyword' | 'keyword-cooccurrence'
  weight: number
  noteCount?: number
}

export type KeywordClusterSelection =
  | { type: 'cluster'; id: string }
  | { type: 'keyword'; id: string }

interface KeywordAggregate {
  keyword: string
  normalized: string
  totalWeight: number
  noteWeights: Map<string, number>
}

interface NoteKeyword {
  keyword: string
  normalized: string
  weight: number
}

const DEFAULT_OPTIONS: KeywordClusterOptions = {
  topKeywordsPerNote: 12,
  minKeywordNoteCount: 1,
  minCooccurrenceNoteCount: 2,
  maxClusters: 14,
  maxKeywordsPerCluster: 30,
}

const CLUSTER_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#c2410c',
  '#4f46e5',
  '#0f766e',
  '#be123c',
  '#65a30d',
  '#9333ea',
]

export function collectMarkdownFilePaths(fileTree: DirTree[], prefix = ''): Set<string> {
  const paths = new Set<string>()
  for (const item of fileTree) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isFile && /\.(md|markdown)$/i.test(item.name)) {
      paths.add(itemPath)
    }
    if (item.children?.length) {
      for (const childPath of collectMarkdownFilePaths(item.children, itemPath)) {
        paths.add(childPath)
      }
    }
  }
  return paths
}

export function buildKeywordClusterGraph(
  topics: NoteTopic[],
  fileTree: DirTree[],
  options: Partial<KeywordClusterOptions> = {},
): KeywordClusterGraph {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options }
  const markdownFiles = collectMarkdownFilePaths(fileTree)
  const noteKeywords = collectNoteKeywords(topics, markdownFiles, resolvedOptions)
  const keywordAggregates = collectKeywordAggregates(noteKeywords, resolvedOptions)
  const noteIndex = buildNoteIndex(noteKeywords, keywordAggregates)
  const cooccurrenceEdges = buildCooccurrenceEdges(noteKeywords, keywordAggregates, resolvedOptions)
  const components = normalizeThemeComponents(
    buildConnectedComponents(keywordAggregates, cooccurrenceEdges),
    keywordAggregates,
    cooccurrenceEdges,
    resolvedOptions,
  )
  const clusters = buildClusters(components, keywordAggregates, resolvedOptions)
  const keywordNodes = buildKeywordNodes(clusters, keywordAggregates, cooccurrenceEdges, resolvedOptions)
  const keywordIndex = new Map<string, KeywordClusterKeyword>()
  for (const node of keywordNodes) {
    keywordIndex.set(node.keyword, node)
  }

  const clusterKeywordEdges: KeywordClusterEdge[] = keywordNodes
    .filter((node): node is KeywordClusterKeyword & { clusterId: string } => Boolean(node.clusterId))
    .map(node => ({
      source: node.clusterId,
      target: node.id,
      type: 'cluster-keyword',
      weight: Math.max(node.avgWeight, 0.1),
    }))

  return {
    clusters,
    keywordNodes,
    edges: [
      ...clusterKeywordEdges,
      ...cooccurrenceEdges.filter(edge => {
        const source = getKeywordNodeByNormalized(keywordNodes, edge.source)
        const target = getKeywordNodeByNormalized(keywordNodes, edge.target)
        if (!source || !target) return false
        edge.source = source.id
        edge.target = target.id
        return true
      }),
    ],
    keywordIndex,
    noteIndex,
  }
}

export function getClusterDetail(graph: KeywordClusterGraph, clusterId: string): KeywordCluster | null {
  return graph.clusters.find(cluster => cluster.id === clusterId) ?? null
}

export function getKeywordDetail(graph: KeywordClusterGraph, keywordId: string): KeywordClusterKeyword | null {
  return graph.keywordNodes.find(node => node.id === keywordId || node.keyword === keywordId) ?? null
}

export function getNotesForCluster(graph: KeywordClusterGraph, clusterId: string): KeywordClusterNoteRef[] {
  const cluster = getClusterDetail(graph, clusterId)
  if (!cluster) return []
  return cluster.notePaths
    .map(path => graph.noteIndex.get(path))
    .filter((note): note is KeywordClusterNoteRef => Boolean(note))
    .map(note => ({
      ...note,
      keywords: note.keywords.filter(item => cluster.keywords.includes(item.keyword)),
      score: note.keywords
        .filter(item => cluster.keywords.includes(item.keyword))
        .reduce((sum, item) => sum + item.weight, 0),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
}

export function getNotesForKeyword(graph: KeywordClusterGraph, keywordId: string): KeywordClusterNoteRef[] {
  const keyword = getKeywordDetail(graph, keywordId)
  if (!keyword) return []
  return keyword.notePaths
    .map(path => graph.noteIndex.get(path))
    .filter((note): note is KeywordClusterNoteRef => Boolean(note))
    .map(note => ({
      ...note,
      keywords: note.keywords.filter(item => item.keyword === keyword.keyword),
      score: note.keywords.find(item => item.keyword === keyword.keyword)?.weight ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
}

function collectNoteKeywords(
  topics: NoteTopic[],
  markdownFiles: Set<string>,
  options: KeywordClusterOptions,
): Map<string, NoteKeyword[]> {
  const grouped = new Map<string, Map<string, NoteKeyword>>()
  for (const topic of topics) {
    if (!markdownFiles.has(topic.filename)) continue
    const keyword = topic.keyword.trim()
    if (!keyword) continue
    const normalized = normalizeKeyword(keyword)
    const byKeyword = grouped.get(topic.filename) ?? new Map<string, NoteKeyword>()
    const existing = byKeyword.get(normalized)
    if (!existing || topic.weight > existing.weight) {
      byKeyword.set(normalized, { keyword, normalized, weight: topic.weight })
    }
    grouped.set(topic.filename, byKeyword)
  }

  const noteKeywords = new Map<string, NoteKeyword[]>()
  for (const [filename, keywords] of grouped) {
    const sorted = Array.from(keywords.values())
      .sort((a, b) => b.weight - a.weight || a.keyword.localeCompare(b.keyword))
      .slice(0, Math.max(1, options.topKeywordsPerNote))
    if (sorted.length > 0) noteKeywords.set(filename, sorted)
  }
  return noteKeywords
}

function collectKeywordAggregates(
  noteKeywords: Map<string, NoteKeyword[]>,
  options: KeywordClusterOptions,
): Map<string, KeywordAggregate> {
  const aggregates = new Map<string, KeywordAggregate>()
  for (const [filename, keywords] of noteKeywords) {
    for (const keyword of keywords) {
      const aggregate = aggregates.get(keyword.normalized) ?? {
        keyword: keyword.keyword,
        normalized: keyword.normalized,
        totalWeight: 0,
        noteWeights: new Map<string, number>(),
      }
      aggregate.keyword = chooseKeywordDisplay(aggregate.keyword, keyword.keyword)
      aggregate.totalWeight += keyword.weight
      aggregate.noteWeights.set(filename, Math.max(aggregate.noteWeights.get(filename) ?? 0, keyword.weight))
      aggregates.set(keyword.normalized, aggregate)
    }
  }

  for (const [normalized, aggregate] of aggregates) {
    if (aggregate.noteWeights.size < options.minKeywordNoteCount) {
      aggregates.delete(normalized)
    }
  }
  return aggregates
}

function buildNoteIndex(
  noteKeywords: Map<string, NoteKeyword[]>,
  aggregates: Map<string, KeywordAggregate>,
): Map<string, KeywordClusterNoteRef> {
  const index = new Map<string, KeywordClusterNoteRef>()
  for (const [path, keywords] of noteKeywords) {
    const usable = keywords
      .filter(keyword => aggregates.has(keyword.normalized))
      .map(keyword => ({ keyword: aggregates.get(keyword.normalized)?.keyword ?? keyword.keyword, weight: keyword.weight }))
      .sort((a, b) => b.weight - a.weight || a.keyword.localeCompare(b.keyword))
    if (usable.length === 0) continue
    index.set(path, {
      path,
      label: getNoteLabel(path),
      keywords: usable,
      score: usable.reduce((sum, keyword) => sum + keyword.weight, 0),
    })
  }
  return index
}

function buildCooccurrenceEdges(
  noteKeywords: Map<string, NoteKeyword[]>,
  aggregates: Map<string, KeywordAggregate>,
  options: KeywordClusterOptions,
): KeywordClusterEdge[] {
  const edgeWeights = new Map<string, number>()
  const edgeNoteCounts = new Map<string, number>()
  for (const keywords of noteKeywords.values()) {
    const usable = keywords
      .filter(keyword => aggregates.has(keyword.normalized))
      .slice(0, Math.max(1, options.topKeywordsPerNote))
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const a = usable[i]
        const b = usable[j]
        const [source, target] = [a.normalized, b.normalized].sort()
        const key = `${source}\u0000${target}`
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + Math.min(a.weight, b.weight))
        edgeNoteCounts.set(key, (edgeNoteCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const weights = Array.from(edgeWeights.values()).sort((a, b) => a - b)
  const median = weights.length ? weights[Math.floor(weights.length / 2)] : 0
  const threshold = weights.length > 8 ? Math.max(0.35, median * 1.05) : 0.35

  return Array.from(edgeWeights.entries())
    .filter(([key, weight]) => {
      const noteCount = edgeNoteCounts.get(key) ?? 0
      return noteCount >= options.minCooccurrenceNoteCount && weight >= threshold
    })
    .map(([key, weight]) => {
      const [source, target] = key.split('\u0000')
      return {
        source,
        target,
        type: 'keyword-cooccurrence' as const,
        weight,
        noteCount: edgeNoteCounts.get(key) ?? 0,
      }
    })
    .sort((a, b) => (b.noteCount ?? 0) - (a.noteCount ?? 0) || b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
}

function buildConnectedComponents(
  aggregates: Map<string, KeywordAggregate>,
  edges: KeywordClusterEdge[],
): string[][] {
  const adjacency = new Map<string, Set<string>>()
  for (const normalized of aggregates.keys()) adjacency.set(normalized, new Set<string>())
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }

  const visited = new Set<string>()
  const components: string[][] = []
  for (const normalized of Array.from(aggregates.keys()).sort()) {
    if (visited.has(normalized)) continue
    const component: string[] = []
    const queue = [normalized]
    visited.add(normalized)
    while (queue.length) {
      const current = queue.shift()!
      component.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    components.push(sortKeywordsBySignal(component, aggregates))
  }
  return components.sort((a, b) => componentScore(b, aggregates) - componentScore(a, aggregates) || a[0].localeCompare(b[0]))
}

function normalizeThemeComponents(
  components: string[][],
  aggregates: Map<string, KeywordAggregate>,
  edges: KeywordClusterEdge[],
  options: KeywordClusterOptions,
): string[][] {
  const strongComponents = components.filter(component => {
    if (component.length < 2) return false
    const notePaths = new Set<string>()
    for (const normalized of component) {
      for (const path of aggregates.get(normalized)?.noteWeights.keys() ?? []) {
        notePaths.add(path)
      }
    }
    return notePaths.size >= options.minCooccurrenceNoteCount
  })

  const splitComponents = strongComponents.flatMap(component => splitOversizedComponent(component, aggregates, edges, options))
  let normalized = splitComponents
    .filter(component => component.length > 0)
    .sort((a, b) => componentScore(b, aggregates) - componentScore(a, aggregates) || a[0].localeCompare(b[0]))

  normalized = normalized.map(component => component.slice(0, Math.max(1, options.maxKeywordsPerCluster)))

  while (normalized.length > Math.max(1, options.maxClusters)) {
    const smallest = normalized.pop()
    if (!smallest || normalized.length === 0) break
    const targetIndex = findNearestComponentIndex(smallest, normalized, aggregates, edges)
    normalized[targetIndex] = sortKeywordsBySignal([...normalized[targetIndex], ...smallest], aggregates)
      .slice(0, Math.max(1, options.maxKeywordsPerCluster))
  }

  return normalized.filter(component => component.length > 0)
}

function splitOversizedComponent(
  component: string[],
  aggregates: Map<string, KeywordAggregate>,
  edges: KeywordClusterEdge[],
  options: KeywordClusterOptions,
): string[][] {
  const maxSize = Math.max(1, options.maxKeywordsPerCluster)
  if (component.length <= maxSize) return [component]

  const seedCount = Math.min(Math.ceil(component.length / maxSize), Math.max(1, options.maxClusters))
  const seeds = sortKeywordsBySignal(component, aggregates).slice(0, seedCount)
  const groups = seeds.map(seed => [seed])
  const assigned = new Set(seeds)
  for (const keyword of sortKeywordsBySignal(component, aggregates)) {
    if (assigned.has(keyword)) continue
    let bestIndex = 0
    let bestScore = -1
    for (let index = 0; index < groups.length; index++) {
      const score = groups[index].reduce((sum, other) => sum + getEdgeWeight(keyword, other, edges), 0)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }
    groups[bestIndex].push(keyword)
  }
  return groups.map(group => sortKeywordsBySignal(group, aggregates).slice(0, maxSize))
}

function buildClusters(
  components: string[][],
  aggregates: Map<string, KeywordAggregate>,
  options: KeywordClusterOptions,
): KeywordCluster[] {
  return components.map((component, index) => {
    const sorted = sortKeywordsBySignal(component, aggregates).slice(0, Math.max(1, options.maxKeywordsPerCluster))
    const notePaths = Array.from(new Set(sorted.flatMap(normalized => Array.from(aggregates.get(normalized)?.noteWeights.keys() ?? []))))
      .sort()
    const label = buildClusterLabel(sorted, aggregates)
    const position = clusterPosition(index, components.length)
    return {
      id: `cluster-${index}-${slugify(label)}`,
      label,
      color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
      keywords: sorted.map(normalized => aggregates.get(normalized)?.keyword ?? normalized),
      notePaths,
      totalWeight: sorted.reduce((sum, normalized) => sum + (aggregates.get(normalized)?.totalWeight ?? 0), 0),
      noteCount: notePaths.length,
      x: position.x,
      y: position.y,
      radius: Math.max(54, Math.min(138, 38 + Math.sqrt(sorted.length) * 18 + notePaths.length * 1.5)),
    }
  })
}

function buildKeywordNodes(
  clusters: KeywordCluster[],
  aggregates: Map<string, KeywordAggregate>,
  edges: KeywordClusterEdge[],
  options: KeywordClusterOptions,
): KeywordClusterKeyword[] {
  const nodes: KeywordClusterKeyword[] = []
  const assigned = new Set<string>()
  for (const cluster of clusters) {
    const sorted = cluster.keywords
      .map(keyword => normalizeKeyword(keyword))
      .filter(normalized => aggregates.has(normalized))
      .slice(0, Math.max(1, options.maxKeywordsPerCluster))
    sorted.forEach((normalized, index) => {
      const aggregate = aggregates.get(normalized)!
      assigned.add(normalized)
      const angle = (index / Math.max(sorted.length, 1)) * Math.PI * 2 + ((index % 2) * 0.18)
      const orbit = cluster.radius + 24 + Math.floor(index / 8) * 16
      const avgWeight = aggregate.totalWeight / Math.max(aggregate.noteWeights.size, 1)
      nodes.push({
        id: `keyword-${slugify(normalized)}`,
        keyword: aggregate.keyword,
        clusterId: cluster.id,
        notePaths: Array.from(aggregate.noteWeights.keys()).sort(),
        totalWeight: aggregate.totalWeight,
        avgWeight,
        noteCount: aggregate.noteWeights.size,
        x: cluster.x + Math.cos(angle) * orbit,
        y: cluster.y + Math.sin(angle) * orbit,
        radius: Math.max(4, Math.min(13, 3 + Math.sqrt(aggregate.totalWeight) * 3 + aggregate.noteWeights.size)),
      })
    })
  }

  const freeKeywords = sortKeywordsBySignal(
    Array.from(aggregates.keys()).filter(normalized => !assigned.has(normalized)),
    aggregates,
  )
  freeKeywords.forEach((normalized, index) => {
    const aggregate = aggregates.get(normalized)!
    const position = freeKeywordPosition(index, freeKeywords.length, clusters, edges, normalized)
    const avgWeight = aggregate.totalWeight / Math.max(aggregate.noteWeights.size, 1)
    nodes.push({
      id: `keyword-${slugify(normalized)}`,
      keyword: aggregate.keyword,
      clusterId: null,
      notePaths: Array.from(aggregate.noteWeights.keys()).sort(),
      totalWeight: aggregate.totalWeight,
      avgWeight,
      noteCount: aggregate.noteWeights.size,
      x: position.x,
      y: position.y,
      radius: Math.max(3.5, Math.min(11, 3 + Math.sqrt(aggregate.totalWeight) * 2.4 + aggregate.noteWeights.size * 0.8)),
    })
  })
  return nodes
}

function buildClusterLabel(sorted: string[], aggregates: Map<string, KeywordAggregate>) {
  const labels = sorted
    .map(normalized => aggregates.get(normalized)?.keyword ?? normalized)
    .filter(keyword => keyword.length <= 18)
    .slice(0, 2)
  return labels.length > 0 ? labels.join(' / ') : '主题'
}

function normalizeKeyword(keyword: string) {
  return keyword.trim().toLocaleLowerCase()
}

function chooseKeywordDisplay(current: string, next: string) {
  if (next.length < current.length) return next
  return current
}

function keywordSignal(normalized: string, aggregates: Map<string, KeywordAggregate>) {
  const aggregate = aggregates.get(normalized)
  if (!aggregate) return 0
  return aggregate.noteWeights.size * 4 + aggregate.totalWeight
}

function sortKeywordsBySignal(keywords: string[], aggregates: Map<string, KeywordAggregate>) {
  return [...keywords].sort((a, b) => keywordSignal(b, aggregates) - keywordSignal(a, aggregates) || a.localeCompare(b))
}

function componentScore(component: string[], aggregates: Map<string, KeywordAggregate>) {
  return component.reduce((sum, normalized) => sum + keywordSignal(normalized, aggregates), 0)
}

function findNearestComponentIndex(
  keywords: string[],
  components: string[][],
  aggregates: Map<string, KeywordAggregate>,
  edges: KeywordClusterEdge[],
) {
  let bestIndex = 0
  let bestScore = -1
  for (let index = 0; index < components.length; index++) {
    const edgeScore = keywords.reduce((sum, keyword) => {
      return sum + components[index].reduce((innerSum, other) => innerSum + getEdgeWeight(keyword, other, edges), 0)
    }, 0)
    const score = edgeScore + componentScore(components[index], aggregates) * 0.001
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
}

function getEdgeWeight(a: string, b: string, edges: KeywordClusterEdge[]) {
  const [source, target] = [a, b].sort()
  return edges.find(edge => edge.source === source && edge.target === target)?.weight ?? 0
}

function clusterPosition(index: number, total: number) {
  if (index === 0) return { x: 0, y: 0 }
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const radius = 230 + Math.sqrt(index) * 92 + total * 8
  const angle = index * goldenAngle
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function freeKeywordPosition(
  index: number,
  total: number,
  clusters: KeywordCluster[],
  edges: KeywordClusterEdge[],
  normalized: string,
) {
  const nearestCluster = findNearestClusterByEdges(normalized, clusters, edges)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const ring = Math.floor(index / 18)

  if (nearestCluster) {
    const angle = index * goldenAngle + ring * 0.23
    const radius = nearestCluster.radius + 118 + (index % 9) * 20 + ring * 42
    return {
      x: nearestCluster.x + Math.cos(angle) * radius,
      y: nearestCluster.y + Math.sin(angle) * radius,
    }
  }

  const angle = index * goldenAngle
  const radius = 340 + Math.sqrt(index + 1) * 58 + Math.min(total, 80) * 2.5
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function findNearestClusterByEdges(
  normalized: string,
  clusters: KeywordCluster[],
  edges: KeywordClusterEdge[],
) {
  let best: KeywordCluster | null = null
  let bestScore = 0
  for (const cluster of clusters) {
    const clusterKeywords = new Set(cluster.keywords.map(keyword => normalizeKeyword(keyword)))
    const score = edges.reduce((sum, edge) => {
      if (edge.source === normalized && clusterKeywords.has(edge.target)) return sum + edge.weight
      if (edge.target === normalized && clusterKeywords.has(edge.source)) return sum + edge.weight
      return sum
    }, 0)
    if (score > bestScore) {
      best = cluster
      bestScore = score
    }
  }
  return best
}

function getKeywordNodeByNormalized(nodes: KeywordClusterKeyword[], normalized: string) {
  return nodes.find(node => normalizeKeyword(node.keyword) === normalized)
}

function getNoteLabel(path: string) {
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.(md|markdown)$/i, '')
}

function slugify(value: string) {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || encodeURIComponent(value.toLocaleLowerCase()).replace(/%/g, '').slice(0, 24) || 'item'
}
