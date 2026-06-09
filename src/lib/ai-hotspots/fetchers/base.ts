import type { AiHotspotRawItem, AiHotspotSourceKind, AiHotspotSourceStatus } from '../types'

export interface AiHotspotFetcher {
  sourceId: string
  sourceName: string
  kind: AiHotspotSourceKind
  fetch(now: Date): Promise<AiHotspotRawItem[]>
}

export abstract class BaseAiHotspotFetcher implements AiHotspotFetcher {
  abstract sourceId: string
  abstract sourceName: string
  kind: AiHotspotSourceKind = 'default'

  abstract fetch(now: Date): Promise<AiHotspotRawItem[]>

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

export async function runAiHotspotFetcher(fetcher: AiHotspotFetcher, now: Date) {
  const startedAt = performance.now()

  try {
    const items = await fetcher.fetch(now)
    return { items, status: successStatus(fetcher, items.length, startedAt) }
  } catch (error) {
    return { items: [], status: failureStatus(fetcher, error, startedAt) }
  }
}
