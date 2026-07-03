import { getAiHotspotItems, upsertAiHotspotItems } from '@/db/ai-hotspots'
import type { AiHotspotItem } from './types'
import { fetchWechatArticleAsMarkdown, isWechatArticleUrl } from '@/lib/wechat-article'
import { findSavedWechatArticle } from '@/lib/wechat-article-cache'
import emitter from '@/lib/emitter'

export type WechatContentStatus = 'summary_only' | 'fetching' | 'ready' | 'failed'

const BACKGROUND_LIMIT = 8
const MIN_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000
const FETCHING_STALE_MS = 5 * 60 * 1000
const HTML_UPGRADE_RETRY_MS = 10 * 60 * 1000
const MIN_READY_MARKDOWN_LENGTH = 240

function nowIso() {
  return new Date().toISOString()
}

function getFailCount(item: AiHotspotItem) {
  const value = Number(item.meta?.wechatContentFailCount || 0)
  return Number.isFinite(value) ? value : 0
}

function shouldFetchWechatContent(item: AiHotspotItem) {
  if (!isWechatArticleUrl(item.url)) return false
  if (item.meta?.wechatContentStatus === 'ready') {
    const markdown = typeof item.meta?.wechatContentMarkdown === 'string'
      ? item.meta.wechatContentMarkdown
      : typeof item.meta?.contentMarkdown === 'string'
        ? item.meta.contentMarkdown
        : ''
    const compactMarkdown = markdown.replace(/\s+/g, '')
    if (compactMarkdown.length < MIN_READY_MARKDOWN_LENGTH) {
      const lastAttempt = String(item.meta?.wechatContentFetchedAt || item.meta?.wechatContentAttemptedAt || '')
      const lastAttemptTime = lastAttempt ? Date.parse(lastAttempt) : 0
      return !Number.isFinite(lastAttemptTime) || lastAttemptTime <= 0 || Date.now() - lastAttemptTime > HTML_UPGRADE_RETRY_MS
    }
  }
  if (
    item.meta?.wechatContentStatus === 'ready'
    && (typeof item.meta?.wechatContentHtml !== 'string' || !item.meta.wechatContentHtml.trim())
  ) {
    const lastAttempt = String(item.meta?.wechatContentFetchedAt || item.meta?.wechatContentAttemptedAt || '')
    const lastAttemptTime = lastAttempt ? Date.parse(lastAttempt) : 0
    return !Number.isFinite(lastAttemptTime) || lastAttemptTime <= 0 || Date.now() - lastAttemptTime > HTML_UPGRADE_RETRY_MS
  }
  if (item.meta?.wechatContentStatus === 'ready') return false

  if (item.meta?.wechatContentStatus === 'fetching') {
    const attemptedAt = String(item.meta?.wechatContentAttemptedAt || item.meta?.contentFetchedAt || '')
    const attemptedTime = attemptedAt ? Date.parse(attemptedAt) : 0
    if (Number.isFinite(attemptedTime) && attemptedTime > 0 && Date.now() - attemptedTime < FETCHING_STALE_MS) {
      return false
    }
  }

  const lastAttempt = String(item.meta?.wechatContentFetchedAt || item.meta?.wechatContentAttemptedAt || '')
  const lastAttemptTime = lastAttempt ? Date.parse(lastAttempt) : 0
  if (Number.isFinite(lastAttemptTime) && lastAttemptTime > 0 && Date.now() - lastAttemptTime < MIN_RETRY_INTERVAL_MS) {
    return false
  }

  return getFailCount(item) < 3
}

function patchMeta(item: AiHotspotItem, patch: Record<string, unknown>): AiHotspotItem {
  return {
    ...item,
    meta: {
      ...(item.meta || {}),
      ...patch,
    },
  }
}

async function fetchOne(item: AiHotspotItem): Promise<AiHotspotItem> {
  const attemptedAt = nowIso()
  try {
    const saved = await findSavedWechatArticle(item.url)
    let contentSource = ''
    let markdown = ''
    let html = ''

    try {
      const direct = await fetchWechatArticleAsMarkdown(item.url)
      markdown = direct.markdown
      html = direct.html
      contentSource = 'native'
    } catch (error) {
      if (!saved?.record.body) throw error
      markdown = saved.record.body
      html = ''
      contentSource = 'link-tool'
    }

    if (markdown.replace(/\s+/g, '').length < MIN_READY_MARKDOWN_LENGTH && !html.trim()) {
      throw new Error('公众号原生抓取未返回完整可用正文')
    }

    return patchMeta(item, {
      wechatContentStatus: 'ready',
      contentStatus: 'ready',
      wechatContentMarkdown: markdown,
      wechatContentHtml: html,
      wechatContentHasContent: true,
      contentMarkdown: markdown,
      contentHtml: html,
      hasContent: true,
      contentFetchedAt: attemptedAt,
      contentFailReason: '',
      failCount: 0,
      wechatContentFetchedAt: attemptedAt,
      wechatContentAttemptedAt: attemptedAt,
      wechatContentFailReason: '',
      wechatContentFailCount: 0,
      wechatContentSource: contentSource || 'direct',
    })
  } catch (error) {
    return patchMeta(item, {
      wechatContentStatus: 'failed',
      contentStatus: 'failed',
      wechatContentHasContent: false,
      hasContent: false,
      wechatContentAttemptedAt: attemptedAt,
      wechatContentFailReason: error instanceof Error ? error.message : String(error),
      wechatContentFailCount: getFailCount(item) + 1,
      contentFailReason: error instanceof Error ? error.message : String(error),
      failCount: getFailCount(item) + 1,
    })
  }
}

export async function fetchWechatArticleContentNow(item: AiHotspotItem) {
  return fetchOne(item)
}

export function primeWechatSummaryState(items: AiHotspotItem[]) {
  return items.map(item => {
    if (!isWechatArticleUrl(item.url)) return item
    if (item.meta?.wechatContentStatus) return item
    return patchMeta(item, {
      wechatContentStatus: 'summary_only',
      contentStatus: 'summary_only',
      wechatContentHasContent: false,
      hasContent: false,
      wechatContentFailCount: 0,
      failCount: 0,
    })
  })
}

export async function backfillWechatArticleContent(items?: AiHotspotItem[]) {
  const sourceItems = items || await getAiHotspotItems()
  const candidates = sourceItems.filter(shouldFetchWechatContent).slice(0, BACKGROUND_LIMIT)
  if (candidates.length === 0) return { attempted: 0, updated: 0 }

  await upsertAiHotspotItems(candidates.map(item => patchMeta(item, {
    wechatContentStatus: 'fetching',
    contentStatus: 'fetching',
    wechatContentAttemptedAt: nowIso(),
  })))

  let updated = 0
  const updatedIds: string[] = []
  for (const item of candidates) {
    const nextItem = await fetchOne(item)
    await upsertAiHotspotItems([nextItem])
    updated += 1
    updatedIds.push(nextItem.id)
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }

  emitter.emit('ai-hotspots-items-updated', { ids: updatedIds })
  return { attempted: candidates.length, updated }
}
