import { getDb } from './index'

export type AiUsageRole = 'request' | 'tool'

export interface AiUsageEvent {
  id: number
  platform: string
  provider: string
  model: string
  modelType?: string | null
  storeKey?: string | null
  cwd?: string | null
  sessionId?: string | null
  conversationId?: number | null
  role: AiUsageRole
  messageCount: number
  tokenEstimate: number
  toolName?: string | null
  toolCallCount: number
  success: number
  errorKind?: string | null
  latencyMs?: number | null
  createdAt: number
}

export interface InsertAiUsageEventInput {
  platform?: string
  provider?: string
  model?: string
  modelType?: string | null
  storeKey?: string | null
  cwd?: string | null
  sessionId?: string | null
  conversationId?: number | null
  role?: AiUsageRole
  messageCount?: number
  tokenEstimate?: number
  toolName?: string | null
  toolCallCount?: number
  success?: boolean
  errorKind?: string | null
  latencyMs?: number | null
  createdAt?: number
}

export async function initAiUsageDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists ai_usage_events (
      id integer primary key autoincrement,
      platform text not null,
      provider text not null,
      model text not null,
      modelType text default null,
      storeKey text default null,
      cwd text default null,
      sessionId text default null,
      conversationId integer default null,
      role text not null,
      messageCount integer not null default 0,
      tokenEstimate integer not null default 0,
      toolName text default null,
      toolCallCount integer not null default 0,
      success integer not null default 1,
      errorKind text default null,
      latencyMs integer default null,
      createdAt integer not null
    )
  `)

  await db.execute(`
    create index if not exists idx_ai_usage_events_created_at
    on ai_usage_events(createdAt desc)
  `)

  await db.execute(`
    create index if not exists idx_ai_usage_events_platform_created_at
    on ai_usage_events(platform, createdAt desc)
  `)

  await db.execute(`
    create index if not exists idx_ai_usage_events_provider_model_created_at
    on ai_usage_events(provider, model, createdAt desc)
  `)
}

export async function insertAiUsageEvent(event: InsertAiUsageEventInput) {
  const db = await getDb()
  const createdAt = event.createdAt ?? Date.now()

  return await db.execute(
    `insert into ai_usage_events
      (platform, provider, model, modelType, storeKey, cwd, sessionId, conversationId,
       role, messageCount, tokenEstimate, toolName, toolCallCount, success, errorKind, latencyMs, createdAt)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      event.platform || 'lingmo',
      event.provider || 'unknown',
      event.model || '',
      event.modelType ?? null,
      event.storeKey ?? null,
      event.cwd ?? null,
      event.sessionId ?? null,
      event.conversationId ?? null,
      event.role || 'request',
      event.messageCount ?? 0,
      event.tokenEstimate ?? 0,
      event.toolName ?? null,
      event.toolCallCount ?? 0,
      event.success === false ? 0 : 1,
      event.errorKind ?? null,
      event.latencyMs ?? null,
      createdAt,
    ]
  )
}

export async function getAllAiUsageEvents() {
  const db = await getDb()

  return await db.select<AiUsageEvent[]>(`
    select id, platform, provider, model, modelType, storeKey, cwd, sessionId, conversationId,
      role, messageCount, tokenEstimate, toolName, toolCallCount, success, errorKind, latencyMs, createdAt
    from ai_usage_events
    order by createdAt desc
  `)
}
