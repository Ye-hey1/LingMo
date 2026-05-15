import { getDb, serializedWrite } from './index'

export interface NoteTopic {
  id: number
  filename: string
  keyword: string
  weight: number
  source: string // 'textrank' | 'llm'
  updated_at: number
}

export interface TopicInput {
  keyword: string
  weight: number
}

export async function initNoteTopicsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists note_topics (
      id integer primary key autoincrement,
      filename text not null,
      keyword text not null,
      weight real not null,
      source text not null default 'textrank',
      updated_at integer not null,
      unique(filename, keyword, source)
    )
  `)

  await db.execute(`
    create index if not exists idx_note_topics_filename
    on note_topics(filename)
  `)

  await db.execute(`
    create index if not exists idx_note_topics_keyword_weight
    on note_topics(keyword, weight desc)
  `)
}

export async function upsertNoteTopics(
  filename: string,
  topics: TopicInput[],
  source: string = 'textrank',
) {
  return serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()

    // 先删除该文件该来源的旧记录
    await db.execute(
      'delete from note_topics where filename = $1 and source = $2',
      [filename, source],
    )

    // 批量插入新记录
    if (topics.length === 0) return

    await db.execute('BEGIN')
    try {
      for (const topic of topics) {
        await db.execute(
          'insert into note_topics (filename, keyword, weight, source, updated_at) values ($1, $2, $3, $4, $5)',
          [filename, topic.keyword, topic.weight, source, now],
        )
      }
      await db.execute('COMMIT')
    } catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  })
}

export async function getTopicsForNote(filename: string): Promise<NoteTopic[]> {
  const db = await getDb()
  return await db.select<NoteTopic[]>(
    'select * from note_topics where filename = $1 order by weight desc',
    [filename],
  )
}

export async function getNotesByKeyword(
  keyword: string,
  limit = 50,
): Promise<NoteTopic[]> {
  const db = await getDb()
  return await db.select<NoteTopic[]>(
    'select * from note_topics where keyword = $1 order by weight desc limit $2',
    [keyword, limit],
  )
}

export async function getAllTopics(): Promise<NoteTopic[]> {
  const db = await getDb()
  return await db.select<NoteTopic[]>(
    'select * from note_topics order by filename, weight desc',
  )
}

export async function deleteTopicsForNote(filename: string) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'delete from note_topics where filename = $1',
      [filename],
    )
  })
}

export async function getAllTopicFilenames(): Promise<{ filename: string }[]> {
  const db = await getDb()
  return await db.select<{ filename: string }[]>(
    'select distinct filename from note_topics',
  )
}
