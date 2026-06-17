import type { ModelType } from '@/app/core/setting/config'

export function inferModelTypeFromId(modelId: string): ModelType {
  const value = modelId.toLowerCase()
  if (value.includes('embedding')) return 'embedding'
  if (value.includes('rerank')) return 'rerank'
  if (
    value.includes('sensevoice') ||
    value.includes('asr') ||
    value.includes('stt') ||
    value.includes('transcribe') ||
    value.includes('whisper')
  ) return 'stt'
  if (value.includes('tts') || value.includes('cosyvoice') || value.includes('speech')) return 'tts'
  if (value.includes('image') || value.includes('vision')) return 'image'
  if (value.includes('video')) return 'video'
  return 'chat'
}
