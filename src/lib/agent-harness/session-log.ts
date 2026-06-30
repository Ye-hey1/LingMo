import type { AgentEvent, ToolResult } from '@/lib/agent/types'
import type { AgentRuntimeSnapshot } from '@/lib/agent/runtime-snapshot'
import type { AgentRoute, VfsRef } from './types'

export type AgentSessionEntryType =
  | 'run_started'
  | 'turn_started'
  | 'turn_finished'
  | 'message'
  | 'thinking'
  | 'tool_call_started'
  | 'tool_result'
  | 'runtime_snapshot'
  | 'compaction'
  | 'branch_summary'
  | 'custom'
  | 'run_finished'

export interface AgentSessionEntryBase {
  type: AgentSessionEntryType
  id: string
  runId: string
  parentId: string | null
  timestamp: number
}

export interface AgentRunStartedEntry extends AgentSessionEntryBase {
  type: 'run_started'
  userGoal: string
  route: AgentRoute
}

export interface AgentTurnStartedEntry extends AgentSessionEntryBase {
  type: 'turn_started'
  iteration: number
  visibleToolNames: string[]
  contextPackRef?: VfsRef
}

export interface AgentTurnFinishedEntry extends AgentSessionEntryBase {
  type: 'turn_finished'
  iteration: number
  finishReason?: string | null
  toolCallCount: number
}

export interface AgentMessageEntry extends AgentSessionEntryBase {
  type: 'message'
  role: 'user' | 'assistant' | 'system'
  content: string
  iteration?: number
}

export interface AgentThinkingEntry extends AgentSessionEntryBase {
  type: 'thinking'
  content: string
  iteration?: number
}

export interface AgentToolCallStartedEntry extends AgentSessionEntryBase {
  type: 'tool_call_started'
  iteration?: number
  toolName: string
  toolCallId?: string
  paramsSummary?: string
}

export interface AgentToolResultEntry extends AgentSessionEntryBase {
  type: 'tool_result'
  iteration?: number
  toolName: string
  toolCallId?: string
  success: boolean
  status?: ToolResult['status']
  summary: string
  dataRef?: string
  retryable?: boolean
}

export interface AgentRuntimeSnapshotEntry extends AgentSessionEntryBase {
  type: 'runtime_snapshot'
  iteration?: number
  snapshot: AgentRuntimeSnapshot
}

export interface AgentCompactionEntry extends AgentSessionEntryBase {
  type: 'compaction'
  summary: string
  firstKeptEntryId?: string
  tokensBefore?: number
  details?: unknown
}

export interface AgentBranchSummaryEntry extends AgentSessionEntryBase {
  type: 'branch_summary'
  fromId: string
  summary: string
  details?: unknown
}

export interface AgentCustomEntry extends AgentSessionEntryBase {
  type: 'custom'
  customType: string
  data?: unknown
}

export interface AgentRunFinishedEntry extends AgentSessionEntryBase {
  type: 'run_finished'
  status: 'completed' | 'failed' | 'paused'
  finalAnswer?: string
  error?: string
}

export type AgentSessionEntry =
  | AgentRunStartedEntry
  | AgentTurnStartedEntry
  | AgentTurnFinishedEntry
  | AgentMessageEntry
  | AgentThinkingEntry
  | AgentToolCallStartedEntry
  | AgentToolResultEntry
  | AgentRuntimeSnapshotEntry
  | AgentCompactionEntry
  | AgentBranchSummaryEntry
  | AgentCustomEntry
  | AgentRunFinishedEntry

export interface AgentSessionLog {
  runId: string
  entries: AgentSessionEntry[]
  leafId: string | null
}

export type AgentSessionEntryAppendData<TEntry extends AgentSessionEntry = AgentSessionEntry> =
  TEntry extends AgentSessionEntry
    ? Omit<TEntry, 'id' | 'runId' | 'parentId' | 'timestamp'> & {
      id?: string
      parentId?: string | null
      timestamp?: number
    }
    : never

export interface AgentSessionLogAppendInput<TEntry extends AgentSessionEntry = AgentSessionEntry> {
  entry: AgentSessionEntryAppendData<TEntry>
}

function createEntryId(runId: string, sequence: number) {
  return `${runId}:entry:${sequence.toString(36).padStart(4, '0')}`
}

export function createAgentSessionLog(runId: string): AgentSessionLog {
  return {
    runId,
    entries: [],
    leafId: null,
  }
}

export function appendAgentSessionEntry<TEntry extends AgentSessionEntry>(
  log: AgentSessionLog,
  input: AgentSessionLogAppendInput<TEntry>,
): AgentSessionLog {
  const parentId = Object.hasOwn(input.entry, 'parentId')
    ? input.entry.parentId ?? null
    : log.leafId
  const entry = {
    ...input.entry,
    id: input.entry.id || createEntryId(log.runId, log.entries.length + 1),
    runId: log.runId,
    parentId,
    timestamp: input.entry.timestamp || Date.now(),
  } as unknown as TEntry

  return {
    ...log,
    entries: [...log.entries, entry],
    leafId: entry.id,
  }
}

export function getAgentSessionBranch(log: AgentSessionLog, leafId = log.leafId): AgentSessionEntry[] {
  if (!leafId) return []

  const byId = new Map(log.entries.map(entry => [entry.id, entry]))
  const branch: AgentSessionEntry[] = []
  let current = byId.get(leafId)

  while (current) {
    branch.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return branch
}

export function reduceAgentSessionLogFromEvents(input: {
  runId: string
  route: AgentRoute
  userGoal: string
  events: AgentEvent[]
}): AgentSessionLog {
  let log = appendAgentSessionEntry(createAgentSessionLog(input.runId), {
    entry: {
      type: 'run_started',
      route: input.route,
      userGoal: input.userGoal,
    },
  })

  for (const event of input.events) {
    const payload = event.payload || {}

    if (event.type === 'iteration.started') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'turn_started',
          iteration: event.iteration || 0,
          visibleToolNames: Array.isArray(payload.visibleToolNames) ? payload.visibleToolNames : [],
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if ((event.type === 'thought' || event.type === 'thought.updated') && typeof payload.content === 'string') {
      if (payload.internal === true || payload.visibility === 'hidden' || !payload.content.trim()) {
        continue
      }
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'thinking',
          content: payload.content,
          iteration: event.iteration,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'tool.execution.finished') {
      const toolCall = payload.toolCall
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'tool_result',
          iteration: event.iteration,
          toolName: String(payload.toolName || toolCall?.toolName || ''),
          toolCallId: typeof payload.toolCallId === 'string' ? payload.toolCallId : toolCall?.id,
          success: payload.success !== false,
          status: typeof payload.status === 'string' ? payload.status : toolCall?.status,
          summary: String(payload.message || payload.error || toolCall?.result?.message || toolCall?.result?.error || ''),
          dataRef: typeof payload.dataRef === 'string' ? payload.dataRef : undefined,
          retryable: typeof payload.retryable === 'boolean' ? payload.retryable : undefined,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'tool.execution.started') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'tool_call_started',
          iteration: event.iteration,
          toolName: String(payload.toolName || payload.tool || ''),
          toolCallId: typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined,
          paramsSummary: summarizeSessionLogParams(payload.params),
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'model.response.received') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'turn_finished',
          iteration: event.iteration || 0,
          finishReason: typeof payload.finishReason === 'string' ? payload.finishReason : null,
          toolCallCount: typeof payload.toolCallCount === 'number' ? payload.toolCallCount : 0,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'final.answer.rendered' && typeof payload.content === 'string') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'message',
          role: 'assistant',
          content: payload.content,
          iteration: event.iteration,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'agent.context.compacted') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'compaction',
          summary: typeof payload.summary === 'string'
            ? payload.summary
            : typeof payload.snapshot?.userGoal === 'string'
              ? `Compacted context for ${payload.snapshot.userGoal}`
              : 'Agent context compacted',
          details: payload.snapshot || payload,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'agent.completed') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'run_finished',
          status: 'completed',
          finalAnswer: typeof payload.result === 'string' ? payload.result : undefined,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'agent.stopped') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'run_finished',
          status: 'paused',
          error: typeof payload.reason === 'string' ? payload.reason : undefined,
          timestamp: event.timestamp,
        },
      })
      continue
    }

    if (event.type === 'error') {
      log = appendAgentSessionEntry(log, {
        entry: {
          type: 'run_finished',
          status: 'failed',
          error: String(payload.friendlyMessage || payload.error || ''),
          timestamp: event.timestamp,
        },
      })
    }
  }

  return log
}

function summarizeSessionLogParams(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined
  try {
    return JSON.stringify(params).slice(0, 500)
  } catch {
    return '[unserializable params]'
  }
}
