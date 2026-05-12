import { getDb, serializedWrite } from './index'

export interface NoteRelation {
  id: number
  source_note: string
  target_note: string
  relation_type: string // 'extends' | 'references' | 'contradicts' | 'supports' | 'analogous' | 'example_of' | 'related'
  confidence: number
  evidence: string | null
  source_method: string // 'keyword' | 'cosine' | 'llm' | 'cross_validated'
  keyword_overlap_score: number
  cosine_sim_score: number
  llm_confirmed: number
  updated_at: number
}

export interface RelationInput {
  source_note: string
  target_note: string
  relation_type: string
  confidence: number
  evidence?: string
  source_method: string
  keyword_overlap_score?: number
  cosine_sim_score?: number
  llm_confirmed?: number
}

export async function initNoteRelationsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists note_relations (
      id integer primary key autoincrement,
      source_note text not null,
      target_note text not null,
      relation_type text not null default 'related',
      confidence real not null,
      evidence text,
      source_method text not null,
      keyword_overlap_score real default 0,
      cosine_sim_score real default 0,
      llm_confirmed integer default 0,
      updated_at integer not null,
      unique(source_note, target_note, source_method)
    )
  `)

  await db.execute(`
    create index if not exists idx_note_relations_source
    on note_relations(source_note)
  `)

  await db.execute(`
    create index if not exists idx_note_relations_target
    on note_relations(target_note)
  `)

  await db.execute(`
    create index if not exists idx_note_relations_method_confidence
    on note_relations(source_method, confidence desc)
  `)
}

export async function upsertNoteRelation(relation: RelationInput) {
  const db = await getDb()
  const now = Date.now()

  await db.execute(
    `insert into note_relations (source_note, target_note, relation_type, confidence, evidence, source_method, keyword_overlap_score, cosine_sim_score, llm_confirmed, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict(source_note, target_note, source_method)
     do update set relation_type = excluded.relation_type, confidence = excluded.confidence, evidence = excluded.evidence,
       keyword_overlap_score = excluded.keyword_overlap_score, cosine_sim_score = excluded.cosine_sim_score,
       llm_confirmed = excluded.llm_confirmed, updated_at = excluded.updated_at`,
    [
      relation.source_note,
      relation.target_note,
      relation.relation_type,
      relation.confidence,
      relation.evidence || null,
      relation.source_method,
      relation.keyword_overlap_score || 0,
      relation.cosine_sim_score || 0,
      relation.llm_confirmed || 0,
      now,
    ],
  )
}

export async function upsertNoteRelationsBatch(relations: RelationInput[]) {
  if (relations.length === 0) return

  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()

    await db.execute('BEGIN')
    try {
      for (const relation of relations) {
        await db.execute(
          `insert into note_relations (source_note, target_note, relation_type, confidence, evidence, source_method, keyword_overlap_score, cosine_sim_score, llm_confirmed, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict(source_note, target_note, source_method)
         do update set relation_type = excluded.relation_type, confidence = excluded.confidence, evidence = excluded.evidence,
           keyword_overlap_score = excluded.keyword_overlap_score, cosine_sim_score = excluded.cosine_sim_score,
           llm_confirmed = excluded.llm_confirmed, updated_at = excluded.updated_at`,
          [
            relation.source_note,
            relation.target_note,
            relation.relation_type,
            relation.confidence,
            relation.evidence || null,
            relation.source_method,
            relation.keyword_overlap_score || 0,
            relation.cosine_sim_score || 0,
            relation.llm_confirmed || 0,
            now,
          ],
        )
      }
      await db.execute('COMMIT')
    } catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  })
}

export async function getRelationsForNote(filename: string): Promise<NoteRelation[]> {
  const db = await getDb()
  return await db.select<NoteRelation[]>(
    'select * from note_relations where source_note = $1 or target_note = $1 order by confidence desc',
    [filename],
  )
}

export async function getRelationsBetween(
  noteA: string,
  noteB: string,
): Promise<NoteRelation[]> {
  const db = await getDb()
  return await db.select<NoteRelation[]>(
    `select * from note_relations
     where (source_note = $1 and target_note = $2)
        or (source_note = $2 and target_note = $1)`,
    [noteA, noteB],
  )
}

export async function getAllRelations(method?: string): Promise<NoteRelation[]> {
  const db = await getDb()
  if (method) {
    return await db.select<NoteRelation[]>(
      'select * from note_relations where source_method = $1 order by confidence desc',
      [method],
    )
  }
  return await db.select<NoteRelation[]>(
    'select * from note_relations order by confidence desc',
  )
}

export async function deleteRelationsForNote(filename: string) {
  const db = await getDb()
  await db.execute(
    'delete from note_relations where source_note = $1 or target_note = $1',
    [filename],
  )
}

export async function deleteRelationsByMethod(method: string) {
  const db = await getDb()
  await db.execute(
    'delete from note_relations where source_method = $1',
    [method],
  )
}

export async function getRelationCount(): Promise<{ method: string; count: number }[]> {
  const db = await getDb()
  return await db.select<{ method: string; count: number }[]>(
    'select source_method as method, count(*) as count from note_relations group by source_method',
  )
}
