import { createWorker } from 'tesseract.js';
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { Store } from '@tauri-apps/plugin-store';

const OCR_TIMEOUT_MS = 30000
const OCR_MAX_EDGE = 2200

let cachedWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null
let cachedLangKey: string | null = null

async function getOcrLanguages() {
  const store = await Store.load('store.json')
  const lang = await store.get<string>('tesseractList')
  return ((lang as string) || 'eng')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function getWorker(langArr: string[]) {
  const langKey = langArr.join('+')
  if (cachedWorkerPromise && cachedLangKey === langKey) {
    return cachedWorkerPromise
  }

  if (cachedWorkerPromise) {
    try {
      const previousWorker = await cachedWorkerPromise
      await previousWorker.terminate()
    } catch {
      // Ignore cleanup errors and recreate the worker below.
    }
  }

  cachedLangKey = langKey
  cachedWorkerPromise = createWorker(langArr)
  return cachedWorkerPromise
}

async function resizeImageForOcr(blob: Blob): Promise<Blob> {
  if (typeof window === 'undefined') {
    return blob
  }

  return await new Promise<Blob>((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new window.Image()

    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        const longestEdge = Math.max(width, height)

        if (!longestEdge || longestEdge <= OCR_MAX_EDGE) {
          resolve(blob)
          return
        }

        const scale = OCR_MAX_EDGE / longestEdge
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(blob)
          return
        }

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, targetWidth, targetHeight)
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

        canvas.toBlob((scaledBlob) => {
          resolve(scaledBlob || blob)
        }, 'image/png', 0.92)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(blob)
    }

    image.src = objectUrl
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error('OCR 识别超时'))
    }, timeoutMs)

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export default async function ocr(path: string): Promise<string> {
  try {
    const langArr = await getOcrLanguages()
    const image = await readFile(path, { baseDir: BaseDirectory.AppData })
    const resizedBlob = await resizeImageForOcr(new Blob([image], { type: 'image/png' }))
    const worker = await getWorker(langArr)
    const recognizePromise = worker.recognize(resizedBlob).then((result) => result.data.text || '')

    return await withTimeout(recognizePromise, OCR_TIMEOUT_MS)
  } catch (error) {
    return error instanceof Error ? error.message : 'OCR 识别失败'
  }
}
