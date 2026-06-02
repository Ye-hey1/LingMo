import { getDb, serializedWrite } from './index'

export interface NoteHistory {
  id: number
  notePath: string
  content: string
  createdAt: number
}

/**
 * 初始化本地历史 SQLite 数据库表
 */
export async function initNoteHistoryDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists note_history (
      id integer primary key autoincrement,
      notePath text not null,
      content text not null,
      createdAt integer not null
    )
  `)
}

/**
 * 插入一份新的笔记历史快照版本，并限制单个笔记的版本上限为 50 条
 */
export async function insertNoteHistory(notePath: string, content: string) {
  const createdAt = Date.now()
  
  // 如果内容为空或者与最新历史版本完全相同，则跳过保存
  try {
    const latest = await getLatestNoteHistory(notePath)
    if (latest && latest.content.trim() === content.trim()) {
      return
    }
  } catch {
    // 捕获异常
  }

  return await serializedWrite(async () => {
    const db = await getDb()
    
    // 1. 写入新的快照
    await db.execute(
      'insert into note_history (notePath, content, createdAt) values ($1, $2, $3)',
      [notePath, content, createdAt]
    )

    // 2. 清理多于 50 条的古老历史版本快照，避免数据库无节制膨胀
    await db.execute(`
      delete from note_history 
      where notePath = $1 
      and id not in (
        select id from note_history 
        where notePath = $1 
        order by createdAt desc 
        limit 50
      )
    `, [notePath])
  })
}

/**
 * 获取最新的一份历史版本快照
 */
export async function getLatestNoteHistory(notePath: string) {
  const db = await getDb()
  const list = await db.select<NoteHistory[]>(
    'select * from note_history where notePath = $1 order by createdAt desc limit 1',
    [notePath]
  )
  return list[0] || null
}

/**
 * 依据 notePath 获取某个笔记的所有历史快照（按时间倒序排列）
 */
export async function getNoteHistoriesByNotePath(notePath: string) {
  const db = await getDb()
  return await db.select<NoteHistory[]>(
    'select * from note_history where notePath = $1 order by createdAt desc',
    [notePath]
  )
}

/**
 * 根据 ID 获取特定快照的完整旧内容
 */
export async function getNoteHistoryById(id: number) {
  const db = await getDb()
  return (await db.select<NoteHistory[]>('select * from note_history where id = $1', [id]))[0]
}
