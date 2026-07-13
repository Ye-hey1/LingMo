import TurndownService from 'turndown'
import { fetchWechatMpArticleHtml } from '@/lib/wechat-mp-native'

export const WECHAT_ARTICLE_TAG_NAME = '公众号文章'
const WECHAT_HOST_RE = /(^|\.)mp\.weixin\.qq\.com$/i
const NON_WECHAT_READER_HOSTS = new Set([
  'aihot.virxact.com',
])

export interface WechatArticleResult {
  title: string
  accountName: string
  author: string
  publishedAt: string
  summary: string
  cover: string
  html: string
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

const SAFE_STYLE_PROPS = new Set([
  'text-align',
  'font-weight',
  'font-style',
  'font-size',
  'line-height',
  'color',
  'background-color',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
])

const TRANSPARENT_PIXEL_RE = /^data:image\/(?:gif|png|webp);base64,(?:r0lgodlh|iVBORw0KGgo|uKlGR)/i

function sanitizeStyle(value: string | null) {
  if (!value) return ''
  if (/expression\s*\(|javascript:|url\s*\(/i.test(value)) return ''
  return value
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf(':')
      if (index <= 0) return ''
      const prop = part.slice(0, index).trim().toLowerCase()
      const propValue = part.slice(index + 1).trim()
      if (!SAFE_STYLE_PROPS.has(prop)) return ''
      if (/position\s*:|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(part)) return ''
      if (/^(?:min-height|max-height|height|width|min-width|max-width)$/i.test(prop)) return ''
      return `${prop}: ${propValue}`
    })
    .filter(Boolean)
    .join('; ')
}

function cleanupWechatContent(root: HTMLElement) {
  root.querySelectorAll('script, style, iframe, wx-open-launch-app, wx-open-launch-weapp').forEach(node => node.remove())

  root.querySelectorAll('img').forEach((image) => {
    const src = normalizeImageUrl(
      image.getAttribute('data-src')
      || image.getAttribute('data-backsrc')
      || image.getAttribute('data-original')
      || image.getAttribute('data-origin-src')
      || image.getAttribute('data-croporisrc')
      || image.getAttribute('data-lazy-src')
      || image.getAttribute('src')
    )
    if (src && !TRANSPARENT_PIXEL_RE.test(src)) {
      image.setAttribute('src', src)
      image.setAttribute('data-src', src)
    } else if (!src || TRANSPARENT_PIXEL_RE.test(src)) {
      image.remove()
      return
    }
    image.removeAttribute('srcset')
    image.removeAttribute('data-srcset')
    image.removeAttribute('data-ratio')
    image.removeAttribute('data-w')
    image.removeAttribute('width')
    image.removeAttribute('height')
    image.removeAttribute('style')
    if (!image.getAttribute('alt')) {
      image.setAttribute('alt', cleanText(image.getAttribute('data-type')) || 'image')
    }
    image.setAttribute('loading', 'lazy')
  })

  root.querySelectorAll('a').forEach((link) => {
    const href = cleanText(link.getAttribute('href'))
    if (!href || href.startsWith('javascript:')) {
      link.removeAttribute('href')
    }
  })

  root.querySelectorAll<HTMLElement>('*').forEach((node) => {
    const style = sanitizeStyle(node.getAttribute('style'))
    if (style) {
      node.setAttribute('style', style)
    } else {
      node.removeAttribute('style')
    }
    node.removeAttribute('class')
    node.removeAttribute('id')
    node.removeAttribute('data-tools')
    node.removeAttribute('data-id')
    node.removeAttribute('contenteditable')
    node.removeAttribute('onclick')
    node.removeAttribute('onerror')
    node.removeAttribute('onload')
  })

  Array.from(root.querySelectorAll<HTMLElement>('p, section, span, div')).reverse().forEach((node) => {
    const hasMedia = Boolean(node.querySelector('img, video, table, svg'))
    const text = cleanText(node.textContent)
    if (!hasMedia && !text && node.children.length === 0) {
      node.remove()
    }
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

function normalizeWechatCandidateUrl(value: string) {
  const trimmed = value.trim().replace(/&amp;/g, '&')
  if (!trimmed) return null

  try {
    const direct = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (WECHAT_HOST_RE.test(direct.hostname)) return direct
    if (NON_WECHAT_READER_HOSTS.has(direct.hostname.toLowerCase())) return null

    for (const key of ['url', 'target', 'redirect', 'redirect_url', 'link']) {
      const nested = direct.searchParams.get(key)
      if (!nested) continue
      try {
        const nestedUrl = new URL(decodeURIComponent(nested))
        if (WECHAT_HOST_RE.test(nestedUrl.hostname)) return nestedUrl
      } catch {
        // keep checking other common wrapper params
      }
    }
  } catch {
    const match = trimmed.match(/https?:\/\/mp\.weixin\.qq\.com\/[^\s"'<>]+/i)
    if (match) {
      try {
        return new URL(match[0].replace(/&amp;/g, '&'))
      } catch {
        return null
      }
    }
  }

  return null
}

export function isWechatArticleUrl(value: string) {
  try {
    const url = normalizeWechatCandidateUrl(value)
    return Boolean(url)
      && (url!.pathname.startsWith('/s') || url!.searchParams.has('__biz') || url!.pathname.includes('/s/'))
  } catch {
    return false
  }
}

export function getWechatArticleUrl(value: string) {
  const url = normalizeWechatCandidateUrl(value)
  return url ? url.toString() : value
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
  const bodyHtml = clonedRoot.innerHTML.trim()
  const bodyMarkdown = htmlFragmentToMarkdown(bodyHtml)
  const compactBody = bodyMarkdown.replace(/\s+/g, '')
  const compactTitle = title.replace(/\s+/g, '')
  const hasImage = clonedRoot.querySelector('img[src]') !== null
  if (
    !bodyMarkdown
    || compactBody.length < 80
    || (!hasImage && compactTitle && compactBody === compactTitle)
  ) {
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
    html: bodyHtml,
    markdown: bodyMarkdown,
    desc,
    content,
  }
}

export async function fetchWechatArticleAsMarkdown(url: string): Promise<WechatArticleResult> {
  const articleUrl = getWechatArticleUrl(url)
  const nativeHtml = await fetchWechatMpArticleHtml(articleUrl)
  if (nativeHtml.trim()) {
    return parseWechatArticleHtml(nativeHtml, articleUrl)
  }
  throw new Error('微信公众号文章返回空正文')
}
