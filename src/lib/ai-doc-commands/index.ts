import {
  Brain,
  FileText,
  NotebookPen,
  Sparkles,
  Link2,
  WalletCards,
  AlignLeft,
  GitBranch,
  type LucideIcon,
} from 'lucide-react'

import {
  analyzeActivityScope,
  buildActivityReviewPrompt,
  buildHighValueConversationNote,
  getBaselineDays,
  getRecentDays,
  type ActivityGoalContext,
  type ActivityReviewKind,
} from '@/lib/activity/review'
import { loadActivityGoalSettings } from '@/lib/activity/goals'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'

export type AiDocCommandId =
  | 'today-review'
  | 'week-review'
  | 'scope-report'
  | 'retrospective'
  | 'high-value-conversations'
  | 'discover-connections'
  | 'generate-flashcards'
  | 'note-summary'
  | 'note-to-mindmap'

export interface AiDocCommandExecution {
  /** 当为 null 时表示无需调用 AI，使用 directContent 直接写入 */
  prompt: string | null
  /** 非 AI 命令的预生成内容 */
  directContent?: string
  /** 草稿默认标题 */
  title: string
  /** 范围标签，例如 "近 7 天" */
  rangeLabel: string
  /** AI 输出最大 tokens */
  maxTokens: number
  /** AI 输出温度 */
  temperature: number
  /** 不满足执行条件时的友好提示 */
  skipReason?: string
}

export interface AiDocCommand {
  id: AiDocCommandId
  title: string
  description: string
  icon: LucideIcon
  searchTerms: string[]
  buildExecution: (data: ActivityCalendarData) => Promise<AiDocCommandExecution>
}

function todayString(data: ActivityCalendarData) {
  return data.insights.today.day
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function getDefaultScopeDays(data: ActivityCalendarData) {
  const endDay = todayString(data)
  const startDay = shiftDay(endDay, -29)
  return data.days
    .filter((day) => day.day >= startDay && day.day <= endDay)
    .sort((a, b) => b.day.localeCompare(a.day))
}

async function buildAiExecution(
  kind: ActivityReviewKind,
  data: ActivityCalendarData,
  options: { rangeLabel: string; titlePrefix: string; emptyHint: string; maxTokens?: number },
): Promise<AiDocCommandExecution> {
  let scopeDays: ActivityDaySummary[]
  let baselineDays: ActivityDaySummary[] = []
  let baselineLabel = ''
  let periodDays = 0
  const todayDayKey = todayString(data)

  if (kind === 'today') {
    const todayDay = data.days.find((day) => day.day === todayDayKey)
    scopeDays = todayDay ? [todayDay] : []
    baselineDays = getBaselineDays(data, todayDayKey, 1)
    baselineLabel = '昨日'
    periodDays = 1
  } else if (kind === 'week') {
    scopeDays = getRecentDays(data, 7)
    baselineDays = getBaselineDays(data, todayDayKey, 7)
    baselineLabel = '上周（前 7 天）'
    periodDays = 7
  } else {
    scopeDays = getDefaultScopeDays(data)
    baselineDays = getBaselineDays(data, todayDayKey, 30)
    baselineLabel = '上月（前 30 天）'
    periodDays = 30
  }

  const analysis = analyzeActivityScope(scopeDays, 'all', options.rangeLabel)
  const baseline = baselineDays.length
    ? analyzeActivityScope(baselineDays, 'all', baselineLabel)
    : undefined
  const title = `${options.titlePrefix}-${analysis.endDay || todayDayKey}`

  if (!analysis.totalCount) {
    return {
      prompt: null,
      title,
      rangeLabel: options.rangeLabel,
      maxTokens: options.maxTokens || 1600,
      temperature: 0.4,
      skipReason: options.emptyHint,
    }
  }

  // 仅月度复盘 / 知识盘点 / 周回顾 引入"目标对照"，今日回顾粒度太细不强行套
  let goal: ActivityGoalContext | undefined
  if (kind !== 'today' && periodDays > 0) {
    try {
      const settings = await loadActivityGoalSettings()
      goal = { daily: settings, periodDays }
    } catch {
      goal = undefined
    }
  }

  return {
    prompt: buildActivityReviewPrompt(kind, analysis, baseline, goal),
    title,
    rangeLabel: options.rangeLabel,
    maxTokens: options.maxTokens || 1600,
    temperature: 0.4,
  }
}

export const AI_DOC_COMMANDS: AiDocCommand[] = [
  {
    id: 'today-review',
    title: '今日回顾',
    description: '基于今日活动生成回顾草稿',
    icon: Sparkles,
    searchTerms: ['today', 'review', '今日', '回顾', 'jrhg', 'jinrihuigu'],
    buildExecution: async (data) =>
      buildAiExecution('today', data, {
        rangeLabel: '今日',
        titlePrefix: '今日回顾',
        emptyHint: '今日暂无活动数据，无法生成回顾。',
      }),
  },
  {
    id: 'week-review',
    title: '本周回顾',
    description: '汇总最近 7 天的产出与对话',
    icon: Sparkles,
    searchTerms: ['week', 'review', '本周', '周', '7天', 'bzhg', 'benzhouhuigu'],
    buildExecution: async (data) =>
      buildAiExecution('week', data, {
        rangeLabel: '近 7 天',
        titlePrefix: '本周回顾',
        emptyHint: '近 7 天暂无活动数据，无法生成回顾。',
      }),
  },
  {
    id: 'scope-report',
    title: '知识盘点',
    description: '按主题聚类近 30 天的产出，输出可沉淀清单',
    icon: NotebookPen,
    searchTerms: ['scope', 'inventory', 'knowledge', '知识', '盘点', '整理', '产出', 'zspd', 'zhishipd'],
    buildExecution: async (data) =>
      buildAiExecution('scope', data, {
        rangeLabel: '近 30 天',
        titlePrefix: '知识盘点',
        emptyHint: '近 30 天暂无活动数据，无法生成整理。',
      }),
  },
  {
    id: 'retrospective',
    title: '月度复盘',
    description: 'STAR + 目标偏差视角的严肃复盘文档',
    icon: FileText,
    searchTerms: ['retrospective', 'report', '复盘', '月度', 'fp', 'ydfp', 'yuedufupan'],
    buildExecution: async (data) =>
      buildAiExecution('report', data, {
        rangeLabel: '近 30 天',
        titlePrefix: '月度复盘',
        emptyHint: '近 30 天暂无活动数据，无法生成复盘文档。',
        maxTokens: 2200,
      }),
  },
  {
    id: 'high-value-conversations',
    title: '沉淀对话',
    description: '将近 30 天的高价值对话整理成笔记（无需 AI）',
    icon: Brain,
    searchTerms: ['high', 'conversation', '沉淀', '对话', '高价值', 'cd', 'chendian'],
    buildExecution: async (data) => {
      const scopeDays = getDefaultScopeDays(data)
      const analysis = analyzeActivityScope(scopeDays, 'all', '近 30 天')
      const today = todayString(data)
      const title = `高价值对话沉淀-${analysis.endDay || today}`

      if (!analysis.highValueConversations.length) {
        return {
          prompt: null,
          title,
          rangeLabel: '近 30 天',
          maxTokens: 0,
          temperature: 0,
          skipReason: '近 30 天没有识别到高价值对话。',
        }
      }

      return {
        prompt: null,
        directContent: buildHighValueConversationNote(analysis),
        title,
        rangeLabel: '近 30 天',
        maxTokens: 0,
        temperature: 0,
      }
    },
  },
  // ============ 知识管理类命令 ============
  {
    id: 'discover-connections',
    title: '关联发现',
    description: '发现当前笔记与其他笔记的潜在关联',
    icon: Link2,
    searchTerms: ['关联', '发现', '链接', '相关', 'connection', 'link', 'related', 'discover', 'glfx', 'guanlian'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()

      if (!activeFilePath || !activeFilePath.endsWith('.md')) {
        return {
          prompt: null,
          title: '关联发现',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '请先打开一篇笔记再使用此命令。',
        }
      }

      if (!currentArticle || currentArticle.trim().length < 20) {
        return {
          prompt: null,
          title: '关联发现',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '当前笔记内容太少，无法进行关联分析。',
        }
      }

      const fileName = activeFilePath.split('/').pop() || activeFilePath
      const contentPreview = currentArticle.slice(0, 3000)

      return {
        prompt: `请分析当前笔记"${fileName}"的内容，找出其中的核心概念和主题，然后使用 get_connected_notes 工具查找与之相关的笔记。如果没有直接关联，请使用 safe_grep 搜索笔记中出现的关键词，发现潜在的关联笔记。

当前笔记内容：
${contentPreview}

请完成以下任务：
1. 提取当前笔记的 3-5 个核心关键词
2. 使用工具查找相关笔记
3. 分析关联关系，给出关联建议（哪些笔记可以互相链接）
4. 如果发现孤立的知识点，建议创建新的关联

输出格式要求：用清晰的 Markdown 列表展示发现的关联。`,
        title: `关联发现-${fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1600,
        temperature: 0.3,
      }
    },
  },
  {
    id: 'generate-flashcards',
    title: '生成闪卡',
    description: '从当前笔记内容自动生成复习闪卡',
    icon: WalletCards,
    searchTerms: ['闪卡', '卡片', '复习', '记忆', 'flashcard', 'card', 'review', 'memory', 'sk', 'shankapianyuxi'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()

      if (!activeFilePath || !activeFilePath.endsWith('.md')) {
        return {
          prompt: null,
          title: '生成闪卡',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '请先打开一篇笔记再使用此命令。',
        }
      }

      if (!currentArticle || currentArticle.trim().length < 50) {
        return {
          prompt: null,
          title: '生成闪卡',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '当前笔记内容太少，无法生成有意义的闪卡。',
        }
      }

      const fileName = activeFilePath.split('/').pop() || activeFilePath

      return {
        prompt: `请基于当前笔记"${fileName}"的内容，使用 generate_flashcards 工具生成闪卡。

要求：
- 从笔记中提取最重要的知识点
- 生成 6 张闪卡（可包含基础问答、填空、选择题）
- 难度适中，覆盖笔记的核心内容
- 自动保存到默认牌组

请调用 generate_flashcards 工具，参数为：
- filePath: "${activeFilePath}"
- count: 6
- difficulty: "medium"
- autoSave: true`,
        title: `闪卡-${fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1200,
        temperature: 0.4,
      }
    },
  },
  {
    id: 'note-summary',
    title: '笔记摘要',
    description: '为当前笔记生成结构化摘要',
    icon: AlignLeft,
    searchTerms: ['摘要', '总结', '概括', '提炼', 'summary', 'abstract', 'digest', 'zy', 'zhaiyao'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()

      if (!activeFilePath || !activeFilePath.endsWith('.md')) {
        return {
          prompt: null,
          title: '笔记摘要',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '请先打开一篇笔记再使用此命令。',
        }
      }

      if (!currentArticle || currentArticle.trim().length < 100) {
        return {
          prompt: null,
          title: '笔记摘要',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '当前笔记内容太少，无法生成有意义的摘要。',
        }
      }

      const fileName = activeFilePath.split('/').pop() || activeFilePath
      const contentPreview = currentArticle.slice(0, 5000)

      return {
        prompt: `请为笔记"${fileName}"生成一份结构化摘要。

笔记内容：
${contentPreview}

要求：
1. 一句话概括（不超过 30 字）
2. 核心要点（3-5 个要点，每个不超过 2 句话）
3. 关键词标签（5-8 个关键词）
4. 如果笔记中有待办事项或行动项，单独列出

输出格式：使用清晰的 Markdown 格式，便于直接阅读。`,
        title: `摘要-${fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1200,
        temperature: 0.3,
      }
    },
  },
  {
    id: 'note-to-mindmap',
    title: '笔记转图',
    description: '将当前笔记内容转为思维导图',
    icon: GitBranch,
    searchTerms: ['思维导图', '导图', '脑图', 'mindmap', 'mind', 'map', 'diagram', '转图', 'swdt', 'bjzt'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()

      if (!activeFilePath || !activeFilePath.endsWith('.md')) {
        return {
          prompt: null,
          title: '笔记转图',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '请先打开一篇笔记再使用此命令。',
        }
      }

      if (!currentArticle || currentArticle.trim().length < 50) {
        return {
          prompt: null,
          title: '笔记转图',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '当前笔记内容太少，无法生成思维导图。',
        }
      }

      const fileName = activeFilePath.split('/').pop()?.replace(/\.md$/i, '') || '思维导图'

      // 预提取笔记的结构骨架（标题+列表），帮助 AI 快速理解层次
      const structureSkeleton = extractNoteSkeleton(currentArticle)
      const isLongNote = currentArticle.length > 3000

      // 对长笔记：顶部放结构骨架，底部附完整内容；短笔记直接发全文
      const contentSection = isLongNote
        ? `## 笔记结构概览（快速参考）\n\n${structureSkeleton}\n\n## 笔记完整内容（用于补充细节）\n\n${currentArticle}`
        : `## 笔记完整内容\n\n${currentArticle}`

      return {
        prompt: `将笔记"${fileName}"转为思维导图。先看结构概览把握全貌，再从完整内容中补充细节。

${contentSection}

## 要求

- 根节点：核心主题。一级分支：主要章节。二级：知识点。三级：细节/数据。
- 保留重要数据、术语、因果关系，每节点一句话以内。
- 禁止：根节点与一级重复、遗漏重要段落、过度压缩为几个字。

调用 create_diagram_from_outline，参数：
- outline: Markdown 列表层级大纲（不含根节点，从一级分支开始）
- title: "${fileName}"
- kind: "mindmap"
- layout: "mindmap"
- fileName: "${fileName}-思维导图"
- openAfterCreate: true`,
        title: `思维导图-${fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 3000,
        temperature: 0.2,
      }
    },
  },
]

/** 从笔记中提取结构骨架：标题层级 + 列表项，帮助 AI 快速理解文章结构 */
function extractNoteSkeleton(content: string): string {
  const lines = content.split('\n')
  const skeletonLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 标题行（保留层级）
    if (/^#{1,6}\s+/.test(trimmed)) {
      skeletonLines.push(trimmed)
    }
    // 列表项（保留缩进层级）
    else if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0
      const level = Math.floor(indent / 2)
      const prefix = '  '.repeat(level) + '- '
      const text = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '')
      skeletonLines.push(prefix + text)
    }
    // 加粗行（通常是关键句）
    else if (/^\*\*.*\*\*$/.test(trimmed)) {
      skeletonLines.push('- ' + trimmed.replace(/\*\*/g, ''))
    }
  }

  return skeletonLines.join('\n')
}

export function findAiDocCommand(id: AiDocCommandId): AiDocCommand | undefined {
  return AI_DOC_COMMANDS.find((cmd) => cmd.id === id)
}

export function filterAiDocCommands(query: string): AiDocCommand[] {
  if (!query) return AI_DOC_COMMANDS
  const q = query.toLowerCase()
  return AI_DOC_COMMANDS.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.searchTerms.some((term) => term.toLowerCase().includes(q)),
  )
}
