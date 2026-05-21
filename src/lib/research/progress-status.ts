import type { DeepResearchProgress } from './deep-research'

const RESEARCH_PROGRESS_PREFIX = '<!-- deep-research-progress '
const RESEARCH_PROGRESS_SUFFIX = ' -->'

export type ResearchProgressStep = {
  id: string
  title: string
  description: string
  status: 'done' | 'active' | 'pending'
}

export type ResearchProgressView = {
  title: string
  statusText: string
  currentStep: string
  currentDetail?: string
  startedAt: number
  estimatedMinutes: string
  completedQueries: number
  totalQueries: number
  learningsCount: number
  visitedUrlsCount: number
  steps: ResearchProgressStep[]
}

const STAGE_INDEX: Record<DeepResearchProgress['stage'], number> = {
  initializing: 1,
  planning: 2,
  searching: 3,
  analyzing: 4,
  verifying: 6,
  writing: 7,
  done: 7,
}

const STEP_BLUEPRINTS = [
  {
    id: 'scope',
    title: '梳理研究目标',
    description: '确认研究问题、边界和输出方向。',
  },
  {
    id: 'runtime',
    title: '连接检索能力',
    description: '检查 Firecrawl MCP，并准备联网搜索通道。',
  },
  {
    id: 'plan',
    title: '规划研究路径',
    description: '拆分搜索问题，确定第一轮检索方向。',
  },
  {
    id: 'search',
    title: '执行联网检索',
    description: '按规划搜索资料、收集来源和摘要。',
  },
  {
    id: 'analysis',
    title: '提炼证据和发现',
    description: '分析搜索结果，抽取关键结论和追问方向。',
  },
  {
    id: 'deepen',
    title: '递归扩展研究',
    description: '围绕新问题继续检索，补足证据链。',
  },
  {
    id: 'verify',
    title: '核验证据链',
    description: '检查来源独立性、置信度和引用映射。',
  },
  {
    id: 'report',
    title: '生成研究报告',
    description: '整理结论、局限和来源列表。',
  },
]

export function buildResearchProgressView(
  progress: DeepResearchProgress | null,
  options: {
    query: string
    startedAt: number
    estimatedMinutes?: string
  },
): ResearchProgressView {
  const activeIndex = progress ? STAGE_INDEX[progress.stage] : 0
  const steps = STEP_BLUEPRINTS.map((step, index) => ({
    ...step,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  })) satisfies ResearchProgressStep[]

  const activeStep = steps.find(step => step.status === 'active') || steps[steps.length - 1]
  const currentDetail = progress?.currentQuery
    ? `当前查询：${progress.currentQuery}`
    : options.query
      ? `研究主题：${options.query}`
      : undefined

  return {
    title: '深度研究进行中',
    statusText: progress?.stage === 'done' ? '研究完成，正在收尾' : '正在研究',
    currentStep: activeStep.title,
    currentDetail,
    startedAt: options.startedAt,
    estimatedMinutes: options.estimatedMinutes || '3-6 分钟',
    completedQueries: progress?.completedQueries ?? 0,
    totalQueries: progress?.totalQueries ?? 0,
    learningsCount: progress?.learningsCount ?? 0,
    visitedUrlsCount: progress?.visitedUrlsCount ?? 0,
    steps,
  }
}

export function encodeResearchProgressView(view: ResearchProgressView) {
  const meta = `${RESEARCH_PROGRESS_PREFIX}${encodeURIComponent(JSON.stringify(view))}${RESEARCH_PROGRESS_SUFFIX}`
  const stepLines = view.steps.map((step) => {
    const prefix = step.status === 'done' ? '[x]' : step.status === 'active' ? '[~]' : '[ ]'
    return `- ${prefix} ${step.title}：${step.description}`
  })

  return [
    meta,
    `## ${view.title}`,
    '',
    `预计输出时间：${view.estimatedMinutes}`,
    `当前步骤：${view.currentStep}`,
    view.currentDetail || '',
    '',
    ...stepLines,
  ].filter(Boolean).join('\n')
}

export function parseResearchProgressView(content?: string | null): ResearchProgressView | null {
  if (!content?.startsWith(RESEARCH_PROGRESS_PREFIX)) {
    return null
  }

  const endIndex = content.indexOf(RESEARCH_PROGRESS_SUFFIX)
  if (endIndex < 0) {
    return null
  }

  try {
    return JSON.parse(decodeURIComponent(content.slice(RESEARCH_PROGRESS_PREFIX.length, endIndex))) as ResearchProgressView
  } catch {
    return null
  }
}
