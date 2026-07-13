import { getDb, serializedWrite } from './index'
import type { AgentEvent } from '@/lib/agent/types'
import type { AgentRunSnapshot, VfsRef } from '@/lib/agent-harness/types'
import { stableStringify } from '@/lib/stable-stringify'

type JsonLike = unknown

export interface AgentRunPersistenceInput {
  conversationId?: number | null
  model?: string | null
}

export interface AgentRunRecord {
  id: string
  conversationId?: number | null
  userGoal: string
  route: string
  status: string
  model?: string | null
  startedAt: number
  endedAt?: number | null
  finalAnswer?: string | null
  error?: string | null
  runtimeSnapshotJson?: string | null
  metricsJson?: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentEventRecord {
  id: string
  runId: string
  seq?: number | null
  schemaVersion?: string | null
  spanId?: string | null
  parentId?: string | null
  type: string
  level?: string | null
  iteration?: number | null
  payloadJson?: string | null
  envelopeJson?: string | null
  createdAt: number
}

export interface AgentToolCallRecord {
  id: string
  runId: string
  stepId?: string | null
  iteration?: number | null
  toolName: string
  status: string
  success?: number | null
  durationMs?: number | null
  error?: string | null
  message?: string | null
  dataRef?: string | null
  paramsJson?: string | null
  resultJson?: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentStepRecord {
  id: string
  runId: string
  stepIndex: number
  title?: string | null
  status: string
  thought?: string | null
  actionJson?: string | null
  observationSummary?: string | null
  plannedToolsJson?: string | null
  startedAt?: number | null
  endedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface AgentApprovalRecord {
  id: string
  runId: string
  stepId?: string | null
  toolName: string
  risk?: string | null
  status: string
  reason?: string | null
  paramsJson?: string | null
  contextJson?: string | null
  approvalScope?: string | null
  decidedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface AgentArtifactRecord {
  id: string
  runId: string
  kind: string
  uri: string
  path: string
  summary?: string | null
  size?: number | null
  createdAt: number
}

export type AgentMemoryCandidateKind = 'preference' | 'memory' | 'workflow' | 'failure'
export type AgentMemoryCandidateStatus = 'pending' | 'approved' | 'rejected' | 'archived'
export type AgentMemoryCandidateConfidence = 'high' | 'medium' | 'low'

export interface AgentMemoryCandidateInput {
  id?: string
  kind: AgentMemoryCandidateKind
  content: string
  evidence: string[]
  sourceRunIds: string[]
  confidence: AgentMemoryCandidateConfidence
  status?: AgentMemoryCandidateStatus
  payload?: JsonLike
  dedupeKey?: string
}

export interface AgentMemoryCandidateRecord {
  id: string
  kind: AgentMemoryCandidateKind
  content: string
  evidenceJson: string
  sourceRunIdsJson: string
  confidence: AgentMemoryCandidateConfidence
  status: AgentMemoryCandidateStatus
  payloadJson?: string | null
  dedupeKey: string
  targetType?: string | null
  targetId?: string | null
  reviewNote?: string | null
  createdAt: number
  updatedAt: number
  reviewedAt?: number | null
}

export interface AgentWorkflowTemplateInput {
  id?: string
  title: string
  summary: string
  triggerExamples: string[]
  reusableSteps: string[]
  requiredTools: string[]
  riskNotes: string[]
  sourceRunIds: string[]
  candidateId?: string | null
}

export interface AgentWorkflowTemplateRecord {
  id: string
  title: string
  summary: string
  triggerExamplesJson: string
  reusableStepsJson: string
  requiredToolsJson: string
  riskNotesJson: string
  sourceRunIdsJson: string
  candidateId?: string | null
  createdAt: number
  updatedAt: number
}

export type AgentSelfEvolutionReviewStatus = 'skipped' | 'reviewed' | 'changed' | 'failed'

export interface AgentSelfEvolutionReviewInput {
  id?: string
  runId: string
  status: AgentSelfEvolutionReviewStatus
  trigger: string
  summary: string
  changedCount: number
  candidateIds: string[]
  findings: JsonLike
}

export interface AgentSelfEvolutionReviewRecord {
  id: string
  runId: string
  status: AgentSelfEvolutionReviewStatus
  trigger: string
  summary: string
  changedCount: number
  candidateIdsJson: string
  findingsJson: string
  createdAt: number
  updatedAt: number
}

export interface AgentRunDetail {
  run: AgentRunRecord
  steps: AgentStepRecord[]
  events: AgentEventRecord[]
  toolCalls: AgentToolCallRecord[]
  approvals: AgentApprovalRecord[]
  artifacts: AgentArtifactRecord[]
}

function now() {
  return Date.now()
}

function safeJson(value: JsonLike): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}


function shortHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function generateDbId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeCandidateContent(content: string) {
  return content.replace(/\s+/g, ' ').trim()
}

export function createAgentMemoryCandidateDedupeKey(kind: AgentMemoryCandidateKind, content: string) {
  return `${kind}:${shortHash(normalizeCandidateContent(content).toLowerCase())}`
}

function eventPrimaryId(runId: string, event: AgentEvent) {
  if (event.id) return event.id
  const seq = event.sequence ?? event.timestamp
  return `${runId}:${seq}:${event.type}:${event.iteration ?? 0}`
}

function eventSeq(event: AgentEvent) {
  return typeof event.sequence === 'number' ? event.sequence : null
}

function stepIdFor(runId: string, iteration?: number) {
  return `${runId}:${iteration ?? 0}`
}

function inferRunEndedAt(snapshot: AgentRunSnapshot) {
  return snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'paused'
    ? snapshot.updatedAt
    : null
}

function extractToolCallId(runId: string, event: AgentEvent) {
  const payload = event.payload || {}
  const explicit = payload.toolCallId || payload.toolCall?.id
  if (typeof explicit === 'string' && explicit.trim()) return explicit
  return `${runId}:${event.sequence ?? event.timestamp}:${event.type}`
}

function extractApprovalId(runId: string, event: AgentEvent) {
  const payload = event.payload || {}
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'tool'
  const paramsKey = stableStringify(payload.params || {})
  return `${runId}:approval:${toolName}:${shortHash(paramsKey)}`
}

function normalizeApprovalStatus(status: unknown, eventType: AgentEvent['type']) {
  if (status === 'confirmed') return 'approved'
  if (status === 'cancelled') return 'rejected'
  if (status === 'rejected') return 'rejected'
  if (status === 'approved') return 'approved'
  if (eventType === 'confirmation.resolved') return 'resolved'
  return 'requested'
}

function refId(ref: VfsRef) {
  return `${ref.runId}:${ref.uri}`
}

async function ensureColumn(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await db.select<Array<{ name: string }>>(`pragma table_info(${table})`)
  if (columns.some(item => item.name === column)) return
  await db.execute(`alter table ${table} add column ${column} ${definition}`)
}

export async function initAgentDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists agent_runs (
      id text primary key,
      conversation_id integer default null,
      user_goal text not null,
      route text not null,
      status text not null,
      model text default null,
      started_at integer not null,
      ended_at integer default null,
      final_answer text default null,
      error text default null,
      runtime_snapshot_json text default null,
      metrics_json text default null,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists agent_steps (
      id text primary key,
      run_id text not null,
      step_index integer not null,
      title text default null,
      status text not null,
      thought text default null,
      action_json text default null,
      observation_summary text default null,
      planned_tools_json text default null,
      started_at integer default null,
      ended_at integer default null,
      created_at integer not null,
      updated_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await db.execute(`
    create table if not exists agent_events (
      id text primary key,
      run_id text not null,
      seq integer default null,
      schema_version text default null,
      span_id text default null,
      parent_id text default null,
      type text not null,
      level text default null,
      iteration integer default null,
      payload_json text default null,
      envelope_json text default null,
      created_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await ensureColumn(db, 'agent_events', 'schema_version', 'text default null')
  await ensureColumn(db, 'agent_events', 'span_id', 'text default null')
  await ensureColumn(db, 'agent_events', 'parent_id', 'text default null')
  await ensureColumn(db, 'agent_events', 'envelope_json', 'text default null')

  await db.execute(`
    create table if not exists agent_tool_calls (
      id text primary key,
      run_id text not null,
      step_id text default null,
      iteration integer default null,
      tool_name text not null,
      category text default null,
      risk text default null,
      params_json text default null,
      result_json text default null,
      status text not null,
      success integer default null,
      duration_ms integer default null,
      error text default null,
      message text default null,
      data_ref text default null,
      retryable integer default null,
      created_at integer not null,
      updated_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await db.execute(`
    create table if not exists agent_approvals (
      id text primary key,
      run_id text not null,
      step_id text default null,
      tool_name text not null,
      risk text default null,
      status text not null,
      reason text default null,
      params_json text default null,
      context_json text default null,
      approval_scope text default null,
      decided_at integer default null,
      created_at integer not null,
      updated_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await db.execute(`
    create table if not exists agent_artifacts (
      id text primary key,
      run_id text not null,
      kind text not null,
      uri text not null,
      path text not null,
      summary text default null,
      size integer default null,
      created_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await db.execute(`
    create table if not exists agent_memory_candidates (
      id text primary key,
      kind text not null,
      content text not null,
      evidence_json text not null,
      source_run_ids_json text not null,
      confidence text not null,
      status text not null default 'pending',
      payload_json text default null,
      dedupe_key text not null unique,
      target_type text default null,
      target_id text default null,
      review_note text default null,
      created_at integer not null,
      updated_at integer not null,
      reviewed_at integer default null
    )
  `)

  await db.execute(`
    create table if not exists agent_workflow_templates (
      id text primary key,
      title text not null,
      summary text not null,
      trigger_examples_json text not null,
      reusable_steps_json text not null,
      required_tools_json text not null,
      risk_notes_json text not null,
      source_run_ids_json text not null,
      candidate_id text default null unique,
      created_at integer not null,
      updated_at integer not null,
      foreign key(candidate_id) references agent_memory_candidates(id) on delete set null
    )
  `)

  await db.execute(`
    create table if not exists agent_self_evolution_reviews (
      id text primary key,
      run_id text not null unique,
      status text not null,
      trigger text not null,
      summary text not null,
      changed_count integer not null default 0,
      candidate_ids_json text not null,
      findings_json text not null,
      created_at integer not null,
      updated_at integer not null,
      foreign key(run_id) references agent_runs(id) on delete cascade
    )
  `)

  await db.execute(`create index if not exists idx_agent_runs_status on agent_runs(status)`)
  await db.execute(`create index if not exists idx_agent_runs_started on agent_runs(started_at desc)`)
  await db.execute(`create index if not exists idx_agent_steps_run on agent_steps(run_id, step_index)`)
  await db.execute(`create index if not exists idx_agent_events_run_seq on agent_events(run_id, seq)`)
  await db.execute(`create index if not exists idx_agent_events_type on agent_events(type)`)
  await db.execute(`create index if not exists idx_agent_tool_calls_run on agent_tool_calls(run_id, updated_at desc)`)
  await db.execute(`create index if not exists idx_agent_tool_calls_name on agent_tool_calls(tool_name)`)
  await db.execute(`create index if not exists idx_agent_tool_calls_status on agent_tool_calls(status)`)
  await db.execute(`create index if not exists idx_agent_approvals_run_status on agent_approvals(run_id, status)`)
  await db.execute(`create index if not exists idx_agent_artifacts_run_kind on agent_artifacts(run_id, kind)`)
  await db.execute(`create index if not exists idx_agent_memory_candidates_status on agent_memory_candidates(status, updated_at desc)`)
  await db.execute(`create index if not exists idx_agent_memory_candidates_kind on agent_memory_candidates(kind, status)`)
  await db.execute(`create index if not exists idx_agent_memory_candidates_target on agent_memory_candidates(target_type, target_id)`)
  await db.execute(`create index if not exists idx_agent_workflow_templates_updated on agent_workflow_templates(updated_at desc)`)
  await db.execute(`create index if not exists idx_agent_self_evolution_reviews_updated on agent_self_evolution_reviews(updated_at desc)`)
  await db.execute(`create index if not exists idx_agent_self_evolution_reviews_status on agent_self_evolution_reviews(status, updated_at desc)`)
}

export async function upsertAgentRunFromSnapshot(
  snapshot: AgentRunSnapshot,
  input: AgentRunPersistenceInput = {},
) {
  await serializedWrite(async () => {
    const db = await getDb()
    const createdAt = snapshot.metrics?.startedAt || snapshot.updatedAt || now()
    await db.execute(
      `insert into agent_runs (
        id, conversation_id, user_goal, route, status, model, started_at, ended_at,
        final_answer, error, runtime_snapshot_json, metrics_json, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      on conflict(id) do update set
        conversation_id = coalesce(excluded.conversation_id, agent_runs.conversation_id),
        user_goal = excluded.user_goal,
        route = excluded.route,
        status = excluded.status,
        model = coalesce(excluded.model, agent_runs.model),
        started_at = min(agent_runs.started_at, excluded.started_at),
        ended_at = excluded.ended_at,
        final_answer = excluded.final_answer,
        error = excluded.error,
        runtime_snapshot_json = excluded.runtime_snapshot_json,
        metrics_json = excluded.metrics_json,
        updated_at = excluded.updated_at`,
      [
        snapshot.runId,
        input.conversationId ?? null,
        snapshot.userGoal,
        snapshot.route,
        snapshot.status,
        input.model ?? null,
        createdAt,
        inferRunEndedAt(snapshot),
        snapshot.finalAnswer ?? null,
        snapshot.status === 'failed' ? snapshot.finalAnswer ?? null : null,
        safeJson(snapshot),
        safeJson(snapshot.metrics),
        createdAt,
        snapshot.updatedAt || now(),
      ],
    )

    await syncAgentArtifactsWithDb(db, snapshot)
  })
}

export async function insertAgentEvent(runId: string, event: AgentEvent) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert or ignore into agent_events (
        id, run_id, seq, schema_version, span_id, parent_id, type, level, iteration, payload_json, envelope_json, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        eventPrimaryId(runId, event),
        runId,
        eventSeq(event),
        event.schemaVersion ?? null,
        event.spanId ?? null,
        event.parentId ?? null,
        event.type,
        event.level ?? null,
        event.iteration ?? null,
        safeJson(event.payload),
        event.envelope ? safeJson(event.envelope) : null,
        event.timestamp || now(),
      ],
    )
  })
}

export async function persistAgentRuntimeEvent(runId: string, event: AgentEvent) {
  await insertAgentEvent(runId, event)
  await projectAgentStepEvent(runId, event)
  await projectAgentToolEvent(runId, event)
  await projectAgentApprovalEvent(runId, event)
}

export async function listAgentRunsFromDb(limit = 30): Promise<AgentRunRecord[]> {
  const db = await getDb()
  return db.select<AgentRunRecord[]>(
    `select
      id,
      conversation_id as conversationId,
      user_goal as userGoal,
      route,
      status,
      model,
      started_at as startedAt,
      ended_at as endedAt,
      final_answer as finalAnswer,
      error,
      runtime_snapshot_json as runtimeSnapshotJson,
      metrics_json as metricsJson,
      created_at as createdAt,
      updated_at as updatedAt
    from agent_runs
    order by started_at desc
    limit $1`,
    [Math.min(100, Math.max(1, Math.floor(limit)))],
  )
}

export async function getAgentRunFromDb(runId: string): Promise<AgentRunRecord | null> {
  const db = await getDb()
  const rows = await db.select<AgentRunRecord[]>(
    `select
      id,
      conversation_id as conversationId,
      user_goal as userGoal,
      route,
      status,
      model,
      started_at as startedAt,
      ended_at as endedAt,
      final_answer as finalAnswer,
      error,
      runtime_snapshot_json as runtimeSnapshotJson,
      metrics_json as metricsJson,
      created_at as createdAt,
      updated_at as updatedAt
    from agent_runs
    where id = $1
    limit 1`,
    [runId],
  )
  return rows[0] || null
}

export async function listAgentEventsFromDb(runId: string, limit = 500): Promise<AgentEventRecord[]> {
  const db = await getDb()
  return db.select<AgentEventRecord[]>(
    `select
      id,
      run_id as runId,
      seq,
      schema_version as schemaVersion,
      span_id as spanId,
      parent_id as parentId,
      type,
      level,
      iteration,
      payload_json as payloadJson,
      envelope_json as envelopeJson,
      created_at as createdAt
    from agent_events
    where run_id = $1
    order by coalesce(seq, created_at), created_at
    limit $2`,
    [runId, Math.min(1000, Math.max(1, Math.floor(limit)))],
  )
}

export async function listAgentStepsFromDb(runId: string): Promise<AgentStepRecord[]> {
  const db = await getDb()
  return db.select<AgentStepRecord[]>(
    `select
      id,
      run_id as runId,
      step_index as stepIndex,
      title,
      status,
      thought,
      action_json as actionJson,
      observation_summary as observationSummary,
      planned_tools_json as plannedToolsJson,
      started_at as startedAt,
      ended_at as endedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from agent_steps
    where run_id = $1
    order by step_index`,
    [runId],
  )
}

export async function listAgentToolCallsFromDb(runId: string): Promise<AgentToolCallRecord[]> {
  const db = await getDb()
  return db.select<AgentToolCallRecord[]>(
    `select
      id,
      run_id as runId,
      step_id as stepId,
      iteration,
      tool_name as toolName,
      status,
      success,
      duration_ms as durationMs,
      error,
      message,
      data_ref as dataRef,
      params_json as paramsJson,
      result_json as resultJson,
      created_at as createdAt,
      updated_at as updatedAt
    from agent_tool_calls
    where run_id = $1
    order by created_at, updated_at`,
    [runId],
  )
}

export interface AgentFailedToolCallRow extends AgentToolCallRecord {
  userGoal: string
  runStatus: string
  runStartedAt: number
}

/**
 * 跨 run 聚合查询：最近失败的 / 被阻塞的工具调用，带所属 run 上下文。
 * 供「失败聚合」面板按工具维度统计高频失败点。
 */
export async function listRecentFailedToolCalls(limit = 200): Promise<AgentFailedToolCallRow[]> {
  const db = await getDb()
  return db.select<AgentFailedToolCallRow[]>(
    `select
      tc.id,
      tc.run_id as runId,
      tc.step_id as stepId,
      tc.iteration,
      tc.tool_name as toolName,
      tc.status,
      tc.success,
      tc.duration_ms as durationMs,
      tc.error,
      tc.message,
      tc.data_ref as dataRef,
      tc.params_json as paramsJson,
      tc.result_json as resultJson,
      tc.created_at as createdAt,
      tc.updated_at as updatedAt,
      r.user_goal as userGoal,
      r.status as runStatus,
      r.started_at as runStartedAt
    from agent_tool_calls tc
    join agent_runs r on r.id = tc.run_id
    where tc.status in ('error', 'blocked')
    order by tc.created_at desc
    limit $1`,
    [Math.min(500, Math.max(1, Math.floor(limit)))],
  )
}

export async function listAgentApprovalsFromDb(runId: string): Promise<AgentApprovalRecord[]> {
  const db = await getDb()
  return db.select<AgentApprovalRecord[]>(
    `select
      id,
      run_id as runId,
      step_id as stepId,
      tool_name as toolName,
      risk,
      status,
      reason,
      params_json as paramsJson,
      context_json as contextJson,
      approval_scope as approvalScope,
      decided_at as decidedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from agent_approvals
    where run_id = $1
    order by created_at`,
    [runId],
  )
}

export async function listAgentArtifactsFromDb(runId: string): Promise<AgentArtifactRecord[]> {
  const db = await getDb()
  return db.select<AgentArtifactRecord[]>(
    `select
      id,
      run_id as runId,
      kind,
      uri,
      path,
      summary,
      size,
      created_at as createdAt
    from agent_artifacts
    where run_id = $1
    order by created_at`,
    [runId],
  )
}

export async function getAgentRunDetailFromDb(runId: string): Promise<AgentRunDetail | null> {
  const run = await getAgentRunFromDb(runId)
  if (!run) return null

  const [steps, events, toolCalls, approvals, artifacts] = await Promise.all([
    listAgentStepsFromDb(runId),
    listAgentEventsFromDb(runId),
    listAgentToolCallsFromDb(runId),
    listAgentApprovalsFromDb(runId),
    listAgentArtifactsFromDb(runId),
  ])

  return {
    run,
    steps,
    events,
    toolCalls,
    approvals,
    artifacts,
  }
}

function selectAgentMemoryCandidateSql(whereSql = '') {
  return `select
    id,
    kind,
    content,
    evidence_json as evidenceJson,
    source_run_ids_json as sourceRunIdsJson,
    confidence,
    status,
    payload_json as payloadJson,
    dedupe_key as dedupeKey,
    target_type as targetType,
    target_id as targetId,
    review_note as reviewNote,
    created_at as createdAt,
    updated_at as updatedAt,
    reviewed_at as reviewedAt
  from agent_memory_candidates
  ${whereSql}`
}

function selectAgentWorkflowTemplateSql(whereSql = '') {
  return `select
    id,
    title,
    summary,
    trigger_examples_json as triggerExamplesJson,
    reusable_steps_json as reusableStepsJson,
    required_tools_json as requiredToolsJson,
    risk_notes_json as riskNotesJson,
    source_run_ids_json as sourceRunIdsJson,
    candidate_id as candidateId,
    created_at as createdAt,
    updated_at as updatedAt
  from agent_workflow_templates
  ${whereSql}`
}

function selectAgentSelfEvolutionReviewSql(whereSql = '') {
  return `select
    id,
    run_id as runId,
    status,
    trigger,
    summary,
    changed_count as changedCount,
    candidate_ids_json as candidateIdsJson,
    findings_json as findingsJson,
    created_at as createdAt,
    updated_at as updatedAt
  from agent_self_evolution_reviews
  ${whereSql}`
}

async function listAgentMemoryCandidatesByDedupeKeys(dedupeKeys: string[]) {
  if (dedupeKeys.length === 0) return []

  const db = await getDb()
  const placeholders = dedupeKeys.map((_, index) => `$${index + 1}`).join(', ')
  return db.select<AgentMemoryCandidateRecord[]>(
    `${selectAgentMemoryCandidateSql(`where dedupe_key in (${placeholders})`)}
    order by updated_at desc`,
    dedupeKeys,
  )
}

export async function upsertAgentMemoryCandidatesInDb(
  candidates: AgentMemoryCandidateInput[],
): Promise<AgentMemoryCandidateRecord[]> {
  const normalizedCandidates = candidates
    .map(candidate => ({
      ...candidate,
      content: normalizeCandidateContent(candidate.content),
      evidence: candidate.evidence.map(normalizeCandidateContent).filter(Boolean),
      sourceRunIds: candidate.sourceRunIds.map(normalizeCandidateContent).filter(Boolean),
    }))
    .filter(candidate => candidate.content)

  if (normalizedCandidates.length === 0) return []

  const dedupeKeys: string[] = []

  await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()

    for (const candidate of normalizedCandidates) {
      const dedupeKey = candidate.dedupeKey || createAgentMemoryCandidateDedupeKey(candidate.kind, candidate.content)
      dedupeKeys.push(dedupeKey)

      await db.execute(
        `insert into agent_memory_candidates (
          id, kind, content, evidence_json, source_run_ids_json, confidence, status,
          payload_json, dedupe_key, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict(dedupe_key) do update set
          content = case
            when agent_memory_candidates.status = 'pending' then excluded.content
            else agent_memory_candidates.content
          end,
          evidence_json = case
            when agent_memory_candidates.status = 'pending' then excluded.evidence_json
            else agent_memory_candidates.evidence_json
          end,
          source_run_ids_json = case
            when agent_memory_candidates.status = 'pending' then excluded.source_run_ids_json
            else agent_memory_candidates.source_run_ids_json
          end,
          confidence = case
            when agent_memory_candidates.status = 'pending' then excluded.confidence
            else agent_memory_candidates.confidence
          end,
          payload_json = case
            when agent_memory_candidates.status = 'pending' then excluded.payload_json
            else agent_memory_candidates.payload_json
          end,
          updated_at = excluded.updated_at`,
        [
          candidate.id || generateDbId('agent-memory-candidate'),
          candidate.kind,
          candidate.content,
          safeJson(candidate.evidence),
          safeJson(candidate.sourceRunIds),
          candidate.confidence,
          candidate.status || 'pending',
          candidate.payload === undefined ? null : safeJson(candidate.payload),
          dedupeKey,
          timestamp,
          timestamp,
        ],
      )
    }
  })

  return listAgentMemoryCandidatesByDedupeKeys([...new Set(dedupeKeys)])
}

export async function listAgentMemoryCandidatesFromDb(options: {
  status?: AgentMemoryCandidateStatus | 'all'
  limit?: number
} = {}): Promise<AgentMemoryCandidateRecord[]> {
  const db = await getDb()
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit || 80)))
  if (options.status && options.status !== 'all') {
    return db.select<AgentMemoryCandidateRecord[]>(
      `${selectAgentMemoryCandidateSql('where status = $1')}
      order by updated_at desc
      limit $2`,
      [options.status, limit],
    )
  }

  return db.select<AgentMemoryCandidateRecord[]>(
    `${selectAgentMemoryCandidateSql()}
    order by updated_at desc
    limit $1`,
    [limit],
  )
}

export async function getAgentMemoryCandidateFromDb(id: string): Promise<AgentMemoryCandidateRecord | null> {
  const db = await getDb()
  const rows = await db.select<AgentMemoryCandidateRecord[]>(
    `${selectAgentMemoryCandidateSql('where id = $1')}
    limit 1`,
    [id],
  )
  return rows[0] || null
}

export async function reviewAgentMemoryCandidateInDb(
  id: string,
  status: AgentMemoryCandidateStatus,
  options: {
    targetType?: string | null
    targetId?: string | null
    reviewNote?: string | null
  } = {},
): Promise<AgentMemoryCandidateRecord | null> {
  await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    await db.execute(
      `update agent_memory_candidates set
        status = $1,
        target_type = coalesce($2, target_type),
        target_id = coalesce($3, target_id),
        review_note = coalesce($4, review_note),
        reviewed_at = $5,
        updated_at = $6
      where id = $7`,
      [
        status,
        options.targetType ?? null,
        options.targetId ?? null,
        options.reviewNote ?? null,
        status === 'pending' ? null : timestamp,
        timestamp,
        id,
      ],
    )
  })

  return getAgentMemoryCandidateFromDb(id)
}

export async function archivePendingAgentMemoryCandidatesInDb(
  reviewNote = 'cleared from memory manager',
): Promise<number> {
  let archivedCount = 0

  await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const pendingRows = await db.select<Array<{ id: string }>>(
      'select id from agent_memory_candidates where status = $1',
      ['pending'],
    )

    archivedCount = pendingRows.length
    if (archivedCount === 0) return

    await db.execute(
      `update agent_memory_candidates set
        status = 'archived',
        review_note = coalesce(review_note, $1),
        reviewed_at = $2,
        updated_at = $3
      where status = 'pending'`,
      [reviewNote, timestamp, timestamp],
    )
  })

  return archivedCount
}

export async function insertAgentWorkflowTemplateInDb(
  template: AgentWorkflowTemplateInput,
): Promise<AgentWorkflowTemplateRecord> {
  const timestamp = now()
  const id = template.id || generateDbId('agent-workflow-template')

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into agent_workflow_templates (
        id, title, summary, trigger_examples_json, reusable_steps_json,
        required_tools_json, risk_notes_json, source_run_ids_json, candidate_id,
        created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict(candidate_id) do update set
        title = excluded.title,
        summary = excluded.summary,
        trigger_examples_json = excluded.trigger_examples_json,
        reusable_steps_json = excluded.reusable_steps_json,
        required_tools_json = excluded.required_tools_json,
        risk_notes_json = excluded.risk_notes_json,
        source_run_ids_json = excluded.source_run_ids_json,
        updated_at = excluded.updated_at`,
      [
        id,
        template.title,
        template.summary,
        safeJson(template.triggerExamples),
        safeJson(template.reusableSteps),
        safeJson(template.requiredTools),
        safeJson(template.riskNotes),
        safeJson(template.sourceRunIds),
        template.candidateId ?? null,
        timestamp,
        timestamp,
      ],
    )
  })

  const db = await getDb()
  const rows = await db.select<AgentWorkflowTemplateRecord[]>(
    template.candidateId
      ? `${selectAgentWorkflowTemplateSql('where candidate_id = $1')} limit 1`
      : `${selectAgentWorkflowTemplateSql('where id = $1')} limit 1`,
    [template.candidateId || id],
  )
  return rows[0]
}

export async function listAgentWorkflowTemplatesFromDb(limit = 50): Promise<AgentWorkflowTemplateRecord[]> {
  const db = await getDb()
  return db.select<AgentWorkflowTemplateRecord[]>(
    `${selectAgentWorkflowTemplateSql()}
    order by updated_at desc
    limit $1`,
    [Math.min(100, Math.max(1, Math.floor(limit)))],
  )
}

export async function upsertAgentSelfEvolutionReviewInDb(
  review: AgentSelfEvolutionReviewInput,
): Promise<AgentSelfEvolutionReviewRecord> {
  const timestamp = now()
  const id = review.id || generateDbId('agent-self-evolution')

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into agent_self_evolution_reviews (
        id, run_id, status, trigger, summary, changed_count,
        candidate_ids_json, findings_json, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict(run_id) do update set
        status = excluded.status,
        trigger = excluded.trigger,
        summary = excluded.summary,
        changed_count = excluded.changed_count,
        candidate_ids_json = excluded.candidate_ids_json,
        findings_json = excluded.findings_json,
        updated_at = excluded.updated_at`,
      [
        id,
        review.runId,
        review.status,
        review.trigger,
        review.summary,
        review.changedCount,
        safeJson(review.candidateIds),
        safeJson(review.findings),
        timestamp,
        timestamp,
      ],
    )
  })

  const existing = await getAgentSelfEvolutionReviewFromDb(review.runId)
  if (!existing) {
    throw new Error(`Agent self-evolution review was not persisted: ${review.runId}`)
  }
  return existing
}

export async function getAgentSelfEvolutionReviewFromDb(
  runId: string,
): Promise<AgentSelfEvolutionReviewRecord | null> {
  const db = await getDb()
  const rows = await db.select<AgentSelfEvolutionReviewRecord[]>(
    `${selectAgentSelfEvolutionReviewSql('where run_id = $1')}
    limit 1`,
    [runId],
  )
  return rows[0] || null
}

export async function listAgentSelfEvolutionReviewsFromDb(
  limit = 50,
): Promise<AgentSelfEvolutionReviewRecord[]> {
  const db = await getDb()
  return db.select<AgentSelfEvolutionReviewRecord[]>(
    `${selectAgentSelfEvolutionReviewSql()}
    order by updated_at desc
    limit $1`,
    [Math.min(100, Math.max(1, Math.floor(limit)))],
  )
}

async function projectAgentStepEvent(runId: string, event: AgentEvent) {
  if (event.type !== 'agent.planning' && event.type !== 'iteration.started' && event.type !== 'step.completed') {
    return
  }

  await serializedWrite(async () => {
    const db = await getDb()
    const createdAt = event.timestamp || now()

    if (event.type === 'agent.planning') {
      const steps = Array.isArray(event.payload?.plan?.steps) ? event.payload?.plan?.steps : []
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index] || {}
        const id = stepIdFor(runId, index + 1)
        await db.execute(
          `insert into agent_steps (
            id, run_id, step_index, title, status, planned_tools_json, started_at, created_at, updated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict(id) do update set
            title = excluded.title,
            planned_tools_json = excluded.planned_tools_json,
            updated_at = excluded.updated_at`,
          [
            id,
            runId,
            index + 1,
            typeof step.description === 'string' ? step.description : `Step ${index + 1}`,
            index === 0 ? 'running' : 'pending',
            safeJson(step.tools || []),
            index === 0 ? createdAt : null,
            createdAt,
            createdAt,
          ],
        )
      }
      return
    }

    const stepIndex = event.type === 'step.completed'
      ? Number(event.payload?.stepIndex || event.iteration || 0)
      : Number(event.iteration || 0)
    if (!stepIndex) return

    const id = stepIdFor(runId, stepIndex)
    await db.execute(
      `insert into agent_steps (
        id, run_id, step_index, title, status, thought, action_json,
        observation_summary, started_at, ended_at, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict(id) do update set
        title = coalesce(excluded.title, agent_steps.title),
        status = excluded.status,
        thought = coalesce(excluded.thought, agent_steps.thought),
        action_json = coalesce(excluded.action_json, agent_steps.action_json),
        observation_summary = coalesce(excluded.observation_summary, agent_steps.observation_summary),
        started_at = coalesce(agent_steps.started_at, excluded.started_at),
        ended_at = coalesce(excluded.ended_at, agent_steps.ended_at),
        updated_at = excluded.updated_at`,
      [
        id,
        runId,
        stepIndex,
        typeof event.payload?.title === 'string' ? event.payload.title : null,
        event.type === 'step.completed'
          ? event.payload?.success === false ? 'failed' : 'completed'
          : 'running',
        typeof event.payload?.thought === 'string' ? event.payload.thought : null,
        event.payload?.action ? safeJson(event.payload.action) : null,
        typeof event.payload?.observation === 'string' ? event.payload.observation : null,
        createdAt,
        event.type === 'step.completed' ? createdAt : null,
        createdAt,
        createdAt,
      ],
    )
  })
}

async function projectAgentToolEvent(runId: string, event: AgentEvent) {
  if (event.type !== 'tool.execution.started' && event.type !== 'tool.execution.finished' && event.type !== 'tool.updated') {
    return
  }

  const payload = event.payload || {}
  const toolCall = payload.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall as Record<string, unknown> : undefined
  const toolName = typeof payload.toolName === 'string'
    ? payload.toolName
    : typeof toolCall?.toolName === 'string'
      ? toolCall.toolName
      : undefined
  if (!toolName) return

  const id = extractToolCallId(runId, event)
  const status = typeof payload.status === 'string'
    ? payload.status
    : typeof toolCall?.status === 'string'
      ? toolCall.status
      : event.type === 'tool.execution.started'
        ? 'running'
        : 'pending'
  const result = payload.result ?? toolCall?.result
  const params = payload.params ?? toolCall?.params ?? {}
  const createdAt = event.timestamp || now()

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into agent_tool_calls (
        id, run_id, step_id, iteration, tool_name, params_json, result_json,
        status, success, duration_ms, error, message, data_ref, retryable,
        created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      on conflict(id) do update set
        step_id = coalesce(excluded.step_id, agent_tool_calls.step_id),
        iteration = coalesce(excluded.iteration, agent_tool_calls.iteration),
        params_json = coalesce(excluded.params_json, agent_tool_calls.params_json),
        result_json = coalesce(excluded.result_json, agent_tool_calls.result_json),
        status = excluded.status,
        success = coalesce(excluded.success, agent_tool_calls.success),
        duration_ms = coalesce(excluded.duration_ms, agent_tool_calls.duration_ms),
        error = coalesce(excluded.error, agent_tool_calls.error),
        message = coalesce(excluded.message, agent_tool_calls.message),
        data_ref = coalesce(excluded.data_ref, agent_tool_calls.data_ref),
        retryable = coalesce(excluded.retryable, agent_tool_calls.retryable),
        updated_at = excluded.updated_at`,
      [
        id,
        runId,
        event.iteration ? stepIdFor(runId, event.iteration) : null,
        event.iteration ?? null,
        toolName,
        safeJson(params),
        result !== undefined ? safeJson(result) : null,
        status,
        typeof payload.success === 'boolean' ? payload.success ? 1 : 0 : null,
        typeof payload.durationMs === 'number' ? payload.durationMs : null,
        typeof payload.error === 'string' ? payload.error : null,
        typeof payload.message === 'string' ? payload.message : null,
        typeof payload.dataRef === 'string' ? payload.dataRef : null,
        typeof payload.retryable === 'boolean' ? payload.retryable ? 1 : 0 : null,
        createdAt,
        createdAt,
      ],
    )
  })
}

async function projectAgentApprovalEvent(runId: string, event: AgentEvent) {
  if (event.type !== 'approval' && event.type !== 'confirmation.waiting' && event.type !== 'confirmation.resolved') {
    return
  }

  const payload = event.payload || {}
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined
  if (!toolName) return

  const status = normalizeApprovalStatus(payload.status, event.type)
  const createdAt = event.timestamp || now()

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into agent_approvals (
        id, run_id, step_id, tool_name, risk, status, reason, params_json,
        context_json, approval_scope, decided_at, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      on conflict(id) do update set
        status = excluded.status,
        reason = coalesce(excluded.reason, agent_approvals.reason),
        context_json = coalesce(excluded.context_json, agent_approvals.context_json),
        approval_scope = coalesce(excluded.approval_scope, agent_approvals.approval_scope),
        decided_at = coalesce(excluded.decided_at, agent_approvals.decided_at),
        updated_at = excluded.updated_at`,
      [
        extractApprovalId(runId, event),
        runId,
        event.iteration ? stepIdFor(runId, event.iteration) : null,
        toolName,
        typeof payload.risk === 'string' ? payload.risk : null,
        status,
        typeof payload.reason === 'string' ? payload.reason : null,
        safeJson(payload.params || {}),
        payload.context ? safeJson(payload.context) : null,
        typeof payload.approvalScope === 'string' ? payload.approvalScope : null,
        status === 'requested' ? null : createdAt,
        createdAt,
        createdAt,
      ],
    )
  })
}

async function syncAgentArtifactsWithDb(
  db: Awaited<ReturnType<typeof getDb>>,
  snapshot: AgentRunSnapshot,
) {
  const refs = [
    snapshot.sessionLogRef,
    snapshot.planRef,
    snapshot.todoRef,
    snapshot.contextPackRef,
    ...(snapshot.turnRefs || []),
    ...snapshot.draftRefs,
    ...snapshot.observationRefs,
  ].filter((ref): ref is VfsRef => Boolean(ref))

  for (const ref of refs) {
    await db.execute(
      `insert or ignore into agent_artifacts (
        id, run_id, kind, uri, path, summary, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        refId(ref),
        snapshot.runId,
        ref.kind,
        ref.uri,
        ref.path,
        ref.summary ?? null,
        snapshot.updatedAt || now(),
      ],
    )
  }
}
