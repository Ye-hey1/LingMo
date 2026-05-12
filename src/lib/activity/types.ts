export type ActivitySource = 'record' | 'chat' | 'writing' | 'ai' | 'memory'
export type ActivityViewSource = ActivitySource

export interface ActivityEntry {
  id: string
  source: ActivitySource
  timestamp: number
  title: string
  description?: string
  path?: string
  tagId?: number
  meta?: Record<string, string | number | boolean | null | undefined>
}

export interface ActivityDaySummary {
  day: string
  totalCount: number
  counts: Record<ActivitySource, number>
  entries: ActivityEntry[]
}

export interface ActivityHeatmapWeek {
  days: ActivityDaySummary[]
}

export interface ActivityCalendarData {
  timeZone: string
  startDate: string
  endDate: string
  generatedAt: number
  totals: {
    totalCount: number
    activeDays: number
    recordCount: number
    chatCount: number
    writingCount: number
    aiCount: number
    memoryCount: number
  }
  days: ActivityDaySummary[]
  weeks: ActivityHeatmapWeek[]
  insights: ActivityInsights
}

export interface ActivityPlatformStat {
  platform: string
  label: string
  todayCount: number
  sessionCount: number
  lastActiveAt?: number
}

export interface ActivityProjectStat {
  cwd: string
  count: number
  lastActiveAt?: number
}

export interface ActivityModelStat {
  provider: string
  model: string
  count: number
  successCount: number
  failureCount: number
  avgLatencyMs: number
  tokenEstimate: number
}

export interface ActivityErrorStat {
  errorKind: string
  count: number
}

export interface ActivityAiInteractionPlatformStat {
  platform: string
  label: string
  count: number
  lastActiveAt?: number
}

export interface ActivityAiInteractionDayStat {
  day: string
  totalCount: number
  platforms: ActivityAiInteractionPlatformStat[]
}

export interface ActivityMemoryStat {
  total: number
  preferences: number
  memories: number
  todayCreated: number
  todayAccessed: number
  totalAccessCount: number
  staleCount: number
  topAccessed: Array<{
    id: string
    content: string
    category: 'preference' | 'memory'
    accessCount: number
    lastAccessedAt: number
  }>
}

export interface ActivityInsights {
  today: {
    day: string
    totalCount: number
    recordCount: number
    chatCount: number
    writingCount: number
    aiCount: number
    memoryCreatedCount: number
    memoryAccessCount: number
  }
  week: {
    totalCount: number
    previousTotalCount: number
    deltaCount: number
    deltaPercent: number
  }
  streakDays: number
  platforms: ActivityPlatformStat[]
  projects: ActivityProjectStat[]
  memory: ActivityMemoryStat
  aiInteractions: {
    days: ActivityAiInteractionDayStat[]
  }
  aiUsage: {
    todayCount: number
    successCount: number
    failureCount: number
    successRate: number
    avgLatencyMs: number
    tokenEstimate: number
    toolCallCount: number
    models: ActivityModelStat[]
    errors: ActivityErrorStat[]
  }
}
