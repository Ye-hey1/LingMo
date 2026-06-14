export * from './base'
export * from './aihot'
export * from './newsnow'
export * from './youtube'
export * from './default-rss'
export * from './user-rss'
export * from './wechat-rss'
export * from './extra-sources'

import { DefaultRssFetcher } from './default-rss'
import { NewsNowFetcher } from './newsnow'
import { WechatRssFetcher } from './wechat-rss'
import {
  BuzzingFetcher,
  ZeliFetcher,
  TechUrlsFetcher,
  IthomeFetcher,
  HuxiuFetcher,
  Kr36Fetcher,
  SspaiFetcher,
} from './extra-sources'
import type { AiHotspotFetcher } from './base'

export function createDefaultAiHotspotFetchers(): AiHotspotFetcher[] {
  return [
    new DefaultRssFetcher(),
    new NewsNowFetcher(),
    new WechatRssFetcher(),
    new BuzzingFetcher(),
    new ZeliFetcher(),
    new TechUrlsFetcher(),
    new IthomeFetcher(),
    new HuxiuFetcher(),
    new Kr36Fetcher(),
    new SspaiFetcher(),
  ]
}
