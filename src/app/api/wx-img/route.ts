export const runtime = 'nodejs'

const IMAGE_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn']
const MAX_REDIRECTS = 5

function getTargetUrl(request: Request) {
  const raw = new URL(request.url).searchParams.get('url') || ''
  if (!raw) throw new Error('缺少 url 参数')

  const target = new URL(raw)
  if (target.protocol !== 'https:' || !IMAGE_HOSTS.includes(target.hostname)) {
    throw new Error('只允许代理微信公众号图片域名')
  }
  return target
}

function isAllowedImageUrl(url: URL) {
  return url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname)
}

async function fetchAllowedWechatImage(target: URL, init: RequestInit) {
  let current = target

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedImageUrl(current)) {
      throw new Error('微信图片重定向到了不允许的域名')
    }

    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) return response
    current = new URL(location, current)
  }

  throw new Error('微信图片重定向次数过多')
}

export async function GET(request: Request) {
  let target: URL
  try {
    target = getTargetUrl(request)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : '非法图片代理地址', { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetchAllowedWechatImage(target, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: 'https://mp.weixin.qq.com/',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN',
      },
    })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : '微信图片代理失败', { status: 400 })
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Robots-Tag': 'noindex',
    },
  })
}
