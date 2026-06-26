/**
 * 应用内文章阅读抓取器
 * ------------------------------
 * 通过 Tauri HTTP 插件（绕过 CORS）抓取网页，使用与「链接记录」一致的字符集解码管道，
 * 再交给 Readability + Turndown 转换为干净的 Markdown，供应用内阅读器渲染。
 *
 * 这套解码逻辑经过线上验证（见 control-link.tsx），支持 utf-8 / gb18030 / gbk / big5，
 * 以及 gzip / deflate 自动解压，避免中文站点乱码。
 */

import { parseWebPageContent } from './content-extractor'

export interface ArticleFetchResult {
  url: string
  host: string
  title: string
  description: string
  /** 已清洗的正文 Markdown（Readability 提取 + Turndown 转换） */
  markdown: string
  /** 纯文本摘要（用于空正文时的降级展示） */
  excerpt: string
  /** 最终正文是否疑似付费墙 / 纯 JS 渲染导致正文过短 */
  thin: boolean
}

export type ArticleFetchErrorCode =
  | 'http'
  | 'non_text'
  | 'network'
  | 'parse'
  | 'empty'
  | 'unknown'

export class ArticleFetchError extends Error {
  code: ArticleFetchErrorCode
  status?: number
  constructor(message: string, code: ArticleFetchErrorCode, status?: number) {
    super(message)
    this.name = 'ArticleFetchError'
    this.code = code
    this.status = status
  }
}

/** 进程内缓存：同一 URL 重复打开时即时返回 */
const memoryCache = new Map<string, ArticleFetchResult>()

function getHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function resolveFetcher(): Promise<typeof fetch> {
  try {
    const mod = await import('@tauri-apps/plugin-http')
    if (typeof mod.fetch === 'function') return mod.fetch as typeof fetch
  } catch {
    // 非 Tauri 环境（纯浏览器开发服务器）降级到原生 fetch
  }
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis)
  throw new ArticleFetchError('当前环境无法发起网络请求', 'network')
}

/* ----------------------------- 字符集解码管道 ----------------------------- */

function extractCharset(contentType: string | null): string | null {
  if (!contentType) return null
  const match = contentType.match(/charset=([^\s;]+)/i)
  return match?.[1]?.trim().toLowerCase() || null
}

function getTextScore(text: string): number {
  if (!text) return Number.NEGATIVE_INFINITY
  const length = text.length || 1
  const replacementRatio = (text.match(/\uFFFD/g) || []).length / length
  const controlRatio = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length / length
  let score = 0
  if (/<html[\s>]/i.test(text)) score += 40
  if (/<body[\s>]/i.test(text)) score += 20
  if (/<title[\s>]/i.test(text)) score += 10
  score -= replacementRatio * 300
  score -= controlRatio * 200
  return score
}

function looksLikeGarbledText(text: string): boolean {
  if (!text) return true
  if (text.length < 20) return false
  const replacementRatio = (text.match(/\uFFFD/g) || []).length / text.length
  if (replacementRatio > 0.02) return true
  const controlRatio = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length / text.length
  return controlRatio > 0.01
}

function decodeBestEffort(bytes: Uint8Array, contentType: string | null): string {
  const charset = extractCharset(contentType)
  const candidates = [charset, 'utf-8', 'gb18030', 'gbk', 'big5'].filter(
    (item, index, arr): item is string => !!item && arr.indexOf(item) === index,
  )
  let best = ''
  let bestScore = Number.NEGATIVE_INFINITY
  for (const encoding of candidates) {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes)
      const score = getTextScore(decoded)
      if (score > bestScore) {
        best = decoded
        bestScore = score
      }
    } catch {
      // 该编码不支持，跳过
    }
  }
  if (best) return best
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

async function decompressBytes(bytes: Uint8Array, encodingHeader: string): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  const encodings = encodingHeader.split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  if (encodings.length === 0) return null
  let result = bytes
  let decompressed = false
  for (let index = encodings.length - 1; index >= 0; index--) {
    const encoding = encodings[index]
    const format: 'gzip' | 'deflate' | null =
      encoding === 'x-gzip' || encoding === 'gzip' ? 'gzip' : encoding === 'deflate' ? 'deflate' : null
    if (!format) continue
    try {
      const stream = new Blob([result]).stream().pipeThrough(new DecompressionStream(format))
      const buffer = await new Response(stream).arrayBuffer()
      result = new Uint8Array(buffer)
      decompressed = true
    } catch {
      return null
    }
  }
  return decompressed ? result : null
}

async function extractResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')
  const contentEncoding = response.headers.get('content-encoding') || ''
  try {
    const sourceBytes = new Uint8Array(await response.arrayBuffer())
    let text = decodeBestEffort(sourceBytes, contentType)
    if (looksLikeGarbledText(text) && contentEncoding) {
      const decompressed = await decompressBytes(sourceBytes, contentEncoding)
      if (decompressed) {
        const decompressedText = decodeBestEffort(decompressed, contentType)
        if (!looksLikeGarbledText(decompressedText) || decompressedText.length > text.length) {
          text = decompressedText
        }
      }
    }
    if (!looksLikeGarbledText(text)) return text
  } catch (error) {
    console.warn('[fetch-article] decode fallback failed:', error)
  }
  return ''
}

/* ------------------------------- 主入口 ------------------------------- */

export async function fetchArticle(url: string, signal?: AbortSignal): Promise<ArticleFetchResult> {
  const cached = memoryCache.get(url)
  if (cached) return cached

  const fetcher = await resolveFetcher()
  let response: Response
  try {
    // Tauri http 插件支持的重定向 / 超时选项；浏览器会忽略多余字段
    const options = {
      method: 'GET',
      connectTimeout: 12000,
      maxRedirections: 5,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
      },
      signal,
    } as unknown as RequestInit
    response = await fetcher(url, options)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ArticleFetchError(
      error instanceof Error ? `无法访问该页面：${error.message}` : '无法访问该页面',
      'network',
    )
  }

  if (!response.ok) {
    throw new ArticleFetchError(`页面返回了 HTTP ${response.status}`, 'http', response.status)
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const isTextLike =
    !contentType ||
    contentType.includes('text/') ||
    contentType.includes('application/xhtml+xml') ||
    contentType.includes('application/xml') ||
    contentType.includes('application/json')
  if (!isTextLike) {
    throw new ArticleFetchError(`该链接不是可阅读的网页（${contentType || '未知类型'}）`, 'non_text')
  }

  const html = await extractResponseText(response)
  if (!html) {
    throw new ArticleFetchError('网页内容编码异常，无法稳定解码。', 'parse')
  }

  const parsed = parseWebPageContent(html, url, 24000, 8000)
  const markdown = parsed.mainContent || ''
  const excerpt = parsed.bodyText || parsed.metaDesc || ''
  const fullContent = markdown || excerpt

  if (!fullContent.trim()) {
    throw new ArticleFetchError('未能在页面中提取到正文内容。', 'empty')
  }

  // 正文过短 → 疑似付费墙 / 纯 JS 渲染，提示用户可打开原文
  const thin = markdown.replace(/\s/g, '').length < 240

  const result: ArticleFetchResult = {
    url,
    host: getHost(url),
    title: parsed.title || getHost(url),
    description: parsed.metaDesc,
    markdown: markdown || excerpt,
    excerpt,
    thin,
  }

  memoryCache.set(url, result)
  return result
}

/** 预热缓存（列表渲染时静默抓取，打开时即时显示） */
export function prefetchArticle(url: string) {
  if (!url || memoryCache.has(url)) return
  void fetchArticle(url).catch(() => {
    // 预热失败静默忽略，正式打开时会重试
  })
}

export function hasArticleCache(url: string) {
  return memoryCache.has(url)
}
