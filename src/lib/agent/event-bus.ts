import type { AgentActivityPhase, AgentEvent, AgentEventType, AgentTurnTelemetry, ToolCall } from './types'
import { isSupportOnlyObservationText, isSupportOnlyToolName } from './support-tools'

export interface AgentEventBusOptions {
  runId?: string
  maxEvents?: number
  onEvent?: (event: AgentEvent) => void
}

export interface AgentReplayState {
  runId?: string
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'error'
  currentThought: string
  actions: Array<{ tool: string; params: Record<string, any>; iteration?: number; timestamp: number }>
  observations: Array<{ content: string; iteration?: number; timestamp: number }>
  toolCalls: ToolCall[]
  approvals: Array<{ status: string; toolName?: string; timestamp: number; payload?: Record<string, any> }>
  modelRequests: Array<{ status: 'started' | 'received'; iteration?: number; timestamp: number; payload?: Record<string, any> }>
  executionSteps: Array<{ status: string; title?: string; iteration?: number; timestamp: number; payload?: Record<string, any> }>
  finalAnswer?: string
  errors: string[]
  telemetry: AgentTurnTelemetry
}

function createRunId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ToolCall>
  return typeof candidate.id === 'string' && typeof candidate.toolName === 'string'
}

export class AgentEventBus {
  private runId: string
  private sequence = 0
  private maxEvents: number
  private events: AgentEvent[] = []
  private onEvent?: (event: AgentEvent) => void

  constructor(options: AgentEventBusOptions = {}) {
    this.runId = options.runId || createRunId()
    this.maxEvents = options.maxEvents || 500
    this.onEvent = options.onEvent
  }

  reset(runId: string = createRunId()) {
    this.runId = runId
    this.sequence = 0
    this.events = []
  }

  getRunId(): string {
    return this.runId
  }

  getEvents(): AgentEvent[] {
    return [...this.events]
  }

  emit(
    type: AgentEventType,
    payload?: Record<string, any>,
    options: { iteration?: number; level?: AgentEvent['level'] } = {}
  ): AgentEvent {
    this.sequence += 1
    const event: AgentEvent = {
      id: `${this.runId}:${this.sequence}`,
      runId: this.runId,
      sequence: this.sequence,
      type,
      timestamp: Date.now(),
      iteration: options.iteration,
      level: options.level,
      payload,
    }

    this.events = appendAgentEvent(this.events, event, this.maxEvents)
    this.onEvent?.(event)

    // Tauri 异步广播事件
    try {
      if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)) {
        import('@tauri-apps/api/event').then(({ emit }) => {
          emit('agent-event', event).catch(err => console.warn('Failed to emit Tauri event:', err))
        }).catch(() => {})
      }
    } catch {
      // 忽略
    }

    return event
  }
}

export function appendAgentEvent(events: AgentEvent[], event: AgentEvent, limit = 500): AgentEvent[] {
  return [...events, event].slice(-limit)
}

export function replayAgentEvents(events: AgentEvent[]): AgentReplayState {
  const replay: AgentReplayState = {
    runId: events.find(event => event.runId)?.runId,
    status: 'idle',
    currentThought: '',
    actions: [],
    observations: [],
    toolCalls: [],
    approvals: [],
    modelRequests: [],
    executionSteps: [],
    errors: [],
    telemetry: {
      elapsedMs: 0,
      outputChars: 0,
      toolCallCount: 0,
      runningToolCount: 0,
      successfulToolCount: 0,
      failedToolCount: 0,
      completedStepCount: 0,
    },
  }

  const toolCallsById = new Map<string, ToolCall>()
  const startedAt = events.find(event => event.type === 'agent.started')?.timestamp || events[0]?.timestamp
  let updatedAt = startedAt
  let currentPhase: AgentActivityPhase | undefined
  let outputChars = 0
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let completedStepCount = 0
  let latestToolName: string | undefined

  for (const event of events) {
    const payload = event.payload || {}
    const hiddenEvent = payload.internal === true || payload.visibility === 'hidden'
    updatedAt = event.timestamp

    if (typeof payload.toolName === 'string') {
      if (!isSupportOnlyToolName(payload.toolName)) {
        latestToolName = payload.toolName
      }
    } else if (typeof payload.tool === 'string') {
      if (!isSupportOnlyToolName(payload.tool)) {
        latestToolName = payload.tool
      }
    } else if (isToolCall(payload.toolCall)) {
      if (!isSupportOnlyToolName(payload.toolCall.toolName)) {
        latestToolName = payload.toolCall.toolName
      }
    }

    switch (event.type) {
      case 'agent.started':
        replay.status = 'running'
        currentPhase = 'preparing'
        break
      case 'agent.stopped':
        replay.status = 'stopped'
        currentPhase = 'completed'
        break
      case 'agent.completed':
        replay.status = 'completed'
        currentPhase = 'completed'
        if (typeof payload.result === 'string') {
          replay.finalAnswer = payload.result
          outputChars = Math.max(outputChars, payload.result.length)
        }
        break
      case 'agent.planning':
        currentPhase = 'planning'
        break
      case 'iteration.started':
        currentPhase = 'thinking'
        break
      case 'thought':
      case 'thought.updated':
        if (hiddenEvent) {
          break
        }
        if (typeof payload.content === 'string') {
          replay.currentThought = payload.content
          outputChars = Math.max(outputChars, payload.content.length)
        }
        currentPhase = 'thinking'
        break
      case 'action':
      case 'action.parsed':
        if (isSupportOnlyToolName(payload.tool)) {
          break
        }
        if (typeof payload.tool === 'string') {
          latestToolName = payload.tool
          replay.actions.push({
            tool: payload.tool,
            params: typeof payload.params === 'object' && payload.params ? payload.params : {},
            iteration: event.iteration,
            timestamp: event.timestamp,
          })
        }
        currentPhase = 'tool'
        break
      case 'observation':
      case 'observation.created':
        if (hiddenEvent || isSupportOnlyToolName(payload.toolName) || isSupportOnlyObservationText(payload.observation)) {
          break
        }
        if (typeof payload.observation === 'string') {
          replay.observations.push({
            content: payload.observation,
            iteration: event.iteration,
            timestamp: event.timestamp,
          })
        }
        break
      case 'tool':
      case 'tool.updated': {
        const toolCall = payload.toolCall
        if (isToolCall(toolCall) && isSupportOnlyToolName(toolCall.toolName)) {
          break
        }
        if (isToolCall(toolCall)) {
          toolCallsById.set(toolCall.id, toolCall)
          latestToolName = toolCall.toolName
        }
        currentPhase = 'tool'
        break
      }
      case 'approval':
        replay.status = payload.status === 'requested' ? 'waiting_approval' : replay.status
        replay.approvals.push({
          status: typeof payload.status === 'string' ? payload.status : 'unknown',
          toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
          timestamp: event.timestamp,
          payload,
        })
        if (payload.status === 'requested') {
          currentPhase = 'waiting-confirmation'
        }
        break
      case 'model.request.started':
        replay.modelRequests.push({
          status: 'started',
          iteration: event.iteration,
          timestamp: event.timestamp,
          payload,
        })
        currentPhase = 'thinking'
        break
      case 'model.response.received':
        replay.modelRequests.push({
          status: 'received',
          iteration: event.iteration,
          timestamp: event.timestamp,
          payload,
        })
        if (typeof payload.contentLength === 'number') {
          outputChars = Math.max(outputChars, payload.contentLength)
        }
        if (typeof payload.inputTokens === 'number') {
          inputTokens = payload.inputTokens
        }
        if (typeof payload.outputTokens === 'number') {
          outputTokens = payload.outputTokens
        }
        currentPhase = 'thinking'
        break
      case 'confirmation.waiting':
        replay.status = 'waiting_approval'
        replay.approvals.push({
          status: 'requested',
          toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
          timestamp: event.timestamp,
          payload,
        })
        currentPhase = 'waiting-confirmation'
        break
      case 'confirmation.resolved':
        replay.approvals.push({
          status: typeof payload.status === 'string' ? payload.status : 'resolved',
          toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
          timestamp: event.timestamp,
          payload,
        })
        break
      case 'tool.execution.started':
        if (isSupportOnlyToolName(payload.toolName)) {
          break
        }
        currentPhase = 'tool'
        replay.executionSteps.push({
          status: event.type,
          title: typeof payload.title === 'string' ? payload.title : undefined,
          iteration: event.iteration,
          timestamp: event.timestamp,
          payload,
        })
        break
      case 'tool.execution.finished':
        if (isSupportOnlyToolName(payload.toolName)) {
          break
        }
        currentPhase = payload.success === false ? 'error' : 'tool'
        replay.executionSteps.push({
          status: event.type,
          title: typeof payload.title === 'string' ? payload.title : undefined,
          iteration: event.iteration,
          timestamp: event.timestamp,
          payload,
        })
        break
      case 'step.completed':
        if (hiddenEvent || isSupportOnlyToolName(payload.toolName) || isSupportOnlyObservationText(payload.observation)) {
          break
        }
        completedStepCount += 1
        currentPhase = payload.success === false ? 'error' : currentPhase
        replay.executionSteps.push({
          status: event.type,
          title: typeof payload.title === 'string' ? payload.title : undefined,
          iteration: event.iteration,
          timestamp: event.timestamp,
          payload,
        })
        break
      case 'final':
      case 'final.answer.rendered':
        if (typeof payload.content === 'string') {
          replay.finalAnswer = payload.content
          outputChars = Math.max(outputChars, payload.content.length)
        }
        currentPhase = 'answering'
        break
      case 'final.answer.rejected':
        replay.finalAnswer = undefined
        currentPhase = 'thinking'
        break
      case 'error':
        replay.status = 'error'
        replay.errors.push(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload))
        currentPhase = 'error'
        break
      default:
        break
    }
  }

  replay.toolCalls = Array.from(toolCallsById.values())
  const runningToolCount = replay.toolCalls.filter(toolCall => toolCall.status === 'running' || toolCall.status === 'pending').length
  const successfulToolCount = replay.toolCalls.filter(toolCall => toolCall.status === 'success').length
  const failedToolCount = replay.toolCalls.filter(toolCall => toolCall.status === 'error').length
  replay.telemetry = {
    startedAt,
    updatedAt,
    elapsedMs: startedAt && updatedAt ? Math.max(0, updatedAt - startedAt) : 0,
    outputChars,
    inputTokens,
    outputTokens,
    toolCallCount: replay.toolCalls.length,
    runningToolCount,
    successfulToolCount,
    failedToolCount,
    completedStepCount,
    currentPhase,
    latestToolName,
  }
  return replay
}

export function createAgentEventBus(options?: AgentEventBusOptions): AgentEventBus {
  return new AgentEventBus(options)
}
