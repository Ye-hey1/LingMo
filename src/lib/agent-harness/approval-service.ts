import type { AgentEvent } from '@/lib/agent/types'
import type { ApprovalRequest } from './types'

function stableParamsKey(params: Record<string, unknown>) {
  try {
    return JSON.stringify(sortObjectKeys(params))
  } catch {
    return JSON.stringify(params)
  }
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  )
}

function approvalKey(request: Pick<ApprovalRequest, 'stepId' | 'toolName' | 'params'>) {
  return `${request.stepId}:${request.toolName}:${stableParamsKey(request.params)}`
}

export function approvalRequestFromEvent(runId: string, event: AgentEvent): ApprovalRequest | null {
  const toolName = typeof event.payload?.toolName === 'string' ? event.payload.toolName : undefined
  if (!toolName) return null

  const params = typeof event.payload?.params === 'object' && event.payload.params
    ? event.payload.params as Record<string, unknown>
    : {}
  const status = event.payload?.status === 'confirmed'
    ? 'approved'
    : event.payload?.status === 'rejected'
      ? 'rejected'
      : 'requested'
  const risk = event.payload?.risk === 'high' ? 'high' : 'medium'
  const approvalScope = event.payload?.approvalScope === 'session' || event.payload?.approvalScope === 'persistent'
    ? event.payload.approvalScope
    : 'once'

  return {
    id: event.id || `approval-${event.timestamp}`,
    runId,
    stepId: String(event.iteration || event.sequence || 'pending'),
    toolName,
    risk,
    status,
    reason: typeof event.payload?.reason === 'string' ? event.payload.reason : status,
    params,
    approvalScope,
  }
}

export function reduceApprovalHistory(
  history: ApprovalRequest[],
  request: ApprovalRequest,
): { history: ApprovalRequest[]; pendingApproval?: ApprovalRequest } {
  const key = approvalKey(request)
  const next = [...history]
  const existingIndex = next.findIndex(item => (
    approvalKey(item) === key ||
    (item.status === 'requested' && item.toolName === request.toolName && stableParamsKey(item.params) === stableParamsKey(request.params))
  ))

  if (existingIndex >= 0) {
    next[existingIndex] = {
      ...next[existingIndex],
      ...request,
      id: next[existingIndex].id,
    }
  } else {
    next.push(request)
  }

  return {
    history: next,
    pendingApproval: request.status === 'requested' ? request : undefined,
  }
}
