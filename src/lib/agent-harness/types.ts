export type AgentRoute = 'writer' | 'advisor' | 'chat' | 'agent' | 'workflow' | 'research'

export interface VfsRef {
  uri: `agent://${string}`
  runId: string
  path: string
  kind: 'context' | 'observation' | 'draft' | 'artifact'
  summary?: string
}

export interface ContextItem {
  id: string
  source: 'user' | 'quote' | 'file' | 'skill' | 'memory' | 'tool' | 'history'
  priority: number
  content: string
  tokenEstimate: number
  ref?: string
}

export interface ContextPack {
  runId: string
  tokenBudget: number
  included: ContextItem[]
  deferred: VfsRef[]
  warnings: string[]
  checksum: string
}

export interface ToolObservation {
  toolName: string
  success: boolean
  summary: string
  dataRef?: string
  artifacts?: string[]
  errorKind?: 'validation' | 'permission' | 'timeout' | 'network' | 'tool'
  retryable: boolean
}

export interface ApprovalRequest {
  id: string
  runId: string
  stepId: string
  toolName: string
  risk: 'medium' | 'high'
  reason: string
  params: Record<string, unknown>
  diffPreview?: string
  affectedFiles?: string[]
  approvalScope: 'once' | 'session' | 'persistent'
}

export interface AgentRunSnapshot {
  runId: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  userGoal: string
  route: AgentRoute
  planRef?: VfsRef
  todoRef?: VfsRef
  contextPackRef?: VfsRef
  draftRefs: VfsRef[]
  observationRefs: VfsRef[]
  approvalHistory: ApprovalRequest[]
  finalAnswer?: string
  updatedAt: number
}
