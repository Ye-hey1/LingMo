import { listWechatMpArticles } from '@/lib/wechat-mp-native'
import type { AiHotspotRawItem, AiHotspotUserFeed } from '../types'
import { AiHotspotFetcherOptions, BaseAiHotspotFetcher, mapWithConcurrency } from './base'

export const WECHAT_MP_FEED_PREFIX = 'wechat-mp://'
export const WECHAT_MP_GROUP_NAME = 'wechat-mp'
export const WECHAT_MP_INITIAL_ARTICLE_COUNT = 20
export const WECHAT_MP_LOAD_MORE_ARTICLE_COUNT = 10

export interface WechatMpFetcherPageOptions {
  begin?: number
  count?: number
}

export function isWechatMpFeed(feed: AiHotspotUserFeed) {
  return feed.feedUrl.startsWith(WECHAT_MP_FEED_PREFIX) || feed.groupName === WECHAT_MP_GROUP_NAME
}

export function getWechatMpFakeId(feed: AiHotspotUserFeed) {
  if (feed.feedUrl.startsWith(WECHAT_MP_FEED_PREFIX)) {
    return decodeURIComponent(feed.feedUrl.slice(WECHAT_MP_FEED_PREFIX.length)).trim()
  }
  return ''
}

function fromUnixSeconds(value: number) {
  if (!value) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

export class WechatMpFetcher extends BaseAiHotspotFetcher {
  sourceId = 'wechat-mp'
  sourceName = '微信公众号'
  kind = 'scraper' as const

  constructor(
    private readonly feeds: AiHotspotUserFeed[],
    private readonly page: WechatMpFetcherPageOptions = {},
  ) {
    super()
  }

  async fetch(_now: Date, options?: AiHotspotFetcherOptions) {
    const force = options?.force ?? false
    const enabledFeeds = this.feeds.filter(feed => feed.enabled && isWechatMpFeed(feed))
    if (!enabledFeeds.length) return []

    const results = await mapWithConcurrency(enabledFeeds, 2, async (feed) => {
      const fakeid = getWechatMpFakeId(feed)
      if (!fakeid) {
        return { feed, items: [] as AiHotspotRawItem[], error: '缺少公众号 fakeid' }
      }
      const feedLastFetchAt = force
        ? null
        : this.resolveFeedLastFetchAt(options, [feed.id, feed.feedUrl, feed.title], null)
      try {
        const articles = await listWechatMpArticles({
          fakeid,
          begin: Math.max(0, this.page.begin ?? 0),
          count: this.page.count ?? WECHAT_MP_INITIAL_ARTICLE_COUNT,
        })
        const parsedItems: AiHotspotRawItem[] = articles.map(article => ({
          sourceId: this.sourceId,
          sourceName: this.sourceName,
          feedName: feed.title,
          title: article.title,
          url: article.link,
          publishedAt: fromUnixSeconds(article.updateTime || article.createTime),
          meta: {
            userFeedId: feed.id,
            feedUrl: feed.feedUrl,
            groupName: WECHAT_MP_GROUP_NAME,
            summary: article.digest,
            description: article.digest,
            image: article.cover,
            cover: article.cover,
            aid: article.aid,
            fakeid,
            sourceKind: WECHAT_MP_GROUP_NAME,
          },
        }))
        const items = force ? parsedItems : this.filterByLastFetchAt(parsedItems, feedLastFetchAt)
        return { feed, items, error: null as string | null }
      } catch (error) {
        return {
          feed,
          items: [] as AiHotspotRawItem[],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    const failedFeeds = results.filter(result => result.error)
    if (failedFeeds.length === results.length) {
      throw new Error(`微信公众号订阅刷新失败：${failedFeeds.map(result => result.feed.title).join(', ')}`)
    }

    return results.flatMap(result => result.items.map(item => ({
      ...item,
      meta: {
        ...item.meta,
        failedFeedCount: failedFeeds.length,
        failedFeeds: failedFeeds.map(failed => ({
          id: failed.feed.id,
          title: failed.feed.title,
          feedUrl: failed.feed.feedUrl,
          error: failed.error,
        })),
      },
    })))
  }
}
