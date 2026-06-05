'use client'
import { clear, hasImage, hasText, readImageBase64, readText, writeImageBase64 } from "tauri-plugin-clipboard-api";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { BaseDirectory, copyFile, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import useTagStore from "@/stores/tag";
import useSettingStore from "@/stores/setting";
import useMarkStore from "@/stores/mark";
import { v4 as uuid } from 'uuid'
import { insertMark, Mark } from "@/db/marks";
import { uint8ArrayToBase64, uploadFile } from "@/lib/sync/github";
import { RepoNames } from "@/lib/sync/github.types";
import { CheckCircle, CircleX, Image as ImageIcon, FileText, Sparkles, Loader2, Copy, Download } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { convertBytesToSize } from "@/lib/utils";
import { recognizeStructuredImage } from "@/lib/mark-image-recognition";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";

export function Clipboard() {
  const t = useTranslations();
  const [type, setType] = useState<'image' | 'text'>('image')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [fileSize, setFileSize] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { githubUsername, primaryImageMethod, enableImageRecognition } = useSettingStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  async function readHandler() {
    const hasImageRes = await hasImage()
    const hasTextRes = await hasText()

    if (hasImageRes) {
      setType('image')
      await handleImage()
    } else if (hasTextRes) {
      setType('text')
      await handleText()
    }
  }

  async function ensureImageDir() {
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData })
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData })
    }
  }

  async function handleImage() {
    const base64Image = await readImageBase64()
    const uint8Array = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0))
    await writeFile('clipboard.png', uint8Array, { baseDir: BaseDirectory.AppData })
    setFileSize(convertBytesToSize(uint8Array.length))
    setImage(`data:image/png;base64, ${base64Image}`)
  }

  async function handleText() {
    const clipboardText = await readText()
    setText(clipboardText)
  }

  async function handleInset() {
    setIsProcessing(true)
    try {
      await clear()
      setImage('')
      const queueId = uuid()
      addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.saveImage'), type: 'image', startTime: Date.now() })

      await ensureImageDir()
      await copyFile('clipboard.png', `image/${queueId}.png`, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData })

      let content = ''
      let desc = ''

      if (!enableImageRecognition) {
        setQueue(queueId, { progress: t('record.mark.progress.save') })
      } else {
        setQueue(queueId, {
          progress: primaryImageMethod === 'vlm' ? t('record.mark.progress.aiAnalysis') : t('record.mark.progress.ocr'),
        })
        const file = await readFile(`image/${queueId}.png`, { baseDir: BaseDirectory.AppData })
        const recognition = await recognizeStructuredImage({
          path: `image/${queueId}.png`,
          base64: primaryImageMethod === 'vlm' ? `data:image/png;base64,${Buffer.from(file).toString('base64')}` : undefined,
          method: primaryImageMethod,
          sourceLabel: '剪贴板图片',
        })
        content = recognition.content
        desc = recognition.desc
      }

      const mark: Partial<Mark> = {
        tagId: currentTagId,
        type: 'image',
        content,
        url: `${queueId}.png`,
        desc,
      }

      const file = await readFile(`image/${queueId}.png`, { baseDir: BaseDirectory.AppData })
      if (githubUsername) {
        setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
        const res = await uploadFile({
          file: uint8ArrayToBase64(file),
          filename: `${queueId}.png`,
          repo: RepoNames.image,
        })
        if (res) {
          setQueue(queueId, { progress: t('record.mark.progress.jsdelivrCache') })
          await fetch(`https://purge.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`)
          mark.url = `https://cdn.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`
        }
      }

      removeQueue(queueId)
      await insertMark(mark)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleTextInset() {
    setIsProcessing(true)
    try {
      await clear()
      setText('')
      const mark: Partial<Mark> = {
        tagId: currentTagId,
        type: 'text',
        content: text,
        desc: text,
      }
      await insertMark(mark)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleCancle() {
    setImage('')
    setText('')
    setFileSize('')
    await clear()
  }

  function getCurrentImageBase64() {
    return image.split(',').pop()?.trim() || ''
  }

  async function handleCopyImage() {
    const base64 = getCurrentImageBase64()
    if (!base64) return

    await writeImageBase64(base64)
    toast({ title: t('record.mark.clipboard.copied') })
  }

  async function handleDownloadImage() {
    const base64 = getCurrentImageBase64()
    if (!base64) return

    const filePath = await save({
      defaultPath: 'clipboard.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    if (!filePath) return

    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    await writeFile(filePath, bytes)
    toast({ title: t('common.success') })
  }

  // 快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (type === 'image' && image) {
          handleInset()
        } else if (type === 'text' && text) {
          handleTextInset()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancle()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [type, image, text, handleInset, handleTextInset, handleCancle])

  useEffect(() => {
    listen('tauri://focus', readHandler)
  }, [])

  if (type === 'image' && image) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative group overflow-hidden rounded-xl border border-border/50 bg-card shadow-lg transition-all duration-300 hover:shadow-xl"
        >
          {/* 图片预览 */}
          <div className="relative aspect-video max-h-[220px] overflow-hidden">
            <Image 
              src={image} 
              width={0} 
              height={0} 
              alt="clipboard image" 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
            />
            
            {/* 渐变遮罩 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
            
            {/* 顶部信息栏 */}
            <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between transform transition-transform duration-300 group-hover:-translate-y-1">
              <div className="flex items-center gap-2">
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/25 shadow-lg"
                >
                  <ImageIcon className="size-3.5 text-white" />
                  <span className="text-xs font-medium text-white">
                    {t('record.mark.clipboard.detectedImage')}
                  </span>
                </motion.div>
                {enableImageRecognition && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.3 }}
                    className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/25 backdrop-blur-md border border-purple-400/40 shadow-lg"
                  >
                    <Sparkles className="size-3 text-purple-200" />
                    <span className="text-xs text-purple-100 font-medium">
                      {primaryImageMethod === 'vlm' ? 'AI Vision' : 'OCR'}
                    </span>
                  </motion.div>
                )}
              </div>
              
              {/* 快捷操作按钮 */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              >
                <button
                  onClick={handleCopyImage}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white transition-all duration-200"
                  title={t('record.mark.clipboard.copy')}
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  onClick={handleDownloadImage}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white transition-all duration-200"
                  title={t('record.mark.clipboard.download')}
                >
                  <Download className="size-3.5" />
                </button>
              </motion.div>
            </div>
            
            {/* 底部信息栏 */}
            <div className="absolute bottom-0 left-0 right-0 p-3 transform transition-transform duration-300 group-hover:translate-y-1">
              <div className="flex items-end justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-white/80 font-mono bg-black/30 px-2 py-0.5 rounded backdrop-blur-sm">
                    {fileSize}
                  </p>
                  {enableImageRecognition && (
                    <p className="text-xs text-white/60">
                      {t('record.mark.clipboard.recognitionHint')}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCancle}
                    disabled={isProcessing}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/25 text-white text-xs font-medium transition-all duration-200 disabled:opacity-50 shadow-lg"
                  >
                    <CircleX className="size-3.5" />
                    {t('common.cancel')}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleInset}
                    disabled={isProcessing}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-white/95 text-black text-xs font-bold transition-all duration-200 disabled:opacity-50 shadow-xl"
                  >
                    {isProcessing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="size-3.5" />
                    )}
                    {isProcessing ? t('record.mark.progress.processing') : t('common.confirm')}
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
          
          {/* 处理进度指示器 */}
          {isProcessing && (
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 2, ease: "linear" }}
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 origin-left"
            />
          )}
        </motion.div>
      </AnimatePresence>
    )
  }

  // 复制文本到剪贴板
  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t('record.mark.clipboard.copied') })
    } catch (error) {
      console.error('Failed to copy text:', error)
    }
  }

  if (type === 'text' && text) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-lg transition-all duration-300 hover:shadow-xl"
        >
          {/* 文本头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-gradient-to-r from-muted/50 to-muted/30">
            <div className="flex items-center gap-2">
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2 }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"
              >
                <FileText className="size-3.5" />
                <span className="text-xs font-medium">
                  {t('record.mark.clipboard.detectedText')}
                </span>
              </motion.div>
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                {t('record.mark.text.characterCount', { count: text.length })}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* 复制按钮 */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCopyText}
                className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-all duration-200"
                title={t('record.mark.clipboard.copy')}
              >
                <Copy className="size-3.5" />
              </motion.button>
              
              <div className="w-px h-4 bg-border/50" />
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCancle}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground text-xs font-medium transition-all duration-200 disabled:opacity-50"
              >
                <CircleX className="size-3.5" />
                {t('common.cancel')}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleTextInset}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                {isProcessing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="size-3.5" />
                )}
                {isProcessing ? t('record.mark.progress.processing') : t('common.confirm')}
              </motion.button>
            </div>
          </div>
          
          {/* 文本内容预览 */}
          <div className="p-4 max-h-[140px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words selection:bg-primary/20">
              {text.length > 300 ? `${text.slice(0, 300)}...` : text}
            </p>
          </div>
          
          {/* 底部提示 */}
          <div className="px-4 py-2 border-t border-border/30 bg-muted/20">
            <p className="text-[10px] text-muted-foreground/60 text-center">
              {t('record.mark.clipboard.pressEnterToConfirm')}
            </p>
          </div>
          
          {/* 处理进度指示器 */}
          {isProcessing && (
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 2, ease: "linear" }}
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 origin-left"
            />
          )}
        </motion.div>
      </AnimatePresence>
    )
  }

  return null
}
