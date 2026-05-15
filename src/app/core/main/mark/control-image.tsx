import { TooltipButton } from "@/components/tooltip-button"
import { insertMark, Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { BaseDirectory, copyFile, exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs"
import { ImagePlus } from "lucide-react"
import useSettingStore from "@/stores/setting"
import { v4 as uuid } from 'uuid'
import { open } from '@tauri-apps/plugin-dialog';
import { uploadImage } from "@/lib/imageHosting"
import { useRef, useEffect, useCallback } from 'react'
import { isMobileDevice } from '@/lib/check'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { recognizeStructuredImage } from "@/lib/mark-image-recognition"

export function ControlImage() {
  const t = useTranslations();
  const router = useRouter();
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { primaryImageMethod, enableImageRecognition } = useSettingStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isMobile = isMobileDevice()

  const handleSelectImages = useCallback(() => {
    selectImages()
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-image', handleSelectImages)
    return () => {
      emitter.off('toolbar-shortcut-image', handleSelectImages)
    }
  }, [handleSelectImages])

  async function ensureImageDir() {
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData })
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData })
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function buildRecognitionResult(params: {
    queueId: string
    path: string
    base64?: string
    sourceLabel: string
  }) {
    if (!enableImageRecognition) {
      setQueue(params.queueId, { progress: t('record.mark.progress.save') })
      return { content: '', desc: '' }
    }

    setQueue(params.queueId, {
      progress: primaryImageMethod === 'vlm' ? t('record.mark.progress.aiAnalysis') : t('record.mark.progress.ocr'),
    })

    return await recognizeStructuredImage({
      path: params.path,
      base64: params.base64,
      method: primaryImageMethod,
      sourceLabel: params.sourceLabel,
    })
  }

  async function saveMarkAndRefresh(mark: Partial<Mark>, queueId: string) {
    removeQueue(queueId)
    await insertMark(mark)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function selectImages() {
    try {
      if (isMobile) {
        if (fileInputRef.current) {
          fileInputRef.current.click()
        } else {
          console.error('File input ref not available')
        }
        return
      }

      const filePaths = await open({
        multiple: true,
        directory: false,
        filters: [{
          name: 'Image',
          extensions: ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
        }],
      });
      if (!filePaths) return

      handleRecordComplete(router)

      for (const path of filePaths) {
        await upload(path)
      }
    } catch (error) {
      console.error('Error in selectImages:', error)
    }
  }

  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = event.target.files
      if (!files || files.length === 0) {
        return
      }

      handleRecordComplete(router)

      for (let i = 0; i < files.length; i++) {
        await uploadMobileFile(files[i])
      }

      event.target.value = ''
    } catch (error) {
      console.error('Error in handleFileInputChange:', error)
    }
  }

  async function uploadMobileFile(file: File) {
    const queueId = uuid()

    try {
      addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.cacheImage'), type: 'image', startTime: Date.now() })

      const ext = file.name.substring(file.name.lastIndexOf('.') + 1) || 'jpg'
      const filename = `${queueId}.${ext}`
      await ensureImageDir()

      const arrayBuffer = await file.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      await writeFile(`image/${filename}`, uint8Array, { baseDir: BaseDirectory.AppData })

      const recognition = await buildRecognitionResult({
        queueId,
        path: `image/${filename}`,
        base64: primaryImageMethod === 'vlm' ? await fileToBase64(file) : undefined,
        sourceLabel: '图片',
      })

      const mark: Partial<Mark> = {
        tagId: currentTagId,
        type: 'image',
        content: recognition.content,
        url: filename,
        desc: recognition.desc,
      }

      try {
        const url = await uploadImage(file)
        if (url) {
          setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
          mark.url = url
        }
      } catch (uploadError) {
        console.error('Failed to upload to image hosting:', uploadError)
      }

      await saveMarkAndRefresh(mark, queueId)
    } catch (error) {
      console.error('Error in uploadMobileFile:', error)
      removeQueue(queueId)
    }
  }

  async function upload(path: string) {
    const queueId = uuid()
    addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.cacheImage'), type: 'image', startTime: Date.now() })

    const ext = path.substring(path.lastIndexOf('.') + 1)
    const filename = `${queueId}.${ext}`
    await ensureImageDir()
    await copyFile(path, `image/${filename}`, { toPathBaseDir: BaseDirectory.AppData })

    const fileData = await readFile(path)
    const recognition = await buildRecognitionResult({
      queueId,
      path: `image/${filename}`,
      base64: primaryImageMethod === 'vlm' ? `data:image/${ext};base64,${Buffer.from(fileData).toString('base64')}` : undefined,
      sourceLabel: '图片',
    })

    const mark: Partial<Mark> = {
      tagId: currentTagId,
      type: 'image',
      content: recognition.content,
      url: filename,
      desc: recognition.desc,
    }

    const file = new File([new Uint8Array(fileData)], filename, { type: `image/${ext}` })
    const url = await uploadImage(file)
    if (url) {
      setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
      mark.url = url
    }

    await saveMarkAndRefresh(mark, queueId)
  }

  return (
    <>
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
      <TooltipButton icon={<ImagePlus />} tooltipText={t('record.mark.type.image')} onClick={selectImages} />
    </>
  )
}
