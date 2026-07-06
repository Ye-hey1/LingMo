import { AI_HOTSPOT_CONFIG } from '../config'
import { fetchHotspotConditional } from '../http'
import { parseRssItems } from '../rss'
import type { AiHotspotRawItem, AiHotspotUserFeed } from '../types'
import { AiHotspotFetcherOptions, BaseAiHotspotFetcher, mapWithConcurrency } from './base'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class UserRssFetcher extends BaseAiHotspotFetcher {
  sourceId = 'user-rss'
  sourceName = 'User RSS'
  kind = 'rss' as const

  constructor(private readonly feeds: AiHotspotUserFeed[]) {
    super()
  }

  async fetch(_now: Date, options?: AiHotspotFetcherOptions) {
    const force = options?.force ?? false
    const enabledFeeds = this.feeds.filter((feed) => feed.enabled)
    if (!enabledFeeds.length) return []

    const results = await mapWithConcurrency(
      enabledFeeds,
      AI_HOTSPOT_CONFIG.rss.maxConcurrency,
      async (feed) => {
        const feedLastFetchAt = force
          ? null
          : this.resolveFeedLastFetchAt(options, [feed.id, feed.feedUrl, feed.title], null)

        try {
          const { response, notModified } = await fetchHotspotConditional(feed.feedUrl, {
            timeoutMs: 20000,
            ifModifiedSince: feedLastFetchAt,
            signal: options?.signal,
          })

          if (notModified) {
            return {
              feed,
              items: [] as AiHotspotRawItem[],
              notModified: true,
              error: null as string | null,
              lastFetchAt: feedLastFetchAt,
            }
          }

          const xml = await response!.text()
          const parsedItems = parseRssItems(xml, {
            sourceId: this.sourceId,
            sourceName: this.sourceName,
            feedName: feed.title,
            feedUrl: feed.feedUrl,
          }).slice(0, AI_HOTSPOT_CONFIG.rss.maxItemsPerFeed)
          const items = force ? parsedItems : this.filterByLastFetchAt(parsedItems, feedLastFetchAt)

          return {
            feed,
            items,
            notModified: false,
            error: null as string | null,
            lastFetchAt: feedLastFetchAt,
          }
        } catch (error) {
          return {
            feed,
            items: [] as AiHotspotRawItem[],
            notModified: false,
            error: getErrorMessage(error),
            lastFetchAt: feedLastFetchAt,
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

    return items
  }
}
