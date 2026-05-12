import { Tool, ToolResult } from '../types'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { fetchAi } from '@/lib/ai/chat'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions } from '@/lib/workspace'
import { createFlashcardsBatch, ensureDefaultFlashcardDeck, getDueFlashcards, getFlashcardDeckById, getFlashcardLearningStats, getWeakFlashcards } from '@/db/flashcards'
import type { CreateFlashcardInput, FlashcardType } from '@/types/flashcard'

interface FlashcardDraft {
  type: FlashcardType
  front?: string
  back?: string
  clozeText?: string
  choices?: string[]
  tags?: string[]
}

const SUPPORTED_TYPES: FlashcardType[] = ['basic', 'basic-reversed', 'cloze', 'choice', 'short-answer']

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractJsonArray(raw: string) {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) {
    throw new Error('AI 未返回 JSON 数组')
  }
  return match[0]
}

function normalizeDrafts(parsed: unknown, maxCount: number): FlashcardDraft[] {
  if (!Array.isArray(parsed)) return []

  return parsed
    .map(item => {
      const draft = (item || {}) as Partial<FlashcardDraft>
      const nextType = SUPPORTED_TYPES.includes(draft.type as FlashcardType)
        ? draft.type as FlashcardType
        : 'basic'

      const nextDraft: FlashcardDraft = {
        type: nextType,
        front: normalizeText(draft.front),
        back: normalizeText(draft.back),
        clozeText: normalizeText(draft.clozeText),
        choices: Array.isArray(draft.choices)
          ? draft.choices.map(choice => String(choice).trim()).filter(Boolean)
          : [],
        tags: Array.isArray(draft.tags)
          ? draft.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 4)
          : [],
      }

      return nextDraft
    })
    .filter(draft => {
      if (draft.type === 'cloze') {
        return Boolean(draft.clozeText)
      }
      if (draft.type === 'choice') {
        return Boolean(draft.front && draft.back && draft.choices && draft.choices.length >= 2)
      }
      return Boolean(draft.front || draft.back)
    })
    .slice(0, maxCount)
}

function getDraftKey(draft: FlashcardDraft) {
  return [draft.type, draft.front || '', draft.back || '', draft.clozeText || ''].join('::')
}

function mergeUniqueDrafts(drafts: FlashcardDraft[], maxCount: number) {
  const seen = new Set<string>()
  const merged: FlashcardDraft[] = []

  for (const draft of drafts) {
    const key = getDraftKey(draft)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(draft)
    if (merged.length >= maxCount) break
  }

  return merged
}

function getDifficultyGuide(difficulty: string) {
  if (difficulty === 'hard') {
    return '更强调易混淆点、边界条件和反例，问题尽量具有挑战性。'
  }
  if (difficulty === 'basic') {
    return '优先覆盖基础定义与核心概念，问题简洁直接。'
  }
  return '难度适中，覆盖定义、原理和应用场景。'
}

function getCardPreview(draft: Pick<FlashcardDraft, 'type' | 'front' | 'back' | 'clozeText'>) {
  if (draft.type === 'cloze') {
    return draft.clozeText || ''
  }
  return draft.front || draft.back || ''
}

async function readNoteContent(filePath: string) {
  const safePath = await ensureSafeWorkspaceRelativePath(filePath)
  const { path, baseDir } = await getFilePathOptions(safePath)
  const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
  return {
    safePath,
    content: content.trim(),
  }
}

async function generateDraftsFromNote(
  safePath: string,
  noteContent: string,
  count: number,
  difficulty: string
) {
  const limitedContent = noteContent.slice(0, 7000)
  const prompt = [
    '你是学习卡片生成助手。',
    `请基于笔记内容生成 ${count} 张闪卡草稿。`,
    `难度要求：${getDifficultyGuide(difficulty)}`,
    '仅返回 JSON 数组，不要解释，不要 markdown 代码块。',
    '数组元素格式：{"type":"basic|basic-reversed|cloze|choice|short-answer","front":"","back":"","clozeText":"","choices":[""],"tags":[""]}',
    '规则：',
    '1. cloze 类型必须使用 {{c1::答案}} 形式放在 clozeText。',
    '2. choice 类型至少 3 个选项，back 里写正确答案与一句解析。',
    '3. tags 最多 4 个短词。',
    '4. 不要重复题干，尽量覆盖不同知识点。',
    '',
    `来源文件：${safePath}`,
    '笔记内容：',
    limitedContent,
  ].join('\n')

  let drafts: FlashcardDraft[] = []

  for (let attempt = 0; attempt < 3 && drafts.length < count; attempt += 1) {
    const remaining = count - drafts.length
    const result = await fetchAi(`${prompt}\n\n本轮还需要 ${remaining} 张，必须返回恰好 ${remaining} 张。`)
    const parsed = JSON.parse(extractJsonArray(result))
    const normalized = normalizeDrafts(parsed, remaining)
    drafts = mergeUniqueDrafts([...drafts, ...normalized], count)
  }

  return drafts
}

function draftToCreateInput(draft: FlashcardDraft, deckId: number, notePath: string): CreateFlashcardInput {
  const tags = draft.tags?.filter(Boolean) || []

  return {
    deckId,
    type: draft.type,
    front: draft.type === 'cloze' ? undefined : draft.front || undefined,
    back: draft.type === 'cloze' ? undefined : draft.back || undefined,
    clozeText: draft.type === 'choice'
      ? JSON.stringify({ choices: draft.choices || [] })
      : draft.type === 'cloze'
        ? draft.clozeText || undefined
        : undefined,
    tags,
    notePath,
  }
}

export const generateFlashcardsTool: Tool = {
  name: 'generate_flashcards',
  description: `Generate flashcard drafts from a Markdown note. Can optionally save directly to a deck.

Use this to build a note -> flashcards learning loop.`,
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Relative path of note file, e.g. "agent-notes/react-hooks.md"',
      required: true,
    },
    {
      name: 'deckId',
      type: 'number',
      description: 'Optional deck ID. Required when autoSave=true and you do not want default deck.',
      required: false,
    },
    {
      name: 'count',
      type: 'number',
      description: 'Optional number of flashcards to generate (1-20, default 6)',
      required: false,
    },
    {
      name: 'difficulty',
      type: 'string',
      description: 'Optional difficulty: basic | medium | hard (default medium)',
      required: false,
    },
    {
      name: 'autoSave',
      type: 'boolean',
      description: 'If true, save generated drafts to flashcard deck immediately.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { safePath, content } = await readNoteContent(params.filePath)
      if (!content) {
        return {
          success: false,
          error: '笔记内容为空，无法生成闪卡',
        }
      }

      const count = clampNumber(params.count, 1, 20, 6)
      const difficulty = ['basic', 'medium', 'hard'].includes(params.difficulty) ? params.difficulty : 'medium'
      const autoSave = Boolean(params.autoSave)

      const drafts = await generateDraftsFromNote(safePath, content, count, difficulty)
      if (drafts.length === 0) {
        return {
          success: false,
          error: 'AI 未生成有效闪卡，请稍后重试',
        }
      }

      let targetDeckId: number | null = null
      if (typeof params.deckId === 'number') {
        const deck = await getFlashcardDeckById(params.deckId)
        if (!deck) {
          return {
            success: false,
            error: `未找到 deckId=${params.deckId} 的牌组`,
          }
        }
        targetDeckId = deck.id
      }

      if (autoSave && !targetDeckId) {
        const defaultDeck = await ensureDefaultFlashcardDeck()
        targetDeckId = defaultDeck.id
      }

      let savedCount = 0
      if (autoSave && targetDeckId) {
        const inputs = drafts.map(draft => draftToCreateInput(draft, targetDeckId as number, safePath))
        await createFlashcardsBatch(inputs)
        savedCount = inputs.length
      }

      return {
        success: true,
        data: {
          filePath: safePath,
          draftCount: drafts.length,
          savedCount,
          deckId: targetDeckId,
          drafts: drafts.map((draft, index) => ({
            index: index + 1,
            type: draft.type,
            preview: getCardPreview(draft),
            tags: draft.tags || [],
          })),
        },
        message: autoSave
          ? `已生成并保存 ${savedCount} 张闪卡`
          : `已生成 ${drafts.length} 张闪卡草稿（未保存）`,
      }
    } catch (error) {
      return {
        success: false,
        error: `生成闪卡失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const getStudyInsightsTool: Tool = {
  name: 'get_study_insights',
  description: `Analyze flashcard review status and return actionable study suggestions based on weak cards and due cards.`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'limit',
      type: 'number',
      description: 'Optional number of weak cards to inspect (5-100, default 20)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const limit = clampNumber(params.limit, 5, 100, 20)
      const [stats, weakCards, dueCards] = await Promise.all([
        getFlashcardLearningStats(),
        getWeakFlashcards(limit),
        getDueFlashcards(),
      ])

      const weakPreviews = weakCards.slice(0, 10).map(card => ({
        id: card.id,
        deckId: card.deckId,
        preview: card.front || card.clozeText || card.back || '(empty)',
      }))

      const suggestions: string[] = []
      if (dueCards.length > 0) {
        suggestions.push(`- 当前有 ${dueCards.length} 张到期卡片，建议优先完成到期复习。`)
      } else {
        suggestions.push('- 当前没有到期卡片，可用于扩充新卡片或做难点复盘。')
      }

      if (stats.weakCount > 0) {
        suggestions.push(`- 当前薄弱卡片 ${stats.weakCount} 张，建议先进行“错题复习”再进入新卡片学习。`)
      } else {
        suggestions.push('- 当前薄弱卡片较少，可适当提高新卡片学习量。')
      }

      if (stats.todayReviewedCount > 0) {
        suggestions.push(`- 今日复习 ${stats.todayReviewedCount} 张，掌握率 ${stats.todayMasteryRate}%。`)
      } else {
        suggestions.push('- 今日尚未开始复习，建议先完成一轮 10-20 张快速复习。')
      }

      return {
        success: true,
        data: {
          stats,
          dueCount: dueCards.length,
          weakCards: weakPreviews,
          suggestions,
        },
        message: `学习洞察已生成：\n${suggestions.join('\n')}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `生成学习洞察失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const flashcardTools: Tool[] = [
  generateFlashcardsTool,
  getStudyInsightsTool,
]
