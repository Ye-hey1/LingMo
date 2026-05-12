import Database from '@tauri-apps/plugin-sql'

let dbPromise: Promise<Database> | null = null
let dbReady = false

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      // 通过连接字符串参数启用 WAL 模式和繁忙超时
      const db = await Database.load('sqlite:note.db?mode=rwc')
      try {
        // 启用 WAL 模式：允许并发读取，减少 database locked 错误
        await db.execute('PRAGMA journal_mode=WAL')
        // 设置繁忙超时：遇到锁时等待 5 秒而非立即报错
        await db.execute('PRAGMA busy_timeout=5000')
        // 同步模式设为 NORMAL（WAL 模式下安全且更快）
        await db.execute('PRAGMA synchronous=NORMAL')
      } catch (e) {
        console.warn('[DB] PRAGMA setup failed (non-critical):', e)
      }
      dbReady = true
      return db
    })()
  }

  return await dbPromise
}

/**
 * 串行化数据库写操作，防止并发写入导致 database locked
 */
let writeQueue: Promise<any> = Promise.resolve()

export function serializedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const task = writeQueue.then(fn, fn) // 即使前一个失败也继续
  writeQueue = task.catch(() => {}) // 防止未处理的 rejection
  return task
}

// 初始化所有数据库
export async function initAllDatabases() {
  const { initChatsDb } = await import('./chats')
  const { initMarksDb } = await import('./marks')
  const { initNotesDb } = await import('./notes')
  const { initTagsDb } = await import('./tags')
  const { initVectorDb } = await import('./vector')
  const { initConversationsDb } = await import('./conversations')
  const { initMemoriesDb } = await import('./memories')
  const { initActivityDb } = await import('./activity')
  const { initAiUsageDb } = await import('./ai-usage')
  const { initFlashcardDb } = await import('./flashcards')
  const { initNoteTopicsDb } = await import('./note-topics')
  const { initNoteRelationsDb } = await import('./note-relations')

  // 先确保基础表存在，再做依赖这些表的初始化。
  await initChatsDb()
  await initConversationsDb()
  await initMarksDb()
  await initNotesDb()
  await initTagsDb()
  await initVectorDb()
  await initMemoriesDb()
  await initActivityDb()
  await initAiUsageDb()
  await initFlashcardDb()
  await initNoteTopicsDb()
  await initNoteRelationsDb()
}
