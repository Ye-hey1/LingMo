import Database from '@tauri-apps/plugin-sql'

const DB_LOCK_RETRY_DELAYS = [80, 160, 320, 640, 1200, 2000, 3000]

type QueryArgs = Parameters<Database['select']>
type ExecuteArgs = Parameters<Database['execute']>

interface DbRuntimeState {
  dbPromise: Promise<Database> | null
  writeQueue: Promise<unknown>
  batchMutexPromise: Promise<void>
}

const globalDbState = globalThis as typeof globalThis & {
  __lingmoDbRuntimeState__?: DbRuntimeState
}

const dbRuntimeState = globalDbState.__lingmoDbRuntimeState__ ??= {
  dbPromise: null,
  writeQueue: Promise.resolve(),
  batchMutexPromise: Promise.resolve(),
}
dbRuntimeState.batchMutexPromise ??= Promise.resolve()

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

/**
 * Runs pooled database work sequentially within this webview.
 * This is not an atomic database transaction: tauri-plugin-sql may use a
 * different pooled connection for every execute/select call.
 */
export async function runDbBatch<T>(
  _db: Database,
  fn: () => Promise<T>,
): Promise<T> {
  let releaseBatch = () => {}
  const currentMutex = new Promise<void>((resolve) => {
    releaseBatch = resolve
  })

  const previousMutex = dbRuntimeState.batchMutexPromise
  dbRuntimeState.batchMutexPromise = currentMutex

  await previousMutex.catch(() => {})

  try {
    return await fn()
  } finally {
    releaseBatch()
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
  const { initCreativeCanvasDb } = await import('./creative-canvas')
  const { initLinkPipelineDb } = await import('./link-pipeline')

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
  await initCreativeCanvasDb()
  await initLinkPipelineDb()
  // KnowledgeObject 是统一索引层，依赖各原表已存在，放最后
  await initKnowledgeObjectsDb()
  await initStructuredKnowledgeDb()
  await initKnowledgeGraphDb()
}
