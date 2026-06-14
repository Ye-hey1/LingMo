import type { AgentEvent, ReActStep, Tool, ToolExecutionContext, ToolResult } from '@/lib/agent/types'
import type { AgentRuntimeSnapshot, McpRuntimeSnapshot, SkillRuntimeSnapshot, ToolExposureSnapshot } from '@/lib/agent/runtime-snapshot'
import type { IntentPolicy } from '@/lib/agent/tool-policy'
import type { SkillMatchSummary } from '@/lib/skills/types'

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
  status?: 'requested' | 'approved' | 'rejected'
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

export interface AgentRunMiddlewareState {
  runtime?: {
    snapshot?: AgentRuntimeSnapshot
    skills?: SkillRuntimeSnapshot
    mcp?: McpRuntimeSnapshot
    tools?: ToolExposureSnapshot
  }
  skills?: {
    forcedSkillIds: string[]
    activeSkillIds: string[]
    selectedSkillIds: string[]
    activeSkillMatches: SkillMatchSummary[]
    warnings?: string[]
  }
  mcp?: {
    selectedServerIds: string[]
    connectedServerIds: string[]
    toolNames: string[]
    warnings: string[]
  }
  visibleToolNames?: string[]
  promptSectionIds?: string[]
  persistedMemoryIds?: string[]
}

export interface HarnessToolExecutionInput {
  tool: Tool
  params: Record<string, any>
  context?: ToolExecutionContext
}

export interface HarnessToolExecutionResult {
  result: ToolResult
  observation: ToolObservation
}

export interface AgentBeforeRunInput {
  runId: string
  route: AgentRoute
  userInput: string
  forcedSkillIds?: string[]
  webSearchEnabled?: boolean
}

export interface AgentBeforeRunOutput {
  state?: Partial<AgentRunMiddlewareState>
}

export interface AgentBeforeModelInput {
  runId: string
  route: AgentRoute
  userInput: string
  iteration: number
  tools: Tool[]
  steps: ReActStep[]
  selectedSkillIds: string[]
  activeSkillIds: string[]
  state: AgentRunMiddlewareState
  intentPolicy?: IntentPolicy
  webSearchEnabled?: boolean
}

export interface AgentBeforeModelOutput {
  tools?: Tool[]
  promptSections?: string[]
  state?: Partial<AgentRunMiddlewareState>
}

export interface AgentBeforeToolInput {
  runId: string
  route: AgentRoute
  userInput: string
  tool: Tool
  params: Record<string, any>
  context?: ToolExecutionContext
  selectedSkillIds: string[]
  activeSkillIds: string[]
  state: AgentRunMiddlewareState
  intentPolicy?: IntentPolicy
  webSearchEnabled?: boolean
}

export interface AgentBeforeToolOutput {
  allowed?: boolean
  requiresConfirmation?: boolean
  reason?: string
  params?: Record<string, any>
  authorizedBy?: string[]
  state?: Partial<AgentRunMiddlewareState>
}

export interface AgentAfterToolInput {
  runId: string
  route: AgentRoute
  userInput: string
  tool: Tool
  params: Record<string, any>
  context?: ToolExecutionContext
  execution: HarnessToolExecutionResult
  selectedSkillIds: string[]
  activeSkillIds: string[]
  state: AgentRunMiddlewareState
}

export interface AgentAfterToolOutput {
  execution?: HarnessToolExecutionResult
  state?: Partial<AgentRunMiddlewareState>
}

export interface AgentAfterRunInput {
  runId: string
  route: AgentRoute
  userInput: string
  result: string
  snapshot: AgentRunSnapshot
  state: AgentRunMiddlewareState
}

export interface AgentHarnessMiddleware {
  name: string
  beforeRun?: (input: AgentBeforeRunInput) => Promise<AgentBeforeRunOutput | void> | AgentBeforeRunOutput | void
  beforeModel?: (input: AgentBeforeModelInput) => Promise<AgentBeforeModelOutput | void> | AgentBeforeModelOutput | void
  beforeTool?: (input: AgentBeforeToolInput) => Promise<AgentBeforeToolOutput | void> | AgentBeforeToolOutput | void
  afterTool?: (input: AgentAfterToolInput) => Promise<AgentAfterToolOutput | void> | AgentAfterToolOutput | void
  afterRun?: (input: AgentAfterRunInput) => Promise<void> | void
}

export interface AgentRunControl {
  runId: string
  route: AgentRoute
  recordEvent: (event: AgentEvent) => void
  executeTool: (input: HarnessToolExecutionInput) => Promise<HarnessToolExecutionResult>
  setContextPack: (input: {
    tokenBudget: number
    items: ContextItem[]
    deferred?: VfsRef[]
  }) => Promise<ContextPack>
  writeDraft: (path: string, content: string, summary?: string) => Promise<VfsRef>
  getSnapshot: () => AgentRunSnapshot
  getMiddlewareState: () => AgentRunMiddlewareState
  setMiddlewareState: (patch: Partial<AgentRunMiddlewareState>) => void
  prepareModel: (input: {
    iteration: number
    tools: Tool[]
    steps: ReActStep[]
    selectedSkillIds?: string[]
    activeSkillIds?: string[]
    intentPolicy?: IntentPolicy
    webSearchEnabled?: boolean
  }) => Promise<AgentBeforeModelOutput>
  authorizeTool: (input: {
    tool: Tool
    params: Record<string, any>
    context?: ToolExecutionContext
    selectedSkillIds?: string[]
    activeSkillIds?: string[]
    intentPolicy?: IntentPolicy
    webSearchEnabled?: boolean
  }) => Promise<AgentBeforeToolOutput>
  afterTool: (input: {
    tool: Tool
    params: Record<string, any>
    context?: ToolExecutionContext
    execution: HarnessToolExecutionResult
    selectedSkillIds?: string[]
    activeSkillIds?: string[]
  }) => Promise<HarnessToolExecutionResult>
}
