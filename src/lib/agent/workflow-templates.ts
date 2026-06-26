import type { AgentWorkflowTemplateRecord } from '@/db/agent'

export interface AgentWorkflowTemplateView {
  id: string
  title: string
  summary: string
  triggerExamples: string[]
  reusableSteps: string[]
  requiredTools: string[]
  riskNotes: string[]
  sourceRunIds: string[]
  candidateId?: string | null
  score?: number
  updatedAt: number
}

export interface AgentWorkflowTemplateMatchOptions {
  limit?: number
  minScore?: number
  poolLimit?: number
}

export interface AgentWorkflowTemplatePromptItem {
  id: string
  title: string
  summary: string
  reusableSteps: string[]
  requiredTools: string[]
  riskNotes: string[]
  score: number
}

function parseJsonArray(value?: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.map(item => String(item).trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(value: string) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]+/gu, ' ')

  return [...new Set(normalized.split(/\s+/).filter(token => token.length >= 2))]
}

function compactText(value: string, maxLength = 260) {
  const text = normalizeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function parseAgentWorkflowTemplateRecord(
  record: AgentWorkflowTemplateRecord,
): AgentWorkflowTemplateView {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    triggerExamples: parseJsonArray(record.triggerExamplesJson),
    reusableSteps: parseJsonArray(record.reusableStepsJson),
    requiredTools: parseJsonArray(record.requiredToolsJson),
    riskNotes: parseJsonArray(record.riskNotesJson),
    sourceRunIds: parseJsonArray(record.sourceRunIdsJson),
    candidateId: record.candidateId,
    updatedAt: record.updatedAt,
  }
}

export function scoreWorkflowTemplateForGoal(
  userGoal: string,
  template: AgentWorkflowTemplateView,
) {
  const goalTokens = tokenize(userGoal)
  if (goalTokens.length === 0) return 0

  const templateText = [
    template.title,
    template.summary,
    ...template.triggerExamples,
    ...template.reusableSteps,
    ...template.requiredTools,
  ].join(' ').toLowerCase()

  let score = 0
  for (const token of goalTokens) {
    if (templateText.includes(token)) {
      score += token.length >= 4 ? 2 : 1
    }
  }

  const normalizedGoal = normalizeText(userGoal).toLowerCase()
  for (const trigger of template.triggerExamples) {
    const normalizedTrigger = normalizeText(trigger).toLowerCase()
    if (!normalizedTrigger) continue
    if (normalizedGoal.includes(normalizedTrigger) || normalizedTrigger.includes(normalizedGoal)) {
      score += 6
      break
    }
  }

  if (template.requiredTools.length > 0) score += 0.5
  return score
}

export async function findRelevantWorkflowTemplates(
  userGoal: string,
  options: AgentWorkflowTemplateMatchOptions = {},
): Promise<AgentWorkflowTemplatePromptItem[]> {
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit || 3)))
  const minScore = options.minScore ?? 2
  const poolLimit = Math.min(100, Math.max(limit, Math.floor(options.poolLimit || 50)))
  const { listAgentWorkflowTemplatesFromDb } = await import('@/db/agent')
  const records = await listAgentWorkflowTemplatesFromDb(poolLimit)

  return records
    .map(record => {
      const view = parseAgentWorkflowTemplateRecord(record)
      return { ...view, score: scoreWorkflowTemplateForGoal(userGoal, view) }
    })
    .filter(template => (template.score || 0) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(template => ({
      id: template.id,
      title: template.title,
      summary: template.summary,
      reusableSteps: template.reusableSteps,
      requiredTools: template.requiredTools,
      riskNotes: template.riskNotes,
      score: template.score || 0,
    }))
}

export function formatWorkflowTemplatesForPrompt(
  templates: AgentWorkflowTemplatePromptItem[],
) {
  if (templates.length === 0) return ''

  return [
    '## Approved Workflow Templates',
    '',
    'These templates were reviewed from previous Agent runs. Use them as reusable guidance when they fit the current task; adapt to current user intent and current files.',
    '',
    ...templates.map((template, index) => [
      `${index + 1}. ${template.title} (score ${template.score.toFixed(1)})`,
      `   Summary: ${compactText(template.summary, 220)}`,
      template.reusableSteps.length > 0
        ? `   Steps: ${template.reusableSteps.slice(0, 5).map(step => compactText(step, 140)).join(' -> ')}`
        : '',
      template.requiredTools.length > 0
        ? `   Tools: ${template.requiredTools.slice(0, 8).join(', ')}`
        : '',
      template.riskNotes.length > 0
        ? `   Risks: ${template.riskNotes.slice(0, 3).map(note => compactText(note, 120)).join('; ')}`
        : '',
    ].filter(Boolean).join('\n')),
  ].join('\n')
}
