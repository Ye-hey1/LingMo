import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { Link, CircleX } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { v4 as uuidv4 } from 'uuid'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { hasText, readText } from 'tauri-plugin-clipboard-api'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from "@/hooks/use-toast"
import { parseWebPageContent, type ParsedWebPageContent } from "@/lib/web/content-extractor"
import { organizeLinkRecord } from "@/lib/ai/link-organizer"
import { tavilyExtract } from "@/lib/tavily"

export function ControlLink() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoReadClipboard, setAutoReadClipboard] = useState(true)
  const [organizeAfterSave, setOrganizeAfterSave] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

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
    const content = result?.rawContent?.trim() || ''
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
    setErrorMessage('')
  }

  async function handleSuccess() {
    if (!url) return
    setErrorMessage('')

    let targetUrl = url.trim()
    if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`
      setUrl(targetUrl)
    }
    
    setLoading(true)
    const queueId = uuidv4()
    
    // 添加到队列中显示加载状态
    addQueue({
      queueId,
      tagId: currentTagId!,
      type: 'link',
      progress: '0%',
      startTime: Date.now()
    })
    
    // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
    handleRecordComplete(router)
    
    try {
      setQueue(queueId, { progress: '30%' });

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

      setQueue(queueId, { progress: '90%' });

      // 提取有用的内容
      const { title, metaDesc, mainContent, bodyText } = pageContent;

      // 构建描述
      let desc = [title, metaDesc].filter(Boolean).join('\n');

      // 构建内容（优先使用主要内容，如果没有则使用正文）
      let content = mainContent || bodyText || metaDesc || `来源链接：${targetUrl}`;

      if (!content.trim()) {
        throw new LinkCaptureError('网页解析结果为空', 'parse')
      }

      // 保存到数据库
      const insertResult = await insertMark({
        tagId: currentTagId,
        type: 'link',
        desc: desc,
        content: content,
        url: targetUrl
      });

      setQueue(queueId, { progress: '100%' });
      await fetchMarks();
      await fetchTags();
      getCurrentTag();

      setUrl('');
      setOpen(false);

      // 保存后后台异步整理，避免阻塞弹窗
      const insertedId = Number(insertResult.lastInsertId || 0)
      if (organizeAfterSave && insertedId > 0) {
        toast({
          title: '链接已保存',
          description: 'AI 正在后台整理内容，你可以继续操作。',
        })

        void (async () => {
          try {
            const organized = await organizeLinkRecord({
              url: targetUrl,
              title,
              metaDesc,
              content,
            })
            if (!organized) {
              return
            }

            // 读取最新记录并更新
            await fetchMarks()
            const { marks, updateMark: updateMarkInStore } = useMarkStore.getState()
            const targetMark = marks.find(item => item.id === insertedId)
            if (!targetMark) {
              return
            }

            await updateMarkInStore({
              ...targetMark,
              desc: organized.desc || targetMark.desc,
              content: organized.content || targetMark.content,
            })

            toast({
              title: 'AI 整理完成',
              description: '链接内容已优化为结构化摘要。',
            })
          } catch (backgroundError) {
            console.error('Background link organize failed:', backgroundError)
          }
        })()
      }
      
    } catch (error) {
      const typedError = toLinkCaptureError(error)
      const message = getLinkErrorMessage(typedError)
      setErrorMessage(message)
      toast({
        title: '链接处理失败',
        description: message,
        variant: 'destructive',
      })
      console.error('Error crawling page:', error);
    } finally {
      removeQueue(queueId);
      setLoading(false);
    }
  }

  async function extractResponseText(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type')
    const contentEncoding = response.headers.get('content-encoding') || ''
    const fallbackResponse = response.clone()

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
    } catch {
      // 忽略并使用 text() 回退
    }

    return await fallbackResponse.text()
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
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.link.title') || '链接记录'}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.link.description') || '输入网页链接，系统将自动爬取页面内容并保存'}
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              <div className="relative">
                <Input
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  className="pr-10"
                />
                {url && !loading && (
                  <button
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    <CircleX className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <DrawerFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 whitespace-nowrap">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Checkbox
                    id="auto-read-clipboard-mobile"
                    checked={autoReadClipboard}
                    onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                    disabled={loading}
                  />
                  <Label
                    htmlFor="auto-read-clipboard-mobile"
                    className="text-sm cursor-pointer"
                  >
                    {t('record.mark.link.autoReadClipboard') || '自动读取剪贴板链接'}
                  </Label>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Checkbox
                    id="auto-organize-link-mobile"
                    checked={organizeAfterSave}
                    onCheckedChange={(checked) => handleOrganizeChange(checked === true)}
                    disabled={loading}
                  />
                  <Label
                    htmlFor="auto-organize-link-mobile"
                    className="text-sm cursor-pointer"
                  >
                    保存后 AI 整理
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-zinc-500">
                  {loading ? '正在爬取页面内容...' : ''}
                </p>
                <Button
                  type="submit"
                  onClick={handleSuccess}
                  disabled={!url || loading}
                >
                  {loading ? '处理中...' : (t('record.mark.link.save') || '保存')}
                </Button>
              </div>
            </DrawerFooter>
            {errorMessage ? (
              <div className="px-4 pb-4 text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton icon={<Link />} tooltipText={t('record.mark.type.link') || '链接'} />
          </DialogTrigger>
          <DialogContent className="min-w-full md:min-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.link.title') || '链接记录'}</DialogTitle>
              <DialogDescription>
                {t('record.mark.link.description') || '输入网页链接，系统将自动爬取页面内容并保存'}
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Input
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                className="pr-10"
              />
              {url && !loading && (
                <button
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <CircleX className="w-4 h-4" />
                </button>
              )}
            </div>
            <DialogFooter className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 whitespace-nowrap">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Checkbox
                    id="auto-read-clipboard"
                    checked={autoReadClipboard}
                    onCheckedChange={(checked) => handleAutoReadChange(checked === true)}
                    disabled={loading}
                  />
                  <Label
                    htmlFor="auto-read-clipboard"
                    className="text-sm cursor-pointer"
                  >
                    {t('record.mark.link.autoReadClipboard') || '自动读取剪贴板链接'}
                  </Label>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Checkbox
                    id="auto-organize-link"
                    checked={organizeAfterSave}
                    onCheckedChange={(checked) => handleOrganizeChange(checked === true)}
                    disabled={loading}
                  />
                  <Label
                    htmlFor="auto-organize-link"
                    className="text-sm cursor-pointer"
                  >
                    保存后 AI 整理
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-zinc-500">
                  {loading ? '正在爬取页面内容...' : ''}
                </p>
                <Button
                  type="submit"
                  onClick={handleSuccess}
                  disabled={!url || loading}
                >
                  {loading ? '处理中...' : (t('record.mark.link.save') || '保存')}
                </Button>
              </div>
            </DialogFooter>
            {errorMessage ? (
              <div className="text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
