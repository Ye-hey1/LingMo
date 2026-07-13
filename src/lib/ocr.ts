import { createWorker } from 'tesseract.js';
import { readFile, writeFile, remove, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { Store } from '@tauri-apps/plugin-store';
import {
  getActiveOcrProvider,
  runInstalledOcrProvider,
} from './ocr-packages';

const OCR_TIMEOUT_MS = 30000
const OCR_MAX_EDGE = 2200
const OCR_TEMP_DIR = 'temp_ocr'
const DEFAULT_OCR_LANGUAGES = 'eng,chi_sim'

let cachedWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null
let cachedLangKey: string | null = null

function parseOcrLanguages(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function getConfiguredOcrLanguages() {
  const store = await Store.load('store.json')
  const lang = await store.get<string>('tesseractList')
  return typeof lang === 'string' && lang.trim() ? parseOcrLanguages(lang) : null
}

async function getOcrLanguages() {
  return (await getConfiguredOcrLanguages()) || parseOcrLanguages(DEFAULT_OCR_LANGUAGES)
}

function isChineseOcrEnvironment(values: unknown[]) {
  return values.some((value) => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized.startsWith('zh') || normalized.includes('中文')
  })
}

function preferChineseSystemOcrLanguages(languages: string[], chineseEnvironment: boolean) {
  if (!chineseEnvironment || languages.length !== 2) return languages
  const normalized = languages.map(normalizeTesseractLanguage)
  if (normalized[0] === 'eng' && normalized[1] === 'chi_sim') {
    return [languages[1], languages[0]]
  }
  return languages
}

async function getSystemOcrLanguages() {
  const store = await Store.load('store.json')
  const configuredValue = await store.get<string>('tesseractList')
  const configured = typeof configuredValue === 'string' && configuredValue.trim()
    ? parseOcrLanguages(configuredValue)
    : null
  if (!configured) {
    // An empty list lets Windows choose the native Chinese-first/user-profile default.
    return []
  }

  const localeValues = await Promise.all([
    store.get<string>('note_locale'),
    store.get<string>('locale'),
    store.get<string>('language'),
  ])
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : ''
  return preferChineseSystemOcrLanguages(
    configured,
    isChineseOcrEnvironment([...localeValues, browserLocale]),
  )
}

function normalizeTesseractLanguage(language: string) {
  const normalized = language.trim().replace('_', '-').toLowerCase()

  switch (normalized) {
    case 'en':
    case 'en-us':
      return 'eng'
    case 'zh':
    case 'zh-cn':
    case 'zh-hans':
      return 'chi_sim'
    case 'zh-tw':
    case 'zh-hant':
    case 'zh-hk':
      return 'chi_tra'
    case 'ja':
    case 'ja-jp':
      return 'jpn'
    case 'ko':
    case 'ko-kr':
      return 'kor'
    default:
      return language.trim().replace('-', '_')
  }
}

async function getTesseractLanguages() {
  return (await getOcrLanguages()).map(normalizeTesseractLanguage)
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

async function recognizeWithSystemOcr(path: string): Promise<string> {
  const activeProvider = await getActiveOcrProvider()

  if (!activeProvider) {
    throw new Error('当前平台暂无内置 OCR 引擎')
  }

  return withTimeout(runInstalledOcrProvider({
    providerId: activeProvider.id,
    imagePath: path,
    languages: await getSystemOcrLanguages(),
  }), OCR_TIMEOUT_MS)
}

async function recognizeWithTesseract(path: string): Promise<string> {
  try {
    const langArr = await getTesseractLanguages()
    const image = await readFile(path, { baseDir: BaseDirectory.AppData })
    const resizedBlob = await resizeImageForOcr(new Blob([image], { type: 'image/png' }))
    const worker = await getWorker(langArr)
    const recognizePromise = worker.recognize(resizedBlob).then((result) => result.data.text || '')

    return await withTimeout(recognizePromise, OCR_TIMEOUT_MS)
  } catch (error) {
    console.warn('Tesseract OCR recognition failed:', error)
    return ''
  }
}

async function ensureOcrTempDir() {
  if (!(await exists(OCR_TEMP_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(OCR_TEMP_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

export async function recognizeImageBlob(blob: Blob): Promise<string> {
  await ensureOcrTempDir()

  const filePath = `${OCR_TEMP_DIR}/${crypto.randomUUID()}.png`
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData })

  try {
    return await ocr(filePath)
  } finally {
    await remove(filePath, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
  }
}

export default async function ocr(path: string): Promise<string> {
  try {
    const systemResult = await recognizeWithSystemOcr(path)
    if (systemResult.trim()) {
      return systemResult
    }
    console.warn('System OCR returned empty text, falling back to Tesseract')
  } catch (error) {
    console.warn('System OCR recognition failed, falling back to Tesseract:', error)
  }

  return recognizeWithTesseract(path)
}
