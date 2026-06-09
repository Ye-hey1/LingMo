import type { Tool } from '@/lib/agent/types'
import type { ApprovalRequest } from './types'

export function shouldInterruptForTool(tool: Tool) {
  return tool.requiresConfirmation || tool.risk === 'medium' || tool.risk === 'high'
}

export function createApprovalRequest(input: {
  runId: string
  stepId: string
  tool: Tool
  params: Record<string, unknown>
  reason: string
  diffPreview?: string
  affectedFiles?: string[]
}): ApprovalRequest {
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: input.runId,
    stepId: input.stepId,
    toolName: input.tool.name,
    risk: input.tool.risk === 'high' ? 'high' : 'medium',
    reason: input.reason,
    params: input.params,
    diffPreview: input.diffPreview,
    affectedFiles: input.affectedFiles,
    approvalScope: 'once',
  }
}
