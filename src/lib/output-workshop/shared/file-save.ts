/**
 * 文件保存的统一实现
 *
 * 合并自 `export.ts`（isTauri 判定 + 友好 filter）与 `smart-card-export.ts`
 * （try-import Tauri + 浏览器兜底）两套近乎重复的逻辑。此处采用前者更严谨的策略：
 * 先按 isTauri() 分流，Tauri 走原生 dialog+fs，Web 走 File System Access API，最终兜底
 * 浏览器 <a> 下载。
 */

import type { ExportResult } from "./types"
import { isTauri } from "./runtime"

/**
 * 下载二进制文件 Blob（浏览器 <a download> 兜底方式）
 */
export function downloadBlob(blob: Blob, filename: string): ExportResult {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { fileName: filename }
}

/** 取文件扩展名（小写，不含点），无扩展名返回空串 */
export function getExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  return match?.[1]?.toLowerCase() || ""
}

/** 按扩展名给出 filter 友好名称，供原生/浏览器 save 对话框展示 */
export function getMimeFilter(extension: string): string {
  switch (extension) {
    case "png":
      return "PNG Image"
    case "zip":
      return "ZIP Archive"
    case "html":
      return "HTML Document"
    case "md":
      return "Markdown"
    case "pptx":
      return "PowerPoint"
    default:
      return "File"
  }
}

/** Blob 转 Uint8Array，供 Tauri writeFile 使用 */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * 把 Blob 另存为文件。
 * Tauri 端走原生保存对话框；Web 端兜底走浏览器下载。
 * 用户取消时返回 `{ canceled: true }`，不抛错。
 */
export async function saveBlobAs(blob: Blob, filename: string): Promise<ExportResult> {
  if (isTauri()) {
    const extension = getExtension(filename)
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeFile } = await import("@tauri-apps/plugin-fs")
    const filePath = await save({
      defaultPath: filename,
      filters: extension ? [{ name: getMimeFilter(extension), extensions: [extension] }] : undefined,
    })
    if (!filePath) return { fileName: filename, canceled: true }
    await writeFile(filePath, await blobToUint8Array(blob))
    return { fileName: filePath.split(/[\\/]/).pop() || filename, filePath }
  }

  return downloadBlob(blob, filename)
}
