import type {
  AgentMemoryCandidateInput,
  AgentMemoryCandidateKind,
  AgentMemoryCandidateRecord,
  AgentMemoryCandidateStatus,
  AgentWorkflowTemplateInput,
} from '@/db/agent'
import type { DistillRecommendation, DreamCandidate } from './dream'
import type { AgentRunSummary } from './resume'
import { fetchEmbedding } from '@/lib/ai/embedding'

export interface GenerateAgentMemoryCandidatesResult {
  candidates: AgentMemoryCandidateRecord[]
  inspectedRunCount: number
  generatedCandidateCount: number
}

export interface ApproveAgentMemoryCandidateResult {
  candidate: AgentMemoryCandidateRecord
  targetType: 'memory' | 'agent_workflow_template'
  targetId: string
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function compactText(value: string, maxLength = 120) {
  const text = normalizeText(value)
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function unique(values: string[]) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
}

function parseJson<T>(value?: string | null, fallback: T = null as T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function dreamCandidateToQueueInput(candidate: DreamCandidate): AgentMemoryCandidateInput {
  return {
    kind: candidate.kind,
    content: candidate.content,
    evidence: candidate.evidence,
    sourceRunIds: candidate.sourceRunIds,
    confidence: candidate.confidence,
    payload: {
      source: 'dream',
      candidate,
    },
  }
}

function workflowSourceRunIds(recommendation: DistillRecommendation, summaries: AgentRunSummary[]) {
  const triggerSet = new Set(recommendation.triggerExamples.map(normalizeText))
  return unique(summaries
    .filter(summary => triggerSet.has(normalizeText(summary.userGoal)))
    .map(summary => summary.id))
}

function recommendationContent(recommendation: DistillRecommendation) {
  return [
    recommendation.title,
    recommendation.summary,
    recommendation.reusableSteps.length > 0
      ? `复用步骤：${recommendation.reusableSteps.join(' / ')}`
      : '',
    recommendation.requiredTools.length > 0
      ? `工具：${recommendation.requiredTools.join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
}

function distillRecommendationToQueueInput(
  recommendation: DistillRecommendation,
  summaries: AgentRunSummary[],
): AgentMemoryCandidateInput {
  const sourceRunIds = workflowSourceRunIds(recommendation, summaries)
  return {
    kind: 'workflow',
    content: recommendationContent(recommendation),
    evidence: unique([
      recommendation.summary,
      ...recommendation.triggerExamples.map(item => `触发：${item}`),
      ...recommendation.requiredTools.map(item => `工具：${item}`),
      ...recommendation.riskNotes,
    ]),
    sourceRunIds,
    confidence: sourceRunIds.length >= 3 ? 'high' : 'medium',
    payload: {
      source: 'distill',
      recommendation,
    },
  }
}

export async function generateAgentMemoryCandidates(
  limit = 30,
): Promise<GenerateAgentMemoryCandidatesResult> {
  const normalizedLimit = Math.min(80, Math.max(1, Math.floor(limit)))
  const [
    { listAgentRunSummaries },
    { loadWorkingMemory },
    { getAllMemories },
    { buildDreamCandidates, buildDistillRecommendations },
    { upsertAgentMemoryCandidatesInDb },
  ] = await Promise.all([
    import('./resume'),
    import('./working-memory'),
    import('@/db/memories'),
    import('./dream'),
    import('@/db/agent'),
  ])

  const [summaries, workingMemory, memories] = await Promise.all([
    listAgentRunSummaries(normalizedLimit),
    loadWorkingMemory(),
    getAllMemories(),
  ])

  const dreamCandidates = buildDreamCandidates({
    summaries,
    memories,
    workingMemory,
  }).map(dreamCandidateToQueueInput)

  const distillCandidates = buildDistillRecommendations({
    summaries,
  }).map(recommendation => distillRecommendationToQueueInput(recommendation, summaries))

  const candidates = await upsertAgentMemoryCandidatesInDb([
    ...dreamCandidates,
    ...distillCandidates,
  ])

  return {
    candidates,
    inspectedRunCount: summaries.length,
    generatedCandidateCount: dreamCandidates.length + distillCandidates.length,
  }
}

export async function listAgentMemoryCandidates(options: {
  status?: AgentMemoryCandidateStatus | 'all'
  limit?: number
} = {}) {
  const { listAgentMemoryCandidatesFromDb } = await import('@/db/agent')
  return listAgentMemoryCandidatesFromDb(options)
}

function buildMemoryContent(candidate: AgentMemoryCandidateRecord) {
  const evidence = parseJson<string[]>(candidate.evidenceJson, [])
  const sourceRunIds = parseJson<string[]>(candidate.sourceRunIdsJson, [])
  const labelByKind: Record<AgentMemoryCandidateKind, string> = {
    preference: '偏好',
    memory: '长期记忆',
    workflow: '工作流',
    failure: '失败经验',
  }

  const traceParts = [
    `kind=${candidate.kind}`,
    sourceRunIds.length > 0 ? `runs=${sourceRunIds.join('|')}` : '',
    `candidate=${candidate.id}`,
    `savedAt=${new Date().toISOString()}`,
  ].filter(Boolean)

  return [
    `[Agent ${labelByKind[candidate.kind]}沉淀] ${candidate.content}`,
    evidence.length > 0
      ? `证据：${evidence.slice(0, 6).map(item => compactText(item, 180)).join('；')}`
      : '',
    `[source-trace] ${traceParts.join(', ')}`,
  ].filter(Boolean).join('\n\n')
}

function workflowTemplateFromCandidate(candidate: AgentMemoryCandidateRecord): AgentWorkflowTemplateInput {
  const payload = parseJson<{
    source?: string
    recommendation?: DistillRecommendation
    candidate?: DreamCandidate
  }>(candidate.payloadJson, {})
  const recommendation = payload.recommendation
  const sourceRunIds = parseJson<string[]>(candidate.sourceRunIdsJson, [])
  const evidence = parseJson<string[]>(candidate.evidenceJson, [])

  if (recommendation) {
    return {
      title: recommendation.title || compactText(candidate.content, 60) || 'Agent 工作流模板',
      summary: recommendation.summary || candidate.content,
      triggerExamples: recommendation.triggerExamples,
      reusableSteps: recommendation.reusableSteps,
      requiredTools: recommendation.requiredTools,
      riskNotes: recommendation.riskNotes,
      sourceRunIds,
      candidateId: candidate.id,
    }
  }

  return {
    title: compactText(candidate.content, 60) || 'Agent 工作流模板',
    summary: candidate.content,
    triggerExamples: evidence.slice(0, 3),
    reusableSteps: [
      '读取相似 run summary 与来源证据',
      '复用已验证的工具顺序',
      '执行后把失败点写回沉淀队列',
    ],
    requiredTools: [],
    riskNotes: ['由单次或少量运行归纳，复用前需确认任务边界'],
    sourceRunIds,
    candidateId: candidate.id,
  }
}

async function clearMemoryContextCache() {
  try {
    const { contextLoader } = await import('@/lib/context/loader')
    contextLoader.clearCache()
  } catch (error) {
    console.error('[AgentMemoryCandidates] Failed to clear memory context cache:', error)
  }
}

export async function approveAgentMemoryCandidate(
  id: string,
): Promise<ApproveAgentMemoryCandidateResult> {
  const [
    { getAgentMemoryCandidateFromDb, insertAgentWorkflowTemplateInDb, reviewAgentMemoryCandidateInDb },
    { upsertMemory },
  ] = await Promise.all([
    import('@/db/agent'),
    import('@/db/memories'),
  ])
  const candidate = await getAgentMemoryCandidateFromDb(id)
  if (!candidate) {
    throw new Error(`记忆候选不存在：${id}`)
  }

  if (candidate.status === 'approved' && candidate.targetId && candidate.targetType) {
    return {
      candidate,
      targetType: candidate.targetType === 'agent_workflow_template' ? 'agent_workflow_template' : 'memory',
      targetId: candidate.targetId,
    }
  }

  if (candidate.kind === 'workflow') {
    const template = await insertAgentWorkflowTemplateInDb(workflowTemplateFromCandidate(candidate))
    const reviewed = await reviewAgentMemoryCandidateInDb(candidate.id, 'approved', {
      targetType: 'agent_workflow_template',
      targetId: template.id,
    })
    return {
      candidate: reviewed || candidate,
      targetType: 'agent_workflow_template',
      targetId: template.id,
    }
  }

  const content = buildMemoryContent(candidate)
  const embedding = await fetchEmbedding(candidate.content)
  if (!embedding) {
    throw new Error('无法生成候选记忆向量，请检查嵌入模型配置')
  }
  const result = await upsertMemory({
    content,
    embedding: JSON.stringify(embedding),
    category: candidate.kind === 'preference' ? 'preference' : 'memory',
  })
  await clearMemoryContextCache()

  const reviewed = await reviewAgentMemoryCandidateInDb(candidate.id, 'approved', {
    targetType: 'memory',
    targetId: result.id,
  })
  return {
    candidate: reviewed || candidate,
    targetType: 'memory',
    targetId: result.id,
  }
}

export async function rejectAgentMemoryCandidate(id: string, note?: string) {
  const { reviewAgentMemoryCandidateInDb } = await import('@/db/agent')
  const candidate = await reviewAgentMemoryCandidateInDb(id, 'rejected', {
    reviewNote: note || 'ignored from Agent center',
  })
  if (!candidate) {
    throw new Error(`记忆候选不存在：${id}`)
  }
  return candidate
}

export async function clearPendingAgentMemoryCandidates(note?: string) {
  const { archivePendingAgentMemoryCandidatesInDb } = await import('@/db/agent')
  return archivePendingAgentMemoryCandidatesInDb(note || 'cleared from AI sediment queue')
}

export async function archiveAgentMemoryCandidate(id: string, note?: string) {
  const { reviewAgentMemoryCandidateInDb } = await import('@/db/agent')
  const candidate = await reviewAgentMemoryCandidateInDb(id, 'archived', {
    reviewNote: note || 'archived from Agent center',
  })
  if (!candidate) {
    throw new Error(`记忆候选不存在：${id}`)
  }
  return candidate
}
