import { fetchHotspotText } from '../http'
import { BaseAiHotspotFetcher, type AiHotspotFetcherOptions } from './base'
import type { AiHotspotRawItem } from '../types'
import { parseRssItems } from '../rss'

/** 限制并发数 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

interface _UserFeed {
  id: string
  title: string
  feedUrl: string
  groupName: string | null
  enabled: boolean
}

/**
 * 微信公众号 RSS 抽取器
 * 从 user_feeds 表读取 group_name 为 'builtin:wechat-rss' 的源
 */
export class WechatRssFetcher extends BaseAiHotspotFetcher {
  sourceId = 'wechat-rss'
  sourceName = '微信公众号'
  kind = 'rss' as const

  async fetch(_now: Date, _options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]> {
    // 动态导入以避免循环依赖
    const { getAiHotspotUserFeeds } = await import('@/db/ai-hotspots')
    
    const allFeeds = await getAiHotspotUserFeeds()
    const wechatFeeds = allFeeds.filter(
      f => f.enabled && f.groupName === 'builtin:wechat-rss'
    )

    if (wechatFeeds.length === 0) return []

    const results = await mapWithLimit(wechatFeeds, 8, async (feed) => {
      try {
        const xml = await fetchHotspotText(feed.feedUrl, { timeoutMs: 15000 })
        const items = parseRssItems(xml, {
          sourceId: this.sourceId,
          sourceName: this.sourceName,
          feedName: feed.title,
          feedUrl: feed.feedUrl,
          feedRole: 'wechat',
        })
        return items
      } catch {
        return [] as AiHotspotRawItem[]
      }
    })

    return results.flat()
  }
}
