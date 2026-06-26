export type ToolParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface ToolParameter {
  name: string
  type: ToolParameterType
  description: string
  required: boolean
  default?: any
}

export interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  requiresConfirmation: boolean
  category: 'note' | 'chat' | 'tag' | 'mark' | 'search' | 'mcp' | 'system' | 'editor' | 'filesystem' | 'web'
  execute: (params: Record<string, any>, context?: ToolExecutionContext) => Promise<ToolResult>
  risk?: 'low' | 'medium' | 'high'
  capabilities?: Array<'read' | 'write' | 'delete' | 'execute' | 'network'>
}

export interface ToolExecutionContext {
  abortSignal?: AbortSignal
  runId?: string
  iteration?: number
  stepId?: string
  toolCallId?: string
  userInput?: string
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  message?: string
  status?: ToolCallStatus
}

export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'blocked'
  | 'skipped'
  | 'adjusted'
  | 'cached'
  | 'cancelled'

export type AgentApprovalScope =
  | 'once'
  | 'conversation'
  | 'always-tool'
  | 'always-folder'
  | 'always-readonly'

export interface ToolCall {
  id: string
  toolName: string
  params: Record<string, any>
  result?: ToolResult
  status: ToolCallStatus
  timestamp: number
}

export type AgentEventType =
  | 'thought'
  | 'action'
  | 'observation'
  | 'tool'
  | 'approval'
  | 'final'
  | 'error'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.stopped'
  | 'agent.context.compacted'
  | 'agent.stream.started'
  | 'agent.stream.delta'
  | 'agent.stream.finished'
  | 'iteration.started'
  | 'thought.updated'
  | 'action.parsed'
  | 'observation.created'
  | 'tool.updated'
  | 'final.answer.rendered'
  | 'final.answer.rejected'
  | 'skills.selected'
  | 'agent.planning'
  | 'model.request.started'
  | 'model.response.received'
  | 'mcp.runtime.warmup'
  | 'tool.batch.started'
  | 'tool.batch.finished'
  | 'tool.execution.started'
  | 'tool.execution.finished'
  | 'confirmation.waiting'
  | 'confirmation.resolved'
  | 'step.completed'
  | 'research.started'
  | 'research.progress'
  | 'research.source_added'
  | 'research.evidence_added'
  | 'research.completed'
  | 'research.error'

export interface AgentEvent {
  id?: string
  runId?: string
  sequence?: number
  type: AgentEventType
  timestamp: number
  iteration?: number
  level?: 'debug' | 'info' | 'warn' | 'error'
  payload?: Record<string, any>
}

export interface ConfirmationRecord {
  toolName: string
  params: Record<string, any>
  status: 'pending' | 'confirmed' | 'cancelled'
  timestamp: number
  scope?: AgentApprovalScope
  sessionApprovalType?: 'write' | 'runtime-script-skill'
  sessionApprovalSkillId?: string
}

export interface AgentContextSnapshot {
  userGoal: string
  readFiles: Array<{
    path: string
    source: string
    lastReadAt: number
  }>
  toolResults: Array<{
    toolName: string
    status: ToolCall['status'] | 'observed'
    summary: string
    timestamp?: number
  }>
  todos: Array<{
    title: string
    status: 'pending' | 'done' | 'blocked'
  }>
  compactedAt: number
  sourceEventCount: number
  sourceStepCount: number
}

export type AgentActivityPhase =
  | 'idle'
  | 'preparing'
  | 'loading-skills'
  | 'planning'
  | 'thinking'
  | 'tool'
  | 'waiting-confirmation'
  | 'answering'
  | 'completed'
  | 'error'

export interface AgentActivity {
  phase: AgentActivityPhase
  label: string
  detail?: string
  startedAt: number
  iteration?: number
  toolName?: string
  outputChars?: number
  inputTokens?: number
  outputTokens?: number
}

export interface AgentTurnTelemetry {
  startedAt?: number
  updatedAt?: number
  elapsedMs: number
  outputChars: number
  inputTokens?: number
  outputTokens?: number
  toolCallCount: number
  runningToolCount: number
  successfulToolCount: number
  failedToolCount: number
  completedStepCount: number
  currentPhase?: AgentActivityPhase
  latestToolName?: string
}

export interface AgentState {
  agentRunId?: string
  agentEventCursor?: number
  activeChatId?: number
  isRunning: boolean
  isThinking: boolean
  currentThought: string
  thoughtHistory: string[]
  completedSteps: ReActStep[]
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  agentEvents: AgentEvent[]
  maxIterations: number
  currentIteration: number
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    previewParams?: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
    canApproveForSession?: boolean
    sessionApprovalType?: 'write' | 'runtime-script-skill'
    sessionApprovalSkillId?: string
    persistentApprovalOptions?: AgentApprovalScope[]
  }
  confirmationHistory: ConfirmationRecord[]
  loadedSkills?: Array<{
    id: string
    name: string
    description?: string
    score?: number
    confidence?: 'high' | 'medium' | 'low'
    reasons?: string[]
  }>
  selectedSkills?: string[]
  currentStepStartTime?: number
  ragSources?: string[]
  ragSourceDetails?: Array<{
    filepath: string
    filename: string
    content: string
    sourceType?: 'rag' | 'current' | 'linked' | 'quote'
    startLine?: number
    endLine?: number
    from?: number
    to?: number
  }>
  isFinalAnswerMode?: boolean
  finalAnswerContent?: string
  agentContextSnapshot?: AgentContextSnapshot
  agentPartSnapshot?: import('./part-reducer').AgentPartSnapshot
  agentParts?: import('./part-reducer').AgentPart[]
  activity?: AgentActivity
  telemetry?: AgentTurnTelemetry
  taskPlan?: {
    isComplex: boolean
    steps: Array<{
      description: string
      tools: string[]
    }>
    summary: string
    completedStepIndex: number
  }
}

export interface ReActStep {
  thought: string
  action?: {
    tool: string
    params: Record<string, any>
  }
  observation?: string
  duration?: number  // Duration in milliseconds.
}
