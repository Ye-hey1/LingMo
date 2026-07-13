import { create } from 'zustand'
import emitter from '@/lib/emitter'
import {
  commitCreativeCanvasGenerationResult,
  createCreativeCanvasAsset,
  createCreativeCanvasId,
  createCreativeCanvasProject,
  deleteCreativeCanvasAssets,
  deleteCreativeCanvasEdge,
  deleteCreativeCanvasNodes,
  deleteCreativeCanvasProject,
  getCreativeCanvasSnapshot,
  initCreativeCanvasDb,
  listCreativeCanvasAssets,
  listCreativeCanvasProjects,
  replaceCreativeCanvasGraph,
  updateCreativeCanvasProject,
  upsertCreativeCanvasAsset,
  upsertCreativeCanvasJob,
  upsertCreativeCanvasNode,
} from '@/db/creative-canvas'
import { upsertKnowledgeObject } from '@/db/knowledge-objects'
import {
  copyCreativeCanvasAssetToWorkspace,
  createAssetFileName,
  createThumbnailFileName,
  getCreativeCanvasAssetUrl,
  getCreativeCanvasThumbnailUrl,
  listCreativeCanvasAssetFiles,
  listCreativeCanvasThumbnailFiles,
  removeCreativeCanvasStoredFile,
  writeCreativeCanvasThumbnailFile,
  writeCreativeCanvasAssetFile,
} from '@/lib/creative-canvas/assets'
import { convertInfiniteCanvasJson, type InfiniteCanvasImportReport } from '@/lib/creative-canvas/importer'
import { findOrphanCreativeCanvasFiles, getKnownCreativeCanvasPaths } from '@/lib/creative-canvas/cleanup'
import { normalizeCanvasViewport } from '@/lib/creative-canvas/geometry'
import {
  editImage,
  generateImage,
  getGenerationType,
  persistGeneratedImage,
  sanitizeGenerationResponseForStorage,
} from '@/lib/creative-canvas/generation'
import type {
  CreativeCanvasAsset,
  CreativeCanvasAssetCleanupPlan,
  CreativeCanvasEdge,
  CreativeCanvasGenerationJob,
  CreativeCanvasJobStatus,
  CreativeCanvasGenerationMode,
  CreativeCanvasGenerationOptions,
  CreativeCanvasNode,
  CreativeCanvasNodeMetadata,
  CreativeCanvasNodeType,
  CreativeCanvasProject,
  CreativeCanvasProjectSettings,
  CreativeCanvasSnapshot,
  CreativeCanvasViewport,
} from '@/types/creative-canvas'

type GraphState = {
  project: CreativeCanvasProject
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}

export type CreativeCanvasOp =
  | { type: 'add_node'; nodeType?: CreativeCanvasNodeType; id?: string; title?: string; x?: number; y?: number; width?: number; height?: number; position?: { x: number; y: number }; metadata?: CreativeCanvasNodeMetadata }
  | { type: 'update_node'; id: string; patch?: Partial<CreativeCanvasNode>; metadata?: CreativeCanvasNodeMetadata }
  | { type: 'delete_node'; id?: string; ids?: string[] }
  | { type: 'delete_connections'; id?: string; ids?: string[]; all?: boolean }
  | { type: 'connect_nodes'; id?: string; fromNodeId: string; toNodeId: string }
  | { type: 'delete_edge'; id: string }
  | { type: 'select_nodes'; ids: string[] }
  | { type: 'set_viewport'; viewport: CreativeCanvasViewport }
  | { type: 'run_generation'; nodeId: string; mode?: CreativeCanvasGenerationMode; prompt?: string }

interface CreativeCanvasState {
  initialized: boolean
  loading: boolean
  error?: string
  projects: CreativeCanvasProject[]
  activeProjectId?: string
  project?: CreativeCanvasProject
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  assets: CreativeCanvasAsset[]
  jobs: CreativeCanvasGenerationJob[]
  selectedNodeIds: string[]
  historyPast: GraphState[]
  historyFuture: GraphState[]
  assetUrls: Record<string, string>
  runningControllers: Record<string, AbortController>
  ensureReady: () => Promise<void>
  loadProjects: () => Promise<CreativeCanvasProject[]>
  openProject: (projectId: string) => Promise<void>
  createProject: (title?: string) => Promise<CreativeCanvasProject>
  deleteProject: (projectId: string) => Promise<void>
  setViewport: (viewport: CreativeCanvasViewport) => Promise<void>
  updateProjectSettings: (patch: Partial<CreativeCanvasProjectSettings>) => Promise<void>
  addNode: (input: { type: CreativeCanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: CreativeCanvasNodeMetadata }) => Promise<CreativeCanvasNode>
  updateNode: (nodeId: string, patch: Partial<CreativeCanvasNode> & { metadata?: CreativeCanvasNodeMetadata }) => Promise<void>
  moveNode: (nodeId: string, x: number, y: number) => Promise<void>
  moveNodes: (positions: Record<string, { x: number; y: number }>) => Promise<void>
  resizeNode: (nodeId: string, width: number, height: number) => Promise<void>
  duplicateNodes: (nodeIds: string[], offset?: { x: number; y: number }) => Promise<CreativeCanvasNode[]>
  deleteSelectedNodes: () => Promise<void>
  deleteNodes: (nodeIds: string[]) => Promise<void>
  connectNodes: (fromNodeId: string, toNodeId: string) => Promise<CreativeCanvasEdge | null>
  deleteEdge: (edgeId: string) => Promise<void>
  selectNodes: (nodeIds: string[]) => void
  importImageAsset: (input: { file: Blob; fileName?: string; title?: string; x?: number; y?: number }) => Promise<{ asset: CreativeCanvasAsset; node: CreativeCanvasNode }>
  addImageNodeFromAsset: (assetId: string, input?: { x?: number; y?: number }) => Promise<CreativeCanvasNode>
  createGenerationFlow: (prompt: string, options?: CreativeCanvasGenerationOptions & { sourcePath?: string; x?: number; y?: number; autoRun?: boolean }) => Promise<{ textNode: CreativeCanvasNode; configNode: CreativeCanvasNode }>
  runGenerationForNode: (nodeId: string, overridePrompt?: string) => Promise<CreativeCanvasJobStatus | undefined>
  runGenerationForNodes: (nodeIds: string[]) => Promise<void>
  cancelGeneration: (jobId: string) => Promise<void>
  insertAssetIntoNote: (assetId: string) => Promise<string>
  getAssetUrl: (asset: CreativeCanvasAsset) => Promise<string>
  getThumbnailUrl: (asset: CreativeCanvasAsset) => Promise<string>
  cacheAssetThumbnail: (assetId: string, bytes: Uint8Array, mimeType: string) => Promise<CreativeCanvasAsset | null>
  recoverStaleJobs: () => Promise<{ staleJobIds: string[] }>
  retryGenerationJob: (jobId: string) => Promise<CreativeCanvasJobStatus | undefined>
  analyzeAssetCleanup: () => Promise<CreativeCanvasAssetCleanupPlan>
  cleanupAssets: (options?: { includeUnusedAssets?: boolean; includeOrphanFiles?: boolean }) => Promise<{ deletedAssetIds: string[]; deletedFiles: string[]; failedFiles: Array<{ path: string; error: string }> }>
  importInfiniteCanvasJson: (input: string | unknown, title?: string) => Promise<InfiniteCanvasImportReport>
  applyOps: (ops: CreativeCanvasOp[]) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  exportSnapshot: () => CreativeCanvasSnapshot | null
}

function now() {
  return Date.now()
}

let openProjectRequestVersion = 0
const deletedProjectIds = new Set<string>()

function createNode(input: {
  projectId: string
  type: CreativeCanvasNodeType
  title?: string
  x?: number
  y?: number
  width?: number
  height?: number
  metadata?: CreativeCanvasNodeMetadata
  id?: string
}): CreativeCanvasNode {
  const ts = now()
  return {
    id: input.id || createCreativeCanvasId('node'),
    projectId: input.projectId,
    type: input.type,
    title: input.title || getDefaultNodeTitle(input.type),
    x: input.x ?? 120,
    y: input.y ?? 120,
    width: input.width ?? (input.type === 'config' ? 300 : 280),
    height: input.height ?? (input.type === 'text' ? 180 : 220),
    metadata: input.metadata || {},
    createdAt: ts,
    updatedAt: ts,
  }
}

function getDefaultNodeTitle(type: CreativeCanvasNodeType) {
  if (type === 'text') return '提示词'
  if (type === 'config') return '生图配置'
  if (type === 'image') return '图片'
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  return '节点'
}

function getGraphState(state: CreativeCanvasState): GraphState | null {
  if (!state.project) return null
  return {
    project: state.project,
    nodes: state.nodes,
    edges: state.edges,
  }
}

function trimHistory(history: GraphState[]) {
  return history.slice(-30)
}

function mergeNodeMetadata(current: CreativeCanvasNode, patch: Partial<CreativeCanvasNode> & { metadata?: CreativeCanvasNodeMetadata }) {
  return {
    ...current.metadata,
    ...(patch.metadata || {}),
  }
}

async function registerGeneratedAssetKnowledgeObject(asset: CreativeCanvasAsset) {
  await upsertKnowledgeObject({
    sourceType: 'creative_asset',
    sourceId: asset.id,
    path: asset.filePath,
    title: asset.title,
    origin: 'agent_generated',
    status: 'active',
    tags: ['creative-canvas'],
    contentHash: asset.hash,
    metadata: {
      kind: asset.kind,
      projectId: asset.projectId,
      prompt: asset.prompt,
      sourceNodeId: asset.sourceNodeId,
      sourceJobId: asset.sourceJobId,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
    },
  })
}

async function createSha256(bytes: Uint8Array) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getImportAssetTitle(fileName?: string, title?: string) {
  return (title || fileName || 'reference-image').trim() || 'reference-image'
}

function getAssetIdsFromNode(node: CreativeCanvasNode) {
  const ids: string[] = []
  if (typeof node.metadata.assetId === 'string' && node.metadata.assetId.trim()) {
    ids.push(node.metadata.assetId)
  }
  if (Array.isArray(node.metadata.referenceIds)) {
    ids.push(...node.metadata.referenceIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))
  }
  return ids
}

function getReferencedAssetIds(nodes: CreativeCanvasNode[], jobs: CreativeCanvasGenerationJob[]) {
  const referenced = new Set<string>()
  for (const node of nodes) {
    for (const id of getAssetIdsFromNode(node)) referenced.add(id)
  }
  for (const job of jobs) {
    if (job.status !== 'succeeded') continue
    for (const id of job.assetIds) referenced.add(id)
  }
  return referenced
}

export async function analyzeCreativeCanvasAssetCleanup(
  snapshot: CreativeCanvasSnapshot | null,
): Promise<CreativeCanvasAssetCleanupPlan> {
  const allProjectAssets = await listCreativeCanvasAssets()
  const nodes = snapshot?.nodes || []
  const jobs = snapshot?.jobs || []
  const persistedAssets = snapshot?.assets || []
  const referencedAssetIds = getReferencedAssetIds(nodes, jobs)
  const knownAssetIds = new Set(persistedAssets.map(asset => asset.id))
  const runningJobIds = new Set(jobs
    .filter(job => job.status === 'queued' || job.status === 'running')
    .map(job => job.id))
  const unusedAssets = persistedAssets.filter(asset =>
    !referencedAssetIds.has(asset.id) && (!asset.sourceJobId || !runningJobIds.has(asset.sourceJobId)))
  const missingAssetIds = Array.from(referencedAssetIds).filter(id => !knownAssetIds.has(id))
  const [assetFiles, thumbnailFiles] = await Promise.all([
    listCreativeCanvasAssetFiles(),
    listCreativeCanvasThumbnailFiles(),
  ])
  const orphanAssetFiles = findOrphanCreativeCanvasFiles(assetFiles, allProjectAssets)
  const orphanThumbnailFiles = findOrphanCreativeCanvasFiles(thumbnailFiles, allProjectAssets)
  const thumbnailBytes = new Map(thumbnailFiles.map(file => [file.path, file.bytes || 0]))
  const reclaimableBytes = unusedAssets.reduce((sum, asset) =>
    sum + asset.bytes + (asset.thumbnailPath ? thumbnailBytes.get(asset.thumbnailPath) || 0 : 0), 0)
    + orphanAssetFiles.reduce((sum, file) => sum + (file.bytes || 0), 0)
    + orphanThumbnailFiles.reduce((sum, file) => sum + (file.bytes || 0), 0)

  return {
    unusedAssets,
    orphanAssetFiles,
    orphanThumbnailFiles,
    missingAssetIds,
    reclaimableBytes,
  }
}

function getJobRecoveryMessage() {
  return '生成任务在上次会话中断，已标记为 stale，可重试。'
}

async function markInterruptedJobsStale(
  snapshot: CreativeCanvasSnapshot,
  runningControllers: Record<string, AbortController>,
) {
  const activeJobIds = new Set(Object.keys(runningControllers))
  const staleJobIds = snapshot.jobs
    .filter(job => (job.status === 'queued' || job.status === 'running') && !activeJobIds.has(job.id))
    .map(job => job.id)

  if (!staleJobIds.length) {
    return { snapshot, staleJobIds }
  }

  const staleJobIdSet = new Set(staleJobIds)
  const ts = now()
  const jobs = snapshot.jobs.map(job => staleJobIdSet.has(job.id)
    ? {
        ...job,
        status: 'stale' as const,
        error: job.error || getJobRecoveryMessage(),
        completedAt: job.completedAt || ts,
        updatedAt: ts,
      }
    : job)
  const nodes = snapshot.nodes.map(node => staleJobIdSet.has(String(node.metadata.jobId || '')) && node.metadata.status === 'running'
    ? {
        ...node,
        metadata: {
          ...node.metadata,
          status: 'stale' as const,
          error: getJobRecoveryMessage(),
        },
        updatedAt: ts,
      }
    : node)

  await Promise.all([
    ...jobs.filter(job => staleJobIdSet.has(job.id)).map(job => upsertCreativeCanvasJob(job)),
    ...nodes.filter(node => staleJobIdSet.has(String(node.metadata.jobId || ''))).map(node => upsertCreativeCanvasNode(node)),
  ])

  return {
    snapshot: {
      ...snapshot,
      nodes,
      jobs,
    },
    staleJobIds,
  }
}

const useCreativeCanvasStore = create<CreativeCanvasState>((set, get) => ({
  initialized: false,
  loading: false,
  projects: [],
  nodes: [],
  edges: [],
  assets: [],
  jobs: [],
  selectedNodeIds: [],
  historyPast: [],
  historyFuture: [],
  assetUrls: {},
  runningControllers: {},

  ensureReady: async () => {
    if (get().initialized) return
    set({ loading: true, error: undefined })
    try {
      await initCreativeCanvasDb()
      const projects = await listCreativeCanvasProjects()
      const project = projects[0] || await createCreativeCanvasProject({ title: '创意画布' })
      set({ projects: projects.length ? projects : [project], initialized: true })
      await get().openProject(project.id)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ loading: false })
    }
  },

  loadProjects: async () => {
    await initCreativeCanvasDb()
    const projects = await listCreativeCanvasProjects()
    set({ projects })
    return projects
  },

  openProject: async (projectId) => {
    const requestVersion = ++openProjectRequestVersion
    set({ loading: true, error: undefined })
    try {
      const snapshot = await getCreativeCanvasSnapshot(projectId)
      if (!snapshot) throw new Error('画布项目不存在。')
      const recovered = await markInterruptedJobsStale(snapshot, get().runningControllers)
      if (requestVersion !== openProjectRequestVersion) return
      set({
        activeProjectId: projectId,
        project: recovered.snapshot.project,
        nodes: recovered.snapshot.nodes,
        edges: recovered.snapshot.edges,
        assets: recovered.snapshot.assets,
        jobs: recovered.snapshot.jobs,
        selectedNodeIds: [],
        historyPast: [],
        historyFuture: [],
      })
    } catch (error) {
      if (requestVersion !== openProjectRequestVersion) return
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (requestVersion === openProjectRequestVersion) set({ loading: false })
    }
  },

  createProject: async (title) => {
    const project = await createCreativeCanvasProject({ title })
    set((state) => ({
      projects: [project, ...state.projects],
      activeProjectId: project.id,
      project,
      nodes: [],
      edges: [],
      assets: [],
      jobs: [],
      selectedNodeIds: [],
      historyPast: [],
      historyFuture: [],
    }))
    return project
  },

  deleteProject: async (projectId) => {
    await get().ensureReady()
    const state = get()
    if (!state.projects.some(item => item.id === projectId)) return

    const deletingActiveProject = state.project?.id === projectId
    const deletingJobIds = new Set(
      deletingActiveProject ? state.jobs.map(job => job.id) : [],
    )
    deletedProjectIds.add(projectId)
    for (const jobId of deletingJobIds) {
      state.runningControllers[jobId]?.abort()
    }

    let deletedAssets: CreativeCanvasAsset[]
    try {
      deletedAssets = await deleteCreativeCanvasProject(projectId)
    } catch (error) {
      deletedProjectIds.delete(projectId)
      throw error
    }

    const remainingProjects = get().projects.filter(item => item.id !== projectId)
    if (deletingActiveProject) {
      openProjectRequestVersion += 1
    }
    set((current) => {
      const projects = current.projects.filter(item => item.id !== projectId)
      if (current.project?.id !== projectId) return { projects }

      return {
        projects,
        activeProjectId: undefined,
        project: undefined,
        nodes: [],
        edges: [],
        assets: [],
        jobs: [],
        selectedNodeIds: [],
        historyPast: [],
        historyFuture: [],
        assetUrls: {},
        runningControllers: Object.fromEntries(
          Object.entries(current.runningControllers)
            .filter(([jobId]) => !deletingJobIds.has(jobId)),
        ),
      }
    })

    const nextProject = remainingProjects[0]
    if (deletingActiveProject && nextProject) {
      await get().openProject(nextProject.id)
    }

    const remainingKnownPaths = getKnownCreativeCanvasPaths(await listCreativeCanvasAssets())
    const deletedFilePaths = deletedAssets.flatMap(asset => [
      asset.filePath,
      ...(asset.thumbnailPath ? [asset.thumbnailPath] : []),
    ]).filter(filePath => !remainingKnownPaths.has(filePath))
    await Promise.allSettled(
      deletedFilePaths.map(filePath => removeCreativeCanvasStoredFile(filePath)),
    )
  },

  setViewport: async (viewport) => {
    const project = get().project
    if (!project) return
    const nextProject = { ...project, viewport: normalizeCanvasViewport(viewport, project.viewport), updatedAt: now() }
    set((state) => ({
      project: nextProject,
      projects: state.projects.map(item => item.id === nextProject.id ? nextProject : item),
    }))
    await updateCreativeCanvasProject(nextProject)
  },

  updateProjectSettings: async (patch) => {
    const project = get().project
    if (!project) return
    const nextProject: CreativeCanvasProject = {
      ...project,
      settings: { ...(project.settings || {}), ...patch },
      updatedAt: now(),
    }
    set((state) => ({
      project: nextProject,
      projects: state.projects.map(item => item.id === nextProject.id ? nextProject : item),
    }))
    await updateCreativeCanvasProject(nextProject)
  },

  addNode: async (input) => {
    await get().ensureReady()
    const state = get()
    if (!state.project) throw new Error('画布未初始化。')
    const previous = getGraphState(state)
    const node = createNode({ ...input, projectId: state.project.id })
    const nextProject = { ...state.project, updatedAt: now() }
    const nextNodes = [...state.nodes, node]
    set({
      project: nextProject,
      nodes: nextNodes,
      selectedNodeIds: [node.id],
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, state.edges)
    return node
  },

  updateNode: async (nodeId, patch) => {
    const state = get()
    const node = state.nodes.find(item => item.id === nodeId)
    if (!node || !state.project) return
    const previous = getGraphState(state)
    const updatedNode: CreativeCanvasNode = {
      ...node,
      ...patch,
      id: node.id,
      projectId: node.projectId,
      metadata: mergeNodeMetadata(node, patch),
      updatedAt: now(),
    }
    const nextNodes = state.nodes.map(item => item.id === nodeId ? updatedNode : item)
    const nextProject = { ...state.project, updatedAt: now() }
    set({
      project: nextProject,
      nodes: nextNodes,
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await upsertCreativeCanvasNode(updatedNode)
  },

  moveNode: async (nodeId, x, y) => {
    await get().moveNodes({ [nodeId]: { x, y } })
  },

  moveNodes: async (positions) => {
    const state = get()
    if (!state.project || !Object.keys(positions).length) return
    const previous = getGraphState(state)
    let changed = false
    const ts = now()
    const nextNodes = state.nodes.map((node) => {
      const position = positions[node.id]
      if (!position || (position.x === node.x && position.y === node.y)) return node
      changed = true
      return { ...node, x: position.x, y: position.y, updatedAt: ts }
    })
    if (!changed) return
    const nextProject = { ...state.project, updatedAt: ts }
    set({
      project: nextProject,
      nodes: nextNodes,
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, state.edges)
  },

  resizeNode: async (nodeId, width, height) => {
    await get().updateNode(nodeId, {
      width: Math.max(180, width),
      height: Math.max(120, height),
    })
  },

  duplicateNodes: async (nodeIds, offset = { x: 32, y: 32 }) => {
    const state = get()
    if (!state.project) return []
    const sourceIds = new Set(nodeIds)
    const sourceNodes = state.nodes.filter(node => sourceIds.has(node.id))
    if (!sourceNodes.length) return []
    const previous = getGraphState(state)
    const ts = now()
    const idMap = new Map<string, string>()
    const duplicatedNodes = sourceNodes.map((node) => {
      const id = createCreativeCanvasId('node')
      idMap.set(node.id, id)
      return {
        ...node,
        id,
        x: node.x + offset.x,
        y: node.y + offset.y,
        metadata: { ...node.metadata },
        createdAt: ts,
        updatedAt: ts,
      }
    })
    const duplicatedEdges = state.edges
      .filter(edge => sourceIds.has(edge.fromNodeId) && sourceIds.has(edge.toNodeId))
      .map(edge => ({
        ...edge,
        id: createCreativeCanvasId('edge'),
        fromNodeId: idMap.get(edge.fromNodeId)!,
        toNodeId: idMap.get(edge.toNodeId)!,
        createdAt: ts,
      }))
    const nextProject = { ...state.project, updatedAt: ts }
    const nextNodes = [...state.nodes, ...duplicatedNodes]
    const nextEdges = [...state.edges, ...duplicatedEdges]
    set({
      project: nextProject,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: duplicatedNodes.map(node => node.id),
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, nextEdges)
    return duplicatedNodes
  },

  deleteSelectedNodes: async () => {
    await get().deleteNodes(get().selectedNodeIds)
  },

  deleteNodes: async (nodeIds) => {
    const state = get()
    if (!state.project || !nodeIds.length) return
    const previous = getGraphState(state)
    const nodeIdSet = new Set(nodeIds)
    for (const job of state.jobs) {
      if (job.nodeId && nodeIdSet.has(job.nodeId) && (job.status === 'queued' || job.status === 'running')) {
        state.runningControllers[job.id]?.abort()
      }
    }
    const nextNodes = state.nodes.filter(node => !nodeIdSet.has(node.id))
    const nextEdges = state.edges.filter(edge => !nodeIdSet.has(edge.fromNodeId) && !nodeIdSet.has(edge.toNodeId))
    const nextProject = { ...state.project, updatedAt: now() }
    set({
      project: nextProject,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: state.selectedNodeIds.filter(id => !nodeIdSet.has(id)),
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await deleteCreativeCanvasNodes(state.project.id, nodeIds)
  },

  connectNodes: async (fromNodeId, toNodeId) => {
    const state = get()
    if (!state.project || fromNodeId === toNodeId) return null
    const projectNodeIds = new Set(state.nodes.map(node => node.id))
    if (!projectNodeIds.has(fromNodeId) || !projectNodeIds.has(toNodeId)) return null
    if (state.edges.some(edge => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)) return null
    const previous = getGraphState(state)
    const edge: CreativeCanvasEdge = {
      id: createCreativeCanvasId('edge'),
      projectId: state.project.id,
      fromNodeId,
      toNodeId,
      createdAt: now(),
    }
    const nextProject = { ...state.project, updatedAt: now() }
    const nextEdges = [...state.edges, edge]
    set({
      project: nextProject,
      edges: nextEdges,
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, state.nodes, nextEdges)
    return edge
  },

  deleteEdge: async (edgeId) => {
    const state = get()
    if (!state.project) return
    const previous = getGraphState(state)
    set({
      edges: state.edges.filter(edge => edge.id !== edgeId),
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await deleteCreativeCanvasEdge(state.project.id, edgeId)
  },

  selectNodes: (nodeIds) => set({ selectedNodeIds: nodeIds }),

  importImageAsset: async (input) => {
    await get().ensureReady()
    const state = get()
    if (!state.project) throw new Error('画布未初始化。')
    const mimeType = input.file.type || 'image/png'
    if (!mimeType.startsWith('image/')) {
      throw new Error('只支持导入图片作为参考素材。')
    }

    const previous = getGraphState(state)
    const bytes = new Uint8Array(await input.file.arrayBuffer())
    const title = getImportAssetTitle(input.fileName, input.title)
    const assetId = createCreativeCanvasId('asset')
    const nodeId = createCreativeCanvasId('node')
    const ts = now()
    const fileName = createAssetFileName(title, mimeType)
    const filePath = await writeCreativeCanvasAssetFile({ bytes, fileName })
    const asset = await createCreativeCanvasAsset({
      id: assetId,
      projectId: state.project.id,
      kind: 'image',
      filePath,
      title,
      mimeType,
      bytes: bytes.byteLength,
      hash: await createSha256(bytes),
      sourceNodeId: nodeId,
      provenance: {
        source: 'import',
        sourceNodeIds: [nodeId],
        createdAt: ts,
      },
    })
    const node = createNode({
      id: nodeId,
      projectId: state.project.id,
      type: 'image',
      title,
      x: input.x ?? 180,
      y: input.y ?? 180,
      width: 280,
      height: 220,
      metadata: {
        assetId: asset.id,
        status: 'idle',
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        provenance: asset.provenance,
      },
    })
    const nextProject = { ...state.project, updatedAt: ts }
    const nextNodes = [...state.nodes, node]
    set({
      project: nextProject,
      nodes: nextNodes,
      assets: [asset, ...state.assets],
      selectedNodeIds: [node.id],
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, state.edges)
    return { asset, node }
  },

  addImageNodeFromAsset: async (assetId, input) => {
    await get().ensureReady()
    const state = get()
    const asset = state.assets.find(item => item.id === assetId)
    if (!state.project || !asset) throw new Error('素材不存在。')
    const previous = getGraphState(state)
    const node = createNode({
      projectId: state.project.id,
      type: 'image',
      title: asset.title,
      x: input?.x ?? 220,
      y: input?.y ?? 220,
      width: 280,
      height: 220,
      metadata: {
        assetId: asset.id,
        status: 'idle',
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        provenance: {
          source: 'manual',
          sourceNodeIds: asset.sourceNodeId ? [asset.sourceNodeId] : undefined,
          jobId: asset.sourceJobId,
          createdAt: now(),
        },
      },
    })
    const nextProject = { ...state.project, updatedAt: now() }
    const nextNodes = [...state.nodes, node]
    set({
      project: nextProject,
      nodes: nextNodes,
      selectedNodeIds: [node.id],
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, state.edges)
    return node
  },

  createGenerationFlow: async (prompt, options) => {
    await get().ensureReady()
    const state = get()
    if (!state.project) throw new Error('画布未初始化。')
    const previous = getGraphState(state)
    const x = options?.x ?? 140
    const y = options?.y ?? 140
    const ts = now()
    const referenceAssetIds = Array.from(new Set((options?.referenceAssetIds || []).filter(Boolean)))
    const existingReferenceNodes = referenceAssetIds
      .map(assetId => state.nodes.find(node => node.type === 'image' && node.metadata.assetId === assetId))
      .filter((node): node is CreativeCanvasNode => Boolean(node))
    const existingReferenceNodeAssetIds = new Set(existingReferenceNodes.map(node => String(node.metadata.assetId || '')))
    const createdReferenceNodes = referenceAssetIds
      .filter(assetId => !existingReferenceNodeAssetIds.has(assetId))
      .map((assetId, index) => {
        const asset = state.assets.find(item => item.id === assetId)
        if (!asset) return null
        return createNode({
          projectId: state.project!.id,
          type: 'image',
          title: asset.title,
          x: Math.max(40, x - 340),
          y: y + index * 240,
          width: 280,
          height: 220,
          metadata: {
            assetId: asset.id,
            status: 'idle',
            mimeType: asset.mimeType,
            bytes: asset.bytes,
            provenance: asset.provenance,
          },
        })
      })
      .filter((node): node is CreativeCanvasNode => Boolean(node))
    const referenceNodes = [...existingReferenceNodes, ...createdReferenceNodes]
    const textNode = createNode({
      projectId: state.project.id,
      type: 'text',
      title: '提示词',
      x,
      y,
      width: 320,
      height: 180,
      metadata: {
        content: prompt,
        prompt,
        provenance: {
          source: options?.sourcePath ? 'editor_selection' : 'manual',
          sourcePath: options?.sourcePath,
          createdAt: ts,
        },
      },
    })
    const configNode = createNode({
      projectId: state.project.id,
      type: 'config',
      title: '生图配置',
      x: x + 380,
      y,
      width: 320,
      height: 220,
      metadata: {
        prompt,
        promptSource: 'upstream',
        status: 'idle',
        generationMode: 'image',
        generationType: 'generation',
        modelSelection: options?.modelSelection,
        model: options?.model,
        size: options?.size || '1024x1024',
        quality: options?.quality || 'standard',
        count: options?.count || 1,
        referenceIds: referenceAssetIds,
        provenance: {
          source: options?.sourcePath ? 'editor_selection' : 'manual',
          sourcePath: options?.sourcePath,
          sourceNodeIds: [textNode.id, ...referenceNodes.map(node => node.id)],
          createdAt: ts,
        },
      },
    })
    const edge: CreativeCanvasEdge = {
      id: createCreativeCanvasId('edge'),
      projectId: state.project.id,
      fromNodeId: textNode.id,
      toNodeId: configNode.id,
      createdAt: ts,
    }
    const referenceEdges: CreativeCanvasEdge[] = referenceNodes.map(referenceNode => ({
      id: createCreativeCanvasId('edge'),
      projectId: state.project!.id,
      fromNodeId: referenceNode.id,
      toNodeId: configNode.id,
      createdAt: ts,
    }))
    const nextNodes = [...state.nodes, textNode, ...createdReferenceNodes, configNode]
    const nextEdges = [...state.edges, edge, ...referenceEdges]
    const nextProject = { ...state.project, updatedAt: ts }
    set({
      project: nextProject,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: [configNode.id],
      historyPast: previous ? trimHistory([...state.historyPast, previous]) : state.historyPast,
      historyFuture: [],
    })
    await replaceCreativeCanvasGraph(nextProject, nextNodes, nextEdges)
    if (options?.autoRun && get().project?.id === state.project.id) {
      await get().runGenerationForNode(configNode.id)
    }
    return { textNode, configNode }
  },

  runGenerationForNode: async (nodeId, overridePrompt) => {
    await get().ensureReady()
    const state = get()
    const project = state.project
    const node = state.nodes.find(item => item.id === nodeId)
    if (!project || !node) return
    const generationMode = node.metadata.generationMode || 'image'
    if (generationMode !== 'image') {
      await get().updateNode(nodeId, {
        metadata: {
          status: 'failed',
          error: 'v1 仅支持图片生成，视频/音频/文本生成会在后续 adapter 中开放。',
        },
      })
      return 'failed'
    }

    const incomingIds = state.edges.filter(edge => edge.toNodeId === nodeId).map(edge => edge.fromNodeId)
    const upstreamNodes = incomingIds
      .map(id => state.nodes.find(item => item.id === id))
      .filter((item): item is CreativeCanvasNode => Boolean(item))
    const upstreamPrompt = upstreamNodes
      .filter(item => item.type === 'text')
      .map(item => item.metadata.prompt || item.metadata.content || '')
      .filter(Boolean)
      .join('\n\n')
      .trim()
    const nodePrompt = node.metadata.prompt?.trim()
    const prompt = overridePrompt?.trim()
      || (node.metadata.promptSource === 'manual' ? nodePrompt || upstreamPrompt : upstreamPrompt || nodePrompt)
    if (!prompt) {
      await get().updateNode(nodeId, { metadata: { status: 'failed', error: '请先填写提示词。' } })
      return 'failed'
    }

    const referenceAssets = upstreamNodes
      .filter(item => item.type === 'image' && item.metadata.assetId)
      .map(item => state.assets.find(asset => asset.id === item.metadata.assetId))
      .filter((asset): asset is CreativeCanvasAsset => Boolean(asset))
      .slice(0, 16)
    const generationType = getGenerationType(referenceAssets)
    const jobId = createCreativeCanvasId('job')
    const controller = new AbortController()
    const ts = now()
    const options: CreativeCanvasGenerationOptions = {
      modelSelection: node.metadata.modelSelection || project.settings?.imageModelSelection,
      model: node.metadata.model,
      size: node.metadata.size,
      quality: node.metadata.quality,
      count: node.metadata.count,
      referenceAssetIds: referenceAssets.map(asset => asset.id),
    }
    const job: CreativeCanvasGenerationJob = {
      id: jobId,
      projectId: project.id,
      nodeId,
      status: 'running',
      mode: 'image',
      generationType,
      modelSelection: options.modelSelection,
      model: options.model,
      prompt,
      request: { prompt, ...options },
      assetIds: [],
      startedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    }

    set((current) => {
      const runningControllers = { ...current.runningControllers, [jobId]: controller }
      if (current.project?.id !== project.id) return { runningControllers }
      return {
        runningControllers,
        jobs: [job, ...current.jobs.filter(item => item.id !== jobId)],
        nodes: current.nodes.map(item => item.id === nodeId
          ? {
              ...item,
              metadata: {
                ...item.metadata,
                prompt,
                status: 'running',
                error: undefined,
                generationType,
                jobId,
              },
              updatedAt: now(),
            }
          : item),
      }
    })
    await upsertCreativeCanvasJob(job)
    await upsertCreativeCanvasNode({
      ...node,
      metadata: {
        ...node.metadata,
        prompt,
        status: 'running',
        error: undefined,
        generationType,
        jobId,
      },
      updatedAt: now(),
    })

    try {
      const result = generationType === 'edit' && referenceAssets.length
        ? await editImage({ prompt, referenceAssets, options, signal: controller.signal })
        : await generateImage({ prompt, options, signal: controller.signal })

      if (controller.signal.aborted || deletedProjectIds.has(project.id)) {
        throw new DOMException('Generation cancelled.', 'AbortError')
      }

      if (!result.images.length) {
        throw new Error('模型没有返回图片。')
      }

      const beforePersist = get()
      const beforePersistSnapshot = beforePersist.project?.id === project.id
        ? {
            project: beforePersist.project,
            nodes: beforePersist.nodes,
            edges: beforePersist.edges,
            assets: beforePersist.assets,
            jobs: beforePersist.jobs,
          }
        : await getCreativeCanvasSnapshot(project.id)
      if (!beforePersistSnapshot?.nodes.some(item => item.id === nodeId)) {
        throw new Error('生成节点已被删除，结果未写回画布。')
      }

      const persistedAssets: CreativeCanvasAsset[] = []
      for (let index = 0; index < result.images.length; index += 1) {
        const assetInput = await persistGeneratedImage({
          projectId: project.id,
          nodeId,
          jobId,
          prompt,
          image: result.images[index],
          index: index + 1,
        })
        const asset = await createCreativeCanvasAsset(assetInput)
        persistedAssets.push(asset)
        await registerGeneratedAssetKnowledgeObject(asset)
      }

      if (controller.signal.aborted) {
        throw new DOMException('Generation cancelled.', 'AbortError')
      }

      const current = get()
      const latest = current.project?.id === project.id
        ? {
            project: current.project,
            nodes: current.nodes,
            edges: current.edges,
            assets: current.assets,
            jobs: current.jobs,
          }
        : await getCreativeCanvasSnapshot(project.id)
      const sourceNode = latest?.nodes.find(item => item.id === nodeId)
      const latestJob = latest?.jobs.find(item => item.id === jobId)
      if (!latest || !sourceNode || sourceNode.metadata.jobId !== jobId || sourceNode.metadata.status !== 'running' || latestJob?.status !== 'running') {
        throw new Error('生成节点已被删除，生成素材已保留在素材库。')
      }
      const resultNodes = persistedAssets.map((asset, index) => createNode({
        projectId: project.id,
        type: 'image',
        title: asset.title,
        x: sourceNode.x + sourceNode.width + 90,
        y: sourceNode.y + index * 260,
        width: 260,
        height: 220,
        metadata: {
          assetId: asset.id,
          prompt,
          status: 'succeeded',
          jobId,
          mimeType: asset.mimeType,
          bytes: asset.bytes,
          provenance: asset.provenance,
        },
      }))
      const resultEdges = resultNodes.map((resultNode) => ({
        id: createCreativeCanvasId('edge'),
        projectId: project.id,
        fromNodeId: nodeId,
        toNodeId: resultNode.id,
        createdAt: now(),
      }))
      const completedJob: CreativeCanvasGenerationJob = {
        ...job,
        status: 'succeeded',
        model: typeof result.request.model === 'string' ? result.request.model : job.model,
        response: sanitizeGenerationResponseForStorage(result.raw),
        assetIds: persistedAssets.map(asset => asset.id),
        completedAt: now(),
        updatedAt: now(),
      }
      const updatedNodes = latest.nodes
        .map(item => item.id === nodeId
          ? {
              ...item,
              metadata: {
                ...item.metadata,
                prompt,
                status: 'succeeded' as const,
                error: undefined,
                jobId,
              },
              updatedAt: now(),
            }
          : item)
        .concat(resultNodes)
      const committed = await commitCreativeCanvasGenerationResult({
        sourceNode: updatedNodes.find(item => item.id === nodeId)!,
        resultNodes,
        resultEdges,
        job: completedJob,
      })
      if (!committed) {
        throw new Error('生成任务状态已变化，结果未写回画布。')
      }
      set((current) => {
        const { [jobId]: _removed, ...controllers } = current.runningControllers
        if (current.project?.id !== project.id) {
          return { runningControllers: controllers }
        }
        const currentSource = current.nodes.find(item => item.id === nodeId)
        if (!currentSource || currentSource.metadata.jobId !== jobId || currentSource.metadata.status !== 'running') {
          return { runningControllers: controllers }
        }
        return {
          runningControllers: controllers,
          project: { ...current.project, updatedAt: completedJob.updatedAt },
          nodes: current.nodes
            .map(item => item.id === nodeId
              ? updatedNodes.find(updatedNode => updatedNode.id === nodeId)!
              : item)
            .concat(resultNodes),
          edges: [...current.edges, ...resultEdges],
          assets: [...persistedAssets, ...current.assets],
          jobs: [completedJob, ...current.jobs.filter(item => item.id !== jobId)],
          selectedNodeIds: resultNodes.map(item => item.id),
        }
      })
      return completedJob.status
    } catch (error) {
      const cancelled = controller.signal.aborted || deletedProjectIds.has(project.id)
      const failedJob: CreativeCanvasGenerationJob = {
        ...job,
        status: cancelled ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: now(),
        updatedAt: now(),
      }
      set((current) => {
        const { [jobId]: _removed, ...controllers } = current.runningControllers
        if (current.project?.id !== project.id) {
          return { runningControllers: controllers }
        }
        return {
          runningControllers: controllers,
          jobs: [failedJob, ...current.jobs.filter(item => item.id !== jobId)],
          nodes: current.nodes.map(item => item.id === nodeId
            ? {
                ...item,
                metadata: {
                  ...item.metadata,
                  status: cancelled ? 'cancelled' : 'failed',
                  error: failedJob.error,
                  jobId,
                },
                updatedAt: now(),
              }
            : item),
        }
      })
      if (deletedProjectIds.has(project.id)) return failedJob.status
      await upsertCreativeCanvasJob(failedJob)
      const latestState = get()
      const latestNode = latestState.project?.id === project.id
        ? latestState.nodes.find(item => item.id === nodeId)
        : (await getCreativeCanvasSnapshot(project.id))?.nodes.find(item => item.id === nodeId)
      if (latestNode) {
        await upsertCreativeCanvasNode({
          ...latestNode,
          metadata: {
            ...latestNode.metadata,
            status: cancelled ? 'cancelled' : 'failed',
            error: failedJob.error,
            jobId,
          },
          updatedAt: now(),
        })
      }
      return failedJob.status
    }
  },

  cancelGeneration: async (jobId) => {
    const state = get()
    const controller = state.runningControllers[jobId]
    const job = state.jobs.find(item => item.id === jobId)
    controller?.abort()
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return
    const cancelledJob: CreativeCanvasGenerationJob = {
      ...job,
      status: 'cancelled',
      error: 'Generation cancelled.',
      completedAt: now(),
      updatedAt: now(),
    }
    const cancelledNode = job.nodeId
      ? state.nodes.find(item => item.id === job.nodeId && item.metadata.jobId === jobId)
      : undefined
    set(current => ({
      jobs: [cancelledJob, ...current.jobs.filter(item => item.id !== jobId)],
      nodes: current.nodes.map(item => item.id === job.nodeId && item.metadata.jobId === jobId
        ? {
            ...item,
            metadata: { ...item.metadata, status: 'cancelled', error: cancelledJob.error },
            updatedAt: cancelledJob.updatedAt,
          }
        : item),
    }))
    await upsertCreativeCanvasJob(cancelledJob)
    if (cancelledNode) {
      await upsertCreativeCanvasNode({
        ...cancelledNode,
        metadata: { ...cancelledNode.metadata, status: 'cancelled', error: cancelledJob.error },
        updatedAt: cancelledJob.updatedAt,
      })
    }
  },

  runGenerationForNodes: async (nodeIds) => {
    const uniqueNodeIds = Array.from(new Set(nodeIds.filter(Boolean)))
    for (const nodeId of uniqueNodeIds) {
      await get().runGenerationForNode(nodeId)
    }
  },

  insertAssetIntoNote: async (assetId) => {
    const asset = get().assets.find(item => item.id === assetId)
    if (!asset) throw new Error('素材不存在。')
    const workspacePath = await copyCreativeCanvasAssetToWorkspace(asset)
    emitter.emit('editor-insert-markdown-image', { imagePath: workspacePath })
    return workspacePath
  },

  getAssetUrl: async (asset) => {
    const cached = get().assetUrls[asset.id]
    if (cached) return cached
    const url = await getCreativeCanvasAssetUrl(asset.filePath)
    set((state) => ({ assetUrls: { ...state.assetUrls, [asset.id]: url } }))
    return url
  },

  getThumbnailUrl: async (asset) => {
    if (!asset.thumbnailPath) return await get().getAssetUrl(asset)
    const cacheKey = `${asset.id}:thumbnail`
    const cached = get().assetUrls[cacheKey]
    if (cached) return cached
    const url = await getCreativeCanvasThumbnailUrl(asset.thumbnailPath)
    set((state) => ({ assetUrls: { ...state.assetUrls, [cacheKey]: url } }))
    return url
  },

  cacheAssetThumbnail: async (assetId, bytes, mimeType) => {
    const state = get()
    const asset = state.assets.find(item => item.id === assetId)
    if (!asset) return null
    const filePath = await writeCreativeCanvasThumbnailFile({
      bytes,
      fileName: createThumbnailFileName(asset, mimeType),
    })
    const updatedAsset: CreativeCanvasAsset = {
      ...asset,
      thumbnailPath: filePath,
      updatedAt: now(),
    }
    set((current) => ({
      assets: current.assets.map(item => item.id === assetId ? updatedAsset : item),
      assetUrls: Object.fromEntries(
        Object.entries(current.assetUrls).filter(([key]) => key !== `${assetId}:thumbnail`),
      ),
    }))
    await upsertCreativeCanvasAsset(updatedAsset)
    return updatedAsset
  },

  recoverStaleJobs: async () => {
    const state = get()
    if (!state.project) return { staleJobIds: [] }
    const projectId = state.project.id
    const recovered = await markInterruptedJobsStale({
      project: state.project,
      nodes: state.nodes,
      edges: state.edges,
      assets: state.assets,
      jobs: state.jobs,
    }, state.runningControllers)
    set(current => current.project?.id === projectId
      ? {
          nodes: recovered.snapshot.nodes,
          jobs: recovered.snapshot.jobs,
        }
      : {})
    return { staleJobIds: recovered.staleJobIds }
  },

  retryGenerationJob: async (jobId) => {
    const job = get().jobs.find(item => item.id === jobId)
    if (!job?.nodeId) throw new Error('任务缺少可重试的节点。')
    return await get().runGenerationForNode(job.nodeId, job.prompt)
  },

  analyzeAssetCleanup: async () => {
    const state = get()
    const persistedSnapshot = state.project
      ? await getCreativeCanvasSnapshot(state.project.id)
      : null
    return await analyzeCreativeCanvasAssetCleanup(persistedSnapshot)
  },

  cleanupAssets: async (options) => {
    const state = get()
    if (!state.project) throw new Error('画布未初始化。')
    const includeUnusedAssets = options?.includeUnusedAssets ?? true
    const includeOrphanFiles = options?.includeOrphanFiles ?? true
    const plan = await get().analyzeAssetCleanup()
    const deletedAssetIds = includeUnusedAssets ? plan.unusedAssets.map(asset => asset.id) : []
    const filePaths = new Set<string>()

    if (includeOrphanFiles) {
      for (const file of plan.orphanAssetFiles) filePaths.add(file.path)
      for (const file of plan.orphanThumbnailFiles) filePaths.add(file.path)
    }

    if (deletedAssetIds.length) {
      await deleteCreativeCanvasAssets(state.project.id, deletedAssetIds)
      set((current) => (current.project?.id === state.project?.id ? {
        assets: current.assets.filter(asset => !deletedAssetIds.includes(asset.id)),
        assetUrls: Object.fromEntries(
          Object.entries(current.assetUrls).filter(([key]) =>
            !deletedAssetIds.some(assetId => key === assetId || key === `${assetId}:thumbnail`),
          ),
        ),
      } : {}))

      const remainingKnownPaths = getKnownCreativeCanvasPaths(await listCreativeCanvasAssets())
      for (const asset of plan.unusedAssets) {
        if (!remainingKnownPaths.has(asset.filePath)) filePaths.add(asset.filePath)
        if (asset.thumbnailPath && !remainingKnownPaths.has(asset.thumbnailPath)) filePaths.add(asset.thumbnailPath)
      }
    }

    const deletedFiles: string[] = []
    const failedFiles: Array<{ path: string; error: string }> = []
    for (const filePath of filePaths) {
      try {
        if (await removeCreativeCanvasStoredFile(filePath)) {
          deletedFiles.push(filePath)
        }
      } catch (error) {
        failedFiles.push({ path: filePath, error: error instanceof Error ? error.message : String(error) })
      }
    }

    return { deletedAssetIds, deletedFiles, failedFiles }
  },

  importInfiniteCanvasJson: async (input, title) => {
    const report = convertInfiniteCanvasJson(input, {
      title,
      createId: createCreativeCanvasId,
    })
    await replaceCreativeCanvasGraph(report.snapshot.project, report.snapshot.nodes, report.snapshot.edges)
    set((state) => ({
      projects: [report.snapshot.project, ...state.projects.filter(item => item.id !== report.snapshot.project.id)],
      activeProjectId: report.snapshot.project.id,
      project: report.snapshot.project,
      nodes: report.snapshot.nodes,
      edges: report.snapshot.edges,
      assets: [],
      jobs: [],
      selectedNodeIds: [],
      historyPast: [],
      historyFuture: [],
    }))
    return report
  },

  applyOps: async (ops) => {
    for (const op of ops) {
      if (op.type === 'add_node') {
        await get().addNode({
          type: op.nodeType || 'text',
          title: op.title,
          x: op.x ?? op.position?.x,
          y: op.y ?? op.position?.y,
          width: op.width,
          height: op.height,
          metadata: op.metadata,
        })
      } else if (op.type === 'update_node') {
        await get().updateNode(op.id, { ...(op.patch || {}), metadata: op.metadata })
      } else if (op.type === 'delete_node') {
        await get().deleteNodes(op.ids || (op.id ? [op.id] : []))
      } else if (op.type === 'delete_connections') {
        const edgeIds = op.all
          ? get().edges.map(edge => edge.id)
          : op.ids || (op.id ? [op.id] : [])
        for (const edgeId of edgeIds) {
          await get().deleteEdge(edgeId)
        }
      } else if (op.type === 'connect_nodes') {
        await get().connectNodes(op.fromNodeId, op.toNodeId)
      } else if (op.type === 'delete_edge') {
        await get().deleteEdge(op.id)
      } else if (op.type === 'select_nodes') {
        get().selectNodes(op.ids)
      } else if (op.type === 'set_viewport') {
        await get().setViewport(op.viewport)
      } else if (op.type === 'run_generation') {
        await get().runGenerationForNode(op.nodeId, op.prompt)
      }
    }
  },

  undo: async () => {
    const state = get()
    const previous = state.historyPast[state.historyPast.length - 1]
    const current = getGraphState(state)
    if (!previous || !current) return
    set({
      project: previous.project,
      nodes: previous.nodes,
      edges: previous.edges,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: trimHistory([current, ...state.historyFuture]),
      selectedNodeIds: [],
    })
    await replaceCreativeCanvasGraph(previous.project, previous.nodes, previous.edges)
  },

  redo: async () => {
    const state = get()
    const next = state.historyFuture[0]
    const current = getGraphState(state)
    if (!next || !current) return
    set({
      project: next.project,
      nodes: next.nodes,
      edges: next.edges,
      historyPast: trimHistory([...state.historyPast, current]),
      historyFuture: state.historyFuture.slice(1),
      selectedNodeIds: [],
    })
    await replaceCreativeCanvasGraph(next.project, next.nodes, next.edges)
  },

  exportSnapshot: () => {
    const state = get()
    if (!state.project) return null
    return {
      project: state.project,
      nodes: state.nodes,
      edges: state.edges,
      assets: state.assets,
      jobs: state.jobs,
    }
  },
}))

export default useCreativeCanvasStore
