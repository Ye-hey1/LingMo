import type { Tool } from '../types'

export const listAgentRunSummariesTool: Tool = {
  name: 'list_agent_run_summaries',
  description: 'List recent Agent run summaries, including tools used, files touched, failures, and outcomes. Useful for avoiding repeated mistakes and continuing prior work patterns.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum summaries to return, default 10' },
    { name: 'query', type: 'string', required: false, description: 'Optional keyword filter across user goal, result, tools, failures, and files' },
    { name: 'filePath', type: 'string', required: false, description: 'Optional file path fragment to match touched files' },
    { name: 'toolName', type: 'string', required: false, description: 'Optional exact tool name filter' },
    { name: 'onlyFailures', type: 'boolean', required: false, description: 'When true, return only stopped runs or runs with tool failures' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const limit = Math.min(30, Math.max(1, Number(params.limit) || 10))
    const hasFilter = Boolean(params.query || params.filePath || params.toolName || params.onlyFailures)
    const { listAgentRunSummaries, searchAgentRunSummaries } = await import('../run-summary')
    const summaries = hasFilter
      ? await searchAgentRunSummaries({
          query: typeof params.query === 'string' ? params.query : undefined,
          filePath: typeof params.filePath === 'string' ? params.filePath : undefined,
          toolName: typeof params.toolName === 'string' ? params.toolName : undefined,
          onlyFailures: params.onlyFailures === true,
          limit,
        })
      : await listAgentRunSummaries(limit)

    if (summaries.length === 0) {
      return {
        success: true,
        message: hasFilter ? 'No matching Agent run summaries found.' : 'No Agent run summaries found yet.',
        data: [],
      }
    }

    return {
      success: true,
      message: summaries.map((summary, index) => {
        const tools = summary.toolsUsed.map(tool => `${tool.toolName}(${tool.count})`).join(', ') || 'none'
        const failures = summary.failures.map(item => `${item.toolName}: ${item.error}`).slice(0, 2).join('; ') || 'none'
        return `${index + 1}. ${summary.userGoal}\n   Result: ${summary.result || (summary.stopped ? 'stopped' : 'completed')}\n   Tools: ${tools}\n   Files: ${summary.filesTouched.slice(0, 5).join(', ') || 'none'}\n   Failures: ${failures}`
      }).join('\n\n'),
      data: summaries,
    }
  },
}

export const agentMemoryTools: Tool[] = [
  listAgentRunSummariesTool,
]
