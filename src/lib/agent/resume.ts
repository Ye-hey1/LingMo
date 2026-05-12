import type { AgentContextSnapshot } from './types'
import { formatAgentContextSnapshot } from './context-compression'

/**
 * Agent 中断恢复模块
 * 当 Agent 被中断后，可以从 snapshot 恢复执行
 */

export interface ResumeContext {
  snapshot: AgentContextSnapshot
  originalUserInput: string
  interruptReason?: 'user_stop' | 'error' | 'timeout' | 'iteration_limit'
  interruptedAt: number
}

/**
 * 构建恢复 prompt
 * 将中断时的上下文注入新的 ReAct 循环
 */
export function buildResumePrompt(context: ResumeContext): string {
  const snapshotText = formatAgentContextSnapshot(context.snapshot)
  const reasonText = getInterruptReasonText(context.interruptReason)

  return `## Resuming Previous Task

The previous execution was interrupted${reasonText}. Here is the saved context:

${snapshotText}

## Instructions for Resumption
- Review the context above to understand what has already been done
- Do NOT repeat actions that are already marked as completed
- Continue from where the previous execution left off
- If all steps appear done, provide the Final Answer

## Original User Request
${context.originalUserInput}`
}

/**
 * 判断是否可以恢复
 */
export function canResumeFromSnapshot(snapshot: AgentContextSnapshot | undefined): boolean {
  if (!snapshot) return false

  // 快照太旧（超过 1 小时）不恢复
  const age = Date.now() - snapshot.compactedAt
  if (age > 60 * 60 * 1000) return false

  // 至少有一些工作已完成
  return snapshot.toolResults.length > 0 || snapshot.readFiles.length > 0
}

/**
 * 从 snapshot 中提取已完成的工作摘要
 */
export function getCompletedWorkSummary(snapshot: AgentContextSnapshot): string {
  const completedTools = snapshot.toolResults
    .filter(r => r.status === 'success' || r.status === 'observed')
    .map(r => `- ${r.toolName}: ${r.summary}`)

  const readFiles = snapshot.readFiles.map(f => `- ${f.path}`)

  const parts: string[] = []

  if (completedTools.length > 0) {
    parts.push(`Completed actions:\n${completedTools.join('\n')}`)
  }

  if (readFiles.length > 0) {
    parts.push(`Files already read:\n${readFiles.join('\n')}`)
  }

  const pendingTodos = snapshot.todos.filter(t => t.status === 'pending')
  if (pendingTodos.length > 0) {
    parts.push(`Remaining tasks:\n${pendingTodos.map(t => `- ${t.title}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

function getInterruptReasonText(reason?: string): string {
  switch (reason) {
    case 'user_stop': return ' (stopped by user)'
    case 'error': return ' (due to an error)'
    case 'timeout': return ' (due to timeout)'
    case 'iteration_limit': return ' (reached iteration limit)'
    default: return ''
  }
}
