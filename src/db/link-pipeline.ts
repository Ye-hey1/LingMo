import { getDb, runDbBatch, serializedWrite } from './index'

export type LinkSourceType = 'webpage' | 'github' | 'wechat' | 'xiaohongshu' | 'video' | 'unknown'
export type LinkJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type LinkJobStage = 'capture' | 'extract' | 'organize' | 'render' | 'complete'
export type LinkStageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface LinkJob {
  id: string
  parentJobId?: string
  markId?: number
  tagId: number
  url: string
  sourceType: LinkSourceType
  status: LinkJobStatus
  currentStage: LinkJobStage
  progress: number
  attempt: number
  autoOrganize: boolean
  input: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
  nextRetryAt?: number
  leaseOwner?: string
  leaseStartedAt?: number
  leaseExpiresAt?: number
  startedAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface LinkStageResult {
  id: string
  jobId: string
  stage: LinkJobStage
  attempt: number
  status: LinkStageStatus
  input: Record<string, unknown>
  output?: Record<string, unknown>
  content?: string
  errorCode?: string
  errorMessage?: string
  startedAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface LinkSourceBlock {
  id: string
  jobId: string
  markId?: number
  position: number
  kind: string
  content: string
  sourceLocator?: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface LinkOutputVersion {
  id: string
  jobId: string
  markId?: number
  version: number
  kind: string
  content: string
  desc?: string
  model?: string
  promptVersion?: string
  sourceFingerprint?: string
  metadata: Record<string, unknown>
  isActive: boolean
  createdAt: number
}

export interface LinkJobBundle {
  job: LinkJob
  stages: LinkStageResult[]
  sourceBlocks: LinkSourceBlock[]
  outputs: LinkOutputVersion[]
}

function now() {
  return Date.now()
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapJob(row: any): LinkJob {
  return {
    id: row.id,
    parentJobId: row.parent_job_id || undefined,
    markId: row.mark_id == null ? undefined : Number(row.mark_id),
    tagId: Number(row.tag_id || 0),
    url: row.url || '',
    sourceType: row.source_type || 'unknown',
    status: row.status || 'queued',
    currentStage: row.current_stage || 'capture',
    progress: Number(row.progress || 0),
    attempt: Number(row.attempt || 1),
    autoOrganize: Number(row.auto_organize || 0) === 1,
    input: parseJson(row.input_json, {}),
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    nextRetryAt: row.next_retry_at == null ? undefined : Number(row.next_retry_at),
    leaseOwner: row.lease_owner || undefined,
    leaseStartedAt: row.lease_started_at == null ? undefined : Number(row.lease_started_at),
    leaseExpiresAt: row.lease_expires_at == null ? undefined : Number(row.lease_expires_at),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapStageResult(row: any): LinkStageResult {
  return {
    id: row.id,
    jobId: row.job_id,
    stage: row.stage,
    attempt: Number(row.attempt || 1),
    status: row.status,
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, undefined),
    content: row.content || undefined,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapSourceBlock(row: any): LinkSourceBlock {
  return {
    id: row.id,
    jobId: row.job_id,
    markId: row.mark_id == null ? undefined : Number(row.mark_id),
    position: Number(row.position || 0),
    kind: row.kind || 'paragraph',
    content: row.content || '',
    sourceLocator: row.source_locator || undefined,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: Number(row.created_at || 0),
  }
}

function mapOutputVersion(row: any): LinkOutputVersion {
  return {
    id: row.id,
    jobId: row.job_id,
    markId: row.mark_id == null ? undefined : Number(row.mark_id),
    version: Number(row.version || 1),
    kind: row.kind || 'organized_markdown',
    content: row.content || '',
    desc: row.desc || undefined,
    model: row.model || undefined,
    promptVersion: row.prompt_version || undefined,
    sourceFingerprint: row.source_fingerprint || undefined,
    metadata: parseJson(row.metadata_json, {}),
    isActive: Number(row.is_active || 0) === 1,
    createdAt: Number(row.created_at || 0),
  }
}

async function ensureLinkJobColumn(column: string, definition: string) {
  const db = await getDb()
  const columns = await db.select<Array<{ name: string }>>('pragma table_info(link_jobs)')
  if (!columns.some(item => item.name === column)) {
    await db.execute(`alter table link_jobs add column ${column} ${definition}`)
  }
}

export async function initLinkPipelineDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists link_jobs (
      id text primary key,
      parent_job_id text,
      mark_id integer,
      tag_id integer not null,
      url text not null,
      source_type text not null,
      status text not null,
      current_stage text not null,
      progress integer not null default 0,
      attempt integer not null default 1,
      auto_organize integer not null default 1,
      input_json text not null default '{}',
      error_code text,
      error_message text,
      next_retry_at integer,
      lease_owner text,
      lease_started_at integer,
      lease_expires_at integer,
      started_at integer,
      completed_at integer,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists link_stage_results (
      id text primary key,
      job_id text not null,
      stage text not null,
      attempt integer not null default 1,
      status text not null,
      input_json text not null default '{}',
      output_json text,
      content text,
      error_code text,
      error_message text,
      started_at integer,
      completed_at integer,
      created_at integer not null,
      updated_at integer not null,
      unique (job_id, stage, attempt)
    )
  `)

  await db.execute(`
    create table if not exists link_source_blocks (
      id text primary key,
      job_id text not null,
      mark_id integer,
      position integer not null,
      kind text not null,
      content text not null,
      source_locator text,
      metadata_json text not null default '{}',
      created_at integer not null,
      unique (job_id, position)
    )
  `)

  await db.execute(`
    create table if not exists link_output_versions (
      id text primary key,
      job_id text not null,
      mark_id integer,
      version integer not null,
      kind text not null,
      content text not null,
      desc text,
      model text,
      prompt_version text,
      source_fingerprint text,
      metadata_json text not null default '{}',
      is_active integer not null default 1,
      created_at integer not null,
      unique (job_id, version)
    )
  `)

  await ensureLinkJobColumn('next_retry_at', 'integer')
  await ensureLinkJobColumn('parent_job_id', 'text')
  await ensureLinkJobColumn('input_json', "text not null default '{}'")
  await ensureLinkJobColumn('lease_owner', 'text')
  await ensureLinkJobColumn('lease_started_at', 'integer')
  await ensureLinkJobColumn('lease_expires_at', 'integer')

  await db.execute('create index if not exists idx_link_jobs_status on link_jobs(status, next_retry_at, updated_at)')
  await db.execute('create index if not exists idx_link_jobs_lease on link_jobs(status, lease_expires_at)')
  await db.execute('create index if not exists idx_link_jobs_mark on link_jobs(mark_id, updated_at desc)')
  await db.execute('create index if not exists idx_link_jobs_url on link_jobs(url, created_at desc)')
  await db.execute('create unique index if not exists idx_link_jobs_parent_unique on link_jobs(parent_job_id) where parent_job_id is not null')
  await db.execute('create index if not exists idx_link_stage_results_job on link_stage_results(job_id, created_at)')
  await db.execute('create index if not exists idx_link_source_blocks_job on link_source_blocks(job_id, position)')
  await db.execute('create index if not exists idx_link_output_versions_job on link_output_versions(job_id, version desc)')
  await db.execute('create index if not exists idx_link_output_versions_mark on link_output_versions(mark_id, is_active)')
}

export interface CreateLinkJobInput {
  id?: string
  parentJobId?: string
  markId?: number
  tagId: number
  url: string
  sourceType?: LinkSourceType
  autoOrganize?: boolean
  input?: Record<string, unknown>
  currentStage?: LinkJobStage
  progress?: number
}

export async function ensureLinkJob(input: CreateLinkJobInput): Promise<{ job: LinkJob; created: boolean }> {
  return await serializedWrite(async () => {
    const db = await getDb()
    if (input.parentJobId) {
      const existingRows = await db.select<any[]>(
        'select * from link_jobs where parent_job_id = $1 limit 1',
        [input.parentJobId],
      )
      if (existingRows[0]) {
        return { job: mapJob(existingRows[0]), created: false }
      }
    }

    const timestamp = now()
    const job: LinkJob = {
      id: input.id || createId('link_job'),
      parentJobId: input.parentJobId,
      markId: input.markId,
      tagId: input.tagId,
      url: input.url,
      sourceType: input.sourceType || 'unknown',
      status: 'queued',
      currentStage: input.currentStage || 'capture',
      progress: Math.max(0, Math.min(100, input.progress ?? 0)),
      attempt: 1,
      autoOrganize: input.autoOrganize ?? true,
      input: input.input || {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const result = await db.execute(
      `insert or ignore into link_jobs
       (id, parent_job_id, mark_id, tag_id, url, source_type, status, current_stage, progress, attempt,
        auto_organize, input_json, error_code, error_message, next_retry_at, lease_owner, lease_started_at,
        lease_expires_at, started_at, completed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        job.id, job.parentJobId ?? null, job.markId ?? null, job.tagId, job.url, job.sourceType,
        job.status, job.currentStage, job.progress, job.attempt, job.autoOrganize ? 1 : 0,
        JSON.stringify(job.input), null, null, null, null, null, null, null, null,
        job.createdAt, job.updatedAt,
      ],
    )
    if (result.rowsAffected > 0) return { job, created: true }

    const existingRows = input.parentJobId
      ? await db.select<any[]>('select * from link_jobs where parent_job_id = $1 limit 1', [input.parentJobId])
      : await db.select<any[]>('select * from link_jobs where id = $1 limit 1', [job.id])
    if (!existingRows[0]) {
      throw new Error('链接任务幂等创建失败')
    }
    return { job: mapJob(existingRows[0]), created: false }
  })
}

export async function createLinkJob(input: CreateLinkJobInput): Promise<LinkJob> {
  return (await ensureLinkJob(input)).job
}

export async function getLinkJob(jobId: string): Promise<LinkJob | null> {
  const db = await getDb()
  const rows = await db.select<any[]>('select * from link_jobs where id = $1 limit 1', [jobId])
  return rows[0] ? mapJob(rows[0]) : null
}

export async function updateLinkJob(jobId: string, patch: Partial<Omit<LinkJob, 'id' | 'createdAt'>>): Promise<LinkJob | null> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const rows = await db.select<any[]>('select * from link_jobs where id = $1 limit 1', [jobId])
    if (!rows[0]) return null

    const current = mapJob(rows[0])
    const next: LinkJob = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now() }
    await db.execute(
      `update link_jobs set
         parent_job_id = $1, mark_id = $2, tag_id = $3, url = $4, source_type = $5, status = $6,
         current_stage = $7, progress = $8, attempt = $9, auto_organize = $10, input_json = $11,
         error_code = $12, error_message = $13, next_retry_at = $14, lease_owner = $15,
         lease_started_at = $16, lease_expires_at = $17, started_at = $18,
         completed_at = $19, updated_at = $20
       where id = $21`,
      [
        next.parentJobId ?? null, next.markId ?? null, next.tagId, next.url, next.sourceType, next.status,
        next.currentStage, Math.max(0, Math.min(100, next.progress)), next.attempt,
        next.autoOrganize ? 1 : 0, JSON.stringify(next.input), next.errorCode ?? null, next.errorMessage ?? null,
        next.nextRetryAt ?? null, next.leaseOwner ?? null, next.leaseStartedAt ?? null,
        next.leaseExpiresAt ?? null, next.startedAt ?? null, next.completedAt ?? null,
        next.updatedAt, next.id,
      ],
    )
    return next
  })
}

export async function attachLinkJobMark(jobId: string, markId: number) {
  return await updateLinkJob(jobId, { markId })
}

export async function claimLinkJob(
  jobId: string,
  owner: string,
  options?: { now?: number; leaseMs?: number; expectedStage?: LinkJobStage },
): Promise<LinkJob | null> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = options?.now ?? now()
    const leaseExpiresAt = timestamp + (options?.leaseMs ?? 60_000)
    const result = await db.execute(
      `update link_jobs set
         status = 'running',
         attempt = case when status in ('running', 'failed') then attempt + 1 else attempt end,
         lease_owner = $1,
         lease_started_at = $2,
         lease_expires_at = $3,
         started_at = coalesce(started_at, $2),
         completed_at = null,
         error_code = null,
         error_message = null,
         updated_at = $2
       where id = $4
       and ($5 is null or current_stage = $5)
       and (
         status = 'queued'
         or (status = 'failed' and (next_retry_at is null or next_retry_at <= $2))
         or (status = 'running' and (lease_expires_at is null or lease_expires_at <= $2))
       )`,
      [owner, timestamp, leaseExpiresAt, jobId, options?.expectedStage ?? null],
    )
    if (!result.rowsAffected) return null

    const rows = await db.select<any[]>('select * from link_jobs where id = $1 limit 1', [jobId])
    return rows[0] ? mapJob(rows[0]) : null
  })
}

export async function checkpointLinkJob(
  jobId: string,
  owner: string,
  patch: { currentStage: LinkJobStage; progress: number; leaseMs?: number },
): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set
         current_stage = $1,
         progress = $2,
         lease_expires_at = $3,
         updated_at = $4
       where id = $5 and status = 'running' and lease_owner = $6`,
      [
        patch.currentStage,
        Math.max(0, Math.min(100, patch.progress)),
        timestamp + (patch.leaseMs ?? 60_000),
        timestamp,
        jobId,
        owner,
      ],
    )
    return result.rowsAffected > 0
  })
}

export async function renewLinkJobLease(jobId: string, owner: string, leaseMs = 60_000): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set lease_expires_at = $1, updated_at = $2
       where id = $3 and status = 'running' and lease_owner = $4`,
      [timestamp + leaseMs, timestamp, jobId, owner],
    )
    return result.rowsAffected > 0
  })
}

export async function completeLinkJob(
  jobId: string,
  owner: string,
  input?: { markId?: number },
): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set
         mark_id = coalesce($1, mark_id),
         status = 'succeeded',
         current_stage = 'complete',
         progress = 100,
         error_code = null,
         error_message = null,
         next_retry_at = null,
         lease_owner = null,
         lease_started_at = null,
         lease_expires_at = null,
         completed_at = $2,
         updated_at = $2
       where id = $3 and status = 'running' and lease_owner = $4`,
      [input?.markId ?? null, timestamp, jobId, owner],
    )
    return result.rowsAffected > 0
  })
}

export async function failLinkJob(
  jobId: string,
  owner: string,
  input: { errorCode: string; errorMessage: string; nextRetryAt?: number },
): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set
         status = 'failed',
         error_code = $1,
         error_message = $2,
         next_retry_at = $3,
         lease_owner = null,
         lease_started_at = null,
         lease_expires_at = null,
         updated_at = $4
       where id = $5 and status = 'running' and lease_owner = $6`,
      [input.errorCode, input.errorMessage, input.nextRetryAt ?? null, timestamp, jobId, owner],
    )
    return result.rowsAffected > 0
  })
}

export async function cancelLinkJob(jobId: string): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set
         status = 'cancelled',
         lease_owner = null,
         lease_started_at = null,
         lease_expires_at = null,
         completed_at = $1,
         updated_at = $1
       where id = $2 and status in ('queued', 'running', 'failed')`,
      [timestamp, jobId],
    )
    return result.rowsAffected > 0
  })
}

export async function upsertLinkStageResult(input: {
  id?: string
  jobId: string
  stage: LinkJobStage
  attempt?: number
  status: LinkStageStatus
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  content?: string
  errorCode?: string
  errorMessage?: string
  startedAt?: number
  completedAt?: number
}): Promise<LinkStageResult> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result: LinkStageResult = {
      id: input.id || createId('link_stage'),
      jobId: input.jobId,
      stage: input.stage,
      attempt: input.attempt || 1,
      status: input.status,
      input: input.input || {},
      output: input.output,
      content: input.content,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await db.execute(
      `insert into link_stage_results
       (id, job_id, stage, attempt, status, input_json, output_json, content, error_code,
        error_message, started_at, completed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict(job_id, stage, attempt) do update set
         status = excluded.status,
         input_json = excluded.input_json,
         output_json = excluded.output_json,
         content = excluded.content,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
      [
        result.id, result.jobId, result.stage, result.attempt, result.status,
        JSON.stringify(result.input), result.output ? JSON.stringify(result.output) : null,
        result.content ?? null, result.errorCode ?? null, result.errorMessage ?? null,
        result.startedAt ?? null, result.completedAt ?? null, result.createdAt, result.updatedAt,
      ],
    )
    return result
  })
}

export async function replaceLinkSourceBlocks(
  jobId: string,
  markId: number | undefined,
  blocks: Array<Pick<LinkSourceBlock, 'kind' | 'content'> & Partial<Pick<LinkSourceBlock, 'id' | 'sourceLocator' | 'metadata'>>>,
): Promise<LinkSourceBlock[]> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const nextBlocks = blocks.map((block, position): LinkSourceBlock => ({
      id: block.id || createId('link_block'),
      jobId,
      markId,
      position,
      kind: block.kind,
      content: block.content,
      sourceLocator: block.sourceLocator,
      metadata: block.metadata || {},
      createdAt: timestamp,
    }))

    await runDbBatch(db, async () => {
      await db.execute('delete from link_source_blocks where job_id = $1', [jobId])
      for (const block of nextBlocks) {
        await db.execute(
          `insert into link_source_blocks
           (id, job_id, mark_id, position, kind, content, source_locator, metadata_json, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            block.id, block.jobId, block.markId ?? null, block.position, block.kind,
            block.content, block.sourceLocator ?? null, JSON.stringify(block.metadata), block.createdAt,
          ],
        )
      }
    })
    return nextBlocks
  })
}

export async function createLinkOutputVersion(input: {
  id?: string
  jobId: string
  markId?: number
  version?: number
  kind: string
  content: string
  desc?: string
  model?: string
  promptVersion?: string
  sourceFingerprint?: string
  metadata?: Record<string, unknown>
}): Promise<LinkOutputVersion> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const versionRows = input.version == null
      ? await db.select<Array<{ next_version: number }>>(
        'select coalesce(max(version), 0) + 1 as next_version from link_output_versions where job_id = $1',
        [input.jobId],
      )
      : []
    const output: LinkOutputVersion = {
      id: input.id || createId('link_output'),
      jobId: input.jobId,
      markId: input.markId,
      version: input.version ?? Number(versionRows[0]?.next_version || 1),
      kind: input.kind,
      content: input.content,
      desc: input.desc,
      model: input.model,
      promptVersion: input.promptVersion,
      sourceFingerprint: input.sourceFingerprint,
      metadata: input.metadata || {},
      isActive: true,
      createdAt: now(),
    }

    await runDbBatch(db, async () => {
      await db.execute(
        `insert into link_output_versions
         (id, job_id, mark_id, version, kind, content, desc, model, prompt_version,
          source_fingerprint, metadata_json, is_active, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          output.id, output.jobId, output.markId ?? null, output.version, output.kind,
          output.content, output.desc ?? null, output.model ?? null, output.promptVersion ?? null,
          output.sourceFingerprint ?? null, JSON.stringify(output.metadata), 1, output.createdAt,
        ],
      )
      // Insert first so a failed insert never deactivates the last usable output.
      await db.execute(
        'update link_output_versions set is_active = 0 where job_id = $1 and id <> $2',
        [output.jobId, output.id],
      )
    })
    return output
  })
}

export async function updateLinkOutputVersionMetadata(
  outputId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const result = await db.execute(
      'update link_output_versions set metadata_json = $1 where id = $2',
      [JSON.stringify(metadata), outputId],
    )
    return result.rowsAffected > 0
  })
}

export async function getLinkJobBundle(jobId: string): Promise<LinkJobBundle | null> {
  const db = await getDb()
  const [jobRows, stageRows, sourceRows, outputRows] = await Promise.all([
    db.select<any[]>('select * from link_jobs where id = $1 limit 1', [jobId]),
    db.select<any[]>('select * from link_stage_results where job_id = $1 order by created_at asc', [jobId]),
    db.select<any[]>('select * from link_source_blocks where job_id = $1 order by position asc', [jobId]),
    db.select<any[]>('select * from link_output_versions where job_id = $1 order by version desc', [jobId]),
  ])
  if (!jobRows[0]) return null
  return {
    job: mapJob(jobRows[0]),
    stages: stageRows.map(mapStageResult),
    sourceBlocks: sourceRows.map(mapSourceBlock),
    outputs: outputRows.map(mapOutputVersion),
  }
}

export async function getLatestLinkJobForMark(markId: number): Promise<LinkJob | null> {
  const db = await getDb()
  const rows = await db.select<any[]>(
    `select * from link_jobs
     where mark_id = $1
     order by case when status in ('queued', 'running', 'failed') then 0 else 1 end,
              updated_at desc
     limit 1`,
    [markId],
  )
  return rows[0] ? mapJob(rows[0]) : null
}

export async function listRecoverableLinkJobs(): Promise<LinkJob[]> {
  const db = await getDb()
  const rows = await db.select<any[]>(
    `select * from link_jobs
     where status in ('queued', 'running', 'failed')
     order by updated_at asc`,
  )
  return rows.map(mapJob)
}

export async function retryLinkJob(jobId: string): Promise<LinkJob | null> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const timestamp = now()
    const result = await db.execute(
      `update link_jobs set
         status = 'queued',
         progress = 0,
         attempt = attempt + 1,
         error_code = null,
         error_message = null,
         next_retry_at = null,
         lease_owner = null,
         lease_started_at = null,
         lease_expires_at = null,
         started_at = null,
         completed_at = null,
         updated_at = $1
       where id = $2 and status = 'failed'`,
      [timestamp, jobId],
    )
    if (result.rowsAffected === 0) return null

    const rows = await db.select<any[]>('select * from link_jobs where id = $1 limit 1', [jobId])
    return rows[0] ? mapJob(rows[0]) : null
  })
}
