import type {
  AgentActivityPhase,
  AgentEvent,
  AgentEventChannel,
  AgentEventEnvelope,
  AgentEventEnvelopeStatus,
  AgentEventSource,
  AgentEventType,
  AgentEventVisibility,
  ToolCall,
  ToolCallStatus,
} from './types'
import { AGENT_EVENT_ENVELOPE_VERSION } from './types'

function payloadOf(event: AgentEvent): Record<string, any> {
  return event.payload || {}
}

function toolNameFromPayload(payload: Record<string, any>) {
  return typeof payload.toolName === 'string'
    ? payload.toolName
    : typeof payload.tool === 'string'
      ? payload.tool
      : typeof payload.toolCall?.toolName === 'string'
        ? payload.toolCall.toolName
        : undefined
}

function toolCallIdFromPayload(payload: Record<string, any>) {
  return typeof payload.toolCallId === 'string'
    ? payload.toolCallId
    : typeof payload.toolCall?.id === 'string'
      ? payload.toolCall.id
      : undefined
}

function statusFromPayload(payload: Record<string, any>, fallback: AgentEventEnvelopeStatus): AgentEventEnvelopeStatus {
  const raw = typeof payload.status === 'string'
    ? payload.status
    : typeof payload.toolCall?.status === 'string'
      ? payload.toolCall.status
      : undefined

  switch (raw) {
    case 'pending':
    case 'running':
    case 'success':
    case 'error':
    case 'blocked':
    case 'skipped':
    case 'adjusted':
    case 'cached':
    case 'cancelled':
      return raw
    case 'confirmed':
      return 'success'
    case 'rejected':
      return 'blocked'
    default:
      return fallback
  }
}

function sourceFromType(type: AgentEventType, payload: Record<string, any>): AgentEventSource {
  if (typeof payload.source === 'string') {
    if (['model', 'tool', 'runtime', 'skill', 'mcp', 'approval', 'research', 'unknown'].includes(payload.source)) {
      return payload.source as AgentEventSource
    }
  }
  if (type.startsWith('model.') || type.startsWith('agent.stream') || type === 'thought' || type === 'thought.updated' || type === 'final' || type.startsWith('final.')) {
    return 'model'
  }
  if (type.startsWith('tool.') || type === 'tool' || type === 'tool.updated' || type === 'action' || type === 'action.parsed' || type === 'observation' || type === 'observation.created' || type === 'step.completed') {
    return 'tool'
  }
  if (type.startsWith('mcp.')) return 'mcp'
  if (type.startsWith('skills.')) return 'skill'
  if (type === 'approval' || type.startsWith('confirmation.')) return 'approval'
  if (type.startsWith('research.')) return 'research'
  return 'runtime'
}

function channelFromType(type: AgentEventType): AgentEventChannel {
  if (type === 'thought' || type === 'thought.updated') return 'reasoning'
  if (type.startsWith('agent.stream') || type === 'final' || type.startsWith('final.')) return 'answer'
  if (type === 'action' || type === 'action.parsed' || type === 'observation' || type === 'observation.created' || type.startsWith('tool.') || type === 'tool' || type === 'tool.updated' || type === 'step.completed') return 'tool'
  if (type === 'approval' || type.startsWith('confirmation.')) return 'approval'
  if (type === 'agent.planning') return 'planning'
  if (type === 'agent.context.compacted') return 'context'
  if (type.startsWith('skills.')) return 'skill'
  if (type.startsWith('mcp.')) return 'mcp'
  if (type.startsWith('research.')) return 'research'
  if (type === 'error') return 'error'
  if (type.startsWith('model.')) return 'status'
  return 'lifecycle'
}

function phaseFromType(type: AgentEventType, payload: Record<string, any>): AgentActivityPhase | undefined {
  switch (type) {
    case 'agent.started':
    case 'mcp.runtime.warmup':
    case 'skills.selected':
      return 'preparing'
    case 'agent.planning':
      return 'planning'
    case 'model.request.started':
    case 'model.response.received':
    case 'agent.stream.started':
    case 'iteration.started':
    case 'thought':
    case 'thought.updated':
      return 'thinking'
    case 'action':
    case 'action.parsed':
    case 'tool':
    case 'tool.updated':
    case 'tool.batch.started':
    case 'tool.batch.finished':
    case 'tool.execution.started':
    case 'tool.execution.finished':
    case 'observation':
    case 'observation.created':
    case 'step.completed':
      return 'tool'
    case 'approval':
    case 'confirmation.waiting':
      return payload.status === 'requested' || type === 'confirmation.waiting'
        ? 'waiting-confirmation'
        : undefined
    case 'agent.stream.delta':
    case 'agent.stream.finished':
    case 'final':
    case 'final.answer.rendered':
      return 'answering'
    case 'agent.completed':
    case 'agent.stopped':
      return 'completed'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

function statusFromType(type: AgentEventType, payload: Record<string, any>): AgentEventEnvelopeStatus {
  switch (type) {
    case 'agent.started':
    case 'agent.stream.started':
    case 'iteration.started':
    case 'model.request.started':
    case 'tool.batch.started':
    case 'tool.execution.started':
      return 'started'
    case 'thought':
    case 'thought.updated':
    case 'agent.stream.delta':
      return 'delta'
    case 'model.response.received':
    case 'agent.stream.finished':
    case 'tool.batch.finished':
      return 'finished'
    case 'tool':
    case 'tool.updated':
    case 'tool.execution.finished':
      return statusFromPayload(payload, payload.success === false ? 'error' : 'success')
    case 'approval':
    case 'confirmation.resolved':
      return statusFromPayload(payload, 'unknown')
    case 'confirmation.waiting':
      return 'pending'
    case 'final':
    case 'final.answer.rendered':
    case 'step.completed':
      return 'completed'
    case 'agent.completed':
      return 'completed'
    case 'agent.stopped':
      return 'stopped'
    case 'error':
      return 'error'
    default:
      return statusFromPayload(payload, 'unknown')
  }
}

function contentFromPayload(type: AgentEventType, payload: Record<string, any>) {
  if (typeof payload.content === 'string') return payload.content
  if (type === 'agent.completed' && typeof payload.result === 'string') return payload.result
  if (typeof payload.observation === 'string') return payload.observation
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  return undefined
}

function visibilityFromPayload(payload: Record<string, any>): AgentEventVisibility {
  return payload.internal === true || payload.visibility === 'hidden' ? 'hidden' : 'visible'
}

function toolStatusFromEnvelopeStatus(status: AgentEventEnvelopeStatus): ToolCallStatus | undefined {
  switch (status) {
    case 'pending':
    case 'running':
    case 'success':
    case 'error':
    case 'blocked':
    case 'skipped':
    case 'adjusted':
    case 'cached':
    case 'cancelled':
      return status
    case 'started':
      return 'running'
    default:
      return undefined
  }
}

export function buildAgentEventEnvelope(event: AgentEvent): AgentEventEnvelope {
  const payload = payloadOf(event)
  const status = statusFromType(event.type, payload)
  const toolName = toolNameFromPayload(payload)
  const toolStatus = toolStatusFromEnvelopeStatus(status)
  const errorMessage = typeof payload.friendlyMessage === 'string'
    ? payload.friendlyMessage
    : typeof payload.error === 'string'
      ? payload.error
      : undefined

  return {
    version: AGENT_EVENT_ENVELOPE_VERSION,
    eventId: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    iteration: event.iteration,
    spanId: event.spanId,
    parentId: event.parentId,
    source: sourceFromType(event.type, payload),
    channel: channelFromType(event.type),
    phase: phaseFromType(event.type, payload),
    visibility: visibilityFromPayload(payload),
    status,
    content: contentFromPayload(event.type, payload),
    stream: event.type.startsWith('agent.stream') || typeof payload.segmentId === 'string'
      ? {
          segmentId: typeof payload.segmentId === 'string' ? payload.segmentId : undefined,
          kind: typeof payload.kind === 'string' ? payload.kind : undefined,
          contentLength: typeof payload.contentLength === 'number' ? payload.contentLength : undefined,
          deltaLength: typeof payload.deltaLength === 'number' ? payload.deltaLength : undefined,
          finishReason: typeof payload.finishReason === 'string' || payload.finishReason === null ? payload.finishReason : undefined,
        }
      : undefined,
    model: event.type.startsWith('model.')
      ? {
          provider: typeof payload.provider === 'string' ? payload.provider : undefined,
          model: typeof payload.model === 'string' ? payload.model : undefined,
          mode: typeof payload.mode === 'string' ? payload.mode : undefined,
          thinkingLevel: typeof payload.thinkingLevel === 'string' ? payload.thinkingLevel : undefined,
          thinkingSupported: typeof payload.thinkingSupported === 'boolean' ? payload.thinkingSupported : undefined,
        }
      : undefined,
    usage: typeof payload.inputTokens === 'number' || typeof payload.outputTokens === 'number'
      ? {
          inputTokens: typeof payload.inputTokens === 'number' ? payload.inputTokens : undefined,
          outputTokens: typeof payload.outputTokens === 'number' ? payload.outputTokens : undefined,
          totalTokens: typeof payload.inputTokens === 'number' && typeof payload.outputTokens === 'number'
            ? payload.inputTokens + payload.outputTokens
            : undefined,
        }
      : undefined,
    tool: toolName
      ? {
          callId: toolCallIdFromPayload(payload),
          name: toolName,
          status: toolStatus,
        }
      : undefined,
    error: errorMessage
      ? {
          message: errorMessage,
          recoverable: typeof payload.retryable === 'boolean' ? payload.retryable : undefined,
        }
      : undefined,
    metadata: payload.toolCall
      ? { ...payload, toolCall: undefined as ToolCall | undefined }
      : payload,
  }
}

export function getAgentEventEnvelope(event: AgentEvent): AgentEventEnvelope {
  return event.envelope || buildAgentEventEnvelope(event)
}
