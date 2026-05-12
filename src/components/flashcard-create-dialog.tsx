'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CreateFlashcardInput, FlashcardType } from '@/types/flashcard'
import { createFlashcard, ensureDefaultFlashcardDeck, getFlashcardDecks } from '@/db/flashcards'
import type { FlashcardDeck } from '@/types/flashcard'
import { fetchAi } from '@/lib/ai/chat'
import { toast } from '@/hooks/use-toast'

interface FlashcardSelectionContext {
  text: string
  fileName?: string
  notePath?: string
  startLine?: number
  endLine?: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  initialDraft?: Partial<CreateFlashcardInput> | null
  selectionContext?: FlashcardSelectionContext | null
}

const cardTypes: { value: FlashcardType; label: string; description: string }[] = [
  { value: 'choice', label: '选择题', description: '适合概念辨析、易错项和考试训练' },
  { value: 'basic', label: '基础问答', description: '适合概念、定义和结论记忆' },
  { value: 'basic-reversed', label: '双向问答', description: '适合术语和对应关系双向回忆' },
  { value: 'cloze', label: '填空题', description: '适合句子、公式或关键片段挖空' },
  { value: 'short-answer', label: '简答题', description: '适合开放题、流程题和原因分析' },
]

function stripMarkdownJsonBlock(input: string) {
  let clean = input.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim()
  const objectMatch = clean.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    clean = objectMatch[0]
  }
  return clean
}

function getCardTypeTitle(type: FlashcardType) {
  if (type === 'choice') return '新建选择题'
  if (type === 'cloze') return '新建填空卡'
  if (type === 'short-answer') return '新建简答题'
  if (type === 'basic-reversed') return '新建双向卡'
  return '新建基础卡'
}

export function FlashcardCreateDialog({
  open,
  onOpenChange,
  onCreated,
  initialDraft,
  selectionContext,
}: Props) {
  const [decks, setDecks] = useState<FlashcardDeck[]>([])
  const [deckId, setDeckId] = useState<string>('')
  const [type, setType] = useState<FlashcardType>('basic')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [clozeText, setClozeText] = useState('')
  const [choices, setChoices] = useState('')
  const [tags, setTags] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generatingDraft, setGeneratingDraft] = useState(false)

  const title = useMemo(() => getCardTypeTitle(type), [type])

  useEffect(() => {
    if (!open) return

    void (async () => {
      const deck = await ensureDefaultFlashcardDeck()
      const allDecks = await getFlashcardDecks()
      setDecks(allDecks)
      setDeckId(String(initialDraft?.deckId || deck.id))
      setType(initialDraft?.type || 'basic')
      setFront(initialDraft?.front || selectionContext?.text || '')
      setBack(initialDraft?.back || '')
      setClozeText(initialDraft?.clozeText || '')
      setChoices('')
      setTags(Array.isArray(initialDraft?.tags) ? initialDraft.tags.join(', ') : '')
    })()
  }, [initialDraft, open, selectionContext])

  async function handleGenerateDraft() {
    if (!selectionContext?.text?.trim()) {
      toast({
        title: '当前没有可用于生成的选中文本',
        description: '请先在笔记中选中一段文本，再打开闪卡创建面板。',
        variant: 'destructive',
      })
      return
    }

    setGeneratingDraft(true)
    try {
      const sourceLabel = selectionContext.fileName
        ? `${selectionContext.fileName}${selectionContext.startLine && selectionContext.endLine ? ` 第 ${selectionContext.startLine}-${selectionContext.endLine} 行` : ''}`
        : '当前选中文本'

      const prompt = [
        '你是一个帮助用户根据笔记生成闪卡的助手。',
        '请基于下面的选中文本，生成 1 张最适合复习的闪卡草稿。',
        '要求：',
        '1. 只返回严格 JSON 对象，不要返回解释。',
        '2. JSON 格式必须是 {"type":"choice|basic|basic-reversed|cloze|short-answer","front":"","back":"","clozeText":"","choices":[""],"tags":[""]}。',
        '3. 如果适合选择题，使用 choice；适合问答卡，使用 basic；适合双向记忆，使用 basic-reversed；适合填空，使用 cloze；适合开放回答，使用 short-answer。',
        '4. 如果 type 不是 cloze，则 clozeText 返回空字符串。',
        '5. 如果 type 是 cloze，则 front/back 返回空字符串，并用 {{c1::答案}} 形式生成 clozeText。',
        '6. 如果 type 是 choice，则 front 写题干，choices 返回 3-5 个选项，back 写正确答案和简短解析。',
        '7. tags 最多返回 3 个简短标签。',
        '',
        `来源：${sourceLabel}`,
        '选中文本：',
        selectionContext.text,
      ].join('\n')

      const result = await fetchAi(prompt)
      const clean = stripMarkdownJsonBlock(result)
      const parsed = JSON.parse(clean) as {
        type?: FlashcardType
        front?: string
        back?: string
        clozeText?: string
        choices?: string[]
        tags?: string[]
      }

      const nextType: FlashcardType = parsed.type && cardTypes.some(item => item.value === parsed.type)
        ? parsed.type
        : 'basic'

      setType(nextType)
      setFront(parsed.front || '')
      setBack(parsed.back || '')
      setClozeText(parsed.clozeText || '')
      setChoices(Array.isArray(parsed.choices) ? parsed.choices.filter(Boolean).join('\n') : '')
      setTags(Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean).join(', ') : '')
      toast({ title: '已生成闪卡草稿' })
    } catch (error) {
      toast({
        title: 'AI 生成草稿失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setGeneratingDraft(false)
    }
  }

  async function handleSubmit() {
    const numericDeckId = Number(deckId)
    if (!numericDeckId) return

    if (type === 'cloze' && !clozeText.trim()) {
      toast({ title: '请填写填空内容' })
      return
    }

    if (type === 'choice' && (!front.trim() || !back.trim() || choices.split('\n').filter(Boolean).length < 2)) {
      toast({ title: '请填写题干、至少两个选项和答案解析' })
      return
    }

    if (type !== 'cloze' && (!front.trim() || !back.trim())) {
      toast({ title: '请填写题面和答案' })
      return
    }

    setSubmitting(true)
    try {
      await createFlashcard({
        deckId: numericDeckId,
        type,
        front: type === 'cloze' ? undefined : front.trim(),
        back: type === 'cloze' ? undefined : back.trim(),
        clozeText: type === 'choice'
          ? JSON.stringify({ choices: choices.split('\n').map(item => item.trim()).filter(Boolean) })
          : type === 'cloze'
            ? clozeText.trim()
            : undefined,
        tags: tags
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
        notePath: initialDraft?.notePath || selectionContext?.notePath,
      })
      setFront('')
      setBack('')
      setClozeText('')
      setChoices('')
      setTags('')
      onOpenChange(false)
      onCreated?.()
      toast({ title: '闪卡已保存' })
    } catch (error) {
      toast({
        title: '保存闪卡失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            手动创建一张可复习的知识卡片，也可以基于选中文本生成草稿。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {selectionContext?.text ? (
            <div className="rounded-2xl border bg-neutral-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">当前选中文本</div>
                <Button variant="outline" size="sm" onClick={() => void handleGenerateDraft()} disabled={generatingDraft}>
                  <Sparkles className="mr-2 size-4" />
                  {generatingDraft ? '生成中...' : 'AI 生成草稿'}
                </Button>
              </div>
              {(selectionContext.fileName || selectionContext.notePath) ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {selectionContext.fileName || selectionContext.notePath}
                  {selectionContext.startLine && selectionContext.endLine
                    ? ` · 第 ${selectionContext.startLine}-${selectionContext.endLine} 行`
                    : ''}
                </div>
              ) : null}
              <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {selectionContext.text}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">牌组</div>
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
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">卡片类型</div>
              <Select value={type} onValueChange={(value) => setType(value as FlashcardType)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {cardTypes.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                {cardTypes.find(item => item.value === type)?.description}
              </div>
            </div>
          </div>

          {type === 'cloze' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">填空内容</div>
              <Textarea
                value={clozeText}
                onChange={(e) => setClozeText(e.target.value)}
                placeholder="例如：HTML 的根标签是 {{c1::html}}"
              />
            </div>
          ) : type === 'choice' ? (
            <>
              <div className="space-y-2">
                <div className="text-sm font-medium">题干</div>
                <Input value={front} onChange={(e) => setFront(e.target.value)} placeholder="选择题题干" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">选项</div>
                <Textarea value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="每行一个选项" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">答案解析</div>
                <Textarea value={back} onChange={(e) => setBack(e.target.value)} placeholder="正确答案和简短解释" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-sm font-medium">题面</div>
                <Input value={front} onChange={(e) => setFront(e.target.value)} placeholder="问题或提示" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">答案</div>
                <Textarea value={back} onChange={(e) => setBack(e.target.value)} placeholder="答案、解释或例子" />
              </div>
            </>
          )}

          <div className="space-y-2">
            <div className="text-sm font-medium">标签</div>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用英文逗号分隔，例如：AI, 面试, 概念" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '保存中...' : '保存闪卡'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
