'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FileText,
  Layers3,
  LoaderCircle,
  MousePointer2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  Trash2,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FlashcardCreateDialog } from '@/components/flashcard-create-dialog'
import {
  createFlashcardDeck,
  createFlashcardsBatch,
  deleteFlashcard,
  deleteFlashcardDeck,
  ensureDefaultFlashcardDeck,
  getDueFlashcards,
  getFlashcardDeckById,
  getFlashcardDeckSummaries,
  getFlashcardLearningStats,
  getFlashcardsByDeckId,
  getWeakFlashcards,
  moveFlashcardToDeck,
  updateFlashcardDeck,
  updateFlashcardReview,
  updateFlashcardTags,
} from '@/db/flashcards'
import { toast } from '@/hooks/use-toast'
import { fetchAi } from '@/lib/ai/chat'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import {
  getNoteGenFilePointerDragDetail,
  isPointInsideElement,
  NOTE_GEN_FILE_POINTER_DRAG_EVENT,
  type NoteGenFilePointerDragDetail,
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

interface FlashcardWorkspaceProps {
  sourcePath?: string | null
}

type FlashcardWorkspaceView =
  | { name: 'home' }
  | { name: 'decks' }
  | { name: 'weak' }
  | { name: 'review'; deckId?: number; mode?: 'due' | 'weak' }

type GenerateMode = 'memory' | 'exam' | 'concept'
type GenerateQuestionType = Extract<FlashcardType, 'choice' | 'cloze' | 'short-answer' | 'basic'>

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
  tags?: string[]
  sourcePath?: string
  selected: boolean
}

interface ReviewContent {
  prompt: string
  answer: string
  promptLabel: string
  answerLabel: string
  choices?: string[]
}

type ReviewCardStatus = 'correct' | 'wrong' | 'skipped'

interface ReviewCardState {
  status?: ReviewCardStatus
  answer?: string
  choiceIndex?: number | null
  showAnswer?: boolean
  recorded?: boolean
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
  { value: 'basic', label: '问答卡' },
]

const ratingOptions: Array<{
  value: FlashcardReviewRating
  label: string
  hint: string
  className: string
}> = [
  { value: 0, label: '不会', hint: '加入薄弱', className: 'border-border/70 bg-background text-foreground hover:bg-muted' },
  { value: 1, label: '困难', hint: '还要练', className: 'border-border/70 bg-background text-foreground hover:bg-muted' },
  { value: 2, label: '记住', hint: '正常复习', className: 'border-border/70 bg-background text-foreground hover:bg-muted' },
  { value: 3, label: '轻松', hint: '延后复习', className: 'border-border/70 bg-background text-foreground hover:bg-muted' },
]

const supportedSourceExtensions = ['.md', '.markdown', '.txt']
const NOTE_FILE_DRAG_TYPE = 'application/x-note-gen-file'

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
  return (window as unknown as { __noteGenDraggingFilePath?: string }).__noteGenDraggingFilePath || ''
}

function clearRememberedDraggingPath() {
  if (typeof window === 'undefined') return
  delete (window as unknown as { __noteGenDraggingFilePath?: string }).__noteGenDraggingFilePath
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

function getReviewContent(card: Flashcard): ReviewContent {
  if (card.type === 'choice') {
    return {
      prompt: card.front || '未填写题目',
      answer: card.back || '暂无答案内容',
      promptLabel: '选择题',
      answerLabel: '答案解析',
      choices: parseChoiceOptions(card),
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
  if (card.type === 'choice' || card.type === 'short-answer' || card.type === 'basic' || card.type === 'basic-reversed') {
    return card.front || card.back || '未填写内容'
  }
  return parseClozeText(card.clozeText).prompt
}

function getCardTypeLabel(type: FlashcardType) {
  if (type === 'choice') return '选择'
  if (type === 'short-answer') return '简答'
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

function extractJsonArray(input: string) {
  let clean = input.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (match) clean = match[0]
  return clean
}

function normalizeDrafts(input: unknown, limit: number, allowedTypes: GenerateQuestionType[], sources: SourceNote[]): GeneratedDraft[] {
  if (!Array.isArray(input)) return []
  const sourcePaths = new Set(sources.map(source => source.path))

  return input
    .map(item => item as Partial<GeneratedDraft>)
    .filter(Boolean)
    .map((item) => {
      const type = item.type && allowedTypes.includes(item.type) ? item.type : allowedTypes[0] || 'basic'
      const choices = Array.isArray(item.choices) ? item.choices.map(String).filter(Boolean) : []
      return {
        type,
        front: item.front || '',
        back: item.back || '',
        clozeText: item.clozeText || '',
        choices,
        tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean).slice(0, 4) : [],
        sourcePath: item.sourcePath && sourcePaths.has(item.sourcePath) ? item.sourcePath : sources[0]?.path,
        selected: true,
      }
    })
    .filter(draft => {
      if (draft.type === 'cloze') return Boolean(draft.clozeText?.trim())
      if (draft.type === 'choice') return Boolean(draft.front?.trim() && draft.back?.trim() && draft.choices && draft.choices.length >= 2)
      return Boolean(draft.front?.trim() && draft.back?.trim())
    })
    .slice(0, limit)
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
  return (value || '').replace(/\s+/g, '').replace(/[。.,，、:：；;]/g, '').toLowerCase()
}

function isChoiceLikelyCorrect(answer: string, choice: string, index: number) {
  const letter = String.fromCharCode(65 + index)
  const letterPattern = new RegExp(`(^|[^A-Z])${letter}([.、:：\\s]|$)`, 'i')
  if (letterPattern.test(answer)) return true

  const normalizedAnswer = normalizeAnswerText(answer)
  const normalizedChoice = normalizeAnswerText(choice)
  return Boolean(normalizedChoice && normalizedAnswer.includes(normalizedChoice.slice(0, 24)))
}

function getReviewAnswerDisplay(answer: string, isChoiceCard: boolean, result: 'correct' | 'wrong' | null) {
  if (!isChoiceCard || result !== 'correct') return answer

  const explanationMatch = answer.match(/(?:解析|解释|说明)\s*[:：]\s*([\s\S]+)$/)
  if (explanationMatch?.[1]?.trim()) return explanationMatch[1].trim()

  return answer
    .replace(/^正确答案\s*[:：][\s\S]*?(?:解析|解释|说明)\s*[:：]\s*/, '')
    .trim() || answer
}

function draftToCreateInput(draft: GeneratedDraft, deckId: number): CreateFlashcardInput {
  return {
    deckId,
    type: draft.type,
    front: draft.type === 'cloze' ? undefined : draft.front,
    back: draft.type === 'cloze' ? undefined : draft.back,
    clozeText: draft.type === 'choice'
      ? JSON.stringify({ choices: draft.choices || [] })
      : draft.type === 'cloze'
        ? draft.clozeText
        : undefined,
    tags: draft.tags,
    notePath: draft.sourcePath,
  }
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'dark' | 'amber' | 'green' | 'rose' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium',
        tone === 'neutral' && 'bg-neutral-100 text-neutral-600',
        tone === 'dark' && 'bg-neutral-950 text-white',
        tone === 'amber' && 'bg-amber-100 text-amber-700',
        tone === 'green' && 'bg-emerald-100 text-emerald-700',
        tone === 'rose' && 'bg-rose-100 text-rose-700',
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
        'inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-neutral-950 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-100',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
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
    <div className="border-b bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-neutral-950">{title}</div>
            <div className="truncate text-xs text-neutral-500">{description}</div>
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
  return (
    <div
      ref={dropZoneRef}
      className={cn(
        'relative flex min-h-[172px] flex-col overflow-hidden rounded-xl border bg-background p-3 transition',
        isDragging ? 'border-neutral-950 bg-muted/35 shadow-[inset_0_0_0_1px_rgba(23,23,23,0.08)]' : 'border-border/70',
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <FilePlus2 className="size-4" />
            </span>
            <span className="whitespace-nowrap">资料来源</span>
            {showDropIndicator ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  isDragging
                    ? 'border-neutral-950 bg-neutral-950 text-white'
                    : 'border-border/70 bg-background text-muted-foreground',
                )}
              >
                <MousePointer2 className="size-3" />
                拖到闪卡
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">拖入多篇笔记，AI 会合并提炼知识点。</div>
        </div>
        <div className="flex items-center gap-2">
          {sourcePath ? (
            <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-md bg-background" onClick={onUseCurrent}>
              加入当前
            </Button>
          ) : null}
          {sources.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-8 shrink-0 rounded-md text-muted-foreground" onClick={onClearSources}>
              清空
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {sources.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 text-center">
            <div>
              <div className="text-sm font-medium text-foreground">添加笔记</div>
              <div className="mt-1 text-xs text-muted-foreground">支持 Markdown / TXT，可一次加入多篇。</div>
            </div>
          </div>
        ) : (
          sources.map(source => (
            <div key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {source.status === 'loading' ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : source.status === 'error' ? (
                  <CircleAlert className="size-4 shrink-0 text-rose-500" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{source.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {source.status === 'ready' ? `${source.content.length} 字符` : source.error || '读取中'}
                  </div>
                </div>
              </div>
              <button className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => onRemoveSource(source.path)} type="button">
                <X className="size-4" />
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

  return (
    <div className="rounded-xl border border-border/70 bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">生成配置</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{activeMode?.hint || '选择生成策略'}</div>
        </div>
        <Badge tone="dark">{selectedTypes.length} 类题</Badge>
      </div>
      <div className="mt-3 space-y-3">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">模式</div>
          <div className="grid grid-cols-3 rounded-lg bg-muted p-1">
            {modeOptions.map(item => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  'rounded-md px-2 py-2 text-center text-xs font-medium transition active:scale-[0.98]',
                  mode === item.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onModeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">题型</div>
          <div className="flex flex-wrap gap-2">
            {questionTypeOptions.map(item => {
              const active = selectedTypes.includes(item.value)
              return (
                <button
                  key={item.value}
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition active:scale-[0.98]',
                    active ? 'border-foreground bg-foreground text-background' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
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
              <SelectTrigger className="h-9 rounded-lg bg-background">
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
            <div className="text-xs font-medium text-muted-foreground">数量</div>
            <Input className="h-9 rounded-lg bg-background text-center" value={count} onChange={(event) => onCountChange(event.target.value)} />
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
    <div className="rounded-xl border border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold text-foreground">卡片草稿</div>
          <div className="text-xs text-muted-foreground">{drafts.length === 0 ? '生成后在这里筛选、删除和保存。' : `${selectedCount}/${drafts.length} 张准备保存`}</div>
        </div>
        <Button size="sm" className="h-8 rounded-md bg-foreground px-3 text-background hover:bg-foreground/90" onClick={onSave} disabled={selectedCount === 0 || saving}>
          {saving ? '保存中...' : '保存选中'}
        </Button>
      </div>
      <div className="max-h-[300px] overflow-auto p-3">
        {drafts.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 text-center">
            <div>
              <div className="mx-auto flex size-9 items-center justify-center rounded-lg bg-background text-muted-foreground">
                <WalletCards className="size-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">等待生成卡片</div>
              <div className="mt-1 text-xs text-muted-foreground">确认来源和题型后点击生成。</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {drafts.map((draft, index) => (
              <div key={`${draft.type}-${index}`} className={cn('rounded-lg border border-border/70 p-3 transition', draft.selected ? 'bg-background shadow-sm' : 'bg-muted/25 opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => onToggleDraft(index)}>
                    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border', draft.selected && 'border-foreground bg-foreground text-background')}>
                      {draft.selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="dark">{getCardTypeLabel(draft.type)}</Badge>
                        {draft.tags?.slice(0, 3).map(tag => <Badge key={tag}>{tag}</Badge>)}
                      </span>
                      <span className="mt-2 block line-clamp-2 text-sm font-semibold leading-6 text-foreground">{getCardPreview(draft)}</span>
                      {draft.type === 'choice' && draft.choices && draft.choices.length > 0 ? (
                        <span className="mt-2 block text-xs text-muted-foreground">{draft.choices.join(' / ')}</span>
                      ) : null}
                    </span>
                  </button>
                  <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onRemoveDraft(index)}>
                    <Trash2 className="size-4" />
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
  return (
    <div className="rounded-xl border border-border/70 bg-background xl:sticky xl:top-3">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold text-foreground">复习队列</div>
          <div className="text-xs text-muted-foreground">{loading ? '读取中...' : `${dueCount} 待复习 · ${stats.weakCount} 薄弱 · ${stats.todayReviewedCount} 今日完成`}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 rounded-md bg-background" onClick={onWeakCards}>错题</Button>
          <Button size="sm" className="h-8 rounded-md bg-foreground text-background hover:bg-foreground/90" onClick={onReviewAll} disabled={dueCount === 0}>复习</Button>
        </div>
      </div>
      <div className="max-h-[250px] overflow-auto p-2">
        {decks.length === 0 ? (
          <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">暂无牌组。</div>
        ) : (
          decks.map(deck => {
            const cardCount = Number(deck.cardCount || 0)
            const deckDueCount = Number(deck.dueCount || 0)
            return (
              <button
                key={deck.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-muted/50"
                onClick={() => onReviewDeck(deck.id)}
                disabled={cardCount === 0}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{deck.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{cardCount} 卡 · {deckDueCount} 待复习</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
              </button>
            )
          })
        )}
      </div>
      <div className="border-t p-2">
        <Button variant="ghost" size="sm" className="h-8 w-full justify-start rounded-lg" onClick={onManageDecks}>
          <Layers3 className="mr-2 size-4" />
          管理牌组
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
  onManageDecks,
  onWeakCards,
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
  onManageDecks: () => void
  onWeakCards: () => void
}) {
  const readySourceCount = sources.filter(source => source.status === 'ready').length
  const canGenerate = readySourceCount > 0 && selectedTypes.length > 0 && Boolean(deckId)
  const hasDrafts = drafts.length > 0

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {pointerDragPreview ? (
        <div
          className={cn(
            'pointer-events-none fixed left-0 top-0 z-[9999] flex max-w-[260px] items-center gap-2 rounded-2xl border bg-white/95 px-3 py-2 text-xs font-medium text-neutral-900 shadow-[0_18px_45px_rgba(23,23,23,0.18)] backdrop-blur transition-colors',
            pointerDragPreview.overDropZone ? 'border-neutral-950' : 'border-neutral-200',
          )}
          style={{ transform: `translate3d(${pointerDragPreview.x + 6}px, ${pointerDragPreview.y + 6}px, 0)` }}
        >
          <FileText className="size-4 shrink-0" />
          <span className="truncate">{pointerDragPreview.name}</span>
        </div>
      ) : null}
      <div className="border-b bg-background px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-muted text-foreground">
              <WalletCards className="size-4" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-foreground">闪卡生成台</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dueCount > 0 ? 'amber' : 'green'}>{loading ? '--' : dueCount} 待复习</Badge>
            <Badge tone={stats.weakCount > 0 ? 'rose' : 'neutral'}>{loading ? '--' : stats.weakCount} 薄弱</Badge>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-sm text-neutral-700 transition hover:bg-neutral-100 active:scale-[0.98]"
                >
                  <SlidersHorizontal className="size-4" />
                  配置
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-[360px] rounded-xl p-0">
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
              </PopoverContent>
            </Popover>
            <IconButton icon={Plus} onClick={onCreateCard}>新建</IconButton>
            <IconButton icon={Target} onClick={onWeakCards}>错题</IconButton>
            <Button
              className="h-9 gap-1.5 rounded-xl bg-foreground px-3 text-sm text-background hover:bg-foreground/90"
              onClick={onGenerate}
              disabled={!canGenerate || generating}
            >
              {generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {generating ? '生成中...' : '生成卡片'}
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto grid max-w-6xl items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))]">
          <div className="space-y-3">
            <div className="grid items-start gap-3">
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
            </div>

            <DraftList
              drafts={drafts}
              saving={saving}
              onToggleDraft={onToggleDraft}
              onRemoveDraft={onRemoveDraft}
              onSave={onSaveDrafts}
            />
          </div>

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
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8f8f7]">
      <WorkspaceHeader title="牌组管理" description="整理卡片、移动牌组、清理无效题目。" onBack={onBack} />
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-auto p-4">
        <div className="mb-4 grid gap-2 rounded-2xl border bg-white p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input value={newDeckName} onChange={(event) => setNewDeckName(event.target.value)} placeholder="牌组名称" />
          <Input value={newDeckDescription} onChange={(event) => setNewDeckDescription(event.target.value)} placeholder="描述，可选" />
          <Button onClick={() => void handleCreateDeck()} disabled={creating}>{creating ? '创建中...' : '创建牌组'}</Button>
        </div>

        <div className="space-y-2">
          {decks.map(deck => {
            const isExpanded = expandedDeckId === deck.id
            const isEditing = editingDeckId === deck.id
            const cards = cardsByDeckId[deck.id] || []
            return (
              <div key={deck.id} className="rounded-2xl border bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                  {isEditing ? (
                    <div className="grid w-full gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                      <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
                      <Input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                      <Button onClick={() => void handleSaveDeck(deck.id)}>保存</Button>
                      <Button variant="outline" onClick={() => setEditingDeckId(null)}>取消</Button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => {
                          const nextOpen = !isExpanded
                          setExpandedDeckId(nextOpen ? deck.id : null)
                          if (nextOpen) void loadDeckCards(deck.id)
                        }}
                      >
                        <ChevronRight className={cn('size-4 text-neutral-400 transition-transform', isExpanded && 'rotate-90')} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-neutral-950">{deck.name}</span>
                          <span className="block truncate text-xs text-neutral-500">{Number(deck.cardCount || 0)} 卡 · {Number(deck.dueCount || 0)} 待复习</span>
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8 rounded-xl" onClick={() => onReviewDeck(deck.id)}>复习</Button>
                        <Button variant="ghost" size="sm" className="h-8 rounded-xl" onClick={() => {
                          setEditingDeckId(deck.id)
                          setEditName(deck.name)
                          setEditDescription(deck.description || '')
                        }}>编辑</Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => void handleDeleteDeck(deck)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                {isExpanded ? (
                  <div className="border-t p-2">
                    {cards.length === 0 ? (
                      <div className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-500">这个牌组暂无卡片。</div>
                    ) : (
                      cards.map(card => (
                        <div key={card.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-neutral-50">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge>{getCardTypeLabel(card.type)}</Badge>
                              <span className="truncate text-sm font-medium">{getCardPreview(card)}</span>
                            </div>
                            <div className="mt-1 truncate text-xs text-neutral-500">{parseTags(card.tags).join(' / ') || '暂无标签'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select value={String(card.deckId)} onValueChange={(value) => void handleMoveCard(card, Number(value))}>
                              <SelectTrigger className="h-8 w-32 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {decks.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => void handleDeleteCard(deck.id, card.id)}>
                              <Trash2 className="size-4" />
                            </Button>
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8f8f7]">
      <WorkspaceHeader
        title="错题与重点"
        description="不会、困难和标记重点的卡片会在这里集中管理。"
        onBack={onBack}
        action={<Button size="sm" className="h-8 rounded-xl" onClick={onReviewWeak} disabled={cards.length === 0}>复习错题</Button>}
      />
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-auto p-4">
        {loading ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-neutral-500">正在整理错题...</div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-center text-sm text-neutral-500">暂无错题。复习时点击“不会”后会自动进入这里。</div>
        ) : (
          <div className="space-y-2">
            {cards.map(card => (
              <div key={card.id} className="rounded-2xl border bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="rose">薄弱</Badge>
                  <Badge>{getCardTypeLabel(card.type)}</Badge>
                  {parseTags(card.tags).slice(0, 3).map(tag => <Badge key={tag}>{tag}</Badge>)}
                </div>
                <div className="mt-2 text-sm font-medium text-neutral-950">{getCardPreview(card)}</div>
              </div>
            ))}
          </div>
        )}
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
    <div className="flex min-h-0 flex-1 overflow-auto bg-background p-5">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-xl border border-border/70 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="size-6" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-semibold tracking-tight text-foreground">复习完成</div>
                <div className="mt-1 text-sm text-muted-foreground">本轮共完成 {total} 张卡片，{summaryTone}</div>
              </div>
            </div>
            <div className="rounded-xl bg-muted/35 px-5 py-3 text-right">
              <div className="text-xs font-medium text-muted-foreground">掌握率</div>
              <div className="mt-1 text-3xl font-semibold text-foreground">{masteryRate}%</div>
            </div>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${masteryRate}%` }} />
          </div>
        </section>

        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))]">
          {statItems.map(item => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-background p-4">
              <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-3xl font-semibold text-foreground">{item.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpenCheck className="size-4" />
              本轮复盘
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-muted/35 p-3">
                <div className="text-xs text-muted-foreground">已掌握</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{remembered}</div>
              </div>
              <div className="rounded-lg bg-muted/35 p-3">
                <div className="text-xs text-muted-foreground">待巩固</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{weak}</div>
              </div>
              <div className="rounded-lg bg-muted/35 p-3">
                <div className="text-xs text-muted-foreground">下一步</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{weak > 0 ? '复习错题' : '继续扩充卡片'}</div>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
              {weak > 0
                ? `有 ${weak} 张卡片需要加固，建议先进入错题队列，再回到牌组继续复习。`
                : '这一轮没有薄弱卡片，可以回到闪卡生成台继续添加新材料或管理牌组。'}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className="text-sm font-semibold text-foreground">接下来</div>
            <div className="mt-3 grid gap-2">
              <Button className="h-10 justify-start rounded-lg bg-foreground text-background hover:bg-foreground/90" onClick={onHome}>
                <WalletCards className="mr-2 size-4" />
                返回闪卡生成台
              </Button>
              <Button variant="outline" className="h-10 justify-start rounded-lg bg-background" onClick={onWeak}>
                <Target className="mr-2 size-4" />
                复习错题
              </Button>
              <Button variant="outline" className="h-10 justify-start rounded-lg bg-background" onClick={onDecks}>
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
  const [submittedAnswer, setSubmittedAnswer] = useState('')
  const [choiceResult, setChoiceResult] = useState<'correct' | 'wrong' | null>(null)
  const [reviewRecorded, setReviewRecorded] = useState(false)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deckName, setDeckName] = useState<string | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [ratingCounts, setRatingCounts] = useState<Record<FlashcardReviewRating, number>>(createRatingCounts())
  const [reviewStates, setReviewStates] = useState<Record<number, ReviewCardState>>({})

  const resetAnswerState = useCallback(() => {
    setShowAnswer(false)
    setUserAnswer('')
    setSelectedChoiceIndex(null)
    setSubmittedAnswer('')
    setChoiceResult(null)
    setReviewRecorded(false)
    setReviewSaving(false)
  }, [])

  const restoreAnswerState = useCallback((card: Flashcard | undefined, states: Record<number, ReviewCardState>) => {
    const state = card ? states[card.id] : undefined
    const choiceIndex = typeof state?.choiceIndex === 'number' ? state.choiceIndex : null

    setShowAnswer(Boolean(state?.showAnswer))
    setUserAnswer(choiceIndex === null ? state?.answer || '' : '')
    setSelectedChoiceIndex(choiceIndex)
    setSubmittedAnswer(state?.answer || '')
    setChoiceResult(state?.status === 'correct' ? 'correct' : state?.status === 'wrong' ? 'wrong' : null)
    setReviewRecorded(Boolean(state?.recorded))
    setReviewSaving(false)
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
  const choices = reviewContent?.choices || []
  const isChoiceCard = choices.length > 0
  const selectedChoice = selectedChoiceIndex === null ? '' : choices[selectedChoiceIndex] || ''
  const canSubmitAnswer = isChoiceCard ? selectedChoiceIndex !== null : userAnswer.trim().length > 0
  const progress = sessionTotal > 0 ? Math.round(((index + 1) / sessionTotal) * 100) : 0
  const answerDisplay = reviewContent
    ? getReviewAnswerDisplay(reviewContent.answer, isChoiceCard, choiceResult)
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
      await updateFlashcardReview(current.id, rating)
      setRatingCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }))
      const status: ReviewCardStatus = rating >= 2 ? 'correct' : 'wrong'
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer: submittedAnswer || userAnswer.trim(),
          choiceIndex: selectedChoiceIndex,
          showAnswer: true,
          recorded: true,
          status,
        },
      }))
      setReviewRecorded(true)
    } finally {
      setReviewSaving(false)
    }
  }, [current, reviewSaving, reviewStates, selectedChoiceIndex, submittedAnswer, userAnswer])

  const handleChoiceAnswer = useCallback(async (choiceIndex: number) => {
    if (!current || !reviewContent || showAnswer || reviewSaving) return

    const choice = choices[choiceIndex]
    if (!choice) return

    const correct = isChoiceLikelyCorrect(reviewContent.answer, choice, choiceIndex)
    const rating: FlashcardReviewRating = correct ? 3 : 0

    setSelectedChoiceIndex(choiceIndex)
    setSubmittedAnswer(choice)
    setChoiceResult(correct ? 'correct' : 'wrong')
    setShowAnswer(true)
    setReviewSaving(true)

    try {
      await updateFlashcardReview(current.id, rating)
      setRatingCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }))
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer: choice,
          choiceIndex,
          showAnswer: true,
          recorded: true,
          status: correct ? 'correct' : 'wrong',
        },
      }))
      setReviewRecorded(true)
    } catch (error) {
      toast({
        title: '记录复习结果失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setReviewSaving(false)
    }
  }, [choices, current, reviewContent, reviewSaving, showAnswer])

  const handleSubmitAnswer = useCallback(() => {
    if (!reviewContent || !canSubmitAnswer) return
    const answer = isChoiceCard ? selectedChoice : userAnswer.trim()
    setSubmittedAnswer(answer)
    setShowAnswer(true)
    if (current) {
      setReviewStates(prev => ({
        ...prev,
        [current.id]: {
          ...prev[current.id],
          answer,
          choiceIndex: selectedChoiceIndex,
          showAnswer: true,
        },
      }))
    }
  }, [canSubmitAnswer, current, isChoiceCard, reviewContent, selectedChoice, selectedChoiceIndex, userAnswer])

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

  async function toggleImportant() {
    if (!current) return
    const nextTags = isImportant ? currentTags.filter(tag => tag !== '重点') : [...currentTags, '重点']
    await updateFlashcardTags(current.id, nextTags)
    setCards(prev => prev.map(card => card.id === current.id ? { ...card, tags: serializeTags(nextTags) } : card))
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <WorkspaceHeader title="复习" description="正在准备卡片。" onBack={onBack} />
        <div className="p-4 text-sm text-muted-foreground">正在加载...</div>
      </div>
    )
  }

  if (!current) {
    return <ReviewSummary total={sessionTotal} ratingCounts={ratingCounts} onHome={onBack} onDecks={onDecks} onWeak={onWeak} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceHeader
        title={mode === 'weak' ? '错题复习' : '闪卡复习'}
        description={deckName || '全部牌组'}
        onBack={onBack}
        action={<Button variant="ghost" size="sm" className="h-8 rounded-md" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />重载</Button>}
      />
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="rounded-xl border border-border/70 bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="dark">{index + 1}/{sessionTotal}</Badge>
                <Badge>{reviewContent?.promptLabel}</Badge>
                {isImportant ? <Badge tone="amber">重点</Badge> : null}
              </div>
              <Button variant="ghost" size="sm" className="h-8 rounded-md" onClick={() => void toggleImportant()}>
                <Star className={cn('mr-2 size-4', isImportant && 'fill-amber-400 text-amber-500')} />
                {isImportant ? '取消重点' : '标重点'}
              </Button>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className="rounded-xl border border-border/70 bg-background p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{reviewContent?.promptLabel}</div>
              <div className="mt-4 whitespace-pre-wrap text-2xl font-semibold leading-relaxed text-foreground">{reviewContent?.prompt}</div>

              {isChoiceCard ? (
                <div className="mt-5 grid gap-2">
                  {choices.map((choice, choiceIndex) => {
                    const selected = selectedChoiceIndex === choiceIndex
                    const likelyCorrect = showAnswer && isChoiceLikelyCorrect(reviewContent?.answer || '', choice, choiceIndex)
                    const selectedWrong = selected && choiceResult === 'wrong'
                    return (
                      <button
                        key={`${choice}-${choiceIndex}`}
                        type="button"
                        className={cn(
                          'flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left text-sm transition',
                          !showAnswer && 'hover:border-foreground hover:bg-background',
                          selected && !showAnswer && 'border-foreground bg-background shadow-sm',
                          likelyCorrect && 'border-foreground bg-foreground text-background',
                          selectedWrong && 'border-border bg-muted text-muted-foreground',
                        )}
                        disabled={showAnswer || reviewSaving}
                        onClick={() => void handleChoiceAnswer(choiceIndex)}
                      >
                        <span className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                          selected && !showAnswer ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground',
                          likelyCorrect && 'border-background bg-background text-foreground',
                          selectedWrong && 'border-border bg-background text-muted-foreground',
                        )}>
                          {String.fromCharCode(65 + choiceIndex)}
                        </span>
                        <span className="min-w-0 flex-1 leading-6">{choice}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">作答区</div>
                  <Textarea
                    value={userAnswer}
                    onChange={(event) => setUserAnswer(event.target.value)}
                    disabled={showAnswer}
                    placeholder={current.type === 'cloze' ? '输入填空答案...' : '先写下自己的答案，再查看参考答案。'}
                    className="min-h-28 resize-none rounded-lg bg-muted/20 text-sm shadow-none"
                  />
                </div>
              )}

              {showAnswer ? (
                <div className="mt-5">
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">{isChoiceCard ? '答案解析' : reviewContent?.answerLabel}</div>
                    {isChoiceCard && choiceResult ? (
                      <div className={cn(
                        'mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold',
                        choiceResult === 'correct'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700',
                      )}>
                        {choiceResult === 'correct' ? '回答正确' : '回答错误'}
                      </div>
                    ) : null}
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{answerDisplay}</div>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="text-sm font-semibold text-foreground">本轮进度</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-muted/40 p-2">
                    <div className="text-xs text-muted-foreground">当前</div>
                    <div className="mt-1 font-semibold">{index + 1}/{sessionTotal}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2">
                    <div className="text-xs text-muted-foreground">已答</div>
                    <div className="mt-1 font-semibold">{completedCount}/{sessionTotal}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button variant="outline" className="h-8 rounded-md bg-background" disabled={index === 0 || reviewSaving} onClick={() => goToIndex(index - 1)}>
                    上一题
                  </Button>
                  <Button variant="outline" className="h-8 rounded-md bg-background" disabled={reviewSaving || reviewRecorded} onClick={() => void handleSkip()}>
                    跳过
                  </Button>
                  <Button className="h-8 rounded-md bg-foreground text-background hover:bg-foreground/90" disabled={reviewSaving} onClick={() => void goToNext()}>
                    {index >= cards.length - 1 ? '完成' : '下一题'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">答题卡</div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" />对</span>
                    <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-rose-500" />错</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-8 gap-1.5">
                  {cards.map((card, cardIndex) => {
                    const state = reviewStates[card.id]
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={cn(
                          'flex aspect-square items-center justify-center rounded-md border text-[11px] font-semibold transition',
                          state?.status === 'correct' && 'border-emerald-500 bg-emerald-500 text-white',
                          state?.status === 'wrong' && 'border-rose-500 bg-rose-500 text-white',
                          state?.status === 'skipped' && 'border-border bg-muted text-muted-foreground',
                          !state?.status && 'border-border/70 bg-background text-muted-foreground hover:bg-muted',
                          cardIndex === index && 'ring-2 ring-foreground ring-offset-2',
                        )}
                        onClick={() => goToIndex(cardIndex)}
                      >
                        {cardIndex + 1}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="text-sm font-semibold text-foreground">
                  {showAnswer && reviewRecorded ? '本题结果' : showAnswer ? '自评掌握度' : '先作答'}
                </div>
                <div className="mt-3 grid gap-2">
                  {showAnswer && reviewRecorded ? (
                    <>
                      <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                        <div className="font-semibold text-foreground">
                          {choiceResult === 'correct' ? '回答正确' : choiceResult === 'wrong' ? '回答错误' : '已记录'}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {choiceResult === 'correct'
                            ? '已降低下次出现频率。'
                            : choiceResult === 'wrong'
                              ? '已加入薄弱复习，会更快再次出现。'
                              : '已保存本题复习结果。'}
                        </div>
                      </div>
                    </>
                  ) : !showAnswer ? (
                    <>
                      {isChoiceCard ? (
                        <div className="rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                          点击选项后会立即判断对错，并自动调整下次复习频率。
                        </div>
                      ) : (
                        <Button className="h-9 rounded-md bg-foreground text-background hover:bg-foreground/90" onClick={handleSubmitAnswer} disabled={!canSubmitAnswer}>
                          提交答案
                        </Button>
                      )}
                      <Button variant="outline" className="h-9 rounded-md bg-background" onClick={handleRevealAnswer}>
                        直接看答案
                      </Button>
                      <Button variant="ghost" className="h-9 rounded-md text-muted-foreground" onClick={() => void handleSkip()}>
                        跳过本题
                      </Button>
                    </>
                  ) : (
                    ratingOptions.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className={cn('rounded-lg border px-3 py-2 text-left text-sm transition hover:-translate-y-0.5', option.className)}
                        disabled={reviewSaving}
                        onClick={() => void handleRating(option.value)}
                      >
                        <div className="font-semibold">{option.label}</div>
                        <div className="text-xs opacity-75">{option.hint}</div>
                      </button>
                    ))
                  )}
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
  const [selectedTypes, setSelectedTypes] = useState<GenerateQuestionType[]>(['choice', 'cloze', 'short-answer'])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pointerDragPreview, setPointerDragPreview] = useState<Pick<NoteGenFilePointerDragDetail, 'x' | 'y'> & { name: string; overDropZone: boolean } | null>(null)
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
    if (!cleanPath || cleanPath.startsWith('note-gen://')) return

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
      const detail = getNoteGenFilePointerDragDetail(event)
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

    window.addEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)

    return () => {
      window.removeEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
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
        '{"type":"choice|cloze|short-answer|basic","front":"","back":"","clozeText":"","choices":[""],"tags":[""],"sourcePath":""}',
        '规则：',
        '1. choice 是选择题，front 写题干，choices 给 3-5 个选项，back 写正确答案和简短解析。',
        '2. cloze 是填空题，只写 clozeText，必须使用 {{c1::答案}} 格式。',
        '3. short-answer 是简答题，front 写问题，back 写参考答案或评分要点。',
        '4. basic 是普通问答卡，front 写问题，back 写答案。',
        '5. sourcePath 必须从来源 path 中选择。',
        '6. tags 最多 4 个，短词即可。',
        '7. 不要重复已有题干；如果来源内容较少，可以从同一知识点拆成不同题型补齐。',
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
        const parsed = JSON.parse(extractJsonArray(result))
        const nextDrafts = normalizeDrafts(parsed, remaining, selectedTypes, readySources)
        normalized = mergeUniqueDrafts([...normalized, ...nextDrafts], requestedCount)
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

  if (view.name === 'weak') {
    return <WeakCardsPanel onBack={() => setView({ name: 'home' })} onReviewWeak={() => setView({ name: 'review', mode: 'weak' })} />
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
        onManageDecks={() => setView({ name: 'decks' })}
        onWeakCards={() => setView({ name: 'weak' })}
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
