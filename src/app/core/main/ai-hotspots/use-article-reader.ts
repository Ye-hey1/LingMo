'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArticleFetchError,
  fetchArticle,
  prefetchArticle,
  type ArticleFetchResult,
} from '@/lib/web/fetch-article'
import type { AiHotspotItem } from '@/lib/ai-hotspots'
import { getWechatArticleUrl, isWechatArticleUrl } from '@/lib/wechat-article'
import { getAiHotspotItems } from '@/db/ai-hotspots'

export type ArticleStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ArticleReaderState {
  status: ArticleStatus
  result: ArticleFetchResult | null
  error: ArticleFetchError | null
  item: AiHotspotItem | null
}

const INITIAL: ArticleReaderState = { status: 'idle', result: null, error: null, item: null }
const ARTICLE_READER_TIMEOUT_MS = 15000
const WECHAT_READER_TIMEOUT_MS = 45000
const MIN_WECHAT_READABLE_LENGTH = 240
const MIN_INLINE_READABLE_LENGTH = 180

function getHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isAihotReaderUrl(value: string) {
  return getHost(value) === 'aihot.virxact.com'
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getStringMeta(target: AiHotspotItem, key: string) {
  const value = target.meta?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function createInlineFeedResult(target: AiHotspotItem): ArticleFetchResult | null {
  const html = getStringMeta(target, 'contentHtml')
  const markdown = getStringMeta(target, 'contentMarkdown')
  const text = getStringMeta(target, 'contentText')
  const summary = (target.summary || target.signalSummary || target.signalEssence || getStringMeta(target, 'summary')).trim()
  const bodyText = markdown || text || stripHtml(html) || summary
  const compactLength = bodyText.replace(/\s+/g, '').length
  const declaredLength = Number(target.meta?.contentLength || 0)
  const hasUsefulInlineContent = Boolean(html || markdown || text) && Math.max(compactLength, declaredLength) >= MIN_INLINE_READABLE_LENGTH
  if (!hasUsefulInlineContent) return null

  return {
    url: target.url,
    host: getHost(target.url),
    title: target.title || getHost(target.url),
    description: summary,
    html: html || undefined,
    markdown: markdown || text || summary,
    excerpt: summary || bodyText.slice(0, 500),
    thin: compactLength < MIN_INLINE_READABLE_LENGTH,
  }
}

function shouldPreferInlineFeedContent(target: AiHotspotItem, result: ArticleFetchResult | null) {
  if (!result) return false
  if (!isAihotReaderUrl(target.url)) return true

  const declaredLength = Number(target.meta?.contentLength || 0)
  const bodyLength = (result.markdown || stripHtml(result.html || '')).replace(/\s+/g, '').length
  return Math.max(declaredLength, bodyLength) >= 500
}

function createWechatSummaryResult(target: AiHotspotItem): ArticleFetchResult {
  const html = typeof target.meta?.wechatContentHtml === 'string'
    ? target.meta.wechatContentHtml.trim()
    : typeof target.meta?.contentHtml === 'string'
      ? target.meta.contentHtml.trim()
      : ''
  const markdown = typeof target.meta?.wechatContentMarkdown === 'string'
    ? target.meta.wechatContentMarkdown.trim()
    : typeof target.meta?.contentMarkdown === 'string'
      ? target.meta.contentMarkdown.trim()
      : ''
  const summary = (target.summary || target.signalSummary || target.signalEssence || '').trim()
  const body = markdown || [
    summary || '这篇微信公众号文章暂时只有 RSS 摘要。正文会在后台继续补采；也可以直接打开原文阅读。',
    '',
    `[打开原文](${target.url})`,
  ].join('\n')

  return {
    url: target.url,
    host: getHost(target.url),
    title: target.title || getHost(target.url),
    description: summary || '微信公众号文章正文将在后台尝试补采。',
    html,
    markdown: body,
    excerpt: summary || body.slice(0, 500),
    thin: !markdown,
  }
}

function getWechatFetchReason(target: AiHotspotItem) {
  const reason = typeof target.meta?.wechatContentFailReason === 'string'
    ? target.meta.wechatContentFailReason.trim()
    : typeof target.meta?.contentFailReason === 'string'
      ? target.meta.contentFailReason.trim()
      : ''
  if (reason) return reason
  if (target.meta?.wechatContentStatus === 'failed' || target.meta?.contentStatus === 'failed') {
    return '公众号正文抓取失败，已先显示 RSS 摘要。'
  }
  if (target.meta?.wechatContentStatus === 'summary_only' || target.meta?.contentStatus === 'summary_only') {
    return '公众号正文还没有补采完成，已先显示 RSS 摘要。'
  }
  return ''
}

function triggerWechatBackfill(target: AiHotspotItem) {
  void import('@/lib/ai-hotspots/wechat-content')
    .then(module => module.backfillWechatArticleContent([target]))
    .catch(error => {
      console.warn('[ai-hotspots] active wechat article backfill failed:', error)
    })
}

async function getLatestItemFromDb(target: AiHotspotItem) {
  try {
    return (await getAiHotspotItems()).find(item => item.id === target.id) || target
  } catch {
    return target
  }
}

function hasReadableWechatContent(target: AiHotspotItem) {
  const html = typeof target.meta?.wechatContentHtml === 'string'
    ? target.meta.wechatContentHtml.trim()
    : typeof target.meta?.contentHtml === 'string'
      ? target.meta.contentHtml.trim()
      : ''

  const markdown = typeof target.meta?.wechatContentMarkdown === 'string'
    ? target.meta.wechatContentMarkdown.trim()
    : typeof target.meta?.contentMarkdown === 'string'
      ? target.meta.contentMarkdown.trim()
      : ''
  if (markdown.replace(/\s+/g, '').length >= MIN_WECHAT_READABLE_LENGTH) return true
  if (!html) return false

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, '')
    .replace(/\s+/g, '')
  return text.length >= MIN_WECHAT_READABLE_LENGTH
}

function getReaderItemKey(item: AiHotspotItem) {
  return [
    item.url,
    item.meta?.wechatContentStatus,
    item.meta?.contentStatus,
    item.meta?.wechatContentFetchedAt,
    item.meta?.contentFetchedAt,
  ].filter(Boolean).join('|')
}

/**
 * 应用内文章阅读状态机。
 * - 自动随当前 item 变化抓取，并缓存结果，重复打开即时显示
 * - 支持手动重试与 Abort
 */
export function useArticleReader(item: AiHotspotItem | null) {
  const [state, setState] = useState<ArticleReaderState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const currentKeyRef = useRef<string | null>(null)

  const load = useCallback(async (target: AiHotspotItem, signal: AbortSignal) => {
    if (isWechatArticleUrl(target.url)) {
      const normalizedTarget = { ...target, url: getWechatArticleUrl(target.url) }
      const latestTarget = { ...await getLatestItemFromDb(target), url: normalizedTarget.url }
      if (signal.aborted) return

      if (hasReadableWechatContent(latestTarget)) {
        setState({ status: 'success', result: createWechatSummaryResult(latestTarget), error: null, item: latestTarget })
        return
      }

      setState({ status: 'loading', result: null, error: null, item: latestTarget })
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new ArticleFetchError('公众号正文抓取超时，已先显示 RSS 摘要。', 'network'))
          }, WECHAT_READER_TIMEOUT_MS)
        })
        const fetchedTarget = await Promise.race([
          import('@/lib/ai-hotspots/wechat-content')
            .then(module => module.fetchWechatArticleContentNow(latestTarget)),
          timeoutPromise,
        ])
        if (signal.aborted) return
        const fetchReason = getWechatFetchReason(fetchedTarget)
        setState({
          status: 'success',
          result: createWechatSummaryResult(fetchedTarget),
          error: fetchReason ? new ArticleFetchError(fetchReason, 'unknown') : null,
          item: fetchedTarget,
        })
        void import('@/db/ai-hotspots')
          .then(module => module.upsertAiHotspotItems([fetchedTarget]))
          .catch(error => console.warn('[ai-hotspots] save active wechat article failed:', error))
      } catch (error) {
        if (signal.aborted) return
        console.warn('[ai-hotspots] foreground wechat article fetch failed:', error)
        setState({
          status: 'success',
          result: createWechatSummaryResult(latestTarget),
          error: error instanceof ArticleFetchError ? error : new ArticleFetchError(error instanceof Error ? error.message : String(error), 'unknown'),
          item: latestTarget,
        })
        triggerWechatBackfill(latestTarget)
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
      return
    }

    const inlineResult = createInlineFeedResult(target)
    if (shouldPreferInlineFeedContent(target, inlineResult)) {
      setState({ status: 'success', result: inlineResult, error: null, item: target })
      return
    }

    setState({ status: 'loading', result: null, error: null, item: target })
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ArticleFetchError('抓取正文超时，已切换到可用的原文兜底视图。', 'network'))
        }, ARTICLE_READER_TIMEOUT_MS)
      })
      const result = await Promise.race([
        fetchArticle(target.url, {
          signal,
          fallbackTitle: target.title,
          fallbackSummary: target.summary || target.signalSummary || target.signalEssence,
          fallbackMarkdown: typeof target.meta?.wechatContentMarkdown === 'string'
            ? target.meta.wechatContentMarkdown
            : typeof target.meta?.contentMarkdown === 'string'
              ? target.meta.contentMarkdown
            : '',
        }),
        timeoutPromise,
      ])
      if (signal.aborted) return
      setState({ status: 'success', result, error: null, item: target })
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') return
      const fallbackInlineResult = createInlineFeedResult(target)
      if (fallbackInlineResult) {
        setState({
          status: 'success',
          result: fallbackInlineResult,
          error: err instanceof ArticleFetchError ? err : new ArticleFetchError(String(err), 'unknown'),
          item: target,
        })
        return
      }
      setState({
        status: 'error',
        result: null,
        error: err instanceof ArticleFetchError ? err : new ArticleFetchError(String(err), 'unknown'),
        item: target,
      })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    // 切换到空 item 时复位
    if (!item) {
      abortRef.current?.abort()
      setState(INITIAL)
      currentKeyRef.current = null
      return
    }

    // 同一 URL + 同一正文状态不重复抓取；后台补采完成后允许刷新显示全文。
    const itemKey = getReaderItemKey(item)
    if (currentKeyRef.current === itemKey) return
    currentKeyRef.current = itemKey

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    void load(item, controller.signal)
    return () => controller.abort()
  }, [item, load])

  const retry = useCallback(() => {
    if (!item) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    void load(item, controller.signal)
  }, [item, load])

  return { state, retry }
}

/** 列表层轻量预取：鼠标悬停 / 进入视口时静默预热 */
export function usePrefetchOnHover() {
  return useCallback((url?: string) => {
    if (url) prefetchArticle(url)
  }, [])
}
