export const CREATIVE_CANVAS_SCHEMA_VERSION = 2

export type CreativeCanvasNodeType = 'text' | 'image' | 'config' | 'video' | 'audio'
export type CreativeCanvasGenerationMode = 'image' | 'video' | 'audio' | 'text'
export type CreativeCanvasGenerationType = 'generation' | 'edit'
export type CreativeCanvasNodeStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale'
export type CreativeCanvasAssetKind = 'image' | 'video' | 'audio' | 'text'
export type CreativeCanvasJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale'
export type CreativeCanvasBackgroundMode = 'grid' | 'dots' | 'blank'

export interface CreativeCanvasViewport {
  x: number
  y: number
  k: number
}

export interface CreativeCanvasProjectSettings {
  imageModelSelection?: string
  backgroundMode?: CreativeCanvasBackgroundMode
  showMiniMap?: boolean
  snapToGrid?: boolean
}

export interface CreativeCanvasProject {
  id: string
  title: string
  schemaVersion: number
  viewport: CreativeCanvasViewport
  settings: CreativeCanvasProjectSettings
  createdAt: number
  updatedAt: number
}

export interface CreativeCanvasProvenance {
  source: 'manual' | 'editor_selection' | 'agent' | 'generation' | 'import'
  sourcePath?: string
  sourceNodeIds?: string[]
  jobId?: string
  runId?: string
  createdAt: number
}

export interface CreativeCanvasNodeMetadata {
  content?: string
  prompt?: string
  status?: CreativeCanvasNodeStatus
  error?: string
  generationMode?: CreativeCanvasGenerationMode
  generationType?: CreativeCanvasGenerationType
  modelSelection?: string
  model?: string
  size?: string
  quality?: string
  count?: number
  assetId?: string
  referenceIds?: string[]
  jobId?: string
  mimeType?: string
  naturalWidth?: number
  naturalHeight?: number
  bytes?: number
  provenance?: CreativeCanvasProvenance
  [key: string]: unknown
}

export interface CreativeCanvasNode {
  id: string
  projectId: string
  type: CreativeCanvasNodeType
  title: string
  x: number
  y: number
  width: number
  height: number
  metadata: CreativeCanvasNodeMetadata
  createdAt: number
  updatedAt: number
}

export interface CreativeCanvasEdge {
  id: string
  projectId: string
  fromNodeId: string
  toNodeId: string
  createdAt: number
}

export interface CreativeCanvasAsset {
  id: string
  projectId: string
  kind: CreativeCanvasAssetKind
  filePath: string
  thumbnailPath?: string
  title: string
  mimeType: string
  bytes: number
  width?: number
  height?: number
  hash?: string
  sourceNodeId?: string
  sourceJobId?: string
  prompt?: string
  provenance?: CreativeCanvasProvenance
  createdAt: number
  updatedAt: number
}

export interface CreativeCanvasGenerationJob {
  id: string
  projectId: string
  nodeId?: string
  status: CreativeCanvasJobStatus
  mode: CreativeCanvasGenerationMode
  generationType: CreativeCanvasGenerationType
  modelSelection?: string
  model?: string
  prompt: string
  request: Record<string, unknown>
  response?: Record<string, unknown>
  error?: string
  assetIds: string[]
  startedAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface CreativeCanvasSnapshot {
  project: CreativeCanvasProject
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  assets: CreativeCanvasAsset[]
  jobs: CreativeCanvasGenerationJob[]
}

export interface CreativeCanvasGenerationOptions {
  modelSelection?: string
  model?: string
  size?: string
  quality?: string
  count?: number
  referenceAssetIds?: string[]
}

export interface CreativeCanvasAssetCleanupPlan {
  unusedAssets: CreativeCanvasAsset[]
  orphanAssetFiles: Array<{ path: string; bytes?: number }>
  orphanThumbnailFiles: Array<{ path: string; bytes?: number }>
  missingAssetIds: string[]
  reclaimableBytes: number
}
