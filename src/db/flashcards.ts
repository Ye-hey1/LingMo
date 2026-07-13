import { getDb, runDbBatch, serializedWrite } from './index'
import type {
  CreateFlashcardInput,
  Flashcard,
  FlashcardDeck,
  FlashcardDeckSummary,
  FlashcardLearningStats,
  FlashcardReview,
  FlashcardReviewRating,
  FlashcardStatus,
} from '@/types/flashcard'
import { applyReviewRating } from '@/lib/flashcard-scheduler'

const DEFAULT_EASE = 2.5
const DEFAULT_INTERVAL = 0
const DEFAULT_DECK_NAME = '默认牌组'
const LEGACY_DEFAULT_DECK_NAMES = new Set([DEFAULT_DECK_NAME])
const SEARCH_HISTORY_LIMIT = 20

function now() {
  return Date.now()
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function normalizeTags(tags?: string[]) {
  if (!tags || tags.length === 0) return null
  return JSON.stringify(uniqueTags(tags))
}

function uniqueTags(tags?: string[] | null) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags || []) {
    const tag = raw.trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

function parseStoredTags(tags?: string | null) {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags) as unknown
    if (Array.isArray(parsed)) return uniqueTags(parsed.map(String))
  } catch {
    return uniqueTags(tags.split(','))
  }
  return []
}

async function syncFlashcardTagIndex(db: Awaited<ReturnType<typeof getDb>>, flashcardId: number, tags?: string[] | string | null) {
  const normalized = Array.isArray(tags) ? uniqueTags(tags) : parseStoredTags(tags)
  await db.execute('delete from flashcard_tag_index where flashcardId = $1', [flashcardId])
  for (const tag of normalized) {
    await db.execute(
      'insert into flashcard_tag_index (flashcardId, tag, normalizedTag) values ($1, $2, $3)',
      [flashcardId, tag, tag.toLowerCase()],
    )
  }
}

async function rebuildFlashcardTagIndex(db: Awaited<ReturnType<typeof getDb>>) {
  const cards = await db.select<Array<{ id: number; tags?: string | null }>>('select id, tags from flashcards')
  await db.execute('delete from flashcard_tag_index')
  for (const card of cards) {
    await syncFlashcardTagIndex(db, card.id, card.tags)
  }
}

export async function initFlashcardDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists flashcard_decks (
      id integer primary key autoincrement,
      name text not null unique,
      description text default null,
      createdAt integer not null,
      updatedAt integer not null
    )
  `)

  await db.execute(`
    create table if not exists flashcards (
      id integer primary key autoincrement,
      deckId integer not null,
      noteId integer default null,
      notePath text default null,
      type text not null,
      front text default null,
      back text default null,
      clozeText text default null,
      tags text default null,
      status text not null,
      ease real not null,
      interval integer not null,
      repetitions integer not null,
      dueAt integer not null,
      lastReviewAt integer default null,
      createdAt integer not null,
      updatedAt integer not null
    )
  `)

  await db.execute(`
    create table if not exists flashcard_reviews (
      id integer primary key autoincrement,
      flashcardId integer not null,
      rating integer not null,
      reviewedAt integer not null,
      prevEase real not null,
      nextEase real not null,
      prevInterval integer not null,
      nextInterval integer not null
    )
  `)

  await db.execute(`
    create index if not exists idx_flashcards_deck_due
    on flashcards(deckId, dueAt)
  `)

  await db.execute(`
    create table if not exists flashcard_tag_index (
      flashcardId integer not null,
      tag text not null,
      normalizedTag text not null,
      primary key (flashcardId, normalizedTag)
    )
  `)

  await db.execute(`
    create index if not exists idx_flashcard_tag_index_tag
    on flashcard_tag_index(normalizedTag)
  `)

  await db.execute(`
    create table if not exists flashcard_search_history (
      id integer primary key autoincrement,
      query text not null,
      filters text default null,
      createdAt integer not null
    )
  `)

  await rebuildFlashcardTagIndex(db)
}

export async function ensureDefaultFlashcardDeck() {
  const decks = await getFlashcardDecks()
  const legacyDefaultDeck = decks.find(deck => LEGACY_DEFAULT_DECK_NAMES.has(deck.name))
  const hasDefaultDeck = decks.some(deck => deck.name === DEFAULT_DECK_NAME)

  if (legacyDefaultDeck && !hasDefaultDeck) {
    const repaired = await updateFlashcardDeck(legacyDefaultDeck.id, {
      name: DEFAULT_DECK_NAME,
      description: legacyDefaultDeck.description,
    })
    if (repaired) return repaired
  }

  if (decks.length > 0) return decks[0]
  return await createFlashcardDeck({ name: DEFAULT_DECK_NAME })
}

export async function createFlashcardDeck(input: { name: string; description?: string }) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      'insert into flashcard_decks (name, description, createdAt, updatedAt) values ($1, $2, $3, $4)',
      [input.name, input.description ?? null, ts, ts],
    )
    const rows = await db.select<FlashcardDeck[]>('select * from flashcard_decks where name = $1 limit 1', [input.name])
    return rows[0]
  })
}

export async function getFlashcardDecks() {
  const db = await getDb()
  return await db.select<FlashcardDeck[]>('select * from flashcard_decks order by createdAt desc')
}

export async function getFlashcardDeckById(deckId: number) {
  const db = await getDb()
  const rows = await db.select<FlashcardDeck[]>('select * from flashcard_decks where id = $1 limit 1', [deckId])
  return rows[0] || null
}

export async function getFlashcardDeckSummaries() {
  const db = await getDb()
  const ts = now()

  return await db.select<FlashcardDeckSummary[]>(
    `select
       d.id,
       d.name,
       d.description,
       d.createdAt,
       d.updatedAt,
       count(f.id) as cardCount,
       coalesce(sum(case when f.status != 'suspended' and f.dueAt <= $1 then 1 else 0 end), 0) as dueCount,
       coalesce(sum(case when f.status = 'review' and f.repetitions > 0 then 1 else 0 end), 0) as masteredCount,
       max(f.lastReviewAt) as lastReviewAt
     from flashcard_decks d
     left join flashcards f on f.deckId = d.id
     group by d.id, d.name, d.description, d.createdAt, d.updatedAt
     order by d.createdAt desc`,
    [ts],
  )
}

export async function updateFlashcardDeck(deckId: number, input: { name: string; description?: string | null }) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      'update flashcard_decks set name = $1, description = $2, updatedAt = $3 where id = $4',
      [input.name, input.description ?? null, ts, deckId],
    )

    const rows = await db.select<FlashcardDeck[]>('select * from flashcard_decks where id = $1 limit 1', [deckId])
    return rows[0] || null
  })
}

export async function createFlashcard(input: CreateFlashcardInput) {
  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    const tags = uniqueTags(input.tags)
    const result = await db.execute(
      `insert into flashcards
        (deckId, noteId, notePath, type, front, back, clozeText, tags, status, ease, interval, repetitions, dueAt, lastReviewAt, createdAt, updatedAt)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.deckId,
        input.noteId ?? null,
        input.notePath ?? null,
        input.type,
        input.front ?? null,
        input.back ?? null,
        input.clozeText ?? null,
        normalizeTags(tags),
        'new',
        DEFAULT_EASE,
        DEFAULT_INTERVAL,
        0,
        ts,
        null,
        ts,
        ts,
      ],
    )
    if (typeof result.lastInsertId === 'number') {
      await syncFlashcardTagIndex(db, result.lastInsertId, tags)
    }
  })
}

export async function createFlashcardsBatch(inputs: CreateFlashcardInput[]) {
  if (inputs.length === 0) return

  await serializedWrite(async () => {
    const db = await getDb()
    try {
      await runDbBatch(db, async () => {
        for (let index = 0; index < inputs.length; index += 1) {
          const input = inputs[index]
          const ts = now()
          const tags = uniqueTags(input.tags)
          const result = await db.execute(
            `insert into flashcards
              (deckId, noteId, notePath, type, front, back, clozeText, tags, status, ease, interval, repetitions, dueAt, lastReviewAt, createdAt, updatedAt)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              input.deckId,
              input.noteId ?? null,
              input.notePath ?? null,
              input.type,
              input.front ?? null,
              input.back ?? null,
              input.clozeText ?? null,
              normalizeTags(tags),
              'new',
              DEFAULT_EASE,
              DEFAULT_INTERVAL,
              0,
              ts,
              null,
              ts,
              ts,
            ],
          )
          if (typeof result.lastInsertId === 'number') {
            await syncFlashcardTagIndex(db, result.lastInsertId, tags)
          }
        }
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : JSON.stringify(error)
      throw new Error(`批量保存闪卡失败：${detail}`)
    }
  })
}

export async function getFlashcardsByDeckId(deckId: number) {
  const db = await getDb()
  return await db.select<Flashcard[]>(
    'select * from flashcards where deckId = $1 order by dueAt asc, createdAt desc',
    [deckId],
  )
}

export async function moveFlashcardToDeck(flashcardId: number, targetDeckId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      'update flashcards set deckId = $1, updatedAt = $2 where id = $3',
      [targetDeckId, ts, flashcardId],
    )
  })
}

export async function deleteFlashcard(flashcardId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('delete from flashcard_tag_index where flashcardId = $1', [flashcardId])
    await db.execute('delete from flashcard_reviews where flashcardId = $1', [flashcardId])
    await db.execute('delete from flashcards where id = $1', [flashcardId])
  })
}

export async function updateFlashcardTags(flashcardId: number, tags: string[]) {
  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    const normalizedTags = uniqueTags(tags)
    await db.execute(
      'update flashcards set tags = $1, updatedAt = $2 where id = $3',
      [normalizeTags(normalizedTags), ts, flashcardId],
    )
    await syncFlashcardTagIndex(db, flashcardId, normalizedTags)
  })
}

export async function updateFlashcardStatus(flashcardId: number, status: FlashcardStatus) {
  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      'update flashcards set status = $1, updatedAt = $2 where id = $3',
      [status, ts, flashcardId],
    )
  })
}

export async function resetFlashcardProgress(flashcardId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      `update flashcards
       set status = $1, ease = $2, interval = $3, repetitions = $4, dueAt = $5, lastReviewAt = $6, updatedAt = $7
       where id = $8`,
      ['new', DEFAULT_EASE, DEFAULT_INTERVAL, 0, ts, null, ts, flashcardId],
    )
  })
}

export interface FlashcardSearchFilters {
  query?: string
  deckId?: number | null
  statuses?: FlashcardStatus[]
  tags?: string[]
  notePath?: string | null
  dueOnly?: boolean
  overdueOnly?: boolean
  importantOnly?: boolean
  weakOnly?: boolean
  limit?: number
  offset?: number
}

export interface FlashcardSearchResult {
  cards: Flashcard[]
  total: number
}

function buildFlashcardSearchWhere(filters: FlashcardSearchFilters) {
  const clauses: string[] = ['1=1']
  const params: unknown[] = []

  if (typeof filters.deckId === 'number') {
    params.push(filters.deckId)
    clauses.push(`f.deckId = $${params.length}`)
  }

  if (filters.statuses && filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(status => {
      params.push(status)
      return `$${params.length}`
    })
    clauses.push(`f.status in (${placeholders.join(',')})`)
  }

  const normalizedTags = uniqueTags(filters.tags).map(tag => tag.toLowerCase())
  for (const tag of normalizedTags) {
    params.push(tag)
    clauses.push(`exists (
      select 1
      from flashcard_tag_index ti
      where ti.flashcardId = f.id and ti.normalizedTag = $${params.length}
    )`)
  }

  if (filters.notePath) {
    params.push(`%${filters.notePath.toLowerCase()}%`)
    clauses.push(`lower(coalesce(f.notePath, '')) like $${params.length}`)
  }

  if (filters.dueOnly) {
    params.push(now())
    clauses.push(`f.status != 'suspended' and f.dueAt <= $${params.length}`)
  }

  if (filters.overdueOnly) {
    params.push(now())
    clauses.push(`f.status != 'suspended' and f.dueAt < $${params.length}`)
  }

  if (filters.importantOnly) {
    clauses.push(`exists (
      select 1
      from flashcard_tag_index important
      where important.flashcardId = f.id and important.normalizedTag = '重点'
    )`)
  }

  if (filters.weakOnly) {
    clauses.push(`(
      f.status = 'learning'
      or (
        select r.rating
        from flashcard_reviews r
        where r.flashcardId = f.id
        order by r.reviewedAt desc
        limit 1
      ) <= 1
    )`)
  }

  const queryTerms = filters.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) || []
  for (const term of queryTerms) {
    params.push(`%${term}%`)
    clauses.push(`(
      lower(coalesce(f.front, '')) like $${params.length}
      or lower(coalesce(f.back, '')) like $${params.length}
      or lower(coalesce(f.clozeText, '')) like $${params.length}
      or lower(coalesce(f.notePath, '')) like $${params.length}
      or lower(coalesce(d.name, '')) like $${params.length}
      or exists (
        select 1
        from flashcard_tag_index tagSearch
        where tagSearch.flashcardId = f.id and lower(tagSearch.tag) like $${params.length}
      )
    )`)
  }

  return { whereSql: clauses.join(' and '), params }
}

export async function searchFlashcards(filters: FlashcardSearchFilters = {}): Promise<FlashcardSearchResult> {
  const db = await getDb()
  const limit = Math.min(200, Math.max(1, Math.floor(filters.limit ?? 80)))
  const offset = Math.max(0, Math.floor(filters.offset ?? 0))
  const { whereSql, params } = buildFlashcardSearchWhere(filters)

  const countRows = await db.select<{ total: number }[]>(
    `select count(*) as total
     from flashcards f
     left join flashcard_decks d on d.id = f.deckId
     where ${whereSql}`,
    params,
  )
  const cards = await db.select<Flashcard[]>(
    `select f.*
     from flashcards f
     left join flashcard_decks d on d.id = f.deckId
     where ${whereSql}
     order by f.updatedAt desc, f.dueAt asc, f.id desc
     limit ${limit} offset ${offset}`,
    params,
  )

  return {
    cards,
    total: Number(countRows[0]?.total || 0),
  }
}

export interface FlashcardTagStat {
  tag: string
  total: number
}

export async function getFlashcardTagStats(limit = 50): Promise<FlashcardTagStat[]> {
  const db = await getDb()
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
  return await db.select<FlashcardTagStat[]>(
    `select tag, count(*) as total
     from flashcard_tag_index
     group by tag
     order by count(*) desc, lower(tag) asc
     limit ${safeLimit}`,
  )
}

export interface FlashcardSearchHistoryItem {
  id: number
  query: string
  filters?: string | null
  createdAt: number
}

export async function getFlashcardSearchHistory(limit = SEARCH_HISTORY_LIMIT) {
  const db = await getDb()
  const safeLimit = Math.min(SEARCH_HISTORY_LIMIT, Math.max(1, Math.floor(limit)))
  return await db.select<FlashcardSearchHistoryItem[]>(
    `select *
     from flashcard_search_history
     order by createdAt desc, id desc
     limit ${safeLimit}`,
  )
}

export async function saveFlashcardSearchHistory(query: string, filters?: Record<string, unknown>) {
  const cleanQuery = query.trim()
  if (!cleanQuery) return

  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    await db.execute(
      'insert into flashcard_search_history (query, filters, createdAt) values ($1, $2, $3)',
      [cleanQuery, filters ? JSON.stringify(filters) : null, ts],
    )
    await db.execute(
      `delete from flashcard_search_history
       where id not in (
         select id
         from flashcard_search_history
         order by createdAt desc, id desc
         limit ${SEARCH_HISTORY_LIMIT}
       )`,
    )
  })
}

export async function addFlashcardTagsBulk(flashcardIds: number[], tags: string[]) {
  const tagList = uniqueTags(tags)
  if (flashcardIds.length === 0 || tagList.length === 0) return

  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    for (const flashcardId of flashcardIds) {
      const rows = await db.select<Array<{ tags?: string | null }>>('select tags from flashcards where id = $1 limit 1', [flashcardId])
      const nextTags = uniqueTags([...parseStoredTags(rows[0]?.tags), ...tagList])
      await db.execute(
        'update flashcards set tags = $1, updatedAt = $2 where id = $3',
        [normalizeTags(nextTags), ts, flashcardId],
      )
      await syncFlashcardTagIndex(db, flashcardId, nextTags)
    }
  })
}

export async function removeFlashcardTagsBulk(flashcardIds: number[], tags: string[]) {
  const removeSet = new Set(uniqueTags(tags).map(tag => tag.toLowerCase()))
  if (flashcardIds.length === 0 || removeSet.size === 0) return

  await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    for (const flashcardId of flashcardIds) {
      const rows = await db.select<Array<{ tags?: string | null }>>('select tags from flashcards where id = $1 limit 1', [flashcardId])
      const nextTags = parseStoredTags(rows[0]?.tags).filter(tag => !removeSet.has(tag.toLowerCase()))
      await db.execute(
        'update flashcards set tags = $1, updatedAt = $2 where id = $3',
        [normalizeTags(nextTags), ts, flashcardId],
      )
      await syncFlashcardTagIndex(db, flashcardId, nextTags)
    }
  })
}

export async function deleteFlashcardDeck(deckId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    const result = await db.select<{ count: number }[]>(
      'select count(*) as count from flashcards where deckId = $1',
      [deckId],
    )

    if (Number(result[0]?.count || 0) > 0) {
      throw new Error('牌组下仍有卡片，无法删除。请先移动或删除卡片。')
    }

    await db.execute('delete from flashcard_decks where id = $1', [deckId])
  })
}

export async function getDueFlashcards(deckId?: number) {
  const db = await getDb()
  const ts = now()
  if (typeof deckId === 'number') {
    return await db.select<Flashcard[]>(
      'select * from flashcards where deckId = $1 and dueAt <= $2 and status != $3 order by dueAt asc, createdAt asc',
      [deckId, ts, 'suspended'],
    )
  }
  return await db.select<Flashcard[]>(
    'select * from flashcards where dueAt <= $1 and status != $2 order by dueAt asc, createdAt asc',
    [ts, 'suspended'],
  )
}

export async function getWeakFlashcards(limit = 50) {
  const db = await getDb()
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))

  return await db.select<Flashcard[]>(
    `select f.*
     from flashcards f
     left join (
       select r.flashcardId, r.rating, r.reviewedAt
       from flashcard_reviews r
       inner join (
         select flashcardId, max(reviewedAt) as latestReviewedAt
         from flashcard_reviews
         group by flashcardId
       ) latest
       on latest.flashcardId = r.flashcardId and latest.latestReviewedAt = r.reviewedAt
     ) latestReview
     on latestReview.flashcardId = f.id
     where f.status != 'suspended'
       and (f.status = 'learning' or latestReview.rating <= 1)
     order by coalesce(latestReview.reviewedAt, f.updatedAt) desc
     limit ${safeLimit}`,
  )
}

export async function getFlashcardLearningStats(): Promise<FlashcardLearningStats> {
  const db = await getDb()
  const todayStart = startOfToday()

  const todayRows = await db.select<{ total: number; mastered: number }[]>(
    `select
       count(*) as total,
       coalesce(sum(case when rating >= 2 then 1 else 0 end), 0) as mastered
     from flashcard_reviews
     where reviewedAt >= $1`,
    [todayStart],
  )

  const weakRows = await db.select<{ total: number }[]>(
    `select count(*) as total
     from flashcards f
     left join (
       select r.flashcardId, r.rating, r.reviewedAt
       from flashcard_reviews r
       inner join (
         select flashcardId, max(reviewedAt) as latestReviewedAt
         from flashcard_reviews
         group by flashcardId
       ) latest
       on latest.flashcardId = r.flashcardId and latest.latestReviewedAt = r.reviewedAt
     ) latestReview
     on latestReview.flashcardId = f.id
     where f.status != 'suspended'
       and (f.status = 'learning' or latestReview.rating <= 1)`,
  )

  const todayReviewedCount = Number(todayRows[0]?.total || 0)
  const todayMasteredCount = Number(todayRows[0]?.mastered || 0)

  return {
    todayReviewedCount,
    todayMasteredCount,
    todayMasteryRate: todayReviewedCount > 0
      ? Math.round((todayMasteredCount / todayReviewedCount) * 100)
      : 0,
    weakCount: Number(weakRows[0]?.total || 0),
  }
}

export async function updateFlashcardReview(flashcardId: number, rating: FlashcardReviewRating) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const current = (await db.select<Flashcard[]>('select * from flashcards where id = $1 limit 1', [flashcardId]))[0]
    if (!current) throw new Error('Flashcard not found')

    const prevEase = current.ease
    const prevInterval = current.interval
    const ts = now()
    const scheduled = applyReviewRating(prevEase, prevInterval, current.repetitions, rating)
    const nextEase = scheduled.ease
    const nextInterval = scheduled.interval
    const repetitions = scheduled.repetitions
    const status = rating <= 1 ? 'learning' : 'review'
    const nextDueAt = scheduled.dueAt

    await db.execute(
      `update flashcards
       set ease = $1, interval = $2, repetitions = $3, dueAt = $4, lastReviewAt = $5, status = $6, updatedAt = $7
       where id = $8`,
      [nextEase, nextInterval, repetitions, nextDueAt, ts, status, ts, flashcardId],
    )

    await db.execute(
      `insert into flashcard_reviews
       (flashcardId, rating, reviewedAt, prevEase, nextEase, prevInterval, nextInterval)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [flashcardId, rating, ts, prevEase, nextEase, prevInterval, nextInterval],
    )

    return { nextEase, nextInterval, nextDueAt }
  })
}

export async function getFlashcardReviews(flashcardId: number) {
  const db = await getDb()
  return await db.select<FlashcardReview[]>(
    'select * from flashcard_reviews where flashcardId = $1 order by reviewedAt desc',
    [flashcardId],
  )
}

export interface DailyReviewStat {
  date: string
  reviewed: number
  mastered: number
  accuracy: number
}

export async function getDailyReviewStats(days: number = 14): Promise<DailyReviewStat[]> {
  const db = await getDb()
  const startDate = Date.now() - days * 24 * 60 * 60 * 1000

  const rows = await db.select<{ day: string; total: number; mastered: number }[]>(
    `select
       date(reviewedAt / 1000, 'unixepoch', 'localtime') as day,
       count(*) as total,
       coalesce(sum(case when rating >= 2 then 1 else 0 end), 0) as mastered
     from flashcard_reviews
     where reviewedAt >= $1
     group by day
     order by day`,
    [startDate],
  )

  return rows.map(row => ({
    date: row.day,
    reviewed: Number(row.total),
    mastered: Number(row.mastered),
    accuracy: Number(row.total) > 0
      ? Math.round((Number(row.mastered) / Number(row.total)) * 100)
      : 0,
  }))
}

export async function getStreakDays(): Promise<number> {
  const db = await getDb()
  const rows = await db.select<{ day: string }[]>(
    `select distinct date(reviewedAt / 1000, 'unixepoch', 'localtime') as day
     from flashcard_reviews
     order by day desc
     limit 365`,
  )

  if (rows.length === 0) return 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  // 连续天数必须从今天或昨天开始算
  const firstDay = rows[0].day
  if (firstDay !== todayStr && firstDay !== yesterdayStr) return 0

  let streak = 1
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].day + 'T00:00:00')
    const curr = new Date(rows[i].day + 'T00:00:00')
    const diff = Math.round((prev.getTime() - curr.getTime()) / (24 * 60 * 60 * 1000))
    if (diff === 1) {
      streak++
    } else {
      break
    }
  }

  return streak
}

export async function getTotalCardStatusCounts(): Promise<Record<FlashcardStatus, number>> {
  const db = await getDb()
  const rows = await db.select<{ status: FlashcardStatus; total: number }[]>(
    'select status, count(*) as total from flashcards group by status',
  )
  const result: Record<FlashcardStatus, number> = { new: 0, learning: 0, review: 0, suspended: 0 }
  for (const row of rows) {
    result[row.status] = Number(row.total)
  }
  return result
}
