import { AI_HOTSPOT_CONFIG } from '../config'
import { fetchHotspotText } from '../http'
import { parseRssItems } from '../rss'
import type { AiHotspotRawItem, AiHotspotUserFeed } from '../types'
import { BaseAiHotspotFetcher } from './base'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
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
    Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, () => worker())
  )

  return results
}

export class UserRssFetcher extends BaseAiHotspotFetcher {
  sourceId = 'user-rss'
  sourceName = 'User RSS'
  kind: 'rss' = 'rss'

  constructor(private readonly feeds: AiHotspotUserFeed[]) {
    super()
  }

  async fetch() {
    const enabledFeeds = this.feeds.filter((feed) => feed.enabled)
    if (!enabledFeeds.length) return []

    const results = await mapWithConcurrency(
      enabledFeeds,
      AI_HOTSPOT_CONFIG.rss.maxConcurrency,
      async (feed) => {
        try {
          const xml = await fetchHotspotText(feed.feedUrl, { timeoutMs: 20000 })
          return {
            feed,
            items: parseRssItems(xml, {
              sourceId: this.sourceId,
              sourceName: this.sourceName,
              feedName: feed.title,
              feedUrl: feed.feedUrl,
            }),
            error: null as string | null,
          }
        } catch (error) {
          return {
            feed,
            items: [] as AiHotspotRawItem[],
            error: getErrorMessage(error),
          }
        }
      }
    )

    const failedFeeds = results.filter((result) => result.error)
    return results.flatMap((result) => result.items.map((item) => ({
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
    })))
  }
}
