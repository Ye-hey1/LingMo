import type { AgentRunSummary } from './resume'
import type { AgentWorkingMemory } from './working-memory'
import type { AgentPartSnapshot } from './part-reducer'
import type { Memory } from '@/db/memories'

export interface DreamCandidate {
  kind: 'preference' | 'memory' | 'workflow' | 'failure'
  content: string
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
  sourceRunIds: string[]
}

export interface DistillRecommendation {
  title: string
  summary: string
  triggerExamples: string[]
  reusableSteps: string[]
  requiredTools: string[]
  riskNotes: string[]
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

export function buildDreamCandidates(input: {
  summaries: AgentRunSummary[]
  memories: Memory[]
  workingMemory: AgentWorkingMemory
  partSnapshots?: Array<{ runId: string; snapshot: AgentPartSnapshot }>
}): DreamCandidate[] {
  const candidates: DreamCandidate[] = []
  const summaries = input.summaries.slice(0, 30)

  for (const summary of summaries) {
    const evidence = unique([
      summary.userGoal,
      summary.result,
      ...summary.filesTouched.slice(0, 3),
      ...summary.failures.slice(0, 2).map(item => `${item.toolName}: ${item.error}`),
    ].map(normalizeText))

    if (summary.filesTouched.length > 0) {
      candidates.push({
        kind: 'workflow',
        content: normalizeText(summary.userGoal),
        evidence,
        confidence: summary.toolsUsed.length > 1 ? 'high' : 'medium',
        sourceRunIds: [summary.id],
      })
    }

    for (const failure of summary.failures.slice(0, 2)) {
      candidates.push({
        kind: 'failure',
        content: normalizeText(`${failure.toolName}: ${failure.error}`),
        evidence,
        confidence: 'medium',
        sourceRunIds: [summary.id],
      })
    }
  }

  for (const memory of input.memories.slice(0, 20)) {
    candidates.push({
      kind: memory.category === 'preference' ? 'preference' : 'memory',
      content: normalizeText(memory.content),
      evidence: [normalizeText(memory.content)],
      confidence: memory.accessCount > 2 ? 'high' : 'low',
      sourceRunIds: [],
    })
  }

  for (const [toolName, count] of Object.entries(input.workingMemory.toolUsageStats || {})) {
    if (count < 3) continue
    candidates.push({
      kind: 'workflow',
      content: `Repeated tool usage: ${toolName}`,
      evidence: [`Used ${count} times`, ...(input.workingMemory.failedAttempts || []).filter(item => item.tool === toolName).map(item => item.error)],
      confidence: count > 6 ? 'high' : 'medium',
      sourceRunIds: [],
    })
  }

  for (const item of candidates) {
    item.evidence = unique(item.evidence)
    item.sourceRunIds = unique(item.sourceRunIds)
  }

  return uniqueCandidates(candidates)
}

export function buildDistillRecommendations(input: {
  summaries: AgentRunSummary[]
}): DistillRecommendation[] {
  const grouped = new Map<string, AgentRunSummary[]>()

  for (const summary of input.summaries.slice(0, 60)) {
    const key = normalizeText(summary.userGoal).slice(0, 80).toLowerCase()
    grouped.set(key, [...(grouped.get(key) || []), summary])
  }

  return [...grouped.entries()]
    .filter(([, items]) => items.length >= 2)
    .slice(0, 8)
    .map(([key, items]) => {
      const first = items[0]
      const tools = unique(items.flatMap(item => item.toolsUsed.map(tool => tool.toolName))).slice(0, 5)
      return {
        title: first.userGoal.slice(0, 60),
        summary: `${items.length} 次相似任务：${first.result || '已有产出'}`,
        triggerExamples: items.slice(0, 3).map(item => item.userGoal),
        reusableSteps: [
          '先读取最近的 run summaries',
          '复用相同的技能与工具组合',
          '把最终结果写入统一产物',
        ],
        requiredTools: tools,
        riskNotes: [
          '先手动触发，再决定是否长期沉淀为技能',
          `匹配键：${key || 'unknown'}`,
        ],
      }
    })
}

function uniqueCandidates(candidates: DreamCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = `${candidate.kind}:${candidate.content}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
