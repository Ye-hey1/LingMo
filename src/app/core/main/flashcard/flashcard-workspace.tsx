'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import MarkdownIt from 'markdown-it'
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Download,
  FilePlus2,
  FileText,
  Layers3,
  LoaderCircle,
  MousePointer2,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlashcardCreateDialog } from '@/components/flashcard-create-dialog'
import {
  createFlashcardDeck,
  createFlashcardsBatch,
  deleteFlashcard,
  deleteFlashcardDeck,
  ensureDefaultFlashcardDeck,
  addFlashcardTagsBulk,
  getFlashcardSearchHistory,
  getFlashcardTagStats,
  getDueFlashcards,
  getFlashcardDeckById,
  getFlashcardDeckSummaries,
  getFlashcardLearningStats,
  getFlashcardsByDeckId,
  getWeakFlashcards,
  moveFlashcardToDeck,
  resetFlashcardProgress,
  removeFlashcardTagsBulk,
  saveFlashcardSearchHistory,
  searchFlashcards,
  updateFlashcardDeck,
  updateFlashcardReview,
  updateFlashcardTags,
  updateFlashcardStatus,
  getDailyReviewStats,
  getStreakDays,
  getTotalCardStatusCounts,
} from '@/db/flashcards'
import { toast } from '@/hooks/use-toast'
import { fetchAi } from '@/lib/ai/chat'
import { exportFlashcardFile, importFlashcardFile } from '@/lib/flashcard-import-export'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import {
  getLingMoFilePointerDragDetail,
  isPointInsideElement,
  LINGMO_FILE_POINTER_DRAG_EVENT,
  type LingMoFilePointerDragDetail,
} from '@/lib/file-pointer-drag'
import { cn } from '@/lib/utils'
import type {
  CreateFlashcardInput,
  Flashcard,
  FlashcardDeckSummary,
  FlashcardLearningStats,
  FlashcardReviewRating,
  FlashcardType,
} from '@/types/flashcard'
import type { FlashcardSearchHistoryItem, FlashcardTagStat } from '@/db/flashcards'

interface FlashcardWorkspaceProps {
  sourcePath?: string | null
}

type FlashcardWorkspaceView =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'decks' }
  | { name: 'weak' }
  | { name: 'stats' }
  | { name: 'review'; deckId?: number; mode?: 'due' | 'weak' }

type GenerateMode = 'memory' | 'exam' | 'concept'
type GenerateQuestionType = Extract<FlashcardType, 'choice' | 'cloze' | 'short-answer' | 'true-false'>

interface SourceNote {
  id: string
  path: string
  name: string
  content: string
  status: 'loading' | 'ready' | 'error'
  error?: string
}

interface GeneratedDraft {
  type: GenerateQuestionType
  front?: string
  back?: string
  clozeText?: string
  choices?: string[]
  choiceMode?: ChoiceMode
  correctChoices?: string[]
  tags?: string[]
  sourcePath?: string
  difficulty?: 'basic' | 'understanding' | 'application' | 'confusable'
  sourceSummary?: string
  qualityNote?: string
  atomicityIssue?: string
  duplicateHint?: string
  selected: boolean
}

interface ReviewContent {
  prompt: string
  answer: string
  promptLabel: string
  answerLabel: string
  choices?: string[]
  choiceMode?: ChoiceMode
  correctIndexes?: number[]
}

type ReviewCardStatus = 'correct' | 'wrong' | 'skipped'
type ChoiceMode = 'single' | 'multiple'

interface ReviewCardState {
  status?: ReviewCardStatus
  answer?: string
  choiceIndex?: number | null
  choiceIndexes?: number[]
  showAnswer?: boolean
  recorded?: boolean
  nextDueAt?: number
}

const defaultStats: FlashcardLearningStats = {
  todayReviewedCount: 0,
  todayMasteredCount: 0,
  todayMasteryRate: 0,
  weakCount: 0,
}

const modeOptions: Array<{ value: GenerateMode; label: string; hint: string }> = [
  { value: 'memory', label: '记忆巩固', hint: '适合知识点复习' },
  { value: 'exam', label: '测验训练', hint: '更像考试题' },
  { value: 'concept', label: '概念理解', hint: '强调为什么' },
]

const questionTypeOptions: Array<{ value: GenerateQuestionType; label: string }> = [
  { value: 'choice', label: '选择题' },
  { value: 'cloze', label: '填空题' },
  { value: 'short-answer', label: '简答题' },
  { value: 'true-false', label: '判断题' },
]

const ratingOptions: Array<{
  value: FlashcardReviewRating
  label: string
  hint: string
  className: string
  icon: LucideIcon
}> = [
  { value: 0, label: '不会', hint: '加入薄弱', icon: X, className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-300' },
  { value: 1, label: '困难', hint: '还要练', icon: CircleAlert, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300' },
  { value: 2, label: '记住', hint: '正常复习', icon: CheckCircle2, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300' },
  { value: 3, label: '轻松', hint: '延后复习', icon: Star, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300' },
]

const supportedSourceExtensions = ['.md', '.markdown', '.txt']
const NOTE_FILE_DRAG_TYPE = 'application/x-lingmo-file'

function createRatingCounts() {
  return { 0: 0, 1: 0, 2: 0, 3: 0 } satisfies Record<FlashcardReviewRating, number>
}

function getFileName(path?: string | null) {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function isSupportedSourcePath(path: string) {
  const lower = path.toLowerCase()
  return supportedSourceExtensions.some(ext => lower.endsWith(ext))
}

function getPathFromDragValue(value: string) {
  const clean = value.trim()
  if (!clean) return ''

  try {
    const parsed = JSON.parse(clean) as { path?: string; isDirectory?: boolean }
    if (parsed.isDirectory) return ''
    if (parsed.path) return parsed.path
  } catch {
    return clean
  }

  return ''
}

function getDraggedPathFromDataTransfer(dataTransfer: DataTransfer) {
  const preferredTypes = [
    NOTE_FILE_DRAG_TYPE,
    'application/x-note-file',
    'text/plain',
    'text',
  ]

  for (const type of preferredTypes) {
    const value = dataTransfer.getData(type)
    const path = getPathFromDragValue(value)
    if (path) return path
  }

  for (const type of Array.from(dataTransfer.types)) {
    const value = dataTransfer.getData(type)
    const path = getPathFromDragValue(value)
    if (path) return path
  }

  return ''
}

function getRememberedDraggingPath() {
  if (typeof window === 'undefined') return ''
  return (window as unknown as { __lingMoDraggingFilePath?: string }).__lingMoDraggingFilePath || ''
}

function clearRememberedDraggingPath() {
  if (typeof window === 'undefined') return
  delete (window as unknown as { __lingMoDraggingFilePath?: string }).__lingMoDraggingFilePath
}

function parseClozeText(text?: string | null) {
  const source = text || ''
  const answers: string[] = []
  const prompt = source.replace(/\{\{c\d+::(.*?)(?:::([^}]*))?\}\}/g, (_, answer: string, hint?: string) => {
    answers.push(answer)
    return hint?.trim() ? `[${hint.trim()}]` : '____'
  })

  return {
    prompt: prompt || '未填写题目',
    answer: answers.length > 0 ? answers.join(' / ') : '暂无答案内容',
  }
}

function parseChoiceOptions(card: Flashcard | GeneratedDraft) {
  const raw = 'clozeText' in card ? card.clozeText : undefined
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as { choices?: unknown }
    if (Array.isArray(parsed.choices)) {
      return parsed.choices.map(String).filter(Boolean)
    }
  } catch {
    return raw.split('\n').map(item => item.trim()).filter(Boolean)
  }

  return []
}

function parseChoiceMeta(card: Flashcard | GeneratedDraft): { choices: string[]; mode: ChoiceMode; correctIndexes: number[] } {
  const raw = 'clozeText' in card ? card.clozeText : undefined
  const fallbackChoices = parseChoiceOptions(card)
  const answer = 'back' in card ? card.back || '' : ''
  if (!raw) return { choices: fallbackChoices, mode: 'single', correctIndexes: [] }

  try {
    const parsed = JSON.parse(raw) as {
      choices?: unknown
      mode?: unknown
      choiceMode?: unknown
      correctIndexes?: unknown
      correctChoices?: unknown
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices.map(String).filter(Boolean) : fallbackChoices
    const rawMode = parsed.choiceMode || parsed.mode
    const mode: ChoiceMode = rawMode === 'multiple' ? 'multiple' : 'single'
    const correctIndexes = Array.isArray(parsed.correctIndexes)
      ? parsed.correctIndexes
          .map(value => Number(value))
          .filter(value => Number.isInteger(value) && value >= 0 && value < choices.length)
      : Array.isArray(parsed.correctChoices)
        ? parsed.correctChoices
            .map(String)
            .map(value => {
              const upper = value.trim().toUpperCase()
              if (/^[A-E]$/.test(upper)) return upper.charCodeAt(0) - 65
              return choices.findIndex(choice => normalizeAnswerText(choice) === normalizeAnswerText(value))
            })
            .filter(value => value >= 0)
        : getChoiceCorrectIndexes(answer, choices)

    return {
      choices,
      mode: correctIndexes.length > 1 ? 'multiple' : mode,
      correctIndexes: Array.from(new Set(correctIndexes)),
    }
  } catch {
    return { choices: fallbackChoices, mode: 'single', correctIndexes: [] }
  }
}

function getReviewContent(card: Flashcard): ReviewContent {
  if (card.type === 'choice') {
    const choiceMeta = parseChoiceMeta(card)
    return {
      prompt: card.front || '未填写题目',
      answer: card.back || '暂无答案内容',
      promptLabel: choiceMeta.mode === 'multiple' ? '多选题' : '单选题',
      answerLabel: '答案解析',
      choices: choiceMeta.choices,
      choiceMode: choiceMeta.mode,
      correctIndexes: choiceMeta.correctIndexes,
    }
  }

  if (card.type === 'true-false') {
    const choices = ['正确', '错误']
    const correctIndexes = getChoiceCorrectIndexes(card.back || '', choices)
    return {
      prompt: card.front || '未填写判断题',
      answer: card.back || '暂无答案解析',
      promptLabel: '判断题',
      answerLabel: '答案解析',
      choices,
      choiceMode: 'single',
      correctIndexes,
    }
  }

  if (card.type === 'short-answer') {
    return {
      prompt: card.front || '未填写题目',
      answer: card.back || '暂无参考答案',
      promptLabel: '简答题',
      answerLabel: '参考答案',
    }
  }

  if (card.type === 'basic-reversed') {
    return {
      prompt: card.back || card.front || '未填写题目',
      answer: card.front || card.back || '暂无答案内容',
      promptLabel: '反向题面',
      answerLabel: '原始答案',
    }
  }

  if (card.type === 'cloze') {
    const cloze = parseClozeText(card.clozeText)
    return {
      prompt: cloze.prompt,
      answer: cloze.answer,
      promptLabel: '填空题',
      answerLabel: '答案',
    }
  }

  return {
    prompt: card.front || card.clozeText || '未填写题目',
    answer: card.back || '暂无答案内容',
    promptLabel: '问答卡',
    answerLabel: '答案',
  }
}

function getCardPreview(card: Flashcard | GeneratedDraft) {
  if (card.type === 'choice' || card.type === 'short-answer' || card.type === 'true-false' || card.type === 'basic' || card.type === 'basic-reversed') {
    return card.front || card.back || '未填写内容'
  }
  return parseClozeText(card.clozeText).prompt
}

function getDifficultyLevel(ease: number, interval: number): { label: string; tone: 'rose' | 'amber' | 'green' | 'neutral' } {
  if (ease < 1.8 || interval <= 1) return { label: '薄弱', tone: 'rose' }
  if (ease < 2.2 || interval <= 3) return { label: '待巩固', tone: 'amber' }
  if (ease < 2.6 || interval <= 14) return { label: '正常', tone: 'neutral' }
  return { label: '熟练', tone: 'green' }
}

function getCardTypeLabel(type: FlashcardType) {
  if (type === 'choice') return '选择'
  if (type === 'short-answer') return '简答'
  if (type === 'true-false') return '判断'
  if (type === 'basic-reversed') return '双向'
  if (type === 'cloze') return '填空'
  return '问答'
}

function parseTags(tags?: string | null) {
  if (!tags) return []

  try {
    const parsed = JSON.parse(tags) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map(String).map(item => item.trim()).filter(Boolean)
    }
  } catch {
    return tags.split(',').map(item => item.trim()).filter(Boolean)
  }

  return []
}

function serializeTags(tags: string[]) {
  return JSON.stringify(tags.map(item => item.trim()).filter(Boolean))
}

function extractCardText(card: Flashcard) {
  return [
    card.front || '',
    card.back || '',
    card.clozeText || '',
    card.notePath || '',
    parseTags(card.tags).join(' '),
    card.type,
    card.status,
  ].join(' ').toLowerCase()
}

function formatNextReviewTime(timestamp?: number | null) {
  if (!timestamp) return '下次复习时间待计算'

  const diff = timestamp - Date.now()
  if (diff <= 0) return '现在可再次复习'

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟后再次出现`
  if (diff < day) return `${Math.round(diff / hour)} 小时后再次出现`
  if (diff < 7 * day) return `${Math.round(diff / day)} 天后再次出现`

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日再次出现`
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}

function extractJsonArray(input: string) {
  let clean = input.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (match) clean = match[0]
  return clean
}

async function parseGeneratedDraftJson(raw: string) {
  const extracted = extractJsonArray(raw)
  try {
    return JSON.parse(extracted)
  } catch (firstError) {
    const repairPrompt = [
      '下面是一段不合法的 JSON 数组，它应该表示闪卡草稿。',
      '请只返回修复后的严格 JSON 数组，不要解释，不要 Markdown 代码块。',
      '要求：保留原有字段和内容；补齐缺失逗号；修复未转义引号；删除 JSON 不允许的尾随逗号或注释。',
      '如果某个字段内容无法修复，可以将该字段改为空字符串，但不要删除数组元素。',
      '',
      extracted,
    ].join('\n')

    const repaired = extractJsonArray(await fetchAi(repairPrompt))
    try {
      return JSON.parse(repaired)
    } catch {
      throw firstError
    }
  }
}

function normalizeDrafts(input: unknown, limit: number, allowedTypes: GenerateQuestionType[], sources: SourceNote[]): GeneratedDraft[] {
  if (!Array.isArray(input)) return []
  const sourcePaths = new Set(sources.map(source => source.path))
  const difficultyValues = new Set(['basic', 'understanding', 'application', 'confusable'])
  const choiceModeValues = new Set(['single', 'multiple'])

  return input
    .map(item => item as Partial<GeneratedDraft>)
    .filter(Boolean)
    .map((item) => {
      const type = item.type && allowedTypes.includes(item.type) ? item.type : allowedTypes[0] || 'short-answer'
      const choices = Array.isArray(item.choices) ? item.choices.map(String).filter(Boolean) : []
      return {
        type,
        front: item.front || '',
        back: item.back || '',
        clozeText: item.clozeText || '',
        choices,
        choiceMode: item.choiceMode && choiceModeValues.has(item.choiceMode) ? item.choiceMode : item.type === 'choice' && Math.random() < 0.3 ? 'multiple' : 'single',
        correctChoices: Array.isArray(item.correctChoices) ? item.correctChoices.map(String).filter(Boolean).slice(0, 4) : [],
        tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean).slice(0, 4) : [],
        sourcePath: item.sourcePath && sourcePaths.has(item.sourcePath) ? item.sourcePath : sources[0]?.path,
        difficulty: item.difficulty && difficultyValues.has(item.difficulty) ? item.difficulty : undefined,
        sourceSummary: typeof item.sourceSummary === 'string' ? item.sourceSummary.slice(0, 160) : undefined,
        qualityNote: typeof item.qualityNote === 'string' ? item.qualityNote.slice(0, 180) : undefined,
        atomicityIssue: typeof item.atomicityIssue === 'string' ? item.atomicityIssue.slice(0, 160) : undefined,
        duplicateHint: typeof item.duplicateHint === 'string' ? item.duplicateHint.slice(0, 160) : undefined,
        selected: true,
      }
    })
    .filter(draft => {
      if (draft.type === 'cloze') return Boolean(draft.clozeText?.trim())
      if (draft.type === 'choice') return Boolean(draft.front?.trim() && draft.back?.trim() && draft.choices && draft.choices.length >= 2)
      if (draft.type === 'true-false') return Boolean(draft.front?.trim() && draft.back?.trim() && getChoiceCorrectIndexes(draft.back || '', ['正确', '错误']).length > 0)
      return Boolean(draft.front?.trim() && draft.back?.trim())
    })
    .slice(0, limit)
}

function getDraftQuestionText(draft: GeneratedDraft) {
  return draft.type === 'cloze'
    ? parseClozeText(draft.clozeText).prompt
    : draft.front || draft.clozeText || draft.back || ''
}

function getDraftDifficultyLabel(difficulty?: GeneratedDraft['difficulty']) {
  if (difficulty === 'basic') return '基础'
  if (difficulty === 'understanding') return '理解'
  if (difficulty === 'application') return '应用'
  if (difficulty === 'confusable') return '易混淆'
  return '未标注'
}

function getChoiceModeLabel(mode?: ChoiceMode) {
  return mode === 'multiple' ? '多选' : '单选'
}

function enrichDraftQuality(drafts: GeneratedDraft[]) {
  const seen = new Map<string, number>()

  return drafts.map((draft, index) => {
    const questionText = getDraftQuestionText(draft)
    const normalizedQuestion = questionText.toLowerCase().replace(/\s+/g, '').slice(0, 80)
    const duplicateIndex = normalizedQuestion ? seen.get(normalizedQuestion) : undefined
    if (normalizedQuestion && duplicateIndex === undefined) {
      seen.set(normalizedQuestion, index)
    }

    const hasMultipleSignals = /[；;]\s*|以及|同时|分别|列举|比较/.test(questionText)
    const atomicityIssue = draft.atomicityIssue || (hasMultipleSignals ? '题面可能包含多个考点，建议拆成更小的卡片。' : '')
    const duplicateHint = draft.duplicateHint || (duplicateIndex !== undefined ? `可能与第 ${duplicateIndex + 1} 张草稿重复。` : '')
    const qualityNote = draft.qualityNote
      || (atomicityIssue
        ? '保留前建议先拆分，确保一次只考一个知识点。'
        : '题面与答案结构清晰，适合进入复习队列。')

    return {
      ...draft,
      atomicityIssue,
      duplicateHint,
      qualityNote,
      difficulty: draft.difficulty || 'understanding',
    }
  })
}

function getDraftIdentity(draft: GeneratedDraft) {
  const text = draft.type === 'cloze'
    ? parseClozeText(draft.clozeText).prompt
    : draft.front || draft.clozeText || draft.back || ''
  return `${draft.type}:${text.replace(/\s+/g, '').toLowerCase()}`
}

function mergeUniqueDrafts(drafts: GeneratedDraft[], limit: number) {
  const seen = new Set<string>()
  const unique: GeneratedDraft[] = []

  for (const draft of drafts) {
    const key = getDraftIdentity(draft)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(draft)
    if (unique.length >= limit) break
  }

  return unique
}

function normalizeAnswerText(value?: string | null) {
  return (value || '')
    .replace(/\s+/g, '')
    .replace(/[。.,，、:：；;！!？?（）()\[\]【】「」『』"'"'·]/g, '')
    .toLowerCase()
}

/**
 * 多策略选择题判断：
 * 1. 字母标识匹配 (A/A./A、/A:)
 * 2. 归一化文本包含
 * 3. Jaccard 字符集相似度（阈值 0.55）
 * 4. 关键词命中率（阈值 60%）
 */
function isChoiceLikelyCorrect(answer: string, choice: string, index: number): boolean {
  if (!answer || !choice) return false

  const trueFalseMatch = answer.match(/(?:正确答案|参考答案|答案)\s*[:：]\s*(正确|错误)/)
  if (trueFalseMatch) {
    return normalizeAnswerText(trueFalseMatch[1]) === normalizeAnswerText(choice)
  }

  // 策略1: 字母标识匹配
  const letter = String.fromCharCode(65 + index)
  const letterPattern = new RegExp(`(^|[^A-Za-z])${letter}([.、:：\s）)]|$)`, 'i')
  if (letterPattern.test(answer)) return true

  // 检查答案中是否明确包含"正确答案"字段并指向此选项
  const correctAnswerMatch = answer.match(/(?:正确答案|参考答案|答案)\s*[:：]\s*([A-E])/i)
  if (correctAnswerMatch && correctAnswerMatch[1].toUpperCase() === letter) return true

  const normalizedAnswer = normalizeAnswerText(answer)
  const normalizedChoice = normalizeAnswerText(choice)

  if (!normalizedChoice || !normalizedAnswer) return false

  // 策略2: 归一化文本完全包含
  // 对较长选项（>6字符）检查是否被答案包含
  if (normalizedChoice.length > 6 && normalizedAnswer.includes(normalizedChoice)) return true
  // 对较短选项使用前缀匹配（取前半部分，最少4字符）
  const prefixLen = Math.max(4, Math.floor(normalizedChoice.length / 2))
  const choicePrefix = normalizedChoice.slice(0, Math.min(prefixLen, 24))
  if (choicePrefix.length >= 4 && normalizedAnswer.includes(choicePrefix)) {
    // 排除误判：确保前缀不是过于常见的单字
    const uniqueChars = new Set(choicePrefix.split('')).size
    if (uniqueChars >= Math.ceil(choicePrefix.length * 0.4)) return true
  }

  // 策略3: Jaccard 字符集相似度
  const answerChars = new Set(normalizedAnswer)
  const choiceChars = new Set(normalizedChoice)
  let intersection = 0
  for (const ch of choiceChars) {
    if (answerChars.has(ch)) intersection++
  }
  const union = new Set([...answerChars, ...choiceChars]).size
  const jaccard = union > 0 ? intersection / union : 0
  if (jaccard > 0.55 && normalizedChoice.length >= 4) return true

  // 策略4: 关键词命中率 - 将选项拆分为2-3字片段
  if (normalizedChoice.length >= 6) {
    const segments: string[] = []
    for (let i = 0; i < normalizedChoice.length - 1; i += 2) {
      segments.push(normalizedChoice.slice(i, i + 2))
    }
    if (segments.length > 0) {
      const hitRate = segments.filter(seg => normalizedAnswer.includes(seg)).length / segments.length
      if (hitRate >= 0.6) return true
    }
  }

  return false
}

function getChoiceCorrectIndexes(answer: string, choices: string[]) {
  const explicitTrueFalseMatch = answer.match(/(?:正确答案|参考答案|答案)\s*[:：]\s*(正确|错误)/)
  if (explicitTrueFalseMatch?.[1]) {
    const normalizedAnswer = normalizeAnswerText(explicitTrueFalseMatch[1])
    const index = choices.findIndex(choice => normalizeAnswerText(choice) === normalizedAnswer)
    if (index >= 0) return [index]
  }

  const explicitListMatch = answer.match(/(?:正确答案|参考答案|答案)\s*[:：]\s*([A-E](?:\s*[,，、/和及]\s*[A-E])*)/i)
  if (explicitListMatch?.[1]) {
    const indexes = explicitListMatch[1]
      .split(/[\s,，、/和及]+/)
      .map(letter => letter.trim().toUpperCase())
      .map(letter => letter.charCodeAt(0) - 65)
      .filter(index => index >= 0 && index < choices.length)
    if (indexes.length > 0) return Array.from(new Set(indexes))
  }

  const explicitIndexes = Array.from(answer.matchAll(/(?:正确答案|参考答案|答案)\s*[:：]\s*([A-E])/gi))
    .map(match => match[1].toUpperCase().charCodeAt(0) - 65)
    .filter(index => index >= 0 && index < choices.length)

  if (explicitIndexes.length > 0) return Array.from(new Set(explicitIndexes))

  return choices
    .map((choice, choiceIndex) => (isChoiceLikelyCorrect(answer, choice, choiceIndex) ? choiceIndex : -1))
    .filter(index => index >= 0)
}

function getReviewAnswerDisplay(answer: string, isChoiceCard: boolean, choices: string[], correctIndexes: number[] = []) {
  if (!isChoiceCard) return answer

  const explanationMatch = answer.match(/(?:解析|解释|说明)\s*[:：]\s*([\s\S]+)$/)
  const inferredIndexes = correctIndexes.length > 0 ? correctIndexes : getChoiceCorrectIndexes(answer, choices)
  if (inferredIndexes.length === 0) return answer

  const answerItems = inferredIndexes.map(index => ({
    letter: String.fromCharCode(65 + index),
    text: choices[index],
  }))
  const letters = answerItems.map(item => item.letter)
  const isTrueFalse = choices.length === 2
    && normalizeAnswerText(choices[0]) === normalizeAnswerText('正确')
    && normalizeAnswerText(choices[1]) === normalizeAnswerText('错误')
  const choiceText = isTrueFalse
    ? answerItems.map(item => item.text).join('、')
    : answerItems.map(item => `${item.letter}：${item.text}`).join('；')
  const explanation = explanationMatch?.[1]?.trim()
    || answer
      .replace(/^(?:正确答案|参考答案|答案)\s*[:：]\s*(?:[A-E]|正确|错误)?[.、:：\s）)]*/i, '')
      .replace(/^(?:[A-E]\s*[:：]\s*)+/i, '')
      .replace(/^[。.,，、\s]+/, '')
      .trim()

  return [
    isTrueFalse ? `答案：${choiceText}` : `答案 ${letters.join('、')}：${choiceText}`,
    explanation ? `解析：${explanation}` : '',
  ].filter(Boolean).join('\n\n')
}

function draftToCreateInput(draft: GeneratedDraft, deckId: number): CreateFlashcardInput {
  return {
    deckId,
    type: draft.type,
    front: draft.type === 'cloze' ? undefined : draft.front,
    back: draft.type === 'cloze' ? undefined : draft.back,
    clozeText: draft.type === 'choice'
      ? JSON.stringify({
          choices: draft.choices || [],
          choiceMode: draft.choiceMode || 'single',
          correctChoices: draft.correctChoices || [],
        })
      : draft.type === 'cloze'
        ? draft.clozeText
        : undefined,
    tags: draft.tags,
    notePath: draft.sourcePath,
  }
}

const lightweightMd = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})
lightweightMd.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

function SimpleMarkdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(() => {
    if (!content) return ''
    const hasMarkdown = /[*_`~\[\]#>|\-]\S|\S[*_`~]|[.*+][\s]/.test(content) || /\n{2,}/.test(content)
    if (!hasMarkdown) return ''
    return lightweightMd.render(content)
  }, [content])

  if (!html) {
    return <div className={className}>{content}</div>
  }

  return (
    <div
      className={cn(
        className,
        'prose prose-sm prose-neutral max-w-none dark:prose-invert [&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_img]:max-h-64 [&_img]:rounded-lg',
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'dark' | 'amber' | 'green' | 'rose' | 'blue' }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center rounded-md px-2 text-[11px] font-medium',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'dark' && 'bg-foreground text-background',
        tone === 'amber' && 'bg-amber-50 text-amber-600 ring-1 ring-amber-200/50',
        tone === 'green' && 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/50',
        tone === 'rose' && 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/50',
        tone === 'blue' && 'bg-blue-50 text-blue-600 ring-1 ring-blue-200/50',
      )}
    >
      {children}
    </span>
  )
}

function IconButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  active,
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground ring-1 ring-border',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  )
}

function WorkspaceHeader({
  title,
  description,
  onBack,
  action,
}: {
  title: string
  description: string
  onBack: () => void
  action?: ReactNode
}) {
  return (
    <div className="border-b border-border bg-card px-5 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-foreground">{title}</div>
            <div className="truncate text-[12px] text-muted-foreground">{description}</div>
          </div>
        </div>
        {action}
      </div>
    </div>
  )
}

function SourceDropZone({
  dropZoneRef,
  sources,
  sourcePath,
  isDragging,
  showDropIndicator,
  onDrop,
  onDragOver,
  onDragLeave,
  onUseCurrent,
  onRemoveSource,
  onClearSources,
}: {
  dropZoneRef: (node: HTMLDivElement | null) => void
  sources: SourceNote[]
  sourcePath?: string | null
  isDragging: boolean
  showDropIndicator: boolean
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onUseCurrent: () => void
  onRemoveSource: (path: string) => void
  onClearSources: () => void
}) {
  const t = useTranslations('flashcard')
  return (
    <div
      ref={dropZoneRef}
      className={cn(
        'flashcard-panel relative flex min-h-[220px] flex-1 flex-col overflow-hidden p-4 transition-[background-color,border-color,transform] duration-200',
        isDragging ? 'border-primary bg-muted/70' : 'border-border bg-card',
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <FilePlus2 className="size-3.5" />
            </span>
            <span className="whitespace-nowrap">{t('sourceTitle')}</span>
            {showDropIndicator ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors',
                  isDragging
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <MousePointer2 className="size-3" />
                拖到闪卡
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[12px] text-muted-foreground">{t('sourceDesc')}</div>
        </div>
        <div className="flex items-center gap-2">
          {sourcePath ? (
            <Button size="sm" className="h-7 shrink-0 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90" onClick={onUseCurrent}>
              <FileText className="mr-1 size-3" />
              {getFileName(sourcePath)}
            </Button>
          ) : null}
          {sources.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 rounded-md text-[12px] text-muted-foreground" onClick={onClearSources}>
              {t('clear')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {sources.length === 0 ? (
          <div className="flashcard-drop-target flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center">
            <div>
              <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
                <Upload className="size-4" />
              </div>
              <div className="text-[13px] font-medium text-foreground">{t('addSource')}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{t('addSourceDesc')}</div>
            </div>
          </div>
        ) : (
          sources.map(source => (
            <div key={source.id} className="flashcard-source-row flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {source.status === 'loading' ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : source.status === 'error' ? (
                  <CircleAlert className="size-4 shrink-0 text-rose-500" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground/80">{source.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {source.status === 'ready' ? `${source.content.length} 字符` : source.error || '读取中'}
                  </div>
                </div>
              </div>
              <button className="rounded-lg p-1 text-muted-foreground hover:bg-card hover:text-foreground/80 transition" onClick={() => onRemoveSource(source.path)} type="button">
                <X className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function GenerateSettings({
  decks,
  deckId,
  count,
  mode,
  selectedTypes,
  onDeckChange,
  onCountChange,
  onModeChange,
  onToggleType,
}: {
  decks: FlashcardDeckSummary[]
  deckId: string
  count: string
  mode: GenerateMode
  selectedTypes: GenerateQuestionType[]
  onDeckChange: (value: string) => void
  onCountChange: (value: string) => void
  onModeChange: (mode: GenerateMode) => void
  onToggleType: (type: GenerateQuestionType) => void
}) {
  const activeMode = modeOptions.find(item => item.value === mode)
  const normalizedCount = Math.min(30, Math.max(1, Number(count) || 8))

  function stepCount(direction: 1 | -1) {
    const next = Math.min(30, Math.max(1, normalizedCount + direction * 2))
    onCountChange(String(next))
  }

  return (
    <div className="flashcard-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-foreground">生成配置</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{activeMode?.hint || '选择生成策略'}</div>
        </div>
        <Badge tone="dark">{selectedTypes.length} 类题</Badge>
      </div>
      <div className="mt-3 space-y-3">
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground">模式</div>
          <div className="grid grid-cols-3 rounded-md bg-muted p-1">
            {modeOptions.map(item => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  'rounded-md px-2 py-2 text-center text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98]',
                  mode === item.value ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onModeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground">题型</div>
          <div className="flex flex-wrap gap-2">
            {questionTypeOptions.map(item => {
              const active = selectedTypes.includes(item.value)
              return (
                <button
                  key={item.value}
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center rounded-md border px-3 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98]',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground border-border',
                  )}
                  onClick={() => onToggleType(item.value)}
                >
                  {active ? <Check className="mr-1.5 size-3.5" /> : null}
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_82px] gap-2">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">保存到</div>
            <Select value={deckId} onValueChange={onDeckChange}>
              <SelectTrigger className="h-9 rounded-md bg-background">
                <SelectValue placeholder="选择牌组" />
              </SelectTrigger>
              <SelectContent>
                {decks.map(deck => (
                  <SelectItem key={deck.id} value={String(deck.id)}>
                    {deck.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">数量</div>
            <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background">
              <Input
                className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-center shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                inputMode="numeric"
                value={count}
                onChange={(event) => onCountChange(event.target.value)}
              />
              <div className="flex w-7 shrink-0 flex-col border-l border-border/70">
                <button
                  type="button"
                  className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground active:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={() => stepCount(1)}
                  disabled={normalizedCount >= 30}
                  aria-label="数量增加 2"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="flex min-h-0 flex-1 items-center justify-center border-t border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground active:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={() => stepCount(-1)}
                  disabled={normalizedCount <= 1}
                  aria-label="数量减少 2"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

function DraftList({
  drafts,
  saving,
  onToggleDraft,
  onRemoveDraft,
  onSave,
}: {
  drafts: GeneratedDraft[]
  saving: boolean
  onToggleDraft: (index: number) => void
  onRemoveDraft: (index: number) => void
  onSave: () => void
}) {
  const selectedCount = drafts.filter(draft => draft.selected).length

  return (
    <div className="flashcard-panel flex min-h-[320px] flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold text-foreground">卡片草稿</div>
          <div className="text-[11px] text-muted-foreground">{drafts.length === 0 ? '生成后在这里筛选、删除和保存。' : `${selectedCount}/${drafts.length} 张准备保存`}</div>
        </div>
        <Button size="sm" className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90" onClick={onSave} disabled={selectedCount === 0 || saving}>
          {saving ? '保存中...' : '保存选中'}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
        {drafts.length === 0 ? (
          <div className="flashcard-drop-target flex min-h-36 flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center">
            <div>
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <WalletCards className="size-5" />
              </div>
              <div className="mt-3 text-[13px] font-medium text-foreground/70">等待生成卡片</div>
              <div className="mt-1 text-[11px] text-muted-foreground">拖入笔记后点击生成，可先筛选再保存。</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {drafts.map((draft, index) => (
              <div key={`${draft.type}-${index}`} className={cn('flashcard-draft-item p-3 transition', draft.selected ? 'opacity-100' : 'opacity-55')}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => onToggleDraft(index)}>
                    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition', draft.selected && 'border-primary bg-primary text-primary-foreground')}>
                      {draft.selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="dark">{getCardTypeLabel(draft.type)}</Badge>
                        {draft.type === 'choice' ? <Badge tone="neutral">{getChoiceModeLabel(draft.choiceMode)}</Badge> : null}
                        <Badge tone={draft.difficulty === 'confusable' ? 'amber' : 'neutral'}>{getDraftDifficultyLabel(draft.difficulty)}</Badge>
                        {draft.tags?.slice(0, 3).map(tag => <Badge key={tag}>{tag}</Badge>)}
                      </span>
                      <span className="mt-2 block line-clamp-2 text-[13px] font-medium leading-6 text-foreground">{getCardPreview(draft)}</span>
                      {draft.type === 'choice' && draft.choices && draft.choices.length > 0 ? (
                        <span className="mt-1.5 block text-[11px] text-muted-foreground">{draft.choices.join(' / ')}</span>
                      ) : null}
                      <span className="mt-2 block rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                        {draft.qualityNote}
                        {draft.atomicityIssue ? <span className="mt-1 block text-amber-600">{draft.atomicityIssue}</span> : null}
                        {draft.duplicateHint ? <span className="mt-1 block text-rose-600">{draft.duplicateHint}</span> : null}
                        {draft.sourceSummary ? <span className="mt-1 block">来源：{draft.sourceSummary}</span> : null}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground/80 transition" onClick={() => onRemoveDraft(index)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DeckQueue({
  decks,
  dueCount,
  stats,
  loading,
  onReviewAll,
  onReviewDeck,
  onManageDecks,
  onWeakCards,
}: {
  decks: FlashcardDeckSummary[]
  dueCount: number
  stats: FlashcardLearningStats
  loading: boolean
  onReviewAll: () => void
  onReviewDeck: (deckId: number) => void
  onManageDecks: () => void
  onWeakCards: () => void
}) {
  const t = useTranslations('flashcard')
  return (
    <div className="flashcard-panel overflow-hidden">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-foreground">复习队列</div>
            <div className="text-[11px] text-muted-foreground">{loading ? '读取中...' : `${dueCount} 待复习 · ${stats.weakCount} 薄弱 · ${stats.todayReviewedCount} 今日完成`}</div>
          </div>
          <Button size="sm" className="h-7 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90" onClick={onReviewAll} disabled={dueCount === 0}>{t('review')}</Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <button type="button" className="rounded-md bg-muted/55 px-2 py-2 text-left" onClick={onReviewAll}>
            <div className="text-[10px] text-muted-foreground">待复习</div>
            <div className="mt-0.5 text-base font-semibold text-foreground">{loading ? '--' : dueCount}</div>
          </button>
          <button type="button" className="rounded-md bg-muted/55 px-2 py-2 text-left" onClick={onWeakCards}>
            <div className="text-[10px] text-muted-foreground">薄弱</div>
            <div className="mt-0.5 text-base font-semibold text-foreground">{loading ? '--' : stats.weakCount}</div>
          </button>
          <button type="button" className="rounded-md bg-muted/55 px-2 py-2 text-left" onClick={onManageDecks}>
            <div className="text-[10px] text-muted-foreground">今日</div>
            <div className="mt-0.5 text-base font-semibold text-foreground">{loading ? '--' : stats.todayReviewedCount}</div>
          </button>
        </div>
      </div>
      <div className="max-h-[250px] overflow-auto p-2">
        {decks.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-lg bg-muted/30 p-4 text-center">
            <div>
              <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Layers3 className="size-5" />
              </div>
              <div className="mt-2 text-[13px] font-medium text-foreground/70">还没有牌组</div>
              <div className="mt-1 text-[11px] text-muted-foreground">创建你的第一个牌组开始学习吧。</div>
            </div>
          </div>
        ) : (
          decks.map(deck => {
            const cardCount = Number(deck.cardCount || 0)
            const deckDueCount = Number(deck.dueCount || 0)
            return (
              <button
                key={deck.id}
                type="button"
                className="flashcard-deck-row flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-[background-color,transform] duration-150 hover:bg-muted/65 active:scale-[0.99]"
                onClick={() => onReviewDeck(deck.id)}
                disabled={cardCount === 0}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">{deck.name}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{cardCount} 卡 · {deckDueCount} 待复习</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-border" />
              </button>
            )
          })
        )}
      </div>
      <div className="border-t border-border/50 p-2">
        <Button variant="ghost" size="sm" className="h-8 w-full justify-start rounded-md text-[12px] text-muted-foreground hover:text-foreground" onClick={onManageDecks}>
          <Layers3 className="mr-2 size-3.5" />
          {t('manageDecks')}
        </Button>
      </div>
    </div>
  )
}

function FlashcardHome({
  dropZoneRef,
  pointerDragPreview,
  decks,
  dueCount,
  stats,
  loading,
  sourcePath,
  sources,
  drafts,
  deckId,
  count,
  mode,
  selectedTypes,
  generating,
  saving,
  isDragging,
  onDrop,
  onDragOver,
  onDragLeave,
  onUseCurrent,
  onRemoveSource,
  onClearSources,
  onDeckChange,
  onCountChange,
  onModeChange,
  onToggleType,
  onGenerate,
  onToggleDraft,
  onRemoveDraft,
  onSaveDrafts,
  onCreateCard,
  onReviewAll,
  onReviewDeck,
  onLibrary,
  onManageDecks,
  onWeakCards,
  onStats,
}: {
  dropZoneRef: (node: HTMLDivElement | null) => void
  pointerDragPreview: { name: string; x: number; y: number; overDropZone: boolean } | null
  decks: FlashcardDeckSummary[]
  dueCount: number
  stats: FlashcardLearningStats
  loading: boolean
  sourcePath?: string | null
  sources: SourceNote[]
  drafts: GeneratedDraft[]
  deckId: string
  count: string
  mode: GenerateMode
  selectedTypes: GenerateQuestionType[]
  generating: boolean
  saving: boolean
  isDragging: boolean
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onUseCurrent: () => void
  onRemoveSource: (path: string) => void
  onClearSources: () => void
  onDeckChange: (value: string) => void
  onCountChange: (value: string) => void
  onModeChange: (mode: GenerateMode) => void
  onToggleType: (type: GenerateQuestionType) => void
  onGenerate: () => void
  onToggleDraft: (index: number) => void
  onRemoveDraft: (index: number) => void
  onSaveDrafts: () => void
  onCreateCard: () => void
  onReviewAll: () => void
  onReviewDeck: (deckId: number) => void
  onLibrary: () => void
  onManageDecks: () => void
  onWeakCards: () => void
  onStats: () => void
}) {
  const readySourceCount = sources.filter(source => source.status === 'ready').length
  const canGenerate = readySourceCount > 0 && selectedTypes.length > 0 && Boolean(deckId)
  const t = useTranslations('flashcard')
  const tReview = useTranslations('flashcard.reviewPanel')
  const activeMode = modeOptions.find(item => item.value === mode)

  return (
    <div
      className="flashcard-shell flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {pointerDragPreview ? (
        <div
          className={cn(
            'pointer-events-none fixed left-0 top-0 z-50 flex max-w-[260px] items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border transition-colors',
            pointerDragPreview.overDropZone ? 'border-primary' : 'border-border',
          )}
          style={{ transform: `translate3d(${pointerDragPreview.x + 6}px, ${pointerDragPreview.y + 6}px, 0)` }}
        >
          <FileText className="size-4 shrink-0" />
          <span className="truncate">{pointerDragPreview.name}</span>
        </div>
      ) : null}
      <div className="border-b border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <WalletCards className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold text-foreground">{t('workspaceTitle')}</div>
              <div className="truncate text-[12px] text-muted-foreground">{readySourceCount > 0 ? `${readySourceCount} 篇材料就绪 · ${activeMode?.label || '生成配置'}` : t('workspaceDesc')}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground sm:flex">
              <BookOpenCheck className="size-3" />
              {loading ? '--' : dueCount} {tReview('dueCount')}
            </div>
            <div className="hidden items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground sm:flex">
              <Target className="size-3" />
              {loading ? '--' : stats.weakCount} {tReview('weakCount')}
            </div>
            <div className="hidden items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground md:flex">
              <CheckCircle2 className="size-3" />
              {loading ? '--' : stats.todayReviewedCount} {tReview('todayDone')}
            </div>
            <Button
              className="h-8 gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
              onClick={onGenerate}
              disabled={!canGenerate || generating}
            >
              {generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {generating ? t('generating') : t('generate')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-5 py-2">
          <IconButton icon={Plus} onClick={onCreateCard}>{t('create')}</IconButton>
          <IconButton icon={WalletCards} onClick={onLibrary}>闪卡库</IconButton>
          <IconButton icon={Target} onClick={onWeakCards}>{t('weakCards')}</IconButton>
          <IconButton icon={BarChart3} onClick={onStats}>{t('stats')}</IconButton>
          <IconButton icon={Layers3} onClick={onManageDecks}>{t('manageDecks')}</IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid max-w-7xl items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 flex-col gap-4">
            <SourceDropZone
              dropZoneRef={dropZoneRef}
              sources={sources}
              sourcePath={sourcePath}
              isDragging={isDragging}
              showDropIndicator={!!pointerDragPreview}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onUseCurrent={onUseCurrent}
              onRemoveSource={onRemoveSource}
              onClearSources={onClearSources}
            />
            <DraftList
              drafts={drafts}
              saving={saving}
              onToggleDraft={onToggleDraft}
              onRemoveDraft={onRemoveDraft}
              onSave={onSaveDrafts}
            />
          </div>
          <aside className="flex h-full flex-col gap-4 xl:sticky xl:top-4">
            <GenerateSettings
              decks={decks}
              deckId={deckId}
              count={count}
              mode={mode}
              selectedTypes={selectedTypes}
              onDeckChange={onDeckChange}
              onCountChange={onCountChange}
              onModeChange={onModeChange}
              onToggleType={onToggleType}
            />
            <DeckQueue
              decks={decks}
              dueCount={dueCount}
              stats={stats}
              loading={loading}
              onReviewAll={onReviewAll}
              onReviewDeck={onReviewDeck}
              onManageDecks={onManageDecks}
              onWeakCards={onWeakCards}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}

function FlashcardDeckManager({
  decks,
  onBack,
  onRefresh,
  onReviewDeck,
}: {
  decks: FlashcardDeckSummary[]
  onBack: () => void
  onRefresh: () => Promise<void>
  onReviewDeck: (deckId: number) => void
}) {
  const [creating, setCreating] = useState(false)
  const [newDeckName, setNewDeckName] = useState('')
  const [newDeckDescription, setNewDeckDescription] = useState('')
  const [expandedDeckId, setExpandedDeckId] = useState<number | null>(null)
  const [cardsByDeckId, setCardsByDeckId] = useState<Record<number, Flashcard[]>>({})
  const [editingDeckId, setEditingDeckId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Flashcard['status']>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [selectedCardIds, setSelectedCardIds] = useState<Record<number, Set<number>>>({})

  const loadDeckCards = useCallback(async (targetDeckId: number) => {
    const cards = await getFlashcardsByDeckId(targetDeckId)
    setCardsByDeckId(prev => ({ ...prev, [targetDeckId]: cards }))
  }, [])

  async function handleCreateDeck() {
    const name = newDeckName.trim()
    if (!name) {
      toast({ title: '请输入牌组名称' })
      return
    }

    setCreating(true)
    try {
      await createFlashcardDeck({ name, description: newDeckDescription.trim() || undefined })
      setNewDeckName('')
      setNewDeckDescription('')
      await onRefresh()
      toast({ title: '牌组已创建' })
    } catch (error) {
      toast({
        title: '创建牌组失败',
        description: error instanceof Error ? error.message : '请检查名称是否重复。',
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveDeck(targetDeckId: number) {
    const name = editName.trim()
    if (!name) {
      toast({ title: '牌组名称不能为空' })
      return
    }

    await updateFlashcardDeck(targetDeckId, { name, description: editDescription.trim() || null })
    setEditingDeckId(null)
    await onRefresh()
  }

  async function handleDeleteDeck(deck: FlashcardDeckSummary) {
    try {
      await deleteFlashcardDeck(deck.id)
      await onRefresh()
    } catch (error) {
      toast({
        title: '删除牌组失败',
        description: error instanceof Error ? error.message : '请先移动或删除卡片。',
        variant: 'destructive',
      })
    }
  }

  async function handleMoveCard(card: Flashcard, targetDeckId: number) {
    if (card.deckId === targetDeckId) return
    await moveFlashcardToDeck(card.id, targetDeckId)
    await Promise.all([onRefresh(), loadDeckCards(card.deckId), loadDeckCards(targetDeckId)])
  }

  async function handleDeleteCard(targetDeckId: number, cardId: number) {
    await deleteFlashcard(cardId)
    await Promise.all([onRefresh(), loadDeckCards(targetDeckId)])
    setSelectedCardIds(prev => {
      const next = new Set(prev[targetDeckId] || [])
      next.delete(cardId)
      return { ...prev, [targetDeckId]: next }
    })
  }

  function getFilteredCards(cards: Flashcard[]) {
    const query = searchQuery.trim().toLowerCase()
    const tags = tagFilter.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean)

    return cards.filter(card => {
      if (statusFilter !== 'all' && card.status !== statusFilter) return false
      if (query && !extractCardText(card).includes(query)) return false
      if (tags.length > 0) {
        const cardTags = parseTags(card.tags).map(tag => tag.toLowerCase())
        if (!tags.some(tag => cardTags.includes(tag))) return false
      }
      return true
    })
  }

  function toggleCardSelected(deckId: number, cardId: number) {
    setSelectedCardIds(prev => {
      const next = new Set(prev[deckId] || [])
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return { ...prev, [deckId]: next }
    })
  }

  function clearSelectedCards(deckId: number) {
    setSelectedCardIds(prev => ({ ...prev, [deckId]: new Set() }))
  }

  async function handleBatchMove(deckId: number, targetDeckId: number, cardIds: number[]) {
    if (cardIds.length === 0 || deckId === targetDeckId) return
    for (const cardId of cardIds) {
      await moveFlashcardToDeck(cardId, targetDeckId)
    }
    clearSelectedCards(deckId)
    await Promise.all([onRefresh(), loadDeckCards(deckId), loadDeckCards(targetDeckId)])
  }

  async function handleBatchStatus(deckId: number, cardIds: number[], status: Flashcard['status']) {
    if (cardIds.length === 0) return
    for (const cardId of cardIds) {
      await updateFlashcardStatus(cardId, status)
    }
    clearSelectedCards(deckId)
    await Promise.all([onRefresh(), loadDeckCards(deckId)])
  }

  async function handleBatchReset(deckId: number, cardIds: number[]) {
    if (cardIds.length === 0) return
    for (const cardId of cardIds) {
      await resetFlashcardProgress(cardId)
    }
    clearSelectedCards(deckId)
    await Promise.all([onRefresh(), loadDeckCards(deckId)])
  }

  async function handleBatchDelete(deckId: number, cardIds: number[]) {
    if (cardIds.length === 0) return
    for (const cardId of cardIds) {
      await deleteFlashcard(cardId)
    }
    clearSelectedCards(deckId)
    await Promise.all([onRefresh(), loadDeckCards(deckId)])
  }

  useEffect(() => {
    setSelectedCardIds(prev => {
      const next: Record<number, Set<number>> = {}
      let changed = false
      for (const deck of decks) {
        const selected = prev[deck.id]
        if (selected) {
          next[deck.id] = selected
        }
      }
      const prevKeys = Object.keys(prev)
      if (prevKeys.length !== Object.keys(next).length) changed = true
      for (const key of prevKeys) {
        if (!next[Number(key)]) {
          changed = true
          break
        }
      }
      return changed ? next : prev
    })
  }, [decks])

  async function handleExport(format: 'csv' | 'anki') {
    try {
      const allCards: Flashcard[] = []
      for (const deck of decks) {
        const cards = await getFlashcardsByDeckId(deck.id)
        allCards.push(...cards)
      }
      if (allCards.length === 0) {
        toast({ title: '没有可导出的卡片' })
        return
      }
      const result = await exportFlashcardFile(allCards, format)
      if (result.success) {
        toast({ title: `已导出 ${allCards.length} 张卡片` })
      }
    } catch (error) {
      toast({ title: '导出失败', description: error instanceof Error ? error.message : '', variant: 'destructive' })
    }
  }

  async function handleImport(format: 'csv' | 'anki') {
    try {
      const result = await importFlashcardFile(format)
      if (!result.success || result.inputs.length === 0) return

      // Import to default deck or first deck
      const targetDeck = decks[0]
      if (!targetDeck) {
        toast({ title: '请先创建一个牌组', variant: 'destructive' })
        return
      }

      const inputs = result.inputs.map(input => ({ ...input, deckId: targetDeck.id }))
      await createFlashcardsBatch(inputs)
      await onRefresh()
      toast({ title: `已导入 ${inputs.length} 张卡片到「${targetDeck.name}」` })
    } catch (error) {
      toast({ title: '导入失败', description: error instanceof Error ? error.message : '', variant: 'destructive' })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      <WorkspaceHeader title="牌组管理" description="整理卡片、移动牌组、清理无效题目。" onBack={onBack} />
      <div className="mx-auto w-full max-w-6xl flex-1 overflow-auto p-4">
        <div className="flashcard-panel mb-4 grid gap-2 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input value={newDeckName} onChange={(event) => setNewDeckName(event.target.value)} placeholder="牌组名称" className="h-9 rounded-md text-[13px]" />
          <Input value={newDeckDescription} onChange={(event) => setNewDeckDescription(event.target.value)} placeholder="描述，可选" className="h-9 rounded-md text-[13px]" />
          <Button className="h-9 rounded-md bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90" onClick={() => void handleCreateDeck()} disabled={creating}>{creating ? '创建中...' : '创建牌组'}</Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 rounded-lg border border-border bg-card/70 p-2">
          <Button variant="outline" size="sm" className="h-7 rounded-md gap-1.5 text-[12px]" onClick={() => void handleImport('csv')}>
            <Upload className="size-3" /> 导入 CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 rounded-md gap-1.5 text-[12px]" onClick={() => void handleImport('anki')}>
            <Upload className="size-3" /> 导入 Anki
          </Button>
          <Button variant="outline" size="sm" className="h-7 rounded-md gap-1.5 text-[12px]" onClick={() => void handleExport('csv')}>
            <Download className="size-3" /> 导出 CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 rounded-md gap-1.5 text-[12px]" onClick={() => void handleExport('anki')}>
            <Download className="size-3" /> 导出 Anki
          </Button>
        </div>

        <div className="space-y-3">
          {decks.map(deck => {
            const isExpanded = expandedDeckId === deck.id
            const isEditing = editingDeckId === deck.id
            const cards = cardsByDeckId[deck.id] || []
            const filteredCards = getFilteredCards(cards)
            const selectedIds = selectedCardIds[deck.id] || new Set<number>()
            const selectedVisibleIds = filteredCards.filter(card => selectedIds.has(card.id)).map(card => card.id)
            const selectedCount = selectedIds.size
            return (
              <div key={deck.id} className="flashcard-panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                  {isEditing ? (
                    <div className="grid w-full gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                      <Input value={editName} onChange={(event) => setEditName(event.target.value)} className="h-9 rounded-md text-[13px]" />
                      <Input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="h-9 rounded-md text-[13px]" />
                      <Button className="h-9 rounded-md bg-primary text-[13px] text-primary-foreground" onClick={() => void handleSaveDeck(deck.id)}>保存</Button>
                      <Button variant="outline" className="h-9 rounded-md text-[13px]" onClick={() => setEditingDeckId(null)}>取消</Button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2.5 text-left"
                        onClick={() => {
                          const nextOpen = !isExpanded
                          setExpandedDeckId(nextOpen ? deck.id : null)
                          if (nextOpen) void loadDeckCards(deck.id)
                        }}
                      >
                        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-foreground">{deck.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{Number(deck.cardCount || 0)} 卡 · {Number(deck.dueCount || 0)} 待复习</span>
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" className="h-7 rounded-md text-[12px]" onClick={() => onReviewDeck(deck.id)}>复习</Button>
                        <Button variant="ghost" size="sm" className="h-7 rounded-md text-[12px] text-muted-foreground" onClick={() => {
                          setEditingDeckId(deck.id)
                          setEditName(deck.name)
                          setEditDescription(deck.description || '')
                        }}>编辑</Button>
                        <button
                          type="button"
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-rose-50 hover:text-rose-500"
                          onClick={() => void handleDeleteDeck(deck)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {isExpanded ? (
                  <div className="border-t border-border/50 p-2">
                    <div className="mb-2 grid gap-2 rounded-lg bg-muted/30 p-2 lg:grid-cols-[minmax(0,1fr)_140px_minmax(140px,180px)]">
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="搜索题面、答案、标签或来源"
                        className="h-8 rounded-md bg-card text-[12px]"
                      />
                      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                        <SelectTrigger className="h-8 rounded-md bg-card text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部状态</SelectItem>
                          <SelectItem value="new">新卡</SelectItem>
                          <SelectItem value="learning">学习中</SelectItem>
                          <SelectItem value="review">复习中</SelectItem>
                          <SelectItem value="suspended">已暂停</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={tagFilter}
                        onChange={(event) => setTagFilter(event.target.value)}
                        placeholder="标签，逗号分隔"
                        className="h-8 rounded-md bg-card text-[12px]"
                      />
                    </div>
                    {cards.length > 0 ? (
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
                            onClick={() => {
                              const allVisibleSelected = filteredCards.length > 0 && selectedVisibleIds.length === filteredCards.length
                              setSelectedCardIds(prev => {
                                const next = new Set(prev[deck.id] || [])
                                for (const card of filteredCards) {
                                  if (allVisibleSelected) next.delete(card.id)
                                  else next.add(card.id)
                                }
                                return { ...prev, [deck.id]: next }
                              })
                            }}
                          >
                            {filteredCards.length > 0 && selectedVisibleIds.length === filteredCards.length ? '取消当前结果' : '选择当前结果'}
                          </button>
                          <span className="text-[11px] text-muted-foreground">
                            显示 {filteredCards.length}/{cards.length} 张 · 已选 {selectedCount} 张
                          </span>
                        </div>
                        {selectedCount > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Select onValueChange={(value) => void handleBatchMove(deck.id, Number(value), Array.from(selectedIds))}>
                              <SelectTrigger className="h-7 w-28 rounded-md text-[11px]"><SelectValue placeholder="移动到" /></SelectTrigger>
                              <SelectContent>
                                {decks.filter(item => item.id !== deck.id).map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button variant="outline" size="sm" className="h-7 rounded-md text-[11px]" onClick={() => void handleBatchStatus(deck.id, Array.from(selectedIds), 'suspended')}>暂停</Button>
                            <Button variant="outline" size="sm" className="h-7 rounded-md text-[11px]" onClick={() => void handleBatchStatus(deck.id, Array.from(selectedIds), 'review')}>恢复</Button>
                            <Button variant="outline" size="sm" className="h-7 rounded-md text-[11px]" onClick={() => void handleBatchReset(deck.id, Array.from(selectedIds))}>重置</Button>
                            <Button variant="ghost" size="sm" className="h-7 rounded-md text-[11px] text-rose-500 hover:bg-rose-50" onClick={() => void handleBatchDelete(deck.id, Array.from(selectedIds))}>删除</Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {cards.length === 0 ? (
                      <div className="rounded-lg bg-muted/30 p-3 text-[13px] text-muted-foreground">这个牌组暂无卡片。</div>
                    ) : filteredCards.length === 0 ? (
                      <div className="rounded-lg bg-muted/30 p-3 text-[13px] text-muted-foreground">没有符合筛选条件的卡片。</div>
                    ) : (
                      filteredCards.map(card => (
                        <div key={card.id} className="flashcard-library-row flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2.5">
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            <button
                              type="button"
                              className={cn(
                                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition',
                                selectedIds.has(card.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-transparent hover:text-muted-foreground',
                              )}
                              onClick={() => toggleCardSelected(deck.id, card.id)}
                              aria-label={selectedIds.has(card.id) ? '取消选择卡片' : '选择卡片'}
                            >
                              <Check className="size-3" />
                            </button>
                            <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Badge>{getCardTypeLabel(card.type)}</Badge>
                              {card.status === 'suspended' ? <Badge tone="neutral">暂停</Badge> : null}
                              <span className="truncate text-[13px] font-medium text-foreground/80">{getCardPreview(card)}</span>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                              {card.notePath ? <span className="text-primary/60">{getFileName(card.notePath)}</span> : ''}
                              {card.notePath && parseTags(card.tags).length > 0 ? ' · ' : ''}
                              {parseTags(card.tags).join(' / ') || ''}
                            </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select value={String(card.deckId)} onValueChange={(value) => void handleMoveCard(card, Number(value))}>
                              <SelectTrigger className="h-7 w-28 rounded-md text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {decks.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-rose-50 hover:text-rose-500"
                              onClick={() => void handleDeleteCard(deck.id, card.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeakCardsPanel({ onBack, onReviewWeak }: { onBack: () => void; onReviewWeak: () => void }) {
  const [cards, setCards] = useState<Flashcard[]>([])
  const [loading, setLoading] = useState(true)
  const importantCount = cards.filter(card => parseTags(card.tags).includes('重点')).length

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCards(await getWeakFlashcards(100))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      <WorkspaceHeader
        title="错题与重点"
        description="不会、困难和标记重点的卡片会在这里集中管理。"
        onBack={onBack}
        action={<Button size="sm" className="h-8 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90" onClick={onReviewWeak} disabled={cards.length === 0}>复习错题</Button>}
      />
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flashcard-panel p-4 text-[13px] text-muted-foreground">正在整理错题...</div>
        ) : cards.length === 0 ? (
          <div className="flashcard-panel flex min-h-48 items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <BookOpenCheck className="size-7" />
              </div>
              <div className="mt-4 text-base font-semibold text-foreground">暂无错题</div>
              <div className="mt-2 text-[13px] text-muted-foreground">复习时点击“不会”的卡片会自动进入这里，方便你集中巩固薄弱知识点。</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flashcard-panel grid gap-2 p-3 sm:grid-cols-3">
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">薄弱卡片</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{cards.length}</div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">重点标记</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{importantCount}</div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">建议动作</div>
                <div className="mt-1 text-[13px] font-medium text-foreground">先复习错题</div>
              </div>
            </div>
            <div className="flashcard-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-foreground">错题清单</div>
                  <div className="text-[11px] text-muted-foreground">按最近薄弱记录排序，适合短时间集中回收。</div>
                </div>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[12px]" onClick={() => void refresh()}>刷新</Button>
              </div>
              <div className="divide-y divide-border/50">
                {cards.map(card => (
                  <div key={card.id} className="flashcard-library-row px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="rose">薄弱</Badge>
                      <Badge>{getCardTypeLabel(card.type)}</Badge>
                      {parseTags(card.tags).slice(0, 3).map(tag => <Badge key={tag}>{tag}</Badge>)}
                    </div>
                    <div className="mt-2 text-[13px] font-medium leading-6 text-foreground">{getCardPreview(card)}</div>
                    {card.notePath && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <FileText className="size-3" />
                        <span className="truncate">{getFileName(card.notePath)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FlashcardLibraryPanel({
  decks,
  onBack,
  onRefresh,
}: {
  decks: FlashcardDeckSummary[]
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [deckFilter, setDeckFilter] = useState('all')
  const [statusFilters, setStatusFilters] = useState<Flashcard['status'][]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [specialFilters, setSpecialFilters] = useState<Array<'due' | 'overdue' | 'weak' | 'important'>>([])
  const [cards, setCards] = useState<Flashcard[]>([])
  const [total, setTotal] = useState(0)
  const [tagStats, setTagStats] = useState<FlashcardTagStat[]>([])
  const [history, setHistory] = useState<FlashcardSearchHistoryItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [tagEditValue, setTagEditValue] = useState('')
  const [loading, setLoading] = useState(true)

  const selectedDeckId = deckFilter === 'all' ? null : Number(deckFilter)
  const selectedCount = selectedIds.size
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds])

  const loadLibrary = useCallback(async (persistHistory = false) => {
    setLoading(true)
    try {
      const filters = {
        query,
        deckId: selectedDeckId,
        statuses: statusFilters,
        tags: selectedTags,
        dueOnly: specialFilters.includes('due'),
        overdueOnly: specialFilters.includes('overdue'),
        weakOnly: specialFilters.includes('weak'),
        importantOnly: specialFilters.includes('important'),
        limit: 120,
      }
      const [result, tags, searches] = await Promise.all([
        searchFlashcards(filters),
        getFlashcardTagStats(60),
        getFlashcardSearchHistory(),
      ])
      setCards(result.cards)
      setTotal(result.total)
      setTagStats(tags)
      setHistory(searches)
      setSelectedIds(prev => new Set(result.cards.filter(card => prev.has(card.id)).map(card => card.id)))

      if (persistHistory && query.trim()) {
        await saveFlashcardSearchHistory(query, {
          deckId: selectedDeckId,
          statuses: statusFilters,
          tags: selectedTags,
          special: specialFilters,
        })
        setHistory(await getFlashcardSearchHistory())
      }
    } finally {
      setLoading(false)
    }
  }, [query, selectedDeckId, selectedTags, specialFilters, statusFilters])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary(false)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [loadLibrary])

  function toggleStatus(status: Flashcard['status']) {
    setStatusFilters(prev => prev.includes(status) ? prev.filter(item => item !== status) : [...prev, status])
  }

  function toggleTag(tag: string) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag])
  }

  function toggleSpecial(filter: 'due' | 'overdue' | 'weak' | 'important') {
    setSpecialFilters(prev => prev.includes(filter) ? prev.filter(item => item !== filter) : [...prev, filter])
  }

  function toggleSelected(cardId: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  async function runBatch(action: () => Promise<void>, message: string) {
    if (selectedIdList.length === 0) return
    await action()
    setSelectedIds(new Set())
    await Promise.all([loadLibrary(false), onRefresh()])
    toast({ title: message })
  }

  async function handleBatchMove(targetDeckId: number) {
    await runBatch(async () => {
      for (const cardId of selectedIdList) {
        await moveFlashcardToDeck(cardId, targetDeckId)
      }
    }, `已移动 ${selectedIdList.length} 张卡片`)
  }

  async function handleBatchStatus(status: Flashcard['status']) {
    await runBatch(async () => {
      for (const cardId of selectedIdList) {
        await updateFlashcardStatus(cardId, status)
      }
    }, status === 'suspended' ? '已暂停所选卡片' : '已恢复所选卡片')
  }

  async function handleBatchReset() {
    await runBatch(async () => {
      for (const cardId of selectedIdList) {
        await resetFlashcardProgress(cardId)
      }
    }, '已重置所选卡片进度')
  }

  async function handleBatchDelete() {
    await runBatch(async () => {
      for (const cardId of selectedIdList) {
        await deleteFlashcard(cardId)
      }
    }, '已删除所选卡片')
  }

  async function handleBatchAddTags() {
    const tags = tagEditValue.split(',').map(item => item.trim()).filter(Boolean)
    if (tags.length === 0) return
    await runBatch(async () => {
      await addFlashcardTagsBulk(selectedIdList, tags)
    }, '已添加标签')
    setTagEditValue('')
  }

  async function handleBatchRemoveTags() {
    const tags = tagEditValue.split(',').map(item => item.trim()).filter(Boolean)
    if (tags.length === 0) return
    await runBatch(async () => {
      await removeFlashcardTagsBulk(selectedIdList, tags)
    }, '已移除标签')
    setTagEditValue('')
  }

  const allVisibleSelected = cards.length > 0 && cards.every(card => selectedIds.has(card.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      <WorkspaceHeader title="闪卡库" description="搜索、按标签导航，并批量整理所有卡片。" onBack={onBack} />
      <div className="mx-auto grid h-full w-full max-w-7xl flex-1 gap-4 overflow-hidden p-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="sticky top-4 h-fit space-y-3 self-start">
          <div className="flashcard-panel p-3">
            <div className="text-[13px] font-semibold text-foreground">检索</div>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadLibrary(true)
              }}
              placeholder="搜索题面、答案、标签、来源、牌组"
              className="mt-3 h-9 rounded-md bg-card text-[13px]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {history.slice(0, 6).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery(item.query)}
                >
                  {item.query}
                </button>
              ))}
            </div>
          </div>

          <div className="flashcard-panel p-3">
            <div className="text-[13px] font-semibold text-foreground">高级过滤</div>
            <Select value={deckFilter} onValueChange={setDeckFilter}>
              <SelectTrigger className="mt-3 h-8 rounded-md bg-card text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部牌组</SelectItem>
                {decks.map(deck => <SelectItem key={deck.id} value={String(deck.id)}>{deck.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                ['new', '新卡'],
                ['learning', '学习中'],
                ['review', '已掌握'],
                ['suspended', '已暂停'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn('rounded-md border px-2 py-1 text-[11px] font-medium transition', statusFilters.includes(value as Flashcard['status']) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={() => toggleStatus(value as Flashcard['status'])}
                >
                  {label}
                </button>
              ))}
              {[
                ['due', '今日到期'],
                ['overdue', '逾期'],
                ['weak', '薄弱'],
                ['important', '重点'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn('rounded-md border px-2 py-1 text-[11px] font-medium transition', specialFilters.includes(value as 'due') ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={() => toggleSpecial(value as 'due' | 'overdue' | 'weak' | 'important')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flashcard-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-foreground">标签云</div>
              {selectedTags.length > 0 ? (
                <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setSelectedTags([])}>清空</button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tagStats.length === 0 ? (
                <div className="text-[12px] text-muted-foreground">暂无标签。</div>
              ) : tagStats.map(item => (
                <button
                  key={item.tag}
                  type="button"
                  className={cn('rounded-md border px-2 py-1 text-[11px] transition', selectedTags.includes(item.tag) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={() => toggleTag(item.tag)}
                >
                  {item.tag} <span className="opacity-70">{item.total}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="flashcard-panel flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">{loading ? '检索中...' : `找到 ${total} 张卡片`}</div>
              <div className="text-[11px] text-muted-foreground">当前显示 {cards.length} 张 · 已选 {selectedCount} 张</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md text-[12px]"
                onClick={() => {
                  setSelectedIds(prev => {
                    const next = new Set(prev)
                    for (const card of cards) {
                      if (allVisibleSelected) next.delete(card.id)
                      else next.add(card.id)
                    }
                    return next
                  })
                }}
              >
                {allVisibleSelected ? '取消当前结果' : '选择当前结果'}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void loadLibrary(true)}>保存搜索</Button>
            </div>
          </div>

          {selectedCount > 0 ? (
            <div className="flashcard-panel flex flex-wrap items-center gap-2 p-3">
              <Select onValueChange={(value) => void handleBatchMove(Number(value))}>
                <SelectTrigger className="h-8 w-32 rounded-md bg-card text-[12px]"><SelectValue placeholder="移动到" /></SelectTrigger>
                <SelectContent>
                  {decks.map(deck => <SelectItem key={deck.id} value={String(deck.id)}>{deck.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                value={tagEditValue}
                onChange={(event) => setTagEditValue(event.target.value)}
                placeholder="标签，逗号分隔"
                className="h-8 w-44 rounded-md bg-card text-[12px]"
              />
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void handleBatchAddTags()}>加标签</Button>
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void handleBatchRemoveTags()}>删标签</Button>
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void handleBatchStatus('suspended')}>暂停</Button>
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void handleBatchStatus('review')}>恢复</Button>
              <Button variant="outline" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void handleBatchReset()}>重置</Button>
              <Button variant="ghost" size="sm" className="h-8 rounded-md text-[12px] text-rose-500 hover:bg-rose-50" onClick={() => void handleBatchDelete()}>删除</Button>
            </div>
          ) : null}

          <div className="flashcard-panel min-h-0 flex-1 overflow-hidden">
            {loading ? (
              <div className="p-4 text-[13px] text-muted-foreground">正在检索闪卡库...</div>
            ) : cards.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center p-8 text-center text-[13px] text-muted-foreground">
                没有符合条件的卡片。
              </div>
            ) : (
              <div className="max-h-full overflow-auto divide-y divide-border/50">
                {cards.map(card => {
                  const deck = decks.find(item => item.id === card.deckId)
                  const tags = parseTags(card.tags)
                  return (
                    <div key={card.id} className="flashcard-library-row flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <button
                          type="button"
                          className={cn(
                            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition',
                            selectedIds.has(card.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-transparent hover:text-muted-foreground',
                          )}
                          onClick={() => toggleSelected(card.id)}
                          aria-label={selectedIds.has(card.id) ? '取消选择卡片' : '选择卡片'}
                        >
                          <Check className="size-3" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge>{getCardTypeLabel(card.type)}</Badge>
                            <Badge tone={card.status === 'learning' ? 'amber' : card.status === 'suspended' ? 'neutral' : 'green'}>
                              {card.status === 'new' ? '新卡' : card.status === 'learning' ? '学习中' : card.status === 'suspended' ? '暂停' : '已掌握'}
                            </Badge>
                            {deck ? <Badge tone="neutral">{deck.name}</Badge> : null}
                            {tags.slice(0, 4).map(tag => <Badge key={tag}>{tag}</Badge>)}
                          </div>
                          <div className="mt-2 text-[13px] font-medium leading-6 text-foreground">{getCardPreview(card)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {card.notePath ? (
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <FileText className="size-3" />
                                <span className="truncate">{getFileName(card.notePath)}</span>
                              </span>
                            ) : null}
                            <span>{formatNextReviewTime(card.dueAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function ReviewSummary({
  total,
  ratingCounts,
  onHome,
  onDecks,
  onWeak,
}: {
  total: number
  ratingCounts: Record<FlashcardReviewRating, number>
  onHome: () => void
  onDecks: () => void
  onWeak: () => void
}) {
  const remembered = ratingCounts[2] + ratingCounts[3]
  const weak = ratingCounts[0] + ratingCounts[1]
  const masteryRate = total > 0 ? Math.round((remembered / total) * 100) : 0
  const summaryTone = masteryRate >= 80
    ? '这一轮掌握得很稳，可以把精力转向薄弱卡片。'
    : masteryRate >= 50
      ? '已经完成一轮复习，建议再补一轮错题巩固。'
      : '这轮暴露了不少薄弱点，先从错题开始回收。'
  const statItems = [
    { label: '不会', value: ratingCounts[0], detail: '需要立即回看' },
    { label: '困难', value: ratingCounts[1], detail: '短期再次出现' },
    { label: '记住', value: ratingCounts[2], detail: '进入正常复习' },
    { label: '轻松', value: ratingCounts[3], detail: '下次更晚出现' },
  ]

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-muted/30 p-5">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="size-6" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold tracking-tight text-foreground">复习完成</div>
                <div className="mt-1 text-[13px] text-muted-foreground">本轮共完成 {total} 张卡片，{summaryTone}</div>
              </div>
            </div>
            <div className="rounded-xl bg-muted/50 px-5 py-3 text-right">
              <div className="text-[11px] font-semibold text-muted-foreground">掌握率</div>
              <div className="mt-1 text-3xl font-bold text-foreground">{masteryRate}%</div>
            </div>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${masteryRate}%` }} />
          </div>
        </section>

        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))]">
          {statItems.map(item => (
            <div key={item.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-3xl font-bold text-foreground">{item.value}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <BookOpenCheck className="size-4" />
              本轮复盘
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">已掌握</div>
                <div className="mt-1 text-xl font-bold text-foreground">{remembered}</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">待巩固</div>
                <div className="mt-1 text-xl font-bold text-foreground">{weak}</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">下一步</div>
                <div className="mt-1 text-[13px] font-semibold text-foreground">{weak > 0 ? '复习错题' : '继续扩充卡片'}</div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-border bg-muted/50 p-3 text-[13px] leading-6 text-muted-foreground">
              {weak > 0
                ? `有 ${weak} 张卡片需要加固，建议先进入错题队列，再回到牌组继续复习。`
                : '这一轮没有薄弱卡片，可以回到闪卡工作台继续添加新材料或管理牌组。'}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-[13px] font-semibold text-foreground">接下来</div>
            <div className="mt-3 grid gap-2">
              <Button className="h-10 justify-start rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90" onClick={onHome}>
                <WalletCards className="mr-2 size-4" />
                返回闪卡工作台
              </Button>
              <Button variant="outline" className="h-10 justify-start rounded-lg" onClick={onWeak}>
                <Target className="mr-2 size-4" />
                复习错题
              </Button>
              <Button variant="outline" className="h-10 justify-start rounded-lg" onClick={onDecks}>
                <Layers3 className="mr-2 size-4" />
                管理牌组
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function FlashcardStatsPanel({ onBack }: { onBack: () => void }) {
  const [streak, setStreak] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ new: 0, learning: 0, review: 0, suspended: 0 })
  const [dailyStats, setDailyStats] = useState<Array<{ date: string; reviewed: number; mastered: number; accuracy: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const [s, counts, daily] = await Promise.all([
          getStreakDays(),
          getTotalCardStatusCounts(),
          getDailyReviewStats(14),
        ])
        setStreak(s)
        setStatusCounts(counts)
        setDailyStats(daily)
      } catch (e) {
        console.error('Failed to load stats', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const totalCards = Object.values(statusCounts).reduce((a, b) => a + b, 0)
  const maxReviewed = Math.max(1, ...dailyStats.map(d => d.reviewed))
  const totalReviewed = dailyStats.reduce((a, b) => a + b.reviewed, 0)
  const avgAccuracy = dailyStats.length > 0
    ? Math.round(dailyStats.reduce((a, b) => a + b.accuracy, 0) / dailyStats.length)
    : 0

  const statusLabels: Array<{ key: string; label: string; color: string; lightColor: string; icon: LucideIcon }> = [
    { key: 'new', label: '新卡', color: 'bg-blue-500', lightColor: 'bg-blue-50 text-blue-600', icon: BookOpenCheck },
    { key: 'learning', label: '学习中', color: 'bg-amber-500', lightColor: 'bg-amber-50 text-amber-600', icon: CircleAlert },
    { key: 'review', label: '已进入复习', color: 'bg-emerald-500', lightColor: 'bg-emerald-50 text-emerald-600', icon: CheckCircle2 },
    { key: 'suspended', label: '暂停', color: 'bg-muted-foreground', lightColor: 'bg-muted text-muted-foreground', icon: X },
  ]

  // 补全空日期
  const filledStats = useMemo(() => {
    if (dailyStats.length === 0) return []
    const result: typeof dailyStats = []
    const start = new Date(dailyStats[0].date + 'T00:00:00')
    const end = new Date(dailyStats[dailyStats.length - 1].date + 'T00:00:00')
    const statMap = new Map(dailyStats.map(s => [s.date, s]))
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      result.push(statMap.get(key) || { date: key, reviewed: 0, mastered: 0, accuracy: 0 })
    }
    return result
  }, [dailyStats])

  const chartData = filledStats.length > 0 ? filledStats : dailyStats

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      <WorkspaceHeader
        title="学习统计"
        description="查看学习进度、复习趋势和掌握率数据"
        onBack={onBack}
      />

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-5">

            {/* === 顶部统计卡片 === */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {/* 连续天数 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="size-2 rounded-full bg-amber-500" />
                  <div className="text-xs font-medium text-amber-600 mt-2">连续学习</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{streak}</span>
                    <span className="text-xs text-amber-500">天</span>
                  </div>
              </div>

              {/* 待学习 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="size-2 rounded-full bg-blue-500" />
                  <div className="text-xs font-medium text-blue-600 mt-2">待学习</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{statusCounts.new || 0}</span>
                    <span className="text-xs text-blue-500">张</span>
                  </div>
              </div>

              {/* 14天复习量 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <div className="text-xs font-medium text-emerald-600 mt-2">14天复习量</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{totalReviewed}</span>
                    <span className="text-xs text-emerald-500">次</span>
                  </div>
              </div>

              {/* 平均掌握率 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="size-2 rounded-full bg-muted-foreground" />
                  <div className="text-xs font-medium text-muted-foreground mt-2">平均掌握率</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{avgAccuracy}</span>
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
              </div>
            </div>

            {/* === 卡片状态分布 === */}
            {totalCards > 0 && (
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">卡片状态分布</div>
                  <div className="text-xs text-muted-foreground">共 {totalCards} 张</div>
                </div>

                {/* 分布条 */}
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
                  {statusLabels.map(({ key, color }) => {
                    const count = statusCounts[key] || 0
                    if (count === 0) return null
                    const pct = (count / totalCards) * 100
                    return (
                      <div
                        key={key}
                        className={`${color} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                        title={`${key}: ${count} (${Math.round(pct)}%)`}
                      />
                    )
                  })}
                </div>

                {/* 图例 + 数值 */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {statusLabels.map(({ key, label, color }) => {
                    const count = statusCounts[key] || 0
                    const pct = totalCards > 0 ? Math.round((count / totalCards) * 100) : 0
                    return (
                      <div key={key} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                        <div className={`size-2.5 shrink-0 rounded-full ${color}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground/80">{label}</div>
                          <div className="text-[11px] text-muted-foreground">{count} 张 · {pct}%</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* === 每日复习趋势图 === */}
            {chartData.length > 0 && (
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">复习趋势</div>
                  <div className="text-xs text-muted-foreground">近 {chartData.length} 天</div>
                </div>

                {/* 柱状图 */}
                <div className="relative mt-4">
                  {/* 水平参考线 */}
                  <div className="absolute inset-x-0 bottom-0 flex h-44 flex-col justify-between">
                    {[0, 25, 50, 75, 100].map(pct => (
                      <div key={pct} className="border-b border-dashed border-border/50" />
                    ))}
                  </div>

                  <div className="relative flex h-44 items-end gap-[3px]">
                    {chartData.map((day, i) => {
                      const h = day.reviewed > 0 ? Math.max(8, (day.reviewed / maxReviewed) * 100) : 0
                      const isToday = i === chartData.length - 1
                      const barColor = day.accuracy >= 80
                        ? 'bg-emerald-400'
                        : day.accuracy >= 50
                          ? 'bg-blue-400'
                          : day.reviewed > 0
                            ? 'bg-amber-400'
                            : 'bg-muted'
                      return (
                        <div
                          key={day.date}
                          className="group relative flex flex-1 flex-col items-center"
                          title={`${day.date}\n复习: ${day.reviewed}  掌握率: ${day.accuracy}%`}
                        >
                          {/* 悬浮提示 */}
                          <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-primary px-2 py-1 text-[10px] leading-tight text-primary-foreground shadow-lg group-hover:block">
                            <div className="font-medium">{day.date.slice(5)}</div>
                            <div>复习 {day.reviewed} · 掌握 {day.accuracy}%</div>
                          </div>

                          {/* 数值 */}
                          {day.reviewed > 0 && (
                            <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{day.reviewed}</div>
                          )}

                          {/* 柱子 */}
                          <div className="w-full flex-1 flex items-end">
                            <div
                              className={`w-full rounded-sm transition-all duration-300 ${barColor} ${isToday ? 'ring-2 ring-offset-1 ring-muted-foreground/40' : ''}`}
                              style={{ height: `${h}%` }}
                            />
                          </div>

                          {/* X轴标签 */}
                          <div className={`mt-1 text-[9px] ${isToday ? 'font-semibold text-foreground/80' : 'text-muted-foreground'}`}>
                            {day.date.slice(8)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* === 掌握率趋势 === */}
            {chartData.length > 0 && (
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">掌握率趋势</div>
                  <div className="flex gap-3 text-[10px]">
                    <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-400" /> ≥80%</span>
                    <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-amber-400" /> 50-79%</span>
                    <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-rose-400" /> &lt;50%</span>
                  </div>
                </div>

                {/* 面积图风格柱状 */}
                <div className="relative mt-4">
                  <div className="absolute inset-x-0 bottom-0 flex h-32 flex-col justify-between">
                    {[0, 25, 50, 75, 100].map(pct => (
                      <div key={pct} className="flex items-center gap-2">
                        <span className="w-6 text-right text-[9px] text-border">{pct}%</span>
                        <div className="flex-1 border-b border-dashed border-border/50" />
                      </div>
                    ))}
                  </div>

                  <div className="relative ml-8 flex h-32 items-end gap-[3px]">
                    {chartData.map((day, i) => {
                      const h = Math.max(day.reviewed > 0 ? 4 : 0, day.accuracy)
                      const color = day.accuracy >= 80 ? 'bg-emerald-400' : day.accuracy >= 50 ? 'bg-amber-400' : day.reviewed > 0 ? 'bg-rose-400' : 'bg-muted'
                      const isToday = i === chartData.length - 1
                      return (
                        <div
                          key={day.date}
                          className="group relative flex flex-1 flex-col items-center"
                          title={`${day.date}: ${day.accuracy}%`}
                        >
                          <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-primary px-2 py-1 text-[10px] text-primary-foreground shadow-lg group-hover:block">
                            {day.accuracy}%
                          </div>
                          <div className="w-full flex-1 flex items-end">
                            <div className={`w-full rounded-sm transition-all duration-300 ${color}`} style={{ height: `${h}%` }} />
                          </div>
                          <div className={`mt-1 text-[9px] ${isToday ? 'font-semibold text-foreground/80' : 'text-muted-foreground'}`}>
                            {day.date.slice(8)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* === 空状态 === */}
            {dailyStats.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 py-16">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
                  <BarChart3 className="size-8 text-border" />
                </div>
                <div className="mt-4 text-sm font-medium text-muted-foreground">暂无复习记录</div>
                <div className="mt-1 text-xs text-muted-foreground">开始复习后即可查看统计数据</div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}

function FlashcardReviewPanel({
  deckId,
  mode = 'due',
  onBack,
  onFinished,
  onDecks,
  onWeak,
}: {
  deckId?: number
  mode?: 'due' | 'weak'
  onBack: () => void
  onFinished: () => Promise<void>
  onDecks: () => void
  onWeak: () => void
}) {
  const [cards, setCards] = useState<Flashcard[]>([])
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [userAnswer, setUserAnswer] = useState('')
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState<number | null>(null)
  const [selectedChoiceIndexes, setSelectedChoiceIndexes] = useState<number[]>([])
  const [submittedAnswer, setSubmittedAnswer] = useState('')
  const [choiceResult, setChoiceResult] = useState<'correct' | 'wrong' | null>(null)
  const [reviewRecorded, setReviewRecorded] = useState(false)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [nextDueAt, setNextDueAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [deckName, setDeckName] = useState<string | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [ratingCounts, setRatingCounts] = useState<Record<FlashcardReviewRating, number>>(createRatingCounts())
  const [reviewStates, setReviewStates] = useState<Record<number, ReviewCardState>>({})
  const [focusMode, setFocusMode] = useState(false)

  const resetAnswerState = useCallback(() => {
    setShowAnswer(false)
    setUserAnswer('')
    setSelectedChoiceIndex(null)
    setSelectedChoiceIndexes([])
    setSubmittedAnswer('')
    setChoiceResult(null)
    setReviewRecorded(false)
    setReviewSaving(false)
    setNextDueAt(null)
  }, [])

  const restoreAnswerState = useCallback((card: Flashcard | undefined, states: Record<number, ReviewCardState>) => {
    const state = card ? states[card.id] : undefined
    const choiceIndex = typeof state?.choiceIndex === 'number' ? state.choiceIndex : null
    const choiceIndexes = Array.isArray(state?.choiceIndexes) ? state.choiceIndexes : (choiceIndex === null ? [] : [choiceIndex])

    setShowAnswer(Boolean(state?.showAnswer))
    setUserAnswer(choiceIndex === null ? state?.answer || '' : '')
    setSelectedChoiceIndex(choiceIndex)
    setSelectedChoiceIndexes(choiceIndexes)
    setSubmittedAnswer(state?.answer || '')
    setChoiceResult(state?.status === 'correct' ? 'correct' : state?.status === 'wrong' ? 'wrong' : null)
    setReviewRecorded(Boolean(state?.recorded))
    setReviewSaving(false)
    setNextDueAt(state?.nextDueAt ?? null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reviewCards, deck] = await Promise.all([
        mode === 'weak' ? getWeakFlashcards(100) : getDueFlashcards(deckId),
        deckId ? getFlashcardDeckById(deckId) : Promise.resolve(null),
      ])
      setCards(reviewCards)
      setSessionTotal(reviewCards.length)
      setDeckName(deck?.name || null)
      setIndex(0)
      resetAnswerState()
      setReviewStates({})
      setRatingCounts(createRatingCounts())
    } finally {
      setLoading(false)
    }
  }, [deckId, mode, resetAnswerState])

  useEffect(() => {
    void load()
  }, [load])

  const current = cards[index]
  const reviewContent = useMemo(() => current ? getReviewContent(current) : null, [current])
  const currentTags = useMemo(() => parseTags(current?.tags), [current?.tags])
  const isImportant = currentTags.includes('重点')
  const difficulty = current ? getDifficultyLevel(current.ease, current.interval) : null
  const choices = reviewContent?.choices || []
  const isChoiceCard = choices.length > 0
  const choiceMode = reviewContent?.choiceMode || 'single'
  const isMultiChoice = isChoiceCard && choiceMode === 'multiple'
  const correctChoiceIndexes = useMemo(
    () => reviewContent ? Array.from(new Set([...(reviewContent.correctIndexes || []), ...getChoiceCorrectIndexes(reviewContent.answer, choices)])).filter(choiceIndex => choiceIndex >= 0 && choiceIndex < choices.length) : [],
    [choices, reviewContent],
  )
  const selectedChoice = selectedChoiceIndex === null ? '' : choices[selectedChoiceIndex] || ''
  const selectedChoices = selectedChoiceIndexes.map(choiceIndex => choices[choiceIndex]).filter(Boolean)
  const canSubmitAnswer = isChoiceCard ? (isMultiChoice ? selectedChoiceIndexes.length > 0 : selectedChoiceIndex !== null) : userAnswer.trim().length > 0
  const progress = sessionTotal > 0 ? Math.round(((index + 1) / sessionTotal) * 100) : 0
  const answerDisplay = reviewContent
    ? getReviewAnswerDisplay(reviewContent.answer, isChoiceCard, choices, correctChoiceIndexes)
    : ''
  const completedCount = useMemo(
    () => cards.filter(card => reviewStates[card.id]?.recorded).length,
    [cards, reviewStates],
  )

  const finishReview = useCallback(async () => {
    setCards([])
    setIndex(0)
    resetAnswerState()
    await onFinished()
  }, [onFinished, resetAnswerState])

  const goToIndex = useCallback((nextIndex: number, states = reviewStates) => {
    if (cards.length === 0) return
    const safeIndex = Math.min(cards.length - 1, Math.max(0, nextIndex))
    setIndex(safeIndex)
    restoreAnswerState(cards[safeIndex], states)
  }, [cards, restoreAnswerState, reviewStates])

  const goToNext = useCallback(async (states = reviewStates) => {
    if (index >= cards.length - 1) {
      await finishReview()
      return
    }

    goToIndex(index + 1, states)
  }, [cards.length, finishReview, goToIndex, index, reviewStates])

  const handleRating = useCallback(async (rating: FlashcardReviewRating) => {
    if (!current || reviewSaving) return
    if (reviewStates[current.id]?.recorded) return

    setReviewSaving(true)
    try {
      const result = await updateFlashcardReview(current.id, rating)
      setRatingCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }))
      const status: ReviewCardStatus = rating >= 2 ? 'correct' : 'wrong'
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer: submittedAnswer || (isChoiceCard ? selectedChoices.join(' / ') : userAnswer.trim()),
          choiceIndex: selectedChoiceIndex,
          choiceIndexes: selectedChoiceIndexes,
          showAnswer: true,
          recorded: true,
          status,
          nextDueAt: result.nextDueAt,
        },
      }))
      setReviewRecorded(true)
      setNextDueAt(result.nextDueAt)
    } finally {
      setReviewSaving(false)
    }
  }, [current, isChoiceCard, reviewSaving, reviewStates, selectedChoiceIndex, selectedChoiceIndexes, selectedChoices, submittedAnswer, userAnswer])

  const handleChoiceAnswer = useCallback(async (choiceIndex: number) => {
    if (!current || !reviewContent || showAnswer || reviewSaving) return

    const choice = choices[choiceIndex]
    if (!choice) return

    if (isMultiChoice) {
      setSelectedChoiceIndexes(prev => {
        const next = prev.includes(choiceIndex) ? prev.filter(item => item !== choiceIndex) : [...prev, choiceIndex]
        return next.sort((a, b) => a - b)
      })
      return
    }

    const correct = correctChoiceIndexes.includes(choiceIndex)
    const rating: FlashcardReviewRating = correct ? 3 : 0

    setSelectedChoiceIndex(choiceIndex)
    setSelectedChoiceIndexes([choiceIndex])
    setSubmittedAnswer(choice)
    setChoiceResult(correct ? 'correct' : 'wrong')
    setShowAnswer(true)
    setReviewSaving(true)

    try {
      const result = await updateFlashcardReview(current.id, rating)
      setRatingCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }))
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer: choice,
          choiceIndex,
          choiceIndexes: [choiceIndex],
          showAnswer: true,
          recorded: true,
          status: correct ? 'correct' : 'wrong',
          nextDueAt: result.nextDueAt,
        },
      }))
      setReviewRecorded(true)
      setNextDueAt(result.nextDueAt)
    } catch (error) {
      toast({
        title: '记录复习结果失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setReviewSaving(false)
    }
  }, [choices, correctChoiceIndexes, current, isMultiChoice, reviewContent, reviewSaving, showAnswer])

  const handleSubmitAnswer = useCallback(() => {
    if (!reviewContent || !canSubmitAnswer) return
    const answer = isChoiceCard ? (isMultiChoice ? selectedChoices.join(' / ') : selectedChoice) : userAnswer.trim()
    const multiChoiceCorrect = isMultiChoice
      && selectedChoiceIndexes.length === correctChoiceIndexes.length
      && selectedChoiceIndexes.every(choiceIndex => correctChoiceIndexes.includes(choiceIndex))

    setSubmittedAnswer(answer)
    setShowAnswer(true)
    if (isMultiChoice) {
      setChoiceResult(multiChoiceCorrect ? 'correct' : 'wrong')
    }
    if (current) {
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer,
          choiceIndex: selectedChoiceIndex,
          choiceIndexes: selectedChoiceIndexes,
          showAnswer: true,
          status: isMultiChoice ? (multiChoiceCorrect ? 'correct' : 'wrong') : prev[current.id]?.status,
        },
      }))
    }
    if (isMultiChoice) {
      void handleRating(multiChoiceCorrect ? 3 : 0)
    }
  }, [canSubmitAnswer, correctChoiceIndexes, current, handleRating, isChoiceCard, isMultiChoice, reviewContent, selectedChoice, selectedChoiceIndex, selectedChoiceIndexes, selectedChoices, userAnswer])

  const handleRevealAnswer = useCallback(() => {
    setSubmittedAnswer('')
    setShowAnswer(true)
    if (current) {
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer: '',
          showAnswer: true,
        },
      }))
    }
  }, [current])

  const handleSkip = useCallback(async () => {
    if (!current) return

    const existingState = reviewStates[current.id]
    const nextStates = existingState?.recorded
      ? reviewStates
      : {
          ...reviewStates,
          [current.id]: {
            ...existingState,
            status: 'skipped' as ReviewCardStatus,
            showAnswer: false,
            recorded: false,
          },
        }

    if (!existingState?.recorded) {
      setReviewStates(nextStates)
    }

    await goToNext(nextStates)
  }, [current, goToNext, reviewStates])

  const toggleImportant = useCallback(async () => {
    if (!current) return
    const nextTags = isImportant ? currentTags.filter(tag => tag !== '重点') : [...currentTags, '重点']
    await updateFlashcardTags(current.id, nextTags)
    setCards(prev => prev.map(card => card.id === current.id ? { ...card, tags: serializeTags(nextTags) } : card))
  }, [current, currentTags, isImportant])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!current || reviewSaving || isTypingTarget(event.target)) return

      if (event.key === ' ') {
        event.preventDefault()
        if (!showAnswer) handleRevealAnswer()
        return
      }

      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        goToIndex(index - 1)
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        void goToNext()
        return
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!reviewRecorded) void handleSkip()
        return
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        void toggleImportant()
        return
      }

      if (showAnswer && !reviewRecorded && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        void handleRating((Number(event.key) - 1) as FlashcardReviewRating)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    current,
    goToIndex,
    goToNext,
    handleRating,
    handleRevealAnswer,
    handleSkip,
    index,
    reviewRecorded,
    reviewSaving,
    showAnswer,
    toggleImportant,
  ])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
        <WorkspaceHeader title="复习" description="正在准备卡片。" onBack={onBack} />
        <div className="p-4 text-[13px] text-muted-foreground">正在加载...</div>
      </div>
    )
  }

  if (!current) {
    return <ReviewSummary total={sessionTotal} ratingCounts={ratingCounts} onHome={onBack} onDecks={onDecks} onWeak={onWeak} />
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-muted/30', focusMode && 'flashcard-focus-shell bg-background')}>
      <WorkspaceHeader
        title={mode === 'weak' ? '错题复习' : '闪卡复习'}
        description={focusMode ? '专注模式' : deckName || '全部牌组'}
        onBack={onBack}
        action={(
          <div className="flex items-center gap-1.5">
            <Button
              variant={focusMode ? 'default' : 'outline'}
              size="sm"
              className={cn('h-8 rounded-md text-[12px]', focusMode && 'bg-foreground text-background hover:bg-foreground/90')}
              onClick={() => setFocusMode(prev => !prev)}
            >
              <Target className="mr-2 size-3.5" />
              {focusMode ? '退出专注' : '专注复习'}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void load()}>
              <RefreshCw className="mr-2 size-3.5" />
              重载
            </Button>
          </div>
        )}
      />
      <div className={cn('min-h-0 flex-1 overflow-auto px-5 py-5', focusMode && 'px-4 py-3 sm:px-6 sm:py-5')}>
        <div className={cn('mx-auto w-full max-w-6xl', focusMode && 'max-w-6xl')}>
          <div className={cn('grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]', focusMode && 'xl:grid-cols-[minmax(0,1fr)_300px]')}>
            <section className={cn('flashcard-panel overflow-hidden', focusMode && 'flashcard-focus-card min-h-[min(68vh,620px)]')}>
              <div className="border-b border-border/50 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge tone="dark">{index + 1}/{sessionTotal}</Badge>
                    <Badge>{reviewContent?.promptLabel}</Badge>
                    {difficulty ? <Badge tone={difficulty.tone}>{difficulty.label}</Badge> : null}
                    {isImportant ? <Badge tone="amber">重点</Badge> : null}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 rounded-md text-[12px]" onClick={() => void toggleImportant()}>
                    <Star className={cn('mr-2 size-3.5', isImportant && 'fill-amber-400 text-amber-500')} />
                    {isImportant ? '取消重点' : '标重点'}
                  </Button>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted flashcard-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                {current?.notePath ? (
                  <div className="mt-2 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">{getFileName(current.notePath)}</span>
                  </div>
                ) : null}
              </div>

              <div className={cn('p-5 sm:p-7', focusMode && 'flex min-h-[calc(min(68vh,620px)-92px)] flex-col justify-center py-8')}>
                <SimpleMarkdown
                  content={reviewContent?.prompt || ''}
                  className={cn(
                    'text-[24px] font-semibold leading-relaxed text-foreground',
                    focusMode && 'mx-auto mt-0 max-w-3xl text-center text-[28px] leading-relaxed sm:text-[32px]',
                  )}
                />

              {isChoiceCard ? (
                <div className={cn('mt-7 grid gap-2.5', focusMode && 'mx-auto mt-8 w-full max-w-2xl')}>
                  {choices.map((choice, choiceIndex) => {
                    const selected = isMultiChoice ? selectedChoiceIndexes.includes(choiceIndex) : selectedChoiceIndex === choiceIndex
                    const likelyCorrect = showAnswer && correctChoiceIndexes.includes(choiceIndex)
                    const selectedWrong = selected && showAnswer && choiceResult === 'wrong' && !likelyCorrect
                    return (
                      <button
                        key={`${choice}-${choiceIndex}`}
                        type="button"
                        className={cn(
                          'flashcard-choice-option flex min-h-12 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-left text-[14px] transition-[background-color,border-color,transform] duration-150',
                          !showAnswer && 'hover:border-foreground/30 hover:bg-card',
                          selected && !showAnswer && 'border-primary bg-card',
                          likelyCorrect && 'border-primary bg-primary text-primary-foreground',
                          selectedWrong && 'border-border bg-muted text-muted-foreground',
                        )}
                        disabled={showAnswer || reviewSaving}
                        onClick={() => void handleChoiceAnswer(choiceIndex)}
                      >
                        <span className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold',
                          selected && !showAnswer ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground',
                          likelyCorrect && 'border-white bg-card text-foreground',
                          selectedWrong && 'border-border bg-card text-muted-foreground',
                        )}>
                          {String.fromCharCode(65 + choiceIndex)}
                        </span>
                        <span className="min-w-0 flex-1 leading-6">{choice}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className={cn('mt-7 space-y-2', focusMode && 'mx-auto mt-8 w-full max-w-2xl')}>
                  <div className="text-[11px] font-medium text-muted-foreground">作答区</div>
                  <Textarea
                    value={userAnswer}
                    onChange={(event) => setUserAnswer(event.target.value)}
                    disabled={showAnswer}
                    placeholder={current.type === 'cloze' ? '输入填空答案...' : '先写下自己的答案，再查看参考答案。'}
                    className="min-h-28 resize-none rounded-lg bg-muted/30 text-[13px] shadow-none border-border"
                  />
                </div>
              )}

              {showAnswer ? (
                <div className={cn('mt-7 animate-in fade-in slide-in-from-bottom-1 duration-200', focusMode && 'mx-auto mt-8 w-full max-w-2xl')}>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-[11px] font-semibold text-muted-foreground">{isChoiceCard ? '答案解析' : reviewContent?.answerLabel}</div>
                    {isChoiceCard && choiceResult ? (
                      <div className={cn(
                        'mt-2 inline-flex animate-in fade-in duration-150 rounded-md px-2 py-1 text-xs font-semibold',
                        choiceResult === 'correct'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700',
                      )}>
                        {choiceResult === 'correct' ? '回答正确' : '回答错误'}
                      </div>
                    ) : null}
                    <SimpleMarkdown content={answerDisplay} className="mt-2 text-[13px] leading-6 text-foreground" />
                  </div>
                </div>
              ) : null}
              </div>
            </section>

            <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
              {/* 移动端底部快速操作栏 */}
              <div className="flashcard-panel p-3 xl:hidden">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">{index + 1}/{sessionTotal}</div>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 rounded-md text-[12px]" disabled={index === 0 || reviewSaving} onClick={() => goToIndex(index - 1)}>
                      上一题
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 rounded-md text-[12px]" disabled={reviewSaving || reviewRecorded} onClick={() => void handleSkip()}>
                      跳过
                    </Button>
                    <Button size="sm" className="h-7 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90" disabled={reviewSaving} onClick={() => void goToNext()}>
                      {index >= cards.length - 1 ? '完成' : '下一题'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* 桌面端完整侧栏 */}
              <div className="hidden xl:block space-y-3">
                <div className="flashcard-panel p-3">
                  <div className="text-[13px] font-semibold text-foreground">本轮进度</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-[11px] text-muted-foreground">当前</div>
                      <div className="mt-1 font-semibold text-foreground">{index + 1}/{sessionTotal}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-[11px] text-muted-foreground">已答</div>
                      <div className="mt-1 font-semibold text-foreground">{completedCount}/{sessionTotal}</div>
                    </div>
                  </div>
                  {focusMode ? (
                    <>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted flashcard-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-foreground transition-all duration-300" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-3 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                        Space 显示答案 · 1/2/3/4 评分 · ←/→ 切换 · S 跳过 · F 标重点
                      </div>
                    </>
                  ) : null}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Button variant="outline" className="h-9 rounded-md text-[12px]" disabled={index === 0 || reviewSaving} onClick={() => goToIndex(index - 1)}>
                      上一题
                    </Button>
                    <Button variant="outline" className="h-9 rounded-md text-[12px]" disabled={reviewSaving || reviewRecorded} onClick={() => void handleSkip()}>
                      跳过
                    </Button>
                    <Button className="h-9 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90" disabled={reviewSaving} onClick={() => void goToNext()}>
                      {index >= cards.length - 1 ? '完成' : '下一题'}
                    </Button>
                  </div>
                </div>

                {!focusMode ? (
                  <div className="flashcard-panel p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[13px] font-semibold text-foreground">答题卡</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" />对</span>
                        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-rose-500" />错</span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-7 gap-1.5">
                      {cards.map((card, cardIndex) => {
                        const state = reviewStates[card.id]
                        return (
                          <button
                            key={card.id}
                            type="button"
                            className={cn(
                              'flex aspect-square items-center justify-center rounded-md border text-[10px] font-bold transition',
                              state?.status === 'correct' && 'border-emerald-500 bg-emerald-500 text-white',
                              state?.status === 'wrong' && 'border-rose-500 bg-rose-500 text-white',
                              state?.status === 'skipped' && 'border-border bg-muted text-muted-foreground',
                              !state?.status && 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                              cardIndex === index && 'ring-2 ring-primary ring-offset-1',
                            )}
                            onClick={() => goToIndex(cardIndex)}
                          >
                            {cardIndex + 1}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="flashcard-panel p-3">
                  <div className="text-[13px] font-semibold text-foreground">
                    {showAnswer && reviewRecorded ? '本题结果' : showAnswer ? '自评掌握度' : '先作答'}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
                    {showAnswer && reviewRecorded ? (
                      <>
                        <div className="rounded-lg border border-border bg-muted/50 p-3 text-[13px] sm:col-span-2">
                          <div className="font-semibold text-foreground">
                            {choiceResult === 'correct' ? '回答正确' : choiceResult === 'wrong' ? '回答错误' : '已记录'}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {choiceResult === 'correct'
                              ? '已降低下次出现频率。'
                              : choiceResult === 'wrong'
                                ? '已加入薄弱复习，会更快再次出现。'
                                : '已保存本题复习结果。'}
                          </div>
                          <div className="mt-2 rounded-md bg-card px-2.5 py-2 text-[11px] font-medium text-foreground ring-1 ring-border">
                            {formatNextReviewTime(nextDueAt)}
                          </div>
                        </div>
                      </>
                    ) : !showAnswer ? (
                      <>
                        {!isChoiceCard ? (
                          <Button className="h-10 rounded-md bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 sm:col-span-2" onClick={handleSubmitAnswer} disabled={!canSubmitAnswer}>
                            提交答案
                          </Button>
                        ) : isMultiChoice ? (
                          <Button className="h-10 rounded-md bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 sm:col-span-2" onClick={handleSubmitAnswer} disabled={!canSubmitAnswer || reviewSaving}>
                            提交选择
                          </Button>
                        ) : null}
                        <Button variant="outline" className={cn('h-10 rounded-md border-border bg-card text-[13px] font-medium hover:bg-muted', !isChoiceCard && 'sm:col-span-1')} onClick={handleRevealAnswer}>
                          查看答案
                        </Button>
                        <Button variant="ghost" className="h-10 rounded-md text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void handleSkip()}>
                          跳过本题
                        </Button>
                      </>
                    ) : (
                      ratingOptions.map(option => {
                        const Icon = option.icon
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cn('flashcard-rating-btn flex min-h-[72px] items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition hover:-translate-y-0.5', option.className)}
                            disabled={reviewSaving}
                            onClick={() => void handleRating(option.value)}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>
                              <div className="font-semibold">{option.label}</div>
                              <div className="text-xs opacity-75">{option.hint}</div>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FlashcardWorkspace({ sourcePath }: FlashcardWorkspaceProps) {
  const [view, setView] = useState<FlashcardWorkspaceView>({ name: 'home' })
  const [decks, setDecks] = useState<FlashcardDeckSummary[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [stats, setStats] = useState<FlashcardLearningStats>(defaultStats)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [sources, setSources] = useState<SourceNote[]>([])
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([])
  const [deckId, setDeckId] = useState('')
  const [count, setCount] = useState('8')
  const [mode, setMode] = useState<GenerateMode>('memory')
  const [selectedTypes, setSelectedTypes] = useState<GenerateQuestionType[]>(['choice', 'cloze', 'short-answer', 'true-false'])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pointerDragPreview, setPointerDragPreview] = useState<Pick<LingMoFilePointerDragDetail, 'x' | 'y'> & { name: string; overDropZone: boolean } | null>(null)
  const sourceDropZoneRef = useRef<HTMLDivElement | null>(null)
  const setSourceDropZoneRef = useCallback((node: HTMLDivElement | null) => {
    sourceDropZoneRef.current = node
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const defaultDeck = await ensureDefaultFlashcardDeck()
      const [deckSummaries, dueCards, learningStats] = await Promise.all([
        getFlashcardDeckSummaries(),
        getDueFlashcards(),
        getFlashcardLearningStats(),
      ])
      setDecks(deckSummaries)
      setDueCount(dueCards.length)
      setStats(learningStats)
      setDeckId(prev => prev || String(defaultDeck.id))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addSourcePath = useCallback(async (path: string) => {
    const cleanPath = path.trim()
    if (!cleanPath || cleanPath.startsWith('lingmo://')) return

    if (!isSupportedSourcePath(cleanPath)) {
      toast({ title: '只支持拖入 Markdown 或文本笔记', variant: 'destructive' })
      return
    }

    setSources(prev => {
      if (prev.some(source => source.path === cleanPath)) return prev
      return [
        ...prev,
        {
          id: cleanPath,
          path: cleanPath,
          name: getFileName(cleanPath),
          content: '',
          status: 'loading',
        },
      ]
    })

    try {
      const content = await readWorkspaceTextFile(cleanPath)
      setSources(prev => prev.map(source => source.path === cleanPath
        ? { ...source, content, status: 'ready', error: undefined }
        : source))
    } catch (error) {
      setSources(prev => prev.map(source => source.path === cleanPath
        ? { ...source, status: 'error', error: error instanceof Error ? error.message : '读取失败' }
        : source))
    }
  }, [])

  const handleDroppedDataTransfer = useCallback(async (dataTransfer: DataTransfer) => {
    setIsDragging(false)

    const files = Array.from(dataTransfer.files || [])
    if (files.length > 0) {
      const nextSources = await Promise.all(
        files
          .filter(file => isSupportedSourcePath(file.name))
          .map(async file => ({
            id: `external:${file.name}:${file.size}`,
            path: file.name,
            name: file.name,
            content: await file.text(),
            status: 'ready' as const,
          })),
      )
      setSources(prev => [...prev, ...nextSources.filter(source => !prev.some(item => item.id === source.id))])
      clearRememberedDraggingPath()
      return
    }

    const draggedPath = getDraggedPathFromDataTransfer(dataTransfer) || getRememberedDraggingPath()
    if (draggedPath) {
      await addSourcePath(draggedPath)
    } else {
      toast({ title: '没有识别到可导入的笔记文件', variant: 'destructive' })
    }
    clearRememberedDraggingPath()
  }, [addSourcePath])

  async function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    await handleDroppedDataTransfer(event.dataTransfer)
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragging(prev => prev || true)
  }

  useEffect(() => {
    if (view.name !== 'home') return

    function allowFlashcardDrop(event: globalThis.DragEvent) {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      setIsDragging(prev => prev || true)
    }

    function leaveFlashcardDrop(event: globalThis.DragEvent) {
      if (!event.relatedTarget) {
        setIsDragging(false)
      }
    }

    function dropIntoFlashcard(event: globalThis.DragEvent) {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      if (event.dataTransfer) {
        void handleDroppedDataTransfer(event.dataTransfer)
      }
    }

    window.addEventListener('dragenter', allowFlashcardDrop, true)
    window.addEventListener('dragover', allowFlashcardDrop, true)
    window.addEventListener('dragleave', leaveFlashcardDrop, true)
    window.addEventListener('drop', dropIntoFlashcard, true)
    document.addEventListener('dragenter', allowFlashcardDrop, true)
    document.addEventListener('dragover', allowFlashcardDrop, true)
    document.addEventListener('dragleave', leaveFlashcardDrop, true)
    document.addEventListener('drop', dropIntoFlashcard, true)

    return () => {
      window.removeEventListener('dragenter', allowFlashcardDrop, true)
      window.removeEventListener('dragover', allowFlashcardDrop, true)
      window.removeEventListener('dragleave', leaveFlashcardDrop, true)
      window.removeEventListener('drop', dropIntoFlashcard, true)
      document.removeEventListener('dragenter', allowFlashcardDrop, true)
      document.removeEventListener('dragover', allowFlashcardDrop, true)
      document.removeEventListener('dragleave', leaveFlashcardDrop, true)
      document.removeEventListener('drop', dropIntoFlashcard, true)
      clearRememberedDraggingPath()
    }
  }, [handleDroppedDataTransfer, view.name])

  useEffect(() => {
    if (view.name !== 'home') return

    function handleFilePointerDrag(event: Event) {
      const detail = getLingMoFilePointerDragDetail(event)
      if (!detail?.path || detail.isDirectory) return

      const overDropZone = isPointInsideElement(sourceDropZoneRef.current, detail.x, detail.y)

      if (detail.phase === 'start' || detail.phase === 'move') {
        setPointerDragPreview({
          name: detail.displayName || detail.name,
          x: detail.x,
          y: detail.y,
          overDropZone,
        })
        setIsDragging(overDropZone)
        return
      }

      setPointerDragPreview(null)
      setIsDragging(false)
      clearRememberedDraggingPath()

      if (detail.phase === 'end' && overDropZone) {
        void addSourcePath(detail.path)
      }
    }

    window.addEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)

    return () => {
      window.removeEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
      setPointerDragPreview(null)
    }
  }, [addSourcePath, view.name])

  function toggleQuestionType(type: GenerateQuestionType) {
    setSelectedTypes(prev => {
      if (prev.includes(type)) {
        const next = prev.filter(item => item !== type)
        return next.length > 0 ? next : prev
      }
      return [...prev, type]
    })
  }

  async function handleGenerate() {
    const readySources = sources.filter(source => source.status === 'ready' && source.content.trim())
    if (readySources.length === 0) {
      toast({ title: '请先拖入至少一篇可读取的笔记', variant: 'destructive' })
      return
    }

    const requestedCount = Math.min(30, Math.max(1, Number(count) || 8))
    const modeLabel = modeOptions.find(item => item.value === mode)?.label || '记忆巩固'
    const typeLabels = selectedTypes.map(type => questionTypeOptions.find(item => item.value === type)?.label || type).join('、')
    const sourceText = readySources
      .map((source, index) => [
        `### 来源 ${index + 1}: ${source.name}`,
        `path: ${source.path}`,
        source.content.slice(0, 4500),
      ].join('\n'))
      .join('\n\n')

    setGenerating(true)
    try {
      const buildPrompt = (targetCount: number, existingDrafts: GeneratedDraft[]) => [
        '你是一个严谨的学习卡片生成助手。',
        `请根据用户提供的笔记，生成 ${targetCount} 张新增闪卡草稿。`,
        `本轮必须返回恰好 ${targetCount} 个 JSON 数组元素，不要少于 ${targetCount} 个。`,
        `生成模式：${modeLabel}`,
        `允许题型：${typeLabels}`,
        '只返回严格 JSON 数组，不要返回解释，不要使用 Markdown 代码块。',
        '每个元素格式：',
        '{"type":"choice|cloze|short-answer|true-false","front":"","back":"","clozeText":"","choices":[""],"choiceMode":"single|multiple","correctChoices":["A"],"tags":[""],"sourcePath":"","difficulty":"basic|understanding|application|confusable","sourceSummary":"","qualityNote":"","atomicityIssue":"","duplicateHint":""}',
        '规则：',
        '1. choice 是选择题，front 写题干，choices 给 3-5 个选项，back 写正确答案和简短解析。',
        '1.1 choiceMode 为 single 时只保留一个正确项，choiceMode 为 multiple 时保留 2-3 个正确项。',
        '1.2 correctChoices 用 A/B/C/D/E 标注正确选项，可以是单个或多个。',
        '1.3 多选题的 back 中应明确写出多个正确答案和一小段解析，不要只写一个字母。',
        '2. cloze 是填空题，只写 clozeText，必须使用 {{c1::答案}} 格式。',
        '3. short-answer 是简答题，front 写问题，back 写参考答案或评分要点。',
        '4. true-false 是判断题，front 写一条可判断真伪的陈述，back 必须以“答案：正确”或“答案：错误”开头，然后写一句解析。',
        '5. sourcePath 必须从来源 path 中选择。',
        '6. tags 最多 4 个，短词即可。',
        '7. 每张卡必须只考一个知识点；如果题面包含多个考点，在 atomicityIssue 中说明。',
        '8. difficulty 必须四选一：basic=基础事实，understanding=概念理解，application=应用迁移，confusable=易混淆辨析。',
        '8.1 选择题要随机混合单选和多选，优先从文章中提取多个并列事实、分类关系、对照关系生成多选题。',
        '9. sourceSummary 用一句话概括来源片段，方便复习时回到原文。',
        '10. qualityNote 说明为什么这张卡值得保留，或保存前应该如何拆分。',
        '11. duplicateHint 标注与已生成题干或来源内相似题的重复风险，没有则留空。',
        '12. 不要重复已有题干；如果来源内容较少，可以从同一知识点拆成不同题型补齐。',
        '13. 所有字符串字段必须是单行短句，不能包含换行符，不能包含未转义的英文双引号。',
        '14. sourceSummary、qualityNote、atomicityIssue、duplicateHint 每项不超过 40 个汉字。',
        '15. 无内容的可选字段必须写成空字符串，不要写 null、undefined 或省略字段。',
        existingDrafts.length > 0
          ? `已生成题干，继续补齐时请避开：\n${existingDrafts.map(draft => `- ${getCardPreview(draft)}`).join('\n')}`
          : '',
        '',
        sourceText,
      ].filter(Boolean).join('\n')

      let normalized = [] as GeneratedDraft[]
      for (let attempt = 0; attempt < 3 && normalized.length < requestedCount; attempt += 1) {
        const remaining = requestedCount - normalized.length
        const result = await fetchAi(buildPrompt(remaining, normalized))
        const parsed = await parseGeneratedDraftJson(result)
        const nextDrafts = normalizeDrafts(parsed, remaining, selectedTypes, readySources)
        normalized = enrichDraftQuality(mergeUniqueDrafts([...normalized, ...nextDrafts], requestedCount))
      }

      if (normalized.length === 0) {
        throw new Error('AI 没有返回有效卡片。')
      }
      setDrafts(normalized)
      toast({
        title: normalized.length >= requestedCount
          ? `已生成 ${normalized.length} 张卡片草稿`
          : `已生成 ${normalized.length}/${requestedCount} 张卡片草稿`,
        description: normalized.length >= requestedCount ? undefined : 'AI 返回内容不足，已保留有效题目。',
      })
    } catch (error) {
      toast({
        title: '生成卡片失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }

  async function handleSaveDrafts() {
    const numericDeckId = Number(deckId)
    const selectedDrafts = drafts.filter(draft => draft.selected)
    if (!numericDeckId || selectedDrafts.length === 0) return

    setSaving(true)
    try {
      await createFlashcardsBatch(selectedDrafts.map(draft => draftToCreateInput(draft, numericDeckId)))
      setDrafts([])
      await refresh()
      toast({ title: `已保存 ${selectedDrafts.length} 张闪卡` })
    } catch (error) {
      toast({
        title: '保存卡片失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleUseCurrentSource() {
    if (sourcePath) {
      await addSourcePath(sourcePath)
    }
  }

  if (view.name === 'decks') {
    return <FlashcardDeckManager decks={decks} onBack={() => setView({ name: 'home' })} onRefresh={refresh} onReviewDeck={(nextDeckId) => setView({ name: 'review', deckId: nextDeckId })} />
  }

  if (view.name === 'library') {
    return <FlashcardLibraryPanel decks={decks} onBack={() => setView({ name: 'home' })} onRefresh={refresh} />
  }

  if (view.name === 'weak') {
    return <WeakCardsPanel onBack={() => setView({ name: 'home' })} onReviewWeak={() => setView({ name: 'review', mode: 'weak' })} />
  }

  if (view.name === 'stats') {
    return <FlashcardStatsPanel onBack={() => setView({ name: 'home' })} />
  }

  if (view.name === 'review') {
    return (
      <FlashcardReviewPanel
        deckId={view.deckId}
        mode={view.mode}
        onBack={() => setView({ name: 'home' })}
        onFinished={refresh}
        onDecks={() => setView({ name: 'decks' })}
        onWeak={() => setView({ name: 'weak' })}
      />
    )
  }

  return (
    <>
      <FlashcardHome
        dropZoneRef={setSourceDropZoneRef}
        pointerDragPreview={pointerDragPreview}
        decks={decks}
        dueCount={dueCount}
        stats={stats}
        loading={loading}
        sourcePath={sourcePath}
        sources={sources}
        drafts={drafts}
        deckId={deckId}
        count={count}
        mode={mode}
        selectedTypes={selectedTypes}
        generating={generating}
        saving={saving}
        isDragging={isDragging}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onUseCurrent={() => void handleUseCurrentSource()}
        onRemoveSource={(path) => setSources(prev => prev.filter(source => source.path !== path))}
        onClearSources={() => setSources([])}
        onDeckChange={setDeckId}
        onCountChange={setCount}
        onModeChange={setMode}
        onToggleType={toggleQuestionType}
        onGenerate={() => void handleGenerate()}
        onToggleDraft={(index) => setDrafts(prev => prev.map((draft, draftIndex) => draftIndex === index ? { ...draft, selected: !draft.selected } : draft))}
        onRemoveDraft={(index) => setDrafts(prev => prev.filter((_, draftIndex) => draftIndex !== index))}
        onSaveDrafts={() => void handleSaveDrafts()}
        onCreateCard={() => setCreateOpen(true)}
        onReviewAll={() => setView({ name: 'review' })}
        onReviewDeck={(nextDeckId) => setView({ name: 'review', deckId: nextDeckId })}
        onLibrary={() => setView({ name: 'library' })}
        onManageDecks={() => setView({ name: 'decks' })}
        onWeakCards={() => setView({ name: 'weak' })}
        onStats={() => setView({ name: 'stats' })}
      />

      <FlashcardCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void refresh()}
        initialDraft={sourcePath ? { notePath: sourcePath } : null}
      />
    </>
  )
}
