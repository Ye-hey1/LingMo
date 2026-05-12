'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createFlashcardsBatch, ensureDefaultFlashcardDeck, getFlashcardDecks } from '@/db/flashcards'
import type { FlashcardDeck, FlashcardType } from '@/types/flashcard'
import { fetchAi } from '@/lib/ai/chat'
import { toast } from '@/hooks/use-toast'

interface FlashcardBatchGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  notePath?: string
  noteTitle?: string
  sourceContent?: string
}

interface FlashcardBatchDraft {
  type: FlashcardType
  front?: string
  back?: string
  clozeText?: string
  choices?: string[]
  tags?: string[]
}

function stripMarkdownJsonArray(input: string) {
  let clean = input.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim()
  const arrayMatch = clean.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    clean = arrayMatch[0]
  }
  return clean
}

function getDraftPreview(draft: FlashcardBatchDraft) {
  if (draft.type === 'cloze') {
    return draft.clozeText || '未生成填空内容'
  }

  if (draft.type === 'basic-reversed') {
    return draft.back || draft.front || '未生成内容'
  }

  return draft.front || '未生成内容'
}

function getDraftTypeLabel(type: FlashcardType) {
  if (type === 'choice') return '选择题'
  if (type === 'short-answer') return '简答题'
  if (type === 'basic-reversed') return '双向问答'
  if (type === 'cloze') return '填空题'
  return '基础问答'
}

function normalizeDrafts(parsed: unknown, count: number): FlashcardBatchDraft[] {
  if (!Array.isArray(parsed)) return []

  return parsed
    .filter(Boolean)
    .map((item) => {
      const draft = item as Partial<FlashcardBatchDraft>
      const type: FlashcardType = draft.type && ['choice', 'basic', 'basic-reversed', 'cloze', 'short-answer'].includes(draft.type)
        ? draft.type
        : 'basic'

      return {
        type,
        front: draft.front || '',
        back: draft.back || '',
        clozeText: draft.clozeText || '',
        choices: Array.isArray(draft.choices) ? draft.choices.filter(Boolean).map(String) : [],
        tags: Array.isArray(draft.tags) ? draft.tags.filter(Boolean).map(String) : [],
      }
    })
    .filter(draft => {
      if (draft.type === 'cloze') return Boolean(draft.clozeText.trim())
      if (draft.type === 'choice') return Boolean(draft.front?.trim() && draft.back?.trim() && draft.choices && draft.choices.length >= 2)
      return Boolean(draft.front?.trim() || draft.back?.trim())
    })
    .slice(0, count)
}

export function FlashcardBatchGenerateDialog({
  open,
  onOpenChange,
  onCreated,
  notePath,
  noteTitle,
  sourceContent,
}: FlashcardBatchGenerateDialogProps) {
  const [decks, setDecks] = useState<FlashcardDeck[]>([])
  const [deckId, setDeckId] = useState<string>('')
  const [cardCount, setCardCount] = useState('5')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<FlashcardBatchDraft[]>([])

  const trimmedSource = sourceContent?.trim() || ''
  const sourcePreview = useMemo(() => trimmedSource.slice(0, 2400), [trimmedSource])
  const sourceDisplayPreview = useMemo(() => trimmedSource.slice(0, 800), [trimmedSource])

  useEffect(() => {
    if (!open) return

    void (async () => {
      const deck = await ensureDefaultFlashcardDeck()
      const allDecks = await getFlashcardDecks()
      setDecks(allDecks)
      setDeckId(String(deck.id))
      setDrafts([])
    })()
  }, [open])

  async function handleGenerate() {
    if (!trimmedSource) {
      toast({
        title: '当前没有可用的笔记内容',
        description: '请先打开一篇笔记，再使用批量生成。',
        variant: 'destructive',
      })
      return
    }

    const requestedCount = Math.min(10, Math.max(1, Number(cardCount) || 5))
    setGenerating(true)
    try {
      const prompt = [
        '你是一个帮助用户根据笔记批量生成闪卡的助手。',
        `请基于下面的笔记内容，生成 ${requestedCount} 张高质量闪卡。`,
        '要求：',
        '1. 只返回严格 JSON 数组，不要返回解释。',
        '2. 每个数组元素格式必须是 {"type":"choice|basic|basic-reversed|cloze|short-answer","front":"","back":"","clozeText":"","choices":[""],"tags":[""]}。',
        '3. 卡片内容要覆盖不同知识点，避免重复。',
        '4. 如果适合选择题，使用 choice；适合问答卡，使用 basic；适合双向记忆，使用 basic-reversed；适合填空，使用 cloze；适合开放回答，使用 short-answer。',
        '5. 如果 type 不是 cloze，则 clozeText 返回空字符串。',
        '6. 如果 type 是 cloze，则 front/back 返回空字符串，并用 {{c1::答案}} 形式生成 clozeText。',
        '7. 如果 type 是 choice，则 front 写题干，choices 返回 3-5 个选项，back 写正确答案和简短解析。',
        '8. tags 最多返回 3 个简短标签。',
        '',
        `来源文件：${noteTitle || notePath || '当前笔记'}`,
        '笔记内容：',
        sourcePreview,
      ].join('\n')

      const result = await fetchAi(prompt)
      const clean = stripMarkdownJsonArray(result)
      const normalized = normalizeDrafts(JSON.parse(clean), requestedCount)

      if (normalized.length === 0) {
        throw new Error('AI 没有返回有效的闪卡草稿。')
      }

      setDrafts(normalized)
      toast({ title: `已生成 ${normalized.length} 张闪卡草稿` })
    } catch (error) {
      toast({
        title: '批量生成闪卡失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }

  async function handleSaveAll() {
    const numericDeckId = Number(deckId)
    if (!numericDeckId || drafts.length === 0) {
      return
    }

    setSaving(true)
    try {
      await createFlashcardsBatch(
        drafts.map(draft => ({
          deckId: numericDeckId,
          type: draft.type,
          front: draft.type === 'cloze' ? undefined : draft.front,
          back: draft.type === 'cloze' ? undefined : draft.back,
          clozeText: draft.type === 'choice'
            ? JSON.stringify({ choices: draft.choices || [] })
            : draft.type === 'cloze'
              ? draft.clozeText
              : undefined,
          tags: draft.tags || [],
          notePath,
        })),
      )
      setDrafts([])
      onOpenChange(false)
      onCreated?.()
      toast({ title: '批量闪卡已保存' })
    } catch (error) {
      toast({
        title: '保存闪卡失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>从当前笔记批量生成闪卡</DialogTitle>
          <DialogDescription>
            先生成可检查的草稿，再保存到指定牌组，避免 AI 直接写入不可控内容。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="rounded-2xl border bg-neutral-50 p-3">
            <div className="text-sm font-medium">{noteTitle || notePath || '当前笔记'}</div>
            <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
              {sourceDisplayPreview || '当前没有可用内容'}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger>
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

            <Input
              value={cardCount}
              onChange={(e) => setCardCount(e.target.value)}
              placeholder="数量"
            />

            <Button onClick={() => void handleGenerate()} disabled={generating}>
              <Sparkles className="mr-2 size-4" />
              {generating ? '生成中...' : '生成草稿'}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border p-3">
            <div className="mb-3 text-sm font-medium">生成结果</div>
            {drafts.length === 0 ? (
              <div className="rounded-xl bg-neutral-50 p-4 text-sm text-muted-foreground">还没有生成草稿。</div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-3 pr-3">
                  {drafts.map((draft, index) => (
                    <div key={`${draft.type}-${index}`} className="rounded-2xl border bg-neutral-50/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">第 {index + 1} 张 · {getDraftTypeLabel(draft.type)}</div>
                        {draft.tags && draft.tags.length > 0 ? (
                          <div className="truncate text-xs text-muted-foreground">{draft.tags.join(', ')}</div>
                        ) : null}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {getDraftPreview(draft)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || generating}>
            取消
          </Button>
          <Button onClick={() => void handleSaveAll()} disabled={saving || drafts.length === 0}>
            {saving ? '保存中...' : `保存 ${drafts.length} 张闪卡`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
