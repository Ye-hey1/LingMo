export type AiHotspotTimeRange = '24h' | '7d'
export type AiHotspotView = 'featured' | 'all' | 'clusters' | 'digest' | 'sources' | 'favorites' | 'saved' | 'trash'
export type AiHotspotSourceKind = 'default' | 'rss' | 'opml' | 'scraper'
export type AiHotspotStatusFilter = 'all' | 'unread' | 'favorite' | 'saved' | 'ignored' | 'deleted'
export type AiHotspotDigestStatus = 'none' | 'added' | 'saved'
export type AiHotspotSuggestedAction = 'ignore' | 'favorite' | 'deep-dive' | 'digest' | 'save'

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
  signalSummary: string | null
  signalEssence: string | null
  impactAudience: string[]
  suggestedAction: AiHotspotSuggestedAction | null
  relatedSignalIds: string[]
  isIgnored: boolean
  deletedAt: string | null
  digestStatus: AiHotspotDigestStatus
  snapshotId: string | null
  meta?: Record<string, unknown>
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
  feedName: string
  status: AiHotspotStatusFilter
}
