import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { invokeAiJson, invokeAiMultipart, blobToBytes } from '@/lib/ai/tauri-client'
import { getAISettings } from '@/lib/ai/utils'
import type { AiConfig } from '@/app/core/setting/config'
import type {
  CreativeCanvasAsset,
  CreativeCanvasGenerationOptions,
  CreativeCanvasGenerationType,
} from '@/types/creative-canvas'
import {
  base64ToBytes,
  bytesToBase64,
  createAssetFileName,
  readCreativeCanvasAssetFile,
  writeCreativeCanvasAssetFile,
} from './assets'
import { buildImageRequest, invokeImageRequestWithCompatibility } from './generation-request'

export interface NormalizedGeneratedImage {
  bytes?: Uint8Array
  mimeType: string
  remoteUrl?: string
  revisedPrompt?: string
  raw?: unknown
}

export interface VisualGenerationResult {
  images: NormalizedGeneratedImage[]
  raw: Record<string, unknown>
  request: Record<string, unknown>
}

interface ImageGenerationResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  mime_type?: string
  content_type?: string
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeGenerationError(error: unknown) {
  return getErrorMessage(error)
    .replace(/Bearer\s+[\w._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/api[-_]?key[=:]\s*[\w._~+/=-]+/gi, 'api_key=[REDACTED]')
    .replace(/authorization["']?\s*[:=]\s*["']?Bearer\s+[^"',\s}]+/gi, 'authorization: Bearer [REDACTED]')
    .replace(/(["']?(?:x-api-key|api-key|authorization)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, '$1[REDACTED]')
}

function transportConfig(aiConfig: AiConfig) {
  return {
    baseUrl: aiConfig.baseURL || '',
    apiKey: aiConfig.apiKey,
    customHeaders: aiConfig.customHeaders,
  }
}

async function getImageAiConfig(modelSelection?: string) {
  const aiConfig = await getAISettings('imageGenerationModel', modelSelection)
  if (!aiConfig?.baseURL || !aiConfig.model) {
    throw new Error('请先在设置中选择生图模型。')
  }
  if (aiConfig.modelType && aiConfig.modelType !== 'image') {
    throw new Error('当前选择的不是生图模型，请在设置中选择 image 类型模型。')
  }
  return aiConfig
}

function extractResponseItems(response: Record<string, unknown>): ImageGenerationResponseItem[] {
  const data = response.data
  const images = response.images
  if (Array.isArray(data)) return data as ImageGenerationResponseItem[]
  if (Array.isArray(images)) return images as ImageGenerationResponseItem[]
  if (typeof response.b64_json === 'string' || typeof response.url === 'string') {
    return [response as ImageGenerationResponseItem]
  }
  return []
}

export function normalizeGenerationResult(response: Record<string, unknown>): NormalizedGeneratedImage[] {
  const images: NormalizedGeneratedImage[] = []

  for (const item of extractResponseItems(response)) {
    const mimeType = item.mime_type || item.content_type || 'image/png'
    if (item.b64_json) {
      images.push({
        bytes: base64ToBytes(item.b64_json),
        mimeType,
        revisedPrompt: item.revised_prompt,
        raw: item,
      })
      continue
    }

    if (item.url) {
      images.push({
        remoteUrl: item.url,
        mimeType,
        revisedPrompt: item.revised_prompt,
        raw: item,
      })
    }
  }

  return images
}

function sanitizeGeneratedResponseValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key === 'b64_json') {
      return `[REDACTED_BASE64_IMAGE length=${value.length}]`
    }
    if (value.length > 5000 && /^data:image\//i.test(value)) {
      return `[REDACTED_DATA_URL length=${value.length}]`
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeGeneratedResponseValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeGeneratedResponseValue(entryValue, entryKey),
      ]),
    )
  }

  return value
}

export function sanitizeGenerationResponseForStorage(response: Record<string, unknown>): Record<string, unknown> {
  return sanitizeGeneratedResponseValue(response) as Record<string, unknown>
}

export async function downloadRemoteAsset(url: string, fallbackMimeType = 'image/png') {
  const response = await tauriFetch(url, {
    method: 'GET',
    connectTimeout: 15000,
  })

  if (!response.ok) {
    throw new Error(`REMOTE_ASSET_DOWNLOAD_FAILED status=${response.status}`)
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || fallbackMimeType
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { bytes, mimeType }
}

export async function persistGeneratedImage(params: {
  projectId: string
  nodeId?: string
  jobId?: string
  prompt: string
  image: NormalizedGeneratedImage
  index?: number
}) {
  const downloaded = params.image.bytes
    ? { bytes: params.image.bytes, mimeType: params.image.mimeType }
    : params.image.remoteUrl
      ? await downloadRemoteAsset(params.image.remoteUrl, params.image.mimeType)
      : null

  if (!downloaded) {
    throw new Error('生成结果没有可保存的图片内容。')
  }

  const fileName = createAssetFileName(`image-${params.index ?? 1}`, downloaded.mimeType)
  const filePath = await writeCreativeCanvasAssetFile({
    bytes: downloaded.bytes,
    fileName,
  })

  return {
    kind: 'image' as const,
    projectId: params.projectId,
    filePath,
    title: fileName,
    mimeType: downloaded.mimeType,
    bytes: downloaded.bytes.byteLength,
    sourceNodeId: params.nodeId,
    sourceJobId: params.jobId,
    prompt: params.prompt,
    provenance: {
      source: 'generation' as const,
      sourceNodeIds: params.nodeId ? [params.nodeId] : undefined,
      jobId: params.jobId,
      createdAt: Date.now(),
    },
  } satisfies Omit<CreativeCanvasAsset, 'id' | 'createdAt' | 'updatedAt'>
}

export async function generateImage(params: {
  prompt: string
  options?: CreativeCanvasGenerationOptions
  signal?: AbortSignal
}): Promise<VisualGenerationResult> {
  try {
    const aiConfig = await getImageAiConfig(params.options?.modelSelection)
    const initialRequest = buildImageRequest(aiConfig, params.prompt, params.options)
    const { response, request } = await invokeImageRequestWithCompatibility(
      initialRequest,
      compatibleRequest => invokeAiJson<Record<string, unknown>>({
        config: transportConfig(aiConfig),
        path: '/images/generations',
        method: 'POST',
        body: compatibleRequest,
      }, params.signal),
    )

    return {
      images: normalizeGenerationResult(response),
      raw: response,
      request,
    }
  } catch (error) {
    throw new Error(sanitizeGenerationError(error))
  }
}

export async function editImage(params: {
  prompt: string
  referenceAssets: CreativeCanvasAsset[]
  options?: CreativeCanvasGenerationOptions
  signal?: AbortSignal
}): Promise<VisualGenerationResult> {
  try {
    const aiConfig = await getImageAiConfig(params.options?.modelSelection)
    const initialRequest = buildImageRequest(aiConfig, params.prompt, params.options)
    if (!params.referenceAssets.length) {
      throw new Error('图片编辑至少需要一张参考图。')
    }
    const files = await Promise.all(params.referenceAssets.map(async referenceAsset => ({
      bytes: Array.from(await readCreativeCanvasAssetFile(referenceAsset.filePath)),
      fileName: referenceAsset.title || 'reference.png',
      contentType: referenceAsset.mimeType || 'image/png',
    })))
    const { response, request } = await invokeImageRequestWithCompatibility(
      initialRequest,
      compatibleRequest => {
        const fields = Object.fromEntries(
          Object.entries(compatibleRequest)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)]),
        )
        return invokeAiMultipart<Record<string, unknown>>({
          config: transportConfig(aiConfig),
          path: '/images/edits',
          fields,
          fileFieldName: files.length === 1 ? 'image' : 'image[]',
          files,
        }, params.signal)
      },
    )

    return {
      images: normalizeGenerationResult(response),
      raw: response,
      request,
    }
  } catch (error) {
    throw new Error(sanitizeGenerationError(error))
  }
}

export async function assetToDataUrl(asset: CreativeCanvasAsset) {
  const bytes = await readCreativeCanvasAssetFile(asset.filePath)
  return `data:${asset.mimeType};base64,${bytesToBase64(bytes)}`
}

export async function blobToGeneratedImage(blob: Blob): Promise<NormalizedGeneratedImage> {
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || 'image/png',
  }
}

export async function blobToMultipartFile(blob: Blob, fileName: string) {
  return {
    bytes: await blobToBytes(blob),
    fileName,
    contentType: blob.type || 'image/png',
  }
}

export function getGenerationType(referenceAssets: CreativeCanvasAsset[] = []): CreativeCanvasGenerationType {
  return referenceAssets.length ? 'edit' : 'generation'
}
