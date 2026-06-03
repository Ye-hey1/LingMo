/**
 * 斜杠命令定义
 *
 * 设计参考 claude-code-source 的命令架构：
 * - 每个命令是独立的 type: 'prompt' | 'local'
 * - 按 category 分组显示
 * - 支持 searchTerms 跨语言搜索
 * - description 简短（一行），prompt 详细
 *
 * 分组策略：
 * 📊 回顾：今日/本周/月度/知识盘点
 * 📝 笔记：摘要/费曼/闪卡/关联/链接
 * 🎨 可视化：思维导图/视觉报告/简报/海报
 *
 * 精简原则：
 * - 移除重复功能的命令
 * - 合并相似命令
 * - 保留最高频使用的命令
 */

import {
  Brain,
  FileText,
  NotebookPen,
  Sparkles,
  Link2,
  WalletCards,
  AlignLeft,
  BrainCircuit,
  GitBranch,
  Presentation,
  Image,
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

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type AiDocCommandId =
  // 回顾类
  | 'today-review'
  | 'week-review'
  | 'month-review'
  // 笔记类
  | 'note-summary'
  | 'feynman-socratic'
  | 'generate-flashcards'
  | 'discover-connections'
  | 'auto-wikilink'
  // 可视化类
  | 'note-to-mindmap'
  | 'note-to-visual-report'
  | 'note-to-deck-brief'
  | 'note-to-poster-card'

export type CommandCategory = 'review' | 'note' | 'visual'

export interface AiDocCommandExecution {
  /** null = 不需要 AI，使用 directContent 直接写入 */
  prompt: string | null
  directContent?: string
  title: string
  rangeLabel: string
  maxTokens: number
  temperature: number
  skipReason?: string
}

export interface AiDocCommand {
  id: AiDocCommandId
  title: string
  description: string
  icon: LucideIcon
  category: CommandCategory
  /** 需要 agent 模式（工具调用）的命令标记 */
  executionMode?: 'chat' | 'agent'
  searchTerms: string[]
  buildExecution: (data: ActivityCalendarData | null) => Promise<AiDocCommandExecution>
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function todayString(data: ActivityCalendarData | null) {
  return data?.insights?.today?.day || new Date().toISOString().slice(0, 10)
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

function extractNoteSkeleton(content: string): string {
  const lines = content.split('\n')
  const skeletonLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#{1,6}\s+/.test(trimmed)) {
      skeletonLines.push(trimmed)
    } else if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0
      const level = Math.floor(indent / 2)
      const prefix = '  '.repeat(level) + '- '
      const text = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '')
      skeletonLines.push(prefix + text)
    } else if (/^\*\*.*\*\*$/.test(trimmed)) {
      skeletonLines.push('- ' + trimmed.replace(/\*\*/g, ''))
    }
  }
  return skeletonLines.join('\n')
}

/** 要求打开笔记的前置检查 */
async function requireOpenNote(): Promise<{ filePath: string; fileName: string; content: string } | { error: string }> {
  const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()
  if (!activeFilePath || !activeFilePath.endsWith('.md')) {
    return { error: '请先打开一篇笔记再使用此命令。' }
  }
  return {
    filePath: activeFilePath,
    fileName: activeFilePath.split('/').pop()?.replace(/\.md$/i, '') || '笔记',
    content: currentArticle || '',
  }
}

// ---------------------------------------------------------------------------
// 回顾类命令构建器
// ---------------------------------------------------------------------------

async function buildReviewExecution(
  kind: ActivityReviewKind,
  data: ActivityCalendarData,
  options: { rangeLabel: string; titlePrefix: string; emptyHint: string; maxTokens?: number },
): Promise<AiDocCommandExecution> {
  const todayDayKey = todayString(data)
  let scopeDays: ActivityDaySummary[]
  let baselineDays: ActivityDaySummary[] = []
  let baselineLabel = ''
  let periodDays = 0

  if (kind === 'today') {
    const todayDay = data.days.find((day) => day.day === todayDayKey)
    scopeDays = todayDay ? [todayDay] : []
    baselineDays = getBaselineDays(data, todayDayKey, 1)
    baselineLabel = '昨日'
    periodDays = 1
  } else if (kind === 'week') {
    scopeDays = getRecentDays(data, 7)
    baselineDays = getBaselineDays(data, todayDayKey, 7)
    baselineLabel = '上周'
    periodDays = 7
  } else {
    scopeDays = getDefaultScopeDays(data)
    baselineDays = getBaselineDays(data, todayDayKey, 30)
    baselineLabel = '上月'
    periodDays = 30
  }

  const analysis = analyzeActivityScope(scopeDays, 'all', options.rangeLabel)
  const baseline = baselineDays.length ? analyzeActivityScope(baselineDays, 'all', baselineLabel) : undefined
  const title = `${options.titlePrefix}-${analysis.endDay || todayDayKey}`

  if (!analysis.totalCount) {
    return { prompt: null, title, rangeLabel: options.rangeLabel, maxTokens: options.maxTokens || 1600, temperature: 0.4, skipReason: options.emptyHint }
  }

  let goal: ActivityGoalContext | undefined
  if (kind !== 'today' && periodDays > 0) {
    try { goal = { daily: await loadActivityGoalSettings(), periodDays } } catch { goal = undefined }
  }

  return { prompt: buildActivityReviewPrompt(kind, analysis, baseline, goal), title, rangeLabel: options.rangeLabel, maxTokens: options.maxTokens || 1600, temperature: 0.4 }
}

// ---------------------------------------------------------------------------
// 命令定义
// ---------------------------------------------------------------------------

export const AI_DOC_COMMANDS: AiDocCommand[] = [
  // ============================================================
  // 📊 回顾类
  // ============================================================
  {
    id: 'today-review',
    title: '今日回顾',
    description: '基于今日活动生成回顾草稿',
    icon: Sparkles,
    category: 'review',
    searchTerms: ['today', 'review', '今日', '回顾', 'jrhg'],
    buildExecution: (data) => data
      ? buildReviewExecution('today', data, { rangeLabel: '今日', titlePrefix: '今日回顾', emptyHint: '今日暂无活动数据，无法生成回顾。' })
      : Promise.resolve({ prompt: null, title: '今日回顾', rangeLabel: '今日', maxTokens: 0, temperature: 0, skipReason: '活动数据不可用。' }),
  },
  {
    id: 'week-review',
    title: '本周回顾',
    description: '汇总最近 7 天的产出与对话',
    icon: Sparkles,
    category: 'review',
    searchTerms: ['week', 'review', '本周', '周', '7天', 'bzhg'],
    buildExecution: (data) => data
      ? buildReviewExecution('week', data, { rangeLabel: '近 7 天', titlePrefix: '本周回顾', emptyHint: '近 7 天暂无活动数据。' })
      : Promise.resolve({ prompt: null, title: '本周回顾', rangeLabel: '近 7 天', maxTokens: 0, temperature: 0, skipReason: '活动数据不可用。' }),
  },
  {
    id: 'month-review',
    title: '月度复盘',
    description: 'STAR + 目标偏差视角的严肃复盘 + 知识盘点',
    icon: FileText,
    category: 'review',
    searchTerms: ['month', 'retrospective', 'report', '复盘', '月度', '盘点', 'ydfp'],
    buildExecution: (data) => data
      ? buildReviewExecution('report', data, { rangeLabel: '近 30 天', titlePrefix: '月度复盘', emptyHint: '近 30 天暂无活动数据。', maxTokens: 2200 })
      : Promise.resolve({ prompt: null, title: '月度复盘', rangeLabel: '近 30 天', maxTokens: 0, temperature: 0, skipReason: '活动数据不可用。' }),
  },

  // ============================================================
  // 📝 笔记类
  // ============================================================
  {
    id: 'note-summary',
    title: '笔记摘要',
    description: '为当前笔记生成结构化摘要和关键词',
    icon: AlignLeft,
    category: 'note',
    searchTerms: ['摘要', '总结', '概括', '提炼', 'summary', 'abstract', 'zy'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '笔记摘要', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 100) return { prompt: null, title: '笔记摘要', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少，无法生成摘要。' }

      return {
        prompt: `为笔记"${note.fileName}"生成结构化摘要。

内容：
${note.content.slice(0, 5000)}

要求：
1. 一句话概括（≤30字）
2. 核心要点（3-5个，每个≤2句）
3. 关键词标签（5-8个）
4. 如有待办事项，单独列出

用清晰的 Markdown 格式输出。`,
        title: `摘要-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1200,
        temperature: 0.3,
      }
    },
  },
  {
    id: 'feynman-socratic',
    title: '费曼追问',
    description: '用费曼学习法 + 苏格拉底式追问检测理解深度',
    icon: BrainCircuit,
    category: 'note',
    searchTerms: ['费曼', '追问', '苏格拉底', '学习', '理解', 'feynman', 'socratic', 'fm'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()
      const hasNote = Boolean(activeFilePath && !activeFilePath.includes('://') && currentArticle?.trim())
      const fileName = activeFilePath?.split('/').pop()?.replace(/\.md$/i, '') || '当前主题'

      return {
        prompt: `你现在是"费曼追问"学习教练。

核心原则：
- 用户必须先解释，你不直接讲完整答案
- 通过追问暴露知识漏洞
- 每轮只问一个关键问题
- 连续卡住才给最小提示
- 识别含糊词、跳步推理、概念混淆、缺少例子、错误因果

评分维度：概念准确性 25 | 机制解释 25 | 例子质量 20 | 边界反例 15 | 表达清晰度 15

评分限制：
- 没解释机制 ≤70 | 没举例 ≤80 | 概念明显错误 ≤60
- 只背定义 ≤65 | 能举例但不解释为什么 ≤75 | 能解释但不能说明边界 ≤85

每轮输出格式：
1. 理解度：N/100（变化：+N/-N/0）
2. 当前薄弱点：一句话
3. 简短反馈：一句话
4. 下一追问：只问一个关键问题

第一条回复：让用户选择一个概念并用自己的话解释。
${hasNote ? `当前笔记：${fileName}\n笔记内容仅用于校验，不要直接复述：\n${currentArticle!.slice(0, 6000)}` : '请先询问用户想学习的主题，并要求用户用自己的话解释。'}`,
        title: `费曼追问-${fileName}`,
        rangeLabel: hasNote ? '当前笔记' : '手动主题',
        maxTokens: 1600,
        temperature: 0.35,
      }
    },
  },
  {
    id: 'generate-flashcards',
    title: '生成闪卡',
    description: '从当前笔记自动生成 6 张复习闪卡',
    icon: WalletCards,
    category: 'note',
    executionMode: 'agent',
    searchTerms: ['闪卡', '卡片', '复习', '记忆', 'flashcard', 'card', 'sk'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '生成闪卡', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 50) return { prompt: null, title: '生成闪卡', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      return {
        prompt: `基于笔记"${note.fileName}"生成闪卡。调用 generate_flashcards 工具：
- filePath: "${note.filePath}"
- count: 6
- difficulty: "medium"
- autoSave: true`,
        title: `闪卡-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1200,
        temperature: 0.4,
      }
    },
  },
  {
    id: 'discover-connections',
    title: '关联发现',
    description: '发现当前笔记与其他笔记的潜在关联',
    icon: Link2,
    category: 'note',
    executionMode: 'agent',
    searchTerms: ['关联', '发现', '链接', '相关', 'connection', 'link', 'glfx'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '关联发现', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 20) return { prompt: null, title: '关联发现', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      return {
        prompt: `分析笔记"${note.fileName}"的关联关系。

1. 调用 get_connected_notes：{"filePath": "${note.filePath}"}
2. 如无结果，调用 safe_grep 搜索关键词
3. 用 Final Answer 输出关联分析报告

笔记核心内容（提取搜索关键词用）：
${note.content.slice(0, 3000)}`,
        title: `关联发现-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1600,
        temperature: 0.3,
      }
    },
  },
  {
    id: 'auto-wikilink',
    title: '双向链接',
    description: '自动建立当前笔记与其他笔记的 [[wiki-link]]',
    icon: Link2,
    category: 'note',
    executionMode: 'agent',
    searchTerms: ['双向链接', '链接', 'wikilink', 'wiki', 'backlink', 'sxlj'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '双向链接', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 20) return { prompt: null, title: '双向链接', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      return {
        prompt: `为笔记"${note.fileName}"自动建立双向 wiki-link。

1. 调用 suggest_links_for_note：{"filePath": "${note.filePath}", "maxSuggestions": 12}
2. 对高相关性建议，在笔记中替换为 [[wiki-link]] 格式
3. 为被链接笔记添加反向链接

规则：
- 只链接确实出现的笔记名称
- 不重复链接已是 [[xxx]] 格式的文本
- 每个笔记名只链接第一次出现
- 完成后报告建立了哪些链接`,
        title: `双向链接-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1600,
        temperature: 0.2,
      }
    },
  },

  // ============================================================
  // 🎨 可视化类
  // ============================================================
  {
    id: 'note-to-mindmap',
    title: '思维导图',
    description: '将当前笔记内容转为思维导图',
    icon: GitBranch,
    category: 'visual',
    executionMode: 'agent',
    searchTerms: ['思维导图', '导图', '脑图', 'mindmap', 'mind', 'map', 'swdt'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '思维导图', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 50) return { prompt: null, title: '思维导图', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      // 优先尝试直接生成（更快）
      try {
        const { fetchAi } = await import('@/lib/ai/chat')
        const { createDiagramContentFromOutline } = await import('@/lib/diagram')
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions } = await import('@/lib/workspace')
        const useArticleStore = (await import('@/stores/article')).default

        const skeleton = extractNoteSkeleton(note.content)
        const contentForAI = skeleton ? `结构概览:\n${skeleton}\n\n正文前段:\n${note.content.slice(0, 4000)}` : note.content.slice(0, 6000)

        const outline = await fetchAi(`将以下笔记转为思维导图大纲。只输出 Markdown 列表，不要输出其他内容。

规则：
- 不包含根节点（根节点是"${note.fileName}"）
- 直接从一级分支开始，用 "- "
- 一级 4-7 个，二级 2-5 个，三级可选
- 每个节点一句话，保留数字/年份/术语
- 禁止过度精简

笔记内容:
${contentForAI}

直接输出大纲:`)

        if (!outline?.trim() || outline.trim().length < 20) {
          return { prompt: null, title: '思维导图', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: 'AI 未能生成有效大纲，请重试。' }
        }

        const diagramFileName = `${note.fileName}-思维导图.drawio`
        const content = createDiagramContentFromOutline('mindmap', outline.trim(), { title: note.fileName, layout: 'mindmap' })

        const { path, baseDir } = await getFilePathOptions(diagramFileName)
        if (baseDir) await writeTextFile(path, content, { baseDir })
        else await writeTextFile(path, content)

        const articleStore = useArticleStore.getState()
        await articleStore.loadFileTree({ skipRemoteSync: true })
        await articleStore.setActiveFilePath(diagramFileName)

        // 在源笔记中添加链接
        try {
          const sourceOpts = await getFilePathOptions(note.filePath)
          const { readTextFile: readSrc } = await import('@tauri-apps/plugin-fs')
          const srcContent = sourceOpts.baseDir ? await readSrc(sourceOpts.path, { baseDir: sourceOpts.baseDir }) : await readSrc(sourceOpts.path)
          const diagramName = diagramFileName.replace(/\.drawio$/, '')
          if (!srcContent.includes(`[[${diagramName}]]`)) {
            const updated = srcContent.trimEnd() + `\n\n---\n相关图表: [[${diagramName}]]\n`
            if (sourceOpts.baseDir) await writeTextFile(sourceOpts.path, updated, { baseDir: sourceOpts.baseDir })
            else await writeTextFile(sourceOpts.path, updated)
          }
        } catch { /* ignore */ }

        return { prompt: null, directContent: `已生成思维导图: ${diagramFileName}`, title: `思维导图-${note.fileName}`, rangeLabel: '当前笔记', maxTokens: 0, temperature: 0 }
      } catch {
        // 降级到 Agent 模式
        return {
          prompt: `将笔记"${note.fileName}"转为思维导图。调用 create_diagram_from_outline：
- outline: Markdown 列表大纲（不含根节点）
- title: "${note.fileName}"
- kind: "mindmap"
- layout: "mindmap"
- fileName: "${note.fileName}-思维导图"
- openAfterCreate: true

笔记内容:
${note.content.slice(0, 5000)}`,
          title: `思维导图-${note.fileName}`,
          rangeLabel: '当前笔记',
          maxTokens: 2000,
          temperature: 0.2,
        }
      }
    },
  },
  {
    id: 'note-to-visual-report',
    title: '可视化解释',
    description: '生成自包含 HTML 交互视觉报告',
    icon: Presentation,
    category: 'visual',
    executionMode: 'agent',
    searchTerms: ['可视化', '解释页', '视觉报告', 'visual', 'explainer', 'report', 'html', 'ksh'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '可视化解释', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 80) return { prompt: null, title: '可视化解释', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      const { buildArtifactGenerationPrompt } = await import('@/lib/artifacts')
      return {
        prompt: buildArtifactGenerationPrompt({ title: `${note.fileName} 可视化解释`, sourceContent: note.content, sourceLabel: note.filePath, templateId: 'article-report' }),
        title: `可视化解释-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 2200,
        temperature: 0.25,
      }
    },
  },
  {
    id: 'note-to-deck-brief',
    title: '演示简报',
    description: '生成交互式 HTML 演示简报',
    icon: Presentation,
    category: 'visual',
    executionMode: 'agent',
    searchTerms: ['简报', '演示', '幻灯片', 'deck', 'slides', 'presentation', 'jb'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '演示简报', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 80) return { prompt: null, title: '演示简报', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      const { buildArtifactGenerationPrompt } = await import('@/lib/artifacts')
      return {
        prompt: buildArtifactGenerationPrompt({ title: `${note.fileName} 演示简报`, sourceContent: note.content, sourceLabel: note.filePath, templateId: 'deck-brief' }),
        title: `演示简报-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 2400,
        temperature: 0.25,
      }
    },
  },
  {
    id: 'note-to-poster-card',
    title: '分享海报',
    description: '生成分享型 HTML 海报卡片',
    icon: Image,
    category: 'visual',
    executionMode: 'agent',
    searchTerms: ['海报', '卡片', '长图', '分享图', 'poster', 'card', 'share', 'hb'],
    buildExecution: async () => {
      const note = await requireOpenNote()
      if ('error' in note) return { prompt: null, title: '分享海报', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: note.error }
      if (note.content.trim().length < 50) return { prompt: null, title: '分享海报', rangeLabel: '', maxTokens: 0, temperature: 0, skipReason: '笔记内容太少。' }

      const { buildArtifactGenerationPrompt } = await import('@/lib/artifacts')
      return {
        prompt: buildArtifactGenerationPrompt({ title: `${note.fileName} 海报卡片`, sourceContent: note.content, sourceLabel: note.filePath, templateId: 'poster-card' }),
        title: `海报-${note.fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1800,
        temperature: 0.3,
      }
    },
  },
]

// ---------------------------------------------------------------------------
// 查询与过滤
// ---------------------------------------------------------------------------

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

/** 按分类获取命令 */
export function getCommandsByCategory(category: CommandCategory): AiDocCommand[] {
  return AI_DOC_COMMANDS.filter(cmd => cmd.category === category)
}

/** 分类标签 */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  review: '📊 回顾',
  note: '📝 笔记',
  visual: '🎨 可视化',
}
