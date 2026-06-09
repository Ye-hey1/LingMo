export type AiHotspotTimeRange = '24h' | '7d'
export type AiHotspotView = 'latest' | 'favorites' | 'digest' | 'sources'
export type AiHotspotSourceKind = 'default' | 'rss' | 'opml'

export interface AiHotspotRawItem {
  sourceId: string
  sourceName: string
  feedName: string
  title: string
  url: string
  publishedAt: Date | null
  meta: Record<string, unknown>
}

export interface AiHotspotItem {
  id: string
  sourceId: string
  sourceName: string
  feedName: string
  title: string
  titleOriginal: string | null
  titleEn: string | null
  titleZh: string | null
  url: string
  publishedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  summary: string | null
  tags: string[]
  score: number
  isFavorite: boolean
  isRead: boolean
  savedNotePath: string | null
}

export interface AiHotspotSourceStatus {
  sourceId: string
  sourceName: string
  kind: AiHotspotSourceKind
  enabled: boolean
  ok: boolean
  itemCount: number
  durationMs: number
  lastOkAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface AiHotspotUserFeed {
  id: string
  title: string
  feedUrl: string
  groupName: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AiHotspotFilters {
  query: string
  timeRange: AiHotspotTimeRange
  sourceId: string
  status: 'all' | 'unread' | 'favorite' | 'saved'
}
