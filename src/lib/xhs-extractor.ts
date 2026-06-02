import { fetchWithProxy } from '@/lib/network-proxy'

export const XHS_NOTE_TAG_NAME = '小红书笔记'

export interface XhsNoteData {
  type: 'normal' | 'video'
  title: string
  desc: string
  imageList: string[]
  videoUrl?: string
  author: string
  authorAvatar?: string
  userId?: string
  homeUrl?: string
  noteId: string
  sourceUrl: string
  likedCount?: string
  collectedCount?: string
  commentCount?: string
  shareCount?: string
  tags?: string[]
  uploadTime?: string
  ipLocation?: string
}

export interface XhsNoteRecord {
  title: string
  desc: string
  content: string
  url: string
}

function cleanText(value?: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function toArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatTimestamp(value: unknown) {
  const raw = typeof value === 'number' ? value : Number(cleanText(value))
  if (!Number.isFinite(raw) || raw <= 0) return ''
  const timestamp = raw < 10_000_000_000 ? raw * 1000 : raw
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeCdnUrl(value?: unknown) {
  const url = cleanText(value)
  if (!url) return ''
  const normalized = url.startsWith('//') ? `https:${url}` : url
  return normalized.split('!')[0]
}

function toNoWatermarkImageUrl(value?: unknown) {
  const url = normalizeCdnUrl(value)
  if (!url || !/(xhscdn|xiaohongshu)/i.test(url)) return url

  try {
    let token = ''
    if (url.includes('notes_pre_post/')) {
      token = `notes_pre_post/${url.split('notes_pre_post/')[1].split('?', 1)[0]}`
    } else if (url.includes('spectrum')) {
      token = url.split('/').slice(-2).join('/').split('?', 1)[0]
    } else if (url.includes('.jpg')) {
      token = url.split('/').slice(-3).join('/').split('?', 1)[0]
    } else {
      token = url.split('/').pop()?.split('?', 1)[0] || ''
    }
    return token ? `https://ci.xiaohongshu.com/${token}?imageView2/format/jpeg` : url
  } catch {
    return url
  }
}

function pickImageUrl(image: any) {
  const infoList = toArray(image?.info_list || image?.infoList)
  return toNoWatermarkImageUrl(
    image?.urlDefault
    || image?.urlSource
    || image?.url_default
    || image?.url_source
    || infoList[1]?.url
    || infoList[0]?.url
    || image?.url
  )
}

function pickVideoUrl(noteCard: any) {
  const video = noteCard?.video || {}
  const stream = video?.media?.stream || {}
  const streamItems = [
    ...toArray(stream.h264),
    ...toArray(stream.h265),
    ...toArray(stream.av1),
  ]
  for (const item of streamItems) {
    const url = normalizeCdnUrl(item?.masterUrl || item?.master_url || item?.url)
    if (url) return url
  }

  const originKey = firstText(video?.consumer?.origin_video_key, video?.consumer?.originVideoKey)
  return originKey ? `https://sns-video-bd.xhscdn.com/${originKey}` : ''
}

function normalizeXhsNote(raw: any, noteId: string, sourceUrl: string): XhsNoteData {
  const container = raw?.note || raw
  const noteCard = container?.note_card || container?.noteCard || container
  const user = noteCard?.user || noteCard?.user_info || noteCard?.userInfo || container?.user || {}
  const actualNoteId = firstText(container?.id, noteCard?.id, noteCard?.note_id, noteCard?.noteId, noteId)
  const type = cleanText(noteCard?.type || container?.type).toLowerCase() === 'video' ? 'video' : 'normal'
  const userId = firstText(user?.user_id, user?.userId, noteCard?.user_id, noteCard?.userId)
  const imageList = uniq(toArray(noteCard?.image_list || noteCard?.imageList || container?.imageList)
    .map(pickImageUrl))
  const videoUrl = type === 'video' ? pickVideoUrl(noteCard) : ''
  const tags = uniq(toArray(noteCard?.tag_list || noteCard?.tagList || container?.tagList)
    .map((tag: any) => firstText(tag?.name, tag?.title, tag)))
  const interactInfo = noteCard?.interact_info || noteCard?.interactInfo || container?.interact_info || container?.interactInfo || {}

  return {
    type,
    title: firstText(noteCard?.title, container?.title) || '无标题',
    desc: firstText(noteCard?.desc, noteCard?.description, container?.desc, container?.description),
    imageList,
    videoUrl: videoUrl || undefined,
    author: firstText(user?.nickname, user?.nickName, user?.name) || '小红书创作者',
    authorAvatar: normalizeCdnUrl(user?.avatar || user?.image || user?.imageb) || undefined,
    userId: userId || undefined,
    homeUrl: userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : undefined,
    noteId: actualNoteId,
    sourceUrl,
    likedCount: firstText(interactInfo?.liked_count, interactInfo?.likedCount),
    collectedCount: firstText(interactInfo?.collected_count, interactInfo?.collectedCount),
    commentCount: firstText(interactInfo?.comment_count, interactInfo?.commentCount),
    shareCount: firstText(interactInfo?.share_count, interactInfo?.shareCount),
    tags,
    uploadTime: formatTimestamp(firstText(noteCard?.time, noteCard?.create_time, noteCard?.createTime, container?.time)),
    ipLocation: firstText(noteCard?.ip_location, noteCard?.ipLocation, container?.ip_location, container?.ipLocation),
  }
}

function extractJsonAfterMarker(html: string, marker: string) {
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) return null
  const start = html.indexOf('{', markerIndex)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false

  for (let index = start; index < html.length; index += 1) {
    const char = html[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return html.slice(start, index + 1)
      }
    }
  }

  return null
}

function extractMetaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return cleanText(match[1])
  }
  return ''
}

function parseXhsMetaHtml(html: string, url: string): XhsNoteData | null {
  const noteId = extractXhsNoteId(url)
  const title = firstText(extractMetaContent(html, 'og:title'), html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  const desc = firstText(extractMetaContent(html, 'og:description'), extractMetaContent(html, 'description'))
  const image = normalizeCdnUrl(extractMetaContent(html, 'og:image'))
  const videoUrl = normalizeCdnUrl(extractMetaContent(html, 'og:video'))
  if (!noteId || (!title && !desc && !image && !videoUrl)) {
    return null
  }

  return {
    type: videoUrl ? 'video' : 'normal',
    title: title || '小红书笔记',
    desc,
    imageList: image ? [image] : [],
    videoUrl: videoUrl || undefined,
    author: '小红书创作者',
    noteId,
    sourceUrl: url,
  }
}

function buildXhsRequestUrl(url: string, noteId: string) {
  try {
    const parsed = new URL(url)
    const params = new URLSearchParams()
    const xsecToken = parsed.searchParams.get('xsec_token')
    const xsecSource = parsed.searchParams.get('xsec_source')
    if (xsecToken) params.set('xsec_token', xsecToken)
    if (xsecSource) params.set('xsec_source', xsecSource)
    const suffix = params.toString()
    return `https://www.xiaohongshu.com/explore/${noteId}${suffix ? `?${suffix}` : ''}`
  } catch {
    return `https://www.xiaohongshu.com/explore/${noteId}`
  }
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
    const normalized = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`
    const parsed = new URL(normalized)
    const noteIdFromQuery = parsed.searchParams.get('note_id')
      || parsed.searchParams.get('noteId')
      || parsed.searchParams.get('source_note_id')
      || parsed.searchParams.get('sourceNoteId')
    if (noteIdFromQuery) {
      return noteIdFromQuery
    }

    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    
    const exploreIndex = pathSegments.indexOf('explore')
    if (exploreIndex !== -1 && pathSegments[exploreIndex + 1]) {
      return pathSegments[exploreIndex + 1].split('?')[0]
    }
    
    const itemIndex = pathSegments.indexOf('item')
    if (itemIndex !== -1 && pathSegments[itemIndex + 1]) {
      return pathSegments[itemIndex + 1].split('?')[0]
    }

    const discoveryIndex = pathSegments.indexOf('discovery')
    if (discoveryIndex !== -1 && pathSegments[discoveryIndex + 2]) {
      return pathSegments[discoveryIndex + 2].split('?')[0]
    }

    const match = url.match(/\/explore\/([a-zA-Z0-9]+)/)
      || url.match(/\/item\/([a-zA-Z0-9]+)/)
      || url.match(/\/discovery\/item\/([a-zA-Z0-9]+)/)
    if (match?.[1]) {
      return match[1]
    }
    
    return ''
  } catch {
    const match = url.match(/(?:note_id|noteId|source_note_id|sourceNoteId)=([a-zA-Z0-9]+)/)
      || url.match(/\/explore\/([a-zA-Z0-9]+)/)
      || url.match(/\/item\/([a-zA-Z0-9]+)/)
      || url.match(/\/discovery\/item\/([a-zA-Z0-9]+)/)
    return match?.[1] || ''
  }
}

/**
 * 递归高容错提取 window.__INITIAL_STATE__ 中所需的笔记数据
 */
function extractNoteDetail(state: any, noteId: string): any {
  if (!state) return null

  const apiItem = toArray(state?.data?.items).find((item: any) => {
    return firstText(item?.id, item?.note_id, item?.noteId) === noteId
  })
  if (apiItem) return apiItem

  if (state.note?.noteDetailMap?.[noteId]) {
    return state.note.noteDetailMap[noteId]
  }

  if (state.noteDetailMap?.[noteId]) {
    return state.noteDetailMap[noteId]
  }

  if (state.note?.note) {
    return { note: state.note.note }
  }

  const seen = new WeakSet<object>()
  const walk = (value: any, depth = 0): any => {
    if (!value || typeof value !== 'object' || depth > 8) return null
    if (seen.has(value)) return null
    seen.add(value)

    if (value.noteDetailMap?.[noteId]) return value.noteDetailMap[noteId]
    if (value.note?.noteDetailMap?.[noteId]) return value.note.noteDetailMap[noteId]
    if (
      firstText(value?.id, value?.note_id, value?.noteId) === noteId
      && (value.note_card || value.noteCard || value.title || value.desc)
    ) {
      return value
    }

    for (const child of Object.values(value)) {
      const found = walk(child, depth + 1)
      if (found) return found
    }
    return null
  }

  return walk(state)
}

/**
 * 本地解耦 HTML 解析器：从 HTML 源码中匹配 window.__INITIAL_STATE__ 并捕获无水印音视频/大图
 */
export function parseXhsHtml(html: string, url: string): XhsNoteData {
  const noteId = extractXhsNoteId(url)
  if (!noteId) {
    throw new Error('无法从小红书链接中提取出有效的笔记 ID，请确认链接格式。')
  }

  // 1. 捕获 window.__INITIAL_STATE__。若平台只返回基础 meta，退回 meta 提取。
  const initialState = extractJsonAfterMarker(html, 'window.__INITIAL_STATE__')
  if (!initialState) {
    const metaData = parseXhsMetaHtml(html, url)
    if (metaData) return metaData
    throw new Error('未能在小红书 HTML 源码中定位到初始状态数据（window.__INITIAL_STATE__），请确认链接可公开访问。')
  }

  // 2. 反序列化状态 JSON
  let state: any = null
  try {
    const sanitizedJson = initialState.replace(/:\s*undefined/g, ':null')
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

  return normalizeXhsNote(noteData, noteId, url)
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

  const requestUrl = buildXhsRequestUrl(targetUrl, noteId)

  const response = await fetchWithProxy(requestUrl, {
    method: 'GET',
    connectTimeout: 12000,
    maxRedirections: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.xiaohongshu.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
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

  return parseXhsHtml(html, response.url || requestUrl || targetUrl)
}

export function buildXhsNoteRecord(note: XhsNoteData): XhsNoteRecord {
  const title = note.title || (note.noteId ? `小红书笔记 ${note.noteId}` : '小红书笔记')
  const typeLabel = note.type === 'video' ? '视频' : '图文'
  const stats = [
    note.likedCount ? `点赞 ${note.likedCount}` : '',
    note.collectedCount ? `收藏 ${note.collectedCount}` : '',
    note.commentCount ? `评论 ${note.commentCount}` : '',
    note.shareCount ? `分享 ${note.shareCount}` : '',
  ].filter(Boolean).join(' · ')
  const extractedAt = formatTimestamp(Date.now())
  const meta = [
    `- 来源：小红书`,
    `- 类型：${typeLabel}`,
    note.author ? `- 作者：${note.author}` : '',
    note.homeUrl ? `- 作者主页：${note.homeUrl}` : '',
    note.noteId ? `- 笔记 ID：${note.noteId}` : '',
    note.sourceUrl ? `- 原文链接：${note.sourceUrl}` : '',
    note.uploadTime ? `- 发布时间：${note.uploadTime}` : '',
    note.ipLocation ? `- IP 属地：${note.ipLocation}` : '',
    stats ? `- 互动数据：${stats}` : '',
    note.tags?.length ? `- 标签：${note.tags.join('、')}` : '',
    extractedAt ? `- 提取时间：${extractedAt}` : '',
  ].filter(Boolean).join('\n')

  const imageSection = note.imageList.length
    ? [
        '## 图片',
        '',
        ...note.imageList.flatMap((imageUrl, index) => [
          `![图片 ${index + 1}](${imageUrl})`,
          '',
          imageUrl,
          '',
        ]),
      ].join('\n').trim()
    : ''

  const videoSection = note.videoUrl
    ? ['## 视频', '', `[视频直链](${note.videoUrl})`, '', note.videoUrl].join('\n')
    : ''

  const content = [
    `<!-- lingmo:xhs-note ${JSON.stringify({
      url: note.sourceUrl,
      noteId: note.noteId,
      title,
      author: note.author,
      type: note.type,
      extractedAt: Date.now(),
    })} -->`,
    `# ${title}`,
    '',
    meta,
    '',
    '---',
    '',
    note.desc ? ['## 正文', '', note.desc].join('\n') : '',
    imageSection,
    videoSection,
  ].filter(Boolean).join('\n\n')

  return {
    title,
    desc: [
      title,
      note.author ? `作者：${note.author}` : '',
      note.desc ? note.desc.slice(0, 180) : '',
    ].filter(Boolean).join('\n'),
    content,
    url: note.sourceUrl,
  }
}
