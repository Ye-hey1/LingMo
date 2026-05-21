import type { Tool } from '../types'

export const knowledgeGraphTools: Tool[] = []

export const getConnectedNotesTool: Tool = {
  name: 'get_connected_notes',
  description: 'Get notes connected to a specific note via wiki-links ([[links]]) or semantic similarity. Returns connected note paths and connection types.',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the note to find connections for' },
    { name: 'maxResults', type: 'number', required: false, description: 'Maximum number of results (default: 10)' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useNoteIndexStore } = await import('@/stores/note-index')
    const articleStore = useArticleStore.getState()
    const noteIndexStore = useNoteIndexStore.getState()

    // Ensure index is built
    if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
      await noteIndexStore.buildIndex(articleStore.fileTree)
    }

    const maxResults = params.maxResults || 10
    const backlinks = noteIndexStore.getBacklinks(params.filePath) || []
    const mentions = noteIndexStore.getUnlinkedMentions(params.filePath) || []

    // Build a set of connected paths
    const connected = new Map<string, { path: string; type: string; context?: string }>()

    for (const bl of backlinks) {
      connected.set(bl.sourcePath, { path: bl.sourcePath, type: 'wikilink (backlink)', context: bl.context })
    }

    for (const mention of mentions.slice(0, maxResults)) {
      if (!connected.has(mention.sourcePath)) {
        connected.set(mention.sourcePath, { path: mention.sourcePath, type: 'unlinked mention', context: mention.context })
      }
    }

    // Also find outgoing links from the file
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { path, baseDir } = await getFilePathOptions(params.filePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)

      const { extractWikiLinks } = await import('@/lib/wikilink-extension')
      const outgoingLinks = extractWikiLinks(content)
      for (const link of outgoingLinks) {
        if (!connected.has(link) && link !== params.filePath) {
          connected.set(link, { path: link, type: 'wikilink (outgoing)' })
        }
      }
    } catch {
      // Ignore read errors
    }

    // 加载语义关系连接
    try {
      const { getCrossValidatedRelations } = await import('@/lib/relation-engine')
      const semanticRels = await getCrossValidatedRelations(params.filePath, 0.3)
      for (const rel of semanticRels.slice(0, maxResults)) {
        if (!connected.has(rel.target_note)) {
          connected.set(rel.target_note, {
            path: rel.target_note,
            type: `semantic (${rel.relation_type})`,
            context: rel.evidence || `置信度: ${(rel.final_score * 100).toFixed(1)}%`,
          })
        }
      }
    } catch {
      // 语义关系可能未初始化
    }

    const results = Array.from(connected.values()).slice(0, maxResults)

    if (results.length === 0) {
      return { success: true, message: `No connected notes found for "${params.filePath}".`, data: [] }
    }

    const list = results.map(r => `- ${r.path} (${r.type})`).join('\n')
    return {
      success: true,
      message: `Found ${results.length} connected note(s) for "${params.filePath}":\n${list}`,
      data: results,
    }
  },
}

export const getGraphOverviewTool: Tool = {
  name: 'get_graph_overview',
  description: 'Get an overview of the knowledge graph: total notes, total connections, hub notes (most connected), and isolated notes.',
  category: 'note',
  parameters: [],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async () => {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useNoteIndexStore } = await import('@/stores/note-index')
    const { getAllMarkdownFiles } = await import('@/lib/files')
    const articleStore = useArticleStore.getState()
    const noteIndexStore = useNoteIndexStore.getState()

    // Ensure index is built
    if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
      await noteIndexStore.buildIndex(articleStore.fileTree)
    }

    const allFiles = await getAllMarkdownFiles()
    const connectionCounts = new Map<string, number>()
    const edgeKeys = new Set<string>()
    const edgeTypeCounts = new Map<string, number>()

    const addGraphEdge = (source: string, target: string, type: string) => {
      if (!source || !target || source === target) return
      const key = [source, target].sort().join('->')
      if (edgeKeys.has(key)) return
      edgeKeys.add(key)
      connectionCounts.set(source, (connectionCounts.get(source) || 0) + 1)
      connectionCounts.set(target, (connectionCounts.get(target) || 0) + 1)
      edgeTypeCounts.set(type, (edgeTypeCounts.get(type) || 0) + 1)
    }

    for (const file of allFiles) {
      const backlinks = noteIndexStore.getBacklinks(file.relativePath) || []
      for (const bl of backlinks) {
        addGraphEdge(bl.sourcePath, file.relativePath, 'wikilink')
      }
    }

    try {
      const { getAllRelations } = await import('@/db/note-relations')
      const semanticRelations = await getAllRelations('cross_validated')
      for (const rel of semanticRelations) {
        if (rel.confidence >= 0.35) {
          addGraphEdge(rel.source_note, rel.target_note, rel.relation_type === 'related' ? 'semantic' : `semantic:${rel.relation_type}`)
        }
      }
    } catch {
      // Semantic relation storage may not be initialized yet.
    }

    // Hub notes (4+ connections)
    const hubs = Array.from(connectionCounts.entries())
      .filter(([_, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, connections: count }))

    // Isolated notes (no connections)
    const isolated = allFiles
      .map(f => f.relativePath)
      .filter(p => !connectionCounts.has(p) || connectionCounts.get(p) === 0)
    const isolatedSample = isolated.slice(0, 20)

    const totalEdges = edgeKeys.size
    const edgeTypes = Array.from(edgeTypeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }))

    const overview = {
      totalNotes: allFiles.length,
      totalConnections: totalEdges,
      edgeTypes,
      hubs,
      isolatedCount: isolated.length,
      isolatedSample,
    }

    const hubList = hubs.map(h => `  - ${h.path}: ${h.connections} connections`).join('\n')
    const edgeTypeList = edgeTypes.map(item => `  - ${item.type}: ${item.count}`).join('\n')

    return {
      success: true,
      message: `Knowledge graph overview:\n- Total notes: ${overview.totalNotes}\n- Total connections: ${overview.totalConnections}\n- Edge types:\n${edgeTypeList || '  (none)'}\n- Hub notes (4+ connections):\n${hubList || '  (none)'}\n- Isolated notes: ${overview.isolatedCount}`,
      data: overview,
    }
  },
}

export const getNoteBacklinksTool: Tool = {
  name: 'get_note_backlinks',
  description: 'Get all backlinks (other notes that link to this note) for a specific file. Shows source file, line number, and context.',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the note to get backlinks for' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useNoteIndexStore } = await import('@/stores/note-index')
    const articleStore = useArticleStore.getState()
    const noteIndexStore = useNoteIndexStore.getState()

    if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
      await noteIndexStore.buildIndex(articleStore.fileTree)
    }

    const backlinks = noteIndexStore.getBacklinks(params.filePath) || []

    if (backlinks.length === 0) {
      return { success: true, message: `No backlinks found for "${params.filePath}".`, data: [] }
    }

    const list = backlinks.map((bl: any) => `- ${bl.sourcePath} (line ${bl.line}): "${bl.context.slice(0, 80)}..."`).join('\n')
    return {
      success: true,
      message: `Found ${backlinks.length} backlink(s) for "${params.filePath}":\n${list}`,
      data: backlinks,
    }
  },
}

knowledgeGraphTools.push(getConnectedNotesTool, getGraphOverviewTool, getNoteBacklinksTool)

// Build adjacency list from backlink index
async function buildAdjacency(): Promise<{
  adj: Map<string, Set<string>>
  edgeTypes: Map<string, string>
}> {
  const { default: useArticleStore } = await import('@/stores/article')
  const { useNoteIndexStore } = await import('@/stores/note-index')
  const articleStore = useArticleStore.getState()
  const noteIndexStore = useNoteIndexStore.getState()

  if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
    await noteIndexStore.buildIndex(articleStore.fileTree)
  }

  const adj = new Map<string, Set<string>>()
  const edgeTypes = new Map<string, string>()

  const addEdge = (a: string, b: string, type: string) => {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
    const key = [a, b].sort().join('->')
    edgeTypes.set(key, type)
  }

  // Add wikilink edges from backlinks
  const { backlinks } = noteIndexStore
  for (const [targetPath, refs] of backlinks) {
    for (const ref of refs) {
      addEdge(ref.sourcePath, targetPath, 'wikilink')
    }
  }

  // Add outgoing links for bidirectional coverage
  const { getAllMarkdownFiles } = await import('@/lib/files')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const { getFilePathOptions } = await import('@/lib/workspace')
  const { extractWikiLinks } = await import('@/lib/wikilink-extension')
  const files = await getAllMarkdownFiles()

  for (const file of files) {
    try {
      const { path, baseDir } = await getFilePathOptions(file.relativePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
      const links = extractWikiLinks(content)
      for (const link of links) {
        if (link !== file.relativePath) {
          addEdge(file.relativePath, link, 'wikilink')
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  // 加载语义关联边
  try {
    const { getAllRelations } = await import('@/db/note-relations')
    const semanticRelations = await getAllRelations('cross_validated')
    for (const rel of semanticRelations) {
      if (rel.confidence >= 0.4) {
        const edgeType = rel.relation_type === 'related' ? 'semantic' : `semantic:${rel.relation_type}`
        addEdge(rel.source_note, rel.target_note, edgeType)
      }
    }
  } catch {
    // 语义关系表可能尚未初始化
  }

  return { adj, edgeTypes }
}

export const findPathBetweenNotesTool: Tool = {
  name: 'find_path_between_notes',
  description: 'Find the shortest path between two notes in the knowledge graph using wiki-links. Returns the path with intermediate notes and connection types. Max depth: 4 hops.',
  category: 'note',
  parameters: [
    { name: 'fromPath', type: 'string', required: true, description: 'Path of the source note' },
    { name: 'toPath', type: 'string', required: true, description: 'Path of the target note' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const { adj, edgeTypes } = await buildAdjacency()

    const from = params.fromPath
    const to = params.toPath

    if (!adj.has(from)) {
      return { success: true, message: `"${from}" has no connections in the graph.`, data: [] }
    }
    if (!adj.has(to)) {
      return { success: true, message: `"${to}" has no connections in the graph.`, data: [] }
    }
    if (from === to) {
      return { success: true, message: 'Source and target are the same note.', data: [{ path: [from], hops: 0 }] }
    }

    // BFS
    const visited = new Set<string>([from])
    const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }]

    while (queue.length > 0) {
      const { node, path } = queue.shift()!
      if (path.length > 5) continue // max 4 hops

      const neighbors = adj.get(node)
      if (!neighbors) continue

      for (const neighbor of neighbors) {
        if (neighbor === to) {
          const fullPath = [...path, neighbor]
          const hops = fullPath.length - 1
          const pathDesc = fullPath.map((p, i) => {
            if (i === fullPath.length - 1) return p
            const key = [p, fullPath[i + 1]].sort().join('->')
            const type = edgeTypes.get(key) || 'link'
            return `${p} --(${type})-->`
          }).join('\n  ')

          return {
            success: true,
            message: `Found path (${hops} hop${hops > 1 ? 's' : ''}):\n  ${pathDesc}`,
            data: { path: fullPath, hops },
          }
        }

        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push({ node: neighbor, path: [...path, neighbor] })
        }
      }
    }

    return {
      success: true,
      message: `No path found between "${from}" and "${to}" within 4 hops.`,
      data: [],
    }
  },
}

export const discoverNoteClustersTool: Tool = {
  name: 'discover_note_clusters',
  description: 'Discover clusters/communities of related notes in the knowledge graph based on connection density. Returns groups of notes that are densely connected to each other.',
  category: 'note',
  parameters: [
    { name: 'minClusterSize', type: 'number', required: false, description: 'Minimum notes per cluster (default: 3)' },
    { name: 'maxClusters', type: 'number', required: false, description: 'Maximum clusters to return (default: 10)' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const { adj } = await buildAdjacency()
    const minSize = params.minClusterSize || 3
    const maxClusters = params.maxClusters || 10

    // Simple label-propagation clustering
    const labels = new Map<string, number>()
    let nextLabel = 0

    // Assign initial labels by connected component via BFS
    const visited = new Set<string>()
    for (const [node] of adj) {
      if (visited.has(node)) continue
      const label = nextLabel++
      const queue = [node]
      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        labels.set(current, label)
        const neighbors = adj.get(current)
        if (neighbors) {
          for (const n of neighbors) {
            if (!visited.has(n)) queue.push(n)
          }
        }
      }
    }

    // Refine: split large components by edge density (cut sparse bridges)
    const clusters = new Map<number, string[]>()
    for (const [node, label] of labels) {
      if (!clusters.has(label)) clusters.set(label, [])
      clusters.get(label)!.push(node)
    }

    // For large clusters, try to split by removing weak bridges
    const refinedClusters: Array<{ id: number; notes: string[]; density: number }> = []
    let clusterId = 0

    for (const [, nodes] of clusters) {
      if (nodes.length < minSize) continue

      // Calculate density: edges within cluster / possible edges
      const nodeSet = new Set(nodes)
      let internalEdges = 0
      for (const node of nodes) {
        const neighbors = adj.get(node)
        if (!neighbors) continue
        for (const n of neighbors) {
          if (nodeSet.has(n)) internalEdges++
        }
      }
      internalEdges /= 2 // undirected
      const maxEdges = (nodes.length * (nodes.length - 1)) / 2
      const density = maxEdges > 0 ? internalEdges / maxEdges : 0

      // If cluster is too large and not dense, try to split
      if (nodes.length > 20 && density < 0.15) {
        // Split by top-k hubs
        const sorted = nodes.sort((a, b) => (adj.get(b)?.size || 0) - (adj.get(a)?.size || 0))
        const hubCount = Math.max(2, Math.floor(sorted.length / 8))
        const hubs = sorted.slice(0, hubCount)

        for (const hub of hubs) {
          const subCluster = [hub]
          const neighbors = adj.get(hub)
          if (neighbors) {
            for (const n of neighbors) {
              if (nodeSet.has(n)) subCluster.push(n)
            }
          }
          const uniqueSub = [...new Set(subCluster)]
          if (uniqueSub.length >= minSize) {
            const subNodeSet = new Set(uniqueSub)
            let subEdges = 0
            for (const n of uniqueSub) {
              const nb = adj.get(n)
              if (nb) for (const x of nb) { if (subNodeSet.has(x)) subEdges++ }
            }
            subEdges /= 2
            const subMax = (uniqueSub.length * (uniqueSub.length - 1)) / 2
            refinedClusters.push({
              id: clusterId++,
              notes: uniqueSub.slice(0, 15),
              density: subMax > 0 ? subEdges / subMax : 0,
            })
          }
        }
      } else {
        refinedClusters.push({
          id: clusterId++,
          notes: nodes.slice(0, 15),
          density,
        })
      }
    }

    // Sort by size descending
    refinedClusters.sort((a, b) => b.notes.length - a.notes.length)
    const result = refinedClusters.slice(0, maxClusters)

    if (result.length === 0) {
      return { success: true, message: 'No significant clusters found.', data: [] }
    }

    const list = result.map((c, i) =>
      `Cluster ${i + 1} (${c.notes.length} notes, density: ${(c.density * 100).toFixed(0)}%): ${c.notes.slice(0, 5).join(', ')}${c.notes.length > 5 ? ' ...' : ''}`
    ).join('\n')

    return {
      success: true,
      message: `Found ${result.length} cluster(s):\n${list}`,
      data: result,
    }
  },
}

knowledgeGraphTools.push(findPathBetweenNotesTool, discoverNoteClustersTool)

export const suggestLinksForNoteTool: Tool = {
  name: 'suggest_links_for_note',
  description: 'Analyze a note and suggest wiki-links ([[links]]) to other existing notes based on content relevance. Uses unlinked mentions and title matching to find candidate links. Returns a list of suggested (text, target) pairs.',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the note to analyze' },
    { name: 'maxSuggestions', type: 'number', required: false, description: 'Maximum suggestions (default: 8)' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useNoteIndexStore } = await import('@/stores/note-index')
    const { getAllMarkdownFiles } = await import('@/lib/files')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { getFilePathOptions } = await import('@/lib/workspace')
    const { extractWikiLinks } = await import('@/lib/wikilink-extension')
    const articleStore = useArticleStore.getState()
    const noteIndexStore = useNoteIndexStore.getState()
    const maxSuggestions = params.maxSuggestions || 8

    if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
      await noteIndexStore.buildIndex(articleStore.fileTree)
    }

    // Read current note content
    const { path, baseDir } = await getFilePathOptions(params.filePath)
    const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
    const existingLinks = new Set(extractWikiLinks(content).map(l => l.toLowerCase()))
    const contentLower = content.toLowerCase()

    // Collect all other note titles
    const allFiles = await getAllMarkdownFiles()
    const otherNotes = allFiles.filter(f => f.relativePath !== params.filePath)

    const suggestions: Array<{ text: string; target: string; reason: string; score: number }> = []

    for (const file of otherNotes) {
      const baseName = file.name.replace(/\.md$/, '')
      const baseNameLower = baseName.toLowerCase()

      // Skip already linked
      if (existingLinks.has(baseNameLower)) continue

      // Check if note name appears in content (unlinked mention)
      const escapedName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const mentionRegex = new RegExp(`(?:^|[\\s(（【「『"'])?${escapedName}(?:$|[\\s)）】」』"'.,;:!?、。，；！？])`, 'gi')
      const hasMention = mentionRegex.test(contentLower)

      if (!hasMention) continue

      // Score based on mention count and position
      const matches = contentLower.split(escapedName.toLowerCase()).length - 1
      const firstIndex = contentLower.indexOf(baseNameLower)
      let score = matches
      // Title-level mentions score higher
      if (firstIndex < 100) score += 2

      suggestions.push({
        text: baseName,
        target: baseName,
        reason: `在正文中出现 ${matches} 次${firstIndex < 100 ? '（含标题区域）' : ''}`,
        score,
      })
    }

    // Also check backlinks pointing to this file (notes that reference this file)
    const backlinks = noteIndexStore.getBacklinks(params.filePath) || []
    for (const bl of backlinks) {
      const blName = bl.sourcePath.split('/').pop()?.replace(/\.md$/, '') || ''
      if (!existingLinks.has(blName.toLowerCase()) && blName.length >= 2) {
        const exists = suggestions.some(s => s.target.toLowerCase() === blName.toLowerCase())
        if (!exists) {
          suggestions.push({
            text: blName,
            target: blName,
            reason: `"${blName}" 已链接到本笔记，建议添加反向链接`,
            score: 3,
          })
        }
      }
    }

    // Sort by score descending
    suggestions.sort((a, b) => b.score - a.score)
    const results = suggestions.slice(0, maxSuggestions)

    if (results.length === 0) {
      return { success: true, message: 'No link suggestions found. The note may already be well-linked.', data: [] }
    }

    const list = results.map(s => `- [[${s.target}]]: ${s.reason}`).join('\n')
    return {
      success: true,
      message: `Found ${results.length} link suggestion(s) for "${params.filePath}":\n${list}`,
      data: results,
    }
  },
}

knowledgeGraphTools.push(suggestLinksForNoteTool)

// === 新增：语义关系工具 ===

export const analyzeNoteTopicsTool: Tool = {
  name: 'analyze_note_topics',
  description: '提取并展示笔记的主题关键词，返回关键词及其权重。使用 TextRank 算法从文章内容中提取核心主题。',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: '笔记路径' },
    { name: 'topK', type: 'number', required: false, description: '返回的关键词数量（默认 20）' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      const { path, baseDir } = await getFilePathOptions(params.filePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)

      if (!content || content.trim().length === 0) {
        return { success: true, message: '笔记内容为空，无法提取关键词。', data: [] }
      }

      const { extractAndStoreTopics, getNoteTopics } = await import('@/lib/topic-extractor')
      await extractAndStoreTopics(params.filePath, content, params.topK || 20)
      const topics = await getNoteTopics(params.filePath)

      if (topics.length === 0) {
        return { success: true, message: '未能提取到关键词。', data: [] }
      }

      const list = topics.map(t => `- ${t.keyword} (权重: ${t.weight.toFixed(2)}, 来源: ${t.source})`).join('\n')
      return {
        success: true,
        message: `从 "${params.filePath}" 中提取了 ${topics.length} 个主题关键词:\n${list}`,
        data: topics,
      }
    } catch (error) {
      return { success: false, error: `关键词提取失败: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const buildSemanticRelationsTool: Tool = {
  name: 'build_semantic_relations',
  description: '构建笔记间的语义关系。使用关键词匹配、余弦相似度聚类和可选的 LLM 分析来发现笔记间的深层关联。如果不指定 filePath 则对所有笔记进行分析。',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: false, description: '指定笔记路径（不填则分析所有笔记）' },
    { name: 'includeLLM', type: 'boolean', required: false, description: '是否启用 LLM 深度分析（默认 false，会消耗 API 额度）' },
    { name: 'maxLLMPairs', type: 'number', required: false, description: 'LLM 分析的最大笔记对数量（默认 20）' },
  ],
  requiresConfirmation: true,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    try {
      if (params.filePath) {
        // 单篇分析
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions } = await import('@/lib/workspace')
        const { path, baseDir } = await getFilePathOptions(params.filePath)
        const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)

        if (!content || content.trim().length === 0) {
          return { success: true, message: '笔记内容为空。', data: [] }
        }

        const { buildRelationsForNote } = await import('@/lib/relation-engine')
        const result = await buildRelationsForNote(params.filePath, content, params.includeLLM || false)

        return {
          success: true,
          message: `关系构建完成:\n- 提取关键词: ${result.topics} 个\n- 关键词匹配对: ${result.keywordPairs}\n- 余弦相似对: ${result.cosinePairs}\n- LLM 分析对: ${result.llmPairs}\n- 交叉验证关系: ${result.crossValidated}`,
          data: result,
        }
      } else {
        // 全量分析
        const { buildAllRelations } = await import('@/lib/relation-engine')
        const result = await buildAllRelations(
          undefined,
          params.includeLLM || false,
          params.maxLLMPairs || 20,
        )

        return {
          success: true,
          message: `全量关系构建完成:\n- 笔记总数: ${result.totalNotes}\n- 关键词关系: ${result.keywordRelations}\n- 余弦关系: ${result.cosineRelations}\n- LLM 关系: ${result.llmRelations}\n- 交叉验证关系: ${result.crossValidatedRelations}`,
          data: result,
        }
      }
    } catch (error) {
      return { success: false, error: `关系构建失败: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const getSemanticRelationsTool: Tool = {
  name: 'get_semantic_relations',
  description: '获取笔记的语义关系列表。返回通过关键词匹配、余弦相似度和 LLM 分析发现的关联笔记，包含关系类型和置信度。',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: '笔记路径' },
    { name: 'minConfidence', type: 'number', required: false, description: '最低置信度阈值（默认 0.3）' },
    { name: 'method', type: 'string', required: false, description: '按方法过滤: keyword | cosine | llm | cross_validated' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    try {
      const minConfidence = params.minConfidence || 0.3

      if (params.method) {
        // 按方法过滤
        const { getAllRelations } = await import('@/db/note-relations')
        const allRelations = await getAllRelations(params.method)
        const relations = allRelations.filter(r =>
          (r.source_note === params.filePath || r.target_note === params.filePath) && r.confidence >= minConfidence,
        )

        if (relations.length === 0) {
          return { success: true, message: `未找到方法为 "${params.method}" 的关系。`, data: [] }
        }

        const list = relations.map(r => {
          const otherNote = r.source_note === params.filePath ? r.target_note : r.source_note
          return `- ${otherNote} (${r.relation_type}, 置信度: ${(r.confidence * 100).toFixed(1)}%)${r.evidence ? ` — ${r.evidence}` : ''}`
        }).join('\n')

        return {
          success: true,
          message: `通过 "${params.method}" 发现 ${relations.length} 条关系:\n${list}`,
          data: relations,
        }
      }

      // 交叉验证关系
      const { getCrossValidatedRelations } = await import('@/lib/relation-engine')
      const relations = await getCrossValidatedRelations(params.filePath, minConfidence)

      if (relations.length === 0) {
        return { success: true, message: `未找到置信度 ≥ ${minConfidence} 的语义关系。尝试先运行 build_semantic_relations。`, data: [] }
      }

      const list = relations.map(r =>
        `- ${r.target_note} (${r.relation_type}, 置信度: ${(r.final_score * 100).toFixed(1)}%, 共识: ${r.agreement_count}/3)${r.evidence ? ` — ${r.evidence}` : ''}`
      ).join('\n')

      return {
        success: true,
        message: `发现 ${relations.length} 条语义关系:\n${list}`,
        data: relations,
      }
    } catch (error) {
      return { success: false, error: `获取关系失败: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

knowledgeGraphTools.push(analyzeNoteTopicsTool, buildSemanticRelationsTool, getSemanticRelationsTool)
