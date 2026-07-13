import { convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, copyFile, exists, mkdir, readDir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { createUniqueArtifactPath, getArtifactFolderPath } from '@/lib/artifacts/destination'
import { getFilePathOptions } from '@/lib/workspace'
import type { CreativeCanvasAsset } from '@/types/creative-canvas'

export const CREATIVE_CANVAS_ASSET_ROOT = 'creative-canvas/assets'
export const CREATIVE_CANVAS_THUMBNAIL_ROOT = 'creative-canvas/thumbnails'

function assertSafeAssetFileName(fileName: string) {
  const normalized = fileName.trim().replace(/\\/g, '/')
  if (!normalized || normalized.includes('/') || normalized === '.' || normalized === '..' || normalized.includes('\0')) {
    throw new Error('INVALID_CREATIVE_CANVAS_ASSET_FILE_NAME')
  }
  return normalized
}

function assertCreativeCanvasStoredPath(filePath: string, allowedRoots: string[]) {
  const normalized = filePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (
    !allowedRoots.some(root => normalized.startsWith(`${root}/`)) ||
    normalized.includes('\0') ||
    segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('INVALID_CREATIVE_CANVAS_STORED_PATH')
  }
  return normalized
}

function assertCreativeCanvasAssetPath(filePath: string) {
  try {
    return assertCreativeCanvasStoredPath(filePath, [CREATIVE_CANVAS_ASSET_ROOT])
  } catch {
    throw new Error('INVALID_CREATIVE_CANVAS_ASSET_PATH')
  }
}

function assertCreativeCanvasThumbnailPath(filePath: string) {
  try {
    return assertCreativeCanvasStoredPath(filePath, [CREATIVE_CANVAS_THUMBNAIL_ROOT])
  } catch {
    throw new Error('INVALID_CREATIVE_CANVAS_THUMBNAIL_PATH')
  }
}

function safeWorkspaceFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[\0\r\n]+/g, '')
    .slice(0, 120) || 'creative-canvas.png'
}

export function getMimeExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('svg')) return 'svg'
  if (normalized.includes('mp4')) return 'mp4'
  if (normalized.includes('mpeg')) return 'mp3'
  if (normalized.includes('wav')) return 'wav'
  return 'png'
}

export function createAssetFileName(prefix: string, mimeType: string) {
  const safePrefix = prefix
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset'
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${getMimeExtension(mimeType)}`
}

export async function ensureCreativeCanvasAssetDir() {
  if (!(await exists(CREATIVE_CANVAS_ASSET_ROOT, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(CREATIVE_CANVAS_ASSET_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

export async function ensureCreativeCanvasThumbnailDir() {
  if (!(await exists(CREATIVE_CANVAS_THUMBNAIL_ROOT, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(CREATIVE_CANVAS_THUMBNAIL_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

export async function writeCreativeCanvasAssetFile(params: {
  bytes: Uint8Array
  fileName: string
}) {
  await ensureCreativeCanvasAssetDir()
  const filePath = `${CREATIVE_CANVAS_ASSET_ROOT}/${assertSafeAssetFileName(params.fileName)}`
  await writeFile(filePath, params.bytes, { baseDir: BaseDirectory.AppData })
  return filePath
}

export async function writeCreativeCanvasThumbnailFile(params: {
  bytes: Uint8Array
  fileName: string
}) {
  await ensureCreativeCanvasThumbnailDir()
  const filePath = `${CREATIVE_CANVAS_THUMBNAIL_ROOT}/${assertSafeAssetFileName(params.fileName)}`
  await writeFile(filePath, params.bytes, { baseDir: BaseDirectory.AppData })
  return filePath
}

export async function readCreativeCanvasAssetFile(filePath: string) {
  return await readFile(assertCreativeCanvasAssetPath(filePath), { baseDir: BaseDirectory.AppData })
}

export async function getCreativeCanvasAssetUrl(filePath: string) {
  return convertFileSrc(await join(await appDataDir(), assertCreativeCanvasAssetPath(filePath)))
}

export async function getCreativeCanvasThumbnailUrl(filePath: string) {
  return convertFileSrc(await join(await appDataDir(), assertCreativeCanvasThumbnailPath(filePath)))
}

export async function getCreativeCanvasAssetAbsolutePath(filePath: string) {
  return await join(await appDataDir(), assertCreativeCanvasAssetPath(filePath))
}

export function createThumbnailFileName(asset: Pick<CreativeCanvasAsset, 'id' | 'hash' | 'updatedAt'>, mimeType: string) {
  const version = asset.hash?.slice(0, 12) || String(asset.updatedAt || Date.now())
  return `${asset.id}-${version}.${getMimeExtension(mimeType)}`
}

async function listStoredFiles(root: string) {
  if (!(await exists(root, { baseDir: BaseDirectory.AppData }))) return []
  const output: Array<{ path: string; bytes?: number }> = []

  async function visit(relativePath: string) {
    const entries = await readDir(relativePath, { baseDir: BaseDirectory.AppData })
    for (const entry of entries) {
      const childPath = `${relativePath}/${entry.name}`.replace(/\\/g, '/')
      if (entry.isDirectory) {
        await visit(childPath)
        continue
      }
      if (!entry.isFile) continue
      let bytes: number | undefined
      try {
        const metadata = await stat(childPath, { baseDir: BaseDirectory.AppData })
        bytes = Number(metadata.size || 0)
      } catch {
        bytes = undefined
      }
      output.push({ path: childPath, bytes })
    }
  }

  await visit(root)
  return output
}

export async function listCreativeCanvasAssetFiles() {
  return await listStoredFiles(CREATIVE_CANVAS_ASSET_ROOT)
}

export async function listCreativeCanvasThumbnailFiles() {
  return await listStoredFiles(CREATIVE_CANVAS_THUMBNAIL_ROOT)
}

export async function removeCreativeCanvasStoredFile(filePath: string) {
  const safePath = assertCreativeCanvasStoredPath(filePath, [
    CREATIVE_CANVAS_ASSET_ROOT,
    CREATIVE_CANVAS_THUMBNAIL_ROOT,
  ])
  if (!(await exists(safePath, { baseDir: BaseDirectory.AppData }))) return false
  await remove(safePath, { baseDir: BaseDirectory.AppData })
  return true
}

export async function copyCreativeCanvasAssetToWorkspace(asset: CreativeCanvasAsset) {
  const folderPath = await getArtifactFolderPath('skill_output', 'outputs/creative-canvas')
  const uniquePath = await createUniqueArtifactPath({
    folderPath,
    fileName: safeWorkspaceFileName(asset.title || `creative-canvas-${asset.id}.${getMimeExtension(asset.mimeType)}`),
    knownExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
  })

  const sourcePath = assertCreativeCanvasAssetPath(asset.filePath)
  const target = await getFilePathOptions(uniquePath)
  await copyFile(sourcePath, target.path, {
    fromPathBaseDir: BaseDirectory.AppData,
    toPathBaseDir: target.baseDir,
  })

  return uniquePath
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string) {
  const base64 = value.includes(',') ? value.split(',').pop() || '' : value
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
