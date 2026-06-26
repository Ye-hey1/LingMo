'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArticleFetchError,
  fetchArticle,
  prefetchArticle,
  type ArticleFetchResult,
} from '@/lib/web/fetch-article'
import type { AiHotspotItem } from '@/lib/ai-hotspots'

export type ArticleStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ArticleReaderState {
  status: ArticleStatus
  result: ArticleFetchResult | null
  error: ArticleFetchError | null
}

const INITIAL: ArticleReaderState = { status: 'idle', result: null, error: null }

/**
 * 应用内文章阅读状态机。
 * - 自动随当前 item 变化抓取，并缓存结果，重复打开即时显示
 * - 支持手动重试与 Abort
 */
export function useArticleReader(item: AiHotspotItem | null) {
  const [state, setState] = useState<ArticleReaderState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const currentUrlRef = useRef<string | null>(null)

  const load = useCallback(async (target: AiHotspotItem, signal: AbortSignal) => {
    setState({ status: 'loading', result: null, error: null })
    try {
      const result = await fetchArticle(target.url, signal)
      if (signal.aborted) return
      setState({ status: 'success', result, error: null })
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') return
      setState({
        status: 'error',
        result: null,
        error: err instanceof ArticleFetchError ? err : new ArticleFetchError(String(err), 'unknown'),
      })
    }
  }, [])

  useEffect(() => {
    // 切换到空 item 时复位
    if (!item) {
      abortRef.current?.abort()
      setState(INITIAL)
      currentUrlRef.current = null
      return
    }

    // 同一 URL 不重复抓取
    if (currentUrlRef.current === item.url) return
    currentUrlRef.current = item.url

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
