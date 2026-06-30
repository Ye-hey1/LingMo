export type AgentLoopPhaseType = 'tool' | 'agent' | 'role' | 'review' | 'dream'

export type AgentLoopGateType = 'phase_success' | 'output_contains' | 'manual_review'

export interface AgentLoopPhaseSpec {
  id: string
  type: AgentLoopPhaseType
  name: string
  tool?: string
  role?: string
  prompt?: string
  args: Record<string, any>
  dependsOn: string[]
  continueOnError: boolean
  retries: number
  timeoutMs?: number
}

export interface AgentLoopGateSpec {
  after: string
  type: AgentLoopGateType
  expectedContains?: string
}

export interface AgentLoopExecutionLimits {
  maxTotalPhases?: number
  maxPhaseRetries?: number
  maxDurationMs?: number
}

export interface AgentLoopSpec {
  id: string
  name: string
  description: string
  version: string
  trigger: Record<string, any>
  phases: AgentLoopPhaseSpec[]
  gates: AgentLoopGateSpec[]
  artifacts: string[]
  executionLimits: AgentLoopExecutionLimits
}

export interface AgentLoopSpecValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  order: string[]
}

const PHASE_TYPES = new Set<AgentLoopPhaseType>(['tool', 'agent', 'role', 'review', 'dream'])
const GATE_TYPES = new Set<AgentLoopGateType>(['phase_success', 'output_contains', 'manual_review'])

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.map(item => text(item)).filter(Boolean)
}

function positiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function parsePhase(raw: unknown, index: number, previousId?: string): AgentLoopPhaseSpec {
  const source = isRecord(raw) ? raw : {}
  const id = text(source.id, `phase_${index + 1}`)
  const type = text(source.type, 'tool') as AgentLoopPhaseType
  const rawDependsOn = source.dependsOn ?? source.depends_on
  return {
    id,
    type,
    name: text(source.name, id),
    tool: text(source.tool) || undefined,
    role: text(source.role) || undefined,
    prompt: text(source.prompt ?? source.task) || undefined,
    args: isRecord(source.args) ? source.args : {},
    dependsOn: rawDependsOn === undefined ? (previousId ? [previousId] : []) : stringList(rawDependsOn),
    continueOnError: Boolean(source.continueOnError ?? source.continue_on_error),
    retries: nonNegativeInteger(source.retries),
    timeoutMs: positiveInteger(source.timeoutMs ?? source.timeout_ms),
  }
}

function parseGate(raw: unknown): AgentLoopGateSpec {
  const source = isRecord(raw) ? raw : {}
  return {
    after: text(source.after ?? source.phase),
    type: text(source.type, 'phase_success') as AgentLoopGateType,
    expectedContains: text(source.expectedContains ?? source.expected_contains) || undefined,
  }
}

function parseExecutionLimits(raw: unknown): AgentLoopExecutionLimits {
  const source = isRecord(raw) ? raw : {}
  return {
    maxTotalPhases: positiveInteger(source.maxTotalPhases ?? source.max_total_phases),
    maxPhaseRetries: positiveInteger(source.maxPhaseRetries ?? source.max_phase_retries),
    maxDurationMs: positiveInteger(source.maxDurationMs ?? source.max_duration_ms),
  }
}

export function parseAgentLoopSpec(raw: unknown): AgentLoopSpec {
  const source = isRecord(raw) ? raw : {}
  const id = text(source.id ?? source.name, 'loop')
  const rawPhases = Array.isArray(source.phases) ? source.phases : Array.isArray(source.nodes) ? source.nodes : []
  let previousId: string | undefined
  const phases = rawPhases.map((phase, index) => {
    const parsed = parsePhase(phase, index, previousId)
    previousId = parsed.id
    return parsed
  })

  return {
    id,
    name: text(source.name, id),
    description: text(source.description),
    version: text(source.version, '1'),
    trigger: isRecord(source.trigger) ? source.trigger : { type: 'manual' },
    phases,
    gates: Array.isArray(source.gates) ? source.gates.map(parseGate) : [],
    artifacts: stringList(source.artifacts),
    executionLimits: parseExecutionLimits(source.executionLimits ?? source.execution_limits),
  }
}

export function getAgentLoopExecutionOrder(spec: AgentLoopSpec): string[] {
  const phases = new Map(spec.phases.map(phase => [phase.id, phase]))
  const state = new Map<string, 'visiting' | 'done'>()
  const order: string[] = []

  function visit(phaseId: string, stack: string[]) {
    const status = state.get(phaseId)
    if (status === 'done') return
    if (status === 'visiting') {
      throw new Error(`loop dependency cycle: ${[...stack, phaseId].join(' -> ')}`)
    }

    const phase = phases.get(phaseId)
    if (!phase) {
      throw new Error(`missing loop phase: ${phaseId}`)
    }

    state.set(phaseId, 'visiting')
    for (const dependency of phase.dependsOn) {
      visit(dependency, [...stack, phaseId])
    }
    state.set(phaseId, 'done')
    order.push(phaseId)
  }

  for (const phase of spec.phases) {
    visit(phase.id, [])
  }
  return order
}

export function validateAgentLoopSpec(raw: AgentLoopSpec | unknown): AgentLoopSpecValidation {
  const spec = isRecord(raw) && Array.isArray(raw.phases) && typeof raw.id === 'string'
    ? raw as AgentLoopSpec
    : parseAgentLoopSpec(raw)
  const errors: string[] = []
  const warnings: string[] = []
  const seenPhaseIds = new Set<string>()
  const phaseIds = new Set(spec.phases.map(phase => phase.id))

  if (!spec.id.trim()) errors.push('loop id is required')
  if (spec.phases.length === 0) errors.push('loop must define at least one phase')

  if (spec.executionLimits.maxTotalPhases && spec.phases.length > spec.executionLimits.maxTotalPhases) {
    errors.push(`loop has ${spec.phases.length} phases but maxTotalPhases is ${spec.executionLimits.maxTotalPhases}`)
  }

  for (const phase of spec.phases) {
    if (!phase.id.trim()) errors.push('phase id is required')
    if (seenPhaseIds.has(phase.id)) errors.push(`duplicate loop phase id: ${phase.id}`)
    seenPhaseIds.add(phase.id)

    if (!PHASE_TYPES.has(phase.type)) errors.push(`phase ${phase.id} has unknown type ${phase.type}`)
    if (phase.type === 'tool' && !phase.tool) errors.push(`phase ${phase.id} is type=tool but missing tool`)
    if ((phase.type === 'agent' || phase.type === 'role' || phase.type === 'review') && !phase.prompt) {
      warnings.push(`phase ${phase.id} has no prompt`)
    }
    if (spec.executionLimits.maxPhaseRetries !== undefined && phase.retries > spec.executionLimits.maxPhaseRetries) {
      errors.push(`phase ${phase.id} retries ${phase.retries} exceeds maxPhaseRetries ${spec.executionLimits.maxPhaseRetries}`)
    }
    for (const dependency of phase.dependsOn) {
      if (!phaseIds.has(dependency)) errors.push(`phase ${phase.id} depends on missing phase ${dependency}`)
    }
  }

  for (const gate of spec.gates) {
    if (!gate.after) errors.push('gate.after is required')
    if (gate.after && !phaseIds.has(gate.after)) errors.push(`gate references missing phase ${gate.after}`)
    if (!GATE_TYPES.has(gate.type)) errors.push(`gate after ${gate.after || '(unknown)'} has unknown type ${gate.type}`)
    if (gate.type === 'output_contains' && !gate.expectedContains) {
      errors.push(`output_contains gate after ${gate.after || '(unknown)'} is missing expectedContains`)
    }
  }

  let order: string[] = []
  try {
    order = getAgentLoopExecutionOrder(spec)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    order,
  }
}

export function formatAgentLoopSpecForPrompt(spec: AgentLoopSpec): string {
  const validation = validateAgentLoopSpec(spec)
  return [
    'Agent LoopSpec Lite',
    `- id: ${spec.id}`,
    `- name: ${spec.name}`,
    spec.description ? `- description: ${spec.description}` : '',
    `- status: ${validation.ok ? 'valid' : 'invalid'}`,
    `- order: ${validation.order.join(' -> ') || '(none)'}`,
    ...spec.phases.map(phase => {
      const target = phase.tool || phase.role || phase.type
      const dependencies = phase.dependsOn.length ? ` after=${phase.dependsOn.join(',')}` : ''
      return `- phase ${phase.id}: ${phase.type}/${target}${dependencies}`
    }),
    ...spec.gates.map(gate => `- gate ${gate.type} after=${gate.after}`),
    ...validation.errors.map(error => `- error: ${error}`),
    ...validation.warnings.map(warning => `- warning: ${warning}`),
  ].filter(Boolean).join('\n')
}
