import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { ensureTagByName } from '@/db/tags'
import { tavilyExtract } from '@/lib/tavily'
import { buildReadableWebMarkdown, normalizeWebContent, parseWebPageContent } from '@/lib/web/content-extractor'
import { fetchWechatArticleAsMarkdown, parseWechatArticleHtml, WECHAT_ARTICLE_TAG_NAME } from '@/lib/wechat-article'
import {
  buildGitHubProjectRecord,
  fetchGitHubProjectInfo,
  getGitHubProjectApiToken,
  getGitHubProjectErrorMessage,
  GITHUB_PROJECT_TAG_NAME,
  parseGitHubRepoUrl,
  summarizeGitHubProject,
} from '@/lib/github-project'
import { buildXhsNoteRecord, fetchXhsNoteData, XHS_NOTE_TAG_NAME } from '@/lib/xhs-extractor'
import { fetchVideoTranscript, VIDEO_TRANSCRIPT_TAG_NAME } from '@/lib/video-transcript'
import type { LinkSourceType } from '@/db/link-pipeline'
import type { LinkOrganizationPolicy } from './source-router'

export type LinkCaptureErrorCode = 'http' | 'non_text' | 'parse' | 'network' | 'unknown'

export class LinkCaptureError extends Error {
  code: LinkCaptureErrorCode
  status?: number
  contentType?: string

  constructor(message: string, code: LinkCaptureErrorCode, options?: { status?: number; contentType?: string }) {
    super(message)
    this.name = 'LinkCaptureError'
    this.code = code
    this.status = options?.status
    this.contentType = options?.contentType
  }
}

export interface CapturedLinkDraft {
  tagId: number
  url: string
  desc: string
  content: string
  title: string
  metaDesc?: string
  sourceType: Exclude<LinkSourceType, 'unknown'>
  organization: LinkOrganizationPolicy
  upsertByUrl?: boolean
  sourceIdentity?: string
  existingContentMarker?: string
  warning?: string
  metadata?: Record<string, unknown>
}

export interface CaptureAdapterOptions {
  onProgress?: (progress: number, message: string) => void
}

export function buildLinkSourceIdentity(
  sourceType: Exclude<LinkSourceType, 'unknown'>,
  url: string,
) {
  if (sourceType !== 'github') return undefined
  return `github:${url.trim().replace(/\/+$/, '').toLowerCase()}`
}

export function toLinkCaptureError(error: unknown): LinkCaptureError {
  if (error instanceof LinkCaptureError) return error
  if (error instanceof Error) {
    const httpStatus = error.message.match(/HTTP\s+(\d+)/i)?.[1]
    if (httpStatus) return new LinkCaptureError(error.message, 'http', { status: Number(httpStatus) })
    const lowered = error.message.toLowerCase()
    if (['network', 'timeout', 'failed to fetch', 'error sending request'].some(value => lowered.includes(value))) {
      return new LinkCaptureError(error.message, 'network')
    }
    return new LinkCaptureError(error.message, 'unknown')
  }
  return new LinkCaptureError(String(error), 'unknown')
}

export function getLinkCaptureErrorMessage(error: LinkCaptureError): string {
  if (/invalid utf-8 sequence/i.test(error.message)) return '链接返回内容包含异常编码，当前解析器无法稳定读取。'
  if (error.code === 'http') {
    if (error.status === 403) return '请求被目标站点拒绝（403），该站点可能开启了访问保护。'
    if (error.status === 401) return '目标网页需要登录（401），当前抓取不带登录态。'
    if (error.status === 404) return '目标网页不存在（404），请检查链接是否正确。'
    if (error.status === 429) return '目标站点请求过于频繁（429），请稍后重试。'
    return `链接抓取失败（HTTP ${error.status ?? 'unknown'}）。`
  }
  if (error.code === 'non_text') return `当前链接返回的不是网页文本内容（${error.contentType || 'unknown content-type'}）。`
  if (error.code === 'parse') return '网页内容解析失败，可能是动态渲染页面或编码异常。'
  if (error.code === 'network') return '网络请求失败，请检查网络连接、代理设置，或稍后重试。'
  return error.message || '链接处理失败，请重试。'
}

function titleFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function extractViaTavily(url: string) {
  const response = await tavilyExtract({ urls: url, extractDepth: 'advanced', format: 'markdown', timeout: 20 })
  const content = normalizeWebContent(response.results[0]?.rawContent?.trim() || '')
  if (!content) {
    throw new LinkCaptureError(response.failedResults[0]?.error || 'Tavily Extract 未返回可用正文', 'parse')
  }
  const heading = content.split(/\r?\n/).map(line => line.trim()).find(line => /^#{1,2}\s+/.test(line))
  return {
    title: heading?.replace(/^#{1,2}\s+/, '').trim() || titleFromUrl(url),
    metaDesc: '通过 Tavily Extract 提取',
    mainContent: content.slice(0, 20_000),
    bodyText: content.slice(0, 20_000),
  }
}

function decodeResponse(bytes: Uint8Array, contentType: string | null) {
  const charset = contentType?.match(/charset=([^\s;]+)/i)?.[1]?.trim().toLowerCase()
  const candidates = [charset, 'utf-8', 'gb18030', 'gbk', 'big5']
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  let best = ''
  let score = Number.NEGATIVE_INFINITY
  for (const encoding of candidates) {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes)
      const length = decoded.length || 1
      const nextScore = (/<html[\s>]/i.test(decoded) ? 40 : 0)
        - ((decoded.match(/\uFFFD/g) || []).length / length) * 300
      if (nextScore > score) {
        best = decoded
        score = nextScore
      }
    } catch {
      // Unsupported encodings are ignored.
    }
  }
  return best
}

async function fetchWebContent(url: string) {
  try {
    const response = await tauriFetch(url, {
      method: 'GET',
      connectTimeout: 12_000,
      maxRedirections: 5,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
      },
    })
    if (!response.ok) throw new LinkCaptureError(`HTTP ${response.status}`, 'http', { status: response.status })
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const textLike = !contentType
      || contentType.includes('text/')
      || contentType.includes('application/xhtml+xml')
      || contentType.includes('application/xml')
      || contentType.includes('application/json')
    if (!textLike) throw new LinkCaptureError('链接不是可解析网页内容', 'non_text', { contentType })
    const html = decodeResponse(new Uint8Array(await response.arrayBuffer()), contentType)
    if (!html) throw new LinkCaptureError('网页内容编码异常', 'parse')
    const parsed = parseWebPageContent(html, url)
    const directContent = parsed.mainContent || parsed.bodyText || parsed.metaDesc || ''
    return directContent.replace(/\s+/g, '').length < 500 ? await extractViaTavily(url) : parsed
  } catch (error) {
    const typed = toLinkCaptureError(error)
    if (typed.code === 'unknown') throw typed
    return await extractViaTavily(url)
  }
}

export async function captureWebpage(url: string, tagId: number): Promise<CapturedLinkDraft> {
  const page = await fetchWebContent(url)
  const title = page.title || titleFromUrl(url)
  const metaDesc = page.metaDesc || ''
  const rawContent = page.mainContent || page.bodyText || metaDesc || `来源链接：${url}`
  if (!rawContent.trim()) throw new LinkCaptureError('网页解析结果为空', 'parse')
  return {
    tagId,
    url,
    title,
    metaDesc,
    desc: [title, metaDesc].filter(Boolean).join('\n'),
    content: buildReadableWebMarkdown({ title, url, metaDesc, content: rawContent }),
    sourceType: 'webpage',
    organization: 'generic_ai',
  }
}

export async function captureWechat(url: string, htmlSource = ''): Promise<CapturedLinkDraft> {
  const article = htmlSource.trim()
    ? parseWechatArticleHtml(htmlSource.trim(), url)
    : await fetchWechatArticleAsMarkdown(url)
  const tag = await ensureTagByName(WECHAT_ARTICLE_TAG_NAME)
  return {
    tagId: tag.id,
    url,
    title: article.desc.split('\n')[0] || '公众号文章',
    desc: article.desc,
    content: article.content,
    sourceType: 'wechat',
    organization: 'generic_ai',
  }
}

export async function captureGithub(
  url: string,
  fallbackTagId: number,
  options: CaptureAdapterOptions = {},
): Promise<CapturedLinkDraft> {
  const ref = parseGitHubRepoUrl(url)
  const token = await getGitHubProjectApiToken()
  if (!ref || !token) {
    options.onProgress?.(35, 'GitHub 专用信息不可用，回退为普通网页抓取')
    const fallback = await captureWebpage(url, fallbackTagId)
    return {
      ...fallback,
      warning: !ref ? '该 GitHub 链接不是仓库首页，已按普通网页保存。' : '未配置 GitHub Token，已按普通网页保存。',
      metadata: { githubFallback: true },
    }
  }

  try {
    options.onProgress?.(30, '正在读取 GitHub 仓库元数据与 README')
    const projectInfo = await fetchGitHubProjectInfo(ref, token)
    options.onProgress?.(50, '正在整理 GitHub 项目资料卡')
    const summary = await summarizeGitHubProject(projectInfo)
    const record = buildGitHubProjectRecord({ ...projectInfo, summary })
    const tag = await ensureTagByName(GITHUB_PROJECT_TAG_NAME)
    return {
      tagId: tag.id,
      url: projectInfo.url,
      title: projectInfo.fullName,
      desc: record.desc,
      content: record.content,
      sourceType: 'github',
      organization: 'adapter_structured',
      upsertByUrl: true,
      sourceIdentity: buildLinkSourceIdentity('github', projectInfo.url),
      existingContentMarker: 'lingmo:github-project',
      metadata: {
        fullName: projectInfo.fullName,
        stars: projectInfo.stars,
        forks: projectInfo.forks,
        language: projectInfo.language,
      },
    }
  } catch (error) {
    options.onProgress?.(40, 'GitHub API 识别失败，回退为普通网页抓取')
    const fallback = await captureWebpage(url, fallbackTagId)
    return {
      ...fallback,
      warning: `${getGitHubProjectErrorMessage(error)} 已回退为普通链接保存。`,
      metadata: { githubFallback: true },
    }
  }
}

export async function captureXiaohongshu(
  url: string,
  options: CaptureAdapterOptions = {},
): Promise<CapturedLinkDraft> {
  options.onProgress?.(35, '正在读取小红书笔记')
  const note = await fetchXhsNoteData(url)
  options.onProgress?.(50, '正在生成小红书笔记卡片')
  const record = buildXhsNoteRecord(note)
  const tag = await ensureTagByName(XHS_NOTE_TAG_NAME)
  return {
    tagId: tag.id,
    url: record.url,
    title: record.title,
    desc: record.desc,
    content: record.content,
    sourceType: 'xiaohongshu',
    organization: 'adapter_structured',
    metadata: {
      noteId: note.noteId,
      noteType: note.type,
      author: note.author,
      imageCount: note.imageList.length,
      hasVideo: Boolean(note.videoUrl),
    },
  }
}

export async function captureVideo(
  url: string,
  options: CaptureAdapterOptions = {},
): Promise<CapturedLinkDraft> {
  const transcript = await fetchVideoTranscript(url, {
    onProgress: progress => options.onProgress?.(
      Math.max(20, Math.min(55, Math.round(20 + progress.progress * 0.35))),
      progress.message,
    ),
  })
  const tag = await ensureTagByName(VIDEO_TRANSCRIPT_TAG_NAME)
  return {
    tagId: tag.id,
    url: transcript.sourceUrl,
    title: transcript.title,
    desc: transcript.desc,
    content: transcript.content,
    sourceType: 'video',
    organization: 'adapter_structured',
    metadata: {
      platform: transcript.platform,
      author: transcript.author,
      transcriptSource: transcript.transcriptSource,
      transcriptLength: transcript.transcript.length,
    },
  }
}
