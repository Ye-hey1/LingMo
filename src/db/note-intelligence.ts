import { getDb, serializedWrite } from './index'

export type NoteUsageEventType =
  | 'open'
  | 'edit'
  | 'rag_reference'
  | 'ai_reference'
  | 'manual_link'

export type NoteInsightType = 'delayed_connection' | 'counterpoint'
export type NoteInsightStatus = 'active' | 'dismissed' | 'accepted'

export interface NoteUsageEvent {
  id: number
  note_path: string
  event_type: NoteUsageEventType
  meta: string | null
  created_at: number
}

export interface NoteLifecycleLabel {
  id: number
  note_path: string
  label: string
  score: number
  reason: string
  suggested_action: string
  updated_at: number
  dismissed_at: number | null
}

export interface NoteInsight {
  id: number
  type: NoteInsightType
  source_note: string
  target_note: string | null
  title: string
  summary: string
  rationale: string
  confidence: number
  status: NoteInsightStatus
  created_at: number
  updated_at: number
}

export interface InsertNoteInsightInput {
  type: NoteInsightType
  source_note: string
  target_note?: string | null
  title: string
  summary: string
  rationale: string
  confidence: number
  status?: NoteInsightStatus
}

export async function initNoteIntelligenceDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists note_usage_events (
      id integer primary key autoincrement,
      note_path text not null,
      event_type text not null,
      meta text default null,
      created_at integer not null
    )
  `)

  await db.execute(`
    create index if not exists idx_note_usage_events_note_time
    on note_usage_events(note_path, created_at desc)
  `)

  await db.execute(`
    create index if not exists idx_note_usage_events_type_time
    on note_usage_events(event_type, created_at desc)
  `)

  await db.execute(`
    create table if not exists note_lifecycle_labels (
      id integer primary key autoincrement,
      note_path text not null unique,
      label text not null,
      score real not null,
      reason text not null,
      suggested_action text not null,
      updated_at integer not null,
      dismissed_at integer default null
    )
  `)

  await db.execute(`
    create index if not exists idx_note_lifecycle_labels_label_score
    on note_lifecycle_labels(label, score desc)
  `)

  await db.execute(`
    create table if not exists note_insights (
      id integer primary key autoincrement,
      type text not null,
      source_note text not null,
      target_note text default null,
      title text not null,
      summary text not null,
      rationale text not null,
      confidence real not null,
      status text not null default 'active',
      created_at integer not null,
      updated_at integer not null,
      unique(type, source_note, target_note)
    )
  `)

  await db.execute(`
    create index if not exists idx_note_insights_type_status
    on note_insights(type, status, confidence desc)
  `)
}

export async function recordNoteUsageEvent(
  notePath: string,
  eventType: NoteUsageEventType,
  meta?: Record<string, unknown>,
) {
  const normalizedPath = notePath.trim()
  if (!normalizedPath) return null

  return serializedWrite(async () => {
    const db = await getDb()
    return await db.execute(
      `insert into note_usage_events (note_path, event_type, meta, created_at)
       values ($1, $2, $3, $4)`,
      [
        normalizedPath,
        eventType,
        meta ? JSON.stringify(meta) : null,
        Date.now(),
      ],
    )
  })
}

export async function getNoteUsageSummary(notePaths: string[], since = 0) {
  if (notePaths.length === 0) return new Map<string, { count: number; lastUsedAt?: number }>()

  const db = await getDb()
  const placeholders = notePaths.map((_, index) => `$${index + 1}`).join(',')
  const rows = await db.select<Array<{ note_path: string; count: number; last_used_at: number }>>(
    `select note_path, count(*) as count, max(created_at) as last_used_at
     from note_usage_events
     where note_path in (${placeholders}) and created_at >= $${notePaths.length + 1}
     group by note_path`,
    [...notePaths, since],
  )

  return new Map(rows.map(row => [
    row.note_path,
    { count: Number(row.count) || 0, lastUsedAt: Number(row.last_used_at) || undefined },
  ]))
}

export async function upsertLifecycleLabel(input: Omit<NoteLifecycleLabel, 'id' | 'updated_at' | 'dismissed_at'>) {
  return serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into note_lifecycle_labels (note_path, label, score, reason, suggested_action, updated_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict(note_path)
       do update set label = excluded.label, score = excluded.score, reason = excluded.reason,
         suggested_action = excluded.suggested_action, updated_at = excluded.updated_at,
         dismissed_at = null`,
      [
        input.note_path,
        input.label,
        input.score,
        input.reason,
        input.suggested_action,
        Date.now(),
      ],
    )
  })
}

export async function getLifecycleLabels(limit = 30) {
  const db = await getDb()
  return await db.select<NoteLifecycleLabel[]>(
    `select * from note_lifecycle_labels
     where dismissed_at is null
     order by score desc, updated_at desc
     limit $1`,
    [limit],
  )
}

export async function dismissLifecycleLabel(notePath: string) {
  return serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update note_lifecycle_labels set dismissed_at = $1 where note_path = $2`,
      [Date.now(), notePath],
    )
  })
}

export async function upsertNoteInsight(input: InsertNoteInsightInput) {
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    await db.execute(
      `insert into note_insights
        (type, source_note, target_note, title, summary, rationale, confidence, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict(type, source_note, target_note)
       do update set title = excluded.title, summary = excluded.summary, rationale = excluded.rationale,
         confidence = excluded.confidence, status = excluded.status, updated_at = excluded.updated_at`,
      [
        input.type,
        input.source_note,
        input.target_note ?? null,
        input.title,
        input.summary,
        input.rationale,
        input.confidence,
        input.status ?? 'active',
        now,
        now,
      ],
    )
  })
}

export async function getNoteInsights(type?: NoteInsightType, limit = 30) {
  const db = await getDb()
  if (type) {
    return await db.select<NoteInsight[]>(
      `select * from note_insights
       where type = $1 and status = 'active'
       order by confidence desc, updated_at desc
       limit $2`,
      [type, limit],
    )
  }

  return await db.select<NoteInsight[]>(
    `select * from note_insights
     where status = 'active'
     order by confidence desc, updated_at desc
     limit $1`,
    [limit],
  )
}

export async function setNoteInsightStatus(id: number, status: NoteInsightStatus) {
  return serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update note_insights set status = $1, updated_at = $2 where id = $3`,
      [status, Date.now(), id],
    )
  })
}
