import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getAllMarks, insertMark, updateMark as updateMarkRecord } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CircleX, Link, Sparkles, FolderOpen } from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from "@/hooks/use-toast"
import { normalizeWebContent, parseWebPageContent, type ParsedWebPageContent } from "@/lib/web/content-extractor"
import { organizeLinkRecord } from "@/lib/ai/link-organizer"
import { tavilyExtract } from "@/lib/tavily"
import {
  buildGitHubProjectRecord,
  fetchGitHubProjectInfo,
  getGitHubProjectApiToken,
  getGitHubProjectErrorMessage,
  getGitHubProjectMarkUrl,
  GITHUB_PROJECT_TAG_NAME,
  isGitHubProjectMark,
  parseGitHubRepoUrl,
  summarizeGitHubProject,
} from "@/lib/github-project"
import { ensureTagByName } from "@/db/tags"
import { fetchWechatArticleAsMarkdown, isWechatArticleUrl, parseWechatArticleHtml, WECHAT_ARTICLE_TAG_NAME } from "@/lib/wechat-article"
import { fetchVideoTranscript, getVideoPlatform, isVideoTranscriptUrl, VIDEO_TRANSCRIPT_TAG_NAME } from "@/lib/video-transcript"
import { buildXhsNoteRecord, fetchXhsNoteData, isXhsUrl, XHS_NOTE_TAG_NAME } from "@/lib/xhs-extractor"
import { extractAudioTrack, segmentAudio } from "@/lib/ffmpeg-wasm"
import { transcribeRecording } from "@/lib/audio"
import { readFile, writeFile, BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"

const INBOX_TAG_NAME = '中转站'
const INBOX_TAG_PATTERN = /^中转站\s*(?:[（(]\s*\d+\s*[）)])?$/

function isInboxLikeTagName(name?: string | null) {
  const normalizedName = name?.trim()
  return normalizedName === INBOX_TAG_NAME
    || normalizedName === 'Idea'
    || Boolean(normalizedName && INBOX_TAG_PATTERN.test(normalizedName))
}

export function ControlLink() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const [organizeAfterSave, setOrganizeAfterSave] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedLocalFile, setSelectedLocalFile] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false)
  const [wechatHtmlFallback, setWechatHtmlFallback] = useState('')
  const [showWechatHtmlFallback, setShowWechatHtmlFallback] = useState(false)
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  async function resolveTargetTagId() {
    const { currentTag, currentTagId: latestTagId, tags, setCurrentTagId } = useTagStore.getState()
    const selectedTag = currentTag || tags.find((tag) => tag.id === latestTagId)

    if (!latestTagId || isInboxLikeTagName(selectedTag?.name)) {
      const inboxTag = await ensureTagByName(INBOX_TAG_NAME)
      if (latestTagId !== inboxTag.id) {
        await setCurrentTagId(inboxTag.id)
      }
      return inboxTag.id
    }

    return latestTagId
  }

  // 初始化时从 store 读取设置
  useEffect(() => {
    async function loadSetting() {
      try {
        const store = await Store.load('store.json')
        const savedValue = await store.get<boolean>('autoReadClipboard')
        if (savedValue !== null && savedValue !== undefined) {
          setAutoReadClipboard(savedValue)
        }
        const savedOrganize = await store.get<boolean>('linkAutoOrganize')
        if (savedOrganize !== null && savedOrganize !== undefined) {
          setOrganizeAfterSave(savedOrganize)
        }
        const githubToken = await getGitHubProjectApiToken()
        setGithubTokenConfigured(Boolean(githubToken))
      } catch {
        // 忽略加载错误
      }
    }
    loadSetting()
  }, [])

  const handleOrganizeChange = useCallback(async (checked: boolean) => {
    setOrganizeAfterSave(checked)
    try {
      const store = await Store.load('store.json')
      await store.set('linkAutoOrganize', checked)
    } catch {
      // ignore
    }
  }, [])

  // 保存设置到 store
  const handleAutoReadChange = useCallback(async (checked: boolean) => {
    setAutoReadClipboard(checked)
    try {
      const store = await Store.load('store.json')
      await store.set('autoReadClipboard', checked)
      // 如果勾选了 checkbox，立即读取剪贴板
      if (checked) {
        try {
          const hasTextRes = await hasText()
          if (hasTextRes) {
            const clipboardText = await readText()
            if (clipboardText && isValidUrl(clipboardText)) {
              setUrl(clipboardText)
            }
          }
        } catch {
          // 忽略剪贴板读取错误
        }
      }
    } catch {
      // 忽略保存错误
    }
  }, [])

  // 检查剪贴板中的链接
  const checkClipboard = useCallback(async () => {
    // 只有启用自动读取时才检查剪贴板
    if (!autoReadClipboard) {
      return
    }

    try {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        const clipboardText = await readText()
        if (clipboardText && isValidUrl(clipboardText)) {
          setUrl(clipboardText)
        }
      }
    } catch {
      // 如果读取失败（比如在 Web 环境），静默忽略
    }
  }, [autoReadClipboard])

  const handleOpen = useCallback(async () => {
    setOpen(true)
    setErrorMessage('')
    await checkClipboard()
  }, [checkClipboard])

  const handleOpenChange = useCallback(async (open: boolean) => {
    setOpen(open)
    if (!open) {
      setErrorMessage('')
    }
    if (open) {
      const githubToken = await getGitHubProjectApiToken()
      setGithubTokenConfigured(Boolean(githubToken))
      await checkClipboard()
    }
  }, [checkClipboard])

  useEffect(() => {
    emitter.on('toolbar-shortcut-link', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-link', handleOpen)
    }
  }, [handleOpen])

  // 检查是否是有效的 URL
  function isValidUrl(text: string): boolean {
    if (!text || text.trim().length === 0) return false
    const trimmed = text.trim()
    // 支持带或不带协议的 URL
    const urlPattern = /^https?:\/\/.+/i
    const domainPattern = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}/i
    return urlPattern.test(trimmed) || domainPattern.test(trimmed)
  }

  type LinkCaptureErrorCode = 'http' | 'non_text' | 'parse' | 'network' | 'unknown'
  class LinkCaptureError extends Error {
    code: LinkCaptureErrorCode
    status?: number
    contentType?: string

    constructor(
      message: string,
      code: LinkCaptureErrorCode,
      options?: { status?: number; contentType?: string }
    ) {
      super(message)
      this.name = 'LinkCaptureError'
      this.code = code
      this.status = options?.status
      this.contentType = options?.contentType
    }
  }

  function toLinkCaptureError(error: unknown): LinkCaptureError {
    if (error instanceof LinkCaptureError) {
      return error
    }
    if (error instanceof Error) {
      const httpStatus = error.message.match(/HTTP\s+(\d+)/i)?.[1]
      if (httpStatus) {
        return new LinkCaptureError(error.message, 'http', {
          status: Number(httpStatus),
        })
      }

      const lowered = error.message.toLowerCase()
      if (
        lowered.includes('network')
        || lowered.includes('timeout')
        || lowered.includes('failed to fetch')
        || lowered.includes('error sending request')
      ) {
        return new LinkCaptureError(error.message, 'network')
      }
      return new LinkCaptureError(error.message, 'unknown')
    }
    return new LinkCaptureError(String(error), 'unknown')
  }

  function getLinkErrorMessage(error: LinkCaptureError): string {
    if (/invalid utf-8 sequence/i.test(error.message)) {
      return '链接返回内容包含异常编码，当前解析器无法稳定读取。若是 B站视频，请确认视频可公开访问，并稍后重试音频转写。'
    }

    if (error.code === 'http') {
      if (error.status === 403) {
        return '请求被目标站点拒绝（403）。该站点可能开启了 Cloudflare/WAF，请更换可直连链接，或改用支持浏览器渲染的抓取方式。'
      }
      if (error.status === 401) {
        return '目标网页需要登录（401），当前抓取不带登录态。请先登录后复制正文，或使用可匿名访问的链接。'
      }
      if (error.status === 404) {
        return '目标网页不存在（404），请检查链接是否正确。'
      }
      if (error.status === 429) {
        return '目标站点或提取服务请求过于频繁（429），暂时限流了。请稍后重试，或换一个可直接访问的链接。'
      }
      return `链接抓取失败（HTTP ${error.status ?? 'unknown'}）。请稍后重试，或更换链接。`
    }

    if (error.code === 'non_text') {
      return `当前链接返回的不是网页文本内容（${error.contentType || 'unknown content-type'}）。建议改用 PDF/OCR 或文件导入方式。`
    }

    if (error.code === 'parse') {
      return '网页内容解析失败，可能是动态渲染页面或编码异常。建议使用可公开访问的文章页链接。'
    }

    if (error.code === 'network') {
      return '网络请求失败，请检查网络连接、代理设置，或稍后重试。'
    }

    return error.message || '链接处理失败，请重试。'
  }

  function getFallbackTitleFromUrl(targetUrl: string): string {
    try {
      return new URL(targetUrl).hostname.replace(/^www\./, '')
    } catch {
      return targetUrl
    }
  }

  function getTitleFromMarkdown(markdown: string, targetUrl: string): string {
    const heading = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => /^#{1,2}\s+/.test(line))

    return heading?.replace(/^#{1,2}\s+/, '').trim() || getFallbackTitleFromUrl(targetUrl)
  }

  function shouldFallbackToTavily(content: string): boolean {
    const compact = content.replace(/\s+/g, '')
    return compact.length < 500
  }

  async function extractPageViaTavily(targetUrl: string) {
    const response = await tavilyExtract({
      urls: targetUrl,
      extractDepth: 'advanced',
      format: 'markdown',
      timeout: 20,
    })
    const result = response.results[0]
    const content = normalizeWebContent(result?.rawContent?.trim() || '')
    if (!content) {
      const failedReason = response.failedResults[0]?.error
      throw new LinkCaptureError(failedReason || 'Tavily Extract 未返回可用正文', 'parse')
    }

    const title = getTitleFromMarkdown(content, targetUrl)
    return {
      title,
      metaDesc: '通过 Tavily Extract 提取',
      mainContent: content.slice(0, 20000),
      bodyText: content.slice(0, 20000),
      url: targetUrl,
    }
  }

  // 清空输入框
  function handleClear() {
    setUrl('')
    setSelectedLocalFile('')
    setErrorMessage('')
    setWechatHtmlFallback('')
    setShowWechatHtmlFallback(false)
  }

  const isLocalMedia = Boolean(selectedLocalFile && url === selectedLocalFile)

  const githubRepoPreview = parseGitHubRepoUrl(url)
  const githubHint = githubRepoPreview
    ? githubTokenConfigured
      ? `已识别 GitHub 仓库 ${githubRepoPreview.owner}/${githubRepoPreview.repo}，将保存到「${GITHUB_PROJECT_TAG_NAME}」。`
      : '已识别 GitHub 仓库。未配置 GitHub Token，将按普通链接保存；可在设置中配置后启用项目卡片。'
    : ''
  const wechatArticlePreview = isWechatArticleUrl(url)
  const wechatHint = wechatArticlePreview
    ? `已识别微信公众号文章，将提取正文并保存到「${WECHAT_ARTICLE_TAG_NAME}」。`
    : ''
  const xhsPreview = isXhsUrl(url)
  const xhsHint = xhsPreview
    ? `已识别小红书笔记，将提取正文、图片和视频直链并保存到「${XHS_NOTE_TAG_NAME}」。`
    : ''
  const videoPlatformPreview = isXhsUrl(url) ? null : getVideoPlatform(url)
  const videoHint = videoPlatformPreview
    ? `已识别${videoPlatformPreview === 'youtube' ? ' YouTube' : ' B站'}视频，将优先提取公开字幕并保存到「${VIDEO_TRANSCRIPT_TAG_NAME}」。`
    : ''
  const canSubmit = Boolean(url.trim()) && !loading

  const inputSection = (
    <div className="space-y-3">
      <div className="relative">
        <Link className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (errorMessage) setErrorMessage('')
          }}
          disabled={loading}
          className="h-10 border-border/80 bg-muted/30 pl-9 pr-16 text-sm shadow-sm"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleSuccess()
            }
          }}
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {url && !loading && (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="清空链接"
            >
              <CircleX className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleLocalFileSelect}
            disabled={loading}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="选择本地视频或音频"
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      </div>
      {isLocalMedia ? (
        <div className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-700">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 animate-pulse text-violet-600" />
          <span>已选择本地媒体：{selectedLocalFile.split('/').pop()}。点击下方「开始识别」即可一键提取转译。</span>
        </div>
      ) : null}
      {githubHint ? (
        <div className={githubTokenConfigured
          ? "flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700"
          : "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700"
        }>
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>{githubHint}</span>
        </div>
      ) : null}
      {!githubHint && wechatHint ? (
        <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">{wechatHint}</span>
            <button
              type="button"
              className="shrink-0 font-medium text-sky-800 underline-offset-2 hover:underline"
              onClick={() => setShowWechatHtmlFallback(value => !value)}
            >
              {showWechatHtmlFallback ? '收起 HTML' : '粘贴 HTML'}
            </button>
          </div>
          {showWechatHtmlFallback ? (
            <div className="space-y-1.5">
              <Textarea
                value={wechatHtmlFallback}
                onChange={(event) => setWechatHtmlFallback(event.target.value)}
                disabled={loading}
                placeholder="如果直接抓取失败，可在浏览器打开文章后复制网页 HTML 源码粘贴到这里。"
                className="max-h-40 min-h-24 resize-y border-sky-200 bg-white/80 text-xs text-slate-800 placeholder:text-sky-700/60"
              />
              <p className="text-[11px] leading-4 text-sky-700/80">
                粘贴后会优先使用这段 HTML 提取正文，不再请求微信页面。
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {!githubHint && !wechatHint && xhsHint ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>{xhsHint}</span>
        </div>
      ) : null}
      {!githubHint && !wechatHint && !xhsHint && videoHint ? (
        <div className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-700">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>{videoHint}</span>
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {errorMessage}
        </div>
      ) : null}
    </div>
  )

  const optionSection = (mobile = false) => (
    <div className={mobile ? "grid gap-3" : "flex min-w-0 flex-wrap items-center gap-4"}>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          id={mobile ? "auto-read-clipboard-mobile" : "auto-read-clipboard"}
          checked={autoReadClipboard}
          onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
          disabled={loading}
        />
        <span>自动读取剪贴板链接</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          id={mobile ? "auto-organize-link-mobile" : "auto-organize-link"}
          checked={organizeAfterSave}
          onCheckedChange={(checked) => handleOrganizeChange(checked === true)}
          disabled={loading}
        />
        <span>保存后 AI 整理</span>
      </label>
    </div>
  )

  function findExistingGitHubProjectMark(projectUrl: string) {
    const normalizedUrl = getGitHubProjectMarkUrl({
      id: 0,
      tagId: 0,
      type: 'link',
      content: '',
      desc: '',
      url: projectUrl,
      deleted: 0,
      createdAt: Date.now(),
    })
    const { allMarks, marks } = useMarkStore.getState()
    return [...allMarks, ...marks]
      .filter(mark => mark.deleted !== 1)
      .find(mark => isGitHubProjectMark(mark) && getGitHubProjectMarkUrl(mark) === normalizedUrl)
  }

  function normalizeTargetUrl(value: string) {
    const trimmed = value.trim()
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
  }

  function getUrlDisplayName(targetUrl: string) {
    const githubRepo = parseGitHubRepoUrl(targetUrl)
    if (githubRepo) {
      return `${githubRepo.owner}/${githubRepo.repo}`
    }

    try {
      return new URL(targetUrl).hostname.replace(/^www\./, '')
    } catch {
      return targetUrl
    }
  }  // 处理移动端文件选择
  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const fileName = file.name
      setUrl(fileName)
      setSelectedLocalFile(fileName)
    } catch (error) {
      console.error('移动端选择文件失败:', error)
      toast({
        title: '选择文件失败',
        description: error instanceof Error ? error.message : '选择文件失败',
        variant: 'destructive'
      })
    }
  }

  // 选择音频或视频文件
  async function handleLocalFileSelect() {
    try {
      const { isMobileDevice } = await import('@/lib/check')
      if (isMobileDevice()) {
        fileInputRef.current?.click()
        return
      }

      // PC 端使用 Tauri dialog
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Media',
          extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'webm', 'mp4', 'mov']
        }]
      })

      if (!selected) return

      const filePath = selected as string
      setUrl(filePath)
      setSelectedLocalFile(filePath)
    } catch (error) {
      console.error('文件选择失败:', error)
      toast({
        title: '选择文件失败',
        description: error instanceof Error ? error.message : '选择文件失败',
        variant: 'destructive'
      })
    }
  }

  // 专门在后台对本地多媒体文件（视频、音频）进行音轨剥离和切片转译
  const handleLocalMediaTranscription = async (
    targetFilePath: string,
    queueId: string,
    targetTagId: number,
  ) => {
    const formatSeconds = (val: number) => {
      const pad = (v: number) => String(v).padStart(2, '0')
      const total = Math.max(0, Math.floor(val))
      const mins = Math.floor(total / 60)
      const secs = total % 60
      return `${pad(mins)}:${pad(secs)}`
    }

    try {
      let mediaBlob: Blob | null = null

      const { isMobileDevice } = await import('@/lib/check')
      if (isMobileDevice()) {
        const file = fileInputRef.current?.files?.[0]
        if (!file) {
          throw new Error('未获取到有效的移动端文件实体')
        }
        mediaBlob = file
      } else {
        const fileData = await readFile(targetFilePath)
        const extension = targetFilePath.split('.').pop()?.toLowerCase()
        const mimeType = extension === 'wav' ? 'audio/wav' :
                        extension === 'mp3' ? 'audio/mpeg' :
                        extension === 'm4a' ? 'audio/mp4' :
                        extension === 'mp4' ? 'video/mp4' :
                        extension === 'mov' ? 'video/quicktime' :
                        extension === 'webm' ? 'video/webm' :
                        'audio/mpeg'

        const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
        mediaBlob = new Blob([buffer], { type: mimeType })
      }

      if (!mediaBlob || mediaBlob.size === 0) {
        throw new Error('多媒体文件数据为空')
      }

      // 1. 调用 WASM 前端引擎提取标准化音轨（16kHz Mono MP3）
      const audioBlob = await extractAudioTrack(mediaBlob, (progress) => {
        setQueue(queueId, { progress: `音轨提取中 ${progress}%...` })
      })

      setQueue(queueId, { progress: '极速切片分片中 40%...' })

      // 2. 使用 WASM 进行高速音频无损分片
      const chunks = await segmentAudio(audioBlob, 180)

      let transcription = ''
      if (chunks.length === 0) {
        throw new Error('未提取到任何有效音频数据')
      } else if (chunks.length === 1) {
        setQueue(queueId, { progress: '语音识别中 60%...' })
        transcription = await transcribeRecording(chunks[0])
      } else {
        // 多片并发 Whisper 转录
        const transcriptions = new Array<string>(chunks.length)
        let finished = 0

        setQueue(queueId, { progress: `并发识别中 0/${chunks.length}...` })

        await Promise.all(chunks.map(async (chunk: Blob, index: number) => {
          try {
            const chunkText = await transcribeRecording(chunk)
            if (chunkText && chunkText.trim()) {
              transcriptions[index] = `- ${formatSeconds(index * 180)} ${chunkText.trim()}`
            }
          } catch (chunkError) {
            console.error(`[WASM STT] Chunk ${index} failed:`, chunkError)
          }
          finished += 1
          setQueue(queueId, {
            progress: `并发识别中 ${finished}/${chunks.length} (${Math.round((finished / chunks.length) * 45 + 50)}%)...`
          })
        }))

        transcription = transcriptions.filter(Boolean).join('\n\n')
      }

      if (!transcription || !transcription.trim()) {
        throw new Error('未检测到有效的语音文本')
      }

      // 3. 将标准化音轨保存为本地 recordings 文件以支持卡片本地播放
      const timestamp = Date.now()
      const filename = `recording_${timestamp}.mp3`
      const audioDir = 'recordings'

      const dirExists = await exists(audioDir, { baseDir: BaseDirectory.AppData })
      if (!dirExists) {
        await mkdir(audioDir, { baseDir: BaseDirectory.AppData, recursive: true })
      }

      const arrayBuffer = await audioBlob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const filePath = `${audioDir}/${filename}`
      await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })

      // 4. 插入记录
      const originalFileName = targetFilePath.split(/[/\\]/).pop() || '语音记录'
      await insertMark({
        tagId: targetTagId,
        type: 'recording',
        desc: originalFileName,
        content: transcription,
        url: filePath
      })

      removeQueue(queueId)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()

      toast({
        title: '音视频文件转录完成',
        description: `已成功保存为语音记录。双击即可查阅并一键直绘精美卡片！`,
      })

    } catch (error) {
      console.error('[WASM Media Select In Link] Failed:', error)
      removeQueue(queueId)
      toast({
        title: '本地多媒体识别失败',
        description: error instanceof Error ? error.message : '转写识别失败，请重试',
        variant: 'destructive'
      })
    }
  }

  async function handleSuccess() {
    if (!url || loading) return
    const targetTagId = await resolveTargetTagId()
    const queueId = crypto.randomUUID()

    if (isLocalMedia) {
      // 本地多媒体文件识别流程
      setLoading(true)
      setOpen(false)
      setLoading(false)

      addQueue({
        queueId,
        tagId: targetTagId,
        type: 'recording',
        progress: '多媒体加载中...',
        startTime: Date.now()
      })

      toast({
        title: '已转入后台多媒体识别',
        description: `状态：多媒体已载入。正在使用纯前端 WASM 引擎转换文件：${selectedLocalFile.split('/').pop()}`,
      })

      // 异步执行本地转译
      void handleLocalMediaTranscription(selectedLocalFile, queueId, targetTagId)

      // 清空选择状态
      setUrl('')
      setSelectedLocalFile('')
      return
    }

    if (!isValidUrl(url)) {
      setErrorMessage('请输入有效链接，例如 https://github.com/owner/repo')
      return
    }

    const targetUrl = normalizeTargetUrl(url)
    const shouldOrganizeAfterSave = organizeAfterSave
    const isGitHubRepo = Boolean(parseGitHubRepoUrl(targetUrl))
    const isWechatArticle = isWechatArticleUrl(targetUrl)
    const isXhsLink = isXhsUrl(targetUrl)
    const isVideoLink = !isXhsLink && isVideoTranscriptUrl(targetUrl)

    setErrorMessage('')
    setLoading(true)
    const wechatHtmlSource = isWechatArticle ? wechatHtmlFallback.trim() : ''

    addQueue({
      queueId,
      tagId: targetTagId,
      type: 'link',
      progress: '0%',
      startTime: Date.now()
    })

    handleRecordComplete(router)
    setUrl('')
    setWechatHtmlFallback('')
    setShowWechatHtmlFallback(false)
    setOpen(false)
    setLoading(false)

    toast({
      title: '已转入后台解析',
      description: isGitHubRepo
        ? `状态：识别中。正在识别 GitHub 项目：${getUrlDisplayName(targetUrl)}`
        : isWechatArticle
          ? `状态：提取中。正在转换微信公众号文章：${getUrlDisplayName(targetUrl)}`
          : isXhsLink
            ? `状态：提取中。正在提取小红书笔记：${getUrlDisplayName(targetUrl)}`
            : isVideoLink
              ? `状态：提取中。正在提取视频字幕：${getUrlDisplayName(targetUrl)}`
              : `状态：解析中。正在抓取并整理：${getUrlDisplayName(targetUrl)}`,
    })

    void processLinkInBackground({
      targetUrl,
      queueId,
      targetTagId,
      shouldOrganizeAfterSave,
      wechatHtmlSource,
    })
  }

  async function processLinkInBackground({
    targetUrl,
    queueId,
    targetTagId,
    shouldOrganizeAfterSave,
    wechatHtmlSource,
  }: {
    targetUrl: string
    queueId: string
    targetTagId: number
    shouldOrganizeAfterSave: boolean
    wechatHtmlSource?: string
  }) {
    try {
      setQueue(queueId, { progress: '30%' });

      const githubRepo = parseGitHubRepoUrl(targetUrl)
      const githubToken = await getGitHubProjectApiToken()
      if (githubRepo && githubToken) {
        try {
          setQueue(queueId, { progress: '45%' })
          const projectInfo = await fetchGitHubProjectInfo(githubRepo, githubToken)
          setQueue(queueId, { progress: '70%' })
          const summary = await summarizeGitHubProject(projectInfo)
          const projectRecord = buildGitHubProjectRecord({ ...projectInfo, summary })
          const projectTag = await ensureTagByName(GITHUB_PROJECT_TAG_NAME)

          const { fetchAllMarks } = useMarkStore.getState()
          await fetchAllMarks()
          const existingMark = findExistingGitHubProjectMark(projectInfo.url)
          if (existingMark) {
            const { updateMark: updateMarkInStore } = useMarkStore.getState()
            await updateMarkInStore({
              ...existingMark,
              tagId: projectTag.id,
              desc: projectRecord.desc,
              content: projectRecord.content,
              url: projectInfo.url,
              deleted: 0,
              processed: 0,
              processedAt: null,
            })

            setQueue(queueId, { progress: '100%', tagId: projectTag.id })
            await fetchMarks()
            await fetchAllMarks()
            await fetchTags()
            getCurrentTag()
            toast({
              title: '已更新 GitHub 项目',
              description: `状态：完成。${projectInfo.fullName} 的项目卡片已刷新。`,
            })
            return
          }

          await insertMark({
            tagId: projectTag.id,
            type: 'link',
            desc: projectRecord.desc,
            content: projectRecord.content,
            url: projectInfo.url,
          })

          setQueue(queueId, { progress: '100%', tagId: projectTag.id })
          await fetchMarks()
          await fetchAllMarks()
          await fetchTags()
          getCurrentTag()
          toast({
            title: '已收藏 GitHub 项目',
            description: `状态：完成。${projectInfo.fullName} 已归入「${GITHUB_PROJECT_TAG_NAME}」。`,
          })
          return
        } catch (githubError) {
          console.warn('[Link] GitHub project capture failed, fallback to normal link:', githubError)
          const githubMessage = getGitHubProjectErrorMessage(githubError)
          toast({
            title: 'GitHub 项目识别失败',
            description: `${githubMessage} 已回退为普通链接记录流程。`,
          })
        }
      }

      if (isWechatArticleUrl(targetUrl)) {
        setQueue(queueId, { progress: '55%' })
        const wechatArticle = wechatHtmlSource
          ? parseWechatArticleHtml(wechatHtmlSource, targetUrl)
          : await fetchWechatArticleAsMarkdown(targetUrl)
        const articleTag = await ensureTagByName(WECHAT_ARTICLE_TAG_NAME)

        await insertMark({
          tagId: articleTag.id,
          type: 'link',
          desc: wechatArticle.desc,
          content: wechatArticle.content,
          url: targetUrl,
        })

        setQueue(queueId, { progress: '100%', tagId: articleTag.id })
        const { fetchAllMarks } = useMarkStore.getState()
        await fetchMarks()
        await fetchAllMarks()
        await fetchTags()
        getCurrentTag()
        toast({
          title: '公众号文章已保存',
          description: `状态：完成。${wechatArticle.title} 已归入「${WECHAT_ARTICLE_TAG_NAME}」。`,
        })
        return
      }

      if (isXhsUrl(targetUrl)) {
        setQueue(queueId, { progress: '55% 正在读取小红书笔记...' })
        const xhsNote = await fetchXhsNoteData(targetUrl)
        setQueue(queueId, { progress: '80% 正在生成笔记卡片...' })
        const noteRecord = buildXhsNoteRecord(xhsNote)
        const xhsTag = await ensureTagByName(XHS_NOTE_TAG_NAME)

        await insertMark({
          tagId: xhsTag.id,
          type: 'link',
          desc: noteRecord.desc,
          content: noteRecord.content,
          url: noteRecord.url,
        })

        setQueue(queueId, { progress: '100%', tagId: xhsTag.id })
        const { fetchAllMarks } = useMarkStore.getState()
        await fetchMarks()
        await fetchAllMarks()
        await fetchTags()
        getCurrentTag()
        toast({
          title: '小红书笔记已保存',
          description: `状态：完成。${noteRecord.title} 已归入「${XHS_NOTE_TAG_NAME}」。`,
        })
        return
      }

      if (isVideoTranscriptUrl(targetUrl)) {
        setQueue(queueId, { progress: '55%' })
        const videoTranscript = await fetchVideoTranscript(targetUrl, {
          onProgress: ({ progress, message }) => {
            setQueue(queueId, { progress: `${progress}% ${message}` })
          },
        })
        const videoTag = await ensureTagByName(VIDEO_TRANSCRIPT_TAG_NAME)

        await insertMark({
          tagId: videoTag.id,
          type: 'link',
          desc: videoTranscript.desc,
          content: videoTranscript.content,
          url: videoTranscript.sourceUrl,
        })

        setQueue(queueId, { progress: '100%', tagId: videoTag.id })
        const { fetchAllMarks } = useMarkStore.getState()
        await fetchMarks()
        await fetchAllMarks()
        await fetchTags()
        getCurrentTag()
        toast({
          title: '视频转写已保存',
          description: `状态：完成。${videoTranscript.title} 已归入「${VIDEO_TRANSCRIPT_TAG_NAME}」。`,
        })
        return
      }

      let pageContent: ParsedWebPageContent
      try {
        // 使用 Tauri 的 HTTP 插件快速获取页面内容
        const response = await tauriFetch(targetUrl, {
          method: 'GET',
          connectTimeout: 12000,
          maxRedirections: 5,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'identity',
          },
        });

        if (!response.ok) {
          throw new LinkCaptureError(`HTTP 错误: ${response.status}`, 'http', {
            status: response.status,
          })
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase()
        const isTextLike =
          !contentType
          || contentType.includes('text/')
          || contentType.includes('application/xhtml+xml')
          || contentType.includes('application/xml')
          || contentType.includes('application/json')
        if (!isTextLike) {
          throw new LinkCaptureError(
            `当前链接返回的不是可解析网页内容（Content-Type: ${contentType}）`,
            'non_text',
            { contentType }
          )
        }

        setQueue(queueId, { progress: '60%' });

        const html = await extractResponseText(response);
        if (!html) {
          throw new LinkCaptureError('网页内容编码异常，无法稳定解码为文本。', 'parse')
        }
        pageContent = parseWebPageContent(html, targetUrl);
        const directContent = pageContent.mainContent || pageContent.bodyText || pageContent.metaDesc
        if (shouldFallbackToTavily(directContent || '')) {
          setQueue(queueId, { progress: '70%' });
          pageContent = await extractPageViaTavily(targetUrl)
        }
      } catch (directError) {
        const typedError = toLinkCaptureError(directError)
        if (typedError.code === 'unknown') {
          throw typedError
        }

        setQueue(queueId, { progress: '70%' });
        pageContent = await extractPageViaTavily(targetUrl)
      }

      setQueue(queueId, { progress: shouldOrganizeAfterSave ? '90% 正在保存清洗正文...' : '90%' });

      // 提取有用的内容
      const { title, metaDesc, mainContent, bodyText } = pageContent;

      const rawDesc = [title, metaDesc].filter(Boolean).join('\n');
      const rawContent = mainContent || bodyText || metaDesc || `来源链接：${targetUrl}`;

      if (!rawContent.trim()) {
        throw new LinkCaptureError('网页解析结果为空', 'parse')
      }

      // 保存到数据库
      const insertResult = await insertMark({
        tagId: targetTagId,
        type: 'link',
        desc: rawDesc,
        content: rawContent,
        url: targetUrl
      });

      setQueue(queueId, { progress: '100%' });
      await fetchMarks();
      await fetchTags();
      getCurrentTag();

      const insertedId = Number(insertResult.lastInsertId || 0)
      if (shouldOrganizeAfterSave && insertedId > 0) {
        toast({
          title: '链接已保存',
          description: '状态：已保存正文，AI 正在后台整理为中文资料卡。',
        })

        void organizeSavedLinkRecord({
          insertedId,
          targetUrl,
          title,
          metaDesc,
          rawContent,
        })
      } else {
        toast({
          title: '链接已保存',
          description: '状态：完成。网页正文已保存。',
        })
      }


    } catch (error) {
      const typedError = toLinkCaptureError(error)
      const message = getLinkErrorMessage(typedError)
      toast({
        title: '链接处理失败',
        description: message,
        variant: 'destructive',
      })
      console.warn('[Link] Crawling page failed:', error)
    } finally {
      removeQueue(queueId);
    }
  }

  async function organizeSavedLinkRecord({
    insertedId,
    targetUrl,
    title,
    metaDesc,
    rawContent,
  }: {
    insertedId: number
    targetUrl: string
    title: string
    metaDesc?: string
    rawContent: string
  }) {
    try {
      const organized = await organizeLinkRecord({
        url: targetUrl,
        title,
        metaDesc,
        content: rawContent,
      })
      if (!organized) {
        return
      }

      const latestMarks = await getAllMarks()
      const targetMark = latestMarks.find(item => item.id === insertedId)
      if (!targetMark || targetMark.deleted === 1) {
        return
      }

      await updateMarkRecord({
        ...targetMark,
        desc: organized.desc || targetMark.desc,
        content: organized.content || targetMark.content,
      })

      const { fetchAllMarks } = useMarkStore.getState()
      await fetchMarks()
      await fetchAllMarks()

      toast({
        title: 'AI 整理完成',
        description: '链接内容已更新为中文结构化资料卡。',
      })
    } catch (backgroundError) {
      console.warn('[Link] Background link organize failed:', backgroundError)
    }
  }

  async function extractResponseText(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type')
    const contentEncoding = response.headers.get('content-encoding') || ''

    try {
      const sourceBuffer = await response.arrayBuffer()
      const sourceBytes = new Uint8Array(sourceBuffer)

      let text = decodeBestEffortText(sourceBytes, contentType)
      if (looksLikeGarbledText(text) && contentEncoding) {
        const decompressed = await decompressBytes(sourceBytes, contentEncoding)
        if (decompressed) {
          const decompressedText = decodeBestEffortText(decompressed, contentType)
          if (!looksLikeGarbledText(decompressedText) || decompressedText.length > text.length) {
            text = decompressedText
          }
        }
      }

      if (!looksLikeGarbledText(text)) {
        return text
      }
    } catch (error) {
      console.warn('[Link] response text decode fallback failed:', error)
    }

    return ''
  }

  function decodeBestEffortText(bytes: Uint8Array, contentType: string | null): string {
    const charset = extractCharset(contentType)
    const candidates = [charset, 'utf-8', 'gb18030', 'gbk', 'big5']
      .filter((item, index, arr): item is string => !!item && arr.indexOf(item) === index)
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
        // ignore unsupported encoding
      }
    }

    if (best) {
      return best
    }

    try {
      return new TextDecoder().decode(bytes)
    } catch {
      return ''
    }
  }

  function extractCharset(contentType: string | null): string | null {
    if (!contentType) {
      return null
    }
    const match = contentType.match(/charset=([^\s;]+)/i)
    return match?.[1]?.trim().toLowerCase() || null
  }

  function getTextScore(text: string): number {
    if (!text) {
      return Number.NEGATIVE_INFINITY
    }
    const length = text.length || 1
    const replacementCount = (text.match(/\uFFFD/g) || []).length
    const replacementRatio = replacementCount / length
    const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length
    const controlRatio = controlCount / length

    let score = 0
    if (/<html[\s>]/i.test(text)) score += 40
    if (/<body[\s>]/i.test(text)) score += 20
    if (/<title[\s>]/i.test(text)) score += 10
    score -= replacementRatio * 300
    score -= controlRatio * 200
    return score
  }

  function looksLikeGarbledText(text: string): boolean {
    if (!text) {
      return true
    }
    const length = text.length
    if (length < 20) {
      return false
    }

    const replacementCount = (text.match(/\uFFFD/g) || []).length
    const replacementRatio = replacementCount / length
    if (replacementRatio > 0.02) {
      return true
    }

    const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length
    const controlRatio = controlCount / length
    if (controlRatio > 0.01) {
      return true
    }

    return false
  }

  async function decompressBytes(bytes: Uint8Array, encodingHeader: string): Promise<Uint8Array | null> {
    if (typeof DecompressionStream === 'undefined') {
      return null
    }

    const encodings = encodingHeader
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)

    if (encodings.length === 0) {
      return null
    }

    let result = bytes
    let decompressed = false

    for (let index = encodings.length - 1; index >= 0; index--) {
      const encoding = encodings[index]
      const format: 'gzip' | 'deflate' | null = encoding === 'x-gzip'
        ? 'gzip'
        : encoding === 'gzip' || encoding === 'deflate'
          ? encoding
          : null

      if (!format) {
        continue
      }

      try {
        const stream = new Blob([result]).stream().pipeThrough(new DecompressionStream(format))
        const decompressedBuffer = await new Response(stream).arrayBuffer()
        result = new Uint8Array(decompressedBuffer)
        decompressed = true
      } catch {
        return null
      }
    }

    return decompressed ? result : null
  }

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DrawerTrigger>
          <DrawerContent className="px-1">
            <DrawerHeader className="text-left">
              <DrawerTitle className="text-base">链接记录</DrawerTitle>
              <DrawerDescription className="text-xs">
                输入网页链接，系统将在后台抓取内容并保存为记录。
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              {inputSection}
            </div>
            <DrawerFooter className="gap-4">
              {optionSection(true)}
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-10 w-full"
              >
                {isLocalMedia ? '开始识别' : '保存并解析'}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] gap-5 rounded-lg border-border/80 p-5 shadow-2xl sm:max-w-[560px]">
            <DialogHeader className="space-y-1 pr-6">
              <DialogTitle className="text-base font-semibold">链接记录</DialogTitle>
              <DialogDescription className="text-xs">
                输入网页链接，系统将在后台抓取内容并保存为记录。
              </DialogDescription>
            </DialogHeader>
            {inputSection}
            <DialogFooter className="flex-row items-center justify-between gap-4 sm:justify-between sm:space-x-0">
              {optionSection(false)}
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-10 min-w-32 shrink-0"
              >
                {isLocalMedia ? '开始识别' : '保存并解析'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.wma,.webm,.mp4,.mov"
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
    </>
  )
}
