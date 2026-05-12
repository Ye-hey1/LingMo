import type { ActivityCalendarData, ActivityDaySummary, ActivityEntry, ActivityViewSource } from './types'

export type ActivityReviewKind = 'today' | 'week' | 'scope' | 'report'

export interface ActivityConversationCandidate {
  id: string
  kind: 'chat' | 'ai'
  title: string
  preview: string
  count: number
  totalChars: number
  startedAt: number
  endedAt: number
  tagName?: string
  platform?: string
  sessionKey?: string
  score: number
  signals: string[]
  entries: ActivityEntry[]
}

export interface ActivityRecordCandidate {
  id: string
  title: string
  preview: string
  type: string
  tagName?: string
  processed: boolean
  timestamp: number
  score: number
  signals: string[]
  entry: ActivityEntry
}

export interface ActivityScopeAnalysis {
  rangeLabel: string
  startDay: string
  endDay: string
  totalCount: number
  activeDays: number
  counts: Record<'record' | 'chat' | 'writing' | 'ai' | 'memory', number>
  effectiveConversationCount: number
  highValueConversationCount: number
  highValueRecordCount: number
  noteConversionCount: number
  noteConversionRate: number
  recordTypeDistribution: Array<{ key: string; label: string; count: number }>
  recordTagDistribution: Array<{ key: string; label: string; count: number }>
  highValueConversations: ActivityConversationCandidate[]
  highValueRecords: ActivityRecordCandidate[]
  recommendedNextNotes: Array<{
    id: string
    title: string
    reason: string
    source: 'conversation' | 'record'
    entry?: ActivityEntry
  }>
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  scan: '截图',
  text: '文本',
  image: '图片',
  link: '链接',
  file: '文件',
  recording: '录音',
  todo: '待办',
  other: '其他',
}

const VALUE_KEYWORD_GROUPS: Array<{ label: string; patterns: RegExp[]; score: number }> = [
  { label: '总结复盘', patterns: [/总结/i, /复盘/i, /review/i], score: 2 },
  { label: '方案设计', patterns: [/方案/i, /设计/i, /架构/i], score: 2 },
  { label: '需求规划', patterns: [/需求/i, /计划/i, /里程碑/i], score: 2 },
  { label: '实现修复', patterns: [/实现/i, /修复/i, /优化/i, /排查/i], score: 2 },
  { label: '任务推进', patterns: [/待办/i, /todo/i, /行动/i, /推进/i], score: 1 },
  { label: '决策结论', patterns: [/结论/i, /决策/i, /取舍/i], score: 1 },
]

function normalizeText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function getEntryText(entry: ActivityEntry) {
  return normalizeText(entry.description || entry.title || entry.path)
}

function getEntryTagName(entry: ActivityEntry) {
  return typeof entry.meta?.tagName === 'string' ? entry.meta.tagName : undefined
}

function getRecordType(entry: ActivityEntry) {
  return typeof entry.meta?.recordType === 'string' ? entry.meta.recordType : 'other'
}

function isRecordProcessed(entry: ActivityEntry) {
  return entry.meta?.processed === true
}

function formatDayRange(days: ActivityDaySummary[]) {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day))
  return {
    startDay: sorted[0]?.day || '',
    endDay: sorted[sorted.length - 1]?.day || '',
  }
}

function getKeywordSignals(text: string) {
  const signals: string[] = []
  let score = 0

  for (const group of VALUE_KEYWORD_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(text))) {
      signals.push(group.label)
      score += group.score
    }
  }

  return {
    signals,
    score: Math.min(score, 6),
  }
}

function getPathSignal(entries: ActivityEntry[]) {
  return entries.some((entry) => normalizeText(entry.path).length > 0)
}

function getUrlSignal(text: string) {
  return /(https?:\/\/|www\.)/i.test(text)
}

function getFileSignal(text: string) {
  return /[\w-]+\.(md|markdown|txt|pdf|png|jpg|jpeg|gif|ts|tsx|js|jsx|json|py|go|rs|java|sql)/i.test(text)
}

function uniqueSignals(signals: string[]) {
  return Array.from(new Set(signals))
}

function scoreConversationCandidate(candidate: Omit<ActivityConversationCandidate, 'score' | 'signals'>): ActivityConversationCandidate {
  const durationMinutes = Math.max(0, Math.round((candidate.endedAt - candidate.startedAt) / 60000))
  const combinedText = normalizeText([
    candidate.title,
    candidate.preview,
    ...candidate.entries.map(getEntryText),
  ].join(' '))
  const keywordSignals = getKeywordSignals(combinedText)
  const signals: string[] = []
  let score = 0

  const turnScore = Math.min(candidate.count * 2, 8)
  if (turnScore > 0) {
    score += turnScore
    if (candidate.count >= 3) signals.push('多轮往返')
    if (candidate.count >= 5) signals.push('持续推进')
  }

  const charScore = Math.min(Math.round(candidate.totalChars / 80), 6)
  if (charScore > 0) {
    score += charScore
    if (candidate.totalChars >= 240) signals.push('内容密度高')
    if (candidate.totalChars >= 600) signals.push('信息完整')
  }

  if (durationMinutes >= 10) {
    score += 2
    signals.push('跨时段跟进')
  }
  if (durationMinutes >= 30) {
    score += 2
    signals.push('长链路讨论')
  }

  if (candidate.tagName) {
    score += 1
    signals.push('带标签上下文')
  }

  if (getPathSignal(candidate.entries)) {
    score += 1
    signals.push('关联项目路径')
  }

  if (candidate.kind === 'ai') {
    if (candidate.platform) {
      score += 1
      signals.push(`平台：${candidate.platform}`)
    }
    if (candidate.sessionKey) {
      score += 1
      signals.push('可定位到会话')
    }
    if (candidate.count >= 2) {
      score += 1
    }
  } else {
    const hasConversationId = candidate.entries.some((entry) => typeof entry.meta?.conversationId === 'number')
    if (hasConversationId) {
      score += 1
      signals.push('同一会话连续讨论')
    }
  }

  score += keywordSignals.score
  signals.push(...keywordSignals.signals)

  return {
    ...candidate,
    score,
    signals: uniqueSignals(signals),
  }
}

function groupChatConversations(entries: ActivityEntry[]) {
  const chatEntries = entries
    .filter((entry) => entry.source === 'chat')
    .sort((a, b) => a.timestamp - b.timestamp)

  const sessions: ActivityConversationCandidate[] = []
  let current: Omit<ActivityConversationCandidate, 'score' | 'signals'> | null = null

  for (const entry of chatEntries) {
    const conversationId = typeof entry.meta?.conversationId === 'number' ? entry.meta.conversationId : 0
    const tagId = typeof entry.tagId === 'number' ? entry.tagId : 0
    const key = `chat-${conversationId || tagId || 'unknown'}`
    const preview = getEntryText(entry)

    if (!current) {
      current = {
        id: `${key}-${entry.timestamp}`,
        kind: 'chat',
        title: preview.slice(0, 40) || '对话',
        preview,
        count: 1,
        totalChars: preview.length,
        startedAt: entry.timestamp,
        endedAt: entry.timestamp,
        tagName: getEntryTagName(entry),
        entries: [entry],
      }
      continue
    }

    const lastEntry: ActivityEntry = current.entries[current.entries.length - 1]
    const lastConversationId: number = typeof lastEntry.meta?.conversationId === 'number' ? lastEntry.meta.conversationId : 0
    const lastTagId: number = typeof lastEntry.tagId === 'number' ? lastEntry.tagId : 0
    const currentKey: string = `chat-${lastConversationId || lastTagId || 'unknown'}`
    const isSameGroup = key === currentKey && entry.timestamp - current.endedAt <= 30 * 60 * 1000

    if (!isSameGroup) {
      sessions.push(scoreConversationCandidate(current))
      current = {
        id: `${key}-${entry.timestamp}`,
        kind: 'chat',
        title: preview.slice(0, 40) || '对话',
        preview,
        count: 1,
        totalChars: preview.length,
        startedAt: entry.timestamp,
        endedAt: entry.timestamp,
        tagName: getEntryTagName(entry),
        entries: [entry],
      }
      continue
    }

    current.count += 1
    current.totalChars += preview.length
    current.endedAt = entry.timestamp
    current.preview = current.preview.length >= preview.length ? current.preview : preview
    current.entries.push(entry)
  }

  if (current) {
    sessions.push(scoreConversationCandidate(current))
  }

  return sessions
}

function groupAiConversations(entries: ActivityEntry[]) {
  const sessionMap = new Map<string, Omit<ActivityConversationCandidate, 'score' | 'signals'>>()

  for (const entry of entries) {
    if (entry.source !== 'ai') continue

    const platform = typeof entry.meta?.platform === 'string' ? entry.meta.platform : 'ai'
    const sessionKey = typeof entry.meta?.sessionKey === 'string' ? entry.meta.sessionKey : entry.id
    const key = `${platform}:${sessionKey}`
    const preview = getEntryText(entry)
    const existing = sessionMap.get(key)

    if (!existing) {
      sessionMap.set(key, {
        id: key,
        kind: 'ai',
        title: entry.title || preview.slice(0, 40) || 'AI 会话',
        preview,
        count: 1,
        totalChars: preview.length,
        startedAt: entry.timestamp,
        endedAt: entry.timestamp,
        platform,
        sessionKey,
        entries: [entry],
      })
      continue
    }

    existing.count += 1
    existing.totalChars += preview.length
    existing.startedAt = Math.min(existing.startedAt, entry.timestamp)
    existing.endedAt = Math.max(existing.endedAt, entry.timestamp)
    existing.preview = existing.preview.length >= preview.length ? existing.preview : preview
    existing.entries.push(entry)
  }

  return Array.from(sessionMap.values()).map(scoreConversationCandidate)
}

function scoreRecordCandidate(entry: ActivityEntry): ActivityRecordCandidate {
  const preview = getEntryText(entry)
  const processed = isRecordProcessed(entry)
  const type = getRecordType(entry)
  const tagName = getEntryTagName(entry)
  const keywordSignals = getKeywordSignals(preview)
  const signals: string[] = []
  let score = 0

  const textScore = Math.min(Math.round(preview.length / 45), 6)
  score += textScore
  if (preview.length >= 100) signals.push('内容较完整')
  if (preview.length >= 240) signals.push('长文本记录')

  if (processed) {
    score += 4
    signals.push('已转化为笔记')
  }

  if (tagName) {
    score += 1
    signals.push('带标签')
  }

  if (type === 'todo') {
    score += 2
    signals.push('待办事项')
  } else if (type === 'scan' || type === 'file' || type === 'link') {
    score += 2
    signals.push('外部素材')
  } else if (type === 'text' || type === 'image' || type === 'recording') {
    score += 1
  }

  if (getUrlSignal(preview)) {
    score += 1
    signals.push('包含链接')
  }

  if (getFileSignal(preview)) {
    score += 1
    signals.push('包含文件线索')
  }

  score += keywordSignals.score
  signals.push(...keywordSignals.signals)

  return {
    id: `record-${entry.meta?.markId || entry.id}`,
    title: entry.title || preview.slice(0, 40) || '记录',
    preview,
    type,
    tagName,
    processed,
    timestamp: entry.timestamp,
    score,
    signals: uniqueSignals(signals),
    entry,
  }
}

function collectRecordCandidates(entries: ActivityEntry[]) {
  return entries
    .filter((entry) => entry.source === 'record')
    .map(scoreRecordCandidate)
}

function buildDistribution(items: Array<{ key: string; label: string }>) {
  const counter = new Map<string, { key: string; label: string; count: number }>()

  for (const item of items) {
    const existing = counter.get(item.key) || { ...item, count: 0 }
    existing.count += 1
    counter.set(item.key, existing)
  }

  return Array.from(counter.values()).sort((a, b) => b.count - a.count).slice(0, 8)
}

function buildRecommendations(
  conversations: ActivityConversationCandidate[],
  records: ActivityRecordCandidate[],
) {
  const suggestions: ActivityScopeAnalysis['recommendedNextNotes'] = []

  conversations
    .filter((item) => item.score >= 10)
    .slice(0, 3)
    .forEach((item) => {
      const topSignals = item.signals.slice(0, 2).join('、') || '信息密度较高'
      suggestions.push({
        id: `conversation-${item.id}`,
        title: item.title,
        reason: item.kind === 'ai'
          ? `这段 AI 互动已形成连续上下文，当前信号：${topSignals}，适合沉淀为项目笔记或周报素材。`
          : `这段对话已形成较完整的问题推进链路，当前信号：${topSignals}，适合整理为复盘记录。`,
        source: 'conversation',
        entry: item.entries[item.entries.length - 1],
      })
    })

  records
    .filter((item) => !item.processed && item.score >= 6)
    .slice(0, 3)
    .forEach((item) => {
      const topSignals = item.signals.slice(0, 2).join('、') || '内容较完整'
      suggestions.push({
        id: `record-${item.id}`,
        title: item.title,
        reason: `这条记录仍未转成笔记，当前信号：${topSignals}，建议继续整理并纳入正式文档。`,
        source: 'record',
        entry: item.entry,
      })
    })

  return suggestions
}

export function analyzeActivityScope(
  days: ActivityDaySummary[],
  _source: ActivityViewSource | 'all',
  rangeLabel: string,
): ActivityScopeAnalysis {
  const normalizedDays = [...days].sort((a, b) => a.day.localeCompare(b.day))
  const entries = normalizedDays.flatMap((day) => day.entries)
  const { startDay, endDay } = formatDayRange(normalizedDays)

  const counts = {
    record: entries.filter((entry) => entry.source === 'record').length,
    chat: entries.filter((entry) => entry.source === 'chat').length,
    writing: entries.filter((entry) => entry.source === 'writing').length,
    ai: entries.filter((entry) => entry.source === 'ai').length,
    memory: entries.filter((entry) => entry.source === 'memory').length,
  }

  const chatConversations = groupChatConversations(entries)
  const aiConversations = groupAiConversations(entries)
  const allConversations = [...chatConversations, ...aiConversations]
    .sort((a, b) => b.score - a.score || b.endedAt - a.endedAt)
  const highValueConversations = allConversations.filter((item) => item.score >= 10).slice(0, 8)

  const recordCandidates = collectRecordCandidates(entries).sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
  const highValueRecords = recordCandidates.filter((item) => item.score >= 6).slice(0, 8)

  const processedCount = recordCandidates.filter((item) => item.processed).length
  const recordTypeDistribution = buildDistribution(
    recordCandidates.map((item) => ({
      key: item.type,
      label: RECORD_TYPE_LABELS[item.type] || item.type || '其他',
    })),
  )
  const recordTagDistribution = buildDistribution(
    recordCandidates
      .filter((item) => item.tagName)
      .map((item) => ({
        key: item.tagName || '未分类',
        label: item.tagName || '未分类',
      })),
  )

  return {
    rangeLabel,
    startDay,
    endDay,
    totalCount: entries.length,
    activeDays: normalizedDays.filter((day) => day.totalCount > 0).length,
    counts,
    effectiveConversationCount: allConversations.length,
    highValueConversationCount: highValueConversations.length,
    highValueRecordCount: highValueRecords.length,
    noteConversionCount: processedCount,
    noteConversionRate: recordCandidates.length ? Math.round((processedCount / recordCandidates.length) * 100) : 0,
    recordTypeDistribution,
    recordTagDistribution,
    highValueConversations,
    highValueRecords,
    recommendedNextNotes: buildRecommendations(highValueConversations, recordCandidates),
  }
}

function buildConversationFactList(items: ActivityConversationCandidate[]) {
  if (!items.length) return '- 暂未识别到高价值对话。'

  return items.slice(0, 6).map((item, index) => {
    const meta = [
      item.kind === 'ai' ? `平台：${item.platform || 'AI'}` : `标签：${item.tagName || '未分类'}`,
      `次数：${item.count}`,
      `分数：${item.score}`,
    ].join('；')
    const signalText = item.signals.length ? item.signals.slice(0, 4).join('、') : '无明显特征'
    return `${index + 1}. ${item.title}\n   - ${meta}\n   - 信号：${signalText}\n   - 摘要：${item.preview || '信息不足'}`
  }).join('\n')
}

function buildRecordFactList(items: ActivityRecordCandidate[]) {
  if (!items.length) return '- 暂未识别到高价值记录。'

  return items.slice(0, 6).map((item, index) => {
    const meta = [
      `类型：${RECORD_TYPE_LABELS[item.type] || item.type || '其他'}`,
      `标签：${item.tagName || '未分类'}`,
      item.processed ? '已转笔记' : '未转笔记',
    ].join('；')
    const signalText = item.signals.length ? item.signals.slice(0, 4).join('、') : '无明显特征'
    return `${index + 1}. ${item.title}\n   - ${meta}\n   - 信号：${signalText}\n   - 摘要：${item.preview || '信息不足'}`
  }).join('\n')
}

interface ReviewKindProfile {
  title: string
  role: string
  goal: string
  /** 输出骨架（强约束的章节标题/字段） */
  skeleton: string
  /** 大致字数上限，引导 AI 控制长度 */
  maxChineseChars: number
  /** 该 kind 特有的额外约束 */
  extraConstraints?: string[]
}

const REVIEW_KIND_PROFILES: Record<ActivityReviewKind, ReviewKindProfile> = {
  today: {
    title: '今日回顾',
    role: '你是用户的个人反思教练，擅长把一天的零散活动凝练成一句小结和一个明日动作。',
    goal: '帮助用户在 1 分钟内看完今天，并明确明天最该做的一件事。',
    skeleton: [
      '## 今日一句话',
      '> 用一句不超过 30 字的话概括今天，要有判断（顺利 / 受阻 / 探索 / 等待）。',
      '',
      '## 已完成 / 已推进',
      '- 用动词开头，每条 ≤ 20 字，写出对应输出物或对话主题；最多 5 条。',
      '',
      '## 待续 / 卡点',
      '- 写出今天没有闭环的问题及当前阻塞点；没有则写"无"。',
      '',
      '## 明日重点',
      '- **今日唯一最重要任务（一句话）**',
      '- 配套 1–3 个 ≤ 15 字的小步骤。',
    ].join('\n'),
    maxChineseChars: 500,
    extraConstraints: [
      '今日数据可能很少，宁可写"信息不足"也不要拼凑。',
      '不要回顾今天以外的内容。',
    ],
  },

  week: {
    title: '本周回顾',
    role: '你是周复盘教练，擅长用 KPT（Keep / Problem / Try）框架做一周小结。',
    goal: '帮用户识别本周可延续的好习惯、暴露的问题，以及下周值得尝试的新做法。',
    skeleton: [
      '## 一周主题',
      '> 一句话概括本周的主线（≤ 40 字）。',
      '',
      '## 关键事实',
      '- 总活动 / 活跃天数 / 高价值对话 / 高价值记录 / 转笔记率：用一行 Markdown 表格列出。',
      '',
      '## Keep（继续做）',
      '- 来自事实可证明、本周做得好且值得保持的 2–4 件事。',
      '',
      '## Problem（要改）',
      '- 本周阻塞、低效或缺位的 2–4 件事，每条注明它造成的具体影响。',
      '',
      '## Try（下周尝试）',
      '- 提出 3 个具体可验证的小实验，写明"做什么 + 验证标准"。',
      '',
      '## 下周 3 件事',
      '1. ...（最重要）',
      '2. ...',
      '3. ...',
    ].join('\n'),
    maxChineseChars: 1200,
    extraConstraints: [
      'Keep / Problem / Try 必须各自独立，不要把同一件事重复。',
      '每条结论都要能从"事实清单"里指回至少一条对话或记录。',
    ],
  },

  scope: {
    title: '知识盘点',
    role: '你是知识管理专家，擅长把一段时间的零散产出按主题聚类，找出值得沉淀的核心结论。',
    goal: '帮用户看清最近这段时间在哪些主题上投入最多，并给出每个主题的下一步动作。',
    skeleton: [
      '## 主题地图',
      '> 用一段话（≤ 80 字）总结当前的研究/工作主题分布。',
      '',
      '## 主题清单（≤ 5 个）',
      '> 每个主题以以下结构输出，按重要性排序：',
      '',
      '### 主题 N · {主题名}',
      '- **核心结论**：≤ 40 字，写明该主题目前能下的一句结论；不能下结论则写"待验证"。',
      '- **代表对话/记录**：列 1–3 条标题，括号注明"对话/记录"。',
      '- **可沉淀为笔记的内容**：写出"可以写成一篇关于 XX 的笔记"，没有则写"暂无"。',
      '- **下一步**：1 条具体动作。',
      '',
      '## 不属于任何主题但值得记一笔',
      '- 列出零散但有价值的发现；没有则省略本节。',
    ].join('\n'),
    maxChineseChars: 1500,
    extraConstraints: [
      '主题数量上限 5 个，宁缺勿滥；信息不足时减少主题数。',
      '"代表对话/记录"必须从输入清单中选取，不能编造标题。',
      '本命令是"梳理"，不是"评价"，不要写好坏判断。',
    ],
  },

  report: {
    title: '月度复盘',
    role: '你是高管教练，擅长用 STAR 与目标-偏差视角做严肃的月度复盘。',
    goal: '产出一份可直接用于 1on1 或月度汇报的复盘文档，强调结果与下一步而非情绪。',
    skeleton: [
      '## 摘要',
      '> 3–5 行结论性段落：本月做了什么、达成程度、最关键的判断。',
      '',
      '## 关键成果（STAR）',
      '> 选 2–3 个最具代表性的成果，每个用 STAR 结构：',
      '',
      '### 成果 N · {标题}',
      '- **Situation**：背景。',
      '- **Task**：要解决的问题。',
      '- **Action**：实际做了什么（动词开头）。',
      '- **Result**：可观测结果，能量化则量化。',
      '',
      '## 问题与风险',
      '- 每条写明"现象 → 根因猜测 → 当前应对"。',
      '',
      '## 知识沉淀',
      '- 列出本月已经成型 / 应该成型的 2–4 篇笔记（标题 + 一句话价值）。',
      '',
      '## 下阶段计划',
      '- 用 3–5 条目标式表述，每条形如"在 X 时间内做到 Y，以 Z 为衡量"。',
    ].join('\n'),
    maxChineseChars: 2500,
    extraConstraints: [
      '禁止使用情绪化或自我表扬的措辞（如"非常出色""极大提升"）。',
      '所有量化数字必须来自输入数据；不能凭空给百分比。',
      '"问题与风险"和"下阶段计划"必须呼应，不能各写各的。',
    ],
  },
}

function formatDelta(current: number, previous: number, unit = '') {
  if (previous <= 0 && current <= 0) return '—'
  if (previous <= 0) return `${current}${unit}（新增）`
  const delta = current - previous
  const sign = delta >= 0 ? '+' : ''
  const pct = Math.round((delta / previous) * 100)
  return `${current}${unit}（${sign}${delta}${unit} · ${sign}${pct}%）`
}

function formatRateDelta(current: number, previous: number) {
  // current/previous 是百分比（0-100）
  if (current === 0 && previous === 0) return '—'
  const delta = current - previous
  const sign = delta >= 0 ? '+' : ''
  return `${current}%（${sign}${delta}pp）`
}

function buildBaselineSection(current: ActivityScopeAnalysis, baseline?: ActivityScopeAnalysis) {
  if (!baseline || baseline.totalCount === 0) {
    return [
      '## 对照基线',
      '- 上一周期数据缺失或为零，无法对比。',
    ].join('\n')
  }
  return [
    '## 对照基线（vs 上一周期 ' + baseline.startDay + ' ~ ' + baseline.endDay + '）',
    '| 指标 | 当前 | 变化 |',
    '| --- | --- | --- |',
    `| 总活动数 | ${current.totalCount} | ${formatDelta(current.totalCount, baseline.totalCount)} |`,
    `| 活跃天数 | ${current.activeDays} | ${formatDelta(current.activeDays, baseline.activeDays, ' 天')} |`,
    `| 高价值对话 | ${current.highValueConversationCount} | ${formatDelta(current.highValueConversationCount, baseline.highValueConversationCount)} |`,
    `| 高价值记录 | ${current.highValueRecordCount} | ${formatDelta(current.highValueRecordCount, baseline.highValueRecordCount)} |`,
    `| 转笔记率 | ${current.noteConversionRate}% | ${formatRateDelta(current.noteConversionRate, baseline.noteConversionRate)} |`,
  ].join('\n')
}

export interface ActivityGoalContext {
  /** 每日目标设置（来自 goals.ts） */
  daily: { record: number; writing: number; conversation: number }
  /** 当前周期的天数（用于把日目标外推为周期目标） */
  periodDays: number
}

function buildGoalSection(
  analysis: ActivityScopeAnalysis,
  goal?: ActivityGoalContext,
): string | null {
  if (!goal || goal.periodDays <= 0) return null
  const targetRecord = goal.daily.record * goal.periodDays
  const targetWriting = goal.daily.writing * goal.periodDays
  const targetConversation = goal.daily.conversation * goal.periodDays

  const fmt = (current: number, target: number) => {
    if (target <= 0) return `${current}（无目标）`
    const pct = Math.round((current / target) * 100)
    const gap = current - target
    const sign = gap >= 0 ? '+' : ''
    return `${current} / ${target}（${pct}% · ${sign}${gap}）`
  }

  return [
    `## 目标对照（按日均目标 × ${goal.periodDays} 天外推）`,
    '| 维度 | 实际 / 名义目标（达成率 · 差距） |',
    '| --- | --- |',
    `| 记录 | ${fmt(analysis.counts.record, targetRecord)} |`,
    `| 写作 | ${fmt(analysis.counts.writing, targetWriting)} |`,
    `| 有效对话 | ${fmt(analysis.effectiveConversationCount, targetConversation)} |`,
  ].join('\n')
}

export function buildActivityReviewPrompt(
  kind: ActivityReviewKind,
  analysis: ActivityScopeAnalysis,
  baseline?: ActivityScopeAnalysis,
  goal?: ActivityGoalContext,
) {
  const profile = REVIEW_KIND_PROFILES[kind]

  return [
    `# 角色`,
    profile.role,
    '',
    `# 目标`,
    profile.goal,
    '',
    `# 任务`,
    `基于下方"输入数据"生成一份《${profile.title}》。`,
    '',
    `# 输出骨架（请严格按此结构输出，章节标题保持一致）`,
    profile.skeleton,
    '',
    `# 风格与约束`,
    '- 简体中文，仅输出 Markdown，禁止 JSON / 代码围栏 / 解释你在做什么。',
    '- 句式短，多用列表与小标题；避免"显著""极大""非常"等含糊副词。',
    '- 禁止开场白、客套、总结性废话；直接进入第一节。',
    '- 任何结论都必须能在"输入数据"中找到依据；事实不足处明确写"信息不足"，不要补全。',
    '- 不要逐条复述输入清单，要做归纳与判断。',
    `- 全文中文字符控制在约 ${profile.maxChineseChars} 字以内。`,
    baseline && baseline.totalCount > 0
      ? '- 涉及数量描述时，必须引用"对照基线"表中的变化（如 +30% / -2pp），不要只给绝对值。'
      : '- 当前没有对照基线，禁止编造同比/环比数字。',
    goal
      ? '- 必须基于"目标对照"表给出"达成 / 未达成 / 超额"判断，并指出最大缺口维度；目标是日均目标外推，不要当作刚性 KPI。'
      : null,
    ...(profile.extraConstraints || []).map((line) => `- ${line}`),
    '',
    `# 输入数据`,
    `范围：${analysis.rangeLabel}（${analysis.startDay} ~ ${analysis.endDay}）`,
    `总活动数：${analysis.totalCount}`,
    `活跃天数：${analysis.activeDays}`,
    `记录：${analysis.counts.record}；对话：${analysis.counts.chat}；写作：${analysis.counts.writing}；AI：${analysis.counts.ai}；记忆：${analysis.counts.memory}`,
    `有效对话数：${analysis.effectiveConversationCount}`,
    `高价值对话数：${analysis.highValueConversationCount}`,
    `高价值记录数：${analysis.highValueRecordCount}`,
    `记录转笔记率：${analysis.noteConversionRate}%`,
    '',
    buildBaselineSection(analysis, baseline),
    '',
    buildGoalSection(analysis, goal),
    goal ? '' : null,
    '## 高价值对话',
    buildConversationFactList(analysis.highValueConversations),
    '',
    '## 高价值记录',
    buildRecordFactList(analysis.highValueRecords),
    '',
    '## 记录类型分布',
    analysis.recordTypeDistribution.length
      ? analysis.recordTypeDistribution.map((item) => `- ${item.label}: ${item.count}`).join('\n')
      : '- 暂无记录类型分布',
    '',
    '## 记录标签分布',
    analysis.recordTagDistribution.length
      ? analysis.recordTagDistribution.map((item) => `- ${item.label}: ${item.count}`).join('\n')
      : '- 暂无记录标签分布',
    '',
    '## 建议继续推进的内容',
    analysis.recommendedNextNotes.length
      ? analysis.recommendedNextNotes.map((item, index) => `- ${index + 1}. ${item.title}：${item.reason}`).join('\n')
      : '- 暂无明显的继续推进项',
  ].join('\n')
}

export function buildHighValueConversationNote(analysis: ActivityScopeAnalysis) {
  const body = analysis.highValueConversations.length
    ? analysis.highValueConversations.map((item, index) => [
        `### ${index + 1}. ${item.title}`,
        '',
        `- 类型：${item.kind === 'ai' ? 'AI 会话' : '站内对话'}`,
        item.platform ? `- 平台：${item.platform}` : null,
        item.tagName ? `- 标签：${item.tagName}` : null,
        `- 交互次数：${item.count}`,
        `- 价值分：${item.score}`,
        item.signals.length ? `- 价值信号：${item.signals.join('、')}` : null,
        '',
        item.preview || '信息不足',
        '',
      ].filter(Boolean).join('\n')).join('\n')
    : '暂无高价值对话。'

  return [
    '# 高价值对话沉淀',
    '',
    `- 范围：${analysis.rangeLabel}`,
    `- 日期：${analysis.startDay} ~ ${analysis.endDay}`,
    `- 沉淀时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    '## 对话清单',
    '',
    body,
    '',
  ].join('\n')
}

export function getRecentDays(data: ActivityCalendarData, dayCount: number) {
  return getDayWindow(data, data.insights.today.day, dayCount)
}

/** 获取以 endDay 结束、长度为 dayCount 的窗口（用于基线/对照） */
export function getDayWindow(
  data: ActivityCalendarData,
  endDay: string,
  dayCount: number,
): ActivityDaySummary[] {
  if (!endDay || dayCount <= 0) return []
  const result: ActivityDaySummary[] = []
  const dayMap = new Map(data.days.map((day) => [day.day, day]))
  const start = new Date(`${endDay}T00:00:00Z`)

  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() - index)
    const key = date.toISOString().slice(0, 10)
    const day = dayMap.get(key)
    if (day) {
      result.push(day)
    }
  }

  return result
}

/** 在 endDay 之前获取一段长度为 dayCount 的基线窗口（用于对比） */
export function getBaselineDays(
  data: ActivityCalendarData,
  endDay: string,
  dayCount: number,
): ActivityDaySummary[] {
  if (!endDay || dayCount <= 0) return []
  const date = new Date(`${endDay}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - dayCount)
  const baselineEnd = date.toISOString().slice(0, 10)
  return getDayWindow(data, baselineEnd, dayCount)
}
