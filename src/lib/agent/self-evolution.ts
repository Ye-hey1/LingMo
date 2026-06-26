import type {
  AgentMemoryCandidateConfidence,
  AgentMemoryCandidateInput,
  AgentMemoryCandidateKind,
  AgentSelfEvolutionReviewRecord,
} from '@/db/agent'
import type { AgentRunMiddlewareState, AgentRunSnapshot } from '@/lib/agent-harness/types'
import type { DistillRecommendation } from './dream'
import type { AgentRunSummary } from './resume'

export type SelfEvolutionFindingKind =
  | 'preference'
  | 'memory'
  | 'workflow'
  | 'failure'
  | 'skill_followup'
  | 'skipped'

export interface SelfEvolutionFinding {
  kind: SelfEvolutionFindingKind
  title: string
  summary: string
  evidence: string[]
  confidence: AgentMemoryCandidateConfidence
  candidateKind?: AgentMemoryCandidateKind
}

export interface SelfEvolutionCandidatePlan {
  candidates: AgentMemoryCandidateInput[]
  findings: SelfEvolutionFinding[]
}

export interface RunSelfEvolutionInput {
  runId: string
  snapshot?: AgentRunSnapshot
  state?: AgentRunMiddlewareState
  trigger?: string
  limit?: number
}

export interface RunSelfEvolutionResult {
  review: AgentSelfEvolutionReviewRecord
  generatedCandidateCount: number
  candidateIds: string[]
}

const PREFERENCE_SIGNAL_RE = /以后|下次|默认|记住|偏好|我喜欢|我希望|不要再|always|prefer|remember|default/i

function normalizeText(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function compactText(value?: string | null, maxLength = 220) {
  const text = normalizeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function unique(values: string[]) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
}

function countTools(summary: AgentRunSummary) {
  return summary.toolsUsed.reduce((sum, tool) => sum + tool.count, 0)
}

function sourceRunIds(summary: AgentRunSummary) {
  return summary.id ? [summary.id] : []
}

function buildEvidence(summary: AgentRunSummary, extra: string[] = []) {
  return unique([
    `目标：${summary.userGoal}`,
    summary.result ? `结果：${compactText(summary.result, 360)}` : '',
    ...summary.toolsUsed.slice(0, 6).map(tool => `工具：${tool.toolName} success=${tool.success} error=${tool.error}`),
    ...summary.filesTouched.slice(0, 6).map(path => `文件：${path}`),
    ...summary.failures.slice(0, 4).map(failure => `失败：${failure.toolName} - ${failure.error}`),
    ...extra,
  ])
}

function createCandidate(input: {
  kind: AgentMemoryCandidateKind
  content: string
  evidence: string[]
  sourceRunIds: string[]
  confidence: AgentMemoryCandidateConfidence
  payload: Record<string, unknown>
}): AgentMemoryCandidateInput {
  return {
    kind: input.kind,
    content: normalizeText(input.content),
    evidence: unique(input.evidence),
    sourceRunIds: unique(input.sourceRunIds),
    confidence: input.confidence,
    payload: {
      source: 'self-evolution',
      ...input.payload,
    },
  }
}

function recommendationSourceRunIds(recommendation: DistillRecommendation, summaries: AgentRunSummary[]) {
  const triggers = new Set(recommendation.triggerExamples.map(normalizeText))
  return unique(summaries
    .filter(summary => triggers.has(normalizeText(summary.userGoal)))
    .map(summary => summary.id))
}

function candidateFromRecommendation(
  recommendation: DistillRecommendation,
  summaries: AgentRunSummary[],
): AgentMemoryCandidateInput {
  const sourceIds = recommendationSourceRunIds(recommendation, summaries)
  return createCandidate({
    kind: 'workflow',
    content: [
      recommendation.title,
      recommendation.summary,
      recommendation.reusableSteps.length > 0
        ? `复用步骤：${recommendation.reusableSteps.join(' / ')}`
        : '',
      recommendation.requiredTools.length > 0
        ? `工具：${recommendation.requiredTools.join(', ')}`
        : '',
    ].filter(Boolean).join('\n'),
    evidence: unique([
      recommendation.summary,
      ...recommendation.triggerExamples.map(item => `触发：${item}`),
      ...recommendation.requiredTools.map(item => `工具：${item}`),
      ...recommendation.riskNotes,
    ]),
    sourceRunIds: sourceIds,
    confidence: sourceIds.length >= 3 ? 'high' : 'medium',
    payload: {
      recommendation,
      sourceRunIds: sourceIds,
    },
  })
}

export function shouldRunSelfEvolutionReview(input: {
  summary?: AgentRunSummary
  snapshot?: AgentRunSnapshot
}) {
  const summary = input.summary
  const snapshot = input.snapshot
  if (!summary && !snapshot) return false
  if (snapshot?.status === 'running') return false

  if (summary) {
    return Boolean(
      summary.failures.length > 0 ||
      summary.stopped ||
      summary.filesTouched.length > 0 ||
      countTools(summary) >= 2 ||
      PREFERENCE_SIGNAL_RE.test(`${summary.userGoal}\n${summary.result}`),
    )
  }

  return Boolean(
    snapshot?.status === 'failed' ||
    snapshot?.status === 'paused' ||
    snapshot?.draftRefs.length ||
    snapshot?.observationRefs.length ||
    (snapshot?.metrics?.toolCalls || 0) >= 2,
  )
}

export function buildSelfEvolutionCandidatePlan(input: {
  currentSummary: AgentRunSummary
  recentSummaries: AgentRunSummary[]
  state?: AgentRunMiddlewareState
  recommendations?: DistillRecommendation[]
}): SelfEvolutionCandidatePlan {
  const { currentSummary } = input
  const candidates: AgentMemoryCandidateInput[] = []
  const findings: SelfEvolutionFinding[] = []
  const evidence = buildEvidence(currentSummary)
  const selectedSkillIds = input.state?.skills?.selectedSkillIds || []
  const runIds = sourceRunIds(currentSummary)

  if (PREFERENCE_SIGNAL_RE.test(`${currentSummary.userGoal}\n${currentSummary.result}`)) {
    candidates.push(createCandidate({
      kind: 'preference',
      content: `[Agent 偏好候选] ${compactText(`${currentSummary.userGoal}\n${currentSummary.result}`, 420)}`,
      evidence,
      sourceRunIds: runIds,
      confidence: 'medium',
      payload: { reason: 'preference-signal' },
    }))
    findings.push({
      kind: 'preference',
      title: '检测到可能的用户偏好',
      summary: '本次目标或结果包含“默认/以后/记住/偏好”等长期行为信号。',
      evidence,
      confidence: 'medium',
      candidateKind: 'preference',
    })
  }

  if (currentSummary.failures.length > 0 || currentSummary.stopped) {
    const failureSummary = currentSummary.failures
      .map(failure => `${failure.toolName}: ${failure.error}`)
      .slice(0, 4)
      .join('；') || '运行被中断或未完成'
    candidates.push(createCandidate({
      kind: 'failure',
      content: `[Agent 失败经验] ${compactText(currentSummary.userGoal, 180)}\n${failureSummary}`,
      evidence,
      sourceRunIds: runIds,
      confidence: currentSummary.failures.length >= 2 ? 'high' : 'medium',
      payload: { reason: 'run-failure' },
    }))
    findings.push({
      kind: 'failure',
      title: '沉淀失败经验',
      summary: failureSummary,
      evidence,
      confidence: currentSummary.failures.length >= 2 ? 'high' : 'medium',
      candidateKind: 'failure',
    })
  }

  if (
    !currentSummary.stopped &&
    currentSummary.failures.length === 0 &&
    (currentSummary.filesTouched.length > 0 || countTools(currentSummary) >= 2) &&
    normalizeText(currentSummary.result).length > 20
  ) {
    candidates.push(createCandidate({
      kind: 'workflow',
      content: [
        `[Agent 可复用工作流] ${compactText(currentSummary.userGoal, 160)}`,
        `结果摘要：${compactText(currentSummary.result, 300)}`,
        currentSummary.toolsUsed.length > 0
          ? `工具链：${currentSummary.toolsUsed.map(tool => tool.toolName).slice(0, 8).join(' -> ')}`
          : '',
      ].filter(Boolean).join('\n'),
      evidence,
      sourceRunIds: runIds,
      confidence: countTools(currentSummary) >= 3 ? 'high' : 'medium',
      payload: { reason: 'successful-repeatable-run' },
    }))
    findings.push({
      kind: 'workflow',
      title: '发现可复用工作流',
      summary: '本次运行包含可复用的工具链、产物或文件触达。',
      evidence,
      confidence: countTools(currentSummary) >= 3 ? 'high' : 'medium',
      candidateKind: 'workflow',
    })
  }

  if (selectedSkillIds.length > 0 && currentSummary.failures.length > 0) {
    candidates.push(createCandidate({
      kind: 'workflow',
      content: [
        `[Skill 改进候选] ${selectedSkillIds.join(', ')}`,
        `触发任务：${compactText(currentSummary.userGoal, 220)}`,
        `失败摘要：${currentSummary.failures.map(failure => `${failure.toolName}: ${failure.error}`).slice(0, 4).join('；')}`,
      ].join('\n'),
      evidence: buildEvidence(currentSummary, selectedSkillIds.map(skillId => `涉及 Skill：${skillId}`)),
      sourceRunIds: runIds,
      confidence: 'medium',
      payload: {
        reason: 'selected-skill-failure',
        selectedSkillIds,
      },
    }))
    findings.push({
      kind: 'skill_followup',
      title: '需要复查已选 Skill',
      summary: `本次运行使用了 ${selectedSkillIds.join(', ')} 且出现失败，建议人工审查 Skill 指令或工具权限。`,
      evidence,
      confidence: 'medium',
      candidateKind: 'workflow',
    })
  }

  for (const recommendation of input.recommendations || []) {
    const candidate = candidateFromRecommendation(recommendation, input.recentSummaries)
    candidates.push(candidate)
    findings.push({
      kind: 'workflow',
      title: `重复工作流：${recommendation.title}`,
      summary: recommendation.summary,
      evidence: candidate.evidence,
      confidence: candidate.confidence,
      candidateKind: 'workflow',
    })
  }

  return {
    candidates,
    findings,
  }
}

function fallbackSummaryFromSnapshot(snapshot: AgentRunSnapshot): AgentRunSummary {
  const metrics = snapshot.metrics
  return {
    id: snapshot.runId,
    userGoal: snapshot.userGoal,
    result: snapshot.finalAnswer || '',
    stopped: snapshot.status === 'paused',
    startedAt: metrics?.startedAt,
    completedAt: snapshot.updatedAt,
    iterations: 0,
    toolsUsed: metrics?.toolCalls
      ? [{ toolName: 'harness_tool', count: metrics.toolCalls, success: metrics.successfulToolCalls, error: metrics.failedToolCalls }]
      : [],
    filesTouched: snapshot.draftRefs.map(ref => ref.path),
    failures: snapshot.status === 'failed' && snapshot.finalAnswer
      ? [{ toolName: 'agent_run', error: snapshot.finalAnswer }]
      : [],
  }
}

function reviewSummary(findings: SelfEvolutionFinding[], generatedCandidateCount: number) {
  if (generatedCandidateCount === 0) {
    return findings.length > 0
      ? `完成复盘，发现 ${findings.length} 条信号，但未生成新候选。`
      : '完成复盘，未发现需要沉淀的稳定信号。'
  }
  return `完成复盘，生成 ${generatedCandidateCount} 条待审核候选。`
}

export async function runPostSessionSelfEvolution(
  input: RunSelfEvolutionInput,
): Promise<RunSelfEvolutionResult> {
  const trigger = input.trigger || 'after-run'
  const [
    { listAgentRunSummaries },
    { buildDistillRecommendations },
    { upsertAgentMemoryCandidatesInDb, upsertAgentSelfEvolutionReviewInDb },
  ] = await Promise.all([
    import('./resume'),
    import('./dream'),
    import('@/db/agent'),
  ])

  try {
    const limit = Math.min(80, Math.max(5, Math.floor(input.limit || 40)))
    const recentSummaries = await listAgentRunSummaries(limit)
    const currentSummary = recentSummaries.find(summary => summary.id === input.runId)
      || (input.snapshot ? fallbackSummaryFromSnapshot(input.snapshot) : undefined)

    if (!currentSummary || !shouldRunSelfEvolutionReview({ summary: currentSummary, snapshot: input.snapshot })) {
      const review = await upsertAgentSelfEvolutionReviewInDb({
        runId: input.runId,
        status: 'skipped',
        trigger,
        summary: '运行证据不足，跳过自我进化复盘。',
        changedCount: 0,
        candidateIds: [],
        findings: [{
          kind: 'skipped',
          title: '跳过复盘',
          summary: '没有失败、文件触达、重复工具链或明确偏好信号。',
          evidence: [],
          confidence: 'low',
        }],
      })
      return { review, generatedCandidateCount: 0, candidateIds: [] }
    }

    const summaries = [
      currentSummary,
      ...recentSummaries.filter(summary => summary.id !== currentSummary.id),
    ]
    const recommendations = buildDistillRecommendations({ summaries }).slice(0, 3)
    const plan = buildSelfEvolutionCandidatePlan({
      currentSummary,
      recentSummaries: summaries,
      state: input.state,
      recommendations,
    })

    const records = plan.candidates.length > 0
      ? await upsertAgentMemoryCandidatesInDb(plan.candidates)
      : []
    const candidateIds = records.map(record => record.id)
    const review = await upsertAgentSelfEvolutionReviewInDb({
      runId: input.runId,
      status: candidateIds.length > 0 ? 'changed' : 'reviewed',
      trigger,
      summary: reviewSummary(plan.findings, candidateIds.length),
      changedCount: candidateIds.length,
      candidateIds,
      findings: plan.findings,
    })

    return {
      review,
      generatedCandidateCount: plan.candidates.length,
      candidateIds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const review = await upsertAgentSelfEvolutionReviewInDb({
      runId: input.runId,
      status: 'failed',
      trigger,
      summary: `自我进化复盘失败：${message}`,
      changedCount: 0,
      candidateIds: [],
      findings: [{
        kind: 'skipped',
        title: '复盘失败',
        summary: message,
        evidence: [],
        confidence: 'low',
      }],
    })
    return { review, generatedCandidateCount: 0, candidateIds: [] }
  }
}
