import type { Tool } from '../types'

function compactText(value?: string | null, maxLength = 240) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

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

export const getAgentRunDetailTool: Tool = {
  name: 'get_agent_run_detail',
  description: 'Read one persisted Agent run in detail from SQLite, including projected steps, tool calls, approvals, artifacts, and recent events.',
  category: 'system',
  parameters: [
    { name: 'runId', type: 'string', required: true, description: 'Agent run ID returned by list_agent_run_summaries or the live run state' },
    { name: 'eventLimit', type: 'number', required: false, description: 'Maximum recent events to return in data, default 80' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const runId = typeof params.runId === 'string' ? params.runId.trim() : ''
    if (!runId) {
      return {
        success: false,
        error: 'Missing runId',
      }
    }

    const eventLimit = Math.min(200, Math.max(1, Number(params.eventLimit) || 80))
    const { getAgentRunDetailFromDb } = await import('@/db/agent')
    const detail = await getAgentRunDetailFromDb(runId)
    if (!detail) {
      return {
        success: false,
        error: `Agent run not found: ${runId}`,
      }
    }

    const failedTools = detail.toolCalls.filter(call => call.success === 0 || call.status === 'error' || call.status === 'blocked')
    const toolSummary = detail.toolCalls
      .map(call => `${call.toolName}:${call.status}`)
      .slice(0, 12)
      .join(', ') || 'none'
    const stepSummary = detail.steps
      .map(step => `${step.stepIndex}. ${step.status} ${compactText(step.title, 80)}`)
      .slice(0, 12)
      .join('\n') || 'none'
    const failureSummary = failedTools
      .map(call => `${call.toolName}: ${compactText(call.error || call.message || call.status, 140)}`)
      .slice(0, 6)
      .join('\n') || 'none'

    return {
      success: true,
      message: [
        `Run: ${detail.run.id}`,
        `Status: ${detail.run.status}`,
        `Goal: ${compactText(detail.run.userGoal, 320)}`,
        `Result: ${compactText(detail.run.finalAnswer || detail.run.error, 320) || 'none'}`,
        `Steps:\n${stepSummary}`,
        `Tools: ${toolSummary}`,
        `Failures:\n${failureSummary}`,
        `Artifacts: ${detail.artifacts.map(artifact => artifact.path).slice(0, 8).join(', ') || 'none'}`,
      ].join('\n'),
      data: {
        ...detail,
        events: detail.events.slice(-eventLimit),
        eventCount: detail.events.length,
      },
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

export const generateMemoryReviewQueueTool: Tool = {
  name: 'generate_memory_review_queue',
  description: 'Convert recent Agent run evidence into a durable manual review queue for long-term memories, failure lessons, and workflow templates. Does not approve candidates.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum run summaries to inspect, default 40' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'write'],
  execute: async (params) => {
    const limit = Math.min(80, Math.max(1, Number(params.limit) || 40))
    const { generateAgentMemoryCandidates } = await import('../memory-candidates')
    const result = await generateAgentMemoryCandidates(limit)
    return {
      success: true,
      message: `Generated ${result.generatedCandidateCount} candidate(s) from ${result.inspectedRunCount} run(s); ${result.candidates.length} queue record(s) inserted or refreshed.`,
      data: result,
    }
  },
}

export const listMemoryReviewQueueTool: Tool = {
  name: 'list_memory_review_queue',
  description: 'List reviewable Agent memory candidates waiting for confirmation, including evidence and source runs.',
  category: 'system',
  parameters: [
    { name: 'status', type: 'string', required: false, description: 'pending, approved, rejected, archived, or all. Defaults to pending.' },
    { name: 'limit', type: 'number', required: false, description: 'Maximum queue records to return, default 20' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const status = typeof params.status === 'string' ? params.status : 'pending'
    const limit = Math.min(80, Math.max(1, Number(params.limit) || 20))
    const normalizedStatus = (
      ['pending', 'approved', 'rejected', 'archived', 'all'].includes(status)
        ? status
        : 'pending'
    ) as 'pending' | 'approved' | 'rejected' | 'archived' | 'all'
    const { listAgentMemoryCandidates } = await import('../memory-candidates')
    const candidates = await listAgentMemoryCandidates({
      status: normalizedStatus,
      limit,
    })
    return {
      success: true,
      message: candidates.length > 0
        ? candidates.map((candidate, index) => `${index + 1}. [${candidate.kind}/${candidate.confidence}/${candidate.status}] ${compactText(candidate.content, 180)}`).join('\n')
        : 'No memory review candidates found.',
      data: candidates,
    }
  },
}

export const approveMemoryCandidateTool: Tool = {
  name: 'approve_memory_candidate',
  description: 'Approve one queued Agent memory candidate. Memory and failure candidates are written to long-term memory; workflow candidates become workflow templates.',
  category: 'system',
  parameters: [
    { name: 'id', type: 'string', required: true, description: 'Candidate ID from list_memory_review_queue' },
  ],
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  execute: async (params) => {
    const id = typeof params.id === 'string' ? params.id.trim() : ''
    if (!id) {
      return {
        success: false,
        error: 'Missing candidate id',
      }
    }
    const { approveAgentMemoryCandidate } = await import('../memory-candidates')
    const result = await approveAgentMemoryCandidate(id)
    return {
      success: true,
      message: `Candidate approved into ${result.targetType}: ${result.targetId}`,
      data: result,
    }
  },
}

export const rejectMemoryCandidateTool: Tool = {
  name: 'reject_memory_candidate',
  description: 'Reject one queued Agent memory candidate so it will not be offered again as pending evidence.',
  category: 'system',
  parameters: [
    { name: 'id', type: 'string', required: true, description: 'Candidate ID from list_memory_review_queue' },
    { name: 'note', type: 'string', required: false, description: 'Optional review note' },
  ],
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  execute: async (params) => {
    const id = typeof params.id === 'string' ? params.id.trim() : ''
    if (!id) {
      return {
        success: false,
        error: 'Missing candidate id',
      }
    }
    const { rejectAgentMemoryCandidate } = await import('../memory-candidates')
    const candidate = await rejectAgentMemoryCandidate(id, typeof params.note === 'string' ? params.note : undefined)
    return {
      success: true,
      message: `Candidate rejected: ${candidate.id}`,
      data: candidate,
    }
  },
}

export const listWorkflowTemplatesTool: Tool = {
  name: 'list_agent_workflow_templates',
  description: 'List approved Agent workflow templates distilled from reviewed memory candidates. Use them to reuse proven steps, tools, and risk notes for similar tasks.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum workflow templates to return, default 20' },
    { name: 'query', type: 'string', required: false, description: 'Optional keyword filter across title, summary, steps, tools, and risks' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20))
    const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : ''
    const [
      { listAgentWorkflowTemplatesFromDb },
      { parseAgentWorkflowTemplateRecord },
    ] = await Promise.all([
      import('@/db/agent'),
      import('../workflow-templates'),
    ])
    const templates = (await listAgentWorkflowTemplatesFromDb(limit * 2))
      .map(parseAgentWorkflowTemplateRecord)
      .filter(template => {
        if (!query) return true
        return [
          template.title,
          template.summary,
          ...template.triggerExamples,
          ...template.reusableSteps,
          ...template.requiredTools,
          ...template.riskNotes,
        ].join('\n').toLowerCase().includes(query)
      })
      .slice(0, limit)

    return {
      success: true,
      message: templates.length > 0
        ? templates.map((template, index) => [
            `${index + 1}. ${template.title}`,
            `   Summary: ${compactText(template.summary, 180)}`,
            template.requiredTools.length ? `   Tools: ${template.requiredTools.join(', ')}` : '',
            template.reusableSteps.length ? `   Steps: ${template.reusableSteps.slice(0, 4).join(' / ')}` : '',
          ].filter(Boolean).join('\n')).join('\n\n')
        : 'No approved Agent workflow templates found.',
      data: templates,
    }
  },
}

export const listSelfEvolutionReviewsTool: Tool = {
  name: 'list_self_evolution_reviews',
  description: 'List recent post-run self-evolution reviews, including whether they generated reviewable memory/workflow candidates.',
  category: 'system',
  parameters: [
    { name: 'limit', type: 'number', required: false, description: 'Maximum reviews to return, default 20' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async (params) => {
    const limit = Math.min(60, Math.max(1, Number(params.limit) || 20))
    const { listAgentSelfEvolutionReviewsFromDb } = await import('@/db/agent')
    const reviews = await listAgentSelfEvolutionReviewsFromDb(limit)
    return {
      success: true,
      message: reviews.length > 0
        ? reviews.map((review, index) => `${index + 1}. [${review.status}] ${review.runId} · ${review.changedCount} candidate(s)\n   ${compactText(review.summary, 220)}`).join('\n\n')
        : 'No self-evolution reviews found yet.',
      data: reviews,
    }
  },
}

export const runSelfEvolutionReviewTool: Tool = {
  name: 'run_self_evolution_review',
  description: 'Run the deterministic self-evolution review for one Agent run. This only creates reviewable candidates and an audit record; it does not auto-approve memories or modify skills.',
  category: 'system',
  parameters: [
    { name: 'runId', type: 'string', required: false, description: 'Agent run ID. Defaults to the most recent run.' },
    { name: 'limit', type: 'number', required: false, description: 'Recent run summaries to inspect, default 40' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'write'],
  execute: async (params) => {
    let runId = typeof params.runId === 'string' ? params.runId.trim() : ''
    if (!runId) {
      const { listAgentRunsFromDb } = await import('@/db/agent')
      const latest = await listAgentRunsFromDb(1)
      runId = latest[0]?.id || ''
    }
    if (!runId) {
      return {
        success: false,
        error: 'No Agent run is available for self-evolution review.',
      }
    }

    const { runPostSessionSelfEvolution } = await import('../self-evolution')
    const result = await runPostSessionSelfEvolution({
      runId,
      trigger: 'tool-manual',
      limit: Number(params.limit) || 40,
    })

    return {
      success: true,
      message: `${result.review.summary} Review: ${result.review.id}; candidates: ${result.candidateIds.join(', ') || 'none'}`,
      data: result,
    }
  },
}

export const agentMemoryTools: Tool[] = [
  listAgentRunSummariesTool,
  getAgentRunDetailTool,
  dreamMemoryCandidatesTool,
  distillWorkflowRecommendationsTool,
  generateMemoryReviewQueueTool,
  listMemoryReviewQueueTool,
  approveMemoryCandidateTool,
  rejectMemoryCandidateTool,
  listWorkflowTemplatesTool,
  listSelfEvolutionReviewsTool,
  runSelfEvolutionReviewTool,
]
