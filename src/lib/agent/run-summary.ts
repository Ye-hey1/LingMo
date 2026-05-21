import { Store } from '@tauri-apps/plugin-store'
import type { AgentEvent, ReActStep, ToolCall } from './types'

export interface AgentRunSummary {
  id: string
  userGoal: string
  result: string
  stopped: boolean
  startedAt?: number
  completedAt: number
  iterations: number
  toolsUsed: Array<{ toolName: string; count: number; success: number; error: number }>
  filesTouched: string[]
  failures: Array<{ toolName: string; error: string }>
}

const STORE_FILE = 'agent-run-summaries.json'
const STORE_KEY = 'summaries'
const MAX_SUMMARIES = 80

function extractFilePath(params: Record<string, any>) {
  const value = params.filePath || params.path || params.folderPath || params.targetPath
  return typeof value === 'string' ? value.replace(/\\/g, '/') : ''
}

function getToolCallsFromEvents(events: AgentEvent[]): ToolCall[] {
  const latest = new Map<string, ToolCall>()
  events.forEach(event => {
    const toolCall = event.payload?.toolCall
    if (toolCall?.id && toolCall.toolName) {
      latest.set(toolCall.id, toolCall as ToolCall)
    }
  })
  return [...latest.values()]
}

export function buildAgentRunSummary(input: {
  userGoal: string
  result: string
  stopped?: boolean
  steps: ReActStep[]
  events: AgentEvent[]
}): AgentRunSummary {
  const toolCalls = getToolCallsFromEvents(input.events)
  const toolStats = new Map<string, { toolName: string; count: number; success: number; error: number }>()
  const filesTouched = new Set<string>()
  const failures: AgentRunSummary['failures'] = []

  toolCalls.forEach(call => {
    const stat = toolStats.get(call.toolName) || { toolName: call.toolName, count: 0, success: 0, error: 0 }
    stat.count += 1
    if (call.status === 'success') stat.success += 1
    if (call.status === 'error') stat.error += 1
    toolStats.set(call.toolName, stat)

    const path = extractFilePath(call.params || {})
    if (path) filesTouched.add(path)
    if (call.status === 'error') {
      failures.push({
        toolName: call.toolName,
        error: call.result?.error || call.result?.message || 'unknown error',
      })
    }
  })

  const startedAt = input.events.find(event => event.type === 'agent.started')?.timestamp
  return {
    id: `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userGoal: input.userGoal.slice(0, 800),
    result: input.result.slice(0, 1200),
    stopped: input.stopped === true,
    startedAt,
    completedAt: Date.now(),
    iterations: input.steps.length,
    toolsUsed: [...toolStats.values()].sort((a, b) => b.count - a.count),
    filesTouched: [...filesTouched].slice(0, 40),
    failures: failures.slice(0, 12),
  }
}

export async function saveAgentRunSummary(summary: AgentRunSummary) {
  try {
    const store = await Store.load(STORE_FILE)
    const existing = await store.get<AgentRunSummary[]>(STORE_KEY) || []
    await store.set(STORE_KEY, [summary, ...existing].slice(0, MAX_SUMMARIES))
    await (store as Store & { save?: () => Promise<void> }).save?.()
  } catch (error) {
    console.warn('[AgentRunSummary] Failed to save:', error)
  }
}

export async function listAgentRunSummaries(limit = 20): Promise<AgentRunSummary[]> {
  try {
    const store = await Store.load(STORE_FILE)
    const existing = await store.get<AgentRunSummary[]>(STORE_KEY) || []
    return existing.slice(0, limit)
  } catch {
    return []
  }
}

export interface SearchAgentRunSummariesOptions {
  query?: string
  filePath?: string
  toolName?: string
  onlyFailures?: boolean
  limit?: number
}

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase())
}

export async function searchAgentRunSummaries(options: SearchAgentRunSummariesOptions): Promise<AgentRunSummary[]> {
  const limit = Math.min(50, Math.max(1, options.limit || 10))
  const summaries = await listAgentRunSummaries(80)
  const query = options.query?.trim()
  const filePath = options.filePath?.trim().replace(/\\/g, '/')
  const toolName = options.toolName?.trim()

  return summaries.filter(summary => {
    if (options.onlyFailures && summary.failures.length === 0 && !summary.stopped) {
      return false
    }

    if (toolName && !summary.toolsUsed.some(tool => tool.toolName === toolName)) {
      return false
    }

    if (filePath && !summary.filesTouched.some(path => path.includes(filePath))) {
      return false
    }

    if (query) {
      const haystack = [
        summary.userGoal,
        summary.result,
        ...summary.filesTouched,
        ...summary.failures.map(failure => `${failure.toolName} ${failure.error}`),
        ...summary.toolsUsed.map(tool => tool.toolName),
      ].join('\n')

      if (!includesText(haystack, query)) {
        return false
      }
    }

    return true
  }).slice(0, limit)
}
