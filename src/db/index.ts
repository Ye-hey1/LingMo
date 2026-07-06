import Database from '@tauri-apps/plugin-sql'

const DB_LOCK_RETRY_DELAYS = [80, 160, 320, 640, 1200, 2000, 3000]

type QueryArgs = Parameters<Database['select']>
type ExecuteArgs = Parameters<Database['execute']>

interface DbRuntimeState {
  dbPromise: Promise<Database> | null
  writeQueue: Promise<unknown>
  transactionMutexPromise: Promise<void>
}

const globalDbState = globalThis as typeof globalThis & {
  __lingmoDbRuntimeState__?: DbRuntimeState
}

const dbRuntimeState = globalDbState.__lingmoDbRuntimeState__ ??= {
  dbPromise: null,
  writeQueue: Promise.resolve(),
  transactionMutexPromise: Promise.resolve(),
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>
    for (const key of ['message', 'error', 'details']) {
      const value = errorRecord[key]
      if (typeof value === 'string') return value
    }

    try {
      return JSON.stringify(error)
    } catch {
      // fall through to String()
    }
  }

  return String(error)
}

function isDatabaseLockedError(error: unknown) {
  const message = getErrorMessage(error)
  return /database is locked|database table is locked|SQLITE_BUSY|code:\s*5/i.test(message)
}

function isTransactionControlSql(sql: unknown) {
  if (typeof sql !== 'string') return false
  return /^(BEGIN|COMMIT|ROLLBACK)(\s|;|$)/i.test(sql.trim())
}

function isTransactionAlreadyActiveError(error: unknown) {
  const message = getErrorMessage(error)
  return /cannot start a transaction within a transaction/i.test(message)
}

function isNoActiveTransactionError(error: unknown) {
  const message = getErrorMessage(error)
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
  if (!dbRuntimeState.dbPromise) {
    dbRuntimeState.dbPromise = (async () => {
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

  return await dbRuntimeState.dbPromise
}

/**
 * 串行化数据库写操作，防止并发写入导致 database locked
 */
export function serializedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const task = dbRuntimeState.writeQueue.then(
    () => runWithDatabaseLockRetry(fn),
    () => runWithDatabaseLockRetry(fn),
  ) // 即使前一个失败也继续
  dbRuntimeState.writeQueue = task.catch(() => {}) // 防止未处理的 rejection
  return task
}

async function rollbackActiveTransaction(db: Database) {
  try {
    await runWithDatabaseLockRetry(() => db.execute('ROLLBACK'))
  } catch (rollbackError) {
    if (!isNoActiveTransactionError(rollbackError)) {
      console.error('[DB] rollback critical failure:', rollbackError)
      throw rollbackError
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
  let releaseTransaction = () => {}
  const currentMutex = new Promise<void>((resolve) => {
    releaseTransaction = resolve
  })

  const previousMutex = dbRuntimeState.transactionMutexPromise
  dbRuntimeState.transactionMutexPromise = currentMutex

  await previousMutex.catch(() => {})

  let transactionStarted = false

  try {
    await beginTransaction(db, beginSql)
    transactionStarted = true

    const result = await fn()
    await runWithDatabaseLockRetry(() => db.execute('COMMIT'))
    transactionStarted = false
    return result
  } catch (error) {
    if (transactionStarted) {
      await rollbackActiveTransaction(db)
    }
    throw error
  } finally {
    releaseTransaction()
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
  const { initNoteIntelligenceDb } = await import('./note-intelligence')
  const { initGithubStarsDb } = await import('./github-stars')
  const { initAiHotspotsDb } = await import('./ai-hotspots')
  const { initNoteHistoryDb } = await import('./history')
  const { initAgentDb } = await import('./agent')
  const { initKnowledgeObjectsDb } = await import('./knowledge-objects')
  const { initStructuredKnowledgeDb } = await import('./structured-knowledge')
  const { initKnowledgeGraphDb } = await import('./knowledge-graph')

  // 先确保基础表存在，再做依赖这些表的初始化。
  await initChatsDb()
  await initConversationsDb()
  await initMarksDb()
  await initNotesDb()
  await initNoteHistoryDb()
  await initTagsDb()
  await initVectorDb()
  await initMemoriesDb()
  await initActivityDb()
  await initAiUsageDb()
  await initFlashcardDb()
  await initNoteTopicsDb()
  await initNoteRelationsDb()
  await initNoteIntelligenceDb()
  await initGithubStarsDb()
  await initAiHotspotsDb()
  await initAgentDb()
  // KnowledgeObject 是统一索引层，依赖各原表已存在，放最后
  await initKnowledgeObjectsDb()
  await initStructuredKnowledgeDb()
  await initKnowledgeGraphDb()
}
