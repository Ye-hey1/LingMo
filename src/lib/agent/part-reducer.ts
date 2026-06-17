import type { AgentActivityPhase, AgentEvent, AgentTurnTelemetry, ToolCall } from './types'
import type { AgentRuntimeSnapshot } from './runtime-snapshot'

export type AgentPartStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'retryable'
  | 'blocked'
  | 'skipped'
  | 'adjusted'
  | 'cached'
  | 'cancelled'
  | 'completed'

export type AgentPartVisibility = 'visible' | 'hidden'

export interface AgentBasePart {
  id: string
  runId?: string
  type: 'reasoning' | 'text' | 'tool' | 'status' | 'error' | 'checkpoint' | 'artifact'
  status: AgentPartStatus
  createdAt: number
  updatedAt: number
  visibility: AgentPartVisibility
}

export interface AgentReasoningPart extends AgentBasePart {
  type: 'reasoning'
  text: string
}

export interface AgentTextPart extends AgentBasePart {
  type: 'text'
  text: string
}

export interface AgentToolPart extends AgentBasePart {
  type: 'tool'
  toolCallId: string
  toolName: string
  params: Record<string, any>
  result?: ToolCall['result']
  recoverable?: boolean
  blockedReason?: string
}

export interface AgentStatusPart extends AgentBasePart {
  type: 'status'
  label: string
  detail?: string
  phase?: AgentActivityPhase
}

export interface AgentErrorPart extends AgentBasePart {
  type: 'error'
  message: string
  recoverable: boolean
}

export interface AgentCheckpointPart extends AgentBasePart {
  type: 'checkpoint'
  label: string
}

export interface AgentArtifactPart extends AgentBasePart {
  type: 'artifact'
  path: string
  label?: string
}

export type AgentPart =
  | AgentReasoningPart
  | AgentTextPart
  | AgentToolPart
  | AgentStatusPart
  | AgentErrorPart
  | AgentCheckpointPart
  | AgentArtifactPart

export interface AgentVisibleStatus {
  tone: 'running' | 'done' | 'error'
  label: string
  detail?: string
}

export interface AgentPartSnapshot {
  runId?: string
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'error'
  parts: AgentPart[]
  visibleStatus: AgentVisibleStatus
  finalAnswerContent?: string
  activity?: {
    phase: AgentActivityPhase
    label: string
    detail?: string
    startedAt: number
    iteration?: number
    toolName?: string
  }
  telemetry?: AgentTurnTelemetry
  runtimeSnapshot?: AgentRuntimeSnapshot
  recoverableErrors: string[]
  fatalErrors: string[]
}

export function createInitialAgentPartSnapshot(runId?: string): AgentPartSnapshot {
  return {
    runId,
    status: 'idle',
    parts: [],
    visibleStatus: {
      tone: 'running',
      label: '准备中',
    },
    recoverableErrors: [],
    fatalErrors: [],
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
}

function eventPayload(event: AgentEvent): Record<string, any> {
  return event.payload || {}
}

function createPartId(event: AgentEvent, suffix: string) {
  return `${event.runId || 'agent'}:${event.sequence || event.timestamp}:${suffix}`
}

function getReasoningPartId(event: AgentEvent) {
  return `${event.runId || 'agent'}:reasoning:live`
}

function getFinalAnswerPartId(event: AgentEvent) {
  return `${event.runId || 'agent'}:text:final`
}

function getPayloadToolName(payload: Record<string, any>) {
  return typeof payload.toolName === 'string'
    ? payload.toolName
    : typeof payload.tool === 'string'
      ? payload.tool
      : typeof payload.toolCall?.toolName === 'string'
        ? payload.toolCall.toolName
        : undefined
}

function getToolPartId(event: AgentEvent, toolCallId?: string) {
  return toolCallId
    ? `${event.runId || 'agent'}:tool:${toolCallId}`
    : createPartId(event, 'tool')
}

function upsertPart(parts: AgentPart[], nextPart: AgentPart): AgentPart[] {
  const index = parts.findIndex(part => part.id === nextPart.id)
  if (index < 0) return [...parts, nextPart]
  return parts.map((part, partIndex) => partIndex === index ? { ...part, ...nextPart } : part)
}

function isRecoverableToolError(result?: ToolCall['result']) {
  const message = `${result?.error || ''}\n${result?.message || ''}`
  if (/invalid[_\s-]?api[_\s-]?key|api key|unauthorized|forbidden|permission/i.test(message)) {
    return false
  }

  return Boolean(
    result?.data?.retryable ||
    /invalid utf-8|utf-8|decode|skipped_tool_call|too large|truncated|stale/i.test(message)
  )
}

function mapToolStatus(status: ToolCall['status']): AgentPartStatus {
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  return status
}

function getToolVisibleStatus(status: AgentPartStatus, recoverable?: boolean, detail?: string) {
  switch (status) {
    case 'error':
      return recoverable
        ? { tone: 'running' as const, label: '工具步骤失败，正在恢复', detail }
        : { tone: 'error' as const, label: '工具调用失败', detail }
    case 'blocked':
      return { tone: 'running' as const, label: '工具被策略阻止', detail }
    case 'skipped':
      return { tone: 'running' as const, label: '已跳过额外工具调用', detail }
    case 'adjusted':
      return { tone: 'running' as const, label: '工具选择已调整', detail }
    case 'cached':
      return { tone: 'running' as const, label: '使用缓存结果', detail }
    case 'cancelled':
      return { tone: 'done' as const, label: '工具调用已取消', detail }
    case 'success':
      return { tone: 'running' as const, label: '工具调用完成', detail }
    default:
      return { tone: 'running' as const, label: '正在调用工具', detail }
  }
}

function isPreparingVisibleStatus(status?: AgentVisibleStatus) {
  return status?.tone === 'running' && status.label === '准备中'
}

function isAnsweringVisibleStatus(status?: AgentVisibleStatus) {
  return status?.tone === 'running' && status.label === '正在写答案'
}

function isTerminalVisibleStatus(status?: AgentVisibleStatus) {
  return status?.tone === 'done' || status?.tone === 'error'
}

function resolveVisibleStatus(snapshot: AgentPartSnapshot, nextStatus: AgentVisibleStatus) {
  if (isTerminalVisibleStatus(nextStatus)) return nextStatus

  const currentStatus = snapshot.visibleStatus
  if (isTerminalVisibleStatus(currentStatus)) return currentStatus

  if (isPreparingVisibleStatus(nextStatus) && !isPreparingVisibleStatus(currentStatus)) {
    return currentStatus
  }

  if (isAnsweringVisibleStatus(currentStatus) && !isAnsweringVisibleStatus(nextStatus)) {
    return currentStatus
  }

  return nextStatus
}

function getPayloadToolCall(event: AgentEvent, payload: Record<string, any>): ToolCall | undefined {
  const direct = payload.toolCall as ToolCall | undefined
  if (direct?.toolName) return direct

  const toolName = getPayloadToolName(payload)
  if (!toolName) return undefined

  const status = typeof payload.status === 'string'
    ? payload.status as ToolCall['status']
    : event.type === 'tool.execution.started'
      ? 'running'
      : event.type === 'tool.execution.finished'
        ? payload.success === false ? 'error' : 'success'
        : 'pending'

  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.result === 'string'
      ? payload.result
      : undefined
  const error = typeof payload.error === 'string' ? payload.error : undefined

  return {
    id: typeof payload.toolCallId === 'string' ? payload.toolCallId : getToolPartId(event),
    toolName,
    params: typeof payload.params === 'object' && payload.params ? payload.params : {},
    status,
    timestamp: event.timestamp,
    result: (message || error || typeof payload.success === 'boolean')
      ? {
          success: payload.success !== false && status !== 'error',
          message,
          error,
          status,
        }
      : undefined,
  }
}

function reduceAgentPartSnapshotCore(
  snapshot: AgentPartSnapshot,
  event: AgentEvent,
): AgentPartSnapshot {
  const payload = eventPayload(event)

  switch (event.type) {
    case 'agent.started':
      return {
        ...snapshot,
        runId: event.runId || snapshot.runId,
        status: 'running',
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '准备中' }),
      }

    case 'iteration.started':
    case 'model.request.started':
      return {
        ...snapshot,
        runId: event.runId || snapshot.runId,
        status: 'running',
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '思考中' }),
      }

    case 'thought':
    case 'thought.updated': {
      if (payload.internal === true || payload.visibility === 'hidden') return snapshot
      if (typeof payload.content !== 'string' || !payload.content.trim()) return snapshot
      const now = event.timestamp
      const part: AgentReasoningPart = {
        id: getReasoningPartId(event),
        runId: event.runId,
        type: 'reasoning',
        status: payload.streaming === false ? 'completed' : 'running',
        visibility: 'hidden',
        createdAt: snapshot.parts.find(existing => existing.id === getReasoningPartId(event))?.createdAt || now,
        updatedAt: now,
        text: payload.content,
      }
      return {
        ...snapshot,
        runId: event.runId || snapshot.runId,
        status: 'running',
        parts: upsertPart(snapshot.parts, part),
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '思考中' }),
      }
    }

    case 'action':
    case 'action.parsed': {
      const toolName = getPayloadToolName(payload)
      if (!toolName) return snapshot
      return {
        ...snapshot,
        runId: event.runId || snapshot.runId,
        status: 'running',
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '准备调用工具' }),
      }
    }

    case 'tool':
    case 'tool.updated':
    case 'tool.execution.started':
    case 'tool.execution.finished': {
      const toolCall = getPayloadToolCall(event, payload)
      if (!toolCall?.toolName) return snapshot
      const status = mapToolStatus(toolCall.status)
      const recoverable = status === 'error' ? isRecoverableToolError(toolCall.result) : undefined
      const part: AgentToolPart = {
        id: getToolPartId(event, toolCall.id),
        runId: event.runId,
        type: 'tool',
        status,
        visibility: 'visible',
        createdAt: toolCall.timestamp || event.timestamp,
        updatedAt: event.timestamp,
        toolCallId: toolCall.id,
        toolName: toolCall.toolName,
        params: toolCall.params || {},
        result: toolCall.result,
        recoverable,
      }
      const detail = toolCall.result?.error || toolCall.result?.message
      const visibleStatus = getToolVisibleStatus(status, recoverable, detail)
      return {
        ...snapshot,
        runId: event.runId || snapshot.runId,
        status: status === 'error' && !recoverable ? 'error' : 'running',
        parts: upsertPart(snapshot.parts, part),
        visibleStatus: resolveVisibleStatus(snapshot, visibleStatus),
        recoverableErrors: recoverable && detail ? [...snapshot.recoverableErrors, detail] : snapshot.recoverableErrors,
        fatalErrors: status === 'error' && !recoverable && detail ? [...snapshot.fatalErrors, detail] : snapshot.fatalErrors,
      }
    }

    case 'confirmation.waiting':
      return {
        ...snapshot,
        status: 'waiting_approval',
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '等待确认', detail: payload.reason }),
      }

    case 'final':
    case 'final.answer.rendered': {
      const content = typeof payload.content === 'string' ? payload.content : snapshot.finalAnswerContent
      if (!content) {
        return {
          ...snapshot,
          status: snapshot.status === 'completed' ? 'completed' : 'running',
          visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '正在写答案' }),
        }
      }
      const now = event.timestamp
      const existing = snapshot.parts.find(part => part.id === getFinalAnswerPartId(event))
      const part: AgentTextPart = {
        id: getFinalAnswerPartId(event),
        runId: event.runId,
        type: 'text',
        status: event.type === 'final.answer.rendered' ? 'completed' : 'running',
        visibility: 'visible',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        text: content,
      }
      return {
        ...snapshot,
        status: snapshot.status === 'completed' ? 'completed' : 'running',
        runId: event.runId || snapshot.runId,
        parts: upsertPart(snapshot.parts, part),
        finalAnswerContent: content,
        visibleStatus: resolveVisibleStatus(snapshot, { tone: 'running', label: '正在写答案' }),
      }
    }

    case 'agent.completed': {
      const content = typeof payload.result === 'string' ? payload.result : snapshot.finalAnswerContent
      const now = event.timestamp
      const existing = snapshot.parts.find(part => part.id === getFinalAnswerPartId(event))
      const parts = content
        ? upsertPart(snapshot.parts, {
            id: getFinalAnswerPartId(event),
            runId: event.runId,
            type: 'text',
            status: 'completed',
            visibility: 'visible',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            text: content,
          })
        : snapshot.parts
      return {
        ...snapshot,
        status: 'completed',
        runId: event.runId || snapshot.runId,
        parts,
        finalAnswerContent: content,
        visibleStatus: { tone: 'done', label: '完成' },
      }
    }

    case 'agent.stopped':
      return {
        ...snapshot,
        status: 'stopped',
        visibleStatus: { tone: 'done', label: '已停止' },
      }

    case 'error': {
      const message = String(payload.friendlyMessage || payload.error || 'Unknown error')
      return {
        ...snapshot,
        status: 'error',
        visibleStatus: { tone: 'error', label: '执行失败', detail: message },
        fatalErrors: [...snapshot.fatalErrors, message],
      }
    }

    default:
      return snapshot
  }
}

// ============================================================================
// Telemetry 派生（增量）
//
// 目的：避免 agent-handler 每收到一个 event 就对整个 agentEvents 数组跑一遍
// replayAgentEvents（O(n) 全量重算，长对话下退化为 O(n²)）。这里改为从已经
// 增量维护的 partSnapshot.parts 派生计数类指标，并随 event 增量更新状态类
// 指标（时间/token/phase）。replayAgentEvents 仍保留，仅供「打开历史会话回放」
// 这类低频场景使用。
// ============================================================================

function computeToolTelemetry(parts: AgentPart[]) {
  let toolCallCount = 0
  let runningToolCount = 0
  let successfulToolCount = 0
  let failedToolCount = 0
  for (const part of parts) {
    if (part.type !== 'tool') continue
    toolCallCount += 1
    if (part.status === 'running' || part.status === 'pending') {
      runningToolCount += 1
    } else if (part.status === 'success') {
      successfulToolCount += 1
    } else if (part.status === 'error') {
      failedToolCount += 1
    }
  }
  return { toolCallCount, runningToolCount, successfulToolCount, failedToolCount }
}

function phaseFromEvent(event: AgentEvent): AgentActivityPhase | undefined {
  const p = event.payload || {}
  switch (event.type) {
    case 'agent.started':
      return 'preparing'
    case 'agent.planning':
      return 'planning'
    case 'iteration.started':
    case 'model.request.started':
    case 'thought':
    case 'thought.updated':
    case 'model.response.received':
      return 'thinking'
    case 'action':
    case 'action.parsed':
    case 'tool':
    case 'tool.updated':
    case 'tool.execution.started':
      return 'tool'
    case 'tool.execution.finished':
    case 'step.completed': {
      const isError = p.success === false
        && !['blocked', 'skipped', 'adjusted', 'cached'].includes(String(p.status || ''))
      return isError ? 'error' : 'tool'
    }
    case 'confirmation.waiting':
      return 'waiting-confirmation'
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

export function deriveTelemetry(
  snapshot: AgentPartSnapshot,
  event: AgentEvent,
): AgentTurnTelemetry {
  const prev = snapshot.telemetry
  const tool = computeToolTelemetry(snapshot.parts)

  const startedAt = prev?.startedAt
    ?? (event.type === 'agent.started' ? event.timestamp : snapshot.parts[0]?.createdAt)
  const updatedAt = event.timestamp
  const elapsedMs = startedAt ? Math.max(0, updatedAt - startedAt) : (prev?.elapsedMs || 0)

  const currentPhase = phaseFromEvent(event) ?? prev?.currentPhase

  const latestToolPart = [...snapshot.parts]
    .reverse()
    .find(part => part.type === 'tool') as AgentToolPart | undefined
  const latestToolName = latestToolPart?.toolName ?? prev?.latestToolName

  // outputChars / tokens：随 event 增量取 max（与 replayAgentEvents 行为一致）
  const payload = event.payload || {}
  let outputChars = prev?.outputChars || 0
  if (typeof payload.contentLength === 'number') {
    outputChars = Math.max(outputChars, payload.contentLength)
  }
  if (typeof payload.content === 'string') {
    outputChars = Math.max(outputChars, payload.content.length)
  }
  if (event.type === 'agent.completed' && typeof payload.result === 'string') {
    outputChars = Math.max(outputChars, payload.result.length)
  }
  const inputTokens = typeof payload.inputTokens === 'number' ? payload.inputTokens : prev?.inputTokens
  const outputTokens = typeof payload.outputTokens === 'number' ? payload.outputTokens : prev?.outputTokens

  // completedStepCount：每个 step.completed event 计一步（与 replay 一致）
  const completedStepCount = (prev?.completedStepCount || 0) + (event.type === 'step.completed' ? 1 : 0)

  return {
    startedAt,
    updatedAt,
    elapsedMs,
    outputChars,
    inputTokens,
    outputTokens,
    toolCallCount: tool.toolCallCount,
    runningToolCount: tool.runningToolCount,
    successfulToolCount: tool.successfulToolCount,
    failedToolCount: tool.failedToolCount,
    completedStepCount,
    currentPhase,
    latestToolName,
  }
}

export function reduceAgentPartSnapshot(
  snapshot: AgentPartSnapshot,
  event: AgentEvent,
): AgentPartSnapshot {
  const next = reduceAgentPartSnapshotCore(snapshot, event)
  if (next === snapshot) {
    // 无状态变化的分支（hidden/default）：保持引用不变，跳过 telemetry 派生
    return next
  }
  return { ...next, telemetry: deriveTelemetry(next, event) }
}
