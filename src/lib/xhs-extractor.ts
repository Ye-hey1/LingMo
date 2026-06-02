import { fetchWithProxy } from '@/lib/network-proxy'

export interface XhsNoteData {
  type: 'normal' | 'video'
  title: string
  desc: string
  imageList: string[]
  videoUrl?: string
  author: string
  authorAvatar?: string
  noteId: string
}

/**
 * 判定是否为小红书链接
 */
export function isXhsUrl(url: string): boolean {
  if (!url) return false
  try {
    const trimmed = url.trim()
    const hostname = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '')
    return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com') || hostname === 'xhslink.com'
  } catch {
    return url.includes('xiaohongshu.com') || url.includes('xhslink.com')
  }
}

/**
 * 针对 xhslink.com 发起请求，跟随 302 重定向以获取真实的长链接
 */
export async function resolveXhsShortLink(url: string): Promise<string> {
  const normalized = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`
  try {
    const response = await fetchWithProxy(normalized, {
      method: 'GET',
      maxRedirections: 5,
      connectTimeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
    })
    return response.url || normalized
  } catch (error) {
    console.warn('[XHS Extractor] Failed to resolve short link, using original:', error)
    return normalized
  }
}

/**
 * 从小红书的完整链接中截取 noteId
 */
export function extractXhsNoteId(url: string): string {
  try {
    const parsed = new URL(url)
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    
    const exploreIndex = pathSegments.indexOf('explore')
    if (exploreIndex !== -1 && pathSegments[exploreIndex + 1]) {
      return pathSegments[exploreIndex + 1].split('?')[0]
    }
    
    const itemIndex = pathSegments.indexOf('item')
    if (itemIndex !== -1 && pathSegments[itemIndex + 1]) {
      return pathSegments[itemIndex + 1].split('?')[0]
    }

    const match = url.match(/\/explore\/([a-zA-Z0-9]+)/) || url.match(/\/item\/([a-zA-Z0-9]+)/)
    if (match?.[1]) {
      return match[1]
    }
    
    return ''
  } catch {
    const match = url.match(/\/explore\/([a-zA-Z0-9]+)/) || url.match(/\/item\/([a-zA-Z0-9]+)/)
    return match?.[1] || ''
  }
}

/**
 * 递归高容错提取 window.__INITIAL_STATE__ 中所需的笔记数据
 */
function extractNoteDetail(state: any, noteId: string): any {
  if (!state) return null

  if (state.note?.noteDetailMap?.[noteId]) {
    return state.note.noteDetailMap[noteId]
  }

  if (state.noteDetailMap?.[noteId]) {
    return state.noteDetailMap[noteId]
  }

  if (state.note?.note) {
    return { note: state.note.note }
  }

  for (const key of Object.keys(state)) {
    if (state[key] && typeof state[key] === 'object') {
      if (state[key].noteDetailMap?.[noteId]) {
        return state[key].noteDetailMap[noteId]
      }
      if (state[key].note?.noteDetailMap?.[noteId]) {
        return state[key].note.noteDetailMap[noteId]
      }
    }
  }

  return null
}

/**
 * 本地解耦 HTML 解析器：从 HTML 源码中匹配 window.__INITIAL_STATE__ 并捕获无水印音视频/大图
 */
export function parseXhsHtml(html: string, url: string): XhsNoteData {
  const noteId = extractXhsNoteId(url)
  if (!noteId) {
    throw new Error('无法从小红书链接中提取出有效的笔记 ID，请确认链接格式。')
  }

  // 1. 正则捕获 window.__INITIAL_STATE__
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*(?:<\/script>|\(function)/)
    || html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/)
  
  if (!match?.[1]) {
    throw new Error('未能在小红书 HTML 源码中定位到初始状态数据（window.__INITIAL_STATE__），请确认已完整复制网页的源代码（Ctrl+U 复制全部）。')
  }

  // 2. 反序列化状态 JSON
  let state: any = null
  try {
    const sanitizedJson = match[1].replace(/:undefined/g, ':null')
    state = JSON.parse(sanitizedJson)
  } catch (err) {
    throw new Error(`解析小红书数据对象失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. 提取笔记详情
  const detail = extractNoteDetail(state, noteId)
  const noteData = detail?.note || detail || state.note?.note

  if (!noteData) {
    throw new Error('未能在初始状态中匹配到该小红书笔记的元数据。若是本地粘贴，请在小红书笔记详情页面查看源代码并复制。')
  }

  const title = (noteData.title || '').trim()
  const desc = (noteData.desc || '').trim()
  const author = (noteData.user?.nickname || '').trim() || '小红书创作者'
  const authorAvatar = noteData.user?.avatar || undefined
  const type = noteData.type === 'video' ? 'video' : 'normal'

  // 4. 提取无水印高清图片
  let imageList: string[] = []
  if (noteData.imageList && Array.isArray(noteData.imageList)) {
    imageList = noteData.imageList.map((img: any) => {
      const rawUrl = img.urlDefault || img.urlSource || img.url || ''
      return rawUrl ? rawUrl.split('!')[0] : ''
    }).filter(Boolean)
  }

  // 5. 提取无水印视频直链
  let videoUrl: string | undefined
  if (type === 'video' && noteData.video?.media?.stream) {
    const stream = noteData.video.media.stream
    const videoItems = stream.h264 || stream.h265 || stream.av1 || []
    if (videoItems.length > 0) {
      videoUrl = videoItems[0].masterUrl || videoItems[0].url || ''
    }
  }

  return {
    type,
    title,
    desc,
    imageList,
    videoUrl,
    author,
    authorAvatar,
    noteId
  }
}

/**
 * 联网抓取小红书网页 HTML 并解析出无水印图集或视频直链
 */
export async function fetchXhsNoteData(url: string): Promise<XhsNoteData> {
  let targetUrl = url
  if (url.includes('xhslink.com')) {
    targetUrl = await resolveXhsShortLink(url)
  }

  const noteId = extractXhsNoteId(targetUrl)
  if (!noteId) {
    throw new Error('无法从小红书链接中提取出有效的笔记 ID，请确认链接格式。')
  }

  const requestUrl = `https://www.xiaohongshu.com/explore/${noteId}`

  const response = await fetchWithProxy(requestUrl, {
    method: 'GET',
    connectTimeout: 12000,
    maxRedirections: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.xiaohongshu.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
  })

  if (!response.ok) {
    throw new Error(`获取小红书页面失败（HTTP ${response.status}）。该链接可能已失效或受到平台防爬虫限制。`)
  }

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  
  let html = ''
  try {
    html = new TextDecoder('utf-8').decode(bytes)
  } catch {
    html = new TextDecoder().decode(bytes)
  }

  // 联网获取到 HTML 后，直接复用 parseXhsHtml 方法解析，极度整洁！
  return parseXhsHtml(html, targetUrl)
}
