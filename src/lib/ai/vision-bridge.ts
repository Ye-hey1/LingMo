import type OpenAI from 'openai'
import type { AiConfig } from '@/app/core/setting/config'
import { createOpenAIClient, getAISettings, handleAIError, convertImageToBase64 } from './utils'

const DESCRIPTION_CACHE_TTL = 300 * 1000
const MAX_IMAGE_EDGE = 1200
const IMAGE_JPEG_QUALITY = 0.82
const VISION_BRIDGE_PROMPT = [
  '请详细描述这张图片的内容，如果包含文字、界面、表格、代码或图表，请尽量提取关键信息。',
  '只输出图片描述，不要提及识别过程，不要向用户寒暄。',
].join('\n')

const IMAGE_CAPABLE_MODEL_PATTERNS = [
  /vlm/i,
  /\bvision\b/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /glm-4.*v/i,
  /qwen.*vl/i,
  /qvq/i,
  /minicpm.*v/i,
  /internvl/i,
  /llava/i,
  /pixtral/i,
  /gemini-1\.5/i,
  /gemini-2\./i,
  /claude-3/i,
  /claude-3\.5/i,
  /claude-3\.7/i,
  /claude-sonnet-4/i,
  /gemma-3/i,
]

const descriptionCache = new Map<string, { ts: number; desc: string }>()

function getCapabilityText(config?: AiConfig) {
  return [
    config?.templateKey,
    config?.key,
    config?.title,
    config?.baseURL,
    config?.model,
  ].filter(Boolean).join(' ')
}

export function supportsImageInput(config?: AiConfig): boolean {
  if (config?.supportsImageInput !== undefined) {
    return config.supportsImageInput
  }

  return IMAGE_CAPABLE_MODEL_PATTERNS.some(pattern => pattern.test(getCapabilityText(config)))
}

export async function hasVisionBridgeModel(): Promise<boolean> {
  const bridgeConfig = await getAISettings('imageMethodModel')
  return Boolean(bridgeConfig?.baseURL && bridgeConfig?.model && supportsImageInput(bridgeConfig))
}

function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) {
    return {
      mimeType: 'image/png',
      base64: dataUrl.includes(',') ? dataUrl.split(',').pop() || dataUrl : dataUrl,
    }
  }

  return {
    mimeType: match[1] || 'image/png',
    base64: match[2] || '',
  }
}

async function hashText(value: string) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const data = new TextEncoder().encode(value)
      const digest = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(digest))
        .slice(0, 8)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {}

  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for compression.'))
    img.src = src
  })
}

async function compressImageDataUrl(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') {
    return dataUrl
  }

  try {
    const { mimeType } = splitDataUrl(dataUrl)
    if (mimeType === 'image/gif' || mimeType === 'image/svg+xml') {
      return dataUrl
    }

    const img = await loadImage(dataUrl)
    const sourceWidth = img.naturalWidth || img.width
    const sourceHeight = img.naturalHeight || img.height

    if (!sourceWidth || !sourceHeight) {
      return dataUrl
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      return dataUrl
    }

    context.drawImage(img, 0, 0, width, height)
    const outputMimeType = mimeType === 'image/png' && dataUrl.length < 700_000 ? 'image/png' : 'image/jpeg'
    const compressed = canvas.toDataURL(outputMimeType, IMAGE_JPEG_QUALITY)

    return compressed.length < dataUrl.length ? compressed : dataUrl
  } catch (error) {
    console.error('[VisionBridge] Failed to compress image:', error)
    return dataUrl
  }
}

function extractTextContent(content: OpenAI.Chat.ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      const typedPart = part as { type?: string; text?: string }
      return typedPart.type === 'text' ? typedPart.text || '' : ''
    })
    .filter(Boolean)
    .join('\n')
}

async function describeImageDataUrl(dataUrl: string, index: number, abortSignal?: AbortSignal): Promise<string> {
  const optimizedDataUrl = await compressImageDataUrl(dataUrl)
  const hash = await hashText(optimizedDataUrl)
  const now = Date.now()
  const cached = descriptionCache.get(hash)

  if (cached && now - cached.ts < DESCRIPTION_CACHE_TTL) {
    return cached.desc
  }

  const aiConfig = await getAISettings('imageMethodModel')
  if (!aiConfig?.baseURL || !aiConfig.model || !supportsImageInput(aiConfig)) {
    return `图片 ${index}：未配置可用的视觉桥接模型，无法生成描述。`
  }

  const openai = await createOpenAIClient(aiConfig)
  const completion = await openai.chat.completions.create({
    model: aiConfig.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: VISION_BRIDGE_PROMPT,
          },
          {
            type: 'image_url',
            image_url: {
              url: optimizedDataUrl,
            },
          },
        ],
      },
    ],
    temperature: aiConfig.temperature ?? 0.2,
    top_p: aiConfig.topP ?? 1,
    max_tokens: 1024,
  }, {
    signal: abortSignal,
  })

  const desc = completion.choices[0]?.message?.content?.trim()
  const finalDesc = desc || `图片 ${index}：视觉模型未返回有效描述。`
  descriptionCache.set(hash, { ts: now, desc: finalDesc })
  return finalDesc
}

function buildBridgeText(originalText: string, descriptions: string[]) {
  const visionBlock = [
    '## 图片描述',
    ...descriptions.map((desc, index) => `图片 ${index + 1}：${desc}`),
  ].join('\n')

  return [visionBlock, originalText].filter(Boolean).join('\n\n')
}

function findLastUserMessageIndex(messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return i
    }
  }
  return -1
}

export async function buildImageContentParts(imageUrls: string[]) {
  const content: Array<{ type: 'image_url'; image_url: { url: string } }> = []

  for (const imageUrl of imageUrls) {
    try {
      const base64Image = await convertImageToBase64(imageUrl)
      if (base64Image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: await compressImageDataUrl(base64Image),
          },
        })
      }
    } catch (error) {
      console.error('[VisionBridge] Failed to convert image to base64:', error)
    }
  }

  return content
}

export async function appendImagesToLastUserMessage(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  imageUrls?: string[]
) {
  if (!imageUrls?.length) {
    return messages
  }

  const lastUserIndex = findLastUserMessageIndex(messages)
  if (lastUserIndex === -1) {
    return messages
  }

  const imageParts = await buildImageContentParts(imageUrls)
  if (imageParts.length === 0) {
    return messages
  }

  const lastMessage = messages[lastUserIndex]
  const text = extractTextContent(lastMessage.content)
  const content: any[] = [
    ...imageParts,
    {
      type: 'text',
      text,
    },
  ]

  const nextMessages = [...messages]
  nextMessages[lastUserIndex] = {
    ...lastMessage,
    role: 'user',
    content,
  } as OpenAI.Chat.ChatCompletionMessageParam

  return nextMessages
}

export async function applyVisionBridgeToLastUserMessage(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  imageUrls?: string[],
  abortSignal?: AbortSignal
) {
  if (!imageUrls?.length) {
    return messages
  }

  const lastUserIndex = findLastUserMessageIndex(messages)
  if (lastUserIndex === -1) {
    return messages
  }

  const descriptions: string[] = []
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const dataUrl = await convertImageToBase64(imageUrls[i])
      if (!dataUrl) {
        descriptions.push(`图片 ${i + 1}：无法读取图片内容。`)
        continue
      }
      descriptions.push(await describeImageDataUrl(dataUrl, i + 1, abortSignal))
    } catch (error) {
      if (abortSignal?.aborted) {
        throw error
      }
      handleAIError(error, false)
      descriptions.push(`图片 ${i + 1}：视觉桥接解析失败。`)
    }
  }

  const lastMessage = messages[lastUserIndex]
  const text = extractTextContent(lastMessage.content)
  const nextMessages = [...messages]
  nextMessages[lastUserIndex] = {
    ...lastMessage,
    role: 'user',
    content: buildBridgeText(text, descriptions),
  } as OpenAI.Chat.ChatCompletionMessageParam

  return nextMessages
}

export async function prepareMessagesWithImages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  aiConfig?: AiConfig,
  imageUrls?: string[],
  abortSignal?: AbortSignal
) {
  if (!imageUrls?.length) {
    return messages
  }

  if (supportsImageInput(aiConfig)) {
    return appendImagesToLastUserMessage(messages, imageUrls)
  }

  return applyVisionBridgeToLastUserMessage(messages, imageUrls, abortSignal)
}
