import { endOfWeek, format, startOfWeek, subWeeks } from 'date-fns'
import { Store } from '@tauri-apps/plugin-store'

import { getAllActivityEvents } from '@/db/activity'
import { getAllAiUsageEvents, type AiUsageEvent } from '@/db/ai-usage'
import { getAllChats, type Chat } from '@/db/chats'
import { getAllMemories, type Memory } from '@/db/memories'
import { getAllMarks, type Mark } from '@/db/marks'
import { getTags, type Tag } from '@/db/tags'
import { getLlmMemorySessionDetail, listLlmMemorySessions, type LlmMemoryPathOverrides, type LlmMemoryPlatform, type LlmMemorySessionListItem } from '@/lib/llm-memory/api'
import { buildActivityHeatmap, summarizeActivityEntries } from './aggregate'
import type { ActivityAiInteractionDayStat, ActivityAiInteractionPlatformStat, ActivityCalendarData, ActivityDaySummary, ActivityEntry, ActivityErrorStat, ActivityHeatmapWeek, ActivityInsights, ActivityMemoryStat, ActivityModelStat, ActivityPlatformStat, ActivityProjectStat } from './types'

const LLM_PLATFORMS: LlmMemoryPlatform[] = ['codex', 'claude', 'opencode', 'lingmo']
const EXTERNAL_AI_INTERACTION_PLATFORMS: LlmMemoryPlatform[] = ['codex', 'claude', 'opencode']
const LLM_MEMORY_PATH_OVERRIDES_KEY = 'llmMemoryPathOverrides'
const ACTIVITY_CACHE_STORE_PATH = 'store.json'
const ACTIVITY_CACHE_STORE_KEY_PREFIX = 'activityCalendarCache'

interface LoadActivityCalendarDataOptions {
  includeExternalAiDetails?: boolean
  force?: boolean
}

interface ActivityCalendarCacheEntry {
  expiresAt: number
  data: ActivityCalendarData
}

const ACTIVITY_CALENDAR_CACHE_TTL_MS = 15_000
const activityCalendarCache = new Map<string, ActivityCalendarCacheEntry>()
const activityCalendarInflight = new Map<string, Promise<ActivityCalendarData>>()
let activityStorePromise: Promise<Store> | null = null

function getActivityCacheKey(includeExternalAiDetails: boolean) {
  return includeExternalAiDetails ? 'full' : 'fast'
}

function getActivityStoreKey(cacheKey: string) {
  return `${ACTIVITY_CACHE_STORE_KEY_PREFIX}:${cacheKey}`
}

async function getActivityStore() {
  if (!activityStorePromise) {
    activityStorePromise = Store.load(ACTIVITY_CACHE_STORE_PATH)
  }

  return await activityStorePromise
}

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function getDefaultRange() {
  const today = new Date()
  const startDate = startOfWeek(subWeeks(today, 25), { weekStartsOn: 0 })
  const endDate = endOfWeek(today, { weekStartsOn: 0 })

  return {
    startDate: format(startDate, 'yyyy-MM-dd'),
    endDate: format(endDate, 'yyyy-MM-dd'),
  }
}

function buildActivityEntries(
  events: Awaited<ReturnType<typeof getAllActivityEvents>>,
  marks: Mark[],
  chats: Chat[],
  tags: Tag[],
  memories: Memory[],
  platformSessions: LlmMemorySessionListItem[]
): ActivityEntry[] {
  const tagNameMap = new Map(tags.map((tag) => [tag.id, tag.name]))

  const writingEntries: ActivityEntry[] = events
    .filter((event) => event.source === 'writing')
    .map(event => ({
    id: `${event.source}-${event.id}`,
    source: event.source,
    timestamp: event.createdAt,
    title: event.title,
    description: event.description ?? undefined,
    path: event.path ?? undefined,
    tagId: event.tagId ?? undefined,
    meta: event.tagId ? { tagName: tagNameMap.get(event.tagId) || undefined } : undefined,
  }))

  const recordEntries: ActivityEntry[] = marks
    .filter((mark) => mark.deleted !== 1)
    .map((mark) => {
      const preview = normalizeActivityText(mark.desc || mark.content || mark.url)
      return {
        id: `record-${mark.id}`,
        source: 'record' as const,
        timestamp: mark.createdAt,
        title: preview || mark.type,
        description: preview || mark.type,
        tagId: mark.tagId,
        meta: {
          markId: mark.id,
          recordType: mark.type,
          processed: mark.processed === 1,
          processedAt: mark.processedAt ?? undefined,
          tagName: tagNameMap.get(mark.tagId) || undefined,
        },
      }
    })

  const chatEntries: ActivityEntry[] = chats
    .filter((chat) => chat.role === 'user' && normalizeActivityText(chat.content))
    .map((chat) => {
      const preview = normalizeActivityText(chat.content)
      return {
        id: `chat-${chat.id}`,
        source: 'chat' as const,
        timestamp: chat.createdAt,
        title: preview.slice(0, 64),
        description: preview,
        tagId: chat.tagId ?? undefined,
        meta: {
          chatId: chat.id,
          conversationId: chat.conversationId ?? undefined,
          chatType: chat.type,
          tagName: chat.tagId ? tagNameMap.get(chat.tagId) || undefined : undefined,
        },
      }
    })

  return [
    ...writingEntries,
    ...recordEntries,
    ...chatEntries,
    ...platformSessions.flatMap(mapPlatformSessionToActivityEntry),
    ...memories.flatMap(mapMemoryToActivityEntries),
  ].sort((a, b) => b.timestamp - a.timestamp)
}

function mapPlatformSessionToActivityEntry(session: LlmMemorySessionListItem): ActivityEntry[] {
  const timestamp = parseTimestamp(session.updatedAt)
  if (!timestamp) return []
  const platformName = platformLabel(session.platform)

  return [{
    id: `ai-session-${session.platform}-${session.sessionKey}`,
    source: 'ai',
    timestamp,
    title: `${platformName} 会话`,
    description: getSessionActivityText(session, platformName),
    path: session.cwd || undefined,
    meta: {
      platform: session.platform,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      event: 'session-updated',
    },
  }]
}

function getSessionActivityText(session: LlmMemorySessionListItem, platformName: string) {
  const preview = normalizeActivityText(session.preview)
  if (preview && !isOpaqueSessionText(preview, session)) return preview

  const title = normalizeActivityText(session.title)
  if (title && !isOpaqueSessionText(title, session)) return title

  const cwd = normalizeActivityText(session.cwd)
  if (cwd) return `${platformName} · ${cwd}`

  return `${platformName} 会话`
}

function normalizeActivityText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function isOpaqueSessionText(value: string, session: LlmMemorySessionListItem) {
  const normalized = value.trim()
  if (!normalized) return true
  if (normalized === session.sessionId || normalized === session.sessionKey) return true

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidLike.test(normalized)) return true

  const compactIdLike = /^[0-9a-f]{24,}$/i
  if (compactIdLike.test(normalized)) return true

  return false
}

function mapMemoryToActivityEntries(memory: Memory): ActivityEntry[] {
  const entries: ActivityEntry[] = [{
    id: `memory-created-${memory.id}`,
    source: 'memory',
    timestamp: memory.createdAt,
    title: memory.category === 'preference' ? '新增偏好' : '新增记忆',
    description: memory.content,
    meta: {
      memoryId: memory.id,
      category: memory.category,
      accessCount: memory.accessCount,
      event: 'created',
    },
  }]

  const hasAccessEvent = memory.accessCount > 0
    && memory.lastAccessedAt
    && Math.abs(memory.lastAccessedAt - memory.createdAt) > 60 * 1000

  if (hasAccessEvent) {
    entries.push({
      id: `memory-accessed-${memory.id}`,
      source: 'memory',
      timestamp: memory.lastAccessedAt,
      title: memory.category === 'preference' ? '命中偏好' : '命中记忆',
      description: memory.content,
      meta: {
        memoryId: memory.id,
        category: memory.category,
        accessCount: memory.accessCount,
        event: 'accessed',
      },
    })
  }

  return entries
}

function buildTotals(days: ActivityDaySummary[]) {
  return days.reduce((totals, day) => {
    totals.totalCount += day.totalCount
    totals.recordCount += day.counts.record
    totals.chatCount += day.counts.chat
    totals.writingCount += day.counts.writing
    totals.aiCount += day.counts.ai
    totals.memoryCount += day.counts.memory
    if (day.totalCount > 0) {
      totals.activeDays += 1
    }
    return totals
  }, {
    totalCount: 0,
    activeDays: 0,
    recordCount: 0,
    chatCount: 0,
    writingCount: 0,
    aiCount: 0,
    memoryCount: 0,
  })
}

function toDayKey(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

function parseTimestamp(value?: string) {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    if (numeric > 10 ** 17) return Math.floor(numeric / 1_000_000)
    if (numeric > 10 ** 15) return Math.floor(numeric / 1_000)
    if (numeric > 10 ** 12) return numeric
    return numeric * 1_000
  }

  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function sumRange(days: ActivityDaySummary[], startDay: string, endDay: string) {
  return days.reduce((sum, day) => {
    if (day.day < startDay || day.day > endDay) return sum
    return sum + day.totalCount
  }, 0)
}

function buildStreak(days: ActivityDaySummary[], today: string) {
  const summaryMap = new Map(days.map(day => [day.day, day]))
  let streak = 0
  let cursor = today

  while (summaryMap.get(cursor)?.totalCount) {
    streak += 1
    cursor = shiftDay(cursor, -1)
  }

  return streak
}

function platformLabel(platform: LlmMemoryPlatform) {
  if (platform === 'claude') return 'Claude'
  if (platform === 'codex') return 'Codex'
  if (platform === 'opencode') return 'OpenCode'
  return 'LingMo'
}

function aiUsagePlatformLabel(platform: string) {
  if (platform === 'claude') return 'Claude'
  if (platform === 'codex') return 'Codex'
  if (platform === 'opencode') return 'OpenCode'
  if (platform === 'lingmo') return 'LingMo'
  return platform || 'Unknown'
}

async function loadPlatformSessions(paths: LlmMemoryPathOverrides | null) {
  const results = await Promise.allSettled(
    LLM_PLATFORMS.map(async (platform) => ({
      platform,
      result: await listLlmMemorySessions({
        platform,
        limit: 500,
        offset: 0,
        paths,
      }),
    }))
  )

  return results.flatMap((result) => {
    if (result.status !== 'fulfilled') return []
    return result.value.result.items
  })
}

async function loadLlmMemoryPathOverrides(): Promise<LlmMemoryPathOverrides | null> {
  try {
    const store = await getActivityStore()
    const saved = await store.get<LlmMemoryPathOverrides>(LLM_MEMORY_PATH_OVERRIDES_KEY)
    if (!saved) return null

    return {
      claudeHome: saved.claudeHome || '',
      codexHome: saved.codexHome || '',
      codexProjectRoot: saved.codexProjectRoot || '',
      opencodeDbPath: saved.opencodeDbPath || '',
      lingmoHome: saved.lingmoHome || '',
    }
  } catch (error) {
    console.error('Failed to load LLM memory path overrides:', error)
    return null
  }
}

export async function loadCachedActivityCalendarData(options: LoadActivityCalendarDataOptions = {}): Promise<ActivityCalendarData | null> {
  const cacheKey = getActivityCacheKey(options.includeExternalAiDetails !== false)
  const memoryCached = activityCalendarCache.get(cacheKey)
  if (memoryCached) {
    return memoryCached.data
  }

  try {
    const store = await getActivityStore()
    const saved = await store.get<ActivityCalendarData>(getActivityStoreKey(cacheKey))
    if (!saved) return null

    activityCalendarCache.set(cacheKey, {
      data: saved,
      expiresAt: Date.now() + ACTIVITY_CALENDAR_CACHE_TTL_MS,
    })
    return saved
  } catch (error) {
    console.error('Failed to load cached activity calendar data:', error)
    return null
  }
}

async function persistActivityCalendarData(cacheKey: string, data: ActivityCalendarData) {
  try {
    const store = await getActivityStore()
    await store.set(getActivityStoreKey(cacheKey), data)
    await store.save()
  } catch (error) {
    console.error('Failed to persist activity calendar data:', error)
  }
}

function buildPlatformStats(sessions: LlmMemorySessionListItem[], today: string, timeZone: string): ActivityPlatformStat[] {
  const stats = new Map<LlmMemoryPlatform, ActivityPlatformStat>()

  for (const platform of LLM_PLATFORMS) {
    stats.set(platform, {
      platform,
      label: platformLabel(platform),
      todayCount: 0,
      sessionCount: 0,
    })
  }

  for (const session of sessions) {
    const item = stats.get(session.platform)
    if (!item) continue

    const updatedAt = parseTimestamp(session.updatedAt)
    item.sessionCount += 1
    if (updatedAt && (!item.lastActiveAt || updatedAt > item.lastActiveAt)) {
      item.lastActiveAt = updatedAt
    }
    if (updatedAt && toDayKey(updatedAt, timeZone) === today) {
      item.todayCount += 1
    }
  }

  return Array.from(stats.values()).sort((a, b) => b.todayCount - a.todayCount)
}

function buildProjectStats(sessions: LlmMemorySessionListItem[], today: string, timeZone: string): ActivityProjectStat[] {
  const stats = new Map<string, ActivityProjectStat>()

  for (const session of sessions) {
    const updatedAt = parseTimestamp(session.updatedAt)
    if (!updatedAt || toDayKey(updatedAt, timeZone) !== today) continue

    const cwd = session.cwd || 'Unknown'
    const item = stats.get(cwd) || { cwd, count: 0 }
    item.count += 1
    if (!item.lastActiveAt || updatedAt > item.lastActiveAt) {
      item.lastActiveAt = updatedAt
    }
    stats.set(cwd, item)
  }

  return Array.from(stats.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

interface AiInteractionInput {
  platform: string
  timestamp: number
}

function addAiInteraction(
  dayMap: Map<string, {
    day: string
    totalCount: number
    platforms: Map<string, ActivityAiInteractionPlatformStat>
  }>,
  input: AiInteractionInput,
  timeZone: string
) {
  const day = toDayKey(input.timestamp, timeZone)
  const dayStat = dayMap.get(day) || {
    day,
    totalCount: 0,
    platforms: new Map<string, ActivityAiInteractionPlatformStat>(),
  }
  const platformKey = input.platform || 'unknown'
  const platformStat = dayStat.platforms.get(platformKey) || {
    platform: platformKey,
    label: aiUsagePlatformLabel(platformKey),
    count: 0,
  }

  dayStat.totalCount += 1
  platformStat.count += 1
  if (!platformStat.lastActiveAt || input.timestamp > platformStat.lastActiveAt) {
    platformStat.lastActiveAt = input.timestamp
  }
  dayStat.platforms.set(platformKey, platformStat)
  dayMap.set(day, dayStat)
}

function isUserInteractionRole(role: string) {
  const normalized = role.trim().toLowerCase()
  return normalized === 'user' || normalized === 'human'
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1

      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(items[index]),
        }
      } catch (reason) {
        results[index] = {
          status: 'rejected',
          reason,
        }
      }
    }
  })

  await Promise.all(workers)
  return results
}

async function loadExternalAiInteractions(
  sessions: LlmMemorySessionListItem[],
  startDay: string,
  endDay: string,
  timeZone: string,
  paths: LlmMemoryPathOverrides | null
): Promise<AiInteractionInput[]> {
  const targetSessions = sessions.filter((session) => {
    if (!EXTERNAL_AI_INTERACTION_PLATFORMS.includes(session.platform)) return false

    const updatedAt = parseTimestamp(session.updatedAt)
    if (!updatedAt) return true

    const updatedDay = toDayKey(updatedAt, timeZone)
    return updatedDay >= startDay && updatedDay <= endDay
  })

  const results = await mapWithConcurrency(
    targetSessions,
    6,
    async (session) => {
      const detail = await getLlmMemorySessionDetail({
        platform: session.platform,
        sessionKey: session.sessionKey,
        paths,
      })
      const fallbackTimestamp = parseTimestamp(session.updatedAt)

      return detail.messages.flatMap((message): AiInteractionInput[] => {
        if (!isUserInteractionRole(message.role)) return []

        const timestamp = parseTimestamp(message.timestamp) || fallbackTimestamp
        if (!timestamp) return []

        const day = toDayKey(timestamp, timeZone)
        if (day < startDay || day > endDay) return []

        return [{
          platform: session.platform,
          timestamp,
        }]
      })
    }
  )

  return results.flatMap((result) => {
    if (result.status !== 'fulfilled') return []
    return result.value
  })
}

function buildAiInteractionStats(
  events: AiUsageEvent[],
  externalInteractions: AiInteractionInput[],
  timeZone: string,
  startDay: string,
  endDay: string
): ActivityInsights['aiInteractions'] {
  const dayMap = new Map<string, {
    day: string
    totalCount: number
    platforms: Map<string, ActivityAiInteractionPlatformStat>
  }>()

  for (const event of events) {
    if (event.role !== 'request') continue

    const day = toDayKey(event.createdAt, timeZone)
    if (day < startDay || day > endDay) continue

    addAiInteraction(dayMap, {
      platform: event.platform,
      timestamp: event.createdAt,
    }, timeZone)
  }

  for (const interaction of externalInteractions) {
    addAiInteraction(dayMap, interaction, timeZone)
  }

  return {
    days: Array.from(dayMap.values())
      .map((day): ActivityAiInteractionDayStat => ({
        day: day.day,
        totalCount: day.totalCount,
        platforms: Array.from(day.platforms.values()).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  }
}

function buildAiUsageStats(today: string, timeZone: string, events: AiUsageEvent[]): ActivityInsights['aiUsage'] {
  const todayEvents = events.filter(event => toDayKey(event.createdAt, timeZone) === today)
  const successCount = todayEvents.filter(event => event.success === 1).length
  const failureCount = todayEvents.length - successCount
  const latencyEvents = todayEvents.filter(event => typeof event.latencyMs === 'number' && event.latencyMs >= 0)
  const avgLatencyMs = latencyEvents.length
    ? Math.round(latencyEvents.reduce((sum, event) => sum + (event.latencyMs || 0), 0) / latencyEvents.length)
    : 0

  const modelMap = new Map<string, ActivityModelStat & { latencyTotal: number; latencyCount: number }>()
  const errorMap = new Map<string, ActivityErrorStat>()

  for (const event of todayEvents) {
    const provider = event.provider || 'unknown'
    const model = event.model || 'unknown'
    const key = `${provider}::${model}`
    const modelStat = modelMap.get(key) || {
      provider,
      model,
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      tokenEstimate: 0,
      latencyTotal: 0,
      latencyCount: 0,
    }

    modelStat.count += 1
    modelStat.tokenEstimate += event.tokenEstimate || 0
    if (event.success === 1) {
      modelStat.successCount += 1
    } else {
      modelStat.failureCount += 1
    }
    if (typeof event.latencyMs === 'number' && event.latencyMs >= 0) {
      modelStat.latencyTotal += event.latencyMs
      modelStat.latencyCount += 1
      modelStat.avgLatencyMs = Math.round(modelStat.latencyTotal / modelStat.latencyCount)
    }
    modelMap.set(key, modelStat)

    if (event.success !== 1) {
      const errorKind = event.errorKind || 'unknown'
      const errorStat = errorMap.get(errorKind) || { errorKind, count: 0 }
      errorStat.count += 1
      errorMap.set(errorKind, errorStat)
    }
  }

  return {
    todayCount: todayEvents.length,
    successCount,
    failureCount,
    successRate: todayEvents.length ? Math.round((successCount / todayEvents.length) * 100) : 100,
    avgLatencyMs,
    tokenEstimate: todayEvents.reduce((sum, event) => sum + (event.tokenEstimate || 0), 0),
    toolCallCount: todayEvents.reduce((sum, event) => sum + (event.toolCallCount || 0), 0),
    models: Array.from(modelMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map(stat => ({
        provider: stat.provider,
        model: stat.model,
        count: stat.count,
        successCount: stat.successCount,
        failureCount: stat.failureCount,
        avgLatencyMs: stat.avgLatencyMs,
        tokenEstimate: stat.tokenEstimate,
      })),
    errors: Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  }
}

function buildMemoryStatsFromEntries(memories: Memory[], today: string, timeZone: string): ActivityMemoryStat {
  const staleBefore = Date.now() - 60 * 24 * 60 * 60 * 1000

  const todayCreated = memories.filter(memory => toDayKey(memory.createdAt, timeZone) === today).length
  const todayAccessed = memories.filter(memory => memory.lastAccessedAt && toDayKey(memory.lastAccessedAt, timeZone) === today).length
  const topAccessed = [...memories]
    .sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0))
    .slice(0, 5)
    .map(memory => ({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      accessCount: memory.accessCount || 0,
      lastAccessedAt: memory.lastAccessedAt || 0,
    }))

  return {
    total: memories.length,
    preferences: memories.filter(memory => memory.category === 'preference').length,
    memories: memories.filter(memory => memory.category === 'memory').length,
    todayCreated,
    todayAccessed,
    totalAccessCount: memories.reduce((sum, memory) => sum + (memory.accessCount || 0), 0),
    staleCount: memories.filter(memory => !memory.lastAccessedAt || memory.lastAccessedAt < staleBefore).length,
    topAccessed,
  }
}

interface BuildInsightsInput {
  days: ActivityDaySummary[]
  timeZone: string
  today: string
  startDate: string
  endDate: string
  paths: LlmMemoryPathOverrides | null
  platformSessions: LlmMemorySessionListItem[]
  memories: Memory[]
  aiUsageEvents: AiUsageEvent[]
  includeExternalAiDetails: boolean
}

async function buildInsights(
  input: BuildInsightsInput
): Promise<ActivityInsights> {
  const {
    days,
    timeZone,
    today,
    startDate,
    endDate,
    paths,
    platformSessions,
    memories,
    aiUsageEvents,
    includeExternalAiDetails,
  } = input
  const todaySummary = days.find(day => day.day === today)
  const weekStart = shiftDay(today, -6)
  const previousWeekStart = shiftDay(weekStart, -7)
  const previousWeekEnd = shiftDay(weekStart, -1)
  const currentWeekCount = sumRange(days, weekStart, today)
  const previousWeekCount = sumRange(days, previousWeekStart, previousWeekEnd)
  const basePlatforms = buildPlatformStats(platformSessions, today, timeZone)
  const projects = buildProjectStats(platformSessions, today, timeZone)
  const memory = buildMemoryStatsFromEntries(memories, today, timeZone)
  const aiUsage = buildAiUsageStats(today, timeZone, aiUsageEvents)
  const externalAiInteractions = includeExternalAiDetails
    ? await loadExternalAiInteractions(platformSessions, startDate, endDate, timeZone, paths)
      .catch((error) => {
        console.error('Failed to load external AI interactions:', error)
        return []
      })
    : []
  const aiInteractions = buildAiInteractionStats(aiUsageEvents, externalAiInteractions, timeZone, startDate, endDate)
  const platforms = basePlatforms
    .sort((a, b) => b.todayCount - a.todayCount)

  return {
    today: {
      day: today,
      totalCount: todaySummary?.totalCount || 0,
      recordCount: todaySummary?.counts.record || 0,
      chatCount: todaySummary?.counts.chat || 0,
      writingCount: todaySummary?.counts.writing || 0,
      aiCount: todaySummary?.counts.ai || 0,
      memoryCreatedCount: memory.todayCreated,
      memoryAccessCount: memory.todayAccessed,
    },
    week: {
      totalCount: currentWeekCount,
      previousTotalCount: previousWeekCount,
      deltaCount: currentWeekCount - previousWeekCount,
      deltaPercent: previousWeekCount > 0
        ? Math.round(((currentWeekCount - previousWeekCount) / previousWeekCount) * 100)
        : currentWeekCount > 0 ? 100 : 0,
    },
    streakDays: buildStreak(days, today),
    platforms,
    projects,
    memory,
    aiInteractions,
    aiUsage,
  }
}

export async function loadActivityCalendarData(options: LoadActivityCalendarDataOptions = {}): Promise<ActivityCalendarData> {
  const { includeExternalAiDetails = true, force = false } = options
  const cacheKey = getActivityCacheKey(includeExternalAiDetails)
  const now = Date.now()
  const cached = activityCalendarCache.get(cacheKey)

  if (!force && cached && cached.expiresAt > now) {
    return cached.data
  }

  if (!force) {
    const inflight = activityCalendarInflight.get(cacheKey)
    if (inflight) return inflight
  }

  const loader = (async () => {
  const timeZone = getBrowserTimeZone()
  const { startDate, endDate } = getDefaultRange()
  const today = toDayKey(Date.now(), timeZone)
  const paths = await loadLlmMemoryPathOverrides()

  const [events, marks, chats, tags, memories, aiUsageEvents, platformSessions] = await Promise.all([
    getAllActivityEvents().catch((error) => {
      console.error('Failed to load activity events:', error)
      return []
    }),
    getAllMarks().catch((error) => {
      console.error('Failed to load marks:', error)
      return []
    }),
    getAllChats().catch((error) => {
      console.error('Failed to load chats:', error)
      return []
    }),
    getTags().catch((error) => {
      console.error('Failed to load tags:', error)
      return []
    }),
    getAllMemories().catch((error) => {
      console.error('Failed to load memories:', error)
      return []
    }),
    getAllAiUsageEvents().catch((error) => {
      console.error('Failed to load AI usage events:', error)
      return []
    }),
    loadPlatformSessions(paths).catch((error) => {
      console.error('Failed to load platform sessions:', error)
      return []
    }),
  ])

  const entries = buildActivityEntries(events, marks, chats, tags, memories, platformSessions)

  const days = summarizeActivityEntries(entries, { timeZone }) as ActivityDaySummary[]
  const heatmap = buildActivityHeatmap(days, { startDate, endDate }) as {
    weeks: ActivityHeatmapWeek[]
  }

    const result: ActivityCalendarData = {
    timeZone,
    startDate,
    endDate,
    generatedAt: Date.now(),
    totals: buildTotals(days),
    days,
    weeks: heatmap.weeks,
    insights: await buildInsights({
      days,
      timeZone,
      today,
      startDate,
      endDate,
      paths,
      platformSessions,
      memories,
      aiUsageEvents,
      includeExternalAiDetails,
    }),
    }

    activityCalendarCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + ACTIVITY_CALENDAR_CACHE_TTL_MS,
    })
    void persistActivityCalendarData(cacheKey, result)

    return result
  })()

  activityCalendarInflight.set(cacheKey, loader)

  try {
    return await loader
  } finally {
    activityCalendarInflight.delete(cacheKey)
  }
}
