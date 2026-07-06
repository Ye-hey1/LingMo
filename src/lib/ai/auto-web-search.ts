export type AutoWebSearchDecisionReason =
  | 'manual-default'
  | 'recent-temporal'
  | 'live-domain'
  | 'fresh-version'
  | 'external-lookup'
  | 'stable'
  | 'empty'
  | 'needs-config'

export interface AutoWebSearchDecision {
  enabled: boolean
  shouldSearch: boolean
  confidence: number
  reason: AutoWebSearchDecisionReason
  label: string
  detail: string
  matchedSignals: string[]
  query: string
}

export interface AutoWebSearchOptions {
  userInput: string
  manualDefaultEnabled?: boolean
  hasSearchProvider?: boolean
  forceManualDefault?: boolean
}

const MAX_QUERY_LENGTH = 1200

const STABLE_TASK_HINTS = [
  /^(解释|说明|总结|翻译|润色|改写|写一段|生成|帮我写|脑暴|取名|分析这段|概括|你好|您好|哈喽|嗨|在吗)/,
  /^(explain|summarize|translate|rewrite|draft|brainstorm|write|name)\b/i,
  /怎么算|证明|推导|代码报错|这段代码|帮我实现|重构|优化这段/,
]

const RECENT_TEMPORAL_HINTS = [
  /最新|最近|近期|当前|现在|当下|今天|今日|昨天|明天|本周|这周|本月|今年|刚刚|刚才/,
  /\b(latest|recent|current|today|yesterday|tomorrow|this week|this month|this year|now)\b/i,
]

const LIVE_DOMAIN_HINTS = [
  /新闻|资讯|快讯|公告|发布|更新|进展|动态|趋势|热门|热榜|榜单|排行|直播|赛程|比分|天气|股价|汇率|价格|票房|财报|利率|政策|法规|投票|选举/,
  /\b(news|trending|weather|stock|price|exchange rate|schedule|score|release|changelog|version|earnings|policy|election)\b/i,
]

const EXTERNAL_LOOKUP_HINTS = [
  /查一下|搜一下|搜索|联网|上网|官网|链接|网址|来源|引用|资料|文献|论文|报告|数据集/,
  /\b(search|look up|browse|web|official docs|source|citation|paper|dataset|report)\b/i,
]

const FRESH_VERSION_HINTS = [
  /20(?:2[5-9]|3\d)/,
  /\bv?\d+\.\d+(?:\.\d+)?\b/,
]

function cleanQuery(input: string) {
  return input
    .replace(/^你正在执行一个应用内命令[:：][\s\S]*?\n\n/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
}

function matchSignals(input: string, patterns: RegExp[], label: string) {
  return patterns
    .filter(pattern => pattern.test(input))
    .map(() => label)
}

function inferConfidence(score: number) {
  if (score >= 4) return 0.96
  if (score >= 3) return 0.9
  if (score >= 2) return 0.82
  if (score >= 1) return 0.68
  return 0.3
}

export function decideAutoWebSearch(options: AutoWebSearchOptions): AutoWebSearchDecision {
  const query = cleanQuery(options.userInput)
  const hasSearchProvider = options.hasSearchProvider !== false

  if (!query) {
    return {
      enabled: false,
      shouldSearch: false,
      confidence: 1,
      reason: 'empty',
      label: '自动',
      detail: '输入后会自动判断是否需要联网。',
      matchedSignals: [],
      query,
    }
  }

  if (options.manualDefaultEnabled) {
    const matchedSignals = [
      ...matchSignals(query, RECENT_TEMPORAL_HINTS, '时间/最新'),
      ...matchSignals(query, LIVE_DOMAIN_HINTS, '动态领域'),
      ...matchSignals(query, EXTERNAL_LOOKUP_HINTS, '外部检索'),
      ...matchSignals(query, FRESH_VERSION_HINTS, '版本/年份'),
    ]
    const stableSignals = matchSignals(query, STABLE_TASK_HINTS, '稳定任务')
    const shouldSearch = options.forceManualDefault || matchedSignals.length > 0

    if (!shouldSearch) {
      return {
        enabled: false,
        shouldSearch: false,
        confidence: stableSignals.length > 0 ? 0.9 : 0.78,
        reason: 'stable',
        label: '自动',
        detail: stableSignals.length > 0
          ? '默认联网已开启，但当前更像寒暄、写作或本地上下文任务，暂不联网。'
          : '默认联网已开启，但未检测到外部检索或实时资料需求，暂不联网。',
        matchedSignals: Array.from(new Set(stableSignals)),
        query,
      }
    }

    if (!hasSearchProvider) {
      return {
        enabled: false,
        shouldSearch: true,
        confidence: 1,
        reason: 'needs-config',
        label: '待配置',
        detail: '默认联网已开启，但当前没有可用搜索渠道。',
        matchedSignals: ['默认联网'],
        query,
      }
    }

    return {
      enabled: true,
      shouldSearch: true,
      confidence: 1,
      reason: 'manual-default',
      label: '联网',
      detail: matchedSignals.length > 0
        ? `默认联网已开启，且检测到${Array.from(new Set(matchedSignals)).join('、')}信号，本轮会带入网页搜索结果。`
        : '按全局默认设置，本轮会带入网页搜索结果。',
      matchedSignals: matchedSignals.length > 0 ? Array.from(new Set(matchedSignals)) : ['默认联网'],
      query,
    }
  }

  const matchedSignals = [
    ...matchSignals(query, RECENT_TEMPORAL_HINTS, '时间/最新'),
    ...matchSignals(query, LIVE_DOMAIN_HINTS, '动态领域'),
    ...matchSignals(query, EXTERNAL_LOOKUP_HINTS, '外部检索'),
    ...matchSignals(query, FRESH_VERSION_HINTS, '版本/年份'),
  ]
  const stableSignals = matchSignals(query, STABLE_TASK_HINTS, '稳定任务')
  const score = matchedSignals.length - Math.min(stableSignals.length, 1)
  const shouldSearch = score > 0

  if (shouldSearch && !hasSearchProvider) {
    return {
      enabled: false,
      shouldSearch: true,
      confidence: inferConfidence(score),
      reason: 'needs-config',
      label: '待配置',
      detail: '这个问题看起来需要实时资料，但当前没有可用搜索渠道。',
      matchedSignals: Array.from(new Set(matchedSignals)),
      query,
    }
  }

  if (shouldSearch) {
    const reason = matchedSignals.includes('时间/最新')
      ? 'recent-temporal'
      : matchedSignals.includes('动态领域')
        ? 'live-domain'
        : matchedSignals.includes('版本/年份')
          ? 'fresh-version'
          : 'external-lookup'

    return {
      enabled: true,
      shouldSearch: true,
      confidence: inferConfidence(score),
      reason,
      label: '自动联网',
      detail: `检测到${Array.from(new Set(matchedSignals)).join('、')}信号，本轮会自动联网。`,
      matchedSignals: Array.from(new Set(matchedSignals)),
      query,
    }
  }

  return {
    enabled: false,
    shouldSearch: false,
    confidence: stableSignals.length > 0 ? 0.86 : 0.72,
    reason: 'stable',
    label: '自动',
    detail: stableSignals.length > 0
      ? '当前更像稳定知识、写作或本地上下文任务，暂不联网。'
      : '未检测到明显实时信号，暂不联网；需要时会由 Agent 工具策略兜底。',
    matchedSignals: Array.from(new Set(stableSignals)),
    query,
  }
}
