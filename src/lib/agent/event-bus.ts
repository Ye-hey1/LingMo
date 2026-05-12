import type { AgentEvent, AgentEventType, ToolCall } from './types'

export interface AgentEventBusOptions {
  runId?: string
  maxEvents?: number
}

export interface AgentReplayState {
  runId?: string
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'error'
  currentThought: string
  actions: Array<{ tool: string; params: Record<string, any>; iteration?: number; timestamp: number }>
  observations: Array<{ content: string; iteration?: number; timestamp: number }>
  toolCalls: ToolCall[]
  approvals: Array<{ status: string; toolName?: string; timestamp: number; payload?: Record<string, any> }>
  finalAnswer?: string
  errors: string[]
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

  constructor(options: AgentEventBusOptions = {}) {
    this.runId = options.runId || createRunId()
    this.maxEvents = options.maxEvents || 500
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
    errors: [],
  }

  const toolCallsById = new Map<string, ToolCall>()

  for (const event of events) {
    const payload = event.payload || {}

    switch (event.type) {
      case 'agent.started':
        replay.status = 'running'
        break
      case 'agent.stopped':
        replay.status = 'stopped'
        break
      case 'agent.completed':
        replay.status = 'completed'
        if (typeof payload.result === 'string') {
          replay.finalAnswer = payload.result
        }
        break
      case 'thought':
      case 'thought.updated':
        if (typeof payload.content === 'string') {
          replay.currentThought = payload.content
        }
        break
      case 'action':
      case 'action.parsed':
        if (typeof payload.tool === 'string') {
          replay.actions.push({
            tool: payload.tool,
            params: typeof payload.params === 'object' && payload.params ? payload.params : {},
            iteration: event.iteration,
            timestamp: event.timestamp,
          })
        }
        break
      case 'observation':
      case 'observation.created':
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
        if (isToolCall(toolCall)) {
          toolCallsById.set(toolCall.id, toolCall)
        }
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
        break
      case 'final':
      case 'final.answer.rendered':
        if (typeof payload.content === 'string') {
          replay.finalAnswer = payload.content
        }
        break
      case 'error':
        replay.status = 'error'
        replay.errors.push(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload))
        break
      default:
        break
    }
  }

  replay.toolCalls = Array.from(toolCallsById.values())
  return replay
}

export function createAgentEventBus(options?: AgentEventBusOptions): AgentEventBus {
  return new AgentEventBus(options)
}
