import { AI_HOTSPOT_CONFIG } from '../config'
import { fetchHotspotConditional } from '../http'
import { parseRssItems } from '../rss'
import type { AiHotspotRawItem, AiHotspotUserFeed } from '../types'
import { AiHotspotFetcherOptions, BaseAiHotspotFetcher } from './base'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
) {
  const results: R[] = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, () => worker()),
  )

  return results
}

export class UserRssFetcher extends BaseAiHotspotFetcher {
  sourceId = 'user-rss'
  sourceName = 'User RSS'
  kind = 'rss' as const

  constructor(private readonly feeds: AiHotspotUserFeed[]) {
    super()
  }

  async fetch(_now: Date, options?: AiHotspotFetcherOptions) {
    const lastFetchAt = options?.lastFetchAt
    const force = options?.force ?? false
    const enabledFeeds = this.feeds.filter((feed) => feed.enabled)
    if (!enabledFeeds.length) return []

    const results = await mapWithConcurrency(
      enabledFeeds,
      AI_HOTSPOT_CONFIG.rss.maxConcurrency,
      async (feed) => {
        try {
          // 使用条件请求：If-Modified-Since
          const { response, notModified } = await fetchHotspotConditional(feed.feedUrl, {
            timeoutMs: 20000,
            ifModifiedSince: force ? null : lastFetchAt,
          })

          // 304 Not Modified
          if (notModified) {
            return {
              feed,
              items: [] as AiHotspotRawItem[],
              notModified: true,
              error: null as string | null,
            }
          }

          const xml = await response!.text()
          return {
            feed,
            items: parseRssItems(xml, {
              sourceId: this.sourceId,
              sourceName: this.sourceName,
              feedName: feed.title,
              feedUrl: feed.feedUrl,
            }),
            notModified: false,
            error: null as string | null,
          }
        } catch (error) {
          return {
            feed,
            items: [] as AiHotspotRawItem[],
            notModified: false,
            error: getErrorMessage(error),
          }
        }
      }
    )

    const failedFeeds = results.filter((result) => result.error)
    if (failedFeeds.length === results.length) {
      throw new Error(`All user RSS feeds failed: ${failedFeeds.map((failed) => failed.feed.title).join(', ')}`)
    }

    const allNotModified = results.every(r => r.notModified || r.error)
    if (allNotModified && failedFeeds.length === 0) {
      return []
    }

    const items = results.flatMap((result) => {
      if (result.notModified) return []
      return result.items.map((item) => ({
        ...item,
        meta: {
          ...item.meta,
          userFeedId: result.feed.id,
          groupName: result.feed.groupName,
          failedFeedCount: failedFeeds.length,
          failedFeeds: failedFeeds.map((failed) => ({
            id: failed.feed.id,
            title: failed.feed.title,
            feedUrl: failed.feed.feedUrl,
            error: failed.error,
          })),
        },
      }))
    })

    // 增量过滤：只保留比 lastFetchAt 更新的条目
    return force ? items : this.filterByLastFetchAt(items, lastFetchAt)
  }
}
