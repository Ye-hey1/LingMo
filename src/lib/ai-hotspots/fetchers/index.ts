export * from './base'
export * from './aihot'
export * from './newsnow'
export * from './youtube'
export * from './default-rss'
export * from './user-rss'

import { AiHotFetcher } from './aihot'
import { DefaultRssFetcher } from './default-rss'
import type { AiHotspotFetcher } from './base'
import { NewsNowFetcher } from './newsnow'
import { YouTubeFetcher } from './youtube'

export function createDefaultAiHotspotFetchers(): AiHotspotFetcher[] {
  return [
    new AiHotFetcher(),
    new NewsNowFetcher(),
    new YouTubeFetcher(),
    new DefaultRssFetcher(),
  ]
}
