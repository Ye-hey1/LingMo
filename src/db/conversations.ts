import { getDb, serializedWrite } from './index'

export interface Conversation {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  isPinned: boolean
}

export async function initConversationsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists conversations (
      id integer primary key autoincrement,
      title text not null,
      createdAt integer not null,
      updatedAt integer not null,
      messageCount integer default 0,
      isPinned integer default 0
    )
  `)

  await db.execute(`
    create index if not exists idx_conversations_created on conversations(createdAt desc)
  `)
  await db.execute(`
    create index if not exists idx_conversations_updated on conversations(updatedAt desc)
  `)

  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {}

  await migrateExistingChats()
}

async function migrateExistingChats() {
  await serializedWrite(async () => {
    const db = await getDb()
    const allChats = await db.select<{ createdAt: number }[]>(
      'select createdAt from chats order by createdAt',
      [],
    )

    if (allChats.length === 0) {
      return
    }

    const chatsWithoutConversation = await db.select<{ id: number }[]>(
      'select id from chats where conversationId is null limit 1',
      [],
    )

    if (chatsWithoutConversation.length === 0) {
      return
    }

    const existingConversations = await db.select<Conversation[]>(
      "select * from conversations where title = '历史对话' limit 1",
      [],
    )

    let defaultConversationId: number

    if (existingConversations.length === 0) {
      const firstChat = allChats[0]
      const lastChat = allChats[allChats.length - 1]
      const result = await db.execute(
        'insert into conversations (title, createdAt, updatedAt, messageCount, isPinned) values ($1, $2, $3, $4, $5)',
        ['历史对话', firstChat.createdAt, lastChat.createdAt, allChats.length, 0],
      )
      defaultConversationId = result.lastInsertId as number
    } else {
      defaultConversationId = existingConversations[0].id
    }

    await db.execute(
      'update chats set conversationId = $1 where conversationId is null',
      [defaultConversationId],
    )
  })
}

export async function createConversation(title: string): Promise<number> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const now = Date.now()
    const result = await db.execute(
      'insert into conversations (title, createdAt, updatedAt, messageCount, isPinned) values ($1, $2, $3, $4, $5)',
      [title, now, now, 0, 0],
    )
    return result.lastInsertId as number
  })
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDb()
  return await db.select<Conversation[]>(
    'select * from conversations order by isPinned desc, updatedAt desc',
    [],
  )
}

export async function getConversation(id: number): Promise<Conversation | null> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    'select * from conversations where id = $1',
    [id],
  )
  return result[0] || null
}

export async function updateConversationTitle(id: number, title: string): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update conversations set title = $1, updatedAt = $2 where id = $3',
      [title, Date.now(), id],
    )
  })
}

export async function updateConversationMessageCount(id: number, delta: number): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update conversations set messageCount = messageCount + $1, updatedAt = $2 where id = $3',
      [delta, Date.now(), id],
    )
  })
}

export async function updateConversationTime(id: number): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update conversations set updatedAt = $1 where id = $2',
      [Date.now(), id],
    )
  })
}

export async function deleteConversation(id: number): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'delete from chats where conversationId = $1',
      [id],
    )
    await db.execute(
      'delete from conversations where id = $1',
      [id],
    )
  })
}

export async function toggleConversationPin(id: number): Promise<boolean> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const result = await db.select<Conversation[]>(
      'select * from conversations where id = $1',
      [id],
    )
    const conv = result[0]
    if (!conv) return false

    const newPinState = conv.isPinned ? 0 : 1
    await db.execute(
      'update conversations set isPinned = $1 where id = $2',
      [newPinState, id],
    )
    return !conv.isPinned
  })
}

export async function syncConversationMessageCount(conversationId: number): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    const result = await db.select<{ count: number }[]>(
      'select count(*) as count from chats where conversationId = $1',
      [conversationId],
    )
    const actualCount = result[0]?.count || 0

    await db.execute(
      'update conversations set messageCount = $1 where id = $2',
      [actualCount, conversationId],
    )
  })
}
