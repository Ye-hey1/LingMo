import type { AgentEvent } from './types'
import { AGENT_EVENT_SCHEMA_VERSION } from './types'

export interface AgentTraceTimelineItem {
  eventId: string
  runId?: string
  sequence?: number
  schemaVersion: string
  spanId: string
  parentId?: string
  type: AgentEvent['type']
  timestamp: number
  offsetMs: number
  iteration?: number
  level?: AgentEvent['level']
  payload: Record<string, any>
}

function fallbackEventId(event: AgentEvent, index: number) {
  return event.id || `${event.runId || 'agent'}:${event.sequence ?? index + 1}:${event.type}`
}

function fallbackSpanId(event: AgentEvent, index: number) {
  if (event.spanId) return event.spanId
  const safeType = event.type.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'
  return `span:${safeType}:${event.sequence ?? index + 1}`
}

export function normalizeAgentTraceEvents(events: AgentEvent[]): AgentTraceTimelineItem[] {
  if (events.length === 0) return []

  const startedAt = events.find(event => event.type === 'agent.started')?.timestamp || events[0].timestamp || 0
  return events.map((event, index) => {
    const timestamp = event.timestamp || startedAt
    return {
      eventId: fallbackEventId(event, index),
      runId: event.runId,
      sequence: event.sequence,
      schemaVersion: event.schemaVersion || AGENT_EVENT_SCHEMA_VERSION,
      spanId: fallbackSpanId(event, index),
      parentId: event.parentId || undefined,
      type: event.type,
      timestamp,
      offsetMs: Math.max(0, timestamp - startedAt),
      iteration: event.iteration,
      level: event.level,
      payload: event.payload || {},
    }
  })
}

export function buildAgentTraceTimeline(events: AgentEvent[]): AgentTraceTimelineItem[] {
  return normalizeAgentTraceEvents(events)
    .sort((left, right) => (left.timestamp - right.timestamp) || ((left.sequence || 0) - (right.sequence || 0)))
}

function compactPayload(payload: Record<string, any>) {
  try {
    return JSON.stringify(payload)
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}

export function renderAgentTraceTimelineMarkdown(events: AgentEvent[]): string {
  const timeline = buildAgentTraceTimeline(events)
  if (timeline.length === 0) {
    return 'Agent trace timeline is empty.'
  }

  return [
    `Agent trace timeline (${timeline.length} events)`,
    ...timeline.map(item => {
      const edge = item.parentId ? ` parent=${item.parentId}` : ''
      const iteration = item.iteration ? ` iter=${item.iteration}` : ''
      return `- +${item.offsetMs}ms ${item.eventId} ${item.type} span=${item.spanId}${edge}${iteration}: ${compactPayload(item.payload).slice(0, 600)}`
    }),
  ].join('\n')
}
