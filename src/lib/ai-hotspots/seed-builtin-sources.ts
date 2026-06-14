import { getAiHotspotUserFeeds, addAiHotspotUserFeed } from '@/db/ai-hotspots'
import { ALL_BUILTIN_SOURCES, getBuiltinSourceGroupId, type BuiltinSource } from './builtin-sources'

/**
 * 确保所有内置源都已写入 user_feeds 表
 * 首次加载时自动执行，不会覆盖用户已有的修改
 */
export async function seedBuiltinSources(): Promise<void> {
  const existingFeeds = await getAiHotspotUserFeeds()
  const existingUrls = new Set(existingFeeds.map(f => f.feedUrl.trim().toLowerCase()))

  for (const source of ALL_BUILTIN_SOURCES) {
    const urlKey = source.url.trim().toLowerCase()
    if (existingUrls.has(urlKey)) continue

    try {
      await addAiHotspotUserFeed({
        id: source.id,
        title: source.title,
        feedUrl: source.url,
        groupName: getBuiltinSourceGroupId(source.type),
        enabled: source.defaultEnabled,
      })
    } catch {
      // ignore duplicate errors
    }
  }
}

/**
 * 判断一个 user_feed 是否为内置源
 */
export function isBuiltinFeed(feedUrl: string): boolean {
  const urlKey = feedUrl.trim().toLowerCase()
  return ALL_BUILTIN_SOURCES.some(s => s.url.trim().toLowerCase() === urlKey)
}

/**
 * 根据 feedUrl 获取内置源配置
 */
export function getBuiltinSourceByFeedUrl(feedUrl: string): BuiltinSource | undefined {
  const urlKey = feedUrl.trim().toLowerCase()
  return ALL_BUILTIN_SOURCES.find(s => s.url.trim().toLowerCase() === urlKey)
}
