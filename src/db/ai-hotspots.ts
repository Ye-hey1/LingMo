import { getDb, serializedWrite } from './index'
import type {
  AiHotspotItem,
  AiHotspotDigestStatus,
  AiHotspotSuggestedAction,
  AiHotspotSourceKind,
  AiHotspotSourceStatus,
  AiHotspotUserFeed,
} from '@/lib/ai-hotspots/types'

interface AiHotspotItemRow {
  id: string
  source_id: string
  source_name: string
  feed_name: string
  title: string
  title_original: string | null
  title_en: string | null
  title_zh: string | null
  url: string
  published_at: string | null
  first_seen_at: string
  last_seen_at: string
  summary: string | null
  tags_json: string | null
  score: number | null
  is_favorite: number | null
  is_read: number | null
  saved_note_path: string | null
  signal_summary: string | null
  signal_essence: string | null
  impact_audience_json: string | null
  suggested_action: AiHotspotSuggestedAction | null
  related_signal_ids_json: string | null
  is_ignored: number | null
  deleted_at: string | null
  digest_status: AiHotspotDigestStatus | null
  snapshot_id: string | null
  meta_json: string | null
}

interface AiHotspotSourceRow {
  source_id: string
  source_name: string
  kind: AiHotspotSourceKind
  enabled: number | null
  ok: number | null
  item_count: number | null
  duration_ms: number | null
  last_ok_at: string | null
  last_error: string | null
  updated_at: string
}

interface AiHotspotUserFeedRow {
  id: string
  title: string
  feed_url: string
  group_name: string | null
  enabled: number | null
  created_at: string
  updated_at: string
}

export interface AiHotspotSnapshot {
  id: string
  startedAt: string
  completedAt: string
  rawCount: number
  keptCount: number
  failedCount: number
  status: unknown
}

export interface AddAiHotspotUserFeedInput {
  id?: string
  title: string
  feedUrl: string
  groupName?: string | null
  enabled?: boolean
}

export type UpdateAiHotspotUserFeedPatch = Partial<Pick<
  AiHotspotUserFeed,
  'title' | 'feedUrl' | 'groupName' | 'enabled'
>>

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function stringifyArray(value: string[]) {
  return JSON.stringify(value.filter(Boolean))
}

export function parseArray(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value)
}

async function ensureColumn(tableName: string, columnName: string, definition: string) {
  const db = await getDb()
  const columns = await db.select<Array<{ name: string }>>(`pragma table_info(${tableName})`)
  if (columns.some(column => column.name === columnName)) return
  await db.execute(`alter table ${tableName} add column ${columnName} ${definition}`)
}

export function mapItemRow(row: AiHotspotItemRow): AiHotspotItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    feedName: row.feed_name,
    title: row.title,
    titleOriginal: row.title_original,
    titleEn: row.title_en,
    titleZh: row.title_zh,
    url: row.url,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    summary: row.summary,
    tags: parseArray(row.tags_json),
    score: Number(row.score || 0),
    isFavorite: Boolean(row.is_favorite),
    isRead: Boolean(row.is_read),
    savedNotePath: row.saved_note_path,
    signalSummary: row.signal_summary,
    signalEssence: row.signal_essence,
    impactAudience: parseArray(row.impact_audience_json),
    suggestedAction: row.suggested_action,
    relatedSignalIds: parseArray(row.related_signal_ids_json),
    isIgnored: Boolean(row.is_ignored),
    deletedAt: row.deleted_at,
    digestStatus: row.digest_status || 'none',
    snapshotId: row.snapshot_id,
    meta: parseJsonObject(row.meta_json),
  }
}

export function mapSourceRow(row: AiHotspotSourceRow): AiHotspotSourceStatus {
  return {
    sourceId: row.source_id,
    sourceName: row.source_name,
    kind: row.kind,
    enabled: row.enabled !== 0,
    ok: Boolean(row.ok),
    itemCount: Number(row.item_count || 0),
    durationMs: Number(row.duration_ms || 0),
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }
}

export function mapFeedRow(row: AiHotspotUserFeedRow): AiHotspotUserFeed {
  return {
    id: row.id,
    title: row.title,
    feedUrl: row.feed_url,
    groupName: row.group_name,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function initAiHotspotsDb() {
  await serializedWrite(async () => {
    const db = await getDb()

    await db.execute(`
      create table if not exists ai_hotspot_items (
        id text primary key,
        source_id text not null,
        source_name text not null,
        feed_name text not null,
        title text not null,
        title_original text,
        title_en text,
        title_zh text,
        url text not null,
        published_at text,
        first_seen_at text not null,
        last_seen_at text not null,
        summary text,
        tags_json text,
        score integer default 0,
        is_favorite integer default 0,
        is_read integer default 0,
        saved_note_path text,
        signal_summary text,
        signal_essence text,
        impact_audience_json text,
        suggested_action text,
        related_signal_ids_json text,
        is_ignored integer default 0,
        deleted_at text,
        digest_status text default 'none',
        snapshot_id text,
        meta_json text
      )
    `)

    await ensureColumn('ai_hotspot_items', 'signal_summary', 'text')
    await ensureColumn('ai_hotspot_items', 'signal_essence', 'text')
    await ensureColumn('ai_hotspot_items', 'impact_audience_json', 'text')
    await ensureColumn('ai_hotspot_items', 'suggested_action', 'text')
    await ensureColumn('ai_hotspot_items', 'related_signal_ids_json', 'text')
    await ensureColumn('ai_hotspot_items', 'is_ignored', 'integer default 0')
    await ensureColumn('ai_hotspot_items', 'deleted_at', 'text')
    await ensureColumn('ai_hotspot_items', 'digest_status', "text default 'none'")
    await ensureColumn('ai_hotspot_items', 'snapshot_id', 'text')
    await ensureColumn('ai_hotspot_items', 'meta_json', 'text')

    await db.execute(`
      create table if not exists ai_hotspot_sources (
        source_id text primary key,
        source_name text not null,
        kind text not null,
        enabled integer default 1,
        ok integer default 0,
        item_count integer default 0,
        duration_ms integer default 0,
        last_ok_at text,
        last_error text,
        updated_at text not null
      )
    `)

    await db.execute(`
      create table if not exists ai_hotspot_user_feeds (
        id text primary key,
        title text not null,
        feed_url text not null unique,
        group_name text,
        enabled integer default 1,
        created_at text not null,
        updated_at text not null
      )
    `)

    await db.execute(`
      create table if not exists ai_hotspot_snapshots (
        id text primary key,
        started_at text not null,
        completed_at text not null,
        raw_count integer default 0,
        kept_count integer default 0,
        failed_count integer default 0,
        status_json text
      )
    `)

    await db.execute('create index if not exists idx_ai_hotspot_items_published_at on ai_hotspot_items(published_at desc)')
    await db.execute('create index if not exists idx_ai_hotspot_items_last_seen_at on ai_hotspot_items(last_seen_at desc)')
    await db.execute('create index if not exists idx_ai_hotspot_items_source on ai_hotspot_items(source_id)')
    await db.execute('create index if not exists idx_ai_hotspot_items_favorite on ai_hotspot_items(is_favorite)')
    await db.execute('create index if not exists idx_ai_hotspot_items_deleted_at on ai_hotspot_items(deleted_at)')
    await db.execute('create index if not exists idx_ai_hotspot_items_ignored on ai_hotspot_items(is_ignored)')
  })
}

export async function getAiHotspotItems() {
  const db = await getDb()
  const rows = await db.select<AiHotspotItemRow[]>(
    `select * from ai_hotspot_items
     order by coalesce(published_at, last_seen_at) desc, last_seen_at desc`,
  )
  return rows.map(mapItemRow)
}

export async function upsertAiHotspotItems(items: AiHotspotItem[]) {
  if (items.length === 0) return

  await serializedWrite(async () => {
    const db = await getDb()

    for (const item of items) {
      await db.execute(
        `insert into ai_hotspot_items
          (id, source_id, source_name, feed_name, title, title_original, title_en, title_zh,
           url, published_at, first_seen_at, last_seen_at, summary, tags_json, score,
           is_favorite, is_read, saved_note_path, signal_summary, signal_essence,
           impact_audience_json, suggested_action, related_signal_ids_json, is_ignored,
           deleted_at, digest_status, snapshot_id, meta_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         on conflict(id) do update set
           source_id = excluded.source_id,
           source_name = excluded.source_name,
           feed_name = excluded.feed_name,
           title = excluded.title,
           title_original = excluded.title_original,
           title_en = excluded.title_en,
           title_zh = excluded.title_zh,
           url = excluded.url,
           published_at = excluded.published_at,
           first_seen_at = ai_hotspot_items.first_seen_at,
           last_seen_at = excluded.last_seen_at,
           summary = excluded.summary,
           tags_json = excluded.tags_json,
           score = excluded.score,
           is_favorite = ai_hotspot_items.is_favorite,
           is_read = ai_hotspot_items.is_read,
           saved_note_path = ai_hotspot_items.saved_note_path,
           signal_summary = coalesce(ai_hotspot_items.signal_summary, excluded.signal_summary),
           signal_essence = coalesce(ai_hotspot_items.signal_essence, excluded.signal_essence),
           impact_audience_json = coalesce(ai_hotspot_items.impact_audience_json, excluded.impact_audience_json),
           suggested_action = coalesce(ai_hotspot_items.suggested_action, excluded.suggested_action),
           related_signal_ids_json = coalesce(ai_hotspot_items.related_signal_ids_json, excluded.related_signal_ids_json),
           is_ignored = ai_hotspot_items.is_ignored,
           deleted_at = ai_hotspot_items.deleted_at,
           digest_status = ai_hotspot_items.digest_status,
           snapshot_id = ai_hotspot_items.snapshot_id,
           meta_json = excluded.meta_json`,
        [
          item.id,
          item.sourceId,
          item.sourceName,
          item.feedName,
          item.title,
          item.titleOriginal,
          item.titleEn,
          item.titleZh,
          item.url,
          item.publishedAt,
          item.firstSeenAt,
          item.lastSeenAt,
          item.summary,
          stringifyArray(item.tags),
          item.score,
          Number(item.isFavorite),
          Number(item.isRead),
          item.savedNotePath,
          item.signalSummary,
          item.signalEssence,
          stringifyArray(item.impactAudience),
          item.suggestedAction,
          stringifyArray(item.relatedSignalIds),
          Number(item.isIgnored),
          item.deletedAt,
          item.digestStatus,
          item.snapshotId,
          stringifyJson(item.meta || {}),
        ],
      )
    }
  })
}

export async function getAiHotspotSourceStatuses() {
  const db = await getDb()
  const rows = await db.select<AiHotspotSourceRow[]>(
    'select * from ai_hotspot_sources order by source_name asc',
  )
  return rows.map(mapSourceRow)
}

export async function upsertAiHotspotSourceStatuses(statuses: AiHotspotSourceStatus[]) {
  if (statuses.length === 0) return

  await serializedWrite(async () => {
    const db = await getDb()

    for (const status of statuses) {
      await db.execute(
        `insert into ai_hotspot_sources
          (source_id, source_name, kind, enabled, ok, item_count, duration_ms, last_ok_at, last_error, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict(source_id) do update set
           source_name = excluded.source_name,
           kind = excluded.kind,
           enabled = excluded.enabled,
           ok = excluded.ok,
           item_count = excluded.item_count,
           duration_ms = excluded.duration_ms,
           last_ok_at = excluded.last_ok_at,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
        [
          status.sourceId,
          status.sourceName,
          status.kind,
          Number(status.enabled),
          Number(status.ok),
          status.itemCount,
          status.durationMs,
          status.lastOkAt,
          status.lastError,
          status.updatedAt,
        ],
      )
    }
  })
}

export async function insertAiHotspotSnapshot(snapshot: AiHotspotSnapshot) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into ai_hotspot_snapshots
        (id, started_at, completed_at, raw_count, kept_count, failed_count, status_json)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        snapshot.id,
        snapshot.startedAt,
        snapshot.completedAt,
        snapshot.rawCount,
        snapshot.keptCount,
        snapshot.failedCount,
        stringifyJson(snapshot.status),
      ],
    )
  })
}

export async function getAiHotspotUserFeeds() {
  const db = await getDb()
  const rows = await db.select<AiHotspotUserFeedRow[]>(
    'select * from ai_hotspot_user_feeds order by created_at asc',
  )
  return rows.map(mapFeedRow)
}

export async function addAiHotspotUserFeed(input: AddAiHotspotUserFeedInput) {
  const now = new Date().toISOString()
  const feed: AiHotspotUserFeed = {
    id: input.id || createId('feed'),
    title: input.title.trim(),
    feedUrl: input.feedUrl.trim(),
    groupName: input.groupName?.trim() || null,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into ai_hotspot_user_feeds
        (id, title, feed_url, group_name, enabled, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        feed.id,
        feed.title,
        feed.feedUrl,
        feed.groupName,
        Number(feed.enabled),
        feed.createdAt,
        feed.updatedAt,
      ],
    )
  })

  return feed
}

export async function updateAiHotspotUserFeed(id: string, patch: UpdateAiHotspotUserFeedPatch) {
  const assignments: string[] = []
  const params: unknown[] = []

  if (patch.title !== undefined) {
    params.push(patch.title.trim())
    assignments.push(`title = $${params.length}`)
  }
  if (patch.feedUrl !== undefined) {
    params.push(patch.feedUrl.trim())
    assignments.push(`feed_url = $${params.length}`)
  }
  if (patch.groupName !== undefined) {
    params.push(patch.groupName?.trim() || null)
    assignments.push(`group_name = $${params.length}`)
  }
  if (patch.enabled !== undefined) {
    params.push(Number(patch.enabled))
    assignments.push(`enabled = $${params.length}`)
  }

  if (assignments.length === 0) {
    const db = await getDb()
    const rows = await db.select<AiHotspotUserFeedRow[]>(
      'select * from ai_hotspot_user_feeds where id = $1',
      [id],
    )
    return rows[0] ? mapFeedRow(rows[0]) : null
  }

  params.push(new Date().toISOString())
  assignments.push(`updated_at = $${params.length}`)
  params.push(id)

  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update ai_hotspot_user_feeds
       set ${assignments.join(', ')}
       where id = $${params.length}`,
      params,
    )

    const rows = await db.select<AiHotspotUserFeedRow[]>(
      'select * from ai_hotspot_user_feeds where id = $1',
      [id],
    )
    return rows[0] ? mapFeedRow(rows[0]) : null
  })
}

export async function deleteAiHotspotUserFeed(id: string) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('delete from ai_hotspot_user_feeds where id = $1', [id])
  })
}

export async function setAiHotspotFavorite(id: string, favorite: boolean) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set is_favorite = $1 where id = $2', [Number(favorite), id])
  })
}

export async function setAiHotspotRead(id: string, read: boolean) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set is_read = $1 where id = $2', [Number(read), id])
  })
}

export async function setAiHotspotSavedNotePath(id: string, path: string | null) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set saved_note_path = $1 where id = $2', [path?.trim() || null, id])
  })
}

export async function setAiHotspotIgnored(id: string, ignored: boolean) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set is_ignored = $1 where id = $2', [Number(ignored), id])
  })
}

export async function setAiHotspotDeletedAt(id: string, deletedAt: string | null) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set deleted_at = $1 where id = $2', [deletedAt, id])
  })
}

export async function setAiHotspotDigestStatus(id: string, digestStatus: AiHotspotDigestStatus) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set digest_status = $1 where id = $2', [digestStatus, id])
  })
}

export async function setAiHotspotSnapshotId(id: string, snapshotId: string | null) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update ai_hotspot_items set snapshot_id = $1 where id = $2', [snapshotId, id])
  })
}

export async function setAiHotspotInsight(id: string, patch: Pick<
  AiHotspotItem,
  'signalSummary' | 'signalEssence' | 'impactAudience' | 'suggestedAction' | 'relatedSignalIds'
>) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update ai_hotspot_items
       set signal_summary = $1,
           signal_essence = $2,
           impact_audience_json = $3,
           suggested_action = $4,
           related_signal_ids_json = $5
       where id = $6`,
      [
        patch.signalSummary,
        patch.signalEssence,
        stringifyArray(patch.impactAudience),
        patch.suggestedAction,
        stringifyArray(patch.relatedSignalIds),
        id,
      ],
    )
  })
}

export async function pruneAiHotspotItems(keepAfterIso: string, dailyKeepAfterIso = keepAfterIso) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `delete from ai_hotspot_items
       where is_favorite = 0
         and saved_note_path is null
         and deleted_at is null
         and feed_name <> 'AI HOT 日报'
         and feed_name not like 'AI HOT 日报明细%'
         and coalesce(published_at, last_seen_at) < $1`,
      [keepAfterIso],
    )
    await db.execute(
      `delete from ai_hotspot_items
       where is_favorite = 0
         and saved_note_path is null
         and deleted_at is null
         and (feed_name = 'AI HOT 日报' or feed_name like 'AI HOT 日报明细%')
         and coalesce(published_at, last_seen_at) < $1`,
      [dailyKeepAfterIso],
    )
  })
}

export async function cleanupAiHotspotTrash(deleteBeforeIso: string) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `delete from ai_hotspot_items
       where deleted_at is not null
         and deleted_at < $1`,
      [deleteBeforeIso],
    )
  })
}
