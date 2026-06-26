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
import { hasImage, hasText, readImageBase64, readText } from 'tauri-plugin-clipboard-api'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

import { RecognitionHistory } from './recognition-history'
import { RecognitionSettings } from './recognition-settings'

interface EnhancedClipboardProps {
  className?: string
}

type SourceKind = 'empty' | 'text' | 'image'
type SourceOrigin = 'empty' | 'clipboard-text' | 'clipboard-image' | 'drop-text' | 'drop-image' | 'manual'
type ProcessingAction = 'clipboard' | 'recognize' | 'organize' | 'tag' | 'title' | 'translate' | 'import' | 'copy' | null
type WorkbenchActionId = 'recognize' | 'organize' | 'summarize' | 'extract' | 'tag' | 'title' | 'translate' | 'import'
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

const WORKBENCH_ACTIONS: Array<{
  id: WorkbenchActionId
  step?: WorkflowStepId
  icon: typeof ImageIcon
  labelKey: string
}> = [
  { id: 'recognize', step: 'recognize', icon: ImageIcon, labelKey: 'recognize' },
  { id: 'organize', step: 'organize', icon: Wand2, labelKey: 'organize' },
  { id: 'summarize', step: 'organize', icon: FileText, labelKey: 'summarize' },
  { id: 'extract', step: 'organize', icon: ClipboardCheck, labelKey: 'extract' },
  { id: 'tag', step: 'tag', icon: Tag, labelKey: 'tag' },
  { id: 'title', step: 'title', icon: Sparkles, labelKey: 'title' },
  { id: 'translate', icon: Languages, labelKey: 'translate' },
  { id: 'import', step: 'import', icon: ArrowDownToLine, labelKey: 'import' },
]

type WorkbenchAction = (typeof WORKBENCH_ACTIONS)[number]

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
  const tempPath = `${TEMP_RECOGNITION_DIR}/${crypto.randomUUID()}.${image.extension}`
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
  const [targetLanguage, setTargetLanguage] = useState('中文')
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
    setDraftTitle('')
    setDraftTags([])
    setLastError(null)
    setWorkflowStep('read', 'done')
    setStatus('ready')
  }, [setWorkflowStep])

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

  const summarizeDraftText = useCallback(async (text: string, title: string) => {
    const prompt = [
      '请为下面这段内容生成一份简洁的知识摘要。',
      '要求：',
      '1. 用 3-5 句话概括核心信息和主要结论。',
      '2. 保留关键数据、专有名词和重要细节。',
      '3. 如果有不同观点或争议，简要指出。',
      '4. 只输出摘要正文，不要标题、不要解释处理过程。',
      '',
      `原标题：${title || '未命名'}`,
      '',
      text.slice(0, 12000),
    ].join('\n')

    const result = await fetchAi(prompt)
    const normalized = result.trim()
    if (!normalized) {
      throw new Error(t('record.mark.enhancedClipboard.messages.emptyAiResult'))
    }
    return normalized
  }, [t])

  const extractKeyPoints = useCallback(async (text: string, title: string) => {
    const prompt = [
      '请从下面这段内容中提取关键知识点和要点。',
      '要求：',
      '1. 用清晰的编号列表格式输出，每个要点一行。',
      '2. 每个要点应包含一个具体的事实、数据、概念或结论。',
      '3. 对重要概念用 **加粗** 标记。',
      '4. 如果内容包含步骤/流程/方法，保留顺序。',
      '5. 只输出要点列表，不要前言、总结或解释。',
      '',
      `原标题：${title || '未命名'}`,
      '',
      text.slice(0, 12000),
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
        modelKey: 'imageMethodModel',
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
    setDraftTitle('')
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

      const preferences = readRecognitionPreferences()
      if (preferences.autoTagAfterOrganize) {
        await runTagWorkflow(result, nextTitle)
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

  const handleSummarize = useCallback(async () => {
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
      const summary = await summarizeDraftText(text, draftTitle)
      // 保留原文 + 追加摘要
      const contentWithSummary = [
        text,
        '',
        '---',
        `**📌 知识摘要**`,
        '',
        summary,
      ].join('\n')
      setDraftContent(contentWithSummary)
      setWorkflowStep('organize', 'done')
      setStatus('organized')
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.processFail')
      console.error('Failed to summarize draft:', error)
      setStepError('organize', message)
      setStatus('processFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'organize' ? null : current)
    }
  }, [
    draftContent,
    draftTitle,
    pushUndoSnapshot,
    setStepError,
    setWorkflowStep,
    sourceText,
    summarizeDraftText,
    t,
  ])

  const handleExtract = useCallback(async () => {
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
      const points = await extractKeyPoints(text, draftTitle)
      // 保留原文 + 追加要点
      const contentWithPoints = [
        text,
        '',
        '---',
        `**📋 关键要点**`,
        '',
        points,
      ].join('\n')
      setDraftContent(contentWithPoints)
      setWorkflowStep('organize', 'done')
      setStatus('organized')
    } catch (error) {
      const message = getErrorMessage(error) || t('record.mark.enhancedClipboard.messages.processFail')
      console.error('Failed to extract key points:', error)
      setStepError('organize', message)
      setStatus('processFail')
      toast({ title: message })
    } finally {
      setProcessingAction((current) => current === 'organize' ? null : current)
    }
  }, [
    draftContent,
    draftTitle,
    extractKeyPoints,
    pushUndoSnapshot,
    setStepError,
    setWorkflowStep,
    sourceText,
    t,
  ])

  const handleGenerateTags = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.tagEmpty') })
      return
    }

    await runTagWorkflow(text, draftTitle)
  }, [draftContent, draftImage, draftTitle, runTagWorkflow, t])

  const handleGenerateTitle = useCallback(async () => {
    const text = draftContent.trim()
    if (!text) {
      toast({ title: t('record.mark.enhancedClipboard.messages.titleEmpty') })
      return
    }

    await runTitleWorkflow(text, draftTitle)
  }, [draftContent, draftTitle, runTitleWorkflow, t])

  /**
   * 将原文和译文组合为交替段落对照格式。
   * 每个段落：原文 → 引用块译文，方便阅读时对照。
   */
  function buildBilingualContent(original: string, translated: string, language: string): string {
    const languageLabel = `(${language})`
    const originalParagraphs = original.split(/\n{2,}/).filter(Boolean)
    const translatedParagraphs = translated.split(/\n{2,}/).filter(Boolean)

    // 如果段落数量一致，逐段对照；否则整块对照
    if (originalParagraphs.length === translatedParagraphs.length && originalParagraphs.length > 1) {
      const pairs = originalParagraphs.map((orig, i) => {
        const trans = translatedParagraphs[i] || ''
        return `${orig.trim()}\n\n> ${trans.trim()} ${languageLabel}`
      })
      return pairs.join('\n\n')
    }

    // 整块对照：原文 + 分隔线 + 译文
    return [
      original.trim(),
      '',
      '---',
      `**${languageLabel}**`,
      '',
      translated.trim(),
    ].join('\n')
  }

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
        // 生成原文+译文交替段落的对照格式
        const bilingualContent = buildBilingualContent(text, translated.trim(), targetLanguage)
        setDraftContent(bilingualContent)
        setDraftTitle(inferTitle(translated, draftTitle || targetLanguage))
        setStatus('translated')
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

  const handleDraftContentChange = useCallback((value: string) => {
    setDraftContent(value)
    if (sourceKind === 'empty') {
      setSourceKind('text')
      setSourceOrigin('manual')
      setSourceText(value)
    }
    if (!draftTitle.trim() && value.trim()) {
      // Don't auto-fill title from content — let AI workflows generate it
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
        const queueId = crypto.randomUUID()
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

  const getActionDisabled = useCallback((action: WorkbenchActionId) => {
    if (isBusy) return true
    if (action === 'recognize') return !draftImage || !enableImageRecognition
    if (action === 'organize') return !canProcessText
    if (action === 'tag') return !draftContent.trim()
    if (action === 'summarize') return !canProcessText
    if (action === 'extract') return !canProcessText
    if (action === 'title') return !draftContent.trim()
    if (action === 'translate') return !draftContent.trim()
    return !hasDraft
  }, [canProcessText, draftContent, draftImage, enableImageRecognition, hasDraft, isBusy])

  const runWorkbenchAction = useCallback((action: WorkbenchActionId) => {
    if (action === 'recognize') return recognizeImage()
    if (action === 'organize') return handleOrganize()
    if (action === 'summarize') return handleSummarize()
    if (action === 'extract') return handleExtract()
    if (action === 'tag') return handleGenerateTags()
    if (action === 'title') return handleGenerateTitle()
    if (action === 'translate') return handleTranslate()
    return handleImportRecord()
  }, [
    handleExtract,
    handleGenerateTags,
    handleGenerateTitle,
    handleImportRecord,
    handleOrganize,
    handleSummarize,
    handleTranslate,
    recognizeImage,
  ])

  const recommendedActionId = useMemo<WorkbenchActionId>(() => {
    if (draftImage && workflowSteps.recognize.status !== 'done' && enableImageRecognition) return 'recognize'
    if (canProcessText && workflowSteps.organize.status !== 'done') return 'organize'
    if (draftContent.trim() && draftTags.length === 0) return 'tag'
    if (draftContent.trim() && !draftTitle.trim()) return 'title'
    return 'import'
  }, [
    canProcessText,
    draftContent,
    draftImage,
    draftTags.length,
    draftTitle,
    enableImageRecognition,
    workflowSteps.organize.status,
    workflowSteps.recognize.status,
  ])

  const processingActions = WORKBENCH_ACTIONS.filter((item) => item.id !== 'import' && item.id !== 'recognize')
  const importAction = WORKBENCH_ACTIONS.find((item) => item.id === 'import') ?? WORKBENCH_ACTIONS[0]!
  const activeWorkflowSteps = WORKFLOW_STEPS.filter((step) => workflowSteps[step].status !== 'idle')

  const renderStepIcon = (stepStatus: WorkflowStepStatus) => {
    if (stepStatus === 'running') return <Loader2 className="size-3.5 animate-spin text-primary" />
    if (stepStatus === 'done') return <CheckCircle2 className="size-3.5 text-emerald-500" />
    if (stepStatus === 'failed') return <XCircle className="size-3.5 text-destructive" />
    return <Circle className="size-3.5 text-muted-foreground/45" />
  }

  const renderActionButton = (action: WorkbenchAction, primary = false) => {
    const Icon = action.icon
    const isProcessing = processingAction === action.id
    const isRecommended = recommendedActionId === action.id

    return (
      <button
        key={action.id}
        type="button"
        className={cn(
          'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
          primary
            ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border-border/60 bg-background text-foreground hover:bg-muted',
          isRecommended && !primary && 'border-primary/40 bg-primary/5 text-primary',
        )}
        onClick={() => {
          void runWorkbenchAction(action.id)
        }}
        disabled={getActionDisabled(action.id)}
        aria-current={isRecommended ? 'step' : undefined}
      >
        {isProcessing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
        <span className="truncate">
          {t(`record.mark.enhancedClipboard.actions.${action.labelKey}`)}
        </span>
      </button>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      {/* Header: title + tabs */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          <h3 className="truncate text-sm font-semibold">
            {t('record.mark.enhancedClipboard.title')}
          </h3>
        </div>
        <TabsList className="grid h-7 grid-cols-3 bg-muted/40 shrink-0">
          <TabsTrigger value="workbench" className="text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-none">
            <Wand2 className="mr-1 size-3" />
            {t('record.mark.enhancedClipboard.tabs.clipboard')}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-none">
            <History className="mr-1 size-3" />
            {t('record.mark.enhancedClipboard.tabs.history')}
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-none">
            <Settings className="mr-1 size-3" />
            {t('record.mark.enhancedClipboard.tabs.settings')}
          </TabsTrigger>
        </TabsList>
      </div>
        {/* ========== Workbench Tab — Left/Right Layout ========== */}
        <TabsContent value="workbench" className="mt-0">
          <div
            className="grid h-[320px] gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 sm:grid-cols-[200px_minmax(0,1fr)]"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation()
              const files = Array.from(e.dataTransfer.files)
              const imageFile = files.find(f => f.type.startsWith('image/'))
              const text = e.dataTransfer.getData('text/plain')
              if (imageFile) handleImageDrop(imageFile)
              else if (text) handleTextDrop(text)
            }}
          >
            {/* ---- Left Panel: Source & Controls ---- */}
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              {/* Read clipboard */}
              <button
                type="button"
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-background border border-border/60 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                onClick={handleReadClipboard}
                disabled={isBusy}
              >
                {processingAction === 'clipboard' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ClipboardPaste className="size-3.5" />
                )}
                {t('record.mark.enhancedClipboard.source.clipboard')}
              </button>

              {/* Source info */}
              <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <ClipboardCheck className="size-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate">{sourceLabel}</span>
              </div>

              {/* Image preview / Drag hint */}
              {draftImage ? (
                <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draftImage.dataUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 text-[10px] text-muted-foreground">
                    <span className="block truncate">{draftImage.fileName}</span>
                    <span>{draftImage.sizeLabel}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border/50 bg-muted/10 px-2 py-3 text-center text-[11px] text-muted-foreground/60">
                  {t('record.mark.enhancedClipboard.source.dragHint')}
                </div>
              )}

              {/* Tags */}
              {draftTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {draftTags.map((item) => (
                    <span key={item} className="inline-flex items-center rounded-md border border-primary/20 bg-primary/5 px-1.5 py-px text-[11px] text-primary">#{item}</span>
                  ))}
                </div>
              )}

              {/* Workflow steps */}
              {activeWorkflowSteps.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/40 bg-muted/10 px-2 py-1">
                  {activeWorkflowSteps.map((step) => {
                    const stepState = workflowSteps[step]
                    return (
                      <div key={step} className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                        {renderStepIcon(stepState.status)}
                        <span className="truncate">{t(`record.mark.enhancedClipboard.workflow.steps.${step}`)}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Action buttons (bottom of left panel) */}
              <div className="flex flex-col gap-1 pt-2">
                <div className="grid grid-cols-2 gap-1">
                  {processingActions.map((action) => renderActionButton(action))}
                </div>
                <div className="flex items-center gap-1">
                  <Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={isBusy}>
                    <SelectTrigger
                      className="h-7 flex-1 rounded-md border-border/60 bg-background px-1.5 text-[11px] shadow-none"
                      aria-label={t('record.mark.enhancedClipboard.actions.translateTo')}
                    >
                      <Languages className="size-3 shrink-0 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((language) => (
                        <SelectItem key={language} value={language} className="text-xs">
                          {language}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {renderActionButton(importAction, true)}
              </div>
            </div>

            {/* ---- Right Panel: Editor ---- */}
            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
              {/* Title */}
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder={t('record.mark.enhancedClipboard.draft.titlePlaceholder')}
                className="h-8 text-sm"
              />

              {/* Content editor */}
              <Textarea
                value={draftContent}
                onChange={(event) => handleDraftContentChange(event.target.value)}
                placeholder={t('record.mark.enhancedClipboard.draft.contentPlaceholder')}
                className="flex-1 resize-none border-border/40 text-sm leading-relaxed"
              />

              {/* Bottom bar */}
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {t('record.mark.enhancedClipboard.draft.characters', { count: draftCharacterCount })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {latestUndo && (
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={isBusy}
                      title={latestUndo.label}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Undo2 className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    onClick={handleCopyDraftText}
                    disabled={isBusy || !draftContent.trim()}
                    title={t('record.mark.enhancedClipboard.actions.copyText')}
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    onClick={handleClear}
                    disabled={isBusy || !hasDraft}
                    title={t('record.mark.enhancedClipboard.source.clear')}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <div className="h-[320px] overflow-y-auto rounded-lg border border-border/50 bg-muted/10 p-2">
          <RecognitionHistory
            version={historyVersion}
            onSelect={handleHistorySelect}
            onDelete={handleHistoryDelete}
            onClear={handleHistoryClear}
          />
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <div className="h-[320px] overflow-y-auto rounded-lg border border-border/50 bg-muted/10 p-2">
          <RecognitionSettings />
          </div>
        </TabsContent>
      </Tabs>

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
