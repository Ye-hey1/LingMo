import { getDb } from "./index"
import { BaseDirectory, exists, mkdir, remove } from "@tauri-apps/plugin-fs"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'

export const TRASH_RETENTION_DAYS = 14

export interface Mark {
  id: number
  tagId: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  content?: string
  desc?: string
  url: string
  deleted: 0 | 1
  deletedAt?: number | null
  createdAt: number
  processed?: 0 | 1
  processedAt?: number | null
  pinned?: 0 | 1
}

const HTTP_URL_PATTERN = /^https?:\/\//i

function isHttpUrl(path?: string): boolean {
  return !!path && HTTP_URL_PATTERN.test(path)
}

function normalizeStoredPath(path: string): string {
  return path.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

function getStoredFileName(path: string): string {
  const normalizedPath = normalizeStoredPath(path)
  const segments = normalizedPath.split('/')

  return segments[segments.length - 1] || ''
}

export function getMarkLocalAssetPath(mark: Pick<Mark, 'type' | 'url'>): string | null {
  if (!mark.url || isHttpUrl(mark.url)) {
    return null
  }

  if (mark.type === 'scan') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `screenshot/${fileName}` : null
  }

  if (mark.type === 'image') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `image/${fileName}` : null
  }

  if (mark.type === 'recording') {
    const relativePath = normalizeStoredPath(mark.url)
    return relativePath || null
  }

  return null
}

async function deleteMarkLocalAsset(mark: Pick<Mark, 'type' | 'url'>) {
  const assetPath = getMarkLocalAssetPath(mark)
  if (!assetPath) {
    return
  }

  const fileExists = await exists(assetPath, { baseDir: BaseDirectory.AppData })
  if (!fileExists) {
    return
  }

  await remove(assetPath, { baseDir: BaseDirectory.AppData })
}

async function deleteMarkLocalAssets(marks: Pick<Mark, 'type' | 'url'>[]) {
  for (const mark of marks) {
    try {
      await deleteMarkLocalAsset(mark)
    } catch (error) {
      console.error('Error deleting mark local asset:', mark.url, error)
    }
  }
}

async function ensureMarksColumn(column: string, definition: string) {
  const db = await getDb()
  const columns = await db.select<Array<{ name: string }>>("pragma table_info(marks)")
  if (!columns.some((item) => item.name === column)) {
    await db.execute(`alter table marks add column ${column} ${definition}`)
  }
}

// 创建 marks 表
export async function initMarksDb() {
  const isExist = await exists('screenshot', { baseDir: BaseDirectory.AppData})
  if (!isExist) {
    await mkdir('screenshot', { baseDir: BaseDirectory.AppData})
  }
  const isImageDirExist = await exists('image', { baseDir: BaseDirectory.AppData })
  if (!isImageDirExist) {
    await mkdir('image', { baseDir: BaseDirectory.AppData })
  }
  const isRecordingDirExist = await exists('recordings', { baseDir: BaseDirectory.AppData })
  if (!isRecordingDirExist) {
    await mkdir('recordings', { baseDir: BaseDirectory.AppData })
  }
  const isTempScreenshotDirExist = await exists('temp_screenshot', { baseDir: BaseDirectory.AppData })
  if (isTempScreenshotDirExist) {
    await remove('temp_screenshot', { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const db = await getDb()
  await db.execute(`
    create table if not exists marks (
      id integer primary key autoincrement,
      tagId integer not null,
      type text not null,
      content text default null,
      url text default null,
      desc text default null,
      deleted integer default 0,
      createdAt integer,
      processed integer default 0,
      processedAt integer default null
    )
  `)
  await ensureMarksColumn('processed', 'integer default 0')
  await ensureMarksColumn('processedAt', 'integer default null')
  await ensureMarksColumn('deletedAt', 'integer default null')
  await ensureMarksColumn('pinned', 'integer default 0')

  // 启动时自动清理超过14天的回收站数据
  await cleanupExpiredTrash()
}

export async function getMarks(id: number) {
  const db = await getDb();
  // 根据 tagId 获取 marks，根据 createdAt 倒序
  return await db.select<Mark[]>("select * from marks where tagId = $1 order by pinned desc, createdAt desc", [id])
}

export async function insertMark(mark: Partial<Mark>) {
  const db = await getDb();
  const createdAt = Date.now();
  const result = await db.execute(
    "insert into marks (tagId, type, content, url, desc, createdAt, deleted, processed, processedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [mark.tagId, mark.type,  mark.content, mark.url, mark.desc, createdAt, 0, mark.processed ?? 0, mark.processedAt ?? null]
  )

  const preview = truncateActivityText(mark.desc || mark.content || mark.url || '', 140)

  await insertActivityEvent({
    source: 'record',
    title: preview || mark.type || 'record',
    description: preview || mark.type || '',
    tagId: mark.tagId ?? null,
    dedupeKey: result.lastInsertId ? `record:${result.lastInsertId}` : `record:${createdAt}:${mark.type || 'record'}`,
    createdAt,
  })

  return result
}

export async function getAllMarks() {
  const db = await getDb();
  return await db.select<Mark[]>("select * from marks order by createdAt desc")
}

export async function updateMark(mark: Mark) {
  const db = await getDb();
  const res = await db.execute(
    "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5, processed = $6, processedAt = $7 where id = $8",
    [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.processed ?? 0, mark.processedAt ?? null, mark.id]
  )
  return res 
}

export async function pinMark(id: number) {
  const db = await getDb();
  return await db.execute("update marks set pinned = 1 where id = $1", [id])
}

export async function unpinMark(id: number) {
  const db = await getDb();
  return await db.execute("update marks set pinned = 0 where id = $1", [id])
}

export async function restoreMark(id: number) {
  const db = await getDb();
  return await db.execute(
    "update marks set deleted = $1, deletedAt = $2 where id = $3",
    [0, null, id]
  )
}

export async function delMark(id: number) {
  const db = await getDb();
  const deletedAt = Date.now();
  return await db.execute(
    "update marks set deleted = $1, deletedAt = $2 where id = $3",
    [1, deletedAt, id]
  )
}

export async function deleteAllMarks() {
  const db = await getDb();
  return await db.execute("delete from marks")
}

export async function insertMarks(marks: Partial<Mark>[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      await db.execute(
        "insert into marks (tagId, type, content, url, desc, createdAt, deleted, processed, processedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted, mark.processed ?? 0, mark.processedAt ?? null]
      );
    }
  } catch (error) {
    console.error('Error inserting marks:', error);
    throw error;
  }
}

export async function delMarkForever(id: number) {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url from marks where id = $1", [id])
  await deleteMarkLocalAssets(marks)
  return await db.execute("delete from marks where id = $1", [id])
}

export async function clearTrash() {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url from marks where deleted = $1", [1])
  await deleteMarkLocalAssets(marks)
  return await db.execute("delete from marks where deleted = $1", [1])
}

export async function updateMarks(marks: Mark[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      await db.execute(
        "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5, processed = $6, processedAt = $7 where id = $8",
        [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.processed ?? 0, mark.processedAt ?? null, mark.id]
      );
    }
  } catch (error) {
    console.error('Error updating marks:', error);
    throw error;
  }
}

export async function updateMarksProcessed(ids: number[], processed: boolean) {
  if (ids.length === 0) {
    return
  }

  const db = await getDb();
  const processedValue = processed ? 1 : 0;
  const processedAt = processed ? Date.now() : null;

  try {
    for (const id of ids) {
      await db.execute(
        "update marks set processed = $1, processedAt = $2 where id = $3",
        [processedValue, processedAt, id]
      );
    }
  } catch (error) {
    console.error('Error updating marks processed state:', error);
    throw error;
  }
}

export async function deleteMarks(ids: number[]) {
  const db = await getDb();
  const deletedAt = Date.now();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, deletedAt = $2 where id = $3",
        [1, deletedAt, id]
      );
    }
  } catch (error) {
    console.error('Error deleting marks:', error);
    throw error;
  }
}

export async function restoreMarks(ids: number[]) {
  const db = await getDb();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, deletedAt = $2 where id = $3",
        [0, null, id]
      );
    }
  } catch (error) {
    console.error('Error restoring marks:', error);
    throw error;
  }
}

/** 清理超过 TRASH_RETENTION_DAYS 天的回收站数据，永久删除并清理本地资产 */
export async function cleanupExpiredTrash() {
  const db = await getDb();
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const expired = await db.select<Mark[]>(
    "select id, type, url from marks where deleted = 1 and deletedAt is not null and deletedAt < $1",
    [cutoff]
  )
  if (expired.length === 0) return
  await deleteMarkLocalAssets(expired)
  await db.execute(
    "delete from marks where deleted = 1 and deletedAt is not null and deletedAt < $1",
    [cutoff]
  )
  console.log(`[Trash] Cleaned up ${expired.length} expired items (older than ${TRASH_RETENTION_DAYS} days)`)
}

export interface DueTodoItem {
  markId: number
  title: string
  dueDate: string
  status: 'overdue' | 'today' | 'upcoming'
}

/** 检查即将到期和已过期的待办，返回需要提醒的列表 */
export async function checkDueTodos(): Promise<DueTodoItem[]> {
  const db = await getDb();
  const todos = await db.select<Mark[]>(
    "select id, content from marks where type = 'todo' and deleted = 0"
  )
  const results: DueTodoItem[] = []
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  for (const todo of todos) {
    try {
      const data = JSON.parse(todo.content || '{}')
      if (!data.dueDate || data.completed) continue
      const title = data.title || '待办事项'

      if (data.dueDate < todayStr) {
        results.push({ markId: todo.id, title, dueDate: data.dueDate, status: 'overdue' })
      } else if (data.dueDate === todayStr) {
        results.push({ markId: todo.id, title, dueDate: data.dueDate, status: 'today' })
      } else {
        // 3天内到期
        const due = new Date(data.dueDate + 'T00:00:00')
        const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000)
        if (diffDays <= 3) {
          results.push({ markId: todo.id, title, dueDate: data.dueDate, status: 'upcoming' })
        }
      }
    } catch {
      // 跳过解析失败的记录
    }
  }

  return results
}
