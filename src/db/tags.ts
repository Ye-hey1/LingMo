import { getDb, serializedWrite } from './index'
import { Store } from '@tauri-apps/plugin-store'

export const TAG_COLORS = [
  '#6B7280', '#EF4444', '#F97316', '#F59E0B', '#84CC16',
  '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E',
] as const

export interface Tag {
  id: number
  name: string
  color?: string | null
  isLocked?: boolean
  isPin?: boolean
  sortOrder?: number
  total?: number
  parentId?: number | null
}

interface OrphanTagRow {
  tagId: number
  total: number
}

interface CountRow {
  total: number
}

interface MaxSortRow {
  maxSort: number | null
}

async function repairOrphanMarkTags() {
  const db = await getDb()
  const orphanRows = await db.select<OrphanTagRow[]>(
    `select m.tagId as tagId, count(*) as total
     from marks m
     left join tags t on t.id = m.tagId
     where m.tagId is not null and t.id is null
     group by m.tagId
     order by m.tagId asc`,
  )

  if (orphanRows.length === 0) {
    return
  }

  const maxSortRows = await db.select<MaxSortRow[]>('select max(sortOrder) as maxSort from tags')
  let nextSortOrder = (maxSortRows[0]?.maxSort ?? -1) + 1

  for (const orphan of orphanRows) {
    const baseName = orphan.tagId === 1 ? '中转站' : `恢复标签 ${orphan.tagId}`
    let recoveredName = baseName

    const duplicatedName = await db.select<Tag[]>('select id from tags where name = $1 limit 1', [recoveredName])
    if (duplicatedName.length > 0) {
      recoveredName = `${baseName} (${orphan.tagId})`
    }

    await db.execute(
      'insert into tags (id, name, isLocked, isPin, sortOrder, parentId) values ($1, $2, $3, $4, $5, $6)',
      [orphan.tagId, recoveredName, false, false, nextSortOrder, null],
    )
    nextSortOrder += 1
  }
}

export async function initTagsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists tags (
      id integer primary key autoincrement,
      name text not null,
      isLocked boolean DEFAULT false,
      isPin boolean DEFAULT false,
      sortOrder integer DEFAULT 0
    )
  `)

  try {
    await db.execute('select sortOrder from tags limit 1')
  } catch {
    await db.execute('alter table tags add column sortOrder integer DEFAULT 0')

    const existingTags = await db.select<Tag[]>('select id from tags order by id asc')
    for (let i = 0; i < existingTags.length; i++) {
      await db.execute('update tags set sortOrder = $1 where id = $2', [i, existingTags[i].id])
    }
  }

  try {
    await db.execute('select parentId from tags limit 1')
  } catch {
    await db.execute('alter table tags add column parentId integer DEFAULT null')
  }

  try {
    await db.execute('select color from tags limit 1')
  } catch {
    await db.execute('alter table tags add column color text DEFAULT null')
  }

  await db.execute('update tags set isLocked = false where name = $1 and isLocked = true', ['Idea'])
  await repairOrphanMarkTags()

  const hasDefaultTag = (await db.select<Tag[]>('select * from tags')).length === 0
  if (hasDefaultTag) {
    await db.execute(
      'insert into tags (name, isLocked, isPin) values ($1, $2, $3)',
      ['Idea', false, true],
    )
    const tag = (await db.select<Tag[]>('select * from tags where name = $1', ['Idea']))[0]
    const store = await Store.load('store.json')
    await store.set('currentTagId', tag.id)
    await store.save()
  }
}

export async function getTags() {
  const db = await getDb()
  const tags = await db.select<Tag[]>('select * from tags order by sortOrder asc, id asc')

  for (const tag of tags) {
    const res = await db.select<{ total: number }[]>(
      'select count(*) as total from marks where tagId = $1 and deleted = $2',
      [tag.id, 0],
    )
    tag.total = res[0].total
  }

  return tags
}

export async function insertTag(tag: Partial<Tag>) {
  return await serializedWrite(async () => {
    const db = await getDb()
    return await db.execute(
      'insert into tags (name, parentId) values ($1, $2)',
      [tag.name, tag.parentId ?? null],
    )
  })
}

export async function updateTag(tag: Tag) {
  return await serializedWrite(async () => {
    const db = await getDb()
    return await db.execute(
      'update tags set name = $1, isLocked = $2, isPin = $3, sortOrder = $4, parentId = $5, color = $6 where id = $7',
      [tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.parentId ?? null, tag.color ?? null, tag.id],
    )
  })
}

export async function updateTagColor(id: number, color: string | null) {
  return await serializedWrite(async () => {
    const db = await getDb()
    return await db.execute('update tags set color = $1 where id = $2', [color, id])
  })
}

export async function delTag(id: number) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const usedRows = await db.select<CountRow[]>('select count(*) as total from marks where tagId = $1', [id])
    const usedCount = usedRows[0]?.total || 0

    if (usedCount > 0) {
      let fallbackTagId: number | undefined
      const fallbackTags = await db.select<Tag[]>(
        'select id from tags where id <> $1 order by sortOrder asc, id asc limit 1',
        [id],
      )
      fallbackTagId = fallbackTags[0]?.id

      if (!fallbackTagId) {
        const maxSortRows = await db.select<MaxSortRow[]>('select max(sortOrder) as maxSort from tags')
        const nextSortOrder = (maxSortRows[0]?.maxSort ?? -1) + 1
        const createResult = await db.execute(
          'insert into tags (name, isLocked, isPin, sortOrder, parentId) values ($1, $2, $3, $4, $5)',
          ['中转站', false, false, nextSortOrder, null],
        )
        fallbackTagId = Number(createResult.lastInsertId)
      }

      if (fallbackTagId) {
        await db.execute('update marks set tagId = $1 where tagId = $2', [fallbackTagId, id])
      }
    }

    return await db.execute('delete from tags where id = $1', [id])
  })
}

export async function deleteAllTags() {
  return await serializedWrite(async () => {
    const db = await getDb()
    return await db.execute('delete from tags where isLocked = false')
  })
}

export async function insertTags(tags: Tag[]) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('BEGIN TRANSACTION')
    try {
      for (const tag of tags) {
        if (tag.isLocked) continue
        const exists = await db.select<Tag[]>('select * from tags where id = $1', [tag.id])
        if (exists.length > 0) {
          await db.execute(
            'update tags set name = $1, isLocked = $2, isPin = $3, sortOrder = $4, parentId = $5, color = $6 where id = $7',
            [tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.parentId ?? null, tag.color ?? null, tag.id],
          )
        } else {
          await db.execute(
            'insert into tags (id, name, isLocked, isPin, sortOrder, parentId, color) values ($1, $2, $3, $4, $5, $6, $7)',
            [tag.id, tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.parentId ?? null, tag.color ?? null],
          )
        }
      }
      await db.execute('COMMIT')
    } catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  })
  return true
}

export async function updateTagsOrder(tags: { id: number; sortOrder: number }[]) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('BEGIN TRANSACTION')
    try {
      for (const tag of tags) {
        await db.execute(
          'update tags set sortOrder = $1 where id = $2',
          [tag.sortOrder, tag.id],
        )
      }
      await db.execute('COMMIT')
    } catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  })
  return true
}
