import Database from '@tauri-apps/plugin-sql'

let dbPromise: Promise<Database> | null = null
const DB_LOCK_RETRY_DELAYS = [80, 160, 320, 640, 1200, 2000, 3000]

type QueryArgs = Parameters<Database['select']>
type ExecuteArgs = Parameters<Database['execute']>

function isDatabaseLockedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /database is locked|database table is locked|SQLITE_BUSY|code:\s*5/i.test(message)
}

function isTransactionControlSql(sql: unknown) {
  if (typeof sql !== 'string') return false
  return /^(BEGIN|COMMIT|ROLLBACK)(\s|;|$)/i.test(sql.trim())
}

function isTransactionAlreadyActiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /cannot start a transaction within a transaction/i.test(message)
}

function isNoActiveTransactionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /no transaction is active/i.test(message)
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function runWithDatabaseLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= DB_LOCK_RETRY_DELAYS.length; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isDatabaseLockedError(error) || attempt >= DB_LOCK_RETRY_DELAYS.length) {
        throw error
      }
      await sleep(DB_LOCK_RETRY_DELAYS[attempt])
    }
  }

  throw lastError
}

function withDatabaseBusyRetry(db: Database): Database {
  const originalSelect = db.select.bind(db)
  const originalExecute = db.execute.bind(db)

  db.select = ((...args: QueryArgs) => {
    return runWithDatabaseLockRetry(() => originalSelect(...args))
  }) as Database['select']

  db.execute = ((...args: ExecuteArgs) => {
    if (isTransactionControlSql(args[0])) {
      return originalExecute(...args)
    }
    return runWithDatabaseLockRetry(() => originalExecute(...args))
  }) as Database['execute']

  return db
}

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      // 通过连接字符串参数启用 WAL 模式和繁忙超时
      const db = await Database.load('sqlite:note.db?mode=rwc')
      try {
        // 启用 WAL 模式：允许并发读取，减少 database locked 错误
        await db.select('PRAGMA journal_mode=WAL')
        // 设置繁忙超时：遇到锁时等待 5 秒而非立即报错
        await db.execute('PRAGMA busy_timeout=5000')
        // 同步模式设为 NORMAL（WAL 模式下安全且更快）
        await db.execute('PRAGMA synchronous=NORMAL')
      } catch (e) {
        console.warn('[DB] PRAGMA setup failed (non-critical):', e)
      }
      return withDatabaseBusyRetry(db)
    })()
  }

  return await dbPromise
}

/**
 * 串行化数据库写操作，防止并发写入导致 database locked
 */
let writeQueue: Promise<any> = Promise.resolve()

export function serializedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const task = writeQueue.then(
    () => runWithDatabaseLockRetry(fn),
    () => runWithDatabaseLockRetry(fn),
  ) // 即使前一个失败也继续
  writeQueue = task.catch(() => {}) // 防止未处理的 rejection
  return task
}

async function rollbackActiveTransaction(db: Database) {
  try {
    await runWithDatabaseLockRetry(() => db.execute('ROLLBACK'))
  } catch (rollbackError) {
    if (!isNoActiveTransactionError(rollbackError)) {
      console.warn('[DB] rollback failed:', rollbackError)
    }
  }
}

async function beginTransaction(db: Database, beginSql: string) {
  try {
    await runWithDatabaseLockRetry(() => db.execute(beginSql))
  } catch (error) {
    if (!isTransactionAlreadyActiveError(error)) {
      throw error
    }

    console.warn('[DB] stale transaction detected; rolling back before retrying BEGIN')
    await rollbackActiveTransaction(db)
    await runWithDatabaseLockRetry(() => db.execute(beginSql))
  }
}

export async function runDbTransaction<T>(
  db: Database,
  fn: () => Promise<T>,
  beginSql = 'BEGIN IMMEDIATE',
): Promise<T> {
  await beginTransaction(db, beginSql)

  try {
    const result = await fn()
    await runWithDatabaseLockRetry(() => db.execute('COMMIT'))
    return result
  } catch (error) {
    await rollbackActiveTransaction(db)
    throw error
  }
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
