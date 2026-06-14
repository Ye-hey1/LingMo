import {
  AI_HOT_DAILY_FEED_NAME,
  AI_HOT_DAILY_FEED_URL,
  AI_HOT_FEATURED_FEED_NAME,
  AI_HOT_FEATURED_FEED_URL,
  AI_HOT_RSS_SOURCE_ID,
  AI_HOT_RSS_SOURCE_NAME,
  getDefaultRssFeedNote,
  getDefaultRssFeedRole,
} from '../feeds'
import { fetchHotspotConditional, fetchHotspotText } from '../http'
import { parseAiHotDailyPage } from '../daily-page'
import { parseRssItems } from '../rss'
import { AiHotspotFetcherOptions, BaseAiHotspotFetcher } from './base'
import type { DefaultRssFeed } from '../feeds'
import type { AiHotspotRawItem, AiHotspotUserFeed } from '../types'

export type DefaultRssFetcherMode = 'all' | 'featured' | 'latest-daily'

const FALLBACK_FEATURED_FEED: AiHotspotUserFeed = {
  id: 'builtin-ai-hot-featured',
  title: AI_HOT_FEATURED_FEED_NAME,
  feedUrl: AI_HOT_FEATURED_FEED_URL,
  groupName: 'builtin:rss',
  enabled: true,
  createdAt: '',
  updatedAt: '',
}

const FALLBACK_DAILY_FEED: AiHotspotUserFeed = {
  id: 'builtin-ai-hot-daily',
  title: AI_HOT_DAILY_FEED_NAME,
  feedUrl: AI_HOT_DAILY_FEED_URL,
  groupName: 'builtin:rss',
  enabled: true,
  createdAt: '',
  updatedAt: '',
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getAiHotAuthorName(value: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text) return ''
  const parenthesized = text.match(/\(([^()]*)\)\s*$/)?.[1]?.trim()
  const name = parenthesized || text.replace(/^.*?<[^>]+>\s*/i, '').trim()
  return name || ''
}

function refineAiHotRssItemSource(item: AiHotspotRawItem, role: DefaultRssFeed['role']): AiHotspotRawItem {
  if (role !== 'featured' && role !== 'all') return item
  const authorName = getAiHotAuthorName(item.meta.author)
  if (!authorName) return item
  return {
    ...item,
    sourceName: authorName,
  }
}

function getDailyIssueDate(item: AiHotspotRawItem) {
  const guid = typeof item.meta.guid === 'string' ? item.meta.guid : ''
  const fromGuid = guid.match(/daily-(\d{4}-\d{2}-\d{2})/)?.[1]
  const fromUrl = item.url.match(/\/daily\/(\d{4}-\d{2}-\d{2})/)?.[1]
  return fromGuid || fromUrl || item.publishedAt?.toISOString().slice(0, 10) || ''
}

function getDailyArticleTime(issue: AiHotspotRawItem, index: number) {
  const baseTime = issue.publishedAt?.getTime()
  if (!baseTime || Number.isNaN(baseTime)) return issue.publishedAt
  return new Date(baseTime + index * 1000)
}

function getDailyArticleFeedName(issueDate: string, sectionTitle: string, role: string) {
  return ['AI HOT 日报明细', issueDate, sectionTitle || '未分组', role].filter(Boolean).join(' · ')
}

async function fetchDailyIssueArticles(issue: AiHotspotRawItem): Promise<AiHotspotRawItem[]> {
  const issueDate = getDailyIssueDate(issue)
  if (!issueDate || !issue.url) return []

  const html = await fetchHotspotText(issue.url, { timeoutMs: 20000 })
  const page = parseAiHotDailyPage(html)
  let index = 0

  return page.sections.flatMap((section, sectionIndex) => {
    return section.articles.map((article, articleIndex) => {
      index += 1
      return {
        sourceId: issue.sourceId,
        sourceName: article.source || issue.sourceName,
        feedName: getDailyArticleFeedName(issueDate, section.title, article.role),
        title: article.title,
        url: article.url || `${issue.url}#${encodeURIComponent(article.id || article.title)}`,
        publishedAt: getDailyArticleTime(issue, index),
        meta: {
          author: article.source,
          dailyArticleId: article.id,
          dailyArticleIndex: index,
          dailyArticleKey: `${issueDate}:${sectionIndex + 1}:${articleIndex + 1}:${article.id || article.title}`,
          dailyArticleRole: article.role,
          dailyIssueDate: issueDate,
          dailyIssueTitle: issue.title,
          dailyIssueUrl: issue.url,
          dailySectionIndex: sectionIndex + 1,
          dailySectionTitle: section.title,
          dailySectionSubtitle: section.subtitle,
          feedRole: 'daily-article',
          feedUrl: issue.meta.feedUrl || '',
          guid: `${issue.meta.guid || `daily-${issueDate}`}-article-${sectionIndex + 1}-${articleIndex + 1}-${article.id || index}`,
          summary: article.summary,
        },
      } satisfies AiHotspotRawItem
    })
  })
}

/**
 * AI HOT RSS 抽取器
 * 从 user_feeds 表读取 group_name 为 'builtin:rss' 的核心源
 */
export class DefaultRssFetcher extends BaseAiHotspotFetcher {
  sourceId = AI_HOT_RSS_SOURCE_ID
  sourceName = AI_HOT_RSS_SOURCE_NAME
  kind = 'rss' as const

  constructor(private readonly mode: DefaultRssFetcherMode = 'all') {
    super()
  }

  async fetch(_now: Date, options?: AiHotspotFetcherOptions) {
    const lastFetchAt = options?.lastFetchAt
    const force = options?.force ?? false

    // 从 user_feeds 表读取核心 RSS 源
    const { getAiHotspotUserFeeds } = await import('@/db/ai-hotspots')
    const allFeeds = await getAiHotspotUserFeeds()
    let rssFeeds = allFeeds.filter(
      f => f.enabled && f.groupName === 'builtin:rss'
    )

    if (this.mode === 'featured') {
      rssFeeds = rssFeeds.filter(feed => getDefaultRssFeedRole(feed) === 'featured')
      if (rssFeeds.length === 0) {
        rssFeeds = [FALLBACK_FEATURED_FEED]
      }
    } else if (this.mode === 'latest-daily') {
      rssFeeds = rssFeeds.filter(feed => getDefaultRssFeedRole(feed) === 'daily')
      if (rssFeeds.length === 0) {
        rssFeeds = [FALLBACK_DAILY_FEED]
      }
    }

    if (rssFeeds.length === 0) {
      return [] as AiHotspotRawItem[]
    }

    const results = await Promise.all(
      rssFeeds.map(async (feed) => {
        try {
          const feedRole = getDefaultRssFeedRole(feed)
          const { response, notModified } = await fetchHotspotConditional(feed.feedUrl, {
            timeoutMs: 20000,
            ifModifiedSince: force ? null : lastFetchAt,
          })

          if (notModified) {
            return {
              feed,
              items: [] as AiHotspotRawItem[],
              notModified: true,
              error: null as string | null,
              role: feedRole,
            }
          }

          const xml = await response!.text()
          const parsedItems = parseRssItems(xml, {
            sourceId: this.sourceId,
            sourceName: this.sourceName,
            feedName: feed.title,
            feedUrl: feed.feedUrl,
            feedRole,
          }).map(item => refineAiHotRssItemSource(item, feedRole))

          return {
            feed,
            items: feedRole === 'daily' ? parsedItems.slice(0, 1) : parsedItems,
            notModified: false,
            error: null as string | null,
            role: feedRole,
          }
        } catch (error) {
          return {
            feed,
            items: [] as AiHotspotRawItem[],
            notModified: false,
            error: getErrorMessage(error),
            role: getDefaultRssFeedRole(feed),
          }
        }
      })
    )

    const failedFeeds = results.filter((result) => result.error)
    const allNotModified = results.every(r => r.notModified || r.error)

    if (failedFeeds.length === results.length) {
      throw new Error(`All default RSS feeds failed: ${failedFeeds.map((f) => f.feed.title).join(', ')}`)
    }

    if (allNotModified && failedFeeds.length === 0) {
      return [] as AiHotspotRawItem[]
    }

    const items = results.flatMap((result) => {
      if (result.notModified) return []
      return result.items.map((item) => ({
        ...item,
        meta: {
          ...item.meta,
          feedRole: result.role,
          feedNote: getDefaultRssFeedNote(result.role),
          failedFeedCount: failedFeeds.length,
          failedFeeds: failedFeeds.map((f) => ({
            name: f.feed.title,
            url: f.feed.feedUrl,
            error: f.error,
          })),
        },
      }))
    })

    const filteredItems = force ? items : this.filterByLastFetchAt(items, lastFetchAt)

    const dailyIssues = filteredItems.filter(item => item.meta.feedRole === 'daily')
    const dailyArticleResults = await Promise.all(
      dailyIssues.slice(0, 1).map(async (issue) => {
        try {
          return {
            articles: await fetchDailyIssueArticles(issue),
            error: '',
            issue,
          }
        } catch (error) {
          return {
            articles: [],
            error: getErrorMessage(error),
            issue,
          }
        }
      }),
    )
    const dailyDetailFetchedAt = new Date().toISOString()
    const dailyDetailStatusByUrl = new Map(
      dailyArticleResults.map(result => [
        result.issue.url,
        {
          count: result.articles.length,
          error: result.error,
        },
      ]),
    )

    return [
      ...filteredItems.map((item) => {
        if (item.meta.feedRole !== 'daily') return item

        const detail = dailyDetailStatusByUrl.get(item.url)
        return {
          ...item,
          meta: {
            ...item.meta,
            dailyDetailCount: detail?.count ?? 0,
            dailyDetailError: detail?.error || '',
            dailyDetailFetchedAt,
            dailyDetailStatus: detail?.error ? 'failed' : 'ok',
          },
        }
      }),
      ...dailyArticleResults.flatMap(result => result.articles),
    ]
  }
}
