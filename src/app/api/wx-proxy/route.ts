export const runtime = 'nodejs'

const WECHAT_PAGE_HOST = 'mp.weixin.qq.com'
const IMAGE_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn']
const MAX_REDIRECTS = 5

function getTargetUrl(request: Request) {
  const raw = new URL(request.url).searchParams.get('url') || ''
  if (!raw) throw new Error('缺少 url 参数')

  const target = new URL(raw)
  if (target.protocol !== 'https:' || target.hostname !== WECHAT_PAGE_HOST) {
    throw new Error('只允许代理 mp.weixin.qq.com 的 HTTPS 页面')
  }
  return target
}

function toProxyImageUrl(raw: string) {
  try {
    const url = new URL(raw.replace(/&amp;/g, '&'))
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.includes(url.hostname)) return raw
    return `/api/wx-img?url=${encodeURIComponent(url.toString())}`
  } catch {
    return raw
  }
}

function isAllowedWechatPageUrl(url: URL) {
  return url.protocol === 'https:' && url.hostname === WECHAT_PAGE_HOST
}

async function fetchAllowedWechatPage(target: URL, init: RequestInit) {
  let current = target

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedWechatPageUrl(current)) {
      throw new Error('微信页面重定向到了不允许的域名')
    }

    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: current }
    }

    const location = response.headers.get('location')
    if (!location) {
      return { response, finalUrl: current }
    }

    current = new URL(location, current)
  }

  throw new Error('微信页面重定向次数过多')
}

function rewriteWechatHtml(html: string, targetUrl: string) {
  return html
    .replace(/https:\/\/mmbiz\.qpic\.cn\/[^"'\\\s<>)]+/g, value => toProxyImageUrl(value))
    .replace(/https:\/\/mmbiz\.qlogo\.cn\/[^"'\\\s<>)]+/g, value => toProxyImageUrl(value))
    .replace(/(href|src)=["']\/\//g, '$1="https://')
    .replace(/(href|src)=["']\/(?!\/)/g, `$1="https://${WECHAT_PAGE_HOST}/`)
    .replace(/<\/head>/i, `<base href="${targetUrl}"></head>`)
}

export async function GET(request: Request) {
  let target: URL
  try {
    target = getTargetUrl(request)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : '非法代理地址', { status: 400 })
  }

  let upstream: Response
  let finalUrl: URL
  try {
    const result = await fetchAllowedWechatPage(target, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://mp.weixin.qq.com/',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN',
      },
    })
    upstream = result.response
    finalUrl = result.finalUrl
  } catch (error) {
    return new Response(error instanceof Error ? error.message : '微信页面代理失败', { status: 400 })
  }

  const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8'
  const body = contentType.toLowerCase().includes('text/html')
    ? rewriteWechatHtml(await upstream.text(), finalUrl.toString())
    : await upstream.arrayBuffer()

  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' https://mmbiz.qpic.cn https://mmbiz.qlogo.cn data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri https://mp.weixin.qq.com; form-action 'none'; frame-ancestors 'self'",
    },
  })
}
