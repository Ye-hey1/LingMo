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
  | 'feynman-socratic'
  | 'note-summary'
  | 'note-to-mindmap'
  | 'auto-wikilink'

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
  /** 默认 chat；需要本地工具、文件写入或编辑器修改的命令必须在 agent 模式执行 */
  executionMode?: 'chat' | 'agent'
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
    executionMode: 'agent',
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
    executionMode: 'agent',
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
        prompt: `分析笔记"${fileName}"的关联关系。

第一步：调用 get_connected_notes 工具查找已有关联：
{"action": "get_connected_notes", "action_input": {"filePath": "${activeFilePath}"}}

第二步：如果第一步没有找到关联，调用 safe_grep 搜索关键词：
{"action": "safe_grep", "action_input": {"query": "AI产品经理"}}

第三步：基于搜索结果，用 Final Answer 输出关联分析报告。

当前笔记核心内容（用于提取搜索关键词）：
${contentPreview}

注意：每一步必须严格使用 JSON 格式输出 action，不要用自然语言描述你要做什么。`,
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
    executionMode: 'agent',
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
    id: 'feynman-socratic',
    title: '费曼追问',
    description: '用费曼学习法和苏格拉底式追问检测理解',
    icon: BrainCircuit,
    searchTerms: ['费曼', '追问', '苏格拉底', '学习', '理解', 'feynman', 'socratic', 'tutor', 'study', 'fm', 'zhuimen'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()
      const hasNoteContext = Boolean(activeFilePath && !activeFilePath.includes('://') && currentArticle?.trim())
      const fileName = activeFilePath?.split('/').pop() || '当前主题'
      const contextPreview = hasNoteContext ? currentArticle.slice(0, 6000) : ''

      return {
        prompt: `你现在进入“费曼追问”学习教练模式。

角色：
你是一个苏格拉底式 AI 学习教练，通过费曼学习法帮助用户检测理解。

核心原则：
- 用户必须先解释。
- 你不直接讲完整答案。
- 你通过追问让用户暴露知识漏洞。
- 你只在用户连续卡住时给最小提示。
- 每轮只问一个关键问题。
- 你要识别用户回答中的含糊词、跳步推理、概念混淆、缺少例子、缺少边界条件和错误因果关系。

学习模式：standard。
如用户要求“快速/quick”，追问 1-3 轮后给结束判断；如用户要求“固执/stubborn”，更严格追问机制、边界、反例和迁移应用。

评分维度：
1. 概念准确性 25 分
2. 机制解释 25 分
3. 例子质量 20 分
4. 边界与反例 15 分
5. 表达清晰度 15 分

评分限制：
- 没有解释机制，最高不超过 70 分。
- 没有举例，最高不超过 80 分。
- 概念明显错误，最高不超过 60 分。
- 只是背定义，最高不超过 65 分。
- 能举例但解释不了为什么，最高不超过 75 分。
- 能解释机制但不能说明边界，最高不超过 85 分。

交互格式：
- 不要输出 JSON。
- 面向用户输出简洁 Markdown。
- 每轮按以下结构输出：
  1. 理解度：N/100（变化：+N/-N/0）
  2. 当前薄弱点：一句话
  3. 简短反馈：一句话
  4. 下一追问：只问一个关键问题
- 如果用户还没给出解释，你的第一条回复只能要求用户先用自己的话解释主题，不要讲答案。
- 如果用户连续卡住，只给“最小提示”，不要给完整讲解。
- 当用户已经能清楚解释概念、机制、例子、边界和反例时，给出“可结束”判断，并生成简短复盘：已掌握、剩余薄弱点、下次练习问题。

${hasNoteContext ? `当前笔记：${fileName}
以下笔记内容只用于校验用户解释，不要直接复述给用户：
${contextPreview}` : '当前没有可用笔记上下文。请先询问用户想学习的主题，并要求用户用自己的话解释。'}

现在开始。你的第一条回复必须让用户先解释：如果已有当前笔记，请让用户选择笔记中的一个概念并用自己的话解释；如果没有笔记，请让用户输入主题并解释。`,
        title: `费曼追问-${fileName}`,
        rangeLabel: hasNoteContext ? '当前笔记' : '手动主题',
        maxTokens: 1600,
        temperature: 0.35,
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
    executionMode: 'agent',
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

      // 直接生成模式：不走 Agent，直接让 AI 输出大纲，然后本地生成图表
      // 这比走 Agent 快 5-10 倍（省去工具定义、system prompt、多轮对话）
      try {
        const { fetchAi } = await import('@/lib/ai/chat')
        const { createDiagramContentFromOutline } = await import('@/lib/diagram')
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions } = await import('@/lib/workspace')
        const useArticleStore = (await import('@/stores/article')).default

        // 提取结构骨架帮助 AI 快速理解
        const skeleton = extractNoteSkeleton(currentArticle)
        // 限制内容长度（骨架 + 前 4000 字符足够理解全貌）
        const contentForAI = skeleton
          ? `结构概览:\n${skeleton}\n\n正文前段:\n${currentArticle.slice(0, 4000)}`
          : currentArticle.slice(0, 6000)

        const aiPrompt = `将以下笔记内容转为思维导图大纲。只输出 Markdown 列表格式的大纲，不要输出其他内容。

规则（diagram-designer 规范）：
- 不要包含根节点（根节点是"${fileName}"）
- 直接从一级分支开始，用 "- " 表示
- 二级用 "  - "，三级用 "    - "
- 一级分支 4-7 个，覆盖文章所有主要章节
- 二级分支每个 2-5 个，保留关键数据和术语
- 三级分支（可选）：重要细节、数据、例子
- 每个节点用一句话概括，不要缩减为几个字
- 保留：数字、年份、人名、术语、因果关系
- 禁止：节点过度精简、遗漏重要段落、同级节点数量严重不均衡

笔记内容:
${contentForAI}

直接输出大纲（不要解释）:`

        const outline = await fetchAi(aiPrompt)

        if (!outline || outline.trim().length < 20) {
          return {
            prompt: null,
            title: '笔记转图',
            rangeLabel: '当前笔记',
            maxTokens: 0,
            temperature: 0,
            skipReason: 'AI 未能生成有效大纲，请重试。',
          }
        }

        // 本地生成图表文件
        const diagramFileName = `${fileName}-思维导图.drawio`
        const content = createDiagramContentFromOutline('mindmap', outline.trim(), {
          title: fileName,
          layout: 'mindmap',
        })

        // 写入文件
        const { path, baseDir } = await getFilePathOptions(diagramFileName)
        if (baseDir) {
          await writeTextFile(path, content, { baseDir })
        } else {
          await writeTextFile(path, content)
        }

        // 刷新文件树并打开
        const articleStore = useArticleStore.getState()
        await articleStore.loadFileTree({ skipRemoteSync: true })
        await articleStore.setActiveFilePath(diagramFileName)

        // 在源笔记中添加链接
        try {
          const sourceOpts = await getFilePathOptions(activeFilePath)
          const sourceContent = sourceOpts.baseDir
            ? await (await import('@tauri-apps/plugin-fs')).readTextFile(sourceOpts.path, { baseDir: sourceOpts.baseDir })
            : await (await import('@tauri-apps/plugin-fs')).readTextFile(sourceOpts.path)
          const diagramName = diagramFileName.replace(/\.drawio$/, '')
          if (!sourceContent.includes(`[[${diagramName}]]`)) {
            const updated = sourceContent.trimEnd() + `\n\n---\n相关图表: [[${diagramName}]]\n`
            if (sourceOpts.baseDir) {
              await writeTextFile(sourceOpts.path, updated, { baseDir: sourceOpts.baseDir })
            } else {
              await writeTextFile(sourceOpts.path, updated)
            }
          }
        } catch { /* 链接创建失败不影响主流程 */ }

        return {
          prompt: null,
          directContent: `已生成思维导图: ${diagramFileName}`,
          title: `思维导图-${fileName}`,
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
        }
      } catch {
        // 直接生成失败，降级到 Agent 模式
        const structureSkeleton = extractNoteSkeleton(currentArticle)
        const contentSection = currentArticle.length > 3000
          ? `## 结构概览\n\n${structureSkeleton}\n\n## 完整内容\n\n${currentArticle.slice(0, 5000)}`
          : `## 完整内容\n\n${currentArticle}`

        return {
          prompt: `将笔记"${fileName}"转为思维导图。

${contentSection}

调用 create_diagram_from_outline，参数：
- outline: Markdown 列表大纲（不含根节点）
- title: "${fileName}"
- kind: "mindmap"
- layout: "mindmap"
- fileName: "${fileName}-思维导图"
- openAfterCreate: true`,
          title: `思维导图-${fileName}`,
          rangeLabel: '当前笔记',
          maxTokens: 2000,
          temperature: 0.2,
        }
      }
    },
  },
  {
    id: 'auto-wikilink',
    title: '双向链接',
    description: '自动发现并建立当前笔记与其他笔记的双向 [[wiki-link]]',
    icon: Link2,
    executionMode: 'agent',
    searchTerms: ['双向链接', '链接', 'wikilink', 'wiki', 'link', '自动链接', '反向链接', 'backlink', 'sxlj', 'lianjie'],
    buildExecution: async () => {
      const { activeFilePath, currentArticle } = (await import('@/stores/article')).default.getState()

      if (!activeFilePath || !activeFilePath.endsWith('.md')) {
        return {
          prompt: null,
          title: '双向链接',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '请先打开一篇 Markdown 笔记再使用此命令。',
        }
      }

      if (!currentArticle || currentArticle.trim().length < 20) {
        return {
          prompt: null,
          title: '双向链接',
          rangeLabel: '当前笔记',
          maxTokens: 0,
          temperature: 0,
          skipReason: '当前笔记内容太少，无法进行链接分析。',
        }
      }

      const fileName = activeFilePath.split('/').pop()?.replace(/\.md$/, '') || ''

      return {
        prompt: `请为当前笔记"${fileName}"自动建立双向 wiki-link。

这是一个明确的执行型任务，不要先解释“双向链接是什么”，不要做概念介绍，也不要只给建议。
你必须直接执行工具，并按步骤完成修改。

执行步骤：
1. 先调用 suggest_links_for_note 工具获取链接建议：
   {"action": "suggest_links_for_note", "action_input": {"filePath": "${activeFilePath}", "maxSuggestions": 12}}

2. 根据返回的建议，对每个高相关性的建议，在当前笔记中找到对应文本并替换为 [[wiki-link]] 格式。使用 get_editor_content 获取当前内容，然后用 replace_editor_content 进行替换。

3. 对于被链接的笔记，如果它们还没有链接回当前笔记，也在它们末尾添加 [[${fileName}]] 的反向链接。

规则：
- 如果工具返回建议，必须继续调用下一步工具，不要改成讲解模式
- 只链接确实在笔记中出现的其他笔记名称
- 不要链接已经是 [[xxx]] 格式的文本（避免重复链接）
- 每个笔记名只链接第一次出现的位置
- 反向链接添加在目标笔记末尾，格式为：\\n\\n相关笔记: [[${fileName}]]
- 完成后用 Final Answer 报告建立了哪些链接`,
        title: `双向链接-${fileName}`,
        rangeLabel: '当前笔记',
        maxTokens: 1600,
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
