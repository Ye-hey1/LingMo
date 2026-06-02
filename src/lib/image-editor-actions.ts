import { BaseDirectory, writeFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { readWorkspaceBinaryFile } from '@/lib/file-binary'

export type ImageExportFormat = 'png' | 'jpeg' | 'webp'

export interface WorkspaceImageAttachment {
  id: string
  url: string
  name?: string
  source?: 'paste' | 'file' | 'record'
}

function getMimeType(format: ImageExportFormat) {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

function getFileNameParts(filePath: string) {
  const fullName = filePath.split('/').pop() || filePath
  const dotIndex = fullName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return { baseName: fullName, extension: '' }
  }
  return {
    baseName: fullName.slice(0, dotIndex),
    extension: fullName.slice(dotIndex + 1).toLowerCase(),
  }
}

export function isWorkspaceImagePath(path: string) {
  return /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(path)
}

export function getImageAltText(filePath: string) {
  return getFileNameParts(filePath).baseName || 'image'
}

export async function getWorkspaceImageUrl(filePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(filePath)
  if (workspace.isCustom) {
    return convertFileSrc(options.path)
  }

  return convertFileSrc(await join(await appDataDir(), options.path))
}

export async function createWorkspaceImageAttachment(filePath: string): Promise<WorkspaceImageAttachment> {
  return {
    id: `workspace-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url: await getWorkspaceImageUrl(filePath),
    name: filePath.split('/').pop() || filePath,
    source: 'file',
  }
}

export async function loadImageElement(src: string) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
  })

  return img
}

export async function imageSourceToCanvas(src: string) {
  const img = await loadImageElement(src)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文')
  }

  ctx.drawImage(img, 0, 0)
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: ImageExportFormat, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('图片导出失败'))
        }
      },
      getMimeType(format),
      format === 'png' ? undefined : quality,
    )
  })
}

export async function blobToUint8Array(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

export async function writeWorkspaceBinaryFile(filePath: string, data: Uint8Array) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(filePath)

  if (workspace.isCustom) {
    await writeFile(pathOptions.path, data)
  } else {
    await writeFile(pathOptions.path, data, { baseDir: pathOptions.baseDir || BaseDirectory.AppData })
  }
}

export async function writeBlobToWorkspaceFile(filePath: string, blob: Blob) {
  await writeWorkspaceBinaryFile(filePath, await blobToUint8Array(blob))
}

export async function exportImageVariant(params: {
  src: string
  originalPath: string
  format: ImageExportFormat
  quality: number
  suffix?: string
}) {
  const { baseName } = getFileNameParts(params.originalPath)
  const folderPath = params.originalPath.includes('/')
    ? params.originalPath.split('/').slice(0, -1).join('/')
    : ''
  const suffix = params.suffix || 'export'
  const fileName = `${baseName}_${suffix}.${params.format === 'jpeg' ? 'jpg' : params.format}`
  const targetPath = folderPath ? `${folderPath}/${fileName}` : fileName
  const canvas = await imageSourceToCanvas(params.src)
  const blob = await canvasToBlob(canvas, params.format, params.quality)
  await writeBlobToWorkspaceFile(targetPath, blob)
  return { targetPath, size: blob.size }
}

export async function readWorkspaceImageAsBlob(filePath: string) {
  const data = await readWorkspaceBinaryFile(filePath)
  return new Blob([data as unknown as BlobPart])
}
