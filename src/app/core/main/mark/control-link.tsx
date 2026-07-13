import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CircleX, Link, FolderOpen } from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from "@/hooks/use-toast"
import { enqueueLinkCapture, type LinkCaptureOutcome } from "@/lib/link-pipeline/capture-runner"
import { routeLinkSource } from "@/lib/link-pipeline/source-router"
import {
  getGitHubProjectApiToken,
  GITHUB_PROJECT_TAG_NAME,
  parseGitHubRepoUrl,
} from "@/lib/github-project"
import { ensureTagByName } from "@/db/tags"
import { isWechatArticleUrl, WECHAT_ARTICLE_TAG_NAME } from "@/lib/wechat-article"
import { getVideoPlatform, isVideoTranscriptUrl, VIDEO_TRANSCRIPT_TAG_NAME } from "@/lib/video-transcript"
import { isXhsUrl, XHS_NOTE_TAG_NAME } from "@/lib/xhs-extractor"
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
  const hasVisibleHint = Boolean(
    isLocalMedia || githubHint || wechatHint || xhsHint || videoHint || errorMessage
  )

  const inputSection = (
    <div className="space-y-3">
      <div className="relative">
        <Link className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="粘贴链接或选择本地音视频"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (errorMessage) setErrorMessage('')
          }}
          disabled={loading}
          className="h-10 rounded-md border-border/60 bg-muted/30 pl-9 pr-16 text-sm"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleSuccess()
            }
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {url && !loading && (
            <button
              type="button"
              onClick={handleClear}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="清空"
            >
              <CircleX className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleLocalFileSelect}
            disabled={loading}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="选择本地文件"
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      </div>

      {hasVisibleHint ? (
        <div className="space-y-1.5">
          {isLocalMedia ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              已选本地媒体：{selectedLocalFile.split('/').pop()}
            </p>
          ) : null}
          {githubHint ? (
            <p className={githubTokenConfigured ? "text-[11px] leading-4 text-emerald-600" : "text-[11px] leading-4 text-amber-600"}>
              {githubHint}
            </p>
          ) : null}
          {!githubHint && wechatHint ? (
            <div className="space-y-1">
              <p className="text-[11px] leading-4 text-sky-600">
                {wechatHint}
                <button
                  type="button"
                  className="ml-1 underline-offset-2 hover:underline"
                  onClick={() => setShowWechatHtmlFallback(value => !value)}
                >
                  {showWechatHtmlFallback ? '收起' : '粘贴 HTML'}
                </button>
              </p>
              {showWechatHtmlFallback ? (
                <Textarea
                  value={wechatHtmlFallback}
                  onChange={(event) => setWechatHtmlFallback(event.target.value)}
                  disabled={loading}
                  placeholder="直接抓取失败时，可粘贴网页 HTML 源码"
                  className="max-h-32 min-h-20 resize-y border-sky-200/70 bg-background text-xs"
                />
              ) : null}
            </div>
          ) : null}
          {!githubHint && !wechatHint && xhsHint ? (
            <p className="text-[11px] leading-4 text-rose-600">{xhsHint}</p>
          ) : null}
          {!githubHint && !wechatHint && !xhsHint && videoHint ? (
            <p className="text-[11px] leading-4 text-violet-600">{videoHint}</p>
          ) : null}
          {errorMessage ? (
            <p className="text-[11px] leading-4 text-red-600">{errorMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  const optionSection = (mobile = false) => (
    <div className={cn(
      "gap-x-4 gap-y-2",
      mobile ? "grid grid-cols-1" : "flex min-w-0 flex-wrap items-center"
    )}>
      <label
        htmlFor={mobile ? "auto-read-clipboard-mobile" : "auto-read-clipboard"}
        className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Checkbox
          id={mobile ? "auto-read-clipboard-mobile" : "auto-read-clipboard"}
          checked={autoReadClipboard}
          onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
          disabled={loading}
          className="size-3.5"
        />
        <span>自动读取剪贴板</span>
      </label>
      <label
        htmlFor={mobile ? "auto-organize-link-mobile" : "auto-organize-link"}
        className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Checkbox
          id={mobile ? "auto-organize-link-mobile" : "auto-organize-link"}
          checked={organizeAfterSave}
          onCheckedChange={(checked) => handleOrganizeChange(checked === true)}
          disabled={loading}
          className="size-3.5"
        />
        <span>保存后 AI 整理</span>
      </label>
    </div>
  )

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

  async function refreshLinkRecordViews(includeAllMarks = true) {
    const { fetchAllMarks } = useMarkStore.getState()
    const refreshes: Array<Promise<unknown>> = [fetchMarks(), fetchTags()]
    if (includeAllMarks) refreshes.push(fetchAllMarks())
    const results = await Promise.allSettled(refreshes)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[Link] Saved successfully but a record view refresh failed:', result.reason)
      }
    }
    try {
      getCurrentTag()
    } catch (error) {
      console.warn('[Link] Saved successfully but current tag refresh failed:', error)
    }
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
    let managedByCaptureRunner = false
    try {
      const sourceRoute = routeLinkSource(targetUrl)
      if (sourceRoute.type === 'unknown') throw new Error('暂不支持该链接类型')

      const handleCaptureSettled = async (outcome: LinkCaptureOutcome) => {
        if (outcome.status === 'succeeded') {
          await refreshLinkRecordViews()
          const organizedSuffix = outcome.organizationJobId ? ' AI 正在后台整理。' : ''
          const warningPrefix = outcome.warning || ''
          const success = sourceRoute.type === 'github'
            ? outcome.sourceType === 'github'
              ? {
                  title: outcome.updatedExisting ? '已更新 GitHub 项目' : '已收藏 GitHub 项目',
                  description: outcome.updatedExisting
                    ? '状态：完成。项目资料卡已刷新。'
                    : `状态：完成。项目已归入「${GITHUB_PROJECT_TAG_NAME}」。`,
                }
              : {
                  title: 'GitHub 链接已保存',
                  description: `${warningPrefix || 'GitHub 专用识别不可用，已按普通链接保存。'}${organizedSuffix}`,
                }
            : sourceRoute.type === 'wechat'
              ? {
                  title: '公众号文章已保存',
                  description: `公众号正文已安全保存。${organizedSuffix}`,
                }
              : sourceRoute.type === 'xiaohongshu'
                ? {
                    title: '小红书笔记已保存',
                    description: `状态：完成。笔记已归入「${XHS_NOTE_TAG_NAME}」。`,
                  }
                : sourceRoute.type === 'video'
                  ? {
                      title: '视频转写已保存',
                      description: `状态：完成。字幕已归入「${VIDEO_TRANSCRIPT_TAG_NAME}」。`,
                    }
                  : {
                      title: '链接已保存',
                      description: `网页正文已安全保存。${organizedSuffix}`,
                    }
          toast(success)
        } else if (outcome.status === 'failed') {
          toast({
            title: '链接处理失败',
            description: outcome.error || '抓取任务已保留，可稍后重试。',
            variant: 'destructive',
          })
        }
      }

      await enqueueLinkCapture({
        jobId: queueId,
        tagId: targetTagId,
        url: targetUrl,
        sourceType: sourceRoute.type,
        autoOrganize: shouldOrganizeAfterSave,
        wechatHtmlSource,
      }, { onSettled: handleCaptureSettled })
      managedByCaptureRunner = true
      return

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast({
        title: '链接处理失败',
        description: message,
        variant: 'destructive',
      })
      console.warn('[Link] Crawling page failed:', error)
    } finally {
      if (!managedByCaptureRunner) removeQueue(queueId);
    }
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
              <DrawerTitle className="text-base">链接</DrawerTitle>
            </DrawerHeader>
            <div className="px-4">
              {inputSection}
            </div>
            <DrawerFooter className="gap-3">
              {optionSection(true)}
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-10 w-full"
              >
                {isLocalMedia ? '开始识别' : '保存'}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] gap-4 rounded-lg border-border/80 p-5 shadow-2xl sm:max-w-[480px]">
            <DialogHeader className="pr-6">
              <DialogTitle className="text-sm font-semibold">链接</DialogTitle>
            </DialogHeader>
            {inputSection}
            <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between sm:space-x-0">
              {optionSection(false)}
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-9 shrink-0"
              >
                {isLocalMedia ? '开始识别' : '保存'}
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
