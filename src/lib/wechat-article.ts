import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import TurndownService from 'turndown'

export const WECHAT_ARTICLE_TAG_NAME = '公众号文章'

export interface WechatArticleResult {
  title: string
  accountName: string
  author: string
  publishedAt: string
  summary: string
  cover: string
  markdown: string
  desc: string
  content: string
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlEntities(value: string) {
  if (!value) return ''
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${value}`, 'text/html')
  return doc.body.textContent || value
}

function decodeJsString(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
  )
}

function extractCharset(contentType: string | null) {
  if (!contentType) {
    return null
  }
  const match = contentType.match(/charset=([^\s;]+)/i)
  return match?.[1]?.trim().toLowerCase() || null
}

function decodeBytes(bytes: Uint8Array, contentType: string | null) {
  const charset = extractCharset(contentType)
  const candidates = [charset, 'utf-8', 'gb18030', 'gbk', 'big5']
    .filter((item, index, arr): item is string => !!item && arr.indexOf(item) === index)

  for (const encoding of candidates) {
    try {
      return new TextDecoder(encoding).decode(bytes)
    } catch {
      // continue
    }
  }

  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function extractJsString(html: string, name: string) {
  const pattern = new RegExp(`(?:var\\s+|window\\.)${escapeRegExp(name)}\\s*=\\s*(['"])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`)
  const match = html.match(pattern)
  return cleanText(match?.[2] ? decodeJsString(match[2]) : '')
}

function extractJsNumber(html: string, name: string) {
  const pattern = new RegExp(`(?:var\\s+|window\\.)${escapeRegExp(name)}\\s*=\\s*['"]?(\\d+)['"]?`)
  const match = html.match(pattern)
  return match?.[1] ? Number(match[1]) : 0
}

function formatTimestamp(seconds: number) {
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeImageUrl(value?: string | null) {
  const url = cleanText(value)
  if (!url) return ''
  return url.startsWith('//') ? `https:${url}` : url
}

function getWechatArticleBody(doc: Document) {
  return doc.querySelector<HTMLElement>('#js_content')
    || doc.querySelector<HTMLElement>('[id="js_content"]')
    || doc.querySelector<HTMLElement>('.rich_media_content')
    || doc.querySelector<HTMLElement>('.rich_media_area_primary_inner')
    || doc.querySelector<HTMLElement>('.rich_media_area_primary')
    || doc.querySelector<HTMLElement>('#page-content')
    || doc.querySelector<HTMLElement>('article')
}

function getWechatPageHint(html: string, doc: Document) {
  const text = cleanText(doc.body?.textContent || html).slice(0, 500)
  if (/环境异常|访问频繁|请稍后再试|验证码|安全验证|verify/i.test(text)) {
    return '微信返回了安全验证或访问限制页面，无法直接提取正文。'
  }
  if (/请在微信客户端打开|在微信中打开|WeChat/i.test(text)) {
    return '微信返回了客户端打开提示页，当前链接可能需要在微信内访问。'
  }
  if (/链接已过期|该内容已被发布者删除|内容不存在|已删除/i.test(text)) {
    return '文章链接已过期、被删除或不可访问。'
  }
  if (/not supported|unsupported browser|浏览器/i.test(text)) {
    return '微信返回了浏览器兼容提示页，未返回文章正文。'
  }
  return text ? `页面未包含标准正文节点。页面提示：${text}` : '页面未包含标准正文节点。'
}

function cleanupWechatContent(root: HTMLElement) {
  root.querySelectorAll('script, style, iframe, wx-open-launch-app, wx-open-launch-weapp').forEach(node => node.remove())

  root.querySelectorAll('img').forEach((image) => {
    const src = normalizeImageUrl(
      image.getAttribute('data-src')
      || image.getAttribute('data-backsrc')
      || image.getAttribute('src')
    )
    if (src) {
      image.setAttribute('src', src)
    }
    if (!image.getAttribute('alt')) {
      image.setAttribute('alt', cleanText(image.getAttribute('data-type')) || 'image')
    }
  })

  root.querySelectorAll('a').forEach((link) => {
    const href = cleanText(link.getAttribute('href'))
    if (!href || href.startsWith('javascript:')) {
      link.removeAttribute('href')
    }
  })

  root.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.removeAttribute('style')
    node.removeAttribute('class')
    node.removeAttribute('id')
  })
}

function htmlFragmentToMarkdown(html: string) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td'])
  turndown.addRule('wechatImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const image = node as HTMLImageElement
      const src = normalizeImageUrl(image.getAttribute('src'))
      if (!src) return ''
      const alt = cleanText(image.getAttribute('alt')) || 'image'
      return `\n\n![${alt}](${src})\n\n`
    },
  })
  turndown.addRule('lineBreak', {
    filter: 'br',
    replacement: () => '\n',
  })

  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function isWechatArticleUrl(value: string) {
  try {
    const url = new URL(value.trim().startsWith('http') ? value.trim() : `https://${value.trim()}`)
    return url.hostname === 'mp.weixin.qq.com'
      && (url.pathname.startsWith('/s') || url.searchParams.has('__biz'))
  } catch {
    return false
  }
}

export function parseWechatArticleHtml(html: string, url: string): WechatArticleResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const contentRoot = getWechatArticleBody(doc)
  if (!contentRoot) {
    throw new Error(getWechatPageHint(html, doc))
  }

  const title = cleanText(
    extractJsString(html, 'msg_title')
    || doc.querySelector('#activity-name')?.textContent
    || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || doc.title
    || '微信公众号文章'
  )
  const summary = cleanText(
    extractJsString(html, 'msg_desc')
    || doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
    || doc.querySelector('meta[name="description"]')?.getAttribute('content')
  )
  const accountName = cleanText(
    extractJsString(html, 'nickname')
    || doc.querySelector('#js_name')?.textContent
    || doc.querySelector('.profile_meta_value')?.textContent
  )
  const author = cleanText(
    doc.querySelector('#js_author_name')?.textContent
    || doc.querySelector('.rich_media_meta_text')?.textContent
  )
  const publishedAt = formatTimestamp(extractJsNumber(html, 'ct'))
  const cover = normalizeImageUrl(
    extractJsString(html, 'msg_cdn_url')
    || doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
  )

  const clonedRoot = contentRoot.cloneNode(true) as HTMLElement
  cleanupWechatContent(clonedRoot)
  const bodyMarkdown = htmlFragmentToMarkdown(clonedRoot.innerHTML)
  if (!bodyMarkdown || bodyMarkdown.replace(/\s+/g, '').length < 20) {
    throw new Error('微信公众号正文解析结果为空')
  }

  const extractedAt = formatDateTime(Date.now())
  const meta = [
    accountName ? `- 来源：${accountName}` : '',
    author ? `- 作者：${author}` : '',
    publishedAt ? `- 发布时间：${publishedAt}` : '',
    `- 原文链接：${url}`,
    `- 提取时间：${extractedAt}`,
    summary ? `- 摘要：${summary}` : '',
  ].filter(Boolean).join('\n')

  const content = [
    `<!-- lingmo:wechat-article ${JSON.stringify({
      url,
      title,
      accountName,
      author,
      publishedAt,
      extractedAt: Date.now(),
    })} -->`,
    `# ${title}`,
    '',
    meta,
    '',
    cover ? `![封面图](${cover})\n` : '',
    '---',
    '',
    bodyMarkdown,
  ].filter(Boolean).join('\n')

  const desc = [
    title,
    accountName ? `公众号：${accountName}` : '',
    summary,
  ].filter(Boolean).join('\n')

  return {
    title,
    accountName,
    author,
    publishedAt,
    summary,
    cover,
    markdown: bodyMarkdown,
    desc,
    content,
  }
}

export async function fetchWechatArticleAsMarkdown(url: string): Promise<WechatArticleResult> {
  const requestHeaders = [
    {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      Referer: 'https://mp.weixin.qq.com/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN',
    },
    {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      Referer: 'https://mp.weixin.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MicroMessenger/8.0.49',
    },
  ]

  let lastError: unknown = null

  for (const headers of requestHeaders) {
    try {
      const response = await tauriFetch(url, {
        method: 'GET',
        connectTimeout: 12000,
        maxRedirections: 5,
        headers,
      })

      if (!response.ok) {
        throw new Error(`微信公众号文章抓取失败（HTTP ${response.status}）`)
      }

      const html = decodeBytes(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
      return parseWechatArticleHtml(html, url)
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw new Error('微信公众号文章解析失败')
}
