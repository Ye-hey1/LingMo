'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  FileText,
  History,
  Image as ImageIcon,
  Languages,
  Loader2,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Wand2,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BaseDirectory, exists, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import { hasImage, hasText, readImageBase64, readText, writeImageBase64 } from 'tauri-plugin-clipboard-api'
import { v4 as uuid } from 'uuid'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { insertMark, Mark } from '@/db/marks'
import { fetchAi } from '@/lib/ai/chat'
import { fetchAiTranslate } from '@/lib/ai/translate'
import { uploadImage } from '@/lib/imageHosting'
import { recognizeStructuredImage } from '@/lib/mark-image-recognition'
import { handleRecordComplete } from '@/lib/record-navigation'
import { cn, convertBytesToSize } from '@/lib/utils'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

import { ClipboardDropzone } from './clipboard-dropzone'
import { RecognitionHistory } from './recognition-history'
import { RecognitionSettings } from './recognition-settings'

interface EnhancedClipboardProps {
  className?: string
}

type SourceKind = 'empty' | 'text' | 'image'
type SourceOrigin = 'empty' | 'clipboard-text' | 'clipboard-image' | 'drop-text' | 'drop-image' | 'manual'
type ProcessingAction = 'clipboard' | 'recognize' | 'organize' | 'tag' | 'title' | 'translate' | 'import' | 'copy' | null
type WorkbenchStatus =
  | 'idle'
  | 'ready'
  | 'reading'
  | 'recognizing'
  | 'recognized'
  | 'organizing'
  | 'organized'
  | 'tagging'
  | 'tagged'
  | 'titling'
  | 'titled'
  | 'translating'
  | 'translated'
  | 'importing'
  | 'imported'
  | 'copied'
  | 'cleared'
  | 'noClipboard'
  | 'readFail'
  | 'processFail'
  | 'importFail'
  | 'historyRestored'

type WorkflowStepId = 'read' | 'recognize' | 'organize' | 'tag' | 'title' | 'import'
type WorkflowStepStatus = 'idle' | 'running' | 'done' | 'failed'

interface DraftImage {
  dataUrl: string
  base64: string
  bytes: Uint8Array
  fileName: string
  mimeType: string
  extension: string
  sizeLabel: string
}

interface RecognitionHistoryItem {
  id: string
  timestamp: number
  type: 'image' | 'text'
  sourceOrigin?: SourceOrigin
  sourceLabel?: string
  desc: string
  content: string
  thumbnail?: string
  favorite?: boolean
  tags?: string[]
}

interface WorkflowStepState {
  status: WorkflowStepStatus
  error?: string
  updatedAt?: number
}

type WorkflowStepStateMap = Record<WorkflowStepId, WorkflowStepState>

interface WorkbenchError {
  step: WorkflowStepId | 'translate' | 'copy'
  message: string
}

interface WorkbenchSnapshot {
  sourceKind: SourceKind
  sourceOrigin: SourceOrigin
  sourceText: string
  draftTitle: string
  draftContent: string
  draftImage: DraftImage | null
  draftTags: string[]
  status: WorkbenchStatus
  workflowSteps: WorkflowStepStateMap
  lastError: WorkbenchError | null
}

interface UndoSnapshot {
  id: string
  step: WorkflowStepId | 'translate' | 'clear' | 'manual'
  label: string
  timestamp: number
  snapshot: WorkbenchSnapshot
}

const HISTORY_KEY = 'recognition-history'
const SETTINGS_KEY = 'recognition-settings'
const TEMP_RECOGNITION_DIR = 'temp_recognition'
const IMAGE_DIR = 'image'
const DEFAULT_HISTORY_LIMIT = 50
const MAX_UNDO_STACK = 20
const MAX_DRAFT_TAGS = 6

const WORKFLOW_STEPS: WorkflowStepId[] = ['read', 'recognize', 'organize', 'tag', 'title', 'import']

const LANGUAGE_OPTIONS = [
  'English',
  '中文',
  '日本語',
  '한국어',
  'Français',
  'Deutsch',
  'Español',
  'Русский',
]

function compactText(value: string) {
  return value.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trim()}...`
}

function cleanAiSingleLine(value: string, maxLength = 36) {
  const line = value
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((item) => item.replace(/^#+\s*/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim())
    .find(Boolean)

  return truncate(line || '', maxLength)
}

function inferTitle(value: string, fallback: string) {
  const lines = value
    .split('\n')
    .map((line) => compactText(line).replace(/^#+\s*/, '').replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)

  return truncate(lines[0] || fallback, 36)
}

function normalizeDraftTag(value: string) {
  return value
    .replace(/^#+/, '')
    .replace(/[，,;；、|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18)
}

function parseDraftTags(value: string) {
  const parsedFromJson = (() => {
    try {
      const raw = value.replace(/```json|```/gi, '').trim()
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed?.tags)) return parsed.tags
    } catch {
      return null
    }
    return null
  })()

  const source = parsedFromJson ?? value
    .replace(/```[\s\S]*?```/g, '')
    .split(/[\n,，;；、|]/)

  const tags = (Array.isArray(source) ? source : [source])
    .flatMap((item) => String(item).split(/[\n,，;；、|]/))
    .map(normalizeDraftTag)
    .filter(Boolean)

  return Array.from(new Set(tags)).slice(0, MAX_DRAFT_TAGS)
}

function appendTagsToContent(content: string, tags: string[], label: string) {
  const normalizedTags = Array.from(new Set(tags.map(normalizeDraftTag).filter(Boolean)))
  if (normalizedTags.length === 0) return content

  const hashtagLine = normalizedTags.map((item) => `#${item.replace(/\s/g, '_')}`).join(' ')
  if (content.includes(hashtagLine)) return content

  return `${content.trim()}\n\n---\n${label}${hashtagLine}`
}

function dataUrlParts(dataUrl: string) {
  const [prefix, base64 = ''] = dataUrl.split(',')
  const mimeType = prefix.match(/^data:(.*?);base64$/)?.[1] || 'image/png'
  return {
    mimeType,
    base64: base64.trim(),
  }
}

function extensionFromMime(mimeType: string) {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('jpeg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('svg')) return 'svg'
  if (normalized.includes('bmp')) return 'bmp'
  return 'png'
}

function base64ToBytes(base64: string) {
  const normalized = base64.replace(/\s/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `data:${mimeType};base64,${btoa(binary)}`
}

async function fileToDraftImage(file: File): Promise<DraftImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = file.type || 'image/png'
  const extension = extensionFromMime(mimeType)
  const dataUrl = bytesToDataUrl(bytes, mimeType)
  const { base64 } = dataUrlParts(dataUrl)

  return {
    dataUrl,
    base64,
    bytes,
    fileName: file.name || `image.${extension}`,
    mimeType,
    extension,
    sizeLabel: convertBytesToSize(bytes.length),
  }
}

function clipboardBase64ToDraftImage(base64: string): DraftImage {
  const bytes = base64ToBytes(base64)
  return {
    dataUrl: `data:image/png;base64,${base64}`,
    base64,
    bytes,
    fileName: 'clipboard.png',
    mimeType: 'image/png',
    extension: 'png',
    sizeLabel: convertBytesToSize(bytes.length),
  }
}

function readRecognitionPreferences() {
  if (typeof window === 'undefined') {
    return {
      autoRecognize: true,
      autoOrganizeAfterRecognize: false,
      autoTagAfterOrganize: false,
      autoTitleBeforeImport: false,
      saveHistory: true,
      maxHistoryItems: DEFAULT_HISTORY_LIMIT,
    }
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return {
        autoRecognize: true,
        autoOrganizeAfterRecognize: false,
        autoTagAfterOrganize: false,
        autoTitleBeforeImport: false,
        saveHistory: true,
        maxHistoryItems: DEFAULT_HISTORY_LIMIT,
      }
    }
    const parsed = JSON.parse(raw)
    return {
      autoRecognize: parsed.autoRecognize !== false,
      autoOrganizeAfterRecognize: parsed.autoOrganizeAfterRecognize === true,
      autoTagAfterOrganize: parsed.autoTagAfterOrganize === true,
      autoTitleBeforeImport: parsed.autoTitleBeforeImport === true,
      saveHistory: parsed.saveHistory !== false,
      maxHistoryItems: Number(parsed.maxHistoryItems) > 0 ? Number(parsed.maxHistoryItems) : DEFAULT_HISTORY_LIMIT,
    }
  } catch {
    return {
      autoRecognize: true,
      autoOrganizeAfterRecognize: false,
      autoTagAfterOrganize: false,
      autoTitleBeforeImport: false,
      saveHistory: true,
      maxHistoryItems: DEFAULT_HISTORY_LIMIT,
    }
  }
}

function createWorkflowStepStates(): WorkflowStepStateMap {
  return WORKFLOW_STEPS.reduce((acc, step) => {
    acc[step] = { status: 'idle' }
    return acc
  }, {} as WorkflowStepStateMap)
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function ensureAppDataDir(path: string) {
  const dirExists = await exists(path, { baseDir: BaseDirectory.AppData })
  if (!dirExists) {
    await mkdir(path, { baseDir: BaseDirectory.AppData })
  }
}

async function writeTempImageFile(image: DraftImage) {
  await ensureAppDataDir(TEMP_RECOGNITION_DIR)
  const tempPath = `${TEMP_RECOGNITION_DIR}/${uuid()}.${image.extension}`
  await writeFile(tempPath, image.bytes, { baseDir: BaseDirectory.AppData })
  return tempPath
}

async function cleanupTempImageFile(path: string) {
  try {
    await remove(path, { baseDir: BaseDirectory.AppData })
  } catch {
    // Temporary recognition files are best-effort cleanup.
  }
}

export function EnhancedClipboard({ className }: EnhancedClipboardProps) {
  const t = useTranslations()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('workbench')
  const [sourceKind, setSourceKind] = useState<SourceKind>('empty')
  const [sourceOrigin, setSourceOrigin] = useState<SourceOrigin>('empty')
  const [sourceText, setSourceText] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftImage, setDraftImage] = useState<DraftImage | null>(null)
  const [draftTags, setDraftTags] = useState<string[]>([])
  const [targetLanguage, setTargetLanguage] = useState('English')
  const [processingAction, setProcessingAction] = useState<ProcessingAction>(null)
  const [status, setStatus] = useState<WorkbenchStatus>('idle')
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepStateMap>(() => createWorkflowStepStates())
  const [lastError, setLastError] = useState<WorkbenchError | null>(null)
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()
  const { enableImageRecognition, primaryImageMethod } = useSettingStore()

  const hasDraft = Boolean(draftTitle.trim() || draftContent.trim() || draftImage)
  const canProcessText = Boolean(draftContent.trim() || sourceText.trim())
  const isBusy = processingAction !== null

  const setWorkflowStep = useCallback((step: WorkflowStepId, nextStatus: WorkflowStepStatus, error?: string) => {
    setWorkflowSteps((current) => ({
      ...current,
      [step]: {
        status: nextStatus,
        error,
        updatedAt: Date.now(),
      },
    }))
  }, [])

  const setStepError = useCallback((step: WorkflowStepId | 'translate' | 'copy', message: string) => {
    if (step !== 'translate' && step !== 'copy') {
      setWorkflowStep(step, 'failed', message)
    }
    setLastError({ step, message })
  }, [setWorkflowStep])

  const getSourceLabel = useCallback((origin: SourceOrigin) => {
    if (origin === 'clipboard-text') return t('record.mark.enhancedClipboard.source.clipboardText')
    if (origin === 'clipboard-image') return t('record.mark.enhancedClipboard.source.clipboardImage')
    if (origin === 'drop-text') return t('record.mark.enhancedClipboard.source.dropText')
    if (origin === 'drop-image') return t('record.mark.enhancedClipboard.source.dropImage')
    if (origin === 'manual') return t('record.mark.enhancedClipboard.source.manual')
    return t('record.mark.enhancedClipboard.source.empty')
  }, [t])

  const sourceLabel = useMemo(() => {
    return getSourceLabel(sourceOrigin)
  }, [getSourceLabel, sourceOrigin])

  const draftCharacterCount = draftContent.length

  const buildWorkbenchSnapshot = useCallback((): WorkbenchSnapshot => ({
    sourceKind,
    sourceOrigin,
    sourceText,
    draftTitle,
    draftContent,
    draftImage,
    draftTags,
    status,
    workflowSteps,
    lastError,
  }), [
    draftContent,
    draftImage,
    draftTags,
    draftTitle,
    lastError,
    sourceKind,
    sourceOrigin,
    sourceText,
    status,
    workflowSteps,
  ])

  const pushUndoSnapshot = useCallback((step: UndoSnapshot['step'], label: string) => {
    const snapshot = buildWorkbenchSnapshot()
    setUndoStack((current) => [
      {
        id: uuid(),
        step,
        label,
        timestamp: Date.now(),
        snapshot,
      },
      ...current,
    ].slice(0, MAX_UNDO_STACK))
  }, [buildWorkbenchSnapshot])

  const restoreWorkbenchSnapshot = useCallback((snapshot: WorkbenchSnapshot) => {
    setSourceKind(snapshot.sourceKind)
    setSourceOrigin(snapshot.sourceOrigin)
    setSourceText(snapshot.sourceText)
    setDraftTitle(snapshot.draftTitle)
    setDraftContent(snapshot.draftContent)
    setDraftImage(snapshot.draftImage)
    setDraftTags(snapshot.draftTags)
    setStatus(snapshot.status)
    setWorkflowSteps(snapshot.workflowSteps)
    setLastError(snapshot.lastError)
  }, [])

  const handleUndo = useCallback(() => {
    const [latest] = undoStack
    if (!latest) return

    restoreWorkbenchSnapshot(latest.snapshot)
    setUndoStack((current) => current.slice(1))
    toast({ title: t('record.mark.enhancedClipboard.messages.undoSuccess', { action: latest.label }) })
  }, [restoreWorkbenchSnapshot, t, undoStack])

  const statusText = useMemo(() => {
    if (status === 'translated') {
      return t('record.mark.enhancedClipboard.status.translated', { language: targetLanguage })
    }
    if (status === 'noClipboard') {
      return t('record.mark.enhancedClipboard.messages.noClipboard')
    }
    if (status === 'readFail') {
      return t('record.mark.enhancedClipboard.messages.readFail')
    }
    if (status === 'processFail') {
      return t('record.mark.enhancedClipboard.messages.processFail')
    }
    if (status === 'importFail') {
      return t('record.mark.enhancedClipboard.messages.importFail')
    }
    if (status === 'historyRestored') {
      return t('record.mark.enhancedClipboard.messages.historyRestored')
    }
    return t(`record.mark.enhancedClipboard.status.${status}`)
  }, [status, targetLanguage, t])

  const saveHistorySnapshot = useCallback((next?: {
    type?: 'image' | 'text'
    sourceOrigin?: SourceOrigin
    sourceLabel?: string
    desc?: string
    content?: string
    thumbnail?: string
    tags?: string[]
  }) => {
    if (typeof window === 'undefined') return

    const preferences = readRecognitionPreferences()
    if (!preferences.saveHistory) return

    const content = next?.content ?? draftContent
    const desc = next?.desc ?? draftTitle
    const type = next?.type ?? (draftImage ? 'image' : 'text')
    const itemSourceOrigin = next?.sourceOrigin ?? sourceOrigin
    const itemTags = next?.tags ?? draftTags
    if (!content.trim() && !desc.trim()) return

    try {
      const saved = window.localStorage.getItem(HISTORY_KEY)
      const history = saved ? JSON.parse(saved) as RecognitionHistoryItem[] : []
      const item: RecognitionHistoryItem = {
        id: uuid(),
        timestamp: Date.now(),
        type,
        sourceOrigin: itemSourceOrigin,
        sourceLabel: next?.sourceLabel ?? getSourceLabel(itemSourceOrigin),
        desc: desc || inferTitle(content, t('record.mark.enhancedClipboard.draft.untitled')),
        content,
        thumbnail: next?.thumbnail ?? draftImage?.dataUrl,
        tags: itemTags,
      }
      const updated = [item, ...history].slice(0, preferences.maxHistoryItems)
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
      setHistoryVersion((version) => version + 1)
    } catch (error) {
      console.error('Failed to save recognition history:', error)
    }
  }, [draftContent, draftImage, draftTags, draftTitle, getSourceLabel, sourceOrigin, t])

  const applyTextDraft = useCallback((text: string, origin: SourceOrigin) => {
    const normalized = text.trim()
    setSourceKind('text')
    setSourceOrigin(origin)
    setSourceText(normalized)
    setDraftImage(null)
    setDraftContent(normalized)
    setDraftTitle(inferTitle(normalized, t('record.mark.enhancedClipboard.draft.untitled')))
    setDraftTags([])
    setLastError(null)
    setWorkflowStep('read', 'done')
    setStatus('ready')
  }, [setWorkflowStep, t])

  const organizeDraftText = useCallback(async (text: string, title: string, originLabel: string) => {
    const prompt = [
      '请把下面这段临时素材整理成适合个人知识库保存的 Markdown 笔记。',
      '要求：',
      '1. 保留原文中的事实、术语、数字和专有名词，不要编造。',
      '2. 如果内容杂乱，先提炼主题，再用小标题、要点、待确认信息组织。',
      '3. 如果信息不足，保留原始摘录并标出“待补充”。',
      '4. 只输出整理后的 Markdown 正文，不要解释你的处理过程。',
      '',
      `当前标题：${title || '未命名'}`,
      `来源：${originLabel}`,
      '',
      text,
    ].join('\n')

    const result = await fetchAi(prompt)
    const normalized = result.trim()
    if (!normalized) {
      throw new Error(t('record.mark.enhancedClipboard.messages.emptyAiResult'))
    }
    return normalized
  }, [t])

  const generateDraftTags = useCallback(async (text: string, title: string) => {
    const prompt = [
      '请为下面这条个人知识库草稿生成 3 到 6 个短标签。',
      '要求：',
      '1. 只输出 JSON 数组，例如 ["产品设计","会议纪要"]。',
      '2. 标签要短，避免句子、标点和泛泛的“笔记/资料”。',
      '3. 不要解释，不要 Markdown 代码块。',
      '',
      `标题：${title || '未命名'}`,
      '',
      text.slice(0, 8000),
    ].join('\n')

    const result = await fetchAi(prompt)
    const tags = parseDraftTags(result)
    if (tags.length === 0) {
      throw new Error(t('record.mark.enhancedClipboard.messages.tagFail'))
    }
    return tags
  }, [t])

  const generateDraftTitle = useCallback(async (text: string, currentTitle: string) => {
    const prompt = [
      '请给下面这条个人知识库草稿生成一个简洁标题。',
      '要求：',
      '1. 只输出标题本身，不要引号、编号、解释或 Markdown。',
      '2. 标题不超过 18 个中文字符或 36 个英文字符。',
      '3. 保留关键实体、主题或任务目标。',
      '',
      `当前标题：${currentTitle || '未命名'}`,
      '',
      text.slice(0, 8000),
    ].join('\n')

    const result = await fetchAi(prompt)
    const title = cleanAiSingleLine(result)
    if (!title) {
      throw new Error(t('record.mark.enhancedClipboard.messages.titleFail'))
    }
    return title
  }, [t])

  const runTagWorkflow = useCallback(async (text: string, title: string) => {
    pushUndoSnapshot('tag', t('record.mark.enhancedClipboard.workflow.undo.tag'))
    setProcessingAction('tag')
    setStatus('tagging')
    setWorkflowStep('tag', 'running')
    setLastError(null)

    try {
      const tags = await generateDraftTags(text, title)
      setDraftTags(tags)
      setWorkflowStep('tag', 'done')
      setStatus('tagged')
      return tags
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.tagFail')
      console.error('Failed to generate draft tags:', error)
      setStepError('tag', message)
      setStatus('processFail')
      toast({ title: message })
      return []
    } finally {
      setProcessingAction((current) => current === 'tag' ? null : current)
    }
  }, [generateDraftTags, pushUndoSnapshot, setStepError, setWorkflowStep, t])

  const runTitleWorkflow = useCallback(async (text: string, currentTitle: string) => {
    pushUndoSnapshot('title', t('record.mark.enhancedClipboard.workflow.undo.title'))
    setProcessingAction('title')
    setStatus('titling')
    setWorkflowStep('title', 'running')
    setLastError(null)

    try {
      const title = await generateDraftTitle(text, currentTitle)
      setDraftTitle(title)
      setWorkflowStep('title', 'done')
      setStatus('titled')
      return title
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.titleFail')
      console.error('Failed to generate draft title:', error)
      setStepError('title', message)
      setStatus('processFail')
      toast({ title: message })
      return currentTitle
    } finally {
      setProcessingAction((current) => current === 'title' ? null : current)
    }
  }, [generateDraftTitle, pushUndoSnapshot, setStepError, setWorkflowStep, t])

  const recognizeImage = useCallback(async (image = draftImage, origin: SourceOrigin = sourceOrigin) => {
    if (!image) {
      toast({ title: t('record.mark.enhancedClipboard.messages.recognizeFirst') })
      return
    }

    if (!enableImageRecognition) {
      toast({ title: t('record.mark.enhancedClipboard.messages.recognizeDisabled') })
      return
    }

    pushUndoSnapshot('recognize', t('record.mark.enhancedClipboard.workflow.undo.recognize'))
    setProcessingAction('recognize')
    setStatus('recognizing')
    setWorkflowStep('recognize', 'running')
    setLastError(null)
    let tempPath = ''
    let activeStep: WorkflowStepId = 'recognize'

    try {
      tempPath = await writeTempImageFile(image)
      const recognition = await recognizeStructuredImage({
        path: tempPath,
        base64: primaryImageMethod === 'vlm' ? image.dataUrl : undefined,
        method: primaryImageMethod,
        sourceLabel: t('record.mark.enhancedClipboard.source.image'),
        modelKey: 'knowledgeRelayVisionModel',
      })
      const nextContent = recognition.content.trim()
      const nextTitle = recognition.desc || inferTitle(nextContent, image.fileName)
      setDraftContent(nextContent)
      setDraftTitle(nextTitle)
      setDraftTags([])
      setWorkflowStep('recognize', 'done')
      setStatus('recognized')
      saveHistorySnapshot({
        type: 'image',
        sourceOrigin: origin,
        sourceLabel: getSourceLabel(origin),
        desc: nextTitle,
        content: nextContent,
        thumbnail: image.dataUrl,
      })

      const preferences = readRecognitionPreferences()
      if (preferences.autoOrganizeAfterRecognize && nextContent) {
        activeStep = 'organize'
        pushUndoSnapshot('organize', t('record.mark.enhancedClipboard.workflow.undo.organize'))
        setProcessingAction('organize')
        setStatus('organizing')
        setWorkflowStep('organize', 'running')

        const organized = await organizeDraftText(nextContent, nextTitle, getSourceLabel(origin))
        const organizedTitle = inferTitle(organized, nextTitle || t('record.mark.enhancedClipboard.draft.untitled'))
        setDraftContent(organized)
        setDraftTitle(organizedTitle)
        setWorkflowStep('organize', 'done')
        setStatus('organized')
        saveHistorySnapshot({
          type: 'image',
          sourceOrigin: origin,
          sourceLabel: getSourceLabel(origin),
          desc: organizedTitle,
          content: organized,
          thumbnail: image.dataUrl,
        })

        if (preferences.autoTagAfterOrganize) {
          const tags = await runTagWorkflow(organized, organizedTitle)
          if (tags.length > 0) {
            saveHistorySnapshot({
              type: 'image',
              sourceOrigin: origin,
              sourceLabel: getSourceLabel(origin),
              desc: organizedTitle,
              content: organized,
              thumbnail: image.dataUrl,
              tags,
            })
          }
        }
      }
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.processFail')
      console.error('Failed to recognize image:', error)
      setStepError(activeStep, message)
      setStatus('processFail')
      toast({ title: message })
    } finally {
      if (tempPath) {
        await cleanupTempImageFile(tempPath)
      }
      setProcessingAction((current) => current === 'recognize' || current === 'organize' ? null : current)
    }
  }, [
    draftImage,
    enableImageRecognition,
    getSourceLabel,
    organizeDraftText,
    primaryImageMethod,
    pushUndoSnapshot,
    runTagWorkflow,
    saveHistorySnapshot,
    setStepError,
    setWorkflowStep,
    sourceOrigin,
    t,
  ])

  const applyImageDraft = useCallback((image: DraftImage, origin: SourceOrigin) => {
    setSourceKind('image')
    setSourceOrigin(origin)
    setSourceText('')
    setDraftImage(image)
    setDraftContent('')
    setDraftTitle(inferTitle(image.fileName, t('record.mark.enhancedClipboard.source.image')))
    setDraftTags([])
    setLastError(null)
    setWorkflowStep('read', 'done')
    setStatus('ready')
  }, [setWorkflowStep, t])

  const handleReadClipboard = useCallback(async () => {
    if (hasDraft) {
      pushUndoSnapshot('read', t('record.mark.enhancedClipboard.workflow.undo.read'))
    }
    setProcessingAction('clipboard')
    setStatus('reading')
    setWorkflowStep('read', 'running')
    setLastError(null)

    try {
      const hasImageRes = await hasImage()
      const hasTextRes = await hasText()

      if (hasImageRes) {
        const base64 = await readImageBase64()
        const image = clipboardBase64ToDraftImage(base64)
        const preferences = readRecognitionPreferences()
        applyImageDraft(image, 'clipboard-image')
        if (preferences.autoRecognize && enableImageRecognition) {
          await recognizeImage(image, 'clipboard-image')
        }
        return
      }

      if (hasTextRes) {
        const text = await readText()
        applyTextDraft(text, 'clipboard-text')
        return
      }

      setStatus('noClipboard')
      setStepError('read', t('record.mark.enhancedClipboard.messages.noClipboard'))
      toast({ title: t('record.mark.enhancedClipboard.messages.noClipboard') })
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.readFail')
      console.error('Failed to read clipboard:', error)
      setStepError('read', message)
      setStatus('readFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'clipboard' ? null : current)
    }
  }, [
    applyImageDraft,
    applyTextDraft,
    enableImageRecognition,
    hasDraft,
    pushUndoSnapshot,
    recognizeImage,
    setStepError,
    setWorkflowStep,
    t,
  ])

  const handleImageDrop = useCallback(async (file: File) => {
    try {
      if (hasDraft) {
        pushUndoSnapshot('read', t('record.mark.enhancedClipboard.workflow.undo.read'))
      }
      setWorkflowStep('read', 'running')
      const image = await fileToDraftImage(file)
      const preferences = readRecognitionPreferences()
      applyImageDraft(image, 'drop-image')
      if (preferences.autoRecognize && enableImageRecognition) {
        await recognizeImage(image, 'drop-image')
      }
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.readFail')
      console.error('Failed to read dropped image:', error)
      setStepError('read', message)
      toast({ title: message })
    }
  }, [applyImageDraft, enableImageRecognition, hasDraft, pushUndoSnapshot, recognizeImage, setStepError, setWorkflowStep, t])

  const handleTextDrop = useCallback((text: string) => {
    if (hasDraft) {
      pushUndoSnapshot('read', t('record.mark.enhancedClipboard.workflow.undo.read'))
    }
    applyTextDraft(text, 'drop-text')
  }, [applyTextDraft, hasDraft, pushUndoSnapshot, t])

  const handleOrganize = useCallback(async () => {
    const text = (draftContent || sourceText).trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.organizeEmpty') })
      return
    }

    pushUndoSnapshot('organize', t('record.mark.enhancedClipboard.workflow.undo.organize'))
    setProcessingAction('organize')
    setStatus('organizing')
    setWorkflowStep('organize', 'running')
    setLastError(null)

    try {
      const result = await organizeDraftText(text, draftTitle, sourceLabel)
      const nextTitle = inferTitle(result, draftTitle || t('record.mark.enhancedClipboard.draft.untitled'))
      setDraftContent(result)
      setDraftTitle(nextTitle)
      setWorkflowStep('organize', 'done')
      setStatus('organized')
      saveHistorySnapshot({
        type: draftImage ? 'image' : 'text',
        sourceOrigin,
        sourceLabel,
        desc: nextTitle,
        content: result,
        thumbnail: draftImage?.dataUrl,
      })

      const preferences = readRecognitionPreferences()
      if (preferences.autoTagAfterOrganize) {
        const tags = await runTagWorkflow(result, nextTitle)
        if (tags.length > 0) {
          saveHistorySnapshot({
            type: draftImage ? 'image' : 'text',
            sourceOrigin,
            sourceLabel,
            desc: nextTitle,
            content: result,
            thumbnail: draftImage?.dataUrl,
            tags,
          })
        }
      }
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.processFail')
      console.error('Failed to organize draft:', error)
      setStepError('organize', message)
      setStatus('processFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'organize' ? null : current)
    }
  }, [
    draftContent,
    draftImage,
    draftTitle,
    organizeDraftText,
    pushUndoSnapshot,
    runTagWorkflow,
    saveHistorySnapshot,
    setStepError,
    setWorkflowStep,
    sourceLabel,
    sourceOrigin,
    sourceText,
    t,
  ])

  const handleGenerateTags = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.tagEmpty') })
      return
    }

    const tags = await runTagWorkflow(text, draftTitle)
    if (tags.length > 0) {
      saveHistorySnapshot({
        type: draftImage ? 'image' : 'text',
        sourceOrigin,
        sourceLabel,
        desc: draftTitle || inferTitle(text, t('record.mark.enhancedClipboard.draft.untitled')),
        content: text,
        thumbnail: draftImage?.dataUrl,
        tags,
      })
    }
  }, [draftContent, draftImage, draftTitle, runTagWorkflow, saveHistorySnapshot, sourceLabel, sourceOrigin, t])

  const handleGenerateTitle = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.titleEmpty') })
      return
    }

    const title = await runTitleWorkflow(text, draftTitle)
    if (title.trim()) {
      saveHistorySnapshot({
        type: draftImage ? 'image' : 'text',
        sourceOrigin,
        sourceLabel,
        desc: title,
        content: text,
        thumbnail: draftImage?.dataUrl,
        tags: draftTags,
      })
    }
  }, [draftContent, draftImage, draftTags, draftTitle, runTitleWorkflow, saveHistorySnapshot, sourceLabel, sourceOrigin, t])

  const handleTranslate = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.translateEmpty') })
      return
    }

    pushUndoSnapshot('translate', t('record.mark.enhancedClipboard.workflow.undo.translate'))
    setProcessingAction('translate')
    setStatus('translating')
    setLastError(null)

    try {
      const translated = await fetchAiTranslate(text, targetLanguage)
      if (translated.trim()) {
        setDraftContent(translated.trim())
        setDraftTitle(inferTitle(translated, draftTitle || targetLanguage))
        setStatus('translated')
        saveHistorySnapshot({
          type: draftImage ? 'image' : 'text',
          sourceOrigin,
          sourceLabel,
          desc: inferTitle(translated, draftTitle || targetLanguage),
          content: translated.trim(),
          thumbnail: draftImage?.dataUrl,
          tags: draftTags,
        })
      }
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.processFail')
      console.error('Failed to translate draft:', error)
      setStepError('translate', message)
      setStatus('processFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'translate' ? null : current)
    }
  }, [
    draftContent,
    draftImage,
    draftTags,
    draftTitle,
    pushUndoSnapshot,
    saveHistorySnapshot,
    setStepError,
    sourceLabel,
    sourceOrigin,
    targetLanguage,
    t,
  ])

  const handleCopyDraftText = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) return

    setProcessingAction('copy')
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
      toast({ title: t('record.mark.enhancedClipboard.messages.copySuccess') })
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.copyFail')
      console.error('Failed to copy draft:', error)
      setStepError('copy', message)
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'copy' ? null : current)
    }
  }, [draftContent, setStepError, t])

  const handleCopyImage = useCallback(async () => {
    if (!draftImage) return

    setProcessingAction('copy')
    try {
      await writeImageBase64(draftImage.base64)
      setStatus('copied')
      toast({ title: t('record.mark.enhancedClipboard.messages.copySuccess') })
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.copyFail')
      console.error('Failed to copy image:', error)
      setStepError('copy', message)
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'copy' ? null : current)
    }
  }, [draftImage, setStepError, t])

  const handleDraftContentChange = useCallback((value: string) => {
    setDraftContent(value)
    if (sourceKind === 'empty') {
      setSourceKind('text')
      setSourceOrigin('manual')
      setSourceText(value)
    }
    if (!draftTitle.trim() && value.trim()) {
      setDraftTitle(inferTitle(value, t('record.mark.enhancedClipboard.draft.untitled')))
    }
    if (status === 'idle') {
      setStatus('ready')
    }
  }, [draftTitle, sourceKind, status, t])

  const handleClear = useCallback(() => {
    if (hasDraft) {
      pushUndoSnapshot('clear', t('record.mark.enhancedClipboard.workflow.undo.clear'))
    }
    setSourceKind('empty')
    setSourceOrigin('empty')
    setSourceText('')
    setDraftImage(null)
    setDraftTitle('')
    setDraftContent('')
    setDraftTags([])
    setWorkflowSteps(createWorkflowStepStates())
    setLastError(null)
    setStatus('cleared')
  }, [hasDraft, pushUndoSnapshot, t])

  const refreshRecords = useCallback(async () => {
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }, [fetchMarks, fetchTags, getCurrentTag])

  const handleImportRecord = useCallback(async () => {
    if (!hasDraft) {
      toast({ title: t('record.mark.enhancedClipboard.messages.emptyDraft') })
      return
    }

    pushUndoSnapshot('import', t('record.mark.enhancedClipboard.workflow.undo.import'))

    try {
      const preferences = readRecognitionPreferences()
      let importTitle = draftTitle
      let importContent = draftContent.trim()

      if (preferences.autoTitleBeforeImport && importContent) {
        importTitle = await runTitleWorkflow(importContent, importTitle)
      }

      const contentWithTags = appendTagsToContent(
        importContent,
        draftTags,
        t('record.mark.enhancedClipboard.draft.tagsPrefix'),
      )
      importContent = contentWithTags

      setProcessingAction('import')
      setStatus('importing')
      setWorkflowStep('import', 'running')
      setLastError(null)

      if (draftImage) {
        const queueId = uuid()
        const filename = `${queueId}.${draftImage.extension}`
        addQueue({
          queueId,
          tagId: currentTagId,
          progress: t('record.mark.progress.cacheImage'),
          type: 'image',
          startTime: Date.now(),
        })

        try {
          await ensureAppDataDir(IMAGE_DIR)
          await writeFile(`${IMAGE_DIR}/${filename}`, draftImage.bytes, { baseDir: BaseDirectory.AppData })

          const mark: Partial<Mark> = {
            tagId: currentTagId,
            type: 'image',
            content: importContent,
            url: filename,
            desc: importTitle || inferTitle(importContent, draftImage.fileName),
          }

          const file = new File([draftImage.bytes], filename, { type: draftImage.mimeType })
          const hostedUrl = await uploadImage(file)
          if (hostedUrl) {
            setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
            mark.url = hostedUrl
          }

          setQueue(queueId, { progress: t('record.mark.progress.save') })
          await insertMark(mark)
          removeQueue(queueId)
        } catch (error) {
          removeQueue(queueId)
          throw error
        }
      } else {
        const mark: Partial<Mark> = {
          tagId: currentTagId,
          type: 'text',
          content: importContent,
          desc: importTitle || inferTitle(importContent, t('record.mark.enhancedClipboard.draft.untitled')),
        }
        await insertMark(mark)
      }

      await refreshRecords()
      handleRecordComplete(router)
      saveHistorySnapshot({
        type: draftImage ? 'image' : 'text',
        sourceOrigin,
        sourceLabel,
        desc: importTitle || inferTitle(importContent, t('record.mark.enhancedClipboard.draft.untitled')),
        content: importContent,
        thumbnail: draftImage?.dataUrl,
        tags: draftTags,
      })
      setWorkflowStep('import', 'done')
      setStatus('imported')
      toast({ title: t('record.mark.enhancedClipboard.messages.importSuccess') })
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.importFail')
      console.error('Failed to import recognition draft:', error)
      setStepError('import', message)
      setStatus('importFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'import' ? null : current)
    }
  }, [
    addQueue,
    currentTagId,
    draftContent,
    draftImage,
    draftTags,
    draftTitle,
    hasDraft,
    pushUndoSnapshot,
    refreshRecords,
    removeQueue,
    router,
    runTitleWorkflow,
    saveHistorySnapshot,
    setQueue,
    setStepError,
    setWorkflowStep,
    sourceLabel,
    sourceOrigin,
    t,
  ])

  const handleHistorySelect = useCallback((item: RecognitionHistoryItem) => {
    if (hasDraft) {
      pushUndoSnapshot('read', t('record.mark.enhancedClipboard.workflow.undo.restore'))
    }
    setActiveTab('workbench')
    setSourceKind(item.type)
    setSourceOrigin(item.sourceOrigin || 'manual')
    setSourceText(item.type === 'text' ? item.content : '')
    setDraftTitle(item.desc)
    setDraftContent(item.content)
    setDraftTags(item.tags || [])

    if (item.thumbnail?.startsWith('data:image/')) {
      const { base64, mimeType } = dataUrlParts(item.thumbnail)
      const bytes = base64ToBytes(base64)
      const extension = extensionFromMime(mimeType)
      setDraftImage({
        dataUrl: item.thumbnail,
        base64,
        bytes,
        fileName: `history.${extension}`,
        mimeType,
        extension,
        sizeLabel: convertBytesToSize(bytes.length),
      })
    } else {
      setDraftImage(null)
    }

    setWorkflowStep('read', 'done')
    setLastError(null)
    setStatus('historyRestored')
  }, [hasDraft, pushUndoSnapshot, setWorkflowStep, t])

  const handleHistoryDelete = useCallback(() => {
    setStatus('ready')
  }, [t])

  const handleHistoryClear = useCallback(() => {
    setStatus('cleared')
  }, [t])

  const latestUndo = undoStack[0]

  const renderStepIcon = (stepStatus: WorkflowStepStatus) => {
    if (stepStatus === 'running') return <Loader2 className="size-3.5 animate-spin text-primary" />
    if (stepStatus === 'done') return <CheckCircle2 className="size-3.5 text-emerald-500" />
    if (stepStatus === 'failed') return <XCircle className="size-3.5 text-destructive" />
    return <Circle className="size-3.5 text-muted-foreground/45" />
  }

  return (
    <div className={cn('space-y-3', className)}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-primary" />
              <h3 className="truncate text-sm font-semibold">
                {t('record.mark.enhancedClipboard.title')}
              </h3>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {statusText}
            </p>
          </div>
          <TabsList className="grid h-8 w-full grid-cols-3 sm:w-[280px]">
            <TabsTrigger value="workbench" className="text-xs">
              <Wand2 className="mr-1.5 size-3.5" />
              {t('record.mark.enhancedClipboard.tabs.clipboard')}
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              <History className="mr-1.5 size-3.5" />
              {t('record.mark.enhancedClipboard.tabs.history')}
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">
              <Settings className="mr-1.5 size-3.5" />
              {t('record.mark.enhancedClipboard.tabs.settings')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workbench" className="mt-3">
          <div className="grid gap-3 lg:grid-cols-[245px_minmax(0,1fr)]">
            <div className="space-y-3">
              <section className="rounded-lg border border-border/60 bg-muted/15 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    {sourceKind === 'image' ? (
                      <ImageIcon className="size-3.5 text-primary" />
                    ) : (
                      <FileText className="size-3.5 text-primary" />
                    )}
                    {t('record.mark.enhancedClipboard.source.title')}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={handleClear}
                    disabled={isBusy || !hasDraft}
                    title={t('record.mark.enhancedClipboard.source.clear')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={handleReadClipboard}
                    disabled={isBusy}
                  >
                    {processingAction === 'clipboard' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ClipboardPaste className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.source.clipboard')}
                  </Button>
                  <ClipboardDropzone
                    onImageDrop={handleImageDrop}
                    onTextDrop={handleTextDrop}
                    className="rounded-lg"
                    compact
                  />
                </div>

                <div className="mt-3 overflow-hidden rounded-md border border-border/50 bg-background">
                  {draftImage ? (
                    <div className="space-y-2 p-2">
                      <div className="relative aspect-video overflow-hidden rounded bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={draftImage.dataUrl}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{sourceLabel}</span>
                        <span className="shrink-0">{draftImage.sizeLabel}</span>
                      </div>
                    </div>
                  ) : sourceText ? (
                    <div className="max-h-28 overflow-y-auto p-3 text-xs leading-relaxed text-muted-foreground">
                      <p className="whitespace-pre-wrap break-words">
                        {truncate(sourceText, 260)}
                      </p>
                    </div>
                  ) : (
                    <div className="flex min-h-24 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                      <ClipboardPaste className="size-5" />
                      {t('record.mark.enhancedClipboard.source.empty')}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-border/60 bg-background p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                  <Sparkles className="size-3.5 text-primary" />
                  {t('record.mark.enhancedClipboard.actions.process')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => recognizeImage()}
                    disabled={isBusy || !draftImage || !enableImageRecognition}
                  >
                    {processingAction === 'recognize' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.recognize')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOrganize}
                    disabled={isBusy || !canProcessText}
                  >
                    {processingAction === 'organize' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.organize')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateTags}
                    disabled={isBusy || !draftContent.trim()}
                  >
                    {processingAction === 'tag' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Tag className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.tag')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateTitle}
                    disabled={isBusy || !draftContent.trim()}
                  >
                    {processingAction === 'title' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.title')}
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((language) => (
                        <SelectItem key={language} value={language}>
                          {language}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTranslate}
                    disabled={isBusy || !draftContent.trim()}
                  >
                    {processingAction === 'translate' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Languages className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.translate')}
                  </Button>
                </div>
              </section>


            </div>

            <section className="flex min-w-0 flex-col rounded-lg border border-border/60 bg-background">
              <div className="border-b border-border/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                    <FileText className="size-3.5 text-primary" />
                    {t('record.mark.enhancedClipboard.draft.content')}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t('record.mark.enhancedClipboard.draft.source', { source: sourceLabel })}
                  </span>
                </div>
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder={t('record.mark.enhancedClipboard.draft.titlePlaceholder')}
                  className="h-8 text-sm"
                />
                {draftTags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draftTags.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] text-primary"
                      >
                        #{item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 p-3">
                <Textarea
                  value={draftContent}
                  onChange={(event) => handleDraftContentChange(event.target.value)}
                  placeholder={t('record.mark.enhancedClipboard.draft.contentPlaceholder')}
                  className="min-h-[330px] resize-none border-border/60 text-sm leading-relaxed"
                />
              </div>

              <div className="flex flex-col gap-3 border-t border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] text-muted-foreground">
                  {t('record.mark.enhancedClipboard.draft.characters', { count: draftCharacterCount })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyImage}
                    disabled={isBusy || !draftImage}
                  >
                    <ImageIcon className="size-3.5" />
                    {t('record.mark.enhancedClipboard.actions.copyImage')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyDraftText}
                    disabled={isBusy || !draftContent.trim()}
                  >
                    {processingAction === 'copy' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.copyText')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleImportRecord}
                    disabled={isBusy || !hasDraft}
                  >
                    {processingAction === 'import' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="size-3.5" />
                    )}
                    {t('record.mark.enhancedClipboard.actions.import')}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <RecognitionHistory
            version={historyVersion}
            onSelect={handleHistorySelect}
            onDelete={handleHistoryDelete}
            onClear={handleHistoryClear}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-3">
          <RecognitionSettings />
        </TabsContent>
      </Tabs>

      {isBusy && (
        <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
          <Loader2 className="size-3.5 animate-spin" />
          {t('record.mark.enhancedClipboard.actions.processing')}
        </div>
      )}

      {lastError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {t('record.mark.enhancedClipboard.messages.stepFail', {
                step: t(`record.mark.enhancedClipboard.workflow.steps.${lastError.step}`),
              })}
            </p>
            <p className="mt-0.5 break-words text-[11px] opacity-85">
              {lastError.message}
            </p>
          </div>
        </div>
      )}

      {status === 'imported' && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          {t('record.mark.enhancedClipboard.messages.importSuccess')}
        </div>
      )}
    </div>
  )
}
