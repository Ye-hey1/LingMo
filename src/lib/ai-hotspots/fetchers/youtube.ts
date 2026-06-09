import { fetchHotspotText } from '../http'
import { decodeXmlEntities, extractXmlTag } from '../rss'
import { BaseAiHotspotFetcher } from './base'

interface YouTubeChannel {
  id: string
  name: string
  channelId: string
}

const YOUTUBE_CHANNELS: YouTubeChannel[] = [
  { id: 'peter-yang', name: 'Peter Yang', channelId: 'UCnpBg7yqNauHtlNSpOl5-cg' },
  { id: 'lenny-podcast', name: "Lenny's Podcast", channelId: 'UC6t1O76G0jYXOAoYCm153dA' },
  { id: '20vc', name: '20VC', channelId: 'UCf0PBRjhf0rF8fWBIxTuoWA' },
]

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function extractAttribute(block: string, attr: string) {
  const match = block.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match ? decodeXmlEntities(match[1]) : ''
}

function parseYouTubeEntries(xml: string) {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const entry = match[0]
    const linkTag = entry.match(/<link\b[^>]*>/i)?.[0] || ''
    const thumbnailTag = entry.match(/<media:thumbnail\b[^>]*>/i)?.[0] || ''
    const statisticsTag = entry.match(/<media:statistics\b[^>]*>/i)?.[0] || ''

    return {
      videoId: extractXmlTag(entry, 'videoId') || '',
      title: extractXmlTag(entry, 'title') || '',
      url: extractAttribute(linkTag, 'href'),
      publishedAt: parseDate(extractXmlTag(entry, 'published')),
      thumbnail: extractAttribute(thumbnailTag, 'url'),
      views: Number.parseInt(extractAttribute(statisticsTag, 'views') || '0', 10) || 0,
      description: (extractXmlTag(entry, 'description') || '').slice(0, 200),
    }
  }).filter((entry) => entry.videoId && entry.title && entry.url)
}

export class YouTubeFetcher extends BaseAiHotspotFetcher {
  sourceId = 'youtube'
  sourceName = 'YouTube'

  async fetch() {
    const results = await Promise.all(
      YOUTUBE_CHANNELS.map(async (channel) => {
        try {
          const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`
          const videos = parseYouTubeEntries(await fetchHotspotText(feedUrl, { timeoutMs: 15000 }))
          return { channel, videos, error: null as string | null }
        } catch (error) {
          return {
            channel,
            videos: [],
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
    )

    const failedChannels = results.filter((result) => result.error)
    if (failedChannels.length === results.length) {
      throw new Error(`All YouTube feeds failed: ${failedChannels.map((failed) => failed.channel.name).join(', ')}`)
    }

    return results.flatMap(({ channel, videos }) => {
      return videos.map((video) => this.createItem({
        feedName: channel.name,
        title: video.title,
        url: video.url,
        publishedAt: video.publishedAt,
        meta: {
          channelId: channel.channelId,
          channelKey: channel.id,
          videoId: video.videoId,
          thumbnail: video.thumbnail,
          views: video.views,
          description: video.description,
          failedChannelCount: failedChannels.length,
          failedChannels: failedChannels.map((failed) => ({
            id: failed.channel.id,
            name: failed.channel.name,
            channelId: failed.channel.channelId,
            error: failed.error,
          })),
        },
      }))
    })
  }
}
