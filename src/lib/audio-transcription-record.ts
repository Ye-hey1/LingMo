import {
  getMarkById,
  insertMark,
  updateMarkContentIfUnchanged,
  type Mark,
} from '@/db/marks'
import {
  createAudioRecordingContent,
  hasAudioRecordingMinutes,
  mergeAudioRecordingMeta,
  mergeAudioRecordingSummary,
  summarizeAudioRecording,
} from '@/lib/audio-recording-record'

export interface CreateAudioTranscriptionRecordInput {
  tagId: number
  transcript: string
  audioPath: string
  sourceFileName?: string
  title?: string
  organize?: boolean
  onProgress?: (message: string) => void
  onRawSaved?: (mark: Mark) => void | Promise<void>
}

export interface CreateAudioTranscriptionRecordResult {
  markId: number
  organized: boolean
  conflict: boolean
  organizationError?: string
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function getFileName(value?: string) {
  const normalized = cleanText(value).replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) || ''
}

function formatRecordingTitle(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `录音 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function createAudioTranscriptionRecord(
  input: CreateAudioTranscriptionRecordInput,
): Promise<CreateAudioTranscriptionRecordResult> {
  const transcript = input.transcript.trim()
  if (!transcript) {
    throw new Error('录音转写内容为空')
  }
  if (!input.tagId) {
    throw new Error('缺少录音记录所属标签')
  }

  const sourceFileName = getFileName(input.sourceFileName)
  const initialTitle = cleanText(input.title) || sourceFileName || formatRecordingTitle()
  const shouldOrganize = input.organize !== false
  const organizationStartedAt = shouldOrganize ? Date.now() : undefined
  const initialContent = createAudioRecordingContent(transcript, {
    sourceFileName,
    title: initialTitle,
    status: shouldOrganize ? 'organizing' : 'raw',
    organizationStartedAt,
  })

  input.onProgress?.('正在保存原始转写...')
  const insertResult = await insertMark({
    tagId: input.tagId,
    type: 'recording',
    desc: initialTitle,
    content: initialContent,
    url: input.audioPath,
  })
  const markId = Number(insertResult.lastInsertId)
  if (!Number.isFinite(markId) || markId <= 0) {
    throw new Error('录音记录保存失败')
  }

  const rawMark = await getMarkById(markId)
  if (!rawMark) {
    throw new Error('已保存录音，但无法读取新记录')
  }
  await input.onRawSaved?.(rawMark)

  if (!shouldOrganize) {
    return { markId, organized: false, conflict: false }
  }

  input.onProgress?.('正在识别需求、决策与行动项...')
  try {
    const minutes = await summarizeAudioRecording({
      title: initialTitle,
      content: transcript,
      url: input.audioPath,
    }, {
      onProgress: progress => input.onProgress?.(progress.message),
    })
    if (!hasAudioRecordingMinutes(minutes)) {
      throw new Error('AI 未返回可用的会话纪要')
    }

    const nextContent = mergeAudioRecordingSummary(initialContent, minutes)
    const nextTitle = cleanText(minutes.title) || initialTitle
    const applied = await updateMarkContentIfUnchanged({
      id: markId,
      expectedDesc: initialTitle,
      expectedContent: initialContent,
      nextDesc: nextTitle,
      nextContent,
    })
    return {
      markId,
      organized: applied,
      conflict: !applied,
    }
  } catch (error) {
    const organizationError = getErrorMessage(error)
    const failedContent = mergeAudioRecordingMeta(initialContent, {
      status: 'failed',
      error: organizationError.slice(0, 500),
    })
    const applied = await updateMarkContentIfUnchanged({
      id: markId,
      expectedDesc: initialTitle,
      expectedContent: initialContent,
      nextDesc: initialTitle,
      nextContent: failedContent,
    })
    return {
      markId,
      organized: false,
      conflict: !applied,
      organizationError,
    }
  }
}
