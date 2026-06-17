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
    const { listAgentRunSummaries, searchAgentRunSummaries } = await import('../resume')
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

export const dreamMemoryCandidatesTool: Tool = {
  name: 'dream_memory_candidates',
  description: 'Analyze recent Agent run summaries, working memory, and saved memories to propose reviewable memory candidates. Manual review only; no automatic writes.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum run summaries to inspect, default 20' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const limit = Math.min(40, Math.max(1, Number(params.limit) || 20))
    const [{ listAgentRunSummaries }, { loadWorkingMemory }, { getAllMemories }, { buildDreamCandidates }] = await Promise.all([
      import('../resume'),
      import('../working-memory'),
      import('@/db/memories'),
      import('../dream'),
    ])
    const [summaries, workingMemory, memories] = await Promise.all([
      listAgentRunSummaries(limit),
      loadWorkingMemory(),
      getAllMemories(),
    ])
    const candidates = buildDreamCandidates({
      summaries,
      memories,
      workingMemory,
    })
    return {
      success: true,
      message: candidates.length > 0
        ? `Generated ${candidates.length} Dream candidate(s).`
        : 'No Dream candidates found.',
      data: candidates,
    }
  },
}

export const distillWorkflowRecommendationsTool: Tool = {
  name: 'distill_workflow_recommendations',
  description: 'Analyze repeated Agent run patterns and recommend reusable workflows, skills, or templates. Manual review only; no automatic creation.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum run summaries to inspect, default 30' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const limit = Math.min(60, Math.max(1, Number(params.limit) || 30))
    const { listAgentRunSummaries } = await import('../resume')
    const { buildDistillRecommendations } = await import('../dream')
    const summaries = await listAgentRunSummaries(limit)
    const recommendations = buildDistillRecommendations({
      summaries,
    })
    return {
      success: true,
      message: recommendations.length > 0
        ? `Generated ${recommendations.length} Distill recommendation(s).`
        : 'No repeated workflows found yet.',
      data: recommendations,
    }
  },
}

export const agentMemoryTools: Tool[] = [
  listAgentRunSummariesTool,
  dreamMemoryCandidatesTool,
  distillWorkflowRecommendationsTool,
]
