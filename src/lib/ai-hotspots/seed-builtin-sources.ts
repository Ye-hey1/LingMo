import { Store } from '@tauri-apps/plugin-store'
import { getAiHotspotUserFeeds, addAiHotspotUserFeed } from '@/db/ai-hotspots'
import { ALL_BUILTIN_SOURCES, getBuiltinSourceGroupId, type BuiltinSource } from './builtin-sources'

const STORE_FILE = 'store.json'
const DELETED_BUILTIN_SOURCE_URLS_KEY = 'aiHotspotsDeletedBuiltinSourceUrls'

function normalizeFeedUrl(feedUrl: string): string {
  return feedUrl.trim().toLowerCase()
}

async function loadDeletedBuiltinSourceUrls(): Promise<Set<string>> {
  const store = await Store.load(STORE_FILE)
  const urls = await store.get<string[]>(DELETED_BUILTIN_SOURCE_URLS_KEY)
  return new Set(
    (Array.isArray(urls) ? urls : [])
      .map(normalizeFeedUrl)
      .filter(Boolean),
  )
}

export async function rememberDeletedBuiltinSource(feedUrl: string): Promise<void> {
  const urlKey = normalizeFeedUrl(feedUrl)
  if (!urlKey) return

  const store = await Store.load(STORE_FILE)
  const urls = await store.get<string[]>(DELETED_BUILTIN_SOURCE_URLS_KEY)
  const nextUrls = new Set(
    (Array.isArray(urls) ? urls : [])
      .map(normalizeFeedUrl)
      .filter(Boolean),
  )
  nextUrls.add(urlKey)
  await store.set(DELETED_BUILTIN_SOURCE_URLS_KEY, Array.from(nextUrls))
  await store.save()
}

export async function forgetDeletedBuiltinSource(feedUrl: string): Promise<void> {
  const urlKey = normalizeFeedUrl(feedUrl)
  if (!urlKey) return

  const store = await Store.load(STORE_FILE)
  const urls = await store.get<string[]>(DELETED_BUILTIN_SOURCE_URLS_KEY)
  const nextUrls = (Array.isArray(urls) ? urls : [])
    .map(normalizeFeedUrl)
    .filter(url => url && url !== urlKey)
  await store.set(DELETED_BUILTIN_SOURCE_URLS_KEY, Array.from(new Set(nextUrls)))
  await store.save()
}

/**
 * 确保所有内置源都已写入 user_feeds 表
 * 首次加载时自动执行，不会覆盖用户已有的修改
 */
export async function seedBuiltinSources(): Promise<void> {
  const existingFeeds = await getAiHotspotUserFeeds()
  const existingUrls = new Set(existingFeeds.map(f => f.feedUrl.trim().toLowerCase()))
  const deletedBuiltinUrls = await loadDeletedBuiltinSourceUrls()

  for (const source of ALL_BUILTIN_SOURCES) {
    const urlKey = normalizeFeedUrl(source.url)
    if (existingUrls.has(urlKey) || deletedBuiltinUrls.has(urlKey)) continue

    try {
      await addAiHotspotUserFeed({
        id: source.id,
        title: source.title,
        feedUrl: source.url,
        groupName: getBuiltinSourceGroupId(source.type),
        enabled: source.defaultEnabled,
      })
    } catch {
      // ignore duplicate errors
    }
  }
}

/**
 * 判断一个 user_feed 是否为内置源
 */
export function isBuiltinFeed(feedUrl: string): boolean {
  const urlKey = normalizeFeedUrl(feedUrl)
  return ALL_BUILTIN_SOURCES.some(s => normalizeFeedUrl(s.url) === urlKey)
}

/**
 * 根据 feedUrl 获取内置源配置
 */
export function getBuiltinSourceByFeedUrl(feedUrl: string): BuiltinSource | undefined {
  const urlKey = normalizeFeedUrl(feedUrl)
  return ALL_BUILTIN_SOURCES.find(s => normalizeFeedUrl(s.url) === urlKey)
}

/**
 * 根据 id 获取内置源配置
 */
export function getBuiltinSourceById(id: string): BuiltinSource | undefined {
  return ALL_BUILTIN_SOURCES.find(s => s.id === id)
}
