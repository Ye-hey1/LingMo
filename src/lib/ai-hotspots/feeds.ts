export interface DefaultRssFeed {
  name: string
  url: string
  role: 'featured' | 'all' | 'daily'
  note: string
}

export const AI_HOT_RSS_SOURCE_ID = 'ai-hot-rss'
export const AI_HOT_RSS_SOURCE_NAME = 'AI HOT RSS'
export const AI_HOT_FEATURED_FEED_NAME = 'AI HOT 精选'
export const AI_HOT_FEATURED_FEED_URL = 'https://aihot.virxact.com/feed.xml'
export const AI_HOT_ALL_FEED_NAME = 'AI HOT 全部 AI 动态'
export const AI_HOT_ALL_FEED_URL = 'https://aihot.virxact.com/feed/all.xml'
export const AI_HOT_DAILY_FEED_NAME = 'AI HOT 日报'
export const AI_HOT_DAILY_FEED_URL = 'https://aihot.virxact.com/feed/daily.xml'

export const DEFAULT_RSS_FEEDS: DefaultRssFeed[] = [
  {
    name: AI_HOT_FEATURED_FEED_NAME,
    url: AI_HOT_FEATURED_FEED_URL,
    role: 'featured',
    note: '每日精编候选池，最新 50 条',
  },
  {
    name: AI_HOT_ALL_FEED_NAME,
    url: AI_HOT_ALL_FEED_URL,
    role: 'all',
    note: '最近 7 天 AI 行业内容流，最新 50 条',
  },
  {
    name: AI_HOT_DAILY_FEED_NAME,
    url: AI_HOT_DAILY_FEED_URL,
    role: 'daily',
    note: '每天 08:00 北京时间发布的精编日报',
  },
]

export function getDefaultRssFeedRole(feed: { title?: string; name?: string; feedUrl?: string; url?: string }): DefaultRssFeed['role'] {
  const title = (feed.title || feed.name || '').trim()
  const url = (feed.feedUrl || feed.url || '').trim().toLowerCase()

  if (title === AI_HOT_DAILY_FEED_NAME || url === AI_HOT_DAILY_FEED_URL) return 'daily'
  if (title === AI_HOT_ALL_FEED_NAME || url === AI_HOT_ALL_FEED_URL) return 'all'
  return 'featured'
}

export function getDefaultRssFeedNote(role: DefaultRssFeed['role']) {
  return DEFAULT_RSS_FEEDS.find(feed => feed.role === role)?.note || ''
}
