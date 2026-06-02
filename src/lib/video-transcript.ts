import { Command } from '@tauri-apps/plugin-shell'
import { readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { appCacheDir } from '@tauri-apps/api/path'
import { fetchAudioTranscription } from '@/lib/audio'
import { fetchWithProxy, getProxyUrl } from '@/lib/network-proxy'
import ffmpegStatic from 'ffmpeg-static'

export const VIDEO_TRANSCRIPT_TAG_NAME = '视频转写'

type VideoPlatform = 'youtube' | 'bilibili' | 'xiaohongshu'
type VideoTranscriptStage = 'metadata' | 'subtitle' | 'audio' | 'transcribe' | 'summary' | 'save'

const AUDIO_CHUNK_SECONDS = 180
const DEFAULT_STT_CONCURRENCY = 3

export interface VideoTranscriptProgress {
  progress: number
  stage: VideoTranscriptStage
  message: string
  current?: number
  total?: number
}

export interface VideoTranscriptOptions {
  onProgress?: (progress: VideoTranscriptProgress) => void
  sttConcurrency?: number
}

export interface VideoTranscriptResult {
  platform: VideoPlatform
  title: string
  author: string
  sourceUrl: string
  transcript: string
  desc: string
  content: string
  transcriptSource: string
}

interface YouTubeCaptionTrack {
  baseUrl?: string
  name?: { simpleText?: string; runs?: Array<{ text?: string }> }
  languageCode?: string
  kind?: string
  vssId?: string
}

interface SubtitleEntry {
  start?: number
  end?: number
  text: string
}

interface YouTubePlayerResponse {
  videoDetails?: {
    title?: string
    author?: string
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrack[]
    }
  }
}

interface BilibiliSubtitleItem {
  lan?: string
  lan_doc?: string
  subtitle_url?: string
  ai_type?: number
  ai_status?: number
}

interface BilibiliViewResponse {
  code?: number
  message?: string
  data?: {
    bvid?: string
    title?: string
    owner?: { name?: string }
    cid?: number
    pages?: Array<{ cid?: number; page?: number; part?: string }>
    subtitle?: {
      list?: BilibiliSubtitleItem[]
    }
  }
}

interface BilibiliInitialState {
  videoData?: BilibiliViewResponse['data']
}

interface BilibiliPlayerResponse {
  code?: number
  message?: string
  data?: {
    subtitle?: {
      list?: BilibiliSubtitleItem[]
      subtitles?: BilibiliSubtitleItem[]
    }
  }
}

interface YtDlpMetadata {
  title?: string
  uploader?: string
  channel?: string
  webpage_url?: string
}

interface BilibiliSubtitleResponse {
  body?: Array<{
    from?: number
    to?: number
    content?: string
  }>
}

const BILIBILI_WEB_HEADERS = {
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function normalizeSubtitleText(value?: string | null) {
  const decoded = decodeHtmlEntities(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\\[^}]+\}/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[♪♫♬]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return decoded
}

function isNoiseSubtitleText(value: string) {
  if (!value) return true
  return /^(?:[\[(（【<]?\s*(?:音乐|字幕|掌声|笑声|欢呼|沉默|片头|片尾|music|applause|laughter|cheering|silence)\s*[\])）】>]?)$/i.test(value)
}

function hasSentenceEnding(value: string) {
  return /[。！？!?…]$/.test(value) || /[.!?]$/.test(value)
}

function normalizeForDedup(value: string) {
  return value
    .replace(/[，。！？、,.!?;；:：'"“”‘’()\[\]（）【】\s]/g, '')
    .toLowerCase()
}

function parseSubtitleTimeToSeconds(value: string) {
  const normalized = value.replace(',', '.').trim()
  const parts = normalized.split(':')
  if (parts.length < 2) return 0
  const seconds = Number(parts.pop() || 0)
  const minutes = Number(parts.pop() || 0)
  const hours = Number(parts.pop() || 0)
  return Math.max(0, Math.floor(hours * 3600 + minutes * 60 + seconds))
}

function normalizeSubtitleEntries(entries: SubtitleEntry[]) {
  const normalizedEntries = entries
    .map(entry => ({
      ...entry,
      text: normalizeSubtitleText(entry.text),
    }))
    .filter(entry => entry.text && !isNoiseSubtitleText(entry.text))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))

  const output: string[] = []
  let buffer: string[] = []
  let bufferStart: number | undefined
  let bufferEnd: number | undefined
  let previousDedupKey = ''
  let previousStart = -999

  function flush() {
    const content = cleanText(buffer.join(' '))
    if (content) {
      output.push(bufferStart !== undefined ? `- ${formatSeconds(bufferStart)} ${content}` : `- ${content}`)
    }
    buffer = []
    bufferStart = undefined
    bufferEnd = undefined
  }

  for (const entry of normalizedEntries) {
    const dedupKey = normalizeForDedup(entry.text)
    if (dedupKey && dedupKey === previousDedupKey && Math.abs((entry.start ?? previousStart) - previousStart) <= 2) {
      continue
    }

    const gap = bufferEnd !== undefined && entry.start !== undefined ? entry.start - bufferEnd : 0
    const currentText = cleanText(buffer.join(' '))
    const shouldFlush = buffer.length > 0 && (
      gap > 2.2 ||
      hasSentenceEnding(currentText) ||
      currentText.length >= 160 ||
      buffer.length >= 5
    )

    if (shouldFlush) {
      flush()
    }

    if (buffer.length === 0) {
      bufferStart = entry.start
    }
    buffer.push(entry.text)
    bufferEnd = entry.end ?? entry.start ?? bufferEnd
    previousDedupKey = dedupKey
    previousStart = entry.start ?? previousStart
  }

  flush()
  return output.join('\n')
}

function notifyVideoProgress(options: VideoTranscriptOptions | undefined, progress: VideoTranscriptProgress) {
  options?.onProgress?.({
    ...progress,
    progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
  })
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSeconds(value?: number) {
  const total = Math.max(0, Math.floor(value || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (item: number) => String(item).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

function decodeHtmlEntities(value: string) {
  if (!value) return ''
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${value}`, 'text/html')
  return doc.body.textContent || value
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

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
}

export function getVideoPlatform(value: string): VideoPlatform | null {
  try {
    const url = new URL(normalizeUrl(value))
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
      return 'youtube'
    }
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') {
      return 'bilibili'
    }
    if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com') || host === 'xhslink.com') {
      return 'xiaohongshu'
    }
    return null
  } catch {
    if (value.includes('xiaohongshu.com') || value.includes('xhslink.com')) {
      return 'xiaohongshu'
    }
    return null
  }
}

export function isVideoTranscriptUrl(value: string) {
  return Boolean(getVideoPlatform(value))
}

function getYouTubeVideoId(value: string) {
  const url = new URL(normalizeUrl(value))
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] || ''
  }
  if (url.pathname === '/watch') {
    return url.searchParams.get('v') || ''
  }
  if (url.pathname.startsWith('/shorts/')) {
    return url.pathname.split('/').filter(Boolean)[1] || ''
  }
  if (url.pathname.startsWith('/embed/')) {
    return url.pathname.split('/').filter(Boolean)[1] || ''
  }
  return ''
}

function getBilibiliBvid(value: string) {
  const url = new URL(normalizeUrl(value))
  const match = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/) || normalizeUrl(value).match(/(BV[a-zA-Z0-9]+)/)
  return match?.[1] || ''
}

function getBilibiliPageNumber(value: string) {
  try {
    const url = new URL(normalizeUrl(value))
    const page = Number(url.searchParams.get('p') || url.searchParams.get('page') || 1)
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  } catch {
    return 1
  }
}

async function resolveBilibiliUrl(value: string) {
  const normalized = normalizeUrl(value)
  try {
    const url = new URL(normalized)
    if (url.hostname.replace(/^www\./, '') !== 'b23.tv') {
      return normalized
    }

    const response = await fetchWithProxy(normalized, {
      method: 'GET',
      connectTimeout: 15000,
      maxRedirections: 5,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        ...BILIBILI_WEB_HEADERS,
      },
    })
    if (response.url && response.url !== normalized) {
      return response.url
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    const html = decodeBytes(bytes, response.headers.get('content-type'))
    const match = html.match(/https?:\/\/(?:www\.)?bilibili\.com\/video\/BV[a-zA-Z0-9]+[^"'<>\\\s]*/i)
    return match?.[0] || normalized
  } catch {
    return normalized
  }
}

async function resolveBilibiliInput(value: string) {
  const resolvedUrl = await resolveBilibiliUrl(value)
  const bvid = getBilibiliBvid(resolvedUrl)
  const pageNumber = getBilibiliPageNumber(resolvedUrl)
  return {
    bvid,
    pageNumber,
    sourceUrl: pageNumber > 1 ? `https://www.bilibili.com/video/${bvid}?p=${pageNumber}` : `https://www.bilibili.com/video/${bvid}`,
  }
}

function getFallbackVideoTitle(platform: VideoPlatform, sourceUrl: string) {
  if (platform === 'bilibili') {
    const bvid = getBilibiliBvid(sourceUrl)
    return bvid ? `B站视频 ${bvid}` : 'B站视频'
  }
  if (platform === 'youtube') {
    const videoId = getYouTubeVideoId(sourceUrl)
    return videoId ? `YouTube 视频 ${videoId}` : 'YouTube 视频'
  }
  if (platform === 'xiaohongshu') {
    return '小红书视频转写'
  }
  return '视频转写'
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

function getCaptionTrackName(track: YouTubeCaptionTrack) {
  return cleanText(track.name?.simpleText || track.name?.runs?.map(item => item.text || '').join(' ') || '')
}

function scoreYouTubeCaptionTrack(track: YouTubeCaptionTrack) {
  const language = (track.languageCode || '').toLowerCase()
  const vssId = (track.vssId || '').toLowerCase()
  const name = getCaptionTrackName(track).toLowerCase()
  const haystack = `${language} ${vssId} ${name}`
  const isAuto = track.kind === 'asr' || vssId.startsWith('a.')
  let score = 0

  if (/zh|zho|chi|中文|chinese|汉语|漢語/.test(haystack)) score += 120
  if (/zh-hans|zh-cn|简体|simplified/.test(haystack)) score += 35
  if (/zh-hant|zh-tw|繁體|繁体|traditional/.test(haystack)) score += 25
  if (/en|english/.test(haystack)) score += 30
  if (!isAuto) score += 40
  if (isAuto) score -= 8
  if (track.baseUrl) score += 10

  return score
}

function selectCaptionTrack(tracks: YouTubeCaptionTrack[]) {
  return [...tracks]
    .filter(track => Boolean(track.baseUrl))
    .sort((a, b) => scoreYouTubeCaptionTrack(b) - scoreYouTubeCaptionTrack(a))[0]
}

function getYouTubeCaptionSource(track: YouTubeCaptionTrack) {
  const label = getCaptionTrackName(track) || track.languageCode || ''
  const source = track.kind === 'asr' ? 'YouTube 自动字幕' : 'YouTube 人工字幕'
  return label ? `${source}：${label}` : source
}

function scoreBilibiliSubtitle(item: BilibiliSubtitleItem) {
  const language = (item.lan || '').toLowerCase()
  const label = (item.lan_doc || '').toLowerCase()
  const haystack = `${language} ${label}`
  let score = 0

  if (/zh|zho|chi|中文|chinese/.test(haystack)) score += 120
  if (/zh-cn|zh-hans|简体|簡體/.test(haystack)) score += 35
  if (/zh-tw|zh-hant|繁体|繁體/.test(haystack)) score += 25
  if (/en|english/.test(haystack)) score += 20
  if (item.subtitle_url) score += 10
  if (item.ai_type && item.ai_type > 0) score -= 8

  return score
}

function selectBilibiliSubtitle(items: BilibiliSubtitleItem[]) {
  return [...items]
    .filter(item => Boolean(item.subtitle_url))
    .sort((a, b) => scoreBilibiliSubtitle(b) - scoreBilibiliSubtitle(a))[0]
}

async function fetchText(url: string, headers?: Record<string, string>) {
  const response = await fetchWithProxy(url, {
    method: 'GET',
    connectTimeout: 15000,
    maxRedirections: 5,
    headers: {
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      ...headers,
    },
  })
  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return decodeBytes(bytes, response.headers.get('content-type'))
}

async function fetchJson<T>(url: string, headers?: Record<string, string>) {
  const response = await fetchWithProxy(url, {
    method: 'GET',
    connectTimeout: 15000,
    maxRedirections: 5,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      ...headers,
    },
  })
  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }
  const text = await fetchText(url, headers)
  return JSON.parse(text) as T
}

function parseBilibiliInitialState(html: string): BilibiliViewResponse['data'] | null {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*\(function/)
    || html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/)
  if (!match?.[1]) {
    return null
  }

  try {
    const state = JSON.parse(match[1]) as BilibiliInitialState
    return state.videoData || null
  } catch {
    return null
  }
}

async function fetchBilibiliVideoData(bvid: string) {
  try {
    const view = await fetchJson<BilibiliViewResponse>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      BILIBILI_WEB_HEADERS
    )
    if (view.code === 0 && view.data) {
      return view.data
    }
  } catch {
    // fall back to page HTML below
  }

  const pageUrl = `https://www.bilibili.com/video/${bvid}/`
  const html = await fetchText(pageUrl, {
    ...BILIBILI_WEB_HEADERS,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  })
  const data = parseBilibiliInitialState(html)
  if (!data) {
    return {
      bvid,
      title: '',
      owner: { name: '' },
      subtitle: { list: [] },
    }
  }
  return data
}

async function fetchBilibiliPlayerSubtitles(bvid: string, cid?: number) {
  if (!cid) {
    return []
  }

  try {
    const response = await fetchJson<BilibiliPlayerResponse>(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`,
      BILIBILI_WEB_HEADERS
    )
    if (response.code === 0 && response.data?.subtitle) {
      return response.data.subtitle.subtitles || response.data.subtitle.list || []
    }
  } catch {
    // fall back to subtitles from the view API
  }

  return []
}

async function fetchBilibiliSubtitleJson(url: string, videoUrl: string) {
  const headers = {
    ...BILIBILI_WEB_HEADERS,
    Referer: videoUrl,
    'Sec-Fetch-Site': 'cross-site',
  }

  try {
    return await fetchJson<BilibiliSubtitleResponse>(url, headers)
  } catch (error) {
    try {
      const response = await fetchWithProxy(url, {
        method: 'GET',
        connectTimeout: 15000,
        maxRedirections: 5,
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity',
          ...headers,
        },
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      const text = decodeBytes(bytes, response.headers.get('content-type'))
      return JSON.parse(text) as BilibiliSubtitleResponse
    } catch {
      throw error
    }
  }
}

function buildVideoMetadataScript() {
  return String.raw`
import json
import shutil
import subprocess
import sys

url = sys.argv[1]

def has_python_module(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False

yt_dlp = shutil.which("yt-dlp")
if yt_dlp:
    command = [yt_dlp]
elif has_python_module("yt_dlp"):
    command = [sys.executable, "-m", "yt_dlp"]
else:
    print("ERROR: YT_DLP_NOT_FOUND", file=sys.stderr)
    sys.exit(2)

process = subprocess.run(
    command + ["--no-playlist", "--dump-single-json", "--skip-download", url],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    encoding="utf-8",
    errors="replace",
)
if process.returncode != 0 or not process.stdout.strip():
    print("ERROR: YT_DLP_METADATA_FAILED", file=sys.stderr)
    sys.exit(process.returncode or 3)

data = json.loads(process.stdout)
print(json.dumps({
    "title": data.get("title") or "",
    "uploader": data.get("uploader") or data.get("channel") or "",
    "channel": data.get("channel") or "",
    "webpage_url": data.get("webpage_url") or url,
}, ensure_ascii=False))
`
}

async function fetchVideoMetadataByYtDlp(url: string): Promise<YtDlpMetadata | null> {
  try {
    const proxyUrl = await getProxyUrl()
    const process = Command.create('python', ['-c', buildVideoMetadataScript(), url], {
      encoding: 'utf-8',
      env: {
        ...(proxyUrl ? { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : {}),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })
    const result = await process.execute()
    if (result.code !== 0 || !result.stdout.trim()) {
      return null
    }
    return JSON.parse(result.stdout.trim()) as YtDlpMetadata
  } catch {
    return null
  }
}

function youtubeCaptionXmlToMarkdown(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const nodes = Array.from(doc.querySelectorAll('text'))
  const entries = nodes
    .map<SubtitleEntry>((node) => {
      const start = Number(node.getAttribute('start') || 0)
      const duration = Number(node.getAttribute('dur') || 0)
      return {
        start,
        end: duration > 0 ? start + duration : undefined,
        text: node.textContent || '',
      }
    })
  return normalizeSubtitleEntries(entries)
}

function subtitleTextToTimeline(text: string) {
  const normalized = text.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const entries: SubtitleEntry[] = []
  let pendingStart: number | undefined
  let pendingEnd: number | undefined
  let pendingText: string[] = []

  function flush() {
    const content = normalizeSubtitleText(pendingText.join(' '))
    if (content) {
      entries.push({
        start: pendingStart,
        end: pendingEnd,
        text: content,
      })
    }
    pendingStart = undefined
    pendingEnd = undefined
    pendingText = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) {
      flush()
      continue
    }
    if (/^\d+$/.test(line) || /^NOTE\b|^STYLE\b|^REGION\b/i.test(line)) {
      continue
    }
    const timeMatch = line.match(/((?:\d{2}:)?\d{2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}(?:[.,]\d{1,3})?)/)
    if (timeMatch) {
      flush()
      pendingStart = parseSubtitleTimeToSeconds(timeMatch[1])
      pendingEnd = parseSubtitleTimeToSeconds(timeMatch[2])
      continue
    }
    pendingText.push(line)
  }
  flush()
  return normalizeSubtitleEntries(entries)
}

async function buildVideoTranscriptRecord(
  result: Omit<VideoTranscriptResult, 'desc' | 'content'>,
  _options?: VideoTranscriptOptions
): Promise<VideoTranscriptResult> {
  const extractedAt = formatDateTime(Date.now())
  const platformLabel = result.platform === 'youtube' ? 'YouTube' : 'B站'
  const genericTitle = `${platformLabel} 视频转写`
  const title = cleanText(result.title) && cleanText(result.title) !== genericTitle
    ? cleanText(result.title)
    : getFallbackVideoTitle(result.platform, result.sourceUrl)
  const meta = [
    `- 来源：${platformLabel}`,
    result.author ? `- 作者：${result.author}` : '',
    `- 原视频：${result.sourceUrl}`,
    `- 提取方式：${result.transcriptSource}`,
    `- 提取时间：${extractedAt}`,
  ].filter(Boolean).join('\n')

  const content = [
    `<!-- lingmo:video-transcript ${JSON.stringify({
      platform: result.platform,
      title,
      sourceUrl: result.sourceUrl,
      transcriptSource: result.transcriptSource,
      extractedAt: Date.now(),
      summary: '',
      chapters: [],
      highlights: [],
      viewpoints: [],
      reflections: [],
      terms: [],
      notes: [],
      actionItems: [],
      questions: [],
    })} -->`,
    `# ${title}`,
    '',
    meta,
    '',
    '## 转写正文',
    '',
    result.transcript,
  ].join('\n')

  return {
    ...result,
    title,
    desc: [title, result.author ? `作者：${result.author}` : '', `来源：${platformLabel}`].filter(Boolean).join('\n'),
    content,
  }
}

function getAudioMimeType(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase()
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4'
  if (extension === 'wav') return 'audio/wav'
  if (extension === 'ogg') return 'audio/ogg'
  if (extension === 'webm') return 'audio/webm'
  return 'audio/mpeg'
}

function plainTranscriptToTimeline(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(line => cleanText(line))
    .filter(Boolean)

  if (lines.length === 0) {
    return ''
  }

  const timestampedEntries = lines
    .map<SubtitleEntry | null>((line) => {
      const match = line.match(/^[-*]?\s*((?:\d{1,2}:)?\d{2}:\d{2})\s+(.+)$/)
      if (!match) return null
      return {
        start: parseSubtitleTimeToSeconds(match[1]),
        text: match[2],
      }
    })
    .filter((entry): entry is SubtitleEntry => Boolean(entry))

  if (timestampedEntries.length > 0) {
    return normalizeSubtitleEntries(timestampedEntries)
  }

  return lines.join('\n\n')
}

function buildAudioDownloadScript() {
  return String.raw`
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

url = sys.argv[1]
output_dir = sys.argv[2]
ffmpeg_path = sys.argv[3] if len(sys.argv) > 3 else ""
result_path = sys.argv[4] if len(sys.argv) > 4 else ""
os.makedirs(output_dir, exist_ok=True)

def has_python_module(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False

def find_ffmpeg(path_from_app):
    candidates = []
    if path_from_app:
        candidates.append(path_from_app)

    env_path = os.environ.get("LINGMO_FFMPEG_PATH", "")
    if env_path:
        candidates.append(env_path)

    executable = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    cwd = Path.cwd()
    for base in [cwd, *cwd.parents]:
        candidates.extend([
            str(base / "node_modules" / "ffmpeg-static" / executable),
            str(base / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / executable),
        ])

    found = shutil.which("ffmpeg")
    if found:
        candidates.append(found)

    for item in candidates:
        if item and os.path.isfile(item):
            return item
    return ""

ffmpeg = find_ffmpeg(ffmpeg_path)
if not ffmpeg:
    print("ERROR: FFMPEG_NOT_FOUND", file=sys.stderr)
    sys.exit(3)

yt_dlp = shutil.which("yt-dlp")
if yt_dlp:
    command = [yt_dlp]
elif has_python_module("yt_dlp"):
    command = [sys.executable, "-m", "yt_dlp"]
else:
    print("ERROR: YT_DLP_NOT_FOUND", file=sys.stderr)
    sys.exit(2)

work_dir = tempfile.mkdtemp(prefix="lingmo-video-", dir=output_dir)
raw_template = os.path.join(work_dir, "source.%(ext)s")
command = command + [
    "--no-playlist",
    "--no-progress",
    "--format", "bestaudio/best",
    "--ffmpeg-location", ffmpeg,
    "--output", raw_template,
    url,
]

process = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if process.returncode != 0:
    print("ERROR: YT_DLP_DOWNLOAD_FAILED", file=sys.stderr)
    sys.exit(process.returncode)

files = sorted(glob.glob(os.path.join(work_dir, "source.*")), key=os.path.getmtime, reverse=True)
files = [item for item in files if os.path.isfile(item) and os.path.getsize(item) > 0]
if not files:
    print("ERROR: AUDIO_FILE_NOT_CREATED", file=sys.stderr)
    sys.exit(4)

source_file = files[0]
chunk_template = os.path.join(work_dir, "chunk-%03d.mp3")
ffmpeg_command = [
    ffmpeg,
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", source_file,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "48k",
    "-f", "segment",
    "-segment_time", "${AUDIO_CHUNK_SECONDS}",
    "-reset_timestamps", "1",
    chunk_template,
]
ffmpeg_process = subprocess.run(ffmpeg_command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if ffmpeg_process.returncode != 0:
    print("ERROR: FFMPEG_SEGMENT_FAILED", file=sys.stderr)
    sys.exit(ffmpeg_process.returncode)

chunks = sorted(glob.glob(os.path.join(work_dir, "chunk-*.mp3")))
chunks = [item for item in chunks if os.path.isfile(item) and os.path.getsize(item) > 0]
if not chunks:
    print("ERROR: AUDIO_CHUNK_NOT_CREATED", file=sys.stderr)
    sys.exit(5)

if result_path:
    with open(result_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(chunks, ensure_ascii=False))
`
}

function buildSubtitleDownloadScript() {
  return String.raw`
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

url = sys.argv[1]
output_dir = sys.argv[2]
result_path = sys.argv[3] if len(sys.argv) > 3 else ""
os.makedirs(output_dir, exist_ok=True)

def has_python_module(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False

yt_dlp = shutil.which("yt-dlp")
if yt_dlp:
    command = [yt_dlp]
elif has_python_module("yt_dlp"):
    command = [sys.executable, "-m", "yt_dlp"]
else:
    print("ERROR: YT_DLP_NOT_FOUND", file=sys.stderr)
    sys.exit(2)

work_dir = tempfile.mkdtemp(prefix="lingmo-subtitle-", dir=output_dir)
output_template = os.path.join(work_dir, "subtitle.%(ext)s")
command = command + [
    "--no-playlist",
    "--no-progress",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "zh-Hans,zh-Hant,zh-CN,zh-TW,zh,en.*",
    "--sub-format", "vtt/srt/best",
    "--output", output_template,
    url,
]

process = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if process.returncode != 0:
    print("ERROR: YT_DLP_SUBTITLE_FAILED", file=sys.stderr)
    sys.exit(process.returncode)

files = [
    item for item in glob.glob(os.path.join(work_dir, "*"))
    if os.path.isfile(item) and os.path.getsize(item) > 0 and Path(item).suffix.lower() in [".vtt", ".srt"]
]
def subtitle_score(path):
    name = os.path.basename(path).lower()
    score = 0
    if any(key in name for key in ["zh-hans", "zh_cn", "zh-cn", "chs", "simplified"]):
        score += 140
    elif any(key in name for key in ["zh-hant", "zh_tw", "zh-tw", "cht", "traditional"]):
        score += 130
    elif any(key in name for key in ["zh", "zho", "chi", "chinese"]):
        score += 120
    elif any(key in name for key in ["en", "english"]):
        score += 40
    if ".auto." not in name and "automatic" not in name:
        score += 20
    if name.endswith(".vtt"):
        score += 5
    return (-score, -os.path.getmtime(path))

files = sorted(files, key=subtitle_score)
if not files:
    print("ERROR: SUBTITLE_FILE_NOT_CREATED", file=sys.stderr)
    sys.exit(4)

if result_path:
    with open(result_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps({"path": files[0], "name": os.path.basename(files[0])}, ensure_ascii=False))
`
}

async function downloadVideoSubtitle(url: string, options?: VideoTranscriptOptions) {
  notifyVideoProgress(options, { progress: 68, stage: 'subtitle', message: '正在尝试快速抓取平台字幕' })
  const cacheDir = await appCacheDir()
  const outputDir = `${cacheDir.replace(/[\\/]+$/, '')}/video-transcript`
  const resultPath = `${outputDir}/subtitle-path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  const proxyUrl = await getProxyUrl()
  const process = Command.create('python', ['-c', buildSubtitleDownloadScript(), url, outputDir, resultPath], {
    encoding: 'utf-8',
    env: {
      ...(proxyUrl ? { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : {}),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  })
  const result = await process.execute()
  if (result.code !== 0) {
    return null
  }
  try {
    const rawResult = (await readTextFile(resultPath)).trim()
    const parsed = JSON.parse(rawResult)
    const subtitlePath = typeof parsed === 'string' ? parsed : parsed?.path
    if (typeof subtitlePath !== 'string' || !subtitlePath) {
      return null
    }
    const subtitleText = await readTextFile(subtitlePath)
    const transcript = subtitleTextToTimeline(subtitleText)
    return transcript || null
  } catch {
    return null
  }
}

async function buildSubtitleTranscriptRecord(
  url: string,
  platform: VideoPlatform,
  transcript: string,
  options?: VideoTranscriptOptions
) {
  const metadata = await fetchVideoMetadataByYtDlp(url)
  notifyVideoProgress(options, { progress: 86, stage: 'subtitle', message: '平台字幕抓取完成，正在整理记录' })
  return await buildVideoTranscriptRecord({
    platform,
    title: cleanText(metadata?.title) || getFallbackVideoTitle(platform, normalizeUrl(url)),
    author: cleanText(metadata?.uploader) || cleanText(metadata?.channel) || '',
    sourceUrl: metadata?.webpage_url || normalizeUrl(url),
    transcript,
    transcriptSource: 'yt-dlp 平台字幕',
  }, options)
}

async function downloadVideoAudioChunks(url: string, options?: VideoTranscriptOptions) {
  notifyVideoProgress(options, { progress: 64, stage: 'audio', message: '未找到可用字幕，正在下载音频' })
  const cacheDir = await appCacheDir()
  const outputDir = `${cacheDir.replace(/[\\/]+$/, '')}/video-transcript`
  const resultPath = `${outputDir}/audio-chunks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  const normalizedFfmpegPath = (ffmpegStatic || 'node_modules/ffmpeg-static/ffmpeg.exe').replace(/\\/g, '/')
  const proxyUrl = await getProxyUrl()
  const process = Command.create('python', ['-c', buildAudioDownloadScript(), url, outputDir, normalizedFfmpegPath, resultPath], {
    encoding: 'utf-8',
    env: {
      ...(proxyUrl ? { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : {}),
      LINGMO_FFMPEG_PATH: normalizedFfmpegPath,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  })
  const result = await process.execute()
  if (result.code !== 0) {
    const errorCode = (result.stderr || result.stdout || '').trim()
    if (errorCode.includes('FFMPEG_NOT_FOUND')) {
      throw new Error('未找到 ffmpeg，请确认项目依赖已安装。')
    }
    if (errorCode.includes('YT_DLP_NOT_FOUND')) {
      throw new Error('未找到 yt-dlp，请先执行 python -m pip install yt-dlp。')
    }
    if (errorCode.includes('AUDIO_FILE_NOT_CREATED')) {
      throw new Error('视频音频下载完成，但没有生成可用音频文件。')
    }
    if (errorCode.includes('FFMPEG_SEGMENT_FAILED')) {
      throw new Error('ffmpeg 音频标准化分片失败。')
    }
    if (errorCode.includes('AUDIO_CHUNK_NOT_CREATED')) {
      throw new Error('音频标准化完成，但没有生成可用分片。')
    }
    throw new Error('yt-dlp 下载音频失败，可能是视频受限、网络异常或需要登录。')
  }
  const rawResult = (await readTextFile(resultPath)).trim()
  let filePaths: string[] = []
  try {
    const parsed = JSON.parse(rawResult)
    filePaths = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  } catch {
    filePaths = rawResult ? [rawResult] : []
  }
  if (filePaths.length === 0) {
    throw new Error('视频音频处理完成，但未返回音频分片路径。')
  }
  notifyVideoProgress(options, {
    progress: 74,
    stage: 'audio',
    message: `音频已切分为 ${filePaths.length} 段，准备语音识别`,
    total: filePaths.length,
  })
  return filePaths
}

export async function transcribeVideoAudio(url: string, options?: {
  platform?: VideoPlatform
  title?: string
  author?: string
  onProgress?: VideoTranscriptOptions['onProgress']
  sttConcurrency?: number
}): Promise<VideoTranscriptResult> {
  const platform = options?.platform || getVideoPlatform(url)
  if (!platform) {
    throw new Error('暂不支持该视频平台。')
  }

  notifyVideoProgress(options, { progress: 63, stage: 'metadata', message: '正在读取视频标题' })
  const metadata = options?.title ? null : await fetchVideoMetadataByYtDlp(url)
  const audioPaths = await downloadVideoAudioChunks(url, options)
  const transcriptions = new Array<string>(audioPaths.length)
  let nextIndex = 0
  let finishedCount = 0
  const concurrency = Math.max(1, Math.min(options?.sttConcurrency || DEFAULT_STT_CONCURRENCY, audioPaths.length))

  notifyVideoProgress(options, {
    progress: 76,
    stage: 'transcribe',
    message: `正在并发转写音频分片（0/${audioPaths.length}）`,
    current: 0,
    total: audioPaths.length,
  })

  async function transcribeNextChunk() {
    while (nextIndex < audioPaths.length) {
      const index = nextIndex
      nextIndex += 1
      const audioPath = audioPaths[index]
      const bytes = await readFile(audioPath)
      const contentType = getAudioMimeType(audioPath)
      const audioBlob = new Blob([bytes], { type: contentType })
      const chunkText = await fetchAudioTranscription(audioBlob, {
        fileName: `video-chunk-${String(index + 1).padStart(3, '0')}.mp3`,
        contentType,
      })
      if (cleanText(chunkText)) {
        transcriptions[index] = `- ${formatSeconds(index * AUDIO_CHUNK_SECONDS)} ${chunkText}`
      }
      finishedCount += 1
      notifyVideoProgress(options, {
        progress: 76 + (finishedCount / audioPaths.length) * 16,
        stage: 'transcribe',
        message: `正在并发转写音频分片（${finishedCount}/${audioPaths.length}）`,
        current: finishedCount,
        total: audioPaths.length,
      })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => transcribeNextChunk()))
  const transcription = transcriptions.filter(Boolean).join('\n\n')
  const transcript = plainTranscriptToTimeline(transcription)
  if (!transcript) {
    throw new Error('语音识别未返回有效文本。')
  }

  return await buildVideoTranscriptRecord({
    platform,
    title: options?.title || cleanText(metadata?.title) || getFallbackVideoTitle(platform, normalizeUrl(url)),
    author: options?.author || cleanText(metadata?.uploader) || cleanText(metadata?.channel) || '',
    sourceUrl: metadata?.webpage_url || normalizeUrl(url),
    transcript,
    transcriptSource: audioPaths.length > 1 ? `音频分片语音识别（${audioPaths.length} 段）` : '音频语音识别',
  }, options)
}

export async function fetchYouTubeTranscript(url: string, options?: VideoTranscriptOptions): Promise<VideoTranscriptResult> {
  const videoId = getYouTubeVideoId(url)
  if (!videoId) {
    throw new Error('无法识别 YouTube 视频 ID')
  }

  notifyVideoProgress(options, { progress: 56, stage: 'metadata', message: '正在读取 YouTube 视频信息' })
  const pageUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const html = await fetchText(pageUrl, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const rawPlayerResponse = extractJsonAfterMarker(html, 'ytInitialPlayerResponse')
  if (!rawPlayerResponse) {
    throw new Error('未找到 YouTube 播放器信息，可能需要登录或被地区限制。')
  }

  const playerResponse = JSON.parse(rawPlayerResponse) as YouTubePlayerResponse
  const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  const selectedTrack = selectCaptionTrack(tracks)
  if (!selectedTrack?.baseUrl) {
    throw new Error('该 YouTube 视频未找到公开字幕。')
  }

  notifyVideoProgress(options, { progress: 66, stage: 'subtitle', message: '已找到公开字幕，正在提取字幕内容' })
  const captionUrl = selectedTrack.baseUrl.includes('fmt=')
    ? selectedTrack.baseUrl
    : `${selectedTrack.baseUrl}&fmt=srv3`
  const captionXml = await fetchText(captionUrl)
  const transcript = youtubeCaptionXmlToMarkdown(captionXml)
  if (!transcript) {
    throw new Error('YouTube 字幕为空。')
  }

  return await buildVideoTranscriptRecord({
    platform: 'youtube',
    title: cleanText(playerResponse.videoDetails?.title) || 'YouTube 视频转写',
    author: cleanText(playerResponse.videoDetails?.author),
    sourceUrl: pageUrl,
    transcript,
    transcriptSource: getYouTubeCaptionSource(selectedTrack),
  }, options)
}

export async function fetchBilibiliTranscript(url: string, options?: VideoTranscriptOptions): Promise<VideoTranscriptResult> {
  const { bvid, pageNumber, sourceUrl } = await resolveBilibiliInput(url)
  if (!bvid) {
    throw new Error('无法识别 B站 BV 号。')
  }

  notifyVideoProgress(options, { progress: 56, stage: 'metadata', message: '正在读取 B站视频信息' })
  const videoData = await fetchBilibiliVideoData(bvid)
  const selectedPage = videoData.pages?.find(page => page.page === pageNumber)
    || videoData.pages?.[Math.max(0, pageNumber - 1)]
    || videoData.pages?.[0]
  const playerSubtitles = await fetchBilibiliPlayerSubtitles(bvid, selectedPage?.cid || videoData.cid)

  const subtitleList = playerSubtitles.length > 0 ? playerSubtitles : videoData.subtitle?.list || []
  const selectedSubtitle = selectBilibiliSubtitle(subtitleList)
  if (!selectedSubtitle?.subtitle_url) {
    throw new Error('该 B站视频未找到公开字幕。')
  }

  notifyVideoProgress(options, { progress: 66, stage: 'subtitle', message: '已找到公开字幕，正在提取字幕内容' })
  const subtitleUrl = selectedSubtitle.subtitle_url.startsWith('//')
    ? `https:${selectedSubtitle.subtitle_url}`
    : selectedSubtitle.subtitle_url
  const subtitle = await fetchBilibiliSubtitleJson(subtitleUrl, sourceUrl)
  const transcript = normalizeSubtitleEntries((subtitle.body || []).map(item => ({
    start: item.from,
    end: item.to,
    text: item.content || '',
  })))
  if (!transcript) {
    throw new Error('B站字幕为空。')
  }

  const pageLabel = selectedPage?.part ? `P${selectedPage.page || pageNumber} ${cleanText(selectedPage.part)}` : ''
  return await buildVideoTranscriptRecord({
    platform: 'bilibili',
    title: [cleanText(videoData.title) || `B站视频转写 ${bvid}`, pageLabel].filter(Boolean).join(' - '),
    author: cleanText(videoData.owner?.name),
    sourceUrl,
    transcript,
    transcriptSource: selectedSubtitle.lan_doc ? `B站字幕：${selectedSubtitle.lan_doc}` : 'B站字幕',
  }, options)
}

export async function fetchVideoTranscript(url: string, options?: VideoTranscriptOptions): Promise<VideoTranscriptResult> {
  const platform = getVideoPlatform(url)
  notifyVideoProgress(options, { progress: 55, stage: 'metadata', message: '正在识别视频平台' })
  try {
    if (platform === 'youtube') {
      return await fetchYouTubeTranscript(url, options)
    }
    if (platform === 'bilibili') {
      return await fetchBilibiliTranscript(url, options)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const canFallbackToStt = /未找到公开字幕|字幕为空|no captions|caption|视频信息获取失败|访问限制|页面结构已变化/i.test(message)
    if (platform && (canFallbackToStt || platform === 'bilibili')) {
      try {
        const subtitleTranscript = await downloadVideoSubtitle(url, options)
        if (subtitleTranscript) {
          return await buildSubtitleTranscriptRecord(url, platform, subtitleTranscript, options)
        }
        notifyVideoProgress(options, { progress: 62, stage: 'audio', message: '公开字幕不可用，切换为音频转写' })
        return await transcribeVideoAudio(url, { platform, ...options })
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        if (/invalid utf-8 sequence/i.test(fallbackMessage)) {
          throw new Error('音频转写失败：本地下载器返回了异常编码内容。')
        }
        throw fallbackError
      }
    }
    throw error
  }
  throw new Error('暂不支持该视频平台。')
}
