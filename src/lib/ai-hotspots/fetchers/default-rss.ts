import { fetchHotspotText } from '../http'
import { parseRssItems } from '../rss'
import { BaseAiHotspotFetcher } from './base'

interface DefaultRssFeed {
  name: string
  url: string
}

const DEFAULT_RSS_FEEDS: DefaultRssFeed[] = [
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
  { name: 'Anthropic News', url: 'https://www.anthropic.com/news/rss.xml' },
  { name: 'Google DeepMind Blog', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'DeepLearning.AI', url: 'https://www.deeplearning.ai/feed/' },
]

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class DefaultRssFetcher extends BaseAiHotspotFetcher {
  sourceId = 'default-rss'
  sourceName = 'Default RSS'
  kind = 'rss' as const

  async fetch() {
    const results = await Promise.all(
      DEFAULT_RSS_FEEDS.map(async (feed) => {
        try {
          const xml = await fetchHotspotText(feed.url, { timeoutMs: 20000 })
          return {
            feed,
            items: parseRssItems(xml, {
              sourceId: this.sourceId,
              sourceName: this.sourceName,
              feedName: feed.name,
              feedUrl: feed.url,
            }),
            error: null as string | null,
          }
        } catch (error) {
          return { feed, items: [], error: getErrorMessage(error) }
        }
      })
    )

    const failedFeeds = results.filter((result) => result.error)
    if (failedFeeds.length === results.length) {
      throw new Error(`All default RSS feeds failed: ${failedFeeds.map((failed) => failed.feed.name).join(', ')}`)
    }

    return results.flatMap((result) => result.items.map((item) => ({
      ...item,
      meta: {
        ...item.meta,
        failedFeedCount: failedFeeds.length,
        failedFeeds: failedFeeds.map((failed) => ({
          name: failed.feed.name,
          url: failed.feed.url,
          error: failed.error,
        })),
      },
    })))
  }
}

export { DEFAULT_RSS_FEEDS }
