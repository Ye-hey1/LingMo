import type { AiHotspotRawItem, AiHotspotSourceKind, AiHotspotSourceStatus } from '../types'

export interface AiHotspotFetcherOptions {
  /** 上次成功拉取的时间戳，用于增量过滤 */
  lastFetchAt?: string | null
  /** 手动刷新时跳过条件请求与增量过滤 */
  force?: boolean
  /** 中断信号 */
  signal?: AbortSignal
}

export interface AiHotspotFetcher {
  sourceId: string
  sourceName: string
  kind: AiHotspotSourceKind
  fetch(now: Date, options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]>
}

export abstract class BaseAiHotspotFetcher implements AiHotspotFetcher {
  abstract sourceId: string
  abstract sourceName: string
  kind: AiHotspotSourceKind = 'default'

  abstract fetch(now: Date, options?: AiHotspotFetcherOptions): Promise<AiHotspotRawItem[]>

  protected createItem(params: {
    feedName: string
    title: string
    url: string
    publishedAt: Date | null
    meta?: Record<string, unknown>
  }): AiHotspotRawItem {
    return {
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      feedName: params.feedName,
      title: params.title,
      url: params.url,
      publishedAt: params.publishedAt,
      meta: params.meta || {},
    }
  }

  /**
   * 过滤掉早于 lastFetchAt 的条目，实现增量拉取。
   * 如果没有 lastFetchAt（首次拉取），返回全部条目。
   * 保留没有 publishedAt 的条目（无法判断新旧，宁可多留）。
   */
  protected filterByLastFetchAt(items: AiHotspotRawItem[], lastFetchAt?: string | null): AiHotspotRawItem[] {
    if (!lastFetchAt) return items

    const cutoff = Date.parse(lastFetchAt)
    if (!Number.isFinite(cutoff)) return items

    return items.filter(item => {
      // 没有发布时间的条目保留，避免遗漏
      if (!item.publishedAt) return true
      return item.publishedAt.getTime() >= cutoff
    })
  }
}

function nowIso() {
  return new Date().toISOString()
}

function getDurationMs(startedAt: number) {
  return Math.round(performance.now() - startedAt)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function successStatus(fetcher: AiHotspotFetcher, itemCount: number, startedAt: number): AiHotspotSourceStatus {
  const updatedAt = nowIso()

  return {
    sourceId: fetcher.sourceId,
    sourceName: fetcher.sourceName,
    kind: fetcher.kind,
    enabled: true,
    ok: true,
    itemCount,
    durationMs: getDurationMs(startedAt),
    lastOkAt: updatedAt,
    lastError: null,
    updatedAt,
  }
}

function failureStatus(fetcher: AiHotspotFetcher, error: unknown, startedAt: number): AiHotspotSourceStatus {
  return {
    sourceId: fetcher.sourceId,
    sourceName: fetcher.sourceName,
    kind: fetcher.kind,
    enabled: true,
    ok: false,
    itemCount: 0,
    durationMs: getDurationMs(startedAt),
    lastOkAt: null,
    lastError: getErrorMessage(error),
    updatedAt: nowIso(),
  }
}

export async function runAiHotspotFetcher(
  fetcher: AiHotspotFetcher,
  now: Date,
  options?: AiHotspotFetcherOptions,
) {
  const startedAt = performance.now()

  try {
    const items = await fetcher.fetch(now, options)
    return { items, status: successStatus(fetcher, items.length, startedAt) }
  } catch (error) {
    return { items: [], status: failureStatus(fetcher, error, startedAt) }
  }
}
