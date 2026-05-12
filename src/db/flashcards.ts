import { getDb } from './index'
import type {
  CreateFlashcardInput,
  Flashcard,
  FlashcardDeck,
  FlashcardDeckSummary,
  FlashcardLearningStats,
  FlashcardReview,
  FlashcardReviewRating,
} from '@/types/flashcard'
import { scheduleFlashcardReview } from '@/lib/flashcard-scheduler'

const DEFAULT_EASE = 2.5
const DEFAULT_INTERVAL = 0
const DEFAULT_DECK_NAME = '默认牌组'
const LEGACY_DEFAULT_DECK_NAMES = new Set(['榛樿鐗岀粍'])

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
  return JSON.stringify(tags.map(item => item.trim()).filter(Boolean))
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
  const db = await getDb()
  const ts = now()
  await db.execute(
    'insert into flashcard_decks (name, description, createdAt, updatedAt) values ($1, $2, $3, $4)',
    [input.name, input.description ?? null, ts, ts],
  )
  const rows = await db.select<FlashcardDeck[]>('select * from flashcard_decks where name = $1 limit 1', [input.name])
  return rows[0]
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
  const db = await getDb()
  const ts = now()
  await db.execute(
    'update flashcard_decks set name = $1, description = $2, updatedAt = $3 where id = $4',
    [input.name, input.description ?? null, ts, deckId],
  )

  return await getFlashcardDeckById(deckId)
}

export async function createFlashcard(input: CreateFlashcardInput) {
  const db = await getDb()
  const ts = now()
  await db.execute(
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
      normalizeTags(input.tags),
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
}

export async function createFlashcardsBatch(inputs: CreateFlashcardInput[]) {
  if (inputs.length === 0) return

  for (let index = 0; index < inputs.length; index += 1) {
    try {
      await createFlashcard(inputs[index])
    } catch (error) {
      const detail = error instanceof Error ? error.message : JSON.stringify(error)
      throw new Error(`第 ${index + 1} 张闪卡保存失败：${detail}`)
    }
  }
}

export async function getFlashcardsByDeckId(deckId: number) {
  const db = await getDb()
  return await db.select<Flashcard[]>(
    'select * from flashcards where deckId = $1 order by dueAt asc, createdAt desc',
    [deckId],
  )
}

export async function moveFlashcardToDeck(flashcardId: number, targetDeckId: number) {
  const db = await getDb()
  const ts = now()
  await db.execute(
    'update flashcards set deckId = $1, updatedAt = $2 where id = $3',
    [targetDeckId, ts, flashcardId],
  )
}

export async function deleteFlashcard(flashcardId: number) {
  const db = await getDb()
  await db.execute('delete from flashcard_reviews where flashcardId = $1', [flashcardId])
  await db.execute('delete from flashcards where id = $1', [flashcardId])
}

export async function updateFlashcardTags(flashcardId: number, tags: string[]) {
  const db = await getDb()
  const ts = now()
  await db.execute(
    'update flashcards set tags = $1, updatedAt = $2 where id = $3',
    [normalizeTags(tags), ts, flashcardId],
  )
}

export async function deleteFlashcardDeck(deckId: number) {
  const db = await getDb()
  const result = await db.select<{ count: number }[]>(
    'select count(*) as count from flashcards where deckId = $1',
    [deckId],
  )

  if (Number(result[0]?.count || 0) > 0) {
    throw new Error('牌组下仍有卡片，无法删除。请先移动或删除卡片。')
  }

  await db.execute('delete from flashcard_decks where id = $1', [deckId])
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
  const db = await getDb()
  const current = (await db.select<Flashcard[]>('select * from flashcards where id = $1 limit 1', [flashcardId]))[0]
  if (!current) throw new Error('Flashcard not found')

  const prevEase = current.ease
  const prevInterval = current.interval
  const ts = now()
  const scheduled = scheduleFlashcardReview({
    ease: prevEase,
    interval: prevInterval,
    repetitions: current.repetitions,
    rating,
  })
  const nextEase = scheduled.ease
  const nextInterval = scheduled.interval
  const repetitions = scheduled.repetitions
  const status = rating <= 1 ? 'learning' : 'review'
  const nextDueAt = ts + nextInterval * 24 * 60 * 60 * 1000

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
}

export async function getFlashcardReviews(flashcardId: number) {
  const db = await getDb()
  return await db.select<FlashcardReview[]>(
    'select * from flashcard_reviews where flashcardId = $1 order by reviewedAt desc',
    [flashcardId],
  )
}
