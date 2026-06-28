import { deriveIntentPolicy } from './tool-policy'

export type AgentTaskComplexity = 'trivial' | 'simple' | 'standard' | 'complex'
export type AgentExecutionRoute = 'direct_static' | 'quick_answer' | 'standard_agent' | 'deep_agent'

export interface AgentTaskRouteInput {
  userInput: string
  imageCount?: number
  forcedSkillIds?: string[]
  webSearchEnabled?: boolean
  hasLinkedContext?: boolean
  hasQuote?: boolean
  hasRag?: boolean
}

export interface AgentTaskRouteDecision {
  route: AgentExecutionRoute
  complexity: AgentTaskComplexity
  requiresRuntime: boolean
  allowPlanning: boolean
  maxIterations: number
  reason: string
}

const TRIVIAL_INPUTS = new Set([
  '你好',
  '您好',
  '嗨',
  '哈喽',
  '哈罗',
  '在吗',
  '在不在',
  '谢谢',
  '感谢',
  'hello',
  'hi',
  'hey',
  'thanks',
  'thankyou',
  'thx',
])

const QUICK_QUESTION_PATTERNS = [
  /^(什么是|啥是|何为|为什么|怎么理解|解释一下|介绍一下|简单说|简单解释|请解释|请介绍)/,
  /^(what is|what are|why|how does|explain|describe|tell me about)\b/i,
  /(区别是什么|有什么区别|是否可以|可不可以|能不能|是不是|对吗|吗\??$)/,
  /\b(difference between|can i|can you|is it|are there)\b/i,
]

const FOLLOW_UP_PATTERNS = [
  /^(继续|接着|然后|再来|再生成|再做|顺便|另外|刚才|基于刚才|在此基础上|那个|这个|它|继续用|再用)/,
  /(上面|前面|刚才|这段|这篇|这个文件|当前文件|当前笔记|我的笔记|我的知识库|这些内容)/,
  /\b(this|that|above|previous|earlier|same file|current file|my notes|my workspace)\b/i,
]

const TOOL_OR_CONTEXT_PATTERNS = [
  /查看|查询|获取|检索|搜索|读取|列出|打开|定位|引用|来源|证据|网页|联网|地图|路线|导航|天气|股票|价格|新闻|热点|最新|今天|昨天|明天|近期|实时|202[5-9]|203\d/,
  /分析|梳理|审视|排查|诊断|调研|对照|参考|借鉴|复盘|盘点|检查|评估|审计/,
  /\b(search|find|fetch|get|read|list|open|source|cite|citation|web|latest|today|yesterday|tomorrow|recent|real-time|realtime|weather|price|stock|route|map)\b/i,
  /\b(analyze|analyse|inspect|audit|diagnose|review|compare|reference|borrow|study|investigate|evaluate)\b/i,
]

const WRITE_OR_ACTION_PATTERNS = [
  /写入|输出到|改写|修改|编辑|更新|修复|重构|优化|改进|精简|省token|省 token|删除|移动|复制|重命名|保存|导出|制作|绘制|画出|整理成|运行|执行|安装|配置|迁移|部署|测试|提交/,
  /(?:创建|新建|新增|生成).{0,24}(?:文件|笔记|文档|目录|文件夹|标签|记录|提醒|图表|流程图|思维导图|白板|幻灯片|ppt|pdf|docx|xlsx)/,
  /(规划|设计|制定|重新规划|生成|整理).{0,30}(攻略|方案|行程|路线|计划|旅游|旅行).{0,24}(输出|保存|写入|导出|存成|存为|笔记|文档|文件)/,
  /(优化|改进|精简|完善|重写|调整).{0,30}(提示词|prompt|系统提示词|agent|运行逻辑|意图识别)/i,
  /\b(?:save|write|create|generate|produce|export).{0,40}(?:note|document|file|presentation|pptx|pdf|docx|xlsx)\b/i,
  /\b(?:plan|design|draft|write|create|generate|produce).{0,40}(?:itinerary|travel plan|trip plan|route|guide|proposal|report).{0,40}(?:save|write|export|file|note|document)\b/i,
  /\b(create|write|edit|modify|update|fix|repair|refactor|optimize|improve|polish|simplify|delete|move|copy|rename|save|export|generate|draw|run|execute|install|configure|migrate|deploy|test|commit)\b/i,
]

const COMPLEXITY_PATTERNS = [
  /先.*再|然后|接着|之后|并且|同时|还有|逐步|完整|全面|仔细|深入|所有|全部|每个|批量|多轮|规划|方案|攻略|行程|路线|输出到笔记|架构|排查|根因|复刻|借鉴|参考|对照|对比.*并|省token|省 token|系统提示词|运行逻辑|意图识别/,
  /\d+[、.．)]\s*\S+/,
  /\b(first.*then|step by step|comprehensive|deep|all|every|batch|architecture|root cause|compare.*and|system prompt|token saving|intent recognition)\b/i,
]

function compactSemanticText(value: string) {
  return Array.from(value.toLowerCase())
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .join('')
}

function matchesAny(patterns: RegExp[], value: string) {
  return patterns.some((pattern) => pattern.test(value))
}

function countTaskSeparators(value: string) {
  return value.match(/[、,，;；\n]/g)?.length || 0
}

function estimateComplexityScore(userInput: string) {
  let score = 0
  const length = Array.from(userInput.trim()).length
  if (length > 180) score += 1
  if (length > 420) score += 2
  if (matchesAny(COMPLEXITY_PATTERNS, userInput)) score += 2
  if (/(?:规划|设计|制定|重新规划|生成|整理).{0,30}(?:攻略|方案|行程|路线|计划).{0,24}(?:输出|保存|写入|导出|存成|存为|笔记|文档|文件)|(?:输出|保存|写入|整理|导出|存成|存为).{0,16}(?:到|为|成)?\s*(?:笔记|文档|文件)/.test(userInput)) score += 2
  score += Math.min(3, Math.floor(countTaskSeparators(userInput) / 2))
  if ((userInput.match(/\d+[、.．)]/g)?.length || 0) >= 2) score += 2
  return score
}

export function classifyAgentTask(input: AgentTaskRouteInput): AgentTaskRouteDecision {
  const userInput = input.userInput.trim()
  const compact = compactSemanticText(userInput)
  const forcedSkillIds = (input.forcedSkillIds || []).filter(Boolean)
  const intentPolicy = deriveIntentPolicy(userInput)
  const hasImages = (input.imageCount || 0) > 0
  const hasExternalContext = Boolean(input.hasLinkedContext || input.hasQuote)
  const hasRuntimeRequirement = forcedSkillIds.length > 0 ||
    Boolean(input.webSearchEnabled) ||
    intentPolicy.allowWrite ||
    intentPolicy.allowDestructive ||
    intentPolicy.allowExecute ||
    matchesAny(TOOL_OR_CONTEXT_PATTERNS, userInput) ||
    matchesAny(WRITE_OR_ACTION_PATTERNS, userInput)

  if (!userInput) {
    return {
      route: 'direct_static',
      complexity: 'trivial',
      requiresRuntime: false,
      allowPlanning: false,
      maxIterations: 0,
      reason: 'empty input',
    }
  }

  if (TRIVIAL_INPUTS.has(compact) || compact === '你好小墨' || compact === 'hi小墨') {
    return {
      route: 'direct_static',
      complexity: 'trivial',
      requiresRuntime: false,
      allowPlanning: false,
      maxIterations: 0,
      reason: 'trivial social turn',
    }
  }

  if (forcedSkillIds.length > 0) {
    return {
      route: 'standard_agent',
      complexity: 'standard',
      requiresRuntime: true,
      allowPlanning: false,
      maxIterations: 12,
      reason: 'explicit skill invocation',
    }
  }

  const complexityScore = estimateComplexityScore(userInput)
  const needsContextFollowUp = matchesAny(FOLLOW_UP_PATTERNS, userInput)
  const simpleIndependentQuestion = !hasRuntimeRequirement &&
    !hasExternalContext &&
    !needsContextFollowUp &&
    complexityScore === 0 &&
    (matchesAny(QUICK_QUESTION_PATTERNS, userInput) || Array.from(userInput).length <= 80)

  if (simpleIndependentQuestion || (hasImages && !hasRuntimeRequirement && complexityScore <= 1 && !needsContextFollowUp)) {
    return {
      route: 'quick_answer',
      complexity: 'simple',
      requiresRuntime: false,
      allowPlanning: false,
      maxIterations: 1,
      reason: hasImages ? 'simple vision/chat answer without tools' : 'simple independent answer without tools',
    }
  }

  if (complexityScore >= 4 || (hasRuntimeRequirement && complexityScore >= 2)) {
    return {
      route: 'deep_agent',
      complexity: 'complex',
      requiresRuntime: true,
      allowPlanning: true,
      maxIterations: 24,
      reason: 'multi-step or high-context task',
    }
  }

  return {
    route: 'standard_agent',
    complexity: hasRuntimeRequirement || hasExternalContext || needsContextFollowUp ? 'standard' : 'simple',
    requiresRuntime: true,
    allowPlanning: complexityScore >= 2,
    maxIterations: hasRuntimeRequirement ? 12 : 8,
    reason: hasRuntimeRequirement ? 'tool or workspace context may be needed' : 'context-dependent agent turn',
  }
}

export function shouldBypassAgentRuntime(decision: AgentTaskRouteDecision) {
  return decision.route === 'direct_static' || decision.route === 'quick_answer'
}
